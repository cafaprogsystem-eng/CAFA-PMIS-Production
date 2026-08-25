/**
 * PMR-SUBID: submitted_by_id update on (re)submit
 *
 * Verifies that the transition handler sets submitted_by_id = req.currentUser.id
 * whenever action="submit" is processed, and does NOT touch submitted_by_id for
 * any other action (e.g. request_revision).
 *
 * Key invariants:
 *   - author_id is NEVER modified by the transition UPDATE
 *   - submitted_by_id is updated on every successful submit (initial or resubmit)
 *   - submitted_by_id reflects the actual req.currentUser.id, even when a
 *     different authorised user resubmits (User B resubmits User A's report)
 *   - On return (request_revision), submitted_by_id is NOT changed
 *   - Failed submissions (validation error, permission denied) do NOT mutate
 *     submitted_by_id
 *   - Self-review guard uses author_id, not submitted_by_id
 *   - DELETE ownership uses author_id, not submitted_by_id
 *   - Approval history actor = req.currentUser.id (not submitted_by_id)
 *
 * Test IDs:
 *   PMR-SUBID-01 through PMR-SUBID-09
 *
 * Uses program_state reports (not project) for most tests to bypass the PMR
 * content gate (validateProjectReportForSubmission), keeping mock setup simple.
 * The fix is universal across all report types; the gate exemption is a
 * test-isolation choice only.
 *
 * Pattern follows pmr-identity-hardening.test.ts.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before any dynamic import of the route
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

const mockPermissionsFor = vi.fn().mockReturnValue([
  "reports.update",
  "reports.create",
]);

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

/** Original author of the report (author_id = 10). */
const USER_A = {
  id: 10,
  name: "User A",
  email: "a@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [] as string[],
};

/** An authorised second user who can resubmit (author_id stays = 10). */
const USER_B = {
  id: 20,
  name: "User B",
  email: "b@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [] as string[],
};

/** Super-admin. */
const SUPER_ADMIN = {
  id: 99,
  name: "Admin",
  email: "admin@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [] as string[],
};

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
    console.error("TEST-APP-ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a mock sequence for the transition handler with a program_state report.
 * program_state uses SIMPLE_CHAIN_TRANSITIONS (no PMR/activity content gate).
 *
 * Order of mockQuery calls inside the transition handler:
 *   [0] BEGIN
 *   [1] SELECT … FOR UPDATE  (locked row)
 *   [2] pool.query for getReportSector
 *   [3] UPDATE reports SET status … (the fix under test)
 *   [4] INSERT INTO approvals
 *   [5] COMMIT
 *   [6..] post-commit pool queries (reportDeepLink, reportSelect, etc.) — return empty
 */
function makeSubmitSequence(
  opts: {
    authorId?: number | null;
    status?: string;
    workflowPath?: string | null;
  } = {},
) {
  const { authorId = USER_A.id, status = "draft", workflowPath = null } = opts;
  return [
    { rows: [] },                // BEGIN
    {
      rows: [{
        status,
        reportType: "program_state",
        stateId: 1,
        sector: null,
        projectId: null,
        activityId: null,
        workflowPath,
        authorId,
      }],
    },                          // SELECT FOR UPDATE
    {
      rows: [{
        reportType:      "program_state",
        projectId:       null,
        projectSector:   null,
        activitySector:  null,
        effectiveSector: null,
      }],
    },                          // getReportSector pool.query
    { rows: [] },               // UPDATE reports
    { rows: [] },               // INSERT INTO approvals
    { rows: [] },               // COMMIT
    { rows: [] },               // reportDeepLink pool.query
    { rows: [] },               // reportSelect pool.query
  ];
}

/**
 * Builds a mock sequence for the request_revision action on a submitted report.
 * Order:
 *   [0] BEGIN
 *   [1] SELECT FOR UPDATE (status="submitted")
 *   [2] getReportSector pool.query
 *   [3] UPDATE reports SET status (NO submitted_by_id)
 *   [4] INSERT INTO approvals
 *   [5] INSERT INTO comments (revision comment)
 *   [6] COMMIT
 *   [7..] post-commit
 */
function makeRevisionSequence(authorId: number | null = USER_A.id) {
  return [
    { rows: [] },               // BEGIN
    {
      rows: [{
        status:       "submitted",
        reportType:   "program_state",
        stateId:      1,
        sector:       null,
        projectId:    null,
        activityId:   null,
        workflowPath: null,
        authorId,
      }],
    },                          // SELECT FOR UPDATE
    {
      rows: [{
        reportType:      "program_state",
        projectId:       null,
        projectSector:   null,
        activitySector:  null,
        effectiveSector: null,
      }],
    },                          // getReportSector
    { rows: [] },               // UPDATE reports
    { rows: [] },               // INSERT INTO approvals
    { rows: [] },               // INSERT INTO comments
    { rows: [] },               // COMMIT
    { rows: [] },               // post-commit
    { rows: [] },
  ];
}

/** Run mockQuery from a sequence array, cycling the last element for overruns. */
function applySequence(seq: { rows: unknown[] }[]) {
  let callCount = 0;
  mockQuery.mockImplementation(() =>
    Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — call capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the call args [sql, params] of the UPDATE reports query from the
 * captured mockQuery calls.  Throws if not found.
 */
function findUpdateCall(): [string, unknown[]] {
  const calls = mockQuery.mock.calls as Array<[string, unknown[]]>;
  const hit = calls.find(([sql]) =>
    typeof sql === "string" && sql.includes("UPDATE reports"),
  );
  if (!hit) throw new Error("UPDATE reports query was not called");
  return hit;
}

/**
 * Returns true if an UPDATE reports query was NOT called.
 */
function updateWasNotCalled(): boolean {
  const calls = mockQuery.mock.calls as Array<[string, unknown[]]>;
  return !calls.some(
    ([sql]) => typeof sql === "string" && sql.includes("UPDATE reports"),
  );
}

/**
 * Returns the call args [sql, params] of the INSERT INTO approvals query.
 */
function findApprovalsInsertCall(): [string, unknown[]] {
  const calls = mockQuery.mock.calls as Array<[string, unknown[]]>;
  const hit = calls.find(([sql]) =>
    typeof sql === "string" && sql.includes("INSERT INTO approvals"),
  );
  if (!hit) throw new Error("INSERT INTO approvals query was not called");
  return hit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite — PMR-SUBID tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PMR-SUBID: submitted_by_id updated on (re)submit", () => {
  /**
   * Pre-import the reports router so any module-level initialization code
   * (e.g. pool.query calls during import resolution) runs BEFORE any
   * test-specific mock sequences are established.  Without this, the first
   * test's applySequence can be shifted by one slot and return a wrong row
   * for the SELECT FOR UPDATE, causing a spurious 400.
   */
  beforeAll(async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await import("../routes/reports.js");
    mockQuery.mockReset();
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.update", "reports.create"]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-01: initial submit by User A
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-01: action=submit by User A → submitted_by_id param = A.id, author_id NOT in SET", async () => {
    applySequence(makeSubmitSequence({ authorId: USER_A.id, status: "draft" }));

    const app = await buildApp(USER_A as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(400);

    const [sql, params] = findUpdateCall();

    // submitted_by_id = $3 must be present in the SQL
    expect(sql).toContain("submitted_by_id");
    // $3 param = User A's id
    expect(params[2]).toBe(USER_A.id);
    // author_id must NOT appear in the UPDATE SET clause
    expect(sql).not.toContain("author_id");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-02: return for revision (request_revision) — submitted_by_id unchanged
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-02: action=request_revision → submitted_by_id NOT in UPDATE SET", async () => {
    mockPermissionsFor.mockReturnValue([
      "reports.update",
      "reports.approve.coordination",
    ]);
    applySequence(makeRevisionSequence(USER_A.id));

    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "request_revision", comment: "Please fix section 2." });

    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(400);

    const [sql, params] = findUpdateCall();

    // submitted_by_id must NOT appear in the SET for request_revision
    expect(sql).not.toContain("submitted_by_id");
    // Only two params: [toStatus, reportId]
    expect(params).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-03: resubmit by User A after return
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-03: resubmit (draft after return) by User A → submitted_by_id = A.id, submitted_at in SET", async () => {
    // After request_revision, status returns to "draft"
    applySequence(makeSubmitSequence({ authorId: USER_A.id, status: "draft" }));

    const app = await buildApp(USER_A as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(400);

    const [sql, params] = findUpdateCall();

    expect(sql).toContain("submitted_by_id");
    expect(sql).toContain("submitted_at");
    expect(params[2]).toBe(USER_A.id);
    expect(params).toHaveLength(3);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-04: resubmit by User B (different authorised user)
  // author_id stays = USER_A.id; submitted_by_id = USER_B.id
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-04: resubmit by User B → submitted_by_id = B.id, author_id NOT changed", async () => {
    // author_id on the locked row is still USER_A
    applySequence(makeSubmitSequence({ authorId: USER_A.id, status: "draft" }));

    const app = await buildApp(USER_B as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(400);

    const [sql, params] = findUpdateCall();

    // submitted_by_id must reflect the current submitter (User B), NOT User A
    expect(sql).toContain("submitted_by_id");
    expect(params[2]).toBe(USER_B.id);
    // author_id is NOT in the UPDATE SET (it remains stored from CREATE)
    expect(sql).not.toContain("author_id");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-05: validation fails → no UPDATE fired; ROLLBACK called
  // Uses "project" type with a minimal row that triggers validation errors.
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-05: validation fails (422) → no UPDATE reports query; ROLLBACK called", async () => {
    // Sequence for a project-type submit where validation fails:
    // The handler fetches the full PMR row (client.query call after sector check).
    // We return a row with empty sections to trigger validation errors.
    let callCount = 0;
    const projectLockRow = {
      status:       "draft",
      reportType:   "project",
      stateId:      1,
      sector:       "WASH",
      projectId:    42,
      activityId:   null,
      workflowPath: "state_authored",
      authorId:     USER_A.id,
    };
    const projectSectorRow = {
      reportType:      "project",
      projectId:       42,
      projectSector:   "WASH",
      activitySector:  null,
      effectiveSector: "WASH",
    };
    // Empty PMR full row — will trigger multiple validation errors
    const emptyPmrRow = {
      id:              1,
      title:           null,
      project_id:      42,
      state_id:        1,
      location_type:   "state",
      kind:            "monthly",
      period:          "2026-06",
      period_start:    null,
      on_demand_reason: null,
      reporting_month: null,
      reporting_year:  null,
      quarter:         null,
      sections:        {},
      activities:      [],
    };
    const seq = [
      { rows: [] },                           // BEGIN
      { rows: [projectLockRow] },             // SELECT FOR UPDATE
      { rows: [projectSectorRow] },           // getReportSector pool.query
      { rows: [emptyPmrRow] },               // SELECT full PMR row for validation
      // validateProjectReportForSubmission internal queries (return empty)
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },                           // ROLLBACK (on validation failure)
    ];
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(USER_A as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");

    // No UPDATE reports query should have fired
    expect(updateWasNotCalled()).toBe(true);

    // ROLLBACK must have been called
    const rollbackCall = (mockQuery.mock.calls as Array<[string]>).find(
      ([sql]) => typeof sql === "string" && sql.toUpperCase().includes("ROLLBACK"),
    );
    expect(rollbackCall).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-06: permission denied → no UPDATE fires; 403 returned
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-06: inner permission check fails → 403 forbidden, no UPDATE query", async () => {
    // User has no reports.create permission → inner perm check denies submit
    mockPermissionsFor.mockReturnValue(["reports.update"]);

    let callCount = 0;
    const seq = makeSubmitSequence({ authorId: USER_A.id, status: "draft" });
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(USER_A as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(updateWasNotCalled()).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-07: self-review guard uses author_id (not submitted_by_id)
  // A reviewer who is also the author → 403 self_review_forbidden
  // submitted_by_id is NOT referenced in the guard.
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-07: action=technical_review, authorId===currentUser.id → 403 self_review_forbidden (guard uses author_id)", async () => {
    mockPermissionsFor.mockReturnValue([
      "reports.update",
      "reports.approve.technical",
    ]);
    let callCount = 0;
    const seq = [
      { rows: [] },                // BEGIN
      {
        rows: [{
          status:       "submitted",
          reportType:   "project",
          stateId:      1,
          sector:       null,
          projectId:    42,
          activityId:   null,
          workflowPath: "state_authored",
          // author_id === currentUser.id (USER_A) → self-review
          authorId:     USER_A.id,
        }],
      },                           // SELECT FOR UPDATE
      { rows: [] },               // getReportSector / further queries
      { rows: [] },
      { rows: [] },
    ];
    mockQuery.mockImplementation(() =>
      Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]),
    );

    const app = await buildApp(USER_A as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "technical_review" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("self_review_forbidden");
    expect(updateWasNotCalled()).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-08: DELETE handler uses author_id, not submitted_by_id
  // Regression guard: the DELETE SELECT uses author_id AS "authorId".
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-08: DELETE handler queries author_id for ownership (not submitted_by_id)", async () => {
    // The DELETE handler selects `status, author_id AS "authorId"` from reports.
    // Provide a row where authorId === currentUser.id → 200 ok.
    mockQuery.mockResolvedValue({
      rows: [{ authorId: USER_A.id, status: "draft" }],
    });

    const app = await buildApp(USER_A as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The SELECT query for DELETE must reference "author_id" not "submitted_by_id"
    const selectCall = (mockQuery.mock.calls as Array<[string]>).find(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("author_id") &&
        sql.includes("FROM reports"),
    );
    expect(selectCall).toBeDefined();

    // No query should reference submitted_by_id in a WHERE/ownership context
    const badCall = (mockQuery.mock.calls as Array<[string]>).find(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("submitted_by_id") &&
        (sql.includes("WHERE") || sql.includes("DELETE")),
    );
    expect(badCall).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PMR-SUBID-09: approval history actor = req.currentUser.id, not submitted_by_id
  // ─────────────────────────────────────────────────────────────────────────
  it("PMR-SUBID-09: INSERT INTO approvals uses req.currentUser.id as actor_id", async () => {
    applySequence(makeSubmitSequence({ authorId: USER_A.id, status: "draft" }));

    // Use User B as the current user; author_id on the row is User A
    const app = await buildApp(USER_B as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "submit" });

    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(400);

    const [_sql, params] = findApprovalsInsertCall();
    // Params: [reportId, action, fromStatus, toStatus, actor_id, comment]
    // actor_id is params[4]
    const actorId = params[4];
    expect(actorId).toBe(USER_B.id);
    // Must NOT be USER_A.id (author_id) or any value linked to submitted_by_id
    expect(actorId).not.toBe(USER_A.id);
  });
});
