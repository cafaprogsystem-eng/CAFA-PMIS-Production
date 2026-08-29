import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "dashboard-performance-truthfulness.spec.ts",
    "hq-snapshot-browser-access.spec.ts",
  ],
  timeout: 45_000,
  expect: { timeout: 12_000 },
  forbidOnly: true,
  retries: 0,
  outputDir: "test-results/dashboard-truthfulness-artifacts",
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});