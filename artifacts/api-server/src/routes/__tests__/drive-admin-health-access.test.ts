/**
 * DRIVE-ADMIN-HEALTH-ACCESS — GET /drive/admin/health lived under an
 * "/admin/" path but was gated by requireAuth (any authenticated user of any
 * role), the same guard as the intentionally-public GET /storage/health. On
 * failure it can return provider error text (see lib/awsS3.ts
 * testConnection's `reason`/`lastError`), which the path implies is
 * admin-only — it must now require an actual admin role.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";

const { mockTestConnection } = vi.hoisted(() => ({ mockTestConnection: vi.fn() }));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: async () => ({ query: vi.fn(), release: () => {} }) },
}));
vi.mock("../../lib/awsS3", () => ({
  uploadFile: vi.fn(),
  downloadFileStream: vi.fn(),
  archiveFile: vi.fn(),
  deleteFile: vi.fn(),
  testConnection: mockTestConnection,
  isConfigured: () => true,
  getConfigStatus: () => ({ configured: true, bucket: "b", region: "r" }),
  batchPresignedUrls: vi.fn(async () => new Map()),
  buildObjectKey: (m: string, n: string) => `${m}/${n}`,
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
}));

const driveRouter = (await import("../drive")).default;
import type { CurrentUser } from "../../middlewares/currentUser";

function userOf(role: string): CurrentUser {
  return {
    id: 1, name: "U", email: "u@test.test", role, roleLabel: role,
    scope: "org", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
  } as CurrentUser;
}

function appAs(user: CurrentUser) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => { req.currentUser = user; next(); });
  app.use(driveRouter);
  return supertest(app);
}

beforeEach(() => { mockTestConnection.mockReset(); mockTestConnection.mockResolvedValue({ ok: true }); });

describe("DRIVE-ADMIN-HEALTH-ACCESS", () => {
  it("rejects a non-admin authenticated user with 403", async () => {
    const res = await appAs(userOf("state_office_manager")).get("/drive/admin/health");
    expect(res.status).toBe(403);
  });

  it("allows an admin role through", async () => {
    const res = await appAs(userOf("super_admin")).get("/drive/admin/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, provider: "aws-s3" });
  });
});
