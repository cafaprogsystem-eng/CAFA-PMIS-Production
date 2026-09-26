/**
 * Ported from artifacts/api-server/src/lib/reportConstants.ts — only the
 * scheduled-frequency constant that projects.ts's create/update routes need.
 * The rest of that file (canonical report types/statuses, workflow tables via
 * @workspace/report-transitions) belongs to reports.ts, not yet ported.
 */

/**
 * Scheduled project reporting frequencies (Task #325 / Model D).
 * The set of values allowed for projects.reporting_frequency.
 * 'on_demand' is deliberately EXCLUDED: on-demand reports are supplementary
 * and never a project's scheduled cycle.
 */
export const SCHEDULED_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export type ScheduledFrequency = (typeof SCHEDULED_FREQUENCIES)[number];
