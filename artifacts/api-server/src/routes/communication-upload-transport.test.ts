import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const {
  mockGetObjectEntityUploadURL,
  mockNormalizeObjectEntityPath,
} = vi.hoisted(() => ({
  mockGetObjectEntityUploadURL: vi.fn(),
  mockNormalizeObjectEntityPath: vi.fn(),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityUploadURL = mockGetObjectEntityUploadURL;
    normalizeObjectEntityPath = mockNormalizeObjectEntityPath;
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  isStorageConfigured: vi.fn().mockReturnValue({ configured: true }),
}));

const { default: storageRouter } = await import("./storage");

const VIEWER = {
  id: 7,
  name: "Viewer",
  email: "viewer@example.test",
  role: "viewer",
  roleLabel: "Viewer",
  scope: "org",
  stateId: null,
  stateName: null,
  sector: "",
  avatarUrl: null,
  sectors: null,
};
const AUTHORISED_SENDER = {
  ...VIEWER,
  role: "technical_coordinator",
  roleLabel: "Technical Coordinator",
  sector: "Health",
};
const UNAUTHORISED_ROLE = { ...VIEWER, role: "unrecognised_role" };

function makeApp(user = AUTHORISED_SENDER) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user;
    (req as unknown as { log: object }).log = { error: vi.fn() };
    next();
  });
  app.use(storageRouter);
  return app;
}

function requestUpload(app: express.Express, body: Record<string, unknown>) {
  return supertest(app)
    .post("/storage/uploads/request-url")
    .send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetObjectEntityUploadURL.mockResolvedValue("https://storage.example.test/upload");
  mockNormalizeObjectEntityPath.mockReturnValue("/objects/uploads/secure-message-file");
});

describe("Communication Centre upload capability and transport", () => {
  it.each([
    ["image", "photo.jpg", 1024, "image/jpeg"],
    ["document", "brief.pdf", 1024, "application/pdf"],
    ["voice", "voice.webm", 1024, "audio/webm"],
  ])("COMM-UPLOAD: issues the generated descriptor for supported %s uploads", async (_kind, name, size, contentType) => {
    const response = await requestUpload(makeApp(), {
      name,
      size,
      contentType,
      scope: "messages",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      uploadURL: "https://storage.example.test/upload",
      objectPath: "/objects/uploads/secure-message-file",
      metadata: { name, size, contentType, scope: "messages" },
    });
    expect(mockGetObjectEntityUploadURL).toHaveBeenCalledWith(contentType);
    expect(response.body.uploadToken).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty("uploadUrl");
  });

  it("denies a user without the dedicated messaging upload capability", async () => {
    const response = await requestUpload(makeApp(UNAUTHORISED_ROLE), {
      name: "brief.pdf",
      size: 1024,
      contentType: "application/pdf",
      scope: "messages",
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: "forbidden",
      requiredPermission: "messages.attachments.upload",
    });
    expect(mockGetObjectEntityUploadURL).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported MIME", { name: "script.html", size: 1024, contentType: "text/html", scope: "messages" }, 415, "unsupported_media_type"],
    ["oversized file", { name: "large.pdf", size: 20 * 1024 * 1024 + 1, contentType: "application/pdf", scope: "messages" }, 413, "file_too_large"],
    ["unsafe filename", { name: "../secret.pdf", size: 1024, contentType: "application/pdf", scope: "messages" }, 400, "invalid_file_name"],
  ])("retains server validation for %s", async (_case, body, status, error) => {
    const response = await requestUpload(makeApp(), body);
    expect(response.status).toBe(status);
    expect(response.body.error).toBe(error);
    expect(mockGetObjectEntityUploadURL).not.toHaveBeenCalled();
  });

  it("returns canonical filename and MIME metadata for the message descriptor", async () => {
    const response = await requestUpload(makeApp(), {
      name: " brief.pdf ",
      size: 1024,
      contentType: "Application/PDF; charset=binary",
      scope: "messages",
    });

    expect(response.status).toBe(200);
    expect(response.body.metadata).toMatchObject({
      name: "brief.pdf",
      contentType: "application/pdf",
      size: 1024,
      scope: "messages",
    });
    expect(mockGetObjectEntityUploadURL).toHaveBeenCalledWith("application/pdf");
  });

  it("does not let message scope change report-bound upload policy", async () => {
    const response = await requestUpload(makeApp(), {
      name: "report.pdf",
      size: 1024,
      contentType: "application/pdf",
      scope: "messages",
      reportId: 44,
      entityType: "attachment",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_upload_scope");
    expect(mockGetObjectEntityUploadURL).not.toHaveBeenCalled();
  });
});