/**
 * PROFILE-DATE-FORMAT-UNIFIED — Profile's "Member Since"/"Last Login" dates
 * used a local formatTimestamp() that rendered in the *active UI language*
 * (Intl.DateTimeFormat("ar-EG", ...) when the interface was in Arabic),
 * unlike every other date in the app, which is always en-GB and isolated in
 * <bdi dir="ltr">. In Arabic that meant Arabic month names and Arabic-Indic
 * digits on this one page while every other date elsewhere showed Western
 * digits and English month abbreviations. Fixed by adding a timezone-aware
 * variant of the shared en-GB formatDate/formatDateTime helpers (Profile is
 * the only page that needs the user's saved timezone, not the browser's
 * local one) and using that instead of a page-local reimplementation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatDateInTimezone } from "../lib/format";

const profileSrc = readFileSync(resolve(__dirname, "../pages/profile.tsx"), "utf8");

describe("PROFILE-DATE-FORMAT-UNIFIED", () => {
  it("formatDateInTimezone always renders en-GB style regardless of any active UI language", () => {
    // A fixed instant that is unambiguous in both Khartoum (UTC+2) and UTC.
    const instant = "2026-03-15T09:30:00.000Z";
    expect(formatDateInTimezone(instant, "Africa/Khartoum")).toBe("15 Mar 2026, 11:30");
    expect(formatDateInTimezone(instant, "Africa/Khartoum", false)).toBe("15 Mar 2026");
  });

  it("resolves the given IANA timezone, not the caller's local one", () => {
    const instant = "2026-01-01T23:30:00.000Z";
    // UTC+2 rolls over to the next calendar day; UTC does not.
    expect(formatDateInTimezone(instant, "Africa/Khartoum", false)).toBe("02 Jan 2026");
    expect(formatDateInTimezone(instant, "UTC", false)).toBe("01 Jan 2026");
  });

  it("returns the app-wide placeholder for a missing value", () => {
    expect(formatDateInTimezone(null, "UTC")).toBe("—");
    expect(formatDateInTimezone(undefined, "UTC")).toBe("—");
  });

  it("profile.tsx no longer reimplements its own locale-following timestamp formatter", () => {
    expect(profileSrc).not.toContain("function formatTimestamp(");
    expect(profileSrc).not.toContain('new Intl.DateTimeFormat(locale, {');
    expect(profileSrc).toContain("formatDateInTimezone(profile?.createdAt, timezone, false)");
    expect(profileSrc).toContain("formatDateInTimezone(profile?.lastLoginAt, timezone)");
  });

  it("isolates both date fields in a dir=\"ltr\" bdi, matching every other date in the app", () => {
    expect(profileSrc).toContain('<Metadata label={t("profile.memberSince")} value={formatDateInTimezone(profile?.createdAt, timezone, false)} dir="ltr" />');
    expect(profileSrc).toContain('<Metadata label={t("profile.lastLogin")} value={formatDateInTimezone(profile?.lastLoginAt, timezone)} dir="ltr" />');
    expect(profileSrc).toContain('<bdi dir={dir}>{value}</bdi>');
  });
});
