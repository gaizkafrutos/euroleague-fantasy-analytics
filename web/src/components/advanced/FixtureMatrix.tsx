"use client";

/** Calendario fantasy: las próximas cinco jornadas de cada club, pintadas por
 *  lo que concede el rival al puesto elegido.
 *
 *  Es la vista que usan los jugadores del Fantasy de la Premier para planificar
 *  fichajes a varias jornadas vista, adaptada: aquí el color no es "dificultad"
 *  genérica sino puntos fantasy concedidos, que es lo que se cobra. Secuencial
 *  en un solo tono (el violeta de las señales de fantasy): más intenso = el
 *  rival regala más a ese puesto.
 *
 *  Las filas se ordenan por la media de las cinco: arriba, los calendarios más
 *  amables para fichar jugadores de ese club.
 */
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { sequentialClass } from "@/lib/advanced";
import { dateShort, num } from "@/lib/format";
import type { Team } from "@/lib/types";

type Pos = "all" | "G" | "F" | "C";

const OPTIONS: Array<{ key: Pos; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "G", label: "Bases" },
  { key: "F", label: "Aleros" },
  { key: "C", label: "Pívots" },
];

export default function FixtureMatrix({ teams, league }: { teams: Team[]; league: Record<Pos, number> | null }) {
  const [pos, setPos] = useState<Pos>("all");
  const byCode = useMemo(() => new Map(teams.map((team) => [team.code, team])), [teams]);
  const rounds = useMemo(
    () => [...new Set(teams.flatMap((team) => (team.upcoming ?? []).map((f) => f.round)))].sort((a, b) => a - b).slice(0, 5),
    [teams],
  );

  const rows = useMemo(
    () =>
      teams
        .map((team) => {
          const cells = rounds.map((round) => {
            const fixture = (team.upcoming ?? []).find((f) => f.round === round) ?? null;
            const opponent = fixture ? byCode.get(fixture.opponent) : undefined;
            const index = opponent?.allowed?.index?.[pos] ?? null;
            const value = opponent?.allowed?.[pos] ?? null;
            return { round, fixture, opponent, index, value };
          });
          const indices = cells.map((cell) => cell.index).filter((v): v is number => v !== null);
          const mean = indices.length ? indices.reduce((a, b) => a + b, 0) / indices.length : null;
          return { team, cells, mean };
        })
        .sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0)),
    [teams, rounds, byCode, pos],
  );

  const word = OPTIONS.find((option) => option.key === pos)?.label.toLowerCase() ?? "";

  return (
    <div className="fxm">
      <div className="fxm-controls">
        <div className="segmented" role="group" aria-label="Puesto">
          {OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={pos === option.key}
              onClick={() => setPos(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="fxm-legend" aria-hidden>
          <span>concede menos</span>
          {[1, 2, 3, 4, 5].map((step) => (
            <i key={step} className={`seq-${step}`} />
          ))}
          <span>concede más</span>
        </div>
      </div>

      <div className="fxm-scroll">
        <table className="fxm-table">
          <caption className="sr-only">
            Próximas jornadas de cada club; en cada celda el rival y los puntos fantasy que concede
            {pos === "all" ? "" : ` a los ${word}`} por partido.
          </caption>
          <thead>
            <tr>
              <th scope="col">Club</th>
              {rounds.map((round) => (
                <th key={round} scope="col">
                  J{round}
                </th>
              ))}
              <th scope="col" className="fxm-mean-h">
                Media
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, cells, mean }) => (
              <tr key={team.code}>
                <th scope="row">
                  <Link href={`/equipos/${team.code}`} className="fxm-team">
                    {team.crest ? <Image src={team.crest} alt="" width={18} height={18} /> : null}
                    <span>{team.code}</span>
                  </Link>
                </th>
                {cells.map(({ round, fixture, opponent, index, value }) => (
                  <td
                    key={round}
                    className={fixture ? `seq-${sequentialClass(index)}` : "fxm-empty"}
                    title={
                      fixture && opponent
                        ? `J${round} · ${fixture.home ? "en casa contra" : "en"} ${opponent.short ?? opponent.code}: concede ${num(value)} pts fantasy${pos === "all" ? "" : ` a ${word}`} por partido (${index ? `${Math.round((index - 1) * 100) >= 0 ? "+" : ""}${Math.round((index - 1) * 100)} %` : "—"} sobre la media) · ${dateShort(fixture.date)}`
                        : "Sin partido"
                    }
                  >
                    {fixture ? (
                      <>
                        <b>{fixture.opponent}</b>
                        <i>{fixture.home ? "casa" : "fuera"}</i>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
                <td className="fxm-mean num">{signedPct(mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fxm-note">
        Media de la liga: {league ? num(league[pos]) : "—"} puntos fantasy por partido
        {pos === "all" ? " entre todos los jugadores del rival" : ` para sus ${word}`}. Las cifras de esta
        temporada se encogen hacia las de la anterior hasta que haya jornadas suficientes.
      </p>
    </div>
  );
}

/** 1,05 -> "+5 %"; 0,998 -> "0 %" (sin "−0"). */
function signedPct(index: number | null): string {
  if (index === null) return "—";
  const value = Math.round((index - 1) * 100);
  if (value === 0) return "0 %";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)} %`;
}
