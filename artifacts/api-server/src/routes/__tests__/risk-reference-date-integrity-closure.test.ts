/**
 * Risk Register — Reference, Linkage & Date Integrity Closure
 * (RISK-006, RISK-007, RISK-008, RISK-011)
 *
 * Route-level tests exercise the real Express handlers in routes/risks.ts with
 * a mocked pg pool; structural tests assert source-level invariants in plans.ts
 * (RISK-007 linkage validation + Task #486 delete null-out regression).
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
  notifyByRole: vi.fn(),
  createNotification: vi.fn(),
  createNotificationDeduped: vi.fn(),
}));
vi.mock("../../lib/due-date-checker", () => ({ checkAllDueDates: vi.fn() }));
vi.mock("../../lib/realtime", () => ({ realtime: { broadcastUpdate: vi.fn() } }));

import risksRouter from "../risks";
import { type CurrentUser } from "../../middlewares/currentUser";
import { UpdateRiskBody } from "@workspace/api-zod";

const ROOT = join(__dirname, "..", "..", "..");
const risksSource = readFileSync(join(ROOT, "src/routes/risks.ts"), "utf8");
const plansSource = readFileSync(join(ROOT, "src/routes/plans.ts"), "utf8");

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
function routeQueries(routes: Array<{ match: string; rows: unknown[] }>) {
  mockPoolQuery.mockImplementation(async (sql: string) => {
    for (const r of routes) {
      if (sql.includes(r.match)) return { rows: r.rows, rowCount: r.rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

const VALID_POST = {
  title: "Test risk", category: "operational",
  severity: "high", likelihood: "medium",
  locationType: "hq" as const,
};

const EXISTING_RISK_ROW = {
  sector: null, projectId: null, assignedToId: null, status: "open",
  stateId: null, severity: "high", likelihood: "medium", impact: null,
};

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("RISK-008 — project reference integrity (POST)", () => {
  it("RISK-REF-01: POST with nonexistent projectId → 422 project_not_found", async () => {
    routeQueries([{ match: "FROM projects WHERE id = $1 AND deleted_at IS NULL", rows: [] }]);
    const res = await supertest(appAs(user()))
      .post("/risks").send({ ...VALID_POST, projectId: 999 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_not_found");
  });

  it("RISK-REF-10: PM (Full Operational Access) still gets 422 for nonexistent project — access bypasses scope, not existence", async () => {
    routeQueries([{ match: "AND deleted_at IS NULL", rows: [] }]);
    const res = await supertest(appAs(user({ role: "program_manager" })))
      .post("/risks").send({ ...VALID_POST, projectId: 424242 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_not_found");
  });

  it("RISK-REF-02a: state role linking a project outside its state → 403 project_forbidden", async () => {
    routeQueries([
      { match: "FROM states", rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] }, // active-state gate
      { match: "AND deleted_at IS NULL", rows: [{ sector: "Health" }] },
      { match: "FROM project_states", rows: [] },
    ]);
    const res = await supertest(appAs(user({ role: "state_program_officer", scope: "state", stateId: 5 })))
      .post("/risks").send({ title: "R", category: "operational", severity: "high", likelihood: "medium", stateId: 5, projectId: 7 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("project_forbidden");
  });

  it("RISK-REF-02b: technical_coordinator linking a wrong-sector project → 403 (existing sector guard retained)", async () => {
    routeQueries([
      { match: "AND deleted_at IS NULL", rows: [{ sector: "Health" }] },
    ]);
    const res = await supertest(appAs(user({ role: "technical_coordinator", sector: "WASH", sectors: ["WASH"] })))
      .post("/risks").send({ ...VALID_POST, projectId: 7 });
    expect(res.status).toBe(403);
  });

  it("RISK-REF-03/04: plan_id is not part of the POST schema — Zod strips it; no plan linkage possible via risks POST (N/A, documented)", async () => {
    // CreateRiskBody has no planId/plan_activity_id keys; supplying them is a no-op strip.
    routeQueries([
      { match: "INSERT INTO risks", rows: [{ id: 1 }] },
      { match: "FROM risks r", rows: [{ id: 1, likelihood: "medium", severity: "high", impact: null }] },
    ]);
    const res = await supertest(appAs(user()))
      .post("/risks").send({ ...VALID_POST, planId: 12345 });
    expect(res.status).toBe(201);
    const insertCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO risks"));
    expect(String(insertCall?.[0])).not.toContain("plan_id");
  });

  it("RISK-REF-08: stateId existence is not validated (current behaviour documented; state scoping enforced for state roles)", () => {
    // No `FROM states` existence lookup exists in the POST handler — documented, unchanged.
    const postBlock = risksSource.slice(risksSource.indexOf('router.post("/risks"'), risksSource.indexOf('router.patch'));
    expect(postBlock).not.toContain("FROM states");
  });
});

describe("RISK-006 — assignee reference integrity", () => {
  it("RISK-REF-09a: POST with nonexistent assignedToId → 422 assigned_user_not_found", async () => {
    routeQueries([{ match: "SELECT status FROM users WHERE id = $1", rows: [] }]);
    const res = await supertest(appAs(user()))
      .post("/risks").send({ ...VALID_POST, assignedToId: 999 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("assigned_user_not_found");
  });

  it("RISK-REF-09b: POST with inactive assignedToId → 422 assigned_user_not_active", async () => {
    routeQueries([{ match: "SELECT status FROM users WHERE id = $1", rows: [{ status: "inactive" }] }]);
    const res = await supertest(appAs(user()))
      .post("/risks").send({ ...VALID_POST, assignedToId: 3 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("assigned_user_not_active");
  });

  it("RISK-REF-09c: PATCH with nonexistent assignedToId → 422 assigned_user_not_found", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] },
      { match: "SELECT status FROM users WHERE id = $1", rows: [] },
    ]);
    const res = await supertest(appAs(user()))
      .patch("/risks/1").send({ assignedToId: 999 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("assigned_user_not_found");
  });

  it("RISK-REF-09d: PATCH with assignedToId=null clears the assignment (no user lookup, null written)", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] },
      { match: "UPDATE risks SET", rows: [] },
      { match: "FROM risks r", rows: [{ id: 1, likelihood: "medium", severity: "high", impact: null, title: "T", status: "open" }] },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/1").send({ assignedToId: null });
    expect(res.status).toBe(200);
    const updateCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("UPDATE risks SET"));
    expect(String(updateCall?.[0])).toContain("assigned_to_id");
    expect((updateCall?.[1] as unknown[])[0]).toBeNull();
    const userLookup = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("SELECT status FROM users"));
    expect(userLookup).toBeUndefined();
  });
});

describe("RISK-011 — date integrity", () => {
  it.each(["not-a-date", "2026/08/19", "19-08-2026", "2026-8-19"])(
    "RISK-DATE-01: POST with malformed dueDate %s → 422 (not 500)",
    async (bad) => {
      const res = await supertest(appAs(user())).post("/risks").send({ ...VALID_POST, dueDate: bad });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("dueDate_invalid_format");
    },
  );

  it("RISK-DATE-01b: POST with impossible calendar date 2026-02-30 → 422 dueDate_invalid_date", async () => {
    const res = await supertest(appAs(user())).post("/risks").send({ ...VALID_POST, dueDate: "2026-02-30" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("dueDate_invalid_date");
  });

  it.each(["0000-01-01", "0000-02-29"])(
    "RISK-DATE-01d: POST with year-zero dueDate %s (invalid in PostgreSQL) → 422 dueDate_invalid_date",
    async (bad) => {
      const res = await supertest(appAs(user())).post("/risks").send({ ...VALID_POST, dueDate: bad });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("dueDate_invalid_date");
    },
  );

  it("RISK-DATE-01e: PATCH with year-zero dueDate → 422 dueDate_invalid_date", async () => {
    routeQueries([{ match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] }]);
    const res = await supertest(appAs(user())).patch("/risks/1").send({ dueDate: "0000-01-01" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("dueDate_invalid_date");
  });

  it("RISK-DATE-01c: PATCH with malformed dueDate → 422", async () => {
    routeQueries([{ match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] }]);
    const res = await supertest(appAs(user())).patch("/risks/1").send({ dueDate: "garbage" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("dueDate_invalid_format");
  });

  it("RISK-DATE-02: no date-ordering rule enforced — no canonical rule exists (RISK-BD-06 documented)", () => {
    expect(risksSource).toContain("RISK-BD-06");
  });

  it("RISK-DATE-03a: PATCH omitting dueDate does not touch due_date", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] },
      { match: "UPDATE risks SET", rows: [] },
      { match: "FROM risks r", rows: [{ id: 1, likelihood: "medium", severity: "high", impact: null, title: "T", status: "open" }] },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/1").send({ title: "Renamed" });
    expect(res.status).toBe(200);
    const updateCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("UPDATE risks SET"));
    expect(String(updateCall?.[0])).not.toContain("due_date");
  });

  it("RISK-DATE-03b: PATCH with dueDate=null clears it", async () => {
    routeQueries([
      { match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] },
      { match: "UPDATE risks SET", rows: [] },
      { match: "FROM risks r", rows: [{ id: 1, likelihood: "medium", severity: "high", impact: null, title: "T", status: "open" }] },
    ]);
    const res = await supertest(appAs(user())).patch("/risks/1").send({ dueDate: null });
    expect(res.status).toBe(200);
    const updateCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes("UPDATE risks SET"));
    expect(String(updateCall?.[0])).toContain("due_date");
    expect((updateCall?.[1] as unknown[])[0]).toBeNull();
  });

  it("RISK-DATE-03c: UpdateRiskBody accepts explicit null for assignedToId and dueDate", () => {
    const parsed = UpdateRiskBody.parse({ assignedToId: null, dueDate: null });
    expect(parsed.assignedToId).toBeNull();
    expect(parsed.dueDate).toBeNull();
  });

  it("RISK-DATE-04: due-date checker excludes NULL due_date rows (no false overdue)", () => {
    const checkerSource = readFileSync(join(ROOT, "src/lib/due-date-checker.ts"), "utf8");
    expect(checkerSource).toContain("r.due_date IS NOT NULL");
  });
});

describe("RISK-007 — plan_activities.risk_id linkage (structural, plans.ts)", () => {
  it("RISK-REF-05a: validateRiskReference helper exists and performs a bare existence check", () => {
    expect(plansSource).toContain("async function validateRiskReference");
    expect(plansSource).toContain("SELECT id FROM risks WHERE id = $1");
    expect(plansSource).toContain('"risk_not_found"');
  });

  it("RISK-REF-05b: POST /plans activity loop validates riskId before insert", () => {
    const postIdx = plansSource.indexOf("Responsible user validation — activity-level");
    const block = plansSource.slice(postIdx, plansSource.indexOf("const planRes", postIdx));
    expect(block).toContain("validateRiskReference(rawAct.riskId");
    expect(block).toContain('PlanValidationError(actRiskErr, "activities.riskId")');
  });

  it("RISK-REF-05c: PATCH /plans activity loop validates riskId before write", () => {
    const patchIdx = plansSource.indexOf("const currentResp = actId != null");
    const block = plansSource.slice(patchIdx, plansSource.indexOf("Activity status/progress consistency", patchIdx));
    expect(block).toContain("validateRiskReference(raw.riskId");
  });

  it("RISK-REF-06: cross-Plan risk_id mismatch not applicable — risks POST/PATCH cannot set plan_id (documented)", () => {
    const patchBlock = risksSource.slice(risksSource.indexOf('router.patch("/risks/'));
    expect(patchBlock).not.toContain("plan_id =");
    expect(patchBlock).not.toContain("plan_activity_id =");
  });

  it("RISK-REF-07: no cross-entity project/plan consistency check enforced (RISK-BD-01 dependency, documented)", () => {
    expect(risksSource).toContain("RISK-BD-01");
  });

  it("RISK-REF-11: plan-activity deletion still nulls risks.plan_activity_id BEFORE delete (Task #486 regression guard)", () => {
    const nullOutIdx = plansSource.indexOf("UPDATE risks SET plan_activity_id = NULL WHERE plan_activity_id = ANY($1::int[])");
    expect(nullOutIdx).toBeGreaterThan(-1);
    const deleteIdx = plansSource.indexOf("DELETE FROM plan_activities WHERE plan_id = $1 AND id = ANY($2::int[])");
    expect(deleteIdx).toBeGreaterThan(nullOutIdx);
  });
});

describe("Error message accuracy (Step 6 cleanup)", () => {
  it("likelihood error message advertises all accepted aliases", async () => {
    const res = await supertest(appAs(user())).post("/risks").send({ ...VALID_POST, likelihood: "bogus" });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("almost_certain");
    expect(res.body.message).toContain("unlikely");
  });

  it("status error message advertises all accepted statuses", async () => {
    routeQueries([{ match: "FROM risks r LEFT JOIN projects p", rows: [EXISTING_RISK_ROW] }]);
    const res = await supertest(appAs(user())).patch("/risks/1").send({ status: "bogus" });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("mitigated");
    expect(res.body.message).toContain("escalation");
  });
});
