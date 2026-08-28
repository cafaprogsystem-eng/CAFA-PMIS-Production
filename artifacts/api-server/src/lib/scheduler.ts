import {
  startAttachmentUploadExpirySweep,
  stopAttachmentUploadExpirySweep,
} from "./attachmentReconciliation";
import { startDueDateChecker, stopDueDateChecker } from "./due-date-checker";
import { startIdempotencyPruner, stopIdempotencyPruner } from "../middlewares/idempotency";
import { logger } from "./logger";
import { evaluateMonthlyReportingDeadlines } from "./monthly-reporting-deadline";
import { monthlyReportingConfig } from "./monthly-reporting-config";
import { assertMonthlyReminderMailerConfiguration } from "./mailer";

let started = false;
let monthlyTimer: NodeJS.Timeout | null = null;
let monthlyRun: Promise<unknown> | null = null;

function startMonthlyReportingScheduler(env: NodeJS.ProcessEnv): void {
  const config = monthlyReportingConfig(env);
  if (!config.enabled) return;
  const run = () => {
    if (monthlyRun) return;
    monthlyRun = evaluateMonthlyReportingDeadlines(new Date(), config)
      .catch((error) => logger.warn({ error }, "Monthly reporting scheduler failed"))
      .finally(() => { monthlyRun = null; });
  };
  run();
  monthlyTimer = setInterval(run, config.pollMs);
  monthlyTimer.unref?.();
}

async function stopMonthlyReportingScheduler(): Promise<void> {
  if (monthlyTimer) clearInterval(monthlyTimer);
  monthlyTimer = null;
  await monthlyRun;
}

export function schedulerEnabled(env = process.env): boolean {
  const configured = env.SCHEDULER_ENABLED;
  if (configured == null || configured === "") return env.NODE_ENV !== "production";
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error("SCHEDULER_ENABLED must be exactly true or false.");
}

export function startSchedulers(env = process.env): boolean {
  if (!schedulerEnabled(env)) {
    logger.info("Recurring scheduler is disabled for this API process");
    return false;
  }
  if (started) return true;
  const monthlyConfig = monthlyReportingConfig(env);
  if (monthlyConfig.enabled) {
    // Validate before any scheduler starts so unsupported mail transports cannot
    // leave this process partially running while monthly email silently fails.
    assertMonthlyReminderMailerConfiguration(env);
  }
  startDueDateChecker();
  startAttachmentUploadExpirySweep();
  startIdempotencyPruner();
  startMonthlyReportingScheduler(env);
  started = true;
  logger.info("Recurring scheduler started");
  return true;
}

export async function stopSchedulers(): Promise<void> {
  if (!started) return;
  // Clear every timer before waiting so shutdown cannot enqueue new work.
  await Promise.all([
    stopDueDateChecker(),
    stopAttachmentUploadExpirySweep(),
    stopIdempotencyPruner(),
    stopMonthlyReportingScheduler(),
  ]);
  started = false;
  logger.info("Recurring scheduler stopped");
}

export function schedulerStarted(): boolean {
  return started;
}