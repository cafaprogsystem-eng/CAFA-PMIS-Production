/**
 * STORAGE-SCOPE — GET /storage/objects/* must re-check the owning record's
 * own sector/state scope for project/plan/report attachments, not just the
 * broad documents.view permission. Previously a Technical Coordinator or
 * State Program Officer who obtained an internal object path out of band
 * (an old bookmark, a leaked log line) could read another sector's/state's
 * attachment despite never having access to it through any canonical route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";

const { mockPoolQuery, mockFindConversationAttachment } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockFindConversationAttachment: vi.fn(async () => null),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../lib/conversationAttachments", () => ({
  findConversationAttachmentByObjectPath: mockFindConversationAttachment,
}));
vi.mock("../lib/conversationAuth", () => ({ canAccessConversation: vi.fn(async () => false) }));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class {
    getObjectEntityFile = vi.fn(async () => ({ key: "fake" }));
    downloadObject = vi.fn(async () => ({
      status: 200,
      headers: new Map([["content-type", "application/pdf"]]),
      body: null,
    }));
  },
  isStorageConfigured: () => ({ configured: true }),
}));

const storageRouter = (await import("./storage")).default;
import type { CurrentUser } from "../middlewares/currentUser";

function tcUser(sectors: string[]): CurrentUser {
  return {
    id: 1, name: "TC", email: "tc@test.test", role: "technical_coordinator", roleLabel: "TC",
    scope: "sector", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors,
  } as CurrentUser;
}

function spoUser(stateId: number): CurrentUser {
  return {
    id: 2, name: "SPO", email: "spo@test.test", role: "state_program_officer", roleLabel: "SPO",
    scope: "state", stateId, stateName: null, sector: null, avatarUrl: null, sectors: null,
  } as CurrentUser;
}

function appAs(user: CurrentUser) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user;
    next();
  });
  app.use(storageRouter);
  return supertest(app);
}

// Every scoped/existence query is distinguished by its FROM clause: the
// scoped variant always JOINs to the owning parent; the plain existence
// variant never does.
function stubOwners(config: {
  projectDocuments?: { scoped: boolean; exists: boolean };
  planAttachments?: { scoped: boolean; exists: boolean };
  reportAttachments?: { scoped: boolean; exists: boolean };
}) {
  mockPoolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("attachment_owners")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM project_documents pd JOIN projects p")) {
      const rows = config.projectDocuments?.scoped ? [{ ok: 1 }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM project_documents WHERE object_path")) {
      const rows = config.projectDocuments?.exists ? [{ ok: 1 }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM plan_attachments pa JOIN plans pl")) {
      const rows = config.planAttachments?.scoped ? [{ ok: 1 }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM plan_attachments WHERE object_path")) {
      const rows = config.planAttachments?.exists ? [{ ok: 1 }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM report_attachments ra JOIN reports r")) {
      const rows = config.reportAttachments?.scoped ? [{ ok: 1 }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM report_attachments WHERE object_path")) {
      const rows = config.reportAttachments?.exists ? [{ ok: 1 }] : [];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindConversationAttachment.mockResolvedValue(null);
});

describe("STORAGE-SCOPE — GET /storage/objects/*", () => {
  it("denies a TC a project-document attachment owned by a project outside their sector", async () => {
    stubOwners({ projectDocuments: { scoped: false, exists: true } });
    const res = await appAs(tcUser(["WASH"])).get("/storage/objects/uploads/some-file.pdf");
    expect(res.status).toBe(403);
  });

  it("serves a TC a project-document attachment owned by a project inside their sector", async () => {
    stubOwners({ projectDocuments: { scoped: true, exists: true } });
    const res = await appAs(tcUser(["WASH"])).get("/storage/objects/uploads/some-file.pdf");
    expect(res.status).toBe(200);
  });

  it("denies an SPO a plan attachment owned by a plan outside their state", async () => {
    stubOwners({ planAttachments: { scoped: false, exists: true } });
    const res = await appAs(spoUser(5)).get("/storage/objects/uploads/plan-file.pdf");
    expect(res.status).toBe(403);
  });

  it("denies a TC a report attachment outside their sector", async () => {
    stubOwners({ reportAttachments: { scoped: false, exists: true } });
    const res = await appAs(tcUser(["WASH"])).get("/storage/objects/uploads/report-file.pdf");
    expect(res.status).toBe(403);
  });

  it("serves an object owned by none of the three scoped tables unchanged (e.g. a program resource)", async () => {
    stubOwners({});
    const res = await appAs(tcUser(["WASH"])).get("/storage/objects/uploads/resource-file.pdf");
    expect(res.status).toBe(200);
  });
});
