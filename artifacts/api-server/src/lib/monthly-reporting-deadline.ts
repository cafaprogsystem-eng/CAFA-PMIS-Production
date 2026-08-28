import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createNotification, getNotificationDeliveryEligibility } from "./notifications";
import { mailerSupportsIdempotentDelivery, sendEmail, publicAppUrl } from "./mailer";
import { logger } from "./logger";
import { monthlyReportingConfig, type MonthlyReportingConfig } from "./monthly-reporting-config";
import { projectCoverageOverlapsMonth, type ReportingMonth } from "./project-reporting-coverage";
import { MAIN_SECTORS } from "./sectors";

export type ObligationStatus =
  | "not_started"
  | "draft"
  | "revision_required"
  | "suppressed"
  | "complete";

export type MonthlyObligation = {
  key: string;
  scopeKey: string;
  reportType: "project" | "program_state" | "hq_sector";
  reporting: ReportingMonth;
  projectId?: number;
  stateId?: number;
  sector?: string;
  reportId?: number;
  status: ObligationStatus;
};

/** Side-effect-free status resolver. Archived/rejected reports do not satisfy an obligation. */
export function classifyMonthlyObligation(statuses: readonly string[]): ObligationStatus {
  if (statuses.includes("approved")) return "complete";
  if (
    statuses.some((status) =>
      ["submitted", "state_reviewed", "technically_approved", "coordination_approved"].includes(
        status,
      ),
    )
  ) {
    return "suppressed";
  }
  if (statuses.includes("revision_required") || statuses.includes("returned")) {
    return "revision_required";
  }
  return statuses.includes("draft") ? "draft" : "not_started";
}

export function previousKhartoumMonth(
  now = new Date(),
  timezone = "Africa/Khartoum",
): ReportingMonth {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const currentYear = Number(parts.find((part) => part.type === "year")?.value);
  const currentMonth = Number(parts.find((part) => part.type === "month")?.value);
  return currentMonth === 1
    ? { year: currentYear - 1, month: 12 }
    : { year: currentYear, month: currentMonth - 1 };
}

export function latestApplicableStage(
  stageDays: readonly number[],
  localDay: number,
): number | null {
  return [...stageDays].reverse().find((day) => day <= localDay) ?? null;
}

export function monthlyReminderCopy(
  stageDay: number,
  dueDay: number,
  status: ObligationStatus,
  period: string,
) {
  const work =
    status === "revision_required"
      ? "requires revision"
      : status === "draft"
        ? "is still in draft"
        : "has not been started";
  const timing =
    stageDay < dueDay ? `is due on day ${dueDay}` : stageDay === dueDay ? "is due today" : "is overdue";
  return {
    subject: stageDay > dueDay ? "Overdue monthly report" : "Monthly report reminder",
    message: `The ${period} monthly report ${work} and ${timing}.`,
  };
}

type ProjectRow = {
  id: number;
  reporting_start_date: string;
  reporting_end_date: string;
  sector: string | null;
  has_hq_operations: boolean;
};

type MatchingReport = { id: number; status: string; latest_action: string | null };

function classifyMatch(rows: MatchingReport[]): { status: ObligationStatus; reportId?: number } {
  const active = rows.filter((row) => !["rejected", "archived"].includes(row.status));
  const selected = active[0];
  if (!selected) return { status: "not_started" };
  if (selected.status === "draft" && selected.latest_action === "request_revision") {
    return { status: "revision_required", reportId: selected.id };
  }
  return {
    status: classifyMonthlyObligation(active.map((row) => row.status)),
    reportId: selected.id,
  };
}

async function matchingReports(
  where: string,
  params: unknown[],
): Promise<{ status: ObligationStatus; reportId?: number }> {
  const reports = await pool.query<MatchingReport>(
    `SELECT r.id, r.status, latest.action AS latest_action
       FROM reports r
       LEFT JOIN LATERAL (
         SELECT a.action
           FROM approvals a
          WHERE a.entity_type='report' AND a.entity_id=r.id
          ORDER BY a.timestamp DESC, a.id DESC
          LIMIT 1
       ) latest ON TRUE
      WHERE r.report_type=$1 AND r.kind='monthly'
        AND r.reporting_year=$2 AND r.reporting_month=$3
        AND r.status NOT IN ('rejected','archived')
        AND r.migration_is_duplicate=FALSE
        AND r.migration_status_unverified=FALSE
        AND ${where}
      ORDER BY r.updated_at DESC, r.id DESC`,
    params,
  );
  return classifyMatch(reports.rows);
}

export async function resolveMonthlyObligations(
  month = previousKhartoumMonth(),
): Promise<MonthlyObligation[]> {
  const projects = await pool.query<ProjectRow>(
    `SELECT id, reporting_start_date::text, reporting_end_date::text, sector, has_hq_operations
       FROM projects
      WHERE deleted_at IS NULL
        AND reporting_frequency='monthly'
        AND status IN ('approved','active','technically_approved','coordination_approved')`,
  );
  const output: MonthlyObligation[] = [];

  const states = await pool.query<{ id: number }>(
    `SELECT id FROM states WHERE operational_status = 'active'`,
  );
  for (const state of states.rows) {
    const match = await matchingReports("r.state_id=$4 AND r.project_id IS NULL", [
      "program_state",
      month.year,
      month.month,
      state.id,
    ]);
    const scopeKey = `state:${state.id}`;
    output.push({
      key: `program-state:${scopeKey}:${month.year}-${month.month}`,
      scopeKey,
      reportType: "program_state",
      stateId: state.id,
      reporting: month,
      ...match,
    });
  }

  for (const project of projects.rows) {
    if (
      !projectCoverageOverlapsMonth(
        project.reporting_start_date,
        project.reporting_end_date,
        month,
      )
    ) {
      continue;
    }
    const locations = await pool.query<{ state_id: number }>(
      `SELECT ps.state_id
         FROM project_states ps
         JOIN states s ON s.id = ps.state_id
        WHERE ps.project_id = $1 AND s.operational_status = 'active'`,
      [project.id],
    );
    for (const location of locations.rows) {
      const match = await matchingReports("r.project_id=$4 AND r.state_id=$5", [
        "project",
        month.year,
        month.month,
        project.id,
        location.state_id,
      ]);
      const scopeKey = `project:${project.id}:state:${location.state_id}`;
      output.push({
        key: `${scopeKey}:${month.year}-${month.month}`,
        scopeKey,
        reportType: "project",
        projectId: project.id,
        stateId: location.state_id,
        reporting: month,
        ...match,
      });
    }
    if (project.has_hq_operations) {
      const match = await matchingReports(
        "r.project_id=$4 AND r.state_id IS NULL AND r.location_type='hq'",
        ["project", month.year, month.month, project.id],
      );
      const scopeKey = `project:${project.id}:hq`;
      output.push({
        key: `${scopeKey}:${month.year}-${month.month}`,
        scopeKey,
        reportType: "project",
        projectId: project.id,
        sector: project.sector ?? undefined,
        reporting: month,
        ...match,
      });
    }
  }

  for (const sector of MAIN_SECTORS) {
    const match = await matchingReports(
      "r.sector=$4 AND r.state_id IS NULL AND r.project_id IS NULL",
      ["hq_sector", month.year, month.month, sector],
    );
    const scopeKey = `sector:${sector}`;
    output.push({
      key: `hq-sector:${scopeKey}:${month.year}-${month.month}`,
      scopeKey,
      reportType: "hq_sector",
      sector,
      reporting: month,
      ...match,
    });
  }
  return [...new Map(output.map((item) => [item.key, item])).values()];
}

export async function resolveMonthlyReminderRecipientIds(
  obligation: MonthlyObligation,
): Promise<number[]> {
  if (obligation.reportType === "project" && obligation.stateId == null) {
    const users = await pool.query<{ id: number }>(
      `SELECT id FROM users
        WHERE status='active' AND role='technical_coordinator'
          AND $1 = ANY(regexp_split_to_array(COALESCE(sector,''), '\\s*,\\s*'))`,
      [obligation.sector],
    );
    return [...new Set(users.rows.map((row) => row.id))];
  }
  if (obligation.reportType === "project" || obligation.reportType === "program_state") {
    const users = await pool.query<{ id: number }>(
      `SELECT u.id FROM users u
        WHERE u.status='active' AND u.state_id=$1 AND u.role='state_program_officer'
          AND ($2::integer IS NULL OR EXISTS (
            SELECT 1 FROM project_assignments pa
             WHERE pa.project_id=$2 AND pa.user_id=u.id
          ))
       UNION
       SELECT u.id FROM users u
        WHERE u.status='active' AND u.state_id=$1 AND u.role='state_office_manager'
          AND $2::integer IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM users spo
             WHERE spo.status='active' AND spo.state_id=$1
               AND spo.role='state_program_officer'
          )`,
      [obligation.stateId, obligation.projectId ?? null],
    );
    return [...new Set(users.rows.map((row) => row.id))];
  }
  if (obligation.reportType === "hq_sector") {
    const users = await pool.query<{ id: number }>(
      `SELECT id FROM users
        WHERE status='active' AND role='technical_coordinator'
          AND $1 = ANY(regexp_split_to_array(COALESCE(sector,''), '\\s*,\\s*'))
       UNION
       SELECT id FROM users
        WHERE status='active' AND role='senior_program_coordinator'
          AND NOT EXISTS (
            SELECT 1 FROM users tc
             WHERE tc.status='active' AND tc.role='technical_coordinator'
               AND $1 = ANY(regexp_split_to_array(COALESCE(tc.sector,''), '\\s*,\\s*'))
          )`,
      [obligation.sector],
    );
    return [...new Set(users.rows.map((row) => row.id))];
  }
  return [];
}

async function claim(
  obligation: MonthlyObligation,
  userId: number,
  channel: "in_app" | "email",
  stageDay: number,
  config: MonthlyReportingConfig,
) {
  const token = randomUUID();
  const result = await pool.query<{ id: number }>(
    `INSERT INTO monthly_report_reminder_deliveries
       (obligation_key,report_type,reporting_year,reporting_month,scope_key,recipient_user_id,channel,stage_day,status,lease_token,lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'leased',$9,NOW() + ($10::text || ' milliseconds')::interval)
     ON CONFLICT (report_type,reporting_year,reporting_month,scope_key,recipient_user_id,stage_day,channel)
     DO UPDATE SET
       status='leased',
       lease_token=EXCLUDED.lease_token,
       lease_expires_at=EXCLUDED.lease_expires_at,
       updated_at=NOW()
     WHERE (
       monthly_report_reminder_deliveries.status IN ('pending','failed')
       OR (
         monthly_report_reminder_deliveries.status='leased'
         AND monthly_report_reminder_deliveries.lease_expires_at < NOW()
       )
     )
       AND monthly_report_reminder_deliveries.attempt_count < $11
       AND monthly_report_reminder_deliveries.next_attempt_at <= NOW()
     RETURNING id`,
    [
      obligation.key,
      obligation.reportType,
      obligation.reporting.year,
      obligation.reporting.month,
      obligation.scopeKey,
      userId,
      channel,
      stageDay,
      token,
      config.leaseMs,
      config.retryLimit,
    ],
  );
  return result.rows[0] ? { id: result.rows[0].id, token } : null;
}

async function settle(
  id: number,
  token: string,
  outcome: "sent" | "failed" | "non_retryable",
  metadata: unknown,
  config: MonthlyReportingConfig,
) {
  const result = await pool.query(
    `UPDATE monthly_report_reminder_deliveries SET
      status=CASE WHEN $3='failed' AND attempt_count+1 >= $7 THEN 'dead_letter' ELSE $3 END,
      attempt_count=attempt_count+1,
      delivered_at=CASE WHEN $3='sent' THEN NOW() ELSE NULL END,
      result_metadata=$4::jsonb,
      last_error=CASE WHEN $3<>'sent' THEN $5 ELSE NULL END,
      next_attempt_at=CASE WHEN $3='failed'
        THEN NOW() + (($6 * power(2, attempt_count))::text || ' milliseconds')::interval
        ELSE next_attempt_at END,
      lease_token=NULL,
      lease_expires_at=NULL,
      updated_at=NOW()
     WHERE id=$1 AND lease_token=$2`,
    [
      id,
      token,
      outcome,
      JSON.stringify(metadata),
      outcome === "sent"
        ? null
        : String((metadata as { error?: unknown }).error ?? "delivery failed"),
      config.retryBackoffMs,
      config.retryLimit,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error("Monthly reminder lease was lost before settlement.");
  }
}

export const monthlyReportingDeliveryInternals = { claim, settle };

export async function evaluateMonthlyReportingDeadlines(
  now = new Date(),
  config = monthlyReportingConfig(),
  dryRun = false,
) {
  if (!config.enabled) return { evaluated: 0, delivered: 0, skipped: "disabled" as const };
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timezone,
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const localDay = Number(local.find((part) => part.type === "day")?.value);
  const localHour = Number(local.find((part) => part.type === "hour")?.value);
  const localMinute = Number(local.find((part) => part.type === "minute")?.value);
  const [businessHour, businessMinute] = config.businessHour.split(":").map(Number);
  if (localHour * 60 + localMinute < businessHour * 60 + businessMinute) {
    return { evaluated: 0, delivered: 0, skipped: "before_business_hour" as const };
  }
  const stageDay = latestApplicableStage(config.stageDays, localDay);
  if (stageDay === null) return { evaluated: 0, delivered: 0, skipped: "before_stage" as const };

  const lockClient = await pool.connect();
  const lock = await lockClient.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
    ["cafa-pmis:monthly-reporting"],
  );
  if (!lock.rows[0]?.locked) {
    lockClient.release();
    return { evaluated: 0, delivered: 0, skipped: "locked" as const };
  }
  try {
    const obligations = (
      await resolveMonthlyObligations(previousKhartoumMonth(now, config.timezone))
    ).filter((item) => item.status !== "complete" && item.status !== "suppressed");
    if (dryRun) {
      const recipientCount = (
        await Promise.all(obligations.map(resolveMonthlyReminderRecipientIds))
      ).reduce((sum, ids) => sum + ids.length, 0);
      return {
        evaluated: obligations.length,
        recipients: recipientCount,
        delivered: 0,
        stageDay,
        byStatus: Object.fromEntries(
          ["not_started", "draft", "revision_required"].map((status) => [
            status,
            obligations.filter((item) => item.status === status).length,
          ]),
        ),
        skipped: "dry_run" as const,
      };
    }

    let delivered = 0;
    for (const obligation of obligations) {
      for (const userId of await resolveMonthlyReminderRecipientIds(obligation)) {
        const eligibility = await getNotificationDeliveryEligibility(
          userId,
          "monthly_report_reminder",
        );
        const baseLink = `/reports/${
          obligation.reportType === "hq_sector"
            ? "hq-sector"
            : obligation.reportType === "program_state"
              ? "program-state"
              : "project"
        }`;
        const link = obligation.reportId
          ? `${baseLink}?open=${obligation.reportId}`
          : `${baseLink}?year=${obligation.reporting.year}&month=${obligation.reporting.month}`;
        const period = `${obligation.reporting.year}-${String(obligation.reporting.month).padStart(2, "0")}`;
        const { subject, message } = monthlyReminderCopy(
          stageDay,
          config.dueDay,
          obligation.status,
          period,
        );
        for (const channel of ["in_app", "email"] as const) {
          const lease = await claim(obligation, userId, channel, stageDay, config);
          if (!lease) continue;
          if (
            !eligibility.active ||
            (channel === "in_app" ? !eligibility.inApp : !eligibility.email)
          ) {
            await settle(
              lease.id,
              lease.token,
              "non_retryable",
              { error: "channel not eligible" },
              config,
            );
            continue;
          }
          try {
            if (channel === "in_app") {
              const notificationId = await createNotification({
                userId,
                kind: "monthly_report_reminder",
                entityType: "report",
                message,
                link,
                suppressEmail: true,
                dedupeKey: `monthly-report-reminder:${obligation.key}:${stageDay}`,
              });
              if (!notificationId) {
                throw new Error("in-app notification was not eligible or persisted");
              }
            } else {
              if (!mailerSupportsIdempotentDelivery()) {
                throw new Error(
                  "monthly reminder email requires a provider with server-side idempotency",
                );
              }
              const result = await sendEmail({
                to: eligibility.emailAddress!,
                userId,
                kind: "monthly_report_reminder",
                subject,
                html: `<p>${message}</p><p><a href="${publicAppUrl()}${link}">Open CAFA PMIS</a></p>`,
                idempotencyKey: createHash("sha256")
                  .update(`${obligation.key}:${userId}:${stageDay}:email`)
                  .digest("hex"),
              });
              if (result.status !== "sent") throw new Error(`mailer ${result.status}`);
            }
            await settle(lease.id, lease.token, "sent", { channel }, config);
            delivered++;
          } catch {
            await settle(lease.id, lease.token, "failed", { error: "delivery failed" }, config);
          }
        }
      }
    }
    logger.info(
      { evaluated: obligations.length, delivered, stageDay },
      "Monthly reporting evaluation complete",
    );
    return { evaluated: obligations.length, delivered, stageDay, skipped: null };
  } finally {
    await lockClient
      .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [
        "cafa-pmis:monthly-reporting",
      ])
      .catch((error) => logger.warn({ error }, "monthly reporting unlock failed"));
    lockClient.release();
  }
}