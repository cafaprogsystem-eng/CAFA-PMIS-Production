/**
 * Risk Register — route-level IDOR tests (RISK-001 & RISK-004 closure)
 *
 * Exercises the REAL Express handlers in routes/comments.ts and routes/drive.ts
 * with a mocked pg pool (same harness pattern as risk-audit.test.ts) to prove
 * the bypass paths are closed:
 *   • comments GET/POST/PATCH/DELETE on an inaccessible risk → 403/404
 *   • generic /drive/files listing (no module param) filters out inaccessible
 *     risk rows and sanitises accessible ones
 *   • risk file download denied cross-state
 *
 * British English spelling used throughout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";

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
vi.mock("../../lib/realtime", () => ({ realtime: { broadcastUpdate: vi.fn() } }));
vi.mock("../../lib/reportAuth", () => ({ assertCanViewReport: vi.fn() }));
vi.mock("../../lib/awsS3", () => ({
  uploadFile: vi.fn(),
  downloadFileStream: vi.fn(),
  archiveFile: vi.fn(),
  deleteFile: vi.fn(),
  testConnection: vi.fn(),
  isConfigured: () => false,
  getConfigStatus: () => ({ configured: false }),
  batchPresignedUrls: vi.fn(async () => new Map()),
  buildObjectKey: (m: string, n: string) => `${m}/${n}`,
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
}));

import commentsRouter from "../comments";
import driveRouter from "../drive";
import type { CurrentUser } from "../../middlewares/currentUser";

function user(over: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1, name: "Test", email: "t@t.t", role: "program_manager", roleLabel: "PM",
    scope: "org", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors: null,
    ...over,
  } as CurrentUser;
}

const spoState1 = () => user({ role: "state_program_officer", stateId: 1, scope: "state" });
const tcWash = () => user({ role: "technical_coordinator", sectors: ["WASH"] });

function appAs(u: CurrentUser | null, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (u) req.currentUser = u;
    next();
  });
  app.use(router);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  return supertest(app);
}

// SQL-aware pool mock: routes queries by substring of the SQL text.
type SqlStub = { match: string; rows: Record<string, unknown>[] };
function stubPool(stubs: SqlStub[]) {
  mockPoolQuery.mockReset().mockImplementation(async (sql: string) => {
    for (const s of stubs) {
      if (sql.includes(s.match)) return { rows: s.rows, rowCount: s.rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

// Risk 7 lives in state 2 (not the SPO's state 1) with no linked project.
const riskState2 = [
  { match: "SELECT p.sector FROM risks r LEFT JOIN projects p", rows: [{ sector: null }] },
  { match: "SELECT state_id FROM risks WHERE id", rows: [{ state_id: 2 }] },
  { match: 'SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector', rows: [{ stateId: 2, projectId: null, sector: null }] },
];
// Risk 8 lives in state 1 (the SPO's own state).
const riskState1 = [
  { match: "SELECT p.sector FROM risks r LEFT JOIN projects p", rows: [{ sector: null }] },
  { match: "SELECT state_id FROM risks WHERE id", rows: [{ state_id: 1 }] },
  { match: 'SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector', rows: [{ stateId: 1, projectId: null, sector: null }] },
];

beforeEach(() => { mockPoolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 }); });

// ── Comments: GET ─────────────────────────────────────────────────────────────

describe("RISK-001 IDOR — GET /comments?entityType=risk", () => {
  it("SPO in the wrong state is denied (403), no comment rows returned", async () => {
    stubPool(riskState2);
    const res = await appAs(spoState1(), commentsRouter as express.Router).get("/comments?entityType=risk&entityId=7");
    expect(res.status).toBe(403);
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("SPO in their own state can list risk comments (canonical risks.view.state read authority)", async () => {
    stubPool([...riskState1, { match: "ORDER BY c.created_at ASC", rows: [{ id: 1, body: "hello" }] }]);
    const res = await appAs(spoState1(), commentsRouter as express.Router).get("/comments?entityType=risk&entityId=8");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("TC with the wrong sector is denied on a project-linked risk (403 sector_forbidden)", async () => {
    stubPool([{ match: "SELECT p.sector FROM risks r LEFT JOIN projects p", rows: [{ sector: "Health" }] }]);
    const res = await appAs(tcWash(), commentsRouter as express.Router).get("/comments?entityType=risk&entityId=7");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("non-existent risk returns 404, never a comment list", async () => {
    stubPool([{ match: "SELECT p.sector FROM risks r LEFT JOIN projects p", rows: [] }]);
    const res = await appAs(user(), commentsRouter as express.Router).get("/comments?entityType=risk&entityId=999");
    expect(res.status).toBe(404);
  });

  it("PM passes regardless of state (Full Operational Access)", async () => {
    stubPool([...riskState2, { match: "ORDER BY c.created_at ASC", rows: [] }]);
    const res = await appAs(user(), commentsRouter as express.Router).get("/comments?entityType=risk&entityId=7");
    expect(res.status).toBe(200);
  });
});

// ── Comments: POST ────────────────────────────────────────────────────────────

describe("RISK-001 IDOR — POST /comments on a risk", () => {
  it("SPO in the wrong state cannot create a comment (403, no INSERT executed)", async () => {
    stubPool(riskState2);
    const res = await appAs(spoState1(), commentsRouter as express.Router)
      .post("/comments").send({ entityType: "risk", entityId: 7, body: "x", commentType: "general" });
    expect(res.status).toBe(403);
    const inserted = mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO comments"));
    expect(inserted).toBe(false);
  });

  it("SOM (view-only, no risks.update, no comments.create) cannot create a risk comment", async () => {
    stubPool(riskState1);
    const res = await appAs(user({ role: "state_office_manager", stateId: 1 }), commentsRouter as express.Router)
      .post("/comments").send({ entityType: "risk", entityId: 8, body: "x", commentType: "observation" });
    expect(res.status).toBe(403);
  });

  it("blank body rejected with 400", async () => {
    stubPool(riskState1);
    const res = await appAs(user(), commentsRouter as express.Router)
      .post("/comments").send({ entityType: "risk", entityId: 8, body: "   ", commentType: "general" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("body_required");
  });
});

// ── Comments: PATCH / DELETE by direct ID ─────────────────────────────────────

describe("RISK-001 IDOR — PATCH/DELETE /comments/:id on an inaccessible risk", () => {
  const commentOnRisk7 = {
    match: "FROM comments WHERE id = $1",
    rows: [{ id: 5, entity_type: "risk", entity_id: 7, comment_type: "general", author_id: 99, created_at: new Date().toISOString(), status: "open" }],
  };

  it("SPO in the wrong state cannot resolve a risk comment by ID (403)", async () => {
    stubPool([commentOnRisk7, ...riskState2]);
    const res = await appAs(spoState1(), commentsRouter as express.Router)
      .patch("/comments/5").send({ action: "resolve" });
    expect(res.status).toBe(403);
    const updated = mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE comments SET status"));
    expect(updated).toBe(false);
  });

  it("SPO in the wrong state cannot delete a risk comment by ID (403, no DELETE executed)", async () => {
    stubPool([commentOnRisk7, ...riskState2]);
    const res = await appAs(spoState1(), commentsRouter as express.Router).delete("/comments/5");
    expect(res.status).toBe(403);
    const deleted = mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM comments"));
    expect(deleted).toBe(false);
  });
});

// ── Comments: enumeration safety on PATCH/DELETE ──────────────────────────────

describe("Comment-ID enumeration safety — PATCH/DELETE without comments.create", () => {
  const commentOnReport = {
    match: "FROM comments WHERE id = $1",
    rows: [{ id: 6, entity_type: "report", entity_id: 3, comment_type: "general", author_id: 99, created_at: new Date().toISOString(), status: "open" }],
  };

  it("SPO (risks.update only): existing non-risk comment and absent ID both return an identical 403", async () => {
    stubPool([commentOnReport]);
    const existing = await appAs(spoState1(), commentsRouter as express.Router).patch("/comments/6").send({ action: "resolve" });
    stubPool([]); // absent ID
    const absent = await appAs(spoState1(), commentsRouter as express.Router).patch("/comments/999").send({ action: "resolve" });
    expect(existing.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(existing.body).toEqual(absent.body);
  });

  it("same uniform 403 for DELETE (existing non-risk vs absent)", async () => {
    stubPool([commentOnReport]);
    const existing = await appAs(spoState1(), commentsRouter as express.Router).delete("/comments/6");
    stubPool([]);
    const absent = await appAs(spoState1(), commentsRouter as express.Router).delete("/comments/999");
    expect(existing.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(existing.body).toEqual(absent.body);
  });

  it("caller with neither permission is rejected before any comment lookup", async () => {
    stubPool([commentOnReport]);
    const ed = user({ role: "state_office_manager", stateId: 1 }); // SOM: no comments.create, no risks.update
    const res = await appAs(ed, commentsRouter as express.Router).patch("/comments/6").send({ action: "resolve" });
    expect(res.status).toBe(403);
    const looked = mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("FROM comments WHERE id = $1"));
    expect(looked).toBe(false);
  });

  it("callers WITH comments.create keep the previous behaviour (404 for absent IDs)", async () => {
    stubPool([]);
    const res = await appAs(user(), commentsRouter as express.Router).patch("/comments/999").send({ action: "resolve" });
    expect(res.status).toBe(404);
  });
});

// ── Drive: generic list bypass ────────────────────────────────────────────────

describe("RISK-004 IDOR — GET /drive/files without module=risks", () => {
  // Simulated database of 4 files across 2 "pages": one inaccessible risk row
  // (risk 7, state 2) sits AHEAD of the accessible rows, so any post-query
  // filtering approach would corrupt both the page and the total.
  const DB = [
    { id: 1, module: "projects", recordId: 10, driveFileId: "projects/a.pdf", driveLink: "projects/a.pdf", name: "a.pdf", status: "active" },
    { id: 2, module: "risks", recordId: 7, driveFileId: "risks/secret.pdf", driveLink: "risks/secret.pdf", name: "secret.pdf", status: "active" },
    { id: 3, module: "risks", recordId: 8, driveFileId: "risks/mine.pdf", driveLink: "risks/mine.pdf", name: "mine.pdf", status: "active" },
    { id: 4, module: "risks", recordId: 8, driveFileId: "risks/mine2.pdf", driveLink: "risks/mine2.pdf", name: "mine2.pdf", status: "active" },
  ];
  // SPO of state 1: risk 7 (state 2) is inaccessible, risk 8 (state 1) is fine.
  const ACCESSIBLE = DB.filter((r) => r.module !== "risks" || r.recordId === 8);

  // Fake DB that honours the SQL-level risk predicate + LIMIT/OFFSET, so the
  // route's own WHERE clause decides what is visible.
  function fakeDb() {
    mockPoolQuery.mockReset().mockImplementation(async (sql: string, params?: unknown[]) => {
      const scoped = sql.includes("EXISTS (SELECT 1 FROM risks r WHERE r.id = df.record_id AND r.state_id =");
      const set = scoped ? ACCESSIBLE : DB;
      if (sql.includes("COUNT(*)::int AS total")) return { rows: [{ total: set.length }], rowCount: 1 };
      if (sql.includes("FROM drive_files df")) {
        const limit = Number(params?.[params.length - 2] ?? 50);
        const offset = Number(params?.[params.length - 1] ?? 0);
        const page = set.slice(offset, offset + limit);
        return { rows: page, rowCount: page.length };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it("applies the parent-risk predicate to BOTH the page query and the count query", async () => {
    fakeDb();
    const res = await appAs(spoState1(), driveRouter as express.Router).get("/drive/files");
    expect(res.status).toBe(200);
    const listSql = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY df.created_at"))?.[0] as string;
    const countSql = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("COUNT(*)::int AS total"))?.[0] as string;
    expect(listSql).toContain("EXISTS (SELECT 1 FROM risks r WHERE r.id = df.record_id AND r.state_id =");
    expect(countSql).toContain("EXISTS (SELECT 1 FROM risks r WHERE r.id = df.record_id AND r.state_id =");
  });

  it("total never counts inaccessible risk rows and pages stay dense (page 1)", async () => {
    fakeDb();
    const res = await appAs(spoState1(), driveRouter as express.Router).get("/drive/files?limit=2&offset=0");
    expect(res.status).toBe(200);
    const files = res.body.files as Record<string, unknown>[];
    expect(res.body.total).toBe(3); // accessible set only — no enumeration via total
    expect(files.map((f) => f.name)).toEqual(["a.pdf", "mine.pdf"]); // inaccessible row does not displace accessible ones
    expect(files.find((f) => f.name === "secret.pdf")).toBeUndefined();
    // Accessible risk row sanitised: no S3 key/internal fields; null-only presign fallback
    const mine = files.find((f) => f.name === "mine.pdf")!;
    expect(mine.driveFileId).toBeUndefined();
    expect(mine.recordId).toBeUndefined();
    expect(mine.driveLink).toBeNull();
    // Non-risk rows keep the existing DTO
    expect(files.find((f) => f.name === "a.pdf")!.driveFileId).toBe("projects/a.pdf");
  });

  it("page 2 contains the remaining accessible row — no gap left by the inaccessible one", async () => {
    fakeDb();
    const res = await appAs(spoState1(), driveRouter as express.Router).get("/drive/files?limit=2&offset=2");
    expect(res.status).toBe(200);
    const files = res.body.files as Record<string, unknown>[];
    expect(res.body.total).toBe(3);
    expect(files.map((f) => f.name)).toEqual(["mine2.pdf"]);
    expect(files[0].driveFileId).toBeUndefined();
    expect(files[0].driveLink).toBeNull();
  });

  it("PM (Full Operational Access) list carries no risk predicate but still sanitises risk rows", async () => {
    fakeDb();
    const res = await appAs(user(), driveRouter as express.Router).get("/drive/files");
    expect(res.status).toBe(200);
    const files = res.body.files as Record<string, unknown>[];
    expect(res.body.total).toBe(4);
    const secret = files.find((f) => f.name === "secret.pdf")!;
    expect(secret).toBeDefined();
    expect(secret.driveFileId).toBeUndefined();
    expect(secret.driveLink).toBeNull();
  });
});

// ── Drive: cross-state download ───────────────────────────────────────────────

describe("RISK-004 IDOR — download of another state's risk attachment", () => {
  it("SPO of state 1 cannot download a risk file whose parent risk is in state 2", async () => {
    mockPoolQuery.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("FROM drive_files WHERE id = $1 AND status = 'active'")) {
        return { rows: [{ fileKey: "risks/x.pdf", name: "x.pdf", mimeType: "application/pdf", stateId: 1, sector: null, module: "risks", recordId: 7 }], rowCount: 1 };
      }
      if (sql.includes('SELECT r.state_id AS "stateId"')) {
        return { rows: [{ stateId: 2, projectId: null, sector: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    // NOTE: the drive_file row claims state_id=1 (matching the actor) — the
    // legacy metadata check would have allowed this. The parent-risk guard denies it.
    const res = await appAs(spoState1(), driveRouter as express.Router).get("/drive/files/2/download");
    expect(res.status).toBe(403);
  });
});
