/**
 * GLOBAL-SEARCH-STATES — States is a first-class top-level module (its own
 * list + detail pages) but was completely absent from global search:
 * searching a state's name surfaced nothing. Fixed by wiring a "states"
 * category through the type, offsets/keyboard-nav, navigate(), and a
 * rendered section, matching every other search category.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../components/global-search.tsx"), "utf8");
const enCommon = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/common.json"), "utf8"));
const arCommon = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/common.json"), "utf8"));

describe("GLOBAL-SEARCH-STATES", () => {
  it("declares a states field on SearchResults and a state FlatItem variant", () => {
    expect(src).toContain("states: SearchState[];");
    expect(src).toContain('{ kind: "state"; data: SearchState }');
  });

  it("counts states toward the total-results check", () => {
    expect(src).toContain("r.states.length");
  });

  it("includes states in the keyboard-navigation flat list and offsets, after every other category", () => {
    expect(src).toContain('...results.states.map((d) => ({ kind: "state" as const, data: d }))');
    const offsetsBlock = src.slice(src.indexOf("const offsets = useMemo"), src.indexOf("}, [results]);"));
    expect(offsetsBlock).toContain("states:");
    expect(offsetsBlock.indexOf("states:")).toBeGreaterThan(offsetsBlock.indexOf("users:"));
  });

  it("navigates to the state's detail page", () => {
    expect(src).toContain('setLocation(`/states/${item.data.id}`)');
  });

  it("renders a States section with a translated group label", () => {
    expect(src).toContain('{results!.states.length > 0 && (');
    expect(src).toContain('label={t("globalSearch.groups.states")}');
  });

  it("has the states group label translated in both locales", () => {
    expect(enCommon.globalSearch.groups.states).toBe("States");
    expect(arCommon.globalSearch.groups.states).toBe("الولايات");
  });

  it("every empty-results fallback includes an empty states array (no missing-field crash)", () => {
    const emptyObjectLiterals = [...src.matchAll(/\{\s*projects:\s*\[\][^}]*\}/g)].map((m) => m[0]);
    expect(emptyObjectLiterals.length).toBeGreaterThan(0);
    for (const literal of emptyObjectLiterals) {
      expect(literal).toContain("states: []");
    }
  });
});
