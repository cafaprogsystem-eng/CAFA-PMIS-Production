/**
 * PRJ-BD-04 — Project Document Post-Approval Lifecycle Gates (Task #472)
 *
 * Verifies status-based lifecycle gates on document upload and delete endpoints.
 * Does NOT touch Plans, Reports, activity spend (#455), or multi-sector scope (#456).
 *
 * Test IDs:
 *   PRJ-DOC-LIFE-01..14        Lifecycle gate scenarios
 *   PRJ-DOC-AUDIT-01..05       Audit log correctness (transactional)
 *   PRJ-DOC-CONCURRENT-01..02  Concurrency: FOR UPDATE prevents race; double-delete → no ghost audit
 *   PRJ-DOC-SCOPE-01..04       Regression: existing scope guards still intact
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { ZodError } from "zod";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

// Transaction client mock — used when pool.connect() is called
const mockClientQuery = vi.fn();
mockClientQuery.mockResolvedValue({ rows: [] });
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn().mockResolvedValue(mockClient);

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: mockConnectFn,
  },
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

vi.mock("../lib/awsS3.js", () => ({
  archiveFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  isConfigured: vi.fn().mockReturnValue(false),
}));

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

// ─── User fixtures ─────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM", email: "pm@cafa.org", role: "program_manager",
  stateId: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const SUPER_ADMIN_USER = {
  id: 2, name: "SA", email: "sa@cafa.org", role: "super_admin",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

const TC_USER = {
  id: 3, name: "TC", email: "tc@cafa.org", role: "technical_coordinator",
  stateId: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const SPC_USER = {
  id: 4, name: "SPC", email: "spc@cafa.org", role: "senior_program_coordinator",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

const SPO_USER = {
  id: 5, name: "SPO", email: "spo@cafa.org", role: "state_program_officer",
  stateId: 7, sector: null, sectors: null, avatarUrl: null,
};

const TC_EDUCATION = {
  id: 6, name: "TC Edu", email: "tc.edu@cafa.org", role: "technical_coordinator",
  stateId: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
};

// ─── App factory ──────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
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

// ─── Query mock fixtures ───────────────────────────────────────────────────────

/** getProjectEffectiveSectors — Health primary sector */
const HEALTH_PROJECT = { rows: [{ sector: "Health", sectors: ["Health"] }] };
/** getProjectEffectiveSectors — Health primary, Education secondary */
const EDUCATION_SECONDARY = { rows: [{ sector: "Health", sectors: ["Health", "Education"] }] };

/** State guard: SPO in state 7 matched for project */
const STATE_MATCH = { rows: [{ "?column?": 1 }] };
/** State guard: no state match */
const STATE_NO_MATCH = { rows: [] };

/** Successful INSERT result for upload */
const UPLOAD_SUCCESS = {
  rows: [{
    id: 99, projectId: 1, category: "optional", kind: "other",
    fileName: "test.pdf", contentType: "application/pdf",
    size: 1024, objectPath: "uploads/test.pdf", driveFileId: null,
    uploadedAt: new Date().toISOString(),
  }],
};

/**
 * Document row returned by DELETE … RETURNING (new atomic pattern).
 * NOTE: pool.query no longer fetches metadata separately — it is now captured
 *       inside the transaction via DELETE … RETURNING.
 */
const DELETED_DOC_ROW = {
  file_name: "test.pdf", kind: "other", category: "optional", drive_file_id: null,
};

/** Valid upload body */
const UPLOAD_BODY = {
  category: "optional",
  kind: "other",
  fileName: "test.pdf",
  contentType: "application/pdf",
  size: 1024,
  objectPath: "uploads/test.pdf",
};

// ─── Transaction mock helpers ─────────────────────────────────────────────────
// The DELETE handler is now fully atomic:
//   BEGIN → SELECT status … FOR UPDATE → [gate check] → DELETE … RETURNING → INSERT audit → COMMIT
// Gate failures:
//   BEGIN → SELECT status … FOR UPDATE → ROLLBACK

/**
 * Set up mockClientQuery for a successful DELETE transaction.
 * status: the project status the FOR UPDATE lock will reveal.
 */
function setupDeleteTxSuccess(status: string) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })                      // BEGIN
    .mockResolvedValueOnce({ rows: [{ status }] })            // SELECT status FOR UPDATE
    .mockResolvedValueOnce({ rows: [DELETED_DOC_ROW] })       // DELETE … RETURNING
    .mockResolvedValueOnce({ rows: [] });                     // COMMIT (audit write goes through the mocked logAudit(), not a raw query)
}

/**
 * Set up mockClientQuery for a gate-blocked DELETE (gate check fails inside TX).
 * BEGIN → SELECT FOR UPDATE → ROLLBACK.
 */
function setupDeleteTxGateBlock(status: string) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })           // BEGIN
    .mockResolvedValueOnce({ rows: [{ status }] }) // SELECT status FOR UPDATE
    .mockResolvedValueOnce({ rows: [] });           // ROLLBACK
}

/**
 * Set up mockClientQuery for a successful UPLOAD transaction.
 * BEGIN → SELECT status FOR UPDATE → INSERT project_documents RETURNING → COMMIT.
 */
function setupUploadTxSuccess(status: string) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })           // BEGIN
    .mockResolvedValueOnce({ rows: [{ status }] }) // SELECT status FOR UPDATE
    .mockResolvedValueOnce(UPLOAD_SUCCESS)          // INSERT project_documents RETURNING
    .mockResolvedValueOnce({ rows: [] });           // COMMIT
}

/**
 * Set up mockClientQuery for a gate-blocked UPLOAD.
 * BEGIN → SELECT status FOR UPDATE → ROLLBACK (frozen project).
 */
function setupUploadTxGateBlock(status: string) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })           // BEGIN
    .mockResolvedValueOnce({ rows: [{ status }] }) // SELECT status FOR UPDATE
    .mockResolvedValueOnce({ rows: [] });           // ROLLBACK
}

/**
 * Set up mockClientQuery for a successful override DELETE.
 * Same sequence as setupDeleteTxSuccess — reason is validated inline before DELETE.
 */
function setupDeleteTxOverrideSuccess(status: string) {
  setupDeleteTxSuccess(status);
}

/**
 * Return the mocked logAudit() call (opts, client), if the route wrote an audit entry.
 * Imported dynamically — not statically — because this file's
 * `vi.mock("../middlewares/currentUser.js", ...)` factory closes over
 * `mockQuery`/`mockClientQuery` declared further down this file; a static
 * import would hoist above those consts and throw a TDZ ReferenceError.
 */
async function findAuditInsert() {
  const { logAudit } = await import("../middlewares/currentUser.js");
  return vi.mocked(logAudit).mock.calls[0];
}

/** Return whether DELETE FROM project_documents appeared in the TX client calls. */
function wasDeleteExecutedInTx(): boolean {
  return mockClientQuery.mock.calls.some(
    (args) => typeof args[0] === "string" && args[0].includes("DELETE FROM project_documents"),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
});

// ─── PRJ-DOC-LIFE — Lifecycle gate tests ─────────────────────────────────────

describe("PRJ-DOC-LIFE — Document lifecycle gates", () => {
  // ── Upload (POST) ────────────────────────────────────────────────────────────
  // Upload gate check still uses pool.query (getProjectDocGate) — no TX needed for upload.

  it("PRJ-DOC-LIFE-01: Draft project upload succeeds when authorised", async () => {
    // Upload gate check is now inside the TX (SELECT FOR UPDATE + INSERT atomic)
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT); // getProjectEffectiveSectors
    setupUploadTxSuccess("draft");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/1/documents")
      .send(UPLOAD_BODY);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(99);
    expect(mockConnectFn).toHaveBeenCalledTimes(1);
  });

  it("PRJ-DOC-LIFE-03: Approved project new upload succeeds", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupUploadTxSuccess("approved");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/1/documents")
      .send(UPLOAD_BODY);

    expect(res.status).toBe(201);
  });

  it("PRJ-DOC-LIFE-09: Closed project upload → 409 project_documents_frozen", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupUploadTxGateBlock("closed");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/1/documents")
      .send(UPLOAD_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
  });

  it("PRJ-DOC-LIFE-09b: Completed project upload → 409 project_documents_frozen", async () => {
    // 'completed' is frozen — same as 'closed', per server classification
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupUploadTxGateBlock("completed");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/1/documents")
      .send(UPLOAD_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
  });

  // ── Delete (DELETE) — gate check now happens INSIDE the transaction ───────────
  // All DELETE calls open a transaction (pool.connect → BEGIN → SELECT FOR UPDATE).
  // Gate failures result in ROLLBACK; success results in COMMIT.

  it("PRJ-DOC-LIFE-02: Draft project delete succeeds when authorised", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT); // getProjectEffectiveSectors
    setupDeleteTxSuccess("draft");

    const app = await buildApp(PM_USER);
    const res = await request(app).delete("/api/projects/1/documents/42");

    expect(res.status).toBe(204);
    expect(mockConnectFn).toHaveBeenCalledTimes(1);
    expect(wasDeleteExecutedInTx()).toBe(true);
  });

  it("PRJ-DOC-LIFE-04: Approved project normal delete → 409 project_document_locked_after_approval", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved");

    const app = await buildApp(TC_USER);
    const res = await request(app).delete("/api/projects/1/documents/42");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_document_locked_after_approval");
    // TX opened, gate blocked inside TX — no DELETE executed
    expect(mockConnectFn).toHaveBeenCalledTimes(1);
    expect(wasDeleteExecutedInTx()).toBe(false);
  });

  it("PRJ-DOC-LIFE-05: Approved project PM delete without overrideReason → 400 override_reason_required", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved"); // reason missing → ROLLBACK after SELECT FOR UPDATE

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");
    expect(wasDeleteExecutedInTx()).toBe(false);
  });

  it("PRJ-DOC-LIFE-06: Approved project PM delete with valid override → 204", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxOverrideSuccess("approved");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Superseded by updated agreement" });

    expect(res.status).toBe(204);
    expect(wasDeleteExecutedInTx()).toBe(true);
  });

  it("PRJ-DOC-LIFE-07: Approved project Super Admin override succeeds", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxOverrideSuccess("approved");

    const app = await buildApp(SUPER_ADMIN_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Admin correction required" });

    expect(res.status).toBe(204);
  });

  it("PRJ-DOC-LIFE-08: TC cannot use override even with document permissions → 409", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved");

    const app = await buildApp(TC_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "I want to delete this" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_document_locked_after_approval");
    expect(wasDeleteExecutedInTx()).toBe(false);
  });

  it("PRJ-DOC-LIFE-10: Closed project delete → 409 project_documents_frozen", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("closed");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Trying to bypass freeze" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
    expect(wasDeleteExecutedInTx()).toBe(false);
  });

  it("PRJ-DOC-LIFE-10b: Completed project delete → 409 project_documents_frozen", async () => {
    // 'completed' is frozen — same gate as 'closed', per server classification
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("completed");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Trying to delete from completed project" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
    expect(wasDeleteExecutedInTx()).toBe(false);
  });

  it("PRJ-DOC-LIFE-11: Closed project PM override attempt → 409 project_documents_frozen (no bypass)", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("closed");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Emergency override attempt" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
    expect(await findAuditInsert()).toBeUndefined();
  });

  it("PRJ-DOC-LIFE-12: Active project behaves same as approved (operational) for non-override actor", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("active");

    const app = await buildApp(TC_USER);
    const res = await request(app).delete("/api/projects/1/documents/42");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_document_locked_after_approval");
  });

  it("PRJ-DOC-LIFE-13: Active project SPC delete → 409", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("active");

    const app = await buildApp(SPC_USER);
    const res = await request(app).delete("/api/projects/1/documents/42");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_document_locked_after_approval");
  });

  it("PRJ-DOC-LIFE-14: Whitespace-only overrideReason → 400 override_reason_required", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved"); // blank reason → ROLLBACK

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");
    expect(wasDeleteExecutedInTx()).toBe(false);
  });
});

// ─── PRJ-DOC-AUDIT — Audit log correctness ───────────────────────────────────

describe("PRJ-DOC-AUDIT — Transactional audit on delete", () => {
  it("PRJ-DOC-AUDIT-01: Successful override → audit row uses document_delete_override action", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxOverrideSuccess("approved");

    const app = await buildApp(PM_USER);
    await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Correcting document error" });

    const auditInsert = await findAuditInsert();
    expect(auditInsert).toBeDefined();
    expect(auditInsert![0].action).toBe("document_delete_override");
  });

  it("PRJ-DOC-AUDIT-02: Audit row contains actor, reason, projectId, document label", async () => {
    const overrideReason = "Budget revision supersedes this document";
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxOverrideSuccess("approved");

    const app = await buildApp(PM_USER);
    await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason });

    const auditInsert = await findAuditInsert();
    expect(auditInsert).toBeDefined();
    const opts = auditInsert![0];
    expect(opts.userId).toBe(PM_USER.id);
    expect(opts.action).toBe("document_delete_override");
    expect(opts.module).toBe("projects");
    expect(opts.entityId).toBe(1);                          // entity_id = projectId
    expect(String(opts.oldValue)).toContain("test.pdf");     // old_value = doc label with filename
    expect(opts.newValue).toBe(overrideReason);
    expect(opts.usedOverride).toBe(true);
    expect(opts.overrideReason).toBe(overrideReason);
  });

  it("PRJ-DOC-AUDIT-02b: Normal (mutable) delete uses document_delete and document label as old_value", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxSuccess("draft");

    const app = await buildApp(PM_USER);
    await request(app).delete("/api/projects/1/documents/42");

    const auditInsert = await findAuditInsert();
    expect(auditInsert).toBeDefined();
    const opts = auditInsert![0];
    expect(opts.action).toBe("document_delete");
    expect(String(opts.oldValue)).toContain("test.pdf"); // preserves filename in audit
    expect(opts.usedOverride).toBe(false);
    expect(opts.overrideReason).toBeNull();
  });

  it("PRJ-DOC-AUDIT-03: Failed override (400 — no reason) → no audit INSERT written", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved"); // reason empty → ROLLBACK

    const app = await buildApp(PM_USER);
    await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "" });

    // TX opened but rolled back before audit INSERT
    expect(await findAuditInsert()).toBeUndefined();
  });

  it("PRJ-DOC-AUDIT-03b: Failed override (409 — non-override actor) → no audit INSERT written", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved");

    const app = await buildApp(TC_USER);
    await request(app).delete("/api/projects/1/documents/42");

    expect(await findAuditInsert()).toBeUndefined();
  });

  it("PRJ-DOC-AUDIT-04: Failed status-gated delete → DELETE FROM project_documents NOT executed", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxGateBlock("approved");

    const app = await buildApp(TC_USER);
    await request(app).delete("/api/projects/1/documents/42");

    expect(wasDeleteExecutedInTx()).toBe(false);
  });

  it("PRJ-DOC-AUDIT-05: Transaction is atomic — BEGIN and COMMIT both called on success", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxSuccess("draft");

    const app = await buildApp(PM_USER);
    await request(app).delete("/api/projects/1/documents/42");

    const sqlCalls = mockClientQuery.mock.calls.map((args) => String(args[0]));
    expect(sqlCalls[0]).toBe("BEGIN");
    expect(sqlCalls[sqlCalls.length - 1]).toBe("COMMIT");
  });
});

// ─── PRJ-DOC-CONCURRENT — Race condition prevention ──────────────────────────

describe("PRJ-DOC-CONCURRENT — Concurrency safety", () => {
  it("PRJ-DOC-CONCURRENT-01: Status changed to approved concurrently — TX FOR UPDATE reveals new status → 409", async () => {
    // A TC user attempts to delete; the project was mutable when they started
    // but a concurrent approval transition committed before their TX SELECT FOR UPDATE.
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    // FOR UPDATE reveals the project is now approved → gate fires → ROLLBACK
    setupDeleteTxGateBlock("approved");

    const app = await buildApp(TC_USER);
    const res = await request(app).delete("/api/projects/1/documents/42");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_document_locked_after_approval");
    // DELETE was not executed — the row is safe
    expect(wasDeleteExecutedInTx()).toBe(false);
    // ROLLBACK was issued
    const sqlCalls = mockClientQuery.mock.calls.map((a) => String(a[0]));
    expect(sqlCalls).toContain("ROLLBACK");
  });

  it("PRJ-DOC-CONCURRENT-03: Project freezes concurrently during upload — FOR UPDATE reveals closed → 409, no INSERT", async () => {
    // A user begins an upload while the project is still mutable; a concurrent
    // admin closes the project before the upload TX acquires the lock. FOR UPDATE
    // ensures the INSERT never lands on the now-frozen project.
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    // FOR UPDATE reveals the project is now closed → gate fires → ROLLBACK
    setupUploadTxGateBlock("closed");

    const app = await buildApp(TC_USER);
    const res = await request(app)
      .post("/api/projects/1/documents")
      .send(UPLOAD_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
    // INSERT was not executed — no phantom document
    const insertExecuted = mockClientQuery.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0].includes("INSERT INTO project_documents"),
    );
    expect(insertExecuted).toBe(false);
    // ROLLBACK was issued
    const sqlCalls = mockClientQuery.mock.calls.map((a) => String(a[0]));
    expect(sqlCalls).toContain("ROLLBACK");
  });

  it("PRJ-DOC-CONCURRENT-02: Concurrent double-delete — RETURNING 0 rows → 404, no orphan audit row", async () => {
    // Two concurrent deletes of the same document; the second one finds nothing to delete.
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                   // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "draft" }] }) // SELECT status FOR UPDATE
      .mockResolvedValueOnce({ rows: [] })                   // DELETE RETURNING → 0 rows (already gone)
      .mockResolvedValueOnce({ rows: [] });                  // ROLLBACK

    const app = await buildApp(PM_USER);
    const res = await request(app).delete("/api/projects/1/documents/42");

    expect(res.status).toBe(404);
    // No audit INSERT — the document was not actually deleted in this TX
    expect(await findAuditInsert()).toBeUndefined();
    // ROLLBACK was issued to close the TX cleanly
    const sqlCalls = mockClientQuery.mock.calls.map((a) => String(a[0]));
    expect(sqlCalls).toContain("ROLLBACK");
  });
});

// ─── PRJ-DOC-SCOPE — Regression: existing scope guards intact ─────────────────

describe("PRJ-DOC-SCOPE — Scope guard regression", () => {
  it("PRJ-DOC-SCOPE-01: TC secondary-sector document access still works (#456)", async () => {
    mockQuery
      .mockResolvedValueOnce(EDUCATION_SECONDARY) // getProjectEffectiveSectors
      .mockResolvedValueOnce({ rows: [] });        // GET documents query

    const app = await buildApp(TC_EDUCATION);
    const res = await request(app).get("/api/projects/1/documents");

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("sector_forbidden");
  });

  it("PRJ-DOC-SCOPE-02: TC unrelated sector denied", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);

    const app = await buildApp(TC_EDUCATION);
    const res = await request(app).get("/api/projects/1/documents");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-DOC-SCOPE-03: State scope remains enforced for SPO out-of-state", async () => {
    mockQuery
      .mockResolvedValueOnce(HEALTH_PROJECT)  // getProjectEffectiveSectors
      .mockResolvedValueOnce(STATE_NO_MATCH); // assertStateAllowed

    const app = await buildApp(SPO_USER);
    const res = await request(app).get("/api/projects/1/documents");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_forbidden");
  });

  it("PRJ-DOC-SCOPE-04: PM Full Access preserved subject to lifecycle gates — override delete succeeds", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxOverrideSuccess("approved");

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/42")
      .send({ overrideReason: "Full operational access override" });

    expect(res.status).toBe(204);
  });
});

// ─── Pre-approval regression ──────────────────────────────────────────────────

describe("Pre-approval status regression", () => {
  const PRE_APPROVAL_STATUSES = [
    "submitted",
    "state_reviewed",
    "technically_approved",
    "coordination_approved",
    "rejected",
  ] as const;

  for (const status of PRE_APPROVAL_STATUSES) {
    it(`Status '${status}' → mutable: delete succeeds without override`, async () => {
      mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
      setupDeleteTxSuccess(status);

      const app = await buildApp(PM_USER);
      const res = await request(app).delete("/api/projects/1/documents/42");

      expect(res.status).toBe(204);
    });
  }

  it("Mutable delete uses document_delete action (not override) in audit", async () => {
    mockQuery.mockResolvedValueOnce(HEALTH_PROJECT);
    setupDeleteTxSuccess("draft");

    const app = await buildApp(PM_USER);
    await request(app).delete("/api/projects/1/documents/42");

    const auditInsert = await findAuditInsert();
    expect(auditInsert).toBeDefined();
    const opts = auditInsert![0];
    expect(opts.action).toBe("document_delete");
    expect(opts.usedOverride).toBe(false); // usedOverride = false
    expect(opts.overrideReason).toBeNull();  // overrideReason = null
  });
});
