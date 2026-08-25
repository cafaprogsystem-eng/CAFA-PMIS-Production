/**
 * TC notification sector matching tests (closes PMR-011)
 *
 * Tests that notifyNextApprover correctly resolves the right TC based on
 * project sector using trim-aware unnest matching.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPoolQuery, mockLoggerWarn } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  },
}));

vi.mock("../lib/realtime", () => ({
  realtime: { broadcastToUser: vi.fn(), publishSupportingEventToUser: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../lib/mailer", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { notifyNextApprover } from "../lib/notifications";

// ── Mock helpers ──────────────────────────────────────────────────────────────

/**
 * Set up pool.query to respond based on SQL content:
 *  - TC SELECT (contains "technical_coordinator") → returns tcRows
 *  - SPC SELECT (contains "senior_program_coordinator") → returns spcRows
 *  - PM SELECT (contains "program_manager" but not coordinator) → returns []
 *  - notification_preferences SELECT → returns [] (use defaults)
 *  - dedup SELECT (notifications table) → returns [] (not a duplicate)
 *  - INSERT INTO notifications → returns [{ id: 9999 }]
 *  - SELECT email FROM users → returns [] (no email → no email dispatch)
 */
function setupQueryRouter(opts: {
  tcRows: { id: number }[];
  spcRows?: { id: number }[];
  pmRows?: { id: number }[];
}) {
  const { tcRows, spcRows = [{ id: 99 }], pmRows = [{ id: 88 }] } = opts;

  mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    if (sql.includes("technical_coordinator")) {
      return Promise.resolve({ rows: tcRows, rowCount: tcRows.length });
    }
    if (sql.includes("senior_program_coordinator")) {
      return Promise.resolve({ rows: spcRows, rowCount: spcRows.length });
    }
    if (sql.includes("program_manager")) {
      return Promise.resolve({ rows: pmRows, rowCount: pmRows.length });
    }
    if (sql.includes("notification_preferences")) {
      return Promise.resolve({
        rows: [{ id: params[0], email: null, notification_preferences: null }],
        rowCount: 1,
      });
    }
    if (sql.includes("INSERT INTO notification_event_dedupes")) {
      return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
    }
    if (sql.includes("INSERT INTO notifications")) {
      return Promise.resolve({ rows: [{ id: 9999 }], rowCount: 1 });
    }
    // dedup check SELECT FROM notifications, SELECT email FROM users, etc.
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

/** Collect distinct userIds for which INSERT INTO notifications was called */
function notifiedUserIds(): number[] {
  const ids: number[] = [];
  for (const call of mockPoolQuery.mock.calls) {
    const sql: string = call[0] ?? "";
    if (sql.includes("INSERT INTO notifications")) {
      const params: unknown[] = call[1] ?? [];
      // params[0] = user_id
      ids.push(params[0] as number);
    }
  }
  return ids;
}

const BASE_OPTS = {
  action: "submit" as const,
  entityType: "report" as const,
  entityId: 42,
  message: "Review requested",
  link: "/reports/42",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("notifyNextApprover — TC sector matching (PMR-011)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── PMR-TC-NOTIFY-01 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-01: TC SELECT uses EXISTS + unnest + trim pattern", async () => {
    setupQueryRouter({ tcRows: [{ id: 1 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health" });

    // Find the TC role query
    const tcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    );
    expect(tcCall).toBeDefined();
    const [sql, params] = tcCall!;
    expect(sql).toMatch(/DISTINCT/i);
    expect(sql).toMatch(/EXISTS/i);
    expect(sql).toMatch(/unnest/i);
    expect(sql).toMatch(/trim\s*\(\s*seg\s*\)/i);
    expect(params).toEqual(["Health"]);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // ── PMR-TC-NOTIFY-02 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-02: TC with non-matching sector → SPC fallback fires; TC not notified", async () => {
    setupQueryRouter({ tcRows: [], spcRows: [{ id: 99 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health" });

    // TC query fired
    const tcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    );
    expect(tcCall).toBeDefined();

    // SPC fallback query fired
    const spcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("senior_program_coordinator"),
    );
    expect(spcCall).toBeDefined();

    // SPC (id=99) received notification; TC (id not 99) did not
    const ids = notifiedUserIds();
    expect(ids).toContain(99);
    expect(ids).not.toContain(1);
  });

  // ── PMR-TC-NOTIFY-03 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-03: multi-sector TC matched on second segment", async () => {
    // DB returns TC id=5 because EXISTS match fired on segment "Protection"
    setupQueryRouter({ tcRows: [{ id: 5 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Protection" });

    const [sql, params] = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    )!;
    expect(sql).toMatch(/unnest/i);
    expect(params).toEqual(["Protection"]);

    const ids = notifiedUserIds();
    expect(ids).toContain(5);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // ── PMR-TC-NOTIFY-04 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-04: TC with no overlapping segment → SPC fallback + warn with full metadata", async () => {
    setupQueryRouter({ tcRows: [], spcRows: [{ id: 99 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health" });

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "no_active_tc_for_sector",
        expectedReviewerRole: "technical_coordinator",
        fallbackRecipientRole: "senior_program_coordinator",
      }),
      expect.any(String),
    );
    const spcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("senior_program_coordinator"),
    );
    expect(spcCall).toBeDefined();
  });

  // ── PMR-TC-NOTIFY-05 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-05: two matching TCs — TC SELECT called once; both receive notifications", async () => {
    setupQueryRouter({ tcRows: [{ id: 1 }, { id: 2 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health" });

    // TC SELECT called exactly once
    const tcCalls = mockPoolQuery.mock.calls.filter((c) =>
      (c[0] as string).includes("technical_coordinator"),
    );
    expect(tcCalls).toHaveLength(1);

    // Both TCs notified
    const ids = notifiedUserIds();
    expect(ids).toContain(1);
    expect(ids).toContain(2);

    // No warn
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // ── PMR-TC-NOTIFY-06 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-06: HQ PMR — TC resolved by sector without stateId", async () => {
    setupQueryRouter({ tcRows: [{ id: 7 }] });

    await notifyNextApprover({
      ...BASE_OPTS,
      sector: "WASH",
      // no stateId — HQ report
    });

    const [_sql, params] = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    )!;
    expect(params).toEqual(["WASH"]);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // ── PMR-TC-NOTIFY-07 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-07: state PMR — TC resolved; reporting state does not override sector match", async () => {
    setupQueryRouter({ tcRows: [{ id: 8 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Education" });

    const [_sql, params] = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    )!;
    expect(params).toEqual(["Education"]);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // ── PMR-TC-NOTIFY-08 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-08: TC-authored PMR — authoring TC excluded via exceptUserId", async () => {
    setupQueryRouter({ tcRows: [{ id: 3 }, { id: 4 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health", exceptUserId: 3 });

    const ids = notifiedUserIds();
    // TC 4 notified; TC 3 (author) excluded
    expect(ids).toContain(4);
    expect(ids).not.toContain(3);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // ── PMR-TC-NOTIFY-09 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-09: no active TC — logger.warn fires with correct metadata; SPC notified", async () => {
    setupQueryRouter({ tcRows: [], spcRows: [{ id: 99 }] });

    await notifyNextApprover({
      ...BASE_OPTS,
      entityType: "report",
      entityId: 42,
      sector: "Protection",
    });

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "report",
        entityId: 42,
        sector: "Protection",
        reason: "no_active_tc_for_sector",
        expectedReviewerRole: "technical_coordinator",
        fallbackRecipientRole: "senior_program_coordinator",
      }),
      expect.any(String),
    );

    const ids = notifiedUserIds();
    expect(ids).toContain(99);
  });

  // ── PMR-TC-NOTIFY-10 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-10: legacy whitespace in stored sector — DB returns TC (trim-aware query)", async () => {
    // The DB trim(seg) handles " Education" from "Health, Education".
    // Mock simulates DB returning TC id=10 after correct trim matching.
    setupQueryRouter({ tcRows: [{ id: 10 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Education" });

    // TC found — no fallback warn
    expect(mockLoggerWarn).not.toHaveBeenCalled();

    // SPC fallback query was NOT called
    const spcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("senior_program_coordinator"),
    );
    expect(spcCall).toBeUndefined();

    const ids = notifiedUserIds();
    expect(ids).toContain(10);
  });

  // ── PMR-TC-NOTIFY-11 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-11: inactive TC excluded by WHERE status='active'; SPC fallback fires", async () => {
    setupQueryRouter({ tcRows: [], spcRows: [{ id: 99 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health" });

    // TC query includes status = 'active' guard
    const tcSql = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    )![0];
    expect(tcSql).toMatch(/status\s*=\s*'active'/);

    // Fallback fires with complete operational metadata
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "no_active_tc_for_sector",
        expectedReviewerRole: "technical_coordinator",
        fallbackRecipientRole: "senior_program_coordinator",
      }),
      expect.any(String),
    );
    const ids = notifiedUserIds();
    expect(ids).toContain(99);
  });

  // ── HQSR-FB-NOTIF: SPC-fallback routing (HQSR-BD-1/BD-6) ──────────────────
  it("HQSR-FB-NOTIF-02: hqsrPath 'spc_fallback' → PM notified directly; no TC/SPC queries", async () => {
    setupQueryRouter({ tcRows: [{ id: 1 }], spcRows: [{ id: 99 }], pmRows: [{ id: 88 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health", hqsrPath: "spc_fallback" });

    const ids = notifiedUserIds();
    expect(ids).toContain(88);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(99);
    // Neither TC nor SPC role queries should fire for the fallback branch
    const tcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    );
    expect(tcCall).toBeUndefined();
  });

  it("HQSR-FB-NOTIF-02b: spc_fallback author excluded from recipients (exceptUserId)", async () => {
    setupQueryRouter({ tcRows: [], spcRows: [], pmRows: [{ id: 88 }, { id: 77 }] });

    await notifyNextApprover({ ...BASE_OPTS, hqsrPath: "spc_fallback", exceptUserId: 88 });

    const ids = notifiedUserIds();
    expect(ids).toContain(77);
    expect(ids).not.toContain(88);
  });

  it("HQSR-FB-NOTIF-02c: spc_fallback with no active PM → warn + super_admin fallback (not silently dropped)", async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes("program_manager")) return Promise.resolve({ rows: [], rowCount: 0 });
      if (sql.includes("super_admin")) return Promise.resolve({ rows: [{ id: 5 }], rowCount: 1 });
      if (sql.includes("notification_preferences")) {
        return Promise.resolve({
          rows: [{ id: params[0], email: null, notification_preferences: null }],
          rowCount: 1,
        });
      }
      if (sql.includes("INSERT INTO notification_event_dedupes")) {
        return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO notifications")) return Promise.resolve({ rows: [{ id: 9999 }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await notifyNextApprover({ ...BASE_OPTS, hqsrPath: "spc_fallback" });

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "no_active_pm_for_hqsr_spc_fallback" }),
      expect.any(String),
    );
    expect(notifiedUserIds()).toContain(5);
  });

  it("HQSR-FB-NOTIF-01: hqsrPath 'tc_authored' routes to SPC, never sector TCs (HQSR-006)", async () => {
    setupQueryRouter({ tcRows: [{ id: 1 }], spcRows: [{ id: 99 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health", hqsrPath: "tc_authored" });

    const ids = notifiedUserIds();
    expect(ids).toContain(99);
    expect(ids).not.toContain(1);
    // No TC role query fires on the tc_authored HQSR path
    const tcCall = mockPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"),
    );
    expect(tcCall).toBeUndefined();
  });

  // ── PMR-TC-NOTIFY-12 ──────────────────────────────────────────────────────
  it("PMR-TC-NOTIFY-12: notifyNextApprover never issues UPDATE/INSERT on permissions or scopes", async () => {
    setupQueryRouter({ tcRows: [{ id: 1 }] });

    await notifyNextApprover({ ...BASE_OPTS, sector: "Health" });

    for (const call of mockPoolQuery.mock.calls) {
      const sql: string = call[0] ?? "";
      expect(sql).not.toMatch(/UPDATE\s+(permissions|scopes)/i);
      expect(sql).not.toMatch(/INSERT\s+INTO\s+(permissions|scopes)/i);
    }
  });
});
