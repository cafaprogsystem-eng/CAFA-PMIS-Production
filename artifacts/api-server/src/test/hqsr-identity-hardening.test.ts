/**
 * HQSR-002 — HQ Sector Report Identity Immutability (PATCH)
 *
 * Verifies that PATCH /reports/:reportId rejects any identity field for
 * hq_sector reports with 409 hq_sector_report_identity_immutable, using
 * present-key semantics (presence alone → 409, even with the same value),
 * while content-only PATCHes still succeed.
 *
 * The guard is actor-independent: TC, SPC fallback authors, PM, and
 * super_admin are all bound by it (no administrative bypass — HQSR sector
 * identity anchors the sector-scoped author gate).
 *
 * Test IDs: HQSR-ID-01 … HQSR-ID-17, HQSR-ID-LIFE-01 … 03,
 *           HQSR-ID-FB-01 … 03, HQSR-ID-OVR-01 … 04
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before any dynamic import of the route
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

const mockPermissionsFor = vi.fn().mockReturnValue(["reports.update", "reports.create"]);

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: mockPermissionsFor,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake users
// ─────────────────────────────────────────────────────────────────────────────

const TC_HEALTH = {
  id: 20,
  name: "TC Health",
  email: "tc-health@example.com",
  role: "technical_coordinator",
  stateId: null,
  sector: "Health",
  sectors: ["Health"],
} as const;

const SPC_USER = {
  id: 21,
  name: "SPC",
  email: "spc@example.com",
  role: "senior_program_coordinator",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const PM_USER = {
  id: 22,
  name: "PM",
  email: "pm@example.com",
  role: "program_manager",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const SUPER_ADMIN = {
  id: 1,
  name: "Super Admin",
  email: "admin@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// App builder
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
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH mock sequence: 1) cur report row, 2) getReportSector JOIN.
// The identity guard fires after these two queries.
// ─────────────────────────────────────────────────────────────────────────────

function patchSeq(overrides: Partial<{ status: string; authorId: number; workflowPath: string | null }> = {}) {
  const { status = "draft", authorId = TC_HEALTH.id, workflowPath = null } = overrides;
  return [
    { rows: [{ status, sector: "Health", projectId: null, reportType: "hq_sector", authorId, sections: null, workflowPath }] },
    { rows: [{ reportType: "hq_sector", projectId: null, projectSector: null, activitySector: null, effectiveSector: "Health" }] },
  ];
}

function mockSeq(seq: Array<{ rows: unknown[]; rowCount?: number }>) {
  let i = 0;
  mockQuery.mockImplementation(() => Promise.resolve(seq[i++] ?? { rows: [] }));
}

/** Full success sequence for a content-only PATCH reaching res.json. */
function fullPatchSuccessSeq(overrides: Partial<{ authorId: number; workflowPath: string | null }> = {}) {
  const { authorId = TC_HEALTH.id, workflowPath = null } = overrides;
  return [
    ...patchSeq({ authorId, workflowPath }),
    { rows: [], rowCount: 1 }, // UPDATE
    { rows: [{ id: 1, reportType: "hq_sector", status: "draft", kind: "monthly", sector: "Health", authorId, workflowPath, plannedBudget: null, actualExpenditure: null }] },
    { rows: [] }, // withHistory approvals
  ];
}

function findUpdateCall() {
  return mockQuery.mock.calls.find(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE reports SET"),
  );
}

const IDENTITY_409 = "hq_sector_report_identity_immutable";

const CONTENT_BODY = {
  title: "Updated HQ Sector Report",
  officerName: "Dr Test",
  sections: {
    technicalAnalysis: "Updated analysis",
    keyFindings: "New findings",
    recommendations: "Do more",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-002 — hq_sector identity immutability (PATCH)", () => {
  beforeAll(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    mockQuery.mockReset();
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.update", "reports.create"]);
  });

  it("HQSR-ID-01: content-only PATCH succeeds for TC draft author", async () => {
    mockSeq(fullPatchSuccessSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send(CONTENT_BODY);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  it("HQSR-ID-02/03: content PATCH issues an UPDATE and never writes identity columns", async () => {
    mockSeq(fullPatchSuccessSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send(CONTENT_BODY);
    expect(res.status).toBe(200);
    const update = findUpdateCall();
    expect(update).toBeDefined();
    const sql = update![0] as string;
    // Identity columns must not appear in the UPDATE statement's SET clause
    for (const col of ["sector =", "kind =", "period =", "reporting_month", "reporting_year", "quarter =", "period_start", "period_end", "state_id", "project_id", "report_type"]) {
      expect(sql.toLowerCase()).not.toContain(col);
    }
  });

  const identityCases: Array<[string, Record<string, unknown>]> = [
    ["HQSR-ID-04: sector", { sector: "Education" }],
    ["HQSR-ID-08: kind", { kind: "quarterly" }],
    ["HQSR-ID-09: period", { period: "2031-Q2" }],
    ["HQSR-ID-10: reportingMonth", { reportingMonth: 6 }],
    ["HQSR-ID-11: reportingYear", { reportingYear: 2032 }],
    ["HQSR-ID-12: quarter", { quarter: 2 }],
    ["HQSR-ID-13: periodStart", { periodStart: "2031-05-01" }],
    ["HQSR-ID-14: periodEnd", { periodEnd: "2031-05-31" }],
    ["HQSR-ID-15: reportType", { reportType: "program_state" }],
    ["HQSR-ID-16: stateId", { stateId: 2 }],
    ["HQSR-ID-17: projectId", { projectId: 7 }],
    ["snake_case report_type", { report_type: "program_state" }],
    ["snake_case state_id", { state_id: 2 }],
    ["snake_case project_id", { project_id: 7 }],
    ["snake_case reporting_month", { reporting_month: 6 }],
    ["snake_case reporting_year", { reporting_year: 2032 }],
    ["snake_case period_start", { period_start: "2031-05-01" }],
    ["snake_case period_end", { period_end: "2031-05-31" }],
  ];

  for (const [label, body] of identityCases) {
    it(`${label} PATCH → 409 ${IDENTITY_409}, no DB write`, async () => {
      mockSeq(patchSeq());
      const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
      const res = await request(app).patch("/api/projects/reports/1").send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(IDENTITY_409);
      expect(findUpdateCall()).toBeUndefined();
    });
  }

  it("HQSR-ID-05: same-value sector PATCH still rejected (present-key convention)", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ sector: "Health" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
    expect(findUpdateCall()).toBeUndefined();
  });

  it("HQSR-ID-06/07: Health TC PATCH sector to Education → 409, row untouched", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ sector: "Education", title: "smuggled alongside content" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
    // No UPDATE ever issued → sector remains "Health" in DB
    expect(findUpdateCall()).toBeUndefined();
  });

  it("present-key with undefined-adjacent values (null) still rejected", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ reportingMonth: null });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
  });

  // ── Returned draft lifecycle ───────────────────────────────────────────────

  it("HQSR-ID-LIFE-01: returned draft — content PATCH succeeds", async () => {
    mockSeq(fullPatchSuccessSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ sections: { technicalAnalysis: "revised per reviewer feedback" } });
    expect(res.status).toBe(200);
  });

  it("HQSR-ID-LIFE-02: returned draft — PATCH sector → 409", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ sector: "Education" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
  });

  it("HQSR-ID-LIFE-03: returned draft — PATCH period field → 409", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ reportingMonth: 7, reportingYear: 2032 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
  });

  it("non-draft HQSR PATCH still rejected before identity guard (regression)", async () => {
    mockSeq(patchSeq({ status: "submitted" }));
    const app = await buildApp(TC_HEALTH as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ title: "x" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("only_draft_reports_can_be_updated");
  });

  // ── SPC fallback author ────────────────────────────────────────────────────

  it("HQSR-ID-FB-01/02: SPC fallback author content PATCH → 200; workflow_path not written", async () => {
    mockSeq(fullPatchSuccessSeq({ authorId: SPC_USER.id, workflowPath: "spc_fallback" }));
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send(CONTENT_BODY);
    expect(res.status).toBe(200);
    const update = findUpdateCall();
    expect(update).toBeDefined();
    expect((update![0] as string).toLowerCase()).not.toContain("workflow_path");
  });

  it("HQSR-ID-FB-03: SPC fallback author PATCH sector → 409", async () => {
    mockSeq(patchSeq({ authorId: SPC_USER.id, workflowPath: "spc_fallback" }));
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ sector: "Education" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
  });

  // ── Full Operational Access / admin actors — no bypass ────────────────────

  it("HQSR-ID-OVR-02: PM PATCH sector/period → 409 (no bypass)", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    mockSeq(patchSeq({ authorId: PM_USER.id }));
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ sector: "Education", period: "2031-07" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
  });

  it("HQSR-ID-OVR-03: super_admin content PATCH → 200", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    mockSeq(fullPatchSuccessSeq({ authorId: TC_HEALTH.id }));
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send(CONTENT_BODY);
    expect(res.status).toBe(200);
  });

  it("HQSR-ID-OVR-04: super_admin identity PATCH → 409 (actor-independent, no admin bypass)", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    mockSeq(patchSeq({ authorId: TC_HEALTH.id }));
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ sector: "Education" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
    expect(findUpdateCall()).toBeUndefined();
  });
});
