/**
 * HQ Sector Report Author Role Gate — Backend Tests
 * (HQSR-AUTH-01 through HQSR-AUTH-13 + HQSR-AUTH-SPC-01 through SPC-06)
 *
 * Verifies that POST /reports enforces the HQSR-001 author gate:
 *  - TC may create HQ Sector Reports for assigned sector(s) only (exact match)
 *  - super_admin may create (emergency authoring)
 *  - SPC fallback (HQSR-BD-1/BD-6, ENABLED): vacancy check is server-verified;
 *    SPC may create when no active TC covers the sector. PM performs
 *    coordination_review for SPC-authored fallback reports.
 *  - SPO, SOM, PM, ED, Viewer are blocked with 403 and no DB row is created.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before dynamic import of the route under test
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn().mockReturnValue(["reports.create"]),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const GATE_ERRORS = [
  "hq_sector_author_role_required",
  "hq_sector_tc_available",
  "sector_scope_forbidden",
];

/** Assert that no INSERT INTO reports was ever issued (DB-level denial proof). */
function expectNoReportInsert() {
  const insertCalls = mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
  );
  expect(insertCalls).toHaveLength(0);
}

/** Minimal valid HQ Sector Report body. */
const BASE_HQSR_BODY = {
  title: "Test HQ Sector Report",
  kind: "monthly",
  reportType: "hq_sector",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  sector: "WASH",
} as const;

// ── Fake users ────────────────────────────────────────────────────────────────

const TC_USER = {
  id: 11, name: "TC Test", email: "tc@example.com",
  role: "technical_coordinator", stateId: null, sector: "WASH", sectors: ["WASH"],
} as const;

const TC_MULTI_USER = {
  ...TC_USER, id: 17, sector: "WASH,Health", sectors: ["WASH", "Health"],
} as const;

const TC_NO_SECTOR_USER = {
  ...TC_USER, id: 18, sector: null, sectors: [] as string[],
} as const;

const SUPER_ADMIN_USER = {
  id: 12, name: "Admin", email: "admin@example.com",
  role: "super_admin", stateId: null, sector: null, sectors: [],
} as const;

const SPO_USER = {
  id: 10, name: "SPO", email: "spo@example.com",
  role: "state_program_officer", stateId: 1, sector: null, sectors: [],
} as const;

const SOM_USER = {
  id: 13, name: "SOM", email: "som@example.com",
  role: "state_office_manager", stateId: 1, sector: null, sectors: [],
} as const;

const PM_USER = {
  id: 14, name: "PM", email: "pm@example.com",
  role: "program_manager", stateId: null, sector: null, sectors: [],
} as const;

const SPC_USER = {
  id: 15, name: "SPC", email: "spc@example.com",
  role: "senior_program_coordinator", stateId: null, sector: null, sectors: [],
} as const;

const ED_USER = {
  id: 16, name: "ED", email: "ed@example.com",
  role: "executive_director", stateId: null, sector: null, sectors: [],
} as const;

const VIEWER_USER = {
  id: 19, name: "Viewer", email: "viewer@example.com",
  role: "viewer", stateId: null, sector: null, sectors: [],
} as const;

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

/** Mock the SPC vacancy query (SELECT sector FROM users WHERE role = 'technical_coordinator' ...). */
function mockTcRoster(sectorsCsvList: string[]) {
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("role = 'technical_coordinator'") && sql.includes("status = 'active'")) {
      return Promise.resolve({ rows: sectorsCsvList.map((s) => ({ sector: s })) });
    }
    // HQSR duplicate guard (Migration 023): return empty to simulate "no existing duplicate".
    // Without this, the catch-all { id: 99 } row would cause a 409 on every successful create test.
    if (typeof sql === "string" && sql.includes("report_type = 'hq_sector'") && !sql.includes("INSERT")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [{ id: 99 }] });
  });
}

/**
 * Default success mock: no active duplicate for any HQSR period,
 * everything else returns a valid row (e.g. INSERT RETURNING id).
 */
function mockAllowCreate() {
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("report_type = 'hq_sector'") && !sql.includes("INSERT")) {
      return Promise.resolve({ rows: [] }); // no duplicate
    }
    return Promise.resolve({ rows: [{ id: 99 }] });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Normal TC authors (HQSR-AUTH-01 – 05)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR author gate — TC (HQSR-AUTH-01 through 05)", () => {
  beforeEach(() => { mockQuery.mockReset(); mockAllowCreate(); });

  it("HQSR-AUTH-01: assigned TC creates own-sector HQ report → passes gate (201)", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
  });

  it("HQSR-AUTH-02: multi-sector TC may create for either assigned sector", async () => {
    const app = await buildApp(TC_MULTI_USER as unknown as Record<string, unknown>);
    const res1 = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "WASH" });
    expect(res1.status).toBe(201);
    const res2 = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "Health", reportingMonth: 7, period: "2026-07" });
    expect(res2.status).toBe(201);
  });

  it("HQSR-AUTH-03: TC requesting a sector outside assignment → 403 sector_scope_forbidden, no row", async () => {
    mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "Health" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_scope_forbidden");
    expectNoReportInsert();
  });

  it("HQSR-AUTH-04: TC with no assigned sectors → 403 fail-closed, no row", async () => {
    mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_NO_SECTOR_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_scope_forbidden");
    expectNoReportInsert();
  });

  it("HQSR-AUTH-05: blank sector → 400 rejected, no row", async () => {
    mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "  " });
    expect(res.status).toBe(400);
    expectNoReportInsert();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Denied roles (HQSR-AUTH-06 – 11)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR author gate — denied roles (HQSR-AUTH-06 through 11)", () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["HQSR-AUTH-06: SPO with reports.create → 403, no row", SPO_USER as unknown as Record<string, unknown>],
    ["HQSR-AUTH-07: SOM → 403, no row", SOM_USER as unknown as Record<string, unknown>],
    // PM removed from denied list: Task #373 Full Operational Access grants PM
    // hq_sector authoring. Covered by HQSR-AUTH-08 below.
    ["HQSR-AUTH-09: ED → 403, no row", ED_USER as unknown as Record<string, unknown>],
    ["HQSR-AUTH-10: Viewer → 403, no row", VIEWER_USER as unknown as Record<string, unknown>],
  ];

  for (const [label, user] of cases) {
    it(label, async () => {
      const app = await buildApp(user);
      const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("hq_sector_author_role_required");
      expectNoReportInsert();
    });
  }

  it("HQSR-AUTH-08: PM with valid sector → passes author gate (Full Operational Access, Task #373)", async () => {
    // PM is now allowed to create HQ Sector Reports (Task #373 governance rule).
    // The author gate no longer returns hq_sector_author_role_required for PM.
    // Any non-403-gate response confirms PM passed the gate.
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("hq_sector_author_role_required");
  });

  it("HQSR-AUTH-11: generic reports.create without an approved author role is insufficient", async () => {
    // A hypothetical role holding reports.create but not in the approved set.
    const GENERIC = { id: 20, name: "X", email: "x@example.com", role: "hq_sector_officer", stateId: null, sector: "WASH", sectors: [] };
    const app = await buildApp(GENERIC as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
    expectNoReportInsert();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// super_admin (HQSR-AUTH-12 – 13)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR author gate — super_admin (HQSR-AUTH-12, 13)", () => {
  beforeEach(() => { mockQuery.mockReset(); mockAllowCreate(); });

  it("HQSR-AUTH-12: super_admin creates a valid HQ Sector Report → allowed", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    vi.mocked(permissionsFor).mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    vi.mocked(permissionsFor).mockReturnValue(["reports.create"]);
  });

  it("HQSR-AUTH-12b: super_admin with blank/whitespace sector → 400, no row", async () => {
    mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] });
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    vi.mocked(permissionsFor).mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    for (const sector of ["", "   ", undefined]) {
      const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector });
      expect(res.status).toBe(400);
    }
    expectNoReportInsert();
    vi.mocked(permissionsFor).mockReturnValue(["reports.create"]);
  });

  it("HQSR-AUTH-12c: super_admin with non-canonical sector → 400 invalid_sector, no row", async () => {
    mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] });
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    vi.mocked(permissionsFor).mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "FAKE_SECTOR_XYZ" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_sector");
    expectNoReportInsert();
    vi.mocked(permissionsFor).mockReturnValue(["reports.create"]);
  });

  it("HQSR-AUTH-12d: super_admin sector value is trimmed before persist", async () => {
    mockQuery.mockReset(); mockAllowCreate();
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    vi.mocked(permissionsFor).mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "  WASH  " });
    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
    );
    expect(insert![1][8]).toBe("WASH"); // $9 — sector snapshot, normalised
    vi.mocked(permissionsFor).mockReturnValue(["reports.create"]);
  });

  it("HQSR-AUTH-13: self-review guard is untouched by the gate (author stamped as creator)", async () => {
    // The gate only runs on CREATE; it introduces no transition changes. Verify the
    // INSERT still stamps author_id = creator id, on which the existing self-review
    // guard operates.
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    vi.mocked(permissionsFor).mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    const insert = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
    );
    expect(insert).toBeTruthy();
    // $29 → submitted_by_id and author_id (29th positional param, index 28)
    expect(insert![1][28]).toBe(SUPER_ADMIN_USER.id);
    vi.mocked(permissionsFor).mockReturnValue(["reports.create"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPC fallback (HQSR-AUTH-SPC-01 – 06)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR author gate — SPC fallback (HQSR-AUTH-SPC-01 through 06)", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("SPC-01: SPC + active TC covering the target sector → 403 hq_sector_tc_available, no row", async () => {
    mockTcRoster(["WASH"]);
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_tc_available");
    expectNoReportInsert();
  });

  it("SPC-02 / HQSR-FB-02: SPC + no active TC for target sector → 201, author_id = SPC user", async () => {
    mockTcRoster([]);
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
    );
    expect(insert).toBeTruthy();
    // index 28 → submitted_by_id/author_id; index 29 → workflow_path frozen as
    // 'spc_fallback' at creation (immutable fallback discriminator, Migration 019)
    expect(insert![1][28]).toBe(SPC_USER.id);
    expect(insert![1][29]).toBe("spc_fallback");
  });

  it("SPC-03 / HQSR-FB-03: inactive TC does not block fallback (roster query filters status='active')", async () => {
    // The roster query itself filters on status = 'active'; an inactive TC never
    // appears in the result set, so the vacancy path (create allowed) applies.
    mockTcRoster([]); // active-only query returns nothing
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    // Verify the vacancy query constrained to active TCs
    const rosterCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("role = 'technical_coordinator'"),
    );
    expect(rosterCall![0]).toContain("status = 'active'");
  });

  it("SPC-04 / HQSR-FB-04: TC assigned to an unrelated sector does not block fallback for the requested sector", async () => {
    mockTcRoster(["Health", "Protection,Education"]);
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "WASH" });
    expect(res.status).toBe(201); // vacancy path, not tc_available
  });

  it("SPC-05: multiple active target-sector TCs block fallback (exact-segment CSV match)", async () => {
    mockTcRoster(["Health,WASH", "WASH"]);
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "WASH" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_tc_available");
    expectNoReportInsert();
  });

  it("SPC-06: SPC create is allowed ONLY when the target sector has no active TC", async () => {
    // TC covering the target sector → 403 tc_available, no INSERT.
    // Vacancy (no roster, or unrelated sectors only) → 201 created.
    for (const [roster, expectCreate] of [
      [["WASH"], false],
      [[], true],
      [["Health"], true],
    ] as Array<[string[], boolean]>) {
      mockQuery.mockReset();
      mockTcRoster(roster);
      const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
      const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
      if (expectCreate) {
        expect(res.status).toBe(201);
      } else {
        expect(res.status).toBe(403);
        expect(GATE_ERRORS).toContain(res.body.error);
        expectNoReportInsert();
      }
    }
  });
});
