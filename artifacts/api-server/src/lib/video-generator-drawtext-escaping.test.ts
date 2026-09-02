/**
 * VIDEO-GENERATOR-DRAWTEXT-ESCAPING — the very first successful production
 * ffmpeg run of this pipeline (ffmpeg itself was missing from the image
 * until just before this) crashed with "No option name near ... :fontfile=
 * ..." — a bullet's apostrophe survived truncation unmatched (the closing
 * quote of "...'invalid credentials'" fell past the 55-char cut), and a
 * backslash-escaped apostrophe (\') followed by more chained drawtext
 * filters desyncs ffmpeg's own quote-tracking for the rest of the chain.
 * Reproduced locally against a real ffmpeg build before fixing esc() to
 * replace apostrophes with a typographic quote instead of escaping them —
 * sidesteps ffmpeg's quoting rules entirely rather than trying to match
 * them exactly.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { esc } from "./video-generator";

// Finds an ffmpeg binary that actually has drawtext compiled in — plain
// "ffmpeg -version" succeeding isn't enough (a build without libfreetype
// lacks the filter entirely, which fails a different, unrelated way and
// would make this test pass for the wrong reason). Tries PATH first, then
// the well-known Homebrew ffmpeg-full location.
function findFfmpegWithDrawtext(): string | null {
  for (const bin of ["ffmpeg", "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"]) {
    try {
      const out = execSync(`${bin} -filters`, { stdio: "pipe" }).toString();
      if (out.includes("drawtext")) return bin;
    } catch { /* try next candidate */ }
  }
  return null;
}

describe("VIDEO-GENERATOR-DRAWTEXT-ESCAPING", () => {
  it("replaces a literal apostrophe with a typographic quote instead of backslash-escaping it", () => {
    expect(esc("Tick 'Remember me' for 30 days")).toBe("Tick ’Remember me’ for 30 days");
  });

  it("still backslash-escapes colons, commas, and brackets (safe inside the caller's quotes)", () => {
    expect(esc("a:b,c[d]e")).toBe("a\\:b\\,c\\[d\\]e");
  });

  it("escapes a literal backslash and percent sign", () => {
    expect(esc("50%\\done")).toBe("50\\%\\\\done");
  });

  it("never leaves a raw single quote in its output, matched pair or not", () => {
    const cases = [
      "Wrong username or password: generic 'invalid credentials'",
      "Too many attempts from your network: 'too many requests'",
      // the exact truncated fragment that crashed production — the closing
      // quote of 'invalid credentials' falls past the 55-char cut
      "Wrong username or password: generic 'invalid credential…",
    ];
    for (const c of cases) {
      expect(esc(c)).not.toContain("'");
    }
  });

  // A drawtext-capable ffmpeg isn't installed in most CI/dev environments
  // (it wasn't in production either, until the deploy right before this bug
  // surfaced) — this only runs where one happens to be available, and is
  // skipped elsewhere rather than failing the suite.
  const ffmpegBin = findFfmpegWithDrawtext();
  (ffmpegBin ? it : it.skip)(
    "produces a filter chain ffmpeg's own parser accepts for the exact chain that crashed production",
    () => {
      const bullets = [
        "Wrong username or password: generic 'invalid credentials'",
        "Account suspended or not yet active: same generic error",
        "A network problem: a distinct 'network error' message",
        "Too many attempts from your network: 'too many requests'",
        "None of these reveal which part was actually wrong",
      ];
      const filters = bullets.map((b, i) => {
        const truncated = b.length > 55 ? b.slice(0, 55) + "…" : b;
        const y = 165 + i * 52;
        // A nonexistent fontfile is fine here — drawtext falls back to a
        // system default via fontconfig rather than erroring; only the
        // filtergraph *syntax* is under test.
        return `drawtext=text='• ${esc(truncated)}':fontfile='/nonexistent/font.ttf':x=28:y=${y}:fontcolor=white:fontsize=22`;
      });
      const vf = filters.join(",");

      let stderr = "";
      try {
        execSync(
          `${ffmpegBin} -y -f lavfi -i "color=c=black:s=1280x720:r=1" -t 0.05 -vf "${vf}" -f null -`,
          { stdio: "pipe" },
        );
      } catch (err) {
        stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
      }
      expect(stderr).not.toMatch(/No option name|Error parsing a filter description|Error parsing filterchain|Unable to parse option value/);
    },
  );
});
