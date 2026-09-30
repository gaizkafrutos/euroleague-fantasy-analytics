/** Veredicto en una frase.
 *
 *  La ficha tenía dieciséis números y ninguna conclusión. Esto compone la frase
 *  que diría alguien que sabe leer esa tabla: cuál es la señal dominante, cuál
 *  la contradice, y con qué números se sostienen las dos.
 *
 *  No inventa nada. Cada señal sale de un dato que ya está en la ficha, y si no
 *  hay partidos suficientes lo dice en vez de rellenar.
 */
import { num, percent, signed } from "./format";
import { percentileOf } from "./percentiles";
import type { Player } from "./types";

export interface Verdict {
  tone: "good" | "warn" | "neutral";
  headline: string;
  reasons: string[];
}

interface Signal {
  /** Positivo = argumento a favor de ficharlo. */
  direction: 1 | -1;
  /** 0–1: cuánto pesa en el veredicto. */
  weight: number;
  /** Trozo de frase, en minúscula y sin punto. */
  clause: string;
  /** Apoyo numérico, para las etiquetas de debajo. */
  reason: string;
}

export function verdictFor(player: Player): Verdict {
  const games = player.perf.gamesPlayed ?? 0;

  if (games === 0) {
    return {
      tone: "neutral",
      headline: "Sin partidos en la referencia, así que aquí no hay nada que juzgar todavía.",
      reasons: ["El precio es lo único conocido", "La proyección aparecerá cuando juegue"],
    };
  }

  const signals: Signal[] = [];
  const valuePct = percentileOf(player, "valueProjected");
  const projPct = percentileOf(player, "projectedFp");
  const minutesTrend = player.perf.minutesShareTrend ?? 0;
  const consistency = player.perf.consistency;
  const formDelta = player.perf.formDelta;

  /* ------------------------------------------------------------ disponibilidad */
  // Lo primero que cambia una decisión: el mejor jugador del mundo no suma nada
  // desde la grada. Las demás señales siguen, pero esta pesa más que todas.
  const level = player.availability?.level;
  if (level === "out") {
    signals.push({
      direction: -1,
      weight: 1.5,
      clause: "está de baja para la próxima jornada",
      reason: player.availability?.label ?? "De baja",
    });
  } else if (level === "doubt") {
    signals.push({
      direction: -1,
      weight: 0.7,
      clause: "está en duda para la próxima jornada",
      reason: `${player.availability?.label ?? "En duda"}: su proyección cuenta la mitad`,
    });
  }

  /* ------------------------------------------------- precio contra rendimiento */
  if (valuePct !== null) {
    if (valuePct >= 0.72) {
      signals.push({
        direction: 1,
        weight: 0.6 + (valuePct - 0.72) * 1.4,
        clause: "rinde más de lo que cuesta",
        reason: `Top ${Math.max(1, Math.round((1 - valuePct) * 100))}% en puntos por crédito de su puesto`,
      });
    } else if (valuePct <= 0.3) {
      signals.push({
        direction: -1,
        weight: 0.6 + (0.3 - valuePct) * 1.4,
        clause: "cuesta más de lo que rinde",
        reason: `Solo ${num(player.valueProjected ?? player.valuePerCredit, 2)} puntos por crédito`,
      });
    }
  }

  /* --------------------------------------------------------- volumen de puntos */
  if (projPct !== null) {
    if (projPct >= 0.85) {
      signals.push({
        direction: 1,
        weight: 0.55,
        clause: "está entre los que más puntúan de su posición",
        reason: `Proyección de ${num(player.projectedFp)} puntos`,
      });
    } else if (projPct <= 0.2) {
      signals.push({
        direction: -1,
        weight: 0.35,
        clause: "puntúa poco para lo que se le pide a su puesto",
        reason: `Proyección de ${num(player.projectedFp)} puntos`,
      });
    }
  }

  /* ------------------------------------------------------------------- el rol */
  if (Math.abs(minutesTrend) >= 0.012) {
    const up = minutesTrend > 0;
    signals.push({
      direction: up ? 1 : -1,
      weight: 0.5 + Math.min(Math.abs(minutesTrend) * 12, 0.45),
      clause: up ? "está ganando sitio en la rotación" : "está perdiendo sitio en la rotación",
      reason: `${signed(minutesTrend * 100, 1)} puntos de cuota de minutos`,
    });
  }

  /* ------------------------------------------------------------------- regularidad */
  // Con uno o dos partidos la "fiabilidad" es 0 por definición: no se juzga.
  if (typeof consistency === "number" && games >= 3) {
    if (consistency >= 0.72) {
      signals.push({
        direction: 1,
        weight: 0.34,
        clause: "es de los que no te dan sustos",
        reason: `Fiabilidad ${percent(consistency)}`,
      });
    } else if (consistency <= 0.45) {
      signals.push({
        direction: -1,
        weight: 0.32,
        clause: "es una lotería de una jornada a otra",
        reason: `Fiabilidad ${percent(consistency)} · desviación ${num(player.perf.fpStd)} pts`,
      });
    }
  }

  /* ------------------------------------------------------------------- la racha */
  if (typeof formDelta === "number" && Math.abs(formDelta) >= 2.5) {
    const up = formDelta > 0;
    signals.push({
      direction: up ? 1 : -1,
      weight: 0.3,
      clause: up ? "llega en racha" : "llega frío",
      reason: `${signed(formDelta)} puntos en los últimos cinco respecto a su media`,
    });
  }

  if (!signals.length) {
    return {
      tone: "neutral",
      headline: "Ni destaca ni preocupa: hace lo que se espera de su precio.",
      reasons: [
        `Media de ${num(player.perf.fpAvg)} puntos en ${games} partidos`,
        `${num(player.valueProjected ?? player.valuePerCredit, 2)} puntos por crédito`,
      ],
    };
  }

  signals.sort((a, b) => b.weight - a.weight);
  const [first, second] = signals;

  // Dos señales que apuntan al mismo lado se suman ("y"); dos que se contradicen
  // se enfrentan ("pero"). Esa conjunción es la mitad del juicio.
  let headline = first.clause;
  if (second) {
    headline += second.direction === first.direction ? ` y ${second.clause}` : `, pero ${second.clause}`;
  }
  headline = `${headline.charAt(0).toUpperCase()}${headline.slice(1)}.`;

  return {
    tone: first.direction === 1 ? "good" : "warn",
    headline,
    reasons: signals.slice(0, 3).map((signal) => signal.reason),
  };
}
