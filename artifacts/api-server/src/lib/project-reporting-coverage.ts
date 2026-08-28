export type ReportingMonth = { year: number; month: number };

function asDate(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) throw new Error("Invalid reporting coverage date.");
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const text = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Invalid reporting coverage date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid reporting coverage date.");
  }
  return date;
}

/** Inclusive: a project ending on a month's first/starting on its last day is covered. */
export function projectCoverageOverlapsMonth(
  coverageStart: string | Date,
  coverageEnd: string | Date,
  month: ReportingMonth,
): boolean {
  if (
    !Number.isInteger(month.year) ||
    !Number.isInteger(month.month) ||
    month.month < 1 ||
    month.month > 12
  ) {
    return false;
  }
  const start = asDate(coverageStart);
  const end = asDate(coverageEnd);
  if (start > end) return false;
  const monthStart = new Date(Date.UTC(month.year, month.month - 1, 1));
  const monthEnd = new Date(Date.UTC(month.year, month.month, 0));
  return start <= monthEnd && end >= monthStart;
}

export function projectCoverageOverlapsPeriod(
  coverageStart: string | Date,
  coverageEnd: string | Date,
  periodStart: string | Date,
  periodEnd: string | Date,
): boolean {
  const start = asDate(coverageStart);
  const end = asDate(coverageEnd);
  const periodFrom = asDate(periodStart);
  const periodTo = asDate(periodEnd);
  return start <= end && periodFrom <= periodTo && start <= periodTo && end >= periodFrom;
}