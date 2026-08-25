/**
 * HQSR-004 — HQ Sector Report Location Integrity (CREATE)
 *
 * Canonical invariant: report_type = 'hq_sector' requires
 * state_id IS NULL AND project_id IS NULL.
 *
 * Verifies:
 *  - POST /reports rejects supplied stateId/projectId with 422
 *    hq_sector_location_invalid (actor-independent — TC, SPC fallback, PM
 *    Full Operational Access, super_admin all bound).
 *  - Valid creates always persist NULL/NULL (INSERT param inspection).
 *  - Rejected creates never reach the DB (no INSERT).
 *  - Audit-query heuristics (Class A classification) behave correctly.
 *
 * Test IDs: HQSR-LOC-01 … 06, HQSR-LOC-ROLE-01 … 04, HQSR-LOC-HIST-*,
 *           plus regression assertions for other report types.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAIN_SECTORS } from "../lib/sectors.js";

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

const mockPermissionsFor = vi.fn().mockReturnValue(["reports.create"]);
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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Assert that no INSERT INTO reports was ever issued. */
function expectNoReportInsert() {
  const insertCalls = mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
  );
  expect(insertCalls).toHaveLength(0);
}

/** Return the params of the (single) INSERT INTO reports call. */
function reportInsertParams(): unknown[] {
  const insertCalls = mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
  );
  expect(insertCalls).toHaveLength(1);
  return insertCalls[0][1] as unknown[];
}

/**
 * INSERT column order (see routes/reports.ts):
 * $11 = project_id, $12 = state_id → params indexes 10 and 11.
 */
function expectInsertNullLinkage() {
  const params = reportInsertParams();
  expect(params[10]).toBeNull(); // project_id
  expect(params[11]).toBeNull(); // state_id
}

const BASE_HQSR_BODY = {
  title: "Test HQ Sector Report",
  kind: "monthly",
  reportType: "hq_sector",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  sector: "WASH",
} as const;

const TC_USER = {
  id: 11, name: "TC Test", email: "tc@example.com",
  role: "technical_coordinator", stateId: null, sector: "WASH", sectors: ["WASH"],
} as const;

const SPC_USER = {
  id: 15, name: "SPC", email: "spc@example.com",
  role: "senior_program_coordinator", stateId: null, sector: null, sectors: [],
} as const;

const PM_USER = {
  id: 14, name: "PM", email: "pm@example.com",
  role: "program_manager", stateId: null, sector: null, sectors: [],
} as const;

const SUPER_ADMIN_USER = {
  id: 12, name: "Admin", email: "admin@example.com",
  role: "super_admin", stateId: null, sector: null, sectors: [],
} as const;

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

/** SPC vacancy check returns "no active TC" (empty roster). */
function mockVacantTcRoster() {
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("role = 'technical_coordinator'") && sql.includes("status = 'active'")) {
      return Promise.resolve({ rows: [] });
    }
    // HQSR duplicate guard (Migration 023): return empty to simulate "no existing duplicate".
    if (typeof sql === "string" && sql.includes("report_type = 'hq_sector'") && !sql.includes("INSERT")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [{ id: 99 }] });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 422 rejection of supplied linkage (HQSR-LOC-03 … 06)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-004 — CREATE rejects State/Project linkage", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 99 }] });
    mockPermissionsFor.mockReturnValue(["reports.create"]);
  });

  it("HQSR-LOC-03: stateId supplied → 422 hq_sector_location_invalid, no insert", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, stateId: 3 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expect(res.body.fields).toEqual(["stateId"]);
    expectNoReportInsert();
  });

  it("HQSR-LOC-04: projectId supplied → 422 hq_sector_location_invalid, no insert", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, projectId: 7 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expect(res.body.fields).toEqual(["projectId"]);
    expectNoReportInsert();
  });

  it("HQSR-LOC-05/06: both supplied → 422 listing both fields, 0 rows created", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, stateId: 3, projectId: 7 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expect(res.body.fields).toEqual(["stateId", "projectId"]);
    expectNoReportInsert();
  });

  it("HQSR-001 precedence: invalid sector still 400 before the location check", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "NotASector", stateId: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_sector");
  });

  it("HQSR-001 precedence: author-role 403 still precedes the location check", async () => {
    const SPO = { id: 10, name: "SPO", email: "spo@example.com", role: "state_program_officer", stateId: 1, sector: null, sectors: [] };
    const app = await buildApp(SPO as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, stateId: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
  });

  it("PM cannot bypass with stateId (Full Operational Access is not a location override)", async () => {
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, stateId: 2, overrideReason: "urgent" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expectNoReportInsert();
  });

  it("super_admin cannot bypass with projectId", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, projectId: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expectNoReportInsert();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Valid creates persist NULL/NULL (HQSR-LOC-01/02, HQSR-LOC-ROLE-01 … 04)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-004 — valid creates persist NULL/NULL", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Return empty rows for HQSR duplicate check (no active duplicate),
    // and { id: 99 } for INSERT RETURNING id and all other queries.
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("report_type = 'hq_sector'") && !sql.includes("INSERT")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ id: 99 }] });
    });
    mockPermissionsFor.mockReturnValue(["reports.create"]);
  });

  it("HQSR-LOC-01/02 + ROLE-01: TC create → INSERT carries null project_id and null state_id", async () => {
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    expectInsertNullLinkage();
  });

  it("HQSR-LOC-ROLE-02: SPC fallback create → NULL/NULL", async () => {
    mockVacantTcRoster();
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    expectInsertNullLinkage();
  });

  it("HQSR-LOC-ROLE-03: PM Full Operational Access create → NULL/NULL", async () => {
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    expectInsertNullLinkage();
  });

  it("HQSR-LOC-ROLE-04: super_admin create → NULL/NULL", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY });
    expect(res.status).toBe(201);
    expectInsertNullLinkage();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-type regression — other types keep their linkage semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-004 — other report types unaffected", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.create"]);
  });

  it("HQSR-LOC-DB-02 (route-level): SPR with stateId still passes the location layer", async () => {
    // SPO authors an SPR — state clamp resolves state_id from the profile.
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM states")) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      return Promise.resolve({ rows: [{ id: 99 }] });
    });
    const SPO = { id: 10, name: "SPO", email: "spo@example.com", role: "state_program_officer", stateId: 1, sector: null, sectors: [] };
    const app = await buildApp(SPO as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({
      title: "SPR", kind: "monthly", reportType: "program_state",
      period: "2026-06", reportingMonth: 6, reportingYear: 2026, stateId: 1,
    });
    // Must never be the HQSR location error — SPRs legitimately carry state_id.
    expect(res.body.error).not.toBe("hq_sector_location_invalid");
    if (res.status === 201) {
      const params = reportInsertParams();
      expect(params[11]).toBe(1); // state_id persisted for SPR
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit heuristics (HQSR-LOC-HIST-01 … 04) — pure classification logic
// ─────────────────────────────────────────────────────────────────────────────

type AuditRow = { report_type: string; state_id: number | null; project_id: number | null; sector: string | null; kind: string };

/** Mirrors the audit query WHERE clause. */
function isMalformedHqsr(r: AuditRow): boolean {
  return r.report_type === "hq_sector" && (r.state_id !== null || r.project_id !== null);
}

/** Mirrors the Migration 021 Class A remediation predicate (canonical sectors only). */
function isClassA(r: AuditRow): boolean {
  return isMalformedHqsr(r)
    && r.sector !== null
    && MAIN_SECTORS.includes(r.sector as (typeof MAIN_SECTORS)[number])
    && ["monthly", "quarterly", "annual", "on_demand"].includes(r.kind);
}

describe("HQSR-004 — audit classification heuristics", () => {
  it("HQSR-LOC-HIST-01: state-only malformed row detected and Class A when sector+kind valid", () => {
    const row: AuditRow = { report_type: "hq_sector", state_id: 1, project_id: null, sector: "Health", kind: "monthly" };
    expect(isMalformedHqsr(row)).toBe(true);
    expect(isClassA(row)).toBe(true);
  });

  it("HQSR-LOC-HIST-02: project-only malformed row detected", () => {
    const row: AuditRow = { report_type: "hq_sector", state_id: null, project_id: 4, sector: "WASH", kind: "quarterly" };
    expect(isMalformedHqsr(row)).toBe(true);
    expect(isClassA(row)).toBe(true);
  });

  it("HQSR-LOC-HIST-03: both-linkage malformed row detected", () => {
    const row: AuditRow = { report_type: "hq_sector", state_id: 1, project_id: 1, sector: "Health", kind: "monthly" };
    expect(isMalformedHqsr(row)).toBe(true);
    expect(isClassA(row)).toBe(true);
  });

  it("HQSR-LOC-HIST-04: canonical NULL/NULL HQSR is not flagged", () => {
    const row: AuditRow = { report_type: "hq_sector", state_id: null, project_id: null, sector: "Health", kind: "monthly" };
    expect(isMalformedHqsr(row)).toBe(false);
  });

  it("Class B (missing sector) is malformed but NOT auto-remediated", () => {
    const row: AuditRow = { report_type: "hq_sector", state_id: 2, project_id: null, sector: null, kind: "monthly" };
    expect(isMalformedHqsr(row)).toBe(true);
    expect(isClassA(row)).toBe(false);
  });

  it("Class B (non-null but non-canonical/legacy sector) is NOT auto-remediated", () => {
    for (const legacy of ["Multi-Purpose Cash Assistance", "Shelter", "FSL", "health", " Health ", "Unknown"]) {
      const row: AuditRow = { report_type: "hq_sector", state_id: 2, project_id: null, sector: legacy, kind: "monthly" };
      expect(isMalformedHqsr(row)).toBe(true);
      expect(isClassA(row)).toBe(false);
    }
  });

  it("Class B (invalid kind) is NOT auto-remediated even with canonical sector", () => {
    const row: AuditRow = { report_type: "hq_sector", state_id: 2, project_id: null, sector: "Health", kind: "weekly" };
    expect(isClassA(row)).toBe(false);
  });

  it("Migration 021 SQL predicate stays in lockstep with the canonical sector taxonomy", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(resolve(here, "../lib/run-migrations.ts"), "utf8");
    const start = sql.indexOf("021_hq_sector_location_integrity");
    expect(start).toBeGreaterThan(-1);
    const block = sql.slice(start, sql.indexOf("chk_hq_sector_no_state_project", start));
    // Remediation UPDATE must whitelist exactly the canonical Main Sectors —
    // never a bare `sector IS NOT NULL` (that would remediate legacy/invalid
    // sectors and destroy Class B classification evidence).
    expect(block).not.toMatch(/sector IS NOT NULL/);
    for (const s of MAIN_SECTORS) {
      expect(block).toContain(`'${s}'`);
    }
    // No extra sector literals beyond the canonical seven in the IN list.
    const inList = block.match(/sector IN \(([\s\S]*?)\)/)?.[1] ?? "";
    const literals = [...inList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(literals)).toEqual(new Set(MAIN_SECTORS));
  });

  it("Other report types with linkage are never flagged", () => {
    const spr: AuditRow = { report_type: "program_state", state_id: 1, project_id: null, sector: null, kind: "monthly" };
    const proj: AuditRow = { report_type: "project", state_id: 1, project_id: 3, sector: "Health", kind: "monthly" };
    expect(isMalformedHqsr(spr)).toBe(false);
    expect(isMalformedHqsr(proj)).toBe(false);
  });
});
