import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockGetActiveSession } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetActiveSession: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../lib/session", () => ({ getActiveSession: mockGetActiveSession }));

const { attachCurrentUser, isDemoRoleHarnessEnabled } = await import("./currentUser");

const originalDemoMode = process.env.CAFA_DEMO_MODE;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.CAFA_DEMO_MODE;
  else process.env.CAFA_DEMO_MODE = originalDemoMode;
});

describe("demo role harness gate", () => {
  it("is disabled by default and requires an explicit non-production setting", () => {
    expect(isDemoRoleHarnessEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDemoRoleHarnessEnabled({ NODE_ENV: "development", CAFA_DEMO_MODE: "true" })).toBe(true);
  });

  it("fails closed in production even if the environment setting is present", () => {
    expect(isDemoRoleHarnessEnabled({ NODE_ENV: "production", CAFA_DEMO_MODE: "true" })).toBe(false);
  });

  it("allows a demo identity only after a valid super-admin session is established", async () => {
    process.env.CAFA_DEMO_MODE = "true";
    mockGetActiveSession.mockResolvedValue({
      id: "active-admin-session",
      userId: 1,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ role: "super_admin" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          name: "Demo staff",
          email: "demo@example.test",
          role: "state_officer",
          role_label: "State Officer",
          scope: "state",
          state_id: 7,
          state_name: "Khartoum",
          state_name_ar: "الخرطوم",
          sector: null,
          status: "active",
          avatar_url: null,
        }],
      });
    const req = {
      header: vi.fn((name: string) => name === "x-user-id" ? "9" : undefined),
    } as unknown as Request;
    const next = vi.fn();

    await attachCurrentUser(req, {} as Response, next as NextFunction);

    expect(req.authSession).toMatchObject({ id: "active-admin-session", userId: 1 });
    expect(req.currentUser?.id).toBe(9);
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT role FROM users"),
      [1],
    );
  });
});