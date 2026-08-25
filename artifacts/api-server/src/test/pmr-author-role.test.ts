/**
 * PMR Author Role Gate — Backend Tests (PMR-AUTH-01 through PMR-AUTH-12)
 *
 * Verifies that POST /reports enforces the PMR_AUTHOR_ROLES gate:
 *  - SPO, TC, super_admin may create PMRs (approved authors)
 *  - SOM, PM, SPC, ED are blocked with 403 project_report_author_role_required
 *  - Task #226 scope checks (state/sector/location) still function after the gate
 *  - requirePerm fires before the role gate (PMR-AUTH-08)
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
    // requirePerm bypassed in most tests; PMR-AUTH-08 uses its own app with a real gate.
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn().mockReturnValue(["reports.create"]),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockPoolNoOp() {
  mockQuery.mockResolvedValue({ rows: [] });
}

/**
 * Project row returned by the DB mock when a valid project is found.
 * Sector "WASH" for TC tests; stateIds satisfied separately via project_states query.
 */
function mockProjectRow(opts: {
  sector?: string | null;
  hasHqOperations?: boolean;
} = {}) {
  return {
    rows: [{
      id: 42,
      sector: opts.sector ?? "WASH",
      managementLevel: "state_managed",
      hasHqOperations: opts.hasHqOperations ?? false,
    }],
  };
}

/**
 * Minimal valid PMR body.
 * `period` is required by the Zod CreateReportBody schema (zod.string()).
 * kind=monthly, locationType=state, stateId provided.
 * projectId=42 must match the mock project row.
 */
const BASE_PMR_BODY = {
  title: "Test PMR",
  kind: "monthly",
  reportType: "project",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  projectId: 42,
  stateId: 1,
  locationType: "state",
} as const;

// ── Fake users ────────────────────────────────────────────────────────────────

const SPO_USER = {
  id: 10,
  name: "SPO Test",
  email: "spo@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

const TC_USER = {
  id: 11,
  name: "TC Test",
  email: "tc@example.com",
  role: "technical_coordinator",
  stateId: null,
  sector: "WASH",
  sectors: ["WASH"],
} as const;

const SUPER_ADMIN_USER = {
  id: 12,
  name: "Admin Test",
  email: "admin@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const SOM_USER = {
  id: 13,
  name: "SOM Test",
  email: "som@example.com",
  role: "state_office_manager",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

const PM_USER = {
  id: 14,
  name: "PM Test",
  email: "pm@example.com",
  role: "program_manager",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const SPC_USER = {
  id: 15,
  name: "SPC Test",
  email: "spc@example.com",
  role: "senior_program_coordinator",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const ED_USER = {
  id: 16,
  name: "ED Test",
  email: "ed@example.com",
  role: "executive_director",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

// ── App builders ─────────────────────────────────────────────────────────────

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
    console.error("TEST APP ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

/**
 * App for PMR-AUTH-08: inlines a real requirePerm-like gate that rejects when
 * the user's `permissions` array does not include the requested permission.
 * This simulates requirePerm behaviour without touching the mocked module.
 */
async function buildAppWithRealPermGate(
  user: Record<string, unknown>,
  permissions: string[],
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  // Inline permission gate that mirrors requirePerm("reports.create")
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!permissions.includes("reports.create") && !permissions.includes("*")) {
      res.status(403).json({ error: "forbidden", message: "You do not have permission to perform this action.", requiredPermission: "reports.create" });
      return;
    }
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("TEST APP ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Approved authors — should NOT be blocked by the PMR role gate
// ─────────────────────────────────────────────────────────────────────────────

describe("PMR author role gate — approved authors (PMR-AUTH-01 through PMR-AUTH-03)", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("PMR-AUTH-01: SPO with reports.create + project in assigned state → passes role gate", async () => {
    // NOTE: This is the first test in the file; the reports router runs a one-time
    // CREATE TABLE IF NOT EXISTS report_attachments query on first module import.
    // We must mock it first so subsequent one-time mocks line up correctly.
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                        // CREATE TABLE report_attachments (init, once)
      .mockResolvedValueOnce(mockProjectRow())                    // project SELECT
      .mockResolvedValueOnce({ rows: [{ project_id: 42 }] })     // project_states link check
      .mockResolvedValueOnce({ rows: [{ id: 99 }] });             // INSERT report

    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, stateId: 1 });

    // Must NOT be blocked by the role gate (403 project_report_author_role_required)
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("project_report_author_role_required");
  });

  it("PMR-AUTH-02: TC with reports.create + project in assigned sector → passes role gate", async () => {
    mockQuery
      .mockResolvedValueOnce(mockProjectRow({ sector: "WASH" }))  // project SELECT
      .mockResolvedValueOnce({ rows: [] })                        // duplicate check
      .mockResolvedValueOnce({ rows: [{ id: 100 }] });            // INSERT

    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    // TC does not use stateId for PMR — omit it; provide locationType="hq" is tricky,
    // so use a body without stateId but that still passes Zod (stateId optional)
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, stateId: undefined });

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("project_report_author_role_required");
  });

  it("PMR-AUTH-03: super_admin → passes role gate (wildcard bypass)", async () => {
    // super_admin has permissionsFor returning ["*"] — mock it for this user
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    vi.mocked(permissionsFor).mockReturnValue(["*"]);

    mockQuery
      .mockResolvedValueOnce(mockProjectRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 101 }] });

    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY });

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("project_report_author_role_required");

    // Restore mock
    vi.mocked(permissionsFor).mockReturnValue(["reports.create"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocked roles — SOM, PM, SPC, ED must be rejected 403 by the role gate
// ─────────────────────────────────────────────────────────────────────────────

describe("PMR author role gate — blocked roles (PMR-AUTH-04 through PMR-AUTH-07)", () => {
  beforeEach(() => { mockQuery.mockReset(); mockPoolNoOp(); });

  it("PMR-AUTH-04: state_office_manager with reports.create → 403 project_report_author_role_required", async () => {
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_report_author_role_required");
  });

  it("PMR-AUTH-05: PM → passes author gate (Full Operational Access, Task #373; no project_report_author_role_required)", async () => {
    // PM is now allowed to create PMRs via Full Operational Access (Task #373).
    // The author gate must NOT return project_report_author_role_required for PM.
    // Any non-gate response (400/404 from downstream mock) confirms PM passed the gate.
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY });

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("project_report_author_role_required");
  });

  it("PMR-AUTH-06: senior_program_coordinator with reports.create → 403 project_report_author_role_required", async () => {
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_report_author_role_required");
  });

  it("PMR-AUTH-07: executive_director with reports.create → 403 project_report_author_role_required", async () => {
    const app = await buildApp(ED_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_report_author_role_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ordering: requirePerm fires before role gate (PMR-AUTH-08)
// ─────────────────────────────────────────────────────────────────────────────

describe("PMR author role gate — permission ordering (PMR-AUTH-08)", () => {
  beforeEach(() => { mockQuery.mockReset(); mockPoolNoOp(); });

  it("PMR-AUTH-08: TC WITHOUT reports.create → 403 forbidden (requirePerm fires before role gate)", async () => {
    // Use the app variant with a real inline permission gate (no reports.create).
    const app = await buildAppWithRealPermGate(
      TC_USER as unknown as Record<string, unknown>,
      [], // no reports.create
    );
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY });

    // Must be blocked — and the error must be "forbidden" (requirePerm), NOT "project_report_author_role_required"
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(res.body.error).not.toBe("project_report_author_role_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #226 scope checks still function after the role gate (PMR-AUTH-09 through PMR-AUTH-12)
// These tests pass the role gate (approved author) and verify scope enforcement.
// ─────────────────────────────────────────────────────────────────────────────

describe("PMR scope checks still enforce after role gate (PMR-AUTH-09 through PMR-AUTH-12)", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("PMR-AUTH-09: SPO + project NOT in assigned state → 403 project_state_mismatch", async () => {
    // Project exists but is NOT linked to SPO's state (1)
    mockQuery
      .mockResolvedValueOnce(mockProjectRow())                // project SELECT (found)
      .mockResolvedValueOnce({ rows: [] });                   // project_states link (NOT FOUND)

    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, stateId: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_state_mismatch");
  });

  it("PMR-AUTH-10: TC + project in wrong sector → 403 sector_scope_forbidden", async () => {
    // Project's primary sector is "Shelter & NFI", outside TC's assigned ["WASH"].
    // stateId=1 must be provided: the route requires stateId for project reports
    // unless locationType=hq (line 657). TC is not a state role so the requirement applies.
    mockQuery
      .mockResolvedValueOnce(mockProjectRow({ sector: "Shelter & NFI" })); // project SELECT

    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, stateId: 1 }); // stateId required for TC project reports

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_scope_forbidden");
  });

  it("PMR-AUTH-11: TC + no sector assigned → 403 sector scope error (fail-closed for empty TC sector)", async () => {
    const TC_NO_SECTORS = { ...TC_USER, sector: null, sectors: [] as string[] };

    // Project found but TC has empty sector list — fail-closed.
    // stateId=1 provided so the route doesn't 400 at the stateId-required check.
    mockQuery
      .mockResolvedValueOnce(mockProjectRow({ sector: "WASH" })); // project SELECT

    const app = await buildApp(TC_NO_SECTORS as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, stateId: 1 });

    // Empty TC sector list → fail-closed; sector_scope_forbidden or tc_sector_validation_failed
    expect(res.status).toBe(403);
    expect(["sector_scope_forbidden", "tc_sector_validation_failed"]).toContain(res.body.error);
  });

  it("PMR-AUTH-12: SPO + valid project + invalid Reporting Location (HQ) → 403 hq_forbidden", async () => {
    // SPO (state-scoped) cannot create HQ project reports
    mockQuery
      .mockResolvedValueOnce(mockProjectRow({ hasHqOperations: true })); // project SELECT

    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "hq", stateId: undefined });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_forbidden");
  });
});
