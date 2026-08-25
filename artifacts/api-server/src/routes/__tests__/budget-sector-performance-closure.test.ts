/**
 * BUD-SECTOR closure suite — /dashboard/sector-performance multi-currency safety (BUD-007).
 *
 * Confirms that budgetUtilizationPct is never a cross-currency ratio:
 *  - single-currency sector → correct ratio (overspend >100% preserved)
 *  - mixed-currency sector  → null + mixedCurrencies: true
 *  - zero/null budget or null spend → null (unavailable ≠ 0%)
 *
 * Test IDs: BUD-SECTOR-01 through BUD-SECTOR-05
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

const PM_USER = {
  id: 1, name: "PM", email: "pm@example.com",
  role: "program_manager", stateId: null, sector: null, sectors: [],
};

async function buildApp() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof PM_USER }).currentUser = PM_USER;
    next();
  });
  const { default: dashboardRouter } = await import("../dashboard.js");
  app.use("/api", dashboardRouter);
  return app;
}

/** Mock the sector-performance aggregate query result. */
function mockSectorRows(rows: Record<string, unknown>[]) {
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes('"currencyCount"')) {
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  });
}

const baseRow = {
  sector: "WASH", projects: 3, beneficiaries: 100,
  indicatorAchievementPct: 50,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("BUD-SECTOR-01 single-currency sector returns correct ratio", () => {
  it("computes SUM(spent)/SUM(budget)*100 when exactly one currency", async () => {
    mockSectorRows([{ ...baseRow, currencyCount: 1, totalBudget: 200_000, totalSpent: 50_000 }]);
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body[0].budgetUtilizationPct).toBe(25);
    expect(res.body[0].mixedCurrencies).toBe(false);
  });
});

describe("BUD-SECTOR-02 mixed-currency sector returns null + flag", () => {
  it("never mixes currencies into one ratio", async () => {
    mockSectorRows([{ ...baseRow, currencyCount: 2, totalBudget: 300_000, totalSpent: 90_000 }]);
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body[0].budgetUtilizationPct).toBeNull();
    expect(res.body[0].mixedCurrencies).toBe(true);
  });
});

describe("BUD-SECTOR-03 zero budget yields null (not 0 or NaN)", () => {
  it("single currency, zero total budget → null", async () => {
    mockSectorRows([{ ...baseRow, currencyCount: 1, totalBudget: 0, totalSpent: 0 }]);
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body[0].budgetUtilizationPct).toBeNull();
    expect(res.body[0].mixedCurrencies).toBe(false);
  });
});

describe("BUD-SECTOR-04 null spend with non-zero budget yields null", () => {
  it("no expenditure records → utilisation unavailable, not 0", async () => {
    mockSectorRows([{ ...baseRow, currencyCount: 1, totalBudget: 100_000, totalSpent: null }]);
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body[0].budgetUtilizationPct).toBeNull();
  });
});

describe("BUD-SECTOR-05 overspend >100% preserved for single-currency sectors", () => {
  it("spent > budget stays above 100, not clamped", async () => {
    mockSectorRows([{ ...baseRow, currencyCount: 1, totalBudget: 100_000, totalSpent: 150_000 }]);
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/sector-performance");
    expect(res.status).toBe(200);
    expect(res.body[0].budgetUtilizationPct).toBe(150);
  });
});
