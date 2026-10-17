import { expect, test, type Locator } from "@playwright/test";

/** "99,8" o "1.234,5" → número. */
function parseEs(text: string) {
  return Number(text.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
}

/** La cifra principal de una de las tarjetas de la consola (`<dt>` + `<dd>`). */
function figure(root: Locator, label: string) {
  return root
    .locator("dl.cancha-figures > div")
    .filter({ has: root.page().locator("dt", { hasText: label }) })
    .locator("dd")
    .first();
}

/** "Gastado" se lee "99,8/100": lo gastado y el presupuesto. */
async function spending(root: Locator) {
  const [spent, budget] = (await figure(root, "Gastado").innerText()).split("/");
  return { spent: parseEs(spent), budget: parseEs(budget) };
}

test("mi equipo: rellenar con el óptimo y vaciar", async ({ page }) => {
  await page.goto("/mi-equipo");
  const consola = page.locator(".cancha");
  const fichas = consola.locator(".tok:not(.is-empty)");

  await page.getByRole("button", { name: "Rellenar con el óptimo" }).click();
  await expect(fichas).toHaveCount(11);

  const { spent, budget } = await spending(consola);
  expect(spent).toBeGreaterThan(0);
  expect(spent).toBeLessThanOrEqual(budget);

  await expect(page.getByRole("heading", { name: "Horquilla de la jornada" })).toBeVisible();
  expect(parseEs(await figure(consola, "Proyección real").innerText())).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Vaciar" }).click();
  await expect(fichas).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Horquilla de la jornada" })).toHaveCount(0);
  expect((await spending(consola)).spent).toBe(0);
});

test("mercado: de la tabla a la nube y vuelta", async ({ page }) => {
  await page.goto("/mercado");
  const tabla = page.getByRole("button", { name: "Tabla", exact: true });
  const nube = page.getByRole("button", { name: "Nube", exact: true });
  const region = page.getByRole("region", { name: "Tabla del mercado" });
  const grafico = page.getByText("Precio contra rendimiento esperado");

  await expect(tabla).toHaveAttribute("aria-pressed", "true");
  await expect(region).toBeVisible();

  await nube.click();
  await expect(nube).toHaveAttribute("aria-pressed", "true");
  await expect(grafico).toBeVisible();
  await expect(region).toHaveCount(0);
  await expect(page).toHaveURL(/vista=grafico/);

  await tabla.click();
  await expect(tabla).toHaveAttribute("aria-pressed", "true");
  await expect(region).toBeVisible();
  await expect(grafico).toHaveCount(0);
});

/* Con la plantilla vacía no aparece "En caja", y en un iPhone de 390 px ese
   campo llegó a ensanchar la página 31 px: se podía arrastrar de lado y se
   quedaba descuadrada. Se mira con la plantilla llena en los anchos de móvil
   más comunes. */
for (const width of [375, 390, 430]) {
  test(`mi equipo con la plantilla llena no se sale de ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/mi-equipo");
    await page.getByRole("button", { name: "Rellenar con el óptimo" }).click();
    await expect(page.locator(".cancha .tok:not(.is-empty)")).toHaveCount(11);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, "scroll horizontal").toBeLessThanOrEqual(overflow.client);
  });
}
