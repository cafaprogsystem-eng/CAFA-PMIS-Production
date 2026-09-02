/**
 * VIDEO-GENERATOR-CROSSFADE-PLAN — the training-video pipeline switched from
 * hard-cut concat to per-pair xfade/acrossfade transitions, which shrinks the
 * final timeline by the transition length at every merge. computeCrossfadePlan()
 * is the pure offset/duration math behind that (crossfadeConcat() just feeds
 * its output straight into ffmpeg), tested here because there is no ffmpeg
 * binary available to exercise the real merge in this environment.
 */
import { describe, expect, it } from "vitest";
import { computeCrossfadePlan } from "./video-generator";

describe("VIDEO-GENERATOR-CROSSFADE-PLAN", () => {
  it("returns the single duration untouched for one clip", () => {
    expect(computeCrossfadePlan([8], 0.4)).toEqual({ xfades: [], starts: [0], totalDuration: 8 });
  });

  it("returns an empty plan for zero clips", () => {
    expect(computeCrossfadePlan([], 0.4)).toEqual({ xfades: [], starts: [], totalDuration: 0 });
  });

  it("shrinks the total by exactly one transition for two normal-length clips", () => {
    const plan = computeCrossfadePlan([10, 6], 0.4);
    expect(plan.xfades).toEqual([0.4]);
    expect(plan.starts).toEqual([0, 9.6]); // offset = duration[0] - xfade
    expect(plan.totalDuration).toBeCloseTo(10 + 6 - 0.4, 5);
  });

  it("chains correctly across several clips, shrinking by one transition each", () => {
    const durations = [8, 10, 3, 10, 8]; // matches intro/section/divider/content/outro scale
    const plan = computeCrossfadePlan(durations, 0.4);
    expect(plan.starts).toHaveLength(durations.length);
    // starts must be strictly increasing — each clip begins after the previous one
    for (let i = 1; i < plan.starts.length; i++) {
      expect(plan.starts[i]).toBeGreaterThan(plan.starts[i - 1]);
    }
    const naiveSum = durations.reduce((a, b) => a + b, 0);
    expect(plan.totalDuration).toBeCloseTo(naiveSum - (durations.length - 1) * 0.4, 5);
  });

  it("clamps the transition length instead of exceeding a very short clip's own duration", () => {
    // A 3s section-header divider next to the requested 0.4s transition is
    // fine on its own, but a divider shorter than the transition must not
    // produce a negative or nonsensical offset.
    const plan = computeCrossfadePlan([10, 0.3], 0.4);
    expect(plan.xfades[0]).toBeLessThanOrEqual(0.3);
    expect(plan.xfades[0]).toBeGreaterThan(0);
    expect(plan.starts[1]).toBeGreaterThanOrEqual(0);
    expect(plan.totalDuration).toBeGreaterThan(0);
  });

  it("never produces a negative offset even for two very short clips back to back", () => {
    const plan = computeCrossfadePlan([0.2, 0.2], 0.4);
    expect(plan.starts[1]).toBeGreaterThanOrEqual(0);
    expect(plan.xfades[0]).toBeGreaterThan(0);
  });
});
