import { defineConfig, devices } from "@playwright/test";

/** Pruebas en navegador sobre el build de producción (`next start`).
 *
 *  Hace falta haber corrido `npm run build` antes: en la CI el paso de build
 *  va justo delante, y aquí no se repite. Solo Chromium, para que quepa en
 *  menos de dos minutos. Sin comparación de capturas por píxel: los datos
 *  cambian a diario y darían falsos positivos. */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/metodologia`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
