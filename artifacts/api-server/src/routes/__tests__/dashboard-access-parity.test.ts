/**
 * DASH-ACCESS — Dashboard Non-Financial KPI Access Parity Tests
 *
 * Verifies that:
 *  - Non-financial fields (project counts, risks, reports, activities, beneficiaries)
 *    are accessible to all authenticated roles via /dashboard/summary.
 *  - Financial fields (totalBudget, totalSpent, burnRatePct, budgetByCurrency, etc.)
 *    are absent from responses for non-Budget roles.
 *  - /dashboard/sector-performance is accessible to all authenticated roles;
 *    budgetUtilizationPct is null for non-Budget roles.
 *  - /dashboard/sector-budget gate (requireBudgetDonorsRole) remains unchanged —
 *    SOM/PO/PA still receive 403.
 *  - TC and SPO/SOM responses are properly scoped (sector / state).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";

// ── Stub the database pool ───────────────────────────────────────────────────
const mockRows = {
  proj: [{ active: 3, total: 5, closed: 1 }],
  stateCount: [{ c: 2 }],
  ben: [{ reached: 120, target: 200 }],
  budgetTotal: [{ total: 500_000 }],
  budgetSpent: [{ spent: 200_000 }],
  allocated: [{ allocated: 100_000 }],
  budgetByCurrency: [],
  risks: [{ high: 1 }],
  riskCounts: [{ open: 4, critical: 2 }],
  reportCounts: [{ submitted: 3, pending: 1 }],
  activityCounts: [{ planned: 10, completed: 6 }],
  pending: [{ proj: 0, rep: 0 }],
  delayed: [{ cnt: 1 }],
  byStatus: [{ status: "active", count: 3 }],
  sectorPerf: [
    {
      sector: "Health",
      projects: 3,
      beneficiaries: 120,
      indicatorAchievementPct: 75,
      currencyCount: 1,
      totalBudget: 500000,
      totalSpent: 200000,
    },
  ],
};

const mockQuery = vi.fn(async (
  sql: string,
  _params?: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> => {
  // sector-performance query
  if (sql.includes("p.sector AS sector") && sql.includes('"currencyCount"')) {
    return { rows: mockRows.sectorPerf };
  }
  // project counts
  if (sql.includes("AS active") && sql.includes("AS closed")) {
    return { rows: mockRows.proj };
  }
  // summary financial aggregates
  if (sql.includes("SUM(p.budget_total)") && sql.includes(" AS total")) {
    return { rows: mockRows.budgetTotal };
  }
  if (sql.includes("SUM(a.budget_spent)") && sql.includes(" AS spent")) {
    return { rows: mockRows.budgetSpent };
  }
  if (sql.includes("SUM(psa.budget_allocation)")) {
    return { rows: mockRows.allocated };
  }
  if (sql.includes("WITH scoped AS")) {
    return { rows: mockRows.budgetByCurrency };
  }
  // state count
  if (sql.includes("COUNT(DISTINCT ps.state_id)") || sql.includes("FROM states")) {
    return { rows: mockRows.stateCount };
  }
  // beneficiaries
  if (sql.includes(" AS reached") || sql.includes(" AS target")) {
    return { rows: mockRows.ben };
  }
  // pending approvals
  if (sql.includes(" AS proj") && sql.includes(" AS rep")) {
    return { rows: mockRows.pending };
  }
  // risk states
  if (sql.includes(" AS high") && sql.includes("FROM risks")) {
    return { rows: mockRows.risks };
  }
  // risk counts
  if (sql.includes(" AS open") && sql.includes(" AS critical")) {
    return { rows: mockRows.riskCounts };
  }
  // report counts
  if (sql.includes(" AS submitted") && sql.includes(" AS pending")) {
    return { rows: mockRows.reportCounts };
  }
  // activity counts
  if (sql.includes(" AS planned") && sql.includes(" AS completed")) {
    return { rows: mockRows.activityCounts };
  }
  // delayed
  if (sql.includes("planned_end") && sql.includes(" AS cnt")) {
    return { rows: mockRows.delayed };
  }
  // by status
  if (sql.includes("GROUP BY status")) {
    return { rows: mockRows.byStatus };
  }
  return { rows: [] };
});

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[] | undefined),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
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
];

const NON_FINANCIAL_KEYS = [
  "activeProjects",
  "totalProjects",
  "completedProjects",
  "totalBeneficiaries",
  "criticalRisks",
  "reportsSubmitted",
];

// ── Because we need to dynamically import after vi.mock(), we use a shared app ─
let app: express.Express;
let summaryPath: string;
let sectorPerfPath: string;
let sectorBudgetPath: string;
let sectorSnapshotPath: string;

beforeAll(async () => {
  // Import router after mocks are registered
  const { default: router } = await import("../dashboard");
  const { requireAuth } = await import("../../middlewares/currentUser");
  app = express();
  app.use(express.json());
  // Mirror production ordering: authentication runs before the dashboard router.
  app.use(requireAuth, router);

  summaryPath = "/dashboard/summary";
  sectorPerfPath = "/dashboard/sector-performance";
  sectorBudgetPath = "/dashboard/sector-budget";
  sectorSnapshotPath = "/dashboard/sector-snapshot";
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockQuery.mockClear();
});

// ── Inject user middleware per-request via a wrapper ─────────────────────────
function agentFor(role: string, stateId: number | null = null, sector: string | null = null) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = {
      id: 99,
      name: "Test User",
      email: "test@example.com",
      role,
      roleLabel: role,
      scope: "global",
      stateId,
      stateName: null,
      sector,
      sectors: sector ? [sector] : null,
      avatarUrl: null,
    };
    next();
  });
  testApp.use(app);
  return testApp;
}

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-01: PM (Budget role) → 200 with financial keys present
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-01: PM receives 200 with financial fields", () => {
  it("returns 200 for program_manager on /dashboard/summary", async () => {
    const res = await request(agentFor("program_manager")).get(summaryPath);
    expect(res.status).toBe(200);
  });

  it("financial keys are present in PM response", async () => {
    const res = await request(agentFor("program_manager")).get(summaryPath);
    const body = res.body as Record<string, unknown>;
    for (const key of FINANCIAL_KEYS) {
      expect(key in body, `expected financial key "${key}" to be present`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-02: SOM → 200 with financial fields absent
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-02: SOM receives 200 on /dashboard/summary", () => {
  it("returns 200 (not 403) for state_office_manager", async () => {
    const res = await request(agentFor("state_office_manager", 1)).get(summaryPath);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-03: SOM response includes non-financial counts
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-03: SOM non-financial fields present", () => {
  it("activeProjects, criticalRisks, reportsSubmitted are in SOM response", async () => {
    const res = await request(agentFor("state_office_manager", 1)).get(summaryPath);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    for (const key of NON_FINANCIAL_KEYS) {
      expect(key in body, `expected key "${key}" to be present`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-04: project_officer → 200 with financial fields absent
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-04: project_officer receives 200", () => {
  it("returns 200 for project_officer", async () => {
    const res = await request(agentFor("project_officer")).get(summaryPath);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-05: project_officer response includes non-financial counts
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-05: project_officer non-financial fields present", () => {
  it("activeProjects and criticalRisks are present", async () => {
    const res = await request(agentFor("project_officer")).get(summaryPath);
    const body = res.body as Record<string, unknown>;
    expect("activeProjects" in body).toBe(true);
    expect("criticalRisks" in body).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-06: program_assistant → same as PO
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-06: program_assistant receives 200 with non-financial fields", () => {
  it("returns 200 for program_assistant", async () => {
    const res = await request(agentFor("program_assistant")).get(summaryPath);
    expect(res.status).toBe(200);
  });

  it("non-financial fields are present", async () => {
    const res = await request(agentFor("program_assistant")).get(summaryPath);
    const body = res.body as Record<string, unknown>;
    expect("activeProjects" in body).toBe(true);
    expect("reportsSubmitted" in body).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-07: Unauthenticated → 401
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-07: unauthenticated → 401", () => {
  it("returns 401 when no currentUser", async () => {
    // App with no currentUser injected
    const bareApp = express();
    bareApp.use(express.json());
    bareApp.use(app);
    const res = await request(bareApp).get(summaryPath);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-08: TC → /dashboard/sector-performance 200 with sector fields
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-08: TC → sector-performance 200 with sector fields", () => {
  it("returns 200 for technical_coordinator on sector-performance", async () => {
    const res = await request(agentFor("technical_coordinator", null, "Health")).get(sectorPerfPath);
    expect(res.status).toBe(200);
  });

  it("response includes sector, projects, beneficiaries, indicatorAchievementPct", async () => {
    const res = await request(agentFor("technical_coordinator", null, "Health")).get(sectorPerfPath);
    expect(res.status).toBe(200);
    const body = res.body as unknown[];
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(expect.objectContaining({
      sector: "Health",
      projects: 3,
      beneficiaries: 120,
      indicatorAchievementPct: 75,
      budgetUtilizationPct: 40,
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-09: SOM → project/risk counts are state-scoped (not org-wide)
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-09: SOM response is state-scoped", () => {
  it("rejects an out-of-scope state filter rather than presenting it as an empty population", async () => {
    const res = await request(agentFor("state_office_manager", 1)).get(`${summaryPath}?stateId=99`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "dashboard_state_forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("DASH-861 state-performance filters and scope parity", () => {
  it("applies an HQ stateId filter through the performance Scope", async () => {
    const res = await request(agentFor("program_manager")).get("/dashboard/state-performance?stateId=2");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(([sql]) => String(sql).includes('s.id AS "stateId"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("FROM states s WHERE s.id = $2");
    expect(call![1]).toEqual([2, 2]);
  });

  it("applies a sector filter through the performance Scope", async () => {
    const res = await request(agentFor("program_manager")).get("/dashboard/state-performance?sector=Health");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(([sql]) => String(sql).includes('s.id AS "stateId"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("p.sector = ANY($1::text[])");
    expect(call![1]).toEqual([["Health"]]);
  });

  it("keeps state and sector parameters distinct for combined state-performance filters", async () => {
    const res = await request(agentFor("program_manager"))
      .get("/dashboard/state-performance?stateId=2&sector=Health");
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find(([sql]) => String(sql).includes('s.id AS "stateId"'));
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("p.sector = ANY($2::text[])");
    expect(String(call![0])).toContain("ra.sector = ANY($2::text[])");
    expect(String(call![0])).toContain("FROM states s WHERE s.id = $3");
    expect(call![1]).toEqual([2, ["Health"], 2]);
  });

  it("uses explicit 403 rather than an empty array for a denied state-performance scope", async () => {
    const res = await request(agentFor("state_office_manager")).get("/dashboard/state-performance");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "dashboard_scope_forbidden" });
  });

  it("uses explicit 403 rather than an empty state-performance result for an SPO assignment scope", async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [{ project_id: 101 }] }));
    const res = await request(agentFor("state_program_officer", 7))
      .get("/dashboard/state-performance");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "dashboard_scope_forbidden" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it.each(["donor=UNICEF", "dateFrom=2025-01-01", "dateTo=2025-12-31"])(
    "rejects unsupported state-performance filter %s",
    async (filter) => {
      const res = await request(agentFor("program_manager"))
        .get(`/dashboard/state-performance?${filter}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(expect.objectContaining({ error: "dashboard_invalid_filter" }));
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );
});

describe("DASH-861 summary aggregate authority", () => {
  it("applies an SPO state and assignment clamp to reports, risks, and activities", async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [{ project_id: 101 }] }));
    const res = await request(agentFor("state_program_officer", 7)).get(summaryPath);
    expect(res.status).toBe(200);

    const reportCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM reports r") && String(sql).includes(" AS submitted"),
    );
    expect(String(reportCall?.[0])).toContain("r.state_id = $1");
    expect(String(reportCall?.[0])).toContain("r.project_id = ANY($2::int[])");
    expect(reportCall?.[1]).toEqual([7, [101]]);

    const riskCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM risks rk") && String(sql).includes("SELECT p.id FROM projects p"),
    );
    expect(riskCalls).not.toHaveLength(0);
    for (const call of riskCalls) {
      expect(String(call[0])).toContain("rk.state_id = $2");
      expect(call[1]).toEqual([[101], 7]);
    }

    const activityCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM activities a")
      && String(sql).includes("a.project_id IN")
      && (String(sql).includes("planned_end") || String(sql).includes(" AS planned")),
    );
    expect(activityCalls).not.toHaveLength(0);
    for (const call of activityCalls) {
      expect(String(call[0])).toContain("a.state_id = $2");
      expect(call[1]).toEqual([[101], 7]);
    }

    const spentCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SUM(a.budget_spent)") && String(sql).includes(" AS spent"),
    );
    expect(String(spentCall?.[0])).toContain("a.state_id = $2");
    expect(spentCall?.[1]).toEqual([[101], 7]);

    const allocationCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM project_state_allocations psa"),
    );
    expect(String(allocationCall?.[0])).toContain("psa.state_id = $2");
    expect(allocationCall?.[1]).toEqual([[101], 7]);

    const currencyCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("WITH scoped AS") && String(sql).includes('"totalSpent"'),
    );
    expect(String(currencyCall?.[0])).toContain("a.state_id = $2");
    expect(currencyCall?.[1]).toEqual([[101], 7]);
  });

  it("applies combined state and sector filters to every risk aggregate", async () => {
    const res = await request(agentFor("program_manager"))
      .get(`${summaryPath}?stateId=2&sector=Health`);
    expect(res.status).toBe(200);

    const riskCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM risks rk"),
    );
    expect(riskCalls).toHaveLength(2);
    for (const call of riskCalls) {
      expect(String(call[0])).toContain("SELECT p.id FROM projects p");
      expect(String(call[0])).toContain("p.sector = ANY($2::text[])");
      expect(String(call[0])).toContain("rk.state_id = $1");
      expect(call[1]).toEqual([2, ["Health"]]);
    }
  });

  it("applies donor and date filters to every risk aggregate", async () => {
    const res = await request(agentFor("program_manager"))
      .get(`${summaryPath}?donor=UNICEF&dateFrom=2025-01-01&dateTo=2025-12-31`);
    expect(res.status).toBe(200);

    const riskCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM risks rk"),
    );
    expect(riskCalls).toHaveLength(2);
    for (const call of riskCalls) {
      expect(String(call[0])).toContain("SELECT p.id FROM projects p");
      expect(String(call[0])).toContain("p.donor = $1");
      expect(String(call[0])).toContain("p.end_date >= $2::date");
      expect(String(call[0])).toContain("p.start_date <= $3::date");
      expect(call[1]).toEqual(["UNICEF", "2025-01-01", "2025-12-31"]);
    }
  });

  it("returns genuine numeric zeroes after every aggregate query succeeds", async () => {
    const saved = structuredClone(mockRows);
    try {
      mockRows.proj[0] = { active: 0, total: 0, closed: 0 };
      mockRows.stateCount[0] = { c: 0 };
      mockRows.ben[0] = { reached: 0, target: 0 };
      mockRows.budgetTotal[0] = { total: 0 };
      mockRows.budgetSpent[0] = { spent: 0 };
      mockRows.allocated[0] = { allocated: 0 };
      mockRows.risks[0] = { high: 0 };
      mockRows.riskCounts[0] = { open: 0, critical: 0 };
      mockRows.reportCounts[0] = { submitted: 0, pending: 0 };
      mockRows.activityCounts[0] = { planned: 0, completed: 0 };
      mockRows.pending[0] = { proj: 0, rep: 0 };
      mockRows.delayed[0] = { cnt: 0 };

      const res = await request(agentFor("program_manager")).get(summaryPath);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        activeProjects: 0, totalProjects: 0, completedProjects: 0,
        totalBeneficiaries: 0, criticalRisks: 0, reportsSubmitted: 0,
      }));
    } finally {
      Object.assign(mockRows, saved);
    }
  });

  it("fails the entire summary when an authoritative aggregate has no row", async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [] }));
    const res = await request(agentFor("program_manager")).get(summaryPath);
    expect(res.status).toBe(500);
  });

  it("returns a canonical client-usable error for unsupported filters", async () => {
    const res = await request(agentFor("program_manager")).get(`${summaryPath}?region=north`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ error: "dashboard_invalid_filter" }));
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-10: SOM response body contains NO totalBudget or budgetByCurrency keys
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-10: SOM response excludes financial keys", () => {
  it("totalBudget key is absent from SOM response", async () => {
    const res = await request(agentFor("state_office_manager", 1)).get(summaryPath);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    for (const key of FINANCIAL_KEYS) {
      expect(key in body, `expected financial key "${key}" to be absent`).toBe(false);
    }
  });

  it("PO response also excludes totalBudget", async () => {
    const res = await request(agentFor("project_officer")).get(summaryPath);
    const body = res.body as Record<string, unknown>;
    expect("totalBudget" in body).toBe(false);
  });

  it("PA response also excludes totalBudget", async () => {
    const res = await request(agentFor("program_assistant")).get(summaryPath);
    const body = res.body as Record<string, unknown>;
    expect("totalBudget" in body).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-11: /dashboard/sector-budget → SOM still gets 403
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-11: /dashboard/sector-budget gate unchanged for SOM", () => {
  it("SOM receives 403 on /dashboard/sector-budget", async () => {
    const res = await request(agentFor("state_office_manager", 1)).get(sectorBudgetPath);
    expect(res.status).toBe(403);
  });

  it("project_officer receives 403 on /dashboard/sector-budget", async () => {
    const res = await request(agentFor("project_officer")).get(sectorBudgetPath);
    expect(res.status).toBe(403);
  });

  it("program_assistant receives 403 on /dashboard/sector-budget", async () => {
    const res = await request(agentFor("program_assistant")).get(sectorBudgetPath);
    expect(res.status).toBe(403);
  });

  it("PM (Budget role) can access /dashboard/sector-budget (200)", async () => {
    const res = await request(agentFor("program_manager")).get(sectorBudgetPath);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-12: TC → sector-performance response has required fields
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-12: TC sector-performance response has sector fields", () => {
  it("response rows contain sector, projects, beneficiaries, indicatorAchievementPct", async () => {
    const res = await request(agentFor("technical_coordinator", null, "Health")).get(sectorPerfPath);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        sector: "Health",
        projects: 3,
        beneficiaries: 120,
        indicatorAchievementPct: 75,
      }),
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-13: TC → budgetUtilizationPct is null for TC (financial field)
//   TC is in BUDGET_DONORS_ROLES — so they DO get the field, but after #586
//   the proxy is removed and the value will be null anyway for zero-budget rows.
//   This test verifies non-Budget roles (SOM) get null.
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-13: non-Budget role sector-performance budgetUtilizationPct is null", () => {
  it("SOM sector-performance returns 200 and budgetUtilizationPct is null", async () => {
    const res = await request(agentFor("state_office_manager", 1)).get(sectorPerfPath);
    expect(res.status).toBe(200);
    const body = res.body as unknown[];
    for (const row of body) {
      expect((row as Record<string, unknown>).budgetUtilizationPct).toBeNull();
    }
  });

  it("program_assistant sector-performance returns 200 and budgetUtilizationPct is null", async () => {
    const res = await request(agentFor("program_assistant")).get(sectorPerfPath);
    expect(res.status).toBe(200);
    const body = res.body as unknown[];
    for (const row of body) {
      expect((row as Record<string, unknown>).budgetUtilizationPct).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASH-ACCESS-14: HQ Sector snapshot follows canonical HQSR view scope
// ─────────────────────────────────────────────────────────────────────────────
describe("DASH-ACCESS-14: HQ Sector snapshot access parity", () => {
  it("denies SOM access to the HQ snapshot, even with an assigned state", async () => {
    const res = await request(agentFor("state_office_manager", 1))
      .get(`${sectorSnapshotPath}?sector=Health`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "state_scope_forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("denies SPO access to the HQ snapshot, even with an assigned state", async () => {
    const res = await request(agentFor("state_program_officer", 1))
      .get(`${sectorSnapshotPath}?sector=Health`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "state_scope_forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows a TC to open an assigned sector snapshot", async () => {
    const res = await request(agentFor("technical_coordinator", null, "Health"))
      .get(`${sectorSnapshotPath}?sector=Health`);
    expect(res.status).toBe(200);
  });

  it("denies a TC an out-of-sector snapshot", async () => {
    const res = await request(agentFor("technical_coordinator", null, "Health"))
      .get(`${sectorSnapshotPath}?sector=Education`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "sector_forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each(["program_manager", "senior_program_coordinator", "executive_director", "viewer", "super_admin"])(
    "keeps %s access to an HQ snapshot",
    async (role) => {
      const res = await request(agentFor(role)).get(`${sectorSnapshotPath}?sector=Health`);
      expect(res.status).toBe(200);
    },
  );
});

describe("DASH-RETIREMENT: soft-deleted project population", () => {
  it("keeps active fixture totals while every summary child metric proves an active parent", async () => {
    const res = await request(agentFor("program_manager")).get(summaryPath);
    expect(res.status).toBe(200);
    // These are the active fixture values returned by the harness. Retired
    // project children must not change any existing active-record definitions.
    expect(res.body).toEqual(expect.objectContaining({
      activeProjects: 3,
      totalProjects: 5,
      criticalRisks: 2,
      reportsSubmitted: 3,
    }));

    const sql = (mockQuery.mock.calls as unknown[][]).map((call) => String(call[0] ?? ""));
    const projectPopulation = sql.find((statement) =>
      statement.includes("AS active") && statement.includes("AS closed"),
    );
    expect(projectPopulation).toContain("p.deleted_at IS NULL");

    const riskPopulation = sql.filter((statement) => statement.includes("FROM risks"));
    expect(riskPopulation).not.toHaveLength(0);
    for (const statement of riskPopulation) {
      expect(statement.includes("active_parent.deleted_at IS NULL") || statement.includes("p.deleted_at IS NULL")).toBe(true);
    }

    const reportPopulation = sql.filter((statement) => statement.includes("FROM reports r"));
    expect(reportPopulation).not.toHaveLength(0);
    for (const statement of reportPopulation) {
      expect(statement).toContain("active_parent.deleted_at IS NULL");
    }

    const activityPopulation = sql.filter((statement) => statement.includes("FROM activities a"));
    expect(activityPopulation).not.toHaveLength(0);
    for (const statement of activityPopulation) {
      expect(statement.includes("active_parent.deleted_at IS NULL") || statement.includes("p.deleted_at IS NULL")).toBe(true);
    }
  });
});
