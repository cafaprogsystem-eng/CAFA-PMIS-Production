/**
 * FIX-08: Activity Report Backend Content Gate — Route-level HTTP Tests
 *
 * Covers:
 *  A) PATCH _schemaVersion immutability guard — null sections bypass rejected
 *  B) Submit transition content gate — 422 for modern records missing required fields
 *  C) Submit transition — legacy records always pass through (no content gate)
 *  D) Full-parity checks — every required-field block enforced by backend matches frontend
 *
 * Uses Express + supertest against the real route handler with mocked @workspace/db.
 * Follows the pattern established in reports-security.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before any dynamic import of the route
// ─────────────────────────────────────────────────────────────────────────────

const mockPoolQuery    = vi.fn(); // pool.query — direct calls (module-init, getReportSector, UPDATE, final load)
const mockClientQuery  = vi.fn(); // client.query — transactional calls (BEGIN/COMMIT/FOR UPDATE/SELECT/ROLLBACK)
const mockClientRelease = vi.fn();
const mockConnect      = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: {
    query:   mockPoolQuery,
    connect: mockConnect,
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:       vi.fn().mockResolvedValue(undefined),
    requirePerm:    () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn().mockReturnValue(["reports.create", "reports.update"]),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Before each test: restore safe defaults so module-init pool.query succeeds
// and the client mock is properly wired.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // mockReset clears calls + implementation; restore a default resolved value so the
  // module-init pool.query("CREATE TABLE IF NOT EXISTS report_attachments ...").catch()
  // doesn't throw when the route module is first imported.
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientRelease.mockReset();
  mockConnect.mockReset().mockImplementation(async () => ({
    query:   mockClientQuery,
    release: mockClientRelease,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake users
// ─────────────────────────────────────────────────────────────────────────────

/** SPO user — has stateId, reports.create perm, no sectorRestriction */
const SPO_USER = {
  id:      42,
  name:    "SPO Test",
  email:   "spo@example.com",
  role:    "state_program_officer",
  stateId: 1,
  sector:  null,
  sectors: [] as string[],
};

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("TEST-APP-ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB mock helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PATCH handler pool.query call order:
 *  [0] SELECT status, sector, project_id, report_type, author_id, sections FROM reports
 *  [1] getReportSector (SELECT r.report_type, ... LEFT JOIN projects, activities)
 *  [2] UPDATE reports SET ...   (if request proceeds past guards)
 *  [3] SELECT reportSelect WHERE r.id = $1  (final state)
 *  [4] approvals query inside withHistory
 */
function mockPatchCurRow(overrides: Partial<{
  status: string;
  sector: string | null;
  projectId: number | null;
  reportType: string;
  authorId: number;
  sections: Record<string, unknown> | null;
}> = {}) {
  return {
    rows: [{
      status:     "draft",
      sector:     "WASH",
      projectId:  null,
      reportType: "activity",
      authorId:   42,
      sections:   { _schemaVersion: "modern" },
      ...overrides,
    }],
  };
}

/**
 * Transition handler query sequence:
 *   client:  BEGIN → SELECT FOR UPDATE → SELECT content → ROLLBACK|UPDATE → INSERT → COMMIT
 *   pool:    getReportSector → reportSelect (on success) → withHistory
 *
 * mockClientSequence sets up the first three client queries; remaining use the
 * default .mockResolvedValue({ rows: [] }) from beforeEach.
 */
function mockClientSequence(lockRow: Record<string, unknown>, contentRow: Record<string, unknown>) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })           // BEGIN — no meaningful rows
    .mockResolvedValueOnce({ rows: [lockRow] })    // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: [contentRow] }) // SELECT title, activity_name, sections ...
    // Remaining calls (ROLLBACK / UPDATE / INSERT / COMMIT) use the default { rows: [] }
    ;
}

function mockGetReportSector(activitySector = "WASH") {
  return {
    rows: [{
      reportType:      "activity",
      projectId:       null,
      projectSector:   null,
      activitySector,
      effectiveSector: activitySector,
    }],
  };
}

/** Standard lock row for a modern Activity Report in "draft" state */
function modernLockRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status:       "draft",
    reportType:   "activity",
    stateId:      1,
    sector:       "WASH",
    projectId:    null,
    activityId:   10,
    workflowPath: "state_authored",
    authorId:     42,
    ...overrides,
  };
}

/** Complete sections blob for a modern Activity Report that passes all content checks */
function completeSections(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _schemaVersion:        "modern",
    implementationStatus:  "completed",
    implementationSummary: "All planned activities were carried out.",
    actualStartDate:       "2026-07-01",
    actualEndDate:         "2026-07-31",
    resultsAchieved:       "Targets fully met.",
    hasBeneficiaryReach:   "yes",
    hasChallenges:         "no",
    lessonsLearned:        "Early community engagement is key.",
    ...overrides,
  };
}

/** Complete top-level row returned by the content-gate SELECT */
function completeContentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title:                "July 2026 Activity Report",
    activityName:         "Community Health Outreach",
    sections:             completeSections(),
    period:               "2026-07",   // YYYY-MM format → isLegacyPeriod=false → month/year required
    reportingMonth:       7,
    reportingYear:        2026,
    beneficiariesMale:    50,
    beneficiariesFemale:  60,
    beneficiariesBoys:    30,
    beneficiariesGirls:   40,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — PATCH _schemaVersion null-bypass guard
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /reports/:id — FIX-08: _schemaVersion null-bypass guard", () => {
  it("AR-P-01: sections:null on modern Activity Report → 409 modern_schema_version_immutable", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    // Pool query sequence: [0] cur (modern), [1] getReportSector (any)
    mockPoolQuery
      .mockResolvedValueOnce(mockPatchCurRow({ sections: { _schemaVersion: "modern" } }))
      .mockResolvedValue({ rows: [] }); // getReportSector + any further

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ sections: null });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("modern_schema_version_immutable");
  });

  it("AR-P-02: sections:null on legacy Activity Report (no marker) → guard does not fire", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    mockPoolQuery
      .mockResolvedValueOnce(mockPatchCurRow({ sections: { oldField: "historical-value" } })) // no _schemaVersion
      .mockResolvedValueOnce(mockGetReportSector())    // getReportSector
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })   // UPDATE
      .mockResolvedValue({ rows: [] });                // reportSelect + withHistory

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ sections: null });

    // Guard must not fire for legacy records
    expect(res.status).not.toBe(409);
    expect(res.body.error).not.toBe("modern_schema_version_immutable");
  });

  it("AR-P-03: sections without marker on modern report → guard restores marker, request proceeds", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    mockPoolQuery
      .mockResolvedValueOnce(mockPatchCurRow({ sections: { _schemaVersion: "modern", implementationStatus: "completed" } }))
      .mockResolvedValueOnce(mockGetReportSector())
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ sections: { implementationStatus: "ongoing" } }); // marker omitted by client

    // Guard silently restores the marker — request must NOT be rejected with the null-bypass error
    expect(res.status).not.toBe(409);
    expect(res.body.error).not.toBe("modern_schema_version_immutable");
  });

  it("AR-P-04: super_admin sections:null on modern report → allowed (admin bypass)", async () => {
    const superAdmin = { ...SPO_USER, id: 1, role: "super_admin", stateId: null };
    const app = await buildApp(superAdmin as unknown as Record<string, unknown>);

    mockPoolQuery
      .mockResolvedValueOnce(mockPatchCurRow({ sections: { _schemaVersion: "modern" }, authorId: 1 }))
      .mockResolvedValueOnce(mockGetReportSector())
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ sections: null });

    // super_admin bypass — guard does not fire
    expect(res.status).not.toBe(409);
    expect(res.body.error).not.toBe("modern_schema_version_immutable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — Submit transition: legacy records are exempt
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — FIX-08: legacy records bypass content gate", () => {
  it("AR-T-01: submit legacy Activity Report (no _schemaVersion) with empty content → not 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    const legacyContentRow = {
      title:          "",          // blank — would fail modern gate
      activityName:   "",          // blank — would fail modern gate
      sections:       { _schemaVersion: "legacy-v1" }, // not "modern"
      reportingMonth: null,
      reportingYear:  null,
      beneficiariesMale: null, beneficiariesFemale: null,
      beneficiariesBoys: null, beneficiariesGirls:  null,
    };

    mockClientSequence(modernLockRow(), legacyContentRow);
    // pool.query sequence: [0] getReportSector (fires before client queries in transition handler)
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Gate did not fire for legacy — must not be 422 report_content_incomplete
    expect(res.body.error).not.toBe("report_content_incomplete");
    expect(res.status).not.toBe(422);
  });

  it("AR-T-02: submit Activity Report with null sections (no marker) → not 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    const nullSectionsRow = {
      title:          "Historical AR",
      activityName:   "Old Activity",
      sections:       null,   // null → no marker → legacy path
      reportingMonth: null,
      reportingYear:  null,
      beneficiariesMale: null, beneficiariesFemale: null,
      beneficiariesBoys: null, beneficiariesGirls:  null,
    };

    mockClientSequence(modernLockRow(), nullSectionsRow);
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.body.error).not.toBe("report_content_incomplete");
    expect(res.status).not.toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — Submit transition: modern records — required field enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — FIX-08: modern Activity Report content gate", () => {
  it("AR-T-03: missing title → 422 report_content_incomplete", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), completeContentRow({ title: "" }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.some((f: string) => f.includes("Report Title"))).toBe(true);
  });

  it("AR-T-04: missing activityName → 422 with activityName field listed", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), completeContentRow({ activityName: "" }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.some((f: string) => f.includes("Activity Name"))).toBe(true);
  });

  it("AR-T-05: missing reportingMonth → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), completeContentRow({ reportingMonth: null }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.some((f: string) => f.includes("Reporting Month"))).toBe(true);
  });

  it("AR-T-06: missing reportingYear → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), completeContentRow({ reportingYear: null }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Reporting Year"))).toBe(true);
  });

  it("AR-T-07: missing implementationStatus → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections();
    delete (sections as Record<string, unknown>)["implementationStatus"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Implementation Status"))).toBe(true);
  });

  it("AR-T-08: missing implementationSummary → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections();
    delete (sections as Record<string, unknown>)["implementationSummary"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Implementation Summary"))).toBe(true);
  });

  it("AR-T-09: actualEndDate before actualStartDate → 422 date_order error", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections({ actualStartDate: "2026-07-20", actualEndDate: "2026-07-10" });
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Actual End Date"))).toBe(true);
  });

  it("AR-T-10: actualEndDate === actualStartDate → date-order error absent", async () => {
    // Same-day period is valid — date-order error must NOT appear
    // Use a row missing resultsAchieved so 422 still fires (confirming gate ran), but not for dates
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections({ actualStartDate: "2026-07-15", actualEndDate: "2026-07-15" });
    delete (sections as Record<string, unknown>)["resultsAchieved"]; // trigger 422 via different field
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    // Date-order error must NOT appear for same-day dates
    expect(res.body.fields.every((f: string) => !f.includes("Actual End Date"))).toBe(true);
  });

  it("AR-T-11: missing resultsAchieved → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections();
    delete (sections as Record<string, unknown>)["resultsAchieved"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Results Achieved"))).toBe(true);
  });

  it("AR-T-12: hasBeneficiaryReach missing → 422 toggle required", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections();
    delete (sections as Record<string, unknown>)["hasBeneficiaryReach"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.toLowerCase().includes("beneficiary reach"))).toBe(true);
  });

  it("AR-T-13: hasBeneficiaryReach=yes with negative beneficiary count → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), completeContentRow({ beneficiariesMale: -5 }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.toLowerCase().includes("men"))).toBe(true);
  });

  it("AR-T-14: hasBeneficiaryReach=no → beneficiary counts not validated regardless of value", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections({ hasBeneficiaryReach: "no" });
    // Even with a negative count, gate must NOT error on beneficiaries when reach=no
    const row = completeContentRow({ sections, beneficiariesMale: -999 });
    mockClientSequence(modernLockRow(), row);
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // No men/beneficiary errors expected — reach=no exempts counts
    if (res.status === 422) {
      expect(res.body.fields.every((f: string) => !f.toLowerCase().includes("men"))).toBe(true);
    }
  });

  it("AR-T-15: hasChallenges missing → 422 challenges toggle required", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections();
    delete (sections as Record<string, unknown>)["hasChallenges"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.toLowerCase().includes("challenges"))).toBe(true);
  });

  it("AR-T-16: hasChallenges=yes with blank challengesEncountered → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections({ hasChallenges: "yes", challenges: "" });
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Challenges Encountered"))).toBe(true);
  });

  it("AR-T-17: hasChallenges=no → challenges field not required", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections({ hasChallenges: "no" });
    delete (sections as Record<string, unknown>)["challenges"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Challenges field must NOT cause a 422 when hasChallenges=no
    if (res.status === 422) {
      expect(res.body.fields.every((f: string) => !f.includes("Challenges Encountered"))).toBe(true);
    }
  });

  it("AR-T-18: missing lessonsLearned → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = completeSections();
    delete (sections as Record<string, unknown>)["lessonsLearned"];
    mockClientSequence(modernLockRow(), completeContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Lessons Learned"))).toBe(true);
  });

  it("AR-T-19: completely empty modern report → 422 with all required fields listed", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const emptyModernRow = {
      title:             "",
      activityName:      "",
      sections:          { _schemaVersion: "modern" }, // no content
      reportingMonth:    null,
      reportingYear:     null,
      beneficiariesMale: null, beneficiariesFemale: null,
      beneficiariesBoys: null, beneficiariesGirls:  null,
    };
    mockClientSequence(modernLockRow(), emptyModernRow);
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    // Multiple fields must be listed — not just the first one
    expect(res.body.fields.length).toBeGreaterThan(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D — Legacy-period modern ARs: reportingMonth/Year exemption alignment
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — FIX-08: legacy-period modern AR reportingMonth/Year exemption", () => {
  it("AR-T-21: modern AR with YYYY-MM period and missing reportingMonth → 422", async () => {
    // Standard period — isLegacyPeriod=false — month/year required
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), completeContentRow({ period: "2026-07", reportingMonth: null }));
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => f.includes("Reporting Month"))).toBe(true);
  });

  it("AR-T-22: modern AR with legacy-format period (non YYYY-MM) → month/year not required", async () => {
    // Legacy-period format — isLegacyPeriod=true — frontend exempts month/year; backend must match
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const legacyPeriodRow = completeContentRow({
      period:         "Q3-2025",  // non YYYY-MM → isLegacyPeriod=true
      reportingMonth: null,       // blank — would fail for standard period
      reportingYear:  null,       // blank — would fail for standard period
    });
    mockClientSequence(modernLockRow(), legacyPeriodRow);
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Backend must NOT require month/year for legacy-format periods (contract parity with frontend)
    if (res.status === 422) {
      expect(res.body.fields.every((f: string) => !f.includes("Reporting Month"))).toBe(true);
      expect(res.body.fields.every((f: string) => !f.includes("Reporting Year"))).toBe(true);
    }
  });

  it("AR-T-23: modern AR with null period → treated as legacy-period, month/year not required", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const nullPeriodRow = completeContentRow({
      period:         null,  // null → empty string → isLegacyPeriod=true
      reportingMonth: null,
      reportingYear:  null,
    });
    mockClientSequence(modernLockRow(), nullPeriodRow);
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    if (res.status === 422) {
      expect(res.body.fields.every((f: string) => !f.includes("Reporting Month"))).toBe(true);
      expect(res.body.fields.every((f: string) => !f.includes("Reporting Year"))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E — Creation path: _schemaVersion stamped server-side at POST
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports — FIX-08: Activity Reports stamped modern at creation", () => {
  it("AR-CR-01: POST Activity Report without sections → INSERT receives _schemaVersion:modern", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    // Mock INSERT returning a new id, then reportSelect and withHistory
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })       // INSERT
      .mockResolvedValueOnce({ rows: [{ id: 99, report_type: "activity", status: "draft", title: "Test" }] }) // reportSelect
      .mockResolvedValue({ rows: [] });                     // withHistory

    await request(app)
      .post("/api/projects/reports")
      .send({
        title:          "New Activity Report",
        reportType:     "activity",
        activityName:   "Community Health",
        kind:           "monthly",
        period:         "2026-07",
        reportingMonth: 7,
        reportingYear:  2026,
        stateId:        1,
        sector:         "WASH",
        // sections intentionally omitted — server must stamp the marker
      });

    // Find the INSERT call and verify _schemaVersion was stamped in the sections parameter
    const insertCall = mockPoolQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO reports"),
    );
    expect(insertCall).toBeDefined();
    if (insertCall) {
      // sections is parameter $18 (index 17 in the values array).
      // After the jsonb serialisation fix the parameter is a JSON string — parse it first.
      const rawSectionsParam = insertCall[1][17];
      const sectionsParam: Record<string, unknown> =
        typeof rawSectionsParam === "string"
          ? (JSON.parse(rawSectionsParam) as Record<string, unknown>)
          : (rawSectionsParam as Record<string, unknown>);
      expect(sectionsParam).toBeDefined();
      expect(sectionsParam["_schemaVersion"]).toBe("modern");
    }
  });

  it("AR-CR-02: POST Activity Report with partial sections → INSERT merges in _schemaVersion:modern", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 100 }] })
      .mockResolvedValueOnce({ rows: [{ id: 100, report_type: "activity", status: "draft", title: "Test" }] })
      .mockResolvedValue({ rows: [] });

    await request(app)
      .post("/api/projects/reports")
      .send({
        title:          "Another AR",
        reportType:     "activity",
        activityName:   "Water Project",
        kind:           "monthly",
        period:         "2026-07",
        reportingMonth: 7,
        reportingYear:  2026,
        stateId:        1,
        sector:         "WASH",
        sections:       { implementationStatus: "ongoing" }, // marker absent from client payload
      });

    const insertCall = mockPoolQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO reports"),
    );
    expect(insertCall).toBeDefined();
    if (insertCall) {
      const rawSectionsParam2 = insertCall[1][17];
      const sectionsParam: Record<string, unknown> =
        typeof rawSectionsParam2 === "string"
          ? (JSON.parse(rawSectionsParam2) as Record<string, unknown>)
          : (rawSectionsParam2 as Record<string, unknown>);
      // Marker must be added even when client sends partial sections without it
      expect(sectionsParam["_schemaVersion"]).toBe("modern");
      // Client-supplied content must be preserved
      expect(sectionsParam["implementationStatus"]).toBe("ongoing");
    }
  });

  it("AR-CR-03: POST non-Activity Report without sections → INSERT does NOT stamp marker", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ id: 101, report_type: "project", status: "draft", title: "Proj Report" }] })
      .mockResolvedValue({ rows: [] });

    await request(app)
      .post("/api/projects/reports")
      .send({
        title:     "Project Monthly Report",
        reportType: "project",
        kind:       "monthly",
        period:     "2026-07",
        projectId:  1,
        stateId:    1,
      });

    const insertCall = mockPoolQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("INSERT INTO reports"),
    );
    if (insertCall) {
      const sectionsParam = insertCall[1][17];
      // Non-activity reports must NOT have marker injected
      if (sectionsParam !== null && sectionsParam !== undefined) {
        expect((sectionsParam as Record<string, unknown>)["_schemaVersion"]).not.toBe("modern");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite F — State / location validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — FIX-08: state/location validation", () => {
  /** Content row with state populated — should pass location check */
  function stateContentRow(overrides: Record<string, unknown> = {}) {
    return completeContentRow({ stateId: 1, locationType: "state", ...overrides });
  }
  /** Content row with no state, non-HQ — should fail location check */
  function noStateContentRow(overrides: Record<string, unknown> = {}) {
    return completeContentRow({ stateId: null, locationType: "state", ...overrides });
  }
  /** Content row for HQ report — no stateId, locationType="hq" — should pass */
  function hqContentRow(overrides: Record<string, unknown> = {}) {
    return completeContentRow({ stateId: null, locationType: "hq", ...overrides });
  }

  it("AR-L-01: modern state-level AR with null stateId → 422 State is required", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow(), noStateContentRow());
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.some((f: string) => f.includes("State is required"))).toBe(true);
  });

  it("AR-L-02: modern HQ AR with null stateId → passes location check (HQ exempt)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // HQ reports must not require stateId
    mockClientSequence(modernLockRow({ stateId: null }), hqContentRow());
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Must not error on State — HQ report is exempt
    if (res.status === 422) {
      expect(res.body.fields.every((f: string) => !f.includes("State is required"))).toBe(true);
    }
  });

  it("AR-L-03: modern state-level AR with valid stateId → location check passes", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockClientSequence(modernLockRow({ stateId: 1 }), stateContentRow());
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Location check must not error when stateId is set
    if (res.status === 422) {
      expect(res.body.fields.every((f: string) => !f.includes("State is required"))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite G — non-submit transitions are not content-gated
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — FIX-08: content gate fires only for submit", () => {
  it("AR-T-20: technical_review on empty modern report → not 422 report_content_incomplete", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);

    // Lock row in "submitted" state (valid from-state for technical_review in state_authored workflow)
    // Content row has empty fields — would fail if content gate fired
    mockClientSequence(
      modernLockRow({ status: "submitted", workflowPath: "state_authored" }),
      completeContentRow({ title: "", activityName: "", sections: { _schemaVersion: "modern" }, reportingMonth: null, reportingYear: null }),
    );
    mockPoolQuery.mockResolvedValue(mockGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "technical_review" });

    // Content gate only fires for "submit" — technical_review must not be blocked by content
    expect(res.body.error).not.toBe("report_content_incomplete");
    expect(res.status).not.toBe(422);
  });
});
