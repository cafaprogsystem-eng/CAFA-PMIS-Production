import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUploadToken } from "../lib/uploadToken";

const {
  mockPoolQuery,
  mockLogAudit,
  mockGetMetadata,
  mockGetFile,
  mockDownload,
  mockFinalize,
  mockDelete,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLogAudit: vi.fn(),
  mockGetMetadata: vi.fn(),
  mockGetFile: vi.fn(),
  mockDownload: vi.fn(),
  mockFinalize: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../middlewares/currentUser.js", () => ({ logAudit: mockLogAudit }));
vi.mock("../lib/objectStorage.js", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class {
    getObjectEntityMetadata = mockGetMetadata;
    getObjectEntityFile = mockGetFile;
    downloadObject = mockDownload;
    finalizeObjectEntityUpload = mockFinalize;
    getObjectEntityUploadURL = vi.fn();
    normalizeObjectEntityPath = vi.fn();
  },
  deleteStorageObjectSafely: mockDelete,
  isStorageConfigured: () => ({ configured: true, provider: "replit" }),
}));

const profileRouter = (await import("./profile")).default;

function appFor(userId = 7) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: userId } as NonNullable<Request["currentUser"]>;
    req.log = { error: vi.fn(), warn: vi.fn() } as never;
    next();
  });
  app.use(profileRouter);
  return app;
}

describe("secure self-profile boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete.mockResolvedValue({ deleted: true });
  });

  it("returns canonical user-management fields, access summary, and a proxy photo URL", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 7, name: "Amina Hassan", email: "amina@example.test", username: "amina",
        role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "hq",
        stateId: null, stateName: null, sector: "Health, WASH", avatarPath: "/objects/profiles/11111111-1111-1111-1111-111111111111",
        status: "active", emailVerified: true, emailVerifiedAt: "2026-08-01T10:00:00.000Z",
        createdAt: "2026-01-01T10:00:00.000Z", lastLoginAt: "2026-08-20T10:00:00.000Z",
        timezone: "Africa/Khartoum", languagePreference: "en", notificationPreferences: null,
      }],
    });

    const response = await request(appFor()).get("/profile").expect(200);

    expect(response.body).toMatchObject({
      email: "amina@example.test",
      username: "amina",
      status: "active",
      emailVerified: true,
      avatarUrl: "/api/profile/photo",
      access: { kind: "sector_scoped", stateNames: [], sectors: ["Health", "WASH"] },
    });
    expect(JSON.stringify(response.body)).not.toContain("/objects/");
  });

  it("fails closed for legacy avatar object keys instead of advertising a broken proxy", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 7, name: "Amina Hassan", email: "amina@example.test", username: "amina",
        role: "program_manager", roleLabel: "Program Manager", scope: "hq",
        stateId: null, stateName: null, sector: null, avatarPath: "/objects/uploads/legacy-key",
        status: "active", emailVerified: true, createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null, timezone: "Africa/Khartoum", languagePreference: "en",
        notificationPreferences: null,
      }],
    });

    const response = await request(appFor()).get("/profile").expect(200);
    expect(response.body.avatarUrl).toBeNull();
  });

  it("rejects attempted identity, lifecycle, and RBAC mutations before touching the database", async () => {
    const response = await request(appFor()).patch("/profile").send({
      name: "Amina",
      email: "attacker@example.test",
      role: "super_admin",
      stateId: 999,
      avatarUrl: "/objects/uploads/forged",
    }).expect(400);

    expect(response.body.error).toBe("forbidden_profile_field");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("normalises supported personal values and keeps the authenticated user as the target", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 7, name: "Amina Hassan", phone: "+249912345678", jobTitle: "Programme Officer",
        role: "viewer", roleLabel: "Viewer", scope: "hq", stateId: null, stateName: null,
        sector: null, avatarPath: null, timezone: "Africa/Khartoum", languagePreference: "en",
        notificationPreferences: null, status: "active", emailVerified: false,
      }] });

    await request(appFor()).patch("/profile").send({
      name: "  أمينة   حسن  ",
      phone: "+249 912 345 678",
      jobTitle: " Programme   Officer ",
    }).expect(200);

    const [sql, values] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE users SET");
    expect(values).toEqual(["أمينة حسن", "+249912345678", "Programme Officer", 7]);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "update_profile", entityId: 7 }));
  });

  it("requires the actual current password and never returns credential material", async () => {
    const hash = await bcrypt.hash("Currentpass1", 4);
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ password_hash: hash }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(appFor()).post("/profile/change-password").send({
      currentPassword: "Currentpass1",
      newPassword: "Replacement2",
    }).expect(200);

    expect(response.body).toEqual({ message: "Password changed successfully." });
    expect(JSON.stringify(response.body)).not.toContain("password");
    expect(mockPoolQuery.mock.calls[1][0]).toContain("UPDATE users SET password_hash");
    expect(mockPoolQuery.mock.calls[2][0]).toContain("UPDATE auth_sessions");
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "change_password" }));
  });

  it("throttles repeated password-change attempts for the same signed-in user", async () => {
    const app = appFor(999);
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app).post("/profile/change-password").send({}).expect(400);
      }

      const response = await request(app).post("/profile/change-password").send({}).expect(429);
      expect(response.body).toEqual(expect.objectContaining({ error: "too_many_requests" }));
      expect(JSON.stringify(response.body)).not.toContain("password");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("binds photo completion to the signed-in user and validates actual image bytes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenForAnotherUser = signUploadToken({
      objectPath: "/objects/uploads/00000000-0000-0000-0000-000000000000",
      userId: 8, reportId: 0, entityType: "profile_photo", scope: "profile",
      contentType: "image/png", maxSize: 5 * 1024 * 1024, iat: now, exp: now + 60,
    });
    await request(appFor()).post("/profile/photo").send({ uploadToken: tokenForAnotherUser }).expect(403);
    expect(mockGetMetadata).not.toHaveBeenCalled();

    const validToken = signUploadToken({
      objectPath: "/objects/uploads/00000000-0000-0000-0000-000000000001",
      userId: 7, reportId: 0, entityType: "profile_photo", scope: "profile",
      contentType: "image/png", maxSize: 5 * 1024 * 1024, iat: now, exp: now + 60,
    });
    mockGetMetadata.mockResolvedValue({ size: 8, contentType: "image/png" });
    mockGetFile.mockResolvedValue({});
    mockDownload.mockResolvedValue(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    mockFinalize.mockResolvedValue("/objects/profiles/11111111-1111-1111-1111-111111111111");
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ previousAvatarPath: "/objects/profiles/22222222-2222-2222-2222-222222222222" }] });

    const response = await request(appFor()).post("/profile/photo").send({ uploadToken: validToken }).expect(200);
    expect(response.body).toEqual({ avatarUrl: "/api/profile/photo" });
    expect(mockFinalize).toHaveBeenCalledWith(expect.stringContaining("/objects/uploads/"), "profiles");
    expect(mockDelete).toHaveBeenCalledWith("/objects/profiles/22222222-2222-2222-2222-222222222222");
    expect(JSON.stringify(response.body)).not.toContain("/objects/");
  });

  it("rejects unsupported or oversized photo descriptors before issuing storage uploads", async () => {
    await request(appFor()).post("/profile/photo/upload-url").send({ size: 1, contentType: "image/gif" }).expect(415);
    await request(appFor()).post("/profile/photo/upload-url").send({ size: 5 * 1024 * 1024 + 1, contentType: "image/png" }).expect(413);
    expect(mockGetMetadata).not.toHaveBeenCalled();
  });

  it("removes only the current user's managed photo and returns no object key", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ previousAvatarPath: "/objects/profiles/22222222-2222-2222-2222-222222222222" }],
    });

    const response = await request(appFor()).delete("/profile/photo").expect(200);
    expect(response.body).toEqual({ avatarUrl: null });
    expect(mockDelete).toHaveBeenCalledWith("/objects/profiles/22222222-2222-2222-2222-222222222222");
    expect(JSON.stringify(response.body)).not.toContain("/objects/");
  });
});