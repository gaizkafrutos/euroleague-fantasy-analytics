/** Lectura del roster personal contra el backend de Fantaking.
 *
 *  El token vive SOLO aquí, como variable de entorno del servidor. Nunca llega
 *  al navegador: el cliente pide a esta ruta, esta ruta pide a Fantaking.
 *
 *  La respuesta se cachea 10 minutos. Es el equipo de una persona y la página
 *  es pública: sin caché, cada visita desde LinkedIn sería una llamada más
 *  contra una API que no es mía.
 */
import { NextResponse } from "next/server";

export const revalidate = 600;

const API_BASE = "https://fantaking-api.dunkest.com/api/v1";
const ORIGIN = "https://euroleaguefantasy.euroleaguebasketball.net";

export async function GET(request: Request) {
  const token = process.env.FANTAKING_TOKEN;
  const teamId = process.env.EFA_FANTASY_TEAM_ID;

  if (!token || !teamId) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "El módulo de equipo personal no está configurado en este despliegue. " +
          "Hacen falta las variables FANTAKING_TOKEN y EFA_FANTASY_TEAM_ID.",
      },
      { status: 200 },
    );
  }

  const url = new URL(request.url);
  const matchdayId = url.searchParams.get("matchday") ?? process.env.EFA_MATCHDAY_ID;
  if (!matchdayId) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "Falta EFA_MATCHDAY_ID: el identificador interno de jornada de Fantaking. " +
          "Se obtiene con `python -m efa discover` o mirando la llamada a /roster en las DevTools.",
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch(
      `${API_BASE}/fantasy-teams/${teamId}/matchdays/${matchdayId}/roster`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: ORIGIN,
          Referer: `${ORIGIN}/`,
          Accept: "application/json",
        },
        next: { revalidate },
      },
    );

    if (response.status === 401) {
      return NextResponse.json(
        {
          configured: true,
          ok: false,
          message:
            "El token de Fantaking ha caducado. Hay que renovarlo y actualizar la variable de entorno.",
        },
        { status: 200 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          configured: true,
          ok: false,
          message: `Fantaking respondió ${response.status}.`,
        },
        { status: 200 },
      );
    }

    const payload = await response.json();
    return NextResponse.json({ configured: true, ok: true, matchdayId, payload });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        ok: false,
        message: `No se pudo contactar con Fantaking: ${(error as Error).message}`,
      },
      { status: 200 },
    );
  }
}
