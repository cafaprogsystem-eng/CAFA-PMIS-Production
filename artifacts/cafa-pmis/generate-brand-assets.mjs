/**
 * Builds every raster CAFA brand asset from the SVGs in src/assets/brand/.
 * Run: node generate-brand-assets.mjs   (then node generate-splashes.mjs)
 *
 * The SVGs were traced from the official logo (attached_assets/CAFA Logo.pdf,
 * which only contains a 584×321 JPEG) with the exact brand colours:
 *   navy #2B2F90 · slate #455E86 · turquoise #00B0EB.
 * If a designer-made vector arrives, replace the SVGs and re-run this script.
 *
 * Output:
 *   public/brand/        transparent PNG + SVG copies of the logo and mark
 *   public/favicon.*     SVG, 16/32/48 PNG and a multi-size .ico
 *   public/icons/        PWA / apple-touch icons (opaque white, 10% padding)
 *                        and maskable icons (mark inside the 80% safe zone)
 */
import sharp from "sharp";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const BRAND = "src/assets/brand";
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
mkdirSync("public/brand", { recursive: true });
mkdirSync("public/icons", { recursive: true });

const svg = (name) => readFileSync(`${BRAND}/${name}.svg`);
const render = (name, width) => sharp(svg(name), { density: 600 }).resize({ width }).png();

/** The mark centred on a square canvas, `scale` of the side. */
async function square(name, size, scale, background) {
  const inner = Math.round(size * scale);
  const mark = await sharp(svg(name), { density: 600 }).resize(inner, inner, { fit: "contain", background: CLEAR }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }]).png({ compressionLevel: 9 }).toBuffer();
}

// Brand kit: transparent PNGs and the source SVGs.
for (const name of ["cafa-logo", "cafa-logo-white", "cafa-mark", "cafa-mark-white"]) {
  const width = name.startsWith("cafa-logo") ? 1200 : 512;
  await render(name, width).toFile(`public/brand/${name}.png`);
  await render(name, width * 2).toFile(`public/brand/${name}@2x.png`);
  copyFileSync(`${BRAND}/${name}.svg`, `public/brand/${name}.svg`);
}

// Favicons: transparent, the mark nearly edge to edge.
copyFileSync(`${BRAND}/cafa-mark.svg`, "public/favicon.svg");
const fav = {};
for (const size of [16, 32, 48]) fav[size] = await square("cafa-mark", size, 0.94, CLEAR);
writeFileSync("public/favicon-16.png", fav[16]);
writeFileSync("public/favicon-32.png", fav[32]);
writeFileSync("public/favicon.png", fav[48]);
// .ico with embedded PNG images (supported by every current browser).
{
  const images = [16, 32, 48].map((s) => ({ s, png: fav[s] }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ s, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  writeFileSync("public/favicon.ico", Buffer.concat([header, ...images.map((x) => x.png)]));
}

// PWA + apple-touch icons: opaque white (iOS paints transparency black).
for (const size of [72, 96, 128, 144, 152, 180, 192, 384, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, await square("cafa-mark", size, 0.8, WHITE));
}
// Maskable: launchers crop to a circle/squircle, so keep the mark in the safe zone.
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-maskable-${size}.png`, await square("cafa-mark", size, 0.6, WHITE));
}
// Scalable app icon: the mark on a white square.
{
  const mark = readFileSync(`${BRAND}/cafa-mark.svg`, "utf8");
  const vb = mark.match(/viewBox="([^"]+)"/)[1];
  const body = mark.replace(/^[\s\S]*?<\/title>/, "").replace(/<\/svg>\s*$/, "");
  writeFileSync("public/icons/icon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FFFFFF"/>` +
    `<svg x="51" y="51" width="410" height="410" viewBox="${vb}">${body}</svg></svg>\n`);
}
console.log("Brand assets written to public/brand, public/favicon.*, public/icons/");
