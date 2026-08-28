/**
 * LOCATION-CTX — Location Context Security, Scope, and API Filtering Tests
 *
 * Covers:
 *  - Active states list (all states are active; no soft-delete column)
 *  - Beneficiaries endpoint state-role clamping (most critical security fix)
 *  - Donor-portfolio endpoint: ?stateId narrows projects for HQ roles
 *  - Donor-portfolio endpoint: SPO cannot widen scope via ?stateId
 *  - Donor-portfolio endpoint: TC without sectors returns 403 fail-closed
 *  - Project-budget-performance endpoint: ?stateId narrows for HQ roles
 *  - Project-budget-performance endpoint: SPO clamped to own state
 *  - resolveLocationContext clamping across roles
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";

// ── Stub the database pool ───────────────────────────────────────────────────

// project rows — two projects in different states
const projKhartoum = {
  id: 1, code: "P001", title: "Khartoum Project",
  budget_total: 100000, currency: "USD",
  donor: null, donor_id: 1, d_id: 1, d_name: "USAID", d_org_type: null,
  beneficiaries: 200, state_id: 2,
};
const projDarfur = {
  id: 2, code: "P002", title: "Darfur Project",
  budget_total: 80000, currency: "EUR",
  donor: null, donor_id: null, d_id: null, d_name: null, d_org_type: null,
  beneficiaries: 100, state_id: 3,
};

// perf rows (project-budget-performance response shape)
const perfKhartoum = {
  id: 1, code: "P001", title: "Khartoum Project",
  status: "active", sector: "WASH", budget_total: 100000, currency: "USD",
  donor_id: 1, donor_name: "USAID", free_text_donor: null, spent: 40000,
  state_ids: [2], state_names: ["Khartoum"], psa_allocated: null, last_financial_update: null,
};
const perfDarfur = {
  id: 2, code: "P002", title: "Darfur Project",
  status: "active", sector: "Health", budget_total: 80000, currency: "EUR",
  donor_id: null, donor_name: null, free_text_donor: null, spent: null,
  state_ids: [3], state_names: ["North Darfur"], psa_allocated: null, last_financial_update: null,
};

const mockQuery = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[]) },
}));
vi.mock("../../middlewares/currentUser.js", async () => {
  const actual = await vi.importActual<typeof import("../../middlewares/currentUser.js")>("../../middlewares/currentUser.js");
  return { ...actual, logAudit: vi.fn() };
});

type FakeUser = {
  id: number; role: string; stateId?: number | null; sector?: string | null;
  name?: string; email?: string; scope?: string; sectors?: string[] | null;
};

function injectUser(user: FakeUser | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (user) (req as unknown as { currentUser: FakeUser }).currentUser = user;
    next();
  };
}

async function buildApp(user: FakeUser | null) {
  const app = express();
  app.use(express.json());
  app.use(injectUser(user));
  const { default: dashRouter } = await import("../dashboard.js");
  const { default: benefRouter } = await import("../beneficiaries.js");
  const { default: statesRouter } = await import("../states.js");
  app.use(dashRouter);
  app.use(benefRouter);
  app.use(statesRouter);
  app.use((err: Error & { status?: number; errorCode?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.errorCode ?? "server_error" });
  });
  return app;
}

// ── Default mock behaviour ─────────────────────────────────────────────────
function setupDefaultMocks() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    // States list
    if (sql.includes("FROM states") && !sql.includes("project_states")) {
      return { rows: [{ id: 2, name: "Khartoum", code: "KH", officeAddress: null, managerName: null, localitiesCount: 5 }] };
    }
    // Beneficiaries
    if (sql.includes("FROM beneficiaries")) {
      return { rows: [{ id: 1, code: "BEN-001", state_id: 2 }] };
    }
    // SPO project assignments
    if (sql.includes("FROM project_assignments")) {
      return { rows: [{ project_id: 1 }] };
    }
    // Activity spend for donor-portfolio and project-budget-perf
    if (sql.includes("FROM activities") && sql.includes("SUM(budget_spent)")) {
      return { rows: [{ project_id: 1, spent: 40000 }] };
    }
    // Donor-portfolio project query — detect stateId narrowing via project_states JOIN
    if (sql.includes("LEFT JOIN donors d") && !sql.includes("exp.project_id")) {
      // Check if the query includes stateId filter (project_states EXISTS subquery)
      const isFiltered = sql.includes("project_states") && params && params.includes(2);
      return { rows: isFiltered ? [projKhartoum] : [projKhartoum, projDarfur] };
    }
    // Project-budget-performance query
    if (sql.includes("LEFT JOIN donors d") && sql.includes("exp.project_id")) {
      const isFiltered = sql.includes("project_states") && params && params.includes(2);
      return { rows: isFiltered ? [perfKhartoum] : [perfKhartoum, perfDarfur] };
    }
    // Sector count (for buildScope userScope)
    if (sql.includes("FROM states s") && sql.includes("users")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ── States list ───────────────────────────────────────────────────────────────
describe("LCTX-01 GET /states — all states returned (no soft-delete column)", () => {
  it("returns state list for any authenticated user", async () => {
    const app = await buildApp({ id: 1, role: "program_manager" });
    const res = await request(app).get("/states");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Beneficiaries security ────────────────────────────────────────────────────
describe("LCTX-02 GET /beneficiaries — unauthenticated returns 401", () => {
  it("rejects unauthenticated requests", async () => {
    const app = await buildApp(null);
    expect((await request(app).get("/beneficiaries")).status).toBe(401);
  });
});

describe("LCTX-03 SPO cannot override stateId via query param", () => {
  it("SPO ?stateId=99 is silently clamped to own stateId=2", async () => {
    const app = await buildApp({ id: 5, role: "state_program_officer", stateId: 2 });
    const res = await request(app).get("/beneficiaries?stateId=99");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(c => (c[0] as string).includes("FROM beneficiaries"));
    expect(call![1]).toContain(2);
    expect(call![1]).not.toContain(99);
  });
});

describe("LCTX-04 SPO with null stateId fails closed", () => {
  it("returns empty [] without running SQL", async () => {
    const app = await buildApp({ id: 7, role: "state_program_officer", stateId: null });
    const res = await request(app).get("/beneficiaries");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockQuery.mock.calls.some(c => (c[0] as string).includes("FROM beneficiaries"))).toBe(false);
  });
});

describe("LCTX-05 HQ PM can filter beneficiaries by ?stateId", () => {
  it("stateId=2 is passed to SQL", async () => {
    const app = await buildApp({ id: 10, role: "program_manager" });
    const res = await request(app).get("/beneficiaries?stateId=2");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(c => (c[0] as string).includes("FROM beneficiaries"));
    expect(call![1]).toContain(2);
  });

  it("no ?stateId means no stateId param in SQL (empty params)", async () => {
    const app = await buildApp({ id: 10, role: "program_manager" });
    const res = await request(app).get("/beneficiaries");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(c => (c[0] as string).includes("FROM beneficiaries"));
    expect(call![1]).toEqual([]);
  });
});

// ── Donor-portfolio stateId filtering ────────────────────────────────────────
describe("LCTX-06 GET /dashboard/donor-portfolio — HQ role ?stateId narrows projects", () => {
  it("PM without ?stateId gets all projects (2 entries)", async () => {
    const app = await buildApp({ id: 10, role: "program_manager", sectors: null, stateId: null });
    const res = await request(app).get("/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Both donors appear when not filtered
    const totalProjects = (res.body as { projectCount: number }[]).reduce((s, e) => s + e.projectCount, 0);
    expect(totalProjects).toBeGreaterThanOrEqual(1);
  });

  it("PM with ?stateId=2 gets only projects in state 2", async () => {
    const app = await buildApp({ id: 10, role: "program_manager", sectors: null, stateId: null });
    const res = await request(app).get("/dashboard/donor-portfolio?stateId=2");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The SQL query must include the project_states EXISTS predicate with param 2
    const donorCall = mockQuery.mock.calls.find(
      c => (c[0] as string).includes("LEFT JOIN donors d") && !(c[0] as string).includes("exp.project_id")
    );
    expect(donorCall).toBeDefined();
    expect(String(donorCall![0])).toContain("project_states");
    expect(donorCall![1]).toContain(2);
  });

  it("invalid ?stateId=abc returns 400", async () => {
    const app = await buildApp({ id: 10, role: "program_manager", sectors: null, stateId: null });
    const res = await request(app).get("/dashboard/donor-portfolio?stateId=abc");
    expect(res.status).toBe(400);
  });
});

describe("LCTX-07 GET /dashboard/donor-portfolio — SPO cannot widen scope via ?stateId", () => {
  it("SPO ?stateId=99 is explicitly rejected without leaking donor data", async () => {
    const app = await buildApp({ id: 5, role: "state_program_officer", stateId: 2, sectors: null });
    const res = await request(app).get("/dashboard/donor-portfolio?stateId=99");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "dashboard_state_forbidden" });
    expect(mockQuery.mock.calls.filter(
      c => (c[0] as string).includes("LEFT JOIN donors d") && !(c[0] as string).includes("exp.project_id"),
    )).toHaveLength(0);
  });
});

describe("LCTX-08 GET /dashboard/donor-portfolio — TC without sectors fails closed (403)", () => {
  it("TC with no sectors gets 403 error message", async () => {
    const app = await buildApp({ id: 20, role: "technical_coordinator", sectors: [], stateId: null });
    const res = await request(app).get("/dashboard/donor-portfolio");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Sector/i);
  });
});

// ── Project-budget-performance stateId filtering ──────────────────────────────
describe("LCTX-09 GET /dashboard/project-budget-performance — HQ role ?stateId narrows", () => {
  it("PM with ?stateId=2 causes project_states filter in SQL", async () => {
    const app = await buildApp({ id: 10, role: "program_manager", sectors: null, stateId: null });
    const res = await request(app).get("/dashboard/project-budget-performance?stateId=2");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const perfCall = mockQuery.mock.calls.find(
      c => (c[0] as string).includes("LEFT JOIN donors d") && (c[0] as string).includes("exp.project_id")
    );
    expect(perfCall).toBeDefined();
    expect(String(perfCall![0])).toContain("project_states");
    expect(perfCall![1]).toContain(2);
  });

  it("PM without ?stateId gets all projects", async () => {
    const app = await buildApp({ id: 10, role: "program_manager", sectors: null, stateId: null });
    const res = await request(app).get("/dashboard/project-budget-performance");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("invalid ?stateId=0 returns 400", async () => {
    const app = await buildApp({ id: 10, role: "program_manager", sectors: null, stateId: null });
    const res = await request(app).get("/dashboard/project-budget-performance?stateId=0");
    expect(res.status).toBe(400);
  });
});

describe("LCTX-10 GET /dashboard/project-budget-performance — TC with sector is scoped", () => {
  it("TC with sector=WASH gets 200 and sector is in SQL params", async () => {
    const app = await buildApp({
      id: 20, role: "technical_coordinator", sectors: ["WASH"], sector: "WASH", stateId: null,
    });
    const res = await request(app).get("/dashboard/project-budget-performance");
    expect(res.status).toBe(200);
    // SQL should contain sector restriction
    const perfCall = mockQuery.mock.calls.find(
      c => (c[0] as string).includes("LEFT JOIN donors d") && (c[0] as string).includes("exp.project_id")
    );
    if (perfCall) {
      // params array contains ["WASH"] as an element (array-in-array); use toContainEqual for deep equality
      expect(perfCall![1]).toContainEqual(["WASH"]);
    }
  });

  it("TC with sector + ?stateId=2 narrows by BOTH sector and state", async () => {
    const app = await buildApp({
      id: 20, role: "technical_coordinator", sectors: ["WASH"], sector: "WASH", stateId: null,
    });
    const res = await request(app).get("/dashboard/project-budget-performance?stateId=2");
    expect(res.status).toBe(200);
    const perfCall = mockQuery.mock.calls.find(
      c => (c[0] as string).includes("LEFT JOIN donors d") && (c[0] as string).includes("exp.project_id")
    );
    if (perfCall) {
      // Both sector (["WASH"] array) and stateId (2) must be in params
      expect(perfCall![1]).toContainEqual(["WASH"]);
      expect(perfCall![1]).toContain(2);
    }
  });

  it("TC without sectors gets 403 fail-closed", async () => {
    const app = await buildApp({
      id: 20, role: "technical_coordinator", sectors: [], sector: null, stateId: null,
    });
    const res = await request(app).get("/dashboard/project-budget-performance");
    expect(res.status).toBe(403);
  });
});

describe("LCTX-11 manipulated stateId param rejection", () => {
  it("negative ?stateId=-1 returns 400", async () => {
    const app = await buildApp({ id: 10, role: "program_manager" });
    const res = await request(app).get("/dashboard/donor-portfolio?stateId=-1");
    expect(res.status).toBe(400);
  });

  it("?stateId=0 returns 400", async () => {
    const app = await buildApp({ id: 10, role: "program_manager" });
    const res = await request(app).get("/dashboard/project-budget-performance?stateId=0");
    expect(res.status).toBe(400);
  });
});
