import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../lib/session", () => ({
  getActiveSession: async () => ({
    id: "session-7",
    userId: 7,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  }),
}));

const { attachCurrentUser } = await import("./currentUser");

function makeRequest() {
  return {
    header: vi.fn(() => undefined),
  } as unknown as Request;
}

const baseRow = {
  id: 7, name: "Amina", email: "amina@example.test", role: "program_manager",
  role_label: "Program Manager", scope: "hq", state_id: null, state_name: null,
  sector: null, status: "active",
};

describe("current user avatar proxy contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not expose a profile proxy for a legacy or arbitrary avatar object key", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ...baseRow, avatar_url: "/objects/uploads/legacy-key" }] });
    const req = makeRequest();
    const next = vi.fn();

    await attachCurrentUser(req, {} as Response, next as NextFunction);

    expect(req.currentUser?.avatarUrl).toBeNull();
    expect(next).toHaveBeenCalledWith();
  });

  it("uses the authenticated proxy for an avatar in the managed profile namespace", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ...baseRow, avatar_url: "/objects/profiles/11111111-1111-1111-1111-111111111111" }] });
    const req = makeRequest();

    await attachCurrentUser(req, {} as Response, vi.fn());

    expect(req.currentUser?.avatarUrl).toBe("/api/profile/photo");
  });
});