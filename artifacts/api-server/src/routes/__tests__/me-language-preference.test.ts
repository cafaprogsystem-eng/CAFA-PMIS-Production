/**
 * ME-LANGUAGE-PREFERENCE — a saved Profile "Interface Language" preference
 * never actually followed a user to a different device/browser: neither
 * attachCurrentUser's SELECT nor GET /me's response ever included
 * language_preference at all, so the frontend had nothing to sync from and
 * silently defaulted to English on any device other than the one the
 * setting was saved from. Fixed: attachCurrentUser now selects it and GET
 * /me returns it on req.currentUser.
 */
import type { NextFunction, Request, Response } from "express";
import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../lib/session", () => ({
  getActiveSession: async () => ({ id: "session-7", userId: 7, expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
}));

const { attachCurrentUser } = await import("../../middlewares/currentUser");
const meRouter = (await import("../me")).default;

const baseRow = {
  id: 7, name: "Amina", email: "amina@example.test", role: "program_manager",
  role_label: "Program Manager", scope: "hq", state_id: null, state_name: null,
  sector: null, status: "active", avatar_url: null,
};

describe("ME-LANGUAGE-PREFERENCE", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attachCurrentUser selects and exposes language_preference on req.currentUser", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ...baseRow, language_preference: "ar" }] });
    const req = { header: vi.fn(() => undefined) } as unknown as Request;

    await attachCurrentUser(req, {} as Response, vi.fn() as NextFunction);

    expect(req.currentUser?.languagePreference).toBe("ar");
    expect(String(mockPoolQuery.mock.calls[0][0])).toContain("u.language_preference");
  });

  it("GET /me returns the acting user's languagePreference", async () => {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.currentUser = {
        id: 7, name: "Amina", email: "amina@example.test", role: "program_manager",
        roleLabel: "Program Manager", scope: "hq", stateId: null, stateName: null,
        sector: null, avatarUrl: null, sectors: null, languagePreference: "ar",
      };
      next();
    });
    app.use(meRouter);

    const res = await supertest(app).get("/me");

    expect(res.status).toBe(200);
    expect(res.body.user.languagePreference).toBe("ar");
  });
});
