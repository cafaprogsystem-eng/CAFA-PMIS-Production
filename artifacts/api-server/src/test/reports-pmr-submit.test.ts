/**
 * PMR-SUBMIT: Project Monthly Report Backend Content Gate (PB-1)
 *
 * Tests the POST /reports/:id/transitions content gate for report_type=project.
 * Direct API calls with action="submit" on an incomplete PMR must return
 * 422 { error: "report_content_incomplete", fields: [...] } — identical to the
 * frontend PMR validateSubmit rules.
 *
 * Suites:
 *   PMR-SUBMIT — basic required-field enforcement
 *   PMR-PERIOD — period consistency rules by kind (monthly/quarterly/annual/on_demand)
 *   PMR-LIFE   — lifecycle paths (draft save unaffected; submit/resubmit gated)
 *   PMR-NOTIFY — no side-effects (approvals row, notifications) on 422 rejection
 *   PMR-NUMERIC — numeric integrity (expenditure, variance, beneficiary totals)
 *
 * Uses Express + supertest with mocked @workspace/db.
 * Pattern follows reports-fix08.test.ts.
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

/** SPO user — has stateId=1, reports.create perm (submit perm) */
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
 * Standard lock row for a PMR in "draft" state.
 * client.query call #2 (SELECT FOR UPDATE).
 */
function pmrLockRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status:       "draft",
    reportType:   "project",
    stateId:      1,
    sector:       "WASH",
    projectId:    10,
    activityId:   null,
    workflowPath: "state_authored",
    authorId:     42,
    ...overrides,
  };
}

/**
 * getReportSector pool.query response for a project report.
 */
function pmrGetReportSector(sector = "WASH") {
  return {
    rows: [{
      reportType:      "project",
      projectId:       10,
      projectSector:   sector,
      activitySector:  null,
      effectiveSector: sector,
    }],
  };
}

/** Minimal valid activity stored in JSONB (camelCase keys as saved by frontend) */
function validActivity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name:               "Community Health Outreach",
    actualExpenditure:  5000,
    plannedBudget:      5000,
    achievementSummary: "All targets met.",
    beneficiariesMen:   50,
    beneficiariesWomen: 60,
    beneficiariesBoys:  20,
    beneficiariesGirls: 30,
    isUnplanned:        false,
    unplannedReason:    "",
    varianceReason:     "",
    ...overrides,
  };
}

/** Complete PMR content row for client.query #3 (SELECT id, title, ...) */
function pmrContentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:              1,
    title:           "July 2026 Project Report",
    project_id:      10,
    state_id:        1,
    location_type:   "state",
    kind:            "monthly",
    period:          "2026-07",
    period_start:    null,
    on_demand_reason:null,
    reporting_month: 7,
    reporting_year:  2026,
    quarter:         null,
    sections: {
      keyAchievements: "Reached 160 beneficiaries across 3 districts.",
      lessonsLearned:  "Early engagement with community leaders reduced resistance.",
    },
    activities: [validActivity()],
    ...overrides,
  };
}

/**
 * Set up the full client.query mock sequence for a PMR transition.
 *
 * Query order inside validateProjectReportForSubmission:
 *   [0] BEGIN
 *   [1] SELECT FOR UPDATE  → lockRow
 *   [2] SELECT content     → contentRow
 *   [3] SELECT currency FROM projects  (§7b — only when ≥1 named activity has actual > 0)
 *   [4] SELECT COUNT(*)    → { cnt: attachCount }  (§8 — always)
 *   [5+] ROLLBACK / UPDATE / INSERT approvals / INSERT comment / COMMIT  → { rows: [] }
 *
 * `currency` controls what §7b returns.  Pass `null` to simulate a project with no
 * currency configured (triggers the currency gate).  Omit (default "USD") to let
 * the check pass silently.
 */
function mockPmrClientSequence(
  lockRow: Record<string, unknown>,
  contentRow: Record<string, unknown>,
  attachCount = 1,
  currency: string | null = "USD",
) {
  // Mirror the condition in §7b: fires only when a named activity has a finite positive actual.
  const acts = Array.isArray(contentRow["activities"])
    ? (contentRow["activities"] as Array<Record<string, unknown>>)
    : [];
  const cleanActs = acts.filter((a) => String(a["name"] ?? "").trim());
  const willFireCurrencyCheck =
    !!contentRow["project_id"] &&
    cleanActs.some((a) => {
      const n = Number(a["actualExpenditure"] ?? null);
      return Number.isFinite(n) && n > 0;
    });

  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })                           // BEGIN
    .mockResolvedValueOnce({ rows: [lockRow] })                    // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [contentRow] });                // SELECT content

  if (willFireCurrencyCheck) {
    mockClientQuery.mockResolvedValueOnce({
      rows: currency !== null ? [{ currency }] : [],               // SELECT currency (§7b)
    });
  }

  mockClientQuery.mockResolvedValueOnce({ rows: [{ cnt: attachCount }] }); // COUNT (§8)
  // Remaining (ROLLBACK / UPDATE / INSERT / COMMIT) use the default mockResolvedValue({ rows: [] })
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite PMR-SUBMIT — required field enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — PMR-SUBMIT: required field enforcement", () => {
  it("PMR-SUBMIT-01: valid complete monthly PMR → not 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())   // getReportSector
      .mockResolvedValue({ rows: [] });               // reportSelect + withHistory

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-SUBMIT-02: missing title → 422 with title field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ title: "" }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.some((f: { field: string }) => f.field === "title")).toBe(true);
  });

  it("PMR-SUBMIT-03: missing project_id → 422 with projectId field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ project_id: null }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "projectId")).toBe(true);
  });

  it("PMR-SUBMIT-04: state-scoped PMR with null state_id → 422 with stateId field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(
      pmrLockRow(),
      pmrContentRow({ location_type: "state", state_id: null }),
    );
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "stateId")).toBe(true);
  });

  it("PMR-SUBMIT-05: HQ PMR (location_type=hq) with null state_id → not rejected for missing state", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // HQ reports are not state-scoped; state scope check must be skipped
    mockPmrClientSequence(
      pmrLockRow({ stateId: null }),
      pmrContentRow({ location_type: "hq", state_id: null }),
    );
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // stateId field must NOT appear in errors (HQ is exempt)
    if (res.status === 422) {
      expect(res.body.fields.every((f: { field: string }) => f.field !== "stateId")).toBe(true);
    }
  });

  it("PMR-SUBMIT-06: missing keyAchievements → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = { lessonsLearned: "Good lessons." };
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "keyAchievements")).toBe(true);
  });

  it("PMR-SUBMIT-07: missing lessonsLearned → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = { keyAchievements: "Good achievements." };
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ sections }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "lessonsLearned")).toBe(true);
  });

  it("PMR-SUBMIT-08: no activities → 422 with activities field", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "activities")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite PMR-PERIOD — period consistency rules by kind
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — PMR-PERIOD: period consistency rules", () => {
  it("PMR-PERIOD-01: valid YYYY-MM monthly period → accepted", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "monthly", period: "2026-07", reporting_month: 7, reporting_year: 2026,
    }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-PERIOD-02: period YYYY-MM mismatch with reporting_month/year → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // period says January but reporting_month=12 — clear inconsistency
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "monthly", period: "2026-01", reporting_month: 12, reporting_year: 2026,
    }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "period")).toBe(true);
  });

  it("PMR-PERIOD-03: valid quarterly YYYY-QN period → accepted", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "quarterly", period: "2026-Q2", reporting_year: 2026, quarter: 2,
      reporting_month: null,
    }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-PERIOD-04: quarterly period/quarter column mismatch → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // period says Q1 but quarter column is 3
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "quarterly", period: "2026-Q1", reporting_year: 2026, quarter: 3,
    }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "period")).toBe(true);
  });

  it("PMR-PERIOD-05: valid annual YYYY period → accepted", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "annual", period: "2026", reporting_year: 2026, reporting_month: null, quarter: null,
    }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-PERIOD-06: valid on-demand with period_start → accepted", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "on_demand",
      period: "2026-07",
      period_start: "2026-07-01",
      on_demand_reason: "Donor Request",
      reporting_month: null,
    }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-PERIOD-08: on-demand PMR with null period_start → 422 even when period column is non-empty", async () => {
    // The period column is not a substitute for period_start — period_start is required unconditionally
    // for on-demand reports.  A direct API call that sets period but omits period_start must be blocked.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind:             "on_demand",
      period:           "2026-07",        // non-empty — must NOT bypass period_start requirement
      period_start:     null,             // missing
      on_demand_reason: "Donor Request",
      reporting_month:  null,
    }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "periodStart")).toBe(true);
  });

  it("PMR-PERIOD-09: on-demand PMR with period_start but missing on_demand_reason → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind:             "on_demand",
      period_start:     "2026-07-01",
      on_demand_reason: null,             // missing
      reporting_month:  null,
    }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: { field: string }) => f.field === "onDemandReason")).toBe(true);
  });

  it("PMR-PERIOD-07: historical non-standard period string (e.g. Q3-2025) not blocked by consistency check", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // Legacy period format — the YYYY-MM regex does NOT match, so consistency check is skipped
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({
      kind: "monthly",
      period: "Q3-2025",        // legacy format — does not match /^\d{4}-\d{2}$/
      reporting_month: 7,       // would mismatch if check ran
      reporting_year: 2026,
    }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Legacy period must NOT trigger a period consistency 422
    if (res.status === 422) {
      expect(res.body.fields.every((f: { field: string }) => f.field !== "period")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite PMR-LIFE — lifecycle: draft save unaffected; submit/resubmit gated
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — PMR-LIFE: submit/resubmit gating", () => {
  it("PMR-LIFE-01: PATCH (draft save) on incomplete PMR → not 422 (gate not in PATCH path)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // PATCH route uses pool.query, not client. Provide enough for PATCH to proceed.
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{
          status: "draft", sector: "WASH", projectId: 10,
          reportType: "project", authorId: 42, sections: {},
        }],
      })
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ title: "" }); // intentionally blank title — gate must NOT fire on PATCH

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-LIFE-02: incomplete draft cannot Submit → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // Missing keyAchievements — should fail content gate
    const incompleteRow = pmrContentRow({
      sections: { lessonsLearned: "Lessons noted." }, // no keyAchievements
    });
    mockPmrClientSequence(pmrLockRow(), incompleteRow);
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
  });

  it("PMR-LIFE-03: complete draft can Submit → 200/201", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect([200, 201]).toContain(res.status);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-LIFE-04: returned report can be PATCH edited → 200", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{
          status: "returned", sector: "WASH", projectId: 10,
          reportType: "project", authorId: 42, sections: {},
        }],
      })
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ title: "Updated title" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-LIFE-05: revised draft (returned to draft by request_revision) with incomplete content cannot re-submit → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // After request_revision the report status is "draft" (the workflow transitions back to draft).
    // The author must re-submit using action=submit from draft, just like the initial submit.
    const revisedDraftLock = pmrLockRow({ status: "draft" });
    const incompleteRow = pmrContentRow({ activities: [] }); // no activities
    mockPmrClientSequence(revisedDraftLock, incompleteRow);
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
  });

  it("PMR-LIFE-06: revised draft with complete content can re-submit → 200", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // Same as initial submit but after a request_revision cycle — status is still "draft"
    const revisedDraftLock = pmrLockRow({ status: "draft" });
    mockPmrClientSequence(revisedDraftLock, pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect([200, 201]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite PMR-NOTIFY — no side-effects on 422 rejection
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — PMR-NOTIFY: no side-effects on content rejection", () => {
  it("PMR-NOTIFY-01: failed content validation → no row inserted in report_approvals", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ title: "" }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // ROLLBACK must have been called; INSERT approvals must NOT have been called
    const allCalls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const hasInsertApprovals = allCalls.some((sql) =>
      sql.includes("INSERT") && sql.toLowerCase().includes("approvals"),
    );
    expect(hasInsertApprovals).toBe(false);
  });

  it("PMR-NOTIFY-02: failed content validation → notifications not sent", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ sections: {} }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Post-commit notifications must NOT fire when transaction was rolled back
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIFY-03: successful submit → existing notification behaviour preserved", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValue({ rows: [] });

    await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // At least one notification function must have been called on success
    const notified =
      mockNotifyEntityActors.mock.calls.length > 0 ||
      mockNotifyNextApprover.mock.calls.length > 0;
    expect(notified).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite PMR-NUMERIC — numeric integrity
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — PMR-NUMERIC: numeric field integrity", () => {
  it("PMR-NUM-01: activity with all beneficiary values = 0 (explicit zero) → no beneficiary error (BD-2)", async () => {
    // BD-2: zero is a valid explicit value — only blank/missing fields are rejected.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const zeroActivity = validActivity({
      beneficiariesMen: 0, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroActivity] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Must not be blocked by any beneficiary-related error
    if (res.status === 422) {
      const fields = res.body.fields as Array<{ field: string }>;
      const hasBenError = fields.some(
        (f) => f.field.includes("beneficiar") || f.field === "beneficiariesTotal",
      );
      expect(hasBenError).toBe(false);
    }
  });

  it("PMR-NUM-02: activity actualExpenditure negative → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const negativeActivity = validActivity({ actualExpenditure: -100 });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [negativeActivity] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("actualExpenditure"))).toBe(true);
  });

  it("PMR-NUM-03: variance threshold exceeded without reason → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // actual=1000, planned=5000 → actual < planned * 0.7 (200% under) → needs variance reason
    const varianceActivity = validActivity({
      plannedBudget:     5000,
      actualExpenditure: 1000,
      varianceReason:    "",
    });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [varianceActivity] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("varianceReason"))).toBe(true);
  });

  it("PMR-NUM-04: actual = planned (within threshold) without variance reason → accepted", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // actual=5000, planned=5000 → exact match → no variance reason needed
    const exactActivity = validActivity({
      plannedBudget:     5000,
      actualExpenditure: 5000,
      varianceReason:    "",
    });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [exactActivity] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    if (res.status === 422) {
      const fields = res.body.fields as Array<{ field: string }>;
      expect(fields.every((f) => !f.field.includes("varianceReason"))).toBe(true);
    }
  });

  it("PMR-NUM-05: unplanned activity without reason → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const unplannedNoReason = validActivity({
      isUnplanned:    true,
      unplannedReason: "",
    });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [unplannedNoReason] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("unplannedReason"))).toBe(true);
  });

  it("PMR-NUM-06: no attachments, docsNoSupport=false → 422 for missing docs", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // attachCount=0, no bypass
    mockPmrClientSequence(pmrLockRow(), pmrContentRow(), 0);
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field === "supportingDocs")).toBe(true);
  });

  it("PMR-NUM-07: no attachments but docsNoSupport=true with reason → accepted (bypass)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const sections = {
      keyAchievements:    "Great achievements.",
      lessonsLearned:     "Good lessons.",
      docsNoSupport:      true,
      docsNoSupportReason:"Project documentation is classified and cannot be attached.",
    };
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ sections }), 0);
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    if (res.status === 422) {
      const fields = res.body.fields as Array<{ field: string }>;
      expect(fields.every((f) => f.field !== "supportingDocs")).toBe(true);
    }
  });

  it("PMR-NUM-09a: activity actualExpenditure stored as empty string → 422 (mirrors frontend blank=missing rule)", async () => {
    // Frontend: `a.actualExpenditure === "" ? null : Number(...)` — blank string is treated as missing.
    // Number("") === 0, so the backend must reject empty string BEFORE numeric conversion.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const emptyStringActivity = validActivity({ actualExpenditure: "" });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [emptyStringActivity] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("actualExpenditure"))).toBe(true);
  });

  it("PMR-NUM-09b: activity actualExpenditure stored as whitespace string → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const wsActivity = validActivity({ actualExpenditure: "   " });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [wsActivity] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("actualExpenditure"))).toBe(true);
  });

  it("PMR-NUM-09: activity actualExpenditure stored as non-numeric string → 422 (NaN treated as missing)", async () => {
    // A PATCH does not validate activity JSONB internals, so a string value can reach submit.
    // Number("not-a-number") === NaN; the gate must treat it as missing (not pass the >= 0 check).
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const nanActivity = validActivity({ actualExpenditure: "not-a-number" });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [nanActivity] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("actualExpenditure"))).toBe(true);
  });

  it("PMR-NUM-10: project has no currency but report has positive expenditure → 422", async () => {
    // Mirrors the frontend rule that blocks submit when the linked project has no currency set.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    // currency: null → SELECT currency FROM projects returns no currency row
    mockPmrClientSequence(pmrLockRow(), pmrContentRow(), 1, null);
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field === "projectCurrency")).toBe(true);
  });

  it("PMR-NUM-11: project has no currency but all activities have zero expenditure → not blocked by currency gate", async () => {
    // Currency gate only fires when there is positive expenditure.
    // A report with all-zero actual expenditure must not be blocked by the currency rule.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const zeroSpendActivity = validActivity({ actualExpenditure: 0 });
    // currency: null — but gate should not fire since expenditure = 0
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroSpendActivity] }), 1, null);
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    if (res.status === 422) {
      const fields = res.body.fields as Array<{ field: string }>;
      expect(fields.every((f) => f.field !== "projectCurrency")).toBe(true);
    }
  });

  it("PMR-NUM-08-placeholder: placeholder before PMR-BEN suite", async () => {
    // Tests moved to PMR-BEN suite below — this placeholder keeps numbering stable.
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite PMR-BEN — beneficiary validation (BD-2: zero is valid)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /reports/:id/transitions — PMR-BEN: beneficiary field validation (BD-2)", () => {
  /** Activity with explicit 0 for all beneficiary fields */
  function zeroBenActivity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return validActivity({
      beneficiariesMen:   0,
      beneficiariesWomen: 0,
      beneficiariesBoys:  0,
      beneficiariesGirls: 0,
      ...overrides,
    });
  }

  it("PMR-BEN-01: state PMR with positive beneficiaries → submits", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-BEN-02: state PMR with all beneficiary values = 0 → submits (BD-2)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroBenActivity()] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-03: HQ PMR with all beneficiary values = 0 → submits (BD-2)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(
      pmrLockRow({ stateId: null }),
      pmrContentRow({ location_type: "hq", state_id: null, activities: [zeroBenActivity()] }),
    );
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-04: activity with all beneficiary values = 0 is valid", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroBenActivity()] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-05: activity with actualExpenditure > 0 and beneficiaries = 0 → valid", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = zeroBenActivity({ actualExpenditure: 500, plannedBudget: 500 });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-06: activity with status Completed and beneficiaries = 0 → valid", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = zeroBenActivity({ status: "Completed" });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-07: negative beneficiary value → 422 with beneficiary field error", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesMen: -5 });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-08: blank string beneficiary field → 422 (missing, not treated as 0)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesMen: "" });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-09: whitespace-only beneficiary string → 422 (blank = missing)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesWomen: "   " });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-10: non-numeric beneficiary string → 422", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesBoys: "abc" });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-11: aggregate total = 0 → does not block submit", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroBenActivity()] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // Must pass — beneficiariesTotal aggregate gate is removed
    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-12: aggregate total > 0 → still valid", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
  });

  it("PMR-BEN-LIFE-01: draft with zero beneficiaries saves without error (PATCH path)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{
          status: "draft", sector: "WASH", projectId: 10,
          reportType: "project", authorId: 42, sections: {},
        }],
      })
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ activities: [{ name: "A", beneficiariesMen: 0, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0 }] });

    expect(res.status).not.toBe(422);
  });

  it("PMR-BEN-LIFE-02: complete zero-beneficiary draft → submits", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroBenActivity()] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-LIFE-03: returned zero-beneficiary PMR resubmits (status=draft after return)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow({ status: "draft" }), pmrContentRow({ activities: [zeroBenActivity()] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-LIFE-04: zero-beneficiary PMR where achievementSummary is blank → still fails (unrelated rule)", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = zeroBenActivity({ achievementSummary: "" });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("achievementSummary"))).toBe(true);
  });

  it("PMR-BEN-HQ-01: HQ project report with 0 beneficiary reach → passes beneficiary validation", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(
      pmrLockRow({ stateId: null }),
      pmrContentRow({ location_type: "hq", state_id: null, activities: [zeroBenActivity()] }),
    );
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-HQ-02: HQ project report still requires achievementSummary + expenditure + evidence", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const incompleteAct = zeroBenActivity({ achievementSummary: "", actualExpenditure: null });
    mockPmrClientSequence(
      pmrLockRow({ stateId: null }),
      pmrContentRow({ location_type: "hq", state_id: null, activities: [incompleteAct] }),
      0, // no attachments
    );
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("achievementSummary") || f.field.includes("actualExpenditure") || f.field === "supportingDocs")).toBe(true);
  });

  it("PMR-BEN-STATE-01: state PMR with zero reach → passes beneficiary validation", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [zeroBenActivity()] }));
    mockPoolQuery.mockResolvedValueOnce(pmrGetReportSector()).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(422);
    expect(res.body.error).not.toBe("report_content_incomplete");
  });

  it("PMR-BEN-13: boolean true beneficiary value → 422 (non-string/non-number type rejected)", async () => {
    // Number(true) === 1, so naive coercion would silently accept boolean.
    // parseBenField must check typeof first and reject non-string/non-number.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesMen: true });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-14: boolean false beneficiary value → 422 (treated as missing, not as 0)", async () => {
    // Number(false) === 0, so naive coercion would treat false as explicit zero.
    // parseBenField must reject booleans — only number/string types are accepted.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesWomen: false });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-15: array beneficiary value → 422 (object-type rejected)", async () => {
    // Number([]) === 0 and Number([1]) === 1, so naive coercion would pass arrays.
    // parseBenField must reject non-string/non-number types.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesBoys: [] });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });

  it("PMR-BEN-STATE-02: state PMR with negative beneficiary reach → fails", async () => {
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const act = validActivity({ beneficiariesGirls: -10 });
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ activities: [act] }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    const fields = res.body.fields as Array<{ field: string }>;
    expect(fields.some((f) => f.field.includes("beneficiar"))).toBe(true);
  });
});

// Kept for completeness — activity report gate unchanged
describe("POST /reports/:id/transitions — PMR-NUM-AR: activity report gate unchanged", () => {
  it("PMR-NUM-08: Activity Report submit gate unchanged — activity report not 422 for PMR checks", async () => {
    // Confirm the existing Activity Report gate is unaffected; PMR gate is project-only.
    // A submitted activity report (modern) with missing PMR fields (activities=[]) must NOT
    // fail with a PMR-specific error — it reaches the Activity gate, not the PMR gate.
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const arLockRow = {
      status:       "draft",
      reportType:   "activity",    // <-- activity, not project
      stateId:      1,
      sector:       "WASH",
      projectId:    null,
      activityId:   10,
      workflowPath: "state_authored",
      authorId:     42,
    };
    const arContentRow = {
      title:                "July AR",
      activityName:         "Health Outreach",
      sections:             { _schemaVersion: "modern", implementationStatus: "completed",
                              implementationSummary: "Done", resultsAchieved: "Met targets",
                              hasBeneficiaryReach: "yes", hasChallenges: "no",
                              lessonsLearned: "Key insight." },
      period:               "2026-07",
      reportingMonth:       7,
      reportingYear:        2026,
      stateId:              1,
      locationType:         "state",
      beneficiariesMale:    50,
      beneficiariesFemale:  60,
      beneficiariesBoys:    30,
      beneficiariesGirls:   40,
    };
    // AR gate uses different client sequence (no attachments query)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })              // BEGIN
      .mockResolvedValueOnce({ rows: [arLockRow] })     // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [arContentRow] })  // AR content SELECT
      // Remaining defaults
      ;
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        reportType: "activity", projectId: null, projectSector: null,
        activitySector: "WASH", effectiveSector: "WASH",
      }],
    }).mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    // AR gate ran; PMR gate did NOT run (reportType=activity)
    // Result may be 200 (gate passed) or 422 via AR gate — either way, must not be
    // a PMR-specific field error (activities, supportingDocs, etc.)
    if (res.status === 422) {
      const fields = res.body.fields as Array<string | { field: string }>;
      const fieldNames = fields.map((f) => typeof f === "string" ? f : f.field);
      expect(fieldNames.every((f) => f !== "activities" && f !== "supportingDocs")).toBe(true);
    }
  });
});
