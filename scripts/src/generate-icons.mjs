/**
 * Generate all PWA icon sizes from the CAFA logo.
 * Usage: node scripts/src/generate-icons.mjs
 */
import { Jimp } from "jimp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "../..");
const LOGO_PATH = resolve(ROOT, "artifacts/cafa-pmis/src/assets/cafa-logo.png");
const OUT_DIR = resolve(ROOT, "artifacts/cafa-pmis/public/icons");

const SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const BG_COLOR = 0x1a2744ff; // CAFA navy
const PADDING_PCT = 0.18;    // 18% padding on each side

async function main() {
  console.log("Reading CAFA logo from:", LOGO_PATH);
  const logo = await Jimp.read(LOGO_PATH);
  console.log(`Logo: ${logo.width}x${logo.height}`);

  for (const size of SIZES) {
    // Create solid navy background
    const bg = new Jimp({ width: size, height: size, color: BG_COLOR });

    // Scale logo to fit with padding (keep aspect ratio)
    const paddedSize = Math.floor(size * (1 - PADDING_PCT * 2));
    const clone = logo.clone();

    // Resize proportionally (limit by the smaller dimension)
    const aspect = clone.width / clone.height;
    let logoW, logoH;
    if (aspect >= 1) {
      logoW = paddedSize;
      logoH = Math.round(paddedSize / aspect);
    } else {
      logoH = paddedSize;
      logoW = Math.round(paddedSize * aspect);
    }
    clone.resize({ w: logoW, h: logoH });

    // Centre on background
    const x = Math.floor((size - clone.width) / 2);
    const y = Math.floor((size - clone.height) / 2);

    bg.composite(clone, x, y);

    const outPath = resolve(OUT_DIR, `icon-${size}.png`);
    await bg.write(outPath);
    console.log(`  ✓ icon-${size}.png  (${size}x${size})`);
  }

  console.log("\nAll icons generated.");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
