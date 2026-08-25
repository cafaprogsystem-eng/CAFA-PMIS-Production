import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "@workspace/db";
import type { CurrentUser } from "../middlewares/currentUser";
import realtimeRouter from "./realtime";

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = {
      id: 7,
      name: "Programme Manager",
      role: "program_manager",
      stateId: null,
      sectors: null,
    } as CurrentUser;
    next();
  });
  app.use(realtimeRouter);
  return app;
}

describe("GET /realtime/locks/:entityType/:entityId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts the string ID supplied by the Express route and returns lock status", async () => {
    const query = pool.query as ReturnType<typeof vi.fn>;
    query
      .mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: [] }] })
      .mockResolvedValueOnce({
        rows: [{
          locked_by: 4,
          locked_at: new Date(),
          locked_by_name: "Locked User",
        }],
      });

    const response = await supertest(makeApp()).get("/realtime/locks/project/123");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      locked: true,
      lockedBy: { id: 4, name: "Locked User" },
    });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [123]);
  });

  it("rejects non-canonical path IDs before authorisation or lookup", async () => {
    const response = await supertest(makeApp()).get("/realtime/locks/project/1.5");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_entity" });
    expect(pool.query).not.toHaveBeenCalled();
  });
});