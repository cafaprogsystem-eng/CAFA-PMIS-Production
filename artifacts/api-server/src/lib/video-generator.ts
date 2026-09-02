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

const exec = promisify(execCb);

const FONT_EN   = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";
const DATA_DIR  = "/home/runner/workspace/data/training-videos";
const SCREENSHOTS_DIR = "/home/runner/workspace/data/training-screenshots";
const TMP_BASE  = "/tmp/cafa-videos";

// Sampled directly from the real CAFA wordmark (cafa-logo.png) — no gold.
// video-assets/bg-graded.png is the pre-rendered graded background using
// these same three colors (generated once with sharp; sharp is NOT a
// runtime dependency of this file or the production image).
const BG_ASSET    = path.resolve(__dirname, "video-assets/bg-graded.png");
const C_NAVY      = "0x2B2F90";
const C_INK       = "0x10133A";
const C_CYAN      = "0x00B0EB";
const C_CYAN_SOFT = "0xBFEAF8";

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

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%");
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
// cascade instead of every bullet appearing at frame 0.
function bulletStagger(index: number): { alpha: string; x: string } {
  const delay = index * BULLET_STAGGER_SEC;
  const rampEnd = delay + 0.3;
  // Plain, readable expressions first — escExpr() does the one-pass comma
  // escaping needed to embed them safely inside the outer filter chain.
  const alphaExpr = `if(lt(t,${delay}),0,if(lt(t,${rampEnd}),(t-${delay})/0.3,1))`;
  const xExpr = `28+if(lt(t,${delay}),20,if(lt(t,${rampEnd}),20*(1-(t-${delay})/0.3),0))`;
  return { alpha: escExpr(alphaExpr), x: escExpr(xExpr) };
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

async function fetchTTS(text: string, tmpDir: string, name: string): Promise<string | null> {
  const chunks = chunkText(text);
  const chunkFiles: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const enc = encodeURIComponent(chunks[i]);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${enc}&tl=en&client=tw-ob&ttsspeed=0.82`;
    try {
      const buf = await fetchBuffer(url, 12000);
      if (buf.length < 100) throw new Error("Empty TTS response");
      const cp = path.join(tmpDir, `${name}_chunk_${i}.mp3`);
      await fs.writeFile(cp, buf);
      chunkFiles.push(cp);
      if (chunks.length > 1) await new Promise(r => setTimeout(r, 380));
    } catch { return null; }
  }
  if (!chunkFiles.length) return null;
  const outPath = path.join(tmpDir, `${name}.mp3`);
  if (chunkFiles.length === 1) { await fs.rename(chunkFiles[0], outPath); return outPath; }
  const listPath = path.join(tmpDir, `${name}_list.txt`);
  await fs.writeFile(listPath, chunkFiles.map(f => `file '${f}'`).join("\n"));
  await exec(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`);
  return outPath;
}

async function silentAudio(durationSec: number, tmpDir: string, name: string): Promise<string> {
  const p = path.join(tmpDir, `${name}.mp3`);
  await exec(`ffmpeg -y -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=44100" -t ${durationSec} -q:a 9 -acodec libmp3lame "${p}"`);
  return p;
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
  slides: FullSlide[];
};

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

async function buildIntroSlide(config: ModuleVideoConfig, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, "slide_000.mp4");
  const audioPath = await fetchTTS(
    config.slides[0].narrationEn,
    tmpDir, "audio_intro",
  ) ?? await silentAudio(8, tmpDir, "audio_intro");

  const vf = [
    `drawbox=x=0:y=ih/2-4:w=iw:h=8:color=${C_CYAN}:t=fill`,
    `drawtext=text='CAFA':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2-130:fontcolor=${C_CYAN}:fontsize=64`,
    `drawtext=text='${esc(config.introHeading)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2-50:fontcolor=white:fontsize=32`,
    `drawtext=text='${esc(config.introSubtitle)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+10:fontcolor=white:fontsize=24`,
    `drawtext=text='English Voice-Over  |  ${esc(config.videoTitle)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+55:fontcolor=${C_CYAN}:fontsize=18`,
    `drawtext=text='CAFA Development Organization':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h-45:fontcolor=white@0.5:fontsize=15`,
    "fade=t=in:st=0:d=0.5",
  ].join(",");

  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

async function buildOutroSlide(config: ModuleVideoConfig, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, "slide_outro.mp4");
  const lastSlide = config.slides[config.slides.length - 1];
  const audioPath = await fetchTTS(lastSlide.narrationEn, tmpDir, "audio_outro")
    ?? await silentAudio(8, tmpDir, "audio_outro");

  const vf = [
    `drawbox=x=0:y=ih/2-3:w=iw:h=6:color=${C_CYAN}:t=fill`,
    `drawtext=text='Training Complete':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2-80:fontcolor=${C_CYAN}:fontsize=48`,
    `drawtext=text='${esc(config.outroHeading ?? config.introHeading)}':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+10:fontcolor=white:fontsize=28`,
    `drawtext=text='Support\\: pmis-support@cafa.org  |  Manual\\: /manual':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h/2+55:fontcolor=white:fontsize=18`,
    `drawtext=text='CAFA Development Organization':fontfile='${FONT_EN}':x=(w-text_w)/2:y=h-40:fontcolor=${C_CYAN}@0.8:fontsize=16`,
    "fade=t=in:st=0:d=0.5",
  ].join(",");

  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

async function buildSectionDivider(slide: FullSlide, index: number, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, `slide_${String(index).padStart(3, "0")}.mp4`);
  const audioPath = await fetchTTS(slide.narrationEn, tmpDir, `audio_${index}`)
    ?? await silentAudio(3, tmpDir, `audio_${index}`);

  const sectionNum = slide.sectionNum?.toString().padStart(2, "0") ?? "00";
  const vf = [
    `drawbox=x=0:y=0:w=iw:h=8:color=${C_CYAN}:t=fill`,
    `drawbox=x=0:y=ih-8:w=iw:h=8:color=${C_CYAN}:t=fill`,
    `drawtext=text='Section ${esc(sectionNum)}':fontfile='${FONT_EN}':x=80:y=(h-text_h)/2-40:fontcolor=${C_CYAN}:fontsize=24`,
    `drawtext=text='${esc(slide.sectionEn ?? "")}':fontfile='${FONT_EN}':x=80:y=(h-text_h)/2:fontcolor=white:fontsize=42`,
    "fade=t=in:st=0:d=0.3",
    "fade=t=out:st=2.7:d=0.3",
  ].join(",");

  await exec(`ffmpeg -y -loop 1 -framerate 24 -i "${BG_ASSET}" -i "${audioPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`);
  return out;
}

export function resolveScreenshotPath(slide: FullSlide): string | null {
  if (!slide.screenshotKey) return null;
  const p = path.join(SCREENSHOTS_DIR, `${slide.screenshotKey}.png`);
  return fsSync.existsSync(p) ? p : null;
}

async function buildContentSlide(slide: FullSlide, index: number, tmpDir: string, config: ModuleVideoConfig): Promise<string> {
  const audioPath = await fetchTTS(slide.narrationEn, tmpDir, `audio_${index}`)
    ?? await silentAudio(slide.durationHint, tmpDir, `audio_${index}`);

  const screenshotPath = resolveScreenshotPath(slide);
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
    filters.push(`drawbox=x=${ringX}:y=40:w=40:h=40:color=${C_NAVY}@0.55:t=fill`);
    filters.push(`drawtext=text='${sn}':fontfile='${FONT_EN}':x=${ringX + 13}:y=50:fontcolor=${C_CYAN}:fontsize=22`);
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

  // Bullet points — staggered fade + slide-in, one after another
  const startY = 165;
  const lineH = 52;
  const points = slide.pointsEn.slice(0, 7);
  for (let i = 0; i < points.length; i++) {
    const y = startY + i * lineH;
    const truncated = points[i].length > 55 ? points[i].slice(0, 55) + "…" : points[i];
    const { alpha, x } = bulletStagger(i);
    filters.push(`drawtext=text='• ${esc(truncated)}':fontfile='${FONT_EN}':x='${x}':y=${y}:fontcolor=white:fontsize=22:alpha='${alpha}'`);
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

// "full" layout: the real screenshot fills the frame (wide, full-page screens
// like Dashboard or Projects don't fit the narrow card region above); title
// and bullets sit in a translucent lower-third band over the screenshot.
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

  const filters: string[] = [
    "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
    `drawbox=x=0:y=0:w=iw:h=56:color=${C_NAVY}@0.85:t=fill`,
    `drawtext=text='${secLabel}':fontfile='${FONT_EN}':x=24:y=16:fontcolor=${C_CYAN}:fontsize=22`,
    `drawtext=text='CAFA PMIS':fontfile='${FONT_EN}':x=w-160:y=16:fontcolor=white:fontsize=20`,
    `drawbox=x=0:y=${bandTop}:w=iw:h=${720 - bandTop}:color=${C_INK}@0.72:t=fill`,
    `drawtext=text='${esc(slide.titleEn)}':fontfile='${FONT_EN}':x=28:y=${bandTop + 14}:fontcolor=${C_CYAN}:fontsize=26`,
  ];

  const startY = bandTop + 56;
  const lineH = 34;
  const points = slide.pointsEn.slice(0, 4); // the lower-third band has less room than the old left column
  for (let i = 0; i < points.length; i++) {
    const y = startY + i * lineH;
    const truncated = points[i].length > 70 ? points[i].slice(0, 70) + "…" : points[i];
    const { alpha, x } = bulletStagger(i);
    filters.push(`drawtext=text='• ${esc(truncated)}':fontfile='${FONT_EN}':x='${x}':y=${y}:fontcolor=white:fontsize=18:alpha='${alpha}'`);
  }
  filters.push("fade=t=in:st=0:d=0.3");

  const vf = filters.join(",");
  await exec(
    `ffmpeg -y -loop 1 -framerate 24 -i "${screenshotPath}" -i "${audioPath}" -vf "${vf}" ` +
    `-c:v libx264 -preset ultrafast -crf 26 -c:a aac -b:a 96k -shortest "${out}"`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// ASS subtitle generator
// ---------------------------------------------------------------------------

function toAssTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const cs = Math.round((s % 1) * 100);
  return `${h}:${String(Math.floor(m)).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// `starts[i]` is when slide i's own content begins in the FINAL (already
// crossfaded) timeline — see crossfadeConcat(), which shrinks the naive
// sum-of-durations timeline by XFADE_SEC at every transition, so subtitles
// can't just be timed off the original per-clip durations anymore.
async function generateASSSubtitles(
  slides: FullSlide[],
  starts: number[],
  totalDuration: number,
  outputPath: string,
): Promise<void> {
  const fontName = path.basename(FONT_EN, ".ttf");
  const header = `[Script Info]
Title: CAFA PMIS Training
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: English,${fontName},28,&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,0,0,0,0,100,100,0,0,1,3,1,2,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogues: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const start = starts[i] ?? 0;
    const end = i + 1 < starts.length ? starts[i + 1] : totalDuration;
    const startStr = toAssTime(start);
    const endStr = toAssTime(Math.max(end - 0.2, start + 0.5));

    if (slides[i].narrationEn && slides[i].type !== "section-header") {
      const text = slides[i].narrationEn.replace(/\n/g, "\\N");
      dialogues.push(`Dialogue: 0,${startStr},${endStr},English,,0,0,0,,{\\fad(300,300)}${text}`);
    }
  }

  await fs.writeFile(outputPath, `${header}\n${dialogues.join("\n")}\n`);
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
  const assPath   = path.join(tmpDir, "subtitles.ass");
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

    await setProgress(videoId, 88, "Generating subtitle track…");
    await generateASSSubtitles(slides, starts, totalDuration, assPath);

    await setProgress(videoId, 92, "Burning captions into video…");
    // Escape path for libass filter
    const assEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    await exec(
      `ffmpeg -y -i "${rawConcat}" -vf "ass='${assEscaped}'" -c:v libx264 -preset ultrafast -crf 24 -c:a copy "${finalPath}"`,
    );

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
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE training_videos
       SET status='failed', error_message=$1, progress_pct=0, progress_label='Failed', updated_at=NOW()
       WHERE id=$2`,
      [msg.slice(0, 500), videoId],
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
