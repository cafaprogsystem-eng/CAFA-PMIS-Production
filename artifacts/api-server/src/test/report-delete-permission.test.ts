/**
 * Report Delete Permission — Backend Tests
 *
 * Verifies that DELETE /reports/:reportId uses the dedicated `reports.delete`
 * permission (not the general `reports.update`), consistent with the
 * projects.delete / plans.delete pattern already established in CAFA PMIS.
 *
 * Test IDs:
 *   REPORT-DEL-PERM-01 through REPORT-DEL-PERM-10  — endpoint permission/ownership
 *   REPORT-DEL-XTYPE-01 through REPORT-DEL-XTYPE-04 — cross-report-type coverage
 *
 * Note: ownership logic (author_id / null-fail-close / super_admin bypass) is
 * already covered by PMR-ID-DEL-01 through PMR-ID-DEL-07 in
 * pmr-identity-hardening.test.ts.  This file focuses exclusively on the
 * permission model change (reports.update → reports.delete).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before any dynamic import of the route
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Capture the real permissionsFor for permission-model unit tests (PERM-07/08/09).
 * The mock still overrides permissionsFor for the route handler (super_admin check),
 * but the original is available via originalPermissionsFor.
 */
let originalPermissionsFor: (user: unknown) => string[];

const mockPermissionsFor = vi.fn().mockReturnValue(["reports.delete"]);

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  // Save the real implementation for unit-testing the permission model.
  originalPermissionsFor = original.permissionsFor;
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    // Bypass the outer gate in most tests; PERM-02 uses buildAppWithRealPermGate instead.
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: mockPermissionsFor,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake users
// ─────────────────────────────────────────────────────────────────────────────

const AUTHOR_SPO = {
  id: 10,
  name: "SPO Author",
  email: "spo@example.com",
  role: "state_program_officer",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

const AUTHOR_TC = {
  id: 11,
  name: "TC Author",
  email: "tc@example.com",
  role: "technical_coordinator",
  stateId: null,
  sector: "WASH",
  sectors: ["WASH"],
} as const;

const AUTHOR_PM = {
  id: 12,
  name: "PM Author",
  email: "pm@example.com",
  role: "program_manager",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const SOM_USER = {
  id: 20,
  name: "SOM User",
  email: "som@example.com",
  role: "state_office_manager",
  stateId: 1,
  sector: null,
  sectors: [],
} as const;

const OTHER_SPO = {
  id: 30,
  name: "Other SPO",
  email: "other-spo@example.com",
  role: "state_program_officer",
  stateId: 2,
  sector: null,
  sectors: [],
} as const;

const SUPER_ADMIN = {
  id: 99,
  name: "Super Admin",
  email: "admin@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// App builders
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("TEST APP ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

/**
 * App that applies a real permission gate for `reports.delete` before the
 * route handler.  Used in PERM-02 to test the outer permission boundary
 * without overriding the requirePerm mock across the whole file.
 */
async function buildAppWithRealPermGate(
  user: Record<string, unknown>,
  permissions: string[],
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  // Inline gate that mirrors requirePerm("reports.delete")
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!permissions.includes("reports.delete") && !permissions.includes("*")) {
      res
        .status(403)
        .json({
          error: "forbidden",
          message: "You do not have permission to perform this action.",
          requiredPermission: "reports.delete",
        });
      return;
    }
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("TEST APP ERROR:", err.message);
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — mock DB for a successful draft delete (no attachments)
// ─────────────────────────────────────────────────────────────────────────────

function mockDraftReport(authorId: number | null, status = "draft") {
  // All pool.query calls return the same row; the route handler extracts
  // only the fields it needs per query.  With no object_path field present,
  // attachment / voice-note path arrays are [undefined], which
  // partitionSafeStoragePathsForReport treats as externally referenced
  // (skipped → no storage delete calls needed).
  mockQuery.mockResolvedValue({ rows: [{ authorId, status }] });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Outer permission gate (reports.delete)
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /reports/:reportId — outer permission gate (reports.delete)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Default: has reports.delete
    mockPermissionsFor.mockReturnValue(["reports.delete"]);
  });

  // REPORT-DEL-PERM-01: Author with reports.delete + Draft → allowed (200)
  it("REPORT-DEL-PERM-01: author with reports.delete + draft status → 200 ok", async () => {
    mockDraftReport(AUTHOR_SPO.id);
    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // REPORT-DEL-PERM-02: Author with reports.update but NOT reports.delete → 403
  it("REPORT-DEL-PERM-02: author has reports.update only (no reports.delete) → 403 forbidden", async () => {
    mockDraftReport(AUTHOR_SPO.id);
    // buildAppWithRealPermGate provides only reports.update — NOT reports.delete
    const app = await buildAppWithRealPermGate(
      AUTHOR_SPO as unknown as Record<string, unknown>,
      ["reports.update"],
    );
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(res.body.requiredPermission).toBe("reports.delete");
  });

  // REPORT-DEL-PERM-03: Has reports.delete but is NOT the author → 403 ownership
  it("REPORT-DEL-PERM-03: user has reports.delete but is not the author → 403 only_creator_or_admin_can_delete", async () => {
    // Report authored by SPO (id=10); request made by OTHER_SPO (id=30)
    mockDraftReport(AUTHOR_SPO.id);
    const app = await buildApp(OTHER_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });

  // REPORT-DEL-PERM-04: Has reports.delete + is author but status is not draft → 409
  it("REPORT-DEL-PERM-04: author with reports.delete + non-draft status → 409 only_draft_reports_can_be_deleted", async () => {
    mockDraftReport(AUTHOR_SPO.id, "submitted");
    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("only_draft_reports_can_be_deleted");
  });

  // REPORT-DEL-PERM-05: author_id = null + non-super-admin with reports.delete → 403 (fails closed)
  it("REPORT-DEL-PERM-05: author_id IS NULL + non-super-admin with reports.delete → 403 fails closed", async () => {
    mockDraftReport(null);
    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });

  // REPORT-DEL-PERM-06: super_admin + wildcard → ownership bypassed even for non-author
  it("REPORT-DEL-PERM-06: super_admin (wildcard) + non-author + draft → 200 ok (bypass)", async () => {
    mockPermissionsFor.mockReturnValue(["*"]);
    // Report authored by AUTHOR_SPO (id=10); request by SUPER_ADMIN (id=99)
    mockDraftReport(AUTHOR_SPO.id);
    const app = await buildApp(SUPER_ADMIN as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // REPORT-DEL-PERM-10: submitted_by_id ≠ author_id; user = submitted_by_id (not author) → 403
  it("REPORT-DEL-PERM-10: user matches submitted_by_id but not author_id → 403 (author_id is authoritative)", async () => {
    // author_id = AUTHOR_SPO (10); OTHER_SPO (30) is the submitter, not the author
    mockDraftReport(AUTHOR_SPO.id);
    const app = await buildApp(OTHER_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("only_creator_or_admin_can_delete");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Permission model: which roles receive reports.delete
// ─────────────────────────────────────────────────────────────────────────────

describe("permissionsFor() — reports.delete role assignments", () => {
  /**
   * Minimal user object shape accepted by permissionsFor().
   * The real implementation checks only `role` and `sectors`.
   */
  function makeUser(role: string) {
    return { id: 1, role, stateId: null, sector: null, sectors: [] as string[] };
  }

  // REPORT-DEL-PERM-07: SPO receives reports.delete
  it("REPORT-DEL-PERM-07: state_program_officer has reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("state_program_officer"));
    expect(perms).toContain("reports.delete");
  });

  // REPORT-DEL-PERM-08: TC receives reports.delete
  it("REPORT-DEL-PERM-08: technical_coordinator has reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("technical_coordinator"));
    expect(perms).toContain("reports.delete");
  });

  // PM receives reports.delete (via HQ block)
  it("REPORT-DEL-PERM-08b: program_manager has reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("program_manager"));
    expect(perms).toContain("reports.delete");
  });

  // SPC receives reports.delete (via HQ block)
  it("REPORT-DEL-PERM-08c: senior_program_coordinator has reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("senior_program_coordinator"));
    expect(perms).toContain("reports.delete");
  });

  // REPORT-DEL-PERM-09: SOM does NOT receive reports.delete
  it("REPORT-DEL-PERM-09: state_office_manager does NOT have reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("state_office_manager"));
    expect(perms).not.toContain("reports.delete");
  });

  // ED does NOT receive reports.delete (reviewer only)
  it("REPORT-DEL-PERM-09b: executive_director does NOT have reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("executive_director"));
    expect(perms).not.toContain("reports.delete");
  });

  // viewer does NOT receive reports.delete
  it("REPORT-DEL-PERM-09c: viewer does NOT have reports.delete", () => {
    const perms = originalPermissionsFor(makeUser("viewer"));
    expect(perms).not.toContain("reports.delete");
  });

  // super_admin gets "*" wildcard (which implies all permissions including reports.delete)
  it("REPORT-DEL-PERM-09d: super_admin receives '*' wildcard (covers reports.delete implicitly)", () => {
    const perms = originalPermissionsFor(makeUser("super_admin"));
    expect(perms).toContain("*");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Cross-report-type coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /reports/:reportId — cross-type (REPORT-DEL-XTYPE)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPermissionsFor.mockReturnValue(["reports.delete"]);
  });

  // REPORT-DEL-XTYPE-01: Activity Report Draft, TC author
  it("REPORT-DEL-XTYPE-01: activity report draft + TC author with reports.delete → 200", async () => {
    mockDraftReport(AUTHOR_TC.id);
    const app = await buildApp(AUTHOR_TC as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/10");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // REPORT-DEL-XTYPE-02: PMR Draft, SPO author
  it("REPORT-DEL-XTYPE-02: PMR draft + SPO author with reports.delete → 200", async () => {
    mockDraftReport(AUTHOR_SPO.id);
    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/20");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // REPORT-DEL-XTYPE-03: State Programme Report Draft, SPO author
  it("REPORT-DEL-XTYPE-03: state programme report draft + SPO author with reports.delete → 200", async () => {
    mockDraftReport(AUTHOR_SPO.id);
    const app = await buildApp(AUTHOR_SPO as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/30");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // REPORT-DEL-XTYPE-04: HQ Sector Report Draft, PM author
  it("REPORT-DEL-XTYPE-04: HQ sector report draft + PM author with reports.delete → 200", async () => {
    mockDraftReport(AUTHOR_PM.id);
    const app = await buildApp(AUTHOR_PM as unknown as Record<string, unknown>);
    const res = await request(app).delete("/api/projects/reports/40");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
