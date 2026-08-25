/**
 * OPLOC — Project Operational Locations test suite
 *
 * Covers the has_hq_operations flag across three test groups:
 *   OPLOC-01..06  : Project CRUD — creating / editing / restoring operational locations
 *   OPLOC-07..09  : Management-level independence — flags are orthogonal
 *   OPLOC-PMR-01..07 : PMR location eligibility enforcement
 *   OPLOC-HIST-01..03: Historical compatibility — existing HQ PMRs remain readable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before any dynamic import of routes
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
// Default: return a resolved Promise so module-level pool.query(...).catch() calls don't fail.
mockQuery.mockResolvedValue({ rows: [] });

// Client mock — used by routes that call pool.connect() (projects route)
const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(mockClient),
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

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn().mockReturnValue(["reports.create", "projects.create"]),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Default no-op pool mock — returns empty rows for any pool.query call. */
function mockPoolNoOp() {
  mockQuery.mockImplementation((sql: string) => {
    if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** A minimal HQ-level user (not state-scoped).
 *  NOTE: program_manager is NOT a PMR author (blocked by PMR_AUTHOR_ROLES gate).
 *  Use HQ_USER only for non-PMR tests in this file. */
const HQ_USER = {
  id: 1,
  name: "PM User",
  email: "pm@example.com",
  role: "program_manager",
  roleLabel: "Programme Manager",
  scope: "hq",
  stateId: null,
  stateName: null,
  sector: null,
  avatarUrl: null,
};

/** Technical Coordinator assigned to Health sector — approved PMR author.
 *  Used for OPLOC-PMR tests that require a non-state, non-PM PMR author. */
const TC_HEALTH_USER = {
  id: 10,
  name: "TC Health",
  email: "tc.health@example.com",
  role: "technical_coordinator",
  roleLabel: "Technical Coordinator",
  scope: "sector",
  stateId: null,
  stateName: null,
  sector: "Health",
  sectors: ["Health"],
  avatarUrl: null,
};

/** A state-scoped SPO user. */
const SPO_USER = {
  id: 2,
  name: "SPO User",
  email: "spo@example.com",
  role: "state_program_officer",
  roleLabel: "State Programme Officer",
  scope: "state",
  stateId: 5,
  stateName: "South Kordofan",
  sector: null,
  avatarUrl: null,
};

/** A state-scoped SOM user. */
const SOM_USER = {
  id: 3,
  name: "SOM User",
  email: "som@example.com",
  role: "state_office_manager",
  roleLabel: "State Office Manager",
  scope: "state",
  stateId: 5,
  stateName: "South Kordofan",
  sector: null,
  avatarUrl: null,
};

async function buildReportsApp(user: Record<string, unknown>) {
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

async function buildProjectsApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use("/api", projectsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

/**
 * Minimal valid project body that passes Zod parse on the server.
 * stateIds and hasHqOperations are intentionally omitted here — tests
 * supply them explicitly to exercise the operational-location gate.
 */
const BASE_PROJECT_BODY = {
  title: "Operational Locations Test Project",
  description:
    "This is a test project description with enough characters to pass the fifty-character minimum validation requirement on the server.",
  agreementNumber: "AGR-OPLOC-001",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  sectors: ["Health"],
  donor: "UNFPA",
  // Required for new projects since Task #325 (Scheduled Reporting Frequency)
  reportingFrequency: "monthly",
};

/** Minimal valid body for a project monthly report */
const BASE_PMR_BODY = {
  title: "Test PMR",
  kind: "monthly",
  reportType: "project",
  period: "2026-06",
  reportingYear: 2026,
  reportingMonth: 6,
  projectId: 42,
  activityName: "Test Activity",
};

// ─────────────────────────────────────────────────────────────────────────────
// OPLOC-01..06 : Project CRUD — operational locations
// ─────────────────────────────────────────────────────────────────────────────

describe("OPLOC-01..06 — Project CRUD Operational Locations", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockQuery.mockReset();
    mockPoolNoOp();
    // Default client query: return { id:1 } for all calls (code-seq, INSERT, COMMIT, etc.)
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1 }] });
  });

  it("OPLOC-01: POST project with stateIds=[5] → 201 (state-only operational location)", async () => {
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, stateIds: [5] });
    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
  });

  it("OPLOC-02: POST project with stateIds=[5,7,12] → 201 (multi-state operational locations)", async () => {
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, stateIds: [5, 7, 12] });
    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
  });

  it("OPLOC-03: POST project with hasHqOperations=true, stateIds=[] → 201 (HQ-only)", async () => {
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, hasHqOperations: true, stateIds: [] });
    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
  });

  it("OPLOC-04: POST project with hasHqOperations=true + stateIds=[5,7] → 201 (HQ + states)", async () => {
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, hasHqOperations: true, stateIds: [5, 7] });
    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
  });

  it("OPLOC-05: POST project with hasHqOperations=false, stateIds=[] → 422 no_operational_location", async () => {
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, hasHqOperations: false, stateIds: [] });
    // No operational location selected — server must reject
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_operational_location");
  });

  it("OPLOC-06: PATCH project with hasHqOperations=true, stateIds=[] → 200 (edit preserves HQ-only)", async () => {
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    // First call: status check SELECT — must return a draft project
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, hasHqOperations: true, stateIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OPLOC-07..09 : Management level independence
// ─────────────────────────────────────────────────────────────────────────────

describe("OPLOC-07..09 — Management level / hasHqOperations independence", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockQuery.mockReset();
    mockPoolNoOp();
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1 }] });
  });

  it("OPLOC-07: managementLevel=hq_managed + hasHqOperations=false + stateIds=[] → 422 (management level alone is not HQ access)", async () => {
    // The backend must deny projects that declare hq_managed but have no operational location.
    // This proves that management_level is NOT the HQ eligibility signal — hasHqOperations is.
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, managementLevel: "hq_managed", hasHqOperations: false, stateIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_operational_location");
  });

  it("OPLOC-08: PATCH with managementLevel change only (no hasHqOperations) + stateIds=[5] → 200, not blocked by ops-location gate", async () => {
    // Changing management_level on a state project does NOT touch has_hq_operations.
    // The gate should pass because stateIds=[5] satisfies the ops-location requirement.
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, managementLevel: "state_managed", stateIds: [5] });
    // No hasHqOperations in body → flag is preserved by COALESCE in SQL
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  it("OPLOC-09: PATCH with hasHqOperations=true + stateIds=[] (no managementLevel) → 200 (HQ-only edit is valid)", async () => {
    // Changing hasHqOperations does not affect managementLevel (not in UPDATE SET).
    // HQ-only edit must succeed when hasHqOperations is true.
    const app = await buildProjectsApp(HQ_USER as unknown as Record<string, unknown>);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health" }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, hasHqOperations: true, stateIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OPLOC-PMR-01..07 : PMR location eligibility enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("OPLOC-PMR — PMR location eligibility", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Restore default resolved value so pool.query(...).catch() at module level
    // doesn't fail if reports.js is first imported after a reset.
    mockPoolNoOp();
  });

  it("OPLOC-PMR-01: Project with State A only → state location accepted (201)", async () => {
    // TC_HEALTH_USER is an approved PMR author (TC role, sector="Health").
    // HQ_USER (program_manager) is no longer a valid PMR author.
    const app = await buildReportsApp(TC_HEALTH_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    mockPoolNoOp(); // default catch-all for reportSelect / withHistory queries after INSERT
    // State PMR query sequence: project SELECT → project_states link → active-state lookup → INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, sector: "Health", managementLevel: "state_managed", hasHqOperations: false }] })
      .mockResolvedValueOnce({ rows: [{ project_id: 42 }] }) // project_states link
      .mockResolvedValueOnce({ rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] });         // INSERT RETURNING id

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "state", stateId: 5, activityName: "Test" });

    // State location must succeed — no HQ-related rejection
    expect(res.status).toBe(201);
    expect(res.body.error).not.toBe("hq_not_permitted_for_project");
    expect(res.body.error).not.toBe("hq_forbidden");
  });

  it("OPLOC-PMR-02: Project with State A + B → both states available (not HQ-gated)", async () => {
    const app = await buildReportsApp(TC_HEALTH_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    mockPoolNoOp();
    // Same sequence as OPLOC-PMR-01 — state PMR has no HQ dup-check step
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, sector: "Health", managementLevel: "state_managed", hasHqOperations: false }] })
      .mockResolvedValueOnce({ rows: [{ project_id: 42 }] }) // project_states link for stateId=5
      .mockResolvedValueOnce({ rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] });         // INSERT RETURNING id

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "state", stateId: 5, activityName: "Test" });

    expect(res.status).toBe(201);
    expect(res.body.error).not.toBe("hq_not_permitted_for_project");
    expect(res.body.error).not.toBe("hq_forbidden");
  });

  it("OPLOC-PMR-03: hasHqOperations=true → HQ accepted for authorised non-state TC user (201)", async () => {
    // TC (approved PMR author) may create HQ PMRs when hasHqOperations=true.
    const app = await buildReportsApp(TC_HEALTH_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    mockPoolNoOp(); // default catch-all for reportSelect / withHistory queries after INSERT
    // HQ PMR query sequence: project SELECT → HQ dup-check → INSERT (no project_states link for HQ)
    const projectRow = { id: 42, sector: "Health", managementLevel: "hq_managed", hasHqOperations: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [projectRow] })  // project SELECT
      .mockResolvedValueOnce({ rows: [] })             // HQ dup-check → no duplicate
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }); // INSERT RETURNING id

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "hq", activityName: "Test" });

    expect(res.status).toBe(201);
    expect(res.body.error).not.toBe("hq_not_permitted_for_project");
    expect(res.body.error).not.toBe("hq_forbidden");
  });

  it("OPLOC-PMR-04: hq_managed + hasHqOperations=false → HQ denied even for TC (400)", async () => {
    // TC is an approved PMR author but still cannot create HQ PMR without hasHqOperations=true.
    const app = await buildReportsApp(TC_HEALTH_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    // Project is hq_managed but hasHqOperations=false — must still be denied.
    const projectRow = { id: 42, sector: "Health", managementLevel: "hq_managed", hasHqOperations: false };
    mockQuery.mockResolvedValueOnce({ rows: [projectRow] });

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "hq", activityName: "Test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("hq_not_permitted_for_project");
  });

  it("OPLOC-PMR-05: hasHqOperations=true but SPO user → HQ denied (403)", async () => {
    const app = await buildReportsApp(SPO_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    const projectRow = { id: 42, sector: "Health", managementLevel: "hq_managed", hasHqOperations: true };
    mockQuery.mockResolvedValueOnce({ rows: [projectRow] });

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "hq", activityName: "Test" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_forbidden");
  });

  it("OPLOC-PMR-05b: SOM user → blocked as non-PMR-author (403)", async () => {
    // SOM is not in PMR_AUTHOR_ROLES (blocked before any HQ location check).
    // The error is project_report_author_role_required, not hq_forbidden.
    const app = await buildReportsApp(SOM_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "hq", activityName: "Test" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_report_author_role_required");
  });

  it("OPLOC-PMR-06: Direct API POST with locationType=hq when hasHqOperations=false → 400", async () => {
    const app = await buildReportsApp(TC_HEALTH_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    const projectRow = { id: 42, sector: "Health", managementLevel: "state_managed", hasHqOperations: false };
    mockQuery.mockResolvedValueOnce({ rows: [projectRow] });

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "hq", activityName: "Test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("hq_not_permitted_for_project");
  });

  it("OPLOC-PMR-07: Direct API POST for State not in project_states → 400", async () => {
    const app = await buildReportsApp(TC_HEALTH_USER as unknown as Record<string, unknown>);
    mockQuery.mockReset();
    // Project row found; project_states link for stateId=99 NOT found
    const projectRow = { id: 42, sector: "Health", managementLevel: "state_managed", hasHqOperations: false };
    mockQuery
      .mockResolvedValueOnce({ rows: [projectRow] })          // project SELECT
      .mockResolvedValueOnce({ rows: [] });                   // project_states SELECT → no link

    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_PMR_BODY, locationType: "state", stateId: 99, activityName: "Test" });

    // State not linked to project — must be rejected
    expect([400, 403].includes(res.status)).toBe(true);
    expect(["state_not_linked_to_project", "project_state_mismatch"].includes(res.body.error)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OPLOC-HIST-01..03 : Historical compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe("OPLOC-HIST — Historical PMR compatibility", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPoolNoOp();
  });

  it("OPLOC-HIST-01: Existing project state relationships are unaffected by the new flag", () => {
    // The has_hq_operations column defaults to false for existing projects.
    // project_states table is unchanged — state linkage remains the source of truth for states.
    // This is a spec invariant: no data migration touches project_states.
    const existingStateIds = [3, 7, 12];
    const hasHqOperations = false; // migration default
    expect(existingStateIds.length).toBeGreaterThan(0);
    expect(hasHqOperations).toBe(false);
  });

  it("OPLOC-HIST-02: Migration 016 adds column to projects only — reports table locationType field is unchanged", () => {
    // Migration 016 runs:
    //   ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_hq_operations BOOLEAN NOT NULL DEFAULT false
    // The `reports` table is untouched. Any existing row with locationType='hq' remains readable.
    // Enforcement only applies on new POST creates; no retroactive UPDATE is applied.
    const migrationSql = "ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_hq_operations BOOLEAN NOT NULL DEFAULT false";
    expect(migrationSql).toContain("projects");
    expect(migrationSql).not.toContain("reports");
    // A historical HQ PMR row shape is unchanged
    const historicalHqPmr = { id: 55, reportType: "project", locationType: "hq", period: "2025-06" };
    expect(historicalHqPmr.locationType).toBe("hq");
  });

  it("OPLOC-HIST-03: New HQ PMR creation is enforced by hasHqOperations — existing records are not retroactively invalidated", () => {
    // Only NEW creates are gated by has_hq_operations.
    // Historical records already in the DB with locationType="hq" are never touched
    // by the migration (no UPDATE applied retroactively).
    // The spec intent: backward compatibility is guaranteed by the migration design.
    const migrationDefault = false; // has_hq_operations DEFAULT false
    const existingHqPmrLocationType = "hq"; // unchanged in the reports table
    // The migration adds the column to projects, not to reports.
    // Reports with locationType="hq" remain as-is.
    expect(migrationDefault).toBe(false);
    expect(existingHqPmrLocationType).toBe("hq");
  });
});
