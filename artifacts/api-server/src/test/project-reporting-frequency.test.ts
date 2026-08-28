/**
 * RFREQ — Project Scheduled Reporting Frequency (Task #325 / Model D)
 *
 * Covers:
 *   RFREQ-01..06      : POST /projects create validation
 *   RFREQ-HIST-01..03 : historical null handling (no default, no backfill)
 *   RFREQ-UPD-01..04  : PATCH /projects/:id update semantics
 *   RFREQ-MIG-01..03  : migration 018 SQL contract
 *   RFREQ-SEC-01..02  : permission / scope enforcement
 *   RFREQ-SAFE-01..03 : cross-frequency safety (reports table untouched)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";

// ─── Module mocks — before any dynamic import of routes ─────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

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

// requirePerm passes through by default; RFREQ-SEC-01 overrides via a 403 gate flag.
let denyPerms = false;
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: (perm: string) => (_req: Request, res: Response, next: NextFunction) => {
      if (denyPerms) {
        res.status(403).json({ error: "forbidden", permission: perm });
        return;
      }
      next();
    },
    permissionsFor: vi.fn().mockReturnValue(["projects.create", "projects.update", "projects.view"]),
  };
});

// ─── Users ───────────────────────────────────────────────────────────────────

const HQ_USER = {
  id: 1, name: "PM User", email: "pm@example.com", role: "program_manager",
  roleLabel: "Programme Manager", scope: "hq",
  stateId: null, stateName: null, sector: null, avatarUrl: null,
};

const SPO_USER = {
  id: 2, name: "SPO User", email: "spo@example.com", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 5, stateName: "South Kordofan", sector: null, avatarUrl: null,
};

async function buildProjectsApp(user?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user) {
      (req as unknown as { currentUser: typeof user }).currentUser = user;
    }
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use("/api", projectsRouter);
  // Mirror production app.ts: ZodError → 400, others → 500
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
      return;
    }
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

const BASE_PROJECT_BODY = {
  title: "Reporting Frequency Test Project",
  description:
    "This is a test project description with enough characters to pass the fifty-character minimum validation requirement on the server.",
  agreementNumber: "AGR-RFREQ-001",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  sectors: ["Health"],
  donor: "UNFPA",
  stateIds: [5],
};

function mockPoolNoOp() {
  mockQuery.mockImplementation((sql: string) => {
    if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** Records every client.query call so we can inspect SQL + params. */
function captureClientQueries(rowsForInsert: Record<string, unknown> = { id: 1 }) {
  const captured: { sql: string; params: unknown[] }[] = [];
  mockClientQuery.mockReset();
  mockClientQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    captured.push({ sql, params });
    return Promise.resolve({ rows: [rowsForInsert] });
  });
  return captured;
}

// Migration SQL source, read once.
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_SRC = fs.readFileSync(
  path.join(__dirname2, "../lib/run-migrations.ts"),
  "utf8",
);
const MIG_018_START = MIGRATIONS_SRC.indexOf("018_project_reporting_frequency");
const MIG_018_NEXT = MIGRATIONS_SRC.indexOf('name: "', MIG_018_START);
const MIG_018 = MIGRATIONS_SRC.slice(
  MIG_018_START,
  MIG_018_NEXT === -1 ? undefined : MIG_018_NEXT,
);

// ─── RFREQ-01..06 — POST create validation ───────────────────────────────────

describe("RFREQ-01..06 — POST /projects reportingFrequency validation", () => {
  beforeEach(() => {
    denyPerms = false;
    mockQuery.mockReset();
    mockPoolNoOp();
    captureClientQueries();
  });

  it.each([
    ["RFREQ-01", "monthly"],
    ["RFREQ-02", "quarterly"],
    ["RFREQ-03", "annual"],
  ])("%s: POST with reportingFrequency=%s → 201 and value persisted", async (_id, freq) => {
    const captured = captureClientQueries();
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: freq });
    expect(res.status).toBe(201);
    const insert = captured.find((c) => /INSERT INTO projects/i.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("reporting_frequency");
    expect(insert!.params).toContain(freq);
  });

  it("RFREQ-04: POST with reportingFrequency=on_demand → 400", async () => {
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "on_demand" });
    expect(res.status).toBe(400);
  });

  it("RFREQ-05: POST with reportingFrequency=weekly (arbitrary string) → 400", async () => {
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .post("/api/projects")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "weekly" });
    expect(res.status).toBe(400);
  });

  it("RFREQ-06: POST without reportingFrequency → 400 (required for new projects)", async () => {
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app).post("/api/projects").send({ ...BASE_PROJECT_BODY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_reporting_frequency");
  });
});

describe("Reporting coverage management concurrency", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
  });

  it("rejects anonymous mutation before opening a transaction", async () => {
    const app = await buildProjectsApp();
    const res = await request(app)
      .patch("/api/projects/7/reporting-coverage")
      .send({
        reportingStartDate: "2026-01-01",
        reportingEndDate: "2026-12-31",
        expectedReportingStartDate: "2026-01-01",
        expectedReportingEndDate: "2026-11-30",
      });
    expect(res.status).toBe(401);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("returns 409 instead of overwriting a concurrently changed coverage range", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (/FROM projects[\s\S]*FOR UPDATE/i.test(sql)) {
        return Promise.resolve({
          rows: [{
            status: "active",
            sector: "Health",
            sectors: [],
            reportingStartDate: "2026-01-01",
            reportingEndDate: "2026-12-31",
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .patch("/api/projects/7/reporting-coverage")
      .send({
        reportingStartDate: "2026-01-01",
        reportingEndDate: "2027-01-31",
        expectedReportingStartDate: "2026-01-01",
        expectedReportingEndDate: "2026-11-30",
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("reporting_coverage_conflict");
    expect(mockClientQuery.mock.calls.some(([sql]) => /UPDATE projects SET reporting_start_date/i.test(String(sql)))).toBe(false);
  });
});

// ─── RFREQ-HIST — historical null handling ───────────────────────────────────

describe("RFREQ-HIST — historical projects stay null", () => {
  beforeEach(() => {
    denyPerms = false;
    mockQuery.mockReset();
    captureClientQueries();
  });

  it("RFREQ-HIST-01/02: GET project with reporting_frequency NULL → reportingFrequency: null (not 'monthly')", async () => {
    const app = await buildProjectsApp(HQ_USER);
    mockQuery.mockImplementation((sql: string) => {
      if (/SELECT sector.*COALESCE\(sectors/i.test(sql)) {
        return Promise.resolve({ rows: [{ sector: "Health", sectors: [] }] });
      }
      if (/COUNT\(\*\)::int AS reached/i.test(sql)) {
        return Promise.resolve({ rows: [{ reached: 0 }] });
      }
      if (/AS spent FROM activities/i.test(sql)) {
        return Promise.resolve({ rows: [{ spent: 0 }] });
      }
      if (/FROM projects p\s/i.test(sql) && /WHERE p\.id = \$1/i.test(sql)) {
        return Promise.resolve({
          rows: [{
            id: 7, title: "Historical", code: "CAFA-H-001", status: "active",
            sector: "Health", sectors: ["Health"], donor: "X",
            reportingFrequency: null,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).get("/api/projects/7");
    expect(res.status).toBe(200);
    expect(res.body.project).toHaveProperty("reportingFrequency");
    expect(res.body.project.reportingFrequency).toBeNull();
    expect(res.body.project.reportingFrequency).not.toBe("monthly");
  });

  it("RFREQ-HIST-03: migration 018 sets no DEFAULT (no silent monthly backfill)", () => {
    expect(MIG_018).not.toMatch(/DEFAULT\s+'monthly'/i);
    expect(MIG_018).not.toMatch(/ADD COLUMN[^;]*DEFAULT/i);
    expect(MIG_018).not.toMatch(/UPDATE\s+projects\s+SET\s+reporting_frequency/i);
  });
});

// ─── RFREQ-UPD — PATCH semantics ─────────────────────────────────────────────

describe("RFREQ-UPD — PATCH /projects/:id", () => {
  beforeEach(() => {
    denyPerms = false;
    mockQuery.mockReset();
    mockPoolNoOp();
  });

  function mockPatchClient() {
    const captured: { sql: string; params: unknown[] }[] = [];
    mockClientQuery.mockReset();
    mockClientQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      if (/SELECT/i.test(sql) && /FROM projects/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, status: "draft", sector: "Health" }] });
      }
      return Promise.resolve({ rows: [{ id: 1 }] });
    });
    return captured;
  }

  it("RFREQ-UPD-01: PATCH reportingFrequency=quarterly on a monthly project → 200, column updated", async () => {
    const captured = mockPatchClient();
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "quarterly" });
    expect(res.status).toBe(200);
    const upd = captured.find((c) => /UPDATE projects SET/i.test(c.sql));
    expect(upd).toBeDefined();
    expect(upd!.sql).toContain("reporting_frequency");
    expect(upd!.params).toContain("quarterly");
    // presence flag true
    expect(upd!.params).toContain(true);
  });

  it("RFREQ-UPD-02/03 (+SAFE-01): PATCH frequency never issues any statement against the reports table", async () => {
    const captured = mockPatchClient();
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "annual" });
    expect(res.status).toBe(200);
    const reportWrites = captured.filter((c) =>
      /(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+reports\b/i.test(c.sql),
    );
    expect(reportWrites).toHaveLength(0); // existing PMRs (incl. drafts) keep their kind
  });

  it("RFREQ-UPD-04: PATCH reportingFrequency=on_demand → 400", async () => {
    mockPatchClient();
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "on_demand" });
    expect(res.status).toBe(400); // rejected by Zod union or route validation
  });

  it("RFREQ-UPD (absent): PATCH without reportingFrequency leaves the column governed by the false flag", async () => {
    const captured = mockPatchClient();
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app).patch("/api/projects/1").send({ ...BASE_PROJECT_BODY });
    expect(res.status).toBe(200);
    const upd = captured.find((c) => /UPDATE projects SET/i.test(c.sql));
    expect(upd).toBeDefined();
    // CASE WHEN $flag THEN $value ELSE reporting_frequency END — flag param is false
    expect(upd!.sql).toMatch(/CASE WHEN \$\d+::boolean THEN \$\d+ ELSE reporting_frequency END/);
    expect(upd!.params).toContain(false);
  });

  it("PATCH retains an existing canonical document without requiring a fresh upload token", async () => {
    mockClientQuery.mockReset();
    mockClientQuery.mockImplementation((sql: string) => {
      if (/SELECT status, sector/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, status: "draft", sector: "Health", sectors: ["Health"] }] });
      }
      if (/FROM project_documents/i.test(sql) && /object_path AS "objectPath"/i.test(sql)) {
        return Promise.resolve({
          rows: [{
            objectPath: "/objects/uploads/existing-project-document",
            fileName: "agreement.pdf",
            contentType: "application/pdf",
            size: 1234,
          }],
        });
      }
      return Promise.resolve({ rows: [{ id: 1 }] });
    });
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app).patch("/api/projects/1").send({
      ...BASE_PROJECT_BODY,
      documents: [{
        category: "agreement",
        kind: "agreement",
        fileName: "agreement.pdf",
        contentType: "application/pdf",
        size: 1234,
        objectPath: "/objects/uploads/existing-project-document",
      }],
    });
    expect(res.status).toBe(200);
  });

  it("PATCH rejects an unowned canonical object path without a descriptor", async () => {
    mockClientQuery.mockReset();
    mockClientQuery.mockImplementation((sql: string) => {
      if (/SELECT status, sector/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, status: "draft", sector: "Health", sectors: ["Health"] }] });
      }
      if (/FROM project_documents/i.test(sql) && /object_path AS "objectPath"/i.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ id: 1 }] });
    });
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app).patch("/api/projects/1").send({
      ...BASE_PROJECT_BODY,
      documents: [{
        category: "optional",
        kind: "supporting",
        fileName: "unowned.pdf",
        contentType: "application/pdf",
        size: 1234,
        objectPath: "/objects/uploads/unowned-project-document",
      }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_document_upload_descriptor");
  });
});

// ─── RFREQ-MIG — migration SQL contract ──────────────────────────────────────

describe("RFREQ-MIG — migration 018 SQL", () => {
  it("RFREQ-MIG-01: adds reporting_frequency TEXT idempotently", () => {
    expect(MIG_018).toMatch(/ADD COLUMN IF NOT EXISTS reporting_frequency TEXT/);
    expect(MIG_018).toMatch(/DROP CONSTRAINT IF EXISTS projects_reporting_frequency_check/);
  });

  it("RFREQ-MIG-02: CHECK allows monthly/quarterly/annual but NOT on_demand", () => {
    expect(MIG_018).toContain("'monthly'");
    expect(MIG_018).toContain("'quarterly'");
    expect(MIG_018).toContain("'annual'");
    // The CHECK constraint's IN (...) list must not admit on_demand
    // (the migration comment may mention it; the constraint must not).
    expect(MIG_018).not.toMatch(/IN\s*\([^)]*on_demand/i);
  });

  it("RFREQ-MIG-03: no non-null DEFAULT anywhere in migration 018", () => {
    expect(MIG_018).not.toMatch(/DEFAULT\s+'/i);
  });
});

// ─── RFREQ-SEC — permissions & scope ─────────────────────────────────────────

describe("RFREQ-SEC — security", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPoolNoOp();
    captureClientQueries();
  });

  it("RFREQ-SEC-01: user without projects.update cannot PATCH reportingFrequency", async () => {
    denyPerms = true;
    const app = await buildProjectsApp(SPO_USER);
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "quarterly" });
    expect(res.status).toBe(403);
    denyPerms = false;
  });

  it("RFREQ-SEC-02: state-scoped user gets 404/403 for an out-of-scope project (no frequency leak)", async () => {
    denyPerms = false;
    const app = await buildProjectsApp(SPO_USER);
    // Detail query returns no rows for a project outside the user's scope
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const res = await request(app).get("/api/projects/999");
    expect([403, 404]).toContain(res.status);
    expect(res.body.reportingFrequency).toBeUndefined();
  });
});

// ─── RFREQ-SAFE — cross-frequency safety ─────────────────────────────────────

describe("RFREQ-SAFE — reports untouched by frequency changes", () => {
  beforeEach(() => {
    denyPerms = false;
    mockQuery.mockReset();
    mockPoolNoOp();
  });

  it("RFREQ-SAFE-01/02/03: frequency change leaves monthly, quarterly and on-demand PMR rows untouched", async () => {
    // Simulated reports table — the mock records any write against it.
    const reportRows = [
      { id: 100, project_id: 1, kind: "monthly", period: "2026-06" },
      { id: 101, project_id: 1, kind: "quarterly", period: "2026-Q2" },
      { id: 102, project_id: 1, kind: "on_demand", period: "2026-06-15" },
    ];
    const before = JSON.parse(JSON.stringify(reportRows));
    mockClientQuery.mockReset();
    mockClientQuery.mockImplementation((sql: string) => {
      if (/(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+reports\b/i.test(sql)) {
        throw new Error("reports table must not be written by a project frequency change");
      }
      if (/SELECT/i.test(sql) && /FROM projects/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, status: "draft", sector: "Health" }] });
      }
      return Promise.resolve({ rows: [{ id: 1 }] });
    });
    const app = await buildProjectsApp(HQ_USER);
    const res = await request(app)
      .patch("/api/projects/1")
      .send({ ...BASE_PROJECT_BODY, reportingFrequency: "annual" });
    expect(res.status).toBe(200);
    // Rows unchanged — monthly and quarterly remain separate records; on-demand unaffected.
    expect(reportRows).toEqual(before);
    expect(reportRows[0].kind).toBe("monthly");
    expect(reportRows[1].kind).toBe("quarterly");
    expect(reportRows[2].kind).toBe("on_demand");
  });
});
