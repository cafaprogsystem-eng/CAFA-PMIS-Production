/**
 * pmr-notifications-routes.test.ts — Part B of the PMR notification audit (Task #333).
 * Route-level: transaction safety (zero notifications on failed transitions),
 * workflowPath passthrough, kind/link correctness.
 * IDs: PMR-NOTIF-03/-04/-15/-16, PMR-NOTIF-LINK-01/-05, PMR-NOTIF-DUP-02/-03.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();
const mockNotifyEntityActors = vi.fn();
const mockNotifyNextApprover = vi.fn();

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockConnect },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: mockNotifyEntityActors,
  notifyNextApprover: mockNotifyNextApprover,
}));

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    permissionsFor: vi.fn((u: { role?: string }) =>
      u?.role === "viewer" ? [] :
      u?.role === "program_manager"
        ? ["reports.update", "reports.approve.final", "reports.approve.coordination"]
        : ["reports.create", "reports.update"]),
  };
});

const SPO_USER = {
  id: 42, name: "SPO Test", email: "spo@example.com",
  role: "state_program_officer", stateId: 1, sector: null, sectors: [] as string[],
};
const PM_USER = {
  id: 77, name: "PM Test", email: "pm@example.com",
  role: "program_manager", stateId: null, sector: null, sectors: [] as string[],
};
const VIEWER_USER = {
  id: 66, name: "Viewer", email: "v@example.com",
  role: "viewer", stateId: null, sector: null, sectors: [] as string[],
};

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

function pmrLockRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "draft", reportType: "project", stateId: 1, sector: "WASH",
    projectId: 10, activityId: null, workflowPath: "state_authored", authorId: 42,
    ...overrides,
  };
}

function pmrGetReportSector(sector = "WASH") {
  return {
    rows: [{
      reportType: "project", projectId: 10,
      projectSector: sector, activitySector: null, effectiveSector: sector,
    }],
  };
}

function validActivity() {
  return {
    name: "Community Health Outreach", actualExpenditure: 5000, plannedBudget: 5000,
    achievementSummary: "All targets met.", beneficiariesMen: 50, beneficiariesWomen: 60,
    beneficiariesBoys: 20, beneficiariesGirls: 30,
    isUnplanned: false, unplannedReason: "", varianceReason: "",
  };
}

function pmrContentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: "July 2026 Project Report", project_id: 10, state_id: 1,
    location_type: "state", kind: "monthly", period: "2026-07", period_start: null,
    on_demand_reason: null, reporting_month: 7, reporting_year: 2026, quarter: null,
    sections: {
      keyAchievements: "Reached 160 beneficiaries across 3 districts.",
      lessonsLearned: "Early engagement reduced resistance.",
    },
    activities: [validActivity()],
    ...overrides,
  };
}

/** Full client mock sequence for a successful submit (mirrors reports-pmr-submit). */
function mockPmrClientSequence(
  lockRow: Record<string, unknown>,
  contentRow: Record<string, unknown>,
  attachCount = 1,
) {
  mockClientQuery
    .mockResolvedValueOnce({ rows: [] })                          // BEGIN
    .mockResolvedValueOnce({ rows: [lockRow] })                   // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rows: [contentRow] })                // SELECT content
    .mockResolvedValueOnce({ rows: [{ currency: "USD" }] })       // SELECT currency
    .mockResolvedValueOnce({ rows: [{ cnt: attachCount }] });     // COUNT attachments
  // remaining calls default to { rows: [] }
}

describe("Part B — transition endpoint notification safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockConnect.mockImplementation(async () => ({
      query: mockClientQuery,
      release: mockClientRelease,
    }));
    mockNotifyEntityActors.mockResolvedValue(undefined);
    mockNotifyNextApprover.mockResolvedValue(undefined);
  });

  it("PMR-NOTIF-01r: state_authored submit passes workflowPath='state_authored' to notifyNextApprover", async () => {
    const app = await buildApp(SPO_USER);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())                 // getReportSector
      .mockResolvedValueOnce({ rows: [{ rt: "project" }] })        // reportDeepLink
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "submit" });

    expect(res.status).toBe(200);
    expect(mockNotifyNextApprover).toHaveBeenCalledOnce();
    expect(mockNotifyNextApprover.mock.calls[0][0]).toMatchObject({
      action: "submit",
      workflowPath: "state_authored",
      sector: "WASH",
    });
  });

  it("PMR-NOTIF-02r: technical_authored submit passes workflowPath='technical_authored'", async () => {
    const app = await buildApp(SPO_USER);
    mockPmrClientSequence(pmrLockRow({ workflowPath: "technical_authored" }), pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValueOnce({ rows: [{ rt: "project" }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "submit" });

    expect(res.status).toBe(200);
    expect(mockNotifyNextApprover).toHaveBeenCalledOnce();
    expect(mockNotifyNextApprover.mock.calls[0][0]).toMatchObject({
      workflowPath: "technical_authored",
    });
  });

  it("PMR-NOTIF-03 / DUP-02: validation-failed submit (report_content_incomplete) → zero notifications", async () => {
    const app = await buildApp(SPO_USER);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow({ title: "" }));
    mockPoolQuery.mockResolvedValue(pmrGetReportSector());

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "submit" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIF-04: permission-denied submit → 403, zero notifications", async () => {
    const app = await buildApp(VIEWER_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                // BEGIN
      .mockResolvedValueOnce({ rows: [pmrLockRow()] });   // SELECT FOR UPDATE

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "submit" });

    expect(res.status).toBe(403);
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIF-15: successful final_approve → notifyEntityActorsDeduped with kind 'approved', not mandatory", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                                            // BEGIN
      .mockResolvedValueOnce({ rows: [pmrLockRow({ status: "coordination_approved" })] }); // lock
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())          // getReportSector
      .mockResolvedValueOnce({ rows: [] })                  // unresolvedRequiredCorrections
      .mockResolvedValueOnce({ rows: [{ rt: "project" }] }) // reportDeepLink
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "final_approve" });

    expect(res.status).toBe(200);
    expect(mockNotifyEntityActors).toHaveBeenCalledOnce();
    const arg = mockNotifyEntityActors.mock.calls[0][0];
    expect(arg.kind).toBe("approved");
    expect(arg.mandatory).toBeFalsy();
  });

  it("PMR-NOTIF-16: permission-denied final_approve → 403, zero notifications", async () => {
    const app = await buildApp(SPO_USER); // SPO lacks reports.approve.final
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pmrLockRow({ status: "coordination_approved", authorId: 999 })] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "final_approve" });

    expect(res.status).toBe(403);
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIF-16b: PM self-review final_approve without overrideReason → 400 override_reason_required, zero notifications (Task #373)", async () => {
    // PM/super_admin may self-review as an override, but must supply overrideReason.
    // Without it the transition returns 400 (not 403) before committing — no notifications.
    const app = await buildApp(PM_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pmrLockRow({ status: "coordination_approved", authorId: PM_USER.id })] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "final_approve" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIF-LINK-01: successful transition uses '?open=<id>' deep link routed to /reports/project", async () => {
    const app = await buildApp(SPO_USER);
    mockPmrClientSequence(pmrLockRow(), pmrContentRow());
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValueOnce({ rows: [{ rt: "project" }] })   // reportDeepLink
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "submit" });

    expect(res.status).toBe(200);
    expect(mockNotifyEntityActors.mock.calls[0][0].link).toBe("/reports/project?open=1");
    expect(mockNotifyNextApprover.mock.calls[0][0].link).toBe("/reports/project?open=1");
  });

  it("PMR-NOTIF-DUP-03 / LINK-05: repeated submit (already submitted) → 400, zero notifications", async () => {
    const app = await buildApp(SPO_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pmrLockRow({ status: "submitted" })] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "submit" });

    expect(res.status).toBe(400);
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIF-STALE: technical_review on technically_approved report → 400, zero notifications", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pmrLockRow({ status: "technically_approved", authorId: 999 })] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions").send({ action: "technical_review" });

    expect(res.status).toBe(400);
    expect(mockNotifyEntityActors).not.toHaveBeenCalled();
    expect(mockNotifyNextApprover).not.toHaveBeenCalled();
  });

  it("PMR-NOTIF-12r: request_revision → mandatory notifyEntityActorsDeduped with kind 'returned'", async () => {
    const app = await buildApp(PM_USER);
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [pmrLockRow({ status: "technically_approved", authorId: 999 })] });
    mockPoolQuery
      .mockResolvedValueOnce(pmrGetReportSector())
      .mockResolvedValueOnce({ rows: [{ rt: "project" }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post("/api/projects/reports/1/transitions")
      .send({ action: "request_revision", comment: "Please fix section 3." });

    expect(res.status).toBe(200);
    const arg = mockNotifyEntityActors.mock.calls[0][0];
    expect(arg.kind).toBe("returned");
    expect(arg.mandatory).toBe(true);
  });
});
