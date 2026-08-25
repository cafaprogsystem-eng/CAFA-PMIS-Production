/**
 * Risk Register — Residual Integrity Closure Wave 2
 * (RISK-003, RISK-009, RISK-010, RISK-012, RISK-014, RISK-015, RISK-016,
 *  RISK-022, #576, #577, RISK-BD-06)
 *
 * Route-level tests exercise the real Express handlers in routes/risks.ts with
 * a mocked pg pool; structural tests assert source-level invariants.
 * British English throughout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => {
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  return { pool: { query: mockPoolQuery, connect: async () => ({ query: mockPoolQuery, release: () => {} }) } };
});
vi.mock("../../lib/notifications", () => ({
  notifyEntityActors: vi.fn(),
  notifyEntityActorsDeduped: vi.fn(),
  notifyByRole: vi.fn(),
  createNotification: vi.fn(),
  createNotificationDeduped: vi.fn(),
}));
vi.mock("../../lib/due-date-checker", () => ({ checkAllDueDates: vi.fn() }));
vi.mock("../../lib/realtime", () => ({ realtime: { broadcastUpdate: vi.fn() } }));

import risksRouter from "../risks";
import { type CurrentUser } from "../../middlewares/currentUser";

const ROOT = join(__dirname, "..", "..", "..");
const risksSource = readFileSync(join(ROOT, "src/routes/risks.ts"), "utf8");
const checkerSource = readFileSync(join(ROOT, "src/lib/due-date-checker.ts"), "utf8");
const migrationsSource = readFileSync(join(ROOT, "src/lib/run-migrations.ts"), "utf8");
const schemaSource = readFileSync(join(ROOT, "..", "..", "lib/db/src/schema/index.ts"), "utf8");
const risksTableBlock = schemaSource.slice(
  schemaSource.indexOf('pgTable("risks"'),
  schemaSource.indexOf("plansTable"),
);

function user(over: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1, name: "Test", email: "t@t.t", role: "program_manager", roleLabel: "PM",
    scope: "org", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
    ...over,
  } as CurrentUser;
}

function appAs(u: CurrentUser | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (u) req.currentUser = u;
    next();
  });
  app.use(risksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { name?: string };
    if (e?.name === "ZodError") { res.status(400).json({ error: "validation_failed" }); return; }
    res.status(500).json({ error: "internal" });
  });
  return app;
}

/** SQL-routing pool mock. Handlers get matched by substring of the query text. */
function routeQueries(routes: Array<{ match: string; rows: unknown[]; reject?: boolean }>) {
  mockPoolQuery.mockImplementation(async (sql: string) => {
    for (const r of routes) {
      if (sql.includes(r.match)) {
        if (r.reject) throw new Error("boom");
        return { rows: r.rows, rowCount: r.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  });
}

const RISK_ROW = {
  id: 7, title: "R", description: null, category: "operational", severity: "high",
  likelihood: "medium", impact: null, status: "open", locationType: "state",
  stateId: 2, stateName: "Blue Nile", projectId: null, projectTitle: null,
  assignedToId: null, assignedToName: null, mitigationPlan: null, dueDate: null,
  followUpDate: null, identifiedAt: "2026-01-01", updatedAt: "2026-01-01",
  planId: null, planActivityId: null,
};

const EXISTING_RISK = {
  sector: null, projectId: null, assignedToId: null, status: "open",
  stateId: 2, severity: "high", likelihood: "medium", impact: null,
};

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── RISK-RES-01 — dead optimistic-locking schema removed ─────────────────────
describe("RISK-RES-01: stale-write / dead lock schema (RISK-003)", () => {
  it("risks Drizzle schema no longer declares a version column", () => {
    expect(risksTableBlock).not.toMatch(/version:\s*integer\("version"\)/);
  });
  it("migration 028 drops the version column", () => {
    expect(migrationsSource).toContain("028_risks_drop_dead_version_and_open_default");
    expect(migrationsSource).toContain("ALTER TABLE risks DROP COLUMN IF EXISTS version;");
  });
  it("locked_by / locked_at are retained (live realtime record-lock columns)", () => {
    // NOT dead schema: routes/realtime.ts reads and writes these on `risks`.
    expect(risksTableBlock).toMatch(/lockedBy:\s*integer\("locked_by"\)/);
    expect(risksTableBlock).toMatch(/lockedAt:/);
    expect(migrationsSource).not.toContain("DROP COLUMN IF EXISTS locked_by");
  });
  it("risks routes never read or write version/locked columns", () => {
    expect(risksSource).not.toMatch(/\bversion\b\s*=/);
    expect(risksSource).not.toContain("locked_by");
    expect(risksSource).not.toContain("locked_at");
  });
});

// ── RISK-RES-02 — state actor project membership parity (RISK-009) ───────────
describe("RISK-RES-02: state actor project membership (RISK-009)", () => {
  const spo = user({ role: "state_program_officer", scope: "state", stateId: 2 });

  it("SPO creating a risk with a project outside their state is denied 403", async () => {
    routeQueries([
      { match: "FROM states", rows: [{ id: 2, name: "Blue Nile", nameAr: "النيل الأزرق", code: "BNL", operationalStatus: "active", officeStatus: "present" }] },
      { match: "SELECT sector FROM projects", rows: [{ sector: "Health" }] },
      { match: "SELECT 1 FROM project_states", rows: [] }, // not a member
    ]);
    const res = await supertest(appAs(spo)).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium",
      stateId: 2, projectId: 9,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_forbidden");
  });

  it("SPO with a project operating in their state passes the membership gate", async () => {
    routeQueries([
      { match: "FROM states", rows: [{ id: 2, name: "Blue Nile", nameAr: "النيل الأزرق", code: "BNL", operationalStatus: "active", officeStatus: "present" }] },
      { match: "SELECT sector FROM projects", rows: [{ sector: "Health" }] },
      { match: "SELECT 1 FROM project_states", rows: [{ 1: 1 }] },
      { match: "deleted_at IS NULL FOR UPDATE", rows: [{ 1: 1 }] },
      { match: "INSERT INTO risks", rows: [{ id: 7 }] },
      { match: "FROM risks r", rows: [RISK_ROW] },
    ]);
    const res = await supertest(appAs(spo)).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium",
      stateId: 2, projectId: 9,
    });
    expect(res.status).toBe(201);
  });

  it("PM bypasses membership scope but not project existence", async () => {
    routeQueries([
      { match: "FROM states", rows: [{ id: 2, name: "Blue Nile", nameAr: "النيل الأزرق", code: "BNL", operationalStatus: "active", officeStatus: "present" }] },
      { match: "SELECT sector FROM projects", rows: [] }, // project does not exist
    ]);
    const res = await supertest(appAs(user())).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium",
      stateId: 2, projectId: 999,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_not_found");
  });

  it("SPO list is clamped to their own state", async () => {
    routeQueries([
      { match: "COUNT(*)::text AS total", rows: [{ total: "0" }] },
      { match: "FROM risks r", rows: [] },
    ]);
    await supertest(appAs(spo)).get("/risks");
    const listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY r.identified_at"));
    expect(listCall).toBeTruthy();
    expect(String(listCall![0])).toContain("r.state_id = $1");
    expect(listCall![1]).toContain(2);
  });

  it("SPO with no assigned state sees nothing (fail closed)", async () => {
    routeQueries([
      { match: "COUNT(*)::text AS total", rows: [{ total: "0" }] },
      { match: "FROM risks r", rows: [] },
    ]);
    const res = await supertest(appAs(user({ role: "state_program_officer", scope: "state", stateId: null }))).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    const listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY r.identified_at"));
    expect(String(listCall![0])).toContain("1=0");
  });
});

// ── RISK-RES-03/04 — soft-deleted project contamination (RISK-010) ───────────
describe("RISK-RES-03/04: soft-deleted projects (RISK-010)", () => {
  it("list and count JOINs exclude soft-deleted projects", () => {
    const joins = risksSource.match(/LEFT JOIN projects p ON p\.id = r\.project_id[^\n]*/g) ?? [];
    expect(joins.length).toBeGreaterThanOrEqual(3); // riskSelect, riskCountSelect, getRiskRow
    for (const j of joins) expect(j).toContain("p.deleted_at IS NULL");
  });
  it("a risk whose project was soft-deleted is retained with a NULL projectTitle", async () => {
    routeQueries([
      { match: "COUNT(*)::text AS total", rows: [{ total: "1" }] },
      { match: "FROM risks r", rows: [{ ...RISK_ROW, projectId: 9, projectTitle: null }] },
    ]);
    const res = await supertest(appAs(user())).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].projectId).toBe(9);
    expect(res.body.items[0].projectTitle).toBeNull();
  });
  it("TC sector scope predicate operates on the deleted-guarded join (p.sector NULL for deleted projects)", () => {
    // TC restriction filters on p.sector; with the guarded JOIN a soft-deleted
    // project yields p.sector = NULL, which never matches ANY(sector[]).
    expect(risksSource).toContain("p.sector = ANY($");
  });
  it("new risks cannot link a soft-deleted project", () => {
    expect(risksSource).toContain("SELECT sector FROM projects WHERE id = $1 AND deleted_at IS NULL");
  });
});

// ── RISK-RES-05 — timezone-safe due-date reference day (RISK-012) ────────────
describe("RISK-RES-05: due-date checker timezone safety (RISK-012)", () => {
  it("reference dates come from PostgreSQL CURRENT_DATE, not JS UTC conversion", () => {
    expect(checkerSource).toContain("CURRENT_DATE::text");
    expect(checkerSource).toContain('(CURRENT_DATE + 7)::text');
  });
  it("the shift-prone setHours + toISOString pattern is gone", () => {
    expect(checkerSource).not.toContain("setHours(0, 0, 0, 0)");
    expect(checkerSource).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});

// ── RISK-RES-06 — no ghost notifications (RISK-014) ──────────────────────────
describe("RISK-RES-06: mutation failure produces zero notifications (RISK-014)", () => {
  it("failed UPDATE → 500 and no notification INSERT", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects", rows: [EXISTING_RISK] },
      { match: "UPDATE risks SET", rows: [], reject: true },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/7").send({ title: "New" });
    expect(res.status).toBe(500);
    const notifCalls = mockPoolQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(notifCalls).toHaveLength(0);
  });
  it("notifications are strictly post-write (source order)", () => {
    const updateIdx = risksSource.indexOf("UPDATE risks SET");
    const notifyIdx = risksSource.indexOf("risk_assigned", updateIdx);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(updateIdx);
  });
});

// ── RISK-RES-07 — Drizzle schema drift fixed (RISK-015) ──────────────────────
describe("RISK-RES-07: Drizzle schema alignment (RISK-015)", () => {
  it("stateId is nullable (migration 013 dropped NOT NULL)", () => {
    expect(risksTableBlock).toMatch(/stateId:\s*integer\("state_id"\),/);
    expect(risksTableBlock).not.toMatch(/stateId:\s*integer\("state_id"\)\.notNull\(\)/);
  });
  it("locationType column is declared (added by migration 013)", () => {
    expect(risksTableBlock).toMatch(/locationType:\s*text\("location_type"\)/);
  });
});

// ── RISK-RES-08/09 — pagination + deterministic ordering (RISK-016) ──────────
describe("RISK-RES-08/09: list pagination and ordering (RISK-016)", () => {
  const listRoutes = (rows: unknown[], total = String(rows.length)) => routeQueries([
    { match: "COUNT(*)::text AS total", rows: [{ total }] },
    { match: "FROM risks r", rows },
  ]);

  it("default request returns a paginated envelope", async () => {
    listRoutes([RISK_ROW], "1");
    const res = await supertest(appAs(user())).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 50, totalPages: 1 });
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("limit is honoured and clamped to 200; page maps to OFFSET", async () => {
    listRoutes([], "0");
    await supertest(appAs(user())).get("/risks?limit=5&page=2");
    let listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY r.identified_at"));
    let params = listCall![1] as unknown[];
    expect(params.slice(-2)).toEqual([5, 5]); // LIMIT 5 OFFSET 5

    mockPoolQuery.mockClear();
    listRoutes([], "0");
    await supertest(appAs(user())).get("/risks?limit=9999");
    listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY r.identified_at"));
    params = listCall![1] as unknown[];
    expect(params.slice(-2)).toEqual([200, 0]);
  });

  it("ordering is deterministic: identified_at DESC, id DESC", async () => {
    listRoutes([], "0");
    await supertest(appAs(user())).get("/risks");
    const listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY"));
    expect(String(listCall![0])).toContain("ORDER BY r.identified_at DESC, r.id DESC");
  });

  it("an empty page returns an empty items array, not 404", async () => {
    listRoutes([], "0");
    const res = await supertest(appAs(user())).get("/risks?page=99");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalPages).toBe(0);
  });
});

// ── RISK-RES-10 — canonical create status (RISK-022) ─────────────────────────
describe("RISK-RES-10: default status is open (RISK-022)", () => {
  it("app INSERT forces status 'open'", () => {
    expect(risksSource).toMatch(/INSERT INTO risks[\s\S]*?VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, 'open'/);
  });
  it("DB default aligned via migration 028; identified rows not mass-updated", () => {
    expect(migrationsSource).toContain("ALTER TABLE risks ALTER COLUMN status SET DEFAULT 'open';");
    expect(migrationsSource).not.toMatch(/UPDATE risks SET status = 'open'/);
  });
  it("Drizzle schema default matches", () => {
    expect(risksTableBlock).toContain('.default("open")');
  });
  it("'identified' remains a valid lifecycle status", () => {
    expect(risksSource).toContain('"identified"');
  });
});

// ── RISK-RES-11/12 — clear assignee / due date via explicit null (#576) ──────
describe("RISK-RES-11/12: explicit null clears assignee and due date (#576)", () => {
  it("PATCH with assignedToId: null writes NULL to the column", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects", rows: [{ ...EXISTING_RISK, assignedToId: 5 }] },
      { match: "UPDATE risks SET", rows: [] },
      { match: "FROM risks r", rows: [RISK_ROW] },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/7").send({ assignedToId: null });
    expect(res.status).toBe(200);
    const updateCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("UPDATE risks SET"));
    expect(String(updateCall![0])).toContain("assigned_to_id = $1");
    expect((updateCall![1] as unknown[])[0]).toBeNull();
  });

  it("PATCH with dueDate: null writes NULL to the column", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects", rows: [EXISTING_RISK] },
      { match: "UPDATE risks SET", rows: [] },
      { match: "FROM risks r", rows: [RISK_ROW] },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/7").send({ dueDate: null });
    expect(res.status).toBe(200);
    const updateCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("UPDATE risks SET"));
    expect(String(updateCall![0])).toContain("due_date = $1");
    expect((updateCall![1] as unknown[])[0]).toBeNull();
  });

  it("PATCH that omits assignee/due date leaves them unchanged", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects", rows: [{ ...EXISTING_RISK, assignedToId: 5 }] },
      { match: "UPDATE risks SET", rows: [] },
      { match: "FROM risks r", rows: [RISK_ROW] },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/7").send({ title: "Renamed" });
    expect(res.status).toBe(200);
    const updateCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("UPDATE risks SET"));
    expect(String(updateCall![0])).not.toContain("assigned_to_id");
    expect(String(updateCall![0])).not.toContain("due_date");
  });
});

// ── RISK-RES-13/14/15 — stateId existence validation (#577) ──────────────────
describe("RISK-RES-13/14/15: state reference validation (#577)", () => {
  it("POST with a nonexistent stateId → 422 state_not_found", async () => {
    routeQueries([{ match: "FROM states", rows: [] }]);
    const res = await supertest(appAs(user())).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium", stateId: 424242,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("state_not_found");
  });

  it("locationType=hq with a stateId is still rejected (existing rule)", async () => {
    const res = await supertest(appAs(user())).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium",
      locationType: "hq", stateId: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_location_combination");
  });

  it("locationType=state with a valid stateId → 201", async () => {
    routeQueries([
      { match: "FROM states", rows: [{ id: 2, name: "Blue Nile", nameAr: "النيل الأزرق", code: "BNL", operationalStatus: "active", officeStatus: "present" }] },
      { match: "INSERT INTO risks", rows: [{ id: 7 }] },
      { match: "FROM risks r", rows: [RISK_ROW] },
    ]);
    const res = await supertest(appAs(user())).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium",
      locationType: "state", stateId: 2,
    });
    expect(res.status).toBe(201);
  });

  it("super_admin cannot bypass the state existence check", async () => {
    routeQueries([{ match: "FROM states", rows: [] }]);
    const res = await supertest(appAs(user({ role: "super_admin" }))).post("/risks").send({
      title: "X", category: "operational", severity: "high", likelihood: "medium", stateId: 424242,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("state_not_found");
  });

  it("stateId is not patchable — no existence gap on PATCH", () => {
    // UpdateRiskBody has no stateId and the PATCH writable set excludes
    // state_id (location identity is create-time only), so no PATCH-side
    // existence check is required.
    expect(risksSource).toContain("state_id are intentionally NOT");
    expect(risksSource).not.toMatch(/sets\.push\(`state_id/);
  });
});

// ── RISK-RES-16 — RISK-BD-06 classification ──────────────────────────────────
describe("RISK-RES-16: no assignee state/sector scope enforcement (RISK-BD-06)", () => {
  it("assignee validation checks existence + active status only", async () => {
    // No canonical business rule requires the assignee to share the risk's
    // state or sector (NOT A REQUIREMENT — #570 + #578 closures).
    expect(risksSource).toContain("SELECT status FROM users WHERE id = $1");
    expect(risksSource).not.toMatch(/users[\s\S]{0,120}state_id[\s\S]{0,60}assigned_to/);
  });
  it("no dueDate/identifiedAt ordering constraint is enforced (documented)", () => {
    expect(risksSource).toContain("RISK-BD-06");
  });
});
