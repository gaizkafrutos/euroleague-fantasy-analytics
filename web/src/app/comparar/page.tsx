/** Comparador: de dos a cuatro jugadores, cara a cara.
 *
 *  La pregunta que más se hace en un fantasy no es "¿es bueno?", es "¿este o
 *  aquel?". La ficha contesta la primera; esto, la segunda. La selección vive
 *  en la URL (`?ids=1,2,3`) para poder compartir la comparación.
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import Comparator, { type CompareRow } from "@/components/compare/Comparator";
import { players } from "@/lib/data";
import { displayName } from "@/lib/format";

export const metadata: Metadata = {
  title: "Comparar jugadores",
  description:
    "Dos, tres o cuatro jugadores del EuroLeague Fantasy Challenge cara a cara: proyección, probabilidad de jugar, minutos, precio, revalorización, calendario y techo.",
};

export default function ComparePage() {
  const rows: CompareRow[] = players
    .filter((player) => (player.price ?? 0) > 0 || player.projectedFp !== null)
    .map((player) => ({
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

  return (
    <section className="section shell">
      <header className="cancha-head">
        <h1>Comparar jugadores</h1>
        <p className="lede">
          Hasta cuatro, cara a cara. En cada fila se marca el mejor; el precio y el calendario no
          se marcan porque lo mejor depende de lo que busques.
        </p>
      </header>
      {/* useSearchParams necesita un límite de Suspense en una página estática. */}
      <Suspense fallback={<p className="muted">Cargando…</p>}>
        <Comparator rows={rows} />
      </Suspense>
    </section>
  );
}
