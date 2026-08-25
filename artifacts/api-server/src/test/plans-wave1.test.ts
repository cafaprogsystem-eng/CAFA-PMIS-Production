/**
 * Plans Module Zero-Residual Closure — Wave 1 (Task closure tests)
 *
 * PLAN-W1-SEC-01…08   PLAN-009 multi-sector regression (authoritative helper)
 * PLAN-W1-CG-01…10    Completed-plan integrity gate (race-safe FOR UPDATE)
 * PLAN-W1-PP-01…05    progressPct nullability contract (number | null)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import * as zodSchemas from "@workspace/api-zod";

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
const PM_USER  = { id: 1, name: "PM",  email: "pm@t.com",  role: "program_manager",       roleLabel: "Programme Manager",     scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const SA_USER  = { id: 2, name: "SA",  email: "sa@t.com",  role: "super_admin",           roleLabel: "Super Admin",           scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const TC_HEALTH = { id: 3, name: "TCH", email: "tch@t.com", role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "sector", stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null } as const;
const TC_EDUC   = { id: 9, name: "TCE", email: "tce@t.com", role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "sector", stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null } as const;
const TC_WASH   = { id: 10, name: "TCW", email: "tcw@t.com", role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "sector", stateId: null, stateName: null, sector: "WASH", sectors: ["WASH"], avatarUrl: null } as const;
const SPO_USER  = { id: 4, name: "SPO", email: "spo@t.com", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null } as const;

const PLAN_ROW = {
  id: 42, status: "active", sector: "Health", stateId: null, locationType: "hq",
  title: "Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: ["Health"], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-042", stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: null, endDate: null, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
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

/**
 * Wires pool.query for GET /plans/:planId — getPlanMeta (LEFT JOIN projects,
 * location_type) and the summary/detail selects (FROM plans pl).
 */
function setupPlanReads(opts: {
  sectors: string[]; sector?: string | null;
  stateId?: number | null; locationType?: string | null;
  progressPct?: number | null;
}) {
  const meta = {
    sector: opts.sector ?? opts.sectors[0] ?? null,
    sectors: opts.sectors,
    stateId: opts.stateId ?? null,
    locationType: opts.locationType ?? "hq",
  };
  mockPoolQuery.mockImplementation((sql: string) => {
    // PLAN-015 (Wave 2): summary aggregates come from the pa_agg LEFT JOIN
    if (sql.includes("pa_agg")) {
      // planSummarySelect — the authoritative summary row
      return Promise.resolve({
        rows: [{ ...PLAN_ROW, sectors: opts.sectors, sector: meta.sector, stateId: meta.stateId, locationType: meta.locationType, progressPct: opts.progressPct ?? null }],
      });
    }
    if (sql.includes("location_type") && sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [meta] });
    }
    if (sql.includes("FROM plans pl")) {
      return Promise.resolve({
        rows: [{ ...PLAN_ROW, sectors: opts.sectors, sector: meta.sector, stateId: meta.stateId, locationType: meta.locationType, progressPct: opts.progressPct ?? null }],
      });
    }
    // PATCH pre-checks: status lookup + "before" snapshot (plain FROM plans, no alias)
    if (sql.includes("FROM plans WHERE id")) {
      return Promise.resolve({
        rows: [{ status: "draft", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "T", responsible_user_id: null }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-W1-SEC: PLAN-009 sector regression (8)
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-W1-SEC: multi-sector plan semantics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-W1-SEC-01: single-sector plan — TC of that sector can view", async () => {
    setupPlanReads({ sectors: ["Health"] });
    const res = await request(await buildApp({ ...TC_HEALTH })).get("/plans/42");
    expect(res.status).toBe(200);
  });

  it("PLAN-W1-SEC-02: multi-sector plan — TC of the primary sector can view", async () => {
    setupPlanReads({ sectors: ["Health", "Education"] });
    const res = await request(await buildApp({ ...TC_HEALTH })).get("/plans/42");
    expect(res.status).toBe(200);
  });

  it("PLAN-W1-SEC-03: multi-sector plan — TC of a SECONDARY sector can view (PLAN-009 core fix)", async () => {
    setupPlanReads({ sectors: ["Health", "Education"] });
    const res = await request(await buildApp({ ...TC_EDUC })).get("/plans/42");
    expect(res.status).toBe(200);
  });

  it("PLAN-W1-SEC-04: TC with no matching sector is denied (sector_forbidden)", async () => {
    setupPlanReads({ sectors: ["Health", "Education"] });
    const res = await request(await buildApp({ ...TC_WASH })).get("/plans/42");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PLAN-W1-SEC-05: PM and super_admin have full access regardless of sectors", async () => {
    setupPlanReads({ sectors: ["Health"] });
    expect((await request(await buildApp({ ...PM_USER })).get("/plans/42")).status).toBe(200);
    setupPlanReads({ sectors: ["Health"] });
    expect((await request(await buildApp({ ...SA_USER })).get("/plans/42")).status).toBe(200);
  });

  it("PLAN-W1-SEC-06: effective-sectors SQL falls back sectors → plan sector → project sector", async () => {
    const { EFFECTIVE_SECTORS_SQL } = await import("../routes/plans.js");
    // Full array wins when non-empty
    const idxArray   = EFFECTIVE_SECTORS_SQL.indexOf("jsonb_array_length(COALESCE(pl.sectors");
    const idxPlan    = EFFECTIVE_SECTORS_SQL.indexOf("NULLIF(pl.sector, '')");
    const idxProject = EFFECTIVE_SECTORS_SQL.indexOf("NULLIF(p.sector, '')");
    expect(idxArray).toBeGreaterThanOrEqual(0);
    expect(idxPlan).toBeGreaterThan(idxArray);   // legacy single-sector is the second branch
    expect(idxProject).toBeGreaterThan(idxPlan); // project sector inherits last
    // Project-linked plan: helper returns the project-derived sectors verbatim
    setupPlanReads({ sectors: ["Protection"], sector: null });
    const { getPlanEffectiveSectors } = await import("../routes/plans.js");
    expect(await getPlanEffectiveSectors(42)).toEqual(["Protection"]);
  });

  it("PLAN-W1-SEC-07: standalone state plan — in-state SPO allowed, cross-state denied", async () => {
    setupPlanReads({ sectors: ["Health"], stateId: 5, locationType: "state" });
    expect((await request(await buildApp({ ...SPO_USER })).get("/plans/42")).status).toBe(200);
    setupPlanReads({ sectors: ["Health"], stateId: 7, locationType: "state" });
    const res = await request(await buildApp({ ...SPO_USER })).get("/plans/42");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
  });

  it("PLAN-W1-SEC-08: HQ plan — state role denied, sector-matched TC allowed", async () => {
    setupPlanReads({ sectors: ["Health"], stateId: null, locationType: "hq" });
    const spoRes = await request(await buildApp({ ...SPO_USER })).get("/plans/42");
    expect(spoRes.status).toBe(403);
    expect(spoRes.body.error).toBe("hq_forbidden");
    setupPlanReads({ sectors: ["Health"], stateId: null, locationType: "hq" });
    expect((await request(await buildApp({ ...TC_HEALTH })).get("/plans/42")).status).toBe(200);
  });

  it("PLAN-W1-SEC-09: list TC predicate is exclusive precedence — a stale legacy sector cannot leak a plan", async () => {
    // Canonical sectors = ['Health']; stale legacy sector = 'Education'. An Education
    // TC must NOT see this plan: the list predicate must be membership against the
    // effective-sectors CASE, never an OR with the legacy/project sector fallback.
    const captured: string[] = [];
    mockPoolQuery.mockImplementation((sql: string) => {
      captured.push(sql);
      return Promise.resolve({ rows: [] });
    });
    const res = await request(await buildApp({ ...TC_EDUC })).get("/plans");
    expect(res.status).toBe(200);
    const listSql = captured.find((s) => s.includes("ORDER BY pl.created_at DESC"));
    expect(listSql).toBeDefined();
    expect(listSql).toContain("jsonb_array_length(COALESCE(pl.sectors"); // precedence CASE present
    expect(listSql).not.toMatch(/OR\s+COALESCE\(NULLIF\(pl\.sector/);    // no legacy OR-leak
  });

  it("PLAN-W1-SEC-10: dashboard TC predicate and bySector grouping use exclusive precedence", async () => {
    const captured: string[] = [];
    mockPoolQuery.mockImplementation((sql: string) => {
      captured.push(sql);
      return Promise.resolve({ rows: [] });
    });
    const res = await request(await buildApp({ ...TC_EDUC })).get("/plans/dashboard");
    expect(res.status).toBe(200);
    const scoped = captured.filter((s) => s.includes("= ANY($1::text[])"));
    expect(scoped.length).toBeGreaterThan(0);
    for (const sql of scoped) {
      expect(sql).toContain("jsonb_array_length(COALESCE(pl.sectors"); // precedence CASE
      expect(sql).not.toMatch(/OR\s+COALESCE\(NULLIF\(pl\.sector/);    // no legacy OR-leak
    }
    // bySector grouping groups by the FIRST effective sector, not the legacy COALESCE
    const bySectorSql = captured.find((s) => s.includes("'Unspecified'"));
    expect(bySectorSql).toBeDefined();
    expect(bySectorSql).toContain("->> 0");
    expect(bySectorSql).not.toContain("COALESCE(NULLIF(pl.sector,''), p.sector, 'Unspecified')");
  });

  it("PLAN-W1-SEC-11: sector-only PATCH on a multi-sector plan is rejected (legacy column cannot desync)", async () => {
    setupPlanReads({ sectors: ["Health", "Education"] });
    const res = await request(await buildApp({ ...PM_USER }))
      .patch("/plans/42")
      .send({ sector: "Education" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("sector_conflicts_with_sectors");
  });

  it("PLAN-W1-SEC-12: in-scope TC cannot PATCH a plan to only out-of-scope sectors — rolled back inside the transaction", async () => {
    // Health TC is authorised on the current plan (sectors ['Health']) but attempts
    // to move it wholly into Education. The in-transaction re-guard must 403 and
    // ROLLBACK — the unauthorised sector change is never committed.
    setupPlanReads({ sectors: ["Health"] });
    const txCalls: string[] = [];
    let updated = false;
    const client = {
      query: vi.fn(async (sql: string) => {
        txCalls.push(sql);
        if (sql.includes("UPDATE plans")) { updated = true; return { rows: [{ id: 42 }], rowCount: 1 }; }
        if (sql.includes("FROM plans WHERE id") && sql.includes("FOR UPDATE")) {
          return { rows: [{ status: "draft", start_date: null, end_date: null, title: "T", responsible_user_id: null, lastFinalApprovedAt: null }] };
        }
        // In-transaction getPlanMeta after the UPDATE reflects the proposed sectors
        if (sql.includes("location_type") && sql.includes("LEFT JOIN projects")) {
          return { rows: [{ sector: updated ? "Education" : "Health", sectors: updated ? ["Education"] : ["Health"], stateId: null, locationType: "hq" }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValueOnce(client);
    const res = await request(await buildApp({ ...TC_HEALTH }))
      .patch("/plans/42")
      .send({ sectors: ["Education"] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
    expect(txCalls.some((s) => s.includes("ROLLBACK"))).toBe(true);
    expect(txCalls.some((s) => s.trim().startsWith("COMMIT"))).toBe(false);
  });

  it("PLAN-W1-SEC-13: consistent paired sector/sectors PATCH emits exactly one sector assignment (no SQL error)", async () => {
    setupPlanReads({ sectors: ["Health"] });
    const txCalls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        txCalls.push(sql);
        if (sql.includes("UPDATE plans")) return { rows: [{ id: 42 }], rowCount: 1 };
        if (sql.includes("FROM plans WHERE id") && sql.includes("FOR UPDATE")) {
          return { rows: [{ status: "draft", start_date: null, end_date: null, title: "T", responsible_user_id: null, lastFinalApprovedAt: null }] };
        }
        if (sql.includes("location_type") && sql.includes("LEFT JOIN projects")) {
          return { rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValueOnce(client);
    const res = await request(await buildApp({ ...PM_USER }))
      .patch("/plans/42")
      .send({ sector: "Health", sectors: ["Health"] });
    expect(res.status).toBe(200);
    const updateSql = txCalls.find((s) => s.includes("UPDATE plans"));
    expect(updateSql).toBeDefined();
    // Exactly one legacy `sector =` assignment (excluding `sectors =`)
    const sectorAssignments = (updateSql!.match(/(?<!s)sector\s*=/g) ?? []).length;
    expect(sectorAssignments).toBe(1);
    expect(updateSql).toContain("sectors =");
    expect(txCalls.some((s) => s.trim().startsWith("COMMIT"))).toBe(true);
  });

  it("PLAN-W1-SEC-14: conflicting paired sector/sectors PATCH is rejected with 422 before any mutation", async () => {
    setupPlanReads({ sectors: ["Health"] });
    const res = await request(await buildApp({ ...PM_USER }))
      .patch("/plans/42")
      .send({ sector: "Education", sectors: ["Health", "Education"] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("sector_conflicts_with_sectors");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-W1-CG: Completed-plan integrity gate (10)
// ─────────────────────────────────────────────────────────────────────────────
type ActRow = { status: string; progress_pct: number | null };

function setupCompleteTransition(
  activityRows: ActRow[],
  opts?: { lockedStatus?: string; fromStatus?: string },
) {
  const fromStatus = opts?.fromStatus ?? "active";
  const lockedStatus = opts?.lockedStatus ?? fromStatus;
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT status, sector")) return Promise.resolve({ rows: [{ status: fromStatus, sector: "Health", project_id: null, stateId: null }] });
    if (sql.includes("location_type") && sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
    }
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "completed" }] });
    return Promise.resolve({ rows: [] });
  });
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    calls,
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("FROM plans WHERE id = $1") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [{ status: lockedStatus }], rowCount: 1 });
      }
      if (sql.includes("FROM plan_activities")) {
        return Promise.resolve({ rows: activityRows, rowCount: activityRows.length });
      }
      return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

describe("PLAN-W1-CG: completed-plan integrity gate", () => {
  beforeEach(() => vi.clearAllMocks());
  const complete = { action: "complete" };

  it("PLAN-W1-CG-01: all activities completed at 100% → transition succeeds", async () => {
    const client = setupCompleteTransition([{ status: "completed", progress_pct: 100 }, { status: "completed", progress_pct: 100 }]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(200);
    expect(client.calls.some((c) => c.sql.includes("UPDATE plans SET status"))).toBe(true);
  });

  it("PLAN-W1-CG-02: one activity still planned → blocked", async () => {
    setupCompleteTransition([{ status: "completed", progress_pct: 100 }, { status: "planned", progress_pct: 0 }]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("PLAN-W1-CG-03: one activity in_progress → blocked", async () => {
    setupCompleteTransition([{ status: "in_progress", progress_pct: 60 }]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("PLAN-W1-CG-04: one activity delayed → blocked", async () => {
    setupCompleteTransition([{ status: "completed", progress_pct: 100 }, { status: "delayed", progress_pct: 90 }]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("PLAN-W1-CG-05: completed + cancelled mix → succeeds (cancelled excluded by SQL filter)", async () => {
    // The gate query filters cancelled rows in SQL — the mock returns only the
    // eligible rows, and we assert the filter is present in the issued SQL.
    const client = setupCompleteTransition([{ status: "completed", progress_pct: 100 }]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(200);
    const gateCall = client.calls.find((c) => c.sql.includes("FROM plan_activities"));
    expect(gateCall?.sql).toContain("status <> 'cancelled'");
  });

  it("PLAN-W1-CG-06: all activities cancelled → blocked (zero eligible rows)", async () => {
    setupCompleteTransition([]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("PLAN-W1-CG-07: zero activities → blocked", async () => {
    setupCompleteTransition([]);
    const res = await request(await buildApp({ ...SA_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("PLAN-W1-CG-08: activity completed but progress_pct < 100 → blocked", async () => {
    setupCompleteTransition([{ status: "completed", progress_pct: 80 }]);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("PLAN-W1-CG-09: race safety — plan locked FOR UPDATE before activities, activities locked FOR UPDATE, stale status → 409", async () => {
    const client = setupCompleteTransition([{ status: "completed", progress_pct: 100 }]);
    await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    const planLockIdx = client.calls.findIndex((c) => c.sql.includes("FROM plans WHERE id = $1") && c.sql.includes("FOR UPDATE"));
    const actIdx = client.calls.findIndex((c) => c.sql.includes("FROM plan_activities"));
    expect(planLockIdx).toBeGreaterThanOrEqual(0);
    expect(actIdx).toBeGreaterThan(planLockIdx);
    expect(client.calls[actIdx].sql).toContain("FOR UPDATE");
    // CAS UPDATE retains the status = expected predicate
    const cas = client.calls.find((c) => c.sql.includes("UPDATE plans SET status"));
    expect(cas?.sql).toMatch(/AND status = \$3/);

    // Concurrent transition already changed the locked status → 409 conflict
    vi.clearAllMocks();
    setupCompleteTransition([{ status: "completed", progress_pct: 100 }], { lockedStatus: "completed", fromStatus: "active" });
    const res = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_status_conflict");
  });

  it("PLAN-W1-CG-10: PM and super_admin cannot bypass the gate", async () => {
    setupCompleteTransition([{ status: "planned", progress_pct: 0 }]);
    const pmRes = await request(await buildApp({ ...PM_USER })).post("/plans/42/transitions").send(complete);
    expect(pmRes.status).toBe(409);
    expect(pmRes.body.error).toBe("plan_activities_incomplete");
    vi.clearAllMocks();
    setupCompleteTransition([{ status: "planned", progress_pct: 0 }]);
    const saRes = await request(await buildApp({ ...SA_USER })).post("/plans/42/transitions").send(complete);
    expect(saRes.status).toBe(409);
    expect(saRes.body.error).toBe("plan_activities_incomplete");
    // British English message
    expect(String(saRes.body.message)).toMatch(/cannot be marked as completed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-W1-CG-11: completion vs. activity-PATCH interleaving
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-W1-CG-11: activity PATCH cannot slip past a concurrent completion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("activity-only PATCH takes the parent plan lock and 409s when the locked status is completed", async () => {
    // Interleaving: the pre-transaction snapshot still says editable, but by the
    // time the PATCH acquires the plan-row FOR UPDATE lock a concurrent completion
    // transition has committed. The in-transaction re-check must reject the write
    // — no activity mutation reaches a completed plan.
    setupPlanReads({ sectors: ["Health"] }); // pre-tx snapshot: draft/editable
    const txCalls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        txCalls.push(sql);
        if (sql.includes("FROM plans WHERE id") && sql.includes("FOR UPDATE")) {
          // Locked row reflects the concurrent completion that already committed
          return { rows: [{ start_date: null, end_date: null, responsible_user_id: null, status: "completed", last_final_approved_at: null }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValueOnce(client);
    const res = await request(await buildApp({ ...PM_USER }))
      .patch("/plans/42")
      .send({ activities: [{ title: "Late activity", status: "planned", progressPct: 0 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_approval_locked");
    // The plan lock is taken BEFORE any activity read/write; nothing may be
    // written to plan_activities and the transaction must roll back.
    expect(txCalls.findIndex((s) => s.includes("FROM plans WHERE id") && s.includes("FOR UPDATE"))).toBeGreaterThanOrEqual(0);
    expect(txCalls.some((s) => s.includes("INSERT INTO plan_activities") || s.includes("UPDATE plan_activities"))).toBe(false);
    expect(txCalls.some((s) => s.includes("ROLLBACK"))).toBe(true);
    expect(txCalls.some((s) => s.trim().startsWith("COMMIT"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-W1-PP: progressPct nullability contract (5)
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-W1-PP: progressPct contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-W1-PP-01: plan with no activities returns progressPct null", async () => {
    setupPlanReads({ sectors: ["Health"], progressPct: null });
    const res = await request(await buildApp({ ...PM_USER })).get("/plans/42");
    expect(res.status).toBe(200);
    expect(res.body.progressPct).toBeNull();
  });

  it("PLAN-W1-PP-02: all-cancelled plan returns null — summary SQL excludes cancelled from AVG", async () => {
    setupPlanReads({ sectors: ["Health"], progressPct: null });
    const res = await request(await buildApp({ ...PM_USER })).get("/plans/42");
    expect(res.body.progressPct).toBeNull();
    // The summary select's AVG aggregate must exclude cancelled activities (PLAN-BD-4).
    // PLAN-015 (Wave 2): the aggregate lives in the pa_agg pre-aggregated LEFT JOIN.
    const summaryCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("pa_agg"));
    expect(summaryCall).toBeDefined();
    expect(String(summaryCall![0])).toContain("AVG(CASE WHEN status <> 'cancelled' THEN progress_pct END)");
  });

  it("PLAN-W1-PP-03: plan with one active activity returns a number", async () => {
    setupPlanReads({ sectors: ["Health"], progressPct: 40 });
    const res = await request(await buildApp({ ...PM_USER })).get("/plans/42");
    expect(res.body.progressPct).toBe(40);
  });

  it("PLAN-W1-PP-04: mixed activities → rounded average passed through unchanged", async () => {
    setupPlanReads({ sectors: ["Health"], progressPct: 67 });
    const res = await request(await buildApp({ ...PM_USER })).get("/plans/42");
    expect(res.body.progressPct).toBe(67);
  });

  it("PLAN-W1-PP-05: generated schema accepts progressPct null (PlanSummary/PlanDetail nullable)", async () => {
    // The generated zod contract for the plans list must accept null progressPct.
    const listItem = (zodSchemas as Record<string, unknown>)["listPlansResponseItem"] as { safeParse: (v: unknown) => { success: boolean } } | undefined;
    const candidates = Object.entries(zodSchemas as Record<string, unknown>)
      .filter(([k]) => /plan/i.test(k) && /response/i.test(k));
    const schemasToCheck = listItem ? [listItem] : [];
    if (schemasToCheck.length === 0) {
      // Fallback: find any plans response schema exposing progressPct
      for (const [, v] of candidates) {
        const s = v as { safeParse?: (x: unknown) => { success: boolean } };
        if (typeof s?.safeParse === "function") { schemasToCheck.push(s as { safeParse: (x: unknown) => { success: boolean } }); break; }
      }
    }
    expect(schemasToCheck.length).toBeGreaterThan(0);
    const base = {
      id: 1, code: "C", title: "T", planType: "monthly", status: "draft",
      startDate: "2026-01-01", endDate: "2026-01-31",
      budgetPlanned: 0, budgetActual: 0, activitiesCount: 0,
      localities: [], sectors: [],
    };
    for (const s of schemasToCheck) {
      const withNull = s.safeParse({ ...base, progressPct: null });
      const withNumber = s.safeParse({ ...base, progressPct: 50 });
      expect(withNumber.success).toBe(true);
      expect(withNull.success).toBe(true); // number | null — null must not be rejected
    }
  });
});
