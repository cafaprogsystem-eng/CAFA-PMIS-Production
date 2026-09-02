/**
 * TRAINING-VIDEOS-ADMIN-PERMISSION — training-videos.ts hand-copied the exact
 * role array ["super_admin", "program_manager", "executive_director"] four
 * separate times (a local requireVideoAdmin middleware plus three inline
 * isAdmin checks), instead of using the shared requirePerm/permissionsFor
 * system every other module in this codebase uses. Fixed: a new
 * training_videos.manage permission (granted to those same three roles) now
 * backs both requireVideoAdmin and the inline read-scoping checks, so there
 * is exactly one place the role list is declared.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

import trainingVideosRouter from "../../routes/training-videos";
import type { CurrentUser } from "../../middlewares/currentUser";

function appAs(role: string) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: 1, name: "Tester", role, roleLabel: role } as CurrentUser;
    next();
  });
  app.use(trainingVideosRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("TRAINING-VIDEOS-ADMIN-PERMISSION", () => {
  it.each(["super_admin", "program_manager", "executive_director"])(
    "requireVideoAdmin (training_videos.manage) allows %s through to an admin-gated route",
    async (role) => {
      const res = await appAs(role).get("/training-certificates");
      expect(res.status).not.toBe(403);
    },
  );

  it.each(["viewer", "state_program_officer", "technical_coordinator", "senior_program_coordinator", "state_office_manager"])(
    "requireVideoAdmin rejects %s from an admin-gated route",
    async (role) => {
      const res = await appAs(role).get("/training-certificates");
      expect(res.status).toBe(403);
    },
  );

  it("the inline isAdmin read-scoping check (GET /training-videos/all) includes drafts for an admin role", async () => {
    await appAs("executive_director").get("/training-videos/all");
    const call = mockQuery.mock.calls.find(([sql]) => String(sql).includes("v.created_at DESC"));
    expect(String(call?.[0])).not.toContain("v.status = 'published'");
  });

  it("the inline isAdmin read-scoping check excludes drafts for a non-admin role", async () => {
    await appAs("state_program_officer").get("/training-videos/all");
    const call = mockQuery.mock.calls.find(([sql]) => String(sql).includes("v.created_at DESC"));
    expect(String(call?.[0])).toContain("v.status = 'published'");
  });
});
