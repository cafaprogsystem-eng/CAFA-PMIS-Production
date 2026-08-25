/**
 * PMR Quarter Immutability — Backend Tests
 *
 * Verifies that `quarter` is treated as an immutable identity field on the
 * PATCH /reports/:reportId handler for Project Reports (PMRs).
 *
 * Closes PMR-002: quarterly PMR quarter must not be changeable after creation.
 *
 * Test IDs:
 *   PMR-QTR-IMM-01  quarterly PMR, content-only PATCH → 200
 *   PMR-QTR-IMM-02  quarterly PMR, PATCH quarter (changed value) → 409
 *   PMR-QTR-IMM-03  quarterly PMR, PATCH quarter (same value) → 409
 *   PMR-QTR-IMM-04  quarterly PMR in returned-draft, PATCH quarter → 409
 *   PMR-QTR-IMM-05  monthly PMR, PATCH reportingMonth → 409 (regression)
 *   PMR-QTR-IMM-06  annual PMR, PATCH reportingYear → 409 (regression)
 *   PMR-QTR-IMM-07  on-demand PMR, PATCH period → 409 (regression)
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before any dynamic import of the route
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

const mockPermissionsFor = vi.fn().mockReturnValue(["reports.update"]);

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: mockPermissionsFor,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake users
// ─────────────────────────────────────────────────────────────────────────────

/** Non-super-admin author; state_program_officer is not TC-scoped so sector guard passes. */
const AUTHOR_SPO = {
  id: 10,
  name: "SPO Author",
  email: "spo@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// App builder
// ─────────────────────────────────────────────────────────────────────────────

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
    console.error("TEST APP ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock sequence helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a two-call mock sequence for the PATCH handler:
 *   Call 1 — SELECT report row (status, reportType, authorId, sector, sections)
 *   Call 2 — getReportSector JOIN query
 *
 * The identity guard fires AFTER these two queries, so only two rows are needed
 * to reach the 409 response.
 */
function makePatchMockSequence(opts: {
  status?: string;
  reportType?: string;
  authorId?: number;
}) {
  const { status = "draft", reportType = "project", authorId = AUTHOR_SPO.id } = opts;
  return [
    // Call 1: cur query — report row
    {
      rows: [
        {
          status,
          sector: null,
          projectId: 1,
          reportType,
          authorId,
          sections: null,
        },
      ],
    },
    // Call 2: getReportSector JOIN query
    {
      rows: [
        {
          reportType,
          projectId: 1,
          projectSector: null,
          activitySector: null,
          effectiveSector: null,
        },
      ],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite — PMR quarter immutability (Fix: add "quarter" to pmrIdentityFields)
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /reports/:reportId — PMR quarter immutability", () => {
  // Pre-warm the router module so the module-level CREATE TABLE pool.query
  // (reports.ts lines 37-50) fires here under a no-op mock, not inside
  // test 01's ordered call sequence.
  beforeAll(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    mockQuery.mockReset();
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.update"]);
  });

  // PMR-QTR-IMM-01: content-only PATCH (no identity fields in body) → 200
  // Verifies that adding "quarter" to the guard does not affect ordinary edits
  // where quarter is simply absent from the request body.
  it("PMR-QTR-IMM-01: quarterly PMR PATCH with no identity fields in body → 200 ok", async () => {
    // The PATCH handler makes up to 5 pool.query calls for a successful edit:
    //   1. SELECT report row (cur)
    //   2. getReportSector JOIN
    //   3. UPDATE reports SET …
    //   4. reportSelect full row
    //   5. withHistory approvals JOIN
    // Provide a proper sequence so the handler reaches res.json(200).
    const fullSeq = [
      // 1 — cur query
      { rows: [{ status: "draft", sector: null, projectId: 1, reportType: "project", authorId: AUTHOR_SPO.id, sections: null }] },
      // 2 — getReportSector
      { rows: [{ reportType: "project", projectId: 1, projectSector: null, activitySector: null, effectiveSector: null }] },
      // 3 — UPDATE reports (return value unused)
      { rows: [], rowCount: 1 },
      // 4 — reportSelect full row (needs `id` for withHistory)
      { rows: [{ id: 1, reportType: "project", status: "draft", kind: "monthly", authorId: AUTHOR_SPO.id, plannedBudget: null, actualExpenditure: null }] },
      // 5 — withHistory approvals JOIN
      { rows: [] },
    ];
    let callCount = 0;
    mockQuery.mockImplementation(() =>
      Promise.resolve(fullSeq[callCount++] ?? { rows: [] }),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ narrative: "Updated narrative text" }); // no identity fields in body

    // 200 means the quarter guard (and all other identity guards) did not fire
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  // PMR-QTR-IMM-02: PATCH with quarter: 2 (was 1) → 409 identity immutable
  it("PMR-QTR-IMM-02: quarterly PMR PATCH with changed quarter → 409 project_report_identity_immutable", async () => {
    let callCount = 0;
    const seq = makePatchMockSequence({});
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ quarter: 2 }); // changing quarter after creation

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
    expect(res.body.message).toMatch(/quarter/);
  });

  // PMR-QTR-IMM-03: PATCH with quarter: 1 (same value as stored) → 409
  // The guard checks body[f] !== undefined (present in payload), NOT whether the
  // value changed. Sending the same quarter value still fires the guard — this
  // prevents clients from accidentally including it without realising.
  it("PMR-QTR-IMM-03: quarterly PMR PATCH with same quarter value → 409 (presence check, not diff)", async () => {
    let callCount = 0;
    const seq = makePatchMockSequence({});
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ quarter: 1 }); // same value, still rejected

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
    expect(res.body.message).toMatch(/quarter/);
  });

  // PMR-QTR-IMM-04: returned draft (status="draft" after revision cycle), PATCH quarter → 409
  // A report returned for revision is stored with status="draft" again. The identity
  // of the PMR (project + location + period + quarter) remains immutable even during
  // the re-draft phase — the author may only edit content fields.
  it("PMR-QTR-IMM-04: returned-draft quarterly PMR, PATCH quarter → 409 (identity still locked)", async () => {
    let callCount = 0;
    const seq = makePatchMockSequence({ status: "draft" }); // returned = back to draft
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ quarter: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
    expect(res.body.message).toMatch(/quarter/);
  });

  // PMR-QTR-IMM-05: monthly PMR, PATCH reportingMonth → 409 (regression guard)
  // Verifies the pre-existing reportingMonth immutability is unchanged by this fix.
  it("PMR-QTR-IMM-05: monthly PMR PATCH with reportingMonth → 409 (regression: existing guard intact)", async () => {
    let callCount = 0;
    const seq = makePatchMockSequence({});
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ reportingMonth: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
    expect(res.body.message).toMatch(/reportingMonth/);
  });

  // PMR-QTR-IMM-06: annual PMR, PATCH reportingYear → 409 (regression guard)
  // Verifies the pre-existing reportingYear immutability is unchanged by this fix.
  it("PMR-QTR-IMM-06: annual PMR PATCH with reportingYear → 409 (regression: existing guard intact)", async () => {
    let callCount = 0;
    const seq = makePatchMockSequence({});
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ reportingYear: 2027 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
    expect(res.body.message).toMatch(/reportingYear/);
  });

  // PMR-QTR-IMM-07: on-demand PMR, PATCH period → 409 (regression guard)
  // Verifies the pre-existing period immutability is unchanged by this fix.
  it("PMR-QTR-IMM-07: on-demand PMR PATCH with period → 409 (regression: existing guard intact)", async () => {
    let callCount = 0;
    const seq = makePatchMockSequence({});
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/api/projects/reports/1")
      .send({ period: "2027-01" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
    expect(res.body.message).toMatch(/period/);
  });
});
