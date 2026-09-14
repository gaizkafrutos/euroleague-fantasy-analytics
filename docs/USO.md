# Uso diario

Guía práctica: cómo se usa esto cada jornada, qué se mantiene solo, y qué hacer
cuando algo pide tu intervención.

---

## 1. Acceder

**<https://euroleague-fantasy-analytics.vercel.app>**

No hay que instalar nada ni iniciar sesión. Funciona en el móvil igual que en el
ordenador. Guárdalo en favoritos o añádelo a la pantalla de inicio del teléfono:
la vas a abrir el día antes de cada jornada, y ahí es donde más cómodo resulta.

No hace falta encender el ordenador, ni tener el proyecto abierto, ni ejecutar
nada. La web es estática: los datos ya están dentro cuando se despliega.

---

## 2. La rutina de cada jornada

El orden en que conviene mirarla, que no es el orden en que aparece:

**Primero, tu equipo.** Ve a **Mi equipo** y monta tu plantilla actual. Mira
"Lo que menos te renta": ahí sale a quién le estás pagando de más en relación a
lo que proyecta. Es el punto de partida de cualquier fichaje, porque tienes
cuatro cambios por jornada y conviene gastarlos donde más duele.

**Segundo, los recambios.** En la misma página, "Fichajes que caben" ya calcula
el mejor sustituto por puesto dentro de lo que te queda de presupuesto más lo
que recuperas al vender. No tienes que buscarlos tú.

**Tercero, el mercado.** En **Mercado**, ordena por "Índice" para ver los
chollos del momento, o cambia a la vista **Nube**: todo lo que quede por encima
de la diagonal rinde más de lo que cuesta.

**Cuarto, el detalle.** Antes de cerrar un fichaje, entra en su ficha. Dos cosas
que la media no te cuenta y ahí sí se ven: la gráfica de barras (si alterna
30 y 4, es una lotería aunque promedie bien) y la tendencia de minutos (si está
perdiendo rol, la media de las últimas semanas ya no vale).

**Y el calendario.** En **Equipos** está la dificultad de los tres próximos
rivales de cada club. Importa más de lo que parece: el bonus de victoria suma un
10% a la puntuación de todos los jugadores del equipo que gana.

---

## 3. Lo que se mantiene solo

Cada mañana a las 07:00 UTC (09:00 en Madrid en horario de verano) GitHub
Actions ejecuta por su cuenta:

1. Reingiere los datos oficiales de la EuroLiga: censo, calendario y los
   boxscores de los partidos nuevos.
2. Captura el mercado de precios (4 peticiones).
3. Recalcula todas las métricas y regenera los datos de la web.
4. Contrasta la fórmula de puntuación con los datos reales del juego.
5. Commitea los cambios, y Vercel redespliega con el push.

Tú no tienes que hacer nada. La web amanece actualizada.

Si quieres comprobar que corrió bien, en el repo: pestaña **Actions** →
workflow **Captura de datos**. Verde es que todo fue bien.

Si necesitas una captura fuera de horario (por ejemplo, justo después de que
cierre una jornada): **Actions** → **Captura de datos** → **Run workflow**.
Puedes ponerle una etiqueta, como `R03`, para que el snapshot quede identificado
en el histórico.

---

## 4. Cuando caduque el token

Es lo único que se va a romper cada cierto tiempo. Los tokens de Fantaking son
de sesión y no se sabe cuánto duran.

**Cómo te enteras:**

- El workflow diario sale con un aviso amarillo `Token caducado`. **No falla**:
  sigue actualizando las estadísticas oficiales y la web se mantiene en pie con
  el último precio conocido.
- Si lo ejecutas en local, `python -m efa snapshot` corta con un `401` y un
  mensaje explícito.

**Cómo lo arreglas** (cinco minutos, sin tocar código):

1. Abre <https://euroleaguefantasy.euroleaguebasketball.net> y entra con tu
   cuenta.
2. `F12` → pestaña **Network** → filtro **Fetch/XHR** → recarga con `F5`.
3. Pincha en cualquier petición a `fantaking-api.dunkest.com`.
4. **Headers** → **Request Headers** → línea `authorization`. El token es todo
   lo que va después de `Bearer `.
5. En GitHub: **Settings** → **Secrets and variables** → **Actions** → en
   `FANTAKING_TOKEN` pulsa el lápiz → pega el nuevo → **Update secret**.
6. Si lo tienes también en Vercel, actualízalo allí y redespliega.

Ya está. La siguiente ejecución diaria vuelve a capturar precios.

> El token es tu credencial personal, equivalente a tu contraseña. No lo pegues
> en un chat, en un issue, en un commit ni en una captura de pantalla. Si se te
> escapa: cierra sesión en la app y vuelve a entrar, lo que invalida el
> anterior. Detalle completo en [TOKEN.md](TOKEN.md).

---

## 5. Compartirlo con alguien

**Le mandas el enlace y ya.** Nada más:

```
https://euroleague-fantasy-analytics.vercel.app
```

No necesita cuenta, ni instalar nada, ni tu token, ni permisos.

**Qué ve tu amigo:** exactamente lo mismo que tú. El explorador de mercado
completo, las fichas de jugador, los equipos y la metodología. Y en **Mi
equipo** puede montar su propia plantilla y recibir el mismo análisis —
validación de reglas, a quién le paga de más, qué recambios le caben. Eso se
guarda en el navegador de cada uno, así que su plantilla no toca la tuya ni al
revés.

**Qué no ve:** tu token, y — mientras no configures las variables en Vercel —
tampoco tu equipo real.

> Si algún día pones `FANTAKING_TOKEN` en Vercel para que el botón "Cargar mi
> equipo real" funcione en la web pública, ten presente que **cualquiera que
> abra el enlace verá tu plantilla**, no la suya. Es una decisión consciente:
> enseñar tu equipo como ejemplo real tiene su gracia en un portfolio, pero
> conviene saber que es eso lo que estás publicando.

Si lo enseñas a alguien que valora el trabajo técnico, mándale también el repo
y dile que mire la página de **Metodología**. Ahí está lo que diferencia esto de
un dashboard cualquiera: cada métrica explicada, con sus pesos y sus límites.

---

## 6. Comandos, para cuando quieras tocar algo en local

Siempre con el entorno virtual activado:

```powershell
cd $HOME\PycharmProjects\euroleague-fantasy-analytics
.\.venv\Scripts\Activate.ps1
```

Si el prompt no empieza por `(.venv)`, los comandos `efa` no existen.

| Para | Comando |
|---|---|
| Actualizar estadísticas oficiales | `python -m efa ingest-official` |
| Capturar precios ahora | `$env:FANTAKING_TOKEN="..."` y `python -m efa snapshot` |
| Regenerar los datos de la web | `python -m efa build` |
| Todo seguido | `python -m efa refresh` |
| Comprobar la fórmula de puntuación | `python -m efa verify` |
| Ver la web en local | `cd web` y `npm run dev` |
| Pasar los tests | `python -m pytest pipeline\tests -q` |

Después de cualquier cambio en local, para que llegue a la web:

```powershell
git add .
git commit -m "lo que hayas hecho"
git push
```

Vercel redespliega solo con el push.

---

## 7. Si algo se ve raro

**Un jugador sale sin estadísticas, solo con precio.** Todavía no está en el
censo oficial de la EuroLiga. Es normal en pretemporada y se resuelve solo
cuando su club lo inscriba. La lista está en
`data/processed/unmatched_players.csv`.

**Un jugador tiene las estadísticas de otro.** Esto sí es un error y conviene
corregirlo: añade una fila a `data/overrides/player_overrides.csv` con su
`fantaking_id` y el `person_code` correcto, y vuelve a ejecutar
`python -m efa build`. La corrección manual gana sobre cualquier
emparejamiento automático.

**Los precios llevan días sin cambiar.** Mira la pestaña Actions. Lo más
probable es que el token haya caducado (sección 4).

**La web no refleja un cambio que acabas de empujar.** Mira el despliegue en
Vercel: si está en rojo, el build ha fallado y el enlace sigue sirviendo la
versión anterior. Eso es bueno — nunca se queda a medias.

**Números que no te cuadran.** Antes de dudar del cálculo, mira la
[metodología](https://euroleague-fantasy-analytics.vercel.app/metodologia).
Hay dos cosas que sorprenden y son correctas: las medias excluyen los partidos
sin jugar (un cero por no estar convocado hundiría la media y mentiría sobre el
jugador), y la "presión de precio" es una aproximación razonada, no la fórmula
real de Fantaking, que no es pública.
