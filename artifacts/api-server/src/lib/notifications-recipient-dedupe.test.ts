/**
 * NOTIF-002 / NOTIF-003 recipient integrity and atomic event-dedupe sentinels.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockSendEmail, mockBroadcastToUser, mockPublishSupportingEventToUser } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockSendEmail: vi.fn(),
  mockBroadcastToUser: vi.fn(),
  mockPublishSupportingEventToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("./mailer", () => ({ sendEmail: mockSendEmail }));
vi.mock("./realtime", () => ({
  realtime: {
    broadcastToUser: mockBroadcastToUser,
    publishSupportingEventToUser: mockPublishSupportingEventToUser,
  },
}));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const {
  actorsForEntity,
  createNotification,
  createNotificationDeduped,
  notifyEntityActors,
} = await import("./notifications");

type RouterOptions = {
  activeUserIds?: number[];
  actorRows?: { user_id: number }[];
};

function installRouter({ activeUserIds = [42], actorRows = [] }: RouterOptions = {}) {
  const claimed = new Set<string>();
  let nextId = 1;
  mockPoolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM users") && sql.includes("status = 'active'")) {
      const userId = params[0] as number;
      return {
        rows: activeUserIds.includes(userId)
          ? [{ id: userId, email: `user-${userId}@cafa.test`, notification_preferences: null }]
          : [],
      };
    }
    if (sql.includes("FROM projects") || sql.includes("FROM reports") || sql.includes("FROM plans")) {
      return { rows: actorRows };
    }
    if (sql.includes("INSERT INTO notification_event_dedupes")) {
      const key = `${params[0]}:${params[1]}`;
      if (claimed.has(key)) return { rows: [], rowCount: 0 };
      claimed.add(key);
      return { rows: [{ id: nextId++ }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO notifications")) {
      return { rows: [{ id: nextId++ }], rowCount: 1 };
    }
    throw new Error(`Unexpected notification SQL: ${sql}`);
  });
}

describe("NOTIF-002 recipient integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "test" });
  });

  it("NOTIF-RECIP-01: missing recipient is a safe no-op", async () => {
    installRouter({ activeUserIds: [] });

    await expect(createNotification({
      userId: 404, kind: "assigned", message: "Missing recipient",
    })).resolves.toBe(0);

    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(false);
    expect(mockBroadcastToUser).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("NOTIF-RECIP-02: inactive recipient is a safe no-op", async () => {
    // The central resolver only returns rows where users.status is active.
    installRouter({ activeUserIds: [42] });

    await expect(createNotification({
      userId: 91, kind: "assigned", message: "Inactive recipient",
    })).resolves.toBe(0);

    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(false);
    expect(mockBroadcastToUser).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("NOTIF-RECIP-03: active recipient receives the eligible independent channels", async () => {
    installRouter({ activeUserIds: [42] });

    await expect(createNotification({
      userId: 42, kind: "assigned", message: "Active recipient",
    })).resolves.toBeGreaterThan(0);

    expect(mockPoolQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications"))).toHaveLength(1);
    expect(mockPublishSupportingEventToUser).toHaveBeenCalledWith(42, {
      entityType: "notification", entityId: 1, action: "created",
    });
    expect(mockBroadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("NOTIF-RECIP-04: actor derivation joins active users and excludes inactive owners/assignees", async () => {
    installRouter({ actorRows: [{ user_id: 7 }] });

    await expect(actorsForEntity("project", 8)).resolves.toEqual(new Set([7]));

    const actorQuery = mockPoolQuery.mock.calls[0][0] as string;
    expect(actorQuery).toContain("JOIN users u");
    expect(actorQuery).toContain("u.status = 'active'");
  });

  it("NOTIF-RECIP-05: actor-driven fan-out excludes the acting user only", async () => {
    installRouter({ activeUserIds: [11], actorRows: [{ user_id: 10 }, { user_id: 11 }] });

    await notifyEntityActors({
      entityType: "project",
      entityId: 8,
      kind: "comment_added",
      message: "Actor comment",
      exceptUserId: 10,
    });

    const insertedFor = mockPoolQuery.mock.calls
      .filter(([sql]) => sql.includes("INSERT INTO notifications"))
      .map(([, params]) => (params as unknown[])[0]);
    expect(insertedFor).toEqual([11]);
  });
});

describe("NOTIF-003 atomic event dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "test" });
    installRouter({ activeUserIds: [42] });
  });

  const event = (dedupeKey: string, message = "A source event") => ({
    userId: 42,
    kind: "assigned",
    entityType: "conversation",
    entityId: 3,
    message,
    link: "/messages/3",
    dedupeKey,
  });

  function insertionCount() {
    return mockPoolQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications")).length;
  }

  it("NOTIF-DEDUPE-01 and -06: the same concurrent event ×2 creates, emails, and emits once", async () => {
    await Promise.all([
      createNotificationDeduped(event("conversation-message:101")),
      createNotificationDeduped(event("conversation-message:101")),
    ]);

    expect(insertionCount()).toBe(1);
    expect(mockBroadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("NOTIF-DEDUPE-02: the same concurrent event ×10 creates once", async () => {
    await Promise.all(Array.from(
      { length: 10 },
      () => createNotificationDeduped(event("conversation-message:102")),
    ));

    expect(insertionCount()).toBe(1);
    expect(mockBroadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("NOTIF-DEDUPE-03: different messages in one conversation remain separate", async () => {
    await Promise.all([
      createNotificationDeduped(event("conversation-message:201", "First message")),
      createNotificationDeduped(event("conversation-message:202", "Second message")),
    ]);
    expect(insertionCount()).toBe(2);
  });

  it("NOTIF-DEDUPE-04: a mention and a message remain separate", async () => {
    await Promise.all([
      createNotificationDeduped(event("conversation-message:301", "Message")),
      createNotificationDeduped({ ...event("conversation-message-mention:301", "Mention"), kind: "mention" }),
    ]);
    expect(insertionCount()).toBe(2);
  });

  it("NOTIF-DEDUPE-05: distinct workflow transitions remain separate", async () => {
    await Promise.all([
      createNotificationDeduped(event("report-transition:11:submit:draft:submitted")),
      createNotificationDeduped(event("report-transition:11:technical_review:submitted:technically_approved")),
    ]);
    expect(insertionCount()).toBe(2);
  });
});