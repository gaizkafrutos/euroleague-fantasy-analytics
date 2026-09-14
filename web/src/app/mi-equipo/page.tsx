import SquadConsole from "@/components/team/SquadConsole";
import { meta, pricedPlayers, rosterPlayers } from "@/lib/data";

export const metadata = {
  title: "Mi equipo",
  description:
    "Analiza tu plantilla del EuroLeague Fantasy Challenge: qué te renta poco, qué fichaje cabe en tu presupuesto y quién debe llevar el brazalete.",
};

export default function TeamPage() {
  const market = meta.hasPrices ? pricedPlayers : rosterPlayers;

  return (
    <section className="section shell">
      <div className="stack" style={{ "--gap": "12px", marginBottom: 26 } as React.CSSProperties}>
        <span className="eyebrow">Jornada {meta.currentRound}</span>
        <h1 className="gradient-text">Tu plantilla, revisada</h1>
        <p className="lede">
          Diez jugadores de campo — 4 bases, 4 aleros, 2 pívots — con 100 créditos y un
          máximo de seis del mismo club. La consola valida esas reglas mientras montas el
          equipo, señala a quién le estás pagando de más y propone el mejor recambio que
          cabe en lo que te queda. El entrenador, la plaza once, se elige aparte y puntúa
          solo por el marcador de su equipo.
        </p>
      </div>
      <SquadConsole market={market} />
    </section>
  );
}
