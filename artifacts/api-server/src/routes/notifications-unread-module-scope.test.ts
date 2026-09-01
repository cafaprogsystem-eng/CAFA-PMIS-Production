/**
 * NOTIFICATIONS-UNREAD-MODULE-SCOPE — GET /notifications's `unread` count was
 * always computed across ALL modules regardless of the request's own
 * `module` filter, while the `items` list it returned alongside it was
 * already correctly filtered by that same `module`. Selecting "Risks" in the
 * module filter left the Unread-tab badge showing the total system-wide
 * unread count (e.g. "12") while the actual filtered list underneath it
 * turned up far fewer rows — the count and what it labels never matched.
 *
 * `unread` is now computed with the same `module` filter as `items`
 * (`unreadOnly` itself is deliberately NOT applied to it — it must always
 * report the true unread count regardless of which tab, All or Unread, is
 * currently selected).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const mockPoolQuery = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../lib/notifications", () => ({
  normaliseNotificationLink: (link: string | null) => link,
  presentNotificationKind: (kind: string) => kind,
}));
vi.mock("../lib/realtime", () => ({ realtime: {} }));

const { default: notificationsRouter } = await import("./notifications");

function makeApp(userId = 7) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.currentUser = { id: userId } as Request["currentUser"]; next(); });
  app.use(notificationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("NOTIFICATIONS-UNREAD-MODULE-SCOPE", () => {
  it("applies the same module filter to the unread count as to the items list", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    mockPoolQuery.mockImplementation((sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT id, kind")) return { rows: [] };
      if (sql.includes("COUNT(*)::int AS n")) return { rows: [{ n: 3 }] };
      return { rows: [] };
    });

    const r = await supertest(makeApp()).get("/notifications?module=risk");

    expect(r.status).toBe(200);
    expect(r.body.unread).toBe(3);

    const unreadQuery = queries.find((q) => q.sql.includes("COUNT(*)::int AS n"));
    expect(unreadQuery).toBeDefined();
    expect(unreadQuery!.sql).toContain("entity_type = $2");
    expect(unreadQuery!.params).toEqual([7, "risk"]);
  });

  it("counts across all modules when no module filter is given (unchanged default behaviour)", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    mockPoolQuery.mockImplementation((sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT id, kind")) return { rows: [] };
      if (sql.includes("COUNT(*)::int AS n")) return { rows: [{ n: 12 }] };
      return { rows: [] };
    });

    const r = await supertest(makeApp()).get("/notifications");

    expect(r.status).toBe(200);
    expect(r.body.unread).toBe(12);

    const unreadQuery = queries.find((q) => q.sql.includes("COUNT(*)::int AS n"));
    expect(unreadQuery!.sql).not.toContain("entity_type");
    expect(unreadQuery!.params).toEqual([7]);
  });
});
