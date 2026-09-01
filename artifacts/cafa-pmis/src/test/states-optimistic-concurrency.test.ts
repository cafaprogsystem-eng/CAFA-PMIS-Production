/**
 * STATES-OPTIMISTIC-CONCURRENCY — PATCH /states/:stateId had no conflict
 * detection at all: two admins editing the same State's registry fields at
 * once would have the second write silently clobber the first, unlike
 * risks/plans/reports's opt-in x-base-revision pattern. The edit dialog now
 * round-trips the State's own updatedAt as x-base-revision, and a 409
 * revision_mismatch response surfaces a specific, translated conflict
 * message instead of the generic "save failed" fallback.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/states.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/planning.json"), "utf8"));
const ar = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/planning.json"), "utf8"));

describe("STATES-OPTIMISTIC-CONCURRENCY", () => {
  it("useUpdateState is called with the current record's updatedAt as x-base-revision", () => {
    expect(src).toContain('record?.updatedAt ? { request: { headers: { "x-base-revision": record.updatedAt } } } : undefined');
  });

  it("errorMessage surfaces a specific, translated message for a revision_mismatch conflict", () => {
    expect(src).toContain('errorCode === "offline_conflict" && conflictCode === "revision_mismatch"');
    expect(src).toContain('errorMessage(error, t("statesPage.saveFailed"), t("statesPage.revisionConflict"))');
  });

  it("the revisionConflict key exists in both locales with real, distinct copy", () => {
    expect(en.statesPage.revisionConflict).toEqual(expect.any(String));
    expect(ar.statesPage.revisionConflict).toEqual(expect.any(String));
    expect(en.statesPage.revisionConflict).not.toBe(en.statesPage.saveFailed);
  });
});
