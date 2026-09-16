import SquadConsole from "@/components/team/SquadConsole";
import { lineup, meta, pricedPlayers, rosterPlayers } from "@/lib/data";

export const metadata = {
  title: "Mi equipo",
  description:
    "Analiza tu plantilla del EuroLeague Fantasy Challenge: qué te renta poco, qué fichaje cabe en tu presupuesto y quién debe llevar el brazalete.",
};

export default function TeamPage() {
  const market = meta.hasPrices ? pricedPlayers : rosterPlayers;

  return (
    <section className="section shell">
      <div className="stack" style={{ "--gap": "12px", marginBottom: 24 } as React.CSSProperties}>
        <span className="eyebrow">Jornada {meta.currentRound}</span>
        <h1>Tu plantilla, revisada</h1>
        <p className="lede">
          Monta el equipo y la consola valida las reglas, señala a quién le pagas de más y
          propone el mejor recambio que cabe en tu presupuesto.
        </p>
      </div>
      <SquadConsole
        market={market}
        optimalProjection={lineup.available ? (lineup.totalProjection ?? null) : null}
      />
    </section>
  );
}
