/**
 * MANUAL-BLANK-TITLE-VALIDATION — chapter/section/SOP create and edit only
 * ever checked `!title` (or `!processName`), which is truthy — and so
 * passes validation — for a whitespace-only string like "   ". A blank-
 * looking title/process name could be created or saved with nothing to
 * show why the row looks empty. Fixed by trimming before the truthiness
 * check on every create and edit route, and storing the trimmed value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

import manualRouter from "../manual";
import type { CurrentUser } from "../../middlewares/currentUser";

function appAs() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: 1, name: "Editor", role: "super_admin", roleLabel: "Admin" } as CurrentUser;
    next();
  });
  app.use(manualRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [{ id: 1, chapter_id: 1 }] });
});

describe("MANUAL-BLANK-TITLE-VALIDATION", () => {
  it("rejects a whitespace-only chapter title on create", async () => {
    const res = await appAs().post("/manual/chapters").send({ title: "   ", slug: "new-chapter" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "title and slug are required" });
  });

  it("rejects a whitespace-only chapter title on edit", async () => {
    const res = await appAs().patch("/manual/chapters/introduction").send({ title: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_title" });
  });

  it("rejects a whitespace-only section title on create", async () => {
    const res = await appAs().post("/manual/chapters/introduction/sections").send({ title: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "title required" });
  });

  it("rejects a whitespace-only section title on edit", async () => {
    const res = await appAs().patch("/manual/sections/1").send({ title: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_title" });
  });

  it("rejects a whitespace-only SOP process name on create", async () => {
    const res = await appAs().post("/manual/chapters/introduction/sops").send({ processName: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "processName required" });
  });

  it("rejects a whitespace-only SOP process name on edit", async () => {
    const res = await appAs().patch("/manual/sops/1").send({ processName: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_process_name" });
  });

  it("stores the trimmed title, not the padded raw value, when creating a chapter", async () => {
    const res = await appAs().post("/manual/chapters").send({ title: "  Padded Title  ", slug: "  padded-slug  " });
    expect(res.status).toBe(201);
    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO manual_chapters"));
    expect(insertCall?.[1]?.[0]).toBe("Padded Title");
    expect(insertCall?.[1]?.[1]).toBe("padded-slug");
  });

  it("still allows an ordinary metadata-only chapter edit (no title touched)", async () => {
    const res = await appAs().patch("/manual/chapters/introduction").send({ icon: "Star" });
    expect(res.status).toBe(200);
  });
});
