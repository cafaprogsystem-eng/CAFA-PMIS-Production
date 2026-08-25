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
  mockDeleteObject,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockGetObjectEntityMetadata: vi.fn(),
  mockFinalizeObjectEntityUpload: vi.fn(),
  mockDeleteObject: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock("../lib/notifications", () => ({
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime", () => ({
  realtime: {
    broadcastMessage: vi.fn(),
    broadcastConversationUpdate: vi.fn(),
  },
}));

vi.mock("../lib/sectors", () => ({
  VALID_SECTOR_SET: new Set(["Health"]),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityMetadata = mockGetObjectEntityMetadata;
    finalizeObjectEntityUpload = mockFinalizeObjectEntityUpload;
    deleteObject = mockDeleteObject;
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

const { default: conversationsRouter } = await import("./conversations");

const USER = {
  id: 7,
  name: "Technical Coordinator",
  email: "tc@example.test",
  role: "technical_coordinator",
  roleLabel: "Technical Coordinator",
  scope: "national",
  stateId: null,
  stateName: null,
  sector: "Health",
  avatarUrl: null,
  sectors: ["Health"],
};
const OBJECT_PATH = "/objects/uploads/message-attachment";

function messageDescriptor(overrides: Partial<Parameters<typeof signUploadToken>[0]> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signUploadToken({
    objectPath: OBJECT_PATH,
    userId: USER.id,
    reportId: 0,
    entityType: "message_attachment",
    scope: "messages",
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    maxSize: 1024,
    iat,
    exp: iat + 86400,
    ...overrides,
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = USER;
    next();
  });
  app.use(conversationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

function attachment(uploadToken?: string) {
  return {
    type: "image",
    name: "photo.jpg",
    url: "",
    objectPath: OBJECT_PATH,
    contentType: "image/jpeg",
    size: 1024,
    ...(uploadToken === undefined ? {} : { uploadToken }),
  };
}

function setMemberConversation() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("conversation_members")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT type, created_by_id")) {
      return { rows: [{ type: "group", created_by_id: USER.id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
  mockGetObjectEntityMetadata.mockResolvedValue({ size: 1024, contentType: "image/jpeg" });
  mockFinalizeObjectEntityUpload.mockResolvedValue("/objects/messages/finalized-attachment");
  mockDeleteObject.mockResolvedValue({ deleted: true, notFound: false });
  setMemberConversation();
});

describe("Communication Centre attachment provenance", () => {
  it("rejects an arbitrary private path without a signed message descriptor", async () => {
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ body: "(attachment)", attachments: [attachment()] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("uploadToken is required for message attachments");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("rejects a stored object whose actual bytes exceed its signed descriptor", async () => {
    mockGetObjectEntityMetadata.mockResolvedValue({
      size: 20 * 1024 * 1024 + 1,
      contentType: "image/jpeg",
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({
        body: "(attachment)",
        attachments: [attachment(messageDescriptor({ maxSize: 1024 }))],
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("attachment_size_mismatch");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("rejects a report descriptor even when the private path matches", async () => {
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({
        body: "(attachment)",
        attachments: [attachment(messageDescriptor({ entityType: "attachment", reportId: 42, scope: undefined }))],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("upload_token_entity_type_mismatch");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("rejects a message descriptor issued to another user", async () => {
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({
        body: "(attachment)",
        attachments: [attachment(messageDescriptor({ userId: 88 }))],
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("upload_token_user_mismatch");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("accepts a matching descriptor and returns only a message proxy URL", async () => {
    let insertedAttachments: Array<{ objectPath: string }> | undefined;
    mockClientQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) {
        insertedAttachments = JSON.parse(params?.[3] as string);
        return { rows: [{ id: 55 }], rowCount: 1 };
      }
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("user_id!=$2")) return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT type, created_by_id")) {
        return { rows: [{ type: "group", created_by_id: USER.id }], rowCount: 1 };
      }
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 55,
            conversationId: 101,
            senderId: USER.id,
            senderName: USER.name,
            body: "(attachment)",
            attachments: [attachment()],
            reactions: [],
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members") && sql.includes("user_id!=$2")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({
        body: "(attachment)",
        attachments: [attachment(messageDescriptor())],
      });

    expect(response.status).toBe(201);
    expect(response.body.attachments[0]).toMatchObject({
      name: "photo.jpg",
      url: "/api/conversations/101/messages/55/attachments/0",
    });
    expect(JSON.stringify(response.body)).not.toContain(OBJECT_PATH);
    expect(JSON.stringify(response.body)).not.toContain("uploadToken");
    expect(mockFinalizeObjectEntityUpload).toHaveBeenCalledWith(OBJECT_PATH);
    expect(insertedAttachments).toEqual([
      expect.objectContaining({ objectPath: "/objects/messages/finalized-attachment" }),
    ]);
  });

  it("creates one canonical attachment-only message with an empty stored body", async () => {
    let insertParams: unknown[] | undefined;
    mockClientQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) {
        insertParams = params;
        return { rows: [{ id: 56 }], rowCount: 1 };
      }
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("conversation_members") && !sql.includes("user_id!=$2")) return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT type, created_by_id")) return { rows: [{ type: "group", created_by_id: USER.id }], rowCount: 1 };
      if (sql.includes("FROM messages m")) {
        return {
          rows: [{
            id: 56, conversationId: 101, senderId: USER.id, senderName: USER.name,
            body: "", attachments: [attachment()], reactions: [],
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("conversation_members") && sql.includes("user_id!=$2")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(messageDescriptor())] });

    expect(response.status).toBe(201);
    expect(insertParams?.[2]).toBe("");
    expect(response.body.attachments).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain(OBJECT_PATH);
  });

  it("cleans a newly finalised object when its post-finalisation verification fails", async () => {
    mockGetObjectEntityMetadata
      .mockResolvedValueOnce({ size: 1024, contentType: "image/jpeg" })
      .mockResolvedValueOnce({ size: 1025, contentType: "image/jpeg" });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(messageDescriptor())] });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("finalized_attachment_metadata_mismatch");
    expect(mockDeleteObject).toHaveBeenCalledWith("/objects/messages/finalized-attachment");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("does not create a message when finalisation fails after a successful PUT", async () => {
    mockFinalizeObjectEntityUpload.mockRejectedValueOnce(new Error("finalisation_failed"));

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(messageDescriptor())] });

    expect(response.status).toBe(500);
    expect(mockPoolConnect).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("cleans an earlier finalised object when a later attachment fails validation", async () => {
    const firstToken = messageDescriptor();
    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(firstToken), attachment()] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("uploadToken is required for message attachments");
    expect(mockFinalizeObjectEntityUpload).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("/objects/messages/finalized-attachment");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("cleans earlier finalised objects when a later attachment finalisation fails", async () => {
    const secondPath = "/objects/uploads/second-message-attachment";
    const firstAttachment = attachment(messageDescriptor());
    const secondAttachment = {
      ...attachment(messageDescriptor({
        objectPath: secondPath,
        fileName: "second.jpg",
      })),
      objectPath: secondPath,
      name: "second.jpg",
    };
    mockFinalizeObjectEntityUpload
      .mockResolvedValueOnce("/objects/messages/finalized-first")
      .mockRejectedValueOnce(new Error("second_finalisation_failed"));

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [firstAttachment, secondAttachment] });

    expect(response.status).toBe(500);
    expect(mockFinalizeObjectEntityUpload).toHaveBeenCalledTimes(2);
    expect(mockDeleteObject).toHaveBeenCalledWith("/objects/messages/finalized-first");
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("cleans finalised objects when the database connection cannot be acquired", async () => {
    mockPoolConnect.mockRejectedValueOnce(new Error("database_unavailable"));

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(messageDescriptor())] });

    expect(response.status).toBe(500);
    expect(mockDeleteObject).toHaveBeenCalledWith("/objects/messages/finalized-attachment");
  });

  it("cleans finalised objects after a known pre-commit database rollback", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) throw new Error("insert_failed");
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(messageDescriptor())] });

    expect(response.status).toBe(500);
    expect(mockDeleteObject).toHaveBeenCalledWith("/objects/messages/finalized-attachment");
  });

  it("preserves a finalised object when COMMIT has an indeterminate failure", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === "BEGIN") return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 57 }], rowCount: 1 };
      if (sql.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      if (sql === "COMMIT") throw new Error("commit_transport_failed");
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await supertest(makeApp())
      .post("/conversations/101/messages")
      .send({ attachments: [attachment(messageDescriptor())] });

    expect(response.status).toBe(500);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});