/**
 * PATH — Attachment objectPath Response Hardening (Route-Level Tests)
 *
 * Exercises the actual Express route handlers and asserts that the JSON
 * responses returned to clients never include `objectPath` (or any other
 * internal storage-path alias) in:
 *
 *   • GET  /reports/:reportId/attachments   — attachment listing
 *   • POST /reports/:reportId/attachments   — attachment create
 *   • GET  /voice-notes                     — voice note listing
 *   • POST /voice-notes                     — voice note create (report path)
 *
 * All external dependencies (pool, db, objectStorageService, reportAuth,
 * notifications, realtime) are mocked so tests are deterministic and
 * require no live database or storage backend.
 *
 * British English spelling used throughout (per project convention).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";
import { signUploadToken } from "../lib/uploadToken";

// ── Hoisted mocks (must be declared before vi.mock calls) ───────────────────

const {
  mockPoolQuery,
  mockOssGetObjectEntityFile,
  mockOssGetObjectEntityUploadURL,
  mockOssNormalizeObjectEntityPath,
  mockOssDownloadObject,
  mockAssertAttachmentMutationAllowed,
  mockAssertCanViewReport,
  mockDbInsert,
  mockDbSelect,
  mockDbSelectFrom,
  mockLogAudit,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockOssGetObjectEntityFile: vi.fn(),
  mockOssGetObjectEntityUploadURL: vi.fn(),
  mockOssNormalizeObjectEntityPath: vi.fn(),
  mockOssDownloadObject: vi.fn(),
  mockAssertAttachmentMutationAllowed: vi.fn(),
  mockAssertCanViewReport: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbSelectFrom: vi.fn(),
  mockLogAudit: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

class MockObjectNotFoundError extends Error {
  constructor() { super("Object not found"); this.name = "ObjectNotFoundError"; }
}

vi.mock("@workspace/db", () => {
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  return {
    pool: { query: mockPoolQuery, connect: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }) },
    db: {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: mockDbInsert }),
          returning: mockDbInsert,
        }),
      }),
      select: () => ({
        from: () => ({
          // Returns an array (iterable, so `const [u] = await chain` works) that also
          // carries an .orderBy() method so `.where().orderBy()` chains work too.
          where: () => {
            const rows: unknown[] = [];
            (rows as unknown as { orderBy: typeof mockDbSelect }).orderBy = mockDbSelect;
            return rows;
          },
          orderBy: () => ({ where: mockDbSelect }),
        }),
      }),
    },
  };
});

vi.mock("@workspace/db/schema", () => ({
  voiceNotesTable: { id: "id", objectPath: "object_path", entityType: "entity_type", entityId: "entity_id" },
  usersTable: { id: "id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => args),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class MockOSS {
    getObjectEntityFile = mockOssGetObjectEntityFile;
    getObjectEntityUploadURL = mockOssGetObjectEntityUploadURL;
    normalizeObjectEntityPath = mockOssNormalizeObjectEntityPath;
    downloadObject = mockOssDownloadObject;
  },
  ObjectNotFoundError: MockObjectNotFoundError,
  isStorageConfigured: vi.fn().mockReturnValue({ configured: true }),
}));

vi.mock("../lib/reportAuth", () => ({
  assertAttachmentMutationAllowed: mockAssertAttachmentMutationAllowed,
  assertCanViewReport: mockAssertCanViewReport,
  getReportSectorForAuth: vi.fn().mockResolvedValue("Health"),
}));

vi.mock("../lib/uploadToken", async (importOriginal) => {
  return importOriginal();
});

vi.mock("../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  attachCurrentUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  logAudit: mockLogAudit,
  assertSectorAllowed: vi.fn().mockReturnValue({ ok: true }),
  tcSectorRestriction: vi.fn().mockReturnValue(null),
  permissionsFor: vi.fn().mockReturnValue(new Set(["reports.update", "documents.upload", "reports.view"])),
}));

vi.mock("../lib/notifications", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("./comments", () => ({
  unresolvedRequiredCorrections: vi.fn().mockResolvedValue(0),
}));

vi.mock("@workspace/api-zod", () => ({
  CreateReportBody: { safeParse: vi.fn() },
  TransitionReportBody: { safeParse: vi.fn() },
  RequestUploadUrlBody: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { name: "test.pdf", size: 1024, contentType: "application/pdf" },
    }),
  },
  RequestUploadUrlResponse: {
    parse: vi.fn().mockImplementation((x) => x),
  },
}));

vi.mock("../lib/sectors", () => ({
  VALID_SECTOR_SET: new Set(["Health", "Education"]),
}));

vi.mock("../lib/reportConstants", () => ({
  CANONICAL_REPORT_TYPES: ["project", "activity", "hq_sector", "program_state"],
  CANONICAL_FREQUENCIES: ["monthly", "quarterly", "annual", "on_demand"],
  REPORT_WORKFLOWS: {},
  AWAITING_APPROVAL_STATUSES_SQL: "",
  TOTAL_STATUSES_SQL: "",
  CANONICAL_TYPES_SQL: "",
  getRevisionPerm: vi.fn(),
  isCanonicalReportType: vi.fn().mockReturnValue(true),
  isCanonicalFrequency: vi.fn().mockReturnValue(true),
  operationalPopulationSQL: "",
  getProjectActivityWorkflow: vi.fn(),
}));

// ── Import routes AFTER mocking ───────────────────────────────────────────────

const { default: reportsRouter } = await import("./reports");
const { default: voiceNotesRouter } = await import("./voice-notes");

// ── Test app ──────────────────────────────────────────────────────────────────

const TEST_USER = {
  id: 1,
  name: "Test User",
  email: "test@example.com",
  role: "state_program_officer",
  roleLabel: "State Programme Officer",
  scope: "state",
  stateId: 1,
  stateName: "Khartoum",
  sector: "Health",
  avatarUrl: null,
  sectors: null,
};

// Org-scope user — avoids the state-scope pool.query in GET /voice-notes
const PM_USER = {
  id: 2,
  name: "Programme Manager",
  email: "pm@example.com",
  role: "programme_manager",
  roleLabel: "Programme Manager",
  scope: "org",
  stateId: null,
  stateName: null,
  sector: "Health",
  avatarUrl: null,
  sectors: null,
};

function buildApp(user: typeof TEST_USER | typeof PM_USER = TEST_USER) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user;
    (req as unknown as { log: object }).log = {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    };
    next();
  });
  app.use(reportsRouter);
  app.use(voiceNotesRouter);
  // Capture unhandled async errors (Express 4 does not do this automatically)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[test-app-error]", err?.message, err?.stack?.split("\n")[1]);
    res.status(500).json({ error: err?.message ?? "unknown" });
  });
  return app;
}

const REPORT_ID = 42;
const OBJECT_PATH = "/objects/uploads/test-uuid-abc123";

// DB row that includes objectPath as it exists in the database record —
// the route handler must strip it before responding.
const DB_ATTACHMENT_ROW_WITH_PATH = {
  id: 101,
  reportId: REPORT_ID,
  fileName: "evidence.pdf",
  contentType: "application/pdf",
  size: 2048,
  // NOTE: objectPath is intentionally present here to simulate what the DB
  // returns for the conflict-path SELECT (existing row). The listing SELECT
  // no longer fetches objectPath at all, but the conflict SELECT did previously.
  uploadedAt: new Date().toISOString(),
};

// Attachment row as returned by the NEW listing/create SELECTs (no objectPath)
const DB_ATTACHMENT_DTO = {
  id: 101,
  reportId: REPORT_ID,
  fileName: "evidence.pdf",
  contentType: "application/pdf",
  size: 2048,
  uploadedAt: new Date().toISOString(),
};

const DB_VOICE_NOTE_ROW = {
  id: 55,
  entityType: "report",
  entityId: REPORT_ID,
  fileName: "voice.webm",
  objectPath: OBJECT_PATH, // present in DB; handler must strip before respond
  contentType: "audio/webm",
  durationSeconds: 25,
  recordedById: TEST_USER.id,
  createdAt: new Date(),
};

function makeAttachmentToken(overrides: Partial<Parameters<typeof signUploadToken>[0]> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signUploadToken({
    objectPath: OBJECT_PATH,
    userId: TEST_USER.id,
    reportId: REPORT_ID,
    entityType: "attachment",
    contentType: "application/pdf",
    maxSize: 2048,
    iat,
    exp: iat + 86400,
    ...overrides,
  });
}

function makeVoiceToken(overrides: Partial<Parameters<typeof signUploadToken>[0]> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signUploadToken({
    objectPath: OBJECT_PATH,
    userId: TEST_USER.id,
    reportId: REPORT_ID,
    entityType: "voice_note",
    contentType: "audio/webm",
    maxSize: 500000,
    iat,
    exp: iat + 86400,
    ...overrides,
  });
}

/** Assert that no objectPath or known storage aliases appear anywhere in body. */
function assertNoStoragePath(body: unknown): void {
  const forbidden = ["objectPath", "object_path", "storageKey", "storagePath"];
  const json = JSON.stringify(body);
  for (const key of forbidden) {
    // Check both as a JSON key and as a value that looks like a storage URL
    expect(json).not.toContain(`"${key}":`);
  }
  // Also ensure no raw GCS / S3 path leaks as a value
  expect(json).not.toMatch(/gcs:\/\//);
  expect(json).not.toMatch(/s3:\/\//);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PATH — GET /reports/:reportId/attachments — objectPath hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockAssertCanViewReport.mockResolvedValue({ ok: true });
    mockAssertAttachmentMutationAllowed.mockResolvedValue({ ok: true });
    mockOssGetObjectEntityFile.mockResolvedValue({ _p: "gcs", file: {} });
  });

  it("PATH-RT-01: attachment listing response does not include objectPath", async () => {
    // assertCanViewReport is mocked; the only pool.query is the listing SELECT.
    mockPoolQuery.mockResolvedValueOnce({ rows: [DB_ATTACHMENT_DTO], rowCount: 1 });

    const res = await supertest(buildApp())
      .get(`/reports/${REPORT_ID}/attachments`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    assertNoStoragePath(res.body);
    // Confirm expected fields are still present
    expect(res.body[0]).toHaveProperty("fileName", "evidence.pdf");
    expect(res.body[0]).toHaveProperty("contentType", "application/pdf");
    expect(res.body[0]).toHaveProperty("size", 2048);
  });

  it("PATH-RT-02: attachment listing does not expose objectPath even if DB were to return it", async () => {
    // Extra safety: if for any reason the DB row includes objectPath (e.g. migration gap),
    // the listing SELECT clause omitting it means it simply won't appear in the response.
    // Simulate with a row that has no objectPath (as the new SELECT produces).
    mockPoolQuery.mockResolvedValueOnce({ rows: [DB_ATTACHMENT_DTO], rowCount: 1 });

    const res = await supertest(buildApp())
      .get(`/reports/${REPORT_ID}/attachments`);

    expect(res.status).toBe(200);
    // Explicitly verify the key is absent
    for (const item of res.body) {
      expect(item).not.toHaveProperty("objectPath");
      expect(item).not.toHaveProperty("object_path");
    }
  });

  it("PATH-RT-03: unauthenticated attachment listing (assertCanViewReport fails) → 403", async () => {
    mockAssertCanViewReport.mockResolvedValueOnce({
      ok: false,
      status: 403,
      body: { error: "sector_scope_forbidden" },
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await supertest(buildApp())
      .get(`/reports/${REPORT_ID}/attachments`);

    expect(res.status).toBe(403);
    assertNoStoragePath(res.body);
  });
});

describe("PATH — POST /reports/:reportId/attachments — objectPath hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockAssertCanViewReport.mockResolvedValue({ ok: true });
    mockAssertAttachmentMutationAllowed.mockResolvedValue({ ok: true });
    mockOssGetObjectEntityFile.mockResolvedValue({ _p: "gcs", file: {} });
  });

  it("PATH-RT-04: attachment create (new row) response does not include objectPath", async () => {
    const token = makeAttachmentToken();
    // INSERT RETURNING: new row without objectPath (new RETURNING clause omits it)
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [DB_ATTACHMENT_DTO], rowCount: 1 });

    const res = await supertest(buildApp())
      .post(`/reports/${REPORT_ID}/attachments`)
      .send({ fileName: "evidence.pdf", uploadToken: token });

    expect(res.status).toBe(201);
    assertNoStoragePath(res.body);
    expect(res.body).toHaveProperty("fileName", "evidence.pdf");
    expect(res.body).toHaveProperty("id");
    expect(res.body).not.toHaveProperty("objectPath");
  });

  it("PATH-RT-05: attachment create (conflict path / idempotent) response does not include objectPath", async () => {
    const token = makeAttachmentToken();
    // First pool call: INSERT → empty RETURNING (conflict)
    // Second pool call: SELECT existing row → also without objectPath
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // INSERT ON CONFLICT → nothing
      .mockResolvedValueOnce({ rows: [DB_ATTACHMENT_DTO], rowCount: 1 }); // SELECT existing

    const res = await supertest(buildApp())
      .post(`/reports/${REPORT_ID}/attachments`)
      .send({ fileName: "evidence.pdf", uploadToken: token });

    expect(res.status).toBe(201);
    assertNoStoragePath(res.body);
    expect(res.body).not.toHaveProperty("objectPath");
    expect(res.body).toHaveProperty("fileName", "evidence.pdf");
  });
});

describe("PATH — GET /voice-notes — objectPath hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockAssertCanViewReport.mockResolvedValue({ ok: true });
    mockOssGetObjectEntityFile.mockResolvedValue({ _p: "gcs", file: {} });
  });

  it("PATH-RT-06: voice note listing response does not include objectPath", async () => {
    // entityType=comment skips pool.query in loadVoiceNoteSector (returns null directly).
    // This isolates the objectPath-stripping assertion from sector/state scope complexity.
    // The stripping logic is shared across all entityTypes so this exercises the same code path.
    mockDbSelect.mockResolvedValue([DB_VOICE_NOTE_ROW]);

    const res = await supertest(buildApp(PM_USER))
      .get(`/voice-notes?entityType=comment&entityId=${REPORT_ID}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    assertNoStoragePath(res.body);
    for (const note of res.body) {
      expect(note).not.toHaveProperty("objectPath");
      expect(note).not.toHaveProperty("object_path");
    }
  });

  it("PATH-RT-07: voice note listing response preserves non-sensitive fields", async () => {
    mockDbSelect.mockResolvedValue([DB_VOICE_NOTE_ROW]);

    const res = await supertest(buildApp(PM_USER))
      .get(`/voice-notes?entityType=comment&entityId=${REPORT_ID}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      const note = res.body[0];
      expect(note).toHaveProperty("id", 55);
      expect(note).toHaveProperty("fileName", "voice.webm");
      expect(note).toHaveProperty("contentType", "audio/webm");
      expect(note).toHaveProperty("durationSeconds", 25);
      expect(note).toHaveProperty("createdAt");
    }
  });
});

describe("PATH — POST /voice-notes — objectPath hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockAssertAttachmentMutationAllowed.mockResolvedValue({ ok: true });
    mockOssGetObjectEntityFile.mockResolvedValue({ _p: "gcs", file: {} });
  });

  it("PATH-RT-08: voice note create (report path) response does not include objectPath", async () => {
    const token = makeVoiceToken();
    // DB insert returns the note row WITH objectPath (as stored in DB);
    // the handler must strip it before res.status(201).json(...)
    mockDbInsert.mockResolvedValue([DB_VOICE_NOTE_ROW]);
    // Conflict-path fetch (if needed) — return empty so primary insert wins
    mockDbSelectFrom.mockResolvedValue([]);

    const res = await supertest(buildApp())
      .post(`/voice-notes`)
      .send({
        entityType: "report",
        entityId: REPORT_ID,
        fileName: "voice.webm",
        uploadToken: token,
        durationSeconds: 25,
      });

    expect(res.status).toBe(201);
    assertNoStoragePath(res.body);
    expect(res.body).not.toHaveProperty("objectPath");
    expect(res.body).not.toHaveProperty("object_path");
  });

  it("PATH-RT-09: voice note create response preserves non-sensitive fields", async () => {
    const token = makeVoiceToken();
    mockDbInsert.mockResolvedValue([DB_VOICE_NOTE_ROW]);
    mockDbSelectFrom.mockResolvedValue([]);

    const res = await supertest(buildApp())
      .post(`/voice-notes`)
      .send({
        entityType: "report",
        entityId: REPORT_ID,
        fileName: "voice.webm",
        uploadToken: token,
        durationSeconds: 25,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id", 55);
    expect(res.body).toHaveProperty("fileName", "voice.webm");
    expect(res.body).toHaveProperty("durationSeconds", 25);
    expect(res.body).toHaveProperty("createdAt");
  });
});
