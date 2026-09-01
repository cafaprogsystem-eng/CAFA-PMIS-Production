/**
 * REPORT-DELETE-PERMISSION-FIX — the Delete Draft action in reports.tsx was
 * gated entirely on canResumeReportDraft(), which checks reports.update — not
 * the backend's dedicated reports.delete permission (DELETE /reports/:reportId
 * requires reports.delete specifically). Every role that currently holds one
 * also holds the other, so this was invisible in practice, but it is the same
 * "checking the wrong-but-coincidentally-matching permission" shape already
 * found and fixed for Plans. A new canDeleteReportDraft() mirrors the
 * backend's actual delete rule (status must be draft; author or Full
 * Operational Access) and gates the Delete menu item independently.
 */
import { describe, it, expect } from "vitest";
import { canResumeReportDraft, canDeleteReportDraft } from "@/pages/reports";

const PM_USER = { id: 1, role: "program_manager" };
const OTHER_USER = { id: 2, role: "state_program_officer" };

function makeReport(overrides: Partial<{ status: string; authorId: number | null }> = {}) {
  return {
    id: 1,
    status: "draft",
    ...overrides,
  } as unknown as Parameters<typeof canDeleteReportDraft>[0];
}

describe("REPORT-DELETE-PERMISSION-FIX: canDeleteReportDraft checks reports.delete, not reports.update", () => {
  it("denies delete for a user who has reports.update but NOT reports.delete (the exact bug scenario)", () => {
    const report = makeReport({ authorId: OTHER_USER.id });
    const updateOnlyPerms = ["reports.update"];
    expect(canResumeReportDraft(report, updateOnlyPerms, OTHER_USER)).toBe(true);
    expect(canDeleteReportDraft(report, updateOnlyPerms, OTHER_USER)).toBe(false);
  });

  it("allows delete for a user who has reports.delete but NOT reports.update", () => {
    const report = makeReport({ authorId: OTHER_USER.id });
    const deleteOnlyPerms = ["reports.delete"];
    expect(canResumeReportDraft(report, deleteOnlyPerms, OTHER_USER)).toBe(false);
    expect(canDeleteReportDraft(report, deleteOnlyPerms, OTHER_USER)).toBe(true);
  });

  it("only applies to draft reports, matching the backend's 409 on non-draft status", () => {
    const submitted = makeReport({ status: "submitted", authorId: OTHER_USER.id });
    expect(canDeleteReportDraft(submitted, ["reports.delete"], OTHER_USER)).toBe(false);
  });

  it("PM (Full Operational Access) can delete any author's draft", () => {
    const report = makeReport({ authorId: OTHER_USER.id });
    expect(canDeleteReportDraft(report, ["reports.delete"], PM_USER)).toBe(true);
  });

  it("a non-full-access author can delete only their own draft", () => {
    const ownDraft = makeReport({ authorId: OTHER_USER.id });
    const othersDraft = makeReport({ authorId: 999 });
    expect(canDeleteReportDraft(ownDraft, ["reports.delete"], OTHER_USER)).toBe(true);
    expect(canDeleteReportDraft(othersDraft, ["reports.delete"], OTHER_USER)).toBe(false);
  });

  it("wildcard (super_admin) always passes", () => {
    const report = makeReport({ authorId: 999 });
    expect(canDeleteReportDraft(report, ["*"], { id: 5, role: "super_admin" })).toBe(true);
  });
});
