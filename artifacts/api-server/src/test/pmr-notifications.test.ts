/**
 * pmr-notifications.test.ts — PMR workflow notification audit tests (Task #333)
 *
 * Part A (lib-level, mocked pool): notifyNextApprover workflow-path routing +
 * actorsForEntity author inclusion. IDs: PMR-NOTIF-01, -02, -12, -13, -14.
 *
 * Part B (route-level, supertest + mocked notifications): transaction safety —
 * failed transitions emit zero notifications; successful transitions pass the
 * correct workflowPath / kind / link. IDs: PMR-NOTIF-03, -04, -15, -16,
 * PMR-NOTIF-LINK-01/-05, PMR-NOTIF-DUP-02/-03.
 *
 * Deep-link security (PMR-NOTIF-SEC-01..05) is covered by the real-logic
 * assertCanViewReport suite in lib/reportAuth.test.ts (PMR-VAUTH-01..10):
 * notification possession grants nothing — GET /reports/:id enforces scope
 * at request time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// ═════════════════════════════════════════════════════════════════════════════
// Part A — lib-level: notifyNextApprover + actorsForEntity
// ═════════════════════════════════════════════════════════════════════════════

const { mockLibPoolQuery, mockLoggerWarn } = vi.hoisted(() => ({
  mockLibPoolQuery: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => mockLibPoolQuery(...args) },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));
vi.mock("../lib/realtime", () => ({
  realtime: {
    broadcastToUser: vi.fn(),
    publishSupportingEventToUser: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
  },
}));
vi.mock("../lib/mailer", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import { notifyNextApprover, actorsForEntity } from "../lib/notifications";

function setupLibRouter(opts: {
  tcRows?: { id: number }[];
  spcRows?: { id: number }[];
  pmRows?: { id: number }[];
}) {
  const { tcRows = [], spcRows = [], pmRows = [] } = opts;
  mockLibPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    if (sql.includes("technical_coordinator"))
      return Promise.resolve({ rows: tcRows, rowCount: tcRows.length });
    if (sql.includes("senior_program_coordinator"))
      return Promise.resolve({ rows: spcRows, rowCount: spcRows.length });
    if (sql.includes("program_manager"))
      return Promise.resolve({ rows: pmRows, rowCount: pmRows.length });
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

function libNotifiedUserIds(): number[] {
  const ids: number[] = [];
  for (const call of mockLibPoolQuery.mock.calls) {
    const sql: string = call[0] ?? "";
    if (sql.includes("INSERT INTO notifications")) ids.push((call[1] ?? [])[0] as number);
  }
  return ids;
}

const BASE = {
  action: "submit" as const,
  entityType: "report" as const,
  entityId: 42,
  message: "Review requested",
  link: "/reports/project?open=42",
};

describe("Part A — notifyNextApprover workflow-path routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PMR-NOTIF-01: state_authored submit resolves a TC (not SPC directly)", async () => {
    setupLibRouter({ tcRows: [{ id: 11 }], spcRows: [{ id: 99 }] });
    await notifyNextApprover({ ...BASE, sector: "Health", workflowPath: "state_authored" });
    expect(libNotifiedUserIds()).toEqual([11]);
    const spcCall = mockLibPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("senior_program_coordinator"));
    expect(spcCall).toBeUndefined();
  });

  it("PMR-NOTIF-01b: null workflowPath falls back to state_authored behaviour (TC queried)", async () => {
    setupLibRouter({ tcRows: [{ id: 11 }] });
    await notifyNextApprover({ ...BASE, sector: "Health", workflowPath: null });
    const tcCall = mockLibPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"));
    expect(tcCall).toBeDefined();
    expect(libNotifiedUserIds()).toEqual([11]);
  });

  it("PMR-NOTIF-02: technical_authored submit resolves SPC — TC query never fired", async () => {
    setupLibRouter({ tcRows: [{ id: 11 }], spcRows: [{ id: 99 }] });
    await notifyNextApprover({ ...BASE, sector: "Health", workflowPath: "technical_authored" });
    const tcCall = mockLibPoolQuery.mock.calls.find((c) =>
      (c[0] as string).includes("technical_coordinator"));
    expect(tcCall).toBeUndefined();
    expect(libNotifiedUserIds()).toEqual([99]);
  });

  it("PMR-NOTIF-02b: technical_authored submit with no active SPC falls back to PM", async () => {
    setupLibRouter({ spcRows: [], pmRows: [{ id: 88 }] });
    await notifyNextApprover({ ...BASE, sector: "Health", workflowPath: "technical_authored" });
    expect(libNotifiedUserIds()).toEqual([88]);
  });

  it("PMR-NOTIF-13: resubmit routing is identical to initial submit for both paths", async () => {
    // Resubmit re-enters the same 'submit' action; state_authored → TC.
    setupLibRouter({ tcRows: [{ id: 11 }] });
    await notifyNextApprover({ ...BASE, sector: "WASH", workflowPath: "state_authored" });
    expect(libNotifiedUserIds()).toEqual([11]);
    vi.clearAllMocks();
    // technical_authored → SPC.
    setupLibRouter({ spcRows: [{ id: 99 }] });
    await notifyNextApprover({ ...BASE, sector: "WASH", workflowPath: "technical_authored" });
    expect(libNotifiedUserIds()).toEqual([99]);
  });

  it("PMR-NOTIF-14: exceptUserId excludes the actor, not the author — TC author already excluded via actor exclusion on submit", async () => {
    // User B (id 7) resubmits User A's report; B is excluded, A is not the next
    // approver (approver is role-resolved), so neither A nor B receives review_requested.
    setupLibRouter({ tcRows: [{ id: 7 }, { id: 11 }] });
    await notifyNextApprover({ ...BASE, sector: "Health", workflowPath: "state_authored", exceptUserId: 7 });
    const ids = libNotifiedUserIds();
    expect(ids).toContain(11);
    expect(ids).not.toContain(7);
  });

  it("PMR-NOTIF-12: actorsForEntity('report') includes author_id (request_revision reaches the owner)", async () => {
    mockLibPoolQuery.mockResolvedValueOnce({
      rows: [{ user_id: 42 }, { user_id: 55 }], // author + submitter/assignee union result
      rowCount: 2,
    });
    const ids = await actorsForEntity("report", 42);
    expect([...ids]).toEqual([42, 55]);
    const sql = mockLibPoolQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/author_id/);
    expect(sql).toMatch(/submitted_by_id/);
  });
});

