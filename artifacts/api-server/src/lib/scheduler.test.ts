import { afterEach, describe, expect, it, vi } from "vitest";

const due = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }));
const cleanup = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }));
const idem = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }));
const monthly = vi.hoisted(() => ({ evaluate: vi.fn().mockResolvedValue({ evaluated: 0, delivered: 0 }) }));

vi.mock("./due-date-checker", () => ({
  startDueDateChecker: due.start,
  stopDueDateChecker: due.stop,
}));
vi.mock("./attachmentReconciliation", () => ({
  startAttachmentUploadExpirySweep: cleanup.start,
  stopAttachmentUploadExpirySweep: cleanup.stop,
}));
vi.mock("../middlewares/idempotency", () => ({
  startIdempotencyPruner: idem.start,
  stopIdempotencyPruner: idem.stop,
}));
vi.mock("./monthly-reporting-deadline", () => ({
  evaluateMonthlyReportingDeadlines: monthly.evaluate,
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn() } }));

const scheduler = await import("./scheduler");

afterEach(async () => {
  await scheduler.stopSchedulers();
  vi.clearAllMocks();
});

describe("scheduler ownership", () => {
  it("is disabled by default in production and requires explicit enablement", () => {
    expect(scheduler.schedulerEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(scheduler.schedulerEnabled({ NODE_ENV: "production", SCHEDULER_ENABLED: "true" })).toBe(true);
    expect(() => scheduler.schedulerEnabled({ SCHEDULER_ENABLED: "yes" })).toThrow(/exactly true or false/);
  });

  it("registers each job once and stops all work safely", async () => {
    expect(scheduler.startSchedulers({ NODE_ENV: "production", SCHEDULER_ENABLED: "true" })).toBe(true);
    scheduler.startSchedulers({ NODE_ENV: "production", SCHEDULER_ENABLED: "true" });
    expect(due.start).toHaveBeenCalledTimes(1);
    expect(cleanup.start).toHaveBeenCalledTimes(1);
    expect(idem.start).toHaveBeenCalledTimes(1);
    expect(monthly.evaluate).toHaveBeenCalledTimes(1);
    await scheduler.stopSchedulers();
    expect(due.stop).toHaveBeenCalledTimes(1);
    expect(cleanup.stop).toHaveBeenCalledTimes(1);
    expect(idem.stop).toHaveBeenCalledTimes(1);
  });

  it("refuses to start any scheduler when monthly email transport lacks idempotency", () => {
    expect(() =>
      scheduler.startSchedulers({
        NODE_ENV: "production",
        SCHEDULER_ENABLED: "true",
        MONTHLY_REPORTING_ENABLED: "true",
        EMAIL_ENABLED: "true",
        EMAIL_PROVIDER: "smtp",
      }),
    ).toThrow(/EMAIL_PROVIDER=resend/);
    expect(due.start).not.toHaveBeenCalled();
    expect(cleanup.start).not.toHaveBeenCalled();
    expect(idem.start).not.toHaveBeenCalled();
    expect(monthly.evaluate).not.toHaveBeenCalled();
  });
});