import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPoolQuery,
  mockConnect,
  mockClientQuery,
  mockDeleteStorageObjectSafely,
  mockLogger,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockConnect: vi.fn(),
  mockClientQuery: vi.fn(),
  mockDeleteStorageObjectSafely: vi.fn(),
  mockLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockConnect },
}));

vi.mock("./objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class ObjectStorageService {},
  activeProvider: () => "s3",
  deleteStorageObjectSafely: mockDeleteStorageObjectSafely,
  isStorageConfigured: () => ({ configured: true, provider: "s3" }),
}));

vi.mock("./logger", () => ({ logger: mockLogger }));

const { runAttachmentUploadExpirySweep } = await import("./attachmentReconciliation");
const { MIGRATIONS } = await import("./run-migrations");
const projectDeleteSource = readFileSync(new URL("../routes/projects.ts", import.meta.url), "utf8");
const planDeleteSource = readFileSync(new URL("../routes/plans.ts", import.meta.url), "utf8");

function operation(overrides: Partial<{
  operationId: string;
  objectPath: string;
  finalObjectPath: string | null;
  attemptCount: number;
  status: string;
  cleanupStatus: string;
}> = {}) {
  return {
    operationId: "b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d",
    objectPath: "/objects/uploads/temporary-upload",
    finalObjectPath: "/objects/files/b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d",
    attemptCount: 0,
    status: "pending",
    cleanupStatus: "not_started",
    ...overrides,
  };
}

function installClaim(
  expiredRows: ReturnType<typeof operation>[],
  cleanupRows: ReturnType<typeof operation>[] = expiredRows,
) {
  const statements: string[] = [];
  mockClientQuery.mockImplementation(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("FROM attachment_upload_operations") && sql.includes("FOR UPDATE SKIP LOCKED")) {
      return { rows: expiredRows };
    }
    if (sql.includes("FROM attachment_upload_cleanup_jobs") && sql.includes("FOR UPDATE SKIP LOCKED")) {
      return { rows: cleanupRows };
    }
    return { rows: [] };
  });
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
  return statements;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockDeleteStorageObjectSafely.mockResolvedValue({ deleted: true });
});

describe("attachment upload expiry sweep", () => {
  it("persists retryable cleanup state through a tracked migration", () => {
    const sourceMigration = MIGRATIONS.find((entry) => entry.name === "048_attachment_upload_expiry_cleanup");
    const outboxMigration = MIGRATIONS.find((entry) => entry.name === "049_attachment_upload_cleanup_outbox");
    expect(sourceMigration?.sql).toContain("cleanup_status");
    expect(sourceMigration?.sql).toContain("cleanup_attempts");
    expect(sourceMigration?.sql).toContain("cleanup_error");
    expect(sourceMigration?.sql).toContain("cleanup_completed_at");
    expect(sourceMigration?.sql).toContain("idx_attachment_upload_operations_expiry_cleanup");
    expect(outboxMigration?.sql).toContain("CREATE TABLE IF NOT EXISTS attachment_upload_cleanup_jobs");
    expect(outboxMigration?.sql).not.toContain("REFERENCES attachment_upload_operations");
    expect(outboxMigration?.sql).toContain("lease_token");
    expect(outboxMigration?.sql).toContain("lease_expires_at");
    expect(outboxMigration?.sql).toContain("cleanup_status <> 'completed'");
    expect(outboxMigration?.sql).toContain(
      "SELECT operation_id, object_path, final_object_path, 'pending',",
    );
    expect(outboxMigration?.sql).not.toContain(
      "SELECT operation_id, object_path, final_object_path, cleanup_status,",
    );
    const parentDeleteMigration = MIGRATIONS.find((entry) => entry.name === "050_attachment_upload_cleanup_parent_delete");
    expect(parentDeleteMigration?.sql).toContain("INSERT INTO attachment_upload_cleanup_jobs");
    expect(parentDeleteMigration?.sql).toContain("status <> 'finalised'");
    const legacyBackfillMigration = MIGRATIONS.find(
      (entry) => entry.name === "051_attachment_upload_cleanup_legacy_failed_backfill",
    );
    expect(legacyBackfillMigration?.sql).toContain("status = 'failed'");
    expect(legacyBackfillMigration?.sql).toContain("cleanup_status <> 'completed'");
  });

  it("queues non-finalised uploads before every explicit plan or project deletion removes their source rows", () => {
    for (const source of [projectDeleteSource, planDeleteSource]) {
      const queueIndex = source.indexOf("INSERT INTO attachment_upload_cleanup_jobs");
      const deleteIndex = source.indexOf("DELETE FROM attachment_upload_operations", queueIndex);
      expect(queueIndex).toBeGreaterThan(-1);
      expect(deleteIndex).toBeGreaterThan(queueIndex);
      expect(source.slice(queueIndex, deleteIndex)).toContain("status <> 'finalised'");
      expect(source.slice(queueIndex, deleteIndex)).toContain("ON CONFLICT (operation_id) DO NOTHING");
    }
  });

  it("fails only expired pending operations before deleting their temporary and recorded final identities", async () => {
    const statements = installClaim([operation()]);
    mockDeleteStorageObjectSafely.mockImplementation(async () => {
      expect(statements).toContain("COMMIT");
      return { deleted: true };
    });

    await expect(runAttachmentUploadExpirySweep()).resolves.toEqual({
      examined: 1, cleaned: 1, failed: 0, retried: 0,
    });

    const claim = statements.find((sql) => sql.includes("FOR UPDATE SKIP LOCKED"))!;
    expect(claim).toContain("status = 'pending' AND expires_at <= NOW()");
    expect(claim).not.toContain("status = 'finalised'");
    expect(claim).not.toContain("FROM attachments");
    expect(statements.find((sql) => sql.includes("SET status = 'failed'"))).toBeTruthy();
    const outboxInsert = statements.findIndex((sql) => sql.includes("INSERT INTO attachment_upload_cleanup_jobs"));
    const commit = statements.findIndex((sql) => sql === "COMMIT");
    expect(outboxInsert).toBeGreaterThan(-1);
    expect(outboxInsert).toBeLessThan(commit);
    expect(mockDeleteStorageObjectSafely).toHaveBeenCalledTimes(2);
    expect(mockDeleteStorageObjectSafely).toHaveBeenNthCalledWith(1, "/objects/uploads/temporary-upload");
    expect(mockDeleteStorageObjectSafely).toHaveBeenNthCalledWith(
      2,
      "/objects/files/b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d",
    );
  });

  it("treats already-missing temporary and promotion objects as a completed, idempotent cleanup", async () => {
    installClaim([operation()]);
    mockDeleteStorageObjectSafely.mockResolvedValue({ deleted: false });

    await expect(runAttachmentUploadExpirySweep()).resolves.toEqual({
      examined: 1, cleaned: 1, failed: 0, retried: 0,
    });

    expect(mockDeleteStorageObjectSafely).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      ["b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d", expect.any(String)],
    );
  });

  it("sweeps a pending job created from a legacy failed upload during migration", async () => {
    installClaim([], [operation({ status: "pending", cleanupStatus: "not_started" })]);
    mockDeleteStorageObjectSafely.mockResolvedValue({ deleted: false });

    await expect(runAttachmentUploadExpirySweep()).resolves.toEqual({
      examined: 1, cleaned: 1, failed: 0, retried: 0,
    });

    expect(mockDeleteStorageObjectSafely).toHaveBeenCalledWith("/objects/uploads/temporary-upload");
    expect(mockDeleteStorageObjectSafely).toHaveBeenCalledWith(
      "/objects/files/b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d",
    );
  });

  it("records a cleanup failure and retries the durable failed operation on a later sweep", async () => {
    installClaim([operation()]);
    mockDeleteStorageObjectSafely
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(runAttachmentUploadExpirySweep()).resolves.toEqual({
      examined: 1, cleaned: 0, failed: 1, retried: 0,
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'failed'"),
      ["b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d", "provider unavailable", expect.any(String)],
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d", attempts: 1 }),
      expect.stringContaining("remains retryable"),
    );

    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockDeleteStorageObjectSafely.mockResolvedValue({ deleted: false });
    installClaim(
      [],
      [operation({ attemptCount: 1, status: "failed", cleanupStatus: "failed" })],
    );

    await expect(runAttachmentUploadExpirySweep()).resolves.toEqual({
      examined: 1, cleaned: 1, failed: 0, retried: 1,
    });
    expect(mockDeleteStorageObjectSafely).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      ["b81be2c6-4b4c-41e9-bd8d-0a10450a5e4d", expect.any(String)],
    );
  });
});