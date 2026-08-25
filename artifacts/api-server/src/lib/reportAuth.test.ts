/**
 * reportAuth.test.ts — Real-logic unit tests for assertCanViewReport (spec §32).
 *
 * Gap-closure for PMR-024 final regression audit (Task #317):
 * every route-level test (att02-hardening, path-hardening) MOCKS
 * assertCanViewReport, so the actual state-scope / sector-scope logic in
 * lib/reportAuth.ts had no direct coverage. These tests exercise the real
 * function with only the DB pool mocked.
 *
 * IDs: PMR-VAUTH-01 .. PMR-VAUTH-08
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock only the DB pool; assertSectorAllowed runs for real ────────────────
const mockPoolQuery = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

const { assertCanViewReport } = await import("./reportAuth.js");

type AnyReq = Parameters<typeof assertCanViewReport>[0];

function reqFor(user: Partial<{
  id: number; role: string; stateId: number | null;
  sector: string | null; sectors: string[] | null;
}>): AnyReq {
  return {
    currentUser: {
      id: 1, name: "T", email: "t@x", roleLabel: "", scope: "",
      stateName: null, avatarUrl: null,
      stateId: null, sector: null, sectors: null, role: "project_manager",
      ...user,
    },
  } as unknown as AnyReq;
}

/** First query: getReportSectorForAuth row. */
function sectorRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    rows: [{
      reportType: "project", projectId: 10,
      projectSector: "Health", activitySector: null, effectiveSector: "Health",
      ...over,
    }],
  };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe("assertCanViewReport — real logic (PMR-VAUTH)", () => {
  it("PMR-VAUTH-01: report not found → 404", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const res = await assertCanViewReport(reqFor({ role: "state_program_officer", stateId: 5 }), 999);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it("PMR-VAUTH-02: SPO cross-state report → 403 state_scope_forbidden", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(sectorRow())
      .mockResolvedValueOnce({ rows: [{ state_id: 7 }] }); // report belongs to state 7
    const res = await assertCanViewReport(reqFor({ role: "state_program_officer", stateId: 5 }), 1);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "state_scope_forbidden" });
    }
  });

  it("PMR-VAUTH-03: SOM cross-state report → 403 state_scope_forbidden", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(sectorRow())
      .mockResolvedValueOnce({ rows: [{ state_id: 2 }] });
    const res = await assertCanViewReport(reqFor({ role: "state_office_manager", stateId: 9 }), 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.body).toEqual({ error: "state_scope_forbidden" });
  });

  it("PMR-VAUTH-04: SPO same-state report → ok", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(sectorRow())
      .mockResolvedValueOnce({ rows: [{ state_id: 5, project_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ project_id: 10 }], rowCount: 1 });
    const res = await assertCanViewReport(reqFor({ role: "state_program_officer", stateId: 5 }), 1);
    expect(res.ok).toBe(true);
  });

  it("PMR-VAUTH-11: an SPO cannot deep-link to an unassigned project report in their state", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(sectorRow())
      .mockResolvedValueOnce({ rows: [{ state_id: 5, project_id: 10 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await assertCanViewReport(reqFor({ role: "state_program_officer", stateId: 5 }), 1);
    expect(res).toEqual({
      ok: false,
      status: 403,
      body: { error: "state_scope_forbidden" },
    });
  });

  it("PMR-VAUTH-05: state-less (HQ) report + state role → 403 fail-closed", async () => {
    mockPoolQuery
      .mockResolvedValueOnce(sectorRow())
      .mockResolvedValueOnce({ rows: [{ state_id: null }] });
    const res = await assertCanViewReport(reqFor({ role: "state_program_officer", stateId: 5 }), 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.body).toEqual({ error: "state_scope_forbidden" });
  });

  it("PMR-VAUTH-06: TC out-of-sector report → 403 sector_forbidden", async () => {
    mockPoolQuery.mockResolvedValueOnce(sectorRow({ projectSector: "Health", effectiveSector: "Health" }));
    const res = await assertCanViewReport(
      reqFor({ role: "technical_coordinator", sectors: ["Education"] }), 1,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "sector_forbidden" });
    }
  });

  it("PMR-VAUTH-07: TC with empty sectors list → 403 fail-closed (no unrestricted fallback)", async () => {
    mockPoolQuery.mockResolvedValueOnce(sectorRow());
    const res = await assertCanViewReport(
      reqFor({ role: "technical_coordinator", sectors: [] }), 1,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.body).toEqual({ error: "sector_forbidden" });
  });

  it("PMR-VAUTH-09: SPO with no assigned state (stateId=null) → 403 fail-closed", async () => {
    mockPoolQuery.mockResolvedValueOnce(sectorRow());
    const res = await assertCanViewReport(reqFor({ role: "state_program_officer", stateId: null }), 1);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "state_scope_forbidden" });
    }
    // Only the sector lookup ran — denial happens before the state query
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("PMR-VAUTH-10: SOM with no assigned state (stateId=null) → 403 fail-closed", async () => {
    mockPoolQuery.mockResolvedValueOnce(sectorRow());
    const res = await assertCanViewReport(reqFor({ role: "state_office_manager", stateId: null }), 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.body).toEqual({ error: "state_scope_forbidden" });
  });

  it("PMR-VAUTH-08: org-wide role (PM) passes with no state/sector queries beyond lookup", async () => {
    mockPoolQuery.mockResolvedValueOnce(sectorRow());
    const res = await assertCanViewReport(reqFor({ role: "project_manager" }), 1);
    expect(res.ok).toBe(true);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1); // no state-scope query for non-state roles
  });
});
