/**
 * PRJ-009 / PRJ-010 — Project Document Evidence Security Closure (Task #509)
 *
 * PRJ-DOC-SEC-01..08   Internal storage field leakage + access-control ordering
 * PRJ-DOC-DL-01..06    Download proxy/streaming behaviour (no /storage/objects redirect)
 * PRJ-DOC-DTO-01       DTO sentinel: strict allow-list of public document keys
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { ZodError } from "zod";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
mockClientQuery.mockResolvedValue({ rows: [] });
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn().mockResolvedValue(mockClient);

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery, connect: mockConnectFn },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
  notifyByRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockDownloadFileStream = vi.fn();
const mockS3IsConfigured = vi.fn().mockReturnValue(false);
vi.mock("../lib/awsS3.js", () => ({
  archiveFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  downloadFileStream: (...args: unknown[]) => mockDownloadFileStream(...args),
  isConfigured: () => mockS3IsConfigured(),
}));

// Object storage spy — asserts storage is never touched when guards fire.
const mockGetObjectEntityFile = vi.fn();
const mockDownloadObject = vi.fn();
const mockIsStorageConfigured = vi.fn().mockReturnValue({ configured: true, provider: "replit" });
vi.mock("../lib/objectStorage.js", () => {
  class ObjectNotFoundError extends Error {
    constructor() { super("Object not found"); this.name = "ObjectNotFoundError"; }
  }
  return {
    ObjectNotFoundError,
    isStorageConfigured: () => mockIsStorageConfigured(),
    ObjectStorageService: class {
      getObjectEntityFile(...args: unknown[]) { return mockGetObjectEntityFile(...args); }
      downloadObject(...args: unknown[]) { return mockDownloadObject(...args); }
    },
  };
});

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: (perm: string) => (req: Request, res: Response, next: NextFunction) => {
      const u = req.currentUser;
      if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
      const perms = original.permissionsFor(u as import("../middlewares/currentUser.js").CurrentUser);
      if (!original.hasPerm(perms, perm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      next();
    },
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM", email: "pm@cafa.org", role: "program_manager",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};
const SUPER_ADMIN_USER = {
  id: 2, name: "SA", email: "sa@cafa.org", role: "super_admin",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};
const TC_HEALTH = {
  id: 3, name: "TC Health", email: "tc.h@cafa.org", role: "technical_coordinator",
  stateId: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};
const TC_EDUCATION = {
  id: 4, name: "TC Edu", email: "tc.edu@cafa.org", role: "technical_coordinator",
  stateId: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
};
const SPO_STATE_7 = {
  id: 5, name: "SPO", email: "spo@cafa.org", role: "state_program_officer",
  stateId: 7, sector: null, sectors: null, avatarUrl: null,
};

const HEALTH_PROJECT = { rows: [{ sector: "Health", sectors: ["Health"] }] };
const HEALTH_EDU_PROJECT = { rows: [{ sector: "Health", sectors: ["Health", "Education"] }] };

const DOC_ROWS_INTERNAL = {
  rows: [{
    id: 11, projectId: 1, category: "agreement", kind: "signed_agreement",
    fileName: "agreement.pdf", contentType: "application/pdf", size: 2048,
    objectPath: "/objects/uploads/secret-key-123", driveFileId: 55,
    uploadedByName: "PM", uploadedAt: "2026-08-01T00:00:00.000Z",
  }],
};

const DOWNLOAD_DOC_LEGACY = {
  rows: [{
    id: 11, fileName: "agreement.pdf", contentType: "application/pdf",
    objectPath: "/objects/uploads/secret-key-123", driveFileId: null,
  }],
};

const ALLOW_LIST = [
  "id", "projectId", "category", "kind", "fileName",
  "contentType", "size", "uploadedByName", "uploadedAt", "availabilityStatus",
].sort();

const FORBIDDEN_KEYS = ["objectPath", "object_path", "storageKey", "bucket", "key", "driveFileId", "drive_file_id"];

async function buildApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user) (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use("/api", projectsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
      return;
    }
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

function makeStorageResponseOk() {
  return new Response("PDFBYTES", {
    headers: { "Content-Type": "application/pdf", "Content-Length": "8" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockIsStorageConfigured.mockReturnValue({ configured: true, provider: "replit" });
  mockS3IsConfigured.mockReturnValue(false);
});

// ─── PRJ-DOC-SEC — Internal field leakage & guard ordering ───────────────────

describe("PRJ-DOC-SEC — document API leaks no internal storage fields", () => {
  it("PRJ-DOC-SEC-01: GET documents response contains no objectPath key", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)     // effective sectors
      .mockResolvedValueOnce(DOC_ROWS_INTERNAL); // getDocuments
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(Object.keys(res.body[0])).not.toContain("objectPath");
    expect(JSON.stringify(res.body)).not.toContain("objectPath");
  });

  it("PRJ-DOC-SEC-02: GET documents response contains no raw provider keys", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(DOC_ROWS_INTERNAL);
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents");
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body[0]);
    for (const bad of FORBIDDEN_KEYS) {
      expect(keys).not.toContain(bad);
    }
    expect(JSON.stringify(res.body)).not.toContain("secret-key-123");
  });

  it("PRJ-DOC-SEC-03: download requires authentication (unauthenticated → 401)", async () => {
    const app = await buildApp(null);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(401);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("PRJ-DOC-SEC-04: cross-State actor denied before any storage access", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)   // effective sectors
      .mockResolvedValueOnce({ rows: [] });    // assertStateAllowed → no match
    const app = await buildApp(SPO_STATE_7);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(403);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDownloadObject).not.toHaveBeenCalled();
    expect(mockDownloadFileStream).not.toHaveBeenCalled();
  });

  it("PRJ-DOC-SEC-05: cross-sector TC denied before storage access", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT); // Health only; TC Education outside
    const app = await buildApp(TC_EDUCATION);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDownloadObject).not.toHaveBeenCalled();
    expect(mockDownloadFileStream).not.toHaveBeenCalled();
  });

  it("PRJ-DOC-SEC-06: authorised TC secondary-sector access succeeds (Task #456 regression)", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_EDU_PROJECT)  // Education is a secondary sector
      .mockResolvedValueOnce(DOWNLOAD_DOC_LEGACY);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(TC_EDUCATION);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(200);
    expect(mockDownloadObject).toHaveBeenCalledTimes(1);
  });

  it("PRJ-DOC-SEC-07: PM Full Access download succeeds without internal path in body or Location", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(DOWNLOAD_DOC_LEGACY);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(200);
    expect(res.headers["location"]).toBeUndefined();
    expect(res.text ?? "").not.toContain("secret-key-123");
  });

  it("PRJ-DOC-SEC-08: Super Admin download succeeds without internal path leakage", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(DOWNLOAD_DOC_LEGACY);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(SUPER_ADMIN_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(200);
    expect(res.headers["location"]).toBeUndefined();
    expect(res.text ?? "").not.toContain("secret-key-123");
  });
});

// ─── PRJ-DOC-DL — Download streaming behaviour ───────────────────────────────

describe("PRJ-DOC-DL — legacy download proxies instead of redirecting", () => {
  it("PRJ-DOC-DL-01: authorised legacy download succeeds with binary body", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(DOWNLOAD_DOC_LEGACY);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("PRJ-DOC-DL-02: response is streamed — no Location header to /storage/objects/", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(DOWNLOAD_DOC_LEGACY);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect([301, 302, 303, 307, 308]).not.toContain(res.status);
    expect(res.headers["location"]).toBeUndefined();
  });

  it("PRJ-DOC-DL-03: no stable internal object path in Location header or body", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(DOWNLOAD_DOC_LEGACY);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.headers["location"] ?? "").not.toContain("/storage/objects/");
    expect(res.headers["location"] ?? "").not.toContain("secret-key-123");
    expect(res.text ?? "").not.toContain("/storage/objects/");
  });

  it("PRJ-DOC-DL-04: Content-Disposition supplies a safe filename", async () => {
    const evilDoc = {
      rows: [{
        id: 11, fileName: 'evil"\r\nX-Injected: 1.pdf', contentType: "application/pdf",
        objectPath: "/objects/uploads/secret-key-123", driveFileId: null,
      }],
    };
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce(evilDoc);
    mockGetObjectEntityFile.mockResolvedValue({ _p: "gcs" });
    mockDownloadObject.mockResolvedValue(makeStorageResponseOk());
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(200);
    const cd = res.headers["content-disposition"] ?? "";
    expect(cd).toContain("attachment");
    expect(cd).not.toContain("\r");
    expect(cd).not.toContain("\n");
    expect(res.headers["x-injected"]).toBeUndefined();
  });

  it("PRJ-DOC-DL-05: missing document → 404, no storage call", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce({ rows: [] }); // document not found
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/999/download");
    expect(res.status).toBe(404);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDownloadObject).not.toHaveBeenCalled();
  });

  it("PRJ-DOC-DL-06: document ID substitution across projects → 404 (project-scoped SQL)", async () => {
    // The SELECT is WHERE id = $1 AND project_id = $2 — a doc belonging to
    // another project returns no rows. Assert both the query shape and the 404.
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce({ rows: [] }); // doc 11 belongs to project 2, queried under project 1
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents/11/download");
    expect(res.status).toBe(404);
    const docQueryCall = mockQuery.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("FROM project_documents WHERE id = $1 AND project_id = $2"),
    );
    expect(docQueryCall).toBeDefined();
    expect(docQueryCall![1]).toEqual([11, 1]);
    expect(mockDownloadObject).not.toHaveBeenCalled();
  });
});

// ─── PRJ-DOC-SEC-09 — Project-detail nested documents are sanitised ─────────

describe("PRJ-DOC-SEC-09 — GET /projects/:id nested documents use the allow-list", () => {
  it("project.documents contains no internal storage fields", async () => {
    // GET /projects/:id issues many parallel queries; default them to empty
    // and target only the two that matter: project row + documents.
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM project_documents pd")) {
        return DOC_ROWS_INTERNAL;
      }
      if (typeof sql === "string" && sql.includes("SELECT sector, COALESCE(sectors")) {
        return HEALTH_PROJECT;
      }
      if (typeof sql === "string" && sql.includes("FROM projects") && sql.includes("WHERE") && sql.includes("p.id = $1")) {
        return { rows: [{ id: 1, sector: "Health", sectors: ["Health"], title: "P", status: "active", beneficiariesTarget: 0, budgetTotal: 0 }] };
      }
      if (typeof sql === "string" && sql.includes("COALESCE(SUM(budget_spent)")) {
        return { rows: [{ spent: 0 }] };
      }
      if (typeof sql === "string" && sql.includes("FROM beneficiaries")) {
        return { rows: [{ reached: 0 }] };
      }
      return { rows: [] };
    });
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(200);
    const docs = res.body.project?.documents ?? res.body.documents ?? [];
    expect(docs.length).toBe(1);
    expect(Object.keys(docs[0]).sort()).toEqual(ALLOW_LIST);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("objectPath");
    expect(serialized).not.toContain("driveFileId");
    expect(serialized).not.toContain("secret-key-123");
  });
});

// ─── PRJ-DOC-DTO — Allow-list sentinel ───────────────────────────────────────

describe("PRJ-DOC-DTO — public document DTO strict allow-list", () => {
  it("PRJ-DOC-DTO-01: GET response keys strictly equal the allow-list (no unknown keys)", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)
      .mockResolvedValueOnce({
        rows: [{
          ...DOC_ROWS_INTERNAL.rows[0],
          surpriseInternalField: "leak-me",
          bucket: "internal-bucket",
        }],
      });
    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/1/documents");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(ALLOW_LIST);
  });

  it("PRJ-DOC-DTO-01b: POST upload response keys strictly equal the allow-list", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT); // effective sectors
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                        // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "draft" }] })     // SELECT FOR UPDATE
      .mockResolvedValueOnce({
        rows: [{
          id: 99, projectId: 1, category: "optional", kind: "other",
          fileName: "test.pdf", contentType: "application/pdf", size: 1024,
          objectPath: "uploads/test.pdf", driveFileId: null,
          uploadedAt: "2026-08-01T00:00:00.000Z",
        }],
      })                                                          // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] });                        // COMMIT
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/1/documents")
      .send({
        category: "optional", kind: "other", fileName: "test.pdf",
        contentType: "application/pdf", size: 1024, objectPath: "uploads/test.pdf",
      });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(ALLOW_LIST);
    expect(JSON.stringify(res.body)).not.toContain("objectPath");
  });
});
