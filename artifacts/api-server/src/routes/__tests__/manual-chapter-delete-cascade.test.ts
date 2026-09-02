/**
 * MANUAL-CHAPTER-DELETE-CASCADE — DELETE /manual/chapters/:slug deleted only
 * the chapter row itself, leaving its sections, SOPs, their localizations,
 * and version-history rows orphaned (no FK/cascade enforced this). It also
 * matched by slug with no LIMIT, so two chapters sharing a slug (nothing
 * previously prevented that) would both be deleted in one call while only
 * the first was audited. Fixed: the route now takes the chapter's numeric
 * ID, runs the full cascade inside one transaction, and manual_chapters.slug
 * is now enforced unique at the DB level (migration 064).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockPoolQuery, mockClientQuery, mockConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockClientQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockConnect },
}));

import manualRouter from "../manual";
import type { CurrentUser } from "../../middlewares/currentUser";

function appAs(role = "super_admin") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: 1, name: "Admin", role, roleLabel: "Admin" } as CurrentUser;
    next();
  });
  app.use(manualRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset().mockResolvedValue({ rows: [] });
  mockConnect.mockReset().mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
});

describe("MANUAL-CHAPTER-DELETE-CASCADE", () => {
  it("deletes by numeric ID (not slug) and cascades to sections, SOPs, their localizations, and version history — in one transaction", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id FROM manual_chapters WHERE id = $1 FOR UPDATE")) return { rows: [{ id: 42 }] };
      return { rows: [] };
    });

    const res = await appAs().delete("/manual/chapters/42");

    expect(res.status).toBe(200);
    const calls = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(calls[0]).toBe("BEGIN");
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_sop_localizations WHERE sop_id IN"))).toBe(true);
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_sops WHERE chapter_id = $1"))).toBe(true);
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_section_localizations WHERE section_id IN"))).toBe(true);
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_sections WHERE chapter_id = $1"))).toBe(true);
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_chapter_localizations WHERE chapter_id = $1"))).toBe(true);
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_version_history WHERE chapter_id = $1"))).toBe(true);
    expect(calls.some((sql) => sql.includes("DELETE FROM manual_chapters WHERE id = $1"))).toBe(true);
    expect(calls[calls.length - 1]).toBe("COMMIT");
    // Every cascade delete ran with the same chapter id.
    for (const [sql, params] of mockClientQuery.mock.calls) {
      if (String(sql).includes("chapter_id = $1") || String(sql).includes("WHERE id = $1")) {
        expect(params).toEqual([42]);
      }
    }
  });

  it("returns 404 and runs no deletes for a chapter ID that does not exist", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FOR UPDATE")) return { rows: [] };
      return { rows: [] };
    });

    const res = await appAs().delete("/manual/chapters/999");

    expect(res.status).toBe(404);
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).startsWith("DELETE"))).toBe(false);
    expect(mockClientQuery.mock.calls.map(([sql]) => String(sql))).toContain("ROLLBACK");
  });

  it("rejects a non-numeric chapter id before opening any transaction", async () => {
    const res = await appAs().delete("/manual/chapters/not-a-number");

    expect(res.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 409 slug_taken instead of a raw 500 when creating a chapter with a duplicate slug", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO manual_chapters")) {
        const err = new Error("duplicate key value violates unique constraint") as Error & { code: string; constraint: string };
        err.code = "23505";
        err.constraint = "manual_chapters_slug_unique";
        throw err;
      }
      return { rows: [] };
    });

    const res = await appAs().post("/manual/chapters").send({ title: "Dup", slug: "existing-slug" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "slug_taken" });
  });
});
