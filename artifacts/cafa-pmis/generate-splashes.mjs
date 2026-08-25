/**
 * Generates iOS/iPad apple-touch-startup-image splash screens.
 * Run once: node generate-splashes.mjs
 * Output:   public/splashes/splash-*.png
 *
 * Pixel dimensions are derived directly from the media queries in index.html:
 *   actual_px = css_px × device_pixel_ratio
 */
import sharp from "sharp";
import { mkdirSync } from "fs";

const SIZES = [
  // name                  | CSS w | CSS h | DPR | actual w | actual h
  { name: "iphone-15-pro-max", width: 1290, height: 2796 }, // 430×932 @3x
  { name: "iphone-15",         width: 1170, height: 2532 }, // 390×844 @3x
  { name: "iphone-13-mini",    width: 1125, height: 2436 }, // 375×812 @3x
  { name: "iphone-se",         width: 750,  height: 1334 }, // 375×667 @2x
  { name: "ipad-pro-12",       width: 2048, height: 2732 }, // 1024×1366 @2x
  { name: "ipad-air-11",       width: 1640, height: 2360 }, // 820×1180 @2x
];

const BG = { r: 26, g: 39, b: 68, alpha: 1 }; // #1a2744 — CAFA navy
const ICON_SIZE = 256;

mkdirSync("public/splashes", { recursive: true });

for (const { name, width, height } of SIZES) {
  const iconX = Math.floor((width  - ICON_SIZE) / 2);
  const iconY = Math.floor((height - ICON_SIZE) / 2) - 40; // slightly above center

  const iconBuf = await sharp("public/icons/icon-512.png")
    .resize(ICON_SIZE, ICON_SIZE)
    .toBuffer();

  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite([{ input: iconBuf, left: iconX, top: iconY }])
    .png({ compressionLevel: 9 })
    .toFile(`public/splashes/splash-${name}.png`);

  console.log(`✓  splash-${name}.png  (${width}×${height})`);
}

console.log("\nDone — 6 splash images in public/splashes/");
