/**
 * VIDEO-GENERATOR-VTT-CAPTIONS — captions moved from one static burned-in
 * ASS block per slide (the whole narration, shown for the whole slide) to a
 * WebVTT sidecar of short, sentence-scale cues — the actual complaint in
 * review was that a whole paragraph sat on screen at once, not just its font
 * size. buildCaptionCues() is the pure splitting logic behind that; verified
 * here without needing a real ffmpeg render.
 */
import { describe, expect, it } from "vitest";
import { buildCaptionCues, toVttTime } from "./video-generator";

describe("VIDEO-GENERATOR-VTT-CAPTIONS", () => {
  describe("buildCaptionCues", () => {
    it("keeps a short narration as a single cue", () => {
      expect(buildCaptionCues("Welcome to the training video.")).toEqual([
        "Welcome to the training video.",
      ]);
    });

    it("splits multi-sentence narration into one cue per sentence", () => {
      const cues = buildCaptionCues(
        "The dashboard opens with a row of KPI cards. Every number updates in real time. Click any card to jump to its detail.",
      );
      expect(cues).toEqual([
        "The dashboard opens with a row of KPI cards.",
        "Every number updates in real time.",
        "Click any card to jump to its detail.",
      ]);
    });

    it("word-wraps a single sentence that alone exceeds the per-cue budget, without cutting a word", () => {
      const longSentence =
        "This is a deliberately long single sentence with no punctuation break in the middle of it so the splitter has to fall back to word wrapping instead of a clean sentence boundary.";
      const cues = buildCaptionCues(longSentence, 60);
      expect(cues.length).toBeGreaterThan(1);
      for (const cue of cues) expect(cue.length).toBeLessThanOrEqual(60);
      // Rejoining preserves every word — word-wrapping never drops or splits one.
      expect(cues.join(" ").replace(/\s+/g, " ")).toBe(longSentence.replace(/\s+/g, " "));
    });

    it("trims a whitespace-only narration down to a single empty cue rather than throwing", () => {
      expect(buildCaptionCues("   ")).toEqual([""]);
    });
  });

  describe("toVttTime", () => {
    it("formats sub-hour durations as HH:MM:SS.mmm", () => {
      expect(toVttTime(5.25)).toBe("00:00:05.250");
    });

    it("formats an hour-plus duration correctly", () => {
      expect(toVttTime(3725.5)).toBe("01:02:05.500");
    });

    it("zero-pads minutes and seconds", () => {
      expect(toVttTime(65)).toBe("00:01:05.000");
    });
  });
});
