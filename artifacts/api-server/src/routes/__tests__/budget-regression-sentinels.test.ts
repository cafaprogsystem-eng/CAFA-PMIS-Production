/**
 * BUD-REG — Budget Dashboard Regression Sentinel Suite (BUD-REG-01 … BUD-REG-12)
 *
 * Durable, named sentinels closing the Budget/Dashboard regression gate.
 * Each sentinel proves an EXACT security or semantics boundary using the
 * canonical merged role set and the current route/field contract. No truthy,
 * wildcard-status, or status-only assertions are permitted here.
 *
 * Canonical financial role set (BUDGET_DONORS_ROLES):
 *   super_admin, executive_director, program_manager,
 *   senior_program_coordinator, technical_coordinator, state_program_officer
 * Excluded (authenticated but non-financial):
 *   state_office_manager, project_officer, program_assistant, viewer
 *
 * Sentinel map (cross-references — do NOT duplicate the referenced suites):
 *   BUD-REG-01  Financial-only endpoints: exact 403 body for every excluded role
 *   BUD-REG-02  /dashboard/summary: all nine financial keys structurally ABSENT
 *               for excluded roles (exact key-absence, not value redaction)
 *   BUD-REG-03  /dashboard/summary: operational fields present for excluded roles
 *   BUD-REG-04  /dashboard/summary: every approved role receives the complete
 *               financial contract with exact values
 *   BUD-REG-05  /dashboard/sector-performance: stable-row redaction —
 *               budgetUtilizationPct === null for excluded roles, exact numeric
 *               value for approved roles
 *   BUD-REG-06  Unauthenticated → exact 401 on all five dashboard endpoints
 *   BUD-REG-07  TC sector clamp: exact SQL predicate + exact bound params;
 *               empty-sector TC yields deny-all/f ail-closed payloads
 *   BUD-REG-08  State clamp: SOM/SPO cannot widen state via query params —
 *               exact bound parameters, attacker stateId never bound
 *   BUD-REG-09  Multi-currency portfolio semantics governed by BUD-SECTOR-01..05
 *               (cross-reference) + direct exact mixed-currency null assertion
 *   BUD-REG-10  Zero-budget / null-spend / overspend semantics (BUD-SECTOR-03/04/05
 *               cross-reference) confirmed from the BUD-REG perspective
 *   BUD-REG-11  State budget-utilisation proxy permanently null (BUD-004 /
 *               BUD-BD-04) — confirmed here AND in BUD-STATE-01..10
 *   BUD-REG-12  Allocation currency inherits Project currency (BUD-BD-02):
 *               no allocation currency column, no FX conversion in cap path
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
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

// Canonical role sets — must stay in exact lockstep with BUDGET_DONORS_ROLES
// in routes/dashboard.ts. Changing either without the other fails BUD-REG-01/04.
const EXCLUDED_ROLES = ["state_office_manager", "project_officer", "program_assistant", "viewer"] as const;
const APPROVED_ROLE_CASES: Array<[string, Partial<FakeUser>]> = [
  ["super_admin", {}],
  ["executive_director", {}],
  ["program_manager", {}],
  ["senior_program_coordinator", {}],
  ["technical_coordinator", { sector: "WASH", sectors: ["WASH"] }],
  ["state_program_officer", { stateId: 7 }],
];

const FINANCIAL_ONLY_ENDPOINTS = [
  "/api/dashboard/sector-budget",
  "/api/dashboard/donor-portfolio",
  "/api/dashboard/project-budget-performance",
] as const;

const ALL_DASHBOARD_ENDPOINTS = [
  "/api/dashboard/summary",
  "/api/dashboard/sector-performance",
  ...FINANCIAL_ONLY_ENDPOINTS,
] as const;

// The exact nine summary financial properties (response-boundary contract).
const FINANCIAL_KEYS = [
  "totalBudget", "totalSpent", "budgetRemaining", "budgetAllocated",
  "budgetUtilization", "burnRatePct", "currency", "currencyMixed", "budgetByCurrency",
] as const;

const OPERATIONAL_KEYS = [
  "activeProjects", "totalProjects", "completedProjects", "statesCount",
  "totalBeneficiaries", "openRisks", "criticalRisks", "reportsSubmitted",
  "reportsPending", "activitiesPlanned", "activitiesCompleted",
] as const;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: unknown) => {
    const query = String(sql);
    if (query.includes("donor ILIKE")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("FROM project_assignments WHERE user_id = $1")) {
      // SPO dashboard scope is assignment-scoped. Return a real assignment
      // shape so the test verifies that scope rather than an undefined mock.
      return Promise.resolve({ rows: [{ project_id: 101 }] });
    }
    if (query.includes('"currencyCount"')) {
      return Promise.resolve({
        rows: [{
          sector: "WASH", projects: 1, beneficiaries: 10,
          indicatorAchievementPct: 50, currencyCount: 1,
          totalBudget: 100, totalSpent: 50,
        }],
      });
    }
    if (query.includes("LEFT JOIN donors d ON d.id = p.donor_id") &&
        query.includes("last_financial_update")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("LEFT JOIN donors d ON d.id = p.donor_id")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("project_with_flags")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("p.sector IS NULL OR p.sector = ''")) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes("WITH scoped AS")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({
      rows: [{
        active: 3, total: 5, closed: 1, c: 2, reached: 120, target: 200,
        high: 1, open: 4, critical: 2, submitted: 3, pending: 1,
        planned: 10, completed: 6, proj: 0, rep: 0, cnt: 1,
        total_budget: 100, total_spent: 50, spent: 2, allocated: 60,
      }],
    });
  });
});

// ── BUD-REG-01 ───────────────────────────────────────────────────────────────
describe("BUD-REG-01 financial-only endpoints return the exact 403 denial for every excluded role", () => {
  for (const role of EXCLUDED_ROLES) {
    for (const endpoint of FINANCIAL_ONLY_ENDPOINTS) {
      it(`${role} ${endpoint} → status 403 with the exact denial body`, async () => {
        const app = await buildApp(user(role, { stateId: role.startsWith("state") ? 7 : null }));
        const res = await request(app).get(endpoint);
        expect(res.status).toBe(403);
        // Exact body equality — cannot be weakened to a status-only check.
        expect(res.body).toEqual({ error: "Access to Budget & Donors requires an approved role." });
        // The gate must run BEFORE any data query: no financial SQL executed.
        const financialSql = mockQuery.mock.calls
          .map((c) => String(c[0]))
          // dashboard.ts runs a one-off module-load data-quality diagnostic
          // (DEFECT-07, "donor ILIKE") that is not request-driven — exclude it.
          .filter((s) => !s.includes("donor ILIKE"))
          .filter((s) => s.includes("budget") || s.includes("donor"));
        expect(financialSql).toEqual([]);
      });
    }
  }
});

// ── BUD-REG-02 ───────────────────────────────────────────────────────────────
describe("BUD-REG-02 summary financial properties are structurally ABSENT for excluded roles", () => {
  for (const role of EXCLUDED_ROLES) {
    it(`${role} → 200 with none of the nine financial keys present (absence, not null)`, async () => {
      const app = await buildApp(user(role, { stateId: role.startsWith("state") ? 1 : null }));
      const res = await request(app).get("/api/dashboard/summary");
      expect(res.status).toBe(200);
      const presentFinancialKeys = FINANCIAL_KEYS.filter((k) =>
        Object.prototype.hasOwnProperty.call(res.body, k));
      // Exact structural boundary: the KEYS themselves must not exist —
      // a null/false/empty redacted VALUE would still fail this assertion.
      expect(presentFinancialKeys).toEqual([]);
    });
  }
});

// ── BUD-REG-03 ───────────────────────────────────────────────────────────────
describe("BUD-REG-03 excluded roles retain the full operational summary contract", () => {
  for (const role of EXCLUDED_ROLES) {
    it(`${role} → 200 with every operational key present`, async () => {
      const app = await buildApp(user(role, { stateId: role.startsWith("state") ? 1 : null }));
      const res = await request(app).get("/api/dashboard/summary");
      expect(res.status).toBe(200);
      const missingOperationalKeys = OPERATIONAL_KEYS.filter((k) =>
        !Object.prototype.hasOwnProperty.call(res.body, k));
      expect(missingOperationalKeys).toEqual([]);
      expect(res.body).toMatchObject({ activeProjects: 3, totalProjects: 5, criticalRisks: 2 });
    });
  }
});

// ── BUD-REG-04 ───────────────────────────────────────────────────────────────
describe("BUD-REG-04 every approved role receives the exact complete financial contract", () => {
  for (const [role, extra] of APPROVED_ROLE_CASES) {
    it(`${role} → summary carries all nine financial keys with exact values`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/summary");
      expect(res.status).toBe(200);
      const missingFinancialKeys = FINANCIAL_KEYS.filter((k) =>
        !Object.prototype.hasOwnProperty.call(res.body, k));
      expect(missingFinancialKeys).toEqual([]);
      expect(res.body).toMatchObject({
        totalBudget: 5, totalSpent: 2, budgetRemaining: 3, budgetAllocated: 60,
        budgetUtilization: 40, burnRatePct: 40,
        currency: null, currencyMixed: false, budgetByCurrency: [],
      });
    });
  }
});

// ── BUD-REG-05 ───────────────────────────────────────────────────────────────
describe("BUD-REG-05 sector-performance stable-row redaction boundary", () => {
  for (const role of EXCLUDED_ROLES) {
    it(`${role} → 200 rows with budgetUtilizationPct === null (present but redacted)`, async () => {
      const app = await buildApp(user(role));
      const res = await request(app).get("/api/dashboard/sector-performance");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({ sector: "WASH", projects: 1, beneficiaries: 10 }),
      ]);
      // Exact: the property must exist and be strictly null (stable row shape).
      expect(Object.prototype.hasOwnProperty.call(res.body[0], "budgetUtilizationPct")).toBe(true);
      expect(res.body[0].budgetUtilizationPct).toBeNull();
    });
  }
  for (const [role, extra] of APPROVED_ROLE_CASES) {
    it(`${role} → exact authorised utilisation value 50`, async () => {
      const app = await buildApp(user(role, extra));
      const res = await request(app).get("/api/dashboard/sector-performance");
      expect(res.status).toBe(200);
      expect(res.body[0].budgetUtilizationPct).toBe(50);
      expect(res.body[0].mixedCurrencies).toBe(false);
    });
  }
});

// ── BUD-REG-06 ───────────────────────────────────────────────────────────────
describe("BUD-REG-06 unauthenticated requests receive exact 401 on all dashboard endpoints", () => {
  for (const endpoint of ALL_DASHBOARD_ENDPOINTS) {
    it(`unauthenticated ${endpoint} → 401 (never 200, never 403)`, async () => {
      const app = await buildApp(null);
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(401);
    });
  }
});

// ── BUD-REG-07 ───────────────────────────────────────────────────────────────
describe("BUD-REG-07 TC sector clamp is bound in SQL; empty-sector TC fails closed", () => {
  it("assigned-sector TC: sector-performance query binds exactly [['WASH']]", async () => {
    const app = await buildApp(user("technical_coordinator", { sector: "WASH", sectors: ["WASH"] }));
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find((c) => String(c[0]).includes('"currencyCount"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("p.sector = ANY($1::text[])");
    expect(call![1]).toEqual([["WASH"]]);
  });

  it("empty-sector TC: sector-budget returns the exact fail-closed payload", async () => {
    const app = await buildApp(user("technical_coordinator", { sector: null, sectors: [] }));
    const res = await request(app).get("/api/dashboard/sector-budget");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sectors: [], unresolvedSectorProjects: 0, unresolvedBudgetByCurrency: {},
    });
  });

  it("empty-sector TC: sector-performance query carries an explicit deny-all predicate", async () => {
    const app = await buildApp(user("technical_coordinator", { sector: null, sectors: [] }));
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find((c) => String(c[0]).includes('"currencyCount"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("AND FALSE");
    expect(call![1]).toEqual([]);
  });
});

// ── BUD-REG-08 ───────────────────────────────────────────────────────────────
describe("BUD-REG-08 state roles cannot widen their state via query parameters", () => {
  it("SOM summary with ?stateId=999 binds only the assigned state 7", async () => {
    const app = await buildApp(user("state_office_manager", { stateId: 7 }));
    const res = await request(app).get("/api/dashboard/summary?stateId=999");
    expect(res.status).toBe(200);
    const projectCountCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("AS active") && String(c[0]).includes("AS closed"));
    expect(projectCountCall).toBeDefined();
    expect(String(projectCountCall![0])).toContain("_ps.state_id = $1");
    expect(projectCountCall![1]).toEqual([7]);
    // The attacker-supplied state must never be bound anywhere.
    expect(JSON.stringify(mockQuery.mock.calls)).not.toContain("999");
  });

  it("SPO sector-budget with ?stateId=999 binds only the assigned state 7", async () => {
    const app = await buildApp(user("state_program_officer", { stateId: 7 }));
    const res = await request(app).get("/api/dashboard/sector-budget?stateId=999");
    expect(res.status).toBe(200);
    const sectorQuery = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("GROUP BY sector, currency"));
    expect(sectorQuery).toBeDefined();
    expect(sectorQuery![1]).toEqual([null, null, null, 7, null, null, [101], 7]);
    expect(JSON.stringify(mockQuery.mock.calls)).not.toContain("999");
  });
});

// ── BUD-REG-09 ───────────────────────────────────────────────────────────────
describe("BUD-REG-09 multi-currency portfolio semantics (governed by BUD-SECTOR-01..05)", () => {
  it("cross-reference: the authoritative BUD-SECTOR suite exists and pins mixed-currency null", () => {
    const suitePath = resolve(import.meta.dirname, "budget-sector-performance-closure.test.ts");
    expect(existsSync(suitePath)).toBe(true);
    const src = readFileSync(suitePath, "utf8");
    for (const id of ["BUD-SECTOR-01", "BUD-SECTOR-02", "BUD-SECTOR-03", "BUD-SECTOR-04", "BUD-SECTOR-05"]) {
      expect(src).toContain(id);
    }
  });

  it("direct: a mixed-currency sector yields budgetUtilizationPct === null + mixedCurrencies: true", async () => {
    mockQuery.mockImplementation((sql: unknown) => {
      if (String(sql).includes('"currencyCount"')) {
        return Promise.resolve({
          rows: [{
            sector: "Health", projects: 2, beneficiaries: 40,
            indicatorAchievementPct: 60, currencyCount: 2,
            totalBudget: 300_000, totalSpent: 90_000,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(user("program_manager"));
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body[0].budgetUtilizationPct).toBeNull();
    expect(res.body[0].mixedCurrencies).toBe(true);
  });
});

// ── BUD-REG-10 ───────────────────────────────────────────────────────────────
describe("BUD-REG-10 zero-budget, null-spend and overspend semantics (BUD-SECTOR-03/04/05)", () => {
  const cases: Array<[string, { totalBudget: number | null; totalSpent: number | null }, number | null]> = [
    ["zero budget → null (unavailable ≠ 0%)", { totalBudget: 0, totalSpent: 0 }, null],
    ["null spend → null (unavailable ≠ 0%)", { totalBudget: 100_000, totalSpent: null }, null],
    ["overspend preserved above 100%", { totalBudget: 100_000, totalSpent: 150_000 }, 150],
  ];
  for (const [name, fin, expected] of cases) {
    it(name, async () => {
      mockQuery.mockImplementation((sql: unknown) => {
        if (String(sql).includes('"currencyCount"')) {
          return Promise.resolve({
            rows: [{
              sector: "WASH", projects: 1, beneficiaries: 5,
              indicatorAchievementPct: 10, currencyCount: 1, ...fin,
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });
      const app = await buildApp(user("program_manager"));
      const res = await request(app).get("/api/dashboard/sector-performance");
      expect(res.status).toBe(200);
      expect(res.body[0].budgetUtilizationPct).toBe(expected);
    });
  }
});

// ── BUD-REG-11 ───────────────────────────────────────────────────────────────
describe("BUD-REG-11 State budget-utilisation proxy is permanently null (BUD-004 / BUD-BD-04)", () => {
  it("computeStateScores returns budgetUtilizationPct === null and a null budget component", async () => {
    const { computeStateScores } = await import("../../services/performanceEngine.js");
    const capturedQueries: string[] = [];
    const capturingPool = {
      query: async (sql: string) => {
        capturedQueries.push(sql);
        return {
          rows: [{
            stateId: 1, stateName: "Test State", activeProjects: 1, beneficiaries: 0,
            budgetUtilizationPct: null, progressPct: 0, riskLevel: "low",
            openRisks: 0, criticalRisks: 0, critOnlyRisks: 0, highOnlyRisks: 0,
            medLowRisks: 0, reportsSubmitted: 0, reportsPending: 0,
            reportsApproved: 0, lateReports: 0, activityCompletionPct: null,
            reportingCompliancePct: null, indicatorAchievementPct: null,
            totalProjects: 1, hasBudget: 0, hasActivities: 0, hasReports: 0, hasTargets: 0,
          }],
        };
      },
    } as unknown as import("../../services/performanceEngine.js").PgPool;

    const rows = await computeStateScores(capturingPool, { stateId: null, sectors: null });
    // Exact null — not undefined, not 0, not a proxy value.
    expect(rows[0]?.budgetUtilizationPct).toBeNull();
    expect(rows[0]?.components.budgetUtilization).toBeNull();
    // No proxy SQL may reappear.
    const allSql = capturedQueries.join("\n");
    expect(allSql).not.toContain("SUM(p.budget_total)");
    expect(allSql).not.toContain("budget_spent");
    expect(allSql).toContain('NULL::int AS "budgetUtilizationPct"');
  });

  it("cross-reference: BUD-STATE-01..10 sentinel suite exists and pins the same contract", () => {
    const suitePath = resolve(
      import.meta.dirname, "../../services/__tests__/performance-engine-state-budget.test.ts");
    expect(existsSync(suitePath)).toBe(true);
    const src = readFileSync(suitePath, "utf8");
    for (const id of ["BUD-STATE-01", "BUD-STATE-04", "BUD-STATE-10"]) {
      expect(src).toContain(id);
    }
  });
});

// ── BUD-REG-12 ───────────────────────────────────────────────────────────────
describe("BUD-REG-12 allocation currency inherits the Project currency (BUD-BD-02)", () => {
  it("project_state_allocations schema has NO currency column", () => {
    const schemaSrc = readFileSync(
      resolve(import.meta.dirname, "../../../../../lib/db/src/schema/index.ts"), "utf8");
    const start = schemaSrc.indexOf("projectStateAllocationsTable");
    expect(start).toBeGreaterThan(-1);
    const tableBlock = schemaSrc.slice(start, schemaSrc.indexOf("});", start));
    expect(tableBlock).toContain("budget_allocation");
    // No independent allocation currency exists.
    expect(tableBlock).not.toContain("currency");
  });

  it("the allocation cap compares amounts to the project budget with no FX conversion", () => {
    const projectsSrc = readFileSync(resolve(import.meta.dirname, "../projects.ts"), "utf8");
    // Unconditional same-unit comparisons (BUD-CAP-14 lockstep).
    expect(projectsSrc).toContain("allocTotal > projectBudget");
    expect(projectsSrc).toContain("patchAllocTotal > patchEffectiveBudget");
    // No FX machinery anywhere in the write path.
    expect(projectsSrc.toLowerCase()).not.toContain("exchangerate");
    expect(projectsSrc.toLowerCase()).not.toContain("fxrate");
    expect(projectsSrc.toLowerCase()).not.toContain("convertcurrency");
  });
});
