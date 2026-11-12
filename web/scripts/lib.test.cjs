/* Tests unitarios de la lógica de `src/lib` que no depende del navegador:
 * formato, etiquetas de jornada, códigos de club y escalas.
 *
 * Sin dependencias nuevas: el runner es el de Node (`node --test`) y los
 * módulos se compilan al vuelo con el TypeScript que ya tiene el proyecto,
 * igual que hace `verify-squad.cjs`.
 *
 * Uso: npm test
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const cache = new Map();

/** Carga un módulo de `src/` (TypeScript o JSON), resolviendo el alias `@/`. */
function load(request, from = path.join(root, "src", "lib")) {
  const base = request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : path.resolve(from, request);
  const file = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) return require(request);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file);
  cache.set(file, mod);
  if (file.endsWith(".json")) {
    mod.exports = JSON.parse(fs.readFileSync(file, "utf8"));
    return mod.exports;
  }
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  mod.require = (next) => load(next, path.dirname(file));
  mod._compile(compiled, file);
  return mod.exports;
}

const format = load("@/lib/format");
const projection = load("@/lib/projection");
const clubs = load("@/lib/clubs");
const advanced = load("@/lib/advanced");

/* ------------------------------------------------------------------ nombres */

test("el nombre se enseña con el de pila delante", () => {
  assert.equal(format.prettyName("VEZENKOV, SASHA"), "Sasha Vezenkov");
  assert.equal(format.prettyName("MILLER-MCINTYRE, CODI"), "Codi Miller-McIntyre");
  assert.equal(format.prettyName("BALDWIN IV, WADE"), "Wade Baldwin IV");
  assert.equal(format.prettyName("LAWSON, A.J."), "A.J. Lawson");
  assert.equal(format.prettyName(null), "—");
});

test("dos iniciales no son un nombre: TJ, RJ, KC", () => {
  assert.equal(format.prettyName("SHORTS, TJ"), "TJ Shorts");
  assert.equal(format.prettyName("COLE, RJ"), "RJ Cole");
  assert.equal(format.prettyName("JONES, KC"), "KC Jones");
});

test("pero un nombre de dos letras sigue siendo un nombre", () => {
  assert.equal(format.prettyName("KLINTMAN, BO"), "Bo Klintman");
  assert.equal(format.prettyName("BLAYZER, OZ"), "Oz Blayzer");
  assert.equal(format.prettyName("JEROME, TY"), "Ty Jerome");
});

test("sin nombre oficial se cae al del mercado", () => {
  assert.equal(format.displayName({ name: null, marketName: "T. Ennis" }), "T. Ennis");
});

/* ------------------------------------------------------------------ cifras */

test("las cifras van con coma y un decimal", () => {
  assert.equal(format.num(22.54), "22,5");
  assert.equal(format.num(22.54, 2), "22,54");
  assert.equal(format.num(147.44, 0), "147");
  assert.equal(format.num(null), "—");
  assert.equal(format.credits(16.7), "16,7 cr");
});

test("el signo va con lo que se enseña: nunca «−0,0»", () => {
  assert.equal(format.signed(0.26), "+0,3");
  assert.equal(format.signed(-1.24), "−1,2");
  assert.equal(format.signed(-0.04), "0,0");
  assert.equal(format.signed(0.04), "0,0");
  assert.equal(format.signed(-0.004, 2), "0,00");
  assert.equal(format.signed(-0.006, 2), "−0,01");
  assert.equal(format.signed(null), "—");
});

test("los porcentajes no llevan decimales salvo que se pidan", () => {
  assert.equal(format.percent(0.954), "95%");
  assert.equal(format.percent(0.1234, 1), "12,3%");
});

/* ------------------------------------------------------------------ fechas */

test("las horas son las de la península, no las del servidor", () => {
  // 00:50 UTC del 12 de noviembre es la 01:50 en Madrid (invierno).
  const winter = format.dateTime("2026-11-12T00:50:28Z");
  assert.match(winter, /12 de noviembre/);
  assert.match(winter, /01:50/);
  // En verano son dos horas, y un partido de las 22:30 UTC cae al día siguiente.
  const summer = format.dateTime("2026-06-30T22:30:00Z");
  assert.match(summer, /1 de julio/);
  assert.match(summer, /00:30/);
  assert.equal(format.dateShort("2026-06-30T22:30:00Z").replace(/\s+/g, " "), "1 jul");
  assert.equal(format.dateTime(null), "—");
  assert.equal(format.dateTime("no es una fecha"), "—");
});

/* ------------------------------------------------------------------ jornada */

const game = (extra) => ({
  date: "2026-11-13T19:30:00Z", turn: 3, turns: 3, opponent: "BAR", home: true,
  restDays: 8, doubleWeek: false, winProb: 0.7, expectedMargin: 6, ...extra,
});

test("el turno se dice solo si la jornada tiene varios días", () => {
  assert.equal(projection.turnLabel(game()), "T3");
  assert.equal(projection.turnLabel(game(), true), "turno 3");
  assert.equal(projection.turnLabel(game({ turn: 1, turns: 1 })), null);
  assert.equal(projection.turnLabel(null), null);
});

test("quien ya ha jugado la jornada lleva la de su próximo partido", () => {
  const ahead = game({ round: 12, ahead: true, turn: 1, turns: 2 });
  assert.equal(projection.turnLabel(ahead), "J12 · T1");
  assert.equal(projection.turnLabel(ahead, true), "jornada 12, turno 1");
  assert.equal(projection.turnLabel(game({ round: 12, ahead: true, turn: 1, turns: 1 })), "J12");
  // Datos anteriores al cambio, sin la marca: como antes.
  assert.equal(projection.turnLabel(game({ round: 11 })), "T3");
});

test("jornada en juego: se ha jugado algo y queda algo", () => {
  assert.deepEqual(projection.roundInPlay({ roundGames: 10, roundPlayed: 2 }), { played: 2, games: 10 });
  assert.equal(projection.roundInPlay({ roundGames: 10, roundPlayed: 0 }), null);
  assert.equal(projection.roundInPlay({ roundGames: 10, roundPlayed: 10 }), null);
  assert.equal(projection.roundInPlay({}), null);
  assert.equal(projection.roundInPlay(null), null);
});

test("el rival sale con el código que se lee, no con el de la API", () => {
  assert.equal(projection.fixtureLabel(game({ opponent: "ULK", home: false })), "@ FEN");
  assert.equal(projection.fixtureLabel(game({ opponent: "PAM" })), "vs VAL");
  assert.equal(projection.fixtureName(game({ opponent: "RED", home: false })), "@ Crvena Zvezda");
  assert.equal(projection.fixtureLabel(null), "—");
});

test("lo que ha hecho el óptimo publicado frente a lo que proyectaba", () => {
  const rounds = [
    { lineup: { projected: 150, real: 160 } },
    { lineup: { projected: 160, real: 120 } },
    { lineup: { projected: 152, real: 152 } },
    {},
  ];
  assert.deepEqual(projection.optimalTrack({ rounds }), { rounds: 3, projected: 154, real: 144 });
  // Con menos de tres jornadas no se saca una media.
  assert.equal(projection.optimalTrack({ rounds: rounds.slice(0, 2) }), null);
  assert.equal(projection.optimalTrack(null), null);
});

/* ------------------------------------------------------------------ clubes */

test("códigos y nombres de club", () => {
  assert.equal(clubs.clubAbbr("IST"), "EFE");
  assert.equal(clubs.clubAbbr("TEL"), "MTA");
  assert.equal(clubs.clubAbbr("BAR"), "BAR");
  assert.equal(clubs.clubName("MAD"), "Real Madrid");
  assert.equal(clubs.clubName("XXX"), "XXX");
  assert.equal(clubs.clubName(null), "—");
});

/* ------------------------------------------------------------------ escalas */

test("lo que concede un rival frente a la media, en cinco tramos", () => {
  assert.equal(advanced.sequentialClass(1.12), 5);
  assert.equal(advanced.sequentialClass(1.04), 4);
  assert.equal(advanced.sequentialClass(1.0), 3);
  assert.equal(advanced.sequentialClass(0.95), 2);
  assert.equal(advanced.sequentialClass(0.75), 1);
  assert.equal(advanced.sequentialClass(null), 3);
});

test("el umbral de revalorización sale del modelo de precio publicado", () => {
  const meta = load("@/data/meta.json");
  const model = meta.priceModel;
  const expected = (-model.c - model.b * 10) / model.a;
  assert.ok(Math.abs(advanced.breakEvenAt(10) - expected) < 1e-9);
  // Más caro, más puntos para mantener el precio.
  assert.ok(advanced.breakEvenAt(18) > advanced.breakEvenAt(6));
});
