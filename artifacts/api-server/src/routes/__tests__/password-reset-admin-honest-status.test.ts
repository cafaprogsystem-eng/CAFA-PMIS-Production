/**
 * PASSWORD-RESET-ADMIN-HONEST-STATUS — POST /password-reset-tokens/:id/resend
 * used to unconditionally report success: it always returned `ok:true` with
 * no delivery indicator, always wrote a "password_reset_email_sent" audit
 * entry, and only ever wrote email_status='sent' — never 'failed' — leaving
 * a failed send indistinguishable from "still pending" forever. An admin
 * relying on this response/audit trail to confirm a user was notified would
 * believe the email went out even when the provider rejected it.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockSendEmail, mockLogAudit } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockSendEmail: vi.fn(),
  mockLogAudit: vi.fn(async (_opts: { action: string; userId: number; module: string; entityId: number }) => {}),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../middlewares/currentUser", () => ({ logAudit: mockLogAudit }));
vi.mock("../../lib/mailer", () => ({
  sendEmail: mockSendEmail,
  renderPasswordResetEmail: vi.fn(() => ({ subject: "s", html: "h", text: "t" })),
  publicAppUrl: vi.fn(() => "https://app.test"),
}));

const router = (await import("../password-reset-admin")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { currentUser: { id: number; role: string } }).currentUser = { id: 9, role: "super_admin" };
    (req as unknown as { log: { warn: (...a: unknown[]) => void } }).log = { warn: vi.fn() };
    next();
  });
  app.use(router);
  return app;
}

const TOKEN_ROW = { userId: 1, name: "Target User", email: "target@test.com" };

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockSendEmail.mockReset();
  mockLogAudit.mockClear();
});

describe("PASSWORD-RESET-ADMIN-HONEST-STATUS", () => {
  it("reports delivered:false and logs a failure action when the send fails", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT prt.user_id")) return { rows: [TOKEN_ROW] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rows: [{ id: 55 }] };
      return { rows: [] };
    });
    mockSendEmail.mockResolvedValue({ delivered: false, provider: "resend", status: "failed" });

    const res = await request(makeApp()).post("/password-reset-tokens/42/resend").send({});

    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(false);
    expect(res.body.emailDelivery).toBe("failed");

    const emailStatusUpdate = mockPoolQuery.mock.calls.find(([sql]) => sql.includes("SET email_status"));
    expect(emailStatusUpdate?.[1]).toEqual(["failed", 55]);

    const auditCall = mockLogAudit.mock.calls[0][0];
    expect(auditCall.action).toBe("password_reset_email_failed");
  });

  it("reports delivered:true and logs a success action when the send succeeds", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT prt.user_id")) return { rows: [TOKEN_ROW] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rows: [{ id: 56 }] };
      return { rows: [] };
    });
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "resend", status: "sent" });

    const res = await request(makeApp()).post("/password-reset-tokens/42/resend").send({});

    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(true);
    expect(res.body.emailDelivery).toBe("sent");

    const emailStatusUpdate = mockPoolQuery.mock.calls.find(([sql]) => sql.includes("SET email_status"));
    expect(emailStatusUpdate?.[1]).toEqual(["sent", 56]);

    const auditCall = mockLogAudit.mock.calls[0][0];
    expect(auditCall.action).toBe("password_reset_email_sent");
  });

  it("still marks email_status='failed' when sendEmail throws instead of resolving", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT prt.user_id")) return { rows: [TOKEN_ROW] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rows: [{ id: 57 }] };
      return { rows: [] };
    });
    mockSendEmail.mockRejectedValue(new Error("network error"));

    const res = await request(makeApp()).post("/password-reset-tokens/42/resend").send({});

    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(false);
    expect(res.body.emailDelivery).toBe("failed");

    const emailStatusUpdate = mockPoolQuery.mock.calls.find(([sql]) => sql.includes("SET email_status"));
    expect(emailStatusUpdate?.[1]).toEqual(["failed", 57]);
  });
});
