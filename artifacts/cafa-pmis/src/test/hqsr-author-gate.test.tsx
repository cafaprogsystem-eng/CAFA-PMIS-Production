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
 * Mirrors the HQSR coordination-review perm selection in transitionsFor()
 * (reports.tsx): for simple-chain reports, the coordination-stage actions are
 * gated on reports.approve.final when workflow_path = 'spc_fallback' on an
 * hq_sector report (PM is the reviewer via a narrow server-side exception —
 * PM does NOT hold reports.approve.coordination), and on
 * reports.approve.coordination otherwise (SPC reviews TC-authored reports).
 */
function hqsrCoordPerm(reportType: string, workflowPath: string | null): string {
  return reportType === "hq_sector" && workflowPath === "spc_fallback"
    ? "reports.approve.final"
    : "reports.approve.coordination";
}
const hasPermMirror = (perms: string[], perm: string) => perms.includes("*") || perms.includes(perm);
// Real production permission facts (permissionsFor): PM holds final but NOT
// coordination; SPC holds coordination but NOT final.
const PM_PERMS = ["reports.update", "reports.approve.final"];
const SPC_PERMS = ["reports.update", "reports.approve.coordination"];

describe("HQSR coordination-review action visibility (HQSR-FB-FE)", () => {
  it("HQSR-FB-FE-02: PM sees coordination action on spc_fallback report", () => {
    expect(hasPermMirror(PM_PERMS, hqsrCoordPerm("hq_sector", "spc_fallback"))).toBe(true);
  });
  it("HQSR-FB-FE-03: PM does NOT see coordination action on TC-authored (workflow_path null) report", () => {
    expect(hasPermMirror(PM_PERMS, hqsrCoordPerm("hq_sector", null))).toBe(false);
  });
  it("HQSR-FB-FE-04: SPC (author) does not see coordination action on spc_fallback report", () => {
    expect(hasPermMirror(SPC_PERMS, hqsrCoordPerm("hq_sector", "spc_fallback"))).toBe(false);
  });
  it("SPC still sees coordination action on TC-authored hq_sector report", () => {
    expect(hasPermMirror(SPC_PERMS, hqsrCoordPerm("hq_sector", null))).toBe(true);
  });
  it("non-hq_sector simple-chain reports keep the coordination perm (PM unaffected)", () => {
    expect(hqsrCoordPerm("program_state", null)).toBe("reports.approve.coordination");
    expect(hasPermMirror(PM_PERMS, hqsrCoordPerm("program_state", null))).toBe(false);
    expect(hasPermMirror(SPC_PERMS, hqsrCoordPerm("program_state", null))).toBe(true);
  });
  it("super_admin (wildcard) sees the action in both paths", () => {
    expect(hasPermMirror(["*"], hqsrCoordPerm("hq_sector", "spc_fallback"))).toBe(true);
    expect(hasPermMirror(["*"], hqsrCoordPerm("hq_sector", null))).toBe(true);
  });
});
