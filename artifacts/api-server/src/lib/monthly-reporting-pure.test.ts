import { describe, expect, it } from "vitest";
import { monthlyReportingConfig } from "./monthly-reporting-config";
import { projectCoverageOverlapsMonth } from "./project-reporting-coverage";
import {
  assertMonthlyReminderMailerConfiguration,
  mailerSupportsIdempotentDelivery,
} from "./mailer";
import {
  classifyMonthlyObligation,
  latestApplicableStage,
  monthlyReminderCopy,
  previousKhartoumMonth,
} from "./monthly-reporting-deadline";

describe("monthly reporting pure boundaries", () => {
  it("uses the Khartoum deadline defaults and rejects malformed environment values", () => {
    expect(monthlyReportingConfig({})).toMatchObject({
      enabled: true,
      timezone: "Africa/Khartoum",
      businessHour: "09:00",
      dueDay: 3,
      stageDays: [1, 3, 4, 6],
    });
    expect(() =>
      monthlyReportingConfig({ MONTHLY_REPORTING_STAGE_DAYS: "3,1" }),
    ).toThrow(/ascending/);
    expect(() => monthlyReportingConfig({ MONTHLY_REPORTING_ENABLED: "1" })).toThrow(
      /exactly/,
    );
  });

  it("fails startup configuration closed for non-idempotent external mail transports", () => {
    expect(mailerSupportsIdempotentDelivery({ EMAIL_ENABLED: "false", EMAIL_PROVIDER: "smtp" })).toBe(true);
    expect(mailerSupportsIdempotentDelivery({ EMAIL_ENABLED: "true", EMAIL_PROVIDER: "resend" })).toBe(true);
    expect(mailerSupportsIdempotentDelivery({ EMAIL_ENABLED: "true", EMAIL_PROVIDER: "sendgrid" })).toBe(false);
    expect(mailerSupportsIdempotentDelivery({ EMAIL_ENABLED: "true", EMAIL_PROVIDER: "smtp" })).toBe(false);
    expect(() =>
      assertMonthlyReminderMailerConfiguration({
        EMAIL_ENABLED: "true",
        EMAIL_PROVIDER: "sendgrid",
      }),
    ).toThrow(/EMAIL_PROVIDER=resend/);
    expect(() =>
      assertMonthlyReminderMailerConfiguration({
        EMAIL_ENABLED: "true",
        EMAIL_PROVIDER: "smtp",
      }),
    ).toThrow(/crash-safe idempotency/);
  });

  it("treats reporting coverage endpoints as inclusive", () => {
    expect(
      projectCoverageOverlapsMonth("2025-01-31", "2025-02-01", {
        year: 2025,
        month: 1,
      }),
    ).toBe(true);
    expect(
      projectCoverageOverlapsMonth("2025-01-31", "2025-02-01", {
        year: 2025,
        month: 2,
      }),
    ).toBe(true);
    expect(
      projectCoverageOverlapsMonth("2025-01-31", "2025-02-01", {
        year: 2025,
        month: 3,
      }),
    ).toBe(false);
  });

  it("classifies report workflow progress and catches up to the latest stage", () => {
    expect(classifyMonthlyObligation([])).toBe("not_started");
    expect(classifyMonthlyObligation(["draft"])).toBe("draft");
    expect(classifyMonthlyObligation(["submitted"])).toBe("suppressed");
    expect(classifyMonthlyObligation(["technically_approved"])).toBe("suppressed");
    expect(classifyMonthlyObligation(["approved"])).toBe("complete");
    expect(latestApplicableStage([1, 3, 4, 6], 5)).toBe(4);
    expect(monthlyReminderCopy(4, 3, "revision_required", "2026-07")).toMatchObject({
      subject: "Overdue monthly report",
      message: expect.stringContaining("requires revision"),
    });
  });

  it("handles January rollover in the configured timezone", () => {
    expect(previousKhartoumMonth(new Date("2026-01-01T00:00:00Z"))).toEqual({
      year: 2025,
      month: 12,
    });
  });
});