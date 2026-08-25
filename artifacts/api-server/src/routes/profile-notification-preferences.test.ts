import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetProfileResponse } from "@workspace/api-zod";

const { mockPoolQuery, mockLogAudit } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../middlewares/currentUser.js", () => ({ logAudit: mockLogAudit }));

const profileRouter = (await import("./profile")).default;

function appFor(userId: number) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: userId } as NonNullable<Request["currentUser"]>;
    next();
  });
  app.use(profileRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe("NOTIF-006 preference persistence validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { inApp: { typoCategory: true } },
    { email: { assignments: "yes" } },
    { digest: "daily" },
    { quietHours: { enabled: true, start: "25:00" } },
    { quietHours: { timezone: "Mars/Olympus" } },
    { unexpected: true },
  ])("rejects malformed or unavailable preference settings: %o", async (notificationPreferences) => {
    const response = await request(appFor(7))
      .patch("/profile")
      .send({ notificationPreferences })
      .expect(422);

    expect(response.body.error).toBe("invalid_notification_preferences");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("persists canonical immediate preferences and rejects no supported keys", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, notificationPreferences: { digest: "immediate" } }] });

    await request(appFor(7))
      .patch("/profile")
      .send({
        notificationPreferences: {
          inApp: { assignments: false },
          email: { mentions: true },
          deliveryOption: "both",
          digest: "immediate",
          quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "Africa/Khartoum" },
        },
      })
      .expect(200);

    const updateArgs = mockPoolQuery.mock.calls[0][1] as unknown[];
    expect(String(updateArgs[0])).toContain('"digest":"immediate"');
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });

  it("normalises legacy stored values before returning the profile contract", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 7,
        name: "Legacy user",
        role: "viewer",
        scope: "state",
        notificationPreferences: {
          digest: "weekly",
          inApp: { oldCategory: false },
        },
      }],
    });

    const response = await request(appFor(7)).get("/profile").expect(200);

    expect(response.body.notificationPreferences).toMatchObject({
      digest: "immediate",
      deliveryOption: "both",
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
      inApp: { assignments: true },
    });
    expect(GetProfileResponse.safeParse(response.body).success).toBe(true);
  });
});

// ── NOTIF-MANDATORY: mandatory category coercion ───────────────────────────────

describe("NOTIF-MANDATORY mandatory category coercion on PATCH", () => {
  beforeEach(() => vi.clearAllMocks());

  it("coerces criticalRisks:false to true in the persisted JSON", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });

    await request(appFor(7))
      .patch("/profile")
      .send({
        notificationPreferences: {
          inApp: { criticalRisks: false },
          email: { criticalRisks: false, passwordReset: false },
        },
      })
      .expect(200);

    const updateArgs = mockPoolQuery.mock.calls[0][1] as unknown[];
    const stored = JSON.parse(String(updateArgs[0]));
    // Mandatory flags must always be persisted as true regardless of input
    expect(stored.inApp.criticalRisks).toBe(true);
    expect(stored.email.criticalRisks).toBe(true);
    expect(stored.email.passwordReset).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });

  it("GET /profile always returns mandatory categories as true even for legacy rows", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 7,
        name: "Old user",
        role: "viewer",
        scope: "state",
        // Simulates a legacy row where mandatory flags were stored as false
        notificationPreferences: {
          inApp: { criticalRisks: false },
          email: { criticalRisks: false, passwordReset: false },
        },
      }],
    });

    const response = await request(appFor(7)).get("/profile").expect(200);

    expect(response.body.notificationPreferences.inApp.criticalRisks).toBe(true);
    expect(response.body.notificationPreferences.email.criticalRisks).toBe(true);
    expect(response.body.notificationPreferences.email.passwordReset).toBe(true);
  });
});

// ── NOTIF-IDOR: self-scope isolation ──────────────────────────────────────────

describe("NOTIF-IDOR self-scope isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /profile resolves only from the authenticated user's ID, not a body field", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 42, name: "Alice", role: "viewer", scope: "state", notificationPreferences: null }],
    });

    const response = await request(appFor(42)).get("/profile").expect(200);

    // The query must have been called with the authenticated user's ID (42)
    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params).toContain(42);
    // No other ID should appear in the query params
    expect(params).not.toContain(99);
    expect(response.body.id).toBe(42);
  });

  it("PATCH /profile with a body userId field is rejected as a forbidden field", async () => {
    const response = await request(appFor(42))
      .patch("/profile")
      .send({ userId: 99, name: "Hacked" })
      .expect(400);

    expect(response.body.error).toBe("forbidden_profile_field");
    // The pool must not have been called — no mutation occurred
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("PATCH /profile with a body id field is rejected as a forbidden field", async () => {
    const response = await request(appFor(42))
      .patch("/profile")
      .send({ id: 99, name: "Hacked" })
      .expect(400);

    expect(response.body.error).toBe("forbidden_profile_field");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("PATCH /profile notificationPreferences updates only the authenticated user, ignoring any embedded target id", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 42, notificationPreferences: null }] }); // SELECT after update

    await request(appFor(42))
      .patch("/profile")
      .send({ notificationPreferences: { digest: "immediate" } })
      .expect(200);

    // The UPDATE must have been called with the authenticated user's ID (42), not any other
    const updateCall = mockPoolQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.toUpperCase().startsWith("UPDATE"),
    );
    expect(updateCall).toBeDefined();
    const updateParams = updateCall![1] as unknown[];
    // The last param is always the WHERE id = $n
    expect(updateParams[updateParams.length - 1]).toBe(42);
  });
});

// ── NOTIF-PREC: preference precedence ─────────────────────────────────────────

describe("NOTIF-PREC preference schema normalisation invariants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("null notificationPreferences on PATCH resets to full defaults", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });

    await request(appFor(7))
      .patch("/profile")
      .send({ notificationPreferences: null })
      .expect(200);

    const updateArgs = mockPoolQuery.mock.calls[0][1] as unknown[];
    const stored = JSON.parse(String(updateArgs[0]));
    expect(stored.deliveryOption).toBe("both");
    expect(stored.digest).toBe("immediate");
    expect(stored.inApp.criticalRisks).toBe(true);
    expect(stored.email.passwordReset).toBe(true);
  });

  it("digest:daily is rejected at the schema validation boundary", async () => {
    const response = await request(appFor(7))
      .patch("/profile")
      .send({ notificationPreferences: { digest: "daily" } })
      .expect(422);

    expect(response.body.error).toBe("invalid_notification_preferences");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
