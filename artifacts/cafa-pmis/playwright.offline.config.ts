import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks deliberately target an already-routed CAFA environment.
 *
 * The web artifact and API artifact share an origin through the artifact
 * router in real deployments. Running Vite preview alone cannot reproduce
 * that topology, so CI must set E2E_BASE_URL to a deployed/staging URL (or a
 * routed preview URL) rather than spinning up an unrelated static server.
 */
const baseURL = process.env.E2E_BASE_URL;
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const productionCertification = process.env.E2E_CERTIFY_PRODUCTION === "true";

if (productionCertification) {
  const missing = [
    !baseURL && "E2E_BASE_URL",
    !process.env.E2E_USERNAME && "E2E_USERNAME",
    !process.env.E2E_PASSWORD && "E2E_PASSWORD",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Production offline certification requires: ${missing.join(", ")}`);
  }
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/offline-browser-artifacts",
  reporter: [["list"], ["html", { outputFolder: "test-results/offline-browser-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // System Chromium is sufficient for screenshots and traces. Keeping video
    // off avoids depending on Playwright's separately downloaded FFmpeg.
    video: "off",
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    // A fixed compact viewport verifies the supported responsive layout while
    // remaining compatible with the routed preview used in this workspace.
    { name: "mobile-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});