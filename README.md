# EuroLeague Fantasy Analytics

Herramienta de análisis del **EuroLeague Fantasy Challenge**: cruza los precios
en créditos del juego oficial con las estadísticas reales de la EuroLiga para
responder a la única pregunta que importa antes de fichar — *¿quién rinde más
de lo que cuesta?*

**[Ver la web](https://euroleague-fantasy-analytics.vercel.app)** ·
[Metodología](https://euroleague-fantasy-analytics.vercel.app/metodologia) ·
[Guía de uso](docs/USO.md)

---

## El problema

Estadísticas de baloncesto hay de sobra. Lo que no existe públicamente es la
otra mitad del cálculo: **el precio**. Sin precio no hay análisis de Fantasy,
porque 20 puntos a 18 créditos son un mal fichaje y 12 puntos a 5 créditos son
un chollo.

El Fantasy Challenge no publica API. Su frontend (una app Flutter) habla contra
`fantaking-api.dunkest.com`, donde la EuroLiga es la competición 49. Ese
endpoint, con un token de sesión propio, devuelve los 347 jugadores con su
cotización. Ese fue el bloqueante del proyecto y es lo que resuelve el pipeline.

El segundo hallazgo cambió el alcance: Fantaking **documenta su baremo de
puntuación**. Reimplementarlo sobre los boxscores oficiales permite reconstruir
los puntos fantasy de **cada partido por separado**, no solo la media que
devuelve el mercado. Y sin eso no se puede medir varianza, forma reciente ni
cambios de rol — que es justo donde está la ventaja.

## Qué hace

- **Explorador de mercado** — los ~350 jugadores con precio, proyección, valor
  por crédito, fiabilidad y dificultad de calendario. Ordenable por todo,
  filtrable por posición, equipo y presupuesto.
- **Nube precio-rendimiento** — con la recta de "precio justo del mercado":
  quien está por encima rinde más de lo que cuesta.
- **Ficha de jugador** — puntuación partido a partido con media y suelo,
  evolución del precio, rol en el equipo y próximos rivales.
- **Consola de equipo** — valida las reglas del juego mientras montas la
  plantilla, señala a quién le estás pagando de más y propone el mejor
  recambio que cabe en tu presupuesto. Funciona con tu equipo real (si
  configuras el token) o en modo manual para cualquiera.
- **Once óptimo** — la mejor plantilla posible con 100 créditos respetando
  4 bases / 4 aleros / 2 pívots y el máximo de 6 por club, resuelto por
  programación entera. Es el óptimo demostrable, no una aproximación.
- **Metodología abierta** — cada métrica explicada, con sus pesos y sus
  límites. Si una recomendación no se puede justificar, no sirve para decidir.

## Arquitectura

```
┌─────────────────────────┐   ┌──────────────────────────┐
│  api-live.euroleague.net│   │ fantaking-api.dunkest.com│
│  pública, sin auth      │   │ token personal           │
│  clubes · plantillas    │   │ precios en créditos      │
│  calendario · boxscores │   │ roster personal          │
└───────────┬─────────────┘   └────────────┬─────────────┘
            │                              │
            └──────────────┬───────────────┘
                           ▼
              ┌─────────────────────────┐
              │  pipeline (Python)      │
              │  cruce de identidades   │
              │  fórmula de puntuación  │
              │  métricas y optimizador │
              └───────────┬─────────────┘
                          ▼
              data/raw/**  (histórico versionado en git)
              web/src/data/*.json  (lo que consume la web)
                          ▼
              ┌─────────────────────────┐
              │  web (Next.js)          │
              │  JSON importado en build│
              │  sin backend, sin BD    │
              └─────────────────────────┘
```

El histórico de precios se **commitea al repositorio**. Para 350 jugadores por
38 jornadas el volumen es trivial, queda versionado y auditable, y evita una
base de datos gestionada que en el plan gratuito se pausa por inactividad.

## Puesta en marcha

```bash
git clone https://github.com/gaizkafrutos/euroleague-fantasy-analytics
cd euroleague-fantasy-analytics

# Pipeline
pip install -e ./pipeline
python -m efa ingest-official        # datos oficiales: no necesita token

# Sin token, para ver la web funcionando con precios de mentira:
python -m efa demo
python -m efa build

# Con token (ver docs/TOKEN.md):
export FANTAKING_TOKEN="1234567|..."
python -m efa demo --clear
python -m efa snapshot
python -m efa build

# Web
cd web && npm install && npm run dev
```

## Comandos

| Comando | Qué hace | ¿Token? |
|---|---|---|
| `efa ingest-official` | Clubes, plantillas, calendario y boxscores | no |
| `efa snapshot` | Captura el mercado de precios | **sí** |
| `efa roster` | Descarga tu equipo fantasy | **sí** |
| `efa discover` | Mapea qué endpoints de Fantaking responden | **sí** |
| `efa build` | Genera los JSON que consume la web | no |
| `efa verify` | Contrasta la fórmula con los datos del juego | no |
| `efa demo` | Precios de demostración para desarrollar sin token | no |
| `efa refresh` | `ingest` + `snapshot` + `build` de una vez | opcional |

## Decisiones de diseño

**Por qué se recalcula la puntuación en vez de usar la media del mercado.**
El endpoint solo da medias. Una media de 15 puede ser un jugador que hace 15
todas las semanas o uno que alterna 4 y 26 — y para un Fantasy con 4 fichajes
por jornada no son en absoluto lo mismo. Recalcular desde los boxscores da la
distribución completa.

**Por qué el cruce de identidades va en cascada y no con un solo fuzzy match.**
Atribuir las estadísticas de un jugador a otro no rompe nada: simplemente
miente, en silencio. La cascada va de más fiable a menos, registra con qué
método se emparejó cada jugador, y lo que no llega al umbral se deja sin cruzar
y se reporta en `data/processed/unmatched_players.csv`.

**Por qué el índice de chollo es una suma ponderada y no un modelo.**
Con un puñado de jornadas y 350 filas, un modelo no aprendería nada que no
capture una suma de percentiles — y no se podría explicar. Los pesos están a la
vista en `efa/metrics.py` y en la página de metodología, y se pueden discutir.

**Por qué se ingiere la temporada anterior.**
Hasta que la 2026-27 tenga jornadas, el rendimiento real de la 2025-26 es la
mejor referencia disponible. La web lo indica explícitamente en vez de
presentarlo como si fuera de la temporada en curso.

## Verificación

```bash
python -m pytest pipeline/tests -q   # fórmula, cruce de identidades, optimizador
python -m efa verify                 # contrasta contra los datos reales del juego
cd web && npm run typecheck && npm run build
```

`efa verify` compara la media calculada aquí con la columna `fpt` del propio
mercado de Fantaking. Si la correlación cae por debajo del umbral, es que el
baremo del juego ha cambiado — y conviene enterarse por ahí y no por un fichaje.

## Automatización

`.github/workflows/snapshot.yml` captura un snapshot cada mañana, regenera los
datos y los commitea; Vercel redespliega con el push. Si el token ha caducado,
avisa pero no rompe la cadena: las estadísticas oficiales se actualizan igual.

`.github/workflows/ci.yml` corre tests, lint, comprobación de tipos, build de la
web y un escaneo que falla si algo con forma de token entra en el repositorio.

## Aviso

Proyecto personal, sin ánimo comercial y sin relación con Euroleague Basketball
ni con Fantaking. Los [términos del
juego](https://fantaking.gitbook.io/euroleague-fantasy-challenge-rules) no
prohíben la automatización pero piden uso no comercial. El pipeline hace cuatro
peticiones por snapshot, una vez al día. Los nombres, escudos y fotos son
propiedad de sus titulares y se usan solo para identificar a jugadores y
equipos.

## Licencia

MIT — ver [LICENSE](LICENSE).
