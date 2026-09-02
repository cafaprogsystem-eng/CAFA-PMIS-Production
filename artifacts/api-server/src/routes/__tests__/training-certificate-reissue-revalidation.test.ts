/**
 * TRAINING-CERT-REISSUE-REVALIDATION — POST /training-certificates/:id/reissue
 * revoked the old certificate and issued a replacement using only the
 * (user_id, training_video_id) recorded on the certificate being reissued —
 * it never re-checked training_completions.completion_status. If a
 * certificate was revoked because the underlying completion was itself
 * found invalid, reissue silently restored it with a new ID and no
 * re-validation. Fixed: reissue now re-confirms completion_status ===
 * 'completed' before revoking/reissuing anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

const trainingVideosRouter = (await import("../training-videos")).default;
import type { CurrentUser } from "../../middlewares/currentUser";

function appAsAdmin() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: 1, role: "super_admin" } as CurrentUser;
    next();
  });
  app.use(trainingVideosRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => vi.clearAllMocks());

describe("TRAINING-CERT-REISSUE-REVALIDATION", () => {
  it("rejects reissue with 409 when the underlying completion is no longer valid, without revoking or inserting anything", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT user_id, training_video_id FROM training_certificates")) {
        return Promise.resolve({ rows: [{ user_id: 7, training_video_id: 3 }] });
      }
      if (sql.includes("FROM training_completions WHERE user_id=$1 AND training_video_id=$2")) {
        return Promise.resolve({ rows: [{ completion_status: "in_progress" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await appAsAdmin().post("/training-certificates/5/reissue");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "completion_not_valid" });
    expect(mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("SET is_active=FALSE"))).toBe(false);
    expect(mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO training_certificates"))).toBe(false);
  });

  it("rejects reissue with 409 when no completion record exists at all for that user+video", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT user_id, training_video_id FROM training_certificates")) {
        return Promise.resolve({ rows: [{ user_id: 7, training_video_id: 3 }] });
      }
      if (sql.includes("FROM training_completions WHERE user_id=$1 AND training_video_id=$2")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await appAsAdmin().post("/training-certificates/5/reissue");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "completion_not_valid" });
  });

  it("proceeds with revoke + reissue when the completion is still genuinely completed", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT user_id, training_video_id FROM training_certificates")) {
        return Promise.resolve({ rows: [{ user_id: 7, training_video_id: 3 }] });
      }
      if (sql.includes("FROM training_completions WHERE user_id=$1 AND training_video_id=$2")) {
        return Promise.resolve({ rows: [{ completion_status: "completed" }] });
      }
      if (sql.includes("SET is_active=FALSE")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("INSERT INTO training_certificates")) {
        return Promise.resolve({ rows: [{ id: 42, certificateId: "CAFA-PMIS-2026-NEW1234", userId: 7, trainingVideoId: 3, isActive: true }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await appAsAdmin().post("/training-certificates/5/reissue");

    expect(res.status).toBe(200);
    expect(res.body.certificate.id).toBe(42);
    expect(mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("SET is_active=FALSE"))).toBe(true);
  });
});
