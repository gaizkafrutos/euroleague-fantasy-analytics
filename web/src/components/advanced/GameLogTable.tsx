/** Partido a partido en tabla: rival, resultado, minutos y la caja básica
 *  junto a los puntos fantasy. Las barras dicen cuánto; esto, contra quién y
 *  cómo. El más reciente arriba. */
import { num } from "@/lib/format";
import type { GameLine } from "@/lib/types";

export default function GameLogTable({ games }: { games: GameLine[] }) {
  // Sin caja en los datos (details.json anterior) no hay tabla que enseñar.
  if (!games.length || !games.some((game) => typeof game.pts === "number")) return null;
  const rows = [...games].reverse();

  return (
    <div className="table-wrap game-log" tabIndex={0} role="region" aria-label="Partidos jugados">
      <table className="data is-compact">
        <thead>
          <tr>
            <th scope="col">J</th>
            <th scope="col" className="is-text">
              Rival
            </th>
            <th scope="col" className="is-text">
              Res.
            </th>
            <th scope="col" className="num">
              Min
            </th>
            <th scope="col" className="num">
              PTS
            </th>
            <th scope="col" className="num">
              REB
            </th>
            <th scope="col" className="num">
              AST
            </th>
            <th scope="col" className="num">
              Fantasy
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((game, index) => (
            <tr key={`${game.round}-${index}`}>
              <td className="num">{game.round ?? "—"}</td>
              <td className="is-text">
                {game.home ? "vs" : "@"} {game.opponent ?? "—"}
              </td>
              <td className="is-text">
                {typeof game.won === "boolean"
                  ? `${game.won ? "G" : "P"} ${typeof game.margin === "number" ? `${game.margin > 0 ? "+" : "−"}${Math.abs(game.margin)}` : ""}`
                  : "—"}
              </td>
              {game.played ? (
                <>
                  <td className="num">{num(game.minutes, 0)}</td>
                  <td className="num">{num(game.pts ?? null, 0)}</td>
                  <td className="num">{num(game.reb ?? null, 0)}</td>
                  <td className="num">{num(game.ast ?? null, 0)}</td>
                  <td className="num">
                    <strong>{num(game.fp)}</strong>
                  </td>
                </>
              ) : (
                <td className="is-text muted" colSpan={5}>
                  No jugó
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
