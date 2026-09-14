# El token de Fantaking

El EuroLeague Fantasy Challenge no publica API ni emite claves. La única forma
de leer los precios es usar el mismo token que usa la app oficial cuando tú
estás dentro. Es **tu credencial personal**: equivale a tu contraseña. No la
pegues en un chat, en un issue ni en un commit.

---

## 1. Obtenerlo

1. Abre <https://euroleaguefantasy.euroleaguebasketball.net> en Chrome o Firefox
   y **inicia sesión**.
2. Abre las herramientas de desarrollador (`F12`, o `Ctrl+Shift+I`).
3. Ve a la pestaña **Network** (Red) y filtra por **Fetch/XHR**.
4. Recarga la página o entra en la sección de mercado. Verás peticiones a
   `fantaking-api.dunkest.com`.
5. Pincha en cualquiera de ellas → pestaña **Headers** → sección
   **Request Headers** → busca `Authorization`.
6. El valor es `Bearer 1234567|AbCdEf...`. **El token es todo lo que va después
   de `Bearer `**, incluida la barra vertical.

En esa misma pestaña, si entras en tu equipo, verás una llamada a
`/fantasy-teams/{team_id}/matchdays/{matchday_id}/roster`. Apunta esos dos
números: el primero es `EFA_FANTASY_TEAM_ID`, el segundo `EFA_MATCHDAY_ID`.

---

## 2. Usarlo en tu máquina

Nunca en el código. Siempre como variable de entorno.

**PowerShell (Windows):**

```powershell
$env:FANTAKING_TOKEN = "1234567|AbCdEf..."
$env:EFA_FANTASY_TEAM_ID = "2675670"
python -m efa snapshot
```

**bash / zsh:**

```bash
export FANTAKING_TOKEN="1234567|AbCdEf..."
export EFA_FANTASY_TEAM_ID="2675670"
python -m efa snapshot
```

También puedes copiar `.env.example` a `.env` y rellenarlo. `.env` está en
`.gitignore` y no se sube nunca.

---

## 3. Usarlo en GitHub Actions

1. En tu repositorio: **Settings → Secrets and variables → Actions**.
2. **New repository secret**.
3. Nombre `FANTAKING_TOKEN`, valor el token completo. Guardar.

El workflow `.github/workflows/snapshot.yml` lo lee de ahí. GitHub lo oculta en
los logs automáticamente.

---

## 4. Usarlo en Vercel

Solo hace falta si quieres que el módulo de "mi equipo" cargue tu roster real
en el despliegue público.

1. En el proyecto de Vercel: **Settings → Environment Variables**.
2. Añade `FANTAKING_TOKEN`, `EFA_FANTASY_TEAM_ID` y `EFA_MATCHDAY_ID`.
3. Márcalas para **Production** (y Preview si quieres).
4. Redespliega.

El token se queda en el servidor: la ruta `/api/mi-equipo` hace la llamada y
devuelve solo el resultado. El navegador nunca lo ve.

> Si prefieres no poner tu token en un despliegue público, no pasa nada: la
> consola de equipo funciona igual en modo manual para cualquier visitante.

---

## 5. Cuando caduque

No se sabe cuánto duran estos tokens. Cuando caduque lo notarás así:

- El workflow de GitHub Actions avisa con `Token caducado` pero **no falla**:
  sigue actualizando las estadísticas oficiales, solo se queda sin capturar
  precios ese día.
- En local, `python -m efa snapshot` sale con un `401` y un mensaje explícito.
- En la web, el módulo de equipo dice que el token ha caducado.

La solución es siempre la misma: repetir el paso 1 y **actualizar el secret**
en GitHub (y en Vercel si lo usas ahí). No hay que tocar código.

---

## 6. Si se te escapa el token a un sitio público

1. Cierra sesión en la app oficial y vuelve a entrar: eso invalida el token
   anterior (son tokens de sesión tipo Laravel Sanctum).
2. Cambia la contraseña de tu cuenta si tienes cualquier duda.
3. Genera uno nuevo y actualiza los secrets.

Borrar el commit no basta: si el repositorio es público, hay que asumir que
alguien lo ha visto.

---

## 7. Descubrir el `matchday_id` sin DevTools

```bash
python -m efa discover
```

Prueba con tu token una lista de rutas candidatas de la API y te dice cuáles
responden y qué devuelven. Es la forma de fijar el identificador de jornada sin
adivinarlo. Si ninguna sirve, el método del paso 1 siempre funciona.
