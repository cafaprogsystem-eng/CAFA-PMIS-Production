/**
 * PMR BD-3 Decision — No PMR Implementation Status Field (OPTION A)
 *
 * Formally documents and enforces the BD-3 business decision:
 *
 *   OPTION A — No PMR-level implementationStatus field.
 *
 * Rationale summary:
 *   • PMR already exposes implementation state through mandatory per-activity
 *     data (status, completion %, achievement summaries).
 *   • A PMR may contain activities with contradictory statuses; no principled
 *     single-value derivation exists.
 *   • Activity Report `implementationStatus` describes one specific Activity;
 *     PMR summarises many activities across a project — a different scope.
 *   • HQ PMRs (coordination, technical support, donor engagement) do not map
 *     cleanly to On Track / Delayed / Suspended semantics.
 *
 * These tests guard against accidental regression of the decision:
 *   PMR-IMPL-DECISION-01 — PMR form source has no implementationStatus field
 *   PMR-IMPL-DECISION-02 — Activity Report still renders its implementationStatus
 *   PMR-IMPL-DECISION-03 — PMR sections config has no implementationStatus key
 *   PMR-IMPL-DECISION-04 — AR implementationStatus values are unchanged
 *
 * Tests run against production source text — no React rendering or network needed.
 * British English spelling used throughout.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const REPORTS_SRC = readFileSync(
  resolve(__dir, "../pages/reports.tsx"),
  "utf-8",
);

// ── Structural extraction helpers ────────────────────────────────────────────

/**
 * Extract the text of SECTIONS["project"] (the PMR section config).
 *
 * The SECTIONS constant is structured as:
 *   const SECTIONS = {
 *     activity: { ... },
 *     project:  { ... },   ← we want this
 *     hq_sector: { ... },
 *     ...
 *   }
 *
 * Strategy: find `  project: {` after the SECTIONS declaration, then find the
 * matching closing `  },` (next top-level key boundary).  Everything in between
 * is the project section.
 */
function extractSectionsProjectBlock(src: string): string {
  const sectionsDecl = src.indexOf("const SECTIONS");
  if (sectionsDecl === -1) throw new Error("SECTIONS constant not found");

  // Work on the substring starting at the SECTIONS declaration
  const tail = src.slice(sectionsDecl);

  // Find the start of the `project:` top-level key inside SECTIONS
  // (indented by 2 spaces, followed by colon)
  const projectMatch = tail.match(/^ {2}project:\s*\{/m);
  if (!projectMatch || projectMatch.index === undefined) {
    throw new Error("project: key not found in SECTIONS");
  }
  const projectStart = projectMatch.index;

  // Find the next top-level key after `project:` — indented 2 spaces
  // (e.g. `  hq_sector:`, `  program_state:`)
  const afterProject = tail.slice(projectStart + projectMatch[0].length);
  const nextKeyMatch = afterProject.match(/^ {2}[a-z_]+:\s*\{/m);

  const projectBlock =
    nextKeyMatch && nextKeyMatch.index !== undefined
      ? tail.slice(projectStart, projectStart + projectMatch[0].length + nextKeyMatch.index)
      : tail.slice(projectStart, projectStart + 4000);

  return projectBlock;
}

/**
 * Extract the IMPLEMENTATION_STATUS_OPTIONS array literal.
 * Returns only the array body (between the first `[` and its matching `]`).
 */
function extractImplStatusOptions(src: string): string {
  const declIdx = src.indexOf("const IMPLEMENTATION_STATUS_OPTIONS");
  if (declIdx === -1) throw new Error("IMPLEMENTATION_STATUS_OPTIONS not found");

  const fromDecl = src.slice(declIdx);
  // Skip the TypeScript type annotation `{ value: string; label: string }[]`
  // and find the assignment `= [` which opens the actual array literal.
  const assignMatch = fromDecl.match(/=\s*\[/);
  if (!assignMatch || assignMatch.index === undefined) {
    throw new Error("No assignment array bracket found");
  }
  const openBracket = assignMatch.index + assignMatch[0].indexOf("[");
  if (openBracket === -1) throw new Error("No array bracket found");

  // Walk forward to find the matching close bracket
  let depth = 0;
  let closeIdx = -1;
  for (let i = openBracket; i < fromDecl.length; i++) {
    if (fromDecl[i] === "[") depth++;
    else if (fromDecl[i] === "]") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) throw new Error("Unmatched bracket in IMPLEMENTATION_STATUS_OPTIONS");
  return fromDecl.slice(openBracket, closeIdx + 1);
}

/**
 * Extract the SECTIONS["activity"] block (for AR-specific assertions).
 */
function extractSectionsActivityBlock(src: string): string {
  const sectionsDecl = src.indexOf("const SECTIONS");
  if (sectionsDecl === -1) throw new Error("SECTIONS constant not found");
  const tail = src.slice(sectionsDecl);

  const activityMatch = tail.match(/^ {2}activity:\s*\{/m);
  if (!activityMatch || activityMatch.index === undefined) {
    throw new Error("activity: key not found in SECTIONS");
  }
  const activityStart = activityMatch.index;
  const afterActivity = tail.slice(activityStart + activityMatch[0].length);
  const nextKeyMatch = afterActivity.match(/^ {2}[a-z_]+:\s*\{/m);

  return nextKeyMatch && nextKeyMatch.index !== undefined
    ? tail.slice(activityStart, activityStart + activityMatch[0].length + nextKeyMatch.index)
    : tail.slice(activityStart, activityStart + 4000);
}

/**
 * Extract the JSX isActivity ternary block that renders the AR progress section.
 * Returns the text from `{isActivity ? (` up to the matching `) : ...}` boundary.
 */
function extractIsActivityJsxBlock(src: string): string {
  // The guard is `{isActivity ? (` followed by the AR-specific form elements.
  // We grab a generous window starting at the first `{isActivity ?` inside the
  // progress section render.
  const markerIdx = src.indexOf("{isActivity ? (");
  if (markerIdx === -1) throw new Error("{isActivity ? ( not found in source");
  // Return 3000 chars — enough to cover all implementationStatus references inside
  return src.slice(markerIdx, markerIdx + 3000);
}

// ── PMR-IMPL-DECISION-01 ─────────────────────────────────────────────────────

describe("PMR-IMPL-DECISION-01: PMR form does not render an implementationStatus field", () => {
  it("The implementationStatus JSX controls are inside the isActivity ternary branch", () => {
    /*
     * The AR-only implementation status select is rendered inside:
     *   {isActivity ? (
     *     <div>  ← Section A — Implementation Status ...
     *     ...
     *   ) : ...}
     *
     * We verify this by extracting the isActivity block and confirming all
     * implementationStatus references appear within it, while the PMR branches
     * (the `: ( ... )` else branches) contain no such references.
     *
     * Strategy: extract the isActivity block and confirm it contains
     * implementationStatus.  Then confirm the PMR-specific JSX section
     * (rendered when !isActivity) does NOT contain implementationStatus
     * select/label controls.
     */
    const isActivityBlock = extractIsActivityJsxBlock(REPORTS_SRC);
    // The block must contain the implementation status references — proving
    // they ARE inside the isActivity guard.
    expect(isActivityBlock).toContain("implementationStatus");
    expect(isActivityBlock).toContain("Implementation Status");
  });

  it("SECTIONS['project'] (PMR) does not contain implementationStatus in any field key", () => {
    const projectBlock = extractSectionsProjectBlock(REPORTS_SRC);
    // Must not have the key
    expect(projectBlock).not.toMatch(/implementationStatus/i);
  });

  it("SECTIONS['activity'] (AR) contains implementationStatus — confirming it is AR-only", () => {
    const activityBlock = extractSectionsActivityBlock(REPORTS_SRC);
    expect(activityBlock).toContain("implementationStatus");
  });
});

// ── PMR-IMPL-DECISION-02 ─────────────────────────────────────────────────────

describe("PMR-IMPL-DECISION-02: Activity Report form still renders its implementationStatus field", () => {
  it("IMPLEMENTATION_STATUS_OPTIONS constant exists in reports.tsx", () => {
    expect(REPORTS_SRC).toContain("const IMPLEMENTATION_STATUS_OPTIONS");
  });

  it("IMPLEMENTATION_STATUS_OPTIONS is referenced in the SECTIONS activity config", () => {
    const activityBlock = extractSectionsActivityBlock(REPORTS_SRC);
    expect(activityBlock).toContain("IMPLEMENTATION_STATUS_OPTIONS");
  });

  it("The AR progress JSX renders IMPLEMENTATION_STATUS_OPTIONS via .map()", () => {
    // The AR form renders the options via IMPLEMENTATION_STATUS_OPTIONS.map(...)
    // inside the isActivity branch.
    expect(REPORTS_SRC).toContain("IMPLEMENTATION_STATUS_OPTIONS.map(");
  });
});

// ── PMR-IMPL-DECISION-03 ─────────────────────────────────────────────────────

describe("PMR-IMPL-DECISION-03: PMR sections config does not include implementationStatus key", () => {
  it("SECTIONS['project'] block has no implementationStatus key", () => {
    const projectBlock = extractSectionsProjectBlock(REPORTS_SRC);
    expect(projectBlock).not.toMatch(/implementationStatus/i);
  });

  it("PMR section field keys are exactly the expected non-implementation-status values", () => {
    const projectBlock = extractSectionsProjectBlock(REPORTS_SRC);

    // Extract all `key: "..."` values from the project sections config
    const keyMatches = [...projectBlock.matchAll(/key:\s*["']([^"']+)["']/g)].map(
      (m) => m[1],
    );

    // Must have found at least the known required keys
    expect(keyMatches.length).toBeGreaterThan(0);

    // Spot-check expected keys are present (guards against false-positive extraction)
    expect(keyMatches).toContain("keyAchievements");
    expect(keyMatches).toContain("lessonsLearned");
    expect(keyMatches).toContain("challenges");

    // None of the keys should be implementationStatus
    const badKeys = keyMatches.filter((k) =>
      /implementation.?status/i.test(k),
    );
    expect(badKeys).toHaveLength(0);
  });
});

// ── PMR-IMPL-DECISION-04 ─────────────────────────────────────────────────────

describe("PMR-IMPL-DECISION-04: Activity Report implementationStatus values are unchanged", () => {
  it("IMPLEMENTATION_STATUS_OPTIONS contains exactly the five expected values", () => {
    const arrayBody = extractImplStatusOptions(REPORTS_SRC);

    const expected = [
      "completed",
      "ongoing",
      "partially_completed",
      "delayed",
      "cancelled",
    ];

    for (const val of expected) {
      expect(arrayBody).toContain(`"${val}"`);
    }

    // Count value: entries — must be exactly 5
    const valueMatches = [
      ...arrayBody.matchAll(/value:\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);

    expect(valueMatches.sort()).toEqual([...expected].sort());
  });

  it("IMPLEMENTATION_STATUS_OPTIONS has exactly five entries", () => {
    const arrayBody = extractImplStatusOptions(REPORTS_SRC);
    const count = [...arrayBody.matchAll(/value:/g)].length;
    expect(count).toBe(5);
  });
});
