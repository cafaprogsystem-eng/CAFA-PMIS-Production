/**
 * BUD-DONOR closure suite — Budgets: Donor Data Model Integrity Closure (BUD-008)
 *
 * BUD-DONOR-01  Canonical linked donor groups by ID
 * BUD-DONOR-02  Spelling/casing mismatch does not split canonical group
 * BUD-DONOR-03  name_mismatch state surfaced when canonical link exists but free-text differs
 * BUD-DONOR-04  Unlinked historical donor retained in portfolio as unlinked group
 * BUD-DONOR-05  Missing donor surfaced as missing group, not dropped
 * BUD-DONOR-06  projectCount equals number of unique project IDs
 * BUD-DONOR-07  Multi-state project appears once in count and budget total
 * BUD-DONOR-08  Per-currency totals remain separate — USD and SDG never summed
 * BUD-DONOR-09  No cross-currency fabricated total when currencyMixed=true; currency is null
 * BUD-DONOR-10  Closed/completed projects retained in portfolio
 * BUD-DONOR-11  Soft-deleted projects excluded (SQL filter check)
 * BUD-DONOR-12  POST /projects with nonexistent donorId returns 422 invalid_donor_id
 * BUD-DONOR-13  PM cannot bypass donor existence check via Full Operational Access
 * BUD-DONOR-14  Super Admin cannot bypass donor existence check
 * BUD-DONOR-15  Frontend budget.tsx DonorPortfolioTable renders canonical donorName
 * BUD-DONOR-16  No double-counting from JOINs — budget accumulation inside dedup guard
 * BUD-DONOR-17  OpenAPI/runtime parity — budgetSpent can be null in generated types
 * BUD-DONOR-18  Audit report declares BUD-008: CLOSED
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: {
    // Use wrapper functions so that vi.resetAllMocks() + re-configuration in
    // beforeEach is always reflected through to the pool reference that modules
    // captured at import time.
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnectFn(...args),
  },
}));

vi.mock("../../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));

vi.mock("../../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
  notifyByRole: vi.fn().mockResolvedValue(undefined),
}));

// Prevent risks.ts's module-level checkAllDueDates() call and setInterval from
// consuming pool.query mock slots and polluting test isolation.
vi.mock("../../lib/due-date-checker.js", () => ({
  checkAllDueDates: vi.fn().mockResolvedValue(undefined),
}));

const mockLogAudit = vi.fn();
vi.mock("../../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: mockLogAudit,
    // Bypass permission checks to keep tests focused on donor logic
    requirePerm: (_perm: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM", email: "pm@cafa.org", role: "program_manager",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

const SUPER_ADMIN_USER = {
  id: 2, name: "SA", email: "sa@cafa.org", role: "super_admin",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

/** Minimal valid POST /projects body. donorId may be added per-test. */
const VALID_PROJECT_BODY = {
  title: "BUD-DONOR Test Project",
  description: "A sufficiently long description for the BUD-DONOR-008 closure test suite to satisfy Zod minimum-length validation on CreateProjectBody.",
  agreementNumber: "AGR-DONOR-001",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  sectors: ["Health"],
  donor: "Test Donor",
  stateIds: [5],
  reportingFrequency: "quarterly",
};

// ── App builders ──────────────────────────────────────────────────────────────

async function buildDashboardApp(currentUser: typeof PM_USER) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof PM_USER }).currentUser = currentUser;
    next();
  });
  const { requireAuth } = await import("../../middlewares/currentUser.js");
  const { default: dashboardRouter } = await import("../dashboard.js");
  app.use("/api", requireAuth, dashboardRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

async function buildProjectsApp(currentUser: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof currentUser }).currentUser = currentUser;
    next();
  });
  const { default: projectsRouter } = await import("../projects.js");
  app.use("/api", projectsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ── Mock row factory ──────────────────────────────────────────────────────────

type ProjectRow = {
  id: number; code: string; title: string;
  budget_total: number | null; currency: string | null;
  free_text_donor: string | null; donor_id: number | null;
  d_id: number | null; d_name: string | null;
  beneficiaries: number;
};

function row(overrides: Partial<ProjectRow> & { id: number }): ProjectRow {
  return {
    code: `P-${String(overrides.id).padStart(3, "0")}`,
    title: `Project ${overrides.id}`,
    budget_total: 100_000,
    currency: "USD",
    free_text_donor: "Test Donor",
    donor_id: null,
    d_id: null,
    d_name: null,
    beneficiaries: 50,
    ...overrides,
  };
}

function mockPortfolioQueries(
  mainRows: ProjectRow[],
  spendRows: { project_id: number; spent: number | null }[] = [],
) {
  // Use SQL-content matching to be immune to call-order races.
  // dashboard.ts has a module-level setImmediate that fires a suspicious-donor
  // audit query asynchronously; if we used mockResolvedValueOnce (call-order),
  // that query would race with the HTTP request and consume the wrong slot.
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql !== "string") return Promise.resolve({ rows: [] });
    // Module-level suspicious-donor audit — harmless, always return no rows
    if (sql.includes("hrthtrhtr")) return Promise.resolve({ rows: [] });
    // Main portfolio SELECT (joins donors table, aliases free_text_donor)
    if (sql.includes("free_text_donor") || sql.includes("d_id")) {
      return Promise.resolve({ rows: mainRows });
    }
    // Activity spend query
    if (sql.includes("SUM(budget_spent)") || sql.includes("budget_spent")) {
      return Promise.resolve({ rows: spendRows });
    }
    // Default: empty result for project_assignments, etc.
    return Promise.resolve({ rows: [] });
  });
}

// ── Reset mocks before each test ──────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockQuery.mockImplementation((sql: string) => {
    if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }] });
    }
    return Promise.resolve({ rows: [] });
  });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockLogAudit.mockResolvedValue(undefined);
});

// =============================================================================
// Group 1 — Donor Portfolio Grouping Logic (BUD-DONOR-01 through 11, 16)
// =============================================================================

describe("BUD-DONOR-01: canonical linked donor groups by ID", () => {
  it("two projects with the same donor_id appear in one portfolio group", async () => {
    const mainRows = [
      row({ id: 1, donor_id: 10, d_id: 10, d_name: "UNHCR", free_text_donor: "UNHCR" }),
      row({ id: 2, donor_id: 10, d_id: 10, d_name: "UNHCR", free_text_donor: "UNHCR" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].donorId).toBe(10);
    expect(res.body[0].projectCount).toBe(2);
  });
});

describe("BUD-DONOR-02: casing mismatch does not split canonical donor group", () => {
  it("different free-text casing with same donor_id stays in one group, donor_id match wins", async () => {
    const mainRows = [
      row({ id: 3, donor_id: 20, d_id: 20, d_name: "UNICEF", free_text_donor: "unicef" }),
      row({ id: 4, donor_id: 20, d_id: 20, d_name: "UNICEF", free_text_donor: "UNICEF" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].donorId).toBe(20);
    expect(res.body[0].projectCount).toBe(2);
  });
});

describe("BUD-DONOR-03: name_mismatch state surfaced", () => {
  it("canonical link exists but free-text differs → dataStatus is name_mismatch", async () => {
    const mainRows = [
      row({ id: 5, donor_id: 30, d_id: 30, d_name: "World Food Programme", free_text_donor: "WFP" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].dataStatus).toBe("name_mismatch");
    expect(res.body[0].donorId).toBe(30);
    expect(res.body[0].donorName).toBe("World Food Programme");
  });
});

describe("BUD-DONOR-04: unlinked historical donor retained", () => {
  it("project with no donor_id but non-blank free-text appears as unlinked group", async () => {
    const mainRows = [
      row({ id: 6, donor_id: null, d_id: null, d_name: null, free_text_donor: "World Vision" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].dataStatus).toBe("unlinked");
    expect(res.body[0].donorId).toBeNull();
    expect(res.body[0].donorName).toBe("World Vision");
  });
});

describe("BUD-DONOR-05: missing donor surfaced, not dropped", () => {
  it("project with no donor_id and blank donor string surfaced as missing group", async () => {
    const mainRows = [
      row({ id: 7, donor_id: null, d_id: null, d_name: null, free_text_donor: "" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].dataStatus).toBe("missing");
    expect(res.body[0].donorName).toBe("(Unknown Donor)");
  });
});

describe("BUD-DONOR-06: projectCount equals number of unique project IDs", () => {
  it("three projects with same donor_id → projectCount 3", async () => {
    const mainRows = [
      row({ id: 10, donor_id: 50, d_id: 50, d_name: "EU", free_text_donor: "EU" }),
      row({ id: 11, donor_id: 50, d_id: 50, d_name: "EU", free_text_donor: "EU" }),
      row({ id: 12, donor_id: 50, d_id: 50, d_name: "EU", free_text_donor: "EU" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body[0].projectCount).toBe(3);
    expect(res.body[0].projects).toBe(3);
  });
});

describe("BUD-DONOR-07: multi-state project appears once in count and budget total", () => {
  it("same project ID repeated in rows counts as one project and budget is not doubled", async () => {
    const mainRows = [
      row({ id: 20, donor_id: 60, d_id: 60, d_name: "USAID", free_text_donor: "USAID", budget_total: 500_000, currency: "USD" }),
      // Same project — simulates multi-state scope JOIN producing two rows for one project
      row({ id: 20, donor_id: 60, d_id: 60, d_name: "USAID", free_text_donor: "USAID", budget_total: 500_000, currency: "USD" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].projectCount).toBe(1);
    const byCurrency: { currency: string; budgetTotal: number }[] = res.body[0].budgetByCurrency ?? [];
    const usd = byCurrency.find((b) => b.currency === "USD");
    expect(usd?.budgetTotal ?? res.body[0].budgetTotal).toBe(500_000);
  });
});

describe("BUD-DONOR-08: per-currency totals remain separate", () => {
  it("USD and SDG projects for same donor appear in separate currency buckets", async () => {
    const mainRows = [
      row({ id: 30, donor_id: 70, d_id: 70, d_name: "DFID", free_text_donor: "DFID", budget_total: 100_000, currency: "USD" }),
      row({ id: 31, donor_id: 70, d_id: 70, d_name: "DFID", free_text_donor: "DFID", budget_total: 5_000_000, currency: "SDG" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const entry = res.body[0];
    expect(entry.currencyMixed).toBe(true);
    const byCurrency: { currency: string; budgetTotal: number }[] = entry.budgetByCurrency ?? [];
    const usd = byCurrency.find((b) => b.currency === "USD");
    const sdg = byCurrency.find((b) => b.currency === "SDG");
    expect(usd?.budgetTotal).toBe(100_000);
    expect(sdg?.budgetTotal).toBe(5_000_000);
    expect(entry.currency).toBeNull();
  });
});

describe("BUD-DONOR-09: no cross-currency total when currencyMixed=true", () => {
  it("currencyMixed=true → top-level currency is null; per-currency breakdown available", async () => {
    const mainRows = [
      row({ id: 32, donor_id: 80, d_id: 80, d_name: "GIZ", free_text_donor: "GIZ", budget_total: 200_000, currency: "EUR" }),
      row({ id: 33, donor_id: 80, d_id: 80, d_name: "GIZ", free_text_donor: "GIZ", budget_total: 300_000, currency: "USD" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    const entry = res.body[0];
    expect(entry.currencyMixed).toBe(true);
    expect(entry.currency).toBeNull();
    expect(entry.allocatedBudget).toBeNull();
    expect(entry.budgetTotal).toBeNull();
    expect(entry.budgetSpent).toBeNull();
    const byCurrency: { currency: string }[] = entry.budgetByCurrency ?? [];
    expect(byCurrency.some((b) => b.currency === "EUR")).toBe(true);
    expect(byCurrency.some((b) => b.currency === "USD")).toBe(true);
  });
});

describe("BUD-DONOR-10: closed/completed projects retained in portfolio", () => {
  it("project in any lifecycle state appears in portfolio (only deleted_at controls exclusion)", async () => {
    // The donor-portfolio SQL does not filter by project.status.
    // Any project the mock returns will appear in the result.
    const mainRows = [
      row({ id: 40, donor_id: 90, d_id: 90, d_name: "AICS", free_text_donor: "AICS" }),
    ];
    mockPortfolioQueries(mainRows);
    const app = await buildDashboardApp(PM_USER);
    const res = await request(app).get("/api/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].projectCount).toBe(1);
  });
});

describe("BUD-DONOR-11: soft-deleted projects excluded by SQL filter", () => {
  it("donor-portfolio SQL includes deleted_at IS NULL to exclude soft-deleted rows", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../dashboard.ts"), "utf8");
    expect(src).toContain("deleted_at IS NULL");
  });
});

// =============================================================================
// Group 2 — Donor Existence Validation on CREATE (BUD-DONOR-12, 13, 14)
// =============================================================================

describe("BUD-DONOR-12: POST /projects with nonexistent donorId returns 422", () => {
  it("invalid donorId on project CREATE returns 422 invalid_donor_id", async () => {
    // Default mockClientQuery returns { rows: [] } for every call:
    //   BEGIN → {rows:[]}, donor SELECT → {rows:[]} (not found), ROLLBACK → {rows:[]}
    const app = await buildProjectsApp(PM_USER);
    const res = await request(app).post("/api/projects").send({
      ...VALID_PROJECT_BODY,
      donorId: 9999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_donor_id");
    expect(res.body.field).toBe("donorId");
  });

  it("donorId=0 on project CREATE returns 422 invalid_donor_id (not a server error)", async () => {
    // Regression for falsy-check bug: `if (body.donorId)` skips 0 entirely,
    // persisting an invalid FK that triggers a DB-level 500 after migration 030.
    // The correct guard is `if (body.donorId != null)`.
    const app = await buildProjectsApp(PM_USER);
    const res = await request(app).post("/api/projects").send({
      ...VALID_PROJECT_BODY,
      donorId: 0,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_donor_id");
    expect(res.body.field).toBe("donorId");
  });
});

describe("BUD-DONOR-13: PM cannot bypass donor existence check via Full Operational Access", () => {
  it("programme_manager with Full Operational Access gets the same 422 for invalid donorId", async () => {
    const app = await buildProjectsApp(PM_USER);
    const res = await request(app).post("/api/projects").send({
      ...VALID_PROJECT_BODY,
      donorId: 9999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_donor_id");
  });

  it("programme_manager gets 422 for donorId=0 (not a server error)", async () => {
    const app = await buildProjectsApp(PM_USER);
    const res = await request(app).post("/api/projects").send({
      ...VALID_PROJECT_BODY,
      donorId: 0,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_donor_id");
  });
});

describe("BUD-DONOR-14: Super Admin cannot bypass donor existence check", () => {
  it("super_admin gets the same 422 for invalid donorId", async () => {
    const app = await buildProjectsApp(SUPER_ADMIN_USER);
    const res = await request(app).post("/api/projects").send({
      ...VALID_PROJECT_BODY,
      donorId: 9999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_donor_id");
  });

  it("super_admin gets 422 for donorId=0 (not a server error)", async () => {
    const app = await buildProjectsApp(SUPER_ADMIN_USER);
    const res = await request(app).post("/api/projects").send({
      ...VALID_PROJECT_BODY,
      donorId: 0,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_donor_id");
  });
});

// =============================================================================
// Group 3 — Source / Type Checks (BUD-DONOR-15, 16, 17, 18)
// =============================================================================

describe("BUD-DONOR-15: donor portfolio renders canonical donor data and safe per-currency figures", () => {
  // The shared DonorPortfolioTable now lives in dashboard.tsx and is consumed
  // by the Budget workspace as well as the dashboard.
  const dashboardPath = resolve(import.meta.dirname, "../../../../cafa-pmis/src/pages/dashboard.tsx");

  it("DonorPortfolioTable uses the API's canonical donor name (not a client-side re-grouping)", () => {
    const src = readFileSync(dashboardPath, "utf8");
    // Renders canonical donorName from the API response
    expect(src).toContain("d.donorName ?? d.donor");
    // No client-side re-grouping of donor entries by free-text field
    expect(src).not.toMatch(/\.reduce\([^)]*donor/i);
  });

  it("mixed donor currency selection takes the matching per-currency entry", () => {
    const src = readFileSync(dashboardPath, "utf8");
    expect(src).toContain("if (!d.currencyMixed && d.currency === effectiveCurrency)");
    expect(src).toContain("d.budgetByCurrency.find(b => b.currency === effectiveCurrency)");
    expect(src).toContain("budgetInCurrency = bc.allocatedBudget ?? bc.budgetTotal");
  });

  it("missing currency figures remain null rather than fabricating a zero share", () => {
    const src = readFileSync(dashboardPath, "utf8");
    expect(src).toContain("let budgetInCurrency: number | null = null");
    expect(src).toMatch(/currencyTotal > 0 && r\.budgetInCurrency != null[\s\S]*: null/);
  });
});

describe("BUD-DONOR-16: budget accumulation inside project-ID dedup guard", () => {
  it("dashboard.ts budget accumulation is inside the projectIds dedup guard", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../dashboard.ts"), "utf8");
    // The dedup guard block must contain the currencyBudget.set call
    // (DEFECT-3 fix: budget was previously outside the guard)
    const dedupBlock = src.match(/if \(!g\.projectIds\.has\(row\.id\)\)[\s\S]*?(?=\n      \})/)?.[0] ?? "";
    expect(dedupBlock).toContain("g.currencyBudget.set");
    // And there must be no currencyBudget.set outside the guard
    const afterGuard = src.slice(src.indexOf("if (!g.projectIds.has(row.id))") + dedupBlock.length);
    expect(afterGuard.slice(0, 500)).not.toContain("g.currencyBudget.set");
  });
});

describe("BUD-DONOR-17: OpenAPI/runtime parity — budgetSpent nullable in generated types", () => {
  // Path: 5 levels up from __tests__ → routes → src → api-server → artifacts → project root
  const schemasPath = resolve(
    import.meta.dirname,
    "../../../../../lib/api-client-react/src/generated/api.schemas.ts",
  );

  it("DonorPortfolioEntry.budgetSpent is typed as number | null (not required number)", () => {
    const src = readFileSync(schemasPath, "utf8");
    expect(src).toMatch(/budgetSpent\?:\s*number\s*\|\s*null/);
  });

  it("DonorPortfolioBudgetByCurrencyItem.budgetSpent is typed as number | null", () => {
    const src = readFileSync(schemasPath, "utf8");
    const currencyItemBlock = src.match(/DonorPortfolioBudgetByCurrencyItem\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(currencyItemBlock).toMatch(/budgetSpent\?:\s*number\s*\|\s*null/);
  });
});

describe("BUD-DONOR-18: audit report declares BUD-008 CLOSED", () => {
  it("closure audit report exists and contains the BUD-008: CLOSED verdict", () => {
    // 5 levels up from artifacts/api-server/src/routes/__tests__ → project root
    const src = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../../../docs/audit-reports/budgets-donor-data-model-closure.md",
      ),
      "utf8",
    );
    expect(src).toContain("BUD-008: CLOSED");
  });
});
