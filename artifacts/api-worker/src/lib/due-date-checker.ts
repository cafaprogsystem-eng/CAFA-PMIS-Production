import type { QueryExecutor, Bindings } from "./db";
import { createNotificationDeduped } from "./notifications";

/**
 * Ported verbatim from artifacts/api-server/src/lib/due-date-checker.ts —
 * `pool.query` swapped for an explicit `db: QueryExecutor` argument, and
 * createNotificationDeduped now takes `db, env` explicitly too. Business
 * logic (thresholds, dedupe keys, recipient resolution) is unchanged.
 *
 * Comprehensive due-date notification checker. Fires notifications for:
 *   - Risks:           due in 7, 3, 1 days  OR  overdue
 *   - Projects:        ending in 7, 3, 1 days OR overdue
 *   - Plans:           ending in 7, 3, 1 days OR overdue
 *   - Plan activities: due in 7, 3, 1 days  OR  overdue
 *
 * Deduplication: each source-derived due-date event is claimed atomically per
 * recipient. A calendar-day bucket permits legitimate recurring overdue
 * reminders without using a race-prone SELECT-then-INSERT time window.
 */

type DueItem = {
  id: number;
  title: string;
  dueDate: string; // YYYY-MM-DD
  assignedToId: number | null;
  parentId: number | null; // project_id for risks; plan_id for activities; null otherwise
};

export type ReferenceDates = {
  today: string; // YYYY-MM-DD
  in1: string;
  in3: string;
  in7: string;
};

async function getReferenceDates(db: QueryExecutor): Promise<ReferenceDates> {
  const { rows } = await db.query<ReferenceDates>(
    `SELECT CURRENT_DATE::text AS "today",
            (CURRENT_DATE + 1)::text AS "in1",
            (CURRENT_DATE + 3)::text AS "in3",
            (CURRENT_DATE + 7)::text AS "in7"`,
  );
  return rows[0];
}

async function sendIfNew(db: QueryExecutor, env: Bindings, opts: {
  userId: number; entityId: number; kind: string;
  message: string; link: string; entityType: string;
  eventDate: string;
}): Promise<void> {
  await createNotificationDeduped(db, env, {
    userId: opts.userId,
    kind: opts.kind,
    entityType: opts.entityType,
    entityId: opts.entityId,
    message: opts.message,
    link: opts.link,
    dedupeKey: `due-date:${opts.entityType}:${opts.entityId}:${opts.kind}:${opts.eventDate}`,
  });
}

async function notifyProjectMembers(
  db: QueryExecutor, env: Bindings,
  projectId: number, entityId: number, kind: string,
  message: string, link: string, entityType: string,
  eventDate: string,
  excludeUserId?: number | null,
): Promise<void> {
  const { rows } = await db.query<{ user_id: number }>(
    `SELECT created_by_id AS user_id FROM projects WHERE id = $1
     UNION
     SELECT user_id FROM project_assignments WHERE project_id = $1 AND user_id IS NOT NULL`,
    [projectId],
  );
  for (const r of rows) {
    if (excludeUserId != null && r.user_id === excludeUserId) continue;
    await sendIfNew(db, env, { userId: r.user_id, entityId, kind, message, link, entityType, eventDate });
  }
}

async function checkRisksDueDates(db: QueryExecutor, env: Bindings, ref: ReferenceDates): Promise<void> {
  const today = ref.today;
  const thresholds = [
    { targetDate: ref.in7, kind: "risk_due_7d", label: "in 7 days" },
    { targetDate: ref.in3, kind: "risk_due_3d", label: "in 3 days" },
    { targetDate: ref.in1, kind: "risk_due_1d", label: "tomorrow" },
    { targetDate: null, kind: "risk_overdue", label: "overdue" },
  ];

  for (const { targetDate, kind, label } of thresholds) {
    const dateClause = targetDate
      ? `TO_CHAR(r.due_date, 'YYYY-MM-DD') = '${targetDate}'`
      : `r.due_date < $1::date`;
    const params: unknown[] = targetDate ? [] : [today];

    const { rows } = await db.query<DueItem>(
      `SELECT r.id, r.title,
              TO_CHAR(r.due_date, 'YYYY-MM-DD') AS "dueDate",
              r.assigned_to_id AS "assignedToId",
              r.project_id AS "parentId"
         FROM risks r
        WHERE r.due_date IS NOT NULL AND r.status NOT IN ('closed', 'mitigated')
          AND ${dateClause}`,
      params,
    );

    for (const risk of rows) {
      const message = `🔔 Risk ${label}: "${risk.title}"${targetDate ? ` — due ${targetDate}` : " (due date passed)"}`;
      if (risk.assignedToId) {
        await sendIfNew(db, env, {
          userId: risk.assignedToId, entityId: risk.id, kind, message,
          link: "/risks", entityType: "risk", eventDate: targetDate ?? today,
        });
      }
      if (risk.parentId) {
        await notifyProjectMembers(
          db, env, risk.parentId, risk.id, kind, message, "/risks", "risk",
          targetDate ?? today, risk.assignedToId,
        );
      }
    }
  }
}

async function checkProjectsDueDates(db: QueryExecutor, env: Bindings, ref: ReferenceDates): Promise<void> {
  const today = ref.today;
  const thresholds = [
    { targetDate: ref.in7, kind: "project_due_7d", label: "in 7 days" },
    { targetDate: ref.in3, kind: "project_due_3d", label: "in 3 days" },
    { targetDate: ref.in1, kind: "project_due_1d", label: "tomorrow" },
    { targetDate: null, kind: "project_overdue", label: "overdue" },
  ];

  for (const { targetDate, kind, label } of thresholds) {
    const dateClause = targetDate
      ? `TO_CHAR(p.end_date, 'YYYY-MM-DD') = '${targetDate}'`
      : `p.end_date < $1::date`;
    const params: unknown[] = targetDate ? [] : [today];

    const { rows } = await db.query<{ id: number; title: string }>(
      `SELECT p.id, p.title
         FROM projects p
        WHERE p.end_date IS NOT NULL AND p.status NOT IN ('closed', 'cancelled')
          AND ${dateClause}`,
      params,
    );

    for (const project of rows) {
      const message = `📅 Project ending ${label}: "${project.title}"`;
      await notifyProjectMembers(
        db, env, project.id, project.id, kind, message, `/projects/${project.id}`, "project",
        targetDate ?? today, null,
      );
    }
  }
}

async function checkPlansDueDates(db: QueryExecutor, env: Bindings, ref: ReferenceDates): Promise<void> {
  const today = ref.today;
  const thresholds = [
    { targetDate: ref.in7, kind: "plan_due_7d", label: "in 7 days" },
    { targetDate: ref.in3, kind: "plan_due_3d", label: "in 3 days" },
    { targetDate: ref.in1, kind: "plan_due_1d", label: "tomorrow" },
    { targetDate: null, kind: "plan_overdue", label: "overdue" },
  ];

  for (const { targetDate, kind, label } of thresholds) {
    const dateClause = targetDate
      ? `TO_CHAR(pl.end_date, 'YYYY-MM-DD') = '${targetDate}'`
      : `pl.end_date < $1::date`;
    const params: unknown[] = targetDate ? [] : [today];

    const { rows } = await db.query<{ id: number; title: string; responsibleUserId: number | null; createdById: number }>(
      `SELECT pl.id, pl.title,
              pl.responsible_user_id AS "responsibleUserId",
              pl.created_by_id AS "createdById"
         FROM plans pl
        WHERE pl.end_date IS NOT NULL AND pl.status NOT IN ('archived', 'cancelled', 'completed')
          AND ${dateClause}`,
      params,
    );

    for (const plan of rows) {
      const message = `📋 Plan ending ${label}: "${plan.title}"`;
      const notified = new Set<number>();

      if (plan.responsibleUserId) {
        await sendIfNew(db, env, {
          userId: plan.responsibleUserId, entityId: plan.id, kind, message,
          link: `/plans/${plan.id}`, entityType: "plan", eventDate: targetDate ?? today,
        });
        notified.add(plan.responsibleUserId);
      }
      if (plan.createdById && !notified.has(plan.createdById)) {
        await sendIfNew(db, env, {
          userId: plan.createdById, entityId: plan.id, kind, message,
          link: `/plans/${plan.id}`, entityType: "plan", eventDate: targetDate ?? today,
        });
      }
    }
  }
}

async function checkPlanActivitiesDueDates(db: QueryExecutor, env: Bindings, ref: ReferenceDates): Promise<void> {
  const today = ref.today;
  const thresholds = [
    { targetDate: ref.in7, kind: "activity_due_7d", label: "in 7 days" },
    { targetDate: ref.in3, kind: "activity_due_3d", label: "in 3 days" },
    { targetDate: ref.in1, kind: "activity_due_1d", label: "tomorrow" },
    { targetDate: null, kind: "activity_overdue", label: "overdue" },
  ];

  for (const { targetDate, kind, label } of thresholds) {
    const dateClause = targetDate
      ? `TO_CHAR(pa.end_date, 'YYYY-MM-DD') = '${targetDate}'`
      : `pa.end_date < $1::date`;
    const params: unknown[] = targetDate ? [] : [today];

    const { rows } = await db.query<{ id: number; title: string; responsibleUserId: number | null; planId: number }>(
      `SELECT pa.id, pa.title,
              pa.responsible_user_id AS "responsibleUserId",
              pa.plan_id AS "planId"
         FROM plan_activities pa
        WHERE pa.end_date IS NOT NULL AND pa.status NOT IN ('completed', 'cancelled')
          AND ${dateClause}`,
      params,
    );

    for (const act of rows) {
      if (!act.responsibleUserId) continue;
      const message = `📌 Activity ${label}: "${act.title}"`;
      await sendIfNew(db, env, {
        userId: act.responsibleUserId, entityId: act.id, kind, message,
        link: `/plans/${act.planId}`, entityType: "plan", eventDate: targetDate ?? today,
      });
    }
  }
}

export async function checkAllDueDates(db: QueryExecutor, env: Bindings): Promise<void> {
  try {
    const ref = await getReferenceDates(db);
    await checkRisksDueDates(db, env, ref);
    await checkProjectsDueDates(db, env, ref);
    await checkPlansDueDates(db, env, ref);
    await checkPlanActivitiesDueDates(db, env, ref);
    console.log("[due-date-checker] check complete");
  } catch (err) {
    console.warn("[due-date-checker] check failed (non-fatal)", err);
  }
}
