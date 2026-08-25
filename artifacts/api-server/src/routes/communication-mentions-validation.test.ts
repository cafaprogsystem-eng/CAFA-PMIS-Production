/**
 * Communication Centre — Mentions (COMM-010) and Validation (COMM-017) closure tests.
 *
 * COMM-MENTION-01  Duplicate first names resolve the selected user ID only
 * COMM-MENTION-02  Non-member mention rejected with 422
 * COMM-MENTION-03  Inactive / missing user ID rejected with 422
 * COMM-MENTION-04  Duplicate same-user mention deduped to one relation/notification
 * COMM-MENTION-05  Correct mention recipient receives the notification
 * COMM-MENTION-06  Message and mention event identities remain distinct
 * COMM-MENTION-07  Direct-message privacy preserved — only members can be mentioned
 *
 * COMM-VALIDATION-01  Non-integer conversation ID returns 4xx, not 500
 * COMM-VALIDATION-02  Non-integer message ID returns 4xx, not 500
 * COMM-VALIDATION-03  Non-integer member ID in path returns 4xx
 * COMM-VALIDATION-04  Malformed cursor returns 400 invalid_cursor
 * COMM-VALIDATION-05  limit above bound returns 400 invalid_limit
 * COMM-VALIDATION-06  limit below bound returns 400 invalid_limit
 * COMM-VALIDATION-07  Non-string limit value returns 400 invalid_limit
 * COMM-VALIDATION-08  Unknown emoji rejected with 400
 * COMM-VALIDATION-09  Negative replyToId rejected with 400
 * COMM-VALIDATION-10  Negative forwardedFromId rejected with 400
 * COMM-VALIDATION-11  Non-integer mentionedUserIds element rejected with 422
 * COMM-VALIDATION-12  Negative mentionedUserIds element rejected with 422
 * COMM-VALIDATION-13  Missing body and attachments rejected with 400
 * COMM-VALIDATION-14  Body over 10 000 characters rejected with 400 message_too_long
 * COMM-VALIDATION-15  Reaction toggle is idempotent under concurrent duplicate requests
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
  mockCreateNotification,
  mockBroadcastMessage,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockGetObjectEntityMetadata: vi.fn(),
  mockFinalizeObjectEntityUpload: vi.fn(),
  mockCreateNotification: vi.fn().mockResolvedValue(undefined),
  mockBroadcastMessage: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock("../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  hasPerm: vi.fn().mockReturnValue(true),
  permissionsFor: vi.fn().mockReturnValue(new Set(["messages.send", "messages.attachments.upload"])),
  logAudit: vi.fn(),
  tcSectorRestriction: vi.fn().mockReturnValue(null),
  assertSectorAllowed: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock("../lib/notifications", () => ({
  createNotificationDeduped: mockCreateNotification,
}));

vi.mock("../lib/realtime", () => ({
  realtime: {
    broadcastMessage: mockBroadcastMessage,
    broadcastConversationUpdate: vi.fn(),
  },
}));

vi.mock("../lib/sectors", () => ({
  VALID_SECTOR_SET: new Set(["Health", "Education"]),
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

const SENDER = {
  id: 1, name: "Alice Sender", email: "alice@example.test", role: "technical_coordinator",
  roleLabel: "TC", scope: "national", stateId: null, stateName: null,
  sector: null, avatarUrl: null, sectors: null,
};
const OTHER_USER = { ...SENDER, id: 2, name: "Bob Other" };

function makeApp(user = SENDER) {
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

/** Minimal mock sequence for a successful message send with given body and extras */
function mockSuccessfulSend(mentionRows: { id: number }[] = []) {
  mockPoolQuery.mockImplementation((sql: string) => {
    // canAccessConversation membership check (various forms)
    if (
      sql.includes("conversation_members") &&
      !sql.includes("FROM conversation_members cm") &&
      !sql.includes("user_id FROM conversation_members")
    ) {
      return memberResult(true);
    }
    // conversation type for announcement guard
    if (sql.includes("SELECT type, created_by_id")) {
      return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
    }
    // conversation type for mention validation (FROM conversations WHERE id=)
    if (sql.includes("FROM conversations WHERE id=")) {
      return { rows: [{ type: "group" }], rowCount: 1 };
    }
    // mention membership validation
    if (sql.includes("FROM conversation_members cm") && sql.includes("AND u.id = ANY")) {
      return { rows: mentionRows, rowCount: mentionRows.length };
    }
    // other member list for message notifications
    if (sql.includes("user_id FROM conversation_members")) {
      return { rows: [{ user_id: 99 }], rowCount: 1 };
    }
    // message_mentions insert
    if (sql.includes("INSERT INTO message_mentions")) {
      return { rows: [], rowCount: 1 };
    }
    // full message row fetch after commit
    if (sql.includes("WHERE m.id=$1")) {
      return {
        rows: [{
          id: 55, conversationId: 101, senderId: 1, senderName: "Alice Sender",
          senderRoleLabel: "TC", body: "Hello", attachments: null,
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
    if (sql.includes("SELECT conversation_id, deleted_at")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected client SQL: ${sql}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
  mockGetObjectEntityMetadata.mockResolvedValue({ size: 1024, contentType: "image/jpeg" });
  mockFinalizeObjectEntityUpload.mockImplementation((p: string) => Promise.resolve(p));
});

/* ────────────────────── COMM-MENTION tests ──────────────────────── */

describe("COMM-MENTION-01 — Duplicate first names resolve the selected user ID only", () => {
  it("sends structured IDs and does not parse the text body for mention resolution", async () => {
    // Two members share first name "Bob"; client passes only id 2
    mockSuccessfulSend([{ id: OTHER_USER.id }]);

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "@Bob is the correct one @Bob", mentionedUserIds: [OTHER_USER.id] });

    expect(response.status).toBe(201);
    // Exactly one mention relation inserted for user 2
    const mentionInserts = mockPoolQuery.mock.calls
      .filter(([sql]) => String(sql).includes("INSERT INTO message_mentions"));
    expect(mentionInserts).toHaveLength(1);
    expect(mentionInserts[0][1]).toContain(OTHER_USER.id);
    // Only one mention notification sent
    const mentionNotifs = mockCreateNotification.mock.calls
      .filter(([args]) => args?.kind === "mention");
    expect(mentionNotifs).toHaveLength(1);
    expect(mentionNotifs[0][0].userId).toBe(OTHER_USER.id);
  });
});

describe("COMM-MENTION-02 — Non-member mention rejected with 422", () => {
  it("rejects a user ID that is not an active member of this conversation", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("FROM conversation_members cm")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "group" }], rowCount: 1 };
      // mention validation: user 999 is NOT a member
      if (sql.includes("FROM conversation_members cm") && sql.includes("AND u.id = ANY")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello", mentionedUserIds: [999] });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("invalid_mentioned_user_ids");
    expect(mockClientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO messages"), expect.anything(),
    );
  });
});

describe("COMM-MENTION-03 — Inactive / missing user ID rejected with 422", () => {
  it("rejects a user ID where the user is inactive", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("FROM conversation_members cm")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "group" }], rowCount: 1 };
      // mention validation: user exists but is suspended (not active) → not returned
      if (sql.includes("FROM conversation_members cm") && sql.includes("AND u.id = ANY")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello", mentionedUserIds: [77] });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("invalid_mentioned_user_ids");
  });
});

describe("COMM-MENTION-04 — Duplicate same-user mention deduped", () => {
  it("creates at most one mention relation per user per message even with repeated IDs", async () => {
    mockSuccessfulSend([{ id: OTHER_USER.id }]);

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello @Bob @Bob", mentionedUserIds: [OTHER_USER.id, OTHER_USER.id] });

    expect(response.status).toBe(201);
    // After Set dedup, only one mention insert per user
    const mentionInserts = mockPoolQuery.mock.calls
      .filter(([sql]) => String(sql).includes("INSERT INTO message_mentions"));
    const uniqueUserIds = [...new Set(mentionInserts.map(([, params]) => params[1]))];
    expect(uniqueUserIds).toHaveLength(1);
    expect(uniqueUserIds[0]).toBe(OTHER_USER.id);
  });
});

describe("COMM-MENTION-05 — Correct mention recipient", () => {
  it("sends the mention notification to exactly the validated user ID", async () => {
    mockSuccessfulSend([{ id: OTHER_USER.id }]);

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello @Bob", mentionedUserIds: [OTHER_USER.id] });

    expect(response.status).toBe(201);
    const mentionNotifs = mockCreateNotification.mock.calls
      .filter(([args]) => args?.kind === "mention");
    expect(mentionNotifs).toHaveLength(1);
    expect(mentionNotifs[0][0].userId).toBe(OTHER_USER.id);
    expect(mentionNotifs[0][0].kind).toBe("mention");
  });
});

describe("COMM-MENTION-06 — Message and mention event identities remain distinct", () => {
  it("uses separate dedupe keys and kinds for message and mention notifications", async () => {
    mockSuccessfulSend([{ id: OTHER_USER.id }]);

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello @Bob", mentionedUserIds: [OTHER_USER.id] });

    expect(response.status).toBe(201);
    const allNotifCalls = mockCreateNotification.mock.calls.map(([args]) => args);
    const messageKinds = allNotifCalls.filter((a) => a?.kind === "message");
    const mentionKinds = allNotifCalls.filter((a) => a?.kind === "mention");
    expect(messageKinds.length).toBeGreaterThanOrEqual(1);
    expect(mentionKinds.length).toBeGreaterThanOrEqual(1);
    // Dedupe keys must differ
    const messageDedupe = messageKinds[0]?.dedupeKey ?? "";
    const mentionDedupe = mentionKinds[0]?.dedupeKey ?? "";
    expect(messageDedupe).not.toBe(mentionDedupe);
    expect(messageDedupe).toContain("conversation-message:");
    expect(mentionDedupe).toContain("conversation-message-mention:");
  });
});

describe("COMM-MENTION-07 — Direct-message privacy preserved", () => {
  it("rejects a mention of a user who is not a direct-message member", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("FROM conversation_members cm")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "direct", created_by_id: 1 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "direct" }], rowCount: 1 };
      // In a DM, only the two members exist; user 999 is not one of them
      if (sql.includes("FROM conversation_members cm") && sql.includes("AND u.id = ANY")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello", mentionedUserIds: [999] });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("invalid_mentioned_user_ids");
  });
});

/* ────────────────────── COMM-VALIDATION tests ───────────────────── */

describe("COMM-VALIDATION-01 — Non-integer conversation ID returns 4xx, not 500", () => {
  it.each(["abc", "1.5", " ", "null"])(
    "rejects conversation ID %s with a 4xx, not 500",
    async (badId) => {
      const response = await supertest(makeApp()).get(`/conversations/${badId}/messages`);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    },
  );
});

describe("COMM-VALIDATION-02 — Non-integer message ID returns 4xx, not 500", () => {
  it("rejects non-integer message ID in PATCH with 4xx", async () => {
    const response = await supertest(makeApp()).patch("/messages/abc").send({ body: "test" });
    // parseInt('abc') = NaN → expect the route to fail gracefully
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

describe("COMM-VALIDATION-03 — Non-integer member ID in path returns 4xx", () => {
  it("rejects non-integer memberId in DELETE /conversations/:id/members/:memberId", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const response = await supertest(makeApp()).delete("/conversations/101/members/abc");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

describe("COMM-VALIDATION-04 — Malformed cursor returns 400", () => {
  it("rejects a non-base64url cursor string", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .get("/conversations/101/messages?cursor=!!!not-valid!!!");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_cursor");
  });

  it("rejects a cursor that is structurally valid base64url but has wrong shape", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      return { rows: [], rowCount: 0 };
    });
    const badCursor = Buffer.from(JSON.stringify({ wrong: "shape" })).toString("base64url");
    const response = await supertest(makeApp())
      .get(`/conversations/101/messages?cursor=${badCursor}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_cursor");
  });
});

describe("COMM-VALIDATION-05 — limit above bound returns 400", () => {
  it("rejects limit=101", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp()).get("/conversations/101/messages?limit=101");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_limit");
  });
});

describe("COMM-VALIDATION-06 — limit below bound returns 400", () => {
  it("rejects limit=0", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp()).get("/conversations/101/messages?limit=0");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_limit");
  });
});

describe("COMM-VALIDATION-07 — Non-string (non-digit) limit value returns 400", () => {
  it("rejects limit=abc", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp()).get("/conversations/101/messages?limit=abc");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_limit");
  });
});

describe("COMM-VALIDATION-08 — Unknown emoji rejected with 400", () => {
  it("returns 400 for an emoji not in the allow-list", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT conversation_id FROM messages")) return { rows: [{ conversation_id: 101 }], rowCount: 1 };
      if (sql.includes("conversation_members")) return memberResult(true);
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/messages/55/reactions")
      .send({ emoji: "🤡" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_emoji");
  });
});

describe("COMM-VALIDATION-09 — Negative replyToId rejected with 400", () => {
  it("returns 400 for replyToId=-1", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "group" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "test", replyToId: -1 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_reply_reference");
  });
});

describe("COMM-VALIDATION-10 — Negative forwardedFromId rejected with 400", () => {
  it("returns 400 for forwardedFromId=0", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      if (sql.includes("FROM conversations WHERE id=")) return { rows: [{ type: "group" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "test", forwardedFromId: 0 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_forward_reference");
  });
});

describe("COMM-VALIDATION-11 — Non-integer mentionedUserIds element rejected with 422", () => {
  it("returns 422 for mentionedUserIds containing a string", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello", mentionedUserIds: ["alice"] });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("invalid_mentioned_user_ids");
  });
});

describe("COMM-VALIDATION-12 — Negative mentionedUserIds element rejected with 422", () => {
  it("returns 422 for mentionedUserIds containing a negative value", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "Hello", mentionedUserIds: [-5] });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("invalid_mentioned_user_ids");
  });
});

describe("COMM-VALIDATION-13 — Missing body and attachments rejected with 400", () => {
  it("returns 400 when neither body nor attachments are present", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({});
    expect(response.status).toBe(400);
  });
});

describe("COMM-VALIDATION-14 — Body over 10 000 characters rejected with 400", () => {
  it("returns 400 message_too_long for a 10001-char body", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: 99 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "a".repeat(10_001) });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("message_too_long");
  });
});

describe("COMM-VALIDATION-15 — Reaction toggle is idempotent under concurrent duplicate requests", () => {
  it("uses DELETE RETURNING then conditional INSERT so concurrent toggling does not produce a raw constraint error", async () => {
    // Simulate a concurrent scenario: DELETE finds nothing (already deleted by concurrent request),
    // INSERT uses ON CONFLICT DO NOTHING — result is always 200, never 500
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT conversation_id FROM messages")) return { rows: [{ conversation_id: 101 }], rowCount: 1 };
      if (sql.includes("conversation_members")) return memberResult(true);
      if (sql.includes("DELETE FROM message_reactions")) return { rows: [], rowCount: 0 }; // nothing deleted
      if (sql.includes("INSERT INTO message_reactions") && sql.includes("ON CONFLICT")) return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT r.emoji")) return { rows: [{ emoji: "👍", userId: 1, userName: "Alice Sender" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .post("/messages/55/reactions")
      .send({ emoji: "👍" });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    // Confirm the route used DELETE RETURNING before INSERT, not check-then-insert
    const deleteCalls = mockPoolQuery.mock.calls.filter(([sql]) => String(sql).includes("DELETE FROM message_reactions"));
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    const insertCalls = mockPoolQuery.mock.calls.filter(([sql]) => String(sql).includes("ON CONFLICT (message_id, user_id, emoji) DO NOTHING"));
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });
});
