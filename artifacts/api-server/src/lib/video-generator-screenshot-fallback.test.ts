/**
 * VIDEO-GENERATOR-SCREENSHOT-FALLBACK — the training-video pipeline is moving
 * from hand-drawn mockup panels to real captured screenshots
 * (scripts/capture-training-screenshots.mjs), but capture runs as a one-off
 * ECS task with no disk shared with the app, so it uploads to S3 instead
 * (routes/training-videos.ts's screenshot-upload route) — resolveScreenshotPath()
 * is what fetches a screenshot from there on first use and caches it locally,
 * and falls back to the slide's drawn `mockup` (never throwing) when a
 * screenshot exists on neither disk nor S3 yet.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import type { FullSlide } from "./full-system-video-script";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("./objectStorage", () => ({
  s3Client: () => ({ send: sendMock }),
  s3Bucket: () => "test-training-bucket",
}));

import { resolveScreenshotPath } from "./video-generator";

const baseSlide: FullSlide = {
  type: "content",
  titleEn: "Accessing the System",
  pointsEn: [],
  narrationEn: "narration",
  durationHint: 10,
};

describe("VIDEO-GENERATOR-SCREENSHOT-FALLBACK", () => {
  beforeEach(() => { sendMock.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns null when the slide has no screenshotKey at all", async () => {
    expect(await resolveScreenshotPath({ ...baseSlide })).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns null when the screenshot is on neither local disk nor S3 yet", async () => {
    vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    sendMock.mockRejectedValue(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }));
    const slide = { ...baseSlide, screenshotKey: "login", screenshotLayout: "card" as const };
    expect(await resolveScreenshotPath(slide)).toBeNull();
  });

  it("returns the resolved path when the captured screenshot PNG already exists on local disk (no S3 call needed)", async () => {
    vi.spyOn(fsSync, "existsSync").mockReturnValue(true);
    const slide = { ...baseSlide, screenshotKey: "dashboard", screenshotLayout: "full" as const };
    const resolved = await resolveScreenshotPath(slide);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatch(/dashboard\.png$/);
    expect(resolved).toContain("training-screenshots");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("downloads from S3 and caches locally when the file isn't on local disk yet", async () => {
    vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);

    async function* fakeBody() {
      yield Buffer.from("fake-png-bytes");
    }
    sendMock.mockResolvedValue({ Body: fakeBody() });

    const slide = { ...baseSlide, screenshotKey: "users", screenshotLayout: "full" as const };
    const resolved = await resolveScreenshotPath(slide);

    expect(resolved).toMatch(/users\.png$/);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    expect(writeFileSpy.mock.calls[0][1]).toEqual(Buffer.from("fake-png-bytes"));
  });
});
