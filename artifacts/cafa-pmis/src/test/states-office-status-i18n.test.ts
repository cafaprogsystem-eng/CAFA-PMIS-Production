/**
 * STATES-OFFICE-STATUS-I18N — the desktop table's officeStatus cell rendered
 * the raw enum value ("present"/"absent"/"unknown") directly, with no t()
 * call — unlike operationalStatus right above it in the same row, and unlike
 * officeStatus's own correctly-translated cell in the mobile card view. An
 * Arabic-language user saw the office status in raw English on desktop but
 * correctly in Arabic on mobile.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/states.tsx"), "utf8");

describe("STATES-OFFICE-STATUS-I18N", () => {
  it("the desktop table cell now translates officeStatus the same way the mobile card view already did", () => {
    const occurrences = [...src.matchAll(/\{t\(`statesPage\.office\.\$\{state\.officeStatus\}`\)\}/g)];
    expect(occurrences.length).toBe(2); // desktop table + mobile card
  });

  it("no cell renders the raw officeStatus value directly", () => {
    expect(src).not.toMatch(/<TableCell>\{state\.officeStatus\}<\/TableCell>/);
    expect(src).not.toMatch(/<dd>\{state\.officeStatus\}<\/dd>/);
  });
});
