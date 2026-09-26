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
            <strong>4 cambios por jornada.</strong> Los precios se revalorizan al cerrar cada
            jornada, según lo que ha puntuado cada uno frente a lo que cuesta.
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

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <article className="card">
          <h2 className="card-title">Las métricas, una a una</h2>
          <dl className="card-note" style={{ display: "grid", gap: 10, margin: 0 }}>
            <Definition term="Proyección">
              Media fantasy de la temporada más un ajuste por tendencia de minutos, traducida a
              puntos con su producción por minuto, aplicado al 30 % y acotado a un 35 % de la
              proyección (6 puntos como mucho). Con pocos partidos se encoge hacia la media del
              año pasado: con n partidos pesa n/(n+5) lo de ahora. A quien llega nuevo a la
              Euroliga, hacia lo que descuenta su precio. Si su club ya ha jugado y él no, se
              multiplica por (jugados + 2)/(partidos del club + 2).
            </Definition>
            <Definition term="Por qué no pesa la forma">
              La forma de los últimos cinco se enseña, pero no entra en la proyección. En un
              backtest sobre la 2025-26 (7.764 partidos predichos solo con los anteriores), la
              media simple se equivocaba 6,05 puntos de media; darle a la forma hasta un 60 %
              subía el error a 6,11, y el ajuste de minutos a tope, a 6,27. Al 30 %, el ajuste
              de minutos sí mejora a la media desde el cuarto partido.
            </Definition>
            <Definition term="Umbral de revalorización">
              Los puntos con los que un precio no se mueve. Sale de ajustar la variación que
              publica el propio juego contra puntos y precio
              {meta.priceModel ? ` (explica el ${percent(meta.priceModel.r2)} de las variaciones)` : ""},
              y queda entre 1,0 y 1,1 veces el precio: más alto cuanto más caro es el jugador.
            </Definition>
            <Definition term="Horquilla">
              Cada jugador puntúa según una normal con su proyección y su dispersión (también
              encogida hacia el año pasado). Suelo y techo son los percentiles 25 y 75.
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
            Las lesiones salen del parte diario de BasketNews. Una baja no cambia la
            proyección (es lo que rinde cuando juega), pero el óptimo no la ficha y Mi equipo
            la puntúa a 0; una «duda» no se descuenta.
          </li>
          <li>
            La proyección no modela el rival concreto de cada jugador, solo la dificultad
            agregada del calendario de su equipo.
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
