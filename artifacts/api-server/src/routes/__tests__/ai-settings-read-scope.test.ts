/**
 * AI-SETTINGS-READ-SCOPE — GET /ai/settings had no permission check at all,
 * so any authenticated user (not just admins) could read systemPromptExtra
 * (the admin's custom internal system-prompt instructions) even though only
 * ai.settings.manage holders can write it. The route must stay open to every
 * user (the chat widget calls it to decide whether to render itself and
 * which response language to request) — the fix scopes just the sensitive
 * field, not the whole endpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

import aiRouter from "../ai";
import type { CurrentUser } from "../../middlewares/currentUser";

function appAs(role: string) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: 1, name: "Tester", role, roleLabel: role } as CurrentUser;
    next();
  });
  app.use(aiRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({
    rows: [{ enabled: "true", system_prompt_extra: "Never mention competitor X.", response_language: "auto", updated_at: "2026-01-01" }],
  });
});

describe("AI-SETTINGS-READ-SCOPE", () => {
  it("stays reachable for an ordinary staff role (the chat widget depends on this)", async () => {
    const res = await appAs("state_program_officer").get("/ai/settings");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe("true");
  });

  it("hides systemPromptExtra from a role with neither ai.settings.manage nor ai.logs.view", async () => {
    const res = await appAs("state_program_officer").get("/ai/settings");
    expect(res.status).toBe(200);
    expect(res.body.systemPromptExtra).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("competitor");
  });

  it("returns systemPromptExtra to a program_manager (ai.logs.view)", async () => {
    const res = await appAs("program_manager").get("/ai/settings");
    expect(res.status).toBe(200);
    expect(res.body.systemPromptExtra).toBe("Never mention competitor X.");
  });

  it("returns systemPromptExtra to an executive_director (ai.settings.manage)", async () => {
    const res = await appAs("executive_director").get("/ai/settings");
    expect(res.status).toBe(200);
    expect(res.body.systemPromptExtra).toBe("Never mention competitor X.");
  });

  it("returns systemPromptExtra to super_admin (wildcard)", async () => {
    const res = await appAs("super_admin").get("/ai/settings");
    expect(res.status).toBe(200);
    expect(res.body.systemPromptExtra).toBe("Never mention competitor X.");
  });
});
