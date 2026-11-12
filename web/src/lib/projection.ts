/** Cómo se cuenta la proyección de un jugador en una línea.
 *
 *  La cifra de la proyección ya es un valor esperado: lo que haría si juega
 *  por la probabilidad de jugar. Leída sola, una duda con 8 puntos parece un
 *  jugador flojo cuando es uno de 16 que juega la mitad de las veces. Estas
 *  funciones dan el desglose para los `title` y las notas.
 */
import { num, percent } from "@/lib/format";
import { clubAbbr, clubName } from "@/lib/clubs";
import type { NextGame, Player } from "@/lib/types";

/** "@ZAL" fuera, "vs ZAL" en casa. */
export function fixtureLabel(next: NextGame | null | undefined): string {
  if (!next) return "—";
  return `${next.home ? "vs" : "@"} ${clubAbbr(next.opponent)}`;
}

/** "@ Fenerbahce" fuera, "vs Fenerbahce" en casa: el nombre y no el código
 *  interno (ULK), para frases y etiquetas donde cabe. */
export function fixtureName(next: NextGame | null | undefined): string {
  if (!next) return "—";
  return `${next.home ? "vs" : "@"} ${clubName(next.opponent)}`;
}

/** "T1" si la jornada se juega en varios días; nada si es de un solo turno.
 *  Con `long`, "turno 1": donde hay sitio, sin abreviatura que aprenderse. */
export function turnLabel(next: NextGame | null | undefined, long = false): string | null {
  if (!next) return null;
  // Con la jornada a medias, quien ya ha jugado sale con su partido de la
  // siguiente: se dice de cuál, o "T1" parecería el primer día de la vigente.
  const round = next.ahead && next.round ? (long ? `jornada ${next.round}` : `J${next.round}`) : null;
  const turn = next.turns > 1 ? (long ? `turno ${next.turn}` : `T${next.turn}`) : null;
  const parts = [round, turn].filter(Boolean);
  return parts.length ? parts.join(long ? ", " : " · ") : null;
}

/** Lo que ha hecho el once óptimo publicado frente a lo que proyectaba, de
 *  media. El óptimo elige a quien más proyecta, y con eso elige también los
 *  errores a favor: su total sale siempre algo por encima de lo que luego hace. */
export function optimalTrack(
  published: { rounds: Array<{ lineup?: { projected: number; real: number } }> } | null | undefined,
): { rounds: number; projected: number; real: number } | null {
  const lineups = (published?.rounds ?? []).flatMap((round) => (round.lineup ? [round.lineup] : []));
  if (lineups.length < 3) return null;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  return {
    rounds: lineups.length,
    projected: mean(lineups.map((lineup) => lineup.projected)),
    real: mean(lineups.map((lineup) => lineup.real)),
  };
}

/** Jornada en juego: se ha jugado algún partido y quedan otros. */
export function roundInPlay(
  schedule: { roundGames?: number; roundPlayed?: number } | null | undefined,
): { played: number; games: number } | null {
  const games = schedule?.roundGames;
  const played = schedule?.roundPlayed;
  if (typeof games !== "number" || typeof played !== "number") return null;
  return played > 0 && played < games ? { played, games } : null;
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
  if (player.outlook?.p90 !== undefined) parts.push(`techo ${num(player.outlook.p90)}`);
  return parts.join(" · ");
}

function signedMargin(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${num(Math.abs(value))}`;
}
