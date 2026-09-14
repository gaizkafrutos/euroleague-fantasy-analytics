# Despliegue

La web es una app Next.js que lee ficheros JSON commiteados en el repositorio.
No hay backend que mantener, ni base de datos que se duerma en el plan
gratuito, ni servicio que tarde treinta segundos en despertar cuando alguien
abre el enlace desde LinkedIn. El commit del pipeline **es** el despliegue.

## Por qué Vercel

| | Vercel | Render / Fly (backend aparte) | GitHub Pages |
|---|---|---|---|
| Coste | gratis en Hobby | gratis con el servicio dormido | gratis |
| Arranque en frío | ninguno (estático + edge) | ~30 s la primera visita | ninguno |
| Rutas de API | sí, para `/api/mi-equipo` | sí | no |
| Deploy al hacer push | sí | sí | requiere Action |

La única parte que necesita servidor es `/api/mi-equipo`, que guarda el token.
Vercel la cubre sin infraestructura adicional; Pages no puede, y un backend
separado añade un servicio que se duerme justo cuando quieres enseñarlo.

## Primer despliegue

1. Sube el repositorio a GitHub.
2. Entra en <https://vercel.com>, **Add New → Project**, e importa el repo.
3. En la configuración del proyecto:
   - **Root Directory:** `web`
   - **Framework Preset:** Next.js (lo detecta solo)
   - Build command e install command: los que propone por defecto.
4. **Deploy**. En un par de minutos tienes la URL.

Todos los pushes a `main` despliegan automáticamente. Cada pull request genera
su propia URL de vista previa.

## Variables de entorno (opcional)

Solo si quieres que el módulo de equipo personal cargue tu roster real en el
despliegue público. **Settings → Environment Variables**:

| Variable | Valor |
|---|---|
| `FANTAKING_TOKEN` | tu token (ver [TOKEN.md](TOKEN.md)) |
| `EFA_FANTASY_TEAM_ID` | el id de tu equipo |
| `EFA_MATCHDAY_ID` | el id interno de jornada |

Sin ellas la web funciona igual: la consola de equipo se usa en modo manual.

## Dominio propio

En **Settings → Domains**. Un subdominio de un dominio que ya tengas queda
mejor en un perfil de LinkedIn que `algo-xyz123.vercel.app`, y no cuesta nada
si ya pagas el dominio.

## Qué pasa cada día

```
07:00 UTC  GitHub Action
           ├─ ingiere datos oficiales de la EuroLeague
           ├─ captura el mercado de Fantaking (4 peticiones)
           ├─ recalcula métricas y regenera web/src/data/*.json
           ├─ verifica la fórmula de puntuación
           └─ commit + push si algo ha cambiado
                └─ Vercel detecta el push y redespliega
```

Si el token ha caducado, el paso de precios avisa pero no rompe la cadena: el
resto se actualiza igual y la web sigue en pie con el último precio conocido.

## Comprobación después de desplegar

- La página principal carga y la tabla ordena al pinchar en una cabecera.
- `/metodologia` muestra el recuento del cruce de identidades.
- La ficha de un jugador dibuja el game log y el historial de precios.
- Si configuraste el token: en `/mi-equipo`, "Cargar mi equipo real" trae
  jugadores. Si no, "Rellenar con el óptimo" monta una plantilla válida.
