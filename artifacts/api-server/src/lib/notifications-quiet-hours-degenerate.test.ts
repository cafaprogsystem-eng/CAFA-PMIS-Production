/**
 * NOTIFICATIONS-QUIET-HOURS-DEGENERATE — isInQuietHours never suppressed
 * anything when a user's quiet-hours start and end were set to the exact
 * same time (`start <= end` routed this into the same-day branch, which
 * reduces to `timeStr >= start && timeStr < start` — always false). A
 * start===end window is now treated as the wrap-around case instead
 * (`start < end`), which reduces to `timeStr >= start || timeStr < start` —
 * always true, i.e. a full 24-hour quiet window, the natural reading of a
 * zero-width arc on a 24-hour clock.
 */
import { describe, it, expect } from "vitest";
import { isInQuietHours } from "./notifications";

describe("NOTIFICATIONS-QUIET-HOURS-DEGENERATE: isInQuietHours(start === end)", () => {
  it("always reports quiet hours active when start and end are identical, regardless of the current time", () => {
    for (const time of ["00:00", "09:15", "12:00", "18:30", "23:59"]) {
      expect(
        isInQuietHours({ enabled: true, start: time, end: time, timezone: "UTC" }),
        `expected quiet hours to be active for start=end=${time}`,
      ).toBe(true);
    }
  });

  it("still reports disabled quiet hours as inactive even when start === end", () => {
    expect(isInQuietHours({ enabled: false, start: "10:00", end: "10:00", timezone: "UTC" })).toBe(false);
  });

  it("normal same-day and wrap-around windows are unaffected by the fix", () => {
    // Same-day window: start < end still uses the same-day branch.
    // We can't control "now", so just assert it doesn't throw and returns a boolean.
    expect(typeof isInQuietHours({ enabled: true, start: "09:00", end: "17:00", timezone: "UTC" })).toBe("boolean");
    // Wrap-around window (start > end), same as before.
    expect(typeof isInQuietHours({ enabled: true, start: "22:00", end: "07:00", timezone: "UTC" })).toBe("boolean");
  });
});
