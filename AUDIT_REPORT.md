# Auditoría de HoopIQ tras la Jornada 3 (5 de octubre de 2026)

Código auditado: `main` en `4ddd68e` ("datos: snapshot 2026-10-05 07:17"), que es lo que sirve Vercel ahora mismo.
Web: https://euroleague-fantasy-analytics.vercel.app · No se ha modificado ningún fichero del proyecto salvo este informe.

## Resumen ejecutivo

**Estado general: los datos y la fórmula están bien. Lo flojo está en la capa de precio y en la disponibilidad.** Las 719 líneas jugador-partido de J1–J3 coinciden al 100 % con euroleaguebasketball.net, y los puntos fantasy de 252 jugadores y 20 entrenadores coinciden con el juego oficial (±0,1, por redondeo). El modelo publicado **sí gana a los baselines tontos**: en la J3 tiene un MAE de 5,56 frente a 6,23 de la media y un Spearman de 0,51 frente a 0,42. Los tres problemas más graves:
1. 🔴 **El "precio pendiente" usa mal el campo `plus`.** Ese campo es la variación *acumulada* desde el inicio de temporada, no la de la jornada. Durante cada jornada, el óptimo, el presupuesto y los pts/cr salen con errores de hasta 1,4 cr. En la J3 eran peores que no ajustar nada (MAE de 0,28 frente a 0,19). Volverá a pasar el 7 de octubre.
2. 🟠 **La probabilidad de jugar está mal calibrada.** A las "dudas" se les da un 50 % y en realidad juega el 25 %. A quien nunca ha entrado en una convocatoria se le da un 57 % y juega el 5 %. Eso infla la proyección (sesgo de +1,1 en la J3).
3. 🟠 **El modelo de precio no se recalibra desde la J1, y la web dice que sí.** Además, "Revalor. esperada" no mejora a predecir "sin cambio", y el parte de lesiones funciona con 1 de sus 3 fuentes sin que salte ningún aviso.

---

## 1. Arquitectura y flujo de datos

```
 api-live.euroleague.net (pública)        fantaking-api.dunkest.com (token)      RotoWire · BasketNews · B.Sphere
 clubes, censo, calendario,               mercado: quotation, fpt, plus,          (scraping HTML)
 boxscores, PBP, tiros, avanzadas         medias por acción
            │ efa ingest-official                 │ efa snapshot                         │ efa injuries
            ▼                                     ▼                                      ▼
 data/raw/official/E2025|E2026/*.json(.gz)   data/raw/prices/prices_*.parquet|csv     data/raw/injuries/*.json
            │                                     │  (solo si cambia quotation/plus/fpt)  │
            └───────────────┬─────────────────────┴──────────────────────┬───────────────┘
                            ▼                                            ▼
        efa build (pipeline/efa/build.py, ~28 s)          efa backtest → data/processed/projection_backtest.json
        ├ matching.py   cruce Fantaking ↔ censo (cascada; overrides manuales)
        ├ gamelogs.py   1 fila jugador×partido; scoring.py = baremo oficial
        ├ metrics.py    medias, fiabilidad, rating de equipo, calendario, índice de chollo
        ├ projection.py v2: minutos EWMA × pts/min (encogidos) × rival × campo
        ├ build.py      × prob. de jugar (historial / parte de lesiones); entrenador = matchmodel.py
        ├ advanced_build.py  precio pendiente, umbral, prob. de subir, horquillas, tiros, on/off
        └ optimizer.py  óptimo ILP (PuLP) con 100 cr
                            ▼
        web/src/data/{players,details,teams,lineup,meta,matching}.json  (commit del bot)
                            ▼
        Next.js 16 (SSG, 386 páginas estáticas; el JSON se importa en build) → Vercel redespliega con cada push
```

**Automatización:** `.github/workflows/snapshot.yml` lleva un cron `23 1,7,13,19 * * *`, pero GitHub lo ejecuta con 3–5 h de retraso. Las ejecuciones reales caen hacia las 06:40, 12:40, 17:30 y 22:20 UTC. Las 30 últimas ejecuciones han terminado en verde y la última fue el 05-10 a las 07:16 UTC. Si falla la captura de precios, el run sale en rojo y las estadísticas se commitean igual. Si falla una fuente de lesiones, no avisa (ver I3).

---

## 2. Integridad de los datos

### 2.1 Cobertura

| Comprobación | Resultado |
|---|---|
| Partidos J1–J3 | 30/30 jugados, 30 boxscores, 0 aplazados. J4 (7–9 oct) sin jugar |
| Clubes por jornada | 20/20 en las tres |
| Filas jugador-partido | 719 (240 / 239 / 240); 681 con minutos, 38 DNP |
| Minutos por equipo y partido | 199,98–200,01 en los 60 casos (no hay prórrogas) |
| Marcador de `games.json` = boxscore = suma de puntos de jugadores | 60/60 |
| Duplicados (partido, jugador) / nulos en el game log | 0 / 0 |
| Jugadores con más de un club esta temporada | 0 |
| Nombres mal parseados | 0. La API oficial va en ASCII mayúsculas y el cruce no depende de tildes. Solo hay fallos **de presentación** (ver M1) |
| IDs: `fantaking_id` y `person_code` duplicados en el mercado | 0 / 0 |
| Sin cruzar con el censo | 7 (Jaiteh, Heidegger, Papas, Medarevic, Bourdillon, Hunter, Boungou-Colo): todos con `fpt = 0` y sin inscribir. Correcto |
| DNP frente a 0 puntos | Se distinguen en datos (`played = minutos > 0`). Hay 29 actuaciones con minutos y 0 puntos exactos, que no se confunden con los 38 DNP. En la UI no siempre se ve la diferencia (M2) |

### 2.2 Contraste con fuentes oficiales

- **euroleaguebasketball.net:** he descargado de su feed (`feeds.incrowdsports.com/.../E2026/games/{1..30}/stats`, el que pinta el *game center* de la web oficial) los 30 boxscores. Comparando 16 campos (minutos, PTS, REB, AST, STL, TOV, BLK a favor y en contra, faltas, tiros, PIR y titular) en las **719 líneas**, hay **0 diferencias** y 0 diferencias de convocatoria.
- **Fantasy oficial:** no hay token en este entorno, así que he usado los snapshots del propio juego que guarda el repo. En el mercado del 03-10 06:42, las medias de los **252 jugadores con minutos** coinciden en las 11 acciones del baremo (diferencia máxima 0,00) y en `fpt` (diferencia máxima 0,05, por redondeo). Los **20 entrenadores** cuadran. Los puntos de cada jornada salen por diferencias entre snapshots: `J_k = g_k·fpt_k − g_{k−1}·fpt_{k−1}`.

### 2.3 Muestra de 12 jugadores, jornada a jornada

Cada estadística se ha comparado **pipeline frente a euroleaguebasketball.net** y han coincidido todas, así que se pone un solo valor. "FP calc." es la fórmula del repo; "FP juego" sale de las medias del Fantasy oficial.

| Jugador | Tipo | J | Estado | Min | PTS | REB | AST | STL | BLK | TOV | PIR | FP calc. | FP juego |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Elijah Bryant (HTA) | estrella | 1 | jugó | 29,2 | 10 | 2 | 3 | 0 | 0 | 2 | 13 | 13,0 | 13,0 |
| | | 2 | jugó | 36,6 | 18 | 10 | 4 | 4 | 0 | 2 | 31 | 34,1 | 34,2 |
| | | 3 | jugó | 31,6 | 22 | 13 | 7 | 1 | 0 | 1 | 40 | 44,0 | 44,0 |
| Sasha Vezenkov (OLY) | estrella | 1 | jugó | 19,0 | 22 | 5 | 1 | 0 | 0 | 1 | 30 | 33,0 | 33,0 |
| | | 2 | jugó | 24,6 | 18 | 8 | 1 | 1 | 0 | 1 | 26 | 28,6 | 28,6 |
| | | 3 | jugó | 26,6 | 20 | 6 | 0 | 1 | 0 | 0 | 23 | 23,0 | 23,0 |
| Carlik Jones (PAR) | estrella | 1 | jugó | 26,9 | 20 | 4 | 10 | 0 | 0 | 0 | 33 | 36,3 | 36,3 |
| | | 2 | jugó | 23,3 | 20 | 1 | 5 | 3 | 0 | 2 | 26 | 28,6 | 28,7 |
| | | 3 | jugó | 25,0 | 16 | 2 | 5 | 0 | 0 | 1 | 13 | 14,3 | 14,2 |
| Mike James | traspaso + baja J4 | 1 | jugó | 31,8 | 22 | 4 | 5 | 0 | 1 | 5 | 24 | 24,0 | 24,0 |
| | | 2 | jugó | 31,3 | 12 | 2 | 4 | 3 | 0 | 1 | 13 | 14,3 | 14,4 |
| | | 3 | jugó | 22,5 | 11 | 1 | 3 | 0 | 0 | 2 | 4 | 4,0 | 3,9 |
| Nigel Williams-Goss (ZAL) | lesionado | 1 | jugó | 25,3 | 14 | 2 | 6 | 2 | 0 | 3 | 14 | 15,4 | 15,4 |
| | | 2–3 | no convocado | — | — | — | — | — | — | — | — | — | — |
| Jonas Valanciunas (ZAL) | fichaje NBA | 1 | jugó | 21,6 | 13 | 8 | 2 | 0 | 3 | 1 | 24 | 26,4 | 26,4 |
| | | 2 | jugó | 23,8 | 11 | 6 | 7 | 1 | 1 | 3 | 21 | 21,0 | 21,0 |
| | | 3 | jugó | 20,6 | 12 | 6 | 0 | 0 | 3 | 4 | 16 | 16,0 | 15,9 |
| Dario Saric (IST) | fichaje NBA | 1 | jugó | 29,3 | 17 | 5 | 2 | 0 | 0 | 1 | 26 | 26,0 | 26,0 |
| | | 2 | jugó | 22,1 | 10 | 3 | 4 | 0 | 0 | 2 | 10 | 11,0 | 11,0 |
| | | 3 | jugó | 24,3 | 13 | 10 | 1 | 1 | 0 | 3 | 18 | 18,0 | 17,9 |
| TJ Shorts (PAM) | traspaso | 1 | jugó | 23,6 | 26 | 1 | 2 | 1 | 0 | 2 | 20 | 22,0 | 22,0 |
| | | 2 | jugó | 18,9 | 12 | 0 | 10 | 1 | 0 | 1 | 20 | 22,0 | 22,0 |
| | | 3 | jugó | 21,6 | 17 | 4 | 6 | 0 | 1 | 2 | 22 | 24,2 | 24,1 |
| Sylvain Francisco | traspaso | 1 | jugó | 21,9 | 18 | 2 | 4 | 0 | 0 | 4 | 18 | 19,8 | 19,8 |
| | | 2 | jugó | 19,6 | 19 | 2 | 3 | 0 | 1 | 0 | 25 | 27,5 | 27,6 |
| | | 3 | jugó | 20,8 | 11 | 3 | 4 | 2 | 0 | 2 | 9 | 9,9 | 9,9 |
| Bryant Dunston (OLY) | rotación, llegó tarde al mercado | 1 | no convocado | — | — | — | — | — | — | — | — | — | — |
| | | 2 | **DNP** | 0,0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| | | 3 | jugó | 18,5 | 6 | 2 | 3 | 0 | 0 | 0 | 7 | 7,0 | 7,0 |
| Juan Núñez (BAR) | rotación | 1–2 | **DNP** | 0,0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| | | 3 | jugó | 2,5 | 0 | 1 | 0 | 0 | 0 | 1 | −1 | −0,9 | −0,9 |
| Daquan Jeffries (BES) | fichaje + baja | 1 | jugó | 5,4 | 0 | 0 | 1 | 0 | 1 | 1 | −3 | −3,0 | −3,0 |
| | | 2–3 | no convocado | — | — | — | — | — | — | — | — | — | — |

Diferencia máxima |FP calc. − FP juego| = **0,1**, que es lo que da el redondeo a un decimal de `fpt`. Los DNP y los no convocados no suman partido en el Fantasy, igual que en el repo.

### 2.4 Precios y frescura

- **Precios al día.** La revalorización de la J3 se aplicó entre el 02-10 23:07 y el 03-10 06:42, y está en el snapshot del 03-10 06:42 (293 cotizaciones cambian). Las capturas posteriores, hasta el 05-10 07:16, devolvieron el mismo mercado y no se guardaron por diseño. `meta.priceFreshness.stale = false`.
- La web dice "Precios del 3 de octubre". Es la fecha del último **cambio**, no la de la última **comprobación** (05-10), y puede dar a entender que los precios llevan dos días sin actualizarse (M3).
- Hay 3 jugadores que entraron en el mercado después de la J1 (Dunston, B. Sy, Papas). El pipeline los recoge sin problema.
- **Si falla la ingesta:** con el token caducado, el run sale en rojo y la web conserva el último precio, con aviso si queda desfasado. Si cae una fuente de lesiones, no avisa (I3). Si cae la API oficial, `ingest-official` rompe el job antes del commit y la web se queda con los datos anteriores.

---

## 3. Fórmula de puntuación

El baremo de `scoring.py` coincide con el reglamento publicado ([players-scoring](https://fantaking.gitbook.io/euroleague-fantasy-challenge-rules/classic-mode/players-scoring), [coach-scoring](https://fantaking.gitbook.io/euroleague-fantasy-challenge-rules/classic-mode/coach-scoring)): +1 por punto, rebote, asistencia, robo, tapón y falta recibida; −1 por pérdida, tapón recibido, falta cometida, tiro de campo fallado y tiro libre fallado; y un +10 % del **valor absoluto** si su equipo gana. La base coincide con el PIR oficial en todas las filas.

Recalculado a mano:

| Actuación | Cálculo | Base | Bonus | Total | Juego |
|---|---|---|---|---|---|
| Bryant J3 (gana HTA) | 22+13+7+1−1+0−0+9−1−8−2 | 40 | +4,0 | **44,0** | 44,0 |
| C. Jones J1 (gana PAR) | 20+4+10+0−0+0−0+5−1−5−0 | 33 | +3,3 | **36,3** | 36,3 |
| Vezenkov J3 (pierde OLY) | 20+6+0+1−0+0−0+2−0−6−0 | 23 | 0 | **23,0** | 23,0 |
| Shorts J1 (gana PAM) | 26+1+2+1−2+0−1+5−3−9−0 | 20 | +2,0 | **22,0** | 22,0 |
| Núñez J3 (gana BAR, base negativa) | 0+1+0+0−1+0−0+0−1−0−0 | −1 | +0,1 | **−0,9** | −0,9 |
| Jeffries J1 (pierde BES) | 0+0+1+0−1+1−0+0−3−1−0 | −3 | 0 | **−3,0** | −3,0 |

(orden del cálculo: PTS + REB + AST + STL − TOV + BLK − BLKA + FD − PF − TCfall − TLfall)

Entrenadores: los 20 cuadran con `fpt`. La regla de prórroga (+10/−5) no se ha podido contrastar con datos reales porque no ha habido ninguna en J1–J3.

---

## 4. Proyecciones

### 4.1 Qué hace cada modelo

| Pieza | Inputs | Fórmula / pesos | Salida |
|---|---|---|---|
| **v2, si juega** (`projection.py:project`) | game log de la temporada, game log 2025-26, puesto, rival y campo de la J siguiente | `minutos × pts/min × F_rival × F_campo`. Minutos: EWMA (vida media 3) encogida con k = 2 partidos hacia la media del año pasado. Pts/min: `(Σfp + 100·ref)/(Σmin + 100)`, con ref = año pasado si jugó ≥100 min, si no lo que "descuenta" el precio (rectas precio→min y precio→tasa), y si no la del puesto. `F_rival = 1 + 0,5·(idx−1)`, con idx encogido con k = 8. `F_campo` = 1,06 en casa y 0,94 fuera, medido en la liga | `projectedIfPlays` |
| **Probabilidad de jugar** (`build.py:399`, `:793`) | partidos jugados, partidos del club, parte de lesiones | sin parte: `(jugados + 2)/(partidos club + 2)`; con parte: baja 0, duda 0,5, probable 0,9 | `playProb`; `projectedFp = si juega × prob` |
| Legacy (`metrics.project_fantasy_points`) | medias | solo de respaldo: para quien no tiene v2 (7 sin cruzar → `fpt` de mercado = 0) | |
| **Entrenador** (`matchmodel.py`) | resultados de las dos temporadas | fuerza = margen ajustado por campo (k = 6), ventaja de campo 3,5, margen ~ N(·, 12,2) | puntos esperados por tramo |
| **Precio** (`advanced.py`) | J1 | `Δ = 0,040·FP − 0,0458·precio + 0,0273` | umbral, variación esperada, prob. de subir |
| Horquilla | backtest 2025-26 | cuantiles empíricos de z = residuo/RMSE (p25 −0,68, p75 +0,57, p90 +1,32) | suelo, techo, p90 |

**Lógica estadística:**
- *Muestra y prior.* Con 3 jornadas se mezcla con 2025-26 (colchón de 100 min en la tasa y de 2 partidos en los minutos). Los que llegan de la NBA usan el prior que marca su precio. Es razonable, aunque los que llegan nuevos salen sobreproyectados (mediana del error si juega: +2,4; ver I4).
- *Rival y campo:* medidos y a medio peso. Están bien.
- *Back-to-back / semana doble:* no se ajusta, y **está justificado**. En 2025-26, con ≤2 días de descanso se hacen 8,9 pts por partido frente a 9,1 con 5+ días, y la tasa relativa es 0,92 frente a 0,93: no hay efecto. Cada jornada es una jornada de Fantasy distinta, así que una "doble jornada" no se suma.
- *Lesiones:* se penalizan multiplicando, no se excluyen, salvo del óptimo (que sí excluye las bajas). La idea es correcta, pero la calibración no (I1).
- *NaN, división por cero y negativos:* las tasas solo se dividen si hay minutos > 0. Sin información, v2 devuelve NaN y entra el modelo de respaldo. Las proyecciones se recortan a ≥0 y las tasas implícitas a [0,3; 1,4]. No hay valores absurdos en `players.json`: el máximo es Vezenkov con 28,2 y no hay negativos ni NaN en jugadores cruzados.

### 4.2 Backtest con lo que **publicó la web**

Se ha usado el `players.json` del commit inmediatamente anterior a cada jornada: `6ae6957` (29-09 07:07, antes de la J2) y `1c8781f` (01-10 14:41, antes de la J3). Se compara con lo que puntuó cada jugador; quien no juega cuenta como 0, que es lo que da el Fantasy. Los baselines son la media de la temporada (sobre los partidos jugados) y el último partido jugado.

**Predicción de la J3 con J1 + J2**

| Universo | Modelo | MAE | RMSE | Sesgo | Spearman |
|---|---|---|---|---|---|
| A. Todo el mercado (n = 326, no jugar = 0) | **HoopIQ `projectedFp`** | **4,71** | **6,51** | +1,10 | **0,602** |
| | Media de temporada (0 si no hay partidos) | 4,83 | 7,13 | +0,53 | 0,538 |
| | Último partido | 5,57 | 7,81 | +0,80 | 0,489 |
| | Precio (solo ranking) | — | — | — | 0,467 |
| B. Con ≥1 partido previo (n = 243) | **HoopIQ** | **5,56** | **7,27** | +1,07 | **0,514** |
| | Media de temporada | 6,23 | 8,08 | +0,93 | 0,422 |
| | Último partido | 7,23 | 8,89 | +1,29 | 0,368 |
| | Media 2025-26 (n = 174) | 6,51 | 8,35 | +1,89 | 0,336 |
| C. Solo los que jugaron (n = 217) | HoopIQ si juega | 5,78 | 7,46 | +0,87 | 0,469 |
| | Media de temporada | 6,23 | 8,04 | +0,39 | 0,435 |
| D. Precio ≥ 8 cr (n = 172) | HoopIQ | 5,89 | 7,78 | +1,38 | 0,528 |
| | Media de temporada | 6,33 | 8,46 | +1,14 | 0,479 |

**Predicción de la J2 con la J1** (aquí media = último partido)

| Universo | Modelo | MAE | RMSE | Sesgo | Spearman |
|---|---|---|---|---|---|
| A. Todo el mercado (n = 326) | **HoopIQ** | **4,67** | **6,07** | +0,69 | **0,637** |
| | Media / último | 5,32 | 7,89 | −0,63 | 0,467 |
| B. Con ≥1 partido (n = 226) | **HoopIQ** | **5,52** | **6,82** | +0,35 | **0,493** |
| | Media / último | 7,16 | 9,12 | −0,44 | 0,320 |

**Conclusión:** **el modelo supera a los baselines** en las dos jornadas, en los cuatro universos y en las tres métricas. En la J3 baja el MAE un 11 % y sube el Spearman en 0,09 sobre la media. La ventaja es mayor en la J2, cuando la media propia es un único partido, y eso concuerda con el backtest de 2025-26 que ya publica la web. **Dos matices:** el sesgo al alza es sistemático (+0,7 y +1,1), y en la J3 la mejora en el universo completo es pequeña (4,71 frente a 4,83). Con 2 jornadas, cualquier diferencia por debajo de ~0,3 de MAE es ruido.

### 4.3 Calibración (J2 + J3, 652 predicciones)

| Lo que dice la web | Predicho | Real |
|---|---|---|
| `playProb` de las **dudas** | 0,50 | **0,25** (14 de 57) |
| `playProb` sin parte, **nunca convocado** esta temporada | 0,57 | **0,05** (n = 64) |
| `playProb` sin parte, ≥1 partido | 0,97–1,00 | 0,92–0,95 |
| Bajas (`out`) | 0,00 | 0,02 (Hayes-Davis jugó: 19,8 pts) |
| Horquilla p25–p75, si juega (ideal 50 %) | 50 % | 41 % (un 31 % queda por debajo del suelo) |
| Por encima del p90, si juega (ideal 10 %) | 10 % | 11,9 % ✅ |
| `riseProb` en el tramo 0,2–0,4 / 0,4–0,6 | 0,30 / 0,50 | **0,13 / 0,36** |
| `expectedChange` (MAE frente a la variación real) | 0,194 | baseline "sin cambio": **0,181** |

Prueba indicativa, sobre los mismos datos y por tanto optimista: con duda = 0,25 y nunca convocado = 0,1, el MAE del universo A baja de 4,67 a 4,35 en la J2 y de 4,71 a 4,45 en la J3, y el sesgo de +1,10 a +0,80.

### 4.4 ¿Lo que se ve es lo que se calcula?

**Sí.** He reconstruido `efa build` en una copia aislada de `HEAD` y lo he comparado con los JSON commiteados: 0 diferencias en `players`, `details`, `teams`, `lineup` y `meta`, salvo las marcas de tiempo. La web lee esos JSON sin recalcular nada. La única transformación en el cliente es `data.ts:20`, que sustituye `price` por `pricePending`, y ahí entra el bug C1. Las proyecciones son para la J4 (`currentRound = 4`, rival y campo de la J4). No hay valores *hardcodeados*, salvo los coeficientes del modelo de precio, que se quedan fijos en los de la J1 por I2.

---

## 5. Hallazgos por gravedad

### 🔴 Crítico

**C1. El precio pendiente suma la variación acumulada de toda la temporada.**
- **Dónde:** `pipeline/efa/advanced_build.py:317` (`delta = plus.get(id)`), que consumen `web/src/lib/data.ts:20-27` y el óptimo (`build.py:992`). El test `pipeline/tests/test_prices.py:168` valida la suposición equivocada.
- **Evidencia:** `plus` coincide con `cotización_actual − cotización_inicial` en el 100 % de los snapshots tomados tras cada revalorización (26-09, 01-10 y 03-10). A mitad de jornada es esa cifra más la variación provisional. Coincide con la variación de la jornada solo en la J1, porque entonces acumulado y jornada son lo mismo, y de ahí la conclusión de la auditoría del 26-09. Simulando `pending_prices` con el estado real a mitad de jornada:

  | Ventana | MAE del pendiente frente al precio real | MAE sin ajustar | Error máximo | Ejemplo |
  |---|---|---|---|---|
  | J2 (30-09 23:07) | 0,182 | 0,184 | 1,0 | Motley 10,0 → pendiente 8,6, real 9,6 |
  | J3 (02-10 23:07) | **0,281** | 0,187 | **1,4** | C. Jones 15,0 → pendiente 16,3, real 14,9 |

- **Impacto:** cada jornada, desde el primer partido hasta la revalorización (la próxima vez del 7 al 10 de octubre), el óptimo, el presupuesto de Mi equipo, los pts/cr, el umbral y la "Δ última jornada" usan precios que pueden ir 1–1,5 cr desviados. Justo en los días en que el usuario decide fichajes.
- **Solución:** `pendiente = cotización_inicial + plus`, donde la cotización inicial es la primera de cada jugador en el histórico. Validado sobre los dos estados: **acierta 350 de 350 precios (MAE 0,00)**. No hace falta el modelo para quien juega después de la captura: `plus` ya lo incluye en cuanto termina su partido. El modelo solo queda para los partidos que aún no han terminado. Hay que corregir el test y añadir el caso de la J2 (§7).

### 🟠 Importante

**I1. La probabilidad de jugar está mal calibrada.**
- **Dónde:** `build.py:793` (`PLAY_PROB = {"doubt": 0.5, ...}`) y `build.py:399` (`(jugados+2)/(club+2)`).
- **Evidencia:** §4.3. Las dudas juegan el 25 % y los nunca convocados el 5 %, frente al 50 % y el 57 % que se les asigna. De los 100 jugadores que no jugaron cada jornada, la proyección media era de 2,4–2,5 pts.
- **Impacto:** la proyección sale inflada (es la mayor parte del sesgo de +0,7/+1,1), igual que el índice de chollo y la probabilidad de subir de los jugadores en duda. El óptimo puede fichar a una "duda" a la mitad de su valor.
- **Solución:** duda ≈ 0,25. Para quien no aparece en ningún boxscore estando su club en ≥1 partido, colchón asimétrico (por ejemplo `(0 + 0,2)/(club + 2)`). Recalibrar sola en cada jornada (ver plan de acción, punto 4).

**I2. El modelo de precio no se recalibra, la web dice lo contrario y la "revalorización esperada" no aporta.**
- **Dónde:** `advanced_build.py:174-198,424` y `advanced.py:519-535`. Los textos están en `web/src/app/jugador/[id]/page.tsx:278-279` ("Ajustado sobre 159 jugadores del último mercado") y `web/src/app/metodologia/page.tsx:341` ("se ajusta cada día").
- **Evidencia:** `fit_price_model` usa `plus` (acumulado) contra el precio **ya revalorizado**. El R² cae por debajo de 0,8 y vuelve en silencio a los coeficientes de la J1 (`meta.priceModel.source = "J1"`, n = 159). Por suerte, esos coeficientes **siguen siendo buenos**: con la FP real predicen la variación de la J2 y la J3 con un MAE de 0,010–0,012 cr (90 % exactas al décimo), y reajustando con las diferencias de cotización reales salen casi iguales (a = 0,0396, b = −0,0455, R² = 0,98). El problema es otro: con la FP *proyectada*, `expectedChange` tiene un MAE de 0,194 frente a 0,181 de predecir "sin cambio" (Spearman 0,17), y `riseProb` está sobreconfiada (§4.3).
- **Impacto:** la web enseña dos datos ("Revalor. esperada" en la tabla y "Prob. de subir" en el índice de chollo, con un 10 % de peso) con menos poder predictivo del que aparentan, y la explicación es falsa.
- **Solución:** (a) ajustar contra `Δcotización` entre el snapshot anterior a la jornada y el posterior a la revalorización; (b) calcular `riseProb` como mezcla: con probabilidad `1−p` no juega (−0,1), y con `p` una normal con la σ calibrada; (c) presentar la revalorización como "orientativa" o quitarla de la tabla; (d) corregir los dos textos.

**I3. El parte de lesiones funciona con 1 de 3 fuentes y nadie se entera.**
- **Dónde:** `.github/workflows/snapshot.yml:50` (`continue-on-error`, que solo falla si no responde **ninguna** fuente) e `ingest/injuries.py:356-367` (descarta, con razón, los partes de más de N horas).
- **Evidencia:** `basketnews.json` es del 26-09 y `basketballsphere.json` del 29-09. Solo entra RotoWire (39 filas, sin `updatedAt`, frente a las 84 de BasketNews). Desde mi máquina, las dos fuentes caídas responden 200: el bloqueo es contra los runners de GitHub. Hay una baja sin cruzar ("Mady Sissoko (BJK)"). *Corrección posterior: no falta ningún alias. Sissoko no está ni en el mercado ni en el censo oficial, así que no cruzar es lo correcto.*
- **Impacto:** menos cobertura de bajas y dudas en el óptimo y en las proyecciones. La metodología dice que se combinan tres partes.
- **Solución:** un `::warning` en el run por cada fuente con más de 48 h de antigüedad, y mostrar en la web la fecha de cada fuente. Si BasketNews sigue bloqueando, valorar el *workflow* desde otra IP (por ejemplo, un cron de Vercel) o quitarlo del texto.

**I4. Sesgo positivo y backtest publicado poco representativo.**
- **Dónde:** `projection.py:252` (solo predice a quien jugó) y `:282` (se descartan las filas sin todas las predicciones, es decir, a los que llegan nuevos), que alimentan el "314 partidos, 5,80 de error" de /metodología.
- **Evidencia:** si juega, el sesgo es de +1,5 (J2) y +2,5 (J3) en los jugadores de ≥12 cr, y la mediana es de +2,4 en los que llegan nuevos (n ≈ 60 por jornada: es una **señal que vigilar, no una conclusión**). El backtest publicado no incluye DNP ni recién llegados.
- **Impacto:** la sobreproyección de los caros afecta a la elección de capitán. La cifra publicada es más optimista que la experiencia real del usuario.
- **Solución:** publicar el backtest "tal y como se publicó" (§6, punto 4), con sesgo y por tramo de precio. Si a la J6 el sesgo en ≥12 cr se mantiene por encima de +1, subir el colchón de la tasa (100→150 min) o encoger el prior implícito por precio de los que llegan nuevos.

**I5. La ficha engaña con jugadores lesionados o con 1–2 partidos.**
- **Dónde:** `metrics.py:102` (`dnp_rate` solo cuenta los DNP que aparecen en el acta) y `web/src/app/jugador/[id]/page.tsx:470-476`.
- **Evidencia:** Williams-Goss, que se ha perdido la J2 y la J3, aparece con "Partidos sin jugar 0 %", "Suelo / techo 15,4 — 15,4" y "Desviación típica 0,0". Dunston: "Fiabilidad ≈0 %" y asistencias p97 con un solo partido.
- **Impacto:** el usuario no ve la señal de "se ha perdido partidos", que es justo la que sirve para decidir una venta.
- **Solución:** calcular `dnpRate` sobre los partidos **del club` (`1 − jugados/partidos_del_club`) y ocultar suelo, techo, σ y fiabilidad con menos de 3 partidos (con un "—" y "pocos datos"). Los percentiles de la cabecera **no se rediseñan** (decisión del rediseño de septiembre): basta con no calcularlos con menos de 2 partidos en el pipeline.

### 🟡 Mejora

| # | Hallazgo | Dónde | Evidencia | Solución |
|---|---|---|---|---|
| M1 | Mayúsculas mal en 12 nombres | `web/src/lib/format.ts:80-101` | "A.j. Lawson", "O'shae J Brissett", "Amath M'baye", "Miller-Mcintyre", "Mckinley Wright IV" | Poner en mayúscula también después de `.` y `'`, y tratar el prefijo `Mc` |
| M2 | DNP y 0 puntos no se distinguen en la UI | `web/src/app/mercado/page.tsx:32` (la sparkline recibe `fp` sin `played`) y `GameLogBars.tsx:36-44` (lista con menos de 3 partidos) | En la ficha de Dunston: "0,0 pts · J2 · 0,0 min". La sparkline normaliza cada jugador a su propio mínimo y máximo | Etiquetar "No jugó" y saltar los DNP en la sparkline, o marcarlos con un hueco |
| M3 | "Precios del 3 de octubre" cuando la última comprobación es del 5-10 | `meta.lastPriceCapture`, `layout.tsx:88` y `mercado/page.tsx:113` | Se muestra la fecha del último cambio | Añadir `lastPriceCheck` (hora del run) y escribir "Precios del 3-10 · comprobados el 5-10 07:16" |
| M4 | La "Δ última jornada" sale de snapshots consecutivos | `metrics.py:176` | A mitad de jornada se guardan snapshots con solo `fpt` cambiado, y la Δ pasa a 0 | Comparar las dos últimas cotizaciones **distintas**, o usar `plus − plus_previo` |
| M5 | Con una jornada a medias, "próximo partido" puede ser un partido ya jugado | `projection.py:315` y `build.py:850` | `next_fixtures` y `_apply_schedule` no filtran `played` | Usar el primer partido sin jugar de cada club |
| M6 | `/api/mi-equipo` es estática (ISR): `?matchday=` se ignora | `web/src/app/api/mi-equipo/route.ts:12,34` | El build la marca como `○ (Static) 10m` | `export const dynamic = "force-dynamic"`, o `fetch` con `revalidate` sin exportarlo en la ruta. Hoy no tiene impacto, porque no está configurada en Vercel |
| M7 | Textos de la metodología desfasados | `metodologia/page.tsx:111, 309, 341, 346` | "334 de 350" (solo vale para la J1), "pretemporada", "se ajusta cada día", "tres partes" | Reescribirlos cuando se arreglen C1, I2 e I3 |
| M8 | Horquilla p25–p75 estrecha | `advanced_build.py` (`Z_QUANTILES` de 2025-26) | Cobertura del 41 % en lugar del 50 % | Ensanchar la σ en las primeras jornadas, por la incertidumbre del propio prior |
| M9 | Código muerto | `metrics.py:467` (`FORM_WEIGHT_MAX = 0` anula la forma), `price_pressure` (se calcula y publica como `pricePressure`, pero no lo usa ni la UI ni el índice) | grep | Borrarlo, o dejarlo detrás de un *flag* documentado |
| M10 | Lógica duplicada | `_season_label` (`build.py:1135` y `advanced_build.py:114`); mapa de posiciones ×3 (`build.py:796`, `advanced_build.py:122`, `projection.py:run_backtests`) | El game log de 2025-26 se construye 4 veces por build | Un `efa/context.py` con los game logs y las posiciones cacheados. Hoy el build tarda 28 s, así que no corre prisa |
| M11 | HTML pesado | `/mercado` 748 KB (94 KB gz, 4.153 nodos); `/comparar` y `/mi-equipo` 360 KB para ~120–275 nodos | Medido en producción | Pasar a `/comparar` y `/mi-equipo` un índice ligero y cargar el jugador al elegirlo |
| M12 | Prórrogas sin contrastar | `scoring.py` / `matchmodel.py` | 0 prórrogas en J1–J3 | Añadir a `efa verify` la comprobación de entrenadores, que ya cuadran los 20 |

**Visualizaciones:** sin desbordamiento horizontal en móvil (375 px) en ninguna de las 10 páginas probadas, sin errores de consola y sin imágenes rotas. TTFB de ≈ 20 ms y `load` < 0,5 s en todas (Lighthouse no se ha ejecutado; las cifras son de la API de rendimiento del navegador sobre producción). La nube precio-proyección usa como referencia el umbral de revalorización, y responde bien a "¿quién va a subir?". Lo que **confunde**: las fichas con 1–2 partidos (I5) y "Los más fiables" con 3 partidos, que mide ruido y convendría esconder hasta la J5–J6. Lo que **sobra**: la columna "Revalor." (I2). Lo que **falta**: "minutos esperados" y "% de que juegue" como columnas ordenables (los datos ya están en `expectedMinutes` y `playProb`) y un aviso de los jugadores que llevan ≥2 jornadas sin convocar.

**Escalabilidad a 34+ jornadas:** se aguanta bien. `recent` está limitado a 12 partidos, el histórico de precios crece en ~4 snapshots por jornada (≈ 10 MB a final de temporada) y los boxscores van en un único gzip. Lo único que crece de forma lineal en el build es `load_snapshots()`, que lee todos los parquet, y aun así es trivial.

---

## 6. Plan de acción priorizado

| # | Acción | Arregla | Esfuerzo | Antes de |
|---|---|---|---|---|
| 1 | `pendiente = cotización_inicial + plus`; corregir el test; Δ de la última jornada con cotizaciones distintas | C1, M4 | 1–2 h | **7-10, 18:45 UTC** (primer partido de la J4) |
| 2 | `PLAY_PROB["doubt"] = 0.25` y colchón asimétrico para los nunca convocados | I1 | 1 h | J4 |
| 3 | Reajustar el modelo de precio con Δcotización real, `riseProb` como mezcla, revalorización "orientativa", textos | I2, M7 | ½ día | J5 |
| 4 | **Backtest "tal y como se publicó":** en cada build, guardar en `data/processed/predictions/R{n}.json` la última predicción antes del primer partido de la jornada; en `efa backtest`, comparar con lo real (MAE, sesgo, Spearman, calibración de `playProb` y `riseProb`) y publicarlo. Así I1, I2 e I4 se vigilan solos | I1, I2, I4 | ½ día | J5 |
| 5 | Aviso por fuente de lesiones caducada y fecha por fuente en la web | I3 | 1 h | J4 |
| 6 | Ficha: `dnpRate` sobre los partidos del club; ocultar σ, suelo, techo y fiabilidad con <3 partidos; DNP visibles | I5, M2 | 2–3 h | J5 |
| 7 | Nombres, "comprobado el…", próximo partido sin jugar, `/api/mi-equipo` dinámica | M1, M3, M5, M6 | 2 h | cuando sea |
| 8 | Limpieza: código muerto, `context.py` común, payload de `/comparar` y `/mi-equipo` | M9–M11 | 1 día | cuando sea |

No se propone cambiar la estructura del modelo v2: gana a los baselines, y lo que falla es la capa de disponibilidad y la de precio, que van alrededor.

---

## 7. Tests propuestos (casos verificados en esta auditoría)

```python
# pipeline/tests/test_scoring.py — actuaciones reales contrastadas con el Fantasy oficial
import pytest
from efa.scoring import player_fantasy_points

def _line(pts, reb, ast, stl, tov, blk, blka, fd, pf, fga, fgm, fta, ftm, secs=1500):
    return {"points": pts, "totalRebounds": reb, "assistances": ast, "steals": stl, "turnovers": tov,
            "blocksFavour": blk, "blocksAgainst": blka, "foulsReceived": fd, "foulsCommited": pf,
            "fieldGoalsAttemptedTotal": fga, "fieldGoalsMadeTotal": fgm,
            "freeThrowsAttempted": fta, "freeThrowsMade": ftm, "timePlayed": secs}

@pytest.mark.parametrize("stats, won, expected", [
    # Bryant J3 2026-27 (HTA gana): base 40 → 44,0
    (_line(22, 13, 7, 1, 1, 0, 0, 9, 1, 15, 7, 8, 6), True, 44.0),
    # Vezenkov J3 (OLY pierde): 23,0
    (_line(20, 6, 0, 1, 0, 0, 0, 2, 0, 13, 7, 4, 4), False, 23.0),
    # Núñez J3 (BAR gana, base −1): −0,9
    (_line(0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 148), True, -0.9),
    # Jeffries J1 (BES pierde): −3,0
    (_line(0, 0, 1, 0, 1, 1, 0, 0, 3, 1, 0, 0, 0, 327), False, -3.0),
])
def test_actuaciones_reales_2026(stats, won, expected):
    assert player_fantasy_points(stats, team_won=won).total == pytest.approx(expected)
```
*(Los intentos y aciertos de tiro de cada línea hay que copiarlos del boxscore. Aquí solo se garantiza el número de fallos: Bryant 8 TC y 2 TL, Vezenkov 6 TC, Jeffries 1 TC.)*

```python
# pipeline/tests/test_prices.py — `plus` es acumulado (caso real de la J3)
def test_precio_pendiente_usa_plus_acumulado():
    # C. Jones: salió a 13,6; tras la J2 vale 15,0 (plus = +1,4); a mitad de la J3 plus = +1,3
    # → al cerrar la J3 vale 13,6 + 1,3 = 14,9, NO 15,0 + 1,3 = 16,3.
    ...
    assert record["pricePending"] == 14.9

def test_probabilidad_de_duda_calibrada():
    from efa.build import PLAY_PROB
    assert PLAY_PROB["doubt"] <= 0.35   # observado: 14/57 en J2–J3
```

Y en `efa verify`: comprobar también los entrenadores (cuadran los 20) y las 11 medias por acción (hoy solo compara `fpt`).

## 8. Estado tras los arreglos (5 de octubre, tarde)

Aplicado en la rama `auditoria-j3-arreglos`, sin commitear. Se han validado así: **163 tests** (14 nuevos en `pipeline/tests/test_auditoria_j3.py`), `ruff` limpio, `tsc` limpio, `verify:squad` OK, `next build` OK, `efa verify` OK (las 11 acciones con diferencia 0,00 y los 20 entrenadores ≤ 0,03) y un recorrido en el navegador sobre el build local a 1440 px y 375 px, sin desbordamiento ni errores de consola.

| Hallazgo | Arreglo | Verificación |
|---|---|---|
| C1 precio pendiente | `pending_prices` usa `plus` actual − `plus` antes de la jornada (`round_plus_base`); el respaldo es el precio de salida | Simulado sobre los estados reales del 30-09 y el 02-10: **error 0,00 en 350/350** (antes 0,18 y 0,28, con un máximo de 1,4) |
| M4 Δ última | Entre las dos últimas cotizaciones **distintas** | Test |
| I1 prob. de jugar | Duda 0,25; nunca convocado con colchón 0,2 (`config.PLAY_PROB_REPORT`, `NEVER_DRESSED_PRIOR`, `build.play_share`) | Sobre lo publicado en J2/J3: MAE de 4,67→4,39 y de 4,71→4,42; sesgo de +0,69→+0,30 y de +1,10→+0,78. **Ojo:** los dos valores salen de esas mismas jornadas, así que es una mejora dentro de muestra. Se vigilará con el punto 4 |
| I2 modelo de precio | `round_price_frame`: Δcotización real por jornada cerrada, sin las filas que topan con el suelo; `source` indica las jornadas (hoy "J1–J3", 662 casos, R² 0,99) | El reajuste ya no vuelve en silencio a J1 |
| I2 prob. de subir / revalorización | Mezcla juega/no juega: `riseProb = p·P(FP ≥ umbral + 0,05/a)`, `expectedChange = p·Δ(si juega) + (1−p)·(−0,1)` | Fuera de muestra (J2 con el modelo de J1, J3 con el de J1–J2): Brier de 0,178→**0,161** (constante: 0,183); MAE de la variación de 0,194→**0,169**, que ya gana a "sin cambio" (0,181) |
| M8 horquilla | σ × √(1 + 2/(n + 2)) | Cobertura p25–p75 en J2–J3: 41 %→**51 %** |
| I4 / punto 4 | `efa/published.py`: cada build anterior al primer partido guarda `data/processed/predictions/RNN.json`; `efa backtest` lo evalúa (MAE, sesgo, Spearman, calibración de `playProb` y `riseProb`, cobertura, sesgo en ≥12 cr). R02 y R03 se han sembrado con lo que publicó la web (commits `6ae6957` y `1c8781f`); R04 ya está guardado. Tabla nueva en /metodología | Reproduce las cifras de §4 |
| I3 lesiones | Paso del workflow que avisa (`::warning`) de cada parte con más de 48 h; la metodología enseña qué parte está en uso y de cuándo | Se verá en el primer run tras el merge |
| I5 ficha | `dnpRate` sobre los partidos del club; suelo, techo y σ con "—" si hay menos de 3 partidos; sin percentil con menos de 2 partidos (la cabecera conserva su diseño) | Williams-Goss: "Partidos sin jugar 67 %" (antes 0 %) |
| M1 nombres | Mayúscula tras `.` y `'`, y en `Mc` | A.J. Lawson, O'Shae J Brissett, Amath M'Baye, McKinley Wright IV |
| M2 DNP | "No jugó" en la lista y en el tooltip; la sparkline del mercado omite los DNP | Dunston: "— No jugó · J2 · @ ZAL" |
| M3 frescura | `data/raw/prices/last_check.json` en cada captura que responde; `meta.lastPriceCheck`; "Precios del…, comprobados el…" | Se verá con el workflow (en local no hay token) |
| M5 próximo partido | `projection.next_games`: el primer partido **sin jugar**, también en `schedule` y en el calendario | Test |
| M6 `/api/mi-equipo` | `dynamic = "force-dynamic"`; la caché de 10 min se queda en la petición | El build la marca como `ƒ` |
| M7 metodología | Textos de precio pendiente, sin cruzar, modelo de precio, lesiones, prob. de jugar, umbral, horquilla y prob. de subir | Revisado en el navegador |
| M9 código muerto | Fuera `price_pressure`/`pricePressure` y la mezcla con la forma (`FORM_WEIGHT_MAX`) | Tests |
| M10 duplicados | `efa/context.py`: `season_label`, `player_positions` y los game logs y boxscores cacheados por temporada | Build idéntico en 28 s |
| M11 payload | `/comparar` lleva un índice ligero y pide las filas a `/comparar/datos` (JSON estático) al haber a quién comparar; `/mi-equipo` solo con los campos que pinta | /comparar de 360→**98 KB** (de 51→20 KB gz); /mi-equipo de 359→307 KB |
| M12 verify | Medias de las 11 acciones y de los entrenadores | `ok: true` |
| Extra | `matching.json` con un orden determinista (cambiaba entre máquinas) | — |

**Lo que se queda fuera, a propósito:**
- La fiabilidad estimada ("≈") con menos de 3 partidos se mantiene: fue una decisión anterior y sale de la σ encogida, no de 1–2 partidos sueltos.
- "Probable" sigue al 90 %: 7 casos no bastan para recalibrarlo.
- Las columnas nuevas (minutos esperados, % de jugar) y esconder "Los más fiables" eran sugerencias, no puntos del plan.
- El aviso de lesiones del workflow y la hora de comprobación de precios no se pueden probar en local: necesitan el run de Actions con el token.

---

### Reproducción
- Integridad y fuente web: feed de euroleaguebasketball.net en `https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/E2026/games/{n}/stats`, comparado con `load_boxscores("E2026")`.
- Fantasy oficial: `fpt` y las medias por acción de `data/raw/prices/prices_20261003_064217.csv`. Por jornada: snapshots `20260926_120404`, `20260930_230753` y `20261003_064217`.
- Backtest publicado: `git show 6ae6957:web/src/data/players.json` y `git show 1c8781f:web/src/data/players.json`, frente a `build_gamelog(...)` de la jornada siguiente.
- Bug C1: `pending_prices()` con el histórico cortado en `2026-09-30T23:10Z` y `2026-10-02T23:10Z`, frente a los snapshots `20261001_072101` y `20261003_064217`.
- Determinismo: `git archive HEAD` en un directorio aparte, `efa build` y diff de los JSON.
- Entorno: Python 3.13, venv aislado; tests `149 passed`, `ruff` limpio, `tsc` limpio, `verify:squad` OK y `next build` OK (386 páginas).
