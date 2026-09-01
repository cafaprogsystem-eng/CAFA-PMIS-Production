import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQuery,
  mockConnect,
  mockClientQuery,
  mockVerifyToken,
  mockHasPerm,
  mockPlanEditable,
  mockMetadata,
  mockDeleteStorageObjectSafely,
  MockObjectNotFoundError,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
  mockClientQuery: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockHasPerm: vi.fn(),
  mockPlanEditable: vi.fn(),
  mockMetadata: vi.fn(),
  mockDeleteStorageObjectSafely: vi.fn(),
  MockObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery, connect: mockConnect } }));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: MockObjectNotFoundError,
  ObjectStorageService: class {
    getObjectEntityMetadata = mockMetadata;
  },
  activeProvider: () => "s3",
  deleteStorageObjectSafely: mockDeleteStorageObjectSafely,
  isStorageConfigured: () => ({ configured: true, provider: "s3" }),
}));
vi.mock("../lib/uploadToken", () => ({
  UploadTokenError: class UploadTokenError extends Error {},
  verifyUploadToken: mockVerifyToken,
  signUploadToken: vi.fn(),
}));
vi.mock("../middlewares/currentUser", () => ({
  hasPerm: mockHasPerm,
  permissionsFor: () => [],
  assertSectorAllowed: () => ({ ok: true }),
  logAudit: vi.fn(),
}));
vi.mock("./plans", () => ({
  assertAnySectorAllowed: () => ({ ok: true }),
  assertPlanStateAllowed: () => ({ ok: true }),
  isPlanCurrentlyEditable: mockPlanEditable,
}));

describe("finalised attachment replay authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPerm.mockReturnValue(false);
    mockConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
  });

  it.each([
    ["temporary upload metadata", false],
    ["deterministic promotion metadata", true],
  ])("durably queues both identities when %s is invalid", async (_label, sourceMissing) => {
    const operationId = "d0f7f2c7-86f7-453c-89b9-8a9b58da4d66";
    const operation = {
      operationId, parentType: "plan", parentId: 41, userId: 7,
      objectPath: "/objects/uploads/pending", fileName: "evidence.pdf",
      contentType: "application/pdf", declaredSize: 1, expiresAt: new Date(Date.now() + 60_000),
      status: "pending", attachmentId: null, replacementAttachmentId: null,
    };
    mockHasPerm.mockReturnValue(true);
    mockPlanEditable.mockResolvedValue(true);
    mockVerifyToken.mockReturnValue({
      operationId, userId: 7, entityType: "attachment", parentType: "plan", parentId: 41,
      objectPath: operation.objectPath, contentType: operation.contentType, maxSize: operation.declaredSize,
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("attachment_upload_operations")) return Promise.resolve({ rows: [operation] });
      return Promise.resolve({ rows: [] });
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{
          stateId: null, locationType: "hq", sectors: ["Health"], sector: "Health",
          status: "draft", lastFinalApprovedAt: null, createdById: 7,
        }] });
      }
      if (sql.includes("attachment_upload_operations") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [operation] });
      }
      if (sql.includes("MAX(version_number)")) return Promise.resolve({ rows: [{ versionNumber: 0 }] });
      return Promise.resolve({ rows: [] });
    });
    if (sourceMissing) {
      mockMetadata
        .mockRejectedValueOnce(new MockObjectNotFoundError("temporary object missing"))
        .mockResolvedValueOnce({ size: 99, contentType: "application/pdf" });
    } else {
      mockMetadata.mockResolvedValueOnce({ size: 99, contentType: "application/pdf" });
    }
    mockDeleteStorageObjectSafely.mockRejectedValue(new Error("provider unavailable"));

    const { default: attachmentsRouter } = await import("./attachments");
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = {
        id: 7, name: "Planner", email: "planner@example.test", role: "program_manager",
        roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null,
        sector: null, sectors: [], avatarUrl: null,
      };
      next();
    });
    app.use(attachmentsRouter);

    const res = await request(app)
      .post(`/attachments/operations/${operationId}/finalize`)
      .send({ uploadToken: "valid-token" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "uploaded_object_metadata_mismatch" });
    const statements = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    const updateIndex = statements.findIndex((sql) => sql.includes("SET status = 'failed'"));
    const outboxIndex = statements.findIndex((sql) => sql.includes("INSERT INTO attachment_upload_cleanup_jobs"));
    const commitIndex = statements.findIndex((sql) => sql === "COMMIT");
    expect(updateIndex).toBeGreaterThan(-1);
    expect(outboxIndex).toBeGreaterThan(updateIndex);
    expect(commitIndex).toBeGreaterThan(outboxIndex);
    expect(mockClientQuery.mock.calls[outboxIndex]![1]).toEqual([
      operationId, "/objects/uploads/pending", `/objects/files/${operationId}`,
    ]);
    // Provider failures cannot discard the job because finalisation never relies
    // on its former one-shot best-effort delete.
    expect(mockDeleteStorageObjectSafely).not.toHaveBeenCalled();
  });

  it("does not let a descriptor token bypass a revoked Plan view permission", async () => {
    const operationId = "a0f7f2c7-86f7-453c-89b9-8a9b58da4d66";
    mockVerifyToken.mockReturnValue({
      operationId, userId: 7, entityType: "attachment", parentType: "plan", parentId: 41,
    });
    mockQuery.mockResolvedValue({
      rows: [{
        operationId, parentType: "plan", parentId: 41, userId: 7,
        objectPath: "/objects/uploads/pending", fileName: "evidence.pdf",
        contentType: "application/pdf", declaredSize: 1, expiresAt: new Date(Date.now() + 60_000),
        status: "finalised", attachmentId: 91, replacementAttachmentId: null,
      }],
    });

    const { default: attachmentsRouter } = await import("./attachments");
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = {
        id: 7, name: "Former planner", email: "former@example.test", role: "viewer",
        roleLabel: "Viewer", scope: "state", stateId: 3, stateName: "Khartoum",
        sector: null, sectors: [], avatarUrl: null,
      };
      next();
    });
    app.use(attachmentsRouter);

    const res = await request(app)
      .post(`/attachments/operations/${operationId}/finalize`)
      .send({ uploadToken: "previously-valid-token" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden", requiredPermission: "plans.view" });
    // Only the operation lookup occurred; the final attachment was not read.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("locks the Plan parent before a pending upload operation", async () => {
    const operationId = "b0f7f2c7-86f7-453c-89b9-8a9b58da4d66";
    const operation = {
      operationId, parentType: "plan", parentId: 41, userId: 7,
      objectPath: "/objects/uploads/pending", fileName: "evidence.pdf",
      contentType: "application/pdf", declaredSize: 1, expiresAt: new Date(Date.now() + 60_000),
      status: "pending", attachmentId: null, replacementAttachmentId: null,
    };
    mockHasPerm.mockReturnValue(true);
    mockPlanEditable.mockResolvedValue(true);
    mockVerifyToken.mockReturnValue({
      operationId, userId: 7, entityType: "attachment", parentType: "plan", parentId: 41,
      objectPath: operation.objectPath, contentType: operation.contentType, maxSize: operation.declaredSize,
    });
    mockQuery.mockResolvedValue({ rows: [operation] });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{
          stateId: null, locationType: "hq", sectors: ["Health"], sector: "Health",
          status: "draft", lastFinalApprovedAt: null, createdById: 7,
        }] });
      }
      if (sql.includes("attachment_upload_operations") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [{ ...operation, status: "failed" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { default: attachmentsRouter } = await import("./attachments");
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = {
        id: 7, name: "Planner", email: "planner@example.test", role: "program_manager",
        roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null,
        sector: null, sectors: [], avatarUrl: null,
      };
      next();
    });
    app.use(attachmentsRouter);

    const res = await request(app)
      .post(`/attachments/operations/${operationId}/finalize`)
      .send({ uploadToken: "valid-token" });

    expect(res.status).toBe(409);
    const statements = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes("FROM plans pl")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("attachment_upload_operations") && sql.includes("FOR UPDATE")));
  });

  it("replays a concurrently finalised operation with view access after Plan mutation access is lost", async () => {
    const operationId = "c0f7f2c7-86f7-453c-89b9-8a9b58da4d66";
    const pendingOperation = {
      operationId, parentType: "plan", parentId: 41, userId: 7,
      objectPath: "/objects/uploads/pending", fileName: "evidence.pdf",
      contentType: "application/pdf", declaredSize: 1, expiresAt: new Date(Date.now() + 60_000),
      status: "pending", attachmentId: null, replacementAttachmentId: null,
    };
    mockHasPerm.mockImplementation((_permissions: unknown, permission: string) => permission === "plans.view");
    mockVerifyToken.mockReturnValue({
      operationId, userId: 7, entityType: "attachment", parentType: "plan", parentId: 41,
      objectPath: pendingOperation.objectPath, contentType: pendingOperation.contentType,
      maxSize: pendingOperation.declaredSize,
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("attachment_upload_operations")) return Promise.resolve({ rows: [pendingOperation] });
      if (sql.includes("FROM attachments")) {
        return Promise.resolve({ rows: [{
          id: 91, parentType: "plan", parentId: 41, fileName: "evidence.pdf",
          contentType: "application/pdf", size: 1, status: "active",
          availabilityStatus: "available", versionNumber: 1,
          uploadedAt: new Date(), uploadedByName: "Planner",
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans pl")) {
        return Promise.resolve({ rows: [{
          stateId: null, locationType: "hq", sectors: ["Health"], sector: "Health",
          status: "approved", lastFinalApprovedAt: new Date(), createdById: 7,
        }] });
      }
      if (sql.includes("attachment_upload_operations") && sql.includes("FOR UPDATE")) {
        return Promise.resolve({ rows: [{ ...pendingOperation, status: "finalised", attachmentId: 91 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { default: attachmentsRouter } = await import("./attachments");
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = {
        id: 7, name: "Reader", email: "reader@example.test", role: "program_manager",
        roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null,
        sector: null, sectors: [], avatarUrl: null,
      };
      next();
    });
    app.use(attachmentsRouter);

    const res = await request(app)
      .post(`/attachments/operations/${operationId}/finalize`)
      .send({ uploadToken: "valid-token" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 91, parentType: "plan", parentId: 41 });
    // The operation became finalised after the initial read, so the locked
    // replay path must not demand the now-revoked mutation capability.
    expect(mockPlanEditable).not.toHaveBeenCalled();
  });
});