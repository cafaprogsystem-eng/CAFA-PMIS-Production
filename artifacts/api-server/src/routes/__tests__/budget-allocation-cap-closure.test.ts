/**
 * BUD-CAP — Budgets Module: Allocation Cap Integrity Closure (Task #595)
 *
 * Canonical rule (BUD-BD-01):
 *   SUM(project_state_allocations.budget_allocation) <= projects.budget_total
 *   — unconditional (including budget_total = 0), actor-independent (PM/SA
 *   cannot bypass), enforced inside the write transaction under a row lock.
 *
 * BUD-CAP-01  Allocation replace: budget=0 + positive allocation → 422 over_allocation
 * BUD-CAP-02  Allocation replace: budget=0 + zero allocation → valid
 * BUD-CAP-03  Allocation replace: allocation total = budget exactly → valid
 * BUD-CAP-04  Allocation replace: allocation total > budget → 422
 * BUD-CAP-05  PM cannot bypass cap (same 422 response)
 * BUD-CAP-06  Super Admin cannot bypass cap (same 422 response)
 * BUD-CAP-07  Project PATCH: budget reduced below allocation SUM in payload → 422
 * BUD-CAP-08  Project PATCH: budget increased → valid even if allocations exist
 * BUD-CAP-09  Project PATCH without allocations → no cap rejection, unrelated update proceeds
 * BUD-CAP-10  Failed budget reduction: transaction rolled back, no UPDATE projects executed
 * BUD-CAP-11  Failed allocation replace: transaction rolled back, old allocations intact
 * BUD-CAP-12  Allocation replace: project row locked (FOR UPDATE) before writes
 * BUD-CAP-13  Budget PATCH: cap check runs inside the same transaction (after BEGIN, before UPDATE)
 * BUD-CAP-14  Concurrency guard: FOR UPDATE row lock present in both write paths (structural)
 * BUD-CAP-15  Successful allocation replace: state_allocations_replace audit entry created
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { ZodError } from "zod";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery, connect: mockConnectFn },
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

const mockLogAudit = vi.fn();
vi.mock("../../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: mockLogAudit,
    requirePerm: (perm: string) => (req: Request, res: Response, next: NextFunction) => {
      const u = req.currentUser;
      if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
      const perms = original.permissionsFor(u as import("../../middlewares/currentUser.js").CurrentUser);
      if (!original.hasPerm(perms, perm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      next();
    },
  };
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM", email: "pm@cafa.org", role: "program_manager",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};
const SUPER_ADMIN_USER = {
  id: 2, name: "SA", email: "sa@cafa.org", role: "super_admin",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

const VALID_PROJECT_BODY = {
  title: "Cap Closure Test Project",
  description: "This is a sufficiently long project description that satisfies the minimum length validation requirement on the CreateProjectBody Zod schema used by the allocation cap closure tests.",
  agreementNumber: "AGR-CAP-001",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  sectors: ["Health"],
  donor: "Test Donor",
  stateIds: [5],
  reportingFrequency: "quarterly",
};

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../projects.js");
  app.use("/api", projectsRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
      return;
    }
    res.status(500).json({ error: "internal" });
  });
  return app;
}

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

// Mock helpers for the allocation replace endpoint.
// pool.query order: getProjectEffectiveSectors → linked-state membership check.
// client.query order: BEGIN → SELECT budget FOR UPDATE → DELETE → INSERTs → COMMIT.
function mockReplaceEndpoint(budget: number, linkedStateIds: number[] = [5]) {
  mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
  mockQuery.mockResolvedValueOnce({ rows: linkedStateIds.map((id) => ({ state_id: id })) });
  mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
  mockClientQuery.mockResolvedValueOnce({ rows: [{ budget }] }); // FOR UPDATE budget read
}

function replaceCall(app: express.Express, allocations: Array<Record<string, unknown>>) {
  return request(app).post("/api/projects/42/state-allocations").send({ allocations });
}

// Mock helper for PATCH: client.query order is status check → BEGIN → budget lock.
function mockPatchEndpoint(oldBudget: number) {
  mockClientQuery.mockResolvedValueOnce({ rows: [{ status: "draft", sector: "Health", sectors: ["Health"] }] });
  mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
  mockClientQuery.mockResolvedValueOnce({ rows: [{ budget: oldBudget }] }); // FOR UPDATE lock
}

const clientSql = () => mockClientQuery.mock.calls.map((c) => String(c[0]));

// ── Allocation replace endpoint ─────────────────────────────────────────────

describe("BUD-CAP-01: zero budget + positive allocation is rejected", () => {
  it("budget=0, allocation=100 → 422 over_allocation", async () => {
    mockReplaceEndpoint(0);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 100 }]);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });
});

describe("BUD-CAP-02: zero budget + zero allocation is valid", () => {
  it("budget=0, allocation=0 → 200", async () => {
    mockReplaceEndpoint(0);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 0 }]);
    expect(res.status).toBe(200);
    expect(clientSql()).toContain("COMMIT");
  });
});

describe("BUD-ZR-01: allocation replacement honours its required request body", () => {
  it("missing allocations is a 400 validation error and never starts a financial write or audit event", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app).post("/api/projects/42/state-allocations").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

describe("BUD-CAP-03: allocation total equal to budget is valid", () => {
  it("budget=1000, allocations sum=1000 → 200", async () => {
    mockReplaceEndpoint(1000, [5, 6]);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [
      { stateId: 5, budgetAllocation: 400 },
      { stateId: 6, budgetAllocation: 600 },
    ]);
    expect(res.status).toBe(200);
  });
});

describe("BUD-CAP-04: allocation total above budget is rejected", () => {
  it("budget=1000, allocations sum=1001 → 422", async () => {
    mockReplaceEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 1001 }]);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });
});

describe("BUD-CAP-05/06: cap is actor-independent", () => {
  it("BUD-CAP-05: PM gets the same 422", async () => {
    mockReplaceEndpoint(500);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 900 }]);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });

  it("BUD-CAP-06: Super Admin gets the same 422", async () => {
    mockReplaceEndpoint(500);
    const app = await buildApp(SUPER_ADMIN_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 900 }]);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });
});

// ── Project PATCH ───────────────────────────────────────────────────────────

describe("BUD-CAP-07: PATCH budget reduction below allocation sum is rejected", () => {
  it("budgetTotal=100 with allocations sum=500 → 422 over_allocation", async () => {
    mockPatchEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await request(app).patch("/api/projects/42").send({
      ...VALID_PROJECT_BODY,
      budgetTotal: 100,
      stateAllocations: [{ stateId: 5, budgetAllocation: 500 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });
});

describe("BUD-CAP-08: PATCH budget increase with allocations is valid", () => {
  it("budgetTotal=2000 with allocations sum=500 → not 422", async () => {
    mockPatchEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await request(app).patch("/api/projects/42").send({
      ...VALID_PROJECT_BODY,
      budgetTotal: 2000,
      stateAllocations: [{ stateId: 5, budgetAllocation: 500 }],
    });
    expect(res.status).not.toBe(422);
    expect(clientSql().some((s) => s.includes("UPDATE projects"))).toBe(true);
  });
});

describe("BUD-CAP-09: PATCH without allocations runs no cap rejection", () => {
  it("unrelated update proceeds", async () => {
    mockPatchEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await request(app).patch("/api/projects/42").send({
      ...VALID_PROJECT_BODY,
      budgetTotal: 300,
    });
    expect(res.status).not.toBe(422);
    expect(clientSql().some((s) => s.includes("UPDATE projects"))).toBe(true);
  });
});

// ── Transactional integrity ─────────────────────────────────────────────────

describe("BUD-CAP-10: failed budget reduction rolls back, budget unchanged", () => {
  it("422 path issues ROLLBACK and never executes UPDATE projects", async () => {
    mockPatchEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await request(app).patch("/api/projects/42").send({
      ...VALID_PROJECT_BODY,
      budgetTotal: 100,
      stateAllocations: [{ stateId: 5, budgetAllocation: 500 }],
    });
    expect(res.status).toBe(422);
    const sql = clientSql();
    expect(sql).toContain("ROLLBACK");
    expect(sql.some((s) => s.includes("UPDATE projects"))).toBe(false);
  });
});

describe("BUD-CAP-11: failed allocation replace rolls back, old rows intact", () => {
  it("422 path issues ROLLBACK before any DELETE of allocations", async () => {
    mockReplaceEndpoint(100);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 999 }]);
    expect(res.status).toBe(422);
    const sql = clientSql();
    expect(sql).toContain("ROLLBACK");
    expect(sql.some((s) => s.includes("DELETE FROM project_state_allocations"))).toBe(false);
  });
});

describe("BUD-CAP-12: allocation replace locks project row before writes", () => {
  it("BEGIN → SELECT ... FOR UPDATE → DELETE ordering", async () => {
    mockReplaceEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 100 }]);
    expect(res.status).toBe(200);
    const sql = clientSql();
    const beginIdx = sql.indexOf("BEGIN");
    const lockIdx = sql.findIndex((s) => s.includes("FOR UPDATE"));
    const deleteIdx = sql.findIndex((s) => s.includes("DELETE FROM project_state_allocations"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(deleteIdx).toBeGreaterThan(lockIdx);
  });
});

describe("BUD-CAP-13: PATCH cap check is inside the same transaction as the budget UPDATE", () => {
  it("BEGIN → FOR UPDATE lock → UPDATE projects ordering", async () => {
    mockPatchEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await request(app).patch("/api/projects/42").send({
      ...VALID_PROJECT_BODY,
      budgetTotal: 2000,
      stateAllocations: [{ stateId: 5, budgetAllocation: 100 }],
    });
    expect(res.status).not.toBe(422);
    const sql = clientSql();
    const beginIdx = sql.indexOf("BEGIN");
    const lockIdx = sql.findIndex((s) => s.includes("FOR UPDATE"));
    const updateIdx = sql.findIndex((s) => s.includes("UPDATE projects"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(updateIdx).toBeGreaterThan(lockIdx);
  });
});

describe("BUD-CAP-14: concurrency guard present in both write paths (structural)", () => {
  it("projects.ts uses FOR UPDATE row locks in allocation replace and PATCH", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../projects.ts"), "utf8");
    const forUpdateBudgetReads = src.match(/budget_total::float, 0\) AS budget FROM projects WHERE id = \$1[^`]*FOR UPDATE/g) ?? [];
    expect(forUpdateBudgetReads.length).toBeGreaterThanOrEqual(2);
    // Zero-budget bypass removed: the conditional `projectBudget > 0 &&` guard is gone.
    expect(src).not.toContain("projectBudget > 0 &&");
    // Unconditional cap comparisons present.
    expect(src).toContain("allocTotal > projectBudget");
    expect(src).toContain("patchAllocTotal > patchEffectiveBudget");
    expect(src).toContain("createAllocTotal > (body.budgetTotal ?? 0)");
  });
});

describe("BUD-CAP-15: successful allocation replace writes audit entry", () => {
  it("logAudit called with action state_allocations_replace", async () => {
    mockReplaceEndpoint(1000);
    const app = await buildApp(PM_USER);
    const res = await replaceCall(app, [{ stateId: 5, budgetAllocation: 100 }]);
    expect(res.status).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "state_allocations_replace" }),
    );
  });
});
