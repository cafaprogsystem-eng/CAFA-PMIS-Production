/**
 * Risk Register Module — Full Functional Audit test matrix (Task: RISK-AUD-01…20)
 *
 * Route-level tests exercise the real Express handlers in routes/risks.ts with
 * a mocked pg pool; structural tests assert source-level invariants (deletion
 * nulling, analytics thresholds, no runtime DDL). British English throughout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { mockPoolQuery, mockNotifyEntityActors, mockNotifyByRole, mockCreateNotificationDeduped } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockNotifyEntityActors: vi.fn(),
  mockNotifyByRole: vi.fn(),
  mockCreateNotificationDeduped: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  return { pool: { query: mockPoolQuery, connect: async () => ({ query: mockPoolQuery, release: () => {} }) } };
});
vi.mock("../../lib/notifications", () => ({
  notifyEntityActors: mockNotifyEntityActors,
  notifyByRole: mockNotifyByRole,
  createNotification: vi.fn(),
  createNotificationDeduped: mockCreateNotificationDeduped,
}));
vi.mock("../../lib/due-date-checker", () => ({ checkAllDueDates: vi.fn() }));
vi.mock("../../lib/realtime", () => ({ realtime: { broadcastUpdate: vi.fn() } }));

import risksRouter from "../risks";
import { permissionsFor, hasPerm, type CurrentUser } from "../../middlewares/currentUser";
import { CreateRiskBody, UpdateRiskBody } from "@workspace/api-zod";

const ROOT = join(__dirname, "..", "..", "..");
const risksSource = readFileSync(join(ROOT, "src/routes/risks.ts"), "utf8");
const plansSource = readFileSync(join(ROOT, "src/routes/plans.ts"), "utf8");
const dashboardSource = readFileSync(join(ROOT, "src/routes/dashboard.ts"), "utf8");
const commentsSource = readFileSync(join(ROOT, "src/routes/comments.ts"), "utf8");

function user(over: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1, name: "Test", email: "t@t.t", role: "program_manager", roleLabel: "PM",
    scope: "org", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
    ...over,
  };
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
    const isZod = typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError";
    res.status(isZod ? 400 : 500).json({ error: isZod ? "validation" : "internal" });
  });
  return supertest(app);
}

// Frontend mirror of computeRiskLevelFE (project-detail.tsx)
function computeRiskLevelFE(likelihood: string, impact: string): string {
  const m: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const score = (m[likelihood] ?? 2) * (m[impact] ?? 2);
  if (score >= 9) return "critical";
  if (score >= 6) return "high";
  if (score >= 2) return "medium";
  return "low";
}
// Backend algorithm replica (routes/risks.ts computeRiskLevel)
function computeRiskLevelBE(likelihood: string, impact: string | null, severity: string): string {
  const probMap: Record<string, number> = { low: 1, unlikely: 1, medium: 2, possible: 2, high: 3, likely: 3, almost_certain: 3 };
  const impMap: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 3 };
  const score = (probMap[likelihood] ?? 2) * (impMap[impact ?? severity] ?? 2);
  if (score >= 9) return "critical";
  if (score >= 6) return "high";
  if (score >= 2) return "medium";
  return "low";
}

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  mockNotifyEntityActors.mockReset();
  mockNotifyByRole.mockReset();
  mockCreateNotificationDeduped.mockReset();
});

describe("RISK-AUD-01 — canonical model / generated schema alignment", () => {
  it("CreateRiskBody accepts every documented create field (no cast workarounds needed)", () => {
    const parsed = CreateRiskBody.parse({
      title: "T", category: "security", severity: "high", likelihood: "high",
      impact: "high", stateId: 1, projectId: 2, assignedToId: 3,
      mitigationPlan: "m", dueDate: "2026-09-01", locationType: "state",
    });
    expect(parsed.impact).toBe("high");
    expect(parsed.assignedToId).toBe(3);
    expect(parsed.dueDate).toBe("2026-09-01");
    expect(parsed.locationType).toBe("state");
  });
  it("UpdateRiskBody accepts status/severity/likelihood/impact/assignedToId/dueDate", () => {
    const parsed = UpdateRiskBody.parse({ status: "closed", severity: "low", likelihood: "low", impact: "low", assignedToId: 9, dueDate: "2026-01-01" });
    expect(parsed.status).toBe("closed");
  });
});

describe("RISK-AUD-02/03/04/05 — linkage model (current behaviour)", () => {
  it("POST /risks never writes plan_id or plan_activity_id (plan links are owned by the plans module)", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 });
    await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "high", likelihood: "high", stateId: 1, planId: 99, planActivityId: 42 });
    const insert = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO risks"));
    expect(insert).toBeTruthy();
    expect(String(insert![0])).not.toContain("plan_id");
    expect(String(insert![0])).not.toContain("plan_activity_id");
  });
  it("plan activity risk link (plan_activities.risk_id) is only writable through plan routes scoped by plan_id", () => {
    // activity UPDATE/INSERT statements constrain by plan_id; risks.ts never touches risk_id
    expect(plansSource).toMatch(/AND plan_id\s*=\s*\$/);
    expect(risksSource).not.toContain("risk_id");
  });
});

describe("RISK-AUD-06 — state scope on list", () => {
  it("SPO list is clamped to own state", async () => {
    await appAs(user({ role: "state_program_officer", stateId: 5 })).get("/risks");
    const q = mockPoolQuery.mock.calls[0];
    expect(String(q[0])).toContain("r.state_id = $1");
    expect(q[1]).toEqual([5]);
  });
  it("SPO with NULL state fails closed (returns nothing)", async () => {
    // Wave 2 (RISK-016): list is paginated — first query is the COUNT.
    mockPoolQuery.mockImplementation(async (sql: string) =>
      String(sql).includes("COUNT(*)::text AS total")
        ? { rows: [{ total: "0" }], rowCount: 1 }
        : { rows: [], rowCount: 0 });
    const res = await appAs(user({ role: "state_program_officer", stateId: null })).get("/risks");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(String(mockPoolQuery.mock.calls[0][0])).toContain("1=0");
  });
  it("SOM cannot request another state's risks via stateId param", async () => {
    await appAs(user({ role: "state_office_manager", stateId: 5 })).get("/risks?stateId=9");
    const q = mockPoolQuery.mock.calls[0];
    expect(q[1]).toEqual([5]); // clamped to own state, param ignored
  });
});

describe("RISK-AUD-07 — TC effective-sector scope", () => {
  it("TC list is restricted to assigned sectors via project sector", async () => {
    await appAs(user({ role: "technical_coordinator", sectors: ["Health", "WASH"] })).get("/risks");
    const q = mockPoolQuery.mock.calls[0];
    expect(String(q[0])).toContain("p.sector = ANY(");
    expect(q[1]).toEqual([["Health", "WASH"]]);
  });
  it("TC with empty sector assignment fails closed (matches nothing, not everything)", async () => {
    await appAs(user({ role: "technical_coordinator", sectors: [] })).get("/risks");
    expect(mockPoolQuery.mock.calls[0][1]).toEqual([[]]);
  });
});

describe("RISK-AUD-08 — permissions matrix / Full Operational Access", () => {
  it("PM holds risks.create, risks.update and risks.view", () => {
    const perms = permissionsFor(user({ role: "program_manager" }));
    expect(hasPerm(perms, "risks.create")).toBe(true);
    expect(hasPerm(perms, "risks.update")).toBe(true);
    expect(hasPerm(perms, "risks.view")).toBe(true);
  });
  it("super_admin wildcard covers all risk permissions", () => {
    const perms = permissionsFor(user({ role: "super_admin" }));
    expect(hasPerm(perms, "risks.delete")).toBe(true);
  });
  it("SOM is view-only (risks.view.state, no create/update)", () => {
    const perms = permissionsFor(user({ role: "state_office_manager" }));
    expect(hasPerm(perms, "risks.view.state")).toBe(true);
    expect(hasPerm(perms, "risks.create")).toBe(false);
    expect(hasPerm(perms, "risks.update")).toBe(false);
  });
  it("unknown role fails closed on the risk read guard", async () => {
    const res = await appAs(user({ role: "project_officer" })).get("/risks");
    expect(res.status).toBe(403);
  });
  it("unauthenticated list request is rejected", async () => {
    const res = await appAs(null).get("/risks");
    expect(res.status).toBe(401);
  });
  it("SOM (view-only) cannot create a risk", async () => {
    const res = await appAs(user({ role: "state_office_manager", stateId: 5 }))
      .post("/risks").send({ title: "x", category: "security", severity: "high", likelihood: "high", stateId: 5 });
    expect(res.status).toBe(403);
  });
});

describe("RISK-AUD-09 — scoring integrity / input validation", () => {
  it("rejects out-of-range likelihood with 422", async () => {
    const res = await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "high", likelihood: "catastrophic", stateId: 1 });
    expect(res.status).toBe(422);
  });
  it("rejects invalid severity and impact with 422", async () => {
    const r1 = await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "5", likelihood: "high", stateId: 1 });
    expect(r1.status).toBe(422);
    const r2 = await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "high", impact: "enormous", likelihood: "high", stateId: 1 });
    expect(r2.status).toBe(422);
  });
  it("PATCH rejects invalid enum values with 422 before any write", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ sector: null, projectId: null, assignedToId: null, status: "open", stateId: 1, severity: "high", likelihood: "high", impact: null }], rowCount: 1 });
    const res = await appAs(user()).patch("/risks/1").send({ likelihood: "certain" });
    expect(res.status).toBe(422);
    const updates = mockPoolQuery.mock.calls.filter((c) => String(c[0]).startsWith("UPDATE risks"));
    expect(updates).toHaveLength(0);
  });
  it("no stored score column exists — score is always derived (client cannot override)", () => {
    expect(risksSource).not.toMatch(/INSERT INTO risks[^;]*score/i);
  });
});

describe("RISK-AUD-10 — backend/frontend severity parity", () => {
  it("derives identical levels for every canonical likelihood × impact combination", () => {
    for (const l of ["low", "medium", "high"]) {
      for (const i of ["low", "medium", "high"]) {
        expect(computeRiskLevelFE(l, i)).toBe(computeRiskLevelBE(l, i, i));
      }
    }
  });
  it("SQL riskLevel expression uses the same thresholds (9/6/2) as the TS helper", () => {
    expect(risksSource).toContain(">= 9 THEN 'critical'");
    expect(risksSource).toContain(">= 6 THEN 'high'");
    expect(risksSource).toContain(">= 2 THEN 'medium'");
  });
});

describe("RISK-AUD-11 — residual risk fields are absent, not fabricated", () => {
  it("no residual columns are selected or written anywhere in the risks route", () => {
    expect(risksSource).not.toMatch(/residual/i);
  });
});

describe("RISK-AUD-12 — owner validity (documented gap)", () => {
  it("notification code guards against null assignedToId", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 });
    await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "high", likelihood: "high", stateId: 1 });
    const assigneeNotifies = mockPoolQuery.mock.calls.filter((c) => String(c[0]).includes("risk_assigned"));
    expect(assigneeNotifies).toHaveLength(0);
  });
});

describe("RISK-AUD-14 — status lifecycle", () => {
  it("accepts all known statuses (incl. legacy) and rejects unknown ones", async () => {
    for (const s of ["open", "under_mitigation", "closed", "mitigated", "identified"]) {
      mockPoolQuery.mockReset().mockResolvedValue({ rows: [{ sector: null, projectId: null, assignedToId: null, status: "open", stateId: 1, severity: "high", likelihood: "high", impact: null, id: 1, title: "t" }], rowCount: 1 });
      const res = await appAs(user()).patch("/risks/1").send({ status: s });
      expect(res.status, s).toBe(200);
    }
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [{ sector: null, projectId: null, assignedToId: null, status: "open", stateId: 1, severity: "high", likelihood: "high", impact: null }], rowCount: 1 });
    const bad = await appAs(user()).patch("/risks/1").send({ status: "wontfix" });
    expect(bad.status).toBe(422);
  });
});

describe("RISK-AUD-15 — comments scope", () => {
  // RISK-001 closure: entityType=risk is now accepted, guarded by the
  // canonical risk scope checks (see risk-comments-closure.test.ts).
  it("shared comments route accepts entityType=risk with scoped access (RISK-001 closed)", () => {
    expect(commentsSource).toMatch(/VALID_ENTITY_TYPES\s*=\s*new Set\(\[\s*"project",\s*"report",\s*"plan",\s*"risk"\s*\]\)/);
    expect(commentsSource).toContain("assertRiskStateScope");
  });
});

describe("RISK-AUD-16 — notification rollback safety", () => {
  it("no notification is sent when the INSERT fails", async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error("boom"));
    const res = await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "high", likelihood: "high", stateId: 1, projectId: 3 });
    expect(res.status).toBe(500);
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyByRole).not.toHaveBeenCalled();
  });
});

describe("RISK-AUD-17 — critical-risk analytics definition", () => {
  it("dashboard critical KPI uses the computed score (>= 9) and excludes closed/mitigated", () => {
    expect(dashboardSource).toMatch(/riskScoreSQL\((?:""|"rk\.")\)\} >= 9 AND (?:rk\.)?status NOT IN \('closed','mitigated'\)/);
    expect(dashboardSource).not.toMatch(/severity IN \('critical','high'\)/);
  });
  it("high-risk-state KPI counts DISTINCT states (no duplicate counting per risk)", () => {
    expect(dashboardSource).toMatch(/COUNT\(DISTINCT (?:rk\.)?state_id\)/);
  });
});

describe("RISK-AUD-18 — delete referential integrity (app-side nulling)", () => {
  it("plan activity removal nulls risks.plan_activity_id before deleting activities", () => {
    expect(plansSource).toMatch(/UPDATE risks SET plan_activity_id = NULL[\s\S]{0,200}DELETE FROM plan_activities/);
  });
  it("plan deletion nulls risks.plan_id before deleting the plan", () => {
    expect(plansSource).toMatch(/UPDATE risks SET plan_id = NULL WHERE plan_id = \$1/);
  });
});

describe("RISK-AUD-19 — API/type alignment", () => {
  it("list response enrichment adds riskLevel to every row", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) =>
      String(sql).includes("COUNT(*)::text AS total")
        ? { rows: [{ total: "1" }], rowCount: 1 }
        : { rows: [{ id: 1, likelihood: "high", impact: "high", severity: "high", status: "open" }], rowCount: 1 });
    const res = await appAs(user()).get("/risks");
    expect(res.body.items[0].riskLevel).toBe("critical");
  });
  it("risks.ts contains no `(body as Record<string, unknown>)` cast workarounds", () => {
    expect(risksSource).not.toContain("(body as Record<string, unknown>)");
  });
});

describe("RISK-AUD-20 — no startup DDL in the risks route", () => {
  it("contains no ALTER/CREATE/DROP TABLE or CREATE INDEX statements", () => {
    expect(risksSource).not.toMatch(/\b(ALTER TABLE|CREATE TABLE|CREATE INDEX|DROP TABLE)\b/);
  });
});

describe("Due-date job trigger is a privileged operation", () => {
  it("read-only viewer cannot trigger the org-wide notification job", async () => {
    const res = await appAs(user({ role: "viewer" })).get("/risks/due-date-check");
    expect(res.status).toBe(403);
  });
  it("state-scoped SPO cannot trigger the job", async () => {
    const res = await appAs(user({ role: "state_program_officer", stateId: 3 })).get("/risks/due-date-check");
    expect(res.status).toBe(403);
  });
  it("PM (no risks.admin) cannot trigger the job; super_admin can", async () => {
    const pm = await appAs(user({ role: "program_manager" })).get("/risks/due-date-check");
    expect(pm.status).toBe(403);
    const sa = await appAs(user({ role: "super_admin" })).get("/risks/due-date-check");
    expect(sa.status).toBe(200);
  });
});

describe("KPI/list parity — activeOnly filter", () => {
  it("activeOnly=1 excludes closed and mitigated risks server-side", async () => {
    await appAs(user()).get("/risks?riskLevel=critical&activeOnly=1");
    // Find the data query (contains ORDER BY) — summary query always has aggregate
    // NOT IN expressions so we must discriminate by the WHERE clause of the data query.
    const dataCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("ORDER BY r.identified_at DESC"));
    expect(dataCall).toBeDefined();
    expect(String(dataCall![0])).toContain(`r.status NOT IN ('closed','mitigated')`);
  });
  it("without activeOnly the list applies no status exclusion to the WHERE clause", async () => {
    await appAs(user()).get("/risks?riskLevel=critical");
    // The data query's WHERE clause must not exclude any status when activeOnly is absent.
    // The summary query legitimately uses NOT IN for its open-count aggregate — we check
    // only the data (SELECT r.id …) query.
    const dataCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("ORDER BY r.identified_at DESC"));
    expect(dataCall).toBeDefined();
    expect(String(dataCall![0])).not.toContain(`NOT IN ('closed','mitigated')`);
  });
  it("dashboard critical KPI and activeOnly list use the same status exclusion", () => {
    expect(dashboardSource).toContain(`status NOT IN ('closed','mitigated')`);
    expect(risksSource).toContain(`r.status NOT IN ('closed','mitigated')`);
  });
});

describe("RISK-AUD-13 — date handling (documented behaviour)", () => {
  it("dueDate is passed through as-is (no reversed-date guard — recorded as finding RISK-011)", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 });
    const res = await appAs(user()).post("/risks").send({ title: "x", category: "security", severity: "high", likelihood: "high", stateId: 1, dueDate: "2026-09-01" });
    expect(res.status).toBe(201);
    const insert = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO risks"));
    expect(insert![1]).toContain("2026-09-01");
  });
});
