import { defineConfig, devices } from "@playwright/test";

/**
 * Authenticated sidebar visual regression configuration.
 *
 * This is deliberately separate from the offline readiness project: visual
 * baselines must use a clean context and a routed, non-production fixture, but
 * must not depend on a service worker or on offline cache state.
 */
const baseURL = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const allowSnapshotUpdate = process.env.E2E_VISUAL_ALLOW_SNAPSHOT_UPDATE === "true";
const updateRequested = process.argv.some(
  (arg) => arg === "--update-snapshots"
    || arg.startsWith("--update-snapshots=")
    || arg === "-u"
    || arg.startsWith("-u="),
);

const missing = [
  !baseURL && "E2E_BASE_URL",
  !username && "E2E_USERNAME",
  !password && "E2E_PASSWORD",
  process.env.E2E_VISUAL_SAFE_FIXTURE !== "true" && "E2E_VISUAL_SAFE_FIXTURE=true",
].filter(Boolean) as string[];

if (missing.length > 0) {
  throw new Error(
    [
      "Sidebar visual tests require an explicitly approved non-production fixture.",
      `Missing: ${missing.join(", ")}.`,
      "Credentials are read from the environment only; never commit or print them.",
    ].join(" "),
  );
}

if (updateRequested && !allowSnapshotUpdate) {
  throw new Error(
    "Snapshot updates are blocked unless E2E_VISUAL_ALLOW_SNAPSHOT_UPDATE=true. " +
    "Use pnpm test:visual:sidebar:update only after reviewing an approved design change.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: /sidebar-visual\.spec\.ts/,
  timeout: 45_000,
  expect: {
    timeout: 12_000,
    // A small pixel ratio tolerates Chromium anti-aliasing while still
    // catching missing elements, spacing, alignment, and width changes.
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      threshold: 0.2,
      maxDiffPixelRatio: 0.005,
    },
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/sidebar-visual-artifacts",
  snapshotPathTemplate: "{testDir}/snapshots/sidebar/{arg}{ext}",
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/sidebar-visual-report", open: "never" }],
  ],
  use: {
    baseURL,
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    // A fresh context and blocked worker prevent an old PWA worker from
    // serving stale HTML/CSS/JS while the routed app remains the real app.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  projects: [
    {
      name: "sidebar-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
});