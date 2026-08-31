/**
 * TRAINING-CERT-ID — training certificate IDs must be unguessable.
 *
 * Certificate IDs used to be a sequential counter (CAFA-PMIS-2026-000001,
 * 000002, ...) enumerable by any authenticated user via the public
 * verification endpoint, which returns each holder's name, role, and email.
 * Generation now happens in application code with a random suffix and is
 * bound as a plain SQL parameter, not built via NEXTVAL() string concatenation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

const trainingVideosRouter = (await import("./training-videos")).default;
import type { CurrentUser } from "../middlewares/currentUser";

function appAs(userId: number) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: userId, role: "viewer" } as CurrentUser;
    next();
  });
  app.use(trainingVideosRouter);
  return supertest(app);
}

beforeEach(() => {
  vi.clearAllMocks();
});

function stubIssueFlow() {
  mockPoolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM training_completions WHERE training_video_id")) {
      return { rows: [{ completion_status: "completed", watch_percent: 100, certificate_issued: false }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO training_certificates")) {
      return {
        rows: [{
          id: 1, certificateId: params?.[0], userId: params?.[1], trainingVideoId: params?.[2],
          issuedAt: new Date().toISOString(), revokedAt: null, isActive: true,
          trainingVideoTitle: "Test", userName: "Test User", userRole: "viewer",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("UPDATE training_completions SET certificate_issued")) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe("TRAINING-CERT-ID — POST /training-videos/:id/complete issues an unguessable certificate ID", () => {
  it("binds certificate_id as a plain parameter, not a NEXTVAL()-built string", async () => {
    stubIssueFlow();
    await appAs(1).post("/training-videos/1/complete");

    const insertCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO training_certificates"));
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).not.toContain("NEXTVAL");
    expect(sql).not.toContain("LPAD");
    expect(sql).toContain("VALUES ($1, $2, $3)");
    expect(params[0]).toMatch(/^CAFA-PMIS-\d{4}-[0-9A-F]{12}$/);
  });

  it("generates a different certificate ID on every issuance — not a predictable sequence", async () => {
    stubIssueFlow();
    await appAs(1).post("/training-videos/1/complete");
    const first = (mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO training_certificates")) as [string, unknown[]])[1][0];

    vi.clearAllMocks();
    stubIssueFlow();
    await appAs(2).post("/training-videos/1/complete");
    const second = (mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO training_certificates")) as [string, unknown[]])[1][0];

    expect(first).not.toBe(second);
  });
});
