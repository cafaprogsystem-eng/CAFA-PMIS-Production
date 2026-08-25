/**
 * Risk Register — Pagination API Contract (RISK-PAGE-02/03/05/07/08)
 * Route-level tests for GET /risks pagination behaviour.
 * British English throughout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => {
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  return { pool: { query: mockPoolQuery } };
});
vi.mock("../../lib/notifications", () => ({
  notifyEntityActors: vi.fn(),
  notifyByRole: vi.fn(),
  createNotification: vi.fn(),
  createNotificationDeduped: vi.fn(),
}));
vi.mock("../../lib/due-date-checker", () => ({ checkAllDueDates: vi.fn() }));
vi.mock("../../lib/realtime", () => ({ realtime: { broadcastUpdate: vi.fn() } }));

import risksRouter from "../risks";
import { type CurrentUser } from "../../middlewares/currentUser";

function user(over: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1, name: "Test", email: "t@t.t", role: "program_manager", roleLabel: "PM",
    scope: "org", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
    ...over,
  } as CurrentUser;
}

function appAs(u: CurrentUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = u;
    next();
  });
  app.use(risksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { name?: string; status?: number; message?: string };
    res.status(e?.status ?? 500).json({ error: e?.message ?? "internal" });
  });
  return app;
}

/** A realistic risk data row (returned by the main SELECT query). */
function makeRiskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "Risk A", description: null, category: "operational",
    severity: "medium", likelihood: "possible", impact: "moderate",
    status: "open", stateId: null, projectId: null,
    assignedToId: null, dueDate: null, identifiedAt: new Date("2026-01-15"),
    updatedAt: new Date(),
    stateName: null, projectTitle: null, assignedToName: null,
    mitigationPlan: null, followUpDate: null, planId: null, planActivityId: null,
    locationType: "hq",
    ...overrides,
  };
}

/** A count row as returned by `riskCountSelect` (COUNT(*)::text AS total). */
function makeCountRow(total: string | number = "5") {
  return { total: String(total) };
}

/**
 * Sets up mock DB responses. The risks route now runs TWO queries in parallel:
 *   1. `riskSummarySelect` — matches "COUNT(*)::text AS total" (returns total + breakdown)
 *   2. `riskSelect`        — matches "r.identified_at AS" (returns data rows)
 */
function routeQueries(options: {
  total?: string | number;
  open?: number;
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  dataRows?: unknown[];
} = {}) {
  const { total = "5", open = 1, critical = 0, high = 0, medium = 1, low = 0, dataRows = [makeRiskRow()] } = options;
  mockPoolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*)::text AS total")) {
      return { rows: [{ total: String(total), open, critical, high, medium, low }], rowCount: 1 };
    }
    if (sql.includes("r.identified_at AS")) {
      return { rows: dataRows, rowCount: dataRows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── RISK-PAGE-01/05: Paginated envelope shape ─────────────────────────────────
describe("RISK-PAGE-01/05: GET /risks returns paginated envelope", () => {
  it("returns items, total, page, limit, totalPages, summary in the response", async () => {
    routeQueries({ total: "3", critical: 1, high: 1, medium: 1, low: 0, open: 2, dataRows: [makeRiskRow(), makeRiskRow({ id: 2 }), makeRiskRow({ id: 3 })] });
    const res = await supertest(appAs(user())).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("limit");
    expect(res.body).toHaveProperty("totalPages");
    expect(res.body).toHaveProperty("summary");
    expect(res.body.summary).toMatchObject({ open: 2, critical: 1, high: 1, medium: 1, low: 0 });
  });

  it("total reflects the full count, not just the page's item count", async () => {
    // 10 total risks, only 5 on this page
    const dataRows = Array.from({ length: 5 }, (_, i) => makeRiskRow({ id: i + 1 }));
    routeQueries({ total: "10", dataRows });
    const res = await supertest(appAs(user())).get("/risks?limit=5&page=1");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.items).toHaveLength(5);
  });
});

// ── RISK-PAGE-02: Next page — page param accepted ────────────────────────────
describe("RISK-PAGE-02: requesting page 2 returns correct envelope", () => {
  it("accepts page=2 and returns page 2 in envelope", async () => {
    routeQueries({ total: "100", dataRows: [makeRiskRow({ id: 51 })] });
    const res = await supertest(appAs(user())).get("/risks?page=2&limit=50");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
  });
});

// ── RISK-PAGE-03: Previous page — page=1 after page=2 ───────────────────────
describe("RISK-PAGE-03: page 1 request returns page=1 in envelope", () => {
  it("page=1 is reflected in envelope", async () => {
    routeQueries({ total: "5" });
    const res = await supertest(appAs(user())).get("/risks?page=1&limit=50");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});

// ── RISK-PAGE-04: Single page — totalPages=1 ─────────────────────────────────
describe("RISK-PAGE-04: single page result has totalPages=1", () => {
  it("when fewer items than limit, totalPages is 1", async () => {
    routeQueries({ total: "3", dataRows: [makeRiskRow(), makeRiskRow({ id: 2 })] });
    const res = await supertest(appAs(user())).get("/risks?limit=50");
    expect(res.status).toBe(200);
    expect(res.body.totalPages).toBe(1);
  });

  it("empty result has total=0, items=[] and no pagination pages", async () => {
    routeQueries({ total: "0", dataRows: [] });
    const res = await supertest(appAs(user())).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
    // Math.ceil(0/limit) = 0; frontend handles totalPages<=1 by hiding controls
    expect(res.body.totalPages).toBe(0);
  });
});

// ── RISK-PAGE-07: Actor-scoped total ─────────────────────────────────────────
describe("RISK-PAGE-07: actor-scoped count returned in total", () => {
  it("TC actor with sector scope: total comes from scoped DB count", async () => {
    routeQueries({ total: "2", dataRows: [makeRiskRow()] });
    const tc = user({ role: "technical_coordinator", sector: "health", scope: "sector" });
    const res = await supertest(appAs(tc)).get("/risks");
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
  });

  it("PM (org scope) returns exact total from DB count envelope", async () => {
    routeQueries({ total: "42", dataRows: [makeRiskRow()] });
    const pm = user({ role: "program_manager", scope: "org" });
    const res = await supertest(appAs(pm)).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(42);
  });
});

// ── RISK-PAGE-08: Ordering preserved ─────────────────────────────────────────
describe("RISK-PAGE-08: identified_at DESC ordering in SQL", () => {
  it("risks route SQL includes ORDER BY r.identified_at DESC", async () => {
    // Capture the main data query SQL (second pool call)
    const capturedSqls: string[] = [];
    mockPoolQuery.mockImplementation(async (sql: string) => {
      capturedSqls.push(sql);
      if (sql.includes("COUNT(*)::text AS total")) {
        return { rows: [{ total: "1" }], rowCount: 1 };
      }
      return { rows: [makeRiskRow()], rowCount: 1 };
    });
    const res = await supertest(appAs(user())).get("/risks?page=2&limit=10");
    expect(res.status).toBe(200);
    // The data query (second call) must include identified_at DESC ordering
    const dataQuery = capturedSqls.find(s => s.includes("r.identified_at AS"));
    expect(dataQuery).toBeDefined();
    expect(dataQuery!.toLowerCase()).toMatch(/order by r\.identified_at desc/);
  });
});
