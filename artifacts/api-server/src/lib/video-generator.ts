import { exec as execCb, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { pool } from "@workspace/db";
import {
  FULL_SYSTEM_SCRIPT,
  FULL_VIDEO_TITLE,
  FULL_VIDEO_MODULE,
  type FullSlide,
  type MockupElement,
} from "./full-system-video-script";
import { s3Client, s3Bucket } from "./objectStorage";
import { GetObjectCommand } from "@aws-sdk/client-s3";

const exec = promisify(execCb);

const FONT_EN   = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";
const DATA_DIR  = "/home/runner/workspace/data/training-videos";
const SCREENSHOTS_DIR = "/home/runner/workspace/data/training-screenshots";
// Shared with routes/training-videos.ts's upload route — kept here (not
// there) so that file doesn't need to import from this one, which already
// imports generateModuleVideo from here and would otherwise be circular.
export const TRAINING_SCREENSHOT_S3_PREFIX = "training-screenshots";
const TMP_BASE  = "/tmp/cafa-videos";

// Sampled directly from the real CAFA wordmark (cafa-logo.png) — no gold.
// video-assets/bg-graded.png is the pre-rendered graded background using
// these same three colors (generated once with sharp; sharp is NOT a
// runtime dependency of this file or the production image).
const BG_ASSET     = path.resolve(__dirname, "video-assets/bg-graded.png");
const C_NAVY       = "0x2B2F90";
const C_NAVY_LIGHT = "0x455E86"; // the wordmark's own slate-blue — secondary chrome (badges, dividers)
const C_INK        = "0x10133A";
const C_CYAN       = "0x00B0EB";
const C_CYAN_LIGHT = "0x5CD6F7"; // foreground accent text on dark — wordmark, badge numbers
const C_CYAN_SOFT  = "0xBFEAF8"; // pale tint for pill/chip backgrounds under dark navy text
const C_TEXT_SOFT  = "0xAEC0DE"; // muted labels (tag lines, timestamps) — never pure white
// Karla (the design proposal's body/narration face) was previously burned
// into the frame via libass for captions — captions are now a WebVTT
// sidecar instead (see generateVTTCaptions()), so this render path no
// longer touches Karla at all; a future player would load it as a web font
// on its own, the same as any other frontend typeface.

// Two clips crossfade into each other over this many seconds instead of a
// hard cut (replaces the old concat-demuxer hard cuts).
const XFADE_SEC = 0.4;
// Each bullet line fades/slides in this many seconds after the previous one.
const BULLET_STAGGER_SEC = 0.13;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }

async function setProgress(id: number, pct: number, label: string) {
  await pool.query(
    `UPDATE training_videos SET progress_pct=$1, progress_label=$2, updated_at=NOW() WHERE id=$3`,
    [pct, label, id],
  );
}

// Escapes a display-text string for embedding inside a drawtext text='...'
// value. A literal apostrophe is deliberately replaced with the typographic
// right single quotation mark (U+2019) rather than backslash-escaped: an
// escaped apostrophe (\') parses fine on its own, but truncated bullet text
// (see the 55-char slice below) can leave a single, unmatched apostrophe in
// the string, and empirically — reproduced locally with a real ffmpeg build
// — a lone escaped apostrophe followed by more chained filters desyncs
// ffmpeg's own quote-tracking across the rest of the filter chain ("No
// option name near ..."). Swapping it for U+2019 sidesteps ffmpeg's
// quoting rules entirely instead of trying to match them exactly, and reads
// better on screen than a straight apostrophe regardless.
export function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// Same escaping a filter *expression* (not literal text) needs when it's
// embedded as one option inside a comma-separated filter chain — arithmetic
// expressions here use commas inside if(a,b,c), which must not be read as
// the filter-chain's own separator.
function escExpr(s: string): string {
  return s.replace(/,/g, "\\,");
}

async function getDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    );
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

// Fade-in + small left-to-right slide for a bullet line, staggered by
// BULLET_STAGGER_SEC per index — matches the agreed design's per-line
// cascade instead of every bullet appearing at frame 0. Returns the raw
// (un-escaped) expressions — escExpr() is applied once, at the point each
// gets embedded into a filter string (see bulletFilters()), so a caller can
// still wrap the raw alpha expression in another if(...) first (a
// highlight band's own hide-after-readWindow cutoff) without double-escaping.
function bulletStagger(index: number, baseX: number): { alpha: string; x: string } {
  const delay = index * BULLET_STAGGER_SEC;
  const rampEnd = delay + 0.3;
  const alphaExpr = `if(lt(t,${delay}),0,if(lt(t,${rampEnd}),(t-${delay})/0.3,1))`;
  const xExpr = `${baseX}+if(lt(t,${delay}),20,if(lt(t,${rampEnd}),20*(1-(t-${delay})/0.3),0))`;
  return { alpha: alphaExpr, x: xExpr };
}

// Safe max character count for a truncated bullet line, given the actual
// pixel width available to its right — a screenshot/mockup panel starts at a
// fixed x, or (with no panel) the bullet has the whole frame width. The
// per-character estimate is deliberately generous (real DejaVu Sans Bold
// glyphs average a bit narrower) so truncation always leaves real margin
// instead of a string that just barely fits.
function maxBulletChars(availableWidthPx: number, fontSize: number): number {
  const avgCharWidth = fontSize * 0.62;
  return Math.max(20, Math.floor(availableWidthPx / avgCharWidth));
}

// One bullet line as two filters — a small cyan ring-mark and the white body
// text — instead of a plain "• text" in one color, matching the agreed
// design's colored bullet marker. Both share the same stagger timing so they
// fade/slide in together. hideAfterSec, when given, wraps the (still raw)
// alpha expression in one more if(...) so the bullet forces back to
// invisible from that time on — folded into the SAME alpha channel that
// already, provenly, controls this text's visibility, rather than a second,
// independent gating mechanism (e.g. drawtext's own `enable` timeline
// option) layered on top of it.
function bulletFilters(text: string, baseX: number, y: number, fontSize: number, index: number, hideAfterSec?: number): string[] {
  const textX = baseX + Math.round(fontSize * 0.85);
  const mark = bulletStagger(index, baseX);
  const body = bulletStagger(index, textX);
  const markSize = Math.max(10, Math.round(fontSize * 0.42));
  const finalAlpha = (raw: string) =>
    escExpr(hideAfterSec !== undefined ? `if(lt(t,${hideAfterSec}),${raw},0)` : raw);
  return [
    `drawtext=text='●':fontfile='${FONT_EN}':x='${escExpr(mark.x)}':y=${y + Math.round(fontSize * 0.28)}:fontcolor=${C_CYAN}:fontsize=${markSize}:alpha='${finalAlpha(mark.alpha)}'`,
    `drawtext=text='${esc(text)}':fontfile='${FONT_EN}':x='${escExpr(body.x)}':y=${y}:fontcolor=white:fontsize=${fontSize}:alpha='${finalAlpha(body.alpha)}'`,
  ];
}

// ---------------------------------------------------------------------------
// HTTP fetch helper
// ---------------------------------------------------------------------------

function fetchBuffer(url: string, timeout = 15000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
        "Referer": "https://translate.google.com/",
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ---------------------------------------------------------------------------
// TTS — Google Translate (English, chunked at 190 chars)
// ---------------------------------------------------------------------------

function chunkText(text: string, max = 190): string[] {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > max) { if (cur) chunks.push(cur); cur = w; }
    else cur = candidate;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// The English TTS engine reads a bare all-caps "CAFA" letter-by-letter, like
// an acronym, instead of as one word — spelling it "Kafa" (still whole-word
// matched, so it can't clip a word like "CAFAlon") makes it read naturally
// as a name. On-screen text (titles, bullets, subtitles) is untouched — this
// only transforms what's sent to the TTS endpoint, never what's displayed.
export function ttsSafeText(text: string): string {
  return text.replace(/\bCAFA\b/g, "Kafa");
}

// Throws (rather than silently falling back to silent audio) on any TTS
// failure — a video with no NAT-gateway egress once "succeeded" with every
// slide silently narration-less, and nothing in its status ever said so. A
// clip missing its narration now fails the whole generation loudly instead,
// through the same try/catch generateModuleVideo() already uses for every
// other failure (status='failed', error_message set).
async function fetchTTS(text: string, tmpDir: string, name: string): Promise<string> {
  const chunks = chunkText(ttsSafeText(text));
  const chunkFiles: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const enc = encodeURIComponent(chunks[i]);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${enc}&tl=en&client=tw-ob&ttsspeed=0.82`;
    let buf: Buffer;
    try {
      buf = await fetchBuffer(url, 12000);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`TTS request failed for "${name}" (chunk ${i + 1}/${chunks.length}): ${reason}`);
    }
    if (buf.length < 100) throw new Error(`TTS returned an empty response for "${name}" (chunk ${i + 1}/${chunks.length})`);
    const cp = path.join(tmpDir, `${name}_chunk_${i}.mp3`);
    await fs.writeFile(cp, buf);
    chunkFiles.push(cp);
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 380));
  }
  const outPath = path.join(tmpDir, `${name}.mp3`);
  if (chunkFiles.length === 1) { await fs.rename(chunkFiles[0], outPath); return outPath; }
  const listPath = path.join(tmpDir, `${name}_list.txt`);
  await fs.writeFile(listPath, chunkFiles.map(f => `file '${f}'`).join("\n"));
  await exec(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`);
  return outPath;
}

// ---------------------------------------------------------------------------
// Mockup element renderer → FFmpeg filter fragments
// ---------------------------------------------------------------------------

function renderMockupFilters(elements: MockupElement[]): string[] {
  const filters: string[] = [];
  for (const el of elements) {
    switch (el.kind) {
      case "box":
        if (el.w && el.h)
          filters.push(`drawbox=x=${el.x}:y=${el.y}:w=${el.w}:h=${el.h}:color=${el.color ?? "white"}:t=fill`);
        break;
      case "highlight":
        if (el.w && el.h)
          filters.push(`drawbox=x=${el.x}:y=${el.y}:w=${el.w}:h=${el.h}:color=${el.color ?? "0xFFD700@0.4"}:t=fill`);
        break;
      case "button":
        if (el.w && el.h) {
          filters.push(`drawbox=x=${el.x}:y=${el.y}:w=${el.w}:h=${el.h}:color=${el.color ?? C_NAVY}:t=fill`);
          if (el.text)
            filters.push(`drawtext=text='${esc(el.text)}':fontfile='${FONT_EN}':x=${el.x + 10}:y=${el.y + 10}:fontcolor=white:fontsize=${el.fontSize ?? 15}`);
        }
        break;
      case "input":
        if (el.w && el.h) {
          filters.push(`drawbox=x=${el.x}:y=${el.y}:w=${el.w}:h=${el.h}:color=0xf3f4f6:t=fill`);
          if (el.text)
            filters.push(`drawtext=text='${esc(el.text)}':fontfile='${FONT_EN}':x=${el.x + 10}:y=${el.y + 8}:fontcolor=0xaaaaaa:fontsize=${el.fontSize ?? 14}`);
        }
        break;
      case "text":
        if (el.text)
          filters.push(`drawtext=text='${esc(el.text)}':fontfile='${FONT_EN}':x=${el.x}:y=${el.y}:fontcolor=${el.color ?? "0x374151"}:fontsize=${el.fontSize ?? 14}`);
        break;
      case "cursor":
        // Arrow cursor using a Unicode arrow character
        filters.push(`drawtext=text='►':fontfile='${FONT_EN}':x=${el.x}:y=${el.y}:fontcolor=0xFF6B00:fontsize=18`);
        break;
    }
  }
  return filters;
}

// ---------------------------------------------------------------------------
// A generation config — one per distinct video (the full-system walkthrough,
// or a standalone per-module deep-dive). generateFullSystemVideo() below is
// just the full-system walkthrough's own config passed to the generic
// generateModuleVideo() engine.
// ---------------------------------------------------------------------------

export type ModuleVideoConfig = {
  moduleKey: string;
  videoTitle: string;     // credited in the bottom bar and used as the DB row's title
  introHeading: string;   // big line under "CAFA" on the intro slide
  introSubtitle: string;  // smaller line under introHeading
  outroHeading?: string;  // defaults to introHeading
  // Big cyan headline on the outro slide. Defaults to "Training Complete" —
  // only correct for the full-system walkthrough. A standalone per-module
  // video must override this (e.g. "Module Complete") so it doesn't imply
  // the viewer has finished the entire system, not just this one module.
  outroBigText?: string;
  slides: FullSlide[];
};

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

async function buildIntroSlide(config: ModuleVideoConfig, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, "slide_000.mp4");
  const audioPath = await fetchTTS(config.slides[0].narrationEn, tmpDir, "audio_intro");

  const vf = [
    // Short two-tone rule under the wordmark (matches the design proposal's
    // .intro-rule — a small centered line, not a full-width bar).
    `drawbox=x=(iw-90)/2:y=ih/2-95:w=45:h=3:color=${C_CYAN}:t=fill`,
    `drawbox=x=(iw-90)/2+45:y=ih/2-95:w=45:h=3:color=${C_NAVY_LIGHT}:t=fill`,
    `drawtext=text='CAFA':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2-130:fontcolor=${C_CYAN_LIGHT}:fontsize=64`,
    `drawtext=text='${esc(config.introHeading)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2-50:fontcolor=white:fontsize=32`,
    `drawtext=text='${esc(config.introSubtitle)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+10:fontcolor=white:fontsize=24`,
    `drawtext=text='English Voice-Over  |  ${esc(config.videoTitle)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+55:fontcolor=${C_TEXT_SOFT}:fontsize=18`,
    `drawtext=text='CAFA Development Organization':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h-45:fontcolor=${C_TEXT_SOFT}@0.7:fontsize=15`,
    "fade=t=in:st=0:d=0.5",
  ].join(",");

  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

async function buildOutroSlide(config: ModuleVideoConfig, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, "slide_outro.mp4");
  const lastSlide = config.slides[config.slides.length - 1];
  const audioPath = await fetchTTS(lastSlide.narrationEn, tmpDir, "audio_outro");

  const vf = [
    `drawbox=x=0:y=ih/2-3:w=iw:h=6:color=${C_CYAN}:t=fill`,
    `drawtext=text='${esc(config.outroBigText ?? "Training Complete")}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2-80:fontcolor=${C_CYAN}:fontsize=48`,
    `drawtext=text='${esc(config.outroHeading ?? config.introHeading)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+10:fontcolor=white:fontsize=28`,
    `drawtext=text='Support\\: pmis-support@cafa.systems  |  Manual\\: /manual':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+55:fontcolor=white:fontsize=18`,
    `drawtext=text='CAFA Development Organization':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h-40:fontcolor=${C_TEXT_SOFT}@0.8:fontsize=16`,
    "fade=t=in:st=0:d=0.5",
  ].join(",");

  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

async function buildSectionDivider(slide: FullSlide, index: number, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, `slide_${String(index).padStart(3, "0")}.mp4`);
  const audioPath = await fetchTTS(slide.narrationEn, tmpDir, `audio_${index}`);

  const sectionNum = slide.sectionNum?.toString().padStart(2, "0") ?? "00";
  // A ringed badge (outer cyan, inner slate-blue) for the section number,
  // instead of a flat "Section NN" text line — matches the design
  // proposal's divider badge. drawbox only draws rectangles (no circle
  // primitive), so this is a square ring rather than a true circle.
  const badgeSize = 100;
  const badgeInset = 3;
  // Two different expressions for the same y — confirmed by rendering this
  // locally: drawbox's own x=/y= only understand "iw"/"ih" (its w=/h=
  // options are themselves this box's own width/height, so using "h" there
  // means the BOX's height, not the frame's — an easy, silent mistake, not
  // a parse error); drawtext's x=/y= are the reverse, only understanding
  // "w"/"h" (the frame's), not "iw"/"ih" at all ("Undefined constant").
  const badgeYBox = "(ih-" + badgeSize + ")/2";
  const badgeYText = "(h-" + badgeSize + ")/2";
  const vf = [
    `drawbox=x=0:y=0:w=iw:h=8:color=${C_CYAN}:t=fill`,
    `drawbox=x=0:y=ih-8:w=iw:h=8:color=${C_CYAN}:t=fill`,
    `drawbox=x=80:y=${badgeYBox}:w=${badgeSize}:h=${badgeSize}:color=${C_CYAN}:t=fill`,
    `drawbox=x=${80 + badgeInset}:y=${badgeYBox}+${badgeInset}:w=${badgeSize - badgeInset * 2}:h=${badgeSize - badgeInset * 2}:color=${C_NAVY_LIGHT}:t=fill`,
    `drawtext=text='${esc(sectionNum)}':fontfile='${FONT_EN}':x=80+(${badgeSize}-text_w)/2:y=${badgeYText}+(${badgeSize}-text_h)/2:fontcolor=${C_CYAN_LIGHT}:fontsize=44`,
    `drawtext=text='SECTION ${esc(sectionNum)}':fontfile='${FONT_MONO}':x=${80 + badgeSize + 40}:y=${badgeYText}+18:fontcolor=${C_CYAN}:fontsize=16`,
    `drawtext=text='${esc(slide.sectionEn ?? "")}':fontfile='${FONT_EN}':x=${80 + badgeSize + 40}:y=${badgeYText}+48:fontcolor=white:fontsize=42`,
    "fade=t=in:st=0:d=0.3",
    "fade=t=out:st=2.7:d=0.3",
  ].join(",");

  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

// scripts/capture-training-screenshots.mjs runs as a one-off ECS task with no
// disk shared with this process, so it uploads each screenshot to S3 instead
// (see routes/training-videos.ts's screenshot-upload route). Local disk is
// checked first — cheap, and lets a screenshot placed there directly (e.g. in
// local dev) work with no S3 involved at all — and a local hit is cached for
// every later slide in the same video and future videos, so this only ever
// downloads a given key from S3 once.
async function fetchScreenshotFromS3(key: string, localPath: string): Promise<string | null> {
  try {
    const result = await s3Client().send(new GetObjectCommand({
      Bucket: s3Bucket(),
      Key: `${TRAINING_SCREENSHOT_S3_PREFIX}/${key}.png`,
    }));
    const body = result.Body;
    if (!body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, Buffer.concat(chunks));
    return localPath;
  } catch {
    // Not configured, not found, or a transient failure — all fall back to
    // the slide's drawn mockup the same way a missing local file always has.
    return null;
  }
}

export async function resolveScreenshotPath(slide: FullSlide): Promise<string | null> {
  if (!slide.screenshotKey) return null;
  const p = path.join(SCREENSHOTS_DIR, `${slide.screenshotKey}.png`);
  if (fsSync.existsSync(p)) return p;
  return fetchScreenshotFromS3(slide.screenshotKey, p);
}

async function buildContentSlide(slide: FullSlide, index: number, tmpDir: string, config: ModuleVideoConfig): Promise<string> {
  const audioPath = await fetchTTS(slide.narrationEn, tmpDir, `audio_${index}`);

  const screenshotPath = await resolveScreenshotPath(slide);
  if (screenshotPath && slide.screenshotLayout === "full") {
    return buildFullScreenshotSlide(slide, index, screenshotPath, audioPath, tmpDir);
  }

  const out = path.join(tmpDir, `slide_${String(index).padStart(3, "0")}.mp4`);
  const hasMockup = !screenshotPath && !!(slide.mockup?.length);
  const hasPanel = !!screenshotPath || hasMockup;

  // ---- Build filter chain (drawn onto the graded background input) ----
  const filters: string[] = [];

  // Section label pill — floats directly on the graded background instead of
  // a solid header bar (matches the agreed redesign).
  const secLabel = slide.sectionEn ? esc(slide.sectionEn.toUpperCase()) : "";
  const chipW = Math.max(90, secLabel.length * 11 + 40);
  filters.push(`drawbox=x=44:y=44:w=${chipW}:h=32:color=${C_CYAN_SOFT}:t=fill`);
  filters.push(`drawtext=text='${secLabel}':fontfile='${FONT_MONO}':x=64:y=53:fontcolor=${C_NAVY}:fontsize=15`);

  // Section number ring, right after the chip
  if (slide.sectionNum) {
    const sn = `${slide.sectionNum}`;
    const ringX = 44 + chipW + 12;
    filters.push(`drawbox=x=${ringX}:y=40:w=40:h=40:color=${C_NAVY_LIGHT}@0.7:t=fill`);
    filters.push(`drawtext=text='${sn}':fontfile='${FONT_EN}':x=${ringX + 13}:y=50:fontcolor=${C_CYAN_LIGHT}:fontsize=22`);
  }

  // Dim CAFA PMIS brand mark, top-right
  filters.push(`drawtext=text='CAFA PMIS':fontfile='${FONT_EN}':x=w-200:y=50:fontcolor=white@0.35:fontsize=22`);

  // Panel separator line (screenshot or drawn mockup both sit in the same right-side panel)
  if (hasPanel) {
    filters.push(`drawbox=x=718:y=85:w=2:h=625:color=${C_CYAN}@0.3:t=fill`);
  }

  // Drawn mockup panel — only when no real screenshot is available yet
  if (hasMockup) {
    for (const f of renderMockupFilters(slide.mockup!)) {
      filters.push(f);
    }
  }

  // Slide title
  filters.push(`drawtext=text='${esc(slide.titleEn)}':fontfile='${FONT_EN}':x=28:y=112:fontcolor=${C_CYAN}:fontsize=30`);

  // Bullet points — staggered fade + slide-in, one after another. Truncation
  // width is panel-aware: a screenshot/mockup panel starts at x=718, but with
  // neither, bullets have the full frame width to use.
  const startY = 165;
  const lineH = 52;
  const bulletFontSize = 22;
  const bulletRightEdge = hasPanel ? 706 : 1252;
  const bulletMax = maxBulletChars(bulletRightEdge - 28, bulletFontSize);
  const points = slide.pointsEn.slice(0, 7);
  for (let i = 0; i < points.length; i++) {
    const y = startY + i * lineH;
    const truncated = points[i].length > bulletMax ? points[i].slice(0, bulletMax) + "…" : points[i];
    filters.push(...bulletFilters(truncated, 28, y, bulletFontSize, i));
  }

  // Bottom bar
  filters.push(`drawbox=x=0:y=690:w=iw:h=30:color=${C_INK}:t=fill`);
  filters.push(`drawtext=text='CAFA PMIS — ${esc(config.videoTitle)}':fontfile='${FONT_EN}':x=20:y=696:fontcolor=${C_CYAN}@0.7:fontsize=13`);

  // Fade
  filters.push("fade=t=in:st=0:d=0.3");

  if (screenshotPath) {
    // "card" layout: the real screenshot sits in the same narrow panel region
    // (730,90 .. 1260,640) the mockup used to draw by hand.
    const filterComplex =
      `[0:v]${filters.join(",")}[bg];` +
      `[1:v]scale=530:550[shot];` +
      `[bg][shot]overlay=730:90[outv]`;
    await exec(
      `ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${screenshotPath}" -i "${audioPath}" ` +
      `-filter_complex "${filterComplex}" -map "[outv]" -map 2:a -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`,
    );
    return out;
  }

  const vf = filters.join(",");
  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

// Convenience wrapper for a filter's "enable" timeline option — the cursor
// filters below are gated to a specific time window, and between()'s own
// comma-separated args need escExpr() same as any other expression embedded
// inside a filter-chain option.
function enableBetween(startSec: number, endSec: number): string {
  return `enable='${escExpr(`between(t,${startSec},${endSec})`)}'`;
}

// Ken Burns pan-and-zoom timing shared by every highlightRegion slide — eases
// from the full frame into a framing centered on the region between these
// two timestamps, then holds. A fixed shared window (rather than a per-slide
// setting) keeps every slide's camera move feeling consistent.
const PAN_START = 0.4;
const PAN_END = 1.8;
const PAN_ZOOM = 1.35;

// "full" layout: the real screenshot fills the frame (wide, full-page screens
// like Dashboard or Projects don't fit the narrow card region above); title
// and bullets sit in a translucent lower-third band over the screenshot. A
// highlightRegion, when set, drives a real Ken Burns pan-and-zoom of the
// screenshot itself toward that region — a static screenshot for the whole
// slide regardless of what the narration is currently discussing was the
// loudest complaint in review, and a purely decorative dim/highlight box
// around a still-frozen frame didn't actually address it, only a moving
// camera does. Confirmed empirically (a local ffmpeg-full render, both the
// scale/crop math in isolation and the full filter chain end to end) before
// shipping this.
async function buildFullScreenshotSlide(
  slide: FullSlide,
  index: number,
  screenshotPath: string,
  audioPath: string,
  tmpDir: string,
): Promise<string> {
  const out = path.join(tmpDir, `slide_${String(index).padStart(3, "0")}.mp4`);
  const secLabel = slide.sectionEn ? esc(slide.sectionEn.toUpperCase()) : "";
  const bandTop = 500;

  const cursorAction = slide.cursorAction;
  let baseScale: string;
  if (slide.highlightRegion) {
    const hr = slide.highlightRegion;
    const centerX = hr.x + hr.w / 2;
    const centerY = hr.y + hr.h / 2;
    // The crop position this settles into, at full zoom, so the region ends
    // up centered in frame — computed once here in plain JS, not as a
    // runtime ffmpeg expression.
    const finalCropX = (centerX * PAN_ZOOM - 640).toFixed(2);
    const finalCropY = (centerY * PAN_ZOOM - 360).toFixed(2);
    const panSpan = (PAN_END - PAN_START).toFixed(3);
    // 0 before the pan starts, ramps to 1 by PAN_END, then holds at 1 — the
    // same ramp shape bulletStagger already uses for its own fade-in.
    const progress = `if(lt(t,${PAN_START}),0,if(lt(t,${PAN_END}),(t-${PAN_START})/${panSpan},1))`;
    const scaleDim = (px: number) => escExpr(`${px}*(1+${(PAN_ZOOM - 1).toFixed(3)}*(${progress}))`);
    const cropPos = (finalPx: string) => escExpr(`(${progress})*${finalPx}`);
    baseScale =
      `scale=w='${scaleDim(1280)}':h='${scaleDim(720)}':eval=frame:force_original_aspect_ratio=increase,` +
      `crop=w=1280:h=720:x='${cropPos(finalCropX)}':y='${cropPos(finalCropY)}'`;
  } else {
    baseScale = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";
  }

  // ---- Section title / bullet band. Was a static quarter-frame band for
  // the whole slide (the single biggest review complaint — it permanently
  // covered part of the real screenshot it was meant to be explaining).
  // Now: full-size for a "read window" — a 2.5s floor, or however long the
  // bullets' own staggered fade-in actually takes, whichever is longer, so a
  // slide with several bullets never collapses mid-reveal — then it
  // collapses to a small persistent tag, freeing the screenshot underneath
  // for the rest of the slide.
  const points = slide.pointsEn.slice(0, 4); // the lower-third band has less room than the old left column
  const lastBulletAt = Math.max(0, points.length - 1) * BULLET_STAGGER_SEC + 0.3;
  const readWindow = Math.max(2.5, lastBulletAt + 0.4);
  const fullBandH = 720 - bandTop;
  const tagH = 40;
  const bandHExpr = escExpr(`if(lt(t,${readWindow}),${fullBandH},${tagH})`);
  const bandYExpr = escExpr(`if(lt(t,${readWindow}),${bandTop},${720 - tagH})`);
  const titleYExpr = escExpr(`if(lt(t,${readWindow}),${bandTop + 14},${720 - tagH + 11})`);
  const titleSizeExpr = escExpr(`if(lt(t,${readWindow}),26,16)`);

  const chrome: string[] = [
    `drawbox=x=0:y=0:w=iw:h=56:color=${C_NAVY}@0.85:t=fill`,
    `drawtext=text='${secLabel}':fontfile='${FONT_EN}':x=24:y=16:fontcolor=${C_CYAN}:fontsize=22`,
    `drawtext=text='CAFA PMIS':fontfile='${FONT_EN}':x=w-160:y=16:fontcolor=white:fontsize=20`,
    `drawbox=x=0:y='${bandYExpr}':w=iw:h='${bandHExpr}':color=${C_INK}@0.72:t=fill`,
    `drawtext=text='${esc(slide.titleEn)}':fontfile='${FONT_EN}':x=28:y='${titleYExpr}':fontcolor=${C_CYAN}:fontsize='${titleSizeExpr}'`,
  ];

  const startY = bandTop + 56;
  const lineH = 34;
  const bulletFontSize = 18;
  // The lower band spans the full frame width, but a single readable line is
  // capped well below what would technically fit — long unbroken lines here
  // would be a readability problem, not an overlap one.
  const bulletMax = Math.min(maxBulletChars(1252 - 28, bulletFontSize), 85);
  for (let i = 0; i < points.length; i++) {
    const y = startY + i * lineH;
    const truncated = points[i].length > bulletMax ? points[i].slice(0, bulletMax) + "…" : points[i];
    // Bullets only ever show during the read window — the band above them
    // physically collapses away afterward, so leaving them visible past
    // that would float bullet text over the bare screenshot. Folded into
    // the bullet's own alpha channel (see bulletFilters' hideAfterSec)
    // rather than a second, independent gating mechanism layered on top.
    for (const f of bulletFilters(truncated, 28, y, bulletFontSize, i, readWindow)) {
      chrome.push(f);
    }
  }

  // ---- Tell → Show → Do: an animated cursor moving to, and "clicking",
  // whatever the narration describes acting on — instead of only describing
  // the action in text. If the slide also pans/zooms via highlightRegion,
  // schedule clickAtSec safely after PAN_END so the cursor's coordinates
  // are relative to the settled, zoomed-in framing.
  if (cursorAction) {
    const { fromX, fromY, toX, toY, clickAtSec } = cursorAction;
    const moveStart = Math.max(0, clickAtSec - 0.7);
    const moveEnd = Math.max(moveStart + 0.1, clickAtSec - 0.1);
    const moveSpan = (moveEnd - moveStart).toFixed(3);
    const cursorX = escExpr(
      `if(lt(t,${moveStart}),${fromX},if(lt(t,${moveEnd}),${fromX}+(${toX}-${fromX})*(t-${moveStart})/${moveSpan},${toX}))`,
    );
    const cursorY = escExpr(
      `if(lt(t,${moveStart}),${fromY},if(lt(t,${moveEnd}),${fromY}+(${toY}-${fromY})*(t-${moveStart})/${moveSpan},${toY}))`,
    );
    chrome.push(
      `drawtext=text='►':fontfile='${FONT_EN}':x='${cursorX}':y='${cursorY}':fontsize=32:fontcolor=0xFF6B00:` +
      enableBetween(moveStart, clickAtSec + 0.6),
    );
    // A brief pulsing dot at the destination, right as the cursor arrives —
    // a lightweight stand-in for a "click ripple" (drawtext/drawbox have no
    // circle primitive to actually expand a ring).
    const pulseSize = escExpr(`22+14*max(0,1-abs(t-${clickAtSec})/0.3)`);
    chrome.push(
      `drawtext=text='●':fontfile='${FONT_EN}':x=${toX}:y=${toY}:fontsize='${pulseSize}':fontcolor=0xFF6B00@0.55:` +
      enableBetween(clickAtSec - 0.05, clickAtSec + 0.6),
    );
  }

  chrome.push("fade=t=in:st=0:d=0.3");

  const vf = [baseScale, ...chrome].join(",");
  await exec(
    `ffmpeg -y -loop 1 -framerate 24 -i "${screenshotPath}" -i "${audioPath}" -vf "${vf}" ` +
    `-c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Caption track — WebVTT sidecar (not burned into the video)
// ---------------------------------------------------------------------------
// Captions used to be permanently burned into the frame via a libass "ass="
// filter, as one static Dialogue line showing a slide's *entire* narration
// for its *entire* duration — that, not just its font size, is why review
// called the captions oversized: it was a whole paragraph on screen at
// once, not a normal caption updating every few seconds. Moving to a WebVTT
// sidecar fixes both problems at once: generateCaptionCues() below splits
// each slide's narration into short, sentence-scale cues timed across the
// slide's own on-screen span (so only a line or two is ever visible at
// once), and — since it's a separate file rather than something baked into
// the frame — it can be toggled on/off by a player and translated to Arabic
// later with zero video re-rendering. There is no training-video player in
// the frontend yet to consume this file; generateModuleVideo() below just
// writes it next to the .mp4 (same local-disk convention) and
// routes/training-videos.ts serves it, ready for whenever that player
// exists.

export function toVttTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(Math.floor(m)).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// Splits on sentence-ending punctuation, keeping it with its sentence —
// narrationEn is always well-punctuated prose (see the module scripts), so
// this never needs to special-case abbreviations or decimals.
function splitCaptionSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+(\s+|$)/g);
  if (!parts) return [text.trim()];
  return parts.map(p => p.trim()).filter(Boolean);
}

// One caption cue per sentence, unless a sentence itself runs long — those
// get word-wrapped (reusing chunkText(), the same word-safe splitter TTS
// chunking already relies on) so no single cue is more than a line or two
// in a typical player at a normal caption size.
export function buildCaptionCues(text: string, maxCharsPerCue = 110): string[] {
  const sentences = splitCaptionSentences(text);
  const cues: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxCharsPerCue) { cues.push(s); continue; }
    cues.push(...chunkText(s, maxCharsPerCue));
  }
  return cues;
}

// `starts[i]` is when slide i's own content begins in the FINAL (already
// crossfaded) timeline — see crossfadeConcat(), which shrinks the naive
// sum-of-durations timeline by XFADE_SEC at every transition, so cues can't
// just be timed off the original per-clip durations anymore. Within one
// slide's span, cues are spaced proportionally to their own character
// length (there's no word-level timing from the TTS engine to time them
// against precisely) — approximate, but far closer to real captioning than
// one static block for the whole slide.
async function generateVTTCaptions(
  slides: FullSlide[],
  starts: number[],
  totalDuration: number,
  outputPath: string,
): Promise<void> {
  const lines: string[] = ["WEBVTT", ""];
  let cueIndex = 1;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (!slide.narrationEn || slide.type === "section-header") continue;

    const slideStart = starts[i] ?? 0;
    const slideEnd = i + 1 < starts.length ? starts[i + 1] : totalDuration;
    const slideDur = Math.max(0.5, slideEnd - slideStart - 0.2);

    const cues = buildCaptionCues(slide.narrationEn.replace(/\n/g, " "));
    const totalChars = cues.reduce((sum, c) => sum + c.length, 0) || 1;

    let elapsed = 0;
    for (const cue of cues) {
      const share = cue.length / totalChars;
      const dur = Math.max(0.9, slideDur * share);
      const cueStart = slideStart + elapsed;
      const cueEnd = Math.min(slideStart + slideDur, Math.max(cueStart + dur, cueStart + 0.5));
      lines.push(String(cueIndex++));
      lines.push(`${toVttTime(cueStart)} --> ${toVttTime(cueEnd)}`);
      lines.push(cue);
      lines.push("");
      elapsed += dur;
    }
  }

  await fs.writeFile(outputPath, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Crossfade concat — replaces the old hard-cut concat demuxer with a chained
// video xfade + audio acrossfade per adjacent pair, merged iteratively so
// each transition is one small, independently verifiable ffmpeg call rather
// than a single filter graph spanning every clip.
// ---------------------------------------------------------------------------

// Pure duration/offset math for the crossfade chain — kept separate from the
// actual ffmpeg calls in crossfadeConcat() below specifically so it can be
// unit-tested without a real ffmpeg binary (see
// video-generator-crossfade-plan.test.ts). Each merge step's xfade `offset`
// is where the transition starts within the *accumulated* clip so far, and
// every merge shrinks the running total by `xfade` seconds (the two clips'
// overlapping span) — `starts[i]` is where clip i's own content begins in
// that final, shrunk timeline.
export function computeCrossfadePlan(
  durations: number[],
  xfadeSec: number,
): { xfades: number[]; starts: number[]; totalDuration: number } {
  if (!durations.length) return { xfades: [], starts: [], totalDuration: 0 };
  if (durations.length === 1) return { xfades: [], starts: [0], totalDuration: durations[0] };

  const xfades: number[] = [];
  const starts: number[] = [0];
  let currentDuration = durations[0];

  for (let i = 1; i < durations.length; i++) {
    const nextDuration = durations[i];
    // Guard against a transition longer than either clip on either side of
    // it (section-header dividers are as short as ~3s).
    const xfade = Math.max(0.05, Math.min(xfadeSec, currentDuration - 0.1, nextDuration - 0.1));
    const offset = Math.max(currentDuration - xfade, 0);
    xfades.push(xfade);
    starts.push(offset);
    currentDuration = currentDuration + nextDuration - xfade;
  }

  return { xfades, starts, totalDuration: currentDuration };
}

async function crossfadeConcat(
  clips: string[],
  durations: number[],
  outputPath: string,
  tmpDir: string,
): Promise<{ starts: number[]; totalDuration: number }> {
  if (!clips.length) throw new Error("No clips to concatenate");
  if (clips.length === 1) {
    await fs.copyFile(clips[0], outputPath);
    return { starts: [0], totalDuration: durations[0] ?? 0 };
  }

  const { xfades, starts, totalDuration } = computeCrossfadePlan(durations, XFADE_SEC);

  let current = clips[0];
  for (let i = 1; i < clips.length; i++) {
    const xfade = xfades[i - 1];
    const offset = starts[i];
    const merged = path.join(tmpDir, `xfade_${i}.mp4`);
    await exec(
      `ffmpeg -y -i "${current}" -i "${clips[i]}" -filter_complex ` +
      `"[0:v][1:v]xfade=transition=fade:duration=${xfade.toFixed(3)}:offset=${offset.toFixed(3)}[v];[0:a][1:a]acrossfade=d=${xfade.toFixed(3)}[a]" ` +
      `-map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k "${merged}"`,
    );
    current = merged;
  }

  await fs.copyFile(current, outputPath);
  return { starts, totalDuration };
}

// ---------------------------------------------------------------------------
// Main generation — generic engine, reused by every module video.
// ---------------------------------------------------------------------------

export async function generateModuleVideo(videoId: number, config: ModuleVideoConfig): Promise<void> {
  const tmpDir = path.join(TMP_BASE, String(videoId));
  await ensureDir(tmpDir);
  await ensureDir(DATA_DIR);

  const rawConcat = path.join(tmpDir, "concat_raw.mp4");
  const finalPath = path.join(DATA_DIR, `${videoId}.mp4`);
  const vttPath   = path.join(DATA_DIR, `${videoId}.vtt`);
  const clipPaths: string[] = [];
  const clipDurations: number[] = [];

  try {
    const slides = config.slides;
    const total = slides.length;

    for (let i = 0; i < total; i++) {
      const slide = slides[i];
      const pct = Math.round(5 + (i / total) * 78);
      await setProgress(videoId, pct, `Processing slide ${i + 1} of ${total}: ${slide.titleEn}…`);

      let clipPath: string;

      if (slide.type === "intro") {
        clipPath = await buildIntroSlide(config, tmpDir);
      } else if (slide.type === "outro") {
        clipPath = await buildOutroSlide(config, tmpDir);
      } else if (slide.type === "section-header") {
        clipPath = await buildSectionDivider(slide, i, tmpDir);
      } else {
        clipPath = await buildContentSlide(slide, i, tmpDir, config);
      }

      const dur = await getDuration(clipPath);
      clipPaths.push(clipPath);
      clipDurations.push(dur);
    }

    await setProgress(videoId, 84, "Assembling final video (cross-dissolve transitions)…");
    const { starts, totalDuration } = await crossfadeConcat(clipPaths, clipDurations, rawConcat, tmpDir);

    await setProgress(videoId, 92, "Generating caption track…");
    // Captions are a WebVTT sidecar, not burned into the frame — see the
    // comment above generateVTTCaptions() — so the crossfaded concat is
    // already the final video with no further encode pass needed.
    await generateVTTCaptions(slides, starts, totalDuration, vttPath);
    await fs.copyFile(rawConcat, finalPath);

    await setProgress(videoId, 98, "Finalizing…");
    const duration = await getDuration(finalPath);

    await pool.query(
      `UPDATE training_videos
       SET status='published', file_path=$1, duration=$2,
           progress_pct=100, progress_label='Complete', error_message=NULL, updated_at=NOW()
       WHERE id=$3`,
      [finalPath, Math.round(duration), videoId],
    );
  } catch (err) {
    // A failed exec() rejects with "Command failed: <full echoed command>"
    // followed by stderr — for these long filter-chain invocations the
    // echoed command alone easily runs past a few hundred characters, which
    // pushed the actually useful part (stderr, the real reason) out of the
    // stored message entirely under the old 500-char cap. stderr goes first
    // now, and the cap is wide enough that this can't recur in practice.
    const stderr = (err as { stderr?: unknown })?.stderr;
    const rawMsg = err instanceof Error ? err.message : String(err);
    const msg = typeof stderr === "string" && stderr.trim() ? stderr.trim() : rawMsg;
    await pool.query(
      `UPDATE training_videos
       SET status='failed', error_message=$1, progress_pct=0, progress_label='Failed', updated_at=NOW()
       WHERE id=$2`,
      [msg.slice(0, 4000), videoId],
    );
    throw err;
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export async function generateFullSystemVideo(videoId: number): Promise<void> {
  return generateModuleVideo(videoId, {
    moduleKey: FULL_VIDEO_MODULE,
    videoTitle: FULL_VIDEO_TITLE,
    introHeading: "Program Management System",
    introSubtitle: "Complete System Training Guide",
    slides: FULL_SYSTEM_SCRIPT,
  });
}
