/** La portada.
 *
 *  Hasta ahora el mercado abría el sitio: se entraba directamente a una tabla
 *  de 354 filas sin saber qué era esto. El mercado vive en `/mercado`; aquí
 *  queda la carta de presentación.
 *
 *  Las cifras salen del snapshot en tiempo de build, como todo lo demás. La
 *  mediana de puntos por crédito se calcula aquí porque es una derivada pura
 *  del JSON que ya existe y no justifica tocar el pipeline.
 */
import Portada from "@/components/home/Portada";
import { meta, pricedPlayers, rosterPlayers } from "@/lib/data";
import { num, percent } from "@/lib/format";

export default function HomePage() {
  const universe = (meta.hasPrices ? pricedPlayers : rosterPlayers).filter(
    (player) => (player.perf.gamesPlayed ?? 0) > 0,
  );

  const rates = universe
    .map((player) => player.valueProjected ?? player.valuePerCredit)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);

  return (
    <Portada
      seasonLabel={meta.seasonLabel}
      budget={num(meta.budget, 0)}
      ptsPerCredit={num(median(rates), 2)}
      referenceGames={meta.performanceSource.games}
      players={meta.players}
      matchRate={percent(meta.matchRate)}
      snapshots={meta.priceSnapshots}
      isBaseline={meta.performanceSource.isBaseline}
    />
  );
}

/** La mediana y no la media: con precios que van de 4 a 16 créditos, unos
 *  pocos jugadores baratos con buen rendimiento arrastran la media. */
function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const a = sorted[middle - 1];
  const b = sorted[middle];
  return a !== undefined && b !== undefined ? (a + b) / 2 : null;
}
