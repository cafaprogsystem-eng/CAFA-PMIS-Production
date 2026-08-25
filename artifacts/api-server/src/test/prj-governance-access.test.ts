/**
 * PRJ Residual Governance & Access Closure (Task — PRJ-BD-02 / PRJ-028 / PRJ-036)
 *
 * Closes:
 *   PRJ-BD-02 / PRJ-021  Stage-aware reject/request_revision permissions
 *   PRJ-028              SPO list/detail scope asymmetry (project_assignments)
 *   PRJ-036              GET /projects/donors explicit permission
 *
 * Test IDs:
 *   PRJ-GOV-01..10        Stage-aware negative-transition workflow
 *   PRJ-GOV-FULL-01..03   PM / Super Admin Full Access behaviour
 *   PRJ-STATE-LIST-01..06 State-role list scope (states + user assignments)
 *   PRJ-DONOR-01..05      Donor reference endpoint permission
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { ZodError } from "zod";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn().mockResolvedValue(mockClient);

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: mockConnectFn,
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

const mockLogAudit = vi.fn().mockResolvedValue(undefined);

// Real permissionsFor / hasPerm / assertStateAllowed / requirePerm-equivalent are
// used so any RBAC regression is caught by these tests.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: mockLogAudit,
    requirePerm: (perm: string) => (req: Request, res: Response, next: NextFunction) => {
      const u = req.currentUser;
      if (!u) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const perms = original.permissionsFor(u as import("../middlewares/currentUser.js").CurrentUser);
      if (!original.hasPerm(perms, perm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      next();
    },
  };
});

// ─── User fixtures ────────────────────────────────────────────────────────────

const base = { stateName: null, sector: null, sectors: null, avatarUrl: null };

const PM_USER = { id: 1, name: "PM User", email: "pm@cafa.org", role: "program_manager", roleLabel: "Programme Manager", scope: "hq", stateId: null, ...base };
const SA_USER = { id: 2, name: "SA User", email: "sa@cafa.org", role: "super_admin", roleLabel: "Super Admin", scope: "hq", stateId: null, ...base };
const TC_USER = { id: 10, name: "TC Health", email: "tc@cafa.org", role: "technical_coordinator", roleLabel: "Technical Coordinator", scope: "hq", stateId: null, ...base, sector: "Health", sectors: ["Health"] };
const SPC_USER = { id: 15, name: "SPC User", email: "spc@cafa.org", role: "senior_program_coordinator", roleLabel: "Senior Programme Coordinator", scope: "hq", stateId: null, ...base };
const SPO_USER = { id: 20, name: "SPO User", email: "spo@cafa.org", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, ...base, stateName: "South Kordofan" };
const SPO_PEER_USER = { id: 23, name: "SPO Peer", email: "spo2@cafa.org", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: 5, ...base, stateName: "South Kordofan" };
const SPO_NULL_STATE_USER = { id: 22, name: "SPO NoState", email: "spo.null@cafa.org", role: "state_program_officer", roleLabel: "State Programme Officer", scope: "state", stateId: null, ...base };
const VIEWER_USER = { id: 30, name: "Viewer", email: "view@cafa.org", role: "viewer", roleLabel: "Viewer", scope: "hq", stateId: null, ...base };
// Unknown role → falls through permissionsFor → universal perms only (no projects.*)
const UNKNOWN_ROLE_USER = { id: 99, name: "Unknown", email: "unknown@cafa.org", role: "programme_assistant", roleLabel: "Programme Assistant", scope: "hq", stateId: null, ...base };

// ─── App factory ──────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user) (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use("/api", projectsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
      return;
    }
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// Wires the pool mock to answer the transition handler's queries for a project
// currently in `fromStatus`. Returns nothing; assertions read mockQuery.mock.calls.
function primeTransitionProject(fromStatus: string, projectId = 77) {
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string") {
      if (sql.includes("SELECT status, sector")) {
        return Promise.resolve({
          rows: [{ status: fromStatus, sector: "Health", sectors: ["Health"], managementLevel: "hq_managed" }],
        });
      }
      if (sql.includes("UPDATE projects SET status")) {
        return Promise.resolve({ rows: [{ id: projectId, status: "updated" }] });
      }
      if (sql.includes("project_states ps") || sql.includes("project_assignments pa")) {
        // assertStateAllowed union query — allow
        return Promise.resolve({ rows: [{ "?column?": 1 }] });
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

function updateProjectsStatusCalls() {
  return mockQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE projects SET status"),
  );
}

async function doTransition(user: Record<string, unknown>, action: string, fromStatus: string) {
  primeTransitionProject(fromStatus);
  const app = await buildApp(user);
  return request(app)
    .post("/api/projects/77/transitions")
    .send({ action, comment: "Governance test rationale" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockLogAudit.mockResolvedValue(undefined);
});

// ─── PRJ-GOV — Stage-aware reject / request_revision ─────────────────────────

describe("PRJ-GOV — stage-aware negative transitions", () => {
  it("PRJ-GOV-01  TC request_revision from submitted (technical stage) succeeds", async () => {
    const res = await doTransition(TC_USER, "request_revision", "submitted");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["draft", 77]);
  });

  it("PRJ-GOV-02  TC reject from state_reviewed (technical stage) succeeds", async () => {
    const res = await doTransition(TC_USER, "reject", "state_reviewed");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["rejected", 77]);
  });

  it("PRJ-GOV-03  SPC request_revision from technically_approved (coordination stage) succeeds", async () => {
    const res = await doTransition(SPC_USER, "request_revision", "technically_approved");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["draft", 77]);
  });

  it("PRJ-GOV-04  SPC reject from technically_approved (coordination stage) succeeds", async () => {
    const res = await doTransition(SPC_USER, "reject", "technically_approved");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["rejected", 77]);
  });

  it("PRJ-GOV-05  PM request_revision from coordination_approved (final stage) succeeds", async () => {
    const res = await doTransition(PM_USER, "request_revision", "coordination_approved");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["draft", 77]);
  });

  it("PRJ-GOV-06  PM reject from coordination_approved (final stage) succeeds", async () => {
    const res = await doTransition(PM_USER, "reject", "coordination_approved");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["rejected", 77]);
  });

  it("PRJ-GOV-07  SPC cannot perform technical_review (wrong stage) despite coordination authority", async () => {
    const res = await doTransition(SPC_USER, "technical_review", "submitted");
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.approve.technical");
    expect(updateProjectsStatusCalls()).toHaveLength(0);
  });

  it("PRJ-GOV-08  TC cannot reject a coordination_approved project (not their stage)", async () => {
    const res = await doTransition(TC_USER, "reject", "coordination_approved");
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.approve.final");
    expect(updateProjectsStatusCalls()).toHaveLength(0);
  });

  it("PRJ-GOV-09  Valid request_revision returns the same project ID in draft state", async () => {
    const res = await doTransition(SPC_USER, "request_revision", "technically_approved");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(77);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["draft", 77]);
  });

  it("PRJ-GOV-10  Invalid source status fails with no workflow side effects", async () => {
    const res = await doTransition(PM_USER, "reject", "draft");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cannot reject from draft");
    expect(updateProjectsStatusCalls()).toHaveLength(0);
    // No approvals row and no audit entry either
    const approvalsCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO approvals"),
    );
    expect(approvalsCalls).toHaveLength(0);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

// ─── PRJ-GOV-FULL — Full Operational Access ──────────────────────────────────

describe("PRJ-GOV-FULL — PM / Super Admin Full Access", () => {
  it("PRJ-GOV-FULL-01  PM Full Access reject succeeds (technical stage)", async () => {
    const res = await doTransition(PM_USER, "reject", "submitted");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["rejected", 77]);
  });

  it("PRJ-GOV-FULL-02  Super Admin Full Access reject succeeds (coordination stage)", async () => {
    const res = await doTransition(SA_USER, "reject", "technically_approved");
    expect(res.status).toBe(200);
    expect(updateProjectsStatusCalls()[0][1]).toEqual(["rejected", 77]);
  });

  it("PRJ-GOV-FULL-03  Full Access cannot jump an invalid workflow source status", async () => {
    const res = await doTransition(SA_USER, "final_approve", "submitted");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("cannot final_approve from submitted");
    expect(updateProjectsStatusCalls()).toHaveLength(0);
  });
});

// ─── PRJ-STATE-LIST — State-role list scope (PRJ-028) ────────────────────────

function listFilterCall() {
  return mockQuery.mock.calls.find(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("FROM projects p") && (c[0] as string).includes("deleted_at IS NULL"),
  );
}

describe("PRJ-STATE-LIST — SPO list scope parity", () => {
  it("PRJ-STATE-LIST-01  Project linked via project_states appears in SPO list", async () => {
    const app = await buildApp(SPO_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: "State Project" }] });
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const call = listFilterCall();
    expect(call?.[0]).toMatch(/project_states ps WHERE ps\.project_id = p\.id AND ps\.state_id/);
    expect(call?.[1]).toContain(5);
  });

  it("PRJ-STATE-LIST-02  User-specific project_assignment surfaces project for the assigned SPO", async () => {
    const app = await buildApp(SPO_USER);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2, title: "Assigned Project" }] });
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    const call = listFilterCall();
    // OR-combined user-scoped assignment clause is present, bound to the caller's id
    expect(call?.[0]).toMatch(/OR EXISTS \(SELECT 1 FROM project_assignments pa WHERE pa\.project_id = p\.id AND pa\.user_id/);
    expect(call?.[1]).toContain(SPO_USER.id);
  });

  it("PRJ-STATE-LIST-03  Unassigned same-State SPO does not inherit a peer's assignment visibility", async () => {
    const app = await buildApp(SPO_PEER_USER);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    const call = listFilterCall();
    // The assignment clause binds ONLY the current caller's user id — never a peer's
    expect(call?.[1]).toContain(SPO_PEER_USER.id);
    expect(call?.[1]).not.toContain(SPO_USER.id);
  });

  it("PRJ-STATE-LIST-04  Cross-State query param cannot widen an SPO's scope", async () => {
    const app = await buildApp(SPO_USER);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/projects?stateId=9");
    expect(res.status).toBe(200);
    const call = listFilterCall();
    // State clamp uses the user's own state (5), not the requested state (9)
    expect(call?.[1]).toContain(5);
    expect(call?.[1]).not.toContain(9);
  });

  it("PRJ-STATE-LIST-05  Null-State SPO fails closed (empty list, no query)", async () => {
    const app = await buildApp(SPO_NULL_STATE_USER);
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(listFilterCall()).toBeUndefined();
  });

  it("PRJ-STATE-LIST-06  List/detail parity — assignment-visible project passes detail access", async () => {
    // Detail/mutation access goes through the real assertStateAllowed, whose union
    // query accepts project_assignments.user_id. A project surfaced in the list via
    // the assignment clause must therefore also pass detail access.
    const original = await vi.importActual<typeof import("../middlewares/currentUser.js")>("../middlewares/currentUser.js");
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    const fakeReq = { currentUser: SPO_USER } as unknown as Request;
    const result = await original.assertStateAllowed(fakeReq, 2);
    expect(result).toEqual({ ok: true });
    const call = mockQuery.mock.calls[0];
    // SPO detail access is assignment-only: the user's state is validated
    // before this query but is intentionally not bound into its predicate.
    expect(call[0]).toMatch(/project_assignments pa\s+WHERE pa\.project_id = \$1 AND pa\.user_id = \$2/);
    expect(call[1]).toEqual([2, SPO_USER.id]);
  });
});

// ─── PRJ-DONOR — Donor endpoint permission (PRJ-036) ─────────────────────────

const DONOR_ROW = {
  id: 1, name: "Donor X", abbreviation: "DX", country: "Sudan",
  contactName: "Jane", contactEmail: "jane@donor.org", createdAt: "2026-01-01T00:00:00.000Z",
};

describe("PRJ-DONOR — GET /projects/donors permission", () => {
  it("PRJ-DONOR-01  Unauthenticated and underprivileged callers are denied", async () => {
    const anonApp = await buildApp(null);
    const anonRes = await request(anonApp).get("/api/donors");
    expect(anonRes.status).toBe(401);

    const underApp = await buildApp(UNKNOWN_ROLE_USER);
    const underRes = await request(underApp).get("/api/donors");
    expect(underRes.status).toBe(403);
    expect(underRes.body.requiredPermission).toBe("projects.view");
  });

  it("PRJ-DONOR-02  Legitimate project viewer (projects.view) can read the donor list", async () => {
    const app = await buildApp(VIEWER_USER);
    mockQuery.mockResolvedValueOnce({ rows: [DONOR_ROW] });
    const res = await request(app).get("/api/donors");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("PRJ-DONOR-03  PM Full Access works", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [DONOR_ROW] });
    const res = await request(app).get("/api/donors");
    expect(res.status).toBe(200);
  });

  it("PRJ-DONOR-04  Super Admin works", async () => {
    const app = await buildApp(SA_USER);
    mockQuery.mockResolvedValueOnce({ rows: [DONOR_ROW] });
    const res = await request(app).get("/api/donors");
    expect(res.status).toBe(200);
  });

  it("PRJ-DONOR-05  Response contains only the intended reference fields", async () => {
    const app = await buildApp(PM_USER);
    mockQuery.mockResolvedValueOnce({ rows: [DONOR_ROW] });
    const res = await request(app).get("/api/donors");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(
      ["abbreviation", "contactEmail", "contactName", "country", "createdAt", "id", "name"],
    );
    // SQL selects exactly the clean reference columns
    const sqlCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("FROM donors"),
    );
    expect(sqlCall?.[0]).toMatch(/SELECT id, name, abbreviation, country, contact_name AS "contactName",\s*contact_email AS "contactEmail", created_at AS "createdAt"/);
  });
});
