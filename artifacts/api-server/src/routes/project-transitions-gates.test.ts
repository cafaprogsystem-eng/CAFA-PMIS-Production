/**
 * PROJ-TRANSITIONS-GATES — POST /projects/:projectId/transitions
 *
 * 1. A soft-deleted project cannot have its status changed (previously the
 *    lookup and UPDATE never checked deleted_at, so a stale project ID —
 *    a bookmarked link, an old email — could still flip status after the
 *    project was supposed to be gone).
 * 2. The status UPDATE is an atomic compare-and-swap (AND status =
 *    $fromStatus): a concurrent transition that already changed the status
 *    between our read and this write is reported as a 409 conflict instead
 *    of silently overwriting whichever transition committed last.
 * 3. final_approve is blocked when the detailed cost breakdown (direct +
 *    indirect + CAFA contribution) exceeds the approved budget total, and
 *    when disaggregated beneficiaries (male+female+boys+girls) exceed the
 *    beneficiaries target — both close at final approval, not at draft
 *    save time, matching the budget-allocation-cap gate's own convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const { mockQuery, mockClientQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockClientQuery: vi.fn(),
}));
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnect = vi.fn().mockResolvedValue(mockClient);

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery, connect: mockConnect } }));
vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn(), notifyEntityActorsDeduped: vi.fn(), notifyNextApprover: vi.fn(),
  createNotification: vi.fn(), createNotificationDeduped: vi.fn(), notifyByRole: vi.fn(),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/currentUser")>();
  return { ...actual, logAudit: vi.fn() };
});

const projectsRouter = (await import("./projects")).default;

const PM_USER = {
  id: 1, name: "PM", email: "pm@test.test", role: "program_manager", roleLabel: "PM",
  scope: "hq", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
};

function appAs(user: typeof PM_USER) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user as never;
    next();
  });
  app.use(projectsRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", detail: String(err) });
  });
  return request(app);
}

type ProjectFixture = {
  status: string;
  deletedAt?: string | null;
  budgetTotal?: number;
  directCost?: number; indirectCost?: number; cafaContribution?: number;
  beneficiariesTarget?: number | null;
  beneficiariesMale?: number; beneficiariesFemale?: number; beneficiariesBoys?: number; beneficiariesGirls?: number;
  agreementDocs?: number; budgetDocs?: number;
};

function stubProject(fixture: ProjectFixture, opts: { casSucceeds?: boolean } = {}) {
  const casSucceeds = opts.casSucceeds ?? true;
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT status, sector")) {
      if (fixture.deletedAt) return { rows: [], rowCount: 0 };
      return { rows: [{ status: fixture.status, sector: "Health", sectors: ["Health"], managementLevel: "hq_managed" }], rowCount: 1 };
    }
    if (sql.includes("project_states ps") || sql.includes("project_assignments pa")) {
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    }
    if (sql.includes("required_correction")) {
      return { rows: [{ n: 0 }], rowCount: 1 };
    }
    if (sql.includes("agreement_count")) {
      return { rows: [{ agreement_count: String(fixture.agreementDocs ?? 1), budget_count: String(fixture.budgetDocs ?? 1) }], rowCount: 1 };
    }
    if (sql.includes('"directCost"')) {
      return {
        rows: [{
          budgetTotal: fixture.budgetTotal ?? 100_000,
          directCost: fixture.directCost ?? 0,
          indirectCost: fixture.indirectCost ?? 0,
          cafaContribution: fixture.cafaContribution ?? 0,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('"beneficiariesTarget"')) {
      return {
        rows: [{
          beneficiariesTarget: fixture.beneficiariesTarget ?? 1000,
          beneficiariesMale: fixture.beneficiariesMale ?? 0,
          beneficiariesFemale: fixture.beneficiariesFemale ?? 0,
          beneficiariesBoys: fixture.beneficiariesBoys ?? 0,
          beneficiariesGirls: fixture.beneficiariesGirls ?? 0,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("UPDATE projects SET status")) {
      return casSucceeds
        ? { rows: [{ id: 77, status: "updated" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PROJ-TRANSITIONS-GATES — soft-deleted projects cannot transition", () => {
  it("returns 404 when the project is soft-deleted (deleted_at IS NOT NULL)", async () => {
    stubProject({ status: "submitted", deletedAt: "2026-01-01" });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "technical_review" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("project not found");
  });
});

describe("PROJ-TRANSITIONS-GATES — atomic compare-and-swap", () => {
  it("returns 409 project_status_conflict when a concurrent transition already changed the status", async () => {
    stubProject({ status: "coordination_approved" }, { casSucceeds: false });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_status_conflict");
  });

  it("succeeds and returns the updated project when the CAS update matches", async () => {
    stubProject({ status: "coordination_approved" });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(200);
  });
});

describe("PROJ-TRANSITIONS-GATES — final_approve budget breakdown gate", () => {
  it("blocks final_approve when direct + indirect + CAFA contribution exceeds budget_total", async () => {
    stubProject({
      status: "coordination_approved",
      budgetTotal: 100_000, directCost: 60_000, indirectCost: 30_000, cafaContribution: 20_000,
    });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("budget_breakdown_exceeds_total");
    expect(res.body.detailedCostTotal).toBe(110_000);
    expect(res.body.budgetTotal).toBe(100_000);
  });

  it("allows final_approve when the breakdown is under or equal to the total", async () => {
    stubProject({
      status: "coordination_approved",
      budgetTotal: 100_000, directCost: 50_000, indirectCost: 30_000, cafaContribution: 20_000,
    });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(200);
  });
});

describe("PROJ-TRANSITIONS-GATES — final_approve beneficiaries breakdown gate", () => {
  it("blocks final_approve when disaggregated beneficiaries exceed the target", async () => {
    stubProject({
      status: "coordination_approved",
      beneficiariesTarget: 100, beneficiariesMale: 60, beneficiariesFemale: 60,
    });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("beneficiaries_breakdown_exceeds_target");
    expect(res.body.beneficiarySum).toBe(120);
    expect(res.body.beneficiariesTarget).toBe(100);
  });

  it("allows final_approve when disaggregated beneficiaries are under or equal to the target", async () => {
    stubProject({
      status: "coordination_approved",
      beneficiariesTarget: 100, beneficiariesMale: 40, beneficiariesFemale: 60,
    });
    const res = await appAs(PM_USER).post("/projects/77/transitions").send({ action: "final_approve" });
    expect(res.status).toBe(200);
  });
});
