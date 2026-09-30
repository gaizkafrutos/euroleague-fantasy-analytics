"use client";

/** La portada: una carta de presentación, no un panel de datos.
 *
 *  El fondo es un mate en bucle (`position: sticky`) y el texto pasa por
 *  delante. En móvil el vídeo ocupa la pantalla entera y el titular va en el
 *  tercio de abajo, como un rótulo de retransmisión; en escritorio el vídeo es
 *  vertical y no se estira: vive en un panel a la derecha, fundido con un
 *  ambiente desenfocado del mismo plano.
 *
 *  El vídeo sale de un clip de 10 s que acaba en primer plano: el bucle se
 *  cierra con un fundido de 0,9 s hecho en ffmpeg (el final se funde con el
 *  arranque), así que no hay corte al volver a empezar. El primer fotograma es
 *  exactamente el póster, para que la carga no dé un salto.
 *
 *  Reglas del vídeo: nunca en `prefers-reduced-motion` ni con ahorro de datos
 *  (se queda el póster), se para cuando el relato sale de pantalla y siempre
 *  hay un botón para pararlo (WCAG 2.2.2: movimiento de más de 5 s).
 *
 *  Cada frase aparece de la nada al entrar en la franja central y se va al
 *  salir, igual subiendo que bajando.
 *
 *  Sin librerías: `sticky` + un `IntersectionObserver` con la franja central
 *  estrecha. El estado oculto lo enciende el propio script, así que sin
 *  JavaScript la página se lee entera y seguida.
 *
 *  Esta pantalla es SIEMPRE oscura, aunque el resto del sitio tenga los dos
 *  temas: el vídeo es un pabellón a oscuras y en claro cantaría. El
 *  bloque de tokens vive en globals.css, bajo `:root:has(.portada)`.
 */

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

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

/** Las palabras del titular entran una a una, enmascaradas desde abajo. */
const HEADLINE: { text: string; soft?: boolean }[][] = [
  [{ text: "Gana" }, { text: "la" }, { text: "jornada" }],
  [
    { text: "antes", soft: true },
    { text: "de", soft: true },
    { text: "que", soft: true },
    { text: "se", soft: true },
    { text: "juegue.", soft: true },
  ],
];

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
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // Si el visitante lo para, se queda parado: ni el scroll ni volver a la
  // pestaña lo arrancan de nuevo.
  const userPaused = useRef(false);

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

  // El vídeo: arranca solo si puede y debe, y se para fuera de pantalla.
  useEffect(() => {
    const node = root.current;
    const clip = video.current;
    if (!node || !clip) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true;
    if (reduce.matches || saveData) {
      userPaused.current = true;
      return;
    }

    // React no pinta `muted` como atributo y iOS lo exige para reproducir solo.
    clip.muted = true;
    clip.preload = "auto";

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    clip.addEventListener("playing", onPlay);
    clip.addEventListener("pause", onPause);

    const tryPlay = () => {
      if (userPaused.current || document.hidden) return;
      clip.play().catch(() => {
        // Modo ahorro de batería o autoplay bloqueado: se queda el póster.
      });
    };

    let inView = true;
    const story = node.querySelector(".story");
    const observer =
      story && "IntersectionObserver" in window
        ? new IntersectionObserver(([entry]) => {
            inView = entry?.isIntersecting ?? true;
            if (inView) tryPlay();
            else clip.pause();
          })
        : null;
    if (story) observer?.observe(story);

    const onVisibility = () => {
      if (document.hidden) clip.pause();
      else if (inView) tryPlay();
    };
    document.addEventListener("visibilitychange", onVisibility);

    tryPlay();

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      clip.removeEventListener("playing", onPlay);
      clip.removeEventListener("pause", onPause);
    };
  }, []);

  function toggleVideo() {
    const clip = video.current;
    if (!clip) return;
    if (clip.paused) {
      userPaused.current = false;
      clip.muted = true;
      clip.preload = "auto";
      clip.play().catch(() => {});
    } else {
      userPaused.current = true;
      clip.pause();
    }
  }

  // Conforme avanza el relato el plano se acerca un poco y se apaga: el
  // titular lo quiere entero; las frases de después, más calladas detrás.
  // Es el único movimiento ligado al scroll, y va por transición, no por frame.
  const progress = BEATS > 1 ? active / (BEATS - 1) : 0;
  const stageStyle = {
    "--s": (1 + progress * 0.08).toFixed(3),
    "--dim": active === 0 ? "0" : (0.42 + progress * 0.2).toFixed(3),
  } as React.CSSProperties;

  return (
    <div className="portada" ref={root} data-anim={animated ? "on" : undefined}>
      <nav className="portada-pips" aria-hidden>
        {Array.from({ length: BEATS }, (_, i) => (
          <i key={i} className={i === active ? "on" : undefined} />
        ))}
      </nav>

      <div className="story">
        <div className="stage" style={stageStyle} data-playing={playing ? "" : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="stage-ambient" src="/portada/mate-ambiente.webp" alt="" aria-hidden />
          <div className="stage-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="stage-poster"
              src="/portada/mate-poster.webp"
              alt=""
              width={496}
              height={864}
              fetchPriority="high"
            />
            <video
              ref={video}
              className="stage-video"
              loop
              muted
              playsInline
              preload="none"
              disablePictureInPicture
              disableRemotePlayback
              aria-hidden
              tabIndex={-1}
            >
              <source src="/portada/mate.webm" type='video/webm; codecs="vp9"' />
              <source src="/portada/mate.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="stage-scrim" />
        </div>

        <div className="beats">
          <section className="beat is-hero is-on" data-b="0">
            <div className="beat-inner">
              <h1 aria-label="Gana la jornada antes de que se juegue.">
                {HEADLINE.map((line, l) => (
                  <span key={l} className="hl-line" aria-hidden>
                    {line.map((word, w) => (
                      <Fragment key={w}>
                        <span className={word.soft ? "hl-w is-soft" : "hl-w"}>
                          <span style={{ "--i": l * 3 + w } as React.CSSProperties}>
                            {word.text}
                          </span>
                        </span>{" "}
                      </Fragment>
                    ))}
                  </span>
                ))}
              </h1>
              <p className="sub">
                {seasonLabel} · Los precios del EuroLeague Fantasy Challenge cruzados con las
                estadísticas oficiales: quién rinde más de lo que cuesta.
              </p>
              {/* Dos entradas en la primera pantalla: sin ellas, quien llegaba
                  nuevo tenía que adivinar que había que bajar seis pantallas. */}
              <nav className="hero-ctas" aria-label="Empezar">
                <Link href="/mercado" className="hero-cta is-primary">
                  Ver el mercado
                </Link>
                <Link href="/mi-equipo" className="hero-cta">
                  Montar mi equipo
                </Link>
              </nav>
              {/* El vídeo se mueve más de 5 s, así que la pausa no se quita. */}
              <div className="hero-foot">
                <button
                  type="button"
                  className="clip-toggle"
                  onClick={toggleVideo}
                  aria-label={playing ? "Pausar el vídeo de fondo" : "Reproducir el vídeo de fondo"}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
                    {playing ? (
                      <path d="M4.5 3h2.2v10H4.5zM9.3 3h2.2v10H9.3z" fill="currentColor" />
                    ) : (
                      <path d="M5 2.8v10.4L13.2 8z" fill="currentColor" />
                    )}
                  </svg>
                </button>
              </div>
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
