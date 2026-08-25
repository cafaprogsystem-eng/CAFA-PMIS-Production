/**
 * EXP-LIMIT: /reports/export safe row-limit tests
 *
 * Verifies the MAX+1 sentinel pattern that caps export results at
 * REPORT_EXPORT_MAX_ROWS (5 000) without a separate COUNT query.
 *
 * Suites:
 *   EXP-LIMIT-01..05 — truncation logic and response shape
 *   EXP-LIMIT-06     — applyReportScope called before query
 *   EXP-LIMIT-07     — filters applied (projectId example)
 *   EXP-LIMIT-08/09  — withHistory receives sliced rows only
 *   EXP-LIMIT-SQL    — LIMIT clause present in emitted SQL
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before any dynamic import of the route under test
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn().mockReturnValue(["reports.view"]),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants (kept in sync with reports.ts)
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_EXPORT_MAX_ROWS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build N minimal row stubs (enough for withHistory passthrough). */
function makeRows(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Report ${i + 1}`,
    status: "submitted",
    reportType: "project",
    kind: "monthly",
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// App factory — imports the real router after all mocks are registered
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: router } = await import("../routes/reports.js");
  const app = express();
  app.use(express.json());
  // Attach a minimal currentUser so role-checks inside the route don't crash.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { currentUser: unknown }).currentUser = {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      role: "program_manager",
      roleLabel: "Programme Manager",
      scope: "global",
      stateId: null,
      stateName: null,
      sector: null,
      avatarUrl: null,
      sectors: null,
    };
    next();
  });
  app.use("/api", router);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────────

let app: express.Express;

beforeEach(async () => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  if (!app) {
    app = await buildApp();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-01: 0 rows → no truncation
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-01 — 0 rows returned", () => {
  it("returns empty array and X-Report-Truncated: false", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
    expect(res.headers["x-report-truncated"]).toBe("false");
    expect(res.headers["x-report-export-limit"]).toBe(String(REPORT_EXPORT_MAX_ROWS));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-02: 42 rows (well below MAX)
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-02 — 42 rows (< MAX)", () => {
  it("returns all 42 rows, X-Report-Truncated: false", async () => {
    mockQuery.mockResolvedValue({ rows: makeRows(42) });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(42);
    expect(res.headers["x-report-truncated"]).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-03: exactly MAX rows (pool returns MAX rows — real DB had ≤ MAX)
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-03 — exactly MAX rows (not truncated)", () => {
  it("returns MAX rows, X-Report-Truncated: false", async () => {
    // Pool returns exactly MAX rows — simulates a dataset that happened to have
    // exactly REPORT_EXPORT_MAX_ROWS records (the DB returned fewer than MAX+1).
    mockQuery.mockResolvedValue({ rows: makeRows(REPORT_EXPORT_MAX_ROWS) });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(REPORT_EXPORT_MAX_ROWS);
    expect(res.headers["x-report-truncated"]).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-04: MAX+1 rows from pool (sentinel present → truncated)
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-04 — pool returns MAX+1 (sentinel present)", () => {
  it("returns MAX rows, X-Report-Truncated: true, sentinel absent", async () => {
    const sentinel = makeRows(REPORT_EXPORT_MAX_ROWS + 1);
    mockQuery.mockResolvedValue({ rows: sentinel });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(REPORT_EXPORT_MAX_ROWS);
    expect(res.headers["x-report-truncated"]).toBe("true");
    // Sentinel row (index MAX) must not appear in the response.
    const ids = (res.body as { id: number }[]).map((r) => r.id);
    expect(ids).not.toContain(REPORT_EXPORT_MAX_ROWS + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-05: pool returns MAX+50 rows
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-05 — pool returns MAX+50 rows", () => {
  it("caps at MAX rows, X-Report-Truncated: true, rows beyond MAX absent", async () => {
    mockQuery.mockResolvedValue({ rows: makeRows(REPORT_EXPORT_MAX_ROWS + 50) });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(REPORT_EXPORT_MAX_ROWS);
    expect(res.headers["x-report-truncated"]).toBe("true");
    const ids = (res.body as { id: number }[]).map((r) => r.id);
    // Rows at index MAX through MAX+49 must not appear.
    for (let i = REPORT_EXPORT_MAX_ROWS + 1; i <= REPORT_EXPORT_MAX_ROWS + 50; i++) {
      expect(ids).not.toContain(i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-06: applyReportScope is called before the query
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-06 — applyReportScope is called", () => {
  it("scope function is invoked for every export request", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    // applyReportScope always appends at least the canonical-type predicate,
    // so the WHERE clause (or params) must be non-trivial. The clearest proxy
    // is that the SQL string contains 'report_type' from the canonical filter.
    const [[sql]] = mockQuery.mock.calls as [string, unknown[]][];
    expect(sql).toMatch(/report_type/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-07: filters applied — projectId causes a WHERE predicate
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-07 — projectId filter applied", () => {
  it("includes projectId value in query params", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await request(app).get("/api/reports/export?projectId=42");
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toContain(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-08: withHistory called with sliced rows (not sentinel row)
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-08 — withHistory receives sliced rows", () => {
  it("when pool returns MAX+1, withHistory sees only MAX rows", async () => {
    const poolRows = makeRows(REPORT_EXPORT_MAX_ROWS + 1);
    mockQuery.mockResolvedValue({ rows: poolRows });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    // The JSON body is the withHistory output; since withHistory is the real
    // implementation (which passes rows through when no history exists), the
    // length reflects what withHistory received.
    expect(res.body).toHaveLength(REPORT_EXPORT_MAX_ROWS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-09: sentinel row (index MAX) not passed to withHistory
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-09 — sentinel row absent from withHistory input", () => {
  it("id of sentinel row (MAX+1) does not appear in response", async () => {
    const poolRows = makeRows(REPORT_EXPORT_MAX_ROWS + 1);
    mockQuery.mockResolvedValue({ rows: poolRows });
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(200);
    const ids = (res.body as { id: number }[]).map((r) => r.id);
    // The sentinel row has id = REPORT_EXPORT_MAX_ROWS + 1
    expect(ids).not.toContain(REPORT_EXPORT_MAX_ROWS + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXP-LIMIT-SQL: LIMIT clause is present in the emitted SQL
// ─────────────────────────────────────────────────────────────────────────────

describe("EXP-LIMIT-SQL — SQL LIMIT clause present", () => {
  it("emitted SQL contains a LIMIT clause", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await request(app).get("/api/reports/export");
    const [[sql, params]] = mockQuery.mock.calls as [string, unknown[]][];
    // Must contain LIMIT followed by a param placeholder or number.
    expect(sql).toMatch(/LIMIT\s+\$\d+/i);
    // The last param must be REPORT_EXPORT_MAX_ROWS + 1 (sentinel value).
    expect(params[params.length - 1]).toBe(REPORT_EXPORT_MAX_ROWS + 1);
  });
});
