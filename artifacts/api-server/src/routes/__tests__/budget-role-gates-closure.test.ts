/**
 * BUD-GATE closure suite — explicit endpoint-level role gates (BUD-013).
 *
 * /dashboard/sector-budget is financial-only and rejects non-approved roles.
 * /dashboard/summary and /dashboard/sector-performance retain operational
 * access for authenticated non-Budget roles, with financial data redacted:
 *   ALLOW: super_admin, executive_director, program_manager,
 *          senior_program_coordinator, technical_coordinator, state_program_officer
 *   DENY : state_office_manager, project_officer, program_assistant, viewer
 *
 * Test IDs: BUD-GATE-01 through BUD-GATE-08
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn(),
  },
}));

type FakeUser = {
  id: number; name: string; email: string; role: string;
  stateId: number | null; sector: string | null; sectors: string[];
};

const user = (role: string, extra: Partial<FakeUser> = {}): FakeUser => ({
  id: 1, name: role, email: `${role}@example.com`, role,
  stateId: null, sector: null, sectors: [], ...extra,
});

async function buildApp(currentUser: FakeUser | null) {
  const app = express();
  if (currentUser) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { currentUser: FakeUser }).currentUser = currentUser;
      next();
    });
  }
  // Mirror production ordering: requireAuth runs before the router.
  const { requireAuth } = await import("../../middlewares/currentUser.js");
  const { default: dashboardRouter } = await import("../dashboard.js");
  app.use("/api", requireAuth, dashboardRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

const MIXED_DASHBOARD_ENDPOINTS = [
  "/api/dashboard/summary",
  "/api/dashboard/sector-performance",
];

const FINANCIAL_ONLY_ENDPOINTS = [
  "/api/dashboard/sector-budget",
  "/api/dashboard/donor-portfolio",
  "/api/dashboard/project-budget-performance",
];

const FINANCIAL_KEYS = [
  "totalBudget",
  "totalSpent",
  "budgetRemaining",
  "budgetAllocated",
  "budgetUtilization",
  "burnRatePct",
  "currency",
  "currencyMixed",
  "budgetByCurrency",
] as const;

const DENIED_ROLES = ["state_office_manager", "project_officer", "program_assistant", "viewer"];
const APPROVED_ROLE_CASES: Array<[string, Partial<FakeUser>]> = [
  ["super_admin", {}],
  ["executive_director", {}],
  ["program_manager", {}],
  ["senior_program_coordinator", {}],
  ["technical_coordinator", { sector: "WASH", sectors: ["WASH"] }],
  ["state_program_officer", { stateId: 7 }],
];

beforeEach(() => {
  mockQuery.mockReset();
  // Generic tolerant default so allowed-role requests can complete, with an
  // explicit sector row for field-level redaction assertions.
  mockQuery.mockImplementation((sql: unknown) => {
    const query = String(sql);
    if (query.includes("donor ILIKE")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("FROM project_assignments WHERE user_id = $1")) {
      return Promise.resolve({ rows: [{ project_id: 101 }] });
    }
    if (query.includes('"currencyCount"')) {
      return Promise.resolve({
        rows: [{
          sector: "WASH",
          projects: 1,
          beneficiaries: 10,
          indicatorAchievementPct: 50,
          currencyCount: 1,
          totalBudget: 100,
          totalSpent: 50,
        }],
      });
    }
    if (query.includes("LEFT JOIN donors d ON d.id = p.donor_id") &&
        query.includes("last_financial_update")) {
      const isSpoQuery = query.includes("psa.budget_allocation::float AS psa_allocated");
      return Promise.resolve({
        rows: [{
          id: 101,
          code: "PRJ-101",
          title: "Scoped Project",
          status: "active",
          sector: "WASH",
          budget_total: 1_000,
          currency: "USD",
          donor_id: 1,
          donor_name: "Donor A",
          free_text_donor: "Donor A",
          spent: 250,
          state_ids: [7],
          state_names: ["State Seven"],
          psa_allocated: isSpoQuery ? 400 : null,
          last_financial_update: "2026-08-19",
        }],
      });
    }
    if (query.includes("LEFT JOIN donors d ON d.id = p.donor_id")) {
      return Promise.resolve({
        rows: [{
          id: 101,
          code: "PRJ-101",
          title: "Scoped Project",
          budget_total: 1_000,
          currency: "USD",
          free_text_donor: "Donor A",
          donor_id: 1,
          d_id: 1,
          d_name: "Donor A",
          beneficiaries: 25,
        }],
      });
    }
    if (query.includes("FROM activities WHERE project_id = ANY")) {
      return Promise.resolve({ rows: [{ project_id: 101, spent: 250 }] });
    }
    if (query.includes("project_with_flags")) {
      return Promise.resolve({
        rows: [{
          sector: "WASH",
          currency: "USD",
          projectCount: 1,
          budgetTotal: 1_000,
          allocatedToStates: 400,
          activityPlanned: 300,
          activitySpent: 250,
          hasNoAllocations: 0,
          hasNoActivities: 0,
          overallocatedProjectCount: 0,
          overallocatedAmount: 0,
          overspentProjectCount: 0,
          overspentAmount: 0,
        }],
      });
    }
    if (query.includes("p.sector IS NULL OR p.sector = ''")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("WITH scoped AS")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({
      rows: [{
        active: 3,
        total: 5,
        closed: 1,
        c: 2,
        reached: 120,
        target: 200,
        high: 1,
        open: 4,
        critical: 2,
        submitted: 3,
        pending: 1,
        planned: 10,
        completed: 6,
        proj: 0,
        rep: 0,
        cnt: 1,
        total_budget: 100,
        total_spent: 50,
        spent: 2,
        allocated: 60,
      }],
    });
  });
});

describe("BUD-GATE-01 /dashboard/summary permits non-financial access and redacts finance", () => {
  for (const role of DENIED_ROLES) {
    it(`${role} → 200 without financial keys`, async () => {
      const app = await buildApp(user(role, { stateId: role.startsWith("state") ? 1 : null }));
      const res = await request(app).get("/api/dashboard/summary");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("activeProjects");
      for (const key of FINANCIAL_KEYS) {
        expect(res.body).not.toHaveProperty(key);
      }
    });
  }
});

describe("BUD-GATE-02 financial-only endpoints reject non-approved roles", () => {
  for (const role of DENIED_ROLES) {
    for (const endpoint of FINANCIAL_ONLY_ENDPOINTS) {
      it(`${role} ${endpoint} → exact 403`, async () => {
        const app = await buildApp(user(role, { stateId: role === "state_office_manager" ? 7 : null }));
        const res = await request(app).get(endpoint);
        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: "Access to Budget & Donors requires an approved role.",
        });
      });
    }
  }
});

describe("BUD-GATE-03 /dashboard/sector-performance permits operational access and redacts utilisation", () => {
  for (const role of DENIED_ROLES) {
    it(`${role} → 200 with null financial utilisation`, async () => {
      const app = await buildApp(user(role));
      const res = await request(app).get("/api/dashboard/sector-performance");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.any(Array));
      for (const row of res.body) {
        expect(row).toHaveProperty("sector");
        expect(row).toHaveProperty("budgetUtilizationPct", null);
      }
    });
  }
});

describe("BUD-GATE-04 TC with an assigned sector passes gate, sector-scoped", () => {
  it("receives 200 and the query carries the TC sector restriction", async () => {
    const app = await buildApp(user("technical_coordinator", { sector: "WASH", sectors: ["WASH"] }));
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(c => String(c[0]).includes('"currencyCount"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("p.sector = ANY($1::text[])");
    expect(call![1]).toEqual([["WASH"]]);
  });
});

describe("BUD-GATE-05 TC with no sectors fails closed on scope (past the gate)", () => {
  it("sector-budget returns the empty fail-closed payload, not 403", async () => {
    const app = await buildApp(user("technical_coordinator", { sector: null, sectors: [] }));
    const res = await request(app).get("/api/dashboard/sector-budget");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sectors: [],
      unresolvedSectorProjects: 0,
      unresolvedBudgetByCurrency: {},
    });
  });

  it("sector-performance carries an explicit deny-all SQL predicate", async () => {
    const app = await buildApp(user("technical_coordinator", { sector: null, sectors: [] }));
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(c => String(c[0]).includes('"currencyCount"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("AND FALSE");
    expect(call![1]).toEqual([]);
  });
});

describe("BUD-GATE-06 every approved role retains the complete financial contract", () => {
  for (const [role, extra] of APPROVED_ROLE_CASES) {
    it(`${role} receives all summary financial fields`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/summary");
      expect(res.status).toBe(200);
      for (const key of FINANCIAL_KEYS) {
        expect(res.body).toHaveProperty(key);
      }
      expect(res.body).toMatchObject({
        totalBudget: 5,
        totalSpent: 2,
        budgetRemaining: 3,
        budgetAllocated: 60,
        budgetUtilization: 40,
        burnRatePct: 40,
        currency: null,
        currencyMixed: false,
        budgetByCurrency: [],
      });
    });

    it(`${role} receives financial sector utilisation`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/sector-performance");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          sector: "WASH",
          budgetUtilizationPct: 50,
          mixedCurrencies: false,
        }),
      ]);
    });

    it(`${role} receives the sector-budget financial payload`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/sector-budget");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        sectors: expect.any(Array),
        unresolvedSectorProjects: expect.any(Number),
        unresolvedBudgetByCurrency: expect.any(Object),
      }));
    });

    it(`${role} receives donor budget and spend values`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/donor-portfolio");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          donorId: 1,
          donorName: "Donor A",
          allocatedBudget: 1_000,
          budgetSpent: 250,
          currency: "USD",
          currencyMixed: false,
          budgetByCurrency: [{
            currency: "USD",
            allocatedBudget: 1_000,
            budgetTotal: 1_000,
            budgetSpent: 250,
          }],
        }),
      ]);
    });

    it(`${role} receives the authorised project financial basis`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/project-budget-performance");
      expect(res.status).toBe(200);
      const isSpo = role === "state_program_officer";
      expect(res.body).toEqual([
        expect.objectContaining(isSpo ? {
          projectId: 101,
          budgetBasis: "State Allocation",
          allocatedBudget: 400,
          spent: null,
          remainingBalance: null,
          utilisationRate: null,
          projectLevelSpent: 250,
          stateIds: [7],
        } : {
          projectId: 101,
          budgetBasis: "Project-Level Budget",
          allocatedBudget: 1_000,
          spent: 250,
          remainingBalance: 750,
          utilisationRate: 25,
        }),
      ]);
    });
  }
});

describe("BUD-GATE-07 state roles cannot widen their state scope", () => {
  it("SOM rejects a conflicting stateId filter before operational summary queries run", async () => {
    const app = await buildApp(user("state_office_manager", { stateId: 7 }));
    const res = await request(app).get("/api/dashboard/summary?stateId=999");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "dashboard_state_forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("SPO financial sector-budget rejects a conflicting state filter before data queries run", async () => {
    const app = await buildApp(user("state_program_officer", { stateId: 7 }));
    const res = await request(app).get("/api/dashboard/sector-budget?stateId=999");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "dashboard_state_forbidden" });
    // SPO assignment lookup is necessary to establish scope; no project facts
    // or aggregate data may be queried after the out-of-scope request.
    expect(mockQuery.mock.calls.filter(c => !String(c[0]).includes("project_assignments"))).toHaveLength(0);
  });

  it("TC donor and project financial queries bind only the assigned sector", async () => {
    const tc = user("technical_coordinator", { sector: "WASH", sectors: ["WASH"] });
    let app = await buildApp(tc);
    expect((await request(app).get("/api/dashboard/donor-portfolio")).status).toBe(200);
    let financialQuery = mockQuery.mock.calls.find(c =>
      String(c[0]).includes("LEFT JOIN donors d ON d.id = p.donor_id"),
    );
    expect(financialQuery).toBeDefined();
    expect(String(financialQuery![0])).toContain("p.sector = ANY($1::text[])");
    expect(financialQuery![1]).toEqual([["WASH"]]);

    mockQuery.mockClear();
    app = await buildApp(tc);
    expect((await request(app).get("/api/dashboard/project-budget-performance")).status).toBe(200);
    financialQuery = mockQuery.mock.calls.find(c =>
      String(c[0]).includes("last_financial_update"),
    );
    expect(financialQuery).toBeDefined();
    expect(String(financialQuery![0])).toContain("p.sector = ANY($1::text[])");
    expect(financialQuery![1]).toEqual([["WASH"]]);
  });

  it("SPO donor and project financial queries bind only assigned projects within the assigned state", async () => {
    const spo = user("state_program_officer", { stateId: 7 });
    let app = await buildApp(spo);
    expect((await request(app).get("/api/dashboard/donor-portfolio")).status).toBe(200);
    let financialQuery = mockQuery.mock.calls.find(c =>
      String(c[0]).includes("LEFT JOIN donors d ON d.id = p.donor_id"),
    );
    expect(financialQuery).toBeDefined();
    expect(String(financialQuery![0])).toContain("p.id = ANY($1::int[])");
    expect(String(financialQuery![0])).toContain("_ps.state_id = $2");
    expect(financialQuery![1]).toEqual([expect.any(Array), 7]);

    mockQuery.mockClear();
    app = await buildApp(spo);
    expect((await request(app).get("/api/dashboard/project-budget-performance")).status).toBe(200);
    financialQuery = mockQuery.mock.calls.find(c =>
      String(c[0]).includes("last_financial_update"),
    );
    expect(financialQuery).toBeDefined();
    expect(String(financialQuery![0])).toContain("p.id = ANY($1::int[])");
    expect(String(financialQuery![0])).toContain("_ps.state_id = $2");
    expect(financialQuery![1]).toEqual([expect.any(Array), 7, 7]);
  });
});

describe("BUD-GATE-08 unauthenticated requests get 401 (not 403 or 200)", () => {
  for (const ep of [...MIXED_DASHBOARD_ENDPOINTS, ...FINANCIAL_ONLY_ENDPOINTS]) {
    it(`${ep} → 401`, async () => {
      const app = await buildApp(null);
      const res = await request(app).get(ep);
      expect(res.status).toBe(401);
    });
  }
});
