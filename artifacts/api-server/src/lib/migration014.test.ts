/**
 * Migration 014 — ATT-02 evidence object_path uniqueness
 *
 * Verifies that migration 014 is self-sufficient and safe to apply over:
 *   • A clean schema (tables newly created by the migration itself)
 *   • An existing schema with historical duplicate object_path rows
 *   • An existing schema with no duplicates
 *   • A partial schema where voice_notes does not yet exist
 *
 * Because the migration runner uses a real pool, tests here mock pool at the
 * module level and verify that the correct SQL sequence is executed.  They do
 * NOT require a live database.
 *
 * British English spelling throughout (per project convention).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPoolConnect } = vi.hoisted(() => ({
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: mockPoolConnect },
}));

vi.mock("./logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// ── Import runner AFTER mocking ────────────────────────────────────────────────

const { runMigrations } = await import("./run-migrations");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns an array of all SQL strings passed to client.query() during migration. */
function capturedQueries(mockClient: ReturnType<typeof buildMockClient>): string[] {
  return mockClient.query.mock.calls.map(([sql]: [string]) => sql as string);
}

/**
 * Build a mock DB client.
 * `schema_migrations` returns:
 *   - all rows for each migration name that is NOT in `pendingNames`
 *   - empty for names that ARE in `pendingNames` (triggers execution)
 */
function buildMockClient(pendingNames: string[] = ["014_att02_evidence_object_path_unique"]) {
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // schema_migrations lookup — determine if this migration is pending
      if (sql.includes("schema_migrations WHERE filename")) {
        const name = params?.[0] as string;
        const isPending = pendingNames.includes(name);
        return { rows: isPending ? [] : [{ 1: 1 }] };
      }
      // All other queries succeed with empty rows
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return client;
}

// ── Structural tests on the migration SQL ─────────────────────────────────────

describe("Migration 014 SQL — structural validation", () => {
  // Extract migration 014's sql by running the migrations with all already-applied
  // except 014, then capturing the query call that contains the migration body.
  let capturedMigrationSql = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    const client = buildMockClient(["014_att02_evidence_object_path_unique"]);
    mockPoolConnect.mockResolvedValue(client);
    await runMigrations();
    // Find the SQL that was executed as the migration body (not BEGIN/COMMIT etc.)
    const allCalls = capturedQueries(client);
    const migrationBodyCall = allCalls.find(
      (sql) =>
        sql.includes("report_attachments") &&
        !sql.includes("schema_migrations") &&
        sql !== "BEGIN" &&
        sql !== "COMMIT",
    );
    capturedMigrationSql = migrationBodyCall ?? "";
  });

  it("creates report_attachments table with IF NOT EXISTS guard", () => {
    expect(capturedMigrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS report_attachments/i,
    );
  });

  it("deduplicates report_attachments BEFORE creating the unique index", () => {
    const deletePos = capturedMigrationSql.indexOf("DELETE FROM report_attachments");
    const indexPos = capturedMigrationSql.indexOf("idx_report_attachments_object_path");
    expect(deletePos).toBeGreaterThan(-1);
    expect(indexPos).toBeGreaterThan(-1);
    expect(deletePos).toBeLessThan(indexPos); // DELETE comes first
  });

  it("deduplication keeps the row with MIN(id) per object_path", () => {
    // The DELETE should use a NOT IN (SELECT MIN(id) ... GROUP BY object_path) pattern
    expect(capturedMigrationSql).toMatch(
      /DELETE FROM report_attachments[\s\S]*?WHERE id NOT IN[\s\S]*?SELECT MIN\(id\)[\s\S]*?GROUP BY object_path/i,
    );
  });

  it("unique index uses IF NOT EXISTS so re-runs are safe", () => {
    expect(capturedMigrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_report_attachments_object_path/i,
    );
  });

  it("voice_notes is guarded by information_schema existence check", () => {
    expect(capturedMigrationSql).toMatch(
      /information_schema\.tables[\s\S]*?voice_notes/i,
    );
  });

  it("voice_notes deduplication is inside the DO block", () => {
    const doBlockStart = capturedMigrationSql.indexOf("DO $$");
    const voiceDelete = capturedMigrationSql.indexOf("DELETE FROM voice_notes");
    expect(doBlockStart).toBeGreaterThan(-1);
    expect(voiceDelete).toBeGreaterThan(doBlockStart); // inside the DO block
  });

  it("voice_notes index creation uses IF NOT EXISTS guard inside DO block", () => {
    expect(capturedMigrationSql).toMatch(
      /IF NOT EXISTS[\s\S]*?idx_voice_notes_object_path/i,
    );
  });
});

// ── Runner-level tests ────────────────────────────────────────────────────────

describe("runMigrations — migration 014 execution scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips migration 014 when already recorded in schema_migrations", async () => {
    // All migrations already applied — none pending
    const client = buildMockClient([]); // empty pending list
    mockPoolConnect.mockResolvedValue(client);

    await runMigrations();

    const queries = capturedQueries(client);
    // The migration SQL body should never have been executed
    const ran014 = queries.some(
      (sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS report_attachments") ||
        sql.includes("idx_report_attachments_object_path"),
    );
    expect(ran014).toBe(false);
  });

  it("applies migration 014 inside a transaction (BEGIN / COMMIT)", async () => {
    const client = buildMockClient(["014_att02_evidence_object_path_unique"]);
    mockPoolConnect.mockResolvedValue(client);

    await runMigrations();

    const queries = capturedQueries(client);
    expect(queries).toContain("BEGIN");
    expect(queries).toContain("COMMIT");

    // BEGIN should precede the migration body
    const beginIdx = queries.indexOf("BEGIN");
    const bodyIdx = queries.findIndex((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS report_attachments"),
    );
    expect(beginIdx).toBeLessThan(bodyIdx);
  });

  it("records migration 014 in schema_migrations after successful run", async () => {
    const client = buildMockClient(["014_att02_evidence_object_path_unique"]);
    mockPoolConnect.mockResolvedValue(client);

    await runMigrations();

    const insertCall = client.query.mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        sql.includes("INSERT INTO public.schema_migrations") &&
        Array.isArray(params) &&
        params[0] === "014_att02_evidence_object_path_unique",
    );
    expect(insertCall).toBeDefined();
  });

  it("ROLLBACKs and throws if migration 014 SQL fails", async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT 1 FROM schema_migrations WHERE filename")) {
          const name = params?.[0] as string;
          return {
            rows: name === "014_att02_evidence_object_path_unique" ? [] : [{ 1: 1 }],
          };
        }
        // Simulate migration body failing (e.g. unique constraint violation)
        if (sql.includes("CREATE TABLE IF NOT EXISTS report_attachments")) {
          throw new Error("simulated SQL error");
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    await expect(runMigrations()).rejects.toThrow("simulated SQL error");

    const queries = capturedQueries(client as typeof client);
    expect(queries).toContain("ROLLBACK");
  });

  it("clean schema: migration 014 runs to completion without error", async () => {
    const client = buildMockClient(["014_att02_evidence_object_path_unique"]);
    mockPoolConnect.mockResolvedValue(client);

    // Should not throw
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("migration 014 applied alone still releases the pool client", async () => {
    const client = buildMockClient(["014_att02_evidence_object_path_unique"]);
    mockPoolConnect.mockResolvedValue(client);

    await runMigrations();

    expect(client.release).toHaveBeenCalled();
  });

  it("pool client is released even if a migration throws", async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT 1 FROM schema_migrations WHERE filename")) {
          const name = params?.[0] as string;
          return {
            rows: name === "014_att02_evidence_object_path_unique" ? [] : [{ 1: 1 }],
          };
        }
        if (sql.includes("CREATE TABLE IF NOT EXISTS report_attachments")) {
          throw new Error("injected failure");
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockPoolConnect.mockResolvedValue(client);

    await runMigrations().catch(() => {});

    expect(client.release).toHaveBeenCalled();
  });
});

// ── Migration idempotency ─────────────────────────────────────────────────────

describe("Migration 014 — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("running migrations a second time is a no-op (all already recorded)", async () => {
    const client = buildMockClient([]); // all applied
    mockPoolConnect.mockResolvedValue(client);

    await runMigrations();

    const queries = capturedQueries(client);
    const migrationBodyExecuted = queries.some((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS report_attachments"),
    );
    expect(migrationBodyExecuted).toBe(false);
  });
});
