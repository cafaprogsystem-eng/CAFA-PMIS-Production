/**
 * USERS-PATCH-UNIQUENESS-RACE — PATCH /users/:id's email/username uniqueness
 * check has a TOCTOU race: the SELECT-based pre-check can pass for two
 * concurrent PATCHes both changing different users to the same new
 * email/username before either UPDATE commits. Unlike POST /users (which
 * catches the resulting 23505 unique-violation and returns a clean 409), the
 * PATCH UPDATE had no such handling — a losing concurrent request would 500
 * from the generic error handler instead of getting "email_taken"/
 * "username_taken".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const mockPoolQuery = vi.fn();

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../lib/realtime", () => ({
  realtime: {
    publishSupportingEvent: vi.fn().mockResolvedValue(undefined),
    publishAuthorizationChanged: vi.fn().mockResolvedValue(undefined),
    disconnectUser: vi.fn(),
    isUserOnline: vi.fn().mockReturnValue(false),
  },
}));
vi.mock("../../lib/mailer", () => ({
  sendEmail: vi.fn(), renderInviteEmail: vi.fn(), renderAccountActivatedEmail: vi.fn(),
  renderAccountSuspendedEmail: vi.fn(), renderAccountDeactivatedEmail: vi.fn(),
}));
vi.mock("../../lib/state-master", () => ({ assertActiveState: vi.fn() }));
vi.mock("../../lib/session", () => ({ revokeAllSessionsForUser: vi.fn() }));
vi.mock("../../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { default: usersRouter } = await import("../users");

const ACTOR = { id: 1, name: "Admin", role: "super_admin" };
const EXISTING_USER = {
  id: 42, name: "Colleague", email: "colleague@example.com", username: "colleague",
  phone: null, role: "program_manager", scope: "hq", state_id: null, sector: null,
  status: "active", role_label: "Program Manager",
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.currentUser = ACTOR as Request["currentUser"]; next(); });
  app.use(usersRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("USERS-PATCH-UNIQUENESS-RACE: a 23505 from the UPDATE itself is caught, not a raw 500", () => {
  it("returns 409 email_taken when the UPDATE hits a unique violation on email", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT * FROM users WHERE id")) return { rows: [{ ...EXISTING_USER }] };
      // Pre-check race: passes here, but the concurrent request already committed.
      if (sql.includes("SELECT id FROM users WHERE LOWER(email)")) return { rows: [] };
      if (sql.includes("UPDATE users SET")) {
        const err = new Error("duplicate key value violates unique constraint") as Error & { code: string; constraint: string };
        err.code = "23505";
        err.constraint = "users_email_key";
        throw err;
      }
      return { rows: [] };
    });

    const res = await supertest(makeApp()).patch("/users/42").send({ email: "taken@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_taken");
  });

  it("returns 409 username_taken when the UPDATE hits a unique violation on username", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT * FROM users WHERE id")) return { rows: [{ ...EXISTING_USER }] };
      if (sql.includes("SELECT id FROM users WHERE LOWER(COALESCE(username")) return { rows: [] };
      if (sql.includes("UPDATE users SET")) {
        const err = new Error("duplicate key value violates unique constraint") as Error & { code: string; constraint: string };
        err.code = "23505";
        err.constraint = "users_username_key";
        throw err;
      }
      return { rows: [] };
    });

    const res = await supertest(makeApp()).patch("/users/42").send({ username: "taken" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("username_taken");
  });

  it("a non-23505 UPDATE error still propagates as a 500 (not silently swallowed)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT * FROM users WHERE id")) return { rows: [{ ...EXISTING_USER }] };
      if (sql.includes("UPDATE users SET")) throw new Error("connection reset");
      return { rows: [] };
    });

    const res = await supertest(makeApp()).patch("/users/42").send({ name: "New Name" });
    expect(res.status).toBe(500);
  });
});
