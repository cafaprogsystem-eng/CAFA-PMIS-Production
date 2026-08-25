/**
 * SPR-003/004 — Frontend visibility for State Programme Report authoring.
 *
 * Verifies:
 *  1. canAuthorProgramStateReport() classifies approved vs blocked roles
 *     (SPR-AUTH-FE-01 … 08). Backend remains authoritative — this is UI
 *     visibility only.
 */

import { describe, it, expect } from "vitest";
import { canAuthorProgramStateReport, PROGRAM_STATE_AUTHOR_ROLES } from "../lib/permissions";

describe("canAuthorProgramStateReport — pure function", () => {
  it("SPR-AUTH-FE-01: SPO with assigned state → visible", () => {
    expect(canAuthorProgramStateReport("state_program_officer", 3)).toBe(true);
  });

  it("SPR-AUTH-FE-02: TC → hidden", () => {
    expect(canAuthorProgramStateReport("technical_coordinator", null)).toBe(false);
    expect(canAuthorProgramStateReport("technical_coordinator", 3)).toBe(false);
  });

  it("SPR-AUTH-FE-03: SPC → hidden", () => {
    expect(canAuthorProgramStateReport("senior_program_coordinator", null)).toBe(false);
  });

  it("SPR-AUTH-FE-04: PM → visible (Full Operational Access override, Task #373)", () => {
    // PM holds Full Operational Access; backend requires an explicit stateId
    // (same requirement as super_admin) but the frontend shows the create action.
    expect(canAuthorProgramStateReport("program_manager", null)).toBe(true);
    expect(canAuthorProgramStateReport("program_manager", 5)).toBe(true);
  });

  it("SPR-AUTH-FE-05: ED → hidden", () => {
    expect(canAuthorProgramStateReport("executive_director", null)).toBe(false);
  });

  it("SPR-AUTH-FE-06: super_admin → visible (no state assignment needed)", () => {
    expect(canAuthorProgramStateReport("super_admin", null)).toBe(true);
    expect(canAuthorProgramStateReport("super_admin", undefined)).toBe(true);
  });

  it("SPR-AUTH-FE-07: SOM with assigned state → visible (Option A — backend verifies vacancy)", () => {
    expect(canAuthorProgramStateReport("state_office_manager", 3)).toBe(true);
  });

  it("SPR-AUTH-FE-08: SPO/SOM without assigned state → hidden (fail closed)", () => {
    expect(canAuthorProgramStateReport("state_program_officer", null)).toBe(false);
    expect(canAuthorProgramStateReport("state_program_officer", undefined)).toBe(false);
    expect(canAuthorProgramStateReport("state_office_manager", null)).toBe(false);
  });

  it("viewer / unknown / undefined roles → hidden", () => {
    expect(canAuthorProgramStateReport("viewer", 1)).toBe(false);
    expect(canAuthorProgramStateReport("some_future_role", 1)).toBe(false);
    expect(canAuthorProgramStateReport(undefined, 1)).toBe(false);
  });

  it("author role set matches approved SPR-BD-2 governance exactly (including #373 PM override)", () => {
    // program_manager added by Task #373 (Full Operational Access); all others unchanged.
    expect([...PROGRAM_STATE_AUTHOR_ROLES].sort()).toEqual(
      ["program_manager", "state_office_manager", "state_program_officer", "super_admin"],
    );
  });
});
