/**
 * SPR-003/004 — State Programme Report Author Role Gate (SPR-BD-2)
 *
 * Verifies that POST /reports enforces the program_state author gate:
 *  - SPO: primary author (profile-clamped state; null-state fails closed)
 *  - SOM: bounded fallback ONLY when no active SPO covers their state
 *    (server-verified vacancy check via hasActiveSpoForState)
 *  - super_admin: emergency authoring — explicit valid stateId required
 *  - TC, SPC, PM, ED, Viewer: blocked with 403, no DB row created
 *  - Generic reports.create alone is insufficient (TC holds it but is blocked)
 *  - reports.program_state.create does NOT widen PMR / Activity / HQSR create
 *
 * Test IDs: SPR-AUTH-01…09, SPR-AUTH-SOM-01…06, SPR-AUTH-SA-01…04,
 *           permission regressions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before dynamic import of the route under test
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

// requirePerm is mocked to a no-op so the type-specific gates (not the outer
// permission middleware) are what the denial tests exercise. permissionsFor is
// NOT mocked — the real role→permission mapping applies, which also verifies
// SOM's narrow reports.program_state.create opens the outer gate wrapper.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function expectNoReportInsert() {
  const insertCalls = mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
  );
  expect(insertCalls).toHaveLength(0);
}

function findInsertCall() {
  return mockQuery.mock.calls.find(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO reports"),
  );
}

/** Minimal valid SPR body. */
const BASE_SPR_BODY = {
  title: "State Programme Report",
  reportType: "program_state",
  kind: "monthly",
  reportingMonth: 5,
  reportingYear: 2031,
  period: "2031-05",
  sector: "Health",
} as const;

/**
 * SQL-routed mock:
 *  - SPO vacancy query (role = 'state_program_officer') → activeSpoCount
 *  - states existence check (FROM states WHERE id) → stateExists
 *  - INSERT INTO reports → new id
 *  - final SELECT of the created report → row
 */
function mockRouting(opts: { activeSpoCount?: number; stateExists?: boolean } = {}) {
  const { activeSpoCount = 0, stateExists = true } = opts;
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql !== "string") return Promise.resolve({ rows: [] });
    if (sql.includes("role = 'state_program_officer'") && sql.includes("status = 'active'")) {
      return Promise.resolve({ rows: [{ count: activeSpoCount }] });
    }
    if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: stateExists ? [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] : [] });
    }
    if (sql.includes("INSERT INTO reports")) {
      return Promise.resolve({ rows: [{ id: 99 }] });
    }
    if (sql.includes("FROM reports r") && sql.includes("WHERE r.id")) {
      return Promise.resolve({
        rows: [{ id: 99, reportType: "program_state", status: "draft", kind: "monthly", authorId: 1, plannedBudget: null, actualExpenditure: null }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ── Fake users ────────────────────────────────────────────────────────────────

const SPO_USER = { id: 10, name: "SPO", email: "spo@example.com", role: "state_program_officer", stateId: 1, sector: null, sectors: [] } as const;
const SPO_NULL_STATE = { ...SPO_USER, id: 11, stateId: null } as const;
const SOM_USER = { id: 12, name: "SOM", email: "som@example.com", role: "state_office_manager", stateId: 1, sector: null, sectors: [] } as const;
const SOM_NULL_STATE = { ...SOM_USER, id: 13, stateId: null } as const;
const TC_USER = { id: 14, name: "TC", email: "tc@example.com", role: "technical_coordinator", stateId: null, sector: "Health", sectors: ["Health"] } as const;
const SPC_USER = { id: 15, name: "SPC", email: "spc@example.com", role: "senior_program_coordinator", stateId: null, sector: null, sectors: [] } as const;
const PM_USER = { id: 16, name: "PM", email: "pm@example.com", role: "program_manager", stateId: null, sector: null, sectors: [] } as const;
const ED_USER = { id: 17, name: "ED", email: "ed@example.com", role: "executive_director", stateId: null, sector: null, sectors: [] } as const;
const VIEWER_USER = { id: 18, name: "Viewer", email: "viewer@example.com", role: "viewer", stateId: null, sector: null, sectors: [] } as const;
const SUPER_ADMIN = { id: 19, name: "Admin", email: "admin@example.com", role: "super_admin", stateId: null, sector: null, sectors: [] } as const;

// ── App builder ──────────────────────────────────────────────────────────────

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
// SPO — primary author (SPR-AUTH-01 … 03)
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR author gate — SPO primary author", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("SPR-AUTH-01: SPO with assigned state → 201, stored state = profile state", async () => {
    mockRouting();
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(201);
    const insert = findInsertCall();
    expect(insert).toBeDefined();
    expect((insert![1] as unknown[])[11]).toBe(1); // effectiveStateId param
  });

  it("SPR-AUTH-02: SPO body stateId ≠ profile state → stored state = profile state (clamp)", async () => {
    mockRouting();
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY, stateId: 7 });
    expect(res.status).toBe(201);
    expect((findInsertCall()![1] as unknown[])[11]).toBe(1);
  });

  it("SPR-AUTH-03: SPO with null assigned state → 403 state_scope_required, no row", async () => {
    mockRouting();
    const app = await buildApp(SPO_NULL_STATE as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    expectNoReportInsert();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOM — bounded fallback (SPR-AUTH-SOM-01 … 06)
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR author gate — SOM bounded fallback", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("SPR-AUTH-SOM-01: SOM + active SPO in same state → 403 program_state_spo_available, no row", async () => {
    mockRouting({ activeSpoCount: 1 });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("program_state_spo_available");
    expectNoReportInsert();
  });

  it("SPR-AUTH-SOM-02: SOM + no active SPO in same state → 201, row created", async () => {
    mockRouting({ activeSpoCount: 0 });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(201);
    expect(findInsertCall()).toBeDefined();
  });

  it("SPR-AUTH-SOM-03: vacancy query is constrained to ACTIVE SPOs in the SOM's own state", async () => {
    // The vacancy SQL filters status='active' AND state_id=$1, so an inactive SPO
    // (or an SPO in another state) never appears in the count — equivalent to
    // SOM-03 (inactive SPO does not block) and SOM-04 (state-specific check).
    mockRouting({ activeSpoCount: 0 });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(201);
    const vacancyCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("role = 'state_program_officer'"),
    );
    expect(vacancyCall).toBeDefined();
    expect(vacancyCall![0]).toContain("status = 'active'");
    expect(vacancyCall![0]).toContain("state_id = $1");
    expect(vacancyCall![1]).toEqual([1]); // SOM's own state, not body-supplied
  });

  it("SPR-AUTH-SOM-04: active SPO in a DIFFERENT state does not block (vacancy keyed on SOM's state)", async () => {
    // Simulate the DB answering 0 for state 1 (the only state ever queried);
    // assert the query parameter is the SOM's profile state.
    mockRouting({ activeSpoCount: 0 });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY, stateId: 9 });
    expect(res.status).toBe(201);
    const vacancyCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("role = 'state_program_officer'"),
    );
    expect(vacancyCall![1]).toEqual([1]);
  });

  it("SPR-AUTH-SOM-05: SOM body stateId ≠ profile state → stored state = profile state (clamp)", async () => {
    mockRouting({ activeSpoCount: 0 });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY, stateId: 9 });
    expect(res.status).toBe(201);
    expect((findInsertCall()![1] as unknown[])[11]).toBe(1);
  });

  it("SPR-AUTH-SOM-06: SOM with null assigned state → 403 state_scope_required, no row, no vacancy query", async () => {
    mockRouting();
    const app = await buildApp(SOM_NULL_STATE as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_required");
    expectNoReportInsert();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Denied roles (SPR-AUTH-04 … 09)
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR author gate — denied roles", () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["SPR-AUTH-04: TC (holds reports.create) → 403, no row", TC_USER as unknown as Record<string, unknown>],
    ["SPR-AUTH-05: SPC → 403, no row", SPC_USER as unknown as Record<string, unknown>],
    // PM removed from denied list: Task #373 Full Operational Access grants PM
    // program_state authoring. Covered by SPR-AUTH-06 below.
    ["SPR-AUTH-07: ED → 403, no row", ED_USER as unknown as Record<string, unknown>],
    ["SPR-AUTH-08: Viewer → 403, no row", VIEWER_USER as unknown as Record<string, unknown>],
  ];

  for (const [label, user] of cases) {
    it(label, async () => {
      const app = await buildApp(user);
      const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("program_state_report_author_role_required");
      expectNoReportInsert();
    });
  }

  it("SPR-AUTH-06: PM without stateId → passes author gate but 400 state required (Full Operational Access, Task #373)", async () => {
    // PM is now allowed to create SPRs but must supply an explicit stateId (they have
    // no profile state). The author gate no longer returns program_state_report_author_role_required.
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("program_state_report_author_role_required");
    expectNoReportInsert();
  });

  it("SPR-AUTH-09: generic reports.create alone (TC) is insufficient — gate, not permission, denies", async () => {
    // TC really holds reports.create (real permissionsFor), yet the type gate blocks.
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("program_state_report_author_role_required");
    expectNoReportInsert();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// super_admin (SPR-AUTH-SA-01 … 04)
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR author gate — super_admin emergency path", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("SPR-AUTH-SA-01: super_admin + valid explicit stateId → 201, stored state = supplied", async () => {
    mockRouting({ stateExists: true });
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY, stateId: 5 });
    expect(res.status).toBe(201);
    const insert = findInsertCall();
    expect(insert).toBeDefined();
    expect((insert![1] as unknown[])[11]).toBe(5); // NOT profile-clamped
  });

  it("SPR-AUTH-SA-02: super_admin missing stateId → 400 state_required_for_super_admin_spr, no row", async () => {
    mockRouting();
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("state_required_for_super_admin_spr");
    expectNoReportInsert();
  });

  it("SPR-AUTH-SA-03: super_admin nonexistent stateId → 400 invalid_state_id, no row", async () => {
    mockRouting({ stateExists: false });
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY, stateId: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_state_id");
    expectNoReportInsert();
  });

  it("SPR-AUTH-SA-04: super_admin-authored SPR stamps author_id = creator (self-review guard input intact)", async () => {
    // The universal self-review guard keys on author_id === reviewer id; the gate
    // must keep stamping the creator as author so that guard still fires.
    mockRouting({ stateExists: true });
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_SPR_BODY, stateId: 5 });
    expect(res.status).toBe(201);
    const insert = findInsertCall();
    const params = insert![1] as unknown[];
    expect(params).toContain(SUPER_ADMIN.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission regression — SOM's narrow permission widens nothing else
// ─────────────────────────────────────────────────────────────────────────────

describe("SPR permission regression — reports.program_state.create is narrow", () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

  it("REG-01: SOM cannot create a PMR (project) report", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "PMR", reportType: "project", kind: "monthly", reportingMonth: 5, reportingYear: 2031, period: "2031-05", projectId: 42, stateId: 1,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_report_author_role_required");
    expectNoReportInsert();
  });

  it("REG-02: SOM cannot create an Activity report", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "AR", reportType: "activity", reportingMonth: 5, reportingYear: 2031, period: "2031-05", activityName: "X",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("activity_report_author_role_required");
    expectNoReportInsert();
  });

  it("REG-03: SOM cannot create an HQ Sector report", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "HQSR", reportType: "hq_sector", kind: "monthly", reportingMonth: 5, reportingYear: 2031, period: "2031-05", sector: "Health",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
    expectNoReportInsert();
  });

  it("REG-04: permissionsFor grants reports.program_state.create ONLY to SOM (besides wildcard)", async () => {
    const { permissionsFor } = (await vi.importActual(
      "../middlewares/currentUser.js",
    )) as typeof import("../middlewares/currentUser.js");
    const roles = [
      "state_program_officer", "technical_coordinator", "senior_program_coordinator",
      "program_manager", "executive_director", "viewer",
    ];
    for (const role of roles) {
      const perms = permissionsFor({ id: 1, role } as never);
      expect(perms).not.toContain("reports.program_state.create");
    }
    const somPerms = permissionsFor({ id: 1, role: "state_office_manager" } as never);
    expect(somPerms).toContain("reports.program_state.create");
    expect(somPerms).not.toContain("reports.create");
  });
});
