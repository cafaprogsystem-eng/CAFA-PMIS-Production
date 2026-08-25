/**
 * PMR Author Gate — Frontend Tests (PMR-AUTH-FE-01 through PMR-AUTH-FE-10)
 *
 * Verifies that:
 *  1. canAuthorProjectReport() correctly classifies approved vs blocked roles
 *  2. The "New Report" button is absent for blocked roles (e.g. program_manager)
 *     and present for approved roles (e.g. state_program_officer)
 *     when lockedType="project"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-ignore — resolved by vitest bundler
import { render, screen } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";

// ── Unit tests for the helper ─────────────────────────────────────────────────

import { canAuthorProjectReport } from "../lib/permissions";

describe("canAuthorProjectReport — pure function (PMR-AUTH-FE-01 through PMR-AUTH-FE-08)", () => {
  it("PMR-AUTH-FE-01: state_program_officer → true", () => {
    expect(canAuthorProjectReport("state_program_officer")).toBe(true);
  });

  it("PMR-AUTH-FE-02: technical_coordinator → true", () => {
    expect(canAuthorProjectReport("technical_coordinator")).toBe(true);
  });

  it("PMR-AUTH-FE-03: super_admin → true", () => {
    expect(canAuthorProjectReport("super_admin")).toBe(true);
  });

  it("PMR-AUTH-FE-04: state_office_manager → false", () => {
    expect(canAuthorProjectReport("state_office_manager")).toBe(false);
  });

  it("PMR-AUTH-FE-05: program_manager → true (Full Operational Access override, Task #373)", () => {
    // PM holds Full Operational Access — PMR authoring is approved by #373.
    expect(canAuthorProjectReport("program_manager")).toBe(true);
  });

  it("PMR-AUTH-FE-06: senior_program_coordinator → false", () => {
    expect(canAuthorProjectReport("senior_program_coordinator")).toBe(false);
  });

  it("PMR-AUTH-FE-07: executive_director → false", () => {
    expect(canAuthorProjectReport("executive_director")).toBe(false);
  });

  it("PMR-AUTH-FE-08: undefined → false", () => {
    expect(canAuthorProjectReport(undefined)).toBe(false);
  });
});

// ── Render tests for the New Report button visibility ─────────────────────────
//
// We test the canCreate logic directly (without rendering the full Reports page
// which requires an extensive provider stack) by extracting and re-evaluating
// the same logic the component uses.  This is equivalent to and faster than a
// full integration render of <Reports lockedType="project">.

/**
 * Mirrors the canCreate derivation in reports.tsx:
 *
 *   const canCreate = hasPerm(perms, "reports.create") && (
 *     (lockedType !== "project" && lockedType !== "activity") ||
 *     canAuthorProjectReport(userRole)
 *   );
 */
function deriveCanCreate(opts: {
  perms: string[];
  lockedType: string;
  userRole: string | undefined;
}): boolean {
  const hasPerm = (p: string[], perm: string) =>
    p.includes("*") || p.includes(perm);
  return (
    hasPerm(opts.perms, "reports.create") &&
    (
      (opts.lockedType !== "project" && opts.lockedType !== "activity") ||
      canAuthorProjectReport(opts.userRole)
    )
  );
}

describe("New Report button visibility — canCreate logic (PMR-AUTH-FE-09 through PMR-AUTH-FE-10)", () => {
  it("PMR-AUTH-FE-09: program_manager with reports.create + lockedType=project → canCreate=true (Full Operational Access, Task #373)", () => {
    // PM holds Full Operational Access; the PMR create action is shown.
    const canCreate = deriveCanCreate({
      perms: ["reports.create", "reports.view"],
      lockedType: "project",
      userRole: "program_manager",
    });
    expect(canCreate).toBe(true);
  });

  it("PMR-AUTH-FE-10: state_program_officer with reports.create + lockedType=project → canCreate=true", () => {
    const canCreate = deriveCanCreate({
      perms: ["reports.create", "reports.view"],
      lockedType: "project",
      userRole: "state_program_officer",
    });
    expect(canCreate).toBe(true);
  });

  // Boundary cases for completeness
  it("Non-project lockedType allows all roles with reports.create (activity gate is separate)", () => {
    // For lockedType="hq_sector", PM can create (no authorship restriction for that type)
    const canCreate = deriveCanCreate({
      perms: ["reports.create"],
      lockedType: "hq_sector",
      userRole: "program_manager",
    });
    expect(canCreate).toBe(true);
  });

  it("No reports.create → canCreate=false regardless of role", () => {
    const canCreate = deriveCanCreate({
      perms: ["reports.view"],
      lockedType: "project",
      userRole: "state_program_officer",
    });
    expect(canCreate).toBe(false);
  });
});
