#!/usr/bin/env node
/**
 * Generates CAFA PMS app icons at all required PWA sizes.
 * Pure Node.js — no external dependencies required.
 * Run: node scripts/generate-icons.mjs
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const deflate = promisify(zlib.deflate);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../public/icons");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const NAVY  = [26, 39, 68];    // #1a2744
const WHITE = [255, 255, 255];
const BLUE  = [76, 159, 232];  // #4c9fe8 accent

/* ── PNG encoder ───────────────────────────────────────────────────────── */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcB]);
}

async function writePNG(size, pixels, outPath) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dst = y * (size * 4 + 1) + 1 + x * 4;
      const src = (y * size + x) * 4;
      raw[dst] = pixels[src]; raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2]; raw[dst+3] = pixels[src+3];
    }
  }
  const compressed = await deflate(raw, { level: 6 });
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(outPath, png);
}

/* ── Icon renderer ─────────────────────────────────────────────────────── */
function setPixel(pixels, size, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
}

function fillRect(pixels, size, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * size + x) * 4;
      if (i >= 0 && i < pixels.length && pixels[i+3] > 0)
        setPixel(pixels, size, x, y, color);
    }
}

function drawCircle(pixels, size, cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) setPixel(pixels, size, x, y, color);
    }
  }
}

async function generateIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const rr = Math.round(size * 0.18); // rounded-corner radius

  // Background: rounded square
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, rr - x, x - (size - 1 - rr));
      const dy = Math.max(0, rr - y, y - (size - 1 - rr));
      if (dx * dx + dy * dy <= rr * rr)
        setPixel(pixels, size, x, y, NAVY);
    }
  }

  const p = (v) => Math.round(size * v); // percent helper

  // Left vertical bar — the "C" stem
  fillRect(pixels, size, p(0.26), p(0.34), p(0.075), p(0.32), WHITE);

  // Three horizontal bars (data rows)
  const bh = Math.max(2, p(0.055));
  fillRect(pixels, size, p(0.26), p(0.34),            p(0.50), bh, WHITE);
  fillRect(pixels, size, p(0.26), p(0.34) + p(0.135), p(0.38), bh, WHITE);
  fillRect(pixels, size, p(0.26), p(0.34) + p(0.265), p(0.45), bh, WHITE);

  // Blue accent dot
  drawCircle(pixels, size, p(0.82), p(0.76), Math.max(3, p(0.065)), BLUE);

  const outPath = path.join(OUT_DIR, `icon-${size}.png`);
  await writePNG(size, pixels, outPath);
  console.log(`  ✓  icon-${size}.png`);
}

console.log("Generating CAFA PMS icons…");
for (const size of SIZES) await generateIcon(size);
console.log("Done.");
