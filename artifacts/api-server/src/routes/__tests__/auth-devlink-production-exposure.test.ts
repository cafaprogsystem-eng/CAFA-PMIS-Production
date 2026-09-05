/**
 * AUTH-DEVLINK-PRODUCTION-EXPOSURE — /auth/forgot-password and
 * /auth/send-verification-email are public, unauthenticated endpoints that
 * fall back to returning the raw reset/verification link in the JSON
 * response whenever sendEmail() reports delivered:false — regardless of
 * *why* delivery failed (stub mode, missing provider key, a provider
 * outage, an unverified sender domain...). In production that fallback is
 * an account-takeover primitive handed to whoever submitted the target's
 * email address, not a debugging convenience, so it must never appear when
 * NODE_ENV=production — only the neutral, delivery-status-agnostic message
 * may be returned there.
 */
import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockSendEmail, mockIsRateLimited } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockSendEmail: vi.fn(),
  mockIsRateLimited: vi.fn(async () => false),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../lib/rate-limit-store", () => ({
  isRateLimited: mockIsRateLimited,
  isAccountLocked: vi.fn(async () => false),
  recordFailedLogin: vi.fn(async () => {}),
  clearAccountFailures: vi.fn(async () => {}),
}));
vi.mock("../../lib/session", () => ({
  createSession: vi.fn(async () => ({ session: { id: "s1", userId: 1, expiresAt: new Date() }, token: "tok" })),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessionsForUser: vi.fn(),
}));
vi.mock("../../lib/realtime", () => ({ realtime: { disconnectUser: vi.fn(), disconnectSession: vi.fn() } }));
vi.mock("../../middlewares/currentUser", () => ({
  permissionsFor: vi.fn(() => []),
  logAudit: vi.fn(async () => {}),
}));
vi.mock("../../lib/mailer", () => ({
  sendEmail: mockSendEmail,
  renderPasswordResetEmail: vi.fn(() => ({ subject: "s", html: "h", text: "t" })),
  renderPasswordResetConfirmEmail: vi.fn(),
  renderInviteEmail: vi.fn(),
  renderVerifyEmail: vi.fn(() => ({ subject: "s", html: "h", text: "t" })),
  publicAppUrl: vi.fn(() => "https://app.test"),
}));
vi.mock("../../lib/notifications", () => ({ createNotificationDeduped: vi.fn() }));

const authRouter = (await import("../auth")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
}

const USER_ROW = { id: 1, name: "Target User", email: "target@test.com" };

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockSendEmail.mockReset();
  mockIsRateLimited.mockClear();
});

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("AUTH-DEVLINK-PRODUCTION-EXPOSURE — /auth/forgot-password", () => {
  it("withholds devResetLink when NODE_ENV=production, even though delivery failed", async () => {
    process.env.NODE_ENV = "production";
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [USER_ROW] };
      return { rows: [{ id: 99 }] };
    });
    mockSendEmail.mockResolvedValue({ delivered: false, provider: "resend", status: "failed" });

    const res = await request(makeApp()).post("/auth/forgot-password").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("devResetLink");
    expect(res.body).toEqual({ ok: true, message: "If the email is registered, a password reset link has been sent." });
  });

  it("still surfaces devResetLink outside production (existing tester convenience)", async () => {
    process.env.NODE_ENV = "development";
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [USER_ROW] };
      return { rows: [{ id: 99 }] };
    });
    mockSendEmail.mockResolvedValue({ delivered: false, provider: "stub", status: "pending" });

    const res = await request(makeApp()).post("/auth/forgot-password").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.devResetLink).toContain("/reset-password?token=");
  });
});

describe("AUTH-DEVLINK-PRODUCTION-EXPOSURE — /auth/send-verification-email", () => {
  it("withholds devVerifyLink when NODE_ENV=production, even though delivery failed", async () => {
    process.env.NODE_ENV = "production";
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [{ ...USER_ROW, email_verified: false }] };
      return { rows: [] };
    });
    mockSendEmail.mockResolvedValue({ delivered: false, provider: "resend", status: "failed" });

    const res = await request(makeApp()).post("/auth/send-verification-email").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("devVerifyLink");
    expect(res.body).toEqual({ ok: true, message: "If that email is registered, a verification link has been sent." });
  });

  it("still surfaces devVerifyLink outside production (existing tester convenience)", async () => {
    process.env.NODE_ENV = "development";
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [{ ...USER_ROW, email_verified: false }] };
      return { rows: [] };
    });
    mockSendEmail.mockResolvedValue({ delivered: false, provider: "stub", status: "pending" });

    const res = await request(makeApp()).post("/auth/send-verification-email").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.devVerifyLink).toContain("/verify-email?token=");
  });
});
