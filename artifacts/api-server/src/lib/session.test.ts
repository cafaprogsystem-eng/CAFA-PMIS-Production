import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

const { createSession, getActiveSessionFromToken, revokeSession } =
  await import("./session");

describe("revocable authenticated sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists only a hash of a fresh opaque token", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { session, token } = await createSession(42, true);

    expect(token).not.toMatch(/^\d+$/);
    expect(token).toHaveLength(43);
    expect(session.userId).toBe(42);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO auth_sessions"),
      expect.arrayContaining([session.id, 42]),
    );
    const storedTokenHash = mockQuery.mock.calls[0][1][2];
    expect(storedTokenHash).not.toBe(token);
    expect(storedTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a legacy signed user-ID value without querying a session", async () => {
    await expect(getActiveSessionFromToken("42")).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("accepts only an unrevoked, unexpired stored session", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "b0b3a43b-f2b4-438e-9ee2-9e65a81fd10d",
          user_id: 42,
          expires_at: new Date("2030-01-01T00:00:00.000Z"),
        },
      ],
    });

    await expect(
      getActiveSessionFromToken("opaque-session-token"),
    ).resolves.toMatchObject({
      userId: 42,
      id: "b0b3a43b-f2b4-438e-9ee2-9e65a81fd10d",
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("revoked_at IS NULL"),
      expect.any(Array),
    );
    expect(mockQuery.mock.calls[0][0]).toContain("expires_at > NOW()");
  });

  it("revokes exactly the targeted session and is safely repeatable", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "session-a" }] });
    await expect(revokeSession("session-a")).resolves.toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND revoked_at IS NULL"),
      ["session-a"],
    );

    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(revokeSession("session-a")).resolves.toBe(false);
  });
});
