import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockBroadcastToUser, mockPublishSupportingEventToUser } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockBroadcastToUser: vi.fn(),
  mockPublishSupportingEventToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("./realtime", () => ({
  realtime: {
    broadcastToUser: mockBroadcastToUser,
    publishSupportingEventToUser: mockPublishSupportingEventToUser,
  },
}));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const { createNotification, normaliseNotificationLink } = await import("./notifications");

describe("NOTIF-LINK new-write and historical link safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM users")) {
        return { rows: [{ id: 9, email: null, notification_preferences: null }] };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 81 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  it("accepts recognised internal CAFA PMIS routes only", () => {
    expect(normaliseNotificationLink("/reports/project?open=42")).toBe("/reports/project?open=42");
    expect(normaliseNotificationLink("/messages/7")).toBe("/messages/7");
    expect(normaliseNotificationLink("/ai")).toBe("/ai");
    expect(normaliseNotificationLink("/ai-settings?tab=logs")).toBe("/ai?tab=logs");
  });

  it.each([
    "https://unsafe.example/path",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "//unsafe.example",
    "/\\unsafe.example",
    "/unknown-route",
  ])("normalises unsafe new destinations to null: %s", async (link) => {
    await createNotification({
      userId: 9,
      kind: "assigned",
      entityType: "project",
      entityId: 4,
      message: "Assignment",
      link,
    });

    const insert = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(insert?.[1]).toEqual([9, "assigned", "project", 4, "Assignment", null]);
  });
});