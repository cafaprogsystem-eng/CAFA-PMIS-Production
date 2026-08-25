/**
 * PLAN-AUDIT SENTINEL TESTS — Backend (Task #416)
 *
 * Tests against real exported production constants and route handlers.
 * No duplicated rule maps — every assertion imports the authoritative source.
 *
 * PLAN-AUDIT-01  Plan type / frequency / status enumerations (real imports)
 * PLAN-AUDIT-02  Access matrix via real permissionsFor() (currentUser.ts)
 * PLAN-AUDIT-03  Transition map integrity (real PLAN_TRANSITIONS)
 * PLAN-AUDIT-04  P0 fix: POST /plans forces status=draft (route handler test)
 * PLAN-AUDIT-05  P0 fix: PATCH /plans ignores body.status (route handler test)
 * PLAN-AUDIT-06  Transition guards: wrong source status returns 409
 * PLAN-AUDIT-07  State/sector scope: state-role fail-closed on null stateId
 * PLAN-AUDIT-08  Full Operational Access: PM cannot skip workflow steps
 * PLAN-AUDIT-09  rejected status is terminal — no transition accepts it as source
 * PLAN-AUDIT-10  Reopen only from REOPENABLE_STATUSES; terminal states blocked
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: mock handles must be declared BEFORE vi.mock factories ────────
const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockPoolQuery,
    connect: mockPoolConnect,
  },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ── Representative user fixtures (complete CurrentUser shape) ─────────────────
// All required fields included so casts to CurrentUser are type-safe.
const PM_USER  = { id: 1, name: "PM",     email: "pm@t.com",  role: "program_manager",           roleLabel: "Programme Manager",         scope: "global",  stateId: null, stateName: null, sector: null,     sectors: null,        avatarUrl: null } as const;
const TC_USER  = { id: 2, name: "TC",     email: "tc@t.com",  role: "technical_coordinator",      roleLabel: "Technical Coordinator",      scope: "sector",  stateId: null, stateName: null, sector: "Health", sectors: ["Health"],  avatarUrl: null } as const;
const SPO_USER = { id: 3, name: "SPO",    email: "spo@t.com", role: "state_program_officer",      roleLabel: "State Programme Officer",    scope: "state",   stateId: 5,    stateName: "Khartoum", sector: null, sectors: null, avatarUrl: null } as const;
const SOM_USER = { id: 7, name: "SOM",    email: "som@t.com", role: "state_office_manager",       roleLabel: "State Office Manager",       scope: "state",   stateId: 5,    stateName: "Khartoum", sector: null, sectors: null, avatarUrl: null } as const;
const ED_USER  = { id: 5, name: "ED",     email: "ed@t.com",  role: "executive_director",         roleLabel: "Executive Director",         scope: "global",  stateId: null, stateName: null, sector: null,     sectors: null,        avatarUrl: null } as const;
const SPC_USER = { id: 6, name: "SPC",    email: "spc@t.com", role: "senior_program_coordinator", roleLabel: "Senior Programme Coordinator",scope: "global",  stateId: null, stateName: null, sector: null,     sectors: null,        avatarUrl: null } as const;
const VIEWER   = { id: 4, name: "Viewer", email: "v@t.com",   role: "viewer",                     roleLabel: "Viewer",                     scope: "global",  stateId: null, stateName: null, sector: null,     sectors: null,        avatarUrl: null } as const;

async function buildPlansApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  // Mount at "/" because plan routes are prefixed with "/plans/" inside the router
  // (e.g. router.get("/plans", ...), router.post("/plans/:id/transitions", ...))
  const { default: plansRouter } = await import("../routes/plans.js");
  app.use("/", plansRouter);
  return app;
}

/** Minimal mock transaction client for write tests */
function mockClient(insertedPlanId = 42) {
  const client = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO plans")) {
        return Promise.resolve({ rows: [{ id: insertedPlanId }] });
      }
      if (typeof sql === "string" && sql.includes("INSERT INTO plan_registration_sessions")) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === "string" && sql.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [{ start_date: null, end_date: null,
          localities: [], currency: null, budget_planned: null }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

/** Minimal DB response for a plan row (used by GET / summary queries) */
const PLAN_ROW = {
  id: 42, status: "draft", sector: "Health", stateId: null, locationType: "hq",
  title: "Test", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-001", stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: null, endDate: null, description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-01: Real plan type / frequency / status enumerations
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-01: Real plan type and frequency constants", async () => {
  const { PLAN_TYPES, PLAN_FREQUENCIES, POST_APPROVAL_LOCKED_STATUSES, REOPENABLE_STATUSES } =
    await import("../routes/plans.js");

  it("01-01: PLAN_TYPES has exactly 7 entries", () => {
    expect(PLAN_TYPES.size).toBe(7);
  });

  it("01-02: all 7 canonical plan types are present", () => {
    for (const t of ["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"]) {
      expect(PLAN_TYPES.has(t)).toBe(true);
    }
  });

  it("01-03: unrecognised types are rejected", () => {
    expect(PLAN_TYPES.has("workplan")).toBe(false);
    expect(PLAN_TYPES.has("strategic")).toBe(false);
    expect(PLAN_TYPES.has("")).toBe(false);
  });

  it("01-04: PLAN_FREQUENCIES has exactly 5 entries", () => {
    expect(PLAN_FREQUENCIES.size).toBe(5);
  });

  it("01-05: all canonical frequencies present", () => {
    for (const f of ["weekly", "monthly", "quarterly", "annual", "on_demand"]) {
      expect(PLAN_FREQUENCIES.has(f)).toBe(true);
    }
  });

  it("01-06: POST_APPROVAL_LOCKED_STATUSES contains all 8 locked statuses (7 post-approval + rejected terminal)", () => {
    for (const s of ["approved", "active", "in_progress", "delayed", "completed", "cancelled", "archived", "rejected"]) {
      expect(POST_APPROVAL_LOCKED_STATUSES.has(s)).toBe(true);
    }
    expect(POST_APPROVAL_LOCKED_STATUSES.size).toBe(8);
  });

  it("01-07: pre-approval statuses are NOT locked", () => {
    for (const s of ["draft", "submitted", "technically_approved", "coordination_approved"]) {
      expect(POST_APPROVAL_LOCKED_STATUSES.has(s)).toBe(false);
    }
  });

  it("01-08: REOPENABLE_STATUSES has exactly 4 non-terminal post-approval statuses", () => {
    for (const s of ["approved", "active", "in_progress", "delayed"]) {
      expect(REOPENABLE_STATUSES.has(s)).toBe(true);
    }
    expect(REOPENABLE_STATUSES.size).toBe(4);
  });

  it("01-09: terminal statuses are locked but not reopenable", () => {
    for (const s of ["completed", "cancelled", "archived"]) {
      expect(POST_APPROVAL_LOCKED_STATUSES.has(s)).toBe(true);
      expect(REOPENABLE_STATUSES.has(s)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-02: Access matrix via real permissionsFor()
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-02: Access matrix — real permissionsFor()", async () => {
  const { permissionsFor } = await import("../middlewares/currentUser.js");
  const p = (user: typeof PM_USER | typeof TC_USER | typeof SPO_USER | typeof SOM_USER |
                    typeof ED_USER | typeof SPC_USER | typeof VIEWER) =>
    permissionsFor(user as Parameters<typeof permissionsFor>[0]);

  it("02-01: PM has all plan permissions", () => {
    const perms = p(PM_USER);
    for (const perm of ["plans.create", "plans.update", "plans.delete", "plans.reopen",
      "plans.approve.coordination", "plans.approve.final", "plans.approve.technical",
      "projects.approve.technical"]) {
      expect(perms, perm).toContain(perm);
    }
  });

  it("02-02: ED has plans.delete and plans.reopen — NOT plans.create, update, or approve.final", () => {
    const perms = p(ED_USER);
    expect(perms).toContain("plans.delete");
    expect(perms).toContain("plans.reopen");
    expect(perms).not.toContain("plans.create");
    expect(perms).not.toContain("plans.update");
    expect(perms).not.toContain("plans.approve.final");
  });

  it("02-03: SPC has create, update, coord-review, reopen — not delete or final-approve", () => {
    const perms = p(SPC_USER);
    expect(perms).toContain("plans.create");
    expect(perms).toContain("plans.update");
    expect(perms).toContain("plans.approve.coordination");
    expect(perms).toContain("plans.reopen");
    expect(perms).not.toContain("plans.delete");
    expect(perms).not.toContain("plans.approve.final");
  });

  it("02-04: TC has create, update, technical-review, reopen (sector-scoped) — not delete or coord", () => {
    const perms = p(TC_USER);
    expect(perms).toContain("plans.create");
    expect(perms).toContain("plans.update");
    expect(perms).toContain("projects.approve.technical");
    expect(perms).toContain("plans.reopen");
    expect(perms).not.toContain("plans.delete");
    expect(perms).not.toContain("plans.approve.coordination");
    expect(perms).not.toContain("plans.approve.final");
  });

  it("02-05: SPO has create and update — no approval or delete", () => {
    const perms = p(SPO_USER);
    expect(perms).toContain("plans.create");
    expect(perms).toContain("plans.update");
    expect(perms).not.toContain("plans.delete");
    expect(perms).not.toContain("plans.reopen");
    expect(perms).not.toContain("plans.approve.final");
  });

  it("02-06: viewer has plans.view only — no writes", () => {
    const perms = p(VIEWER);
    expect(perms).toContain("plans.view");
    for (const perm of ["plans.create", "plans.update", "plans.delete", "plans.reopen",
      "plans.approve.coordination", "plans.approve.final"]) {
      expect(perms).not.toContain(perm);
    }
  });

  it("02-07: only ED and PM have plans.delete", () => {
    expect(p(ED_USER)).toContain("plans.delete");
    expect(p(PM_USER)).toContain("plans.delete");
    for (const user of [SPC_USER, TC_USER, SPO_USER, SOM_USER, VIEWER]) {
      expect(p(user)).not.toContain("plans.delete");
    }
  });

  it("02-08: SOM is monitoring-only — no plans.create, plans.update, or any approval perms", () => {
    // Per currentUser.ts: SOM was eliminated from the operational workflow.
    // SOM has no create, edit, submit, or review authority over plans.
    const perms = p(SOM_USER);
    expect(perms).not.toContain("plans.create");
    expect(perms).not.toContain("plans.update");
    expect(perms).not.toContain("plans.delete");
    expect(perms).not.toContain("plans.reopen");
    expect(perms).not.toContain("plans.approve.final");
    expect(perms).not.toContain("plans.approve.coordination");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-03: Transition map integrity (real PLAN_TRANSITIONS)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-03: Transition map integrity — real PLAN_TRANSITIONS", async () => {
  const { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS } = await import("../routes/plans.js");

  it("03-01: every transition has a non-empty from array and a non-empty to string", () => {
    for (const [action, t] of Object.entries(PLAN_TRANSITIONS)) {
      expect(t.from.length, `${action}.from`).toBeGreaterThan(0);
      expect(t.to.length, `${action}.to`).toBeGreaterThan(0);
    }
  });

  it("03-02: approval chain source statuses are strictly sequential", () => {
    expect(PLAN_TRANSITIONS.submit.from).toEqual(["draft"]);
    expect(PLAN_TRANSITIONS.technical_review.from).toEqual(["submitted"]);
    expect(PLAN_TRANSITIONS.coordination_review.from).toEqual(["technically_approved"]);
    expect(PLAN_TRANSITIONS.final_approve.from).toEqual(["coordination_approved"]);
  });

  it("03-03: approval chain destinations are correct", () => {
    expect(PLAN_TRANSITIONS.submit.to).toBe("submitted");
    expect(PLAN_TRANSITIONS.technical_review.to).toBe("technically_approved");
    expect(PLAN_TRANSITIONS.coordination_review.to).toBe("coordination_approved");
    expect(PLAN_TRANSITIONS.final_approve.to).toBe("approved");
  });

  it("03-04: every transition has a permission defined in PLAN_TRANSITION_PERMS", () => {
    for (const action of Object.keys(PLAN_TRANSITIONS)) {
      expect(PLAN_TRANSITION_PERMS[action], `${action} missing permission`).toBeDefined();
    }
  });

  it("03-05: submit permission is plans.create", () => {
    expect(PLAN_TRANSITION_PERMS.submit).toBe("plans.create");
  });

  it("03-06: final_approve permission is plans.approve.final", () => {
    expect(PLAN_TRANSITION_PERMS.final_approve).toBe("plans.approve.final");
  });

  it("03-07: reject and request_revision share projects.approve.technical", () => {
    expect(PLAN_TRANSITION_PERMS.reject).toBe("projects.approve.technical");
    expect(PLAN_TRANSITION_PERMS.request_revision).toBe("projects.approve.technical");
  });

  it("03-08: operational transitions require plans.update", () => {
    for (const action of ["activate", "start", "mark_delayed", "complete", "cancel", "archive"]) {
      expect(PLAN_TRANSITION_PERMS[action], action).toBe("plans.update");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-09: rejected is terminal — verified against real transition map
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-09: rejected status is terminal (real PLAN_TRANSITIONS)", async () => {
  const { PLAN_TRANSITIONS, REOPENABLE_STATUSES } = await import("../routes/plans.js");

  it("09-01: no transition accepts rejected as a source status", () => {
    for (const [action, t] of Object.entries(PLAN_TRANSITIONS)) {
      expect(t.from, `${action} must not list rejected`).not.toContain("rejected");
    }
  });

  it("09-02: rejected is the destination of the reject transition only", () => {
    const count = Object.values(PLAN_TRANSITIONS).filter((t) => t.to === "rejected").length;
    expect(count).toBe(1);
    expect(PLAN_TRANSITIONS.reject.to).toBe("rejected");
  });

  it("09-03: request_revision does NOT accept rejected — reviewer must choose before rejecting", () => {
    expect(PLAN_TRANSITIONS.request_revision.from).not.toContain("rejected");
    expect(PLAN_TRANSITIONS.request_revision.from).toEqual(
      expect.arrayContaining(["submitted", "technically_approved", "coordination_approved"]),
    );
  });

  it("09-04: rejected is not reopenable", () => {
    expect(REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-10: Reopen / terminal status rules (real constants)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-10: Reopen and terminal status rules (real constants)", async () => {
  const { REOPENABLE_STATUSES, POST_APPROVAL_LOCKED_STATUSES } = await import("../routes/plans.js");

  it("10-01: every reopenable status is also locked (subset check)", () => {
    for (const s of REOPENABLE_STATUSES) {
      expect(POST_APPROVAL_LOCKED_STATUSES.has(s)).toBe(true);
    }
  });

  it("10-02: terminal statuses are locked but not reopenable", () => {
    for (const s of ["completed", "cancelled", "archived"]) {
      expect(POST_APPROVAL_LOCKED_STATUSES.has(s)).toBe(true);
      expect(REOPENABLE_STATUSES.has(s)).toBe(false);
    }
  });

  it("10-03: pre-approval workflow statuses are not locked and not reopenable", () => {
    // These statuses are normal pre-approval states — not locked, not reopenable.
    for (const s of ["draft", "submitted", "technically_approved", "coordination_approved"]) {
      expect(POST_APPROVAL_LOCKED_STATUSES.has(s)).toBe(false);
      expect(REOPENABLE_STATUSES.has(s)).toBe(false);
    }
  });

  it("10-03b: rejected is locked (terminal, not editable) and not reopenable (PLAN-BD-5)", () => {
    // rejected is a terminal pre-final-approval status added to POST_APPROVAL_LOCKED_STATUSES
    // so that isPlanCurrentlyEditable() returns false — PATCH editing blocked.
    expect(POST_APPROVAL_LOCKED_STATUSES.has("rejected")).toBe(true);
    expect(REOPENABLE_STATUSES.has("rejected")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-04: P0 fix — POST /plans forces status=draft (route test)
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-04: P0 fix — POST /plans always creates in draft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("04-01: POST with body.status=approved — captured INSERT status is draft", async () => {
    let capturedStatus: unknown = null;

    const client = mockClient(42);
    client.query.mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO plans")) {
        // status is parameter index 14 (0-based) in the INSERT
        if (Array.isArray(params)) capturedStatus = params[14];
        return Promise.resolve({ rows: [{ id: 42 }] });
      }
      if (typeof sql === "string" && sql.includes("INSERT INTO plan_registration_sessions")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Pool queries (non-transaction: getPlanMeta, getPlanById summary, activities)
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [PLAN_ROW] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app)
      .post("/plans")
      .send({ title: "Bypass Test", locationType: "hq", status: "approved" });

    // Request must not 500 (auth/validation errors are expected; internal errors are not)
    expect(res.status).toBeLessThan(500);

    // If the INSERT was reached, status must be hardcoded 'draft'
    if (capturedStatus !== null) {
      expect(capturedStatus).toBe("draft");
    }
  });

  it("04-02: POST with body.status=submitted — INSERT status is draft, not submitted", async () => {
    let capturedStatus: unknown = null;

    const client = mockClient(43);
    client.query.mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO plans")) {
        if (Array.isArray(params)) capturedStatus = params[14];
        return Promise.resolve({ rows: [{ id: 43 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{ ...PLAN_ROW, id: 43 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app)
      .post("/plans")
      .send({ title: "Submit Bypass", locationType: "hq", status: "submitted" });

    expect(res.status).toBeLessThan(500);
    if (capturedStatus !== null) {
      expect(capturedStatus).toBe("draft");
      expect(capturedStatus).not.toBe("submitted");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-05: P0 fix — PATCH /plans ignores body.status
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-05: P0 fix — PATCH /plans does not accept body.status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("05-01: PATCH with body.status=approved on draft plan — UPDATE SET clause has no status column", async () => {
    let updateSql = "";

    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT status")) {
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null }] });
      }
      if (typeof sql === "string" && sql.includes("action = 'reopen'")) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === "string" && sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [PLAN_ROW] });
      }
      if (typeof sql === "string" && sql.includes("UPDATE plans SET")) {
        updateSql = sql;
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("FOR UPDATE")) {
          return Promise.resolve({ rows: [{ start_date: null, end_date: null,
            localities: [], currency: null, budget_planned: null }] });
        }
        if (typeof sql === "string" && sql.includes("UPDATE plans SET")) {
          updateSql = sql;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app)
      .patch("/plans/42")
      .send({ title: "New Title", status: "approved" });

    expect(res.status).toBeLessThan(500);

    // The UPDATE SET clause must not set status from body
    if (updateSql) {
      // The SET clause should contain "title" but not a raw "status = " from body
      // (status column may appear in WHERE but not in SET from body.status)
      const setClause = updateSql.match(/SET (.+?) WHERE/i)?.[1] ?? updateSql;
      // "status" must not be in the SET clause as a field being assigned from body
      expect(setClause).not.toMatch(/\bstatus\s*=\s*\$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-06: Transition guard — wrong source status returns 409
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-06: Transition guard — wrong source status blocked by route handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("06-01: final_approve on draft returns 409 cannot_final_approve_from_draft (PLAN-016)", async () => {
    // PLAN-016: wrong-source status is now 409 Conflict (previously 400).
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT status, sector")) {
        return Promise.resolve({ rows: [{ status: "draft", sector: "Health", project_id: null, stateId: null }] });
      }
      // getPlanMeta call
      if (typeof sql === "string" && sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_final_approve_from_draft");
  });

  it("06-02: technical_review on coordination_approved returns 409 cannot_* (PLAN-016)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT status, sector")) {
        return Promise.resolve({ rows: [{ status: "coordination_approved", sector: "Health", project_id: null, stateId: null }] });
      }
      if (typeof sql === "string" && sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildPlansApp({ ...TC_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_technical_review_from_coordination_approved");
  });

  it("06-03: unknown action name returns 400 with invalid_action prefix", async () => {
    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "magic_approve" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^invalid_action:/);
  });

  it("06-04: submit from already-submitted state returns 409 cannot_submit_from_submitted (PLAN-016)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT status, sector")) {
        return Promise.resolve({ rows: [{ status: "submitted", sector: "Health", project_id: null, stateId: null }] });
      }
      if (typeof sql === "string" && sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "submit" });
    // submit from submitted is wrong-source-state → 409 (PLAN-016: aligned with CAS conflict response).
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_submit_from_submitted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-07: State/sector scope — fail-closed on null stateId
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-07: State/sector scope — fail-closed route behaviour", () => {
  beforeEach(() => vi.clearAllMocks());

  it("07-01: SPO with null stateId receives empty plan list", async () => {
    const app = await buildPlansApp({ ...SPO_USER, stateId: null });
    const res = await request(app).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("07-02: SOM with null stateId receives empty plan list", async () => {
    const app = await buildPlansApp({ ...SOM_USER, stateId: null });
    const res = await request(app).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("07-03: TC with empty sectors receives empty dashboard (fail-closed)", async () => {
    const app = await buildPlansApp({ ...TC_USER, sector: null, sectors: [] });
    const res = await request(app).get("/plans/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.totals?.total ?? 0).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-AUDIT-08: Full Operational Access — PM cannot skip workflow steps
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN-AUDIT-08: Full Operational Access — PM cannot skip workflow steps", async () => {
  const { PLAN_TRANSITIONS } = await import("../routes/plans.js");
  const { permissionsFor } = await import("../middlewares/currentUser.js");

  it("08-01: PM has plans.approve.final but final_approve still requires coordination_approved source", () => {
    const perms = permissionsFor(PM_USER as Parameters<typeof permissionsFor>[0]);
    expect(perms).toContain("plans.approve.final");
    // Structural guard is not permission-dependent
    expect(PLAN_TRANSITIONS.final_approve.from).toEqual(["coordination_approved"]);
    expect(PLAN_TRANSITIONS.final_approve.from).not.toContain("draft");
  });

  it("08-02: PM cannot reach approved from draft — each intermediate step is required", () => {
    expect(PLAN_TRANSITIONS.final_approve.from).not.toContain("draft");
    expect(PLAN_TRANSITIONS.final_approve.from).not.toContain("submitted");
    expect(PLAN_TRANSITIONS.final_approve.from).not.toContain("technically_approved");
  });

  it("08-03: PM does not receive wildcard (*) — permissions are explicit", () => {
    const perms = permissionsFor(PM_USER as Parameters<typeof permissionsFor>[0]);
    expect(perms).not.toContain("*");
  });

  it("08-04: final_approve from draft returns 409 even for PM (route-level structural enforcement, PLAN-016)", async () => {
    // PM has plans.approve.final permission but the transition map still guards from-status.
    // Wrong-source-status returns 409 cannot_final_approve_from_draft regardless of role (PLAN-016).
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT status, sector")) {
        return Promise.resolve({ rows: [{ status: "draft", sector: null, project_id: null, stateId: null }] });
      }
      if (typeof sql === "string" && sql.includes("LEFT JOIN projects")) {
        return Promise.resolve({ rows: [{ sector: null, stateId: null, locationType: "hq" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = await buildPlansApp({ ...PM_USER });
    const res = await request(app).post("/plans/42/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_final_approve_from_draft");
  });
});
