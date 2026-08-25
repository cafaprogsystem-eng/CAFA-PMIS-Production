/**
 * Communication Centre confidentiality / IDOR closure tests.
 *
 * These exercise the real Express routes with a deterministic database and
 * object-storage boundary. They cover the adversarial access cases required by
 * the Wave 1 closure: cross-thread provenance, direct-message privacy (even
 * for PM/Super Admin), removed members, attachment reads, and read receipts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { signUploadToken } from "../lib/uploadToken";

const {
  mockPoolQuery,
  mockClientQuery,
  mockPoolConnect,
  mockGetObject,
  mockGetObjectEntityMetadata,
  mockFinalizeObjectEntityUpload,
  mockDownloadObject,
  mockAudit,
  mockBroadcastMessage,
  mockBroadcastConversationUpdate,
  mockBroadcastPersonalConversationUpdate,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockGetObject: vi.fn(),
  mockGetObjectEntityMetadata: vi.fn(),
  mockFinalizeObjectEntityUpload: vi.fn(),
  mockDownloadObject: vi.fn(),
  mockAudit: vi.fn(),
  mockBroadcastMessage: vi.fn(),
  mockBroadcastConversationUpdate: vi.fn(),
  mockBroadcastPersonalConversationUpdate: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock("../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  hasPerm: vi.fn().mockReturnValue(true),
  permissionsFor: vi.fn().mockReturnValue(new Set(["messages.send", "messages.attachments.upload"])),
  logAudit: mockAudit,
  tcSectorRestriction: vi.fn().mockReturnValue(null),
  assertSectorAllowed: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock("../lib/notifications", () => ({
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime", () => ({
  realtime: {
    broadcastMessage: mockBroadcastMessage,
    broadcastConversationUpdate: mockBroadcastConversationUpdate,
    broadcastPersonalConversationUpdate: mockBroadcastPersonalConversationUpdate,
  },
}));

vi.mock("../lib/sectors", () => ({
  VALID_SECTOR_SET: new Set(["Health"]),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityFile = mockGetObject;
    getObjectEntityMetadata = mockGetObjectEntityMetadata;
    finalizeObjectEntityUpload = mockFinalizeObjectEntityUpload;
    downloadObject = mockDownloadObject;
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

const { default: conversationsRouter } = await import("./conversations");

const MEMBER = {
  id: 7, name: "Member", email: "member@example.test", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "national", stateId: null, stateName: null,
  sector: null, avatarUrl: null, sectors: null,
};
const PM = { ...MEMBER, id: 8, role: "program_manager", roleLabel: "Program Manager" };
const SUPER_ADMIN = { ...MEMBER, id: 9, role: "super_admin", roleLabel: "Super Admin" };

function messageUploadToken({
  objectPath,
  name,
  contentType,
  size,
}: {
  objectPath: string;
  name: string;
  contentType: string;
  size: number;
}) {
  const iat = Math.floor(Date.now() / 1000);
  return signUploadToken({
    objectPath,
    userId: MEMBER.id,
    reportId: 0,
    entityType: "message_attachment",
    scope: "messages",
    fileName: name,
    contentType,
    maxSize: size,
    iat,
    exp: iat + 86400,
  });
}

function makeApp(user = MEMBER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = user;
    next();
  });
  app.use(conversationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

function memberResult(isMember: boolean) {
  return { rows: [], rowCount: isMember ? 1 : 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBroadcastConversationUpdate.mockReset();
  mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
  mockGetObjectEntityMetadata.mockResolvedValue({ size: 1024, contentType: "image/jpeg" });
  mockFinalizeObjectEntityUpload.mockImplementation((objectPath: string) => Promise.resolve(objectPath));
  mockDownloadObject.mockResolvedValue({ status: 200, headers: new Headers(), body: null });
});

describe("Communication Centre confidentiality and IDOR closure", () => {
  it("rejects a cross-group reply source before the message is inserted", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT conversation_id, deleted_at") && sql.includes("FROM messages")) {
        return { rows: [{ conversation_id: 202, deleted_at: null }], rowCount: 1 };
      }
      throw new Error(`Unexpected client SQL: ${sql}`);
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Do not leak this", replyToId: 55 });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("reply_source_unavailable");
    expect(mockClientQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO messages"), expect.anything());
  });

  it("rejects a cross-DM forward for a PM who is not actually a member", async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes("conversation_members") && params[0] === 101) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 8 }], rowCount: 1 };
      if (sql.includes("conversation_members") && params[0] === 202) return memberResult(false);
      if (sql.includes("SELECT type FROM conversations") && params[0] === 202) {
        return { rows: [{ type: "direct" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT conversation_id, deleted_at") && sql.includes("FROM messages")) {
        return { rows: [{ conversation_id: 202, deleted_at: null }], rowCount: 1 };
      }
      throw new Error(`Unexpected client SQL: ${sql}`);
    });

    const response = await supertest(makeApp(PM))
      .post("/conversations/101/messages")
      .send({ body: "forward", forwardedFromId: 55 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("forward_source_forbidden");
  });

  it.each([
    ["ordinary non-member", MEMBER],
    ["Program Manager", PM],
    ["Super Admin", SUPER_ADMIN],
  ])("denies %s access to a direct-message attachment", async (_label, user) => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(false);
      if (sql.includes("SELECT type FROM conversations")) return { rows: [{ type: "direct" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp(user))
      .get("/conversations/101/messages/55/attachments/0");

    expect(response.status).toBe(403);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it("allows a member to retrieve only a stored parent-message attachment", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT attachments FROM messages")) {
        return {
          rows: [{
            attachments: [{
              name: "field-photo.png",
              type: "image",
              objectPath: "/objects/messages/evidence.pdf",
              contentType: "image/png",
            }],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mockGetObject.mockResolvedValue({ key: "messages/evidence.pdf" });

    const response = await supertest(makeApp())
      .get("/conversations/101/messages/55/attachments/0");

    expect(response.status).toBe(200);
    expect(mockGetObject).toHaveBeenCalledWith("/objects/messages/evidence.pdf");
    expect(response.headers["content-type"]).toContain("image/png");
  });

  it("streams a safe Unicode filename only through the parent-authorised proxy", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT attachments FROM messages")) {
        return {
          rows: [{
            attachments: [{
              name: "تقرير ميداني.png",
              type: "image",
              objectPath: "/objects/messages/unicode-name.png",
              contentType: "image/png",
            }],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mockGetObject.mockResolvedValue({ key: "messages/unicode-name.png" });

    const response = await supertest(makeApp())
      .get("/conversations/101/messages/55/attachments/0");

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(response.headers["content-disposition"]).not.toContain("/objects/");
    expect(response.headers.location).toBeUndefined();
  });

  it("allows a PM operational viewer to read a non-direct attachment without creating membership", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(false);
      if (sql.includes("SELECT type FROM conversations")) return { rows: [{ type: "group" }], rowCount: 1 };
      if (sql.includes("SELECT attachments FROM messages")) {
        return {
          rows: [{
            attachments: [{
              name: "field-photo.png", type: "image",
              objectPath: "/objects/messages/group-photo.png", contentType: "image/png",
            }],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mockGetObject.mockResolvedValue({ key: "messages/group-photo.png" });

    const response = await supertest(makeApp(PM))
      .get("/conversations/101/messages/55/attachments/0");

    expect(response.status).toBe(200);
    expect(mockGetObject).toHaveBeenCalledWith("/objects/messages/group-photo.png");
  });

  it("returns 404 for an attachment reference that has no parent message", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT attachments FROM messages")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .get("/conversations/101/messages/99999/attachments/0");

    expect(response.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it("does not leak deleted reply content in message results", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 88, conversationId: 101, body: "visible reply", attachments: null,
            replyToId: 55, replyBody: null, replySenderName: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp()).get("/conversations/101/messages");

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ replyToId: 55, replyBody: null, replySenderName: null });
  });

  it("does not expose a privately hidden reply source in the actor's message history", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 88, conversationId: 101, body: "visible reply", attachments: null,
            replyToId: 55, replyBody: null, replySenderName: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp()).get("/conversations/101/messages");

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({
      replyToId: 55,
      replyBody: null,
      replySenderName: null,
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("rm.conversation_id=m.conversation_id"),
      expect.arrayContaining([101, 7]),
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("rmh.message_id=rm.id AND rmh.user_id=$2"),
      expect.any(Array),
    );
  });

  it("does not let an edit overwrite a message shared-deleted during the edit race", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sender_id, conversation_id, deleted_at, created_at")) {
        return {
          rows: [{ sender_id: 7, conversation_id: 101, deleted_at: null, created_at: new Date().toISOString() }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("UPDATE messages")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .patch("/messages/55")
      .send({ body: "late edit" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("message_already_deleted");
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("deletion_type IS DISTINCT FROM 'for_everyone'"),
      ["late edit", 55],
    );
  });

  it("broadcasts only a refetch identity so a recipient's private reply hide cannot leak over realtime", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT user_id FROM conversation_members")) {
        return { rows: [{ user_id: 8 }], rowCount: 1 };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) {
        return { rows: [{ type: "group", created_by_id: 7 }], rowCount: 1 };
      }
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 55, conversationId: 101, senderId: 7, senderName: "Member",
            senderRoleLabel: "Technical Coordinator", body: "A reply", attachments: null,
            replyToId: 44, replyBody: "private source", replySenderName: "Other",
            reactions: [], createdAt: new Date().toISOString(),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT DISTINCT u.id")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 55 }], rowCount: 1 };
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected client SQL: ${sql}`);
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "A reply" });

    expect(response.status).toBe(201);
    expect(mockBroadcastMessage).toHaveBeenCalledWith(
      [7, 8],
      { id: 55, conversationId: 101 },
    );
    expect(JSON.stringify(mockBroadcastMessage.mock.calls)).not.toContain("private source");
  });

  it("returns a conflict rather than pinning or notifying after a shared deletion wins the pin race", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT conversation_id FROM messages")) {
        return { rows: [{ conversation_id: 101 }], rowCount: 1 };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT COUNT(*)::text AS count")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE messages")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp(PM)).post("/messages/55/pin");

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("message_already_deleted");
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("deletion_type IS DISTINCT FROM 'for_everyone'"),
      [55, 8, 8],
    );
    expect(mockAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "message_pin" }));
  });

  it("returns a newest bounded database page in chronological display order with an opaque older cursor", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [
            { id: 30, conversationId: 101, createdAt: "2026-08-19T10:30:00.000Z", body: "newest", attachments: null },
            { id: 20, conversationId: 101, createdAt: "2026-08-19T10:20:00.000Z", body: "middle", attachments: null },
            { id: 10, conversationId: 101, createdAt: "2026-08-19T10:10:00.000Z", body: "oldest", attachments: null },
          ],
          rowCount: 3,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp()).get("/conversations/101/messages?limit=2");

    expect(response.status).toBe(200);
    expect(response.body.items.map((message: { id: number }) => message.id)).toEqual([20, 30]);
    expect(response.body.hasMore).toBe(true);
    expect(typeof response.body.nextCursor).toBe("string");
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY m.created_at DESC, m.id DESC"),
      expect.arrayContaining([101, 7, 3]),
    );
  });

  it("uses a per-user hide row for Delete For Me without updating shared message deletion fields", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sender_id, conversation_id, created_at, deleted_at, deletion_type")) {
        return { rows: [{ sender_id: 9, conversation_id: 101, created_at: new Date().toISOString(), deleted_at: null, deletion_type: null }], rowCount: 1 };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("INSERT INTO message_user_hides")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .delete("/messages/55")
      .send({ deletionType: "for_me" });

    expect(response.status).toBe(204);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO message_user_hides"),
      [55, 7],
    );
    expect(mockPoolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE messages SET deleted_at"),
      expect.anything(),
    );
    expect(mockBroadcastConversationUpdate).not.toHaveBeenCalled();
    expect(mockBroadcastPersonalConversationUpdate).toHaveBeenCalledWith(MEMBER.id, 101);
  });

  it("emits a shared-delete identity event only after the committed message mutation", async () => {
    let mutationCommitted = false;
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sender_id, conversation_id, created_at, deleted_at, deletion_type")) {
        return {
          rows: [{
            sender_id: MEMBER.id,
            conversation_id: 101,
            created_at: new Date().toISOString(),
            deleted_at: null,
            deletion_type: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("UPDATE messages") && sql.includes("SET deleted_at")) {
        mutationCommitted = true;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    mockBroadcastConversationUpdate.mockImplementation(() => {
      expect(mutationCommitted).toBe(true);
    });

    const response = await supertest(makeApp())
      .delete("/messages/55")
      .send({ deletionType: "for_everyone" });

    expect(response.status).toBe(204);
    expect(mockBroadcastConversationUpdate).toHaveBeenCalledWith(
      [],
      101,
      {
        change: "message:deleted",
        messageId: 55,
        actorId: MEMBER.id,
        actorName: MEMBER.name,
      },
    );
  });

  it("notifies a removed member's other sessions to refetch without sharing conversation data", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT 1 FROM conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id FROM conversations")) {
        return { rows: [{ type: "group", created_by_id: MEMBER.id }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM conversation_members")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .delete("/conversations/101/members/19");

    expect(response.status).toBe(204);
    expect(mockBroadcastConversationUpdate).toHaveBeenCalledWith(
      [19],
      101,
      {
        change: "membership:changed",
        actorId: MEMBER.id,
        actorName: MEMBER.name,
      },
    );
  });

  it("does not serve an attachment that the requesting member hid for themselves", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT attachments FROM messages")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .get("/conversations/101/messages/55/attachments/0");

    expect(response.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("message_user_hides"),
      [55, 101, MEMBER.id],
    );
  });

  it("filters private hides from conversation detail previews and unread counts", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM conversations WHERE id=$1")) {
        return {
          rows: [{
            id: 101, type: "group", name: "Coordination",
            projectId: null, stateId: null, sector: null,
            createdById: 7, createdAt: "2026-08-19T10:00:00.000Z", updatedAt: "2026-08-19T10:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT m.body")) return { rows: [], rowCount: 0 };
      if (sql.includes("COUNT(*)::text AS count")) return { rows: [{ count: "0" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp()).get("/conversations/101");

    expect(response.status).toBe(200);
    expect(response.body.lastMessageBody).toBeNull();
    const sqlCalls = mockPoolQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.some((sql) => sql.includes("lastMessageAt") && sql.includes("message_user_hides"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("COUNT(*)::text AS count") && sql.includes("message_user_hides"))).toBe(true);
  });

  it("does not leak a privately hidden reply preview in paginated history", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 88, conversationId: 101, body: "visible reply", attachments: null,
            replyToId: 55, replyBody: null, replySenderName: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp()).get("/conversations/101/messages");

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ replyToId: 55, replyBody: null, replySenderName: null });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("rmh.message_id=rm.id"),
      expect.arrayContaining([101, MEMBER.id]),
    );
  });

  it("blocks a removed sender from editing even inside the edit window", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sender_id, conversation_id")) {
        return {
          rows: [{ sender_id: 7, conversation_id: 101, deleted_at: null, created_at: new Date().toISOString() }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members")) return memberResult(false);
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .patch("/messages/55")
      .send({ body: "attempted edit" });

    expect(response.status).toBe(403);
    expect(mockPoolQuery).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE messages SET body"), expect.anything());
  });

  it("rejects a direct edit of a message the sender previously hid", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT sender_id, conversation_id")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .patch("/messages/55")
      .send({ body: "attempted edit" });

    expect(response.status).toBe(404);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("message_user_hides"),
      [55, MEMBER.id],
    );
    expect(mockPoolQuery).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE messages SET body"), expect.anything());
  });

  it("rejects a direct unpin request for a message the actor hid", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT conversation_id FROM messages")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .delete("/messages/55/pin");

    expect(response.status).toBe(404);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("message_user_hides"),
      [55, MEMBER.id],
    );
    expect(mockPoolQuery).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE messages SET is_pinned=FALSE"), expect.anything());
  });

  it("returns a deterministic denial instead of false success for a non-member read receipt", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(false);
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp(PM)).post("/conversations/101/read");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("read_receipt_forbidden");
    expect(mockPoolQuery).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE conversation_members"), expect.anything());
  });

  it("persists a member read receipt and returns 204", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("UPDATE")) return memberResult(true);
      if (sql.includes("UPDATE conversation_members")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp()).post("/conversations/101/read");

    expect(response.status).toBe(204);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE conversation_members SET last_read_at=NOW()"),
      [101, MEMBER.id],
    );
  });

  it.each([
    ["COMM-UPLOAD-09 document", "file", "application/pdf", "brief.pdf", "attachment"],
    ["COMM-UPLOAD-10 voice", "voice", "audio/webm", "voice.webm", "inline"],
  ])("completes %s send, DTO rendering, and authorised retrieval without exposing objectPath", async (
    _label,
    attachmentType,
    contentType,
    name,
    disposition,
  ) => {
    const storedAttachment = {
      name,
      type: attachmentType,
      objectPath: "/objects/messages/uploaded-object",
      contentType,
      size: 1024,
      ...(attachmentType === "voice" ? { duration: 4 } : {}),
    };
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 7 }], rowCount: 1 };
      if (sql.includes("WHERE m.id=$1")) {
        return {
          rows: [{
            id: 55,
            conversationId: 101,
            senderId: 7,
            senderName: "Member",
            senderRoleLabel: "Technical Coordinator",
            body: "(attachment)",
            attachments: [storedAttachment],
            replyToId: null,
            editedAt: null,
            deletedAt: null,
            deletionType: null,
            isPinned: false,
            pinnedBy: null,
            pinnedAt: null,
            forwardedFromId: null,
            createdAt: new Date().toISOString(),
            replyBody: null,
            replySenderName: null,
            reactions: [],
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT attachments FROM messages")) {
        return { rows: [{ attachments: [storedAttachment] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 55 }], rowCount: 1 };
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected client SQL: ${sql}`);
    });
    mockGetObject.mockResolvedValue({ key: "messages/uploaded-object" });
    mockGetObjectEntityMetadata.mockResolvedValue({ size: 1024, contentType });
    mockDownloadObject.mockResolvedValue({ status: 200, headers: new Headers(), body: null });

    const app = makeApp();
    const sent = await supertest(app)
      .post("/conversations/101/messages")
      .send({
        body: "(attachment)",
        attachments: [{
          ...storedAttachment,
          uploadToken: messageUploadToken(storedAttachment),
        }],
      });

    expect(sent.status).toBe(201);
    expect(sent.body.attachments).toEqual([expect.objectContaining({
      name,
      type: attachmentType,
      contentType,
      url: "/api/conversations/101/messages/55/attachments/0",
    })]);
    expect(JSON.stringify(sent.body)).not.toContain("objectPath");

    const downloaded = await supertest(app)
      .get("/conversations/101/messages/55/attachments/0");

    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-type"]).toContain(
      attachmentType === "voice" ? contentType : "application/octet-stream",
    );
    expect(downloaded.headers["content-disposition"]).toContain(disposition);
    expect(mockGetObject).toHaveBeenCalledWith("/objects/messages/uploaded-object");
  });
});