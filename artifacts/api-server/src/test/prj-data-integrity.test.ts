/**
 * PRJ Data, Analytics & Integrity Residual Closure Tests
 *
 * Covers:
 *  - PRJ-CODE-01..06  — project code concurrency (advisory lock) + DB uniqueness (PRJ-008/PRJ-018)
 *  - PRJ-MIG-01..04   — duplicate "021" migration prefix is NOT A DEFECT (PRJ-029)
 *  - PRJ-LOC-01..05   — project_localities vs project_free_localities is NOT A DEFECT (PRJ-019)
 *  - PRJ-KPI-01..05   — report-KPI canonical source / no double-counting (PRJ-034)
 *  - PRJ-DONOR-KPI-01..06 — donor portfolio canonical grouping + currency semantics
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
const mockClient = {
  query: mockClientQuery,
  release: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(mockClient),
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

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SUPER_ADMIN = {
  id: 1,
  name: "Super Admin",
  email: "sa@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_SRC = fs.readFileSync(path.join(__dirname_, "../routes/projects.ts"), "utf8");
const MIGRATIONS_SRC = fs.readFileSync(path.join(__dirname_, "../lib/run-migrations.ts"), "utf8");

async function buildProjectsApp(user: Record<string, unknown> = SUPER_ADMIN) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use(projectsRouter);
  // terminal error handler so unhandled errors become 500s, not hangs
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", detail: String((err as Error)?.message ?? err) });
  });
  return app;
}

async function buildDashboardApp(user: Record<string, unknown> = SUPER_ADMIN) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: dashboardRouter } = await import("../routes/dashboard.js");
  app.use(dashboardRouter);
  return app;
}

/** Minimal valid create-project body. */
function buildCreateBody(extra: Record<string, unknown> = {}) {
  return {
    title: "Concurrency Test Project",
    description: "D".repeat(60),
    donor: "UNICEF",
    agreementNumber: "AGR-CODE-01",
    sector: "Health",
    sectors: ["Health"],
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    hasHqOperations: true,
    reportingFrequency: "monthly",
    stateIds: [],
    outputs: [],
    ...extra,
  };
}

type Dispatch = (sql: string, params?: unknown[]) => { rows: unknown[] } | undefined;

/** Route client.query by SQL text; unmatched queries resolve { rows: [] }. */
function dispatchClientQueries(dispatch: Dispatch) {
  mockClientQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const r = dispatch(String(sql), params);
    return Promise.resolve(r ?? { rows: [] });
  });
}

/** Route pool.query by SQL text; unmatched queries resolve { rows: [] }. */
function dispatchPoolQueries(dispatch: Dispatch) {
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const r = dispatch(String(sql), params);
    return Promise.resolve(r ?? { rows: [] });
  });
}

const YEAR = new Date().getFullYear();

/** Standard happy-path create dispatch: returns the inserted project row. */
function createRouteDispatch(): Dispatch {
  return (sql) => {
    if (sql.includes("MAX(CAST(SUBSTRING")) return { rows: [{ next: 7 }] };
    if (sql.includes("INSERT INTO projects")) {
      return { rows: [{ id: 42, code: `CAFA-PROJ-${YEAR}-007`, title: "Concurrency Test Project", status: "draft" }] };
    }
    return undefined;
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-CODE — project code concurrency & uniqueness (PRJ-008 / PRJ-018)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-CODE — project code concurrency & uniqueness", () => {
  it("PRJ-CODE-01: create acquires pg_advisory_xact_lock after BEGIN and before the MAX+1 query", async () => {
    dispatchClientQueries(createRouteDispatch());
    const app = await buildProjectsApp();
    const res = await request(app).post("/projects").send(buildCreateBody());
    expect(res.status).toBe(201);

    const sqls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const beginIdx = sqls.findIndex((s) => s === "BEGIN");
    const lockIdx = sqls.findIndex((s) => s.includes("pg_advisory_xact_lock"));
    const maxIdx = sqls.findIndex((s) => s.includes("MAX(CAST(SUBSTRING"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(maxIdx).toBeGreaterThan(lockIdx);
  });

  it("PRJ-CODE-02: advisory lock key is namespaced to the current year", async () => {
    dispatchClientQueries(createRouteDispatch());
    const app = await buildProjectsApp();
    await request(app).post("/projects").send(buildCreateBody());
    const lockCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("pg_advisory_xact_lock"));
    expect(lockCall).toBeDefined();
    expect(lockCall![1]).toEqual([`project_code_${YEAR}`]);
  });

  it("PRJ-CODE-03: generated code uses the year-scoped MAX+1 sequence", async () => {
    dispatchClientQueries(createRouteDispatch());
    const app = await buildProjectsApp();
    const res = await request(app).post("/projects").send(buildCreateBody());
    expect(res.status).toBe(201);
    const insertCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO projects"));
    expect(insertCall![1]![0]).toBe(`CAFA-PROJ-${YEAR}-007`);
    const maxCall = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("MAX(CAST(SUBSTRING"));
    expect(maxCall![1]).toEqual([`CAFA-PROJ-${YEAR}-%`]);
  });

  it("PRJ-CODE-04: a 23505 on projects_code_unique is mapped to a clean 409 project_code_conflict", async () => {
    dispatchClientQueries((sql) => {
      if (sql.includes("MAX(CAST(SUBSTRING")) return { rows: [{ next: 7 }] };
      if (sql.includes("INSERT INTO projects")) {
        const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
          constraint: "projects_code_unique",
        });
        throw err;
      }
      return undefined;
    });
    const app = await buildProjectsApp();
    const res = await request(app).post("/projects").send(buildCreateBody());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "project_code_conflict" });
    const sqls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain("ROLLBACK");
  });

  it("PRJ-CODE-05: unrelated 23505 violations are NOT masked as project_code_conflict", async () => {
    dispatchClientQueries((sql) => {
      if (sql.includes("MAX(CAST(SUBSTRING")) return { rows: [{ next: 7 }] };
      if (sql.includes("INSERT INTO projects")) {
        throw Object.assign(new Error("duplicate key"), { code: "23505", constraint: "some_other_unique" });
      }
      return undefined;
    });
    const app = await buildProjectsApp();
    const res = await request(app).post("/projects").send(buildCreateBody());
    expect(res.status).toBe(500);
    expect(res.body.error).not.toBe("project_code_conflict");
  });

  it("PRJ-CODE-06: migration 024 adds the projects_code_unique constraint with duplicate remediation first", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = MIGRATIONS.find((m) => m.name === "024_project_code_unique");
    expect(mig).toBeDefined();
    const sql = mig!.sql;
    expect(sql).toContain("ADD CONSTRAINT projects_code_unique UNIQUE (code)");
    // remediation (dedup) block appears before the constraint addition
    expect(sql.indexOf("HAVING COUNT(*) > 1")).toBeGreaterThan(-1);
    expect(sql.indexOf("HAVING COUNT(*) > 1")).toBeLessThan(sql.indexOf("ADD CONSTRAINT projects_code_unique"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-DONOR-PLACEHOLDER — placeholder donor prevention
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-DONOR-PLACEHOLDER — unconfirmed donor values are rejected", () => {
  it("rejects a placeholder free-text donor before creating a project", async () => {
    const app = await buildProjectsApp();
    const res = await request(app)
      .post("/projects")
      .send(buildCreateBody({ donor: "hrthtrhtrhtr" }));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "placeholder_donor",
      field: "donor",
    });
    expect(mockClientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO projects"),
      expect.anything(),
    );
  });

  it("rejects a placeholder donor returned from the reusable donor registry", async () => {
    dispatchClientQueries((sql) => {
      if (sql.includes("SELECT name FROM donors")) return { rows: [{ name: "TBD" }] };
      return undefined;
    });
    const app = await buildProjectsApp();
    const res = await request(app)
      .post("/projects")
      .send(buildCreateBody({ donor: "UNICEF", donorId: 77 }));

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "placeholder_donor",
      field: "donorId",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-MIG — duplicate "021" migration prefix (PRJ-029, NOT A DEFECT)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-MIG — migration registry integrity (PRJ-029)", () => {
  it("PRJ-MIG-01: all full migration names are unique", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("PRJ-MIG-02: the two 021_ entries have distinct full names and both are registered", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const with021 = MIGRATIONS.filter((m) => m.name.startsWith("021_"));
    expect(with021.length).toBe(2);
    expect(with021[0].name).not.toBe(with021[1].name);
    expect(with021.map((m) => m.name).sort()).toEqual([
      "021_hq_sector_location_integrity",
      "021_report_attachments_drive_file_id.sql",
    ]);
  });

  it("PRJ-MIG-03: the runner tracks migrations by full name, not numeric prefix", () => {
    // Identity key = full migration name recorded in schema_migrations.filename
    expect(MIGRATIONS_SRC).toContain("schema_migrations WHERE filename = $1");
    expect(MIGRATIONS_SRC).toContain("INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)");
    expect(MIGRATIONS_SRC).toContain("[migration.name, checksum]");
  });

  it("PRJ-MIG-04: the forward-looking naming convention note is documented above the second 021_ entry", () => {
    const noteIdx = MIGRATIONS_SRC.indexOf("FORWARD-LOOKING CONVENTION");
    const secondIdx = MIGRATIONS_SRC.indexOf('"021_report_attachments_drive_file_id.sql"');
    expect(noteIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(noteIdx);
    expect(MIGRATIONS_SRC).toContain("NOT the identity key");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-LOC — locality table semantics & deletion coverage (PRJ-019, NOT A DEFECT)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-LOC — project_localities vs project_free_localities (PRJ-019)", () => {
  it("PRJ-LOC-01: migration 024 documents both tables' distinct roles via schema comments", async () => {
    const { MIGRATIONS } = await import("../lib/run-migrations.js");
    const mig = MIGRATIONS.find((m) => m.name === "024_project_code_unique");
    expect(mig!.sql).toContain("COMMENT ON TABLE project_free_localities");
    expect(mig!.sql).toContain("COMMENT ON TABLE project_localities");
    expect(mig!.sql).toContain("NOT a duplicate table (PRJ-019)");
  });

  const deleteDispatch: Dispatch = (sql) => {
    if (sql.includes("FOR UPDATE")) {
      return {
        rows: [{
          id: 42, code: "CAFA-PROJ-2026-007", title: "T", status: "draft",
          sector: "Health", sectors: [], deleted_at: null,
        }],
      };
    }
    if (sql.includes('to_status AS "toStatus"')) return { rows: [] }; // never approved → permanent
    if (sql.includes("AS cnt")) return { rows: [{ cnt: 0 }] };   // no protected records (activities spend / finalised reports)
    return undefined;
  };

  it("PRJ-LOC-02: permanent deletion removes rows from BOTH locality tables before deleting the project", async () => {
    dispatchClientQueries(deleteDispatch);
    const app = await buildProjectsApp();
    const res = await request(app).delete("/projects/42").send({ reason: "cleanup test project" });
    if (res.status !== 200) console.error("DELETE failed:", res.body);
    expect(res.status).toBe(200);
    expect(res.body.deletionMode).toBe("permanent");
    const sqls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const locIdx = sqls.findIndex((s) => s.includes("DELETE FROM project_localities"));
    const freeIdx = sqls.findIndex((s) => s.includes("DELETE FROM project_free_localities"));
    const projIdx = sqls.findIndex((s) => s.includes("DELETE FROM projects WHERE id"));
    expect(locIdx).toBeGreaterThan(-1);
    expect(freeIdx).toBeGreaterThan(-1);
    expect(projIdx).toBeGreaterThan(Math.max(locIdx, freeIdx)); // children first → no orphans
  });

  it("PRJ-LOC-03: permanent deletion commits after all child deletions (no orphaning partial state)", async () => {
    dispatchClientQueries(deleteDispatch);
    const app = await buildProjectsApp();
    await request(app).delete("/projects/42").send({ reason: "cleanup test project" });
    const sqls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const commitIdx = sqls.findIndex((s) => s === "COMMIT");
    const projIdx = sqls.findIndex((s) => s.includes("DELETE FROM projects WHERE id"));
    expect(commitIdx).toBeGreaterThan(projIdx);
  });

  it("PRJ-LOC-04: soft deletion preserves both locality tables (UPDATE only, no locality DELETEs)", async () => {
    dispatchClientQueries((sql) => {
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ id: 42, code: "C", title: "T", status: "active", sector: "Health", sectors: [], deleted_at: null }] };
      }
      if (sql.includes('to_status AS "toStatus"')) return { rows: [{ toStatus: "approved" }] };
      return undefined;
    });
    const app = await buildProjectsApp();
    const res = await request(app).delete("/projects/42").send({ reason: "soft delete test" });
    expect(res.status).toBe(200);
    expect(res.body.deletionMode).toBe("soft");
    const sqls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("DELETE FROM project_localities"))).toBe(false);
    expect(sqls.some((s) => s.includes("DELETE FROM project_free_localities"))).toBe(false);
    expect(sqls.some((s) => s.includes("SET deleted_at"))).toBe(true);
  });

  it("PRJ-LOC-05: registration writes free-text localities to project_free_localities only", async () => {
    dispatchClientQueries(createRouteDispatch());
    const app = await buildProjectsApp();
    const res = await request(app).post("/projects").send(buildCreateBody({ localities: ["Kass", "Nyala North"] }));
    expect(res.status).toBe(201);
    const freeInserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT INTO project_free_localities"));
    expect(freeInserts.length).toBe(2);
    expect(freeInserts[0][1]).toEqual([42, "Kass", 0]);
    // structured FK table is NOT written by the free-text registration path
    expect(mockClientQuery.mock.calls.some((c) =>
      String(c[0]).includes("INSERT INTO project_localities"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-KPI — report-KPI canonical source & no double-counting (PRJ-034)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-KPI — report-kpis canonical sources (PRJ-034)", () => {
  function kpiDispatch(opts: {
    agg?: Partial<{ reportCount: string; beneficiariesReached: string; totalPlannedBudget: string; totalActualExpenditure: string; latestPeriod: string | null }>;
    act?: Partial<{ totalActivities: string; completedActivities: string; avgPercent: string }>;
    bs?: Partial<{ onBudget: string; underBudget: string; overBudget: string }>;
  }): Dispatch {
    return (sql) => {
      if (sql.includes("FROM projects")) return { rows: [{ sector: "Health", sectors: [] }] };
      if (sql.includes('AS "reportCount"')) {
        return { rows: [{ reportCount: "0", beneficiariesReached: "0", totalPlannedBudget: "0", totalActualExpenditure: "0", latestPeriod: null, ...opts.agg }] };
      }
      if (sql.includes('AS "totalActivities"')) {
        return { rows: [{ totalActivities: "0", completedActivities: "0", avgPercent: "0", ...opts.act }] };
      }
      if (sql.includes('AS "onBudget"')) {
        return { rows: [{ onBudget: "0", underBudget: "0", overBudget: "0", ...opts.bs }] };
      }
      return undefined;
    };
  }

  it("PRJ-KPI-01: JSONB activity data only → completion % computed from JSONB source", async () => {
    dispatchPoolQueries(kpiDispatch({
      agg: { reportCount: "2" },
      act: { totalActivities: "4", completedActivities: "2", avgPercent: "55.4" },
    }));
    const app = await buildProjectsApp();
    const res = await request(app).get("/projects/42/report-kpis");
    expect(res.status).toBe(200);
    expect(res.body.activityCompletionPct).toBe(50);
    expect(res.body.avgActivityProgressPct).toBe(55);
    expect(res.body.beneficiariesReached).toBe(0);
  });

  it("PRJ-KPI-02: no report data at all → deterministic zeros/null, not an error", async () => {
    dispatchPoolQueries(kpiDispatch({}));
    const app = await buildProjectsApp();
    const res = await request(app).get("/projects/42/report-kpis");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reportCount: 0,
      beneficiariesReached: 0,
      totalPlannedBudget: 0,
      totalActualExpenditure: 0,
      burnRatePct: 0,
      totalActivities: 0,
      activityCompletionPct: 0,
      latestPeriod: null,
    });
  });

  it("PRJ-KPI-03: beneficiary columns and JSONB activities both present → each dimension from its own source", async () => {
    dispatchPoolQueries(kpiDispatch({
      agg: { reportCount: "2", beneficiariesReached: "300", totalPlannedBudget: "1000", totalActualExpenditure: "250", latestPeriod: "2026-07" },
      act: { totalActivities: "5", completedActivities: "5", avgPercent: "100" },
      bs: { onBudget: "2", underBudget: "2", overBudget: "1" },
    }));
    const app = await buildProjectsApp();
    const res = await request(app).get("/projects/42/report-kpis");
    expect(res.body.beneficiariesReached).toBe(300);   // relational reports columns
    expect(res.body.burnRatePct).toBe(25);
    expect(res.body.activityCompletionPct).toBe(100);  // JSONB activities
    expect(res.body.activitiesOverBudget).toBe(1);
    expect(res.body.latestPeriod).toBe("2026-07");
  });

  it("PRJ-KPI-04: beneficiary columns present, activities JSONB empty → beneficiary KPI computed, activity KPI zero", async () => {
    dispatchPoolQueries(kpiDispatch({
      agg: { reportCount: "1", beneficiariesReached: "120", totalPlannedBudget: "500", totalActualExpenditure: "100" },
    }));
    const app = await buildProjectsApp();
    const res = await request(app).get("/projects/42/report-kpis");
    expect(res.body.beneficiariesReached).toBe(120);
    expect(res.body.totalActivities).toBe(0);
    expect(res.body.activityCompletionPct).toBe(0);
  });

  it("PRJ-KPI-05: aggregation is additive across periods and never touches the relational activities table", async () => {
    dispatchPoolQueries(kpiDispatch({
      agg: { reportCount: "3", beneficiariesReached: "450", totalPlannedBudget: "3000", totalActualExpenditure: "1500" },
      act: { totalActivities: "9", completedActivities: "3", avgPercent: "40" },
    }));
    const app = await buildProjectsApp();
    const res = await request(app).get("/projects/42/report-kpis");
    // additive aggregate (SUM over all periods), not a last-record override
    expect(res.body.reportCount).toBe(3);
    expect(res.body.beneficiariesReached).toBe(450);
    expect(res.body.activityCompletionPct).toBe(33);

    // Double-count protection: no executed query JOINs or reads the relational
    // `activities` table — activity KPIs come exclusively from JSONB r.activities.
    const executed = mockQuery.mock.calls.map((c) => String(c[0]));
    for (const sql of executed) {
      expect(sql).not.toMatch(/\bFROM\s+activities\b/i);
      expect(sql).not.toMatch(/\bJOIN\s+activities\b/i);
    }
    // and the aggregate SQL uses SUM/COUNT (additive) over reports
    const aggSql = executed.find((s) => s.includes('AS "reportCount"'))!;
    expect(aggSql).toMatch(/SUM\(/);
    expect(aggSql).toMatch(/FROM reports r/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-DONOR-KPI — donor portfolio grouping & currency semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-DONOR-KPI — donor portfolio grouping", () => {
  type Row = {
    id: number; code: string; title: string;
    budget_total: number | null; currency: string | null;
    free_text_donor: string | null; donor_id: number | null;
    d_id: number | null; d_name: string | null;
    beneficiaries: number;
  };

  function donorDispatch(rows: Row[], spend: Array<{ project_id: number; spent: number | null }> = []): Dispatch {
    return (sql) => {
      if (sql.includes("AS free_text_donor")) return { rows };
      if (sql.includes("FROM activities WHERE project_id = ANY")) return { rows: spend };
      return undefined;
    };
  }

  const base = { budget_total: 100, currency: "USD", beneficiaries: 10 };

  it("PRJ-DONOR-KPI-01: linked projects group canonically by donor_id with canonical donors.name as display name", async () => {
    dispatchPoolQueries(donorDispatch([
      { id: 1, code: "P1", title: "A", ...base, free_text_donor: "Unicef ", donor_id: 5, d_id: 5, d_name: "UNICEF" },
      { id: 2, code: "P2", title: "B", ...base, free_text_donor: null, donor_id: 5, d_id: 5, d_name: "UNICEF" },
    ]));
    const app = await buildDashboardApp();
    const res = await request(app).get("/dashboard/donor-portfolio");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].donorId).toBe(5);
    expect(res.body[0].donorName).toBe("UNICEF");   // canonical name, not free text
    expect(res.body[0].projectCount).toBe(2);
    expect(res.body[0].allocatedBudget).toBe(200);
  });

  it("PRJ-DONOR-KPI-02: unlinked donors group by normalised free-text name", async () => {
    dispatchPoolQueries(donorDispatch([
      { id: 1, code: "P1", title: "A", ...base, free_text_donor: "World Bank", donor_id: null, d_id: null, d_name: null },
      { id: 2, code: "P2", title: "B", ...base, free_text_donor: "  world bank ", donor_id: null, d_id: null, d_name: null },
    ]));
    const app = await buildDashboardApp();
    const res = await request(app).get("/dashboard/donor-portfolio");
    expect(res.body.length).toBe(1);
    expect(res.body[0].donorId).toBeNull();
    expect(res.body[0].dataStatus).toBe("unlinked");
    expect(res.body[0].projectCount).toBe(2);
    expect(res.body[0].allocatedBudget).toBe(200);
  });

  it("PRJ-DONOR-KPI-03: mixed currencies within a group stay per-currency (no cross-currency single total)", async () => {
    dispatchPoolQueries(donorDispatch([
      { id: 1, code: "P1", title: "A", ...base, currency: "USD", free_text_donor: null, donor_id: 5, d_id: 5, d_name: "UNICEF" },
      { id: 2, code: "P2", title: "B", ...base, currency: "EUR", budget_total: 300, free_text_donor: null, donor_id: 5, d_id: 5, d_name: "UNICEF" },
    ]));
    const app = await buildDashboardApp();
    const res = await request(app).get("/dashboard/donor-portfolio");
    const entry = res.body[0];
    expect(entry.currencyMixed).toBe(true);
    expect(entry.currency).toBeNull();  // no single currency claimed
    const byCur = Object.fromEntries(entry.budgetByCurrency.map((b: { currency: string; allocatedBudget: number }) => [b.currency, b.allocatedBudget]));
    expect(byCur).toEqual({ USD: 100, EUR: 300 });
  });

  it("PRJ-DONOR-KPI-04: activity spend is attributed per project currency, null when no activity data", async () => {
    dispatchPoolQueries(donorDispatch(
      [
        { id: 1, code: "P1", title: "A", ...base, currency: "USD", free_text_donor: null, donor_id: 5, d_id: 5, d_name: "UNICEF" },
        { id: 2, code: "P2", title: "B", ...base, currency: "EUR", free_text_donor: null, donor_id: 6, d_id: 6, d_name: "ECHO" },
      ],
      [{ project_id: 1, spent: 40 }], // project 2 has no activity rows
    ));
    const app = await buildDashboardApp();
    const res = await request(app).get("/dashboard/donor-portfolio");
    const unicef = res.body.find((e: { donorId: number }) => e.donorId === 5);
    const echo = res.body.find((e: { donorId: number }) => e.donorId === 6);
    expect(unicef.budgetByCurrency[0]).toMatchObject({ currency: "USD", budgetSpent: 40 });
    expect(echo.budgetByCurrency[0]).toMatchObject({ currency: "EUR", budgetSpent: null }); // null ≠ zero
    expect(echo.budgetSpent).toBeNull();
  });

  it("PRJ-DONOR-KPI-05: name_mismatch is surfaced when free text disagrees with canonical name", async () => {
    dispatchPoolQueries(donorDispatch([
      { id: 1, code: "P1", title: "A", ...base, free_text_donor: "Unisef", donor_id: 5, d_id: 5, d_name: "UNICEF" },
    ]));
    const app = await buildDashboardApp();
    const res = await request(app).get("/dashboard/donor-portfolio");
    expect(res.body[0].dataStatus).toBe("name_mismatch");
    expect(res.body[0].dataIssues).toContain("name_mismatch");
    expect(res.body[0].donorName).toBe("UNICEF"); // canonical still wins for display
  });

  it("PRJ-DONOR-KPI-06: projects with no donor at all surface individually as missing", async () => {
    dispatchPoolQueries(donorDispatch([
      { id: 1, code: "P1", title: "A", ...base, free_text_donor: null, donor_id: null, d_id: null, d_name: null },
      { id: 2, code: "P2", title: "B", ...base, free_text_donor: "", donor_id: null, d_id: null, d_name: null },
    ]));
    const app = await buildDashboardApp();
    const res = await request(app).get("/dashboard/donor-portfolio");
    expect(res.body.length).toBe(2); // NOT merged into one "missing" bucket
    for (const e of res.body) {
      expect(e.dataStatus).toBe("missing");
      expect(e.donorName).toBe("(Unknown Donor)");
      expect(e.projectCount).toBe(1);
    }
  });
});
