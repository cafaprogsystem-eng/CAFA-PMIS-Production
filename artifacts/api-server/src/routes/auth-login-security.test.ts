/**
 * AUTH-LOGIN-SECURITY — POST /auth/login timing side-channel + account lockout.
 *
 * 1. An identifier that matches no account must take comparably long to
 *    reject as one that matches an account with the wrong password — a real
 *    bcrypt comparison must run either way (DUMMY_PASSWORD_HASH in auth.ts),
 *    not a fast DB-miss early return.
 * 2. Ten consecutive failed attempts against the SAME identifier lock that
 *    account out for a cooldown window, independent of the caller's IP
 *    (which this harness never varies) and independent of whether the very
 *    next attempt supplies the correct password.
 */
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../lib/session", () => ({
  createSession: vi.fn(async () => ({ session: { id: "s1", userId: 1, expiresAt: new Date() }, token: "tok" })),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessionsForUser: vi.fn(),
}));
vi.mock("../lib/realtime", () => ({ realtime: { disconnectUser: vi.fn(), disconnectSession: vi.fn() } }));
vi.mock("../middlewares/currentUser", () => ({
  permissionsFor: vi.fn(() => []),
  logAudit: vi.fn(async () => {}),
}));
vi.mock("../lib/mailer", () => ({
  sendEmail: vi.fn(),
  renderPasswordResetEmail: vi.fn(),
  renderPasswordResetConfirmEmail: vi.fn(),
  renderInviteEmail: vi.fn(),
  renderVerifyEmail: vi.fn(),
  publicAppUrl: vi.fn(() => "https://app.test"),
}));
vi.mock("../lib/notifications", () => ({ createNotificationDeduped: vi.fn() }));

const authRouter = (await import("./auth")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal", detail: String(err) });
  });
  return app;
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Test User", email: "user@test.com", username: "user",
    password_hash: null, role: "viewer", role_label: "Viewer", scope: "hq",
    state_id: null, sector: null, status: "active", state_name: null,
    ...overrides,
  };
}

let realCostHash: string;

beforeAll(async () => {
  // Cost 12 — matches the cost the real route hashes with, and matches
  // DUMMY_PASSWORD_HASH's cost, so both timing measurements below are
  // comparing like with like.
  realCostHash = await bcrypt.hash("CorrectPassw0rd", 12);
});

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("AUTH-LOGIN-SECURITY — timing side-channel", () => {
  it("an unknown identifier takes comparably long to reject as a wrong password on a real account", async () => {
    const app = makeApp();

    mockPoolQuery.mockResolvedValueOnce({ rows: [userRow({ password_hash: realCostHash })] });
    const t0 = Date.now();
    const wrongPasswordRes = await request(app).post("/auth/login").send({ identifier: "user@test.com", password: "not-the-password" });
    const wrongPasswordMs = Date.now() - t0;

    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const t1 = Date.now();
    const notFoundRes = await request(app).post("/auth/login").send({ identifier: "no-such-user@test.com", password: "not-the-password" });
    const notFoundMs = Date.now() - t1;

    expect(wrongPasswordRes.status).toBe(401);
    expect(notFoundRes.status).toBe(401);
    expect(wrongPasswordRes.body).toEqual(notFoundRes.body);
    // A bare DB-miss early return (the old behaviour) completes in a few ms.
    // A real bcrypt cost-12 comparison takes tens of milliseconds. Both
    // branches must now run one.
    expect(wrongPasswordMs).toBeGreaterThan(15);
    expect(notFoundMs).toBeGreaterThan(15);
  });
});

describe("AUTH-LOGIN-SECURITY — account-level lockout", () => {
  it("locks an account after repeated failed attempts, rejecting even a subsequent correct password", async () => {
    const app = makeApp();
    const hash = await bcrypt.hash("CorrectPassw0rd", 4); // cheap cost — only the lockout counter is under test here
    mockPoolQuery.mockResolvedValue({ rows: [userRow({ id: 42, email: "lockme@test.com", username: "lockme", password_hash: hash })] });

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post("/auth/login").send({ identifier: "lockme@test.com", password: "WrongPassword" });
      expect(res.status).toBe(401);
    }

    const lockedOut = await request(app).post("/auth/login").send({ identifier: "lockme@test.com", password: "CorrectPassw0rd" });
    expect(lockedOut.status).toBe(429);
    expect(lockedOut.body).toEqual({ error: "too_many_requests" });
  });

  it("does not lock out a different account that never failed", async () => {
    const app = makeApp();
    const hash = await bcrypt.hash("CorrectPassw0rd", 4);
    mockPoolQuery.mockResolvedValue({ rows: [userRow({ id: 43, email: "victim@test.com", username: "victim", password_hash: hash })] });

    for (let i = 0; i < 10; i += 1) {
      await request(app).post("/auth/login").send({ identifier: "attacker-target@test.com", password: "WrongPassword" });
    }

    const unrelated = await request(app).post("/auth/login").send({ identifier: "victim@test.com", password: "CorrectPassw0rd" });
    expect(unrelated.status).toBe(200);
  });
});
