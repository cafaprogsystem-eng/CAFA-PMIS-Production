import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { assertSafeLandingCaptureHost } from "./landing-capture-safety.js";

const baseURL = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const fixtureAcknowledged = process.env.E2E_VISUAL_SAFE_FIXTURE === "true";
const fixtureConfirmation = process.env.E2E_LANDING_SAFE_FIXTURE_CONFIRMATION;
const allowedHosts = process.env.E2E_LANDING_ALLOWED_HOSTS;
const allowReplacement = process.env.E2E_LANDING_ALLOW_REPLACEMENT === "true";
const replaceApproved = process.argv.includes("--replace-approved-assets");
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const artifactRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const assetRoot = join(artifactRoot, "src", "assets");
const outputRoot = replaceApproved
  ? assetRoot
  : join(artifactRoot, "test-results", "landing-captures");

type Capture = {
  asset: string;
  route: string;
  description: string;
  readyText?: RegExp;
};

const captures: Capture[] = [
  {
    asset: "landing-dashboard.webp",
    route: "/dashboard",
    description: "Strategic dashboard overview",
    readyText: /programme dashboard/i,
  },
  {
    asset: "landing-projects.webp",
    route: "/projects",
    description: "Projects workspace",
    readyText: /^projects$/i,
  },
  {
    asset: "landing-plans.webp",
    route: "/plans",
    description: "Plans workspace",
    readyText: /^plans$/i,
  },
  {
    asset: "landing-ai.webp",
    route: "/ai",
    description: "AI assistant workspace",
    readyText: /CAFA AI Assistant is ready for configuration|AI Assistant/i,
  },
];

function fail(message: string): never {
  throw new Error(`Landing screenshot capture blocked: ${message}`);
}

function requireSafeConfiguration(): void {
  if (!baseURL || !username || !password) {
    fail("E2E_BASE_URL, E2E_USERNAME, and E2E_PASSWORD are required.");
  }
  if (!fixtureAcknowledged) {
    fail("set E2E_VISUAL_SAFE_FIXTURE=true to acknowledge the isolated fixture.");
  }
  if (fixtureConfirmation !== "CAFA-PMIS-NONPROD-SYNTHETIC") {
    fail("set E2E_LANDING_SAFE_FIXTURE_CONFIRMATION=CAFA-PMIS-NONPROD-SYNTHETIC.");
  }
  try {
    assertSafeLandingCaptureHost(baseURL, allowedHosts);
  } catch (error) {
    fail(error instanceof Error ? error.message : "invalid E2E_BASE_URL.");
  }
  if (replaceApproved && !allowReplacement) {
    fail("approved assets require --replace-approved-assets and E2E_LANDING_ALLOW_REPLACEMENT=true.");
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#identifier").fill(username!);
  await page.locator("#password").fill(password!);
  await page.locator('form[aria-label] button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
    );
  });
}

async function capturePage(page: Page, capture: Capture): Promise<void> {
  try {
    await page.goto(capture.route, { waitUntil: "domcontentloaded" });
  } catch (error) {
    // Some client-side route redirects abort the initial document navigation.
    // The canonical pathname and settled-state checks below still have to pass.
    if (!(error instanceof Error) || !error.message.includes("net::ERR_ABORTED")) {
      throw error;
    }
  }
  await page.waitForURL((url) => url.pathname === capture.route);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    fail(`normal sign-in was not retained before ${capture.route}.`);
  }
  await page.locator("aside").waitFor({ state: "visible" });
  await page.locator("main h1").waitFor({ state: "visible" });
  if (capture.readyText) {
    await page.getByText(capture.readyText).first().waitFor({ state: "visible" });
  }
  await page.waitForFunction(
    () => !document.querySelector("[aria-busy='true'], [data-loading='true'], .animate-pulse"),
  );
  await settle(page);
  const png = await page.screenshot({ animations: "disabled", caret: "hide", fullPage: false });
  const destination = join(outputRoot, capture.asset);
  await sharp(png).webp({ quality: 88, effort: 6 }).toFile(destination);
}

async function main(): Promise<void> {
  requireSafeConfiguration();
  await mkdir(outputRoot, { recursive: true });

  const browser: Browser = await chromium.launch({
    headless: true,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await signIn(page);
  for (const capture of captures) await capturePage(page, capture);

  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: artifactRoot,
    encoding: "utf8",
  }).trim();
  const assets = await Promise.all(captures.map(async (capture) => {
    const metadata = await sharp(join(outputRoot, capture.asset)).metadata();
    if (!metadata.width || !metadata.height) {
      fail(`could not read dimensions for ${capture.asset}.`);
    }
    return {
      asset: capture.asset,
      route: capture.route,
      viewport: "1440x810@2x",
      outputDimensions: `${metadata.width}x${metadata.height}`,
      description: capture.description,
    };
  }));
  const provenance = {
    status: replaceApproved ? "approved-baseline" : "candidate",
    sourceRevision,
    captureDate: new Date().toISOString().slice(0, 10),
    fixtureConfirmation: `Authorised non-production synthetic fixture (${fixtureConfirmation})`,
    assets,
    refreshCommand: "pnpm capture:landing -- --replace-approved-assets",
  };
  await writeFile(
    join(outputRoot, "landing-screenshots.provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
  await context.close();
  await browser.close();

  if (!replaceApproved) {
    console.log(`Candidate captures written to ${outputRoot}. Review them, then rerun with explicit replacement.`);
  } else {
    console.log("Approved landing captures replaced after explicit safety checks.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Landing screenshot capture failed.");
  process.exitCode = 1;
});