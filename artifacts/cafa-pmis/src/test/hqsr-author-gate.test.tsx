/**
 * HQ Sector Report Author Gate — Frontend Tests (HQSR-AUTH-FE-01 through FE-07)
 *
 * Verifies that:
 *  1. canAuthorHqSectorReport() classifies approved vs blocked roles
 *     (TC + super_admin approved; SPC excluded while fallback is deferred)
 *  2. The canCreate derivation used by reports.tsx hides the HQ Sector create
 *     action for blocked roles and shows it for approved roles.
 */

import { describe, it, expect } from "vitest";
import { canAuthorHqSectorReport, canAuthorProjectReport } from "../lib/permissions";
import { REPORT_WORKFLOWS } from "@workspace/report-transitions";

describe("canAuthorHqSectorReport — pure function", () => {
  it("HQSR-AUTH-FE-01: sector-assigned technical_coordinator → true", () => {
    expect(canAuthorHqSectorReport("technical_coordinator", "WASH")).toBe(true);
    expect(canAuthorHqSectorReport("technical_coordinator", "WASH,Health")).toBe(true);
  });
  it("TC with no assigned sectors fails closed → false", () => {
    expect(canAuthorHqSectorReport("technical_coordinator", null)).toBe(false);
    expect(canAuthorHqSectorReport("technical_coordinator", "")).toBe(false);
    expect(canAuthorHqSectorReport("technical_coordinator", " , ")).toBe(false);
    expect(canAuthorHqSectorReport("technical_coordinator")).toBe(false);
  });
  it("HQSR-AUTH-FE-07: super_admin → true", () => {
    expect(canAuthorHqSectorReport("super_admin")).toBe(true);
  });
  it("HQSR-AUTH-FE-03: state_program_officer → false", () => {
    expect(canAuthorHqSectorReport("state_program_officer")).toBe(false);
  });
  it("HQSR-AUTH-FE-04: state_office_manager → false", () => {
    expect(canAuthorHqSectorReport("state_office_manager")).toBe(false);
  });
  it("HQSR-AUTH-FE-05: program_manager → true (Full Operational Access override, Task #373)", () => {
    // PM holds Full Operational Access; HQSR authoring is approved by #373.
    // Backend still requires a canonical sector in the body — the sector is
    // derived from the report payload, not the user's profile sector.
    expect(canAuthorHqSectorReport("program_manager")).toBe(true);
  });
  it("HQSR-AUTH-FE-06: executive_director → false", () => {
    expect(canAuthorHqSectorReport("executive_director")).toBe(false);
  });
  it("SPC fallback enabled (HQSR-BD-1/BD-6): senior_program_coordinator → true (backend vacancy check is authoritative)", () => {
    expect(canAuthorHqSectorReport("senior_program_coordinator")).toBe(true);
  });
  it("viewer / undefined → false", () => {
    expect(canAuthorHqSectorReport("viewer")).toBe(false);
    expect(canAuthorHqSectorReport(undefined)).toBe(false);
  });
});

/**
 * Mirrors the canCreate derivation in reports.tsx:
 *
 *   const canCreate = hasPerm(perms, "reports.create") && (
 *     lockedType === "project" || lockedType === "activity"
 *       ? VALID_PROJECT_REPORT_AUTHOR_ROLES.has(userRole)
 *       : lockedType === "hq_sector"
 *         ? canAuthorHqSectorReport(userRole)
 *         : true
 *   );
 */
function deriveCanCreate(opts: { perms: string[]; lockedType: string; userRole: string; userSector?: string | null }): boolean {
  const hasPerm = (p: string[], perm: string) => p.includes("*") || p.includes(perm);
  return (
    hasPerm(opts.perms, "reports.create") &&
    (opts.lockedType === "project" || opts.lockedType === "activity"
      ? canAuthorProjectReport(opts.userRole)
      : opts.lockedType === "hq_sector"
        ? canAuthorHqSectorReport(opts.userRole, opts.userSector)
        : true)
  );
}

describe("HQ Sector create visibility — canCreate derivation", () => {
  const HQ = "hq_sector";

  it("TC with reports.create + assigned sector sees HQ Sector create", () => {
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: HQ, userRole: "technical_coordinator", userSector: "WASH" })).toBe(true);
  });
  it("TC with no assigned sector does NOT see HQ Sector create (fail closed)", () => {
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: HQ, userRole: "technical_coordinator", userSector: null })).toBe(false);
  });
  it("super_admin (wildcard) sees HQ Sector create", () => {
    expect(deriveCanCreate({ perms: ["*"], lockedType: HQ, userRole: "super_admin" })).toBe(true);
  });
  it("SPC sees HQ Sector create (fallback enabled; backend vacancy check decides per sector)", () => {
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: HQ, userRole: "senior_program_coordinator" })).toBe(true);
  });
  it("PM sees HQ Sector create (Full Operational Access, Task #373)", () => {
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: HQ, userRole: "program_manager" })).toBe(true);
  });
  it("SPO / SOM / ED / viewer do not see HQ Sector create", () => {
    for (const role of ["state_program_officer", "state_office_manager", "executive_director", "viewer"]) {
      expect(deriveCanCreate({ perms: ["reports.create"], lockedType: HQ, userRole: role })).toBe(false);
    }
  });
  it("HQSR-AUTH-FE-02 (regression): TC still sees project/activity create; program_state visibility unchanged", () => {
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: "project", userRole: "technical_coordinator" })).toBe(true);
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: "activity", userRole: "technical_coordinator" })).toBe(true);
    expect(deriveCanCreate({ perms: ["reports.create"], lockedType: "program_state", userRole: "state_program_officer" })).toBe(true);
  });
});

/**
 * HQSR coordination-review permission — no longer a hand-mirrored shadow copy.
 * transitionsFor() (reports.tsx) now derives this directly from
 * @workspace/report-transitions's REPORT_WORKFLOWS, the exact same table
 * routes/reports.ts enforces. This test imports the real function so it can
 * never silently drift from production again — the failure mode that let the
 * OLD hand-mirrored version here keep asserting a workflow_path='spc_fallback'
 * exception (PM reviews via reports.approve.final) years after the backend
 * generalised PM's coordination-review access to reports.approve.coordination
 * for ALL hq_sector reports via Full Operational Access (Task #373).
 */
function hqsrCoordPerm(reportType: string): string {
  return REPORT_WORKFLOWS[reportType].coordination_review.perm;
}
const hasPermMirror = (perms: string[], perm: string) => perms.includes("*") || perms.includes(perm);
// Real production permission facts (middlewares/currentUser.ts): PM holds ALL
// THREE of reports.approve.{technical,coordination,final} via Full Operational
// Access; SPC holds only reports.approve.coordination.
const PM_PERMS = ["reports.update", "reports.approve.coordination", "reports.approve.final"];
const SPC_PERMS = ["reports.update", "reports.approve.coordination"];

describe("HQSR coordination-review action visibility (HQSR-FB-FE)", () => {
  it("HQSR-FB-FE-02: PM sees coordination action on a spc_fallback report", () => {
    expect(hasPermMirror(PM_PERMS, hqsrCoordPerm("hq_sector"))).toBe(true);
  });
  it("HQSR-FB-FE-03: PM ALSO sees coordination action on a TC-authored (workflow_path null) report — Full Operational Access is not path-dependent", () => {
    // Corrected behaviour: the coordination permission is unconditional per
    // report type, not narrowed by workflow_path — matching the backend,
    // which never differentiated here after Task #373.
    expect(hasPermMirror(PM_PERMS, hqsrCoordPerm("hq_sector"))).toBe(true);
  });
  it("SPC (even as the spc_fallback report's own author) sees the coordination action — visibility is permission-based, not author-based", () => {
    // Corrected behaviour: SPC holds reports.approve.coordination, the actual
    // required permission, so the button renders for them too. Self-review
    // prevention for non-PM/non-super_admin authors is enforced server-side
    // (routes/reports.ts's author_id guard), not by hiding the button behind
    // a permission SPC was never meant to lack.
    expect(hasPermMirror(SPC_PERMS, hqsrCoordPerm("hq_sector"))).toBe(true);
  });
  it("SPC sees coordination action on TC-authored hq_sector report", () => {
    expect(hasPermMirror(SPC_PERMS, hqsrCoordPerm("hq_sector"))).toBe(true);
  });
  it("non-hq_sector simple-chain reports keep the same coordination perm (PM and SPC both see it)", () => {
    expect(hqsrCoordPerm("program_state")).toBe("reports.approve.coordination");
    expect(hasPermMirror(PM_PERMS, hqsrCoordPerm("program_state"))).toBe(true);
    expect(hasPermMirror(SPC_PERMS, hqsrCoordPerm("program_state"))).toBe(true);
  });
  it("super_admin (wildcard) sees the action regardless of workflow_path", () => {
    expect(hasPermMirror(["*"], hqsrCoordPerm("hq_sector"))).toBe(true);
  });
});
