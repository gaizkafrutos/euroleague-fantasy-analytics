/* Comprueba la lógica de plantilla de la web (src/lib/squad.ts) con los datos
 * reales del último snapshot:
 *
 *  1. El reparto de roles puntúa lo mismo que la mejor alineación por fuerza
 *     bruta (todas las formaciones, sextos y capitanes posibles).
 *  2. "Rellenar con el óptimo" a 100 créditos llega al óptimo exacto que
 *     resolvió el pipeline por programación entera (lineup.json).
 *  3. El plan de cambios nunca se sale de las reglas: presupuesto, 4-4-2,
 *     seis por club, como mucho los cambios pedidos, y lo que dice que gana
 *     es lo que gana.
 *
 * Uso: npm run verify:squad
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/squad.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = new Module("squad");
mod._compile(compiled, "squad.js");
const S = mod.exports;

const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "src/data", name), "utf8"));
const players = read("players.json").map((p) =>
  typeof p.pricePending === "number" && p.pricePending !== p.price ? { ...p, price: p.pricePending } : p,
);
const lineup = read("lineup.json");
const market = players.filter((p) => !p.isCoach && p.position && p.price > 0);
const coaches = players.filter((p) => p.isCoach && p.price > 0 && p.projectedFp != null);

let seed = 20260926;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sample = (list, k) => {
  const pool = [...list];
  const out = [];
  while (out.length < k && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
};
const byPos = Object.fromEntries(["G", "F", "C"].map((p) => [p, market.filter((x) => x.position === p)]));
const randomSquad = () => [...sample(byPos.G, 4), ...sample(byPos.F, 4), ...sample(byPos.C, 2)];

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`✗ ${message}`);
};

// 1. Roles frente a fuerza bruta.
const combos = (items, k) =>
  k === 0 ? [[]] : items.flatMap((x, i) => combos(items.slice(i + 1), k - 1).map((c) => [x, ...c]));
const E = S.effectiveProjection;
function brute(squad, coach) {
  let best = -Infinity;
  const idx = squad.map((_, i) => i);
  for (const five of combos(idx, 5)) {
    const pos = new Set(five.map((i) => squad[i].position));
    if (!(pos.has("G") && pos.has("F") && pos.has("C"))) continue;
    const rest = idx.filter((i) => !five.includes(i));
    for (const sixth of rest) {
      const bench = rest.filter((i) => i !== sixth);
      const score =
        five.reduce((a, i) => a + E(squad[i]), 0) +
        Math.max(...five.map((i) => E(squad[i]))) +
        E(squad[sixth]) +
        0.5 * bench.reduce((a, i) => a + E(squad[i]), 0) +
        E(coach);
      best = Math.max(best, score);
    }
  }
  return best;
}
for (let t = 0; t < 300; t += 1) {
  const squad = randomSquad();
  const coach = coaches[t % coaches.length];
  const got = S.scoredProjection(S.assignRoles(squad), coach);
  const want = brute(squad, coach);
  if (Math.abs(got - want) > 1e-6) fail(`roles: ${got.toFixed(2)} frente a ${want.toFixed(2)} por fuerza bruta`);
}
console.log("✓ roles = fuerza bruta en 300 plantillas");

// 2. Relleno automático frente al óptimo exacto del pipeline.
if (lineup.available && typeof lineup.scoredProjection === "number") {
  const built = S.buildSquad(market, lineup.budget ?? 100, coaches);
  const check = S.checkSquad(built.players, lineup.budget ?? 100, built.coach);
  const gap = lineup.scoredProjection - check.scored;
  if (!check.valid) fail(`relleno automático no válido: ${check.problems.join(" ")}`);
  if (gap > 1) fail(`relleno automático a ${gap.toFixed(2)} pts del óptimo exacto`);
  console.log(`✓ relleno automático ${check.scored.toFixed(2)} frente a ${lineup.scoredProjection.toFixed(2)} del óptimo`);
}

// 3. Plan de cambios: reglas y cuentas.
let slowest = 0;
for (let t = 0; t < 30; t += 1) {
  const squad = randomSquad();
  const clubs = {};
  for (const p of squad) clubs[p.club] = (clubs[p.club] ?? 0) + 1;
  if (Math.max(...Object.values(clubs)) > S.MAX_PER_CLUB) continue;
  const coach = coaches[t % coaches.length];
  const spent = squad.reduce((a, p) => a + p.price, 0) + coach.price;
  const budget = Math.max(100, Math.ceil(spent));
  const k = 1 + (t % 4);
  const start = Date.now();
  const plan = S.planTrades({ players: squad, coach }, market, coaches, budget, k);
  slowest = Math.max(slowest, Date.now() - start);
  const check = S.checkSquad(plan.players, budget, plan.coach);
  const changed =
    plan.players.filter((p, i) => p.id !== squad[i].id).length + (plan.coach.id !== coach.id ? 1 : 0);
  const gains = plan.steps.reduce((a, s) => a + s.gain, 0);
  if (!check.valid) fail(`plan no válido: ${check.problems.join(" ")}`);
  if (plan.used > k || changed !== plan.used) fail(`plan con ${changed} cambios (límite ${k})`);
  if (plan.after + 1e-6 < plan.before) fail("el plan empeora la plantilla");
  if (Math.abs(plan.before + gains - plan.after) > 0.05) fail("las ganancias de los pasos no suman el total");
}
console.log(`✓ plan de cambios dentro de las reglas (el más lento, ${slowest} ms)`);

if (failures) {
  console.error(`${failures} fallos`);
  process.exit(1);
}
