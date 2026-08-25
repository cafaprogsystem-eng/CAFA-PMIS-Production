/**
 * Plans Module Zero-Residual Closure — Wave 2 (Task closure tests)
 *
 * PLAN-PERF-01…07   PLAN-015 list-performance: pre-aggregated LEFT JOIN
 *                   replaces per-row correlated subqueries; null contract and
 *                   scope rules preserved.
 * MIG-021-01…05     Migration-identity regression guard: full migration name
 *                   is the identity key; the duplicate "021" numeric prefix is
 *                   non-semantic (NOT A DEFECT).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: shared mock handles ───────────────────────────────────────────
const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
  createNotification:        vi.fn().mockResolvedValue(undefined),
  notifyEntityActors:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:          vi.fn().mockResolvedValue(undefined),
    requirePerm:       () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER   = { id: 1, name: "PM",  email: "pm@t.com",  role: "program_manager",       roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const SA_USER   = { id: 2, name: "SA",  email: "sa@t.com",  role: "super_admin",           roleLabel: "Super Admin",       scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const TC_HEALTH = { id: 3, name: "TCH", email: "tch@t.com", role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "sector", stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null } as const;
const SPO_USER  = { id: 4, name: "SPO", email: "spo@t.com", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null } as const;
const SPO_NULL  = { ...SPO_USER, id: 6, stateId: null, stateName: null } as const;

const PLAN_ROW = {
  id: 42, code: "CAFA-PLAN-042", title: "Wave 2 Plan", planType: "monthly", frequency: "monthly",
  status: "active", projectId: null, projectTitle: null, stateId: 5, stateName: "Khartoum",
  localityId: null, localities: [], sector: "Health", sectors: ["Health"],
  responsibleName: "Alice", responsibleUserId: null, responsibleUserName: null,
  startDate: "2026-08-01", endDate: "2026-08-31",
  budgetPlanned: null, budgetActual: null, fundingSource: null, currency: null,
  budgetLegacyUnverified: false, locationType: "state", lastFinalApprovedAt: null,
  progressPct: null, activitiesCount: 0,
};

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: plansRouter } = await import("../routes/plans.js");
  app.use("/", plansRouter);
  return app;
}

/** Wires pool.query to return the given rows for the list select. */
function setupListQuery(rows: Array<Record<string, unknown>>) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows });
    return Promise.resolve({ rows: [] });
  });
}

/** Extracts the SQL of the list query issued by GET /plans. */
function capturedListSql(): string {
  const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"));
  return call ? String(call[0]) : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-PERF: PLAN-015 list-performance closure (7)
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-PERF: pre-aggregated activity join", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-PERF-01: list issues a single query with no correlated plan_activities subqueries", async () => {
    setupListQuery([PLAN_ROW]);
    const res = await request(await buildApp({ ...PM_USER })).get("/plans");
    expect(res.status).toBe(200);
    // Singular main query — not one query per plan row.
    const listCalls = mockPoolQuery.mock.calls.filter((c) => String(c[0]).includes("FROM plans pl"));
    expect(listCalls.length).toBe(1);
    expect(mockPoolQuery.mock.calls.length).toBe(1);
    const sql = capturedListSql();
    // Correlated form is gone…
    expect(sql).not.toMatch(/\(SELECT\s+ROUND\(AVG\(pa\.progress_pct\)/);
    expect(sql).not.toContain("WHERE pa.plan_id = pl.id");
    // …replaced by one grouped LEFT JOIN; the only pl.id reference to
    // plan_activities aggregates is the JOIN's ON clause.
    expect(sql).toContain("LEFT JOIN (");
    expect(sql).toContain("GROUP BY plan_id");
    expect(sql).toContain('ON pa_agg.plan_id = pl.id');
  });

  it("PLAN-PERF-02: aggregation is grouped per plan — one plan row per plan regardless of activity count", async () => {
    // A plan with 3 activities aggregates to a single pa_agg row (GROUP BY plan_id),
    // so the LEFT JOIN cannot fan out the plan row.
    setupListQuery([{ ...PLAN_ROW, activitiesCount: 3, progressPct: 40 }]);
    const res = await request(await buildApp({ ...PM_USER })).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].activitiesCount).toBe(3);
    const sql = capturedListSql();
    // Structural guarantee of 1:1 join cardinality: aggregate subquery groups by plan_id.
    const subquery = sql.slice(sql.indexOf("LEFT JOIN ("));
    expect(subquery).toContain("FROM plan_activities");
    expect(subquery).toContain("GROUP BY plan_id");
  });

  it("PLAN-PERF-03: cancelled activities are excluded from progress (all cancelled → null)", async () => {
    setupListQuery([{ ...PLAN_ROW, progressPct: null, activitiesCount: 2 }]);
    const res = await request(await buildApp({ ...PM_USER })).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body[0].progressPct).toBeNull();
    const sql = capturedListSql();
    // AVG over CASE WHEN: cancelled rows contribute NULL, and AVG of only NULLs is NULL.
    expect(sql).toMatch(/AVG\(CASE WHEN status <> 'cancelled' THEN progress_pct END\)/);
  });

  it("PLAN-PERF-04: no eligible activities → progressPct null, not 0 (no COALESCE reintroduced)", async () => {
    setupListQuery([{ ...PLAN_ROW, progressPct: null, activitiesCount: 0 }]);
    const res = await request(await buildApp({ ...PM_USER })).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body[0].progressPct).toBeNull();
    expect(res.body[0].activitiesCount).toBe(0);
    const sql = capturedListSql();
    // COALESCE only guards activitiesCount — never progressPct.
    expect(sql).toContain('COALESCE(pa_agg."activitiesCount", 0)');
    expect(sql).not.toMatch(/COALESCE\(pa_agg\."progressPct"/);
  });

  it("PLAN-PERF-05: state scope unchanged — SPO clamped to own state; null-state SPO fails closed", async () => {
    setupListQuery([PLAN_ROW]);
    const res = await request(await buildApp({ ...SPO_USER })).get("/plans?stateId=999");
    expect(res.status).toBe(200);
    const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"))!;
    expect(String(call[0])).toContain("pl.state_id = $1");
    expect(call[1]).toEqual([5]); // clamped to own state, crafted ?stateId ignored
    // Fail-closed: SPO without a state sees nothing and no query runs.
    vi.clearAllMocks();
    setupListQuery([PLAN_ROW]);
    const res2 = await request(await buildApp({ ...SPO_NULL })).get("/plans");
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual([]);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("PLAN-PERF-06: TC sector scope unchanged — effective-sectors EXISTS filter applied", async () => {
    setupListQuery([PLAN_ROW]);
    const res = await request(await buildApp({ ...TC_HEALTH })).get("/plans");
    expect(res.status).toBe(200);
    const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"))!;
    expect(String(call[0])).toMatch(/EXISTS \(SELECT 1 FROM jsonb_array_elements_text\(/);
    expect(call[1]).toEqual([["Health"]]);
  });

  it("PLAN-PERF-07: PM and Super Admin full access — no state/sector filters injected", async () => {
    for (const user of [PM_USER, SA_USER]) {
      vi.clearAllMocks();
      setupListQuery([PLAN_ROW]);
      const res = await request(await buildApp({ ...user })).get("/plans");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"))!;
      expect(String(call[0])).not.toContain("WHERE");
      expect(call[1]).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MIG-021: migration-identity regression guard (5)
// ─────────────────────────────────────────────────────────────────────────────
describe("MIG-021: migration full-name identity", () => {
  const HQSR_NAME  = "021_hq_sector_location_integrity";
  const DRIVE_NAME = "021_report_attachments_drive_file_id.sql";

  const runnerSourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../lib/run-migrations.ts",
  );

  it("MIG-021-01: all full migration names in the registry are unique", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("MIG-021-02: both 021-prefixed migrations are present with distinct full names", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const names = MIGRATIONS.map((m) => m.name);
    expect(names).toContain(HQSR_NAME);
    expect(names).toContain(DRIVE_NAME);
    expect(HQSR_NAME).not.toBe(DRIVE_NAME);
    // Both are independently trackable registry entries with their own SQL.
    const hqsr  = MIGRATIONS.find((m) => m.name === HQSR_NAME)!;
    const drive = MIGRATIONS.find((m) => m.name === DRIVE_NAME)!;
    expect(hqsr.sql).not.toBe(drive.sql);
  });

  it("MIG-021-03: the runner uses full-name identity (schema_migrations lookup + insert by name)", () => {
    const src = readFileSync(runnerSourcePath, "utf8");
    // Applied-check and tracking insert both key on the FULL migration name.
    expect(src).toContain("schema_migrations WHERE filename = $1");
    expect(src).toMatch(/INSERT INTO public\.schema_migrations \(filename, checksum\) VALUES \(\$1, \$2\)/);
    expect(src).toContain("[migration.name, checksum]");
    // No numeric-prefix parsing anywhere in the runner.
    expect(src).not.toMatch(/name\.(slice|substring|split)\(/);
  });

  it("MIG-021-04: the numeric 021 prefix appears exactly twice — proving it is non-semantic", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const with021 = MIGRATIONS.filter((m) => m.name.startsWith("021_"));
    expect(with021.length).toBe(2);
    expect(with021.map((m) => m.name).sort()).toEqual([HQSR_NAME, DRIVE_NAME].sort());
  });

  it("MIG-021-05: a forward-looking convention comment documents the duplicate prefix", () => {
    const src = readFileSync(runnerSourcePath, "utf8");
    const commentIdx = src.indexOf("FORWARD-LOOKING CONVENTION");
    const secondEntryIdx = src.indexOf(`name: "${DRIVE_NAME}"`);
    expect(commentIdx).toBeGreaterThan(-1);
    expect(secondEntryIdx).toBeGreaterThan(-1);
    // The comment sits above the second 021_ entry.
    expect(commentIdx).toBeLessThan(secondEntryIdx);
    // And it states that full-name uniqueness is the identity rule.
    expect(src).toContain("uniqueness of the full");
  });
});
