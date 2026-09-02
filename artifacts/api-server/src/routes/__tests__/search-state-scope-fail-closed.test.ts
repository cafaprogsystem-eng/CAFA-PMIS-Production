/**
 * SEARCH-STATE-SCOPE-FAIL-CLOSED — GET /search silently dropped its state
 * filter (instead of failing closed) for a state_program_officer/
 * state_office_manager with no assigned state, returning an organisation-wide
 * result set to a user who should see nothing. Fixed to match the same
 * fail-closed rule already enforced by the report-list and plan-list scopes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

import searchRouter from "../search";
import type { CurrentUser } from "../../middlewares/currentUser";

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1, name: "Tester", email: "tester@example.test", role: "state_program_officer",
    roleLabel: "State Program Officer", scope: "state", stateId: 7, stateName: "Khartoum",
    sector: null, avatarUrl: null, sectors: null, ...overrides,
  };
}

function appAs(currentUser: CurrentUser) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = currentUser;
    next();
  });
  app.use(searchRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("SEARCH-STATE-SCOPE-FAIL-CLOSED", () => {
  it("fails closed with 403 for a state-scoped role with no assigned state, running no queries", async () => {
    const response = await appAs(user({ stateId: null })).get("/search?q=health");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "no state assigned" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still searches normally for a state-scoped role that does have an assigned state", async () => {
    const response = await appAs(user({ stateId: 7 })).get("/search?q=health");

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalled();
    const projectQuery = String(mockQuery.mock.calls[0][0]);
    expect(projectQuery).toContain("project_states ps WHERE ps.project_id = p.id AND ps.state_id = $3");
  });

  it("is unaffected for non-state-scoped roles (e.g. program_manager) even with a null stateId", async () => {
    const response = await appAs(user({ role: "program_manager", scope: "org", stateId: null })).get("/search?q=health");

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalled();
  });
});
