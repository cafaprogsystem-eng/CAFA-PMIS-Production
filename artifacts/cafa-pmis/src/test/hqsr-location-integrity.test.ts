/**
 * HQSR-004 — HQ Sector Report Location Integrity (Frontend contract tests)
 *
 * HQSR-LOC-FE-01: the HQSR create payload builder never emits top-level
 *                 stateId/projectId (source contract scan of the builder).
 * HQSR-LOC-FE-02: the submitted detail header never renders State or Project
 *                 metadata for report_type = hq_sector (pure mirror of the
 *                 SheetDescription guard in pages/reports.tsx).
 *
 * No React rendering, no HTTP, no DB.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* ══════════════════════════════════════════════════════════════════════════
   HQSR-LOC-FE-01 — create payload contract
══════════════════════════════════════════════════════════════════════════ */

describe("HQSR-LOC-FE-01 — HQSR create payload contains no stateId/projectId", () => {
  it("payload builder's top-level keys exclude stateId and projectId", () => {
    const src = readFileSync(
      resolve(here, "../components/hq-sector-report-form.tsx"),
      "utf8",
    );

    // Locate the payload return block anchored on the hq_sector discriminator.
    const anchor = src.indexOf('reportType: "hq_sector" as const');
    expect(anchor).toBeGreaterThan(-1);

    // Walk back to the enclosing `return {` and forward to its matching brace.
    const returnStart = src.lastIndexOf("return {", anchor);
    expect(returnStart).toBeGreaterThan(-1);
    let depth = 0;
    let end = -1;
    for (let i = src.indexOf("{", returnStart); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    expect(end).toBeGreaterThan(-1);
    const block = src.slice(returnStart, end + 1);

    // Determine the indentation of top-level keys from the anchor line, then
    // assert no top-level stateId/projectId key exists at that indentation.
    const anchorLine = block.split("\n").find((l) => l.includes('reportType: "hq_sector"'))!;
    const indent = anchorLine.match(/^\s*/)![0];
    const topLevelKeys = block
      .split("\n")
      .filter((l) => l.startsWith(indent) && /^\s*[A-Za-z_$][\w$]*\s*:/.test(l) && l.match(/^\s*/)![0] === indent)
      .map((l) => l.trim().split(":")[0]);

    expect(topLevelKeys).toContain("reportType");
    expect(topLevelKeys).not.toContain("stateId");
    expect(topLevelKeys).not.toContain("projectId");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   HQSR-LOC-FE-02 — detail header State/Project metadata guard
   Mirror of the SheetDescription guard in pages/reports.tsx (HQSR-004).
══════════════════════════════════════════════════════════════════════════ */

type DetailReport = {
  reportType: string;
  projectTitle?: string | null;
  stateName?: string | null;
  locationType?: string | null;
};

function shouldShowProjectMeta(r: DetailReport): boolean {
  return r.reportType !== "hq_sector" && !!r.projectTitle;
}

function shouldShowLocationMeta(r: DetailReport): boolean {
  return r.reportType !== "hq_sector" && !!(r.locationType || r.stateName);
}

describe("HQSR-LOC-FE-02 — detail header hides State/Project for hq_sector", () => {
  it("canonical HQSR (null linkage) renders neither", () => {
    const r: DetailReport = { reportType: "hq_sector", projectTitle: null, stateName: null };
    expect(shouldShowProjectMeta(r)).toBe(false);
    expect(shouldShowLocationMeta(r)).toBe(false);
  });

  it("malformed historical HQSR (names present) STILL renders neither", () => {
    const r: DetailReport = { reportType: "hq_sector", projectTitle: "Project X", stateName: "Khartoum", locationType: "state" };
    expect(shouldShowProjectMeta(r)).toBe(false);
    expect(shouldShowLocationMeta(r)).toBe(false);
  });

  it("non-HQSR types keep rendering their metadata", () => {
    const spr: DetailReport = { reportType: "program_state", stateName: "Kassala" };
    const proj: DetailReport = { reportType: "project", projectTitle: "Project Y", locationType: "hq" };
    expect(shouldShowLocationMeta(spr)).toBe(true);
    expect(shouldShowProjectMeta(proj)).toBe(true);
    expect(shouldShowLocationMeta(proj)).toBe(true);
  });

  it("the live guard exists in pages/reports.tsx source", () => {
    const src = readFileSync(resolve(here, "../pages/reports.tsx"), "utf8");
    expect(src).toContain('selected.reportType !== "hq_sector" && selected.projectTitle');
    expect(src).toContain('selected.reportType !== "hq_sector" && (selected.locationType || selected.stateName)');
  });
});
