import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const {
  mockUploadUrl,
  mockNormalisePath,
  mockStorageConfigured,
} = vi.hoisted(() => ({
  mockUploadUrl: vi.fn(),
  mockNormalisePath: vi.fn(),
  mockStorageConfigured: vi.fn(),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityUploadURL = mockUploadUrl;
    normalizeObjectEntityPath = mockNormalisePath;
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  isStorageConfigured: mockStorageConfigured,
}));

const { default: storageRouter } = await import("./storage");
const { permissionsFor } = await import("../middlewares/currentUser");

const OPERATIONAL_USER = {
  id: 7,
  name: "State Programme Officer",
  email: "spo@example.test",
  role: "state_program_officer",
  roleLabel: "State Programme Officer",
  scope: "state",
  stateId: 1,
  stateName: "Khartoum",
  sector: null,
  avatarUrl: null,
  sectors: null,
};

const VIEWER_USER = {
  ...OPERATIONAL_USER,
  id: 8,
  role: "viewer",
  roleLabel: "Viewer",
};

function makeApp(user = OPERATIONAL_USER) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user;
    (req as unknown as { log: { error: ReturnType<typeof vi.fn> } }).log = { error: vi.fn() };
    next();
  });
  app.use(storageRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorageConfigured.mockReturnValue({ configured: true });
  mockUploadUrl.mockResolvedValue("https://storage.example.test/upload/object-1");
  mockNormalisePath.mockReturnValue("/objects/messages/object-1");
});

describe("Communication Centre upload capability and descriptor contract", () => {
  it("COMM-UPLOAD-06: keeps the viewer messaging role text-only", async () => {
    const permissions = permissionsFor(VIEWER_USER);
    expect(permissions).toContain("messages.send");
    expect(permissions).not.toContain("messages.attachments.upload");

    const response = await supertest(makeApp(VIEWER_USER))
      .post("/storage/uploads/request-url")
      .send({ scope: "messages", name: "photo.png", size: 1024, contentType: "image/png" });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe("messages.attachments.upload");
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["COMM-UPLOAD-01 image", "photo.png", "image/png"],
    ["COMM-UPLOAD-02 document", "brief.pdf", "application/pdf"],
    ["COMM-UPLOAD-03 voice", "voice.webm", "audio/webm"],
  ])("%s requests the canonical private upload descriptor", async (_label, name, contentType) => {
    const response = await supertest(makeApp())
      .post("/storage/uploads/request-url")
      .send({ scope: "messages", name, size: 1024, contentType });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      uploadURL: "https://storage.example.test/upload/object-1",
      objectPath: "/objects/messages/object-1",
      metadata: { name, size: 1024, contentType, scope: "messages" },
    });
    expect(response.body.uploadToken).toEqual(expect.any(String));
  });

  it("COMM-UPLOAD-07: grants the messaging attachment capability to operational messaging roles", () => {
    const permissions = permissionsFor(OPERATIONAL_USER);
    expect(permissions).toContain("messages.send");
    expect(permissions).toContain("messages.attachments.upload");
  });

  it("COMM-UPLOAD-04: rejects unsupported MIME types before issuing an upload URL", async () => {
    const response = await supertest(makeApp())
      .post("/storage/uploads/request-url")
      .send({ scope: "messages", name: "unsafe.html", size: 512, contentType: "text/html" });

    expect(response.status).toBe(415);
    expect(response.body.error).toBe("unsupported_media_type");
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it("COMM-UPLOAD-05: rejects oversized uploads before issuing an upload URL", async () => {
    const response = await supertest(makeApp())
      .post("/storage/uploads/request-url")
      .send({
        scope: "messages",
        name: "large.pdf",
        size: 20 * 1024 * 1024 + 1,
        contentType: "application/pdf",
      });

    expect(response.status).toBe(413);
    expect(response.body.error).toBe("file_too_large");
    expect(mockUploadUrl).not.toHaveBeenCalled();
  });

  it("COMM-UPLOAD-08: keeps document-repository uploads on their existing capability", async () => {
    const response = await supertest(makeApp(VIEWER_USER))
      .post("/storage/uploads/request-url")
      .send({ name: "brief.pdf", size: 1024, contentType: "application/pdf" });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe("documents.upload");
  });
});