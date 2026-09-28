/**
 * HQ Plans and Geographical Coverage.
 *
 * HQ (national-level) Plans cover the whole country rather than specific
 * Localities, so Save & Finish must not require Geographical Coverage for them,
 * and their Activities may have no Locality. State Plans keep both rules.
 *
 * PLAN-HQ-GEO-01  HQ Save & Finish with no Localities is accepted
 * PLAN-HQ-GEO-02  HQ Activity without a Locality counts as complete
 * PLAN-HQ-GEO-03  HQ Activity with a Locality outside listed coverage is still rejected
 * PLAN-HQ-GEO-04  State Save & Finish with no Localities → 400 geographical_coverage_required
 * PLAN-HQ-GEO-05  State Activity without a Locality is not complete
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: shared mock handles ──────────────────────────────────────────
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
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));
vi.mock("../lib/plan-registration-session.js", () => ({
  ensureRegistrationSessionTable:  vi.fn().mockResolvedValue(undefined),
  createRegistrationSession:       vi.fn().mockResolvedValue("raw-token-abc"),
  validateRegistrationSession:     vi.fn().mockResolvedValue(true),
  closeRegistrationSession:        vi.fn().mockResolvedValue(undefined),
  revokeRegistrationSessionsByPlan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/reportAuth.js", () => ({
  assertCanViewReport: vi.fn().mockResolvedValue({ ok: false, status: 403, body: { error: "forbidden" } }),
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

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER = {
  id: 1, name: "PM", email: "pm@t.com", role: "program_manager",
  roleLabel: "Programme Manager", scope: "global",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
} as const;

// ── Minimal plan row ──────────────────────────────────────────────────────────
const PLAN_ROW = {
  id: 42, status: "draft", sector: "Health", stateId: null, locationType: "hq",
  title: "Closure Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-HQ-042",
  stateName: null, projectTitle: null, projectId: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: "2026-01-01", endDate: "2026-12-31", description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
  activities: [], linkedRisks: [],
};

// ── App factory ───────────────────────────────────────────────────────────────
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

/** Minimal transaction client that can be extended per-test. */
function mockClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
  opts: { userStatus?: string; userExists?: boolean } = {},
) {
  const { userStatus = "active", userExists = true } = opts;
  const client = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (overrides) {
        const result = overrides(sql, params);
        if (result !== null) return Promise.resolve(result);
      }
      if (sql.includes("SELECT status FROM users")) {
        if (!userExists) return Promise.resolve({ rows: [], rowCount: 0 });
        return Promise.resolve({ rows: [{ status: userStatus }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO plans")) {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO plan_registration_sessions")) {
        return Promise.resolve({ rows: [{ token_hash: "abc" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

/** Standard pool.query mock for HQ plan reads. */
function setupListQuery() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("operational_status AS \"operationalStatus\"")) {
      return Promise.resolve({ rows: [{ id: 5, name: "Kassala", nameAr: "كسلا", code: "KSL", operationalStatus: "active", officeStatus: "present" }] });
    }
    if (sql.includes("code LIKE 'CAFA-PLAN-HQ-%'")) return Promise.resolve({ rows: [] });
    if (sql.includes("code FROM states"))             return Promise.resolve({ rows: [{ code: "KH" }] });
    if (sql.includes("code LIKE $"))                  return Promise.resolve({ rows: [] });
    if (sql.includes("FROM plans pl"))                return Promise.resolve({ rows: [PLAN_ROW] });
    return Promise.resolve({ rows: [] });
  });
}


const ACTIVITY = {
  title: "Coordination workshop",
  localityName: "",
  plannedDate: "2026-03-15",
  priority: "medium",
  targetBeneficiaries: 40,
  budgetPlanned: 1000,
  expectedResult: "Agreed national workplan",
};

function finishBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "National coordination plan",
    planType: "action",
    locationType: "hq",
    responsibleName: "Alice",
    sectors: ["Health"],
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    description: "National-level coordination.",
    currency: "USD",
    budgetPlanned: 5000,
    localities: [],
    activities: [ACTIVITY],
    closeRegistration: true,
    status: "draft",
    ...overrides,
  };
}

describe("HQ Plans and Geographical Coverage — POST /plans Save & Finish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupListQuery();
    mockClient();
  });

  it("PLAN-HQ-GEO-01/02: HQ plan with no Localities and an Activity without a Locality is accepted", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send(finishBody());
    expect(res.body.error).not.toBe("geographical_coverage_required");
    expect(res.body.error).not.toBe("at_least_one_complete_activity_required");
    expect(res.status).toBeLessThan(300);
  });

  it("PLAN-HQ-GEO-03: HQ Activity with a Locality outside the listed coverage is still rejected", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send(finishBody({
      localities: ["Port Sudan"],
      activities: [{ ...ACTIVITY, localityName: "Kassala Town" }],
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("at_least_one_complete_activity_required");
  });

  it("PLAN-HQ-GEO-04: State plan with no Localities → 400 geographical_coverage_required", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send(finishBody({ locationType: undefined, stateId: 5 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("geographical_coverage_required");
  });

  it("PLAN-HQ-GEO-05: State Activity without a Locality is not complete", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).post("/plans").send(finishBody({
      locationType: undefined, stateId: 5, localities: ["Kassala Town"],
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("at_least_one_complete_activity_required");
  });
});
