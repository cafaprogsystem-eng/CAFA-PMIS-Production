/**
 * Read-only presentation safeguards for Project Budget values.
 *
 * Project currency is the monetary authority. An absent or unsupported value
 * must remain visibly unavailable rather than gaining an unqualified default.
 */
const SUPPORTED_PROJECT_CURRENCIES = new Set(["USD", "SDG", "EUR", "AED"]);

export function resolveProjectCurrency(currency: string | null | undefined): string | null {
  const normalised = currency?.trim().toUpperCase();
  if (!normalised) return null;
  return SUPPORTED_PROJECT_CURRENCIES.has(normalised) ? normalised : null;
}

export function formatProjectBudgetMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  const resolvedCurrency = resolveProjectCurrency(currency);
  if (value == null || !resolvedCurrency) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: resolvedCurrency,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * A burn rate only has a financial meaning when its own planned amount is
 * positive. This preserves genuine 0% spend while keeping 0/0 unavailable.
 */
export function projectBurnRate(
  plannedAmount: number | null | undefined,
  reportedRate: number | null | undefined,
): number | null {
  return plannedAmount != null && plannedAmount > 0 && reportedRate != null
    ? reportedRate
    : null;
}

export const BUDGET_LINE_LEVEL_LABELS: Record<string, string> = {
  output: "Output",
  activity: "Activity",
};

export function formatBudgetLineLevel(level: string): string {
  return BUDGET_LINE_LEVEL_LABELS[level] ?? level.replace(/[_-]/g, " ");
}