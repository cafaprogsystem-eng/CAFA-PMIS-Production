import { z } from "zod";
import { ListAuditLogQueryParams } from "./generated/api";

export const AUDIT_ACTION_CATEGORIES = ["created", "updated", "deleted", "approved"] as const;
export type AuditActionCategory = (typeof AUDIT_ACTION_CATEGORIES)[number];

/**
 * One category definition powers URL aliases, server-side row classification,
 * aggregate counts, and the action predicate used by the Audit Log.
 */
export const AUDIT_ACTION_CATEGORY_RULES: Record<
  AuditActionCategory,
  { aliases: readonly string[]; sqlPattern: string }
> = {
  created: {
    aliases: ["created", "create"],
    sqlPattern: "(^|[_ -])(create|created|add|added|upload|uploaded|register|registered)([_ -]|$)",
  },
  updated: {
    aliases: ["updated", "update"],
    sqlPattern: "(^|[_ -])(update|updated|edit|edited|change|changed|merge|merged)([_ -]|$)",
  },
  deleted: {
    aliases: ["deleted", "delete"],
    sqlPattern: "(^|[_ -])(delete|deleted|remove|removed|archive|archived)([_ -]|$)",
  },
  approved: {
    aliases: ["approved", "approve"],
    sqlPattern: "(^|[_ -])(approve|approved|approval|activate|activated)([_ -]|$)",
  },
};

export function normalizeAuditActionCategory(value: string | null | undefined): AuditActionCategory | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return AUDIT_ACTION_CATEGORIES.find((category) =>
    AUDIT_ACTION_CATEGORY_RULES[category].aliases.includes(normalized),
  );
}

export function categorizeAuditAction(action: string): AuditActionCategory | null {
  return AUDIT_ACTION_CATEGORIES.find((category) =>
    new RegExp(AUDIT_ACTION_CATEGORY_RULES[category].sqlPattern, "i").test(action),
  ) ?? null;
}

/** Builds a trusted SQL CASE expression from the category rules above. */
export function auditActionCategorySql(actionColumn: string): string {
  const cases = AUDIT_ACTION_CATEGORIES.map((category) =>
    `WHEN ${actionColumn} ~* '${AUDIT_ACTION_CATEGORY_RULES[category].sqlPattern}' THEN '${category}'`,
  ).join(" ");
  return `(CASE ${cases} ELSE NULL END)`;
}

function isIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Strict transport validator for the Audit Log query.
 *
 * The generated schema supplies the OpenAPI types, enums, bounds and patterns.
 * These cross-field/calendar refinements are deliberately kept here because
 * OpenAPI parameter schemas cannot represent them declaratively.
 */
export const AuditLogQueryParams = ListAuditLogQueryParams.superRefine((value, ctx) => {
  if (value.action && !normalizeAuditActionCategory(value.action)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "unsupported audit action category" });
  }
  for (const field of ["dateFrom", "dateTo"] as const) {
    if (value[field] && !isIsoCalendarDate(value[field])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "invalid calendar date" });
    }
  }
  if (value.module && value.entityType && value.module !== value.entityType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entityType"], message: "module and entityType must match" });
  }
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "dateTo must be on or after dateFrom" });
  }
});