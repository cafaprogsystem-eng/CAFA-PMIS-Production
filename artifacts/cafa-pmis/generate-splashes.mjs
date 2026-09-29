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

// White launch screen with the full-colour logo (matches the manifest's
// background_color). The old navy background hid the navy logo.
const BG = { r: 255, g: 255, b: 255, alpha: 1 };
const LOGO = "src/assets/brand/cafa-logo.svg";

mkdirSync("public/splashes", { recursive: true });

for (const { name, width, height } of SIZES) {
  // Logo at half the screen width (capped for iPads), slightly above centre.
  const logoWidth = Math.min(Math.round(width * 0.5), 820);
  const logoBuf = await sharp(LOGO, { density: 600 }).resize({ width: logoWidth }).png().toBuffer();
  const { height: logoHeight } = await sharp(logoBuf).metadata();
  const logoX = Math.floor((width - logoWidth) / 2);
  const logoY = Math.floor((height - logoHeight) / 2) - Math.round(height * 0.03);

  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite([{ input: logoBuf, left: logoX, top: logoY }])
    .png({ compressionLevel: 9 })
    .toFile(`public/splashes/splash-${name}.png`);

  console.log(`✓  splash-${name}.png  (${width}×${height})`);
}

console.log("\nDone — 6 splash images in public/splashes/");
