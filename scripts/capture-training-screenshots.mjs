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
 *
 * Usage:
 *   STAGING_BASE_URL=https://staging.pmis.cafa.systems \
 *   STAGING_DEMO_EMAIL=demo@cafa.org \
 *   STAGING_DEMO_PASSWORD=*** \
 *   node scripts/capture-training-screenshots.mjs [key1 key2 ...]
 *
 * With no keys given, captures every target in TARGETS. Output goes to
 * data/training-screenshots/<key>.png (override with SCREENSHOT_OUT_DIR),
 * the same directory video-generator.ts reads from.
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
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.fill("#identifier", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
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

async function main() {
  const baseUrl = (process.env.STAGING_BASE_URL || "https://staging.pmis.cafa.systems").replace(/\/$/, "");
  const email = process.env.STAGING_DEMO_EMAIL;
  const password = process.env.STAGING_DEMO_PASSWORD;
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
  if (targets.some((t) => t.auth) && (!email || !password)) {
    console.error("ERROR: STAGING_DEMO_EMAIL and STAGING_DEMO_PASSWORD are required for authenticated targets.");
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let authenticated = false;
  try {
    for (const target of targets) {
      if (target.auth && !authenticated) {
        console.log(`Logging in as the demo account…`);
        await login(page, baseUrl, email, password);
        authenticated = true;
      }
      console.log(`Capturing ${target.key} → ${baseUrl}${target.urlPath}`);
      await page.goto(`${baseUrl}${target.urlPath}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500); // let any post-load skeleton/animation settle
      await page.evaluate(BLUR_SCRIPT);
      const raw = await page.screenshot();
      const styled = await styleScreenshot(raw, target.style);
      await writeFile(path.join(outDir, `${target.key}.png`), styled);
    }
  } finally {
    await browser.close();
  }

  console.log(`Done. ${targets.length} screenshot(s) written to ${outDir}`);
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
