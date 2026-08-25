/**
 * PRJ-MSEC — Multi-Sector Technical Coordinator Project Scope (Task #456)
 *
 * Implements PRJ-BD-05: TC whose assigned sector appears only in sectors[] JSONB
 * (not in the primary sector column) must be able to access project detail and
 * mutation endpoints.
 *
 * Test IDs:
 *   PRJ-MSEC-01..08   assertEffectiveSectorAllowedForProject helper unit tests
 *   PRJ-MSEC-DETAIL-01  TC with secondary-sector-only match can open Project detail
 *   PRJ-MSEC-UPDATE-01  TC with permission + secondary-sector match can PATCH
 *   PRJ-MSEC-UPDATE-02  TC without any sector match denied on PATCH
 *   PRJ-MSEC-MERGE-01   Merge endpoint uses effective-sector scope
 *   PRJ-MSEC-BUD-01     Budget endpoint uses effective-sector scope
 *   PRJ-MSEC-ALLOC-01   State allocations GET uses effective-sector scope
 *   PRJ-MSEC-DUP-01     Duplicate-check respects sectors[]
 *   PRJ-MSEC-PERM-01    Sector match alone does not grant update permission to TC without projects.update
 *   PRJ-MSEC-FULL-01    PM Full Access (#373) unaffected — sees all Projects regardless
 *   PRJ-MSEC-FULL-02    Super Admin Full Access (#373) unaffected
 *   PRJ-MSEC-STATE-01   SPO cross-State denial remains intact
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

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockLogAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,  // real permissionsFor, hasPerm, assertSectorAllowed, tcSectorRestriction, assertStateAllowed
    logAudit: mockLogAudit,
    requirePerm: (perm: string) => (req: Request, res: Response, next: NextFunction) => {
      const u = req.currentUser;
      if (u) {
        const perms = original.permissionsFor(u as import("../middlewares/currentUser.js").CurrentUser);
        if (!original.hasPerm(perms, perm)) {
          res.status(403).json({ error: "forbidden", requiredPermission: perm });
          return;
        }
      }
      next();
    },
  };
});

// ─── User fixtures ─────────────────────────────────────────────────────────────

/** TC whose assigned sector is "Health" (primary sector only) */
const TC_PRIMARY_HEALTH = {
  id: 10, name: "TC Primary Health", email: "tc.h@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

/** TC whose assigned sector is "Education" — secondary only on a Health-primary project */
const TC_SECONDARY_EDUCATION = {
  id: 11, name: "TC Education", email: "tc.edu@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
};

/** TC with no assigned sectors */
const TC_NO_SECTOR = {
  id: 12, name: "TC NoSector", email: "tc.none@cafa.org", role: "technical_coordinator",
  roleLabel: "Technical Coordinator", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: [], avatarUrl: null,
};

const PM_USER = {
  id: 1, name: "PM", email: "pm@cafa.org", role: "program_manager",
  roleLabel: "Programme Manager", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const SUPER_ADMIN_USER = {
  id: 2, name: "SA", email: "sa@cafa.org", role: "super_admin",
  roleLabel: "Super Admin", scope: "hq",
  stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
};

const SPO_USER = {
  id: 20, name: "SPO", email: "spo@cafa.org", role: "state_program_officer",
  roleLabel: "State Programme Officer", scope: "state",
  stateId: 5, stateName: "South Kordofan", sector: null, sectors: null, avatarUrl: null,
};

// ─── App factory ──────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
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

beforeEach(() => {
  vi.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockLogAudit.mockResolvedValue(undefined);
  mockClient.release.mockReset();
});

// ─── PRJ-MSEC — assertEffectiveSectorAllowedForProject helper unit tests ──────

describe("assertEffectiveSectorAllowedForProject — helper unit tests", async () => {
  // Import the helpers indirectly via the real module (they are private to projects.ts
  // so we test them through the endpoint behaviour).
  // We validate the semantics in the integration tests below.
  // These unit tests drive the logic directly via GET /projects/:id (which calls the helper).

  it("PRJ-MSEC-01: TC matches primary sector → allowed (200)", async () => {
    // Project: primary=Health, sectors=[]
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: [] }] });
    // Full project detail rows
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_PRIMARY_HEALTH);
    const res = await request(app).get("/api/projects/1");
    // 404/500 might follow but the sector guard must NOT have blocked with 403
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-02: TC does not match primary but matches sectors[] → allowed", async () => {
    // Project: primary=Health, sectors=["Education"]  → TC_SECONDARY_EDUCATION should pass
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Education"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-03: TC matches neither primary nor sectors[] → denied (403)", async () => {
    // Project: primary=Health, sectors=["Protection"]  — TC_SECONDARY_EDUCATION is "Education"
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Protection"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-MSEC-04: Primary null, sectors[] contains assigned sector → allowed", async () => {
    // Project: primary=null, sectors=["Education"]
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: null, sectors: ["Education"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-05: Primary valid, sectors[] unrelated; TC matches primary → allowed", async () => {
    // Project: primary=Health, sectors=["Protection"]  — TC_PRIMARY_HEALTH matches primary
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Protection"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_PRIMARY_HEALTH);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-06: TC with no assigned sectors → denied", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Education"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_NO_SECTOR);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-MSEC-07: Malformed/empty sector strings in sectors[] do not grant access", async () => {
    // sectors[] contains empty string and whitespace — should not match "Education"
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: null, sectors: ["", "  "] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-MSEC-08: Duplicate sector values in union do not alter result", async () => {
    // sectors[] has duplicate of primary sector — dedup should still allow the match
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health", "Health"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_PRIMARY_HEALTH);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).not.toBe(403);
  });
});

// ─── PRJ-MSEC-DETAIL — Project detail endpoint ────────────────────────────────

describe("PRJ-MSEC-DETAIL — GET /projects/:id", () => {
  it("PRJ-MSEC-DETAIL-01: TC with secondary-sector-only match can open Project detail", async () => {
    // Project primary=Health, sectors=["Education"] → TC_SECONDARY_EDUCATION should pass
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Education"] }] });
    // Subsequent queries for project body, states, history
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-DETAIL-02: TC with only mismatched sectors gets 403", async () => {
    // Project: primary=Protection, sectors=["Shelter"] — TC is "Education"
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Protection", sectors: ["Shelter"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42");
    expect(res.status).toBe(403);
  });
});

// ─── PRJ-MSEC-UPDATE — PATCH /projects/:id ────────────────────────────────────

describe("PRJ-MSEC-UPDATE — PATCH /projects/:id", () => {
  const VALID_PATCH_BODY = {
    title: "Updated Title",
    sector: "Education",
    sectors: ["Education"],
    subSectors: [],
    donor: "UNICEF",
    classification: "A",
    status: "draft",
    stateIds: [],
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    assistanceModality: null,
    hasHqOperations: true,
  };

  it("PRJ-MSEC-UPDATE-01: TC with permission + secondary-sector match can PATCH", async () => {
    // Check query: status=draft, sectors includes "Education" (TC's sector)
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ status: "draft", sector: "Health", sectors: ["Education"] }],
    });
    // State-check for assertStateAllowed (TC passes — not a state role)
    // Remaining queries for update
    mockClientQuery.mockResolvedValue({ rows: [{ id: 1, status: "draft", sector: "Health" }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .patch("/api/projects/42")
      .send(VALID_PATCH_BODY);
    // Should not be 403 (may be 404/500 from mocked DB but not sector-forbidden)
    expect(res.status).not.toBe(403);
    if (res.status === 403) {
      expect(res.body.error).not.toBe("sector_forbidden");
    }
  });

  it("PRJ-MSEC-UPDATE-02: TC without any sector match denied on PATCH", async () => {
    // Check query: sector=Health, sectors=["Protection"]  — TC is "Education"
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ status: "draft", sector: "Health", sectors: ["Protection"] }],
    });
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .patch("/api/projects/42")
      .send(VALID_PATCH_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });
});

// ─── PRJ-MSEC-MERGE — POST /projects/:id/merge ────────────────────────────────

describe("PRJ-MSEC-MERGE — POST /projects/:id/merge", () => {
  it("PRJ-MSEC-MERGE-01: TC with secondary-sector match can reach merge logic", async () => {
    // proj: primary=Health, sectors=["Education"] → TC_SECONDARY_EDUCATION should pass sector guard
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 42, sector: "Health", sectors: ["Education"] }],
    });
    // assertStateAllowed (TC not a state role — passes)
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .post("/api/projects/42/merge")
      .send({ stateIds: [], sectors: [], localities: [] });
    // Not 403 (sector guard passed; may get other errors from mocked DB)
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-MERGE-02: TC with no match denied on merge", async () => {
    // proj: primary=Protection, sectors=["Shelter"] — TC is "Education"
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 42, sector: "Protection", sectors: ["Shelter"] }],
    });
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .post("/api/projects/42/merge")
      .send({ stateIds: [], sectors: [], localities: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });
});

// ─── PRJ-MSEC-BUD — GET /projects/:id/budget ──────────────────────────────────

describe("PRJ-MSEC-BUD — GET /projects/:id/budget", () => {
  it("PRJ-MSEC-BUD-01: TC with secondary-sector match can access budget", async () => {
    // Budget query returns project row with primary=Health, sectors=["Education"]
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 100000, sector: "Health", sectors: ["Education"] }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42/budget");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-BUD-02: TC with no match denied on budget", async () => {
    // primary=Protection, sectors=["Shelter"]
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 100000, sector: "Protection", sectors: ["Shelter"] }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42/budget");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });
});

// ─── PRJ-MSEC-ALLOC — GET /projects/:id/state-allocations ────────────────────

describe("PRJ-MSEC-ALLOC — GET /projects/:id/state-allocations", () => {
  it("PRJ-MSEC-ALLOC-01: TC with secondary-sector match can read state allocations", async () => {
    // effective-sector query returns Health primary + Education in sectors[]
    mockQuery.mockResolvedValueOnce({
      rows: [{ sector: "Health", sectors: ["Education"] }],
    });
    // assertStateAllowed (TC not state-role → pass via not a state role)
    // state-allocations query
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42/state-allocations");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-ALLOC-02: TC with no sector match denied on state-allocations", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ sector: "Protection", sectors: ["Shelter"] }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42/state-allocations");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });
});

// ─── PRJ-MSEC-DUP — Duplicate-check sectors[] ────────────────────────────────

describe("PRJ-MSEC-DUP — GET /projects/duplicate-check", () => {
  it("PRJ-MSEC-DUP-01: Duplicate-check returns result for TC whose sector is in sectors[]", async () => {
    // The duplicate-check SQL now uses (p.sector = ANY(...) OR EXISTS (...sectors[]))
    // We verify that TC_SECONDARY_EDUCATION does not get the fail-closed 'none' early exit.
    // The query itself is mocked to return a row so we can confirm the TC is not ejected.
    mockQuery.mockResolvedValueOnce({
      rows: [{
        code: "CAFA-001", title: "Test", agreementNumber: "AGR-001",
        donor: "UNICEF", sector: "Health", sectors: ["Education"],
      }],
    });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-001");
    // Should not be the early-exit 'none' caused by fail-closed TC check
    // (TC has assigned sector "Education", so should proceed to query)
    expect(res.status).toBe(200);
  });

  it("PRJ-MSEC-DUP-02: TC with no sectors still gets fail-closed response", async () => {
    const app = await buildApp(TC_NO_SECTOR);
    const res = await request(app)
      .get("/api/projects/duplicate-check?agreementNumber=AGR-001");
    expect(res.status).toBe(200);
    expect(res.body.matchType).toBe("none");
  });
});

// ─── PRJ-MSEC-PERM — Sector match ≠ permission grant ─────────────────────────

describe("PRJ-MSEC-PERM — Sector match does not grant missing permissions", () => {
  it("PRJ-MSEC-PERM-01: TC with matching sector but no projects.update cannot PATCH", async () => {
    // A viewer-role user who somehow has sectors set — should be blocked by requirePerm gate
    const VIEWER_WITH_SECTORS = {
      id: 50, name: "Viewer", email: "v@cafa.org", role: "viewer",
      roleLabel: "Viewer", scope: "hq",
      stateId: null, stateName: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
    };

    // Even if the DB would pass the sector check, requirePerm("projects.update") fires first
    mockClientQuery.mockResolvedValue({ rows: [{ status: "draft", sector: "Education", sectors: ["Education"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(VIEWER_WITH_SECTORS);
    const res = await request(app)
      .patch("/api/projects/42")
      .send({ title: "X", sector: "Education", stateIds: [], startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(res.status).toBe(403);
  });
});

// ─── PRJ-MSEC-FULL — PM/Super Admin unaffected ────────────────────────────────

describe("PRJ-MSEC-FULL — Full Operational Access unaffected (#373)", () => {
  it("PRJ-MSEC-FULL-01: PM sees project regardless of sector configuration", async () => {
    // Project: primary=Health, sectors=["Protection"] — PM has no sector restriction
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Protection"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/99");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-FULL-02: Super Admin sees project regardless of sector configuration", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Protection"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(SUPER_ADMIN_USER);
    const res = await request(app).get("/api/projects/99");
    expect(res.status).not.toBe(403);
  });

  it("PRJ-MSEC-FULL-03: PM can access budget on any project", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 50000, sector: "Health", sectors: ["Protection"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/projects/99/budget");
    expect(res.status).not.toBe(403);
  });
});

// ─── PRJ-MSEC-TRANS — POST /projects/:id/transitions ─────────────────────────

describe("PRJ-MSEC-TRANS — POST /projects/:id/transitions", () => {
  it("PRJ-MSEC-TRANS-01: TC with secondary-sector match can reach transition logic", async () => {
    // technical_review is a valid action TC has permission for (projects.approve.technical).
    // Project: primary=Health, sectors=["Education"] → TC_SECONDARY_EDUCATION passes sector guard.
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: "submitted", sector: "Health", sectors: ["Education"], managementLevel: "hq_managed" }],
    });
    // assertStateAllowed: TC is not a state role → returns ok immediately, no DB call.
    // Remaining queries for transition logic (unresolvedRequiredCorrections etc.)
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .post("/api/projects/42/transitions")
      .send({ action: "technical_review" });
    // Sector guard passed — response may be 400/404/409 from other checks, but NOT 403 sector_forbidden
    if (res.status === 403) {
      expect(res.body.error).not.toBe("sector_forbidden");
    }
  });

  it("PRJ-MSEC-TRANS-02: TC with no sector match denied on transitions (403 sector_forbidden)", async () => {
    // technical_review is valid and TC has projects.approve.technical.
    // primary=Protection, sectors=["Shelter"] — TC is "Education" → sector guard fires.
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: "submitted", sector: "Protection", sectors: ["Shelter"], managementLevel: "hq_managed" }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app)
      .post("/api/projects/42/transitions")
      .send({ action: "technical_review" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("PRJ-MSEC-TRANS-03: PM can transition any project regardless of sector config", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: "draft", sector: "Health", sectors: ["Protection"], managementLevel: "hq_managed" }],
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/42/transitions")
      .send({ action: "submit" });
    // PM has no sector restriction — any non-sector_forbidden response is acceptable
    if (res.status === 403) {
      expect(res.body.error).not.toBe("sector_forbidden");
    }
  });
});

// ─── PRJ-MSEC-ACTV — GET /activities TC sector scope ─────────────────────────

describe("PRJ-MSEC-ACTV — GET /activities (project-linked TC sector scope)", () => {
  it("PRJ-MSEC-ACTV-01: TC with non-empty sectors reaches DB and receives activity rows", async () => {
    // TC_SECONDARY_EDUCATION has sectors=["Education"] (non-empty) → proceeds to DB
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, code: "ACT-001", title: "Activity", status: "active",
          progressPct: 0, plannedStart: null, plannedEnd: null,
          outputId: null, outputTitle: null, indicatorId: null,
          stateId: null, stateName: null, localityName: null,
          target: 0, budgetPlanned: 0, budgetSpent: 0 },
      ],
    });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/activities");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toBe("ACT-001");
  });

  it("PRJ-MSEC-ACTV-02: TC with no sectors returns empty list (fail-closed)", async () => {
    // TC_NO_SECTOR has sectors=[] → short-circuit returns []
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_NO_SECTOR);
    const res = await request(app).get("/api/activities");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("PRJ-MSEC-ACTV-03: PM sees all activities (no sector restriction)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 10, code: "ACT-010", title: "PM activity", status: "active",
               progressPct: 0, plannedStart: null, plannedEnd: null,
               outputId: null, outputTitle: null, indicatorId: null,
               stateId: null, stateName: null, localityName: null,
               target: 0, budgetPlanned: 0, budgetSpent: 0 }],
    });

    const app = await buildApp(PM_USER);
    const res = await request(app).get("/api/activities");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toBe("ACT-010");
  });

  it("PRJ-MSEC-ACTV-04: GET /projects/:id/activities TC with secondary-sector match returns activity data", async () => {
    // Effective-sector query: primary=Health, sectors=["Education"] → TC_SECONDARY_EDUCATION passes
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Education"] }] });
    // assertStateAllowed: TC is not a state role → returns ok immediately, no DB call.
    // Activities SELECT result (next query)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, code: "ACT-005", title: "Secondary sector activity", status: "active",
               progressPct: 0, plannedStart: null, plannedEnd: null,
               outputId: null, outputTitle: null, indicatorId: null,
               stateId: null, stateName: null, localityName: null,
               target: 0, budgetPlanned: 0, budgetSpent: 0 }],
    });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42/activities");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].code).toBe("ACT-005");
  });

  it("PRJ-MSEC-ACTV-05: GET /projects/:id/activities TC with no sector match returns 403", async () => {
    // primary=Protection, sectors=["Shelter"] — TC is "Education"
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Protection", sectors: ["Shelter"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_SECONDARY_EDUCATION);
    const res = await request(app).get("/api/projects/42/activities");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });
});

// ─── PRJ-MSEC-STATE — SPO cross-State denial unchanged ───────────────────────

describe("PRJ-MSEC-STATE — SPO cross-State restrictions unchanged", () => {
  it("PRJ-MSEC-STATE-01: SPO with null stateId cannot access project state-allocations", async () => {
    const SPO_NULL_STATE = {
      id: 22, name: "SPO NoState", email: "spo.null@cafa.org", role: "state_program_officer",
      roleLabel: "State Programme Officer", scope: "state",
      stateId: null, stateName: null, sector: null, sectors: null, avatarUrl: null,
    };

    // Effective-sector query returns a valid project (not 404)
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: null, sectors: [] }] });
    // assertStateAllowed will query for project's states — return empty (not in state)
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(SPO_NULL_STATE);
    const res = await request(app).get("/api/projects/42/state-allocations");
    // SPO with null stateId → assertStateAllowed should deny
    expect(res.status).toBe(403);
  });
});
