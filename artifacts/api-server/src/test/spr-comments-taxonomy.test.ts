/**
 * SPR-010 — Reviewer Comments Taxonomy tests.
 *
 * Verifies the canonical SPR section-key validation on POST /comments:
 *  - SPR-COM-01: null section on an SPR comment → 201, section stored as null
 *  - SPR-COM-02: canonical section ("activities") → 201, stored verbatim
 *  - SPR-COM-03: section field returned in the created comment payload
 *  - SPR-COM-04: invalid section key on SPR → 422 invalid_section_key
 *  - SPR-COM-05: historical null-section comments remain readable via GET
 *  - SPR-COM-10: non-SPR report types skip the taxonomy validation
 *  - SPR-COM-11: PM (Full Operational Access) can post on any SPR
 *  - SPR-COM-12: super_admin can post
 * Plus unit tests for the canonical key/label module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

import { SPR_SECTION_KEYS, SPR_SECTION_LABELS, isSprSectionKey, getSprSectionLabel } from "../lib/sprSections.js";

const mockPool = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: (...args: unknown[]) => mockPool(...args), connect: vi.fn() } }));
vi.mock("../lib/realtime.js", () => ({ realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() } }));
const notifyEntityActors = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: (...args: unknown[]) => notifyEntityActors(...args),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

const SPC = { id: 5, name: "SPC", role: "senior_program_coordinator", stateId: null, sector: null, sectors: [] };
const PM = { id: 14, name: "PM", role: "program_manager", stateId: null, sector: null, sectors: [] };
const SA = { id: 1, name: "Admin", role: "super_admin", stateId: null, sector: null, sectors: [] };

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: commentsRouter } = await import("../routes/comments.js");
  app.use(commentsRouter);
  return app;
}

/** Mock the entity-meta query for a report of the given type. */
function metaRow(reportType: string) {
  return {
    rows: [{
      reportType,
      projectId: null,
      projectSector: null,
      activitySector: null,
      effectiveSector: null,
    }],
  };
}

const createdRow = (section: string | null) => ({
  rows: [{
    id: 77, entityType: "report", entityId: 9, parentId: null,
    section, commentType: "general", authorId: 5, authorName: "SPC",
    authorRoleLabel: "Senior Programme Coordinator", body: "Please revise",
    status: "open", resolvedAt: null, resolvedById: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }],
});

function queueCreateQueries(reportType: string, section: string | null) {
  // 1) loadEntityMeta  2) INSERT RETURNING id  3) SELECT created row
  // Subsequent queries (entityLink report_type lookup for the notification
  // link, etc.) get a generic fallback.
  mockPool
    .mockResolvedValueOnce(metaRow(reportType))
    .mockResolvedValueOnce({ rows: [{ id: 77 }] })
    .mockResolvedValueOnce(createdRow(section))
    .mockResolvedValue({ rows: [{ report_type: reportType }] });
}

beforeEach(() => {
  mockPool.mockReset();
  notifyEntityActors.mockClear();
});

describe("sprSections module", () => {
  it("every key has a label and round-trips through the guard", () => {
    for (const k of SPR_SECTION_KEYS) {
      expect(isSprSectionKey(k)).toBe(true);
      expect(SPR_SECTION_LABELS[k]).toBeTruthy();
      expect(getSprSectionLabel(k)).toBe(SPR_SECTION_LABELS[k]);
    }
  });
  it("rejects unknown keys", () => {
    expect(isSprSectionKey("invalid_xyz")).toBe(false);
    expect(isSprSectionKey("Narrative")).toBe(false);
  });
  it("uses British-English report-level label", () => {
    expect(SPR_SECTION_LABELS.general).toBe("General / Report-Level");
  });
});

describe("POST /comments — SPR section taxonomy", () => {
  it("SPR-COM-01: null section on SPR comment → 201, section null", async () => {
    const app = await buildApp(SPC);
    queueCreateQueries("program_state", null);
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 9, commentType: "general", body: "Please revise",
    });
    expect(res.status).toBe(201);
    expect(res.body.section).toBeNull();
    // INSERT params include null section
    const insertCall = mockPool.mock.calls[1];
    expect(insertCall[1][3]).toBeNull();
  });

  it("SPR-COM-02/03: canonical section 'activities' → 201, stored and returned", async () => {
    const app = await buildApp(SPC);
    queueCreateQueries("program_state", "activities");
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 9, commentType: "general", section: "activities", body: "Please revise",
    });
    expect(res.status).toBe(201);
    expect(res.body.section).toBe("activities");
    const insertCall = mockPool.mock.calls[1];
    expect(insertCall[1][3]).toBe("activities");
    // Notification enriched with the section label
    expect(notifyEntityActors).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("— Activities") }),
    );
  });

  it("SPR-COM-04: invalid section key on SPR → 422 invalid_section_key", async () => {
    const app = await buildApp(SPC);
    mockPool.mockResolvedValueOnce(metaRow("program_state"));
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 9, commentType: "general", section: "invalid_xyz", body: "x",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_section_key");
    // No INSERT happened
    expect(mockPool).toHaveBeenCalledTimes(1);
  });

  it("SPR-COM-10: non-SPR report type accepts arbitrary section (no taxonomy validation)", async () => {
    const app = await buildApp(SPC);
    // project report: meta query returns projectSector for scope
    mockPool
      .mockResolvedValueOnce({ rows: [{ reportType: "project", projectId: 3, projectSector: null, activitySector: null, effectiveSector: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 78 }] })
      .mockResolvedValueOnce(createdRow("Narrative"))
      .mockResolvedValue({ rows: [{ report_type: "project" }] });
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 8, commentType: "general", section: "Narrative", body: "ok",
    });
    expect(res.status).toBe(201);
  });

  it("SPR-COM-11: PM (Full Operational Access) can post a canonical-section SPR comment", async () => {
    const app = await buildApp(PM);
    queueCreateQueries("program_state", "main_challenges");
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 9, commentType: "revision_request", section: "main_challenges", body: "Fix this",
    });
    expect(res.status).toBe(201);
  });

  it("SPR-COM-12: super_admin can post", async () => {
    const app = await buildApp(SA);
    queueCreateQueries("program_state", "risks");
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 9, commentType: "general", section: "risks", body: "Note",
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /comments — section normalisation", () => {
  it("whitespace-only section is normalised to null (not stored as '')", async () => {
    const app = await buildApp(SPC);
    queueCreateQueries("program_state", null);
    const res = await request(app).post("/comments").send({
      entityType: "report", entityId: 9, commentType: "general", section: "   ", body: "Please revise",
    });
    expect(res.status).toBe(201);
    const insertCall = mockPool.mock.calls[1];
    expect(insertCall[1][3]).toBeNull();
  });
});

describe("GET /comments — restricted read path for non-commenting report viewers (SPR-010)", () => {
  const SPO = { id: 21, name: "SPO", role: "state_program_officer", stateId: 1, sector: null, sectors: [] };
  const sectorRow = { rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null }] };

  it("SPO author of a returned SPR draft in their own state can read comments (200)", async () => {
    const app = await buildApp(SPO);
    mockPool
      .mockResolvedValueOnce(sectorRow)                               // getReportSectorForAuth
      .mockResolvedValueOnce({ rows: [{ state_id: 1 }] })             // state-scope check
      .mockResolvedValueOnce({ rows: [{ ok: true }] })                // returned-draft author gate
      .mockResolvedValueOnce({ rows: [createdRow("activities").rows[0]] }); // comments
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 9 });
    expect(res.status).toBe(200);
    expect(res.body[0].section).toBe("activities");
  });

  it.each([
    ["same-state non-author"],
    ["SPR draft not returned for revision"],
    ["non-SPR report type"],
  ])("restricted path denies: %s (403)", async () => {
    const app = await buildApp(SPO);
    mockPool
      .mockResolvedValueOnce(sectorRow)
      .mockResolvedValueOnce({ rows: [{ state_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ ok: false }] }); // gate fails for all three reasons
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 9 });
    expect(res.status).toBe(403);
  });

  it("SPO cannot read comments on another state's report (403)", async () => {
    const app = await buildApp(SPO);
    mockPool
      .mockResolvedValueOnce(sectorRow)
      .mockResolvedValueOnce({ rows: [{ state_id: 2 }] });
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 9 });
    expect(res.status).toBe(403);
  });

  it("SPO with no assigned state fails closed (403)", async () => {
    const app = await buildApp({ ...SPO, stateId: null });
    mockPool.mockResolvedValueOnce(sectorRow);
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 9 });
    expect(res.status).toBe(403);
  });

  it("SPO cannot use the restricted path for non-report entities (403)", async () => {
    const app = await buildApp(SPO);
    const res = await request(app).get("/comments").query({ entityType: "project", entityId: 3 });
    expect(res.status).toBe(403);
    expect(mockPool).not.toHaveBeenCalled();
  });
});

describe("GET /comments — HQSR-005 returned hq_sector draft author read access", () => {
  const TC = { id: 31, name: "TC", role: "technical_coordinator", stateId: null, sector: "Health", sectors: ["Health"] };
  const hqMeta = { rows: [{ reportType: "hq_sector", projectId: null, projectSector: null, activitySector: null, effectiveSector: "Health" }] };

  it("TC holds comments.create, so HQSR authors read (and may reply to) reviewer comments via the standard path", async () => {
    const { permissionsFor } = await import("../middlewares/currentUser.js");
    const perms = permissionsFor({ ...TC, status: "active" } as never);
    expect(perms).toContain("comments.create");
  });

  it("own-sector TC reads comments on a returned hq_sector draft (200)", async () => {
    const app = await buildApp(TC);
    mockPool
      .mockResolvedValueOnce(hqMeta)                                // loadEntityMeta (sector scope source)
      .mockResolvedValueOnce({ rows: [createdRow(null).rows[0]] }); // comments
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 88 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("cross-sector TC is denied by the sector guard (403/404), never reaching the comments query", async () => {
    const app = await buildApp({ ...TC, sector: "Education", sectors: ["Education"] });
    mockPool.mockResolvedValueOnce(hqMeta); // effectiveSector Health ≠ TC sectors
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 88 });
    expect([403, 404]).toContain(res.status);
    expect(mockPool).toHaveBeenCalledTimes(1);
  });

  it("restricted read-only fallback gate admits returned hq_sector drafts alongside program_state (belt-and-braces for any future non-commenting author)", async () => {
    // Exercise the !comments.create branch with a viewer-style role (no
    // comments.create, not state-scoped) to prove the gate SQL covers
    // hq_sector and still requires authorship + a request_revision approval.
    const VIEWER = { id: 41, name: "V", role: "viewer", stateId: null, sector: null, sectors: [] };
    const app = await buildApp(VIEWER);
    mockPool
      .mockResolvedValueOnce(hqMeta)                                // assertCanViewReport → getReportSectorForAuth
      .mockResolvedValueOnce({ rows: [{ ok: true }] })              // returned-draft author gate
      .mockResolvedValueOnce({ rows: [createdRow(null).rows[0]] }); // comments
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 88 });
    expect(res.status).toBe(200);
    const gateSql = String(mockPool.mock.calls[1][0]);
    expect(gateSql).toContain("hq_sector");
    expect(gateSql).toContain("program_state");
    expect(gateSql).toContain("request_revision");
    expect(gateSql).toContain("author_id");
  });

  it("restricted fallback denies a non-author / non-returned hq_sector draft (403)", async () => {
    const VIEWER = { id: 41, name: "V", role: "viewer", stateId: null, sector: null, sectors: [] };
    const app = await buildApp(VIEWER);
    mockPool
      .mockResolvedValueOnce(hqMeta)
      .mockResolvedValueOnce({ rows: [{ ok: false }] });
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 88 });
    expect(res.status).toBe(403);
  });
});

describe("GET /comments — historical null-section comments (SPR-COM-05)", () => {
  it("returns null-section comments unchanged", async () => {
    const app = await buildApp(SPC);
    mockPool
      .mockResolvedValueOnce(metaRow("program_state")) // loadEntityMeta
      .mockResolvedValueOnce({ rows: [ { ...createdRow(null).rows[0] }, { ...createdRow("activities").rows[0], id: 78 } ] });
    const res = await request(app).get("/comments").query({ entityType: "report", entityId: 9 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].section).toBeNull();
    expect(res.body[1].section).toBe("activities");
  });
});
