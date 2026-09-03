/**
 * VIDEO-GENERATOR-CONTENT-FIXES — two small content bugs found reviewing the
 * first real generated video: (1) the outro slide always said "Training
 * Complete" even for a standalone per-module video, wrongly implying the
 * whole system was covered; (2) the English TTS engine reads a bare
 * all-caps "CAFA" letter-by-letter instead of as a name.
 */
import { describe, expect, it } from "vitest";
import { ttsSafeText } from "./video-generator";
import { TRAINING_VIDEO_MODULES } from "./training-video-modules";
import { FULL_VIDEO_MODULE } from "./full-system-video-script";
import { LOGIN_VIDEO_MODULE } from "./login-module-video-script";

describe("VIDEO-GENERATOR-CONTENT-FIXES", () => {
  describe("outro headline per module", () => {
    it("the login module overrides the outro headline so it doesn't claim the whole system is done", () => {
      expect(TRAINING_VIDEO_MODULES[LOGIN_VIDEO_MODULE].outroBigText).toBe("Module Complete");
    });

    it("the full-system video leaves outroBigText unset, keeping the default 'Training Complete'", () => {
      expect(TRAINING_VIDEO_MODULES[FULL_VIDEO_MODULE].outroBigText).toBeUndefined();
    });
  });

  describe("ttsSafeText", () => {
    it("spells CAFA so the TTS engine reads it as a name instead of an acronym", () => {
      expect(ttsSafeText("Welcome to the CAFA Program Management System.")).toBe(
        "Welcome to the Kafa Program Management System.",
      );
    });

    it("replaces every occurrence, not just the first", () => {
      expect(ttsSafeText("CAFA PMIS is part of CAFA.")).toBe("Kafa PMIS is part of Kafa.");
    });

    it("only matches the whole word CAFA, not as a substring of a longer word", () => {
      expect(ttsSafeText("CAFAlon is not a real word")).toBe("CAFAlon is not a real word");
    });

    it("leaves lowercase or mixed-case occurrences alone (only the all-caps brand form is mispronounced)", () => {
      expect(ttsSafeText("cafa.systems and Cafa are untouched")).toBe("cafa.systems and Cafa are untouched");
    });
  });
});
