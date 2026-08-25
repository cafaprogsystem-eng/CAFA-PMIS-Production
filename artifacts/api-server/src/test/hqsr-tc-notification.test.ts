/**
 * HQSR-006 — TC-authored HQ Sector Report submit notification routing tests
 * (HQSR-NOTIF-01 … HQSR-NOTIF-18 subset that lives at the notifyNextApprover level)
 *
 * TC-authored hq_sector submits (hqsrPath "tc_authored", covering both new
 * reports and historical workflow_path = NULL rows) must notify SPC — never
 * sector TCs. When no active SPC exists, fall back to PM with a structured
 * warning. The SPC-fallback → PM path from #363 is regression-covered here too.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPoolQuery, mockLoggerWarn } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));

vi.mock("../lib/realtime", () => ({
  realtime: { broadcastToUser: vi.fn(), publishSupportingEventToUser: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../lib/mailer", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { notifyNextApprover } from "../lib/notifications";

const TC_AUTHOR = 11;
const OTHER_TC_SAME_SECTOR = 12;
const OTHER_TC_DIFF_SECTOR = 13;
const SPC_1 = 21;
const SPC_2 = 22;
const PM_1 = 31;
const SA_1 = 41;

function setupQueryRouter(opts: {
  tcRows?: { id: number }[];
  spcRows?: { id: number }[];
  pmRows?: { id: number }[];
  saRows?: { id: number }[];
}) {
  const {
    tcRows = [{ id: OTHER_TC_SAME_SECTOR }],
    spcRows = [{ id: SPC_1 }],
    pmRows = [{ id: PM_1 }],
    saRows = [{ id: SA_1 }],
  } = opts;
  mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    if (sql.includes("technical_coordinator"))
      return Promise.resolve({ rows: tcRows, rowCount: tcRows.length });
    if (sql.includes("senior_program_coordinator"))
      return Promise.resolve({ rows: spcRows, rowCount: spcRows.length });
    if (sql.includes("program_manager"))
      return Promise.resolve({ rows: pmRows, rowCount: pmRows.length });
    if (sql.includes("super_admin"))
      return Promise.resolve({ rows: saRows, rowCount: saRows.length });
    if (sql.includes("notification_preferences"))
      return Promise.resolve({
        rows: [{ id: params[0], email: null, notification_preferences: null }],
        rowCount: 1,
      });
    if (sql.includes("INSERT INTO notification_event_dedupes"))
      return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
    if (sql.includes("INSERT INTO notifications"))
      return Promise.resolve({ rows: [{ id: 9999 }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function notifiedUserIds(): number[] {
  const ids: number[] = [];
  for (const call of mockPoolQuery.mock.calls) {
    const sql: string = call[0] ?? "";
    if (sql.includes("INSERT INTO notifications")) ids.push((call[1] ?? [])[0] as number);
  }
  return ids;
}

function tcQueryCalls() {
  return mockPoolQuery.mock.calls.filter((c) =>
    (c[0] as string).includes("technical_coordinator"),
  );
}

const BASE = {
  action: "submit" as const,
  entityType: "report" as const,
  entityId: 7,
  sector: "WASH",
  workflowPath: null,
  message: "Review requested",
  link: "/reports/7",
  exceptUserId: TC_AUTHOR,
};

describe("HQSR-006 — TC-authored hq_sector submit routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("HQSR-NOTIF-01/03/04: TC-authored submit notifies SPC only; no TC query at all", async () => {
    setupQueryRouter({ tcRows: [{ id: OTHER_TC_SAME_SECTOR }, { id: OTHER_TC_DIFF_SECTOR }] });
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored" });
    expect(tcQueryCalls()).toHaveLength(0);
    const ids = notifiedUserIds();
    expect(ids).toEqual([SPC_1]);
    expect(ids).not.toContain(OTHER_TC_SAME_SECTOR);
    expect(ids).not.toContain(OTHER_TC_DIFF_SECTOR);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it("HQSR-NOTIF-02: author excluded when author is themselves an SPC-role match edge (exceptUserId honoured)", async () => {
    setupQueryRouter({ spcRows: [{ id: TC_AUTHOR }, { id: SPC_1 }] });
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored" });
    const ids = notifiedUserIds();
    expect(ids).toEqual([SPC_1]);
    expect(ids).not.toContain(TC_AUTHOR);
  });

  it("HQSR-NOTIF-05/18: multiple active SPCs → all notified exactly once each", async () => {
    setupQueryRouter({ spcRows: [{ id: SPC_1 }, { id: SPC_2 }] });
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored" });
    const ids = notifiedUserIds();
    expect(ids.sort()).toEqual([SPC_1, SPC_2]);
    expect(ids.filter((i) => i === SPC_1)).toHaveLength(1);
    expect(ids.filter((i) => i === SPC_2)).toHaveLength(1);
  });

  it("HQSR-NOTIF-09/10: no active SPC → PM fallback with structured warning", async () => {
    setupQueryRouter({ spcRows: [] });
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored" });
    const ids = notifiedUserIds();
    expect(ids).toEqual([PM_1]);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "no_active_spc",
        expectedReviewerRole: "senior_program_coordinator",
        fallbackRecipientRole: "program_manager",
      }),
      expect.any(String),
    );
  });

  it("HQSR-NOTIF-11: active SPC exists → PM NOT notified", async () => {
    setupQueryRouter({});
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored" });
    expect(notifiedUserIds()).not.toContain(PM_1);
  });

  it("HQSR-NOTIF-12/14: historical NULL workflow_path (call site maps to tc_authored) → SPC on resubmit too", async () => {
    setupQueryRouter({});
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored", workflowPath: null });
    await notifyNextApprover({ ...BASE, hqsrPath: "tc_authored", workflowPath: null });
    const ids = notifiedUserIds();
    expect(new Set(ids)).toEqual(new Set([SPC_1]));
    expect(tcQueryCalls()).toHaveLength(0);
  });
});

describe("HQSR-006 — #363 SPC-fallback → PM regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("HQSR-NOTIF-06/07/08/13/15: spc_fallback submit notifies PM only, author excluded, no TCs", async () => {
    setupQueryRouter({});
    await notifyNextApprover({ ...BASE, hqsrPath: "spc_fallback", exceptUserId: SPC_1 });
    const ids = notifiedUserIds();
    expect(ids).toEqual([PM_1]);
    expect(ids).not.toContain(SPC_1);
    expect(tcQueryCalls()).toHaveLength(0);
  });

  it("spc_fallback with no active PM → super_admin fallback (unchanged from #363)", async () => {
    setupQueryRouter({ pmRows: [] });
    await notifyNextApprover({ ...BASE, hqsrPath: "spc_fallback", exceptUserId: SPC_1 });
    expect(notifiedUserIds()).toEqual([SA_1]);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
  });
});

describe("HQSR-006 — cross-report regression (hqsrPath absent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("HQSR-NOTIF-XR-01: PMR state-authored routing still resolves sector TC", async () => {
    setupQueryRouter({});
    await notifyNextApprover({ ...BASE, hqsrPath: null, workflowPath: "state_authored" });
    expect(notifiedUserIds()).toEqual([OTHER_TC_SAME_SECTOR]);
  });

  it("HQSR-NOTIF-XR-02: technical_authored (PMR/Activity TC-authored) still routes to SPC", async () => {
    setupQueryRouter({});
    await notifyNextApprover({ ...BASE, workflowPath: "technical_authored" });
    expect(notifiedUserIds()).toEqual([SPC_1]);
  });

  it("HQSR-NOTIF-XR-03: program_state simple-chain (no sector, no hqsrPath) → SPC", async () => {
    setupQueryRouter({});
    await notifyNextApprover({ ...BASE, sector: null, hqsrPath: null });
    expect(notifiedUserIds()).toEqual([SPC_1]);
  });
});
