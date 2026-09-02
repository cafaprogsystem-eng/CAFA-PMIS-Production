/**
 * MANUAL-CERT-DUP-RACE — POST /training-videos/:id/complete read
 * training_completions.certificate_issued, inserted a certificate, then set
 * certificate_issued=TRUE as three separate un-locked statements. Two
 * concurrent completions (double-click, two open tabs) could both pass the
 * certificate_issued check before either committed, producing two active
 * certificates for the same completion. Fixed: the whole read-check-insert-
 * update sequence now runs in one transaction with the completion row
 * locked (SELECT ... FOR UPDATE), so the second call blocks until the first
 * commits and then correctly sees certificate_issued=TRUE instead of
 * inserting a duplicate. A partial unique index (migration 065) is added as
 * defence-in-depth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockPoolQuery, mockClientQuery, mockConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery, connect: mockConnect } }));

const trainingVideosRouter = (await import("../training-videos")).default;
import type { CurrentUser } from "../../middlewares/currentUser";

function appAs(userId: number) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: userId, role: "viewer" } as CurrentUser;
    next();
  });
  app.use(trainingVideosRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
});

describe("MANUAL-CERT-DUP-RACE", () => {
  it("locks the completion row for the whole transaction (SELECT ... FOR UPDATE inside BEGIN/COMMIT)", async () => {
    mockClientQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ completion_status: "completed", certificate_issued: false }] };
      if (sql.includes("INSERT INTO training_certificates")) {
        return { rows: [{ id: 1, certificateId: params?.[0], userId: params?.[1], trainingVideoId: params?.[2] }] };
      }
      return { rows: [] };
    });

    const res = await appAs(1).post("/training-videos/1/complete");

    expect(res.status).toBe(200);
    const calls = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(calls[0]).toBe("BEGIN");
    const lockIndex = calls.findIndex((sql) => sql.includes("FOR UPDATE"));
    expect(lockIndex).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toBe("COMMIT");
  });

  it("returns the existing certificate instead of inserting a second one when certificate_issued is already TRUE", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ completion_status: "completed", certificate_issued: true }] };
      if (sql.includes("WHERE cert.user_id=$1 AND cert.training_video_id=$2 AND cert.is_active=TRUE")) {
        return { rows: [{ id: 9, certificateId: "CAFA-PMIS-2026-EXISTING1234" }] };
      }
      return { rows: [] };
    });

    const res = await appAs(1).post("/training-videos/1/complete");

    expect(res.status).toBe(200);
    expect(res.body.certificate.id).toBe(9);
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO training_certificates"))).toBe(false);
  });

  it("rolls back and returns 400 without inserting anything when the completion is not actually completed", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ completion_status: "in_progress", certificate_issued: false }] };
      return { rows: [] };
    });

    const res = await appAs(1).post("/training-videos/1/complete");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "not_completed" });
    const calls = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(calls).toContain("ROLLBACK");
    expect(calls.some((sql) => sql.includes("INSERT INTO training_certificates"))).toBe(false);
  });
});
