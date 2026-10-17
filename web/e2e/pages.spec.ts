import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import players from "../src/data/players.json";
import teams from "../src/data/teams.json";

/** Un equipo y un jugador de los datos del día: los ids cambian con las
 *  capturas, así que no se fijan a mano. */
const team = teams[0].code;
const player = players.find((row) => !row.isCoach && row.price)?.id ?? players[0].id;

const PAGES = [
  "/",
  "/mercado",
  "/mi-equipo",
  "/equipos",
  `/equipos/${team}`,
  `/jugador/${player}`,
  "/comparar",
  "/metodologia",
];

const VIEWPORTS = [
  { name: "móvil", width: 375, height: 812 },
  { name: "escritorio", width: 1280, height: 800 },
];

/** Errores de consola y excepciones sin capturar desde que se abre la página. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width} px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of PAGES) {
      test(`${path} carga limpia y es accesible`, async ({ page }, testInfo) => {
        const errors = watchErrors(page);
        const response = await page.goto(path);
        expect(response?.status(), "estado HTTP").toBe(200);
        // Tras la hidratación: los avisos de React salen en ese momento.
        await page.waitForLoadState("networkidle");

        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, "scroll horizontal").toBeLessThanOrEqual(overflow.client);

        const axe = await new AxeBuilder({ page }).analyze();
        const serious = axe.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map(
            (violation) =>
              `${violation.id} (${violation.impact}): ${violation.help} — ` +
              violation.nodes
                .slice(0, 3)
                .map((node) => `${node.target.join(" ")} (${node.any[0]?.message ?? "sin detalle"})`)
                .join(" | "),
          );
        expect(serious, "violaciones serias o críticas de axe").toEqual([]);

        expect(errors, "errores de consola").toEqual([]);

        // Material de revisión para el artefacto del job, no comparación.
        await page.screenshot({ path: testInfo.outputPath("pagina.png"), fullPage: true });
      });
    }
  });
}
