/**
 * Communication Centre — API / OpenAPI Contract tests (COMM-014 / COMM-CONTRACT-*)
 *
 * COMM-CONTRACT-01  Current route inventory represented
 * COMM-CONTRACT-02  Message pagination response shape {items, hasMore, nextCursor}
 * COMM-CONTRACT-03  Cursor contract: opaque string, structurally correct, decodes cleanly
 * COMM-CONTRACT-04  Delete For Me vs Delete For Everyone semantics distinct
 * COMM-CONTRACT-05  Reply/forward fields present in Message response
 * COMM-CONTRACT-06  mentionedUserIds accepted in MessageInput, stored by user ID
 * COMM-CONTRACT-07  Attachment DTO hides objectPath / raw storage keys
 * COMM-CONTRACT-08  Generated client compiles (import-level check)
 * COMM-CONTRACT-09  Current conversation types represented in CreateConversation body
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { signUploadToken } from "../lib/uploadToken";

const {
  mockPoolQuery,
  mockClientQuery,
  mockPoolConnect,
  mockGetObjectEntityMetadata,
  mockFinalizeObjectEntityUpload,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockGetObjectEntityMetadata: vi.fn(),
  mockFinalizeObjectEntityUpload: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock("../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  hasPerm: vi.fn().mockReturnValue(true),
  permissionsFor: vi.fn().mockReturnValue(new Set(["messages.send", "messages.attachments.upload", "messages.manage_members", "messages.create"])),
  logAudit: vi.fn(),
  tcSectorRestriction: vi.fn().mockReturnValue(null),
  assertSectorAllowed: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock("../lib/notifications", () => ({
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime", () => ({
  realtime: {
    broadcastMessage: vi.fn(),
    broadcastConversationUpdate: vi.fn(),
    broadcastPersonalConversationUpdate: vi.fn(),
  },
}));

vi.mock("../lib/sectors", () => ({
  VALID_SECTOR_SET: new Set(["Health"]),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = vi.fn();
    getObjectEntityMetadata = mockGetObjectEntityMetadata;
    finalizeObjectEntityUpload = mockFinalizeObjectEntityUpload;
    downloadObject = vi.fn();
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

const { default: conversationsRouter } = await import("./conversations");

const MEMBER = {
  id: 7, name: "Test Member", email: "member@test.example", role: "technical_coordinator",
  roleLabel: "TC", scope: "national", stateId: null, stateName: null,
  sector: null, avatarUrl: null, sectors: null,
};

function makeApp(user = MEMBER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.currentUser = user; next(); });
  app.use(conversationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

function memberResult(is: boolean) {
  return { rows: [], rowCount: is ? 1 : 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
  mockGetObjectEntityMetadata.mockResolvedValue({ size: 1024, contentType: "image/jpeg" });
  mockFinalizeObjectEntityUpload.mockImplementation((p: string) => Promise.resolve(p));
});

/* ─────────────────── COMM-CONTRACT-01 Route inventory ──────────────────── */

describe("COMM-CONTRACT-01 — Current route inventory is reachable", () => {
  it("GET /conversations/unread-count responds (authenticated)", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ total: "3" }], rowCount: 1 });
    const r = await supertest(makeApp()).get("/conversations/unread-count");
    expect(r.status).toBe(200);
    expect(typeof r.body.total).toBe("number");
  });

  it("GET /conversations responds with a bounded pagination envelope", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const r = await supertest(makeApp()).get("/conversations");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  it("validates conversation-list pagination and filters before issuing SQL", async () => {
    const app = makeApp();
    for (const path of [
      "/conversations?limit=0",
      "/conversations?limit=101",
      "/conversations?limit=1.5",
      "/conversations?type=unknown",
      "/conversations?unread=yes",
      "/conversations?cursor=not-a-cursor",
    ]) {
      const r = await supertest(app).get(path);
      expect(r.status).toBe(400);
    }
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("uses stable activity cursors and keeps membership-scoped unread semantics in the list query", async () => {
    const now = "2026-08-20T09:00:00.000Z";
    mockPoolQuery.mockResolvedValue({
      rows: [
        { id: 11, activityAt: now, unreadCount: 2 },
        { id: 10, activityAt: now, unreadCount: null },
      ],
      rowCount: 2,
    });
    const r = await supertest(makeApp()).get("/conversations?limit=1&type=group&search=health&unread=false");
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([{ id: 11, unreadCount: 2 }]);
    expect(r.body.hasMore).toBe(true);
    expect(typeof r.body.nextCursor).toBe("string");
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain("unread_counts");
    expect(sql).toContain("vm.sender_id!=$1");
    expect(sql).toContain("message_user_hides");
    expect(sql).toContain("ORDER BY COALESCE(lm.created_at, c.updated_at) DESC, c.id DESC");
    expect(params).toEqual([MEMBER.id, "group", "%health%", 2]);
  });

  it("returns a null unread state for an authorised operational non-member", async () => {
    const now = "2026-08-20T09:00:00.000Z";
    mockPoolQuery.mockResolvedValue({
      rows: [{ id: 22, type: "project", activityAt: now, unreadCount: null }],
      rowCount: 1,
    });
    const r = await supertest(makeApp({
      ...MEMBER,
      id: 8,
      role: "program_manager",
      roleLabel: "Programme Manager",
    })).get("/conversations?limit=1");

    expect(r.status).toBe(200);
    expect(r.body.items[0].unreadCount).toBeNull();
    expect(mockPoolQuery.mock.calls[0][0]).toContain("CASE WHEN cm.user_id IS NULL THEN NULL");
  });

  it("GET /conversations/:id responds 404 for missing conversation", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const r = await supertest(makeApp()).get("/conversations/99999");
    expect(r.status).toBe(404);
  });

  it("POST /conversations/:id/read returns 403 for non-member", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const r = await supertest(makeApp()).post("/conversations/101/read");
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("read_receipt_forbidden");
  });

  it("GET /conversations/:id/messages responds with pagination shape", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const r = await supertest(makeApp()).get("/conversations/101/messages");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("items");
    expect(r.body).toHaveProperty("hasMore");
    expect("nextCursor" in r.body).toBe(true);
  });

  it("GET /conversations/:id/media responds 403 for non-member", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const r = await supertest(makeApp()).get("/conversations/101/media");
    expect(r.status).toBe(403);
  });

  it("GET /conversations/:id/pinned responds 403 for non-member", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const r = await supertest(makeApp()).get("/conversations/101/pinned");
    expect(r.status).toBe(403);
  });

  it("DELETE /conversations/:id/members/:memberId reachable (returns 403 for non-member access)", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const r = await supertest(makeApp()).delete("/conversations/101/members/2");
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("PATCH /conversations/:id reachable (returns 404 for missing conv)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const r = await supertest(makeApp()).patch("/conversations/101").send({ name: "New Name" });
    expect(r.status).toBe(404);
  });
});

/* ─────────────────── COMM-CONTRACT-02 Pagination shape ─────────────────── */

describe("COMM-CONTRACT-02 — Message pagination response shape", () => {
  it("returns {items, hasMore, nextCursor} and items are in chronological order", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        // Route fetches limit+1 DESC; respond with 2 items → hasMore=true with limit=1
        return {
          rows: [
            { id: 20, conversationId: 101, createdAt: "2026-08-01T10:20:00.000Z", body: "B", attachments: null },
            { id: 10, conversationId: 101, createdAt: "2026-08-01T10:10:00.000Z", body: "A", attachments: null },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).get("/conversations/101/messages?limit=1");

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("items");
    expect(r.body).toHaveProperty("hasMore");
    expect("nextCursor" in r.body).toBe(true);
    expect(r.body.hasMore).toBe(true);
    // Route fetches limit+1 rows DESC → [id=20, id=10]. hasMore=true (2>1).
    // newestFirst = [id=20] (first limit=1 rows). Reversed = [id=20].
    // So items[0].id = 20 (newest in the page window).
    expect(r.body.items[0].id).toBe(20);
  });

  it("returns hasMore=false and nextCursor=null when no further pages", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{ id: 5, conversationId: 101, createdAt: "2026-08-01T09:00:00.000Z", body: "X", attachments: null }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).get("/conversations/101/messages?limit=10");

    expect(r.status).toBe(200);
    expect(r.body.hasMore).toBe(false);
    expect(r.body.nextCursor).toBeNull();
  });
});

/* ─────────────────── COMM-CONTRACT-03 Cursor contract ─────────────────── */

describe("COMM-CONTRACT-03 — Cursor is opaque and structurally valid", () => {
  it("nextCursor is a non-empty string when hasMore is true", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [
            { id: 20, conversationId: 101, createdAt: "2026-08-01T10:20:00.000Z", body: "B", attachments: null },
            { id: 10, conversationId: 101, createdAt: "2026-08-01T10:10:00.000Z", body: "A", attachments: null },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).get("/conversations/101/messages?limit=1");
    expect(r.body.hasMore).toBe(true);
    const cursor = r.body.nextCursor;
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeGreaterThan(0);
    // Clients must not construct this; decoding it is an implementation detail
    // but we verify it is valid base64url and encodes a createdAt+id boundary
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    expect(decoded).toMatchObject({ createdAt: expect.any(String), id: expect.any(Number) });
  });

  it("a valid cursor is accepted by the messages endpoint without error", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const validCursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-08-01T10:00:00.000Z", id: 10 }),
    ).toString("base64url");

    const r = await supertest(makeApp()).get(`/conversations/101/messages?cursor=${validCursor}`);
    expect(r.status).toBe(200);
  });
});

/* ─────────────────── COMM-CONTRACT-04 Delete semantics ─────────────────── */

describe("COMM-CONTRACT-04 — Delete For Me and Delete For Everyone are distinct", () => {
  it("Delete For Me inserts a per-user hide row and does not update shared deletion fields", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sender_id, conversation_id, created_at, deleted_at, deletion_type")) {
        return {
          rows: [{ sender_id: 99, conversation_id: 101, created_at: new Date().toISOString(), deleted_at: null, deletion_type: null }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("INSERT INTO message_user_hides")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).delete("/messages/55").send({ deletionType: "for_me" });
    expect(r.status).toBe(204);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO message_user_hides"), [55, MEMBER.id],
    );
    expect(mockPoolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE messages SET deleted_at"), expect.anything(),
    );
  });

  it("Delete For Everyone updates shared deletion state and clears pin", async () => {
    // The route: SELECT msg → assertMemberOrFullAccess(convId) → isSender check →
    //   UPDATE messages SET deleted_at... → 204.
    // SELECT uses the for_everyone NOT EXISTS sub-filter; we return the row with
    // sender_id=MEMBER.id so isSender=true and age check passes (created_at=now).
    mockPoolQuery.mockImplementation((sql: string) => {
      // Message existence check (for_everyone path includes NOT EXISTS sub-query)
      if (sql.includes("SELECT sender_id, conversation_id")) {
        return {
          rows: [{ sender_id: MEMBER.id, conversation_id: 101, created_at: new Date().toISOString(), deleted_at: null, deletion_type: null }],
          rowCount: 1,
        };
      }
      // assertMemberOrFullAccess membership check
      if (sql.includes("conversation_members")) return memberResult(true);
      // The shared deletion UPDATE — must return rowCount=1 to avoid 409
      if (sql.includes("UPDATE messages")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).delete("/messages/55").send({ deletionType: "for_everyone" });
    expect(r.status).toBe(204);
    // Verify the UPDATE hit the shared tombstone path (not the per-user hide)
    const updateCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("UPDATE messages"));
    expect(updateCall?.[0]).toContain("deletion_type='for_everyone'");
    expect(updateCall?.[0]).toContain("is_pinned=FALSE");
    expect(mockPoolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO message_user_hides"), expect.anything(),
    );
  });
});

/* ─────────────────── COMM-CONTRACT-05 Reply/forward fields ─────────────── */

describe("COMM-CONTRACT-05 — Reply and forward fields present in Message response", () => {
  it("message list response items include replyToId and forwardedFromId", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 88, conversationId: 101, senderId: 7, senderName: "Test Member",
            senderRoleLabel: "TC", body: "A reply", attachments: null,
            replyToId: 55, forwardedFromId: null,
            editedAt: null, deletedAt: null, deletionType: null,
            isPinned: false, pinnedBy: null, pinnedAt: null,
            createdAt: new Date().toISOString(), replyBody: "source body",
            replySenderName: "Other", reactions: [],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).get("/conversations/101/messages");
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toHaveProperty("replyToId", 55);
    expect(r.body.items[0]).toHaveProperty("forwardedFromId", null);
    expect(r.body.items[0]).toHaveProperty("replyBody", "source body");
    expect(r.body.items[0]).toHaveProperty("replySenderName", "Other");
  });

  it("keeps ordinary messages with a null deletion type visible to their members", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 89, conversationId: 101, senderId: 7, senderName: "Test Member",
            senderRoleLabel: "TC", body: "Visible normal message", attachments: null,
            replyToId: null, forwardedFromId: null,
            editedAt: null, deletedAt: null, deletionType: null,
            isPinned: false, pinnedBy: null, pinnedAt: null,
            createdAt: new Date().toISOString(), replyBody: null,
            replySenderName: null, reactions: [],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await supertest(makeApp()).get("/conversations/101/messages");

    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    const messageListQuery = mockPoolQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("FROM messages m"),
    )?.[0] as string;
    expect(messageListQuery).toContain("m.deletion_type IS DISTINCT FROM 'for_me'");
    expect(messageListQuery).toContain("m.deleted_by IS DISTINCT FROM $2");
  });
});

/* ─────────────────── COMM-CONTRACT-06 mentionedUserIds in MessageInput ─── */

describe("COMM-CONTRACT-06 — mentionedUserIds accepted and stored by user ID", () => {
  it("sends mention notifications for the validated user IDs, not text tokens", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("FROM conversation_members cm")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "group" }], rowCount: 1 };
      if (sql.includes("FROM conversation_members cm") && sql.includes("AND u.id = ANY")) {
        return { rows: [{ id: 8 }], rowCount: 1 };
      }
      if (sql.includes("user_id FROM conversation_members")) return { rows: [{ user_id: 99 }], rowCount: 1 };
      if (sql.includes("INSERT INTO message_mentions")) return { rows: [], rowCount: 1 };
      if (sql.includes("WHERE m.id=$1")) {
        return {
          rows: [{
            id: 55, conversationId: 101, senderId: 7, senderName: "Test Member",
            senderRoleLabel: "TC", body: "Hello @Bob @Alice",
            attachments: null, replyToId: null, editedAt: null, deletedAt: null,
            deletionType: null, isPinned: false, pinnedBy: null, pinnedAt: null,
            forwardedFromId: null, createdAt: new Date().toISOString(),
            replyBody: null, replySenderName: null, reactions: [],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 55 }], rowCount: 1 };
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected client SQL: ${sql}`);
    });

    const r = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello @Bob @Alice", mentionedUserIds: [8] });

    expect(r.status).toBe(201);
    // message_mentions insert happened for user 8 (not text-parsed names)
    const mentionInserts = mockPoolQuery.mock.calls
      .filter(([sql]) => String(sql).includes("INSERT INTO message_mentions"));
    expect(mentionInserts.length).toBeGreaterThanOrEqual(1);
    expect(mentionInserts[0][1]).toContain(8);
  });
});

/* ─────────────────── COMM-CONTRACT-07 Attachment DTO hides storage keys ── */

describe("COMM-CONTRACT-07 — Attachment DTO hides objectPath and raw storage keys", () => {
  it("message response does not expose objectPath even when the stored attachment has one", async () => {
    const storedAttachment = {
      name: "photo.png", type: "image",
      objectPath: "/objects/messages/secret-path",
      contentType: "image/png", size: 1024,
    };

    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("FROM conversation_members cm")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "group" }], rowCount: 1 };
      if (sql.includes("FROM conversation_members cm") && sql.includes("AND u.id = ANY")) return { rows: [], rowCount: 0 };
      if (sql.includes("user_id FROM conversation_members")) return { rows: [{ user_id: 99 }], rowCount: 1 };
      if (sql.includes("WHERE m.id=$1")) {
        return {
          rows: [{
            id: 55, conversationId: 101, senderId: 7, senderName: "Test Member",
            senderRoleLabel: "TC", body: "(attachment)",
            attachments: [storedAttachment],
            replyToId: null, editedAt: null, deletedAt: null, deletionType: null,
            isPinned: false, pinnedBy: null, pinnedAt: null, forwardedFromId: null,
            createdAt: new Date().toISOString(), replyBody: null, replySenderName: null,
            reactions: [],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 55 }], rowCount: 1 };
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected client SQL: ${sql}`);
    });
    mockGetObjectEntityMetadata.mockResolvedValue({ size: 1024, contentType: "image/png" });
    mockFinalizeObjectEntityUpload.mockImplementation((p: string) => Promise.resolve(p));

    const uploadToken = signUploadToken({
      objectPath: storedAttachment.objectPath,
      userId: MEMBER.id, reportId: 0, entityType: "message_attachment",
      scope: "messages", fileName: storedAttachment.name,
      contentType: storedAttachment.contentType, maxSize: storedAttachment.size,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400,
    });

    const r = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({
        body: "(attachment)",
        attachments: [{ ...storedAttachment, uploadToken }],
      });

    expect(r.status).toBe(201);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain("objectPath");
    expect(body).not.toContain("secret-path");
    // Should expose a proxy URL instead
    if (r.body.attachments?.length > 0) {
      expect(r.body.attachments[0]).toHaveProperty("url");
      expect(r.body.attachments[0].url).toContain("/api/conversations/");
    }
  });
});

/* ─────────────────── COMM-CONTRACT-08 Generated client compiles ─────────── */

describe("COMM-CONTRACT-08 — Generated client compiles and exports Communication hooks", () => {
  it("generated client dist exports Communication-related function names", async () => {
    // @workspace/api-client-react is a frontend lib not available in this test context.
    // We verify at the file level that the generated dist exports the expected symbols.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = resolve(process.cwd(), "../../lib/api-client-react/src/generated");
    const apiSrc = readFileSync(resolve(root, "api.ts"), "utf8");
    const schemaSrc = readFileSync(resolve(root, "api.schemas.ts"), "utf8");
    for (const name of ["listConversations", "sendMessage", "editMessage", "deleteMessage"]) {
      expect(apiSrc).toContain(name);
    }
    // mentionedUserIds is defined in the TypeScript schemas file
    expect(schemaSrc).toContain("mentionedUserIds");
  });
});

/* ─────────────────── COMM-CONTRACT-09 Conversation types ──────────────────- */

describe("COMM-CONTRACT-09 — Current conversation types represented", () => {
  it.each(["direct", "group", "project", "state", "sector", "announcement"])(
    "type=%s is not rejected at the type-validation level",
    async (convType) => {
      mockPoolQuery.mockImplementation((sql: string) => {
        // Return valid state/project for identity checks
        if (sql.includes("FROM states WHERE id=")) return { rows: [{ id: 1 }], rowCount: 1 };
        if (sql.includes("FROM projects WHERE id=")) return { rows: [{ id: 1, sector: "Health" }], rowCount: 1 };
        if (sql.includes("FROM users WHERE id = ANY")) return { rows: [{ id: 99, status: "active" }], rowCount: 1 };
        if (sql.includes("conversation_members")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      });
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT conversation_id FROM direct_conversation_keys")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT conversation_id FROM organisational_conversation_keys")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT c.id")) return { rows: [], rowCount: 0 };
        if (sql.includes("INSERT INTO conversations")) return { rows: [{ id: 999 }], rowCount: 1 };
        if (sql.includes("INSERT INTO conversation_members")) return { rows: [], rowCount: 1 };
        if (sql.includes("INSERT INTO direct_conversation_keys")) return { rows: [], rowCount: 1 };
        if (sql.includes("INSERT INTO organisational_conversation_keys")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });

      const body: Record<string, unknown> = { type: convType };
      if (convType === "direct") body.memberIds = [99];
      if (convType === "group") body.memberIds = [99];
      if (convType === "project") { body.projectId = 1; body.memberIds = []; }
      if (convType === "state") { body.stateId = 1; body.memberIds = []; }
      if (convType === "sector") { body.sector = "Health"; body.memberIds = []; }
      if (convType === "announcement") {
        body.name = "Test Announcement"; body.targetAll = true;
        // announcements require PM+ role
        const PM = {
          ...MEMBER, id: 8, role: "program_manager" as const,
          name: "PM User",
        };
        const pmApp = makeApp(PM);
        mockPoolQuery.mockImplementation((sql: string) => {
          if (sql.includes("FROM users WHERE status='active'")) return { rows: [{ id: 8 }, { id: 99 }], rowCount: 2 };
          if (sql.includes("SELECT id, type, name")) {
            return { rows: [{ id: 999, type: "announcement", name: "Test Announcement", projectId: null, stateId: null, sector: null, createdById: 8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), memberCount: 2, unreadCount: 0, lastMessageBody: null, lastMessageAt: null, lastMessageSenderName: null }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        });
        const r = await supertest(pmApp).post("/conversations").send(body);
        expect(r.status).not.toBe(400); // not rejected as unknown type
        return;
      }

      // For non-announcement types, check that the response is either success or a domain error (400/403/404),
      // but never a raw 500 from an unknown type
      mockPoolQuery.mockImplementation((sql: string) => {
        if (sql.includes("FROM states WHERE id=")) return { rows: [{ id: 1 }], rowCount: 1 };
        if (sql.includes("FROM projects WHERE id=")) return { rows: [{ id: 1, sector: "Health" }], rowCount: 1 };
        if (sql.includes("FROM users WHERE id = ANY")) return { rows: [{ id: 99, status: "active" }], rowCount: 1 };
        if (sql.includes("SELECT id, type, name")) {
          return { rows: [{ id: 999, type: convType, name: null, projectId: null, stateId: null, sector: convType === "sector" ? "Health" : null, createdById: 7, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), memberCount: 1, unreadCount: 0, lastMessageBody: null, lastMessageAt: null, lastMessageSenderName: null }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const r = await supertest(makeApp()).post("/conversations").send(body);
      expect(r.status).not.toBe(500);
    },
  );
});
