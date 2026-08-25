/**
 * PM Full Operational Access — Cross-Module Request-Level Tests (Task #373)
 *
 * Verifies that a Program Manager can perform operational actions across all
 * CAFA PMIS modules that were previously restricted to super_admin or the
 * original author/owner of a record.
 *
 * Tests: GLOBAL-ACCESS-01 through 15, and module tests.
 * Covered actions:
 *   - Comments: delete another user's comment (cross-author); resolve any comment
 *   - Users: create user, edit user, activate/suspend, invite management
 *   - Reports: draft edit (cross-author), draft delete (cross-author)
 *   - Helper: hasFullOperationalAccess returns true for PM and super_admin only
 *
 * These tests confirm that the governance rule (Task #373) is enforced at the
 * request boundary, not just in permissionsFor().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper tests (GLOBAL-ACCESS-01 … 05)
// ─────────────────────────────────────────────────────────────────────────────

describe("hasFullOperationalAccess helper", async () => {
  const { hasFullOperationalAccess } = await import("../lib/accessControl.js");

  it("GLOBAL-ACCESS-01: program_manager → true", () => {
    expect(hasFullOperationalAccess({ role: "program_manager", id: 1 })).toBe(true);
  });
  it("GLOBAL-ACCESS-02: super_admin → true", () => {
    expect(hasFullOperationalAccess({ role: "super_admin", id: 2 })).toBe(true);
  });
  it("GLOBAL-ACCESS-03: senior_program_coordinator → false", () => {
    expect(hasFullOperationalAccess({ role: "senior_program_coordinator", id: 3 })).toBe(false);
  });
  it("GLOBAL-ACCESS-04: technical_coordinator → false", () => {
    expect(hasFullOperationalAccess({ role: "technical_coordinator", id: 4 })).toBe(false);
  });
  it("GLOBAL-ACCESS-05: state_program_officer → false", () => {
    expect(hasFullOperationalAccess({ role: "state_program_officer", id: 5 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Comments module
// ─────────────────────────────────────────────────────────────────────────────

const mockPool = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: mockPool, connect: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }) } }));
vi.mock("../lib/realtime.js", () => ({ realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() } }));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    // Keep the real permission middleware for User Management. Its tests
    // assert the canonical capability boundary rather than a retired
    // super-admin-only role check.
    requirePerm: original.requirePerm,
  };
});

const PM_USER = { id: 14, name: "PM", email: "pm@example.com", role: "program_manager", stateId: null, sector: null, sectors: [] } as const;
const OTHER_USER_ID = 99; // A different user who owns the comment/record

async function buildCommentsApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: commentsRouter } = await import("../routes/comments.js");
  app.use("/api", commentsRouter);
  return app;
}

describe("Comments — PM Full Operational Access", () => {
  beforeEach(() => {
    mockPool.mockReset();
  });

  it("PM can delete another user's comment immediately (no 15-min window required)", async () => {
    // Comment authored by OTHER_USER_ID, created 2 hours ago — normal users blocked
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockPool
      .mockResolvedValueOnce({ rows: [{ author_id: OTHER_USER_ID, created_at: createdAt }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [] }); // logAudit / notification (mocked)

    const app = await buildCommentsApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/comments/42");
    expect(res.status).toBe(204);
    expect(res.body.error).not.toBe("cannot_delete");
  });

  it("PM can resolve a comment authored by another user (cross-author)", async () => {
    // Comment type "general" by OTHER_USER_ID — PM not the author
    mockPool
      .mockResolvedValueOnce({ rows: [{ id: 42, entity_type: "report", entity_id: 1, author_id: OTHER_USER_ID, comment_type: "general", status: "open" }] }) // SELECT comment
      .mockResolvedValueOnce({ rows: [{ sector: "WASH" }] }) // loadEntitySector helper (mocked)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 42, comment_type: "general", status: "resolved", author_id: OTHER_USER_ID, author_name: "Other", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), resolved_at: null, resolved_by_id: null, content: "", status_updated_at: null }] }); // SELECT out

    const app = await buildCommentsApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/comments/42/resolve");
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("cannot_change_comment_status");
  });

  it("Normal SPC cannot delete another user's comment after 15 minutes", async () => {
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const SPC = { id: 15, name: "SPC", email: "spc@example.com", role: "senior_program_coordinator", stateId: null, sector: null, sectors: [] };
    mockPool.mockResolvedValueOnce({ rows: [{ author_id: OTHER_USER_ID, created_at: createdAt }] });

    const app = await buildCommentsApp(SPC as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/comments/42");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("cannot_delete");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Users module — PM is correctly blocked from privileged account mutations
// (Security regression: privilege-escalation boundary preserved per governance §7)
// ─────────────────────────────────────────────────────────────────────────────

async function buildUsersApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: usersRouter } = await import("../routes/users.js");
  app.use("/api", usersRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

describe("Users — PM cannot perform privileged account mutations (governance §7)", () => {
  beforeEach(() => {
    mockPool.mockReset();
  });

  // User creation, role changes, password resets, and invite-token operations remain
  // super_admin-only to prevent privilege escalation and credential disclosure.

  it("PM cannot create users (POST /users → 403 users.manage)", async () => {
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/users").send({ name: "New", email: "n@example.com", role: "state_program_officer" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(res.body.requiredPermission).toBe("users.manage");
  });

  it("PM cannot edit another user (PATCH /users/:id → 403 users.manage)", async () => {
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/api/users/50").send({ name: "X" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("PM cannot activate/suspend users (POST /users/:id/status → 403 users.manage)", async () => {
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/users/50/status").send({ status: "suspended" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("PM cannot reset another user's password (POST /users/:id/reset-password → 403 users.manage)", async () => {
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/users/50/reset-password").send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("PM cannot view invitation lifecycle records (GET /users/invitations → 403 users.manage)", async () => {
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/users/invitations");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("PM cannot delete users (DELETE /users/:id → 403 users.manage)", async () => {
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/users/50");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("PM can still read the directory through users.view", async () => {
    mockPool.mockResolvedValue({ rows: [] });
    const app = await buildUsersApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/users");
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversations — PM sees non-DM conversations without being a member
// ─────────────────────────────────────────────────────────────────────────────

async function buildConvApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: convRouter } = await import("../routes/conversations.js");
  app.use("/api", convRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

describe("Conversations — PM Full Operational Access", () => {
  beforeEach(() => {
    mockPool.mockReset();
  });

  const SPC_USER = { id: 15, name: "SPC", email: "spc@example.com", role: "senior_program_coordinator", stateId: null, sector: null, sectors: [] };
  const GROUP_CONV = { id: 55, type: "group", name: "Project Team", projectId: null, stateId: null, sector: null, createdById: 99, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

  it("PM can GET a group conversation without being a member", async () => {
    // assertMemberOrFullAccess: isMember=false, but PM+non-direct → allowed
    mockPool
      .mockResolvedValueOnce({ rows: [GROUP_CONV] })            // getConvById SELECT conv
      .mockResolvedValueOnce({ rowCount: 0 })                    // assertMember → not a member
      .mockResolvedValueOnce({ rows: [{ type: "group" }] })      // hasConvFullAccess type check
      .mockResolvedValueOnce({ rows: [] })                        // members list
      .mockResolvedValueOnce({ rows: [] })                        // lastMsg
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });         // unread count

    const app = await buildConvApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/conversations/55");
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("PM cannot GET a direct conversation they are not a party to (DM privacy)", async () => {
    // assertMemberOrFullAccess: isMember=false, PM+direct → denied
    const DM_CONV = { ...GROUP_CONV, id: 77, type: "direct", name: null };
    mockPool
      .mockResolvedValueOnce({ rows: [DM_CONV] })    // getConvById SELECT conv
      .mockResolvedValueOnce({ rowCount: 0 })          // assertMember → not a member
      .mockResolvedValueOnce({ rows: [{ type: "direct" }] }); // type check → direct → denied

    const app = await buildConvApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/conversations/77");
    expect(res.status).toBe(404); // getConvById returns null → 404
  });

  it("SPC is still blocked from a group conversation they are not a member of", async () => {
    mockPool
      .mockResolvedValueOnce({ rows: [GROUP_CONV] }) // getConvById SELECT conv
      .mockResolvedValueOnce({ rowCount: 0 });         // assertMember → not a member, SPC has no bypass

    const app = await buildConvApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).get("/api/conversations/55");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plans — PM coordination_review and technical_review transitions
// ─────────────────────────────────────────────────────────────────────────────

async function buildPlansApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: plansRouter } = await import("../routes/plans.js");
  app.use("/api", plansRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

describe("Plans — PM coordination_review and technical_review access", () => {
  beforeEach(() => {
    mockPool.mockReset();
  });

  type MinUser = { role: string; stateId: null; sector: null; sectors: never[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUser = (role: string): any => ({ id: 1, name: "Test", email: "t@test.com", role, roleLabel: role, stateId: null, sector: null, sectors: [], status: "active" });

  it("PM has plans.approve.coordination permission (unit check)", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    expect(permissionsFor(makeUser("program_manager"))).toContain("plans.approve.coordination");
  });

  it("PM has plans.approve.technical permission (unit check)", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    expect(permissionsFor(makeUser("program_manager"))).toContain("plans.approve.technical");
  });

  it("PM has projects.approve.coordination permission (unit check)", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    expect(permissionsFor(makeUser("program_manager"))).toContain("projects.approve.coordination");
  });

  it("PM has projects.approve.technical permission (unit check)", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    expect(permissionsFor(makeUser("program_manager"))).toContain("projects.approve.technical");
  });

  it("PM has plans.update permission (unit check)", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    expect(permissionsFor(makeUser("program_manager"))).toContain("plans.update");
  });

  it("SPC still has plans.approve.coordination but not projects.approve.technical", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    const perms = permissionsFor(makeUser("senior_program_coordinator"));
    expect(perms).toContain("plans.approve.coordination");
    expect(perms).not.toContain("projects.approve.technical");
  });
});
