import type { BadgeVariant } from "@/components/ui/badge";

export const formatCurrency = (val: number | undefined | null, currency?: string | null) => {
  if (currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: 0,
    }).format(val ?? 0);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val || 0);
};

/**
 * Formats a percentage value with adaptive precision (up to 2 decimal places).
 * null / undefined → "—"   |   0 → "0%"   |   0.1058 → "0.11%"
 * Values above 100 are preserved as-is (e.g. 125.75 → "125.75%").
 */
export const formatPercent = (val: number | null | undefined): string => {
  if (val == null) return "—";
  if (val === 0) return "0%";
  return `${parseFloat(val.toFixed(2))}%`;
};

export const formatDate = (d: string | undefined | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

export const formatDateTime = (d: string | undefined | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

/**
 * Same fixed en-GB rendering as formatDate/formatDateTime — every date in
 * the app stays in that one consistent, LTR-isolated format regardless of
 * active UI language — but resolved in a specific IANA timezone (e.g. a
 * user's saved Profile timezone) rather than the browser's local one.
 * Never pass the active UI locale here: that would render Arabic month
 * names and Arabic-Indic digits, inconsistent with every other date in
 * the app.
 */
export const formatDateInTimezone = (
  d: string | Date | undefined | null,
  timeZone: string,
  withTime = true,
): string => {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(d));
  } catch {
    return "—";
  }
};

export const hasPerm = (perms: string[] | undefined, p: string) =>
  !!perms && (perms.includes("*") || perms.includes(p));

/**
 * Converts a raw project status key into its display label.
 * Only affects the visible label — no underlying values, enums, or
 * workflow logic are changed.
 */
export const formatStatusLabel = (status: string): string => {
  switch (status?.toLowerCase()) {
    case "draft":                  return "Draft";
    case "submitted":              return "Submitted";
    case "state_reviewed":
    case "technically_approved":   return "Technically Approved";
    case "coordination_approved":  return "Coordination Approved";
    case "approved":               return "Approved";
    case "active":                 return "Active";
    case "rejected":               return "Rejected";
    case "returned":
    case "request_revision":       return "Returned";
    case "on_hold":                return "On Hold";
    case "closed":                 return "Closed";
    case "completed":              return "Completed";
    case "cancelled":              return "Cancelled";
    case "pending":                return "Pending";
    default:
      // Safe fallback: replace underscores and title-case each word
      return status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
};

/**
 * Converts a raw plan type key into its single approved display label.
 * Used throughout Planning (Plans table, Plan Details, etc.) to ensure
 * one consistent label per internal value.
 *   annual       → "Annual"
 *   emergency    → "Emergency Response"
 *   (other keys) → title-cased first word
 */
export const formatPlanType = (pt: string | null | undefined): string => {
  if (!pt) return "—";
  switch (pt.toLowerCase()) {
    case "monthly":      return "Monthly";
    case "quarterly":    return "Quarterly";
    case "annual":       return "Annual";
    case "action":       return "Action";
    case "operational":  return "Operational";
    case "emergency":    return "Emergency Response";
    case "custom":       return "Custom";
    default:
      return pt.charAt(0).toUpperCase() + pt.slice(1);
  }
};

/* ── Status → badge variant mapping ─────────────────────────────────── */
export const statusBadgeVariant = (
  status: string
): { variant: BadgeVariant; className?: string } => {
  switch (status?.toLowerCase()) {
    case "draft":
      return { variant: "draft" };
    case "submitted":
      return { variant: "submitted" };
    case "state_reviewed":
    case "technically_approved":
      return { variant: "completed" };
    case "coordination_approved":
      return { variant: "invited" };
    case "approved":
      return { variant: "approved" };
    case "active":
      return { variant: "active" };
    case "in_progress":
      return { variant: "info" };
    case "delayed":
      return { variant: "warning" };
    case "archived":
      return { variant: "inactive" };
    case "rejected":
      return { variant: "rejected" };
    case "returned":
    case "request_revision":
      return { variant: "returned" };
    case "on_hold":
      return { variant: "on_hold" };
    case "cancelled":
      return { variant: "cancelled" };
    case "closed":
      return { variant: "closed" };
    case "completed":
      return { variant: "completed" };
    case "pending":
      return { variant: "pending" };
    case "invited":
      return { variant: "invited" };
    case "suspended":
      return { variant: "suspended" };
    case "inactive":
    case "deactivated":
      return { variant: "inactive" };
    default:
      return { variant: "outline" };
  }
};

/* ── Severity → badge variant ────────────────────────────────────────── */
export const severityBadgeVariant = (severity: string): BadgeVariant => {
  switch (severity?.toLowerCase()) {
    case "critical": return "critical";
    case "high":     return "high";
    case "medium":   return "medium";
    case "low":      return "low";
    default:         return "outline";
  }
};

/** @deprecated use severityBadgeVariant */
export const severityBadgeClass = (severity: string) => {
  switch (severity) {
    case "critical": return "bg-red-700 text-white";
    case "high":     return "bg-red-500 text-white";
    case "medium":   return "bg-amber-500 text-white";
    case "low":      return "bg-emerald-500 text-white";
    default:         return "bg-muted text-foreground";
  }
};

/**
 * Returns a human-readable location label from a locationType + state pair.
 *
 * locationType === "hq"   → "HQ"
 * locationType === "state" (or inferred from stateId) and stateName present → stateName
 * No location data available → "—"
 *
 * This is the ONLY place HQ display branching belongs.
 * Never write `locationType === "hq" ? "HQ" : stateName` inline across modules.
 */
export const formatLocation = (opts: {
  locationType?: string | null;
  stateName?: string | null;
  stateNameAr?: string | null;
  stateId?: number | null;
}, language?: string): string => {
  // Infer type from stateId when locationType is absent (backward compat with pre-migration records).
  const lt = opts.locationType ?? (opts.stateId != null ? "state" : null);
  if (lt === "hq") return "HQ";
  return language?.toLowerCase().startsWith("ar")
    ? opts.stateNameAr?.trim() || opts.stateName || "—"
    : opts.stateName ?? "—";
};

/** @deprecated use severityBadgeVariant */
export const riskLevelClass = (level: string) => {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-700 text-white";
  if (l === "high")     return "bg-orange-500 text-white";
  if (l === "medium")   return "bg-amber-400 text-black";
  if (l === "low")      return "bg-emerald-500 text-white";
  return "bg-muted text-foreground";
};

const ENGLISH_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Localised label for a chart month key. The dashboard's monthly series
 * types `month` as a free string, so this accepts both a machine key
 * ("2026-09", "2026-09-01") and an English name or abbreviation ("Sep",
 * "September"), and renders the month in the UI language ("سبتمبر" in
 * Arabic, "Sep" in English; the year is added only for "YYYY-MM" keys when
 * `withYear` is set). Anything else is returned unchanged.
 */
export function formatMonthLabel(value: string | number | undefined | null, language?: string, withYear = false): string {
  if (value == null) return "";
  const raw = String(value).trim();
  // en-US keeps the familiar three-letter "Sep" (en-GB writes "Sept").
  const locale = language?.toLowerCase().startsWith("ar") ? "ar-u-nu-latn" : "en-US";
  const iso = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, 1));
    return new Intl.DateTimeFormat(locale, { month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(date);
  }
  // English name or 3-letter abbreviation ("Sep", "Sept", "September"),
  // optionally followed by a 2- or 4-digit year ("Sep 26", as the project
  // budget series sends it).
  const named = raw.match(/^([A-Za-z]+)\.?(?:\s+(\d{2}|\d{4}))?$/);
  if (named) {
    const word = named[1].toLowerCase();
    const index = ENGLISH_MONTHS.findIndex((name) => word === name || word === name.slice(0, 3) || (name === "september" && word === "sept"));
    if (index >= 0) {
      const year = named[2] ? Number(named[2].length === 2 ? `20${named[2]}` : named[2]) : 2000;
      return new Intl.DateTimeFormat(locale, {
        month: "short", ...(named[2] ? { year: named[2].length === 2 ? "2-digit" : "numeric" } : {}), timeZone: "UTC",
      }).format(new Date(Date.UTC(year, index, 1)));
    }
  }
  return raw;
}
