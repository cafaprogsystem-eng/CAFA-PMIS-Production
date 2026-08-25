/**
 * RISK-005 — Project Permanent Delete: Risk referential & storage cleanup
 * (Task: null plan_activities.risk_id, purge risk comments and canonical
 * attachment metadata, then run post-commit best-effort object cleanup.)
 *
 * RISK-DEL-01 … RISK-DEL-15. Behavioural tests exercise the real
 * DELETE /projects/:projectId handler with a mocked pg pool; structural
 * sentinels pin source-level invariants. British English throughout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const { mockQuery, mockClientQuery, mockConnectFn, mockDeleteStorageObjectSafely } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockConnectFn: vi.fn(),
  mockDeleteStorageObjectSafely: vi.fn(),
}));
const mockClient = { query: mockClientQuery, release: vi.fn() };

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery, connect: mockConnectFn },
}));

vi.mock("../../lib/realtime", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));

vi.mock("../../lib/notifications", () => ({
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
  notifyByRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/objectStorage")>();
  return {
    ...original,
    deleteStorageObjectSafely: (...args: unknown[]) => mockDeleteStorageObjectSafely(...args),
  };
});

let denyPerm: string | null = null;
vi.mock("../../middlewares/currentUser", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../middlewares/currentUser")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: (perm: string) => (_req: Request, res: Response, next: NextFunction) => {
      if (denyPerm && perm === denyPerm) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      next();
    },
    permissionsFor: vi.fn().mockReturnValue(["*"]),
    hasPerm: vi.fn().mockReturnValue(true),
  };
});

import projectsRouter from "../projects";
import risksRouter from "../risks";
import type { CurrentUser } from "../../middlewares/currentUser";

const ROOT = join(__dirname, "..", "..", "..");
const projectsSource = readFileSync(join(ROOT, "src/routes/projects.ts"), "utf8");
const risksSource = readFileSync(join(ROOT, "src/routes/risks.ts"), "utf8");
const schemaSource = readFileSync(join(ROOT, "..", "..", "lib/db/src/schema/index.ts"), "utf8");
const commentsSource = readFileSync(join(ROOT, "src/routes/comments.ts"), "utf8");
const attachmentsSource = readFileSync(join(ROOT, "src/routes/attachments.ts"), "utf8");
const plansSource = readFileSync(join(ROOT, "src/routes/plans.ts"), "utf8");

const PM_USER: CurrentUser = {
  id: 1, name: "PM User", email: "pm@cafa.org", role: "program_manager",
  roleLabel: "Programme Manager", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

function appAs(u: CurrentUser | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (u) req.currentUser = u;
    next();
  });
  app.use(projectsRouter);
  app.use(risksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  return request(app);
}

// ─── Scenario fixture ─────────────────────────────────────────────────────────
// Drives the permanent-delete transaction: draft project, no approvals history,
// no protected records, two linked risks (7, 8) with canonical attachments.

interface Scenario {
  riskRows?: Array<{ id: number }>;
  attachmentRows?: Array<{ object_path: string }>;
  pendingAttachmentRows?: Array<{ object_path: string; final_object_path: string | null }>;
  failOn?: RegExp; // reject the matching client query (simulates mid-tx failure)
}

function installScenario(sc: Scenario = {}) {
  const riskRows = sc.riskRows ?? [{ id: 7 }, { id: 8 }];
  const attachmentRows = sc.attachmentRows ?? [
    { object_path: "/objects/files/risk-a" },
    { object_path: "/objects/files/risk-b" },
  ];
  const pendingAttachmentRows = sc.pendingAttachmentRows ?? [
    { object_path: "/objects/uploads/risk-op-a", final_object_path: "/objects/files/risk-op-a" },
  ];
  const executed: string[] = [];
  mockClientQuery.mockImplementation((sql: string) => {
    executed.push(sql);
    if (sc.failOn && sc.failOn.test(sql)) return Promise.reject(new Error("tx_failure"));
    if (sql.includes("FROM projects WHERE id = $1 FOR UPDATE")) {
      return Promise.resolve({
        rows: [{ id: 42, code: "CAFA-P-001", title: "T", status: "draft", sectors: [], sector: "Health", deleted_at: null }],
      });
    }
    if (sql.includes("FROM approvals")) return Promise.resolve({ rows: [] });
    if (sql.includes("COUNT(*)::int AS cnt")) return Promise.resolve({ rows: [{ cnt: 0 }] });
    if (sql.includes("DELETE FROM risks WHERE project_id = $1 RETURNING id")) return Promise.resolve({ rows: riskRows });
    if (sql.includes("DELETE FROM attachments")) return Promise.resolve({ rows: attachmentRows });
    if (sql.includes("DELETE FROM attachment_upload_operations")) return Promise.resolve({ rows: pendingAttachmentRows });
    return Promise.resolve({ rows: [] });
  });
  return executed;
}

beforeEach(() => {
  vi.clearAllMocks();
  denyPerm = null;
  mockQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockDeleteStorageObjectSafely.mockResolvedValue({ deleted: true });
});

const DEL_BODY = { reason: "Registered in error — duplicate record." };

describe("RISK-DEL-01 — permanent delete removes linked risk rows", () => {
  it("issues DELETE FROM risks scoped to the project within the transaction", async () => {
    const executed = installScenario();
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(200);
    expect(res.body.deletionMode).toBe("permanent");
    expect(executed.some((s) => s.includes("DELETE FROM risks") && s.includes("project_id = $1"))).toBe(true);
    const commitIdx = executed.findIndex((s) => s === "COMMIT");
    const riskDelIdx = executed.findIndex((s) => s.includes("DELETE FROM risks"));
    expect(riskDelIdx).toBeGreaterThan(-1);
    expect(riskDelIdx).toBeLessThan(commitIdx);
  });
});

describe("RISK-DEL-02 — plan_activities.risk_id nulled after risk IDs are collected", () => {
  it("UPDATE plan_activities … SET risk_id = NULL runs in-transaction using the riskIds returned by the risks delete", async () => {
    const executed = installScenario();
    await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    const nullIdx = executed.findIndex((s) => s.includes("UPDATE plan_activities SET risk_id = NULL"));
    const riskDelIdx = executed.findIndex((s) => s.includes("DELETE FROM risks WHERE project_id = $1 RETURNING id"));
    const commitIdx = executed.findIndex((s) => s === "COMMIT");
    expect(riskDelIdx).toBeGreaterThan(-1);
    expect(nullIdx).toBeGreaterThan(riskDelIdx);
    expect(nullIdx).toBeLessThan(commitIdx);
    const call = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("UPDATE plan_activities SET risk_id = NULL"));
    expect(call![1]).toEqual([[7, 8]]);
  });
});

describe("RISK-DEL-03 — risks of other projects are unaffected", () => {
  it("every risk-related statement is keyed by project_id or the collected riskIds only", async () => {
    installScenario();
    await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    const riskDel = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("DELETE FROM risks"));
    expect(String(riskDel![0])).toContain("WHERE project_id = $1 RETURNING id");
    expect(riskDel![1]).toEqual([42]);
    for (const marker of [
      "UPDATE plan_activities SET risk_id = NULL",
      "entity_type = 'risk'",
      "DELETE FROM attachments",
      "DELETE FROM attachment_upload_operations",
    ]) {
      const call = mockClientQuery.mock.calls.find((c) => String(c[0]).includes(marker));
      expect(call, marker).toBeTruthy();
      expect(call![1]).toEqual([[7, 8]]);
    }
  });
  it("skips all riskId-scoped cleanup when the project has no risks (no unbounded statements)", async () => {
    const executed = installScenario({ riskRows: [] });
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(200);
    expect(executed.some((s) => s.includes("UPDATE plan_activities"))).toBe(false);
    expect(executed.some((s) => s.includes("entity_type = 'risk'"))).toBe(false);
    expect(executed.some((s) => s.includes("DELETE FROM attachments"))).toBe(false);
    expect(executed.some((s) => s.includes("DELETE FROM attachment_upload_operations"))).toBe(false);
  });
});

describe("RISK-DEL-04/05 — plans and plan activities survive as records; only risk_id is nulled", () => {
  it("no DELETE FROM plan_activities is issued anywhere in the cascade", async () => {
    const executed = installScenario();
    await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(executed.some((s) => s.includes("DELETE FROM plan_activities"))).toBe(false);
    const upd = executed.find((s) => s.includes("UPDATE plan_activities"));
    expect(upd).toContain("SET risk_id = NULL");
    expect(upd).not.toMatch(/SET\s+risk_id\s*=\s*NULL\s*,/); // only the one column is touched
  });
  it("plans deletion remains scoped to the deleted project only", async () => {
    installScenario();
    await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    const planDel = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("DELETE FROM plans"));
    expect(String(planDel![0])).toContain("project_id = $1");
    expect(planDel![1]).toEqual([42]);
  });
});

describe("RISK-DEL-06 — canonical attachment metadata is removed in-transaction", () => {
  it("purges finalised and pending canonical identities after risks and before COMMIT", async () => {
    const executed = installScenario();
    await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    const attachmentIdx = executed.findIndex((s) => s.includes("DELETE FROM attachments"));
    const pendingIdx = executed.findIndex((s) => s.includes("DELETE FROM attachment_upload_operations"));
    const riskDelIdx = executed.findIndex((s) => s.includes("DELETE FROM risks WHERE project_id = $1 RETURNING id"));
    const commitIdx = executed.findIndex((s) => s === "COMMIT");
    expect(attachmentIdx).toBeGreaterThan(riskDelIdx);
    expect(pendingIdx).toBeGreaterThan(attachmentIdx);
    expect(pendingIdx).toBeLessThan(commitIdx);
    expect(executed[attachmentIdx]).toContain("parent_type = 'risk' AND parent_id = ANY($1)");
    expect(executed[attachmentIdx]).toContain("RETURNING object_path");
    expect(executed[pendingIdx]).toContain("RETURNING object_path, final_object_path");
    expect(mockClientQuery.mock.calls[attachmentIdx]![1]).toEqual([[7, 8]]);
    expect(mockClientQuery.mock.calls[pendingIdx]![1]).toEqual([[7, 8]]);
  });
});

describe("RISK-DEL-07 — post-commit canonical object cleanup", () => {
  it("cleans finalised and pending object identities only after the transaction succeeds", async () => {
    const executed = installScenario();
    mockDeleteStorageObjectSafely.mockImplementation(async () => {
      expect(executed).toContain("COMMIT");
      return { deleted: true };
    });
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(200);
    expect(mockDeleteStorageObjectSafely).toHaveBeenCalledTimes(4);
    for (const path of [
      "/objects/files/risk-a",
      "/objects/files/risk-b",
      "/objects/uploads/risk-op-a",
      "/objects/files/risk-op-a",
    ]) expect(mockDeleteStorageObjectSafely).toHaveBeenCalledWith(path);
  });
});

describe("RISK-DEL-08 — canonical storage failure is non-fatal", () => {
  it("project deletion still returns 200 when best-effort object cleanup fails", async () => {
    installScenario();
    mockDeleteStorageObjectSafely.mockRejectedValue(new Error("provider unavailable"));
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(200);
    expect(res.body.deletionMode).toBe("permanent");
    expect(mockDeleteStorageObjectSafely).toHaveBeenCalled();
  });
});

describe("RISK-DEL-09 — transaction failure rolls everything back", () => {
  it("a failure mid-cascade triggers ROLLBACK; no COMMIT, no storage cleanup", async () => {
    const executed = installScenario({ failOn: /DELETE FROM comments WHERE entity_type/ });
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(500);
    expect(executed).not.toContain("COMMIT");
    expect(executed).toContain("ROLLBACK");
    expect(mockDeleteStorageObjectSafely).not.toHaveBeenCalled();
  });
});

describe("RISK-DEL-10 — soft delete leaves risks untouched", () => {
  it("soft mode only updates the project row; no risk or canonical attachment cleanup runs", async () => {
    const executed: string[] = [];
    mockClientQuery.mockImplementation((sql: string) => {
      executed.push(sql);
      if (sql.includes("FROM projects WHERE id = $1 FOR UPDATE")) {
        return Promise.resolve({
          rows: [{ id: 42, code: "CAFA-P-001", title: "T", status: "active", sectors: [], sector: "Health", deleted_at: null }],
        });
      }
      if (sql.includes("FROM approvals")) return Promise.resolve({ rows: [{ toStatus: "approved" }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(200);
    expect(res.body.deletionMode).toBe("soft");
    expect(executed.some((s) => s.includes("risks"))).toBe(false);
    expect(executed.some((s) => s.includes("plan_activities"))).toBe(false);
    expect(executed.some((s) => s.includes("DELETE FROM attachments"))).toBe(false);
    expect(executed.some((s) => s.includes("DELETE FROM attachment_upload_operations"))).toBe(false);
    expect(executed.some((s) => s.includes("UPDATE projects") && s.includes("deleted_at"))).toBe(true);
    expect(mockDeleteStorageObjectSafely).not.toHaveBeenCalled();
  });
});

describe("RISK-DEL-11/12 — orphan enumeration closed (structural)", () => {
  it("risk attachments are deleted by canonical parent identity, not retired metadata", () => {
    const del = projectsSource.slice(projectsSource.indexOf('router.delete("/projects/:projectId"'));
    const branch = del.slice(0, del.indexOf("documents/:documentId"));
    expect(branch).toContain("DELETE FROM attachments");
    expect(branch).toContain("DELETE FROM attachment_upload_operations");
    expect(branch).toContain("parent_type = 'risk' AND parent_id = ANY($1)");
    expect(branch).not.toContain("DELETE FROM drive_files");
    expect(branch).not.toContain("module = 'risks'");
  });
  it("risk comments are deleted by entity identity within the same transaction", () => {
    const del = projectsSource.slice(projectsSource.indexOf('router.delete("/projects/:projectId"'));
    const branch = del.slice(0, del.indexOf("documents/:documentId"));
    expect(branch).toContain("DELETE FROM comments WHERE entity_type = 'risk' AND entity_id = ANY($1)");
  });
  it("behavioural: risk comment purge runs before COMMIT with the collected riskIds", async () => {
    const executed = installScenario();
    await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    const idx = executed.findIndex((s) => s.includes("entity_type = 'risk'"));
    const commitIdx = executed.findIndex((s) => s === "COMMIT");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(commitIdx);
  });
});

describe("RISK-DEL-13 — permanent delete remains gated by projects.delete", () => {
  it("403 when the projects.delete permission is denied; no transaction started", async () => {
    installScenario();
    denyPerm = "projects.delete";
    const res = await appAs(PM_USER).delete("/projects/42").send(DEL_BODY);
    expect(res.status).toBe(403);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

describe("RISK-DEL-14 — no DELETE /risks/:id route exists (RISK-BD-05)", () => {
  it("risks router registers no delete route", () => {
    expect(risksSource).not.toMatch(/router\.delete\(\s*["'`]\/risks/);
  });
  it("behavioural: DELETE /risks/7 is not handled", async () => {
    installScenario();
    const res = await appAs(PM_USER).delete("/risks/7").send({});
    expect(res.status).toBe(404);
  });
});

describe("RISK-DEL-15 — cascade order and concurrency invariants (structural sentinels)", () => {
  const del = projectsSource.slice(projectsSource.indexOf('router.delete("/projects/:projectId"'));
  const branch = del.slice(0, del.indexOf("documents/:documentId"));
  it("DELETE risks RETURNING id → canonical attachments → null links → comments, all before COMMIT", () => {
    const order = [
      "DELETE FROM risks WHERE project_id = $1 RETURNING id",
      "DELETE FROM attachments",
      "DELETE FROM attachment_upload_operations",
      "UPDATE plan_activities SET risk_id = NULL",
      "DELETE FROM comments WHERE entity_type = 'risk'",
      "DELETE FROM reports",
      "DELETE FROM plans",
      "DELETE FROM projects WHERE id = $1",
      `"COMMIT"`,
    ];
    let last = -1;
    for (const marker of order) {
      const idx = branch.indexOf(marker);
      expect(idx, marker).toBeGreaterThan(last);
      last = idx;
    }
  });
  it("audit_log rows are still preserved through permanent delete", () => {
    expect(branch).not.toContain("DELETE FROM audit_log");
    expect(branch).toContain("intentionally NOT deleted");
  });
  it("post-commit storage cleanup is outside the transaction and best-effort", () => {
    const commitIdx = branch.indexOf(`"COMMIT"`);
    const cleanupIdx = branch.indexOf("for (const path of canonicalAttachmentPaths)");
    expect(cleanupIdx).toBeGreaterThan(commitIdx);
    expect(branch.slice(cleanupIdx)).toContain("deleteStorageObjectSafely(path).catch");
  });
  it("risk create closes the no-FK concurrency race with an in-transaction FOR UPDATE re-check", () => {
    // risks.project_id has no DB-level FK (schema), so the create path must
    // re-verify the project under FOR UPDATE in the same tx as the INSERT.
    const risksTable = schemaSource.slice(
      schemaSource.indexOf('pgTable("risks"'),
      schemaSource.indexOf("pgTable(", schemaSource.indexOf('pgTable("risks"') + 10),
    );
    expect(risksTable).not.toContain(".references(");
    const create = risksSource.slice(risksSource.indexOf('router.post("/risks"'));
    const createBlock = create.slice(0, create.indexOf("router.", 10));
    expect(createBlock).toContain("AND deleted_at IS NULL FOR UPDATE");
    const forUpdateIdx = createBlock.indexOf("AND deleted_at IS NULL FOR UPDATE");
    const insertIdx = createBlock.indexOf("INSERT INTO risks");
    const beginIdx = createBlock.indexOf(`"BEGIN"`);
    const commitIdx = createBlock.indexOf(`"COMMIT"`);
    expect(beginIdx).toBeLessThan(forUpdateIdx);
    expect(forUpdateIdx).toBeLessThan(insertIdx);
    expect(insertIdx).toBeLessThan(commitIdx);
  });
});

describe("RISK-DEL-16 — writer coordination with the delete cascade (interleaving sentinels)", () => {
  // Concurrency protocol: the cascade deletes risks FIRST (RETURNING id) and
  // purges children AFTER; every writer that creates a risk child row must
  // lock the parent risk (SELECT … FOR UPDATE) in the same transaction as its
  // INSERT. Interleavings are therefore serialised on the risk row lock:
  //   • writer commits first → cascade's DELETE FROM risks blocks on the row
  //     lock; once acquired, the child purge sees the committed row — purged.
  //   • cascade wins → writer's FOR UPDATE blocks, then finds no risk row —
  //     fails closed, nothing orphaned.
  it("risk comment INSERT is guarded by an in-transaction FOR UPDATE lock on the risk row", () => {
    const post = commentsSource.slice(commentsSource.indexOf('router.post("/comments"'));
    const block = post.slice(0, post.indexOf("router.", 10));
    const riskBranch = block.slice(block.indexOf('if (entityType === "risk")'));
    const beginIdx = riskBranch.indexOf('"BEGIN"');
    const lockIdx = riskBranch.indexOf("SELECT 1 FROM risks WHERE id = $1 FOR UPDATE");
    const insertIdx = riskBranch.indexOf("INSERT INTO comments");
    const commitIdx = riskBranch.indexOf('"COMMIT"');
    expect(beginIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(insertIdx).toBeGreaterThan(lockIdx);
    expect(commitIdx).toBeGreaterThan(insertIdx);
    // Fails closed when the risk row is gone after the lock wait.
    expect(riskBranch.slice(lockIdx, insertIdx)).toContain("entity_not_found");
    expect(riskBranch.slice(lockIdx, insertIdx)).toContain("ROLLBACK");
  });
  it("risk attachment descriptor creation locks the canonical parent before it creates the operation", () => {
    const descriptor = attachmentsSource.slice(
      attachmentsSource.indexOf('router.post("/attachments/upload-descriptors"'),
      attachmentsSource.indexOf('router.post("/attachments/operations/:operationId/finalize"'),
    );
    const lockIdx = descriptor.indexOf("assertCanonicalParent(req, parentType, parentId, true, client)");
    const insertIdx = descriptor.indexOf("INSERT INTO attachment_upload_operations");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(lockIdx);
    expect(descriptor.slice(insertIdx)).toContain("deleteStorageObjectSafely(objectPath)");
  });
  it("cascade deletes risks before purging children, so committed writer rows are always visible to the purge", () => {
    const branch = projectsSource.slice(
      projectsSource.indexOf('if (mode === "permanent")'),
      projectsSource.indexOf('"COMMIT"', projectsSource.indexOf('if (mode === "permanent")')),
    );
    const riskDelIdx = branch.indexOf("DELETE FROM risks WHERE project_id = $1 RETURNING id");
    expect(riskDelIdx).toBeGreaterThan(-1);
    expect(branch.indexOf("DELETE FROM comments WHERE entity_type = 'risk'")).toBeGreaterThan(riskDelIdx);
    expect(branch.indexOf("DELETE FROM attachments")).toBeGreaterThan(riskDelIdx);
    expect(branch.indexOf("DELETE FROM attachment_upload_operations")).toBeGreaterThan(riskDelIdx);
    expect(branch.indexOf("UPDATE plan_activities SET risk_id = NULL")).toBeGreaterThan(riskDelIdx);
  });
});

describe("RISK-DEL-17 — plan-activity risk link and upload failure-path coordination", () => {
  it("plan-activity risk reference validation locks the risk row FOR SHARE on the transaction client", () => {
    // plan_activities.risk_id has no DB-level FK; the existence check must
    // hold a share lock through the activity write so a racing project
    // permanent delete either blocks (and then nulls the committed link) or
    // makes this check fail closed.
    const fn = plansSource.slice(plansSource.indexOf("async function validateRiskReference"));
    const block = fn.slice(0, fn.indexOf("\nfunction "));
    expect(block).toContain("SELECT id FROM risks WHERE id = $1 FOR SHARE");
    expect(block).toContain("risk_not_found");
    // Both call sites pass the open transaction client (lock survives to the
    // activity write). Call shape: validateRiskReference(…, client)
    const callSites = [...plansSource.matchAll(/await validateRiskReference\([^;]*?\);/gs)].map((m) => m[0]);
    expect(callSites.length).toBeGreaterThanOrEqual(2);
    for (const call of callSites) expect(call).toContain(", client)");
  });
  it("attachment finalisation rechecks canonical parent authority before locking the upload operation", () => {
    const finalisation = attachmentsSource.slice(
      attachmentsSource.indexOf('router.post("/attachments/operations/:operationId/finalize"'),
      attachmentsSource.indexOf("function currentModule"),
    );
    const parentGuardIdx = finalisation.indexOf("assertCanonicalParent(req, op.parentType, op.parentId)");
    const operationLockIdx = finalisation.indexOf("FROM attachment_upload_operations WHERE operation_id = $1 FOR UPDATE");
    expect(parentGuardIdx).toBeGreaterThan(-1);
    expect(operationLockIdx).toBeGreaterThan(parentGuardIdx);
  });
});

describe("RISK-DEL-18 — deletion audience assignment authority", () => {
  it("locks project assignments before capturing a permanent-delete audience", () => {
    const branch = projectsSource.slice(projectsSource.indexOf('router.delete("/projects/:projectId"'));
    const assignmentLock = branch.indexOf(
      "SELECT project_id, user_id FROM project_assignments WHERE project_id = $1 FOR UPDATE",
    );
    const audienceCapture = branch.indexOf("captureOperationalAudience?.(");

    // An externally revoked SPO assignment cannot slip between capture and the
    // project-assignment cascade: it blocks on this row lock, then observes the
    // deletion rather than receiving its private deletion signal.
    expect(assignmentLock).toBeGreaterThan(-1);
    expect(audienceCapture).toBeGreaterThan(assignmentLock);
    expect(branch.slice(0, assignmentLock)).toContain('if (mode === "permanent")');
  });

  it("captures the development retirement audience through its open transaction", () => {
    const retirement = projectsSource.slice(
      projectsSource.indexOf('router.post("/projects/:projectId/development-test-retirement"'),
      projectsSource.indexOf('router.get("/projects/:projectId/deletion-info"'),
    );
    expect(retirement).toContain("captureOperationalAudience?.(\"project\", project.id, client)");
  });
});
