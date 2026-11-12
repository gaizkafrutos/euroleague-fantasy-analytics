"use client";

/** Las fichas de la cancha: un jugador (o el entrenador) en su sitio, y el
 *  hueco libre. Salieron de SquadConsole.tsx tal cual. */
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { AvailabilityTag } from "@/components/ui/primitives";
import { credits, displayName, num, percent, positionLabel } from "@/lib/format";
import { fixtureLabel, fixtureName, playRisk, turnLabel } from "@/lib/projection";
import { effectiveProjection } from "@/lib/squad";
import type { Player } from "@/lib/types";

export type TokenRole = "captain" | "starter" | "sixth" | "bench" | "coach";

export interface TokenEdit {
  picked: boolean;
  onPick: (id: number) => void;
  onCaptain?: (id: number) => void;
}

export function Token({
  player,
  role,
  onRemove,
  className = "",
  edit = null,
}: {
  player: Player;
  role: TokenRole;
  onRemove: (id: number) => void;
  className?: string;
  edit?: TokenEdit | null;
}) {
  const next = player.schedule?.next ?? null;
  const turn = turnLabel(next);
  const risk = playRisk(player);
  const name = displayName(player);
  const surname = name.includes(" ") ? name.slice(name.indexOf(" ") + 1) : name;
  // Si la foto no carga, el escudo; si tampoco, el hueco limpio. Antes se veía
  // el icono de imagen rota del navegador en mitad de la cancha.
  const [photoBroken, setPhotoBroken] = useState(false);
  const [crestBroken, setCrestBroken] = useState(false);
  const projection = player.projectedFp === null ? null : effectiveProjection(player);
  const shown =
    projection === null
      ? null
      : role === "captain"
        ? projection * 2
        : role === "bench"
          ? projection / 2
          : projection;
  const isCoach = role === "coach";

  return (
    <div
      className={`tok pos-${isCoach ? "E" : (player.position ?? "X")}${
        role === "bench" ? " is-bench" : ""
      }${isCoach ? " is-coach" : ""}${player.availability?.level === "out" ? " is-out" : ""}${
        edit ? " is-editing" : ""
      }${edit?.picked ? " is-picked" : ""}${className}`}
    >
      {role === "captain" ? (
        <span className="cap-badge">
          <span className="cap-long">Capitán </span>
          <span className="cap-short" aria-hidden>
            C{" "}
          </span>
          ×2
        </span>
      ) : null}
      {edit ? (
        <>
          {/* Toda la ficha es el botón: en el móvil, apuntar a algo pequeño
              para mover a un jugador es una lotería. */}
          <button
            type="button"
            className="tok-pick"
            aria-pressed={edit.picked}
            aria-label={edit.picked ? `${name} elegido: toca a otro para intercambiarlos` : `Mover a ${name}`}
            onClick={() => edit.onPick(player.id)}
          />
          {edit.onCaptain && role === "starter" ? (
            <button
              type="button"
              className="tok-cap"
              aria-label={`Hacer capitán a ${name}`}
              title="Hacer capitán"
              onClick={() => edit.onCaptain?.(player.id)}
            >
              C
            </button>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className="tok-remove"
          onClick={() => onRemove(player.id)}
          aria-label={`Quitar a ${name}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M7 7l10 10M17 7 7 17" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <div className="tok-shot">
        {player.image && !photoBroken ? (
          <Image
            src={player.image}
            alt=""
            width={750}
            height={1000}
            sizes="100px"
            onError={() => setPhotoBroken(true)}
          />
        ) : player.clubCrest && !crestBroken ? (
          <Image
            className="tok-shot-crest"
            src={player.clubCrest}
            alt=""
            width={42}
            height={42}
            onError={() => setCrestBroken(true)}
          />
        ) : null}
      </div>

      <div className="tok-plate">
        <div className="tok-name">
          {player.clubCrest ? (
            <Image className="tok-crest" src={player.clubCrest} alt="" width={15} height={15} />
          ) : null}
          {isCoach ? (
            <span title={name}>{surname}</span>
          ) : (
            <Link href={`/jugador/${player.id}`} title={name}>
              {surname}
            </Link>
          )}
        </div>
        {/* Puesto y rival en piezas separadas: en la pista del móvil el puesto
            sobra (ya lo dice el sitio) y el separador no se queda colgando. */}
        <div className="tok-sub">
          <span className="tok-pos">{isCoach ? "Entrenador" : positionLabel(player.position)}</span>
          {next ? (
            <span className="tok-fixture" title={fixtureName(next)}>
              {fixtureLabel(next)}
            </span>
          ) : null}
          {turn ? (
            <span className="turn-tag" title={`Juega en el turno ${next?.turn} de ${next?.turns}`}>
              {turn}
            </span>
          ) : null}
        </div>
        {player.availability ? (
          <div className="tok-avail">
            <AvailabilityTag player={player} />
          </div>
        ) : null}
        <div className="tok-figs">
          <span
            className="tok-proj num"
            title={
              risk !== null && typeof player.projectedIfPlays === "number"
                ? `Si juega, ${num(player.projectedIfPlays)}; ${percent(risk)} de que juegue`
                : undefined
            }
          >
            {num(shown)}
            {risk !== null ? <small className="play-risk">{percent(risk)}</small> : null}
          </span>
          <span className="tok-price num">{credits(player.price)}</span>
        </div>
        {projection !== null && role === "captain" ? (
          <span className="tok-half num">{num(projection)} × 2</span>
        ) : null}
        {projection !== null && role === "bench" ? (
          <span className="tok-half num">{num(projection)} × 0,5</span>
        ) : null}
      </div>
    </div>
  );
}

export function EmptySlot({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`tok is-empty${className}`}>
      <div className="tok-shot" aria-hidden />
      <div className="tok-plate">
        <div className="tok-name">
          <span>Hueco libre</span>
        </div>
        <div className="tok-sub">{label}</div>
      </div>
    </div>
  );
}
