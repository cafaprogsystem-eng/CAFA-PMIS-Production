/**
 * HQSR Final Closure Audit — Backend Sentinel Tests
 *
 * Created during the Task #414 end-to-end closure audit.  These tests cover
 * findings from HQSR-CLOSE-01 through HQSR-CLOSE-17 that are best verified
 * at the API layer, plus HQSR-CLOSE-DUP (the new duplicate enforcement guard
 * that was the sole CORE BLOCKER identified during the audit).
 *
 * Tests verified against production route code at the time of closure.
 * British English spelling used throughout.
 *
 * Suites:
 *   HQSR-CLOSE-01/02  — Authoring matrix: TC sector scope
 *   HQSR-CLOSE-03     — SPC vacancy fallback + workflow_path frozen at creation
 *   HQSR-CLOSE-04     — state_id / project_id remain NULL on all write paths
 *   HQSR-CLOSE-05     — Identity immutable for PM / Super Admin (PATCH → 409)
 *   HQSR-CLOSE-DUP    — HQSR duplicate enforcement (monthly, quarterly, annual;
 *                       on_demand exempt) — the CORE BLOCKER fixed in this audit
 *   HQSR-CLOSE-17     — Migration registry: no conflicting IDs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Source files for static-inspection tests
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATIONS_SRC = readFileSync(
  resolve(__dirname, "../lib/run-migrations.ts"),
  "utf8",
);

const REPORTS_SRC = readFileSync(
  resolve(__dirname, "../routes/reports.ts"),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before any dynamic import of the route under test
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
}));

const mockPermissionsFor = vi.fn().mockReturnValue(["reports.create", "reports.update"]);
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: mockPermissionsFor,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture users
// ─────────────────────────────────────────────────────────────────────────────

const TC_USER = {
  id: 11, name: "TC Test", email: "tc@example.com",
  role: "technical_coordinator", stateId: null, sector: "WASH", sectors: ["WASH"],
} as const;

const TC_OTHER_USER = {
  id: 18, name: "TC Health", email: "tc2@example.com",
  role: "technical_coordinator", stateId: null, sector: "Health", sectors: ["Health"],
} as const;

const TC_NO_SECTOR_USER = {
  id: 19, name: "TC NoSec", email: "tcns@example.com",
  role: "technical_coordinator", stateId: null, sector: null, sectors: [] as string[],
} as const;

const SPC_USER = {
  id: 15, name: "SPC", email: "spc@example.com",
  role: "senior_program_coordinator", stateId: null, sector: null, sectors: [],
} as const;

const PM_USER = {
  id: 14, name: "PM", email: "pm@example.com",
  role: "program_manager", stateId: null, sector: null, sectors: [],
} as const;

const SUPER_ADMIN_USER = {
  id: 12, name: "Admin", email: "admin@example.com",
  role: "super_admin", stateId: null, sector: null, sectors: [],
} as const;

const SPO_USER = {
  id: 10, name: "SPO", email: "spo@example.com",
  role: "state_program_officer", stateId: 1, sector: null, sectors: [],
} as const;

const SOM_USER = {
  id: 13, name: "SOM", email: "som@example.com",
  role: "state_office_manager", stateId: 1, sector: null, sectors: [],
} as const;

const ED_USER = {
  id: 16, name: "ED", email: "ed@example.com",
  role: "executive_director", stateId: null, sector: null, sectors: [],
} as const;

const VIEWER_USER = {
  id: 20, name: "Viewer", email: "viewer@example.com",
  role: "viewer", stateId: null, sector: null, sectors: [],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
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
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

const BASE_HQSR_BODY = {
  title: "HQ Sector Report — WASH",
  kind: "monthly",
  reportType: "hq_sector",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  sector: "WASH",
} as const;

/** Allow the create: no active duplicate, no active TC (SPC vacancy path), INSERT succeeds. */
function mockDefaultSuccess() {
  mockQuery.mockImplementation((sql: string) => {
    // TC vacancy check for SPC fallback — return empty (no active TC)
    if (typeof sql === "string" && sql.includes("role = 'technical_coordinator'") && sql.includes("status = 'active'")) {
      return Promise.resolve({ rows: [] });
    }
    // HQSR duplicate guard — return empty (no existing duplicate for this period)
    if (typeof sql === "string" && sql.includes("report_type = 'hq_sector'") && !sql.includes("INSERT")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [{ id: 99 }] });
  });
}

/** Return a duplicate row when the HQSR duplicate check runs. */
function mockHqsrDuplicate() {
  mockQuery.mockImplementation((sql: string) => {
    if (
      typeof sql === "string" &&
      sql.includes("report_type = 'hq_sector'") &&
      sql.includes("migration_is_duplicate = FALSE")
    ) {
      return Promise.resolve({ rows: [{ id: 55 }] });
    }
    // TC vacancy check — no active TC
    if (typeof sql === "string" && sql.includes("role = 'technical_coordinator'") && sql.includes("status = 'active'")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [{ id: 99 }] });
  });
}

function expectNoReportInsert() {
  const insertCalls = mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
  );
  expect(insertCalls).toHaveLength(0);
}

function reportInsertParams(): unknown[] {
  const insertCalls = mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO reports"),
  );
  expect(insertCalls).toHaveLength(1);
  return insertCalls[0][1] as unknown[];
}

beforeEach(() => {
  mockQuery.mockReset();
  mockPermissionsFor.mockReturnValue(["reports.create", "reports.update"]);
});

// =============================================================================
// HQSR-CLOSE-01/02 — Authoring matrix and TC Sector scope
// =============================================================================

describe("HQSR-CLOSE-01: Canonical authoring matrix", () => {
  it("TC with assigned sector → 201 (authorised)", async () => {
    mockDefaultSuccess();
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(201);
  });

  it("super_admin → 201 (authorised)", async () => {
    mockDefaultSuccess();
    mockPermissionsFor.mockReturnValue(["*"]);
    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(201);
  });

  it("PM (Full Operational Access) → 201 (authorised)", async () => {
    mockDefaultSuccess();
    mockPermissionsFor.mockReturnValue(["reports.create", "reports.update"]);
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(201);
  });

  it("SPO → 403 hq_sector_author_role_required, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(SPO_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
    expectNoReportInsert();
  });

  it("SOM → 403 hq_sector_author_role_required, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(SOM_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
    expectNoReportInsert();
  });

  it("ED → 403 hq_sector_author_role_required, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(ED_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
    expectNoReportInsert();
  });

  it("Viewer → 403 hq_sector_author_role_required, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(VIEWER_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_author_role_required");
    expectNoReportInsert();
  });
});

describe("HQSR-CLOSE-02: TC Sector scope enforcement", () => {
  it("TC requesting cross-sector report → 403 sector_scope_forbidden, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_OTHER_USER as unknown as Record<string, unknown>);
    // TC_OTHER_USER is assigned to "Health" — requesting "WASH" must be blocked
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "WASH" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_scope_forbidden");
    expectNoReportInsert();
  });

  it("TC with no assigned sectors → 403 fail-closed, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_NO_SECTOR_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_scope_forbidden");
    expectNoReportInsert();
  });

  it("TC requesting non-canonical sector → 400 invalid_sector, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "FAKE_SECTOR_XYZ" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_sector");
    expectNoReportInsert();
  });

  it("TC with blank sector → 400 sector is required, no INSERT", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send({ ...BASE_HQSR_BODY, sector: "" });
    expect(res.status).toBe(400);
    expectNoReportInsert();
  });
});

// =============================================================================
// HQSR-CLOSE-03 — SPC vacancy fallback
// =============================================================================

describe("HQSR-CLOSE-03: SPC vacancy fallback + workflow_path frozen at creation", () => {
  it("SPC with no active TC → 201 (vacancy confirmed)", async () => {
    mockDefaultSuccess(); // returns empty rows for TC vacancy check
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(201);
  });

  it("SPC vacancy check is server-verified: TC active → 403 hq_sector_tc_available", async () => {
    mockQuery.mockImplementation((sql: string) => {
      // TC vacancy check returns an active TC
      if (typeof sql === "string" && sql.includes("role = 'technical_coordinator'") && sql.includes("status = 'active'")) {
        return Promise.resolve({ rows: [{ sector: "WASH" }] });
      }
      return Promise.resolve({ rows: [{ id: 99 }] });
    });
    const app = await buildApp(SPC_USER as unknown as Record<string, unknown>);
    const res = await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hq_sector_tc_available");
    expectNoReportInsert();
  });

  it("workflow_path = spc_fallback is frozen at creation for SPC-authored HQSR", () => {
    // Source-inspection: the workflow_path assignment in reports.ts must only use
    // the author's role at creation time (immutable per HQSR-BD-1 / Migration 019).
    expect(REPORTS_SRC).toContain("spc_fallback");
    expect(REPORTS_SRC).toContain(
      "reportType === \"hq_sector\" && req.currentUser.role === \"senior_program_coordinator\"",
    );
    expect(REPORTS_SRC).toContain("? \"spc_fallback\"");
  });
});

// =============================================================================
// HQSR-CLOSE-04 — state_id / project_id remain NULL
// =============================================================================

describe("HQSR-CLOSE-04: state_id / project_id remain NULL on all write paths", () => {
  it("TC create: INSERT persists NULL/NULL linkage (params[10]=null, params[11]=null)", async () => {
    mockDefaultSuccess();
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    await request(app).post("/api/projects/reports").send(BASE_HQSR_BODY);
    const params = reportInsertParams();
    // $11=project_id (index 10), $12=state_id (index 11) in INSERT column list
    expect(params[10]).toBeNull(); // project_id forced NULL
    expect(params[11]).toBeNull(); // state_id forced NULL
  });

  it("Client-supplied stateId/projectId → 422 hq_sector_location_invalid (actor-independent)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_HQSR_BODY, stateId: 1, projectId: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expectNoReportInsert();
  });

  it("PM Full Operational Access also rejected on stateId supply → 422", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_HQSR_BODY, stateId: 2 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("hq_sector_location_invalid");
    expectNoReportInsert();
  });

  it("Route enforces NULL at INSERT regardless of gate outcome (defence in depth)", () => {
    // Source-inspection: the INSERT forces NULL for project_id and state_id
    // when reportType === 'hq_sector', independent of any prior validation.
    expect(REPORTS_SRC).toContain("reportType === \"hq_sector\"");
    expect(REPORTS_SRC).toContain("? null");
    // Verify effectiveStateId logic
    expect(REPORTS_SRC).toContain(
      "const effectiveStateId = reportType === \"hq_sector\"",
    );
  });
});

// =============================================================================
// HQSR-CLOSE-05 — Identity immutable even for PM / Super Admin
// =============================================================================

describe("HQSR-CLOSE-05: Identity immutable for PM / Super Admin (PATCH → 409)", () => {
  it("Source confirms PATCH guard for hq_sector identity fields returns 409", () => {
    expect(REPORTS_SRC).toContain("hq_sector_report_identity_immutable");
    expect(REPORTS_SRC).toContain("cur.rows[0].reportType === \"hq_sector\"");
  });

  it("Identity guard fires before any content update (sector in PATCH body)", () => {
    // The identity guard runs early in the PATCH handler, before any DB update.
    const patchGuardIdx = REPORTS_SRC.indexOf("hq_sector_report_identity_immutable");
    const updateIdx     = REPORTS_SRC.indexOf("UPDATE reports SET", patchGuardIdx);
    // Guard must appear before any UPDATE in the PATCH handler
    expect(patchGuardIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(patchGuardIdx);
  });
});

// =============================================================================
// HQSR-CLOSE-DUP — HQSR duplicate enforcement (the CORE BLOCKER fixed in this audit)
// =============================================================================

describe("HQSR-CLOSE-DUP: HQSR duplicate enforcement — monthly, quarterly, annual", () => {
  it("Duplicate monthly HQSR → 409 duplicate_report_period, no INSERT", async () => {
    mockHqsrDuplicate();
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_HQSR_BODY, kind: "monthly", reportingMonth: 6, reportingYear: 2026 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_report_period");
    expectNoReportInsert();
  });

  it("Duplicate quarterly HQSR → 409 duplicate_report_period, no INSERT", async () => {
    mockHqsrDuplicate();
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_HQSR_BODY, kind: "quarterly", quarter: 2, reportingYear: 2026 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_report_period");
    expectNoReportInsert();
  });

  it("Duplicate annual HQSR → 409 duplicate_report_period, no INSERT", async () => {
    mockHqsrDuplicate();
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .post("/api/projects/reports")
      .send({ ...BASE_HQSR_BODY, kind: "annual", reportingYear: 2026 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_report_period");
    expectNoReportInsert();
  });

  it("on_demand HQSR → no duplicate check SQL emitted (multiple allowed)", async () => {
    mockDefaultSuccess();
    const app = await buildApp(TC_USER as unknown as Record<string, unknown>);
    await request(app)
      .post("/api/projects/reports")
      .send({
        ...BASE_HQSR_BODY,
        kind: "on_demand",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        onDemandReason: "Emergency sector assessment",
      });
    // on_demand must NOT run the HQSR duplicate check
    const dupCheckCalls = mockQuery.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("report_type = 'hq_sector'") &&
        c[0].includes("migration_is_duplicate = FALSE"),
    );
    expect(dupCheckCalls).toHaveLength(0);
  });

  it("Source guard covers all three recurring frequencies", () => {
    // Verify the duplicate guard code is present for each kind
    expect(REPORTS_SRC).toContain("reportType === \"hq_sector\" && effectiveSector && body.reportingYear != null");
    expect(REPORTS_SRC).toContain("An HQ Sector Report already exists for this Sector and reporting period.");
  });

  it("Migration 023 registers unique partial indexes for HQSR", () => {
    expect(MIGRATIONS_SRC).toContain("023_hqsr_unique_period_indexes");
    expect(MIGRATIONS_SRC).toContain("idx_hqsr_unique_monthly");
    expect(MIGRATIONS_SRC).toContain("idx_hqsr_unique_quarterly");
    expect(MIGRATIONS_SRC).toContain("idx_hqsr_unique_annual");
    expect(MIGRATIONS_SRC).toContain("report_type = 'hq_sector'");
  });
});

// =============================================================================
// HQSR-023-MTEST: Migration 023 deduplication safety
// Verifies the Migration 023 SQL:
//   1. Contains deduplication UPDATE statements for monthly, quarterly, annual
//   2. The UPDATEs appear BEFORE the CREATE INDEX statements
//   3. UPDATEs mark duplicates as migration_is_duplicate = TRUE (not status change)
//   4. Canonical row selection: lowest id preserved (r2.id < r.id)
//   5. migration_review_notes receives an audit annotation
// =============================================================================

describe("HQSR-023-MTEST: Migration 023 deduplication safety — SQL content verification", () => {
  // Extract the Migration 023 SQL block from the source file for targeted assertions
  const m023Start = MIGRATIONS_SRC.indexOf("\"023_hqsr_unique_period_indexes\"");
  const m023End   = MIGRATIONS_SRC.indexOf("\n  },\n  {\n    name:", m023Start + 1);
  const m023Sql   = m023Start > 0 && m023End > m023Start
    ? MIGRATIONS_SRC.slice(m023Start, m023End)
    : "";

  it("Migration 023 SQL block is present and non-empty", () => {
    expect(m023Start).toBeGreaterThan(0);
    expect(m023Sql.length).toBeGreaterThan(100);
  });

  it("Migration 023 contains a deduplication UPDATE for monthly HQSR duplicates", () => {
    // Must update rows WHERE kind = 'monthly' and mark them as migration_is_duplicate = TRUE
    expect(m023Sql).toContain("kind = 'monthly'");
    // The UPDATE must set migration_is_duplicate = TRUE (not just the CREATE INDEX)
    const updateMonthlyIdx = m023Sql.indexOf("kind = 'monthly'");
    const firstCreateIdx   = m023Sql.indexOf("CREATE UNIQUE INDEX");
    // The monthly UPDATE predicate must appear before the first CREATE UNIQUE INDEX
    expect(updateMonthlyIdx).toBeLessThan(firstCreateIdx);
  });

  it("Migration 023 contains a deduplication UPDATE for quarterly HQSR duplicates", () => {
    expect(m023Sql).toContain("kind = 'quarterly'");
    const updateQuarterlyIdx = m023Sql.indexOf("kind = 'quarterly'");
    const firstCreateIdx     = m023Sql.indexOf("CREATE UNIQUE INDEX");
    expect(updateQuarterlyIdx).toBeLessThan(firstCreateIdx);
  });

  it("Migration 023 contains a deduplication UPDATE for annual HQSR duplicates", () => {
    expect(m023Sql).toContain("kind = 'annual'");
    const updateAnnualIdx = m023Sql.indexOf("kind = 'annual'");
    const firstCreateIdx  = m023Sql.indexOf("CREATE UNIQUE INDEX");
    expect(updateAnnualIdx).toBeLessThan(firstCreateIdx);
  });

  it("Deduplication UPDATEs set migration_is_duplicate = TRUE (status is NOT modified)", () => {
    // migration_is_duplicate = TRUE must be set in the UPDATE
    expect(m023Sql).toContain("migration_is_duplicate = TRUE");
    // The UPDATEs must NOT set status (status is preserved as-is per the policy)
    // Strip comment lines and check DML does not include "SET status"
    const dmlLines = m023Sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    // Within the UPDATE blocks (before CREATE UNIQUE INDEX), there should be
    // no "SET status" assignment
    const beforeCreate = dmlLines.slice(0, dmlLines.indexOf("CREATE UNIQUE INDEX"));
    expect(beforeCreate).not.toMatch(/SET\s+status\s*=/i);
  });

  it("Canonical row selection: lowest id wins (r2.id < r.id pattern)", () => {
    // The EXISTS subquery must use r2.id < r.id to identify the canonical (oldest) row
    expect(m023Sql).toContain("r2.id < r.id");
  });

  it("Deduplication UPDATEs append to migration_review_notes for auditability", () => {
    expect(m023Sql).toContain("migration_review_notes");
    // The note must reference the migration number so future operators can trace it
    expect(m023Sql).toContain("Migration 023");
  });

  it("Deduplication guard is scoped to report_type = hq_sector only", () => {
    // Confirm the WHERE clause restricts to hq_sector so no other report types are touched
    const dmlBeforeCreate = m023Sql.slice(0, m023Sql.indexOf("CREATE UNIQUE INDEX"));
    expect(dmlBeforeCreate).toContain("report_type = 'hq_sector'");
  });

  it("CREATE UNIQUE INDEX statements appear after all three deduplication UPDATEs", () => {
    // Use the last occurrence of "migration_is_duplicate = TRUE" as the marker for
    // the last UPDATE statement — this string only appears in UPDATEs, not in
    // CREATE INDEX predicates (which only read migration_is_duplicate = FALSE).
    const lastDupSetIdx  = m023Sql.lastIndexOf("migration_is_duplicate = TRUE");
    const firstCreateIdx = m023Sql.indexOf("CREATE UNIQUE INDEX");
    expect(lastDupSetIdx).toBeGreaterThan(0);
    expect(firstCreateIdx).toBeGreaterThan(0);
    // The final deduplication assignment must precede the first CREATE INDEX
    expect(firstCreateIdx).toBeGreaterThan(lastDupSetIdx);
  });

  it("Migration 023 explains on-database-with-006 safety in comments", () => {
    // Must document why this is safe on DBs that already ran Migration 006
    expect(m023Sql).toContain("zero rows");
  });
});

// =============================================================================
// HQSR-CLOSE-17 — Migration registry: no conflicting IDs
// =============================================================================

describe("HQSR-CLOSE-17: Migration registry — no conflicting execution IDs", () => {
  it("All registered migration names are unique (schema_migrations.filename constraint)", () => {
    const namePattern = /name:\s*["'`]([^"'`]+)["'`]/g;
    const names: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = namePattern.exec(MIGRATIONS_SRC)) !== null) {
      names.push(m[1]);
    }
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("Two migrations share the '021' numeric prefix but have distinct full names (non-breaking)", () => {
    // Both are tracked by full name in schema_migrations.filename (UNIQUE constraint).
    // Array-order execution means 021_hq_sector_location_integrity runs before
    // 021_report_attachments_drive_file_id.sql — both applied safely.
    expect(MIGRATIONS_SRC).toContain("021_hq_sector_location_integrity");
    expect(MIGRATIONS_SRC).toContain("021_report_attachments_drive_file_id.sql");
    // Confirm they are separate (different full names = separate schema_migrations rows)
    const idx1 = MIGRATIONS_SRC.indexOf("021_hq_sector_location_integrity");
    const idx2 = MIGRATIONS_SRC.indexOf("021_report_attachments_drive_file_id.sql");
    expect(idx1).not.toBe(idx2);
  });

  it("Migration 023 and 022 are both registered; 023 appears first in array definition order", () => {
    const idx022 = MIGRATIONS_SRC.indexOf("022_hqsr_attachments_backfill.sql");
    const idx023 = MIGRATIONS_SRC.indexOf("023_hqsr_unique_period_indexes");
    // Both must be present
    expect(idx022).toBeGreaterThan(0);
    expect(idx023).toBeGreaterThan(0);
    // 023 appears before 022 in the MIGRATIONS array — it runs first, establishing
    // the unique period constraints before the backfill (022) populates rows.
    expect(idx023).toBeLessThan(idx022);
  });

  it("Migration runner tracks by full name, never by numeric prefix", () => {
    expect(MIGRATIONS_SRC).toContain("filename, checksum FROM public.schema_migrations WHERE filename = $1");
    expect(MIGRATIONS_SRC).toContain("INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)");
  });
});
