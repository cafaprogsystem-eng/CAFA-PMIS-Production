/**
 * AUTH-FORGOT-PASSWORD-EMAIL-STATUS — /auth/forgot-password only ever wrote
 * password_reset_tokens.email_status = 'sent' on success; on a failed send it
 * silently stayed at its default 'pending' forever, indistinguishable in the
 * admin token-management dashboard from a request that's merely still in
 * flight. A failed delivery must be recorded as 'failed'.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockSendEmail } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../lib/rate-limit-store", () => ({
  isRateLimited: vi.fn(async () => false),
  isAccountLocked: vi.fn(async () => false),
  recordFailedLogin: vi.fn(async () => {}),
  clearAccountFailures: vi.fn(async () => {}),
}));
vi.mock("../../lib/session", () => ({
  createSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn(),
  revokeSession: vi.fn(), revokeAllSessionsForUser: vi.fn(),
}));
vi.mock("../../lib/realtime", () => ({ realtime: { disconnectUser: vi.fn(), disconnectSession: vi.fn() } }));
vi.mock("../../middlewares/currentUser", () => ({ permissionsFor: vi.fn(() => []), logAudit: vi.fn(async () => {}) }));
vi.mock("../../lib/mailer", () => ({
  sendEmail: mockSendEmail,
  renderPasswordResetEmail: vi.fn(() => ({ subject: "s", html: "h", text: "t" })),
  renderPasswordResetConfirmEmail: vi.fn(),
  renderInviteEmail: vi.fn(),
  renderVerifyEmail: vi.fn(),
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
});

describe("AUTH-FORGOT-PASSWORD-EMAIL-STATUS", () => {
  it("records email_status='failed' when delivery fails", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [USER_ROW] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rows: [{ id: 77 }] };
      return { rows: [] };
    });
    mockSendEmail.mockResolvedValue({ delivered: false, provider: "resend", status: "failed" });

    const res = await request(makeApp()).post("/auth/forgot-password").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    const statusUpdate = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("SET email_status"));
    expect(statusUpdate?.[1]).toEqual(["failed", 77]);
  });

  it("records email_status='sent' when delivery succeeds", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [USER_ROW] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rows: [{ id: 78 }] };
      return { rows: [] };
    });
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "resend", status: "sent" });

    const res = await request(makeApp()).post("/auth/forgot-password").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    const statusUpdate = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("SET email_status"));
    expect(statusUpdate?.[1]).toEqual(["sent", 78]);
  });

  it("records email_status='failed' when sendEmail throws", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [USER_ROW] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rows: [{ id: 79 }] };
      return { rows: [] };
    });
    mockSendEmail.mockRejectedValue(new Error("network error"));

    const res = await request(makeApp()).post("/auth/forgot-password").send({ email: "target@test.com" });

    expect(res.status).toBe(200);
    const statusUpdate = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("SET email_status"));
    expect(statusUpdate?.[1]).toEqual(["failed", 79]);
  });
});
