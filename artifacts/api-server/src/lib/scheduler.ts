import {
  startAttachmentUploadExpirySweep,
  stopAttachmentUploadExpirySweep,
} from "./attachmentReconciliation";
import { startDueDateChecker, stopDueDateChecker } from "./due-date-checker";
import { startIdempotencyPruner, stopIdempotencyPruner } from "../middlewares/idempotency";
import { logger } from "./logger";

let started = false;

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
  startDueDateChecker();
  startAttachmentUploadExpirySweep();
  startIdempotencyPruner();
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
  ]);
  started = false;
  logger.info("Recurring scheduler stopped");
}

export function schedulerStarted(): boolean {
  return started;
}