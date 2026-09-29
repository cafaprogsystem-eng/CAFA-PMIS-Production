import type { TFunction } from "i18next";

/**
 * Display label for a report-form option whose stored value is English text
 * (activity statuses, support types, priorities, document types…). The stored
 * value never changes; only what the reader sees is translated.
 */
export function optionLabel(t: TFunction, group: string, value: string): string {
  if (!value) return value;
  return t(`formOptions.${group}.${value}`, { ns: "reports", defaultValue: value });
}

/** Risk severity / level → HeroUI Chip colour. */
export function severityColor(level: string): "danger" | "warning" | "default" {
  const l = level.toLowerCase();
  return l === "critical" || l === "high" ? "danger" : l === "medium" ? "warning" : "default";
}

/** Translated risk severity (low / medium / high / critical). */
export function severityText(t: TFunction, level: string): string {
  return t(`levels.${level.toLowerCase()}`, { ns: "risks", defaultValue: level });
}

/** Translated risk-register status (open / under_mitigation / closed …). */
export function riskStatusText(t: TFunction, status: string): string {
  return t(`status.${status}`, { ns: "risks", defaultValue: status.replace(/_/g, " ") });
}

/** Project-report activity statuses are stored as English text ("In Progress"). */
const PROJECT_ACTIVITY_STATUS_KEYS: Record<string, string> = {
  "Planned": "planned", "In Progress": "inProgress", "Completed": "completed", "Delayed": "delayed", "Cancelled": "cancelled",
};
export function projectActivityStatusText(t: TFunction, status: string): string {
  const key = PROJECT_ACTIVITY_STATUS_KEYS[status];
  return key ? t(`form.activityStatusValues.${key}`, { ns: "reports", defaultValue: status }) : status;
}
