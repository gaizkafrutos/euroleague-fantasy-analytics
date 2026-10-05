/** Filas del comparador. SOLO servidor: importa `players.json`.
 *
 *  La página lleva en el HTML un índice mínimo para el buscador; las filas
 *  completas se sirven como JSON estático en `/comparar/datos` y el comparador
 *  las pide cuando hay alguien que comparar. Antes viajaban las 353 dentro del
 *  HTML (360 KB) aunque se miraran dos.
 */
import type { CompareIndexEntry, CompareRow } from "@/components/compare/Comparator";

import { players } from "./data";
import { displayName } from "./format";

const comparable = players.filter((player) => (player.price ?? 0) > 0 || player.projectedFp !== null);

export function compareIndex(): CompareIndexEntry[] {
  return comparable.map((player) => ({
    id: player.id,
    name: displayName(player),
    club: player.clubShort ?? player.club ?? "",
    position: player.isCoach ? "E" : player.position,
    isCoach: player.isCoach,
    price: player.price,
  }));
}

export function compareRows(): CompareRow[] {
  return comparable.map((player) => ({
    id: player.id,
    name: displayName(player),
    club: player.clubShort ?? player.club ?? "",
    position: player.isCoach ? "E" : player.position,
    isCoach: player.isCoach,
    image: player.image,
    price: player.price,
    projectedFp: player.projectedFp,
    projectedIfPlays: player.projectedIfPlays ?? null,
    playProb: player.playProb ?? null,
    valueProjected: player.valueProjected ?? player.valuePerCredit,
    expectedMinutes: player.expectedMinutes ?? null,
    fpAvg: player.perf.fpAvg,
    lastFp: player.perf.lastFp,
    form: player.perf.form,
    consistency: player.perf.consistency,
    consistencyEstimated: Boolean(player.perf.consistencyEstimated),
    gamesPlayed: player.perf.gamesPlayed,
    startedRate: player.perf.startedRate,
    ptsAvg: player.perf.ptsAvg ?? null,
    rebAvg: player.perf.rebAvg ?? null,
    astAvg: player.perf.astAvg ?? null,
    pirAvg: player.perf.pirAvg ?? null,
    floor: player.outlook?.floor ?? null,
    ceiling: player.outlook?.ceiling ?? null,
    p90: player.outlook?.p90 ?? null,
    expectedChange: player.outlook?.expectedChange ?? null,
    riseProb: player.outlook?.riseProb ?? null,
    difficulty: player.schedule.difficulty,
    next: player.schedule.next ?? null,
    bargainScore: player.bargainScore,
    availability: player.availability?.label ?? null,
    out: player.availability?.level === "out",
  }));
}
