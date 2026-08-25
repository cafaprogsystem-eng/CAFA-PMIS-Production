/**
 * SPR-008 — State Programme Report Duplicate Check & Duplicate-Prevention UX
 *
 * Verifies:
 *  1. GET /reports/duplicate-check supports reportType=program_state for
 *     monthly / quarterly / annual periods, mirroring the DB partial unique
 *     indexes (rejected/archived excluded; on_demand always allowed).
 *  2. State-scoped users are clamped to their own state (no cross-state
 *     probing); null-state users fail closed.
 *  3. POST /reports pre-check returns a descriptive 409 duplicate_report_period
 *     for scheduled SPR duplicates; rejected existing reports do not block.
 *  4. Response contains only id/title/period/status.
 *
 * Test IDs: SPR-DUP-01 … SPR-DUP-11, SPR-DUP-POST-01/02, SPR-DUP-SEC-01/03
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

const mockPermissionsFor = vi.fn().mockReturnValue(["reports.view", "reports.create", "reports.update"]);

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: mockPermissionsFor,
  };
});

const SPO_STATE1 = {
  id: 10, name: "SPO State 1", email: "spo1@example.com",
  role: "state_program_officer", stateId: 1, sector: null, sectors: [],
} as const;
const SPO_NULL_STATE = { ...SPO_STATE1, id: 11, stateId: null } as const;
const PM = { ...SPO_STATE1, id: 20, role: "program_manager", stateId: null } as const;

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

const EXISTING = { id: 42, title: "Existing SPR", period: "2031-05", status: "draft" };

function dupCheckUrl(params: Record<string, string>) {
  return `/api/projects/reports/duplicate-check?${new URLSearchParams({ reportType: "program_state", ...params })}`;
}

describe("SPR-008 — GET /reports/duplicate-check program_state branch", () => {
  beforeAll(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    mockQuery.mockReset();
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("SPR-DUP-01: existing monthly SPR same State/year/month → exact match", async () => {
    mockQuery.mockResolvedValue({ rows: [EXISTING] });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "monthly", period: "2031-05" }));
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("exact");
    expect(res.body.existingReport.id).toBe(42);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("kind = 'monthly'");
    expect(sql).toContain("status NOT IN ('rejected','archived')");
    expect(sql).toContain("migration_is_duplicate = FALSE");
    expect(params).toEqual([1, 2031, 5]);
  });

  it("SPR-DUP-02: different month → none", async () => {
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "monthly", period: "2031-06" }));
    expect(res.body.matchType).toBe("none");
    expect((mockQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual([1, 2031, 6]);
  });

  it("SPR-DUP-03: existing quarterly SPR same State/year/quarter → exact", async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...EXISTING, period: "2031-Q2" }] });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "quarterly", period: "2031-Q2" }));
    expect(res.body.matchType).toBe("exact");
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("kind = 'quarterly'");
    expect(sql).toContain("quarter = $3");
    expect(params).toEqual([1, 2031, 2]);
  });

  it("SPR-DUP-04: different quarter → none", async () => {
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "quarterly", period: "2031-Q3" }));
    expect(res.body.matchType).toBe("none");
  });

  it("SPR-DUP-05: existing annual SPR same State/year → exact", async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...EXISTING, period: "2031" }] });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "annual", period: "2031" }));
    expect(res.body.matchType).toBe("exact");
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("kind = 'annual'");
    expect(params).toEqual([1, 2031]);
  });

  it("SPR-DUP-06: different State (PM query) same period → none", async () => {
    const app = await buildApp(PM as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "2", frequency: "monthly", period: "2031-05" }));
    expect(res.body.matchType).toBe("none");
    // PM (full access) may supply arbitrary stateId — used as-is
    expect((mockQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual([2, 2031, 5]);
  });

  it("SPR-DUP-07/08: rejected/archived excluded via SQL predicate", async () => {
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    await request(app).get(dupCheckUrl({ stateId: "1", frequency: "monthly", period: "2031-05" }));
    const sql = (mockQuery.mock.calls[0] as [string])[0];
    expect(sql).toContain("status NOT IN ('rejected','archived')");
  });

  it("SPR-DUP-12: migration-preserved duplicates excluded in every frequency's SQL predicate", async () => {
    // The SPR partial unique indexes (migration 006 recreation) all carry
    // `migration_is_duplicate = FALSE`; the duplicate-check SQL must mirror it
    // so a preserved historical duplicate never blocks a valid new report.
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    await request(app).get(dupCheckUrl({ stateId: "1", frequency: "monthly", period: "2031-05" }));
    await request(app).get(dupCheckUrl({ stateId: "1", frequency: "quarterly", period: "2031-Q2" }));
    await request(app).get(dupCheckUrl({ stateId: "1", frequency: "annual", period: "2031" }));
    for (const call of mockQuery.mock.calls) {
      expect((call as [string])[0]).toContain("migration_is_duplicate = FALSE");
    }
  });

  it("SPR-DUP-09: on_demand frequency → none, no query", async () => {
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "on_demand", period: "2031-05-01" }));
    expect(res.body.matchType).toBe("none");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("SPR-DUP-10: state-scoped user querying another State is clamped to own state", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "2", frequency: "monthly", period: "2031-05" }));
    expect(res.status).toBe(200);
    // Query ran against the user's OWN state (1), not the requested state (2).
    expect((mockQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual([1, 2031, 5]);
  });

  it("SPR-DUP-11: null-state state-scoped user → none (fail closed, no query)", async () => {
    const app = await buildApp(SPO_NULL_STATE as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "2", frequency: "monthly", period: "2031-05" }));
    expect(res.body.matchType).toBe("none");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("invalid period format for frequency → 400", async () => {
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "monthly", period: "2031-Q2" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_period_for_frequency");
  });

  it("SPR-DUP-SEC-01: match response exposes only id/title/period/status", async () => {
    mockQuery.mockResolvedValue({ rows: [EXISTING] });
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).get(dupCheckUrl({ stateId: "1", frequency: "monthly", period: "2031-05" }));
    expect(Object.keys(res.body.existingReport).sort()).toEqual(["id", "period", "status", "title"]);
  });
});

describe("SPR-008 — POST /reports SPR duplicate pre-check", () => {
  const monthlyBody = {
    title: "State Programme Report",
    reportType: "program_state",
    kind: "monthly",
    reportingMonth: 5,
    reportingYear: 2031,
    period: "2031-05",
    sector: "Health",
  };

  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.view", "reports.create", "reports.update"]);
  });

  function routeMock(dupRows: unknown[]) {
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === "string" && /FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] });
      }
      if (typeof sql === "string" && sql.includes("INSERT INTO reports")) {
        return Promise.resolve({ rows: [{ id: 99 }] });
      }
      if (typeof sql === "string" && sql.includes("report_type = 'program_state'") && sql.includes("kind = 'monthly'")) {
        return Promise.resolve({ rows: dupRows });
      }
      if (typeof sql === "string" && sql.includes("FROM reports r") && sql.includes("WHERE r.id")) {
        return Promise.resolve({
          rows: [{ id: 99, reportType: "program_state", status: "draft", kind: "monthly", authorId: SPO_STATE1.id, plannedBudget: null, actualExpenditure: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  function findInsertCall() {
    return mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO reports"),
    );
  }

  it("SPR-DUP-POST-01: duplicate monthly SPR → 409 duplicate_report_period, no INSERT", async () => {
    routeMock([{ id: 42 }]);
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(monthlyBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_report_period");
    expect(findInsertCall()).toBeUndefined();
  });

  it("SPR-DUP-POST-02: no active duplicate (e.g. rejected existing excluded) → 201", async () => {
    routeMock([]); // guard SQL excludes rejected/archived, so it returns no rows
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(monthlyBody);
    expect(res.status).toBe(201);
    expect(findInsertCall()).toBeDefined();
  });

  it("SPR-DUP-POST-03: guard SQL excludes migration-preserved duplicates (creation permitted)", async () => {
    routeMock([]); // migration_is_duplicate=TRUE rows are filtered by the guard SQL itself
    const app = await buildApp(SPO_STATE1 as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(monthlyBody);
    expect(res.status).toBe(201);
    const guardCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("report_type = 'program_state'") && (c[0] as string).includes("kind = 'monthly'") && !(c[0] as string).includes("INSERT"),
    );
    expect(guardCall).toBeDefined();
    expect((guardCall![0] as string)).toContain("migration_is_duplicate = FALSE");
    expect((guardCall![0] as string)).toContain("status NOT IN ('rejected','archived')");
  });
});
