/**
 * AI-CHAT-ERROR-REDACTION — POST /ai/chat used to write the raw OpenAI SDK
 * exception message into the streamed reply and persist it verbatim in
 * ai_chat_messages, as if it were the assistant's own response. A failure
 * (rate limit, auth, malformed request...) must instead show the user a
 * generic notice; the real error belongs only in the server log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery, mockCreate, mockLogError } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCreate: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: mockCreate } } },
}));

process.env.AI_ENABLED = "true";
process.env.AI_DAILY_MESSAGE_LIMIT = "50";

const aiRouter = (await import("../ai")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = {
      id: 7, name: "Tester", role: "program_manager", roleLabel: "Programme Manager",
      scope: "org", stateId: null, stateName: null, sector: null, sectors: null,
    } as Request["currentUser"];
    req.log = { error: mockLogError, warn: vi.fn(), info: vi.fn() } as unknown as Request["log"];
    next();
  });
  app.use(aiRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

let insertedContent: string | undefined;
let insertedStatus: string | undefined;

beforeEach(() => {
  mockQuery.mockReset();
  mockCreate.mockReset();
  mockLogError.mockClear();
  insertedContent = undefined;
  insertedStatus = undefined;
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes("FROM ai_settings")) return { rows: [{ enabled: "true" }] };
    if (sql.includes("COUNT(*)::text AS count FROM ai_chat_messages")) return { rows: [{ count: "0" }] };
    if (sql.includes("SELECT role, content FROM ai_chat_messages")) return { rows: [] };
    if (sql.includes("INSERT INTO ai_chat_messages") && params) {
      insertedContent = params[2] as string;
      insertedStatus = params[5] as string;
    }
    return { rows: [] };
  });
});

describe("AI-CHAT-ERROR-REDACTION", () => {
  it("shows a generic notice and logs the real error internally when the OpenAI call throws", async () => {
    mockCreate.mockRejectedValue(new Error("Incorrect API key provided: sk-***abcd. Project proj_internal123."));

    const res = await makeApp().post("/ai/chat").send({ message: "hello", currentPage: "/dashboard" });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Incorrect API key");
    expect(res.text).not.toContain("proj_internal123");
    expect(res.text).toContain("something went wrong");

    expect(insertedContent).not.toContain("Incorrect API key");
    expect(insertedStatus).toBe("failed");

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "[ai:chat] OpenAI request failed",
    );
  });
});
