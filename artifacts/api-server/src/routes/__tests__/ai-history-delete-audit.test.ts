/**
 * AI-HISTORY-DELETE-AUDIT — DELETE /ai/history cleared a user's own AI chat
 * history with zero audit trail: a sensitive privacy-relevant action (erasing
 * conversation records) left no trace in the Audit Log. Fixed by writing a
 * logAudit() entry alongside the deletion.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery, mockLogAudit } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockLogAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));
vi.mock("../../middlewares/currentUser", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../middlewares/currentUser")>();
  return { ...original, logAudit: mockLogAudit };
});

import aiRouter from "../ai";

function makeApp() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: 7 } as Request["currentUser"];
    next();
  });
  app.use(aiRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  mockLogAudit.mockClear();
});

describe("AI-HISTORY-DELETE-AUDIT", () => {
  it("writes an audit entry for the acting user when their AI chat history is cleared", async () => {
    const res = await makeApp().delete("/ai/history");

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(`DELETE FROM ai_chat_messages WHERE user_id = $1`, [7]);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, action: "delete_history", module: "ai" }),
    );
  });
});
