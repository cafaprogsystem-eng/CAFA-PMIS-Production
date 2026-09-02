/**
 * VIDEO-GENERATOR-SCREENSHOT-FALLBACK — the training-video pipeline is moving
 * from hand-drawn mockup panels to real captured screenshots
 * (scripts/capture-training-screenshots.mjs), but capture runs separately
 * from video generation. resolveScreenshotPath() is what guarantees a
 * generation run started before a screenshot exists still falls back to the
 * slide's drawn `mockup` instead of crashing or silently compositing a
 * missing file.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fsSync from "node:fs";
import type { FullSlide } from "./full-system-video-script";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));

import { resolveScreenshotPath } from "./video-generator";

const baseSlide: FullSlide = {
  type: "content",
  titleEn: "Accessing the System",
  pointsEn: [],
  narrationEn: "narration",
  durationHint: 10,
};

describe("VIDEO-GENERATOR-SCREENSHOT-FALLBACK", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns null when the slide has no screenshotKey at all", () => {
    expect(resolveScreenshotPath({ ...baseSlide })).toBeNull();
  });

  it("returns null when screenshotKey is set but the PNG has not been captured yet", () => {
    vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    const slide = { ...baseSlide, screenshotKey: "login", screenshotLayout: "card" as const };
    expect(resolveScreenshotPath(slide)).toBeNull();
  });

  it("returns the resolved path when the captured screenshot PNG exists on disk", () => {
    vi.spyOn(fsSync, "existsSync").mockReturnValue(true);
    const slide = { ...baseSlide, screenshotKey: "dashboard", screenshotLayout: "full" as const };
    const resolved = resolveScreenshotPath(slide);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatch(/dashboard\.png$/);
    expect(resolved).toContain("training-screenshots");
  });
});
