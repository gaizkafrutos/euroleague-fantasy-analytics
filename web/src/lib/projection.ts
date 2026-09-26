/** Cómo se cuenta la proyección de un jugador en una línea.
 *
 *  La cifra de la proyección ya es un valor esperado: lo que haría si juega
 *  por la probabilidad de jugar. Leída sola, una duda con 8 puntos parece un
 *  jugador flojo cuando es uno de 16 que juega la mitad de las veces. Estas
 *  funciones dan el desglose para los `title` y las notas.
 */
import { num, percent } from "@/lib/format";
import type { NextGame, Player } from "@/lib/types";

/** "@ZAL" fuera, "vs ZAL" en casa. */
export function fixtureLabel(next: NextGame | null | undefined): string {
  if (!next) return "—";
  return `${next.home ? "vs" : "@"} ${next.opponent}`;
}

/** "T1" si la jornada se juega en varios días; nada si es de un solo turno. */
export function turnLabel(next: NextGame | null | undefined): string | null {
  if (!next || next.turns <= 1) return null;
  return `T${next.turn}`;
}

/** Probabilidad de jugar por debajo de la cual se avisa. */
export const PLAY_RISK = 0.95;

export function playRisk(player: Pick<Player, "playProb" | "isCoach">): number | null {
  if (player.isCoach) return null;
  const prob = player.playProb;
  return typeof prob === "number" && prob < PLAY_RISK ? prob : null;
}

/** Desglose de la proyección para un `title`. */
export function projectionNote(player: Player): string {
  const parts: string[] = [];
  const next = player.schedule?.next;
  if (player.isCoach) {
    if (next) parts.push(`${fixtureLabel(next)}: ${percent(next.winProb)} de ganar, margen esperado ${signedMargin(next.expectedMargin)}`);
    parts.push("El entrenador puntúa solo por el resultado");
    return parts.join(" · ");
  }
  const ifPlays = player.projectedIfPlays;
  const risk = playRisk(player);
  if (risk !== null && typeof ifPlays === "number") {
    parts.push(`Si juega: ${num(ifPlays)} pts · ${percent(risk)} de que juegue`);
  }
  if (typeof player.expectedMinutes === "number") parts.push(`${num(player.expectedMinutes)} min esperados`);
  if (next) {
    const turn = turnLabel(next);
    parts.push(`${fixtureLabel(next)}${turn ? ` (${turn} de ${next.turns})` : ""}`);
  }
  const factor = player.matchup?.opponentFactor;
  if (typeof factor === "number" && Math.abs(factor - 1) >= 0.02) {
    parts.push(`rival ${factor > 1 ? "blando" : "duro"} (${factor > 1 ? "+" : "−"}${num(Math.abs(factor - 1) * 100, 0)} %)`);
  }
  if (player.outlook?.p90 !== undefined) parts.push(`techo (p90) ${num(player.outlook.p90)}`);
  return parts.join(" · ");
}

function signedMargin(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${num(Math.abs(value))}`;
}
