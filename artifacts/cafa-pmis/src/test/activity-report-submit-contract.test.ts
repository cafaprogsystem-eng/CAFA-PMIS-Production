/**
 * Activity Report Submit — Backend Content Gate Contract Tests
 *
 * FIX-08: Pure-logic mirrors of the backend submit transition content gate
 * (routes/reports.ts, action="submit", report_type="activity").
 *
 * These tests validate the design invariants of the content gate without
 * requiring a live HTTP server or database. The mirror logic is extracted
 * directly from the handler (search "report_content_incomplete" in reports.ts).
 *
 * No React, no HTTP, no DB. British English spelling throughout.
 */

import { describe, it, expect } from "vitest";

/* ══════════════════════════════════════════════════════════════════════════
   Mirror of the backend content gate — routes/reports.ts submit handler
   (FIX-08 block: "Backend content gate — modern Activity Reports only")
══════════════════════════════════════════════════════════════════════════ */

type DbReport = {
  title: string | null;
  activityName: string | null;
  sections: Record<string, unknown> | null;
};

type ContentGateResult =
  | { ok: true }
  | { ok: false; status: 422; error: "report_content_incomplete"; fields: string[] };

/**
 * Mirrors the backend content gate added in FIX-08.
 * Returns ok:true for legacy records and non-activity types.
 * Returns 422 for modern Activity Reports missing required fields.
 */
function checkActivityReportContent(
  action: string,
  reportType: string,
  report: DbReport,
): ContentGateResult {
  if (action !== "submit") return { ok: true };
  if (reportType !== "activity") return { ok: true };

  const sections = report.sections ?? {};
  const isModern = sections["_schemaVersion"] === "modern";

  if (!isModern) {
    // Legacy records: no content gate — FIX-07 governs
    return { ok: true };
  }

  const contentErrors: string[] = [];
  if (!(report.title ?? "").trim()) contentErrors.push("Report Title is required.");
  if (!(report.activityName ?? "").trim()) contentErrors.push("Report Subject / Activity Name is required.");
  if (!(String(sections["implementationStatus"] ?? "")).trim()) contentErrors.push("Implementation Status is required.");
  if (!(String(sections["implementationSummary"] ?? "")).trim()) contentErrors.push("Implementation Summary is required.");
  if (!(String(sections["resultsAchieved"] ?? "")).trim()) contentErrors.push("Results Achieved is required.");
  if (!(String(sections["lessonsLearned"] ?? "")).trim()) contentErrors.push("Lessons Learned is required.");

  if (contentErrors.length > 0) {
    return { ok: false, status: 422, error: "report_content_incomplete", fields: contentErrors };
  }
  return { ok: true };
}

/* ══════════════════════════════════════════════════════════════════════════
   Mirror of the PATCH _schemaVersion immutability guard
   (routes/reports.ts PATCH handler, FIX-08 block)
══════════════════════════════════════════════════════════════════════════ */

/**
 * Mirrors the backend _schemaVersion immutability guard.
 * Returns the effective sections that will be written to the database.
 * Preserves _schemaVersion:"modern" when the existing report has it set.
 */
function applySchemaVersionGuard(opts: {
  reportType: string;
  isSuperAdmin: boolean;
  existingSections: Record<string, unknown> | null;
  incomingSections: Record<string, unknown> | undefined;
}): Record<string, unknown> | undefined {
  if (opts.incomingSections === undefined) return undefined; // not being updated

  if (
    opts.reportType === "activity" &&
    !opts.isSuperAdmin &&
    opts.incomingSections !== undefined
  ) {
    const existing = opts.existingSections ?? {};
    if (existing["_schemaVersion"] === "modern") {
      const incoming = opts.incomingSections;
      if (incoming["_schemaVersion"] !== "modern") {
        return { ...incoming, _schemaVersion: "modern" };
      }
    }
  }

  return opts.incomingSections;
}

/* ══════════════════════════════════════════════════════════════════════════
   Test helpers
══════════════════════════════════════════════════════════════════════════ */

function completeModernReport(): DbReport {
  return {
    title: "Monthly Activity Report — July 2026",
    activityName: "Community Health Outreach",
    sections: {
      _schemaVersion: "modern",
      implementationStatus: "completed",
      implementationSummary: "All planned activities were carried out in the target localities.",
      resultsAchieved: "Significant improvement in health knowledge and hygiene practices.",
      hasBeneficiaryReach: "yes",
      hasChallenges: "no",
      lessonsLearned: "Early community engagement is critical to achieving planned targets.",
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   §1 — Content gate: non-submit actions pass through
══════════════════════════════════════════════════════════════════════════ */

describe("§1 — Content gate: non-submit actions are not gated", () => {
  it("AR-CG-01: technical_review action → ok (no content check)", () => {
    const report: DbReport = { title: "", activityName: "", sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("technical_review", "activity", report).ok).toBe(true);
  });

  it("AR-CG-02: coordination_review action → ok", () => {
    const report: DbReport = { title: "", activityName: "", sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("coordination_review", "activity", report).ok).toBe(true);
  });

  it("AR-CG-03: final_approve action → ok (content gate only for submit)", () => {
    const report: DbReport = { title: "", activityName: "", sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("final_approve", "activity", report).ok).toBe(true);
  });

  it("AR-CG-04: request_revision action → ok", () => {
    const report: DbReport = { title: "", activityName: "", sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("request_revision", "activity", report).ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §2 — Content gate: non-activity report types pass through
══════════════════════════════════════════════════════════════════════════ */

describe("§2 — Content gate: non-activity report types are not gated", () => {
  it("AR-CG-05: project report submit → ok (gating only for activity type)", () => {
    const report: DbReport = { title: "", activityName: null, sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("submit", "project", report).ok).toBe(true);
  });

  it("AR-CG-06: hq_sector report submit → ok", () => {
    const report: DbReport = { title: "", activityName: null, sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("submit", "hq_sector", report).ok).toBe(true);
  });

  it("AR-CG-07: program_state report submit → ok", () => {
    const report: DbReport = { title: "", activityName: null, sections: { _schemaVersion: "modern" } };
    expect(checkActivityReportContent("submit", "program_state", report).ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §3 — Content gate: legacy Activity Records pass through
══════════════════════════════════════════════════════════════════════════ */

describe("§3 — Content gate: legacy Activity Records are exempt (FIX-07 preserved)", () => {
  it("AR-CG-08: legacy record (no _schemaVersion) with all fields missing → ok", () => {
    const report: DbReport = {
      title: "",
      activityName: "",
      sections: { someOldField: "historical content" }, // no _schemaVersion
    };
    expect(checkActivityReportContent("submit", "activity", report).ok).toBe(true);
  });

  it("AR-CG-09: legacy record with null sections → ok", () => {
    const report: DbReport = { title: "", activityName: "", sections: null };
    expect(checkActivityReportContent("submit", "activity", report).ok).toBe(true);
  });

  it("AR-CG-10: legacy record with _schemaVersion other than 'modern' → ok", () => {
    const report: DbReport = {
      title: "",
      activityName: "",
      sections: { _schemaVersion: "v1-legacy" },
    };
    expect(checkActivityReportContent("submit", "activity", report).ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §4 — Content gate: modern Activity Report — valid record passes
══════════════════════════════════════════════════════════════════════════ */

describe("§4 — Content gate: modern Activity Report — complete record passes", () => {
  it("AR-CG-11: fully-populated modern report → ok (HTTP 200 equivalent)", () => {
    const result = checkActivityReportContent("submit", "activity", completeModernReport());
    expect(result.ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §5 — Content gate: modern Activity Report — required field checks
══════════════════════════════════════════════════════════════════════════ */

describe("§5 — Content gate: modern Activity Report — required field enforcement", () => {
  it("AR-CG-12: missing title → 422 report_content_incomplete", () => {
    const report = { ...completeModernReport(), title: "" };
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toBe("report_content_incomplete");
      expect(result.fields.some(f => f.includes("Report Title"))).toBe(true);
    }
  });

  it("AR-CG-13: null title → 422", () => {
    const report = { ...completeModernReport(), title: null };
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
  });

  it("AR-CG-14: missing activityName → 422", () => {
    const report = { ...completeModernReport(), activityName: "" };
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.some(f => f.includes("Activity Name"))).toBe(true);
    }
  });

  it("AR-CG-15: missing implementationStatus → 422", () => {
    const report = completeModernReport();
    delete (report.sections as Record<string, unknown>)["implementationStatus"];
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.some(f => f.includes("Implementation Status"))).toBe(true);
    }
  });

  it("AR-CG-16: blank implementationStatus → 422", () => {
    const report = { ...completeModernReport(), sections: { ...completeModernReport().sections, implementationStatus: "   " } };
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
  });

  it("AR-CG-17: missing implementationSummary → 422", () => {
    const report = completeModernReport();
    delete (report.sections as Record<string, unknown>)["implementationSummary"];
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.some(f => f.includes("Implementation Summary"))).toBe(true);
    }
  });

  it("AR-CG-18: missing resultsAchieved → 422", () => {
    const report = completeModernReport();
    delete (report.sections as Record<string, unknown>)["resultsAchieved"];
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.some(f => f.includes("Results Achieved"))).toBe(true);
    }
  });

  it("AR-CG-19: missing lessonsLearned → 422", () => {
    const report = completeModernReport();
    delete (report.sections as Record<string, unknown>)["lessonsLearned"];
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.some(f => f.includes("Lessons Learned"))).toBe(true);
    }
  });

  it("AR-CG-20: all required fields missing → 422 with all field names listed", () => {
    const report: DbReport = {
      title: "",
      activityName: "",
      sections: { _schemaVersion: "modern" }, // missing all required content
    };
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.length).toBe(6); // title, activityName, implementationStatus, implementationSummary, resultsAchieved, lessonsLearned
    }
  });

  it("AR-CG-21: whitespace-only title → 422", () => {
    const report = { ...completeModernReport(), title: "   " };
    const result = checkActivityReportContent("submit", "activity", report);
    expect(result.ok).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §6 — _schemaVersion immutability guard (PATCH handler)
══════════════════════════════════════════════════════════════════════════ */

describe("§6 — PATCH _schemaVersion immutability guard", () => {
  it("AR-SV-01: modern report, PATCH removes _schemaVersion → marker preserved", () => {
    const result = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern", implementationStatus: "completed" },
      incomingSections: { implementationStatus: "ongoing" }, // no _schemaVersion
    });
    expect(result!["_schemaVersion"]).toBe("modern");
  });

  it("AR-SV-02: modern report, PATCH sends _schemaVersion:modern → passes through", () => {
    const result = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern" },
      incomingSections: { _schemaVersion: "modern", implementationStatus: "completed" },
    });
    expect(result!["_schemaVersion"]).toBe("modern");
  });

  it("AR-SV-03: legacy report (no existing marker), PATCH without marker → no marker added", () => {
    const result = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { oldField: "value" }, // no _schemaVersion
      incomingSections: { oldField: "updated value" },
    });
    expect(result!["_schemaVersion"]).toBeUndefined();
  });

  it("AR-SV-04: non-activity report, PATCH removes _schemaVersion → guard does not fire", () => {
    const result = applySchemaVersionGuard({
      reportType: "project",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern" },
      incomingSections: { someField: "value" }, // no _schemaVersion
    });
    // Guard only applies to activity type; project type unaffected
    expect(result!["_schemaVersion"]).toBeUndefined();
  });

  it("AR-SV-05: super_admin PATCH removes _schemaVersion → allowed (admin bypass)", () => {
    const result = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: true, // super_admin can remove marker for admin corrections
      existingSections: { _schemaVersion: "modern" },
      incomingSections: { someField: "value" }, // no _schemaVersion
    });
    // super_admin bypass means the guard does not add the marker back
    expect(result!["_schemaVersion"]).toBeUndefined();
  });

  it("AR-SV-06: sections not being updated (undefined) → returns undefined (no change)", () => {
    const result = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern" },
      incomingSections: undefined,
    });
    expect(result).toBeUndefined();
  });

  it("AR-SV-07: modern report, PATCH to clear other fields but preserve marker → other fields updated, marker kept", () => {
    const result = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern", implementationStatus: "completed", implementationSummary: "Done" },
      incomingSections: { implementationStatus: "ongoing" }, // cleared summary, removed marker
    });
    expect(result!["_schemaVersion"]).toBe("modern");
    expect(result!["implementationStatus"]).toBe("ongoing");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §7 — End-to-end: marker removal attempt cannot bypass content gate
══════════════════════════════════════════════════════════════════════════ */

describe("§7 — End-to-end: marker removal cannot bypass backend content gate", () => {
  it("AR-E2E-01: client PATCHes away marker → guard restores it → submit gate fires", () => {
    // Step 1: client tries to PATCH sections without the marker
    const patchedSections = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern" },
      incomingSections: { implementationStatus: "ongoing" }, // client omits marker
    });
    // Guard restored the marker
    expect(patchedSections!["_schemaVersion"]).toBe("modern");

    // Step 2: the submit transition reads the DB row (which has the marker thanks to the guard)
    const dbRowAfterPatch: DbReport = {
      title: "Test Report",
      activityName: "Test Activity",
      sections: patchedSections!,
    };
    // Simulate report with missing required content fields
    delete (dbRowAfterPatch.sections as Record<string, unknown>)["implementationSummary"];
    const result = checkActivityReportContent("submit", "activity", dbRowAfterPatch);

    // Because the marker was preserved, the gate fires and rejects the submission
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toBe("report_content_incomplete");
    }
  });

  it("AR-E2E-02: complete modern report flows through both guard and gate", () => {
    // PATCH preserves existing marker
    const patchedSections = applySchemaVersionGuard({
      reportType: "activity",
      isSuperAdmin: false,
      existingSections: { _schemaVersion: "modern" },
      incomingSections: {
        _schemaVersion: "modern",
        implementationStatus: "completed",
        implementationSummary: "Carried out as planned.",
        resultsAchieved: "All targets met.",
        lessonsLearned: "Stakeholder buy-in is critical.",
      },
    });

    // Submit gate passes for a fully-populated report
    const dbRow: DbReport = {
      title: "July Report",
      activityName: "Health Programme",
      sections: patchedSections!,
    };
    const result = checkActivityReportContent("submit", "activity", dbRow);
    expect(result.ok).toBe(true);
  });
});
