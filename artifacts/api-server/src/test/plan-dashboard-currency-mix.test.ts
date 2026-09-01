/**
 * PLAN-CURRENCY-MIX — GET /plans/dashboard previously summed budget_planned/
 * budget_actual across every contributing Plan regardless of currency (USD/
 * SDG/EUR/AED, or NULL on drafts) into one combined burnRatePct/budgetPlanned/
 * budgetActual figure. The same defect class was already fixed for the
 * Projects dashboard's budget summary (DEFECT-05): totals are now grouped by
 * Plan currency, and the combined figures are only ever returned when every
 * contributing Plan shares one currency — a per-currency breakdown
 * (budgetByCurrency) is always returned so no information is lost when mixed.
 *
 * burnRatePct also now follows the same null-vs-zero convention as
 * budget-presentation.ts's projectBurnRate: null (not 0) when the relevant
 * planned amount is not positive, so "no budget" is never displayed as "0%
 * spent".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery, connect: vi.fn() } }));
vi.mock("../lib/realtime.js", () => ({ realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() } }));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
  createNotification:        vi.fn().mockResolvedValue(undefined),
  notifyEntityActors:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/objectStorage.js", () => ({ deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }), objectStorageService: {} }));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:          vi.fn().mockResolvedValue(undefined),
    requirePerm:       () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

const PM_USER = { id: 1, name: "PM", email: "pm@t.com", role: "program_manager", roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;

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

/** Wires the per-currency breakdown query; everything else returns empty rows. */
function setupCurrencyRows(rows: Array<{ currency: string; planned: number; actual: number }>) {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("GROUP BY pl.currency")) return Promise.resolve({ rows });
    return Promise.resolve({ rows: [] });
  });
}

describe("PLAN-CURRENCY-MIX: /plans/dashboard budget totals are currency-safe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a single currency's combined totals are returned as before, with a null (not 0) burnRatePct when planned is 0", async () => {
    setupCurrencyRows([{ currency: "USD", planned: 0, actual: 0 }]);
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.totals.currency).toBe("USD");
    expect(res.body.totals.currencyMixed).toBe(false);
    expect(res.body.totals.budgetPlanned).toBe(0);
    expect(res.body.totals.burnRatePct).toBeNull();
  });

  it("a single currency with real spend still returns a real percentage", async () => {
    setupCurrencyRows([{ currency: "SDG", planned: 200, actual: 50 }]);
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/dashboard");

    expect(res.body.totals.currency).toBe("SDG");
    expect(res.body.totals.budgetPlanned).toBe(200);
    expect(res.body.totals.budgetActual).toBe(50);
    expect(res.body.totals.burnRatePct).toBe(25);
  });

  it("mixed currencies null out the combined figures and expose the per-currency breakdown", async () => {
    setupCurrencyRows([
      { currency: "USD", planned: 1000, actual: 400 },
      { currency: "SDG", planned: 500000, actual: 100000 },
    ]);
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/dashboard");

    expect(res.body.totals.currencyMixed).toBe(true);
    expect(res.body.totals.currency).toBeNull();
    expect(res.body.totals.budgetPlanned).toBeNull();
    expect(res.body.totals.budgetActual).toBeNull();
    expect(res.body.totals.burnRatePct).toBeNull();
    expect(res.body.totals.budgetByCurrency).toEqual([
      { currency: "USD", budgetPlanned: 1000, budgetActual: 400, burnRatePct: 40 },
      { currency: "SDG", budgetPlanned: 500000, budgetActual: 100000, burnRatePct: 20 },
    ]);
  });

  it("no Plan currency data at all (e.g. only drafts) returns zero totals, not null, with an empty breakdown", async () => {
    setupCurrencyRows([]);
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/dashboard");

    expect(res.body.totals.currencyMixed).toBe(false);
    expect(res.body.totals.currency).toBeNull();
    expect(res.body.totals.budgetPlanned).toBe(0);
    expect(res.body.totals.budgetActual).toBe(0);
    expect(res.body.totals.burnRatePct).toBeNull();
    expect(res.body.totals.budgetByCurrency).toEqual([]);
  });

  it("the TC-empty-sector short-circuit response also carries the null-safe currency shape", async () => {
    const app = await buildApp({ ...PM_USER, role: "technical_coordinator", sector: null, sectors: [] });
    const res = await request(app).get("/plans/dashboard");

    expect(res.body.totals.burnRatePct).toBeNull();
    expect(res.body.totals.currency).toBeNull();
    expect(res.body.totals.currencyMixed).toBe(false);
    expect(res.body.totals.budgetByCurrency).toEqual([]);
  });
});
