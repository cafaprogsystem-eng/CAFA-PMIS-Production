import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query } }));

import {
  monthlyReportingDeliveryInternals,
  resolveMonthlyReminderRecipientIds,
  type MonthlyObligation,
} from "./monthly-reporting-deadline";
import { monthlyReportingConfig } from "./monthly-reporting-config";

const stateProject: MonthlyObligation = {
  key: "project:41:state:7:2026-7",
  scopeKey: "project:41:state:7",
  reportType: "project",
  projectId: 41,
  stateId: 7,
  reporting: { year: 2026, month: 7 },
  status: "not_started",
};

describe("monthly reporting recipient governance", () => {
  beforeEach(() => query.mockReset());

  it("routes a State Project obligation only through active exact-State SPO assignments", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 19 }, { id: 23 }] });

    await expect(resolveMonthlyReminderRecipientIds(stateProject)).resolves.toEqual([19, 23]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("u.status='active'");
    expect(sql).toContain("u.state_id=$1");
    expect(sql).toContain("u.role='state_program_officer'");
    expect(sql).toContain("FROM project_assignments pa");
    expect(sql).toContain("pa.project_id=$2 AND pa.user_id=u.id");
    expect(params).toEqual([7, 41]);
  });

  it("returns no State Project recipient when no exact-State SPO is assigned", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(resolveMonthlyReminderRecipientIds(stateProject)).resolves.toEqual([]);
  });

  it("keeps the SPO/SOM vacancy fallback limited to State Programme obligations", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 31 }] });
    const stateProgramme: MonthlyObligation = {
      key: "program-state:state:7:2026-7",
      scopeKey: "state:7",
      reportType: "program_state",
      stateId: 7,
      reporting: { year: 2026, month: 7 },
      status: "draft",
    };

    await expect(resolveMonthlyReminderRecipientIds(stateProgramme)).resolves.toEqual([31]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("u.role='state_office_manager'");
    expect(sql).toContain("AND $2::integer IS NULL");
    expect(sql).toContain("NOT EXISTS");
    expect(params).toEqual([7, null]);
  });

  it("never adds routine programme-manager or super-admin recipients", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 44 }] });
    const hqSector: MonthlyObligation = {
      key: "hq-sector:sector:Health:2026-7",
      scopeKey: "sector:Health",
      reportType: "hq_sector",
      sector: "Health",
      reporting: { year: 2026, month: 7 },
      status: "not_started",
    };
    await expect(resolveMonthlyReminderRecipientIds(hqSector)).resolves.toEqual([44]);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("role='technical_coordinator'");
    expect(sql).toContain("role='senior_program_coordinator'");
    expect(sql).not.toContain("program_manager");
    expect(sql).not.toContain("super_admin");
  });
});

describe("monthly reporting durable delivery claims", () => {
  beforeEach(() => query.mockReset());

  it("claims each channel identity only when pending, retryable, or expired", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 71 }] });
    const result = await monthlyReportingDeliveryInternals.claim(
      stateProject,
      19,
      "email",
      3,
      monthlyReportingConfig({}),
    );
    expect(result?.id).toBe(71);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("status IN ('pending','failed')");
    expect(sql).toContain("lease_expires_at < NOW()");
    expect(sql).toContain("attempt_count < $11");
    expect(sql).toContain("next_attempt_at <= NOW()");
    expect(params).toEqual(expect.arrayContaining(["email", 3, 3]));
  });

  it("does not let a stale worker settle a lease it no longer owns", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      monthlyReportingDeliveryInternals.settle(
        71,
        "stale-token",
        "sent",
        { channel: "email" },
        monthlyReportingConfig({}),
      ),
    ).rejects.toThrow(/lease was lost/);
    expect(query.mock.calls[0][0]).toContain("WHERE id=$1 AND lease_token=$2");
  });

  it("dead-letters bounded failures and preserves channel-independent settlement", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await monthlyReportingDeliveryInternals.settle(
      71,
      "owned-token",
      "failed",
      { error: "transient" },
      monthlyReportingConfig({ MONTHLY_REPORTING_RETRY_LIMIT: "3" }),
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("attempt_count+1 >= $7 THEN 'dead_letter'");
    expect(sql).toContain("lease_token=NULL");
    expect(params).toEqual(expect.arrayContaining(["failed", 3]));
  });
});