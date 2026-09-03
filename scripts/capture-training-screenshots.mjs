#!/usr/bin/env node
/**
 * One-off tooling script — NOT part of the live api-server, and never
 * imported by it. Captures real screenshots of the running CAFA PMIS app
 * (staging by default) for the training-video pipeline, so
 * video-generator.ts can composite an actual product screen instead of the
 * hand-drawn `mockup` panels in full-system-video-script.ts.
 *
 * Prerequisites (do these first, they are NOT automated by this script):
 *   1. Seed the target database with clearly-labeled demo data — run
 *      scripts/seed.mjs against it. Only capture from an instance you know
 *      holds no real staff/beneficiary data; TARGETS below is deliberately
 *      limited to top-level pages that need no click-through, so what shows
 *      up is exactly what the seeded demo account sees.
 *   2. Create a dedicated demo user on that instance (do not reuse a real
 *      staff account) and export its credentials as env vars — never as
 *      command-line arguments (they would land in shell history).
 *   3. One-time browser install if this machine has never run Playwright:
 *        npx playwright install chromium
 *      If that download hangs or fails specifically on
 *      "chromium_headless_shell" (a separate binary Playwright fetches only
 *      for headless mode), set HEADLESS=false below to run the full Chromium
 *      build instead — no separate download needed if `npx playwright
 *      install chromium` (without "--only-shell") already succeeded.
 *      HEADLESS=false opens a real, visible browser window, so it needs an
 *      actual display (your own machine, or an X server / Xvfb on a
 *      headless box) — it will not work inside a plain container with no
 *      display at all.
 *
 * Usage:
 *   STAGING_BASE_URL=https://staging.pmis.cafa.systems \
 *   STAGING_DEMO_EMAIL=demo@cafa.org \
 *   STAGING_DEMO_PASSWORD=*** \
 *   [HEADLESS=false] \
 *   node scripts/capture-training-screenshots.mjs [key1 key2 ...]
 *
 * With no keys given, captures every target in TARGETS. Each screenshot is
 * both written to data/training-screenshots/<key>.png (override with
 * SCREENSHOT_OUT_DIR — harmless, but not load-bearing when this runs as a
 * one-off ECS task, since that local disk never reaches the running app)
 * AND uploaded to POST /api/training-videos/screenshots/:key on the target
 * itself, authenticated with the same session login() established — that
 * route stores it in the app's own S3 bucket, which is what
 * video-generator.ts's resolveScreenshotPath() actually reads from. Set
 * SKIP_UPLOAD=true to skip the upload (e.g. previewing a screenshot locally
 * with no server changes intended).
 *
 * Defense-in-depth: every page is scanned for visible email-looking text and
 * blurred before the screenshot is taken, regardless of which account or
 * dataset is in use — see applyDefensiveBlur() below.
 *
 * Coverage note: only screens reachable by a direct URL with no further
 * click-through are listed in TARGETS. Slides whose real screen requires
 * opening a modal or dropdown (the beneficiary breakdown modal, the new
 * project/plan/report forms, the user-avatar menu, a token-bound
 * reset-password link, etc.) still render their original hand-drawn mockup
 * — converting those needs someone to click through the live app and note
 * the exact selectors first; see full-system-video-script.ts for which
 * slides still carry a `mockup` with no `screenshotKey`.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Every wait in this script (navigation, fill, click, screenshot…) is bounded
// by this — Playwright's own per-action defaults are also set to this value
// below, but this wrapper is a second, explicit guarantee: no step can ever
// hang silently. A step that exceeds it fails fast with a labeled error
// instead of leaving the script looking frozen with no output.
const STEP_TIMEOUT_MS = 30_000;

function withTimeout(promise, label, ms = STEP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const TARGETS = [
  { key: "login", urlPath: "/login", auth: false, style: "card" },
  { key: "forgot-password", urlPath: "/forgot-password", auth: false, style: "card" },
  { key: "dashboard", urlPath: "/dashboard", auth: true, style: "full" },
  { key: "projects-list", urlPath: "/projects", auth: true, style: "full" },
  { key: "reports-landing", urlPath: "/reports", auth: true, style: "full" },
  { key: "risk-heatmap", urlPath: "/risks", auth: true, style: "full" },
  { key: "budget-overview", urlPath: "/budget", auth: true, style: "full" },
  { key: "notifications", urlPath: "/notifications", auth: true, style: "full" },
  { key: "manual", urlPath: "/manual", auth: true, style: "full" },
  { key: "audit-log", urlPath: "/audit-log", auth: true, style: "full" },
  { key: "users", urlPath: "/users", auth: true, style: "full" },
  { key: "states", urlPath: "/states", auth: true, style: "full" },
];

// Blurs any element whose visible text looks like an email address, on
// whatever page is currently loaded — a broad, content-based net rather than
// a per-page list of column selectors, so it still catches something the
// TARGETS list above didn't anticipate.
const BLUR_SCRIPT = `
(function () {
  var EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/;
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var hits = new Set();
  var node;
  while ((node = walker.nextNode())) {
    if (EMAIL_RE.test(node.nodeValue || "")) {
      var el = node.parentElement;
      if (el) hits.add(el);
    }
  }
  hits.forEach(function (el) {
    el.style.filter = "blur(6px)";
    el.style.userSelect = "none";
  });
})();
`;

async function login(page, baseUrl, email, password) {
  console.log("  Navigating to /login…");
  // "networkidle" never fires on an authenticated app that polls in the
  // background (this one polls notifications every 30s) — "domcontentloaded"
  // is what actually matters for a login form to be fillable.
  await withTimeout(page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" }), "navigate to /login");

  console.log("  Filling in demo credentials…");
  await withTimeout(page.fill("#identifier", email), "fill #identifier");
  await withTimeout(page.fill("#password", password), "fill #password");

  console.log("  Submitting the login form…");
  await withTimeout(page.click('button[type="submit"]'), "click submit");

  console.log("  Waiting for the post-login redirect…");
  await withTimeout(
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: STEP_TIMEOUT_MS }),
    "post-login redirect away from /login",
  );
  console.log(`  Logged in — redirected to ${new URL(page.url()).pathname}.`);
}

// "card": rounded corners + a soft drop shadow, sized for the narrow panel
// region video-generator.ts overlays it into (same region the login mockup
// used to occupy). "full": no styling — the wide, full-page screens are
// meant to fill the frame edge-to-edge, not float as a card.
async function styleScreenshot(buffer, style) {
  if (style !== "card") return sharp(buffer).png().toBuffer();

  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 1000;
  const h = meta.height ?? 1000;
  const radius = 14;
  const pad = 28;

  const roundedMask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  const rounded = await sharp(buffer)
    .composite([{ input: roundedMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const shadow = Buffer.from(
    `<svg width="${w + pad * 2}" height="${h + pad * 2}">
       <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter></defs>
       <rect x="${pad - 2}" y="${pad + 6}" width="${w + 4}" height="${h + 4}" rx="${radius}" ry="${radius}" fill="#000" opacity="0.35" filter="url(#b)"/>
     </svg>`,
  );

  return sharp({
    create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: shadow, top: 0, left: 0 },
      { input: rounded, top: pad, left: pad },
    ])
    .png()
    .toBuffer();
}

// context.request shares cookies with the browser context — the same
// session login() established authenticates this upload too, no separate
// credential handling needed.
async function uploadScreenshot(context, baseUrl, key, buffer) {
  const response = await withTimeout(
    context.request.post(`${baseUrl}/api/training-videos/screenshots/${key}`, {
      data: buffer,
      headers: { "Content-Type": "image/png" },
    }),
    `upload ${key} to the server`,
  );
  if (!response.ok()) {
    throw new Error(`Upload rejected with ${response.status()} ${response.statusText()}: ${await response.text()}`);
  }
}

async function main() {
  console.log("Starting training-screenshot capture…");
  const baseUrl = (process.env.STAGING_BASE_URL || "https://staging.pmis.cafa.systems").replace(/\/$/, "");
  const email = process.env.STAGING_DEMO_EMAIL;
  const password = process.env.STAGING_DEMO_PASSWORD;
  // Default headless (normal case). Set HEADLESS=false to run the full,
  // visible Chromium build instead — avoids depending on the separate
  // "chromium-headless-shell" binary Playwright otherwise fetches for
  // headless mode, useful when that particular download is unreliable.
  const headless = process.env.HEADLESS !== "false";
  const outDir = process.env.SCREENSHOT_OUT_DIR
    ? path.resolve(process.env.SCREENSHOT_OUT_DIR)
    : path.join(REPO_ROOT, "data", "training-screenshots");

  const requestedKeys = process.argv.slice(2);
  const targets = requestedKeys.length ? TARGETS.filter((t) => requestedKeys.includes(t.key)) : TARGETS;

  const unknown = requestedKeys.filter((k) => !TARGETS.some((t) => t.key === k));
  if (unknown.length) {
    console.error(`Unknown screenshot key(s): ${unknown.join(", ")}`);
    console.error(`Known keys: ${TARGETS.map((t) => t.key).join(", ")}`);
    process.exit(1);
  }
  const skipUpload = process.env.SKIP_UPLOAD === "true";
  // Uploading needs an authenticated admin session regardless of whether the
  // *page itself* requires login (e.g. /login is public) — so credentials
  // are required whenever an upload will actually be attempted, and
  // separately whenever any requested target needs auth just to view it.
  const needsAuth = !skipUpload || targets.some((t) => t.auth);
  if (needsAuth && (!email || !password)) {
    console.error("ERROR: STAGING_DEMO_EMAIL and STAGING_DEMO_PASSWORD are required (uploading needs an authenticated session). Set SKIP_UPLOAD=true and request only auth:false targets to skip this entirely.");
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });

  console.log(`Target: ${baseUrl}`);
  console.log(`Output: ${outDir}`);
  console.log(`Targets queued (${targets.length}): ${targets.map((t) => t.key).join(", ")}`);
  console.log(
    `Launching Chromium in ${headless ? "headless" : "headed (visible window)"} mode ` +
    `(each step below is capped at ${STEP_TIMEOUT_MS / 1000}s)…`,
  );
  const browser = await withTimeout(chromium.launch({ headless }), "launch chromium", STEP_TIMEOUT_MS);
  console.log("Browser launched.");

  const context = await withTimeout(
    browser.newContext({ viewport: { width: 1440, height: 900 } }),
    "create browser context",
  );
  // Blanket safety net on top of withTimeout() above: any Playwright action
  // on this context/page that isn't explicitly wrapped still can't hang past
  // this either.
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(STEP_TIMEOUT_MS);
  const page = await withTimeout(context.newPage(), "open new page");
  console.log("Browser context and page ready.");

  let uploadFailures = 0;
  try {
    // Logged in once, up front, regardless of which targets need auth just
    // to *view* them — uploading needs an authenticated admin session for
    // every target, including the public ones (/login itself doesn't
    // redirect an already-authenticated visitor away, so capturing it after
    // logging in is safe).
    if (email && password) {
      console.log("Logging in as the demo account…");
      await login(page, baseUrl, email, password);
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const progress = `[${i + 1}/${targets.length}]`;

      console.log(`${progress} Capturing '${target.key}' → ${baseUrl}${target.urlPath}`);
      await withTimeout(
        page.goto(`${baseUrl}${target.urlPath}`, { waitUntil: "domcontentloaded" }),
        `navigate to ${target.urlPath}`,
      );
      console.log(`${progress}   Page loaded, letting it settle…`);
      await withTimeout(page.waitForTimeout(500), `settle delay for ${target.key}`); // post-load skeleton/animation
      console.log(`${progress}   Scanning for and blurring sensitive text…`);
      await withTimeout(page.evaluate(BLUR_SCRIPT), `blur scan for ${target.key}`);
      console.log(`${progress}   Taking screenshot…`);
      const raw = await withTimeout(page.screenshot(), `screenshot for ${target.key}`);
      const styled = await styleScreenshot(raw, target.style);
      const outPath = path.join(outDir, `${target.key}.png`);
      await writeFile(outPath, styled);
      console.log(`${progress} Saved ${target.key}.png (${styled.length} bytes) → ${outPath}`);

      if (!skipUpload) {
        console.log(`${progress}   Uploading to the server…`);
        try {
          await uploadScreenshot(context, baseUrl, target.key, styled);
          console.log(`${progress}   Uploaded.`);
        } catch (err) {
          uploadFailures += 1;
          console.error(`${progress}   Upload FAILED: ${err.message}`);
        }
      }
    }
  } finally {
    console.log("Closing browser…");
    await browser.close();
  }

  console.log(`Done. ${targets.length} screenshot(s) written to ${outDir}`);
  if (!skipUpload) {
    console.log(`${targets.length - uploadFailures}/${targets.length} uploaded successfully.`);
    if (uploadFailures > 0) {
      console.error(`${uploadFailures} upload(s) failed — see above.`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
