/**
 * SPR-002 — State Programme Report Identity Immutability & State Scope Hardening
 *
 * Verifies:
 *  1. PATCH /reports/:reportId rejects any identity field for program_state
 *     reports with 409 program_state_report_identity_immutable.
 *  2. POST /reports fails closed (403, no row) when a state-scoped role with a
 *     null assigned state attempts to create an SPR.
 *  3. The existing create clamp still stores the author's own stateId even when
 *     the body claims a different state.
 *
 * Test IDs:
 *   SPR-ID-01 … SPR-ID-10        — PATCH identity immutability
 *   SPR-ID-SEC-01 … SPR-ID-SEC-03 — state scope security
 *   SPR-ID-LIFE-01               — returned draft identity remains locked
 *   SPR-ID-FREQ-01 … 04          — all frequencies still creatable
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

const SPO_STATE1 = {
  id: 10,
  name: "SPO State 1",
  email: "spo1@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

const SPO_NULL_STATE = {
  ...SPO_STATE1,
  id: 11,
  email: "sponull@example.com",
  stateId: null,
} as const;

const SOM_NULL_STATE = {
  ...SPO_NULL_STATE,
  id: 12,
  email: "somnull@example.com",
  role: "state_office_manager",
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

function patchSeq(overrides: Partial<{ status: string; authorId: number }> = {}) {
  const { status = "draft", authorId = SPO_STATE1.id } = overrides;
  return [
    { rows: [{ status, sector: null, projectId: null, reportType: "program_state", authorId, sections: null }] },
    { rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null }] },
  ];
}

function mockSeq(seq: Array<{ rows: unknown[]; rowCount?: number }>) {
  let i = 0;
  mockQuery.mockImplementation(() => Promise.resolve(seq[i++] ?? { rows: [] }));
}

/** Full success sequence for a content-only PATCH reaching res.json. */
function fullPatchSuccessSeq() {
  return [
    ...patchSeq(),
    { rows: [], rowCount: 1 }, // UPDATE
    { rows: [{ id: 1, reportType: "program_state", status: "draft", kind: "monthly", authorId: SPO_STATE1.id, plannedBudget: null, actualExpenditure: null }] },
    { rows: [] }, // withHistory approvals
  ];
}

// SQL-routed mock for POST create tests: answers by statement shape.
function mockCreateRouting() {
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && /FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] });
    }
    if (typeof sql === "string" && sql.includes("INSERT INTO reports")) {
      return Promise.resolve({ rows: [{ id: 99 }] });
    }
    if (typeof sql === "string" && sql.includes("FROM reports r") && sql.includes("WHERE r.id")) {
      return Promise.resolve({
        rows: [{ id: 99, reportType: "program_state", status: "draft", kind: "monthly", authorId: SPO_STATE1.id, plannedBudget: null, actualExpenditure: null }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

function findInsertCall() {
  return mockQuery.mock.calls.find(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO reports"),
  );
}

const IDENTITY_409 = "program_state_report_identity_immutable";

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR-002 — program_state identity immutability (PATCH)", () => {
  beforeAll(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    mockQuery.mockReset();
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.update", "reports.create"]);
  });

  it("SPR-ID-01: content-only PATCH succeeds for eligible draft author", async () => {
    mockSeq(fullPatchSuccessSeq());
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ title: "Updated title", narrative: "New narrative", sections: { keyAchievements: "x" }, activities: [], sector: "Health" });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  const identityCases: Array<[string, Record<string, unknown>]> = [
    ["SPR-ID-02: stateId", { stateId: 2 }],
    ["SPR-ID-03: kind", { kind: "quarterly" }],
    ["SPR-ID-04: period", { period: "2031-Q2" }],
    ["SPR-ID-05: reportingMonth", { reportingMonth: 6 }],
    ["SPR-ID-06: reportingYear", { reportingYear: 2032 }],
    ["SPR-ID-07: quarter", { quarter: 2 }],
    ["SPR-ID-08: periodStart", { periodStart: "2031-05-01" }],
    ["SPR-ID-09: periodEnd", { periodEnd: "2031-05-31" }],
    ["SPR-ID-10: reportType", { reportType: "hq_sector" }],
  ];

  for (const [label, body] of identityCases) {
    it(`${label} PATCH → 409 ${IDENTITY_409}`, async () => {
      mockSeq(patchSeq());
      const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
      const res = await request(app).patch("/api/projects/reports/1").send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(IDENTITY_409);
      // No UPDATE must have been issued
      const update = mockQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE reports SET"),
      );
      expect(update).toBeUndefined();
    });
  }

  it("SPR-ID-02b: same-value identity PATCH still rejected (present-key convention)", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ stateId: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
  });

  it("SPR-ID-SEC-01: SPO State 1 PATCH stateId=2 → 409 and no DB write", async () => {
    mockSeq(patchSeq());
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ stateId: 2, kind: "quarterly", period: "2031-Q2", reportingMonth: null });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);
    const update = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE reports SET"),
    );
    expect(update).toBeUndefined(); // report row untouched → stateId remains 1
  });

  it("SPR-ID-LIFE-01: returned draft (post-request_revision) identity locked, content editable", async () => {
    // Identity attempt on a draft (returned drafts have status=draft again) → 409
    mockSeq(patchSeq());
    let app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    let res = await request(app).patch("/api/projects/reports/1").send({ kind: "annual" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(IDENTITY_409);

    // Content edit on the same returned draft still succeeds
    mockQuery.mockReset();
    mockSeq(fullPatchSuccessSeq());
    app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    res = await request(app).patch("/api/projects/reports/1").send({ narrative: "revised per feedback" });
    expect(res.status).toBe(200);
  });

  it("non-draft SPR PATCH still rejected before identity guard (regression)", async () => {
    mockSeq(patchSeq({ status: "submitted" }));
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ title: "x" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("only_draft_reports_can_be_updated");
  });

  it("super_admin may bypass the identity guard (administrative corrections)", async () => {
    const SUPER = { ...SPO_STATE1, id: 1, role: "super_admin" };
    mockPermissionsFor.mockReturnValue(["*"]);
    const seq = [
      { rows: [{ status: "draft", sector: null, projectId: null, reportType: "program_state", authorId: 10, sections: null }] },
      { rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null }] },
      { rows: [], rowCount: 1 },
      { rows: [{ id: 1, reportType: "program_state", status: "draft", kind: "monthly", authorId: 10, plannedBudget: null, actualExpenditure: null }] },
      { rows: [] },
    ];
    mockSeq(seq);
    const app = await buildApp(SUPER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/projects/reports/1").send({ stateId: 3 });
    expect(res.status).toBe(200);
  });
});

describe("SPR-002 — null-state create fail-closed & clamp (POST)", () => {
  beforeAll(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    mockQuery.mockReset();
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.create", "reports.update"]);
  });

  const monthlyBody = {
    title: "State Programme Report",
    reportType: "program_state",
    kind: "monthly",
    reportingMonth: 5,
    reportingYear: 2031,
    period: "2031-05",
    sector: "Health",
  };

  it("SPR-ID-SEC-02: SPO with null assigned state → 403, no row created", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(SPO_NULL_STATE as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(monthlyBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    expect(findInsertCall()).toBeUndefined();
  });

  it("SPR-ID-SEC-02b: SOM with null assigned state → 403, no row created", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(SOM_NULL_STATE as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(monthlyBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    expect(findInsertCall()).toBeUndefined();
  });

  it("SPR-ID-SEC-02c: null-state SPO body stateId also rejected (no spoof-around)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(SPO_NULL_STATE as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...monthlyBody, stateId: 2 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    expect(findInsertCall()).toBeUndefined();
  });

  it("SPR-ID-SEC-03: SPO State 1 creating with body stateId=2 → stored state = 1 (clamp)", async () => {
    mockCreateRouting();
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...monthlyBody, stateId: 2 });
    expect(res.status).toBe(201);
    const insert = findInsertCall();
    expect(insert).toBeDefined();
    const params = insert![1] as unknown[];
    // effectiveStateId is the 12th INSERT parameter (index 11)
    expect(params[11]).toBe(1);
  });

  const freqBodies: Array<[string, Record<string, unknown>]> = [
    ["SPR-ID-FREQ-01 monthly", monthlyBody],
    ["SPR-ID-FREQ-02 quarterly", { title: "Q", reportType: "program_state", kind: "quarterly", quarter: 2, reportingYear: 2031, period: "2031-Q2", sector: "Health" }],
    ["SPR-ID-FREQ-03 annual", { title: "A", reportType: "program_state", kind: "annual", reportingYear: 2031, period: "2031", sector: "Health" }],
    ["SPR-ID-FREQ-04 on_demand", { title: "OD", reportType: "program_state", kind: "on_demand", reportingYear: 2031, period: "2031-05-01", periodStart: "2031-05-01", periodEnd: "2031-05-15", sector: "Health" }],
  ];

  for (const [label, body] of freqBodies) {
    it(`${label}: SPO State 1 creation still works, stored state = 1`, async () => {
      mockCreateRouting();
      const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
      const res = await request(app).post("/api/projects/reports").send(body);
      expect(res.status).toBe(201);
      const insert = findInsertCall();
      expect(insert).toBeDefined();
      expect((insert![1] as unknown[])[11]).toBe(1);
    });
  }
});
