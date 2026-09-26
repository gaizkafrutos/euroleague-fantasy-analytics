import { matching, meta } from "@/lib/data";
import { dateTime, num, percent } from "@/lib/format";

export const metadata = {
  title: "Metodología",
  description:
    "De dónde salen los datos, cómo se calcula cada métrica y qué límites tiene el modelo.",
};

export default function MethodologyPage() {
  const byMethod = matching.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.match_method] = (accumulator[row.match_method] ?? 0) + 1;
    return accumulator;
  }, {});

  // Dos cosas distintas que antes salían mezcladas: los que no cruzaron (para
  // los que el número no es una confianza, es lo cerca que quedó el candidato
  // más parecido, que es otra cosa) y los que sí cruzaron por una vía con
  // margen de error.
  const unmatched = matching.filter((row) => !row.person_code);
  const lowConfidence = matching
    .filter((row) => row.person_code && row.match_confidence < 92)
    .sort((a, b) => a.match_confidence - b.match_confidence)
    .slice(0, 10);

  return (
    <section className="section shell">
      <div className="stack" style={{ "--gap": "12px", marginBottom: 30 } as React.CSSProperties}>
        <span className="eyebrow">Cómo funciona</span>
        <h1>Metodología</h1>
        <p className="lede">
          Todo lo que hay en esta web sale de dos fuentes y una fórmula. Ninguna métrica es
          una caja negra: si una recomendación no se puede explicar, no sirve para decidir un
          fichaje.
        </p>
      </div>

      {/* Primero las reglas: sin ellas no se entiende ni el óptimo ni la consola. */}
      <div className="card" style={{ marginBottom: 16 }} id="reglas">
        <h2 className="card-title">Las reglas en 30 segundos</h2>
        <ul className="card-note" style={{ margin: "8px 0 0", maxWidth: "76ch", display: "grid", gap: 6 }}>
          <li>
            <strong>{num(meta.budget, 0)} créditos</strong> para diez jugadores y un entrenador:
            4 bases, 4 aleros y 2 pívots. Como mucho 6 del mismo club.
          </li>
          <li>
            El quinteto lleva al menos uno de cada puesto (2-2-1, 1-2-2, 2-1-2, 1-3-1 o 3-1-1).{" "}
            <strong>Quinteto y sexto hombre puntúan al 100 %</strong>; los cuatro del banquillo, al
            50 %. El entrenador puntúa por el marcador de su equipo.
          </li>
          <li>
            El <strong>capitán</strong>, que sale del quinteto, <strong>puntúa doble</strong>. Cada
            jugador suma un 10 % más si su equipo gana.
          </li>
          <li>
            <strong>4 cambios por jornada, y el entrenador cuenta como uno.</strong> Tras las
            jornadas 6, 13, 18, 23, 28 y 34, y en playoffs, los cambios son ilimitados.
          </li>
          <li>
            Cada jornada se juega en <strong>turnos</strong> (días): entre un turno y el siguiente
            se puede mover gente entre pista y banquillo y cambiar de capitán.
          </li>
          <li>
            Los precios se revalorizan al cerrar cada jornada, según lo que ha puntuado cada uno
            frente a lo que cuesta.
          </li>
        </ul>
        <p className="card-note" style={{ marginTop: 10 }}>
          Reglamento completo en{" "}
          <a href="https://fantaking.gitbook.io/euroleague-fantasy-challenge-rules">
            fantaking.gitbook.io
          </a>
          .
        </p>
      </div>

      <div className="grid grid-2">
        <article className="card">
          <h2 className="card-title">1. Estadísticas oficiales</h2>
          <p className="card-note">
            <code>api-live.euroleague.net</code> — la API pública de la EuroLeague. De ahí
            salen los 20 clubes, el censo de jugadores, el calendario completo de las 38
            jornadas y el boxscore de cada partido jugado. Sin autenticación y sin límite de
            uso razonable.
          </p>
          <p className="card-note">
            El censo trae a los traspasados dos veces, con el club antiguo marcado como
            inactivo. Se filtra: si no, a un jugador se le acabaría asignando el calendario
            del equipo que dejó.
          </p>
        </article>

        <article className="card">
          <h2 className="card-title">2. Precios del Fantasy</h2>
          <p className="card-note">
            El EuroLeague Fantasy Challenge no publica API. Su frontend habla contra{" "}
            <code>fantaking-api.dunkest.com</code>, donde la Euroliga es la competición 49.
            De ahí sale la columna que no existe en ningún otro sitio: el precio en créditos
            de cada jugador.
          </p>
          <p className="card-note">
            Un snapshot completo son cuatro peticiones. Se captura cuatro veces al día y solo se
            guarda si el mercado ha cambiado: el histórico acumulado es lo que permite ver quién
            sube y quién baja.
          </p>
          <p className="card-note">
            El juego calcula la variación de cada jugador en cuanto acaba su partido, pero no la
            aplica al precio hasta que se cierra la jornada. Si la última captura es de antes, la
            web lo avisa y enseña el <strong>precio pendiente</strong>: la variación que ya
            publica el juego para quien ha jugado, y la del modelo de precio para quien jugó
            después. Con los datos de la J1 acertaba 334 de 350 precios al décimo.
          </p>
        </article>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="card-title">La fórmula de puntuación</h2>
        <p className="card-note" style={{ maxWidth: "72ch" }}>
          Fantaking documenta el baremo, pero el mercado solo devuelve medias. Reimplementar
          la fórmula sobre los boxscores permite recuperar la puntuación de cada partido por
          separado — y sin eso no hay forma de medir varianza, forma reciente ni cambios de
          rol.
        </p>
        <div className="table-wrap" style={{ marginTop: 12 }} tabIndex={0} role="region" aria-label="Baremo de puntuación">
          <table className="data">
            <thead>
              <tr>
                <th>Acción</th>
                <th className="num">Valor</th>
                <th>Acción</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Punto anotado</td>
                <td className="num">+1</td>
                <td>Pérdida</td>
                <td className="num">−1</td>
              </tr>
              <tr>
                <td>Rebote</td>
                <td className="num">+1</td>
                <td>Tapón recibido</td>
                <td className="num">−1</td>
              </tr>
              <tr>
                <td>Asistencia</td>
                <td className="num">+1</td>
                <td>Falta cometida</td>
                <td className="num">−1</td>
              </tr>
              <tr>
                <td>Robo</td>
                <td className="num">+1</td>
                <td>Tiro de campo fallado</td>
                <td className="num">−1</td>
              </tr>
              <tr>
                <td>Tapón</td>
                <td className="num">+1</td>
                <td>Tiro libre fallado</td>
                <td className="num">−1</td>
              </tr>
              <tr>
                <td>Falta recibida</td>
                <td className="num">+1</td>
                <td>Victoria del equipo</td>
                <td className="num">+10% del valor absoluto</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="card-note" style={{ marginTop: 10 }}>
          El entrenador puntúa solo por el marcador: +10 / +20 / +25 según gane por 1-10,
          11-20 o más de 20; −5 / −10 / −20 si pierde. El capitán dobla su puntuación y el
          banquillo cuenta la mitad.
        </p>
        <p className="card-note">
          El comando <code>efa verify</code> contrasta la media calculada aquí con la que
          devuelve el propio mercado de Fantaking. Si la correlación cae, es que el baremo ha
          cambiado — y es mejor enterarse por ahí que por un fichaje.
        </p>
        <p className="card-note">
          Contrastado en la jornada 1: cuadran al decimal los 159 jugadores y los 14
          entrenadores de los partidos del 24 de septiembre. El bonus de victoria suma siempre:
          un −1 con victoria queda en −0,9, no en −1,1.
        </p>
      </div>

      <ProjectionModel />

      <OfficialData />

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <article className="card">
          <h2 className="card-title">Las métricas, una a una</h2>
          <dl className="card-note" style={{ display: "grid", gap: 10, margin: 0 }}>
            <Definition term="Proyección">
              Minutos esperados × puntos por minuto × rival × campo × probabilidad de jugar. El
              detalle y cuánto acierta, en{" "}
              <a href="#proyeccion">el modelo de proyección</a>.
            </Definition>
            <Definition term="Umbral de revalorización">
              Los puntos con los que un precio no se mueve. Sale de ajustar la variación que
              publica el propio juego contra puntos y precio
              {meta.priceModel ? ` (explica el ${percent(meta.priceModel.r2)} de las variaciones)` : ""},
              y queda entre 1,0 y 1,1 veces el precio: más alto cuanto más caro es el jugador.
            </Definition>
            <Definition term="Horquilla y techo">
              Suelo, techo y p90 salen de los errores reales del backtest, no de una normal: la
              puntuación tiene la cola de arriba más larga que la de abajo (el percentil 75 queda
              a +0,57 desviaciones y el 25 a −0,68). La dispersión se encoge hacia la del año
              pasado y, si puede no jugar, suma el riesgo de quedarse en cero. La del entrenador
              es exacta: solo puede sacar seis cifras. El p90 es el que importa para el capitán.
            </Definition>
            <Definition term="En pista, on/off y quintetos">
              Se reconstruye quién está en pista cada segundo con los cambios del jugada a
              jugada oficial. En la J1 los minutos cuadran con el boxscore a menos de 30
              segundos en los 240 jugadores. Las posesiones se estiman como tiros + 0,44 ×
              libres − rebotes ofensivos + pérdidas.
            </Definition>
            <Definition term="Mapa de tiro">
              Coordenadas de cada tiro de campo (API oficial), repartidas en diez zonas con las
              medidas FIBA y comparadas con la media de la liga en esa zona. Dos temporadas: el
              tiro viaja con el jugador.
            </Definition>
            <Definition term="Lo que concede cada club">
              Puntos fantasy por partido de los rivales de cada puesto, encogidos hacia el año
              pasado como la proyección. Es lo que colorea el calendario fantasy.
            </Definition>
            <Definition term="Puntos por crédito">
              Proyección dividida entre precio. Es el ratio que decide casi todo: 18 puntos a
              12 créditos rinden peor que 12 puntos a 7.
            </Definition>
            <Definition term="Fiabilidad">
              Uno menos el coeficiente de variación, acotado entre 0 y 1. Un 70% es un
              jugador que repite; un 30% es una lotería con la misma media. Con menos de tres
              partidos se estima con la dispersión encogida hacia el año pasado, y se marca
              con «≈».
            </Definition>
            <Definition term="Probabilidad de subir">
              La probabilidad de que puntúe por encima de su umbral de revalorización, con su
              proyección y su dispersión.
            </Definition>
            <Definition term="Cuota de minutos">
              Porcentaje de los minutos de su equipo que juega. Señal de rol más limpia que
              los minutos absolutos, que se inflan con las prórrogas.
            </Definition>
            <Definition term="Calendario">
              Diferencial medio de los tres próximos rivales, con penalización por jugar
              fuera, normalizado a 0-100. El diferencial de cada club mezcla esta temporada con
              la anterior: con n partidos pesa n/(n+6) lo de ahora.
            </Definition>
            <Definition term="Plan de cambios (Mi equipo)">
              Desde tu plantilla, los fichajes (hasta 4, entrenador incluido, o ilimitados en
              ventana) que más suben la puntuación real, dentro de tu presupuesto (valor de tu
              plantilla + caja) y del tope de club. Búsqueda en haz con cambios sueltos y por
              parejas, contrastada con el óptimo exacto por programación entera: igual en 26 de
              30 plantillas de prueba y 0,1 puntos por debajo de media. Los roles se recolocan
              tras cada cambio y el reparto de roles se comprueba contra fuerza bruta en cada
              integración.
            </Definition>
            <Definition term="Lo que menos te renta">
              Puntos que aporta cada crédito en el sitio que ocupa: capitán ×2, quinteto y sexto
              ×1, banquillo ×0,5. Lo que paga tu plantilla es su rendimiento en su sitio, no su
              valor de mercado.
            </Definition>
            <Definition term="Índice de chollo">
              40% valor por crédito, 25% proyección, 15% fiabilidad, 10% tendencia de rol,
              10% probabilidad de subir. Pesos a la vista y discutibles a propósito.
            </Definition>
          </dl>
        </article>

        <article className="card">
          <h2 className="card-title">Cruce de identidades</h2>
          <p className="card-note">
            Los identificadores de Fantaking y de la EuroLeague no tienen nada que ver. El
            único puente es nombre + equipo, con acentos, apellidos compuestos y nombres
            abreviados de por medio. El emparejamiento va en cascada, de más fiable a menos, y
            lo que no llega al umbral se deja sin cruzar en vez de inventarse.
          </p>
          <div className="table-wrap" style={{ marginTop: 10 }} tabIndex={0} role="region" aria-label="Métodos de cruce">
            <table className="data">
              <thead>
                <tr>
                  <th>Método</th>
                  <th className="num">Jugadores</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byMethod)
                  .sort((a, b) => b[1] - a[1])
                  .map(([method, count]) => (
                    <tr key={method}>
                      <td>{METHOD_LABEL[method] ?? method}</td>
                      <td className="num">{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {unmatched.length ? (
            <p className="card-note" style={{ marginTop: 12 }}>
              <strong>{unmatched.length} sin cruzar.</strong> No es que el emparejamiento
              dude: es que esos jugadores todavía no existen en el censo oficial. Son en su
              mayoría fichajes llegados de la NBA y jugadores jóvenes que los clubes aún no
              han inscrito. Se resuelve solo conforme avanza la pretemporada, porque el
              censo se vuelve a descargar cada día.
            </p>
          ) : null}

          {lowConfidence.length ? (
            <>
              <p className="card-note" style={{ marginTop: 12 }}>
                Emparejados por una vía con margen de error, que conviene mirar a mano:
              </p>
              <ul className="card-note" style={{ margin: 0 }}>
                {lowConfidence.map((row) => (
                  <li key={row.fantaking_id}>
                    {row.fantaking_name} ({row.fantaking_team}) → {row.official_name} ·{" "}
                    {num(row.match_confidence, 0)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="card-note" style={{ marginTop: 12 }}>
              De los {meta.matched} cruzados, ninguno lo hizo por una vía dudosa:{" "}
              {percent(meta.matchRate)} del mercado está identificado con garantías.
            </p>
          )}
        </article>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="card-title">Límites que conviene tener presentes</h2>
        <ul className="card-note" style={{ margin: 0, maxWidth: "72ch" }}>
          <li>
            La fórmula de revalorización no es pública. El modelo de precio se ajusta cada día
            a la variación que publica el juego, pero es una aproximación: a los entrenadores
            que juegan después de la captura no se les estima el precio pendiente.
          </li>
          <li>
            Las lesiones combinan tres partes públicos: BasketNews (el más completo),
            RotoWire y Basketball Sphere; si uno no responde, siguen los otros. Una baja
            proyecta 0 y el óptimo no la ficha; una duda cuenta la mitad y un probable, el 90 %.
            Son probabilidades fijas, no estimadas: el parte no dice más.
          </li>
          <li>
            La horquilla de la plantilla suma a los jugadores como si fueran independientes. Los
            de un mismo equipo se mueven juntos (si el equipo pierde de 30, fallan todos), así
            que la real es algo más ancha.
          </li>
          <li>
            Los turnos permiten cambiar de capitán entre días. La consola elige el que más
            proyecta; no calcula el valor de esperar a ver el primer turno.
          </li>
          <li>
            El rating de equipo de las primeras jornadas es poco fiable: por eso se encoge hacia
            la temporada anterior, que manda hasta pasada media docena de partidos.
          </li>
        </ul>
      </div>

      <p className="card-note" style={{ marginTop: 20 }}>
        Última generación de datos: {dateTime(meta.generatedAt)} · {meta.players} jugadores ·{" "}
        {meta.priceSnapshots} capturas de precio ·{" "}
        {meta.performanceSource.games} partidos analizados
        {meta.performanceSource.isBaseline ? ` (${meta.performanceSource.source})` : ""}.
      </p>
    </section>
  );
}

/** El modelo de proyección y su backtest, con las cifras del último
 *  `efa backtest` (meta.modelBacktest), no copiadas a mano. */
function ProjectionModel() {
  const bt = meta.modelBacktest ?? null;
  const season = bt?.season;
  const current = bt?.current;
  const coach = bt?.coach;
  const match = meta.matchModel;
  const buckets = season?.byGames ? Object.entries(season.byGames) : [];
  return (
    <div className="card" style={{ marginTop: 16 }} id="proyeccion">
      <h2 className="card-title">El modelo de proyección</h2>
      <div className="card-note" style={{ maxWidth: "76ch", display: "grid", gap: 8 }}>
        <p style={{ margin: 0 }}>
          <strong>Si juega:</strong> minutos esperados × puntos por minuto × rival × campo.
        </p>
        <ul style={{ margin: 0, display: "grid", gap: 4 }}>
          <li>
            <strong>Minutos:</strong> media con más peso a los últimos partidos (vida media de 3),
            encogida hacia sus minutos del año pasado con un colchón de 2 partidos.
          </li>
          <li>
            <strong>Puntos por minuto:</strong> su ritmo de la temporada encogido con un colchón de
            100 minutos hacia el del año pasado; si llega nuevo, hacia el que descuenta su precio,
            y si no, hacia el de su puesto.
          </li>
          <li>
            <strong>Rival:</strong> lo que concede ese rival a su puesto frente a la media, a medio
            peso y encogido con 8 partidos. <strong>Campo:</strong> lo que se puntúa de más en casa.
          </li>
          <li>
            <strong>Probabilidad de jugar:</strong> si hay parte, 0 de baja, 50 % en duda y 90 %
            probable; si no, la parte de partidos de su club que ha jugado, con colchón de 2. La
            proyección que se enseña es lo que hace si juega por esa probabilidad; «si juega» va
            aparte en la ficha, el mercado y el comparador.
          </li>
          <li>
            <strong>Entrenador:</strong> solo puntúa por el marcador. Cada club tiene una fuerza
            (margen medio ajustado por campo, encogido con 6 partidos hacia el año pasado), el
            margen esperado es la diferencia más{" "}
            {match ? `${num(match.homeAdvantage)} puntos de ventaja de campo` : "la ventaja de campo"}, y
            el resultado se reparte como una normal
            {match ? ` de ${num(match.marginSd)} puntos de dispersión` : ""}. De ahí la
            probabilidad de ganar y sus puntos esperados.
          </li>
        </ul>
        {season ? (
          <p style={{ margin: 0 }}>
            <strong>Cuánto acierta.</strong> Se predice cada partido de la temporada{" "}
            {season.code.slice(1)}-{String(Number(season.code.slice(1)) + 1).slice(-2)} solo con los
            anteriores ({num(season.n, 0)} partidos). Error medio:
          </p>
        ) : null}
      </div>
      {season ? (
        <div className="table-wrap" style={{ marginTop: 10, maxWidth: 620 }} tabIndex={0} role="region" aria-label="Backtest de la proyección">
          <table className="data">
            <thead>
              <tr>
                <th>Partidos jugados antes</th>
                <th className="num">n</th>
                <th className="num">Este modelo</th>
                <th className="num">El anterior</th>
                <th className="num">Su media</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map(([bucket, row]) => (
                <tr key={bucket}>
                  <td>{bucket.replace("-99", " o más").replace("-", " a ")}</td>
                  <td className="num">{num(row.n, 0)}</td>
                  <td className="num">
                    <strong>{num(row.v2, 2)}</strong>
                  </td>
                  <td className="num">{num(row.legacy ?? null, 2)}</td>
                  <td className="num">{num(row.mean ?? null, 2)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className="num">{num(season.n, 0)}</td>
                <td className="num">
                  <strong>{num(season.v2.mae, 2)}</strong>
                </td>
                <td className="num">{num(season.legacy?.mae ?? null, 2)}</td>
                <td className="num">{num(season.mean?.mae ?? null, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="card-note" style={{ maxWidth: "76ch", marginTop: 10, display: "grid", gap: 6 }}>
        {season ? (
          <p style={{ margin: 0 }}>
            Donde más gana es al principio, que es cuando la media propia no existe: con 1 a 3
            partidos se equivoca bastante menos que la media y que el modelo anterior. La forma
            de los últimos cinco no entra: en el backtest, darle peso empeoraba el error.
          </p>
        ) : null}
        {current && current.n > 0 ? (
          <p style={{ margin: 0 }}>
            Esta temporada, {num(current.n, 0)} partidos predichos: {num(current.v2.mae, 2)} de error
            medio
            {current.prior_mean ? ` (la media del año pasado, ${num(current.prior_mean.mae, 2)})` : ""}.
            Con tan pocas jornadas la cifra aún se mueve mucho.
          </p>
        ) : null}
        {coach && coach.n > 0 ? (
          <p style={{ margin: 0 }}>
            Entrenadores ({num(coach.n, 0)} partidos): {num(coach.model, 2)} de error medio con el
            modelo de partido frente a {num(coach.mean, 2)} con su media.
          </p>
        ) : null}
        {bt ? (
          <p style={{ margin: 0 }} className="muted">
            Backtest del {dateTime(bt.generatedAt)}; se repite en cada captura.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Qué se usa de la Euroliga y qué no. Lo que no entra en la proyección no
 *  entra porque en el backtest no mejora el error, o porque ya está dentro de
 *  otra cifra (la puntuación fantasy ya es la valoración más el bonus). */
function OfficialData() {
  const rows: Array<[string, string, string]> = [
    [
      "Boxscore de cada partido",
      "Puntos, rebotes, asistencias, robos, pérdidas, tapones puestos y recibidos, faltas recibidas y cometidas, tiros de campo y libres fallados (la puntuación fantasy, partido a partido); minutos, titular, más/menos y valoración; rebotes ofensivos y defensivos y tiros de 2 y de 3 (para los índices de equipo)",
      "Intentos de «accuracy» y el segundo indicador de titular",
    ],
    [
      "Estadísticas avanzadas por jugador",
      "Tiro verdadero (TS%), tiro efectivo (eFG%), % de rebote ofensivo y defensivo, ratio de asistencias, pérdidas por posesión, tiros libres por tiro, dobles-dobles y titularidades (percentiles en la ficha)",
      "% de rebote total, asistencias/pérdidas, posesiones, ratios de intentos de 2 y de 3, triples-dobles, victorias y derrotas, y todo el bloque de reparto de puntos (qué parte viene de libres, de 2 y de 3)",
    ],
    [
      "Jugada a jugada",
      "Quién está en pista cada segundo: on/off, quintetos, minutos por cuarto y en los finales apretados",
      "—",
    ],
    [
      "Tiros con coordenadas",
      "Mapa de tiro en diez zonas frente a la media de la liga",
      "—",
    ],
    [
      "Calendario y resultados",
      "Rival, campo, fecha y turno de cada partido; marcadores y prórrogas (puntos del entrenador y modelo de partido)",
      "—",
    ],
    [
      "Censo",
      "Posición, altura, país, edad, dorsal, foto y club de jugadores y entrenadores",
      "—",
    ],
  ];
  return (
    <div className="card" style={{ marginTop: 16 }} id="datos-oficiales">
      <h2 className="card-title">Qué se usa de la Euroliga</h2>
      <p className="card-note" style={{ maxWidth: "76ch" }}>
        La <strong>proyección</strong> solo usa minutos, puntuación fantasy partido a partido, puesto,
        lo que concede cada rival a ese puesto, el campo, el calendario y el parte de lesiones. La
        puntuación fantasy es la valoración oficial (PIR) más el 10 % si gana su equipo, así que
        «lo que concede el rival» ya es, en la práctica, la valoración que permite a cada puesto. Los
        porcentajes avanzados describen al jugador en su ficha, pero no entran en la cifra: ya
        están dentro de lo que puntúa por minuto.
      </p>
      <div className="table-wrap" style={{ marginTop: 10 }} tabIndex={0} role="region" aria-label="Datos oficiales usados">
        <table className="data">
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Se usa</th>
              <th>Se descarga pero no se usa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([source, used, unused]) => (
              <tr key={source}>
                <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{source}</td>
                <td style={{ whiteSpace: "normal", minWidth: 260 }}>{used}</td>
                <td style={{ whiteSpace: "normal", minWidth: 200 }} className="muted">
                  {unused}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ fontWeight: 640, color: "var(--ink)" }}>{term}</dt>
      <dd style={{ margin: "2px 0 0" }}>{children}</dd>
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = {
  override: "Corrección manual",
  "initial-club": "Apellido e inicial, mismo club",
  "surname-club": "Apellido único en el club",
  exact: "Nombre completo idéntico",
  subset: "Apellido compuesto o con partícula",
  "fuzzy-club": "Similitud alta, mismo club",
  "initial-open": "Apellido e inicial, único en la liga",
  "exact-open": "Nombre exacto, club distinto",
  "prior-season": "Censo de la temporada anterior",
  "fuzzy-open": "Similitud muy alta, sin club",
  unmatched: "Sin cruzar (aún no inscrito)",
};
