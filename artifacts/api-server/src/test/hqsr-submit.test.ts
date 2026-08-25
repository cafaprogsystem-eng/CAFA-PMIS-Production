/**
 * HQSR-SUBMIT: HQ Sector Report Backend Content Gate (HQSR-003)
 *
 * Tests the POST /reports/:id/transitions content gate for report_type=hq_sector.
 * Direct API calls with action="submit" on an incomplete HQSR must return
 * 422 { error: "report_content_incomplete", fields: [...] } — identical to the
 * frontend HQSR buildPayload validation rules.
 *
 * Suites:
 *   HQSR-SUBMIT     — required-field enforcement (sector, title, 8 narratives,
 *                     supportRequired ≥ 1 valid entry)
 *   HQSR-SUBMIT-OD  — on-demand rules (periodStart/periodEnd/reason + ordering)
 *   HQSR-SUBMIT-MAL — malformed sections never cause a 500
 *   HQSR-SUBMIT-NQ  — non-required quantitative data does not block submit
 *   HQSR-SUBMIT-TX  — transaction safety: no workflow mutation / side-effects on 422
 *   HQSR-SUBMIT-LIFE— resubmit after request_revision uses the same gate
 *   HQSR-SUBMIT-OVR — PM/super_admin actors face the same content rules
 *
 * Uses Express + supertest with mocked @workspace/db.
 * Pattern follows spr-submit.test.ts.
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
// Fake users
// ─────────────────────────────────────────────────────────────────────────────

const TC_USER = {
  id:      77,
  name:    "TC Test",
  email:   "tc@example.com",
  role:    "technical_coordinator",
  stateId: null,
  sector:  "WASH",
  sectors: ["WASH"] as string[],
};

const SPC_USER = {
  id:      88,
  name:    "SPC Test",
  email:   "spc@example.com",
  role:    "senior_program_coordinator",
  stateId: null,
  sector:  null,
  sectors: [] as string[],
};

const SUPER_ADMIN_USER = {
  id:      99,
  name:    "Admin Test",
  email:   "admin@example.com",
  role:    "super_admin",
  stateId: null,
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

/** Lock row for an HQSR in "draft" state (SELECT FOR UPDATE, client query #2). */
function hqLockRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status:       "draft",
    reportType:   "hq_sector",
    stateId:      null,
    sector:       "WASH",
    projectId:    null,
    activityId:   null,
    workflowPath: null,
    authorId:     77,
    ...overrides,
  };
}

/** getReportSector pool.query response for an hq_sector report. */
function hqGetReportSector(sector = "WASH") {
  return {
    rows: [{
      reportType:      "hq_sector",
      projectId:       null,
      projectSector:   null,
      activitySector:  null,
      effectiveSector: sector,
    }],
  };
}

/** Complete valid sections JSONB for an HQSR (mirrors frontend buildPayload). */
function validHqSections(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    frequency:           "monthly",
    period:              "2026-07",
    officerName:         "Jane Officer",
    technicalAnalysis:   "Detailed analysis of sector performance this period.",
    keyFindings:         "Three localities improved coverage significantly.",
    qualityAssessment:   "Field quality checks passed in all visited sites.",
    technicalChallenges: "Supply chain delays for chlorination materials.",
    recommendations:     "Pre-position supplies ahead of the rainy season.",
    strategicPriorities: "Expand coverage to underserved localities.",
    lessonsLearned:      "Early coordination with state teams reduces delays.",
    sectorOutlook:       "Stable with expected seasonal pressure in Q4.",
    supportRequired: [
      { supportType: "Logistics", description: "Additional transport for field missions." },
    ],
    stateObservations:   [],
    technicalRatings:    [],
    risks:               [],
    indicatorCommentary: [],
    attachments:         [],
    ...overrides,
  };
}

/** Complete HQSR content row for the validator SELECT (client query #3). */
function hqContentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:               1,
    title:            "WASH — HQ Sector Report — 2026-07",
    sector:           "WASH",
    kind:             "monthly",
    period_start:     null,
    period_end:       null,
    on_demand_reason: null,
    sections:         validHqSections(),
    ...overrides,
  };
}

/**
 * Set up the client.query mock sequence for an HQSR transition:
 *   [0] BEGIN
 *   [1] SELECT FOR UPDATE → lockRow
 *   [2] SELECT content    → contentRow (HQSR-003 gate)
 *   [3+] ROLLBACK / UPDATE / INSERT approvals / COMMIT → { rows: [] } (default)
 */
function mockHqClientSequence(
  lockRow: Record<string, unknown>,
  contentRow: Record<string, unknown>,
) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })            // BEGIN
    .mockResolvedValueOnce({ rows: [lockRow] })     // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [contentRow] }); // SELECT content (HQSR gate)
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
// Suite HQSR-SUBMIT — required field enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT: required field enforcement", () => {
  it("HQSR-SUBMIT-01: complete valid TC-authored HQSR submits (not 422)", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(hqGetReportSector())
      .mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
    expect([200, 201]).toContain(res.status);
  });

  it("HQSR-SUBMIT-02: complete SPC-fallback HQSR submits (not 422)", async () => {
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(
      hqLockRow({ authorId: 88, workflowPath: "spc_fallback" }),
      hqContentRow(),
    );
    mockPoolQuery
      .mockResolvedValueOnce(hqGetReportSector())
      .mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
    expect([200, 201]).toContain(res.status);
  });

  it("HQSR-SUBMIT-04: empty HQSR → 422 report_content_incomplete", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      title: "", sector: "", sections: {},
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect((res.body.fields as unknown[]).length).toBeGreaterThan(0);
  });

  it("HQSR-SUBMIT-05: blank title → 422 with title field", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({ title: "   " }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("title");
  });

  it("HQSR-SUBMIT-06: missing sector → 422 with sector field", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({ sector: null }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("sector");
  });

  const narrativeCases: Array<[string, string]> = [
    ["HQSR-SUBMIT-07", "technicalAnalysis"],
    ["HQSR-SUBMIT-08", "keyFindings"],
    ["HQSR-SUBMIT-09", "qualityAssessment"],
    ["HQSR-SUBMIT-10", "technicalChallenges"],
    ["HQSR-SUBMIT-11", "recommendations"],
    ["HQSR-SUBMIT-12", "strategicPriorities"],
    ["HQSR-SUBMIT-13", "lessonsLearned"],
    ["HQSR-SUBMIT-14", "sectorOutlook"],
  ];
  for (const [id, key] of narrativeCases) {
    it(`${id}: blank ${key} → 422 with ${key} field`, async () => {
      const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
      mockHqClientSequence(hqLockRow(), hqContentRow({
        sections: validHqSections({ [key]: "   " }),
      }));
      mockPoolQuery.mockResolvedValue(hqGetReportSector());

      const res = await submit(app);
      expect(res.status).toBe(422);
      expect(fieldNames(res)).toContain(key);
    });
  }

  it("HQSR-SUBMIT-15: no valid supportRequired entries → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      sections: validHqSections({ supportRequired: [] }),
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("supportRequired");
  });

  it("HQSR-SUBMIT-16: supportRequired entry with blank description → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      sections: validHqSections({
        supportRequired: [{ supportType: "Logistics", description: "   " }],
      }),
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("supportRequired");
  });

  it("HQSR-SUBMIT-16b: supportRequired entry with blank supportType → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      sections: validHqSections({
        supportRequired: [{ supportType: "", description: "Need transport." }],
      }),
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("supportRequired");
  });

  it("HQSR-SUBMIT: officerName is NOT required (blank officerName still submits)", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      sections: validHqSections({ officerName: "" }),
    }));
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite HQSR-SUBMIT-OD — on-demand rules
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT-OD: on-demand rules", () => {
  /** On-demand row with period fields stored in sections (frontend layout). */
  function onDemandRow(sectionOverrides: Record<string, unknown> = {}, rowOverrides: Record<string, unknown> = {}): Record<string, unknown> {
    return hqContentRow({
      kind: "on_demand",
      period_start: null,
      period_end: null,
      on_demand_reason: null,
      sections: validHqSections({
        frequency:      "on_demand",
        periodStart:    "2026-07-01",
        periodEnd:      "2026-07-31",
        onDemandReason: "Donor request",
        ...sectionOverrides,
      }),
      ...rowOverrides,
    });
  }

  it("HQSR-SUBMIT-OD-01: valid on-demand HQSR (sections storage) submits (not 422)", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow());
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("HQSR-SUBMIT-OD-01b: valid on-demand HQSR with top-level period columns submits", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow(
      { periodStart: undefined, periodEnd: undefined, onDemandReason: undefined },
      { period_start: "2026-07-01", period_end: "2026-07-31", on_demand_reason: "Donor request" },
    ));
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("HQSR-SUBMIT-OD-02: missing periodStart → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow({ periodStart: undefined }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodStart");
  });

  it("HQSR-SUBMIT-OD-03: missing periodEnd → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow({ periodEnd: undefined }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodEnd");
  });

  it("HQSR-SUBMIT-OD-04: periodEnd before periodStart → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow({
      periodStart: "2026-07-31",
      periodEnd:   "2026-07-01",
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodEnd");
  });

  it("HQSR-SUBMIT-OD-05: missing onDemandReason → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow({ onDemandReason: "  " }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("onDemandReason");
  });

  it("HQSR-SUBMIT-OD-06: invalid date strings → 422, not 500", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow({
      periodStart: "garbage",
      periodEnd:   "also-garbage",
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    const fields = fieldNames(res);
    expect(fields).toContain("periodStart");
    expect(fields).toContain("periodEnd");
  });

  const invalidCalendarCases: Array<[string, string]> = [
    ["impossible day (Feb 30)",        "2026-02-30"],
    ["non-leap-year Feb 29",           "2027-02-29"],
    ["out-of-range month (13)",        "2026-13-01"],
    ["zero month",                     "2026-00-10"],
    ["out-of-range day (32)",          "2026-01-32"],
    ["non-canonical format (1-digit)", "2026-7-1"],
  ];
  for (const [label, bad] of invalidCalendarCases) {
    it(`HQSR-SUBMIT-OD-CAL: ${label} in sections periodStart → 422`, async () => {
      const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
      mockHqClientSequence(hqLockRow(), onDemandRow({ periodStart: bad }));
      mockPoolQuery.mockResolvedValue(hqGetReportSector());

      const res = await submit(app);
      expect(res.status).toBe(422);
      expect(fieldNames(res)).toContain("periodStart");
    });

    it(`HQSR-SUBMIT-OD-CAL: ${label} in top-level period_end → 422`, async () => {
      const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
      mockHqClientSequence(hqLockRow(), onDemandRow(
        { periodEnd: undefined },
        { period_end: bad },
      ));
      mockPoolQuery.mockResolvedValue(hqGetReportSector());

      const res = await submit(app);
      expect(res.status).toBe(422);
      expect(fieldNames(res)).toContain("periodEnd");
    });
  }

  it("HQSR-SUBMIT-OD-CAL: valid leap day (2028-02-29) → submits", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow({
      periodStart: "2028-02-29",
      periodEnd:   "2028-03-01",
    }));
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("HQSR-SUBMIT-OD-CAL: JS Date objects from pg date columns are accepted", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow(
      { periodStart: undefined, periodEnd: undefined },
      {
        period_start: new Date("2026-07-01T00:00:00Z"),
        period_end:   new Date("2026-07-31T00:00:00Z"),
      },
    ));
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });

  it("HQSR-SUBMIT-OD-07: on_demand detected via sections.frequency when kind is absent", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow(
      { onDemandReason: undefined },
      { kind: null },
    ));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("onDemandReason");
  });

  it("HQSR-SUBMIT-OD-09: conflicting storage (kind=monthly, sections.frequency=on_demand) still enforces on-demand rules → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow(
      { periodStart: undefined, periodEnd: undefined, onDemandReason: undefined },
      { kind: "monthly" }, // top-level says monthly; sections say on_demand
    ));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    const fields = fieldNames(res);
    expect(fields).toContain("periodStart");
    expect(fields).toContain("periodEnd");
    expect(fields).toContain("onDemandReason");

    // Rollback — no workflow mutations
    const allCalls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((sql) => sql.includes("ROLLBACK"))).toBe(true);
    expect(allCalls.some((sql) => sql.includes("UPDATE reports"))).toBe(false);
    expect(allCalls.some((sql) => sql.includes("COMMIT"))).toBe(false);
  });

  it("HQSR-SUBMIT-OD-10: conflicting storage (kind=on_demand, sections.frequency=monthly) still enforces on-demand rules → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      kind: "on_demand",
      sections: validHqSections({ frequency: "monthly" }), // no period fields / reason
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    const fields = fieldNames(res);
    expect(fields).toContain("periodStart");
    expect(fields).toContain("periodEnd");
    expect(fields).toContain("onDemandReason");
  });

  it("HQSR-SUBMIT-OD-11: conflicting storage with invalid calendar date in sections → 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), onDemandRow(
      { periodStart: "2026-02-30" },
      { kind: "monthly" },
    ));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(fieldNames(res)).toContain("periodStart");
  });

  it("HQSR-SUBMIT-OD-08: monthly HQSR is not subject to on-demand rules", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow()); // monthly, no period fields
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite HQSR-SUBMIT-MAL — malformed structures never cause 500
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT-MAL: malformed sections handling", () => {
  const malformedCases: Array<[string, Record<string, unknown>]> = [
    ["sections = null",                { sections: null }],
    ["sections = {}",                  { sections: {} }],
    ["sections is an array",           { sections: ["oops"] }],
    ["narrative is a boolean",         { sections: validHqSections({ technicalAnalysis: false }) }],
    ["narrative is an array",          { sections: validHqSections({ keyFindings: [] }) }],
    ["supportRequired is a string",    { sections: validHqSections({ supportRequired: "junk" }) }],
    ["supportRequired entry is null",  { sections: validHqSections({ supportRequired: [null] }) }],
    ["supportRequired entry is array", { sections: validHqSections({ supportRequired: [["x"]] }) }],
  ];

  for (const [label, overrides] of malformedCases) {
    it(`HQSR-SUBMIT-MAL: ${label} → 422 not 500`, async () => {
      const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
      mockHqClientSequence(hqLockRow(), hqContentRow(overrides));
      mockPoolQuery.mockResolvedValue(hqGetReportSector());

      const res = await submit(app);
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("report_content_incomplete");
    });
  }

  it("HQSR-SUBMIT-MAL-05: junk nested optional arrays (stateObservations) → no crash, submits", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({
      sections: validHqSections({
        stateObservations: [null, "junk", { weird: true }],
        technicalRatings:  "not-an-array",
        indicatorCommentary: 42,
      }),
    }));
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite HQSR-SUBMIT-NQ — non-required quantitative data
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT-NQ: no quantitative requirements", () => {
  it("HQSR-SUBMIT-NQ-01/02/03: no beneficiaries, activities, or financial figures → submits", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    // hqContentRow has no beneficiary/activity/financial fields at all
    mockHqClientSequence(hqLockRow(), hqContentRow());
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
    expect([200, 201]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite HQSR-SUBMIT-TX — transaction safety on validation failure
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT-TX: no mutation on 422", () => {
  it("HQSR-SUBMIT-TX-01/02/03: validation failure → ROLLBACK, no UPDATE of status/submitted_by_id/submitted_at, no COMMIT", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({ title: "" }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);

    const allCalls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((sql) => sql.includes("ROLLBACK"))).toBe(true);
    expect(allCalls.some((sql) => sql.includes("UPDATE reports"))).toBe(false);
    expect(allCalls.some((sql) => sql.includes("submitted_at"))).toBe(false);
    expect(allCalls.some((sql) => sql.includes("COMMIT"))).toBe(false);
  });

  it("HQSR-SUBMIT-TX-04: validation failure → no approval/history row created", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({ sections: {} }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    await submit(app);

    const allCalls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const hasInsertApprovals = allCalls.some(
      (sql) => sql.includes("INSERT") && sql.toLowerCase().includes("approvals"),
    );
    expect(hasInsertApprovals).toBe(false);
  });

  it("HQSR-SUBMIT-TX-05: validation failure → no notification dispatched", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow({ sections: {} }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    await submit(app);

    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("HQSR-SUBMIT-TX-06: successful submit → notifications fire, hqsrPath preserved (tc_authored)", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow(), hqContentRow());
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    await submit(app);

    expect(mockNotifyNextApprover).toHaveBeenCalled();
    const arg = mockNotifyNextApprover.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.hqsrPath).toBe("tc_authored");
  });

  it("HQSR-SUBMIT-TX-07: successful SPC-fallback submit → hqsrPath = spc_fallback (HQSR-006 routing preserved)", async () => {
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(
      hqLockRow({ authorId: 88, workflowPath: "spc_fallback" }),
      hqContentRow(),
    );
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    await submit(app);

    expect(mockNotifyNextApprover).toHaveBeenCalled();
    const arg = mockNotifyNextApprover.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.hqsrPath).toBe("spc_fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite HQSR-SUBMIT-LIFE — resubmit lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT-LIFE: resubmit uses the same gate", () => {
  it("HQSR-SUBMIT-LIFE-01: returned draft with incomplete revision → resubmit 422", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    // After request_revision the HQSR returns to draft; re-submit is the same path.
    mockHqClientSequence(hqLockRow({ status: "draft" }), hqContentRow({
      sections: validHqSections({ recommendations: "" }),
    }));
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
  });

  it("HQSR-SUBMIT-LIFE-02: corrected complete revision → resubmit succeeds", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow({ status: "draft" }), hqContentRow());
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
    expect([200, 201]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite HQSR-SUBMIT-OVR — override actors face the same content rules
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — HQSR-SUBMIT-OVR: no content bypass for elevated actors", () => {
  it("HQSR-SUBMIT-OVR-01: super_admin actor → 422 on incomplete HQSR", async () => {
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(
      hqLockRow({ authorId: 99 }),
      hqContentRow({ sections: {} }),
    );
    mockPoolQuery.mockResolvedValue(hqGetReportSector());

    const res = await submit(app);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
  });

  it("HQSR-SUBMIT-OVR-02: super_admin actor → 200 on complete HQSR", async () => {
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    mockHqClientSequence(hqLockRow({ authorId: 99 }), hqContentRow());
    mockPoolQuery.mockResolvedValueOnce(hqGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await submit(app);
    expect(res.status).not.toBe(422);
    expect([200, 201]).toContain(res.status);
  });
});
