/**
 * AI-CHAT-DAILY-LIMIT — POST /ai/chat had no per-user cost cap: the only
 * limiter covering it was the app-wide IP-keyed rate limiter, which is
 * skipped entirely outside production and shared across every API route
 * (not AI-specific). A single user could otherwise drive unbounded, repeated
 * real LLM API calls. Fixed with a per-user daily message cap, counted from
 * ai_chat_messages, independent of that general limiter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "hi" } }], usage: undefined };
          },
        }),
      },
    },
  },
}));

process.env.AI_ENABLED = "true";
process.env.AI_DAILY_MESSAGE_LIMIT = "3";

const aiRouter = (await import("../ai")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = {
      id: 7, name: "Tester", role: "program_manager", roleLabel: "Programme Manager",
      scope: "org", stateId: null, stateName: null, sector: null, sectors: null,
    } as Request["currentUser"];
    next();
  });
  app.use(aiRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM ai_settings")) return { rows: [{ enabled: "true" }] };
    if (sql.includes("COUNT(*)::text AS count FROM ai_chat_messages")) return { rows: [{ count: "0" }] };
    if (sql.includes("SELECT role, content FROM ai_chat_messages")) return { rows: [] };
    return { rows: [] };
  });
});

describe("AI-CHAT-DAILY-LIMIT", () => {
  it("blocks with 429 once the user has reached today's message cap, without calling the LLM", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM ai_settings")) return { rows: [{ enabled: "true" }] };
      if (sql.includes("COUNT(*)::text AS count FROM ai_chat_messages")) return { rows: [{ count: "3" }] };
      return { rows: [] };
    });

    const res = await makeApp().post("/ai/chat").send({ message: "hello", currentPage: "/dashboard" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "ai_daily_limit_reached", limit: 3 });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO ai_chat_messages"))).toBe(false);
  });

  it("allows the request through when the user is below today's cap", async () => {
    const res = await makeApp().post("/ai/chat").send({ message: "hello", currentPage: "/dashboard" });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("COUNT(*)::text AS count FROM ai_chat_messages"))).toBe(true);
  });

  it("counts only today's 'user' role messages for the acting user, not assistant replies or other users", async () => {
    await makeApp().post("/ai/chat").send({ message: "hello", currentPage: "/dashboard" });

    const usageQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes("COUNT(*)::text AS count FROM ai_chat_messages"));
    expect(usageQuery?.[0]).toContain("role = 'user'");
    expect(usageQuery?.[0]).toContain("user_id = $1");
    expect(usageQuery?.[0]).toContain("date_trunc('day', NOW())");
    expect(usageQuery?.[1]).toEqual([7]);
  });
});
