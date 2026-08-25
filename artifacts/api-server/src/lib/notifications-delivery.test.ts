/**
 * NOTIF-001 — canonical independent delivery-channel contract.
 *
 * The matrix intentionally covers every combination of delivery option,
 * category preferences, mandatory status, quiet-hours state, and provider
 * outcome. The provider is mocked so the test checks channel decisions rather
 * than making external email calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const { createNotification, normaliseNotificationPreferences } = await import("./notifications");

type Delivery = "both" | "inapp_only" | "email_only";
type Provider = "success" | "failure" | "stub";

const BASE_PREFS = {
  inApp: {
    approvals: true, approvalDecisions: true, comments: true, assignments: true,
    mentions: true, dueDates: true, overdueItems: true, highRisks: true,
    criticalRisks: true, systemNotifications: true,
  },
  email: {
    approvalRequests: false, approvalDecisions: false, assignments: true,
    mentions: true, passwordReset: true, userInvitations: true,
    dueDateReminders: false, highRisks: true, criticalRisks: true,
  },
  deliveryOption: "both" as Delivery,
  digest: "immediate" as const,
  quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "UTC" },
};

const matrix = (["both", "inapp_only", "email_only"] as const).flatMap((delivery) =>
  ([true, false] as const).flatMap((inAppEnabled) =>
    ([true, false] as const).flatMap((emailEnabled) =>
      ([true, false] as const).flatMap((mandatory) =>
        ([true, false] as const).flatMap((quietActive) =>
          (["success", "failure", "stub"] as const).map((provider) => ({
            delivery, inAppEnabled, emailEnabled, mandatory, quietActive, provider,
          })),
        ),
      ),
    ),
  ),
);

function makePrefs(caseData: (typeof matrix)[number]) {
  return {
    ...BASE_PREFS,
    inApp: { ...BASE_PREFS.inApp, assignments: caseData.inAppEnabled },
    email: { ...BASE_PREFS.email, assignments: caseData.emailEnabled },
    deliveryOption: caseData.delivery,
    quietHours: {
      enabled: caseData.quietActive,
      start: "00:00",
      end: "23:59",
      timezone: "UTC",
    },
  };
}

describe("NOTIF-001 independent notification delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");
  });

  it.each(matrix)(
    "delivery=$delivery inApp=$inAppEnabled email=$emailEnabled mandatory=$mandatory quiet=$quietActive provider=$provider",
    async (caseData) => {
      const prefs = makePrefs(caseData);
      const effectiveDelivery = caseData.mandatory ? "both" : caseData.delivery;
      const shouldCreateInApp =
        (caseData.mandatory || caseData.inAppEnabled) && effectiveDelivery !== "email_only";
      const shouldSendEmail =
        (caseData.mandatory || caseData.emailEnabled) &&
        effectiveDelivery !== "inapp_only" &&
        (caseData.mandatory || !caseData.quietActive);

      mockPoolQuery.mockImplementation((sql: string) => {
        if (sql.includes("notification_preferences")) {
          return { rows: [{ id: 42, email: "recipient@cafa.test", notification_preferences: prefs }] };
        }
        if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 7001 }] };
        if (sql.includes("SELECT email FROM users")) return { rows: [{ email: "recipient@cafa.test" }] };
        throw new Error(`Unexpected notification SQL: ${sql}`);
      });
      if (caseData.provider === "failure") {
        mockSendEmail.mockRejectedValue(new Error("provider failure"));
      } else {
        mockSendEmail.mockResolvedValue({
          delivered: caseData.provider === "success",
          provider: caseData.provider,
        });
      }

      const result = await createNotification({
        userId: 42,
        kind: "assigned",
        message: "Assignment changed",
        entityType: "project",
        entityId: 9,
        mandatory: caseData.mandatory,
      });

      expect(mockPoolQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications"))).toHaveLength(
        shouldCreateInApp ? 1 : 0,
      );
      expect(mockBroadcastToUser).toHaveBeenCalledTimes(shouldCreateInApp ? 1 : 0);
      expect(mockSendEmail).toHaveBeenCalledTimes(shouldSendEmail ? 1 : 0);
      expect(result).toBe(shouldCreateInApp ? 7001 : 0);
      // Email provider failure/stub is best-effort and never changes the
      // successful in-app decision.
      if (shouldSendEmail) {
        expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
          to: "recipient@cafa.test",
          kind: "notification.assigned",
        });
      }
    },
  );
});

describe("NOTIF-001 side-effect isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");
  });

  it("sends email_only without inserting or emitting an in-app notification", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "only-email@cafa.test",
            notification_preferences: { ...BASE_PREFS, deliveryOption: "email_only" },
          }],
        };
      }
      if (sql.includes("SELECT email FROM users")) return { rows: [{ email: "only-email@cafa.test" }] };
      throw new Error(`Unexpected notification SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "test" });

    await expect(createNotification({
      userId: 42, kind: "assigned", message: "Email only",
    })).resolves.toBe(0);

    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(false);
    expect(mockBroadcastToUser).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps an in-app notification when email dispatch fails", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return { rows: [{ id: 42, email: "recipient@cafa.test", notification_preferences: BASE_PREFS }] };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 7002 }] };
      if (sql.includes("SELECT email FROM users")) return { rows: [{ email: "recipient@cafa.test" }] };
      throw new Error(`Unexpected notification SQL: ${sql}`);
    });
    mockSendEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(createNotification({
      userId: 42, kind: "assigned", message: "Independent channels",
    })).resolves.toBe(7002);

    expect(mockBroadcastToUser).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});

// ── NOTIF-PREC: preference-precedence unit tests ──────────────────────────────

describe("NOTIF-PREC normaliseNotificationPreferences mandatory coercion", () => {
  it("forces inApp.criticalRisks to true regardless of stored value", () => {
    const result = normaliseNotificationPreferences({ inApp: { criticalRisks: false } });
    expect(result.inApp.criticalRisks).toBe(true);
  });

  it("forces email.criticalRisks to true regardless of stored value", () => {
    const result = normaliseNotificationPreferences({ email: { criticalRisks: false } });
    expect(result.email.criticalRisks).toBe(true);
  });

  it("forces email.passwordReset to true regardless of stored value", () => {
    const result = normaliseNotificationPreferences({ email: { passwordReset: false } });
    expect(result.email.passwordReset).toBe(true);
  });

  it("retains optional category disabled settings while enforcing mandatory ones", () => {
    const result = normaliseNotificationPreferences({
      inApp: { assignments: false, criticalRisks: false },
      email: { mentions: false, passwordReset: false, criticalRisks: false },
    });
    expect(result.inApp.assignments).toBe(false);
    expect(result.email.mentions).toBe(false);
    // Mandatory override
    expect(result.inApp.criticalRisks).toBe(true);
    expect(result.email.passwordReset).toBe(true);
    expect(result.email.criticalRisks).toBe(true);
  });

  it("returns safe defaults for completely malformed input", () => {
    const result = normaliseNotificationPreferences("not-json");
    expect(result.inApp.criticalRisks).toBe(true);
    expect(result.email.passwordReset).toBe(true);
    expect(result.deliveryOption).toBe("both");
  });
});

// ── NOTIF-QH: quiet-hours edge cases ─────────────────────────────────────────

describe("NOTIF-QH quiet-hours overnight window and mandatory override", () => {
  beforeEach(() => vi.clearAllMocks());

  function prefsWithQuietHours(start: string, end: string, enabled = true) {
    return {
      ...BASE_PREFS,
      quietHours: { enabled, start, end, timezone: "UTC" },
    };
  }

  function makeRecipient(prefs: object) {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return { rows: [{ id: 42, email: "r@cafa.test", notification_preferences: prefs }] };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9001 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });
  }

  it("suppresses email at 23:30 inside an overnight quiet window (22:00→07:00)", async () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("23:30");
    makeRecipient(prefsWithQuietHours("22:00", "07:00"));

    await createNotification({ userId: 42, kind: "assigned", message: "Late night" });

    expect(mockSendEmail).not.toHaveBeenCalled();
    // In-app is unaffected by quiet hours
    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(true);
  });

  it("allows email at 08:00 outside an overnight quiet window (22:00→07:00)", async () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("08:00");
    makeRecipient(prefsWithQuietHours("22:00", "07:00"));

    await createNotification({ userId: 42, kind: "assigned", message: "Morning" });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("suppresses email at 03:00 inside an overnight quiet window (22:00→07:00)", async () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("03:00");
    makeRecipient(prefsWithQuietHours("22:00", "07:00"));

    await createNotification({ userId: 42, kind: "assigned", message: "Night" });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("delivers mandatory risk_critical email even during quiet hours", async () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("23:30");
    // Even with quiet hours covering the whole day
    makeRecipient(prefsWithQuietHours("00:00", "23:59"));

    await createNotification({ userId: 42, kind: "risk_critical", message: "Critical risk!" });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("delivers mandatory password_changed notification regardless of inapp_only delivery setting", async () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");
    // password_changed has no email channel in the registry, but it is mandatory
    // so in-app must always be created
    const prefsInAppOnly = { ...BASE_PREFS, deliveryOption: "inapp_only" as const };
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return { rows: [{ id: 42, email: "r@cafa.test", notification_preferences: prefsInAppOnly }] };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9002 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    const result = await createNotification({ userId: 42, kind: "password_changed", message: "Password changed" });

    // password_changed maps to systemNotifications (no email key), so in-app is created
    expect(result).toBe(9002);
    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(true);
  });
});

// ── NOTIF-PROTZ: profile timezone authoritative for quiet hours ───────────────

describe("NOTIF-PROTZ profile timezone overrides stored quietHours.timezone", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses recipient profile timezone (users.timezone) for quiet-hours, not stored preference timezone", async () => {
    // Stored preferences say timezone=UTC; profile timezone is Africa/Khartoum.
    // toLocaleTimeString must be called with Africa/Khartoum, not UTC.
    const localTimeSpy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");

    const prefsWithUTCTimezone = {
      ...BASE_PREFS,
      quietHours: { enabled: true, start: "00:00", end: "23:59", timezone: "UTC" },
    };

    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "r@cafa.test",
            email_verified: true,
            timezone: "Africa/Khartoum", // profile timezone — must override stored UTC
            notification_preferences: prefsWithUTCTimezone,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9200 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    await createNotification({ userId: 42, kind: "assigned", message: "Test" });

    // The quiet-hours toLocaleTimeString call must use the profile timezone
    const qhCalls = localTimeSpy.mock.calls.filter(
      ([locale, opts]) => locale === "en-GB" && (opts as Intl.DateTimeFormatOptions)?.timeZone !== undefined,
    );
    const usedTimezones = qhCalls.map(([, opts]) => (opts as Intl.DateTimeFormatOptions).timeZone);
    expect(usedTimezones).toContain("Africa/Khartoum");
    expect(usedTimezones).not.toContain("UTC");
  });

  it("falls back to stored quietHours.timezone when recipient has no profile timezone", async () => {
    const localTimeSpy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");

    const prefsWithStoredTimezone = {
      ...BASE_PREFS,
      quietHours: { enabled: true, start: "00:00", end: "23:59", timezone: "Africa/Cairo" },
    };

    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "r@cafa.test",
            email_verified: true,
            timezone: null, // no profile timezone → fall back to stored preference
            notification_preferences: prefsWithStoredTimezone,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9201 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    await createNotification({ userId: 42, kind: "assigned", message: "Test" });

    // Stored timezone must be used as fallback
    const qhCalls = localTimeSpy.mock.calls.filter(
      ([locale, opts]) => locale === "en-GB" && (opts as Intl.DateTimeFormatOptions)?.timeZone !== undefined,
    );
    const usedTimezones = qhCalls.map(([, opts]) => (opts as Intl.DateTimeFormatOptions).timeZone);
    expect(usedTimezones).toContain("Africa/Cairo");
  });
});

// ── NOTIF-EVERIFY: email_verified delivery gate ───────────────────────────────

describe("NOTIF-EVERIFY email_verified delivery gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");
  });

  it("withholds optional email when email_verified is false", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "unverified@cafa.test",
            email_verified: false,
            notification_preferences: BASE_PREFS,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9100 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    // "assigned" is an optional notification — email should be withheld
    const result = await createNotification({
      userId: 42,
      kind: "assigned",
      message: "Assignment for unverified user",
    });

    // In-app notification is created (unaffected by email verification)
    expect(result).toBe(9100);
    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(true);
    // Optional email must NOT be sent
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still delivers mandatory email when email_verified is false", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "unverified@cafa.test",
            email_verified: false,
            notification_preferences: BASE_PREFS,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9101 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    // "risk_critical" is a mandatory notification — email must bypass verification gate
    await createNotification({
      userId: 42,
      kind: "risk_critical",
      message: "Critical risk alert",
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: "unverified@cafa.test",
      kind: "notification.risk_critical",
    });
  });

  it("sends optional email when email_verified is true", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "verified@cafa.test",
            email_verified: true,
            notification_preferences: BASE_PREFS,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9102 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    await createNotification({
      userId: 42,
      kind: "assigned",
      message: "Assignment for verified user",
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: "verified@cafa.test",
      kind: "notification.assigned",
    });
  });

  it("treats email_verified=null as verified for legacy accounts", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return {
          rows: [{
            id: 42,
            email: "legacy@cafa.test",
            email_verified: null,
            notification_preferences: BASE_PREFS,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9103 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    await createNotification({
      userId: 42,
      kind: "assigned",
      message: "Assignment for legacy user",
    });

    // Legacy accounts (email_verified=null) are treated as verified
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("treats missing email_verified field as verified (backward compat)", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        // No email_verified field — simulates rows from before the column existed
        return {
          rows: [{
            id: 42,
            email: "old@cafa.test",
            notification_preferences: BASE_PREFS,
          }],
        };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 9104 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    await createNotification({
      userId: 42,
      kind: "assigned",
      message: "Assignment for pre-verification user",
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});

// ── NOTIF-DEDUP: mention vs comment dedup guard ───────────────────────────────

describe("NOTIF-DEDUP mention does not also trigger a comments preference check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00");
  });

  it("a mention notification uses the mentions preference key, not the comments key", async () => {
    // User has comments disabled but mentions enabled
    const prefs = {
      ...BASE_PREFS,
      inApp: { ...BASE_PREFS.inApp, comments: false, mentions: true },
    };
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return { rows: [{ id: 42, email: "m@cafa.test", notification_preferences: prefs }] };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 8001 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    // Emitting as "mention" uses the mentions preference, so it gets delivered
    // even though comments is disabled
    const result = await createNotification({ userId: 42, kind: "mention", message: "You were mentioned" });
    expect(result).toBe(8001);
    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(true);
  });

  it("a comment_added notification uses the comments preference key", async () => {
    // User has comments disabled but mentions enabled
    const prefs = {
      ...BASE_PREFS,
      inApp: { ...BASE_PREFS.inApp, comments: false, mentions: true },
    };
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return { rows: [{ id: 42, email: "m@cafa.test", notification_preferences: prefs }] };
      }
      // Should NOT be reached since comments is disabled
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 8002 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    // comment_added uses comments preference → disabled → no in-app notification
    const result = await createNotification({ userId: 42, kind: "comment_added", message: "New comment" });
    expect(result).toBe(0);
    expect(mockPoolQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(false);
  });

  it("a single mention event does not also create a comment_added notification", async () => {
    // This test confirms callers must choose one kind per event, enforced at the
    // createNotification call site; a single call always resolves to one kind.
    const prefs = { ...BASE_PREFS };
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("notification_preferences")) {
        return { rows: [{ id: 42, email: "m@cafa.test", notification_preferences: prefs }] };
      }
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: 8003 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    mockSendEmail.mockResolvedValue({ delivered: true });

    await createNotification({ userId: 42, kind: "mention", message: "Mentioned in comment" });

    // Exactly one INSERT — not two (one for mention, one for comment_added)
    expect(mockPoolQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications"))).toHaveLength(1);
  });
});
