/**
 * MANUAL-TRANSLATION-STALE-ON-EDIT — editing a chapter/section/SOP's English
 * source content never touched its translated (localization) rows at all.
 * translation_status only ever changed via the explicit admin "import
 * machine draft" action (checksum-diffed), so a normal content edit left a
 * stale Arabic translation with no "needs review" signal anywhere. Fixed:
 * each PATCH route now marks every existing localization row for that
 * entity translation_status='review_required' the moment a translatable
 * field is touched.
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

function staleUpdateCalls() {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes("translation_status = 'review_required'"));
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [{ id: 7, chapter_id: 3 }] });
});

describe("MANUAL-TRANSLATION-STALE-ON-EDIT", () => {
  it("marks a chapter's localizations stale when title/description is edited", async () => {
    const res = await appAs().patch("/manual/chapters/introduction").send({ title: "New Title" });
    expect(res.status).toBe(200);
    const stale = staleUpdateCalls();
    expect(stale).toHaveLength(1);
    expect(stale[0][0]).toContain("manual_chapter_localizations");
    expect(stale[0][0]).toContain("WHERE chapter_id = $1");
    expect(stale[0][1]).toEqual([7]);
  });

  it("does not mark a chapter's localizations stale for a metadata-only edit (icon/order/status)", async () => {
    const res = await appAs().patch("/manual/chapters/introduction").send({ icon: "Star", order: 3 });
    expect(res.status).toBe(200);
    expect(staleUpdateCalls()).toHaveLength(0);
  });

  it("marks a section's localizations stale when title/content is edited", async () => {
    const res = await appAs().patch("/manual/sections/7").send({ content: "Updated procedure text." });
    expect(res.status).toBe(200);
    const stale = staleUpdateCalls();
    expect(stale).toHaveLength(1);
    expect(stale[0][0]).toContain("manual_section_localizations");
    expect(stale[0][0]).toContain("WHERE section_id = $1");
    expect(stale[0][1]).toEqual([7]);
  });

  it("does not mark a section's localizations stale for an order-only edit", async () => {
    const res = await appAs().patch("/manual/sections/7").send({ order: 2 });
    expect(res.status).toBe(200);
    expect(staleUpdateCalls()).toHaveLength(0);
  });

  it("marks a SOP's localizations stale when any translatable field is edited", async () => {
    const res = await appAs().patch("/manual/sops/9").send({ purpose: "Updated purpose." });
    expect(res.status).toBe(200);
    const stale = staleUpdateCalls();
    expect(stale).toHaveLength(1);
    expect(stale[0][0]).toContain("manual_sop_localizations");
    expect(stale[0][0]).toContain("WHERE sop_id = $1");
  });

  it("the stale-marking UPDATE never regresses an already-reviewed/approved row back to review_required unnecessarily (guarded by translation_status <> 'review_required')", async () => {
    await appAs().patch("/manual/chapters/introduction").send({ title: "New Title" });
    const stale = staleUpdateCalls();
    expect(stale[0][0]).toContain("translation_status <> 'review_required'");
  });
});
