"""Backtest de lo que la web PUBLICÓ, jornada a jornada.

El backtest de `projection.backtest()` mide el modelo en condiciones de
laboratorio: solo a quien jugó, y solo a quien tiene predicción en todos los
modelos. Al usuario le llega otra cosa: la proyección final (con la
probabilidad de jugar dentro) de todo el mercado, recién llegados incluidos, y
quien no juega puntúa 0. En la auditoría de la J3 eso destapó un sesgo de +1,1
que el backtest de laboratorio no veía, sobre todo por la probabilidad de jugar.

Dos piezas:

  archive_predictions()  en cada build ANTERIOR al primer partido de la jornada,
                         guarda lo publicado en data/processed/predictions/RNN.json.
                         La última captura antes del salto inicial es la que vale.
  evaluate_published()   con la jornada jugada (y revalorizada), compara lo
                         guardado con lo real: error frente a la media de
                         temporada, calibración de la probabilidad de jugar, de
                         la de subir y de la horquilla, y lo que puntuó el once
                         óptimo que salía de lo publicado.
"""
from __future__ import annotations

import json
import logging
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from efa.config import PROCESSED_DIR, ROSTER_BUDGET

log = logging.getLogger(__name__)

PREDICTIONS_DIR = PROCESSED_DIR / "predictions"

#: Lo que se guarda de cada jugador: lo justo para evaluarlo después.
FIELDS = (
    "id", "personCode", "isCoach", "position", "club", "price",
    "projectedFp", "projectedIfPlays", "playProb",
)


def _game_time(game: dict[str, Any]) -> pd.Timestamp | None:
    stamp = pd.to_datetime(game.get("utcDate"), utc=True, errors="coerce")
    return None if pd.isna(stamp) else stamp


def round_start(games: list[dict[str, Any]], round_number: int) -> pd.Timestamp | None:
    times = [t for g in games if int(g.get("round") or 0) == round_number and (t := _game_time(g)) is not None]
    return min(times) if times else None


def prediction_row(record: dict[str, Any]) -> dict[str, Any]:
    row = {key: record.get(key) for key in FIELDS}
    # Se paga el precio pendiente si lo hay (es el que usa la web).
    row["price"] = record.get("pricePending") or record.get("price")
    row["availability"] = (record.get("availability") or {}).get("level")
    row["neverDressed"] = (record.get("perf") or {}).get("games") in (None, 0)
    outlook = record.get("outlook") or {}
    for key in ("riseProb", "expectedChange", "floor", "ceiling", "p90"):
        row[key] = outlook.get(key)
    return row


def archive_predictions(
    records: list[dict[str, Any]],
    games: list[dict[str, Any]],
    round_now: int,
    *,
    now: datetime | None = None,
) -> str | None:
    """Guarda lo publicado para `round_now` si la jornada aún no ha empezado."""
    now = now or datetime.now(timezone.utc)
    start = round_start(games, round_now)
    if start is None or pd.Timestamp(now) >= start:
        return None
    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    path = PREDICTIONS_DIR / f"R{round_now:02d}.json"
    payload = {
        "round": round_now,
        "generatedAt": pd.Timestamp(now).isoformat(),
        "players": [prediction_row(r) for r in records],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path.name


# ---------------------------------------------------------------------------
# Evaluación
# ---------------------------------------------------------------------------
def _score(pred: pd.Series, real: pd.Series) -> dict[str, float]:
    mask = pred.notna() & real.notna()
    err = pred[mask] - real[mask]
    if not len(err):
        return {}
    spearman = pd.Series(pred[mask]).rank().corr(pd.Series(real[mask]).rank())
    return {
        "mae": round(float(err.abs().mean()), 3),
        "rmse": round(float(np.sqrt((err**2).mean())), 3),
        "bias": round(float(err.mean()), 3),
        "spearman": round(float(spearman), 3),
    }


def _price_after(history: pd.DataFrame | None, games: list[dict[str, Any]], round_number: int) -> dict[int, float]:
    """Cotización de cada jugador tras la revalorización de la jornada."""
    if history is None or history.empty:
        return {}
    times = [t for g in games if int(g.get("round") or 0) == round_number and (t := _game_time(g)) is not None]
    if not times:
        return {}
    stamps = pd.to_datetime(history["captured_at"], utc=True)
    before = history[stamps < min(times)]
    if before.empty:
        return {}
    base = before[pd.to_datetime(before["captured_at"], utc=True) == pd.to_datetime(before["captured_at"], utc=True).max()]
    base_q = dict(zip(base["fantaking_id"].astype(int), base["quotation"], strict=False))
    for stamp in sorted(stamps[stamps > max(times)].unique()):
        snap = history[stamps == stamp]
        quotes = dict(zip(snap["fantaking_id"].astype(int), snap["quotation"], strict=False))
        common = [pid for pid in quotes if pid in base_q]
        if common and np.mean([quotes[p] != base_q[p] for p in common]) >= 0.5:
            return quotes
    return {}


def _lineup_check(
    prediction: dict[str, Any],
    scores: pd.Series,
    coach_scores: dict[str, float] | None,
    budget: float,
) -> dict[str, Any] | None:
    """El once óptimo de lo publicado: lo que proyectaba y lo que puntuó.

    Se rehace con el optimizador sobre las proyecciones archivadas (las mismas
    reglas que `build._build_optimal_lineup`, salvo la inscripción, que no se
    archiva) y se puntúa con los papeles fijados antes de la jornada: quinteto
    y sexto al 100 %, banquillo a la mitad y capitán doble. `best` es el mejor
    once posible sabiendo ya los resultados, para dar escala.
    """
    from efa.optimizer import BENCH_MULTIPLIER, CAPTAIN_MULTIPLIER, Candidate, assign_roles, optimize

    players, coaches, real = [], [], {}
    for row in prediction["players"]:
        price = pd.to_numeric(row.get("price"), errors="coerce")
        projection = pd.to_numeric(row.get("projectedFp"), errors="coerce")
        if pd.isna(price) or price <= 0:
            continue
        key, club = str(row.get("id")), str(row.get("club") or "")
        if row.get("isCoach"):
            if coach_scores is None:
                continue
            real[key] = float(coach_scores.get(club, 0.0))
            coaches.append(Candidate(key, "", "E", club, float(price), 0.0 if pd.isna(projection) else float(projection)))
            continue
        if row.get("position") not in {"G", "F", "C"} or pd.isna(projection) or row.get("availability") == "out":
            continue
        real[key] = float(scores.get(row.get("personCode"), 0.0))
        players.append(Candidate(key, "", row["position"], club, float(price), float(projection)))
    if len(players) < 10:
        return None

    def scored(lineup: Any, points: dict[str, float]) -> float:
        starters, sixth, bench = assign_roles(lineup.players)
        full = sum(points[c.key] for c in starters) + (points[sixth.key] if sixth else 0.0)
        half = BENCH_MULTIPLIER * sum(points[c.key] for c in bench)
        captain = (CAPTAIN_MULTIPLIER - 1) * points[lineup.captain.key] if lineup.captain else 0.0
        return full + half + captain + (points[lineup.coach.key] if lineup.coach else 0.0)

    lineup = optimize(players, budget=budget, coaches=coaches)
    if lineup is None:
        return None
    # Los papeles (quinteto, sexto, capitán) se fijan con la proyección.
    projected = {c.key: c.projection for c in [*lineup.players, *([lineup.coach] if lineup.coach else [])]}
    hindsight = optimize(
        [replace(c, projection=real[c.key]) for c in players],
        budget=budget,
        coaches=[replace(c, projection=real[c.key]) for c in coaches],
    )
    return {
        "projected": round(scored(lineup, projected), 1),
        "real": round(scored(lineup, real), 1),
        "best": round(hindsight.scored_projection, 1) if hindsight else None,
        "withCoach": bool(coaches),
    }


def evaluate_round(
    prediction: dict[str, Any],
    gamelog: pd.DataFrame,
    games: list[dict[str, Any]],
    history: pd.DataFrame | None = None,
    coach_log: pd.DataFrame | None = None,
    *,
    budget: float = ROSTER_BUDGET,
) -> dict[str, Any] | None:
    """Lo publicado antes de una jornada frente a lo que pasó en ella."""
    number = int(prediction["round"])
    in_round = [g for g in games if int(g.get("round") or 0) == number]
    if not in_round or not all(g.get("played") for g in in_round):
        return None
    frame = pd.DataFrame(prediction["players"])
    # Una predicción antigua o recortada puede no traer todos los campos.
    for column in ("price", "projectedIfPlays", "playProb", "availability", "neverDressed",
                   "riseProb", "expectedChange", "floor", "ceiling", "p90"):
        if column not in frame.columns:
            frame[column] = np.nan
    frame = frame[~frame["isCoach"].astype(bool) & frame["personCode"].notna()].copy()
    if frame.empty:
        return None

    now = gamelog[gamelog["round"] == number]
    scores = now[now["played"]].groupby("person_code")["fantasy_points"].sum()
    before = gamelog[(gamelog["round"] < number) & gamelog["played"]]
    mean = before.groupby("person_code")["fantasy_points"].mean()
    frame["played"] = frame["personCode"].isin(scores.index)
    frame["real"] = frame["personCode"].map(scores).fillna(0.0)
    frame["mean"] = frame["personCode"].map(mean).fillna(0.0)

    out: dict[str, Any] = {
        "round": number,
        "n": int(len(frame)),
        "model": _score(frame["projectedFp"], frame["real"]),
        "mean": _score(frame["mean"], frame["real"]),
    }
    # Sesgo "si juega" de los caros (≥12 cr): son los candidatos a capitán, y en
    # J2–J3 salían sobreproyectados (+1,5 y +2,5). Se vigila aquí.
    expensive = frame[
        frame["played"] & frame["projectedIfPlays"].notna()
        & (pd.to_numeric(frame["price"], errors="coerce") >= 12)
    ]
    out["biasExpensiveIfPlays"] = (
        round(float((expensive["projectedIfPlays"] - expensive["real"]).mean()), 3) if len(expensive) else None
    )
    out["expensiveN"] = int(len(expensive))

    # Probabilidad de jugar: lo que se dijo frente a lo que pasó, por grupos.
    groups = frame["availability"].fillna("")
    groups = groups.where(groups != "", np.where(frame["neverDressed"].fillna(False).astype(bool), "nunca convocado", "sin parte"))
    calibration = {}
    for name, part in frame.groupby(groups):
        prob = pd.to_numeric(part["playProb"], errors="coerce")
        calibration[str(name)] = {
            "n": int(len(part)),
            "predicted": round(float(prob.mean()), 3) if prob.notna().any() else None,
            "real": round(float(part["played"].mean()), 3),
        }
    out["playProb"] = calibration

    coach_scores = None
    if coach_log is not None and not coach_log.empty:
        rows = coach_log[coach_log["round"] == number]
        coach_scores = rows.groupby("club_code")["fantasy_points"].sum().to_dict()
    lineup = _lineup_check(prediction, scores, coach_scores, budget)
    if lineup:
        out["lineup"] = lineup

    # Horquilla publicada (p25–p75): debería recoger la mitad de los resultados.
    band = frame.dropna(subset=["floor", "ceiling"])
    if len(band):
        inside = (band["real"] >= band["floor"]) & (band["real"] <= band["ceiling"])
        out["bandCoverage"] = round(float(inside.mean()), 3)
        out["aboveP90"] = round(float((band["real"] > band["p90"]).mean()), 3) if band["p90"].notna().any() else None

    # Precio: probabilidad de subir y variación esperada frente a la real.
    after = _price_after(history, games, number)
    if after:
        frame["change"] = frame.apply(
            lambda r: after.get(int(r["id"]), np.nan) - float(r["price"]) if r["price"] else np.nan, axis=1
        )
        rise = frame.dropna(subset=["riseProb", "change"])
        if len(rise):
            rose = (rise["change"] > 0.04).astype(float)
            out["riseBrier"] = round(float(((rise["riseProb"] - rose) ** 2).mean()), 4)
            out["riseBrierConstant"] = round(float(((rose.mean() - rose) ** 2).mean()), 4)
        change = frame.dropna(subset=["expectedChange", "change"])
        if len(change):
            out["changeMae"] = round(float((change["expectedChange"] - change["change"]).abs().mean()), 3)
            out["changeMaeZero"] = round(float(change["change"].abs().mean()), 3)
    return out


def evaluate_published(
    gamelog: pd.DataFrame,
    games: list[dict[str, Any]],
    history: pd.DataFrame | None = None,
    coach_log: pd.DataFrame | None = None,
) -> dict[str, Any] | None:
    """Todas las jornadas guardadas que ya se han jugado."""
    if not PREDICTIONS_DIR.exists():
        return None
    rounds = []
    for path in sorted(PREDICTIONS_DIR.glob("R*.json")):
        try:
            prediction = json.loads(path.read_text(encoding="utf-8"))
            result = evaluate_round(prediction, gamelog, games, history, coach_log)
        except (OSError, ValueError, KeyError) as exc:
            log.warning("No se pudo evaluar %s: %s", path.name, exc)
            continue
        if result:
            result["generatedAt"] = prediction.get("generatedAt")
            rounds.append(result)
    if not rounds:
        return None

    def pooled(key: str, metric: str) -> float | None:
        values = [(r[key].get(metric), r["n"]) for r in rounds if r.get(key) and r[key].get(metric) is not None]
        total = sum(n for _, n in values)
        return round(sum(v * n for v, n in values) / total, 3) if total else None

    # Probabilidad de jugar de todas las jornadas juntas, por estado del parte.
    play: dict[str, dict[str, float]] = {}
    for r in rounds:
        for name, group in (r.get("playProb") or {}).items():
            acc = play.setdefault(name, {"n": 0, "predicted": 0.0, "real": 0.0, "nPredicted": 0})
            acc["n"] += group["n"]
            acc["real"] += group["real"] * group["n"]
            if group.get("predicted") is not None:
                acc["predicted"] += group["predicted"] * group["n"]
                acc["nPredicted"] += group["n"]
    play_total = {
        name: {
            "n": acc["n"],
            "predicted": round(acc["predicted"] / acc["nPredicted"], 3) if acc["nPredicted"] else None,
            "real": round(acc["real"] / acc["n"], 3),
        }
        for name, acc in play.items()
    }

    return {
        "rounds": rounds,
        "total": {
            "n": sum(r["n"] for r in rounds),
            "model": {m: pooled("model", m) for m in ("mae", "bias", "spearman")},
            "mean": {m: pooled("mean", m) for m in ("mae", "bias", "spearman")},
            "playProb": play_total,
        },
    }
