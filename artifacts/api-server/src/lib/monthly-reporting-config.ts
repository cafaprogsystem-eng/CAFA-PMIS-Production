/** Pure configuration boundary for the monthly-reporting worker. */
export type MonthlyReportingConfig = {
  enabled: boolean;
  timezone: "Africa/Khartoum";
  businessHour: string;
  dueDay: number;
  stageDays: readonly number[];
  pollMs: number;
  retryLimit: number;
  retryBackoffMs: number;
  leaseMs: number;
};

const bool = (value: string | undefined, name: string, fallback: boolean): boolean => {
  if (value == null || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false.`);
};

const whole = (
  value: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const number = Number(value);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return number;
};

export function monthlyReportingConfig(
  env: Record<string, string | undefined> = process.env,
): MonthlyReportingConfig {
  const timezone = env.MONTHLY_REPORTING_TIMEZONE ?? "Africa/Khartoum";
  if (timezone !== "Africa/Khartoum") {
    throw new Error("MONTHLY_REPORTING_TIMEZONE must be Africa/Khartoum.");
  }
  const businessHour = env.MONTHLY_REPORTING_BUSINESS_HOUR ?? "09:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(businessHour)) {
    throw new Error("MONTHLY_REPORTING_BUSINESS_HOUR must use HH:MM.");
  }
  const stageText = env.MONTHLY_REPORTING_STAGE_DAYS ?? "1,3,4,6";
  const stageDays = stageText.split(",").map((part) => {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("MONTHLY_REPORTING_STAGE_DAYS must be comma-separated days.");
    }
    return Number(trimmed);
  });
  if (
    !stageDays.length ||
    stageDays.some((day) => day < 1 || day > 31) ||
    stageDays.some((day, index) => index > 0 && day <= stageDays[index - 1])
  ) {
    throw new Error("MONTHLY_REPORTING_STAGE_DAYS must be ascending unique days between 1 and 31.");
  }
  const dueDay = whole(env.MONTHLY_REPORTING_DUE_DAY, "MONTHLY_REPORTING_DUE_DAY", 3, 1, 28);
  if (!stageDays.includes(dueDay)) {
    throw new Error("MONTHLY_REPORTING_STAGE_DAYS must include MONTHLY_REPORTING_DUE_DAY.");
  }
  return {
    enabled: bool(env.MONTHLY_REPORTING_ENABLED, "MONTHLY_REPORTING_ENABLED", true),
    timezone,
    businessHour,
    dueDay,
    stageDays,
    pollMs: whole(env.MONTHLY_REPORTING_POLL_MS, "MONTHLY_REPORTING_POLL_MS", 60_000, 1_000, 3_600_000),
    retryLimit: whole(env.MONTHLY_REPORTING_RETRY_LIMIT, "MONTHLY_REPORTING_RETRY_LIMIT", 3, 1, 20),
    retryBackoffMs: whole(
      env.MONTHLY_REPORTING_RETRY_BACKOFF_MS,
      "MONTHLY_REPORTING_RETRY_BACKOFF_MS",
      60_000,
      1_000,
      86_400_000,
    ),
    leaseMs: whole(env.MONTHLY_REPORTING_LEASE_MS, "MONTHLY_REPORTING_LEASE_MS", 300_000, 10_000, 3_600_000),
  };
}