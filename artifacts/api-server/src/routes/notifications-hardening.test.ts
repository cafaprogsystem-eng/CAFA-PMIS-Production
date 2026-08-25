import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

const notificationsRouter = (await import("./notifications")).default;

function appFor(userId: number) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = { id: userId } as NonNullable<Request["currentUser"]>;
    next();
  });
  app.use(notificationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe("NOTIF-006 / NOTIF-008 notification list hardening", () => {
  beforeEach(() => vi.clearAllMocks());

  it("NOTIF-IDOR-01: another user's direct notification ID cannot be marked read", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(appFor(11))
      .patch("/notifications/99/read")
      .expect(404);

    expect(response.body).toEqual({ error: "not_found" });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND user_id = $2"),
      [99, 11],
    );
  });

  it("NOTIF-IDOR-02: list queries bind every result to the authenticated recipient", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ n: 4 }] });

    const response = await request(appFor(11))
      .get("/notifications?limit=2&offset=0")
      .expect(200);

    expect(response.body).toMatchObject({
      items: [],
      unread: 4,
      pagination: { limit: 2, offset: 0, hasMore: false, nextOffset: null },
    });
    expect(mockPoolQuery.mock.calls[0][0]).toContain("WHERE user_id = $1");
    expect(mockPoolQuery.mock.calls[0][1]).toEqual([11, 3, 0]);
  });

  it("NOTIF-LIST-01: rejects malformed and out-of-range list bounds", async () => {
    for (const query of ["?limit=0", "?limit=-1", "?limit=201", "?limit=1.5", "?offset=-1", "?unreadOnly=yes"]) {
      await request(appFor(11)).get(`/notifications${query}`).expect(422);
    }
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("NOTIF-LIST-02: serves deterministic newest-first pages and a documented envelope", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 9, kind: "assigned", link: "/projects/9", createdAt: "2026-08-19T12:00:00.000Z" },
          { id: 8, kind: "assigned", link: "https://unsafe.example", createdAt: "2026-08-19T12:00:00.000Z" },
          { id: 7, kind: "assigned", link: "/projects/7", createdAt: "2026-08-19T11:00:00.000Z" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ n: 3 }] });

    const response = await request(appFor(11))
      .get("/notifications?limit=2&offset=4")
      .expect(200);

    expect(mockPoolQuery.mock.calls[0][0]).toContain("ORDER BY created_at DESC, id DESC");
    expect(response.body).toMatchObject({
      unread: 3,
      items: [
        { id: 9, link: "/projects/9" },
        { id: 8, link: null },
      ],
      pagination: { limit: 2, offset: 4, hasMore: true, nextOffset: 6 },
    });
  });

  it("NOTIF-ID-VALIDATION-01: malformed direct IDs fail before querying", async () => {
    await request(appFor(11)).patch("/notifications/not-a-number/read").expect(422);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});