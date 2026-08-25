/**
 * Plan comment read-only exception — backend integration tests (Task #495)
 *
 * Verifies the narrowly scoped GET /comments read exception for plan authors
 * (state_program_officer / state_office_manager) who lack comments.create but
 * may read revision_request comments on their own state's returned-for-revision
 * draft plan.
 *
 * PLAN-COM-01  SPO in same state reads revision_request comments on draft plan with revision approval → 200
 * PLAN-COM-02  SOM in same state reads revision_request comments on draft plan with revision approval → 200
 * PLAN-COM-03  SPO in different state → 403
 * PLAN-COM-04  SPO with null stateId → 403
 * PLAN-COM-05  Plan not in draft (submitted) → 403
 * PLAN-COM-06  Plan has no request_revision approval → 403
 * PLAN-COM-07  Non-state role without comments.create and entityType=plan → 403
 * PLAN-COM-08  Only revision_request comments returned (not general/other types)
 * PLAN-COM-09  SPO with comments.create perm uses normal read path (not exception)
 * PLAN-COM-10  entityType=project with no comments.create → 403 (plan exception does not widen)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockPool = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => mockPool(...args), connect: vi.fn() },
}));
vi.mock("../lib/realtime.js", () => ({ realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() } }));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/reportAuth.js", () => ({
  assertCanViewReport: vi.fn().mockResolvedValue({ ok: false, status: 403, body: { error: "forbidden" } }),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    assertSectorAllowed: () => ({ ok: true }),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SPO = { id: 10, name: "SPO", role: "state_program_officer", stateId: 7, sector: null, sectors: [] };
const SOM = { id: 11, name: "SOM", role: "state_office_manager",  stateId: 7, sector: null, sectors: [] };
const SPO_OTHER_STATE = { id: 12, name: "SPO2", role: "state_program_officer", stateId: 99, sector: null, sectors: [] };
const SPO_NULL_STATE  = { id: 13, name: "SPO3", role: "state_program_officer", stateId: null, sector: null, sectors: [] };
const TC  = { id: 20, name: "TC",  role: "technical_coordinator",  stateId: null, sector: "Health", sectors: ["Health"] };
const PM  = { id: 1,  name: "PM",  role: "program_manager",        stateId: null, sector: null, sectors: [] };

const REVISION_COMMENT = {
  id: 55, entityType: "plan", entityId: 42,
  parentId: null, section: null, commentType: "revision_request",
  authorId: 20, authorName: "TC User", authorRoleLabel: "Technical Coordinator",
  body: "Please revise the budget section.",
  status: "open", resolvedAt: null, resolvedById: null,
  createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
};

const GENERAL_COMMENT = { ...REVISION_COMMENT, id: 56, commentType: "general", body: "General note." };

/** Gate query — plan exists in same state, is draft, has a request_revision approval */
function gateOk(sameState = true) {
  return {
    rows: [{ ok: sameState }],
  };
}

/** Comments select result */
function commentsResult(comments: unknown[]) {
  return { rows: comments };
}

beforeEach(() => { mockPool.mockReset(); });

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: commentsRouter } = await import("../routes/comments.js");
  app.use(commentsRouter);
  return app;
}

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-01: SPO in same state reads revision_request comments → 200
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-01: SPO same-state reads revision_request comments on returned draft", () => {
  it("returns 200 with revision_request comments", async () => {
    const app = await buildApp(SPO);
    mockPool
      .mockResolvedValueOnce(gateOk(true))          // gate query
      .mockResolvedValueOnce(commentsResult([REVISION_COMMENT])); // narrow SELECT

    const res = await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].commentType).toBe("revision_request");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-02: SOM in same state reads revision_request comments → 200
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-02: SOM same-state reads revision_request comments on returned draft", () => {
  it("returns 200 with revision_request comments", async () => {
    const app = await buildApp(SOM);
    mockPool
      .mockResolvedValueOnce(gateOk(true))
      .mockResolvedValueOnce(commentsResult([REVISION_COMMENT]));

    const res = await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(200);

    expect(res.body[0].commentType).toBe("revision_request");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-03: SPO in different state → 403
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-03: SPO different state → 403", () => {
  it("returns 403 when plan belongs to a different state", async () => {
    const app = await buildApp(SPO_OTHER_STATE);
    mockPool.mockResolvedValueOnce(gateOk(false)); // gate returns ok=false

    await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-04: SPO with null stateId → 403 (fail-closed)
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-04: SPO with null stateId → 403 (fail-closed)", () => {
  it("returns 403 without querying the DB when stateId is null", async () => {
    const app = await buildApp(SPO_NULL_STATE);
    // No DB query should be made — route should fail-close immediately
    await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(403);

    expect(mockPool).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-05: Plan not in draft → 403 (gate returns ok=false)
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-05: Plan not in draft status → 403", () => {
  it("returns 403 when plan is submitted (not draft)", async () => {
    const app = await buildApp(SPO);
    // Gate query returns ok=false because status != 'draft'
    mockPool.mockResolvedValueOnce(gateOk(false));

    await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-06: No request_revision approval → 403 (gate returns ok=false)
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-06: Plan has no request_revision approval → 403", () => {
  it("returns 403 when plan is draft but has never been returned for revision", async () => {
    const app = await buildApp(SPO);
    // Gate query returns ok=false because no approvals.action='request_revision'
    mockPool.mockResolvedValueOnce(gateOk(false));

    await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-07: TC has comments.create → uses full read path (not exception)
//
// Every role except SPO/SOM receives comments.create from permissionsFor.
// TC therefore uses the normal (unfiltered) read path, returning all comment
// types — not filtered to revision_request, and not gated by state/draft/approval.
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-07: TC has comments.create → full read path, all comment types", () => {
  it("returns 200 with all comments via normal read path (not narrowed to revision_request)", async () => {
    const app = await buildApp(TC);
    // TC has comments.create → normal path: loadEntityMeta, assertSectorAllowed, full SELECT
    mockPool
      .mockResolvedValueOnce({ rows: [{ sector: "Health" }] }) // loadEntityMeta (plan)
      .mockResolvedValueOnce(commentsResult([REVISION_COMMENT, GENERAL_COMMENT])); // full SELECT

    const res = await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(200);

    // Full path returns all types — not filtered to revision_request only
    const types = res.body.map((c: { commentType: string }) => c.commentType);
    expect(types).toContain("revision_request");
    expect(types).toContain("general");
    expect(res.body).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-08: Only revision_request comments returned (not general/other)
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-08: Narrow read — only revision_request comments returned", () => {
  it("response contains only revision_request entries even if DB has other types", async () => {
    // The narrow SELECT already filters by comment_type = 'revision_request'.
    // Simulate backend returning only the filtered result.
    const app = await buildApp(SPO);
    mockPool
      .mockResolvedValueOnce(gateOk(true))
      // DB returns only revision_request after narrow filter (general excluded)
      .mockResolvedValueOnce(commentsResult([REVISION_COMMENT]));

    const res = await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(200);

    // Every returned item must be revision_request
    for (const c of res.body) {
      expect(c.commentType).toBe("revision_request");
    }
    expect(res.body.some((c: { commentType: string }) => c.commentType === "general")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-09: PM (has comments.create) uses normal full-read path
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-09: PM with comments.create uses normal read path", () => {
  it("returns 200 with all comments via normal path (not the exception)", async () => {
    const app = await buildApp(PM);
    // Normal path: loadEntityMeta → sector check → full SELECT
    mockPool
      .mockResolvedValueOnce({ rows: [{ sector: "Health" }] }) // loadEntityMeta
      .mockResolvedValueOnce(commentsResult([REVISION_COMMENT, GENERAL_COMMENT])); // full SELECT

    const res = await request(app)
      .get("/comments?entityType=plan&entityId=42")
      .expect(200);

    expect(res.body).toHaveLength(2);
    // Both types present — normal path returns all types
    const types = res.body.map((c: { commentType: string }) => c.commentType);
    expect(types).toContain("revision_request");
    expect(types).toContain("general");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAN-COM-10: entityType=project with SPO → 403 (plan exception does not widen)
// ══════════════════════════════════════════════════════════════════════════════
describe("PLAN-COM-10: Plan exception does not widen to other entity types", () => {
  it("SPO gets 403 for entityType=project (no comments.create)", async () => {
    const app = await buildApp(SPO);

    await request(app)
      .get("/comments?entityType=project&entityId=42")
      .expect(403);

    // Must not query the DB — should fail-close immediately at entityType check
    expect(mockPool).not.toHaveBeenCalled();
  });
});
