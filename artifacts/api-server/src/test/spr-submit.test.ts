/**
 * SPR-SUBMIT: State Programme Report Backend Content Gate (SPR-001)
 *
 * Tests the POST /reports/:id/transitions content gate for report_type=program_state.
 * Direct API calls with action="submit" on an incomplete SPR must return
 * 422 { error: "report_content_incomplete", fields: [...] } — identical to the
 * frontend SPR buildPayload validation rules.
 *
 * Suites:
 *   SPR-SUBMIT    — required-field enforcement (title, sectors, localities,
 *                   humanitarian context, activities, narratives)
 *   SPR-SUBMIT-OD — on-demand rules (periodStart/periodEnd/reason + ordering)
 *   SPR-SUBMIT-TX — transaction safety: no workflow mutation / side-effects on 422
 *   SPR-ROBUST    — malformed sections never cause a 500
 *
 * Uses Express + supertest with mocked @workspace/db.
 * Pattern follows reports-pmr-submit.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before any dynamic import of the route
// ─────────────────────────────────────────────────────────────────────────────

const mockPoolQuery     = vi.fn();
const mockClientQuery   = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect       = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: {
    query:   mockPoolQuery,
    connect: mockConnect,
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

const mockNotifyEntityActors  = vi.fn().mockResolvedValue(undefined);
const mockNotifyNextApprover  = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: mockNotifyEntityActors,
  notifyNextApprover:        mockNotifyNextApprover,
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
// Test setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientRelease.mockReset();
  mockConnect.mockReset().mockImplementation(async () => ({
    query:   mockClientQuery,
    release: mockClientRelease,
  }));
  mockNotifyEntityActors.mockReset().mockResolvedValue(undefined);
  mockNotifyNextApprover.mockReset().mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake user — SPO with stateId=1 (SPR author role)
// ─────────────────────────────────────────────────────────────────────────────

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

/** Lock row for an SPR in "draft" state (SELECT FOR UPDATE, client query #2). */
function sprLockRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status:       "draft",
    reportType:   "program_state",
    stateId:      1,
    sector:       "WASH",
    projectId:    null,
    activityId:   null,
    workflowPath: null,
    authorId:     42,
    ...overrides,
  };
}

/** getReportSector pool.query response for a program_state report. */
function sprGetReportSector(sector = "WASH") {
  return {
    rows: [{
      reportType:      "program_state",
      projectId:       null,
      projectSector:   null,
      activitySector:  null,
      effectiveSector: sector,
    }],
  };
}

/** Minimal valid SPR activity stored in the activities JSONB column. */
function validSprActivity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title:              "Water point rehabilitation",
    sector:             "WASH",
    activityDate:       "2026-07-15",
    achievementSummary: "Rehabilitated 3 water points serving 2 villages.",
    beneficiariesMen:   50,
    beneficiariesWomen: 60,
    beneficiariesBoys:  20,
    beneficiariesGirls: 30,
    ...overrides,
  };
}

/** Complete valid sections JSONB for an SPR. */
function validSprSections(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    frequency:         "monthly",
    sectors:           ["WASH", "Health"],
    localitiesCovered: ["Kassala Town", "Rural Kassala"],
    humanitarianContext: {
      securitySituation:   "Stable with localised incidents.",
      populationMovements: "Minor influx from neighbouring localities.",
      diseaseOutbreaks:    "No new outbreaks reported.",
      accessConstraints:   "Seasonal road access limitations.",
    },
    keyAchievements:      "Expanded WASH coverage to two new localities.",
    mainChallenges:       "Fuel shortages delayed field missions.",
    mitigationMeasures:   "Pre-positioned fuel stocks with partners.",
    nextPeriodPriorities: "Complete borehole drilling in Rural Kassala.",
    ...overrides,
  };
}

/** Complete SPR content row for the validator SELECT (client query #3). */
function sprContentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:               1,
    title:            "Kassala — Monthly Programme Report — 2026-07",
    state_id:         1,
    kind:             "monthly",
    period:           "2026-07",
    period_start:     null,
    period_end:       null,
    on_demand_reason: null,
    sections:         validSprSections(),
    activities:       [validSprActivity()],
    ...overrides,
  };
}

/**
 * Set up the client.query mock sequence for an SPR transition:
 *   [0] BEGIN
 *   [1] SELECT FOR UPDATE → lockRow
 *   [2] SELECT content    → contentRow (SPR-001 gate)
 *   [3+] ROLLBACK / UPDATE / INSERT approvals / COMMIT → { rows: [] } (default)
 */
function mockSprClientSequence(
  lockRow: Record<string, unknown>,
  contentRow: Record<string, unknown>,
) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })            // BEGIN
    .mockResolvedValueOnce({ rows: [lockRow] })     // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [contentRow] }); // SELECT content (SPR gate)
}

async function submit(app: express.Express) {
  return request(app)
    .post("/api/projects/reports/1/transitions")
    .send({ action: "submit" });
}

function fieldNames(res: request.Response): string[] {
  return ((res.body.fields ?? []) as Array<{ field: string }>).map((f) => f.field);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite SPR-SUBMIT — required field enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — SPR-SUBMIT: required field enforcement", () => {
  it("SPR-SUBMIT-01: complete valid SPR submits (not 422)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(sprGetReportSector())
      .mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
    expect([200, 201]).toContain(res.status);
  });

  it("SPR-SUBMIT-02: empty SPR → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      title: "", state_id: null, sections: {}, activities: [],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect((res.body.fields as unknown[]).length).toBeGreaterThan(0);
  });

  it("SPR-SUBMIT-03: blank title → 422 with title field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({ title: "   " }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("title");
  });

  it("SPR-SUBMIT-04: missing sectors → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({ sectors: [] }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("sectors");
  });

  it("SPR-SUBMIT-05: missing localities → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({ localitiesCovered: [] }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("localitiesCovered");
  });

  it("SPR-SUBMIT-06: missing required humanitarian context fields → 422 (each named)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({
        humanitarianContext: { securitySituation: "Stable." }, // other 3 missing
      }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    const fields = fieldNames(res);
    expect(fields).toContain("humanitarianContext.populationMovements");
    expect(fields).toContain("humanitarianContext.diseaseOutbreaks");
    expect(fields).toContain("humanitarianContext.accessConstraints");
    expect(fields).not.toContain("humanitarianContext.securitySituation");
  });

  it("SPR-SUBMIT-07: no activities → 422 with activities field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({ activities: [] }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities");
  });

  it("SPR-SUBMIT-08: activity missing title → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({ title: "  " })],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities[0].title");
  });

  it("SPR-SUBMIT-09: activity missing sector → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({ sector: "" })],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities[0].sector");
  });

  it("SPR-SUBMIT-10: activity missing date → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({ activityDate: "" })],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities[0].date");
  });

  it("SPR-SUBMIT-11: activity missing achievement summary → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({ achievementSummary: "" })],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities[0].achievementSummary");
  });

  it("SPR-SUBMIT-12a: activity with zero total beneficiary reach → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({
        beneficiariesMen: 0, beneficiariesWomen: 0,
        beneficiariesBoys: 0, beneficiariesGirls: 0,
      })],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities[0].beneficiaries");
  });

  it("SPR-SUBMIT-12b: invalid beneficiary data (negative, NaN string, boolean, array) → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({
        beneficiariesMen:   -5,
        beneficiariesWomen: "not-a-number",
        beneficiariesBoys:  true,
        beneficiariesGirls: [10],
      })],
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("activities[0].beneficiaries");
  });

  it("SPR-SUBMIT-12c: blank-string beneficiary fields parse as 0, not NaN — sum>0 still passes", async () => {
    // Number("") === 0 must not corrupt the sum; blank fields mirror the
    // frontend's Number(x || 0) treatment.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      activities: [validSprActivity({
        beneficiariesMen: "", beneficiariesWomen: "  ",
        beneficiariesBoys: 5, beneficiariesGirls: 0,
      })],
    }));
    mockPoolQuery.mockResolvedValueOnce(sprGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("SPR-SUBMIT-13: missing keyAchievements → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({ keyAchievements: "" }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("keyAchievements");
  });

  it("SPR-SUBMIT-14: missing mainChallenges → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({ mainChallenges: "" }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("mainChallenges");
  });

  it("SPR-SUBMIT-15: missing mitigationMeasures → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({ mitigationMeasures: "" }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("mitigationMeasures");
  });

  it("SPR-SUBMIT-16: missing nextPeriodPriorities → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({
      sections: validSprSections({ nextPeriodPriorities: "" }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("nextPeriodPriorities");
  });

  it("SPR-SUBMIT-17: null state_id on stored report → 422 with stateId field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({ state_id: null }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("stateId");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite SPR-SUBMIT-OD — on-demand rules
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — SPR-SUBMIT-OD: on-demand rules", () => {
  function onDemandRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return sprContentRow({
      kind:             "on_demand",
      period:           "2026-07-01",
      period_start:     "2026-07-01",
      period_end:       "2026-07-31",
      on_demand_reason: "Donor request",
      sections:         validSprSections({ frequency: "on_demand", onDemandReason: "Donor request" }),
      ...overrides,
    });
  }

  it("SPR-SUBMIT-OD-01: valid on-demand SPR submits (not 422)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow());
    mockPoolQuery.mockResolvedValueOnce(sprGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("SPR-SUBMIT-OD-02: missing periodStart → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow({ period_start: null }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodStart");
  });

  it("SPR-SUBMIT-OD-03: missing periodEnd → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow({ period_end: null }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodEnd");
  });

  it("SPR-SUBMIT-OD-04: end before start → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow({
      period_start: "2026-07-31",
      period_end:   "2026-07-01",
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodEnd");
  });

  it("SPR-SUBMIT-OD-05: missing onDemandReason (column and sections) → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow({
      on_demand_reason: null,
      sections: validSprSections({ frequency: "on_demand" }), // no onDemandReason key
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("onDemandReason");
  });

  it("SPR-SUBMIT-OD-06: reason only in sections JSONB (frontend storage) → accepted", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow({ on_demand_reason: null }));
    mockPoolQuery.mockResolvedValueOnce(sprGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("SPR-SUBMIT-OD-07: invalid date strings → 422, not 500", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), onDemandRow({
      period_start: "garbage",
      period_end:   "also-garbage",
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    const fields = fieldNames(res);
    expect(fields).toContain("periodStart");
    expect(fields).toContain("periodEnd");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite SPR-ROBUST — malformed structures never cause 500
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — SPR-ROBUST: malformed sections handling", () => {
  const malformedCases: Array<[string, Record<string, unknown>]> = [
    ["sections = null",              { sections: null }],
    ["sections = {}",                { sections: {} }],
    ["sections is an array",         { sections: ["oops"] }],
    ["humanitarianContext = string", { sections: validSprSections({ humanitarianContext: "not-an-object" }) }],
    ["humanitarianContext = array",  { sections: validSprSections({ humanitarianContext: ["x"] }) }],
    ["sectors is a string",          { sections: validSprSections({ sectors: "WASH" }) }],
    ["localitiesCovered is object",  { sections: validSprSections({ localitiesCovered: { a: 1 } }) }],
    ["activities is not an array",   { activities: "junk" }],
    ["activity entry is a string",   { activities: ["junk"] }],
    ["activity entry is null",       { activities: [null] }],
  ];

  for (const [label, overrides] of malformedCases) {
    it(`SPR-ROBUST: ${label} → 422 not 500`, async () => {
      const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
      mockSprClientSequence(sprLockRow(), sprContentRow(overrides));
      mockPoolQuery.mockResolvedValue(sprGetReportSector());

      const res = await submit(app);
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("report_content_incomplete");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite SPR-SUBMIT-TX — transaction safety on validation failure
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — SPR-SUBMIT-TX: no mutation on 422", () => {
  it("SPR-SUBMIT-TX-01/02: validation failure → ROLLBACK, no UPDATE of status/submitted_by_id/submitted_at", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({ title: "" }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);

    const allCalls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((sql) => sql.includes("ROLLBACK"))).toBe(true);
    expect(allCalls.some((sql) => sql.includes("UPDATE reports"))).toBe(false);
    expect(allCalls.some((sql) => sql.includes("submitted_at"))).toBe(false);
    expect(allCalls.some((sql) => sql.includes("COMMIT"))).toBe(false);
  });

  it("SPR-SUBMIT-TX-03: validation failure → no approval/history row created", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({ activities: [] }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    await submit(app);

    const allCalls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const hasInsertApprovals = allCalls.some(
      (sql) => sql.includes("INSERT") && sql.toLowerCase().includes("approvals"),
    );
    expect(hasInsertApprovals).toBe(false);
  });

  it("SPR-SUBMIT-TX-04: validation failure → no notification dispatched", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow({ sections: {} }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    await submit(app);

    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("SPR-SUBMIT-TX-05: successful submit → notifications fire as before", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockSprClientSequence(sprLockRow(), sprContentRow());
    mockPoolQuery.mockResolvedValueOnce(sprGetReportSector()).mockResolvedValue({ rows: [] });

    await submit(app);

    const notified =
      mockNotifyEntityActors.mock.calls.length > 0 ||
      mockNotifyNextApprover.mock.calls.length > 0;
    expect(notified).toBe(true);
  });

  it("SPR-SUBMIT-TX-06: resubmit after request_revision (draft again) uses the same gate → 422 when incomplete", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // After request_revision the SPR returns to draft; re-submit is the same path.
    mockSprClientSequence(sprLockRow({ status: "draft" }), sprContentRow({
      sections: validSprSections({ keyAchievements: "" }),
    }));
    mockPoolQuery.mockResolvedValue(sprGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
  });
});
