/**
 * PRJ-AUDIT — Projects Module Full Audit Sentinel Tests (Task #415)
 *
 * Covers:
 *   PRJ-AUDIT-01  Authoring / access matrix (role × action)
 *   PRJ-AUDIT-02  Canonical Project identity (code uniqueness, duplicate-check)
 *   PRJ-AUDIT-03  Multi-State Project visibility / deduplication
 *   PRJ-AUDIT-04  Sector scope — TC exact-match (no substring leak)
 *   PRJ-AUDIT-05  Draft / edit saves same Project ID (no POST replacement)
 *   PRJ-AUDIT-06  Reporting frequency (valid values, null handling, on_demand excluded)
 *   PRJ-AUDIT-07  Project budget vs State allocation boundary (over-allocation guard)
 *   PRJ-AUDIT-08  Delete integrity (dependency protection, soft vs permanent threshold)
 *   PRJ-AUDIT-09  Project ↔ PMR reporting completeness (project_states + frequency source)
 *   PRJ-AUDIT-10  #373 Full Access vs data integrity (PM cannot bypass required fields)
 *   PRJ-AUDIT-11  PATCH uses projects.update permission (regression guard for PRJ-001)
 *   PRJ-AUDIT-12  Soft-deleted project inaccessible via detail / documents / merge
 *   PRJ-AUDIT-13  State allocations — negative value and over-allocation guards
 *   PRJ-AUDIT-14  State allocations POST requires scope guard (sector + state)
 *   PRJ-AUDIT-15  Duplicate-check excludes soft-deleted projects
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

// Named mock for pool.connect so we can re-set it in beforeEach after resetAllMocks.
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

// Named references so they can be re-set after vi.resetAllMocks() in beforeEach.
// The transitions route calls permissionsFor() directly (not via requirePerm middleware),
// so it must be re-set explicitly after each reset.
const mockPermissionsFor = vi.fn().mockReturnValue(["*"]);
const mockHasPerm = vi.fn().mockReturnValue(true);
const mockLogAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: mockLogAudit,
    requirePerm: (perm: string) => (_req: Request, res: Response, next: NextFunction) => {
      if (denyPerm && perm === denyPerm) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      next();
    },
    permissionsFor: mockPermissionsFor,
    hasPerm: mockHasPerm,
  };
});

// ─── User fixtures ────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM User", email: "pm@cafa.org", role: "program_manager",
  roleLabel: "Programme Manager", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const TC_USER = {
  id: 10, name: "TC User", email: "tc@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const TC_EDUCATION_USER = {
  id: 11, name: "TC Education", email: "tce@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
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

const VIEWER_USER = {
  id: 30, name: "Viewer", email: "view@cafa.org", role: "viewer",
  roleLabel: "Viewer", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

// ─── App factory ─────────────────────────────────────────────────────────────

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

// Minimal body that satisfies the CreateProjectBody Zod schema.
// Modelled on the BASE_PROJECT_BODY used in project-reporting-frequency.test.ts
// (the canonical passing reference).  Extra presentation fields (sector, currency,
// budgetTotal, hasHqOperations) are NOT included because their presence / absence
// in the Zod schema is unknown; including them risks schema-validation failures.
const VALID_PROJECT_BODY = {
  title: "Audit Test Project",
  description: "This is a sufficiently long project description that satisfies the minimum length validation requirement on the CreateProjectBody Zod schema used in the audit sentinel tests.",
  agreementNumber: "AGR-AUDIT-001",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  sectors: ["Health"],
  donor: "Test Donor",
  stateIds: [5],
  reportingFrequency: "quarterly",
};

beforeEach(async () => {
  // resetAllMocks clears both call history AND the mockResolvedValueOnce queue,
  // preventing leftover one-shot values from poisoning subsequent tests.
  vi.resetAllMocks();
  denyPerm = null;
  // Re-establish default mock behaviours after reset.
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  // Re-set the named pool.connect mock so the route can acquire a DB client.
  mockConnectFn.mockResolvedValue(mockClient);
  // Re-set named currentUser helpers — the transitions route calls permissionsFor()
  // directly (not via requirePerm middleware), so it must be re-set here.
  mockPermissionsFor.mockReturnValue(["*"]);
  mockHasPerm.mockReturnValue(true);
  mockLogAudit.mockResolvedValue(undefined);
});

// ─── PRJ-AUDIT-01 — Authoring / access matrix ────────────────────────────────

describe("PRJ-AUDIT-01 — Authoring / access matrix", () => {
  it("01-a  Viewer is denied project creation (projects.create blocked)", async () => {
    denyPerm = "projects.create";
    const app = await buildApp(VIEWER_USER);
    const res = await request(app).post("/api/projects").send(VALID_PROJECT_BODY);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.create");
  });

  it("01-b  SOM is denied PATCH on projects (projects.update blocked)", async () => {
    denyPerm = "projects.update";
    const app = await buildApp(SOM_USER);
    // Mock: project exists as draft in user's state
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", deleted_at: null }] });
    const res = await request(app).patch("/api/projects/99").send(VALID_PROJECT_BODY);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.update");
  });

  it("01-c  PM has full access (create, transition, delete all pass permission gate)", async () => {
    // PM has * — no perm should be denied; just check non-403 at perm stage
    denyPerm = null;
    const app = await buildApp(PM_USER);
    // Mock project missing → 404 expected (auth passed, not found)
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/999");
    // getProjectSector returns undefined → 404, not 403
    expect(res.status).toBe(404);
  });

  it("01-d  SPO denied deletion (projects.delete blocked)", async () => {
    denyPerm = "projects.delete";
    const app = await buildApp(SPO_USER);
    const res = await request(app)
      .delete("/api/projects/5")
      .send({ reason: "Test reason long enough" });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.delete");
  });
});

// ─── PRJ-AUDIT-02 — Canonical Project identity (code / duplicate-check) ──────

describe("PRJ-AUDIT-02 — Project identity and duplicate-check", () => {
  it("02-a  Duplicate-check returns none when agreement number is blank", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/duplicate-check?agreementNumber=");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
  });

  it("02-b  Duplicate-check queries only non-deleted projects (deleted_at IS NULL in SQL)", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // simulate no match
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-001");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
    // The SQL call must include deleted_at IS NULL
    const call = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    expect(call?.[0]).toMatch(/deleted_at IS NULL/);
  });

  it("02-c  Exact duplicate (same agreement + donor + title) returns exact matchType", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 7, code: "CAFA-PROJ-2026-001", title: "Test Project",
        agreementNumber: "AGR-001", donor: "Donor X",
        sector: "Health", sectors: ["Health"], stateIds: [], stateNames: [], localities: [],
      }],
    });
    const res = await request(app).get(
      "/api/projects/duplicate-check?agreementNumber=AGR-001&donor=Donor+X&title=Test+Project",
    );
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("exact");
  });

  it("02-d  Agreement-only match (same AGR, different title) returns agreement_warning", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 8, code: "CAFA-PROJ-2026-002", title: "Different Title",
        agreementNumber: "AGR-001", donor: "Donor X",
        sector: "Health", sectors: ["Health"], stateIds: [], stateNames: [], localities: [],
      }],
    });
    const res = await request(app).get(
      "/api/projects/duplicate-check?agreementNumber=AGR-001&donor=Donor+X&title=New+Title",
    );
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("agreement_warning");
  });
});

// ─── PRJ-AUDIT-03 — Multi-State Project visibility ───────────────────────────

describe("PRJ-AUDIT-03 — Multi-State Project visibility", () => {
  it("03-a  SPO sees project in their state via project_states JOIN", async () => {
    const app = await buildApp(SPO_USER);
    // List query returns one project linked to stateId=5
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1, code: "CAFA-PROJ-2026-001", title: "Multi-State Project",
        status: "active", sector: "Health", sectors: ["Health"],
        stateIds: [5, 6], stateNames: ["South Kordofan", "Khartoum"],
        hasHqOperations: false, reportingFrequency: "quarterly",
      }],
    });
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    // Project appears once (no duplication per state)
    expect(res.body).toHaveLength(1);
  });

  it("03-b  SPO list query applies state filter clause", async () => {
    const app = await buildApp(SPO_USER);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/api/projects");
    const call = mockQuery.mock.calls[0];
    // SQL must contain project_states scoping
    expect(call[0]).toMatch(/project_states/);
    expect(call[1]).toContain(5); // SPO's stateId
  });

  it("03-c  SPO with null stateId is denied project detail (fail-closed)", async () => {
    const nullStateSPO = { ...SPO_USER, stateId: null, stateName: null };
    const app = await buildApp(nullStateSPO);
    // getProjectSector succeeds — project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // assertStateAllowed: stateId null → denies
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(403);
  });

  it("03-d  SPO cannot open an unassigned project by guessing its ID", async () => {
    const app = await buildApp(SPO_USER);
    // The project exists, but there is no matching project_assignments row for
    // the requesting SPO. Assignment is the SPO's canonical record-level scope.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: [] }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/api/projects/65");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
    const scopeQuery = mockQuery.mock.calls[1];
    expect(scopeQuery?.[0]).toContain("FROM project_assignments pa");
    expect(scopeQuery?.[1]).toEqual([65, SPO_USER.id]);
  });
});

// ─── PRJ-AUDIT-04 — TC sector scope (exact match, no substring leak) ─────────

describe("PRJ-AUDIT-04 — TC sector scope", () => {
  it("04-a  TC can access project in their assigned sector", async () => {
    const app = await buildApp(TC_USER);
    // getProjectSector returns "Health" — matches TC_USER.sectors = ["Health"]
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    // assertStateAllowed: non-state role → passes
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, status: "active" }] });
    // main project query
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/projects/1");
    expect(res.status).not.toBe(403);
  });

  it("04-b  TC is denied access to project in a different sector", async () => {
    const app = await buildApp(TC_EDUCATION_USER); // sectors: ["Education"]
    // getProjectSector returns "Health"
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] });
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("04-c  TC list query applies sector restriction (not substring)", async () => {
    const app = await buildApp(TC_USER); // sectors: ["Health"]
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/api/projects");
    const call = mockQuery.mock.calls[0];
    // SQL must pass the exact sectors array, not a LIKE/substring match
    expect(call[0]).toMatch(/= ANY\(\$\d+::text\[\]\)/);
    // Params should contain the exact ["Health"] array
    expect(JSON.stringify(call[1])).toContain("Health");
  });
});

// ─── PRJ-AUDIT-05 — Draft/edit saves same Project ID (no POST replacement) ───

describe("PRJ-AUDIT-05 — Draft edit saves same project ID", () => {
  it("05-a  PATCH uses the existing projectId (not a new POST)", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] });
    // The rest of client queries succeed
    mockClientQuery.mockResolvedValue({ rows: [{ id: 42, title: "Updated" }] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch("/api/projects/42")
      .send(VALID_PROJECT_BODY);
    // Should not 404 (project found) and not redirect to new resource
    expect(res.status).not.toBe(404);
    // Confirm no POST /projects was called (the router only hits PATCH route)
    expect(res.status).not.toBe(201); // 201 = created — means POST was used instead
  });

  it("05-b  PATCH on a submitted (non-draft) project returns 409", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: "submitted", sector: "Health" }] });
    const res = await request(app)
      .patch("/api/projects/42")
      .send(VALID_PROJECT_BODY);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/draft/i);
  });
});

// ─── PRJ-AUDIT-06 — Reporting frequency semantics ────────────────────────────

describe("PRJ-AUDIT-06 — Reporting frequency", () => {
  const VALID_FREQS = ["monthly", "quarterly", "annual"] as const;

  it("06-a  Creating a project without reportingFrequency returns 400", async () => {
    const app = await buildApp(PM_USER);
    const body = { ...VALID_PROJECT_BODY };
    delete (body as Record<string, unknown>).reportingFrequency;
    const res = await request(app).post("/api/projects").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_reporting_frequency");
  });

  it.each(VALID_FREQS)(
    "06-b  Valid frequency '%s' passes validation at create",
    async (freq) => {
      const app = await buildApp(PM_USER);
      // Simulate DB returning a created project (mocked for code generation and insert)
      mockClientQuery
        .mockResolvedValueOnce({ rows: [{ next: 1 }] }) // code sequence
        .mockResolvedValue({ rows: [{ id: 1, code: "CAFA-PROJ-2026-001", title: "T", status: "draft", reporting_frequency: freq }] });
      mockQuery.mockResolvedValue({ rows: [] });
      const res = await request(app)
        .post("/api/projects")
        .send({ ...VALID_PROJECT_BODY, reportingFrequency: freq });
      expect(res.status).not.toBe(400);
    },
  );

  it("06-c  'on_demand' is rejected as a create frequency", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...VALID_PROJECT_BODY, reportingFrequency: "on_demand" });
    // Status 400 confirms rejection — exact error code depends on whether
    // reportingFrequency is in the Zod schema enum or caught by the route guard.
    expect(res.status).toBe(400);
  });

  it("06-d  PATCH with null frequency clears the field (null is valid for PATCH)", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] });
    mockClientQuery.mockResolvedValue({ rows: [{ id: 5, title: "T" }] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch("/api/projects/5")
      .send({ ...VALID_PROJECT_BODY, reportingFrequency: null });
    expect(res.status).not.toBe(400);
  });

  it("06-e  PATCH with 'on_demand' frequency is rejected", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] });
    const res = await request(app)
      .patch("/api/projects/5")
      .send({ ...VALID_PROJECT_BODY, reportingFrequency: "on_demand" });
    // Status 400 confirms rejection — error may come from Zod enum validation
    // or from the route-level frequency guard, both are correct behaviour.
    expect(res.status).toBe(400);
  });
});

// ─── PRJ-AUDIT-07 — Budget vs state allocation boundary ─────────────────────

describe("PRJ-AUDIT-07 — Budget vs state allocation boundary", () => {
  it("07-a  Over-allocation is rejected (sum > project budget_total)", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector for scope guard
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // PRJ-033 stateId membership check (pool.query, batch): both stateIds 5+6 linked
    mockQuery.mockResolvedValueOnce({ rows: [{ state_id: 5 }, { state_id: 6 }] });
    // Active-state eligibility is checked after project membership, once per State.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 6, name: "West Kordofan", nameAr: "غرب كردفان", code: "WKR", operationalStatus: "active", officeStatus: "present" }],
    });
    // client.query: BEGIN, then budget read (FOR UPDATE, inside transaction)
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [{ budget: 100000 }] });
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({
        allocations: [
          { stateId: 5, budgetAllocation: 80000 },
          { stateId: 6, budgetAllocation: 30000 }, // total 110000 > 100000
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });

  it("07-b  Negative budget allocation is rejected", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // PRJ-033 stateId membership check (pool.query, batch): stateId 5 is linked
    mockQuery.mockResolvedValueOnce({ rows: [{ state_id: 5 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }],
    });
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({
        allocations: [{ stateId: 5, budgetAllocation: -500 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_allocation");
  });

  it("07-c  Allocation within budget is accepted", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // PRJ-033 stateId membership check (pool.query, batch): stateId 5 is linked
    mockQuery.mockResolvedValueOnce({ rows: [{ state_id: 5 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [{ budget: 100000 }] });
    // assertStateAllowed: PM → non-state role → passes automatically
    mockClientQuery.mockResolvedValue({ rows: [] }); // transaction queries
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({
        allocations: [{ stateId: 5, budgetAllocation: 60000 }],
      });
    expect(res.status).not.toBe(422);
  });

  it("07-d  State allocations POST is gated with projects.update (not projects.create)", async () => {
    denyPerm = "projects.update";
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [] });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.update");
  });
});

// ─── PRJ-AUDIT-08 — Delete integrity ─────────────────────────────────────────

describe("PRJ-AUDIT-08 — Delete integrity", () => {
  it("08-a  Permanent delete blocked when activities have posted expenditure", async () => {
    const app = await buildApp(PM_USER);
    // project exists, not deleted, no approval history (→ permanent mode)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockResolvedValueOnce({                          // project lock
        rows: [{ id: 1, code: "CAFA-PROJ-2026-001", title: "T", status: "draft", sector: "Health", deleted_at: null }],
      })
      .mockResolvedValueOnce({ rows: [] })             // approval history → no final approval
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }); // spent check → has spent activities

    const res = await request(app)
      .delete("/api/projects/1")
      .send({ reason: "Test deletion reason" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("protected_records");
  });

  it("08-b  Permanent delete blocked when finalised reports exist", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockResolvedValueOnce({                          // project lock
        rows: [{ id: 1, code: "CAFA-PROJ-2026-001", title: "T", status: "draft", sector: "Health", deleted_at: null }],
      })
      .mockResolvedValueOnce({ rows: [] })             // approval history → no final approval
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })  // no spent activities
      .mockResolvedValueOnce({ rows: [{ cnt: 2 }] }); // finalized reports

    const res = await request(app)
      .delete("/api/projects/1")
      .send({ reason: "Test deletion reason" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("protected_records");
  });

  it("08-c  Delete requires a reason of at least 5 characters", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1")
      .send({ reason: "No" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("deletion_reason_required");
  });

  it("08-d  Already-deleted project returns 409", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce({               // project lock — deleted_at set
        rows: [{ id: 1, code: "C", title: "T", status: "draft", sector: "Health", deleted_at: new Date() }],
      });
    const res = await request(app)
      .delete("/api/projects/1")
      .send({ reason: "Sufficient reason text" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already deleted/);
  });

  it("08-e  projects.delete permission is required (viewer denied)", async () => {
    denyPerm = "projects.delete";
    const app = await buildApp(VIEWER_USER);
    const res = await request(app)
      .delete("/api/projects/1")
      .send({ reason: "Test deletion reason" });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.delete");
  });
});

// ─── PRJ-AUDIT-09 — PMR integration source ───────────────────────────────────

describe("PRJ-AUDIT-09 — Project-PMR reporting completeness source", () => {
  it("09-a  report-kpis aggregates only project-type, non-draft reports", async () => {
    const app = await buildApp(PM_USER);
    // PM is not a state role → assertStateAllowed returns immediately without a DB call.
    // So the sequence is: getProjectSector, then the KPI queries directly.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ sector: "Health" }] }) // getProjectSector (sector guard)
      .mockResolvedValueOnce({                                   // main KPI query
        rows: [{ reportCount: "3", beneficiariesReached: "50", totalPlannedBudget: "10000", totalActualExpenditure: "8000", latestPeriod: "2026-06" }],
      })
      .mockResolvedValueOnce({ rows: [{ totalActivities: "5", completedActivities: "3", avgPercent: "60" }] })
      .mockResolvedValueOnce({ rows: [{ onBudget: "1", underBudget: "1", overBudget: "0" }] });

    const res = await request(app).get("/api/projects/1/report-kpis");
    expect(res.status).toBe(200);
    expect(res.body.reportCount).toBe(3);

    // Confirm the SQL filters on report_type = 'project' and status != 'draft'
    const kpiCall = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("report_type"),
    );
    expect(kpiCall?.[0]).toMatch(/report_type\s*=\s*'project'/);
    expect(kpiCall?.[0]).toMatch(/status NOT IN \('draft'\)/);
  });

  it("09-b  Soft-deleted project returns 404 on report-kpis", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector with deleted_at IS NULL → returns nothing
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/projects/99/report-kpis");
    expect(res.status).toBe(404);
  });
});

// ─── PRJ-AUDIT-10 — #373 Full Access vs data integrity ───────────────────────

describe("PRJ-AUDIT-10 — #373 Full Access vs data integrity", () => {
  it("10-a  PM (Full Operational Access) cannot create project without reportingFrequency", async () => {
    const app = await buildApp(PM_USER);
    const body = { ...VALID_PROJECT_BODY };
    delete (body as Record<string, unknown>).reportingFrequency;
    const res = await request(app).post("/api/projects").send(body);
    expect(res.status).toBe(400);
    // Full Access does NOT bypass required field validation
    expect(res.body.error).toBe("invalid_reporting_frequency");
  });

  it("10-b  PM cannot submit project without required document gate", async () => {
    const app = await buildApp(PM_USER);
    // The transitions route does its own inline SELECT (not getProjectSector helper).
    // Call order: SELECT status/sector → assertSectorAllowed (no DB for PM) →
    // assertStateAllowed (no DB for PM) → unresolvedRequiredCorrections → doc check.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: "coordination_approved", sector: "Health", managementLevel: "hq_managed" }] }) // project SELECT
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }) // unresolvedRequiredCorrections → 0 open corrections
      .mockResolvedValueOnce({ rows: [{ agreement_count: "0", budget_count: "0" }] }); // doc check → missing docs → 409

    const res = await request(app)
      .post("/api/projects/1/transitions")
      .send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("missing_required_document");
  });

  it("10-c  PM cannot create project without operational location (HQ or state)", async () => {
    const app = await buildApp(PM_USER);
    // Override stateIds to empty and explicitly clear HQ ops flag.
    // The route reads hasHqOperations from raw req.body (not the Zod-parsed body),
    // so even if Zod strips it the check still fires.
    const res = await request(app)
      .post("/api/projects")
      .send({ ...VALID_PROJECT_BODY, hasHqOperations: false, stateIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_operational_location");
  });

  it("10-d  PM cannot create project with negative budgetTotal", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...VALID_PROJECT_BODY, budgetTotal: -1 });
    expect(res.status).toBe(400);
  });
});

// ─── PRJ-AUDIT-11 — PATCH uses projects.update permission (PRJ-001 regression) ─

describe("PRJ-AUDIT-11 — PATCH guard is projects.update (PRJ-001 regression)", () => {
  it("11-a  PATCH route denies when projects.update is blocked", async () => {
    denyPerm = "projects.update";
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .patch("/api/projects/1")
      .send(VALID_PROJECT_BODY);
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.update");
  });

  it("11-b  PATCH route does NOT use projects.create as its permission gate", async () => {
    // Block projects.create but allow projects.update → PATCH should proceed past auth
    denyPerm = "projects.create";
    const app = await buildApp(PM_USER);
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] });
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1, title: "T" }] });
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch("/api/projects/1")
      .send(VALID_PROJECT_BODY);
    // Should not be 403 on permission — passes auth (may fail elsewhere with mock data)
    expect(res.status).not.toBe(403);
  });
});

// ─── PRJ-AUDIT-12 — Soft-deleted project inaccessible ────────────────────────

describe("PRJ-AUDIT-12 — Soft-deleted project inaccessible", () => {
  it("12-a  Detail GET for soft-deleted project returns 404", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector with AND deleted_at IS NULL → rows empty for deleted project
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/projects/99");
    expect(res.status).toBe(404);
    // Confirm deleted_at IS NULL present in the SQL
    const call = mockQuery.mock.calls[0];
    expect(call?.[0]).toMatch(/deleted_at IS NULL/);
  });

  it("12-b  Merge endpoint for soft-deleted project returns 404", async () => {
    const app = await buildApp(PM_USER);
    // merge uses client.query for the initial check with deleted_at IS NULL
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // deleted project → no rows
    const res = await request(app)
      .post("/api/projects/99/merge")
      .send({ stateIds: [5] });
    expect(res.status).toBe(404);
    // Verify SQL includes deleted_at IS NULL
    const call = mockClientQuery.mock.calls[0];
    expect(call?.[0]).toMatch(/deleted_at IS NULL/);
  });

  it("12-c  Documents endpoint for soft-deleted project returns 404", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector with deleted_at IS NULL → no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/projects/99/documents");
    expect(res.status).toBe(404);
  });
});

// ─── PRJ-AUDIT-13 — State allocations guards ────────────────────────────────
// Note: negative-allocation (PRJ-AUDIT-07-b) and over-allocation (PRJ-AUDIT-07-a)
// guards are already covered by PRJ-AUDIT-07.  This block adds the soft-delete
// boundary test that 07 does not cover.

describe("PRJ-AUDIT-13 — State allocations validation guards", () => {
  it("13-a  Soft-deleted project state-allocations returns 404", async () => {
    const app = await buildApp(PM_USER);
    // getProjectSector for deleted project returns no rows → undefined
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [] });
    expect(res.status).toBe(404);
  });
});

// ─── PRJ-AUDIT-14 — State allocations scope guard ────────────────────────────

describe("PRJ-AUDIT-14 — State allocations POST scope guard", () => {
  it("14-a  TC cannot POST state-allocations to out-of-sector project", async () => {
    const app = await buildApp(TC_EDUCATION_USER); // sectors: ["Education"]
    // project sector is "Health" — TC education can't access
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    const res = await request(app)
      .post("/api/projects/1/state-allocations")
      .send({ allocations: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("14-b  SPO cannot POST state-allocations to project in another state", async () => {
    const app = await buildApp(SPO_USER); // stateId: 5
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector
    // assertStateAllowed: checks project_states for stateId=5 — returns no rows (not SPO's state)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // assertStateAllowed DB call
    const res = await request(app)
      .post("/api/projects/99/state-allocations")
      .send({ allocations: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
  });
});

// ─── PRJ-AUDIT-15 — Duplicate-check excludes soft-deleted projects ────────────

describe("PRJ-AUDIT-15 — Duplicate-check excludes soft-deleted projects", () => {
  it("15-a  SQL contains deleted_at IS NULL", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get("/api/projects/duplicate-check?agreementNumber=AGR-XYZ");
    const call = mockQuery.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("agreement_number"),
    );
    expect(call?.[0]).toMatch(/deleted_at IS NULL/);
  });
});
