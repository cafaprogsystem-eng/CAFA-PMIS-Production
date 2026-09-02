/**
 * SEARCH-STATES — States is a first-class top-level module (its own list +
 * detail pages) but was completely absent from global search: searching a
 * state's name surfaced nothing. Fixed by adding a states branch, scoped the
 * same way as every other category (a state-scoped role can only ever match
 * its own single assigned state; states are not sector-partitioned, same as
 * the users branch).
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
    id: 1, name: "Tester", email: "tester@example.test", role: "program_manager",
    roleLabel: "Programme Manager", scope: "org", stateId: null, stateName: null,
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

describe("SEARCH-STATES", () => {
  it("includes a states category in the response for an org-wide role", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 3, name: "Kassala", nameAr: "كسلا", code: "KSL", operationalStatus: "active", officeStatus: "present" }] });

    const response = await appAs(user()).get("/search?q=kassala");

    expect(response.status).toBe(200);
    expect(response.body.states).toEqual([{ id: 3, name: "Kassala", nameAr: "كسلا", code: "KSL", operationalStatus: "active", officeStatus: "present" }]);
    const statesQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes("FROM states s"));
    expect(statesQuery?.[0]).toContain("s.name ILIKE $1 OR s.name_ar ILIKE $1 OR s.code ILIKE $1");
    expect(statesQuery?.[0]).not.toContain("s.id = $3");
  });

  it("scopes a state-role user's states search to only their own assigned state", async () => {
    await appAs(user({ role: "state_program_officer", stateId: 7 })).get("/search?q=kassala");

    const statesQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes("FROM states s"));
    expect(statesQuery?.[0]).toContain("AND s.id = $3");
    expect(statesQuery?.[1]).toEqual(["%kassala%", 5, 7]);
  });

  it("returns an empty states array (not an error) for an empty query", async () => {
    const response = await appAs(user()).get("/search");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ states: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
