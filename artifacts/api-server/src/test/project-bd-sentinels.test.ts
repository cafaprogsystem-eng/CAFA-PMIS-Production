/**
 * PRJ-BD-SENTINELS — Business Decision Sentinel Tests (Task #446)
 *
 * These tests document CURRENT (defective) behaviour and MUST PASS against the
 * unmodified codebase. They will be updated or removed when the implementation
 * tasks fix each defect.
 *
 * PRJ-BD-SENT-01  PATCH full-replace resets budget_spent to 0  (PRJ-BD-03 defect)
 * PRJ-BD-SENT-02  Multi-sector TC list/detail scope mismatch   (PRJ-BD-05 defect)
 * PRJ-BD-SENT-03  Document delete succeeds on approved project  (PRJ-BD-04 defect)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
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

const mockLogAudit = vi.fn().mockResolvedValue(undefined);
const mockAssertStateAllowed = vi.fn().mockResolvedValue({ ok: true });

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original, // keep real assertSectorAllowed, tcSectorRestriction
    logAudit: mockLogAudit,
    assertStateAllowed: mockAssertStateAllowed,
    requirePerm: (_perm: string) => (_req: Request, _res: Response, next: NextFunction) => {
      next();
    },
  };
});

// ─── User fixtures ─────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM User", email: "pm@cafa.org", role: "program_manager",
  roleLabel: "Programme Manager", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

/** TC assigned ONLY to "Education" — project primary sector is "Health" */
const TC_SECONDARY_SECTOR_USER = {
  id: 10, name: "TC Secondary", email: "tc.secondary@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null,
  sector: "Education",
  sectors: ["Education"],
  avatarUrl: null,
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
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockConnectFn.mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [] });
  mockQuery.mockResolvedValue({ rows: [] });
  mockLogAudit.mockResolvedValue(undefined);
  mockAssertStateAllowed.mockResolvedValue({ ok: true });
});

// ─── PRJ-BD-SENT-01: PATCH spend preservation — PRJ-BD-03 FIXED ──────────────

describe("PRJ-BD-SENT-01 — PATCH full-replace silently resets budget_spent", () => {
  /**
   * PRJ-BD-03 IMPLEMENTED (Task #455):
   * - The PATCH handler now uses an upsert pattern instead of delete-then-reinsert.
   * - Existing activities are UPDATEd in-place (budget_spent/progress_pct preserved).
   * - New activities (no id) are INSERTed with budget_spent=0, progress_pct=0.
   * - Removed activities are deleted via a project-scoped DELETE ... NOT IN clause.
   * - SENT-01a and SENT-01b now verify the FIXED state.
   */
  it("SENT-01a: PATCH handler retains DELETE clause (for removed activities) and INSERT (for new activities)", () => {
    // Read the route source to verify both still exist (for their new purposes)
    const routePath = path.resolve(
      import.meta.dirname ?? __dirname,
      "../routes/projects.ts",
    );
    const source = fs.readFileSync(routePath, "utf-8");

    // Fallback DELETE still exists (for when no ids matched, i.e. all activities are new)
    expect(source).toContain("DELETE FROM activities WHERE project_id=$1");
    // INSERT still exists (for brand-new activities)
    expect(source).toContain("INSERT INTO activities");
    // UPDATE also now exists (for existing activities — the fix)
    expect(source).toContain("UPDATE activities SET");
  });

  it("SENT-01b: activity INSERT statement now includes budget_spent and progress_pct (PRJ-BD-03 fixed)", () => {
    // Verify the INSERT for new activities explicitly sets budget_spent=0 and progress_pct=0
    const routePath = path.resolve(
      import.meta.dirname ?? __dirname,
      "../routes/projects.ts",
    );
    const source = fs.readFileSync(routePath, "utf-8");

    // Extract the INSERT INTO activities block from the PATCH handler
    const insertMatch = source.match(
      /INSERT INTO activities\s+\(project_id,\s*output_id,[^)]+\)\s*VALUES[^;]+/,
    );

    expect(insertMatch).not.toBeNull();
    // FIXED: budget_spent is now present in the INSERT (set to 0 for new activities)
    expect(insertMatch![0]).toContain("budget_spent");
    // FIXED: progress_pct is also present
    expect(insertMatch![0]).toContain("progress_pct");
  });

  it("SENT-01c: PATCH endpoint is restricted to draft projects (guard confirmed)", async () => {
    // Verify that the status guard exists — PATCH on non-draft returns 409
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ status: "active", sector: "Health" }] }); // SELECT status, sector

    const app = await buildApp(PM_USER);
    const body = {
      title: "Test Project",
      description: "A".repeat(50),
      agreementNumber: "AGR-001",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      stateIds: [1],
      sectors: ["Health"],
    };

    const res = await request(app).patch("/api/projects/42").send(body);

    // The handler rejects non-draft projects with 409
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("draft");
  });
});

// ─── PRJ-BD-SENT-02: Multi-sector TC list/detail scope mismatch ───────────────

describe("PRJ-BD-SENT-02 — TC secondary-sector list/detail scope mismatch", () => {
  /**
   * Documents the asymmetry between list and detail scope for TC users:
   * - List (GET /projects) uses union(primary sector, sectors[]) → TC sees project
   * - Detail (GET /projects/:id) uses assertSectorAllowed(primary only) → TC gets 403
   *
   * After Task B (PRJ-BD-05 implementation):
   * - Detail should also use union scope, returning 200 for both.
   */
  it("SENT-02a: assertSectorAllowed checks only primary sector (not sectors[])", async () => {
    // Import the real implementation (not mocked for this unit test)
    const { assertSectorAllowed, tcSectorRestriction } = await import(
      "../middlewares/currentUser.js"
    );

    const mockReq = { currentUser: TC_SECONDARY_SECTOR_USER } as unknown as Request;

    // TC is assigned to "Education" only
    const restriction = tcSectorRestriction(mockReq);
    expect(restriction).toEqual(["Education"]);

    // Project primary sector is "Health" — TC's sectors[] has "Education" but not "Health"
    // assertSectorAllowed only checks primary sector → denies access
    const result = assertSectorAllowed(mockReq, "Health");

    // CURRENT DEFECT: forbidden even though TC's sector is in project's sectors[]
    // After Task B: assertSectorAllowedForProject would return { ok: true }
    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number; body: object }).status).toBe(403);
  });

  it("SENT-02b: assertSectorAllowed passes when primary sector matches TC assignment", async () => {
    const { assertSectorAllowed } = await import("../middlewares/currentUser.js");
    const mockReq = { currentUser: TC_SECONDARY_SECTOR_USER } as unknown as Request;

    // Primary sector matches TC → access granted (baseline, must remain true after fix)
    const result = assertSectorAllowed(mockReq, "Education");
    expect(result.ok).toBe(true);
  });

  it("SENT-02c: TC with empty sector assignment fails closed", async () => {
    const { assertSectorAllowed } = await import("../middlewares/currentUser.js");

    const tcNoSector = {
      currentUser: { ...TC_SECONDARY_SECTOR_USER, sectors: [] },
    } as unknown as Request;

    const result = assertSectorAllowed(tcNoSector, "Health");
    expect(result.ok).toBe(false);
  });

  it("SENT-02d: GET /projects/:id returns 403 for TC assigned only to secondary sector", async () => {
    // Project primary sector = "Health"; TC sectors = ["Education"]
    mockQuery
      .mockResolvedValueOnce({ rows: [{ sector: "Health" }] }); // getProjectSector

    const app = await buildApp(TC_SECONDARY_SECTOR_USER);
    const res = await request(app).get("/api/projects/42");

    // CURRENT DEFECT: TC whose sector is in sectors[] but not primary sector gets 403
    // After Task B: should return 200 if "Education" is in project's sectors[]
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });
});

// ─── PRJ-BD-SENT-03: Document delete status gate — PRJ-BD-04 FIXED ───────────

describe("PRJ-BD-SENT-03 — Document delete is blocked by project status (PRJ-BD-04 IMPLEMENTED)", () => {
  /**
   * PRJ-BD-04 IMPLEMENTED (Task #472):
   * - Document delete on approved/active projects returns 409 for non-override actors.
   * - PM/Super Admin may override with a non-blank overrideReason.
   * - Closed projects: 409 for everyone, no bypass.
   * - SENT-03a and SENT-03b now verify the FIXED state.
   */
  it("SENT-03a: project status query IS issued inside the transaction during document delete", async () => {
    // PRJ-BD-04 (Task #472): The status check is now fully atomic — it happens via
    // SELECT … FOR UPDATE inside the delete transaction (mockClientQuery), not as a
    // separate pool.query call beforehand.
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: [] }] }); // getProjectEffectiveSectors

    // Transaction: BEGIN → SELECT status FOR UPDATE (approved) → ROLLBACK (no reason)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "approved" }] })   // SELECT status FOR UPDATE
      .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/42/documents/7")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");

    // The status query MUST have appeared inside the transaction (mockClientQuery)
    const projectStatusQuery = mockClientQuery.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .find((sql) => sql.includes("status") && sql.toLowerCase().includes("from projects"));

    expect(projectStatusQuery).toBeDefined();
    // The query must use FOR UPDATE to prevent concurrent transition races
    expect(projectStatusQuery).toContain("FOR UPDATE");
  });

  it("SENT-03b: document delete block contains inline atomic status guard (FOR UPDATE, not a separate helper)", () => {
    const routePath = path.resolve(
      import.meta.dirname ?? __dirname,
      "../routes/projects.ts",
    );
    const source = fs.readFileSync(routePath, "utf-8");

    // Find the delete endpoint block
    const deleteEndpointMatch = source.match(
      /router\.delete\("\/projects\/:projectId\/documents\/:documentId"[\s\S]+?(?=router\.\w+\()/,
    );

    expect(deleteEndpointMatch).not.toBeNull();
    const deleteBlock = deleteEndpointMatch![0];

    // The gate must use SELECT … FOR UPDATE inside the transaction (atomic, race-safe)
    expect(deleteBlock).toContain("FOR UPDATE");

    // The frozen guard must be present
    expect(deleteBlock).toContain("project_documents_frozen");

    // The operational guard must be present
    expect(deleteBlock).toContain("project_document_locked_after_approval");

    // The override reason requirement must be present
    expect(deleteBlock).toContain("override_reason_required");

    // DELETE … RETURNING must be used (metadata captured atomically, no pre-fetch)
    expect(deleteBlock).toContain("RETURNING");
  });
});
