/**
 * MESSAGES-PATCH-BODY-VALIDATION — PATCH /messages/:msgId destructured
 * `{ body }` from the request with no runtime check that it was actually a
 * non-empty string. `if (body && body.length > 10_000)` short-circuits false
 * for `undefined`/`""`, so a request with no `body` field reached
 * `body.trim()` further down and threw `TypeError: Cannot read properties of
 * undefined (reading 'trim')` — caught by the outer try/catch and surfaced
 * as a generic 500 instead of a real 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const mockPoolQuery = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery, connect: vi.fn() } }));
vi.mock("../../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  hasPerm: vi.fn().mockReturnValue(true),
  permissionsFor: vi.fn().mockReturnValue(new Set(["messages.send"])),
  logAudit: vi.fn(),
  tcSectorRestriction: vi.fn().mockReturnValue(null),
  assertSectorAllowed: vi.fn().mockReturnValue({ ok: true }),
}));
vi.mock("../../lib/notifications", () => ({ createNotificationDeduped: vi.fn() }));
vi.mock("../../lib/realtime", () => ({
  realtime: { broadcastMessage: vi.fn(), broadcastConversationUpdate: vi.fn(), broadcastPersonalConversationUpdate: vi.fn() },
}));
vi.mock("../../lib/sectors", () => ({ VALID_SECTOR_SET: new Set(["Health"]) }));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class { getObjectEntityFile = vi.fn(); getObjectEntityMetadata = vi.fn(); finalizeObjectEntityUpload = vi.fn(); downloadObject = vi.fn(); },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

const { default: conversationsRouter } = await import("../conversations");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      id: 7, name: "Test", email: "t@test.example", role: "technical_coordinator",
      roleLabel: "TC", scope: "national", stateId: null, stateName: null,
      sector: null, avatarUrl: null, sectors: null,
    } as Request["currentUser"];
    next();
  });
  app.use(conversationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({
    rows: [{ sender_id: 7, conversation_id: 1, deleted_at: null, created_at: new Date().toISOString() }],
  });
});

describe("MESSAGES-PATCH-BODY-VALIDATION", () => {
  it("returns 400 body_required (not a 500) when body is missing entirely", async () => {
    const r = await supertest(makeApp()).patch("/messages/1").send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("body_required");
  });

  it("returns 400 body_required when body is an empty string", async () => {
    const r = await supertest(makeApp()).patch("/messages/1").send({ body: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("body_required");
  });

  it("returns 400 body_required when body is whitespace-only", async () => {
    const r = await supertest(makeApp()).patch("/messages/1").send({ body: "   " });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("body_required");
  });

  it("returns 400 body_required when body is not a string at all", async () => {
    const r = await supertest(makeApp()).patch("/messages/1").send({ body: 12345 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("body_required");
  });

  it("still enforces the 10,000 character limit for a real string body", async () => {
    const r = await supertest(makeApp()).patch("/messages/1").send({ body: "a".repeat(10_001) });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("message_too_long");
  });
});
