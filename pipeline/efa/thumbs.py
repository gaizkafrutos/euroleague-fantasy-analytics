"""Miniaturas de fotos y escudos para los avatares de la web.

Las fotos de la CDN oficial son PNG de 750x1000 (500-850 KB) y la web las pinta
a 30-36 px: /mercado llegaba a pesar 9 MB, 8,4 de ellos en 17 avatares. No se
usa `next/image` porque el plan Hobby de Vercel da 5K transformaciones al mes
(ver `web/next.config.mjs`), así que se reducen aquí, una vez, y se sirven como
estáticos desde `web/public/`.

Cada miniatura tiene nombre estable (`fotos/<id>.webp`, `escudos/<club>.webp`)
y el manifiesto guarda de qué URL salió: solo se descarga lo que es nuevo o ha
cambiado de origen, no las 350 fotos en cada captura del bot. Si una descarga
falla se conserva la miniatura anterior; si no la hay, el campo queda a null y
la web tira de la URL original.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import requests

from efa.config import THUMBS_MANIFEST_PATH, WEB_PUBLIC_DIR

log = logging.getLogger(__name__)

#: Anchura de las fotos: el avatar más grande mide 36 px, y a 2x son 72; 96 deja
#: margen para pantallas de 3x sin acercarse al peso del original.
PHOTO_WIDTH = 96
#: Los escudos van con `object-fit: contain` y 5 px de relleno en 36 px.
CREST_WIDTH = 72
WEBP_QUALITY = 80

Fetch = Callable[[str], bytes]


def _fetch(url: str) -> bytes:
    response = requests.get(
        url,
        timeout=30,
        headers={"User-Agent": "euroleague-fantasy-analytics/1.0 (personal, non-commercial)"},
    )
    response.raise_for_status()
    return response.content


def make_thumb(content: bytes, width: int) -> bytes:
    """WebP de `width` px de ancho, con la proporción y la transparencia del
    original: el recorte lo sigue haciendo el CSS, igual que con la foto grande."""
    from PIL import Image

    with Image.open(io.BytesIO(content)) as image:
        image = image.convert("RGBA")
        if image.width > width:
            height = max(1, round(image.height * width / image.width))
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, "WEBP", quality=WEBP_QUALITY, method=6)
    return out.getvalue()


def _version(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]


def build_thumbs(
    wanted: dict[str, tuple[str, int]],
    *,
    root: Path = WEB_PUBLIC_DIR,
    manifest_path: Path = THUMBS_MANIFEST_PATH,
    fetch: Fetch = _fetch,
    workers: int = 8,
) -> dict[str, str]:
    """Genera las miniaturas que faltan y devuelve {ruta: URL pública}.

    `wanted` va de ruta relativa a `root` (``"fotos/3765.webp"``) a la URL de
    origen y el ancho. La URL pública lleva `?v=` con un hash del origen para
    que el navegador no se quede con la foto anterior cuando la cambian.
    Borra las miniaturas que ya no pide nadie.
    """
    manifest: dict[str, str] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    pending = {
        rel: (url, width)
        for rel, (url, width) in wanted.items()
        if manifest.get(rel) != url or not (root / rel).exists()
    }

    def work(item: tuple[str, tuple[str, int]]) -> tuple[str, bytes | None]:
        rel, (url, width) = item
        try:
            return rel, make_thumb(fetch(url), width)
        except Exception as exc:  # noqa: BLE001 - una foto rota no tumba el build
            log.warning("Miniatura %s sin generar (%s): %s", rel, url, exc)
            return rel, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(work, pending.items()))

    for rel, data in results:
        if data is None:
            continue
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        manifest[rel] = wanted[rel][0]

    # Fuera lo que ya no se pide (jugadores que salen del mercado). Con `wanted`
    # vacío algo ha ido mal aguas arriba: mejor no borrar nada.
    if wanted:
        for rel in list(manifest):
            if rel not in wanted:
                (root / rel).unlink(missing_ok=True)
                del manifest[rel]
        for folder in {Path(rel).parent for rel in wanted}:
            for path in (root / folder).glob("*.webp"):
                if path.relative_to(root).as_posix() not in wanted:
                    path.unlink()

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )

    fresh = sum(1 for _, data in results if data is not None)
    if pending:
        log.info("Miniaturas: %d nuevas, %d reutilizadas", fresh, len(wanted) - len(pending))

    return {
        rel: f"/{rel}?v={_version(manifest[rel])}"
        for rel in wanted
        if rel in manifest and (root / rel).exists()
    }


def apply_thumbs(records: Iterable[dict[str, Any]], **kwargs: Any) -> None:
    """Añade `thumb` (foto) y `clubCrestThumb` (escudo) a cada jugador."""
    records = list(records)
    wanted: dict[str, tuple[str, int]] = {}
    for record in records:
        # Antes de `clean()` una foto que falta puede llegar como NaN, no None.
        image, crest = record.get("image"), record.get("clubCrest")
        if isinstance(image, str) and image:
            wanted[f"fotos/{record['id']}.webp"] = (image, PHOTO_WIDTH)
        if isinstance(crest, str) and crest and record.get("club"):
            wanted[f"escudos/{record['club']}.webp"] = (crest, CREST_WIDTH)

    public = build_thumbs(wanted, **kwargs)
    for record in records:
        record["thumb"] = public.get(f"fotos/{record['id']}.webp")
        record["clubCrestThumb"] = public.get(f"escudos/{record.get('club')}.webp")
