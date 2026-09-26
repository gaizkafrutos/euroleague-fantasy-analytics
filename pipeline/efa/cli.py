"""Interfaz de línea de comandos del pipeline.

    python -m efa ingest-official     # datos oficiales (sin token)
    python -m efa snapshot            # precios del Fantasy (necesita token)
    python -m efa build               # genera los JSON de la web
    python -m efa refresh             # ingest + snapshot + build, todo seguido
    python -m efa discover            # mapea endpoints de Fantaking
    python -m efa verify              # contrasta la fórmula con los datos reales
    python -m efa injuries            # parte de lesiones de BasketNews
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Any

from efa.config import PRIOR_SEASON_CODE, ROSTER_BUDGET, SEASON_CODE


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(message)s",
        stream=sys.stdout,
    )


# ---------------------------------------------------------------------------
# Comandos
# ---------------------------------------------------------------------------
def cmd_ingest_official(args: argparse.Namespace) -> int:
    from efa.ingest.official import ingest_all

    summary = ingest_all(
        args.season,
        None if args.no_prior else args.prior_season,
        with_boxscores=not args.no_boxscores,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def cmd_snapshot(args: argparse.Namespace) -> int:
    from efa.clients import FantakingAuthError
    from efa.ingest.prices import take_snapshot

    try:
        path = take_snapshot(matchday_id=args.matchday_id, label=args.label)
    except FantakingAuthError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2
    print(f"OK: {path}")
    return 0


def cmd_roster(args: argparse.Namespace) -> int:
    from efa.clients import FantakingAuthError, FantakingError
    from efa.ingest.roster import fetch_roster

    try:
        record = fetch_roster(team_id=args.team_id, matchday_id=args.matchday_id)
    except (FantakingAuthError, FantakingError, ValueError) as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2
    print(json.dumps({k: v for k, v in record.items() if k != "payload"}, indent=2, ensure_ascii=False))
    return 0


def cmd_discover(args: argparse.Namespace) -> int:
    from efa.clients import FantakingAuthError, FantakingClient

    try:
        client = FantakingClient()
    except FantakingAuthError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2

    report = client.discover()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    working = [entry["path"] for entry in report if entry.get("status") == 200]
    print(f"\nRutas que responden 200: {working or 'ninguna'}", file=sys.stderr)
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from efa.build import build

    meta = build(budget=args.budget)
    print(json.dumps(meta, indent=2, ensure_ascii=False))
    for warning in meta.get("warnings", []):
        print(f"AVISO: {warning}", file=sys.stderr)
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    from efa.verify import run_verification

    report = run_verification()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report.get("ok") else 1


def cmd_injuries(args: argparse.Namespace) -> int:
    from efa.ingest.injuries import fetch_report, save_report

    report = fetch_report()
    path = save_report(report)
    print(
        f"Parte de lesiones: {len(report['rows'])} filas, actualizado {report['updatedAt']} -> {path}"
    )
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    from efa import demo

    if args.clear:
        removed = demo.clear()
        print(f"Eliminados {removed} ficheros de demostración.")
        return 0

    written = demo.generate(args.season, snapshots=args.snapshots)
    print("\n".join(written))
    print(
        "\nPrecios DE MENTIRA, derivados del rendimiento real para poder ver la web "
        "sin token. Bórralos con `efa demo --clear` antes de capturar los reales.",
        file=sys.stderr,
    )
    return 0


def cmd_refresh(args: argparse.Namespace) -> int:
    """Ciclo completo, tolerante a que falte el token."""
    from efa.build import build
    from efa.clients import FantakingAuthError, FantakingError
    from efa.ingest.official import ingest_all
    from efa.ingest.prices import take_snapshot

    ingest_all(args.season, None if args.no_prior else args.prior_season)

    try:
        from efa.ingest.injuries import fetch_report, save_report

        save_report(fetch_report())
    except Exception as exc:  # noqa: BLE001 - el parte es un extra, no bloquea
        print(f"AVISO: no se pudo leer el parte de lesiones ({exc}).", file=sys.stderr)

    try:
        take_snapshot(label=args.label)
    except (FantakingAuthError, FantakingError) as exc:
        if args.require_prices:
            print(f"\n{exc}\n", file=sys.stderr)
            return 2
        print(f"AVISO: no se pudo capturar precios ({exc}). Se sigue con datos oficiales.", file=sys.stderr)

    meta = build(budget=args.budget)
    print(json.dumps(meta, indent=2, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="efa", description="EuroLeague Fantasy Analytics")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest-official", help="Clubes, jugadores, calendario y boxscores")
    ingest.add_argument("--season", default=SEASON_CODE)
    ingest.add_argument("--prior-season", default=PRIOR_SEASON_CODE)
    ingest.add_argument("--no-prior", action="store_true", help="No ingerir la temporada anterior")
    ingest.add_argument("--no-boxscores", action="store_true")
    ingest.set_defaults(func=cmd_ingest_official)

    snapshot = sub.add_parser("snapshot", help="Captura precios del Fantasy (requiere token)")
    snapshot.add_argument("--label", default=None, help='Etiqueta del snapshot, ej. "R03"')
    snapshot.add_argument("--matchday-id", type=int, default=None)
    snapshot.set_defaults(func=cmd_snapshot)

    roster = sub.add_parser("roster", help="Descarga tu equipo fantasy")
    roster.add_argument("--team-id", type=int, default=None)
    roster.add_argument("--matchday-id", type=int, default=None)
    roster.set_defaults(func=cmd_roster)

    discover = sub.add_parser("discover", help="Mapea qué endpoints de Fantaking responden")
    discover.set_defaults(func=cmd_discover)

    build_cmd = sub.add_parser("build", help="Genera los JSON que consume la web")
    build_cmd.add_argument("--budget", type=float, default=ROSTER_BUDGET)
    build_cmd.set_defaults(func=cmd_build)

    verify = sub.add_parser("verify", help="Contrasta la fórmula de puntuación con los datos reales")
    verify.set_defaults(func=cmd_verify)

    injuries = sub.add_parser("injuries", help="Descarga el parte de lesiones (BasketNews)")
    injuries.set_defaults(func=cmd_injuries)

    demo = sub.add_parser("demo", help="Genera precios de demostración (sin token)")
    demo.add_argument("--season", default=PRIOR_SEASON_CODE, help="Temporada de la que derivar el rendimiento")
    demo.add_argument("--snapshots", type=int, default=4)
    demo.add_argument("--clear", action="store_true", help="Borra los datos de demostración")
    demo.set_defaults(func=cmd_demo)

    refresh = sub.add_parser("refresh", help="ingest + snapshot + build")
    refresh.add_argument("--season", default=SEASON_CODE)
    refresh.add_argument("--prior-season", default=PRIOR_SEASON_CODE)
    refresh.add_argument("--no-prior", action="store_true")
    refresh.add_argument("--label", default=None)
    refresh.add_argument("--budget", type=float, default=ROSTER_BUDGET)
    refresh.add_argument("--require-prices", action="store_true", help="Falla si no hay token válido")
    refresh.set_defaults(func=cmd_refresh)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    handler: Any = args.func
    return int(handler(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
