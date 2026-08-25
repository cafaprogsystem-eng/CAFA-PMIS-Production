/**
 * PMR Identity Hardening — Backend Tests
 *
 * Verifies two security fixes in DELETE /reports/:reportId and the
 * transition handler POST /reports/:reportId/transition:
 *
 * Fix 1 — DELETE uses author_id (not submitted_by_id) for ownership.
 * Fix 2 — Self-review blocked at technical_review, coordination_review,
 *          and final_approve (not just technical_review).
 *
 * Test IDs:
 *   PMR-ID-DEL-01 through PMR-ID-DEL-07
 *   PMR-ID-SR-01  through PMR-ID-SR-06
 *   PMR-ID-HIST-01 through PMR-ID-HIST-03
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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

// permissionsFor is used both in DELETE and transition handler; default to
// a non-super-admin permission set. Individual tests override where needed.
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

/** The true author of the report (author_id = 10). */
const AUTHOR_USER = {
  id: 10,
  name: "Author User",
  email: "author@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

/** A different user who happens to have submitted the report but is NOT the author. */
const SUBMITTER_NOT_AUTHOR = {
  id: 20,
  name: "Submitter Not Author",
  email: "submitter@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

/** An unrelated third-party user. */
const OTHER_USER = {
  id: 30,
  name: "Other User",
  email: "other@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

/** Super-admin user with wildcard permission. */
const SUPER_ADMIN = {
  id: 99,
  name: "Admin",
  email: "admin@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

/** A reviewer (e.g. SPC) who is NOT the author. */
const REVIEWER_USER = {
  id: 50,
  name: "Reviewer",
  email: "reviewer@example.com",
  role: "senior_program_coordinator",
  stateId: null,
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
// Suite 1 — DELETE /reports/:reportId uses author_id for ownership
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /reports/:reportId — author_id ownership (Fix 1)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Default: non-super-admin permissions
    mockPermissionsFor.mockReturnValue(["reports.update"]);
  });

  // PMR-ID-DEL-01: author matches → allowed
  it("PMR-ID-DEL-01: author_id matches currentUser.id, draft → 200 ok", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "draft" }],
    });
    const app = await buildApp(AUTHOR_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    // 200 or 204 (the handler returns res.json({ ok: true }) which is 200)
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // PMR-ID-DEL-02: different user → 403
  it("PMR-ID-DEL-02: author_id !== currentUser.id, draft → 403 only_creator_or_admin_can_delete", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "draft" }],
    });
    const app = await buildApp(OTHER_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });

  // PMR-ID-DEL-03: submitted_by_id user but NOT author → 403
  // Key regression test: previously submitted_by_id was used, allowing the
  // submitter (who is not the author) to delete. Now author_id is checked.
  it("PMR-ID-DEL-03: submitter (not author) tries delete → 403 only_creator_or_admin_can_delete", async () => {
    // The row has author_id=10 (AUTHOR_USER) but current user is SUBMITTER_NOT_AUTHOR (id=20)
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "draft" }],
    });
    const app = await buildApp(SUBMITTER_NOT_AUTHOR as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });

  // PMR-ID-DEL-04: author deletes a returned draft → 200
  it("PMR-ID-DEL-04: author_id matches, status=draft (returned) → 200 ok", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "draft" }],
    });
    const app = await buildApp(AUTHOR_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/99");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // PMR-ID-DEL-05: author + status=submitted → 409 (not draft)
  it("PMR-ID-DEL-05: author_id matches but status=submitted → 409 only_draft_reports_can_be_deleted", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "submitted" }],
    });
    const app = await buildApp(AUTHOR_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("only_draft_reports_can_be_deleted");
  });

  // PMR-ID-DEL-06: super-admin bypass preserved even when author_id != their id
  it("PMR-ID-DEL-06: super_admin, author_id !== currentUser.id, draft → 200 ok (bypass)", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "draft" }],
    });
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // PMR-ID-DEL-07: null author_id fails closed for non-super-admin
  // Legacy records without backfill should not be permissively deletable.
  it("PMR-ID-DEL-07: author_id IS NULL, non-super-admin → 403 only_creator_or_admin_can_delete", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: null, status: "draft" }],
    });
    const app = await buildApp(OTHER_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Self-review prevention at all reviewer/approver actions (Fix 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal locked-row response that the transition handler reads via
 * SELECT … FOR UPDATE.  The transition handler also calls BEGIN/ROLLBACK/COMMIT
 * via the pool client, but we use pool.query throughout — the mock handles both.
 *
 * `status` must be a valid `from` status for the action under test:
 *   - technical_review    → "submitted"           (state_authored path)
 *   - coordination_review → "submitted"           (technical_authored path)
 *   - final_approve       → "coordination_approved" (either path)
 */
function makeTransitionMockSequence(
  authorId: number | null,
  status: string = "submitted",
  workflowPath: string = "state_authored",
) {
  return [
    // BEGIN
    { rows: [] },
    // SELECT … FOR UPDATE (locked row)
    {
      rows: [{
        status,
        reportType: "project",
        stateId: 1,
        sector: null,
        projectId: 42,
        activityId: null,
        workflowPath,
        authorId,
      }],
    },
    // Any further queries (project lookup, approval inserts, etc.) return empty
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ];
}

describe("Transition handler — self-review prevention (Fix 2)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Default: non-super-admin; specific tests override
    mockPermissionsFor.mockReturnValue([
      "reports.approve.technical",
      "reports.approve.coordination",
      "reports.approve.final",
      "reports.update",
    ]);
  });

  // PMR-ID-SR-01: technical_review by author → 403
  it("PMR-ID-SR-01: action=technical_review, authorId===currentUser.id → 403 self_review_forbidden", async () => {
    let callCount = 0;
    const seq = makeTransitionMockSequence(REVIEWER_USER.id);
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(REVIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "technical_review" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("self_review_forbidden");
  });

  // PMR-ID-SR-02: coordination_review by author → 403
  // Uses technical_authored workflow where coordination_review from="submitted"
  it("PMR-ID-SR-02: action=coordination_review, authorId===currentUser.id → 403 self_review_forbidden", async () => {
    let callCount = 0;
    const seq = makeTransitionMockSequence(REVIEWER_USER.id, "submitted", "technical_authored");
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(REVIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "coordination_review" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("self_review_forbidden");
  });

  // PMR-ID-SR-03: final_approve by author → 403
  // final_approve from="coordination_approved" in both workflow paths
  it("PMR-ID-SR-03: action=final_approve, authorId===currentUser.id → 403 self_review_forbidden", async () => {
    let callCount = 0;
    const seq = makeTransitionMockSequence(REVIEWER_USER.id, "coordination_approved", "state_authored");
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(REVIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "final_approve" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("self_review_forbidden");
  });

  // PMR-ID-SR-04: technical_review by a DIFFERENT user → no self-review block
  // (transition may still fail due to workflow state, but not from self-review)
  it("PMR-ID-SR-04: action=technical_review, authorId !== currentUser.id → no self_review_forbidden", async () => {
    let callCount = 0;
    // author is AUTHOR_USER (id=10); reviewer is REVIEWER_USER (id=50)
    const seq = makeTransitionMockSequence(AUTHOR_USER.id);
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(REVIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "technical_review" });
    // Must NOT be self_review_forbidden — it may fail for other workflow reasons
    expect(res.body.error).not.toBe("self_review_forbidden");
    expect(res.status).not.toBe(403);
  });

  // PMR-ID-SR-05: authorId IS NULL → no self-review block
  // A null author means authorship is unknown; we cannot affirmatively assert
  // self-review, so the guard does not fire. Legitimate reviewers are not blocked.
  it("PMR-ID-SR-05: action=technical_review, authorId IS NULL → no self-review block (null passes through)", async () => {
    let callCount = 0;
    const seq = makeTransitionMockSequence(null);
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(REVIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "technical_review" });
    expect(res.body.error).not.toBe("self_review_forbidden");
  });

  // PMR-ID-SR-06: super_admin who is also the author — override requires reason
  // Task #373: super_admin may self-review but MUST supply overrideReason.
  // Without overrideReason the transition returns 400 (not 403).
  it("PMR-ID-SR-06: action=final_approve, super_admin AND authorId===currentUser.id, no overrideReason → 400 override_reason_required (Task #373)", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    let callCount = 0;
    const seq = makeTransitionMockSequence(SUPER_ADMIN.id, "coordination_approved", "state_authored");
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "final_approve" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Historical / legacy records (null author_id edge cases)
// ─────────────────────────────────────────────────────────────────────────────

describe("Historical records — null author_id edge cases", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.update"]);
  });

  // PMR-ID-HIST-01: null author_id, DELETE, non-super-admin → 403 (fail closed)
  it("PMR-ID-HIST-01: author_id IS NULL, non-super-admin, DELETE → 403 (fail closed for destructive ops)", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: null, status: "draft" }],
    });
    const app = await buildApp(OTHER_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });

  // PMR-ID-HIST-02: null author_id, coordination_review → passes self-review check
  // Unknown authorship must not prevent legitimate reviewers from acting.
  // Uses technical_authored workflow where coordination_review from="submitted"
  it("PMR-ID-HIST-02: author_id IS NULL, action=coordination_review → no self_review_forbidden", async () => {
    mockPermissionsFor.mockReturnValue([
      "reports.approve.coordination",
      "reports.update",
    ]);
    let callCount = 0;
    const seq = makeTransitionMockSequence(null, "submitted", "technical_authored");
    mockQuery.mockImplementation(() => Promise.resolve(seq[Math.min(callCount++, seq.length - 1)]));

    const app = await buildApp(REVIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "coordination_review" });
    expect(res.body.error).not.toBe("self_review_forbidden");
  });

  // PMR-ID-HIST-03: valid author_id — report read access unaffected by identity hardening
  // The SELECT for DELETE still returns the report row normally.
  it("PMR-ID-HIST-03: valid author_id returns report row normally (read access unaffected)", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ authorId: AUTHOR_USER.id, status: "draft" }],
    });
    const app = await buildApp(AUTHOR_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    // The handler proceeds past the ownership check to the actual delete
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
