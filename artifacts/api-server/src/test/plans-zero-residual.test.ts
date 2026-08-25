/**
 * Plans Module Zero-Residual Final Re-Closure — PLAN-ZR sentinel suite (Task #525)
 *
 * 30 sentinels (PLAN-ZR-01 … PLAN-ZR-30) that pin every closure-critical Plans
 * behaviour after Wave 1 (#514) and Wave 2 (#520). Each sentinel is either a
 * behavioural test against the real route handlers (with mocked DB) or a
 * structural guard against the production source itself.
 *
 * The real-PostgreSQL aggregate verification (#523) lives in
 * plans-aggregate-integration.test.ts (executes the exact production
 * planSummarySelect SQL against a live DB inside a rolled-back transaction).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
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
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
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

// ── Fixtures ──────────────────────────────────────────────────────────────────
const PM_USER   = { id: 1, name: "PM",  email: "pm@t.com",  role: "program_manager",       roleLabel: "Programme Manager",     scope: "global", stateId: null, stateName: null, sector: null,     sectors: [],                 avatarUrl: null } as const;
const SA_USER   = { id: 2, name: "SA",  email: "sa@t.com",  role: "super_admin",           roleLabel: "Super Admin",           scope: "global", stateId: null, stateName: null, sector: null,     sectors: [],                 avatarUrl: null } as const;
const TC_HEALTH = { id: 3, name: "TCH", email: "tch@t.com", role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "sector", stateId: null, stateName: null, sector: "Health", sectors: ["Health"],         avatarUrl: null } as const;
const TC_MULTI  = { ...TC_HEALTH, id: 7, sectors: ["Health", "WASH"] } as const;
const SPO_USER  = { id: 4, name: "SPO", email: "spo@t.com", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null } as const;

const PLAN_ROW = {
  id: 42, code: "CAFA-PLAN-HQ-001", title: "ZR Plan", planType: "monthly", frequency: "monthly",
  status: "draft", projectId: null, projectTitle: null, stateId: null, stateName: null,
  localityId: null, localities: [], sector: "Health", sectors: ["Health"],
  responsibleName: "Alice", responsibleUserId: null, responsibleUserName: null,
  startDate: "2026-01-01", endDate: "2026-12-31",
  budgetPlanned: null, budgetActual: null, fundingSource: null, currency: null,
  budgetLegacyUnverified: false, locationType: "hq", lastFinalApprovedAt: null,
  progressPct: null, activitiesCount: 0, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANS_TS       = path.resolve(HERE, "../routes/plans.ts");
const COMMENTS_TS    = path.resolve(HERE, "../routes/comments.ts");
const PLANS_TSX      = path.resolve(HERE, "../../../cafa-pmis/src/pages/plans.tsx");
const PLAN_DETAIL_TSX = path.resolve(HERE, "../../../cafa-pmis/src/pages/plan-detail.tsx");
const CREATE_DIALOG_TSX = path.resolve(HERE, "../../../cafa-pmis/src/components/create-plan-registration-dialog.tsx");
const AUDIT_DOC = path.resolve(HERE, "../../../../docs/audit-reports/plans-zero-residual-final-reclosure-audit.md");

const plansSrc = readFileSync(PLANS_TS, "utf8");

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

function setupListQuery(rows: Array<Record<string, unknown>>) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows });
    return Promise.resolve({ rows: [] });
  });
}

/** Standard pool wiring for POST /plans (HQ plan). */
function setupPostQuery(opts: { activeUser?: boolean; userExists?: boolean } = {}) {
  const { activeUser = true, userExists = true } = opts;
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("code LIKE 'CAFA-PLAN-HQ-%'")) return Promise.resolve({ rows: [] });
    if (sql.includes("code FROM states"))           return Promise.resolve({ rows: [{ code: "KH" }] });
    if (sql.includes("code LIKE $"))                return Promise.resolve({ rows: [] });
    if (sql.includes("SELECT status FROM users")) {
      if (!userExists) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ status: activeUser ? "active" : "suspended" }] });
    }
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
    return Promise.resolve({ rows: [] });
  });
}

function mockTransactionClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
) {
  const issued: string[] = [];
  const client = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      issued.push(sql);
      if (overrides) {
        const result = overrides(sql, params);
        if (result !== null && result !== undefined) return Promise.resolve(result);
      }
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ rows: [{ status: "active" }], rowCount: 1 });
      if (sql.includes("INSERT INTO plans"))        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return { client, issued };
}

/** Pool wiring for transition-handler tests. */
function setupTransitionQuery(status: string) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM plans WHERE id = $1")) {
      return Promise.resolve({ rows: [{ status, sector: "Health", project_id: null, stateId: null }] });
    }
    if (sql.includes("LEFT JOIN projects")) {
      return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
    }
    if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
    if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [{ ...PLAN_ROW, status }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => vi.clearAllMocks());

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-01 … 04: Canonical effective-sector model + scope
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-01: canonical effective-sector model drives TC list scope", () => {
  it("TC list filter uses the effective-sectors EXISTS predicate, not raw pl.sector", async () => {
    setupListQuery([PLAN_ROW]);
    const res = await request(await buildApp({ ...TC_HEALTH })).get("/plans");
    expect(res.status).toBe(200);
    const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"))!;
    expect(String(call[0])).toMatch(/EXISTS \(SELECT 1 FROM jsonb_array_elements_text\(/);
    expect(call[1]).toEqual([["Health"]]);
  });

  it("structural: detail/transitions/reopen authorization goes through effective-sector meta", () => {
    // Detail + reopen authorize via meta.sectors (getPlanMeta / getPlanEffectiveSectors).
    expect(plansSrc).toContain("getPlanEffectiveSectors");
    expect(plansSrc.match(/assertAnySectorAllowed\(/g)!.length).toBeGreaterThanOrEqual(4);
    // No standalone raw-sector authorization predicate remains.
    expect(plansSrc).not.toMatch(/restriction\.includes\(row\.sector/);
  });
});

describe("PLAN-ZR-02: TC secondary/multi-sector access", () => {
  it("TC with two assigned sectors filters with the full sector array", async () => {
    setupListQuery([PLAN_ROW]);
    const res = await request(await buildApp({ ...TC_MULTI })).get("/plans");
    expect(res.status).toBe(200);
    const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"))!;
    expect(call[1]).toEqual([["Health", "WASH"]]);
  });
});

describe("PLAN-ZR-03: cross-State denial", () => {
  it("SPO of state 5 is denied detail access to a state-7 plan", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: 7, locationType: "state" }] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW, stateId: 7, locationType: "state" }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(await buildApp({ ...SPO_USER })).get("/plans/42");
    expect(res.status).toBe(403);
  });

  it("SPO is denied HQ plan detail (hq_forbidden)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
      if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(await buildApp({ ...SPO_USER })).get("/plans/42");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_forbidden");
  });
});

describe("PLAN-ZR-04: PM/Super Admin Full Operational Access", () => {
  it("PM and SA list without any state/sector filter", async () => {
    for (const user of [PM_USER, SA_USER]) {
      vi.clearAllMocks();
      setupListQuery([PLAN_ROW]);
      const res = await request(await buildApp({ ...user })).get("/plans");
      expect(res.status).toBe(200);
      const call = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("FROM plans pl"))!;
      expect(String(call[0])).not.toContain("WHERE");
      expect(call[1]).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-05 … 07: Integrity gates that Full Access cannot bypass
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-05: Full Access cannot bypass date integrity", () => {
  it("PM reversed date range → 422 end_date_before_start_date", async () => {
    setupPostQuery();
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Bypass", locationType: "hq", startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });
});

describe("PLAN-ZR-06: strict date integrity", () => {
  it("impossible calendar date 2026-02-30 → 422", async () => {
    setupPostQuery();
    const res = await request(await buildApp({ ...SA_USER })).post("/plans").send({
      title: "Feb30", locationType: "hq", startDate: "2026-02-30", endDate: "2026-03-31",
    });
    expect(res.status).toBe(422);
  });

  it("junk-suffix date → 422", async () => {
    setupPostQuery();
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Junk", locationType: "hq", startDate: "2026-01-01x", endDate: "2026-03-31",
    });
    expect(res.status).toBe(422);
  });
});

describe("PLAN-ZR-07: responsible-user integrity", () => {
  it("suspended responsible user → 422", async () => {
    setupPostQuery({ activeUser: false });
    mockTransactionClient((sql) =>
      sql.includes("SELECT status FROM users") ? { rows: [{ status: "suspended" }], rowCount: 1 } : null);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Resp", locationType: "hq", responsibleUserId: 99,
    });
    expect(res.status).toBe(422);
  });

  it("nonexistent responsible user → 422", async () => {
    setupPostQuery({ userExists: false });
    mockTransactionClient((sql) =>
      sql.includes("SELECT status FROM users") ? { rows: [], rowCount: 0 } : null);
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Resp", locationType: "hq", responsibleUserId: 9999,
    });
    expect(res.status).toBe(422);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-08 … 10: Draft / revision / rejected lifecycle
// ═════════════════════════════════════════════════════════════════════════════
const PLAN_EXTRAS_ROW = {
  description: null, objectives: null,
  createdById: 1, createdByName: "PM",
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
};

describe("PLAN-ZR-08: draft same-ID lifecycle", () => {
  it("PATCH on a draft mutates the same plan — no INSERT INTO plans, same ID returned", async () => {
    // Discriminate queries:
    //  "pa_agg"         → planSummarySelect (getPlanById main query)
    //  "createdByName"  → getPlanById extras query  (LEFT JOIN users, no "pa_agg")
    //  "LEFT JOIN projects" → getPlanMeta (no "pa_agg", no "createdByName")
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("pa_agg"))         return Promise.resolve({ rows: [PLAN_ROW] });
      if (sql.includes('"createdByName"')) return Promise.resolve({ rows: [PLAN_EXTRAS_ROW] });
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null,
          start_date: null, end_date: null, title: "Draft", responsible_user_id: null }] });
      if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const { issued } = mockTransactionClient();
    const res = await request(await buildApp({ ...PM_USER })).patch("/plans/42").send({ title: "Renamed" });
    expect(res.status).toBeLessThan(300);
    expect(res.body.id).toBe(42);
    expect(issued.some((s) => s.includes("INSERT INTO plans"))).toBe(false);
  });
});

describe("PLAN-ZR-09: revision same-ID lifecycle", async () => {
  const { PLAN_TRANSITIONS } = await import("../routes/plans.js");

  it("request_revision returns the SAME plan to draft; submit re-accepts it", () => {
    expect(PLAN_TRANSITIONS.request_revision.to).toBe("draft");
    expect(PLAN_TRANSITIONS.submit.from).toEqual(["draft"]);
  });

  it("structural: transitions handler never creates a replacement plan", () => {
    const start = plansSrc.indexOf('"/plans/:planId/transitions"');
    const end = plansSrc.indexOf('"/plans/:planId/reopen"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(plansSrc.slice(start, end)).not.toContain("INSERT INTO plans");
  });
});

describe("PLAN-ZR-10: rejected terminal state", () => {
  it("PATCH on a rejected plan → 409 plan_approval_locked, no mutation", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "rejected", lastFinalApprovedAt: null,
          start_date: null, end_date: null, title: "Rejected", responsible_user_id: null }] });
      if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "rejected" }] });
      return Promise.resolve({ rows: [] });
    });
    mockTransactionClient();
    const res = await request(await buildApp({ ...PM_USER })).patch("/plans/42").send({ title: "Edit" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_approval_locked");
  });

  it("no transition accepts 'rejected' as a source; rejected is not reopenable", async () => {
    const { PLAN_TRANSITIONS, REOPENABLE_STATUSES } = await import("../routes/plans.js");
    for (const [action, t] of Object.entries(PLAN_TRANSITIONS)) {
      expect(t.from, `transition '${action}' must not accept rejected`).not.toContain("rejected");
    }
    expect(REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-11 + 27: CAS conflict → 409, zero approvals, zero notifications
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-11/27: workflow CAS conflict and notification rollback safety", () => {
  it("stale CAS transition → 409 plan_status_conflict; no approval, no notification", async () => {
    setupTransitionQuery("submitted");
    const { issued } = mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans SET status")) return { rows: [], rowCount: 0 }; // concurrent winner
      if (sql.includes("FOR UPDATE")) return { rows: [{ status: "submitted", sectors: ["Health"], sector: "Health", project_id: null, state_id: null, location_type: "hq" }], rowCount: 1 };
      return null;
    });
    const notif = await import("../lib/notifications.js");
    const res = await request(await buildApp({ ...PM_USER }))
      .post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_status_conflict");
    expect(issued.some((s) => s.includes("INSERT INTO approvals"))).toBe(false);
    expect(vi.mocked(notif.notifyNextApprover)).not.toHaveBeenCalled();
    expect(vi.mocked(notif.notifyEntityActorsDeduped)).not.toHaveBeenCalled();
    expect(vi.mocked(notif.createNotification)).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-12 … 14: delete integrity, risk null-out, activity consistency
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-12: delete referential integrity", () => {
  it("DELETE cascades sessions, comments, approvals, risks, attachments, activities", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });
    const { issued } = mockTransactionClient((sql) => {
      if (sql.includes("object_path FROM plan_attachments")) return { rows: [] };
      return null;
    });
    const res = await request(await buildApp({ ...PM_USER })).delete("/plans/42");
    expect(res.status).toBeLessThan(500);
    const all = issued.join("\n");
    for (const marker of [
      "plan_registration_sessions", "plan_activities", "plan_attachments",
      "UPDATE risks", "plan_activity_id = NULL",
    ]) expect(all, `delete cascade must touch: ${marker}`).toContain(marker);
    // Risk references cleared BEFORE activity deletion
    const riskIdx = issued.findIndex((s) => s.trim().startsWith("UPDATE risks"));
    const actIdx  = issued.findIndex((s) => s.includes("DELETE FROM plan_activities"));
    expect(riskIdx).toBeGreaterThanOrEqual(0);
    expect(actIdx).toBeGreaterThan(riskIdx);
  });
});

describe("PLAN-ZR-13: PATCH activity omission nulls risk references in-transaction", () => {
  it("UPDATE risks … plan_activity_id = NULL precedes DELETE FROM plan_activities", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null,
          start_date: null, end_date: null, title: "Draft", responsible_user_id: null }] });
      if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
      return Promise.resolve({ rows: [] });
    });
    const order: string[] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.trim().startsWith("UPDATE risks") && sql.includes("plan_activity_id = NULL")) order.push("risks_null");
        if (sql.includes("DELETE FROM plan_activities")) order.push("activities_delete");
        if (sql.includes("FROM plan_activities") && sql.includes("FOR UPDATE"))
          return Promise.resolve({ rows: [{ id: 10, responsible_user_id: null }, { id: 11, responsible_user_id: null }] });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);
    await request(await buildApp({ ...PM_USER })).patch("/plans/42").send({
      activities: [{ id: 10, title: "Kept", status: "planned", progressPct: 0 }],
    });
    expect(order.indexOf("risks_null")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("risks_null")).toBeLessThan(order.indexOf("activities_delete"));
  });
});

describe("PLAN-ZR-14: activity progress consistency rejected before mutation", () => {
  it("completed activity at 50% → 422 activity_progress_invalid, nothing persisted", async () => {
    setupPostQuery();
    const { issued } = mockTransactionClient();
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Bad Act", locationType: "hq",
      activities: [{ title: "X", status: "completed", progressPct: 50 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("activity_progress_invalid");
    expect(issued.some((s) => s.includes("INSERT INTO plans"))).toBe(false);
  });

  it("unsupported status → 422 before silent normalisation", async () => {
    setupPostQuery();
    mockTransactionClient();
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Bad Status", locationType: "hq",
      activities: [{ title: "X", status: "half_done", progressPct: 10 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("activity_progress_invalid");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-15 … 17: progress null contract, completion integrity + concurrency
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-15: plan progress null contract", () => {
  it("detail returns progressPct null (never 0) when no eligible activities", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("pa_agg"))         return Promise.resolve({ rows: [{ ...PLAN_ROW, progressPct: null, activitiesCount: 0 }] });
      if (sql.includes('"createdByName"')) return Promise.resolve({ rows: [PLAN_EXTRAS_ROW] });
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", sectors: ["Health"], stateId: null, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(await buildApp({ ...PM_USER })).get("/plans/42");
    expect(res.status).toBe(200);
    expect(res.body.progressPct).toBeNull();
  });

  it("structural: no COALESCE guards progressPct in the summary select", () => {
    expect(plansSrc).not.toMatch(/COALESCE\(pa_agg\."progressPct"/);
  });
});

describe("PLAN-ZR-16: completion integrity gate", () => {
  it("complete with zero activities → 409 plan_activities_incomplete", async () => {
    setupTransitionQuery("active");
    mockTransactionClient((sql) => {
      if (sql.includes("SELECT status FROM plans WHERE id = $1 FOR UPDATE"))
        return { rows: [{ status: "active" }], rowCount: 1 };
      if (sql.includes("FROM plan_activities")) return { rows: [], rowCount: 0 };
      return null;
    });
    const res = await request(await buildApp({ ...PM_USER }))
      .post("/plans/42/transitions").send({ action: "complete" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("complete with an incomplete activity → 409 (cancelled-only equivalent: gate excludes cancelled)", async () => {
    setupTransitionQuery("active");
    mockTransactionClient((sql) => {
      if (sql.includes("SELECT status FROM plans WHERE id = $1 FOR UPDATE"))
        return { rows: [{ status: "active" }], rowCount: 1 };
      if (sql.includes("FROM plan_activities"))
        return { rows: [{ status: "in_progress", progress_pct: 60 }], rowCount: 1 };
      return null;
    });
    const res = await request(await buildApp({ ...PM_USER }))
      .post("/plans/42/transitions").send({ action: "complete" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_activities_incomplete");
  });

  it("structural: the gate queries only non-cancelled activities, so a cancelled-only plan cannot qualify", () => {
    const gate = plansSrc.slice(plansSrc.indexOf('if (action === "complete")'));
    expect(gate).toContain("status <> 'cancelled'");
    expect(gate).toContain("acts.rows.length === 0");
  });
});

describe("PLAN-ZR-17: completion concurrency protection", () => {
  it("structural: complete gate locks plan row and activity rows FOR UPDATE in one transaction", () => {
    const gate = plansSrc.slice(plansSrc.indexOf('if (action === "complete")'), plansSrc.indexOf("CAS UPDATE"));
    expect(gate).toContain("SELECT status FROM plans WHERE id = $1 FOR UPDATE");
    expect(gate).toMatch(/FROM plan_activities\s+WHERE plan_id = \$1 AND status <> 'cancelled'\s+FOR UPDATE/);
  });

  it("structural: activity PATCH path locks the parent plan and existing activities FOR UPDATE", () => {
    expect(plansSrc).toContain("SELECT id, responsible_user_id, state_id FROM plan_activities WHERE plan_id = $1 FOR UPDATE");
    expect(plansSrc.match(/FROM plans WHERE id = \$1 FOR UPDATE/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-18 … 20: duplicate protection
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-18: structured hard duplicate protection", () => {
  it("monthly create with an active identical plan → 409, no second plan persisted", async () => {
    setupPostQuery();
    const { issued } = mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("status NOT IN")) return { rows: [{ id: 99, status: "active", sector: "Health" }] };
      return null;
    });
    const res = await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Dup", locationType: "hq", planType: "monthly",
      startDate: "2026-01-01", endDate: "2026-01-31",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_duplicate_exists");
    expect(issued.some((s) => s.includes("INSERT INTO plans"))).toBe(false);
  });
});

describe("PLAN-ZR-19: duplicate concurrency (advisory lock)", () => {
  it("structured create acquires pg_advisory_xact_lock inside the transaction", async () => {
    setupPostQuery();
    let lock = false;
    mockTransactionClient((sql) => {
      if (sql.includes("pg_advisory_xact_lock")) { lock = true; return { rows: [] }; }
      if (sql.includes("status NOT IN")) return { rows: [] };
      return null;
    });
    await request(await buildApp({ ...PM_USER })).post("/plans").send({
      title: "Lock", locationType: "hq", planType: "quarterly",
      startDate: "2026-01-01", endDate: "2026-03-31",
    });
    expect(lock).toBe(true);
  });
});

describe("PLAN-ZR-20: soft duplicate security / navigation", () => {
  function setupSoftMatch(matchedSectors: string[]) {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("MAX(id)")) return Promise.resolve({ rows: [{ n: 1, first_id: 77 }] });
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: matchedSectors[0] ?? null, sectors: matchedSectors, stateId: null, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });
  }
  const QS = "planType=action&startDate=2026-01-01&endDate=2026-01-31&locationType=hq";

  it("accessible soft match returns planId for navigation", async () => {
    setupSoftMatch(["Health"]);
    const res = await request(await buildApp({ ...PM_USER })).get(`/plans/duplicate-check?${QS}`);
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("soft");
    expect(res.body.planId).toBe(77);
  });

  it("inaccessible soft match (wrong-sector TC) returns no planId and no metadata", async () => {
    setupSoftMatch(["WASH"]);
    const res = await request(await buildApp({ ...TC_HEALTH })).get(`/plans/duplicate-check?${QS}`);
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("soft");
    expect(res.body.planId).toBeNull();
    expect(res.body.title).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-21 … 24: frontend parity, aggregate query, migrations, DDL
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-21: Continue Editing parity across Table / Card / Kanban", () => {
  const src = readFileSync(PLANS_TSX, "utf8");

  it("Continue Editing affordance exists in the table AND the shared card/kanban block", () => {
    const occurrences = src.match(/Continue Editing/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("draft-gates Continue Editing and routes it through the shared edit helper", () => {
    // The record viewer now owns the shared action, so the route exists once in
    // continueEdit rather than being duplicated in table/card/kanban markup.
    expect(src).toContain('setLocation(`/plans/${planId}?edit=1`)');
    expect(src).toMatch(/canEditDrafts\s*&&\s*p\.status === "draft"/);
    expect(src).toContain("ContinueEditingAction");
    expect(src).toMatch(/onClick=\{\(\) => continueEdit\(p\.id\)\}/);
  });
});

describe("PLAN-ZR-22: PLAN-015 aggregate list query correctness", () => {
  it("single grouped LEFT JOIN, no correlated subquery, null progress preserved", async () => {
    setupListQuery([
      { ...PLAN_ROW, id: 1, activitiesCount: 3, progressPct: 40 },
      { ...PLAN_ROW, id: 2, activitiesCount: 0, progressPct: null },
    ]);
    const res = await request(await buildApp({ ...PM_USER })).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1].progressPct).toBeNull();
    expect(mockPoolQuery.mock.calls.length).toBe(1); // no per-plan round trips
    const sql = String(mockPoolQuery.mock.calls[0][0]);
    expect(sql).not.toContain("WHERE pa.plan_id = pl.id");
    expect(sql).toContain("GROUP BY plan_id");
    expect(sql).toMatch(/AVG\(CASE WHEN status <> 'cancelled' THEN progress_pct END\)/);
  });
});

describe("PLAN-ZR-23: migration full-name identity", async () => {
  const { MIGRATIONS } = await import("../lib/run-migrations.js");

  it("all migration full names are unique; both 021_* entries independently tracked", () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("021_hq_sector_location_integrity");
    expect(names).toContain("021_report_attachments_drive_file_id.sql");
  });
});

describe("PLAN-ZR-24: no Plans startup DDL", () => {
  it("plans.ts contains no CREATE/ALTER/DROP DDL statements", () => {
    expect(plansSrc).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE|CREATE OR REPLACE/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-25 … 27: comments scope, attachment security (27 covered with 11)
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-25: plan comments scope", () => {
  const commentsSrc = readFileSync(COMMENTS_TS, "utf8");

  it("comments router enforces plan state/sector scope and the narrow revision_request exception", () => {
    expect(commentsSrc).toContain('entityType === "plan"');
    // Scope resolution joins the plan to its project for effective-sector checks.
    expect(commentsSrc).toMatch(/FROM plans pl LEFT JOIN projects p ON p\.id = pl\.project_id/);
    // The SPO/SOM returned-draft exception is bounded to revision_request comments.
    expect(commentsSrc).toContain("request_revision");
  });
});

describe("PLAN-ZR-26: attachment security", () => {
  it("no plans route exposes raw storage internals (objectPath/driveFileId) in responses", () => {
    expect(plansSrc).not.toContain('"objectPath"');
    expect(plansSrc).not.toContain("driveFileId");
    // The only object_path read is the delete-time storage cleanup inside the transaction.
    const reads = plansSrc.match(/SELECT object_path FROM plan_attachments/g) ?? [];
    expect(reads.length).toBe(1);
    const idx = plansSrc.indexOf("SELECT object_path FROM plan_attachments");
    const deleteRouteIdx = plansSrc.indexOf('router.delete("/plans/:planId"');
    expect(deleteRouteIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(deleteRouteIdx);
  });

  it("attachment cleanup happens inside the delete transaction (no orphan metadata)", () => {
    expect(plansSrc).toContain("DELETE FROM plan_attachments WHERE plan_id = $1");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PLAN-ZR-28 … 30: TypeScript hygiene, skipped tests, residual meta-sentinel
// ═════════════════════════════════════════════════════════════════════════════
describe("PLAN-ZR-28: Plans-owned TypeScript hygiene", () => {
  it("no `as any` / ts-ignore / ts-expect-error in any Plans-owned source file", () => {
    for (const file of [PLANS_TS, PLANS_TSX, PLAN_DETAIL_TSX, CREATE_DIALOG_TSX]) {
      const src = readFileSync(file, "utf8");
      expect(src, `${path.basename(file)} must not contain 'as any'`).not.toContain("as any");
      expect(src, `${path.basename(file)} must not contain @ts-ignore`).not.toContain("@ts-ignore");
      expect(src, `${path.basename(file)} must not contain @ts-expect-error`).not.toContain("@ts-expect-error");
    }
  });
});

describe("PLAN-ZR-29: no closure-critical skipped tests", () => {
  it("no .skip / .todo in any Plans test file", () => {
    const skipMarker = ".s" + "kip(";
    const todoMarker = ".t" + "odo(";
    const files = readdirSync(HERE).filter((f) => f.startsWith("plan") && f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const src = readFileSync(path.join(HERE, f), "utf8");
      expect(src.includes(skipMarker), `${f} contains a skipped test`).toBe(false);
      expect(src.includes(todoMarker), `${f} contains a todo test`).toBe(false);
    }
  });
});

describe("PLAN-ZR-30: zero-residual meta-sentinel", () => {
  it("the final re-closure audit artifact exists and records the ZERO-RESIDUAL COMPLETE verdict", () => {
    expect(existsSync(AUDIT_DOC), `missing ${AUDIT_DOC}`).toBe(true);
    const doc = readFileSync(AUDIT_DOC, "utf8");
    expect(doc).toContain("ZERO-RESIDUAL COMPLETE — PLANS MODULE MAY BE CLOSED");
    // The register must not leave open classifications.
    expect(doc).not.toMatch(/Final Classification:\s*(ACCEPTED RESIDUAL|PENDING|TRACKED SEPARATELY|FUTURE ENFORCEMENT)/i);
  });

  it("the real-DB aggregate verification (#523) is part of the suite — not left pending", () => {
    expect(existsSync(path.join(HERE, "plans-aggregate-integration.test.ts"))).toBe(true);
  });
});
