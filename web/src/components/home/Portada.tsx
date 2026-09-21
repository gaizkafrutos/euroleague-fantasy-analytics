"use client";

/** La portada: una carta de presentación, no un panel de datos.
 *
 *  El balón se queda quieto a la derecha (`position: sticky`) y el texto pasa
 *  por delante. Cada frase aparece de la nada al entrar en la franja central y
 *  se va al salir, igual subiendo que bajando.
 *
 *  Sin librerías: `sticky` + un `IntersectionObserver` con la franja central
 *  estrecha. El estado oculto lo enciende el propio script, así que sin
 *  JavaScript la página se lee entera y seguida.
 *
 *  Esta pantalla es SIEMPRE oscura, aunque el resto del sitio tenga los dos
 *  temas: la foto del balón está hecha sobre negro y en claro cantaría. El
 *  bloque de tokens vive en globals.css, bajo `:root:has(.portada)`.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Props {
  seasonLabel: string;
  budget: string;
  ptsPerCredit: string;
  referenceGames: number;
  players: number;
  matchRate: string;
  snapshots: number;
  isBaseline: boolean;
}

/** Cuántos tiempos tiene el relato. Sirve para los pips del margen. */
const BEATS = 6;

export default function Portada({
  seasonLabel,
  budget,
  ptsPerCredit,
  referenceGames,
  players,
  matchRate,
  snapshots,
  isBaseline,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const node = root.current;
    if (!node) return;

    // Solo se esconde el texto si el script ha llegado a ejecutarse.
    setAnimated(true);

    const beats = Array.from(node.querySelectorAll<HTMLElement>(".beat"));
    if (!("IntersectionObserver" in window)) {
      beats.forEach((beat) => beat.classList.add("is-on"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle("is-on", entry.isIntersecting);
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.b);
            if (Number.isFinite(index)) setActive(index);
          }
        }
      },
      // Franja central estrecha: la frase entra al llegar al centro de la
      // pantalla y se va en cuanto lo abandona.
      { rootMargin: "-38% 0px -38% 0px", threshold: 0 },
    );

    beats.forEach((beat) => observer.observe(beat));
    return () => observer.disconnect();
  }, []);

  // El balón crece y sube un poco conforme avanza el relato. Es el único
  // movimiento ligado al scroll, y va por transición, no por frame.
  const progress = BEATS > 1 ? active / (BEATS - 1) : 0;
  const ballStyle = {
    "--s": (1 + progress * 0.12).toFixed(3),
    "--ty": `${(-progress * 40).toFixed(1)}px`,
  } as React.CSSProperties;
  const glowStyle = { "--g": (0.82 + progress * 0.5).toFixed(3) } as React.CSSProperties;

  return (
    <div className="portada" ref={root} data-anim={animated ? "on" : undefined}>
      <nav className="portada-pips" aria-hidden>
        {Array.from({ length: BEATS }, (_, i) => (
          <i key={i} className={i === active ? "on" : undefined} />
        ))}
      </nav>

      <div className="story">
        <div className="ball">
          <div className="ball-glow" style={glowStyle} />
          <picture>
            <source media="(min-width: 900px)" srcSet="/portada/balon-ancho.webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/portada/balon-alto.webp"
              alt=""
              width={860}
              height={1528}
              fetchPriority="high"
              style={ballStyle}
            />
          </picture>
        </div>

        <div className="beats">
          <section className="beat is-hero is-on" data-b="0">
            <div className="beat-inner">
              <h1>Gana la jornada antes de que se juegue.</h1>
              <p className="sub">
                {seasonLabel} · EuroLeague Fantasy Challenge, con los números delante.
              </p>
              <div className="portada-actions">
                <Link className="btn btn-primary" href="/mercado">
                  Ver el mercado
                </Link>
                <Link className="btn btn-ghost" href="/mi-equipo">
                  Mi equipo
                </Link>
              </div>
              <p className="hint">
                <span aria-hidden /> Baja
              </p>
            </div>
          </section>

          <section className="beat" data-b="1">
            <div className="beat-inner">
              <p>
                <span className="q">{budget}</span> créditos. Diez jugadores y un entrenador.
              </p>
            </div>
          </section>

          <section className="beat" data-b="2">
            <div className="beat-inner">
              <p>El capitán puntúa doble. El banquillo, la mitad.</p>
            </div>
          </section>

          <section className="beat" data-b="3">
            <div className="beat-inner">
              <p>El juego te dice lo que cuesta. No lo que compras.</p>
            </div>
          </section>

          <section className="beat is-lede" data-b="4">
            <div className="beat-inner">
              <p>
                El jugador mediano rinde <span className="q">{ptsPerCredit}</span> puntos por
                crédito.
              </p>
              <p className="small">Lo demás es ver quién se sale de esa cuenta.</p>
            </div>
          </section>

          <section className="beat is-lede" data-b="5">
            <div className="beat-inner">
              <p>Precios capturados cada día, cruzados con los boxscores oficiales.</p>
              <p className="small">El código, a la vista. Y lo que todavía no sabe, escrito.</p>
            </div>
          </section>
        </div>
      </div>

      <div className="outro">
        <div className="shell">
          <p className="outro-lead">Empieza por donde te haga falta.</p>

          <nav className="outro-links">
            <Link href="/mercado">
              <span className="t">
                El mercado <span className="arrow">→</span>
              </span>
              <span className="d num">
                {players} jugadores y quién se sale de la cuenta
              </span>
            </Link>
            <Link href="/mi-equipo">
              <span className="t">
                Mi equipo <span className="arrow">→</span>
              </span>
              <span className="d">Tu once, con el capitán al doble</span>
            </Link>
            <Link href="/equipos">
              <span className="t">
                Los equipos <span className="arrow">→</span>
              </span>
              <span className="d">Clasificación, factores y próximos cinco</span>
            </Link>
          </nav>

          <div className="outro-strip num">
            <span>
              {referenceGames} partidos {isBaseline ? "de referencia" : "de esta temporada"}
            </span>
            <span className="sep">·</span>
            <span>
              {players} jugadores, {matchRate} identificados
            </span>
            <span className="sep">·</span>
            <span>
              {snapshots} {snapshots === 1 ? "captura" : "capturas"} de precio
            </span>
            <span className="sep">·</span>
            <Link href="/metodologia">Metodología</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
