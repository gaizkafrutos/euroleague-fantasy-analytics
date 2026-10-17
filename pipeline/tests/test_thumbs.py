"""Miniaturas de los avatares: caché por URL de origen y repuestos."""
from __future__ import annotations

import io
import json

import pytest
from PIL import Image

from efa.thumbs import PHOTO_WIDTH, apply_thumbs, build_thumbs, make_thumb


def png(width=750, height=1000) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, height), (200, 30, 30, 128)).save(out, "PNG")
    return out.getvalue()


class FakeCdn:
    def __init__(self, broken=()):
        self.calls: list[str] = []
        self.broken = set(broken)

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url in self.broken:
            raise OSError("404")
        return png()


@pytest.fixture
def dirs(tmp_path):
    return {"root": tmp_path / "public", "manifest_path": tmp_path / "miniaturas.json"}


def test_reduce_a_webp_con_la_proporcion_y_la_transparencia():
    with Image.open(io.BytesIO(make_thumb(png(), PHOTO_WIDTH))) as thumb:
        assert thumb.format == "WEBP"
        assert thumb.size == (96, 128)
        assert thumb.mode == "RGBA"


def test_no_amplia_una_imagen_mas_pequena():
    with Image.open(io.BytesIO(make_thumb(png(40, 40), 72))) as thumb:
        assert thumb.size == (40, 40)


def test_solo_descarga_lo_nuevo_o_lo_que_cambia_de_origen(dirs):
    cdn = FakeCdn()
    wanted = {"fotos/1.webp": ("https://cdn/a.png", 96), "fotos/2.webp": ("https://cdn/b.png", 96)}
    first = build_thumbs(wanted, fetch=cdn, **dirs)
    assert sorted(cdn.calls) == ["https://cdn/a.png", "https://cdn/b.png"]
    assert first["fotos/1.webp"].startswith("/fotos/1.webp?v=")

    cdn.calls.clear()
    assert build_thumbs(wanted, fetch=cdn, **dirs) == first
    assert cdn.calls == []

    wanted["fotos/2.webp"] = ("https://cdn/b2.png", 96)
    second = build_thumbs(wanted, fetch=cdn, **dirs)
    assert cdn.calls == ["https://cdn/b2.png"]
    assert second["fotos/1.webp"] == first["fotos/1.webp"]
    assert second["fotos/2.webp"] != first["fotos/2.webp"]  # la versión rompe la caché del navegador


def test_regenera_si_falta_el_fichero(dirs):
    cdn = FakeCdn()
    wanted = {"fotos/1.webp": ("https://cdn/a.png", 96)}
    build_thumbs(wanted, fetch=cdn, **dirs)
    (dirs["root"] / "fotos/1.webp").unlink()
    build_thumbs(wanted, fetch=cdn, **dirs)
    assert cdn.calls == ["https://cdn/a.png", "https://cdn/a.png"]


def test_si_la_descarga_falla_conserva_la_anterior(dirs):
    build_thumbs({"fotos/1.webp": ("https://cdn/a.png", 96)}, fetch=FakeCdn(), **dirs)
    before = build_thumbs({"fotos/1.webp": ("https://cdn/a.png", 96)}, fetch=FakeCdn(), **dirs)

    broken = FakeCdn(broken={"https://cdn/nueva.png", "https://cdn/c.png"})
    after = build_thumbs(
        {"fotos/1.webp": ("https://cdn/nueva.png", 96), "fotos/3.webp": ("https://cdn/c.png", 96)},
        fetch=broken,
        **dirs,
    )
    assert after == {"fotos/1.webp": before["fotos/1.webp"]}  # la 3 no existe: sin miniatura
    manifest = json.loads(dirs["manifest_path"].read_text(encoding="utf-8"))
    assert manifest == {"fotos/1.webp": "https://cdn/a.png"}  # se reintentará en el siguiente build


def test_borra_las_que_ya_no_se_piden(dirs):
    cdn = FakeCdn()
    build_thumbs({"fotos/1.webp": ("https://cdn/a.png", 96), "fotos/2.webp": ("https://cdn/b.png", 96)},
                 fetch=cdn, **dirs)
    (dirs["root"] / "fotos/huerfana.webp").write_bytes(b"x")
    build_thumbs({"fotos/1.webp": ("https://cdn/a.png", 96)}, fetch=cdn, **dirs)
    assert sorted(p.name for p in (dirs["root"] / "fotos").iterdir()) == ["1.webp"]
    assert list(json.loads(dirs["manifest_path"].read_text(encoding="utf-8"))) == ["fotos/1.webp"]


def test_apply_thumbs_rellena_foto_y_escudo(dirs):
    records = [
        {"id": 7, "image": "https://cdn/7.png", "club": "MAD", "clubCrest": "https://cdn/mad.png"},
        {"id": 8, "image": None, "club": "MAD", "clubCrest": "https://cdn/mad.png"},
        {"id": 9, "image": "https://cdn/9.png", "club": None, "clubCrest": None},
        {"id": 10, "image": float("nan"), "club": "MAD", "clubCrest": "https://cdn/mad.png"},
    ]
    cdn = FakeCdn()
    apply_thumbs(records, fetch=cdn, **dirs)
    assert len(cdn.calls) == 3  # el escudo del MAD, una sola vez
    assert records[0]["thumb"].startswith("/fotos/7.webp?v=")
    assert records[0]["clubCrestThumb"].startswith("/escudos/MAD.webp?v=")
    assert records[1]["thumb"] is None
    assert records[1]["clubCrestThumb"] == records[0]["clubCrestThumb"]
    assert records[2]["clubCrestThumb"] is None
    assert records[3]["thumb"] is None  # NaN de pandas: sin foto, no una URL "nan"
