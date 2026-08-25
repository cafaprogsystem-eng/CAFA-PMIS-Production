import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
}));

describe("GET /dashboard/hierarchical-performance", () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: router } = await import("../dashboard");
    app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = {
        id: 7,
        name: "Dashboard Tester",
        email: "dashboard@example.com",
        role: "program_manager",
        roleLabel: "Program Manager",
        scope: "global",
        stateId: null,
        stateName: null,
        sector: null,
        sectors: null,
        avatarUrl: null,
      };
      next();
    });
    app.use(router);
  });

  it("returns 200 and a valid hierarchy when a project label is null", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM projects p")) {
        return {
          rows: [
            { id: 1, code: "P-1", title: "Known", sector: "Health" },
            { id: 2, code: "P-2", title: "Unresolved", sector: null },
            { id: 3, code: "P-3", title: "Unknown", sector: "unknown" },
          ],
        };
      }
      if (sql.includes("FROM project_states") || sql.includes("FROM indicators")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected dashboard query: ${sql}`);
    });

    const response = await request(app).get("/dashboard/hierarchical-performance");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      averageSectorAchievementRate: null,
      validSectorCount: 0,
      validProjectCount: 0,
      sectors: [
        expect.objectContaining({ sector: "Health", projectCount: 1 }),
        expect.objectContaining({ sector: null, projectCount: 2 }),
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain("undefined");
    expect(JSON.stringify(response.body)).not.toContain("hierarchical.");
  });
});