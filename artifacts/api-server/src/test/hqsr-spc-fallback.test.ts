/**
 * HQ Sector Report — SPC Fallback Workflow Tests (HQSR-FB-05 through HQSR-FB-22
 * + HQSR-FB-NOTIF-01 through 04)
 *
 * Verifies the enabled SPC fallback author path (HQSR-BD-1/BD-6):
 *  - Fallback discriminator is the IMMUTABLE workflow_path = 'spc_fallback'
 *    (frozen at creation, Migration 019) — never the author's current role
 *  - PM has reports.approve.coordination (Full Operational Access, Task #373) and
 *    may perform coordination_review on ANY hq_sector report (TC-authored or
 *    spc_fallback), and on other report types too.
 *  - SPC remains the coordination reviewer for TC-authored hq_sector reports when
 *    PM is not acting.
 *  - SPC author cannot self-review (universal self-review guard)
 *  - PM final_approve works after coordination_approved (two audited steps)
 *  - Revision loop: request_revision → draft → resubmit → PM again
 *  - Notification routing: SPC-fallback submit passes hqsrPath "spc_fallback"
 *
 * These tests use the REAL permissionsFor map (not mocked role→perm tables) so
 * they exercise production authorization behaviour.
 *
 * Creation-gate tests (HQSR-FB-01..04) live in hqsr-author-role.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before dynamic import of the route under test
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

const mockNotifyNextApprover = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: mockNotifyNextApprover,
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// IMPORTANT: permissionsFor is the REAL production implementation — only the
// audit sink and the outer route middleware are stubbed.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake users
// ─────────────────────────────────────────────────────────────────────────────

const TC_ID = 11;
const SPC_ID = 15;
const PM_ID = 14;

const TC_USER = {
  id: TC_ID, name: "TC", email: "tc@example.com",
  role: "technical_coordinator", stateId: null, sector: "WASH", sectors: ["WASH"],
} as const;

const SPC_USER = {
  id: SPC_ID, name: "SPC", email: "spc@example.com",
  role: "senior_program_coordinator", stateId: null, sector: null, sectors: [],
} as const;

const PM_USER = {
  id: PM_ID, name: "PM", email: "pm@example.com",
  role: "program_manager", stateId: null, sector: null, sectors: [],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// App builder + SQL-keyed query router
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(user: { role: string } & Record<string, unknown>) {
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

interface ReportRow {
  status: string;
  reportType: string;
  stateId: number | null;
  sector: string | null;
  projectId: number | null;
  activityId: number | null;
  workflowPath: string | null;
  authorId: number | null;
}

/**
 * Routes mockQuery by SQL content:
 *  - SELECT … FOR UPDATE          → the locked report row
 *  - reportSelect / getReportSector (FROM reports r) → generic row
 *  - everything else (BEGIN, UPDATE, INSERT, COMMIT, …) → { rows: [] }
 *
 * Records UPDATE/INSERT calls for assertions. Note: there is deliberately NO
 * "SELECT role FROM users" route — the fallback discriminator is workflow_path,
 * and the tests assert no author-role lookup ever happens.
 */
function routeQueries(report: ReportRow) {
  mockQuery.mockImplementation((sql: unknown) => {
    const s = typeof sql === "string" ? sql : "";
    if (s.includes("FOR UPDATE")) return Promise.resolve({ rows: [report] });
    if (s.includes("FROM reports r")) {
      return Promise.resolve({
        rows: [{
          id: 1, reportType: report.reportType, status: report.status,
          sector: report.sector, projectId: report.projectId,
          activityId: report.activityId, projectSector: null,
          activitySector: null, effectiveSector: report.sector,
          workflowPath: report.workflowPath, authorId: report.authorId,
        }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** SPC-authored fallback report: immutable workflow_path = 'spc_fallback'. */
const FALLBACK_HQSR = (over: Partial<ReportRow> = {}): ReportRow => ({
  status: "submitted",
  reportType: "hq_sector",
  stateId: null,
  sector: "WASH",
  projectId: null,
  activityId: null,
  workflowPath: "spc_fallback",
  authorId: SPC_ID,
  ...over,
});

/** Normal TC-authored report: workflow_path NULL. */
const TC_HQSR = (over: Partial<ReportRow> = {}): ReportRow =>
  FALLBACK_HQSR({ workflowPath: null, authorId: TC_ID, ...over });

function transition(app: express.Express, action: string, comment?: string) {
  return request(app)
    .post("/api/projects/reports/1/transitions")
    .send(comment ? { action, comment } : { action });
}

function updateStatusCalls() {
  return mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("UPDATE reports") && c[0].includes("SET status"),
  );
}

function approvalInsertCalls() {
  return mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO approvals"),
  );
}

function authorRoleLookups() {
  return mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("SELECT role FROM users"),
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockNotifyNextApprover.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Coordination reviewer split
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-FB: coordination reviewer split", () => {
  it("HQSR-FB-05: SPC coordination_review on TC-authored submitted hq_sector → 200", async () => {
    routeQueries(TC_HQSR());
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("coordination_approved");
  });

  it("HQSR-FB-06: PM coordination_review on TC-authored hq_sector → 200 (Full Operational Access; reports.approve.coordination granted)", async () => {
    routeQueries(TC_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("coordination_approved");
  });

  it("PM request_revision on TC-authored hq_sector → 200 (Full Operational Access; reports.approve.coordination covers request_revision)", async () => {
    routeQueries(TC_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "request_revision", "nope");
    expect(res.status).toBe(200);
  });

  it("HQSR-FB-07: SPC fallback submit → 200 submitted", async () => {
    routeQueries(FALLBACK_HQSR({ status: "draft" }));
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "submit");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("submitted");
  });

  it("HQSR-FB-08: SPC author attempts coordination_review on own report → 403 self_review_forbidden", async () => {
    routeQueries(FALLBACK_HQSR());
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("self_review_forbidden");
  });

  it("HQSR-FB-09/10: PM coordination_review on spc_fallback hq_sector → 200 coordination_approved (real perms: PM lacks reports.approve.coordination)", async () => {
    routeQueries(FALLBACK_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("coordination_approved");
    // The discriminator is workflow_path — no author-role lookup happened
    expect(authorRoleLookups()).toHaveLength(0);
  });

  it("HQSR-FB-11/12: PM final_approve after coordination_approved → 200 approved", async () => {
    routeQueries(FALLBACK_HQSR({ status: "coordination_approved" }));
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "final_approve");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("approved");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit history
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-FB: audit history (13–15)", () => {
  it("HQSR-FB-13/14/15: coordination_review and final_approve each insert one distinct approvals record", async () => {
    routeQueries(FALLBACK_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    await transition(app, "coordination_review");
    const first = approvalInsertCalls();
    expect(first).toHaveLength(1);
    expect(first[0][1][1]).toBe("coordination_review");

    mockQuery.mockClear();
    routeQueries(FALLBACK_HQSR({ status: "coordination_approved" }));
    await transition(app, "final_approve");
    const second = approvalInsertCalls();
    expect(second).toHaveLength(1);
    expect(second[0][1][1]).toBe("final_approve");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Revision loop
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-FB: revision loop (16–19)", () => {
  it("HQSR-FB-16: PM request_revision on spc_fallback submitted report → status draft", async () => {
    routeQueries(FALLBACK_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "request_revision", "Please clarify section 2");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("draft");
  });

  it("HQSR-FB-17: SPC author resubmits from draft → 200 submitted", async () => {
    routeQueries(FALLBACK_HQSR({ status: "draft" }));
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "submit");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("submitted");
  });

  it("HQSR-FB-18: after resubmit, PM remains the coordination reviewer → 200", async () => {
    routeQueries(FALLBACK_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
  });

  it("HQSR-FB-19: PM reject at coordination stage → 200 rejected (SIMPLE_CHAIN semantics)", async () => {
    routeQueries(FALLBACK_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "reject", "Not acceptable");
    expect(res.status).toBe(200);
    expect(updateStatusCalls()[0][1][0]).toBe("rejected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full Operational Access — PM coordination_review across all report types
// (Task #373: PM holds reports.approve.coordination globally)
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-FB: PM Full Operational Access coordination_review (20–22)", () => {
  it("HQSR-FB-20: PM coordination_review on program_state → 200 (Full Operational Access)", async () => {
    routeQueries(FALLBACK_HQSR({ reportType: "program_state", stateId: 1, sector: null, workflowPath: null, authorId: 10 }));
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
  });

  it("HQSR-FB-20b (control): SPC coordination_review on program_state → 200 (existing behaviour intact)", async () => {
    routeQueries(FALLBACK_HQSR({ reportType: "program_state", stateId: 1, sector: null, workflowPath: null, authorId: 10 }));
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
  });

  for (const [id, rt] of [["21", "project"], ["22", "activity"]] as const) {
    it(`HQSR-FB-${id}: PM coordination_review on ${rt} report → 200 (Full Operational Access)`, async () => {
      routeQueries(
        FALLBACK_HQSR({ reportType: rt, stateId: 1, projectId: 42, workflowPath: "state_authored", status: "technically_approved", authorId: 10 }),
      );
      const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
      const res = await transition(app, "coordination_review");
      expect(res.status).toBe(200);
    });
  }

  it("PM coordination_review on program_state with mislabeled spc_fallback path → 200 (Full Operational Access; workflow_path is irrelevant for PM)", async () => {
    // PM has reports.approve.coordination globally, so workflow_path label is irrelevant.
    routeQueries(FALLBACK_HQSR({ reportType: "program_state", stateId: 1, sector: null, workflowPath: "spc_fallback", authorId: 10 }));
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Notification routing
// ─────────────────────────────────────────────────────────────────────────────

describe("HQSR-FB-NOTIF: submit notification routing", () => {
  it("HQSR-FB-NOTIF-02: SPC-fallback submit passes hqsrPath 'spc_fallback' and excludes the author", async () => {
    routeQueries(FALLBACK_HQSR({ status: "draft" }));
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    await transition(app, "submit");
    expect(mockNotifyNextApprover).toHaveBeenCalledTimes(1);
    const arg = mockNotifyNextApprover.mock.calls[0][0];
    expect(arg.hqsrPath).toBe("spc_fallback");
    expect(arg.exceptUserId).toBe(SPC_ID); // HQSR-FB-NOTIF-03
  });

  it("HQSR-FB-NOTIF-01: TC-authored submit passes hqsrPath 'tc_authored' (default routing preserved)", async () => {
    routeQueries(TC_HQSR({ status: "draft" }));
    const app = await buildApp(TC_USER as unknown as { role: string } & Record<string, unknown>);
    await transition(app, "submit");
    const arg = mockNotifyNextApprover.mock.calls[0][0];
    expect(arg.hqsrPath).toBe("tc_authored");
    expect(arg.workflowPath).toBeNull();
  });

  it("HQSR-FB-NOTIF-04: PM coordination_review on TC-authored → 200 and notification sent (Full Operational Access)", async () => {
    // Previously expected 403 (PM lacked reports.approve.coordination). Task #373
    // grants PM full access; the transition now succeeds and notification fires.
    routeQueries(TC_HQSR());
    const app = await buildApp(PM_USER as unknown as { role: string } & Record<string, unknown>);
    const res = await transition(app, "coordination_review");
    expect(res.status).toBe(200);
    expect(mockNotifyNextApprover).toHaveBeenCalledTimes(1);
  });

  it("non-hq_sector submit passes hqsrPath null", async () => {
    routeQueries(FALLBACK_HQSR({ reportType: "program_state", status: "draft", stateId: 1, sector: null, workflowPath: null, authorId: 10 }));
    const app = await buildApp(SPC_USER as unknown as { role: string } & Record<string, unknown>);
    await transition(app, "submit");
    const arg = mockNotifyNextApprover.mock.calls[0][0];
    expect(arg.hqsrPath).toBeNull();
  });
});
