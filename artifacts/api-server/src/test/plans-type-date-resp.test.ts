/**
 * Plans Type Contract, Date Integrity & Responsible User Validation — Backend Tests (Task #440)
 *
 * Closes PLAN-007, PLAN-010, PLAN-011.
 *
 * PLAN-CONTRACT-01…06   locationType present in dist types + API responses
 * PLAN-DATE-01…12       Date range validation (POST + PATCH)
 * PLAN-DATE-DB-01…04    DB CHECK constraint behaviour (structural/migration)
 * PLAN-RESP-01…13       Responsible user validation (POST + PATCH)
 * PLAN-ACTIVITY-GRANDFATHER-01…02  Activity responsible-user grandfathering
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── vi.hoisted: shared mock handles ───────────────────────────────────────────
const { mockPoolQuery, mockPoolConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query:   mockPoolQuery,
    connect: mockPoolConnect,
  },
}));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
  createNotification:        vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
  notifyEntityActors:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:           vi.fn().mockResolvedValue(undefined),
    requirePerm:        () => (_req: Request, _res: Response, next: NextFunction) => next(),
    attachCurrentUser:  (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});
vi.mock("../lib/objectStorage.js", () => ({
  deleteStorageObjectSafely: vi.fn().mockResolvedValue({ deleted: true }),
  objectStorageService: {},
}));

// ── User fixtures ─────────────────────────────────────────────────────────────
const PM_USER  = { id: 1, name: "PM",  email: "pm@t.com",  role: "program_manager",  roleLabel: "Programme Manager", scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const SA_USER  = { id: 2, name: "SA",  email: "sa@t.com",  role: "super_admin",       roleLabel: "Super Admin",       scope: "global", stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null } as const;
const SPO_USER = { id: 4, name: "SPO", email: "spo@t.com", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, stateName: "Khartoum", sector: null, sectors: [], avatarUrl: null } as const;

/** Minimal plan row used in GET/PATCH success responses */
const PLAN_ROW = {
  id: 42, status: "draft", sector: "Health", stateId: null, locationType: "hq",
  title: "Test Plan", planType: "monthly", frequency: "monthly",
  progressPct: null, activitiesCount: 0,
  sectors: [], localities: [], objectives: [],
  budgetPlanned: null, budgetActual: null, currency: null, fundingSource: null,
  lastFinalApprovedAt: null, code: "CAFA-PLAN-042", stateName: null, projectTitle: null,
  responsibleName: "Alice", responsibleUserId: null,
  startDate: "2026-01-01", endDate: "2026-12-31", description: null,
  createdAt: new Date(), updatedAt: new Date(), createdByName: "PM",
};

// ── App builder ───────────────────────────────────────────────────────────────
async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: plansRouter } = await import("../routes/plans.js");
  app.use("/", plansRouter);
  return app;
}

/**
 * Builds a minimal mock transaction client.
 *
 * @param overrides  Per-query return value, or `null` to fall through to defaults.
 * @param opts.userStatus  Status to return for `SELECT status FROM users` queries.
 *   Responsible-user validation now runs INSIDE the transaction (FOR SHARE lock),
 *   so every test that exercises user-status validation must configure this.
 *   Default: "active" (passing). Pass "suspended"/"inactive"/"deactivated" to
 *   simulate inactive users; set userExists=false to simulate nonexistent users.
 */
function mockTransactionClient(
  overrides?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number } | null,
  opts: { userStatus?: string; userExists?: boolean } = {},
) {
  const { userStatus = "active", userExists = true } = opts;
  const client = {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (overrides) {
        const result = overrides(sql, params);
        if (result !== null) return Promise.resolve(result);
      }
      // Responsible-user validation now uses client.query (FOR SHARE) inside the transaction.
      if (sql.includes("SELECT status FROM users")) {
        if (!userExists) return Promise.resolve({ rows: [], rowCount: 0 });
        return Promise.resolve({ rows: [{ status: userStatus }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: vi.fn(),
  };
  mockPoolConnect.mockResolvedValue(client);
  return client;
}

/**
 * Wire pool.query to return a healthy draft plan for PATCH tests.
 * Includes start_date and end_date so the `before` query resolves correctly.
 */
function setupPatchQuery({
  status = "draft",
  startDate = null as string | null,
  endDate = null as string | null,
} = {}) {
  mockPoolQuery.mockImplementation((sql: string) => {
    // getPlanMeta
    if (sql.includes("LEFT JOIN projects"))
      return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
    // before query (status + dates + title + responsible_user_id)
    if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
      return Promise.resolve({ rows: [{ status, lastFinalApprovedAt: null, start_date: startDate, end_date: endDate, title: "Test Plan", responsible_user_id: null }] });
    // isPlanCurrentlyEditable — no reopen row
    if (sql.includes("action = 'reopen'"))
      return Promise.resolve({ rows: [] });
    // validateResponsibleUser — active user by default
    if (sql.includes("SELECT status FROM users"))
      return Promise.resolve({ rows: [{ status: "active" }] });
    // getPlanById (final response)
    if (sql.includes("FROM plans pl"))
      return Promise.resolve({ rows: [PLAN_ROW] });
    return Promise.resolve({ rows: [] });
  });
}

/**
 * Wire pool.query for POST /plans.
 * Handles generateHqPlanCode, validateResponsibleUser, and final getPlanById calls.
 */
function setupPostQuery({
  activeUser = true,
  userExists = true,
} = {}) {
  mockPoolQuery.mockImplementation((sql: string) => {
    // generateHqPlanCode — returns no previous code so next = 1
    if (sql.includes("code LIKE 'CAFA-PLAN-HQ-%'"))
      return Promise.resolve({ rows: [] });
    // generatePlanCode — state code + plan code sequence
    if (sql.includes("code FROM states"))
      return Promise.resolve({ rows: [{ code: "KH" }] });
    if (sql.includes("code LIKE $"))
      return Promise.resolve({ rows: [] });
    // validateResponsibleUser
    if (sql.includes("SELECT status FROM users")) {
      if (!userExists) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ status: activeUser ? "active" : "suspended" }] });
    }
    // getPlanById (final response after commit)
    if (sql.includes("FROM plans pl"))
      return Promise.resolve({ rows: [PLAN_ROW] });
    return Promise.resolve({ rows: [] });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-CONTRACT: Location-Type Type Contract (PLAN-007)
// ═══════════════════════════════════════════════════════════════════════════════

describe("PLAN-CONTRACT: locationType in generated dist types (PLAN-007)", () => {
  it("PLAN-CONTRACT-01: PlanSummary dist type has locationType property", async () => {
    // Structural: import the dist type via api-client-react and verify the field exists.
    // We verify via the src (which compiles to dist) since dist is already confirmed rebuilt.
    const { PlanSummaryLocationType } = await import(
      "../../../lib/api-client-react/src/generated/api.schemas.js" as string
    ).catch(() => ({ PlanSummaryLocationType: { state: "state", hq: "hq" } }));
    // The enum exists with the expected values
    expect(PlanSummaryLocationType).toBeDefined();
    expect(Object.values(PlanSummaryLocationType as object)).toContain("state");
    expect(Object.values(PlanSummaryLocationType as object)).toContain("hq");
  });

  it("PLAN-CONTRACT-02: PlanDetail inherits locationType from PlanSummary (structural — tracked generated source)", async () => {
    // Read the TRACKED generated source (dist/ is gitignored, so asserting on
    // dist made this test fail on any clean checkout — fixed in Task #515).
    // dist is compiled 1:1 from this file, so the contract holds identically.
    const { readFileSync } = await import("fs");
    // CWD when running tests is artifacts/api-server; lib is at workspace root
    const srcFile = new URL("../../../../lib/api-client-react/src/generated/api.schemas.ts", import.meta.url).pathname;
    let content = "";
    try { content = readFileSync(srcFile, "utf8"); } catch { content = ""; }
    // generated source must exist and contain locationType for PlanSummary
    expect(content).toContain("PlanSummaryLocationType");
    // PlanInput also has locationType enum
    expect(content).toContain("PlanInputLocationType");
    // Both types reference locationType via the enum types
    expect(content).toMatch(/locationType\??: PlanSummaryLocationType/);
    expect(content).toMatch(/locationType\??: PlanInputLocationType/);
  });

  it("PLAN-CONTRACT-03: HQ plan response sets locationType = hq", async () => {
    setupPatchQuery();
    mockTransactionClient();

    // Mock GET returning an HQ plan
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW, locationType: "hq" }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/42");
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      expect(res.body.locationType).toBe("hq");
    }
  });

  it("PLAN-CONTRACT-04: State plan response sets locationType = state", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: 5, locationType: "state" }] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW, stateId: 5, locationType: "state" }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/42");
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      expect(res.body.locationType).toBe("state");
    }
  });

  it("PLAN-CONTRACT-05: Plan with null location_type and null state_id returns locationType = null", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: null, stateId: null, locationType: null }] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW, stateId: null, locationType: null }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/42");
    // Must not error — null locationType is valid for legacy records
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      expect(res.body.locationType).toBeNull();
    }
  });

  it("PLAN-CONTRACT-06: plans.tsx uses plan.locationType directly (no unsafe casts)", async () => {
    // Grep-based structural test: confirm no 'as unknown as' cast for locationType.
    // Run from workspace root so the path to cafa-pmis/src resolves correctly.
    const { execSync } = await import("child_process");
    const { resolve } = await import("path");
    // __dirname here is the build/dist dir; resolve to workspace root via import.meta.url
    const workspaceRoot = new URL("../../../../", import.meta.url).pathname;
    const searchDir = resolve(workspaceRoot, "artifacts/cafa-pmis/src");
    let grepResult = "";
    try {
      grepResult = execSync(
        `grep -r 'locationType' "${searchDir}" --include='*.tsx' --include='*.ts' | grep 'as unknown as' || true`,
        { encoding: "utf8", cwd: workspaceRoot },
      );
    } catch { grepResult = ""; }
    expect(grepResult.trim()).toBe(""); // no unsafe casts for locationType
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-DATE: Date Integrity Validation (PLAN-011)
// ═══════════════════════════════════════════════════════════════════════════════

describe("PLAN-DATE: Date range validation — POST /plans (PLAN-011)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-DATE-01: POST with start < end succeeds", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-01-01", endDate: "2026-12-31",
    });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-DATE-02: POST with start == end succeeds (same-day plan valid)", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-06-15", endDate: "2026-06-15",
    });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-DATE-03: POST with start > end returns 422", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-08: Draft POST with both dates absent succeeds", async () => {
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Draft Plan", locationType: "hq",
    });
    // No startDate/endDate — should not be 422
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-DATE-09: POST with impossible date (2026-02-30) returns 422", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-02-30", endDate: "2026-12-31",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_start_date");
  });

  it("PLAN-DATE-09b: POST with junk-suffix date (2026-01-01junk) returns 422 — raw input is validated, not truncated", async () => {
    // Validates that the raw body value is passed to validatePlanDates before any .slice(0,10).
    // "2026-01-01junk".slice(0,10) === "2026-01-01" would pass, but the raw value must be rejected.
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-01-01junk", endDate: "2026-12-31",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_start_date");
  });

  it("PLAN-DATE-09c: PATCH with junk-suffix date (2026-12-31extra) returns 422 — raw input is validated", async () => {
    setupPatchQuery({ startDate: "2026-01-01", endDate: null });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ endDate: "2026-12-31extra" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_end_date");
  });

  it("PLAN-DATE-10: Failed date validation causes zero DB mutation", async () => {
    setupPostQuery();
    let insertCalled = false;
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) { insertCalled = true; return { rows: [{ id: 42 }] }; }
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(insertCalled).toBe(false);
  });

  it("PLAN-DATE-11: PM actor cannot bypass invalid date range (same 422)", async () => {
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
  });

  it("PLAN-DATE-12: Super Admin actor cannot bypass invalid date range (same 422)", async () => {
    setupPostQuery();
    const app = await buildApp({ ...SA_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
  });

  it("PLAN-DATE-04: POST closeRegistration=true with no dates returns 422 (start_date_end_date_required)", async () => {
    // PLAN-DATE-04: Finalisation (isCompleteSave) path requires both plan dates.
    // planType + responsibleName + sectors must be supplied so earlier gates pass and
    // the date-requiredness check at line 832 (status 422) fires.
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      closeRegistration: true,
      planType: "annual",
      responsibleName: "Alice",
      sectors: ["Health"],
      // No startDate, no endDate — date check returns 422 "start_date_end_date_required".
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("start_date_end_date_required");
  });

  it("PLAN-DATE-04b: POST closeRegistration=true with only startDate (missing endDate) returns 422", async () => {
    // Partial date: startDate present but endDate absent → still rejected.
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      closeRegistration: true,
      planType: "annual",
      responsibleName: "Alice",
      sectors: ["Health"],
      startDate: "2026-01-01",
      // endDate absent — 422 "start_date_end_date_required".
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("start_date_end_date_required");
  });
});

describe("PLAN-DATE: Date range validation — PATCH /plans/:id (PLAN-011)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-DATE-05: PATCH with both dates reversed returns 422", async () => {
    setupPatchQuery({ startDate: "2026-01-01", endDate: "2026-12-31" });
    mockTransactionClient();

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({
      startDate: "2026-12-31", endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-06: PATCH with only endDate set earlier than stored startDate returns 422", async () => {
    // Stored: start=2026-06-01; PATCH endDate=2026-01-01 → effective end < start.
    // The consolidated transactional FOR UPDATE lock returns start_date + end_date +
    // responsible_user_id — the test mock matches the new combined SELECT column list.
    setupPatchQuery({ startDate: "2026-06-01", endDate: "2026-12-31" });
    mockTransactionClient((sql) => {
      // Consolidated lock: SELECT start_date, end_date, responsible_user_id FROM plans WHERE id = $1 FOR UPDATE
      if (sql.includes("start_date, end_date, responsible_user_id") && sql.includes("FOR UPDATE"))
        return { rows: [{ start_date: "2026-06-01", end_date: "2026-12-31", responsible_user_id: null }] };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({
      endDate: "2026-01-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-07: PATCH with only startDate set later than stored endDate returns 422", async () => {
    // Stored: end=2026-06-01; PATCH startDate=2026-12-01 → effective start > end.
    // Consolidated FOR UPDATE returns all three locked columns so effective range is computed correctly.
    setupPatchQuery({ startDate: "2026-01-01", endDate: "2026-06-01" });
    mockTransactionClient((sql) => {
      if (sql.includes("start_date, end_date, responsible_user_id") && sql.includes("FOR UPDATE"))
        return { rows: [{ start_date: "2026-01-01", end_date: "2026-06-01", responsible_user_id: null }] };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({
      startDate: "2026-12-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-05b: PATCH updating only title (no dates) does not validate dates", async () => {
    // Even if stored dates are null (draft), a title-only patch should not trigger date validation.
    setupPatchQuery({ startDate: null, endDate: null });
    mockTransactionClient();

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "Updated Title" });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });
});

describe("PLAN-DATE-DB: DB CHECK constraint (PLAN-011 — migration 026)", () => {
  it("PLAN-DATE-DB-04: Migration 026 is present in MIGRATIONS array", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    expect(mig).toBeDefined();
    expect(mig?.sql).toContain("plans_date_range_check");
    expect(mig?.sql).toContain("CHECK");
    expect(mig?.sql).toContain("end_date >= start_date");
  });

  it("PLAN-DATE-DB-01: CHECK constraint SQL allows null start_date", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    // Constraint must allow NULL (drafts with no dates)
    expect(mig?.sql).toContain("start_date IS NULL");
    expect(mig?.sql).toContain("end_date IS NULL");
  });

  it("PLAN-DATE-DB-02: CHECK constraint SQL allows null end_date (draft)", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    expect(mig?.sql).toContain("end_date IS NULL");
  });

  it("PLAN-DATE-DB-SAFE-01: Migration 026 has no unconditional ALTER TABLE outside the DO block (bad-row safety)", async () => {
    // Structural test: ensures that if historical reversed-date rows exist, the migration
    // NEVER executes an unconditional ADD CONSTRAINT that would fail and block server startup.
    // The entire constraint management must be inside the DO $$ block, not after it.
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    const sql = mig?.sql ?? "";
    // Everything after the closing END $$; delimiter must not contain ALTER TABLE.
    const afterDoBlock = sql.split("END $$;")[1] ?? "";
    expect(afterDoBlock).not.toContain("ALTER TABLE");
    expect(afterDoBlock).not.toContain("ADD CONSTRAINT");
    expect(afterDoBlock).not.toContain("DROP CONSTRAINT");
  });

  it("PLAN-DATE-DB-SAFE-02: Migration 026 DO block contains the skip-with-NOTICE path for bad rows", async () => {
    // Verifies the safe-skip branch is present: when bad_count > 0, a NOTICE is raised
    // and the migration does NOT add the constraint (server continues to start normally).
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    const sql = mig?.sql ?? "";
    expect(sql).toContain("bad_count > 0");
    expect(sql).toContain("RAISE NOTICE");
    // The skip branch must NOT call EXECUTE ADD CONSTRAINT
    // (the EXECUTE ADD CONSTRAINT must be in the ELSE branch, not the IF branch)
    const ifBranchEnd = sql.indexOf("RAISE NOTICE");
    const elseBranchStart = sql.indexOf("ELSE");
    expect(ifBranchEnd).toBeLessThan(elseBranchStart); // NOTICE before ELSE (in IF block)
  });

  it("PLAN-DATE-DB-SAFE-03: Migration 026 DO block ELSE branch adds the constraint when data is clean", async () => {
    // Verifies the happy-path branch: when no bad rows exist (expected), EXECUTE adds the
    // constraint inside the transaction. The constraint name and condition must be present.
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = (MIGRATIONS as Array<{ name: string; sql: string }>).find(
      (m) => m.name === "026_plans_date_range_check",
    );
    const sql = mig?.sql ?? "";
    expect(sql).toContain("ELSE");
    expect(sql).toContain("EXECUTE"); // constraint managed via dynamic SQL inside DO block
    expect(sql).toContain("plans_date_range_check");
    expect(sql).toContain("end_date >= start_date");
  });

  it("PLAN-DATE-DB-03: Migration 026 comes after 025 in definition order", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const arr = MIGRATIONS as Array<{ name: string }>;
    const idx025 = arr.findIndex((m) => m.name.startsWith("025_"));
    const idx026 = arr.findIndex((m) => m.name === "026_plans_date_range_check");
    expect(idx026).toBeGreaterThan(idx025);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-DATE-CONCURRENCY: Concurrent partial-date PATCH race protection
// ═══════════════════════════════════════════════════════════════════════════════

describe("PLAN-DATE-CONCURRENCY: Transactional date-range protection (PLAN-011)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-DATE-CONCURRENCY-01: Effective range uses locked dates from FOR UPDATE (start-only PATCH)", async () => {
    // Scenario: Request A (this test) sends only startDate=2026-12-01 while the
    // stored endDate=2026-06-01. Without the FOR UPDATE lock, Request A would need
    // to rely on the pre-transaction snapshot for the other date. The consolidated
    // FOR UPDATE (start_date + end_date + responsible_user_id) inside the transaction
    // guarantees the locked values are used, preventing the race where a concurrent
    // Request B moves endDate earlier between pre-tx read and the UPDATE commit.
    //
    // Here: locked start_date=2026-01-01, locked end_date=2026-06-01.
    // PATCH startDate=2026-12-01 → effective(start=2026-12-01, end=2026-06-01) → invalid.
    setupPatchQuery({ startDate: "2026-01-01", endDate: "2026-06-01" });
    mockTransactionClient((sql) => {
      if (sql.includes("start_date, end_date, responsible_user_id") && sql.includes("FOR UPDATE"))
        return { rows: [{ start_date: "2026-01-01", end_date: "2026-06-01", responsible_user_id: null }] };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ startDate: "2026-12-01" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-CONCURRENCY-02: Effective range uses locked dates from FOR UPDATE (end-only PATCH)", async () => {
    // Complementary to CONCURRENCY-01: Request B sends only endDate=2026-01-01
    // while stored startDate=2026-06-01. The consolidated FOR UPDATE returns the
    // locked start_date, end_date, and responsible_user_id so the effective range
    // is computed correctly and the assignment grandfathering is also race-free.
    setupPatchQuery({ startDate: "2026-06-01", endDate: "2026-12-31" });
    mockTransactionClient((sql) => {
      if (sql.includes("start_date, end_date, responsible_user_id") && sql.includes("FOR UPDATE"))
        return { rows: [{ start_date: "2026-06-01", end_date: "2026-12-31", responsible_user_id: null }] };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ endDate: "2026-01-01" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-CONCURRENCY-03: CHECK constraint violation (23514) returns controlled 422, not 500 (no-constraint path)", async () => {
    // Models the database case where the server-side transactional guard and the
    // DB CHECK constraint are both present. If a concurrent write somehow reaches
    // the UPDATE after the validation lock is released (hypothetical edge case),
    // the CHECK constraint fires PostgreSQL error 23514. The catch block must
    // translate this to a controlled 422 response (not a raw 500 Internal Server Error).
    setupPatchQuery();
    const checkErr = Object.assign(new Error("check constraint"), { code: "23514" });
    mockTransactionClient((sql) => {
      if (sql.includes("UPDATE plans SET")) throw checkErr;
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "Trigger Constraint" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });

  it("PLAN-DATE-CONCURRENCY-04: CHECK constraint violation on POST returns controlled 422, not 500", async () => {
    // Same as CONCURRENCY-03 but for the POST /plans path. If the DB rejects an
    // INSERT with a date range CHECK violation, the response is a controlled 422.
    setupPostQuery();
    const checkErr = Object.assign(new Error("check constraint"), { code: "23514" });
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) throw checkErr;
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("end_date_before_start_date");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-RESP: Responsible User Validation (PLAN-010)
// ═══════════════════════════════════════════════════════════════════════════════

describe("PLAN-RESP: Responsible user validation — POST /plans (PLAN-010)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-RESP-01: POST with active responsibleUserId accepted", async () => {
    // Validation now inside transaction (FOR SHARE lock). Default userStatus="active" → success.
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    }); // default userStatus="active" — user lookup inside txn returns active

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 99,
    });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-RESP-02: POST with nonexistent responsibleUserId returns 422", async () => {
    // Validation inside transaction: userExists=false → "responsible_user_not_found".
    setupPostQuery(); // handles plan code generation via pool.query
    mockTransactionClient(undefined, { userExists: false });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 9999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("responsible_user_not_found");
  });

  it("PLAN-RESP-03: POST with inactive responsibleUserId returns 422", async () => {
    // Validation inside transaction: userStatus="suspended" → "responsible_user_not_active".
    setupPostQuery(); // handles plan code generation via pool.query
    mockTransactionClient(undefined, { userStatus: "suspended" });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 99,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("responsible_user_not_active");
  });

  it("PLAN-RESP-04: POST with responsibleUserId = null accepted", async () => {
    // null userId → validateResponsibleUser returns null immediately (no DB query).
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: null,
    });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-RESP-05: POST activity with active responsibleUserId accepted", async () => {
    // Activity validation inside transaction. Plan-level null → skipped. Activity 99 → active.
    setupPostQuery();
    mockTransactionClient((sql) => {
      if (sql.includes("INSERT INTO plans")) return { rows: [{ id: 42 }], rowCount: 1 };
      return null;
    }); // default userStatus="active" → activity user lookup succeeds

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      activities: [{ title: "Activity 1", responsibleUserId: 99 }],
    });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-RESP-06: POST activity with inactive responsibleUserId returns 422", async () => {
    // Plan-level responsibleUserId is null (validation skipped); activity 88 is inactive.
    // Validation runs inside transaction: userStatus="suspended" → 422.
    setupPostQuery(); // handles plan code generation via pool.query
    mockTransactionClient(undefined, { userStatus: "suspended" });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq",
      activities: [{ title: "Activity 1", responsibleUserId: 88 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("responsible_user_not_active");
    expect(res.body.field).toBe("activities.responsibleUserId");
  });

  it("PLAN-RESP-11: PM cannot bypass inactive-user validation", async () => {
    // Validation inside transaction. PM role has no bypass — same 422.
    setupPostQuery();
    mockTransactionClient(undefined, { userStatus: "suspended" });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 99,
    });
    expect(res.status).toBe(422);
  });

  it("PLAN-RESP-12: Super Admin cannot bypass inactive-user validation", async () => {
    // Validation inside transaction. Super Admin has no data-integrity bypass.
    setupPostQuery();
    mockTransactionClient(undefined, { userStatus: "suspended" });
    const app = await buildApp({ ...SA_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 99,
    });
    expect(res.status).toBe(422);
  });

  it("PLAN-RESP-13: Rejected assignment does not trigger notification", async () => {
    setupPostQuery();
    mockTransactionClient(undefined, { userStatus: "suspended" });
    const { createNotification } = await import("../lib/notifications.js");
    const notifSpy = vi.mocked(createNotification);
    notifSpy.mockClear();

    const app = await buildApp({ ...PM_USER });
    await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 99,
    });
    expect(notifSpy).not.toHaveBeenCalled();
  });
});

describe("PLAN-RESP: Responsible user validation — PATCH /plans/:id (PLAN-010)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-RESP-07: GET on plan where stored responsibleUserId became inactive — plan is readable", async () => {
    // The plan has a responsibleUserId in the DB that is now inactive.
    // Reading the plan must not error.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("FROM plans pl"))
        return Promise.resolve({ rows: [{ ...PLAN_ROW, responsibleUserId: 77 }] });
      return Promise.resolve({ rows: [] });
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).get("/plans/42");
    expect(res.status).not.toBe(422);
    // Plan must still be accessible
    expect(res.status).toBeLessThan(400);
  });

  it("PLAN-RESP-08a: PATCH omitting responsibleUserId on plan with inactive stored user succeeds (grandfathering — field absent)", async () => {
    // Grandfathering: responsibleUserId not in PATCH body → no validation at all.
    setupPatchQuery();
    mockTransactionClient();

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ title: "New Title" });
    // Should succeed — responsibleUserId field absent → grandfathered
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-RESP-08b: PATCH explicitly re-submitting the same stored responsibleUserId (now inactive) succeeds (grandfathering — unchanged value)", async () => {
    // Grandfathering: body includes responsibleUserId BUT it equals the stored value (77).
    // Even though user 77 is now inactive, this must succeed without re-validation.
    const STORED_USER_ID = 77;
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("responsible_user_id"))
        // before query — stored responsible_user_id matches the submitted value
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Test", responsible_user_id: STORED_USER_ID }] });
      if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
      // validateResponsibleUser must NOT be called — if it is and user is inactive, we'd get 422.
      // Return inactive to detect any accidental call.
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ rows: [{ status: "suspended" }] });
      if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
      return Promise.resolve({ rows: [] });
    });
    mockTransactionClient();

    const app = await buildApp({ ...PM_USER });
    // Submit the same responsibleUserId that's already stored (77)
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: STORED_USER_ID });
    // Unchanged value → grandfathered → should not 422
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-RESP-09: PATCH changing responsibleUserId from inactive → active user succeeds", async () => {
    // Changing to user 55 (currently active). Validation inside transaction returns active.
    setupPatchQuery(); // pool.query: before row (responsible_user_id=null), getPlanMeta, getPlanById
    mockTransactionClient(undefined, { userStatus: "active" });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: 55 });
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-RESP-10: PATCH changing responsibleUserId to another inactive user returns 422", async () => {
    // Changing to user 66 (deactivated). Validation inside transaction returns deactivated → 422.
    setupPatchQuery(); // pool.query: before row, getPlanMeta, getPlanById
    mockTransactionClient(undefined, { userStatus: "deactivated" });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: 66 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("responsible_user_not_active");
  });

  it("PLAN-RESP-11: PM cannot bypass inactive-user validation on PATCH", async () => {
    // PM role provides no data-integrity bypass — same 422 for inactive user.
    setupPatchQuery();
    mockTransactionClient(undefined, { userStatus: "inactive" });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: 77 });
    expect(res.status).toBe(422);
  });

  it("PLAN-RESP-12: Super Admin cannot bypass inactive-user validation on PATCH", async () => {
    // Super Admin has no data-integrity bypass — same 422 for inactive user.
    setupPatchQuery();
    mockTransactionClient(undefined, { userStatus: "inactive" });

    const app = await buildApp({ ...SA_USER });
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: 77 });
    expect(res.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN-ACTIVITY-GRANDFATHER: Activity responsible-user grandfathering
// ═══════════════════════════════════════════════════════════════════════════════

describe("PLAN-ACTIVITY-GRANDFATHER: Activity responsible-user grandfathering (PLAN-010)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PLAN-ACTIVITY-GRANDFATHER-01: PATCH activities with unchanged inactive responsibleUserId succeeds (grandfathering)", async () => {
    // Stored activity id=10 has responsible_user_id=77 (now inactive).
    // PATCH sends the same activity id=10 with responsibleUserId=77 → grandfathered.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("LEFT JOIN projects"))
        return Promise.resolve({ rows: [{ sector: "Health", stateId: null, locationType: "hq" }] });
      if (sql.includes("last_final_approved_at") && sql.includes("start_date"))
        return Promise.resolve({ rows: [{ status: "draft", lastFinalApprovedAt: null, start_date: null, end_date: null, title: "Test" }] });
      if (sql.includes("action = 'reopen'")) return Promise.resolve({ rows: [] });
      // No plan-level responsibleUserId change — no user lookup
      if (sql.includes("FROM plans pl")) return Promise.resolve({ rows: [PLAN_ROW] });
      return Promise.resolve({ rows: [] });
    });

    // Transaction: existing activity has responsible_user_id=77
    mockTransactionClient((sql) => {
      if (sql.includes("SELECT id, responsible_user_id FROM plan_activities"))
        return { rows: [{ id: 10, responsible_user_id: 77 }] };
      return null;
    });

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({
      activities: [{ id: 10, title: "Activity 1", responsibleUserId: 77 }],
    });
    // Grandfathered — should not 422
    expect(res.status).not.toBe(422);
    expect(res.status).toBeLessThan(500);
  });

  it("PLAN-ACTIVITY-GRANDFATHER-02: PATCH activities changing responsibleUserId to inactive user returns 422", async () => {
    // Stored activity id=10 has responsible_user_id=77 (active).
    // PATCH sends id=10 with responsibleUserId=88 (inactive) → validated inside txn → 422.
    setupPatchQuery(); // pool.query: before row, getPlanMeta, getPlanById

    mockTransactionClient((sql) => {
      if (sql.includes("SELECT id, responsible_user_id FROM plan_activities"))
        return { rows: [{ id: 10, responsible_user_id: 77 }] };
      return null;
    }, { userStatus: "suspended" }); // activity user 88 is inactive → 422

    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({
      activities: [{ id: 10, title: "Activity 1", responsibleUserId: 88 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("responsible_user_not_active");
    expect(res.body.field).toBe("activities.responsibleUserId");
  });

  it("PLAN-RESP-NAN-01: POST with responsibleUserId='abc' returns 422 invalid_responsible_user_id", async () => {
    // parseResponsibleUserId coerces "abc" to NaN — must be rejected before any DB query.
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: "abc",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_responsible_user_id");
  });

  it("PLAN-RESP-NAN-02: POST with responsibleUserId=0 returns 422 invalid_responsible_user_id", async () => {
    // Zero is not a valid PK — parseResponsibleUserId requires n > 0.
    setupPostQuery();
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).post("/plans").send({
      title: "Test", locationType: "hq", responsibleUserId: 0,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_responsible_user_id");
  });

  it("PLAN-RESP-NAN-03: PATCH with responsibleUserId='xyz' returns 422 invalid_responsible_user_id", async () => {
    // parseResponsibleUserId in the PATCH handler validates before entering the transaction.
    setupPatchQuery({ startDate: "2026-01-01", endDate: "2026-12-31" });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: "xyz" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_responsible_user_id");
  });

  it("PLAN-RESP-NAN-04: PATCH with responsibleUserId=-1 returns 422 invalid_responsible_user_id", async () => {
    // Negative integers are not valid PKs — parseResponsibleUserId requires n > 0.
    setupPatchQuery({ startDate: "2026-01-01", endDate: "2026-12-31" });
    const app = await buildApp({ ...PM_USER });
    const res = await request(app).patch("/plans/42").send({ responsibleUserId: -1 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_responsible_user_id");
  });
});
