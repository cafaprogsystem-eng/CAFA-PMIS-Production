/** The header clock follows the app-wide date rule: en-GB in both languages, isolated LTR in Arabic. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const clock = readFileSync("src/components/live-clock.tsx", "utf8");

describe("LIVE-CLOCK-EN-GB", () => {
  it("formats en-GB regardless of the interface language", () => {
    expect(clock).toContain('const dateLocale = "en-GB";');
    expect(clock).not.toMatch(/ar-u-nu-latn|i18n\.language/);
  });
  it("keeps the date in order inside the Arabic header", () => {
    expect(clock).toContain('dir="ltr"');
    expect(clock).toContain('<bdi dir="ltr">{dateFull} · {time}</bdi>');
  });
});
