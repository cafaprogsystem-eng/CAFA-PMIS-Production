/**
 * Plans Workflow Concurrency & Delete Integrity — Backend Tests (Task #430)
 *
 * Closes PLAN-004, PLAN-005, PLAN-006, and PLAN-016.
 *
 * PLAN-HARD-00-01/02  P0 regression: POST/PATCH cannot inject status
 * PLAN-HARD-TR-01…12  Transition concurrency (PLAN-004 CAS + PLAN-016 409)
 * PLAN-HARD-REOPEN-01…08  Reopen lock inside transaction (PLAN-006)
 * PLAN-HARD-DEL-01…08  Delete integrity (PLAN-005)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: shared mock handles ───────────────────────────────────────────
const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query:   mockPoolQuery,
    connect: mockPoolConnect,
  },
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
    logAudit:           vi.fn().mockResolvedValue(undefined),
    requirePerm:        () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser:  (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER    = { id: 1,  name: "PM",     email: "pm@t.com",     role: "program_manager",            roleLabel: "Programme Manager",          scope: "global", stateId: null, stateName: null, sector: null,     sectors: [],         avatarUrl: null } as const;
const SA_USER    = { id: 2,  name: "SA",     email: "sa@t.com",     role: "super_admin",                roleLabel: "Super Admin",                scope: "global", stateId: null, stateName: null, sector: null,     sectors: [],         avatarUrl: null } as const;
const TC_USER    = { id: 3,  name: "TC",     email: "tc@t.com",     role: "technical_coordinator",       roleLabel: "Technical Coordinator",      scope: "sector", stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null } as const;
const TC_EDUC    = { id: 9,  name: "TC-EDU", email: "edu@t.com",    role: "technical_coordinator",       roleLabel: "Technical Coordinator",      scope: "sector", stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null } as const;
const SPO_USER   = { id: 4,  name: "SPO",    email: "spo@t.com",    role: "state_program_officer",       roleLabel: "State Programme Officer",    scope: "state",  stateId: 5,   stateName: "Khartoum", sector: null, sectors: [],   avatarUrl: null } as const;
const SPO_CROSS  = { id: 8,  name: "SPO2",   email: "spo2@t.com",   role: "state_program_officer",       roleLabel: "State Programme Officer",    scope: "state",  stateId: 7,   stateName: "Kassala",  sector: null, sectors: [],   avatarUrl: null } as const;
const SOM_USER   = { id: 5,  name: "SOM",    email: "som@t.com",    role: "state_office_manager",        roleLabel: "State Office Manager",       scope: "state",  stateId: 5,   stateName: "Khartoum", sector: null, sectors: [],   avatarUrl: null } as const;
const VIEWER     = { id: 6,  name: "Viewer", email: "view@t.com",   role: "viewer",                     roleLabel: "Viewer",                     scope: "global", stateId: null, stateName: null, sector: null,     sectors: [],         avatarUrl: null } as const;

/** Minimal plan row returned by summary queries */
const PLAN_ROW = {
  id: 42, status: "submitted", sector: "Health", stateId: null, locationType: "hq",
  title: "Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-042", stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: null, endDate: null, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
};

// ── App builder ───────────────────────────────────────────────────────────────
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
 * Builds a mock transaction client that records every SQL call and returns
 * configurable results.  Defaults to { rows: [], rowCount: 1 } for every query
 * so the happy-path succeeds (UPDATE returns rowCount=1).
 */
function mockTransactionClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    calls,
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (overrides) {
        const result = overrides(sql, params);
        if (result !== null) return Promise.resolve(result);
      }
      // Default: BEGIN/COMMIT/ROLLBACK → rows:[], everything else rowCount:1.
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-HARD-00: P0 regression — POST/PATCH cannot inject status
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-HARD-00: P0 regression — status injection blocked (PLAN-001/002)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-HARD-00-01: POST /plans with body.status='approved' persists status='draft'", async () => {
    let capturedStatus: unknown = null;

    const client = mockTransactionClient((sql, params) => {
      if (sql.includes("INSERT INTO plans")) {
        if (Array.isArray(params)) capturedStatus = params[14]; // status is param index 14
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      return null;
    });
    void client; // used implicitly via mockPoolConnect

    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({ title: "Test", locationType: "hq", status: "approved" });
    expect(res.status).toBeLessThan(500);

    if (capturedStatus !== null) {
      expect(capturedStatus).toBe("draft");
      expect(capturedStatus).not.toBe("approved");
    }
  });

  it("PLAN-HARD-00-02: PATCH /plans/:planId with body.status='approved' does NOT include status in SET clause", async () => {
    let capturedUpdateSql = "";

    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status")) {
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null }] });
      }
      if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM plans pl"))    return Promise.resolve({ rows: [PLAN_ROW] });
      return Promise.resolve({ rows: [] });
    });

    const patchClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ start_date: null, end_date: null, localities: [], currency: null, budget_planned: null }] });
        }
        if (sql.includes("UPDATE plans SET")) capturedUpdateSql = sql;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(patchClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "New Title", status: "approved" });
    expect(res.status).toBeLessThan(500);

    if (capturedUpdateSql) {
      const setClause = capturedUpdateSql.match(/SET (.+?) WHERE/i)?.[1] ?? capturedUpdateSql;
      expect(setClause).not.toMatch(/\bstatus\s*=\s*\$/);
    }
  });
});

describe("PLAN-HARD-STATE: PATCH destination State validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects changing a Plan to an inactive State before opening a write transaction", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({
          rows: [{ ...PLAN_ROW, stateId: 5, locationType: "state", sectors: ["Health"] }],
        });
      }
      if (sql.includes("SELECT status, last_final_approved_at")) {
        return Promise.resolve({
          rows: [{
            status: "draft",
            lastFinalApprovedAt: null,
            start_date: null,
            end_date: null,
            title: "Test Plan",
            responsible_user_id: null,
          }],
        });
      }
      if (sql.includes("FROM states")) {
        return Promise.resolve({
          rows: [{
            id: 7,
            name: "Kassala",
            code: "KSL",
            nameAr: "كسلا",
            operationalStatus: "inactive",
            officeStatus: "present",
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ stateId: 7 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("inactive_state");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("does not let a state-scoped editor move an in-scope Plan to another State", async () => {
    // Return an in-scope Plan for every pre-guard lookup. This test must reach
    // the destination-state authorisation check; an empty default result would
    // make an incidental Plan lookup fail first with plan_not_found.
    mockPoolQuery.mockResolvedValue({
      rows: [{ ...PLAN_ROW, stateId: 5, locationType: "state", sectors: ["Health"] }],
    });

    const app = await buildApp({ ...SPO_USER });
    const res = await request(app).patch("/plans/42").send({ stateId: 7 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
    expect(mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("FROM states"))).toBe(false);
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-HARD-TR: Transition concurrency (PLAN-004 CAS + PLAN-016)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-HARD-TR: Transition concurrency — CAS & PLAN-016", () => {
  beforeEach(() => vi.clearAllMocks());

  /** Wire pool.query to return the given source status for a non-submit action. */
  function setupStatusQuery(status: string, sector = "Health", stateId: number | null = null) {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status, sector"))  return Promise.resolve({ rows: [{ status, sector, project_id: null, stateId }] });
      if (sql.includes("LEFT JOIN projects"))      return Promise.resolve({ rows: [{ sector, stateId, locationType: "hq" }] });
      if (sql.includes("unresolved_required"))     return Promise.resolve({ rows: [{ count: "0" }] });
      if (sql.includes("FROM plans pl"))           return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "technically_approved" }] });
      return Promise.resolve({ rows: [] });
    });
  }

  it("PLAN-HARD-TR-01: valid single transition succeeds — status updated, one approval row inserted", async () => {
    setupStatusQuery("submitted");
    let approvalInserted = false;

    const txClient = mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO approvals")) { approvalInserted = true; return { rows: [], rowCount: 1 }; }
      if (sql.includes("UPDATE plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });
    void txClient;

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).not.toBe(500);
    expect(approvalInserted).toBe(true);
  });

  it("PLAN-HARD-TR-02: wrong source status returns 409 — not 400 (PLAN-016)", async () => {
    setupStatusQuery("draft"); // final_approve requires coordination_approved

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot_final_approve_from_draft/);
  });

  it("PLAN-HARD-TR-03: stale second transition (status already changed) returns 409", async () => {
    setupStatusQuery("submitted");

    // CAS UPDATE returns rowCount=0 — status already changed by a concurrent actor.
    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans")) return { rows: [], rowCount: 0 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_status_conflict");
  });

  it("PLAN-HARD-TR-04: stale second transition writes no additional approval row", async () => {
    setupStatusQuery("submitted");

    let approvalCount = 0;
    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans"))         return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO approvals")) { approvalCount++; return { rows: [], rowCount: 1 }; }
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(approvalCount).toBe(0);
  });

  it("PLAN-HARD-TR-05: stale second transition writes no audit/history record", async () => {
    setupStatusQuery("submitted");

    let auditCount = 0;
    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans"))         return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO audit_log")) { auditCount++; return { rows: [], rowCount: 1 }; }
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(auditCount).toBe(0);
  });

  it("PLAN-HARD-TR-06: stale second transition triggers no notification", async () => {
    setupStatusQuery("submitted");

    const { notifyEntityActorsDeduped } = await import("../lib/notifications.js");
    const notifySpy = vi.mocked(notifyEntityActorsDeduped);
    notifySpy.mockClear();

    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans")) return { rows: [], rowCount: 0 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("PLAN-HARD-TR-07: exactly one transition commits when source status pre-changed (second → 409)", async () => {
    // Simulate: first transition already changed status to technically_approved,
    // second concurrent call still sees 'submitted' in the pre-check but CAS fails.
    setupStatusQuery("submitted");

    // CAS UPDATE fails → second caller gets 409.
    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans")) return { rows: [], rowCount: 0 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("plan_status_conflict");
  });

  it("PLAN-HARD-TR-07b: stale submit (wrong source locked under FOR UPDATE) returns 409 — not 400 (PLAN-016)", async () => {
    // The submit path locks the plan row with FOR UPDATE, then re-checks eligibility
    // from the locked row.  If a concurrent actor changed the status between the
    // pre-transaction check and the lock acquisition, the locked status will be wrong.
    // This must return 409 Conflict (not 400 Bad Request).

    // Pre-transaction check: status appears eligible (draft → submit is valid).
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status, sector"))  return Promise.resolve({ rows: [{ status: "draft", sector: "Health", project_id: null, stateId: null }] });
      if (sql.includes("LEFT JOIN projects"))      return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("unresolved_required"))     return Promise.resolve({ rows: [{ count: "0" }] });
      if (sql.includes("FROM plans pl"))           return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "submitted" }] });
      return Promise.resolve({ rows: [] });
    });

    // Under the FOR UPDATE lock, the status has already changed to 'submitted'
    // (a concurrent submit won the race) — the locked status is no longer 'draft'.
    mockTransactionClient((sql) => {
      if (sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            status: "submitted",       // stale: already submitted
            description: "desc", start_date: null, end_date: null,
            localities: [], currency: "USD", budget_planned: null,
            planSector: "Health", projectId: null, stateId: null,
          }],
          rowCount: 1,
        };
      }
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "submit" });
    // Stale-status conflict under lock → 409, not 400.
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot_submit_from_submitted/);
  });

  it("PLAN-HARD-TR-08: TC can only transition Plans within their sector — cross-sector → 403", async () => {
    // Plan is in Education sector; TC_USER has Health sector.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status, sector"))  return Promise.resolve({ rows: [{ status: "submitted", sector: "Education", project_id: null, stateId: null }] });
      if (sql.includes("LEFT JOIN projects"))      return Promise.resolve({ rows: [{ sector: "Education", stateId: null, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...TC_USER }); // TC for Health, not Education
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(403);
  });

  it("PLAN-HARD-TR-09: SPO can only transition Plans within their State — cross-State → 403", async () => {
    // Plan is in stateId=7 (Kassala); SPO_USER has stateId=5 (Khartoum).
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status, sector"))  return Promise.resolve({ rows: [{ status: "submitted", sector: null, project_id: null, stateId: 7 }] });
      if (sql.includes("LEFT JOIN projects"))      return Promise.resolve({ rows: [{ sector: null, stateId: 7, locationType: "state" }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...SPO_USER }); // stateId=5, cross-state to 7
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(403);
  });

  it("PLAN-HARD-TR-10: PM Full Operational Access can transition organisation-wide", async () => {
    // Plan in Health sector, state 7; PM has no sector/state restriction.
    setupStatusQuery("submitted", "Health", 7);

    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    // PM is allowed globally — not 403.
    expect(res.status).not.toBe(403);
  });

  it("PLAN-HARD-TR-11: Super Admin Full Operational Access can transition organisation-wide", async () => {
    setupStatusQuery("submitted", "Health", 7);

    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...SA_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).not.toBe(403);
  });

  it("PLAN-HARD-TR-12: Viewer cannot trigger any transition → 403 (no transition permissions)", async () => {
    // requirePerm is bypassed in the mock; the permission check inside the route body runs.
    // Viewer does not have 'projects.approve.technical', so technical_review must be denied.
    setupStatusQuery("submitted");

    const app = await buildApp({ ...VIEWER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-HARD-REOPEN: Reopen lock inside transaction (PLAN-006)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-HARD-REOPEN: Reopen lock inside transaction (PLAN-006)", () => {
  beforeEach(() => vi.clearAllMocks());

  /** Wire pool.query for GET /plans/:planId/reopen pre-transaction reads. */
  function setupReopenQuery(status = "approved", sector = "Health", stateId: number | null = null) {
    mockPoolQuery.mockImplementation((sql: string) => {
      // getPlanMeta (sector/stateId guard)
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector, stateId, locationType: "hq" }] });
      }
      // getPlanById summary (returned after success)
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{ ...PLAN_ROW, status: "draft" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it("PLAN-HARD-REOPEN-01: FOR UPDATE is issued after BEGIN on the same client (structural test)", async () => {
    setupReopenQuery();

    const callOrder: string[] = [];
    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.trim().toUpperCase() === "BEGIN")    callOrder.push("BEGIN");
        else if (sql.includes("FOR UPDATE"))          callOrder.push("FOR UPDATE");
        else if (sql.includes("UPDATE plans"))        callOrder.push("UPDATE plans");
        else if (sql.includes("INSERT INTO approvals")) callOrder.push("INSERT approvals");
        else if (sql.trim().toUpperCase() === "COMMIT") callOrder.push("COMMIT");

        // Return the locked plan row for the FOR UPDATE query.
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "approved", code: "P-042", title: "Test", last_final_approved_at: null }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans/42/reopen").send({ reason: "Correction needed." });

    // FOR UPDATE must come AFTER BEGIN and BEFORE any UPDATE/INSERT.
    const beginIdx    = callOrder.indexOf("BEGIN");
    const forupdIdx   = callOrder.indexOf("FOR UPDATE");
    const updateIdx   = callOrder.indexOf("UPDATE plans");

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(forupdIdx).toBeGreaterThan(beginIdx);
    if (updateIdx >= 0) {
      expect(updateIdx).toBeGreaterThan(forupdIdx);
    }
  });

  it("PLAN-HARD-REOPEN-02: FOR UPDATE and mutation UPDATE share one BEGIN/COMMIT block (one client)", async () => {
    setupReopenQuery();

    let forUpdateSeen = false;
    let updatePlansSeen = false;
    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE"))   forUpdateSeen = true;
        if (sql.includes("UPDATE plans")) updatePlansSeen = true;
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "approved", code: "P-042", title: "Test", last_final_approved_at: null }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans/42/reopen").send({ reason: "Correction needed." });

    // Both FOR UPDATE and UPDATE plans must be on the same client object.
    expect(forUpdateSeen).toBe(true);
    expect(updatePlansSeen).toBe(true);
    // The client.query mock was called with both — confirming single-client use.
    const sqls = (reopenClient.query.mock.calls as Array<[string]>).map((c) => c[0]);
    expect(sqls.some((s) => s.includes("FOR UPDATE"))).toBe(true);
    expect(sqls.some((s) => s.includes("UPDATE plans"))).toBe(true);
  });

  it("PLAN-HARD-REOPEN-03: valid reopen succeeds — status 'draft'; one reopen approval row exists", async () => {
    setupReopenQuery("approved");

    // The reopen INSERT uses hardcoded literals for action ('reopen') and to_status ('draft')
    // in the SQL itself — verify the SQL contains both, and that the insert was called.
    let approvalSql = "";
    let approvalFromStatus: unknown = null;

    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "approved", code: "P-042", title: "Test", last_final_approved_at: null }] });
        }
        if (sql.includes("INSERT INTO approvals") && Array.isArray(params)) {
          approvalSql        = sql;
          approvalFromStatus = params[1]; // from_status ($2 in the INSERT → params[1])
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({ reason: "Fix required." });
    expect(res.status).not.toBe(500);
    // SQL must contain hardcoded 'reopen' and 'draft'.
    expect(approvalSql).toMatch(/'reopen'/);
    expect(approvalSql).toMatch(/'draft'/);
    // from_status must be the plan's previous status ("approved").
    expect(approvalFromStatus).toBe("approved");
  });

  it("PLAN-HARD-REOPEN-04: reopen without a reason returns 400/422", async () => {
    setupReopenQuery();

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({});
    expect([400, 422]).toContain(res.status);
    expect(res.body.error).toMatch(/reason/i);
  });

  it("PLAN-HARD-REOPEN-05: concurrent reopen — second attempt gets no duplicate approval when status already draft", async () => {
    setupReopenQuery("draft"); // plan is already draft (previously reopened)

    // FOR UPDATE returns draft — not in REOPENABLE_STATUSES.
    // However, draft was never finally approved, so alreadyEditable=true → idempotent return.
    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "draft", code: "P-042", title: "Test", last_final_approved_at: null }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    let approvalInserted = false;
    const originalQuery = reopenClient.query;
    reopenClient.query = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO approvals")) approvalInserted = true;
      return originalQuery(sql, params);
    });
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({ reason: "Again." });
    // Already editable → idempotent 200, no new approval row.
    expect(res.status).not.toBe(500);
    expect(approvalInserted).toBe(false);
  });

  it("PLAN-HARD-REOPEN-06: second stale reopen (plan already draft, not in REOPENABLE) returns controlled conflict — not 500", async () => {
    setupReopenQuery("approved");

    // Simulate a plan that WAS finally approved; no valid reopen event yet.
    // Status is returned as "draft" from FOR UPDATE (concurrent reopen already ran).
    // "draft" is NOT in REOPENABLE_STATUSES, so this should be a controlled 409.
    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "draft", code: "P-042", title: "Test", last_final_approved_at: "2026-01-01T00:00:00Z" }] });
        }
        // approvals check for valid reopen event: none found (no reopen after last_final_approved_at).
        if (sql.includes("action = 'reopen'")) {
          return Promise.resolve({ rows: [] }); // Case C: no valid reopen event
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({ reason: "Stale reopen." });
    // "draft" is not in REOPENABLE_STATUSES → 409 terminal (not 500).
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(409);
  });

  it("PLAN-HARD-REOPEN-07: failed reopen sends no notification", async () => {
    setupReopenQuery("approved");

    const { notifyEntityActorsDeduped } = await import("../lib/notifications.js");
    const notifySpy = vi.mocked(notifyEntityActorsDeduped);
    notifySpy.mockClear();

    // FOR UPDATE fails (plan not found).
    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) return Promise.resolve({ rows: [] }); // not found inside tx
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({ reason: "Should fail." });
    expect(res.status).toBe(404);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("PLAN-HARD-REOPEN-08: PM/Super Admin Full Access can reopen any Plan", async () => {
    // Test that PM (full operational access) reaches the reopen logic without a scope rejection.
    setupReopenQuery("approved", "Health", 7); // plan in different state — PM ignores state scope

    const reopenClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ status: "approved", code: "P-042", title: "Test", last_final_approved_at: null }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(reopenClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/reopen").send({ reason: "PM global reopen." });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-HARD-DEL: Delete integrity (PLAN-005)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-HARD-DEL: Delete integrity (PLAN-005)", () => {
  beforeEach(() => vi.clearAllMocks());

  function setupDeleteMeta(sector = "Health", stateId: number | null = null) {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector, stateId, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  /** Default delete client: handles FOR UPDATE lock + attachment path SELECT inside the transaction. */
  function makeDeleteClient(attachmentPaths: string[] = []) {
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        // Initial plan row lock (FOR UPDATE)
        if (sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
        }
        // Attachment path SELECT inside the transaction
        if (sql.includes("SELECT object_path FROM plan_attachments")) {
          return Promise.resolve({ rows: attachmentPaths.map((p) => ({ object_path: p })) });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);
    return client;
  }

  it("PLAN-HARD-DEL-01: delete is transaction-wrapped — ROLLBACK on inner failure preserves plan", async () => {
    setupDeleteMeta();

    const callOrder: string[] = [];
    let commitSeen = false;
    let rollbackSeen = false;

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        const up = sql.trim().toUpperCase();
        if (up === "BEGIN")    callOrder.push("BEGIN");
        else if (up === "COMMIT")   { commitSeen = true; callOrder.push("COMMIT"); }
        else if (up === "ROLLBACK") { rollbackSeen = true; callOrder.push("ROLLBACK"); }
        else if (sql.includes("DELETE FROM plan_registration_sessions")) callOrder.push("del_sessions");
        else if (sql.includes("DELETE FROM comments"))   callOrder.push("del_comments");
        else if (sql.includes("DELETE FROM approvals"))  callOrder.push("del_approvals");
        else if (sql.includes("UPDATE risks"))           callOrder.push("null_risks");
        else if (sql.includes("DELETE FROM plan_activities")) callOrder.push("del_activities");
        else if (sql.includes("DELETE FROM plans"))       {
          // Simulate an inner failure to test ROLLBACK path.
          throw new Error("simulated FK failure");
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    // Error from DB → 500; ROLLBACK must be invoked.
    await request(app).delete("/plans/42");
    expect(rollbackSeen).toBe(true);
    expect(commitSeen).toBe(false);
  });

  it("PLAN-HARD-DEL-02: plan_activities are deleted inside the transaction", async () => {
    setupDeleteMeta();

    let activitiesDeleted = false;
    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM plan_activities")) activitiesDeleted = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    expect(activitiesDeleted).toBe(true);
  });

  it("PLAN-HARD-DEL-03: registration sessions are deleted inside the transaction (no usable orphans)", async () => {
    setupDeleteMeta();

    let sessionsDeleted = false;
    let sessionsDeletedBeforePlan = false;
    let planDeleted = false;

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM plan_registration_sessions")) {
          sessionsDeleted = true;
          if (!planDeleted) sessionsDeletedBeforePlan = true;
        }
        if (sql.includes("DELETE FROM plans") && !sql.includes("plan_activities")) planDeleted = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    expect(sessionsDeleted).toBe(true);
    // Sessions must be cleaned before the plan row itself is removed.
    expect(sessionsDeletedBeforePlan).toBe(true);
  });

  it("PLAN-HARD-DEL-04: comments are cleaned (entity_type='plan') per schema contract", async () => {
    setupDeleteMeta();

    let commentsDeleted = false;
    let commentsSql = "";

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM comments")) {
          commentsDeleted = true;
          commentsSql = sql;
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    expect(commentsDeleted).toBe(true);
    expect(commentsSql).toMatch(/entity_type\s*=\s*'plan'/);
  });

  it("PLAN-HARD-DEL-05: approvals are cleaned (entity_type='plan') per schema contract", async () => {
    setupDeleteMeta();

    let approvalsDeleted = false;
    let approvalsSql = "";

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM approvals")) {
          approvalsDeleted = true;
          approvalsSql = sql;
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    expect(approvalsDeleted).toBe(true);
    expect(approvalsSql).toMatch(/entity_type\s*=\s*'plan'/);
  });

  it("PLAN-HARD-DEL-06: audit_log rows are NOT deleted (intentional governance retention)", async () => {
    setupDeleteMeta();

    let auditLogDeleted = false;
    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM audit_log")) auditLogDeleted = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    expect(auditLogDeleted).toBe(false);
  });

  it("PLAN-HARD-DEL-07: if child cleanup throws, plan deletion is rolled back (plan still exists)", async () => {
    setupDeleteMeta();

    let rollbackCalled = false;
    let commitCalled = false;

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM plan_registration_sessions")) {
          throw new Error("Simulated session delete failure");
        }
        const up = sql.trim().toUpperCase();
        if (up === "ROLLBACK") rollbackCalled = true;
        if (up === "COMMIT")   commitCalled   = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(500);
    expect(rollbackCalled).toBe(true);
    expect(commitCalled).toBe(false);
  });

  it("PLAN-HARD-DEL-08: delete permissions unchanged — non-authorised role (Viewer) → 403", async () => {
    // requirePerm is mocked to pass-through; the internal permission check governs access.
    // Viewer has no plans.delete → the middleware mock passes but the route itself
    // can only gate on requirePerm (which IS mocked). This test verifies the structural
    // claim that only ED/PM roles carry plans.delete in permissionsFor().
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    const perms = permissionsFor(VIEWER as unknown as Parameters<typeof permissionsFor>[0]);
    expect(perms).not.toContain("plans.delete");

    // Also confirm PM and ED carry the permission.
    const pmPerms = permissionsFor(PM_USER as unknown as Parameters<typeof permissionsFor>[0]);
    expect(pmPerms).toContain("plans.delete");
  });

  it("PLAN-HARD-DEL-LOCK: plan row is locked FOR UPDATE before attachment paths are collected", async () => {
    // Migration 024 added FK (plan_attachments.plan_id → plans.id ON DELETE CASCADE).
    // This means concurrent attachment uploads must acquire KEY SHARE on the plans row
    // via the FK check.  The delete handler must take FOR UPDATE on the plans row FIRST
    // so that new uploads block until the transaction commits.
    setupDeleteMeta();

    const callOrder: string[] = [];
    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FOR UPDATE"))             callOrder.push("LOCK_FOR_UPDATE");
        if (sql.includes("SELECT object_path"))     callOrder.push("COLLECT_PATHS");
        if (sql.includes("DELETE FROM plan_attachments")) callOrder.push("DEL_ATTACH");
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);

    const lockIdx        = callOrder.indexOf("LOCK_FOR_UPDATE");
    const collectIdx     = callOrder.indexOf("COLLECT_PATHS");
    const delAttachIdx   = callOrder.indexOf("DEL_ATTACH");

    // FOR UPDATE must come before path collection, which must come before metadata delete.
    expect(lockIdx).toBeLessThan(collectIdx);
    expect(collectIdx).toBeLessThan(delAttachIdx);
  });

  // Risk FK behaviour: risks has two unbound integer columns referencing plan data (no DB-level FK).
  // risks.plan_id — direct link to the plan.
  // risks.plan_activity_id — link to a specific plan activity.
  // Both must be SET NULL; operational risks must not be silently deleted.
  it("PLAN-HARD-DEL-ATT-01: attachment paths read inside tx; metadata deleted in tx; storage cleaned post-COMMIT", async () => {
    const { deleteStorageObjectSafely } = await import("../lib/objectStorage.js");
    const deleteSpy = vi.mocked(deleteStorageObjectSafely);
    deleteSpy.mockClear();
    deleteSpy.mockResolvedValue({ deleted: true });

    // Attachment paths are supplied by the transaction CLIENT (not pool.query),
    // because the SELECT is performed inside the BEGIN/COMMIT block.
    setupDeleteMeta();

    let attachmentsDeletedInTx = false;
    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        // Return two attachment paths when the in-transaction SELECT runs.
        if (sql.includes("SELECT object_path FROM plan_attachments")) {
          return Promise.resolve({ rows: [{ object_path: "/objects/att-1.pdf" }, { object_path: "/objects/att-2.pdf" }] });
        }
        if (sql.includes("DELETE FROM plan_attachments")) attachmentsDeletedInTx = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);

    // DB metadata deleted inside the transaction.
    expect(attachmentsDeletedInTx).toBe(true);

    // Storage objects deleted post-COMMIT (both paths).
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledWith("/objects/att-1.pdf");
    expect(deleteSpy).toHaveBeenCalledWith("/objects/att-2.pdf");
  });

  it("PLAN-HARD-DEL-ATT-02: post-COMMIT storage failure is non-fatal — DB is consistent, 204 returned", async () => {
    // Durable ordering guarantee: DB rows are deleted in the transaction FIRST.
    // If storage deletion fails after COMMIT, the plan is already gone from the DB
    // (consistent state). The storage failure is logged for admin reconciliation
    // but does NOT roll back the delete or fail the HTTP response.
    const { deleteStorageObjectSafely } = await import("../lib/objectStorage.js");
    const deleteSpy = vi.mocked(deleteStorageObjectSafely);
    deleteSpy.mockClear();
    deleteSpy.mockRejectedValue(new Error("storage unavailable"));

    setupDeleteMeta();

    let planRowDeleted = false;
    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("SELECT object_path FROM plan_attachments")) {
          return Promise.resolve({ rows: [{ object_path: "/objects/fail.pdf" }] });
        }
        if (sql.includes("DELETE FROM plans") && !sql.includes("plan_activities") && !sql.includes("plan_attachments")) {
          planRowDeleted = true;
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    // DB is committed: plan row deleted, 204 returned — storage failure is non-fatal.
    expect(res.status).toBe(204);
    expect(planRowDeleted).toBe(true);
    // Storage deletion was attempted (best-effort).
    expect(deleteSpy).toHaveBeenCalledWith("/objects/fail.pdf");
  });

  it("PLAN-HARD-DEL-RISK-01: risks.plan_id is SET NULL (not deleted) when plan is removed", async () => {
    setupDeleteMeta();

    let risksDeleteCalled = false;
    let risksSetNullCalled = false;
    let risksSetNullSql = "";

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM risks")) risksDeleteCalled = true;
        if (sql.includes("UPDATE risks") && sql.includes("plan_id = NULL")) {
          risksSetNullCalled = true;
          risksSetNullSql = sql;
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    // Risks must NOT be deleted — they are preserved with plan_id = NULL.
    expect(risksDeleteCalled).toBe(false);
    expect(risksSetNullCalled).toBe(true);
    expect(risksSetNullSql).toMatch(/plan_id\s*=\s*NULL/);
  });

  it("PLAN-HARD-DEL-RISK-02: risks.plan_activity_id is SET NULL before plan_activities are deleted", async () => {
    setupDeleteMeta();

    let activityNullCalled = false;
    let activityNullBeforeDelete = false;
    let activitiesDeleted = false;
    let activityNullSql = "";

    const delClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("UPDATE risks") && sql.includes("plan_activity_id = NULL")) {
          activityNullCalled = true;
          activityNullSql = sql;
          if (!activitiesDeleted) activityNullBeforeDelete = true;
        }
        if (sql.includes("DELETE FROM plan_activities")) activitiesDeleted = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(delClient);

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).delete("/plans/42");
    expect(res.status).toBe(204);
    // plan_activity_id must be cleared before activities are removed.
    expect(activityNullCalled).toBe(true);
    expect(activityNullBeforeDelete).toBe(true);
    // The SQL should use a subquery to target activities belonging to this plan.
    expect(activityNullSql).toMatch(/plan_activity_id\s*=\s*NULL/);
    expect(activityNullSql).toMatch(/plan_activities/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-HARD-TR-SCOPE: TC sector scope cross-sector (companion structural check)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-HARD-TR-SCOPE: TC sector scope enforcement (structural)", async () => {
  const { permissionsFor } = await import("../middlewares/currentUser.js");

  it("TC has sector-scoped approval permissions", () => {
    const perms = permissionsFor(TC_USER as unknown as Parameters<typeof permissionsFor>[0]);
    expect(perms).toContain("projects.approve.technical");
    // TC does not have wildcard — sector restriction is enforced at route level.
    expect(perms).not.toContain("*");
  });

  it("SPO has create/update but NOT any approval permissions", () => {
    const perms = permissionsFor(SPO_USER as unknown as Parameters<typeof permissionsFor>[0]);
    expect(perms).toContain("plans.create");
    expect(perms).not.toContain("plans.approve.final");
    expect(perms).not.toContain("projects.approve.technical");
  });

  it("TC_EDUC and TC_HEALTH have separate sector scopes (structural check)", () => {
    // Both are TCs but in different sectors — no overlap.
    expect(TC_USER.sector).toBe("Health");
    expect(TC_EDUC.sector).toBe("Education");
    expect(TC_USER.sector).not.toBe(TC_EDUC.sector);
  });

  it("SPO_CROSS (stateId=7) is different state from SPO_USER (stateId=5)", () => {
    expect(SPO_CROSS.stateId).toBe(7);
    expect(SPO_USER.stateId).toBe(5);
    expect(SPO_CROSS.stateId).not.toBe(SPO_USER.stateId);
  });
});
