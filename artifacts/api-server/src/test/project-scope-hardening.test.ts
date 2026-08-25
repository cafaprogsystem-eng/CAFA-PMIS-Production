/**
 * PRJ-SCOPE — Projects Endpoint Scope & Data Access Hardening (Task #426)
 *
 * Closes:
 *   PRJ-002  GET /projects/duplicate-check  — permission guard + scope
 *   PRJ-005  GET /projects/:id/state-allocations — permission guard + scope
 *   PRJ-007  POST /projects/:id/merge — Sector/State scope enforcement
 *   PRJ-014  GET /projects/:id/budget — permission guard + TC Sector scope
 *   PRJ-033  POST /projects/:id/state-allocations — stateId membership validation
 *
 * Test IDs:
 *   PRJ-SCOPE-DUP-01..05   Duplicate-check permission + scope
 *   PRJ-SCOPE-ALLOC-01..05 State allocations GET permission + scope
 *   PRJ-SCOPE-MERGE-01..06 Merge Sector/State scope
 *   PRJ-SCOPE-BUD-01..05   Budget permission + TC scope
 *   PRJ-SCOPE-ST-01..05    stateId membership validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { ZodError } from "zod";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn().mockResolvedValue(mockClient);

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: mockConnectFn,
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
  notifyByRole: vi.fn().mockResolvedValue(undefined),
}));

// Permission-gate control: null = pass all; string = deny any perm matching value
let denyPerm: string | null = null;

const mockLogAudit = vi.fn().mockResolvedValue(undefined);

// permissionsFor and hasPerm are NOT mocked in this file — real implementations are
// used throughout so that inline permission checks in route handlers (e.g. the
// projects.* gate on duplicate-check) and requirePerm both validate actual role
// grants. Any RBAC regression (e.g. ED/SOM losing budget.view, Viewer losing
// project-domain access) will be caught by the tests below.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,  // real permissionsFor, hasPerm, assertSectorAllowed, assertStateAllowed, tcSectorRestriction
    logAudit: mockLogAudit,
    // requirePerm uses real permissionsFor so tests catch actual RBAC regressions.
    // denyPerm can still force an additional denial to test the gate in isolation.
    requirePerm: (perm: string) => (req: Request, res: Response, next: NextFunction) => {
      if (denyPerm && perm === denyPerm) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      const u = req.currentUser;
      if (u) {
        const perms = original.permissionsFor(u as import("../middlewares/currentUser.js").CurrentUser);
        if (!original.hasPerm(perms, perm)) {
          res.status(403).json({ error: "forbidden", requiredPermission: perm });
          return;
        }
      }
      next();
    },
  };
});

// ─── User fixtures ─────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM User", email: "pm@cafa.org", role: "program_manager",
  roleLabel: "Programme Manager", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const SUPER_ADMIN_USER = {
  id: 2, name: "SA User", email: "sa@cafa.org", role: "super_admin",
  roleLabel: "Super Admin", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const TC_HEALTH_USER = {
  id: 10, name: "TC Health", email: "tc.health@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const TC_EDUCATION_USER = {
  id: 11, name: "TC Education", email: "tc.edu@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
};

const TC_NO_SECTOR_USER = {
  id: 12, name: "TC NoSector", email: "tc.none@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
};

const SPO_USER = {
  id: 20, name: "SPO User", email: "spo@cafa.org", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 5, stateName: "South Kordofan", sector: null, sectors: null, avatarUrl: null,
};

const SOM_USER = {
  id: 21, name: "SOM User", email: "som@cafa.org", role: "state_office_manager",
  roleLabel: "State Office Manager", scope: "state",
  stateId: 5, stateName: "South Kordofan", sector: null, sectors: null, avatarUrl: null,
};

const SPO_NULL_STATE_USER = {
  id: 22, name: "SPO NoState", email: "spo.null@cafa.org", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const ED_USER = {
  id: 40, name: "ED User", email: "ed@cafa.org", role: "executive_director",
  roleLabel: "Executive Director", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const VIEWER_USER = {
  id: 30, name: "Viewer", email: "view@cafa.org", role: "viewer",
  roleLabel: "Viewer", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

// A user with an unrecognised role falls through all if-blocks in permissionsFor and
// receives only universal permissions — no budget.view, no projects.create.
const UNKNOWN_ROLE_USER = {
  id: 99, name: "Unknown", email: "unknown@cafa.org", role: "programme_assistant",
  roleLabel: "Programme Assistant", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

// ─── App factory ──────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use("/api", projectsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
      return;
    }
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

beforeEach(async () => {
  vi.resetAllMocks();
  denyPerm = null;
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockLogAudit.mockResolvedValue(undefined);
});

// ─── PRJ-SCOPE-DUP — Duplicate-check permission + scope ───────────────────────

describe("PRJ-SCOPE-DUP — Duplicate-check permission and scope", () => {
  it("PRJ-SCOPE-DUP-01  Caller with no project-domain permission receives 403 (real permissions)", async () => {
    // UNKNOWN_ROLE_USER (role='programme_assistant') falls through all if-blocks in
    // permissionsFor and receives only universal non-project permissions.
    // The inline projects.* gate closes for this caller without any denyPerm override.
    const app = await buildApp(UNKNOWN_ROLE_USER);
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-001");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("PRJ-SCOPE-DUP-08  Viewer (projects.view) can access duplicate-check (real permissions)", async () => {
    // Viewer holds projects.view which satisfies the projects.* gate. Prior to PRJ-002
    // the endpoint was open to all authenticated callers; Viewer must not regress to 403.
    const app = await buildApp(VIEWER_USER);
    // Viewer has org-wide scope (not TC, not state role) — no scope clause injected.
    mockQuery.mockResolvedValueOnce({ rows: [] }); // duplicate-check query returns no match
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-VIEWER-001");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
  });

  it("PRJ-SCOPE-DUP-02  Authorised SPO with projects.create can use duplicate-check", async () => {
    // SPO has projects.create; mock returns a match
    const app = await buildApp(SPO_USER);
    // duplicate-check query returns a project for SPO's state scope
    mockQuery.mockResolvedValueOnce({
      rows: [{
        code: "CAFA-PROJ-2026-001", title: "Found Project",
        agreementNumber: "AGR-001", donor: "Donor X",
        sector: "Health", sectors: ["Health"], stateIds: [5], stateNames: ["South Kordofan"], localities: [],
      }],
    });
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-001&donor=Donor+X&title=Found+Project");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("matchType");
  });

  it("PRJ-SCOPE-DUP-03  Soft-deleted project does NOT trigger isDuplicate", async () => {
    const app = await buildApp(PM_USER);
    // DB returns no rows (deleted_at IS NULL filters out the deleted project)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-DELETED-001");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
    // Confirm deleted_at IS NULL is present in the SQL
    const sqlCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    expect(sqlCall?.[0]).toMatch(/deleted_at IS NULL/);
  });

  it("PRJ-SCOPE-DUP-04  TC with no sectors returns none (fail-closed, no enumeration)", async () => {
    const app = await buildApp(TC_NO_SECTOR_USER);
    // No DB call expected — the handler short-circuits before querying
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-001");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
    // No DB call for the agreement number query — fail-closed
    const sqlCalled = mockQuery.mock.calls.some((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    expect(sqlCalled).toBe(false);
  });

  it("PRJ-SCOPE-DUP-05  TC receives only results scoped to their sector (clause injected)", async () => {
    const app = await buildApp(TC_HEALTH_USER); // sectors: ["Health"]
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/api/projects/duplicate-check?agreementNumber=AGR-TC-001");
    // TC sector clause must be present in the SQL
    const sqlCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    expect(sqlCall?.[0]).toMatch(/sector = ANY/);
    // The params array must contain the TC's sectors
    const params = sqlCall?.[1] as unknown[];
    const hasHealthSector = JSON.stringify(params).includes("Health");
    expect(hasHealthSector).toBe(true);
  });

  it("PRJ-SCOPE-DUP-06  PM Full Access returns organisation-wide duplicate result", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        code: "CAFA-PROJ-2026-002", title: "Org-Wide Project",
        agreementNumber: "AGR-ORG-001", donor: "Donor Y",
        sector: "Education", sectors: ["Education"], stateIds: [], stateNames: [], localities: [],
      }],
    });
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-ORG-001&title=Org-Wide+Project&donor=Donor+Y");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("exact");
    // No sector or state SCOPE clause injected for PM (the stateIds subquery in SELECT is fine)
    const sqlCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    expect(sqlCall?.[0]).not.toMatch(/sector = ANY/);
    // The scope-filter clause uses EXISTS + state_id parameter; PM should not have it
    expect(sqlCall?.[0]).not.toMatch(/EXISTS.*project_states.*state_id/s);
  });

  it("PRJ-SCOPE-DUP-07  Response does not include internal DB id field", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        code: "CAFA-PROJ-2026-003", title: "No ID Project",
        agreementNumber: "AGR-NOID-001", donor: "Donor Z",
        sector: "Health", sectors: ["Health"], stateIds: [], stateNames: [], localities: [],
      }],
    });
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-NOID-001&title=No+ID+Project&donor=Donor+Z");
    expect(res.status).toBe(200);
    // The SELECT no longer fetches p.id — the response should not expose internal DB id
    const sqlCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    // Confirm `p.id` is not in the SELECT list (only `p.code`, etc.)
    expect(sqlCall?.[0]).not.toMatch(/SELECT p\.id/);
  });
});

// ─── PRJ-SCOPE-ALLOC — State allocations GET permission + scope ────────────────

describe("PRJ-SCOPE-ALLOC — State allocations GET permission and scope", () => {
  it("PRJ-SCOPE-ALLOC-01  Caller without budget.view receives 403 from GET allocations (real permissions)", async () => {
    // UNKNOWN_ROLE_USER has role 'programme_assistant' which falls through all
    // if-blocks in permissionsFor and receives no budget.view grant.
    // requirePerm uses real permissionsFor, so no denyPerm override is needed.
    const app = await buildApp(UNKNOWN_ROLE_USER);
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(403);
  });

  it("PRJ-SCOPE-ALLOC-02  SPO receives only their own State's allocation row", async () => {
    const app = await buildApp(SPO_USER); // stateId: 5
    // getProjectSector → "Health" (project exists)
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // assertStateAllowed → project is in SPO's state
    mockQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    // allocation rows for stateId=5 only (state clause enforced)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 99, projectId: 1, stateId: 5, stateName: "South Kordofan",
        budgetAllocation: 50000, beneficiaryTarget: 100,
        beneficiaryMale: 50, beneficiaryFemale: 50,
        beneficiaryBoys: 0, beneficiaryGirls: 0,
        activityTarget: 5, indicatorTarget: 3,
        stateLead: null, stateTeam: [], notes: null,
        createdAt: new Date(), updatedAt: new Date(),
      }],
    });
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(200);
    // Only one row returned — the SPO's own state
    expect(res.body).toHaveLength(1);
    expect(res.body[0].stateId).toBe(5);
    // The SQL for allocations must include the stateId filter clause
    const allocCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("project_state_allocations"),
    );
    expect(allocCall?.[0]).toMatch(/psa\.state_id/);
    expect(allocCall?.[1]).toContain(5);
  });

  it("PRJ-SCOPE-ALLOC-03  State role with null stateId receives 403", async () => {
    const app = await buildApp(SPO_NULL_STATE_USER); // stateId: null
    // getProjectSector → project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // assertStateAllowed → null stateId → 403 (no DB call from assertStateAllowed)
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(403);
  });

  it("PRJ-SCOPE-ALLOC-04  TC whose sector does not match the Project receives 403", async () => {
    const app = await buildApp(TC_EDUCATION_USER); // sectors: ["Education"]
    // getProjectSector returns "Health" — does NOT match TC Education
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-SCOPE-ALLOC-05a  Executive Director (budget.view.all, no projects.update) can read all allocations (real permissions)", async () => {
    // ED does NOT have projects.update but DOES have budget.view — the gate must use budget.view.
    const app = await buildApp(ED_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // assertStateAllowed: ED is not a state role → passes without DB call
    // All allocations returned (ED is not a state role, so no row-level filter)
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 1, projectId: 1, stateId: 5, stateName: "South Kordofan", budgetAllocation: 30000, beneficiaryTarget: 0, beneficiaryMale: 0, beneficiaryFemale: 0, beneficiaryBoys: 0, beneficiaryGirls: 0, activityTarget: 0, indicatorTarget: 0, stateLead: null, stateTeam: [], notes: null, createdAt: new Date(), updatedAt: new Date() },
    ] });
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(200);
  });

  it("PRJ-SCOPE-ALLOC-05b  State Office Manager (budget.view.state, no projects.update) sees only their State's row (real permissions)", async () => {
    // SOM does NOT have projects.update but DOES have budget.view — gate must allow them.
    // State-role row clamping then restricts the response to their own state.
    const app = await buildApp(SOM_USER); // stateId: 5
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // assertStateAllowed: SOM's stateId=5 linked to project
    mockQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    // Row-level clamped to stateId=5
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 1, projectId: 1, stateId: 5, stateName: "South Kordofan", budgetAllocation: 20000, beneficiaryTarget: 0, beneficiaryMale: 0, beneficiaryFemale: 0, beneficiaryBoys: 0, beneficiaryGirls: 0, activityTarget: 0, indicatorTarget: 0, stateLead: null, stateTeam: [], notes: null, createdAt: new Date(), updatedAt: new Date() },
    ] });
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].stateId).toBe(5);
    // Confirm stateId filter was applied in the allocation query
    const allocCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("project_state_allocations"),
    );
    expect(allocCall?.[1]).toContain(5);
  });

  it("PRJ-SCOPE-ALLOC-05  PM receives all States' allocation data (no state clause)", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector → project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // assertStateAllowed: PM is not a state role → passes without DB call
    // allocations: two rows (all states)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, projectId: 1, stateId: 5, stateName: "South Kordofan", budgetAllocation: 30000, beneficiaryTarget: 50, beneficiaryMale: 0, beneficiaryFemale: 0, beneficiaryBoys: 0, beneficiaryGirls: 0, activityTarget: 0, indicatorTarget: 0, stateLead: null, stateTeam: [], notes: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, projectId: 1, stateId: 6, stateName: "Khartoum", budgetAllocation: 70000, beneficiaryTarget: 100, beneficiaryMale: 0, beneficiaryFemale: 0, beneficiaryBoys: 0, beneficiaryGirls: 0, activityTarget: 0, indicatorTarget: 0, stateLead: null, stateTeam: [], notes: null, createdAt: new Date(), updatedAt: new Date() },
      ],
    });
    const res = await request(app).get("/api/projects/1/state-allocations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // No stateId filter clause — PM sees all states
    const allocCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("project_state_allocations"),
    );
    // The allocations query params should NOT include stateId=5 for PM
    const params = JSON.stringify(allocCall?.[1] ?? []);
    // Only param should be the projectId, not a stateId filter
    expect(params).not.toContain("5");
    expect(params).not.toContain("6");
  });
});

// ─── PRJ-SCOPE-MERGE — Merge Sector/State scope enforcement ───────────────────

describe("PRJ-SCOPE-MERGE — Merge endpoint Sector/State scope", () => {
  it("PRJ-SCOPE-MERGE-01  TC whose sector matches the Project succeeds (subject to merge validity)", async () => {
    const app = await buildApp(TC_HEALTH_USER); // sectors: ["Health"]
    // Project fetch via client.query: sector="Health" matches TC
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, sector: "Health", sectors: ["Health"] }] });
    // assertStateAllowed: TC is not a state role → passes without DB call
    // transaction queries: BEGIN, INSERT states, COMMIT, final project query
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post("/api/projects/1/merge")
      .send({ stateIds: [], sectors: [], localities: [] });
    expect(res.status).not.toBe(403);
  });

  it("PRJ-SCOPE-MERGE-02  TC whose sector does NOT match the Project receives 403", async () => {
    const app = await buildApp(TC_EDUCATION_USER); // sectors: ["Education"]
    // Project fetch: sector="Health" — does NOT match TC Education
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, sector: "Health", sectors: ["Health"] }] });
    const res = await request(app)
      .post("/api/projects/1/merge")
      .send({ stateIds: [5], sectors: [], localities: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-SCOPE-MERGE-03  SPO for a Project linked to their State succeeds (subject to merge validity)", async () => {
    const app = await buildApp(SPO_USER); // stateId: 5
    // Project fetch: sector present (SPO is not TC — sector guard passes)
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, sector: "Health", sectors: ["Health"] }] });
    // assertStateAllowed: checks project_states for stateId=5 → found
    mockQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    // transaction queries
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await request(app)
      .post("/api/projects/1/merge")
      .send({ stateIds: [], sectors: [], localities: [] });
    expect(res.status).not.toBe(403);
  });

  it("PRJ-SCOPE-MERGE-04  SPO for a Project NOT linked to their State receives 403", async () => {
    const app = await buildApp(SPO_USER); // stateId: 5
    // Project fetch: project exists
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 99, sector: "Health", sectors: ["Health"] }] });
    // assertStateAllowed: stateId=5 not in project_states for project 99
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/api/projects/99/merge")
      .send({ stateIds: [7], sectors: [], localities: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
  });

  it("PRJ-SCOPE-MERGE-05  Merge on a soft-deleted Project receives 404", async () => {
    const app = await buildApp(PM_USER);
    // Project fetch with AND deleted_at IS NULL → no rows (deleted project)
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/api/projects/99/merge")
      .send({ stateIds: [5] });
    expect(res.status).toBe(404);
    const call = mockClientQuery.mock.calls[0];
    expect(call?.[0]).toMatch(/deleted_at IS NULL/);
  });

  it("PRJ-SCOPE-MERGE-06  PM Full Access merge proceeds subject to structural validation", async () => {
    const app = await buildApp(PM_USER);
    // Project found; sector guard passes (PM is not TC); state guard passes (PM is not state role)
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, sector: "Health", sectors: ["Health"] }] });
    // transaction + final select
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post("/api/projects/1/merge")
      .send({ stateIds: [], sectors: [], localities: [] });
    // PM passes all scope guards; result determined by structural validation only
    expect(res.status).not.toBe(403);
  });

  it("PRJ-SCOPE-MERGE-07  Inactive destination State is rejected before a merge transaction begins", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, sector: "Health", sectors: ["Health"] }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 6, name: "Khartoum", nameAr: "الخرطوم", code: "KRT",
        operationalStatus: "inactive", officeStatus: "present",
      }],
    });

    const res = await request(app)
      .post("/api/projects/1/merge")
      .send({ stateIds: [6], sectors: [], localities: [] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("inactive_state");
    expect(mockClientQuery.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO project_states"),
    )).toBe(false);
  });

  it("PRJ-SCOPE-MERGE-08  State-scoped caller cannot add a destination State outside their authority", async () => {
    const app = await buildApp(SPO_USER); // assigned State: 5
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 1, sector: "Health", sectors: ["Health"] }] });
    // SPO has record-level access; target-state scope must still be enforced.
    mockQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] });

    const res = await request(app)
      .post("/api/projects/1/merge")
      .send({ stateIds: [6], sectors: [], localities: [] });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
    expect(mockClientQuery.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO project_states"),
    )).toBe(false);
  });
});

// ─── PRJ-SCOPE-BUD — Budget endpoint permission + TC scope ────────────────────

describe("PRJ-SCOPE-BUD — Budget endpoint permission and TC Sector scope", () => {
  it("PRJ-SCOPE-BUD-01  Authorised PM can read project budget", async () => {
    const app = await buildApp(PM_USER);
    // Project query (includes deleted_at IS NULL + sector)
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 100000, sector: "Health" }] });
    // Subsequent budget sub-queries (outputs, activities)
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("total");
  });

  it("PRJ-SCOPE-BUD-02  TC whose sector matches the Project can read budget", async () => {
    const app = await buildApp(TC_HEALTH_USER); // sectors: ["Health"]
    // Project query: sector="Health" matches TC
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 50000, sector: "Health" }] });
    // TC is not a state role — state guard passes without further DB call
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(50000);
  });

  it("PRJ-SCOPE-BUD-03  TC whose sector does NOT match receives 403 from budget endpoint", async () => {
    const app = await buildApp(TC_EDUCATION_USER); // sectors: ["Education"]
    // Project query: sector="Health" — does NOT match TC Education
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 50000, sector: "Health" }] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-SCOPE-BUD-04  State role (SPO) response uses existing State-based semantics", async () => {
    const app = await buildApp(SPO_USER); // stateId: 5
    // Project query: exists, not deleted
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 120000, sector: "Health" }] });
    // assertSectorAllowed: SPO is not TC → passes without DB call
    // State-role guard in handler: stateId=5 is not null → proceeds to access check
    mockQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] }); // SPO's state linked
    // Budget sub-queries
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(200);
    // Budget data returned for authorised SPO (State role semantics preserved)
    expect(res.body).toHaveProperty("total");
  });

  it("PRJ-SCOPE-BUD-05  PM / Super Admin Full Access returns full budget data", async () => {
    const app = await buildApp(SUPER_ADMIN_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 200000, sector: "Education" }] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(200000);
  });

  it("PRJ-SCOPE-BUD-06  Caller without budget.view receives 403 from budget endpoint (real permissions)", async () => {
    // UNKNOWN_ROLE_USER has role 'programme_assistant' — falls through all permissionsFor
    // if-blocks and receives only universal permissions, never budget.view.
    // requirePerm uses real permissionsFor; no denyPerm override needed.
    const app = await buildApp(UNKNOWN_ROLE_USER);
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(403);
  });

  it("PRJ-SCOPE-BUD-08  Executive Director (budget.view.all, no projects.update) can read budget (real permissions)", async () => {
    // ED does NOT have projects.update but DOES have budget.view — the gate must use budget.view.
    const app = await buildApp(ED_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 80000, sector: "Health" }] });
    // ED is not TC (sector guard passes) and not a state role (state guard passes)
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(80000);
  });

  it("PRJ-SCOPE-BUD-09  State Office Manager (budget.view.state, no projects.update) can read budget within their state (real permissions)", async () => {
    // SOM does NOT have projects.update but DOES have budget.view — gate must allow them.
    const app = await buildApp(SOM_USER); // stateId: 5
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 60000, sector: "Health" }] });
    // assertSectorAllowed: SOM is not TC → passes without DB call
    // State guard in handler: stateId=5 not null → access check
    mockQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] }); // project linked to SOM's state
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1/budget");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(60000);
  });

  it("PRJ-SCOPE-BUD-07  Budget endpoint includes deleted_at IS NULL in project query", async () => {
    const app = await buildApp(PM_USER);
    // Project not found (deleted) → 404
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/projects/99/budget");
    expect(res.status).toBe(404);
    const call = mockQuery.mock.calls[0];
    expect(call?.[0]).toMatch(/deleted_at IS NULL/);
  });
});

// ─── PRJ-SCOPE-ST — stateId membership validation ────────────────────────────

describe("PRJ-SCOPE-ST — Allocation stateId membership validation (PRJ-033)", () => {
  it("PRJ-SCOPE-ST-01  Allocation to a State linked to the Project succeeds", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // stateId membership check: stateId=5 is linked to projectId=1
    mockQuery.mockResolvedValueOnce({ rows: [{ state_id: 5 }] });
    // linked State is active and therefore eligible for a new allocation
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }],
    });
    // budget check: within limit
    mockClientQuery.mockResolvedValueOnce({ rows: [{ budget: 100000 }] });
    // transaction queries
    mockClientQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [{ stateId: 5, budgetAllocation: 40000 }] });
    expect(res.status).not.toBe(422);
  });

  it("PRJ-SCOPE-ST-02  Allocation to a State NOT in project_states returns 422 with project_state_not_linked", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // stateId membership check: stateId=99 NOT linked → empty rows
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [{ stateId: 99, budgetAllocation: 40000 }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_state_not_linked");
    expect(res.body.message).toMatch(/not linked/);
  });

  it("PRJ-SCOPE-ST-03  Failed allocation (unlinked State) creates no DB row", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // stateId membership check: unlinked
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [{ stateId: 77, budgetAllocation: 10000 }] });
    // No BEGIN or INSERT should have been issued (returned before transaction start)
    const beginCalled = mockClientQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].trim().toUpperCase() === "BEGIN",
    );
    expect(beginCalled).toBe(false);
    const insertCalled = mockClientQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO project_state_allocations"),
    );
    expect(insertCalled).toBe(false);
  });

  it("PRJ-SCOPE-ST-03b  Historical link to an inactive State cannot receive a new allocation", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // The historical project_states relationship remains present and readable.
    mockQuery.mockResolvedValueOnce({ rows: [{ state_id: 5 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "inactive", officeStatus: "present" }],
    });

    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [{ stateId: 5, budgetAllocation: 10000 }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("inactive_state");
    expect(mockClientQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].trim().toUpperCase() === "BEGIN",
    )).toBe(false);
  });

  it("PRJ-SCOPE-ST-04  PM cannot bypass linked-State integrity (Full Access does not bypass)", async () => {
    // PM has Full Operational Access but PRJ-033 fix applies to all roles including PM.
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    mockQuery.mockResolvedValueOnce({ rows: [] }); // stateId=999 not linked → empty
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [{ stateId: 999, budgetAllocation: 20000 }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_state_not_linked");
  });

  it("PRJ-SCOPE-ST-05  Super Admin cannot bypass linked-State integrity", async () => {
    const app = await buildApp(SUPER_ADMIN_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    mockQuery.mockResolvedValueOnce({ rows: [] }); // stateId=999 not linked → empty
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [{ stateId: 999, budgetAllocation: 20000 }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_state_not_linked");
  });

  it("PRJ-SCOPE-ST-06  Empty allocations array skips stateId check (no spurious DB call)", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // budget check with empty allocations (total=0, budget=100000 → no over-allocation)
    mockClientQuery.mockResolvedValueOnce({ rows: [{ budget: 100000 }] });
    mockClientQuery.mockResolvedValue({ rows: [] }); // transaction
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [] });
    // No stateId membership query should have been issued
    const membershipCalled = mockQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && c[0].includes("project_states") && c[0].includes("ANY"),
    );
    expect(membershipCalled).toBe(false);
    expect(res.status).not.toBe(422);
  });
});
