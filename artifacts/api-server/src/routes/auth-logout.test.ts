import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRevokeSession,
  mockClearSessionCookie,
  mockDisconnectSession,
  mockLogAudit,
} = vi.hoisted(() => ({
  mockRevokeSession: vi.fn(),
  mockClearSessionCookie: vi.fn((res: express.Response) =>
    res.clearCookie("cafa_sid"),
  ),
  mockDisconnectSession: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../lib/session", () => ({
  clearSessionCookie: mockClearSessionCookie,
  createSession: vi.fn(),
  revokeSession: mockRevokeSession,
  setSessionCookie: vi.fn(),
}));
vi.mock("../lib/realtime", () => ({
  realtime: { disconnectSession: mockDisconnectSession },
}));
vi.mock("../middlewares/currentUser", () => ({
  logAudit: mockLogAudit,
  permissionsFor: vi.fn(() => []),
  requireAuth: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));
vi.mock("../lib/mailer", () => ({
  publicAppUrl: vi.fn(),
  renderInviteEmail: vi.fn(),
  renderPasswordResetConfirmEmail: vi.fn(),
  renderPasswordResetEmail: vi.fn(),
  renderVerifyEmail: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock("../lib/notifications", () => ({ createNotificationDeduped: vi.fn() }));

const { default: authRouter } = await import("./auth");

function makeApp(
  session:
    | { id: string; userId: number; expiresAt: Date }
    | null
    | undefined = undefined,
) {
  const effectiveSession =
    session === undefined
      ? { id: "session-1", userId: 7, expiresAt: new Date("2030-01-01") }
      : session;
  const app = express();
  app.use((req, _res, next) => {
    req.authSession = effectiveSession ?? undefined;
    next();
  });
  app.use(authRouter);
  return app;
}

describe("POST /auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevokeSession.mockResolvedValue(true);
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("revokes the underlying session before socket disconnect, audit, and cookie clearing", async () => {
    const response = await supertest(makeApp()).post("/auth/logout");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mockRevokeSession).toHaveBeenCalledWith("session-1");
    expect(mockDisconnectSession).toHaveBeenCalledWith("session-1");
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: "logout",
      }),
    );
    expect(mockRevokeSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearSessionCookie.mock.invocationCallOrder[0],
    );
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when no active session remains, while still clearing the cookie", async () => {
    const response = await supertest(makeApp(null)).post("/auth/logout");

    expect(response.status).toBe(200);
    expect(mockRevokeSession).not.toHaveBeenCalled();
    expect(mockDisconnectSession).not.toHaveBeenCalled();
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("does not claim success or clear the cookie when durable revocation fails", async () => {
    mockRevokeSession.mockRejectedValueOnce(new Error("database unavailable"));
    const app = makeApp();
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({ error: err.message });
      },
    );

    const response = await supertest(app).post("/auth/logout");

    expect(response.status).toBe(500);
    expect(mockClearSessionCookie).not.toHaveBeenCalled();
    expect(mockDisconnectSession).not.toHaveBeenCalled();
  });
});
