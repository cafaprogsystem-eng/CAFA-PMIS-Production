import { Hono } from "hono";
import { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS } from "@workspace/plan-transitions";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  tcSectorRestriction,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";

/**
 * Ported from artifacts/api-server/src/routes/plans.ts (3340 lines, 10
 * routes) — third file of the post-projects.ts phase, and (like
 * projects.ts) large enough to need its own batches.
 *
 * Batch A (this addition): GET /plans (list), GET /plans/dashboard, GET
 * /plans/duplicate-check, GET /plans/:planId (detail) — read paths only,
 * plus every shared helper these need (getPlanMeta, getPlanEffectiveSectors,
 * assertAnySectorAllowed, assertPlanStateAllowed, planSummarySelect,
 * getPlanActivities, getPlanLinkedRisks, getPlanById, the soft-duplicate
 * helpers). PLAN_TRANSITIONS/PLAN_TRANSITION_PERMS come from the shared
 * @workspace/plan-transitions package (plain data, no Node-only imports),
 * exactly as the Express original imports them — re-exported here for the
 * batches that still need the workflow table.
 *
 * Deferred to later batches: POST /plans (create, ~460 lines), PATCH
 * /plans/:planId (update, ~770 lines), POST /plans/:planId/close-registration,
 * DELETE /plans/:planId, POST /plans/:planId/transitions, POST
 * /plans/:planId/reopen.
 *
 * Dropped (same reasoning as every prior file): notification creation and
 * realtime.broadcastUpdate — to be confirmed per call site as each later
 * batch reaches them.
 */

export { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS };

export const PLAN_TYPES = new Set(["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"]);
export const PLAN_FREQUENCIES = new Set(["weekly", "monthly", "quarterly", "annual", "on_demand"]);

// Statuses in which direct PATCH to editable fields is blocked. Includes all
// post-final-approval statuses AND the terminal pre-approval status
// "rejected" (PLAN-BD-5: no edit, no resubmit from rejected).
export const POST_APPROVAL_LOCKED_STATUSES = new Set(["approved", "active", "in_progress", "delayed", "completed", "cancelled", "archived", "rejected"]);

// Subset of locked statuses that may be reopened. Terminal statuses
// (completed/cancelled/archived) are excluded by default per spec §17.
export const REOPENABLE_STATUSES = new Set(["approved", "active", "in_progress", "delayed"]);

/**
 * Authoritative editability check for Plan content.
 *
 * Two modes:
 *  1. Plan has NEVER been finally approved (`last_final_approved_at` is null)
 *     → editable if status is not in POST_APPROVAL_LOCKED_STATUSES.
 *  2. Plan HAS been finally approved → locked by default. Only editable when
 *     a valid `approvals.action='reopen'` row exists with `created_at`
 *     STRICTLY AFTER `last_final_approved_at`. When the plan is finally
 *     approved again, `last_final_approved_at` advances so any earlier
 *     reopen events no longer authorise editing.
 *
 * The `approvals` table is the single authoritative source of truth for
 * Reopen events. The Audit Log is historical evidence only and MUST NOT be
 * used here.
 */
export async function isPlanCurrentlyEditable(
  db: QueryExecutor,
  planId: number,
  status: string,
  lastFinalApprovedAt: Date | string | null,
): Promise<boolean> {
  if (!lastFinalApprovedAt) {
    return !POST_APPROVAL_LOCKED_STATUSES.has(status);
  }
  const reopen = await db.query(
    `SELECT 1 FROM approvals
     WHERE entity_type = 'plan' AND entity_id = $1
       AND action = 'reopen'
       AND "timestamp" > $2
     LIMIT 1`,
    [planId, lastFinalApprovedAt],
  );
  if (reopen.rows.length === 0) return false;
  return !POST_APPROVAL_LOCKED_STATUSES.has(status);
}

/**
 * Canonical Plan locality normaliser: trim, collapse internal whitespace,
 * discard empty values, and deduplicate case-insensitively (preserving the
 * casing of the first accepted occurrence). Used on both POST /plans and
 * PATCH /plans/:planId so the database always receives normalised data.
 */
export function normalisePlanLocalities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    const v = String(raw).replace(/\s+/g, " ").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

type PlanMeta = { sector: string | null; sectors: string[]; stateId: number | null; locationType: string | null };

// PLAN-009: single authoritative SQL fragment for a plan's effective sectors.
// Canonical model: the full `sectors` JSONB array when non-empty; else the
// legacy single `sector` column wrapped in an array; else the linked
// project's sector. Requires `plans pl LEFT JOIN projects p` aliases in the
// enclosing query.
export const EFFECTIVE_SECTORS_SQL = `
  CASE
    WHEN jsonb_array_length(COALESCE(pl.sectors, '[]'::jsonb)) > 0 THEN pl.sectors
    WHEN NULLIF(pl.sector, '') IS NOT NULL THEN jsonb_build_array(pl.sector)
    WHEN NULLIF(p.sector, '') IS NOT NULL THEN jsonb_build_array(p.sector)
    ELSE '[]'::jsonb
  END`;

/** Normalises a JSONB sectors value into a clean string array. */
function normaliseSectors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s)).filter(Boolean);
}

export async function getPlanMeta(db: QueryExecutor, planId: number): Promise<PlanMeta | undefined> {
  const r = await db.query<{ sector: string | null; sectors: unknown; stateId: number | null; locationType: string | null }>(
    `SELECT COALESCE(NULLIF(pl.sector,''), p.sector) AS sector,
            ${EFFECTIVE_SECTORS_SQL} AS "sectors",
            pl.state_id AS "stateId",
            pl.location_type AS "locationType"
     FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id
     WHERE pl.id = $1`,
    [planId],
  );
  if (r.rows.length === 0) return undefined;
  const row = r.rows[0];
  const sector = row.sector ?? null;
  const parsed = normaliseSectors(row.sectors);
  return {
    sector,
    // Defensive TS-side mirror of the SQL fallback chain: if the JSONB array is
    // empty, the effective single sector (plan → project COALESCE) stands in.
    sectors: parsed.length > 0 ? parsed : sector ? [sector] : [],
    stateId: row.stateId ?? null,
    locationType: row.locationType ?? null,
  };
}

/**
 * PLAN-009: authoritative effective-sectors resolver. Returns the full
 * sectors array for a plan (sectors JSONB → [sector] → [project sector]).
 * Returns undefined when the plan does not exist.
 */
export async function getPlanEffectiveSectors(db: QueryExecutor, planId: number): Promise<string[] | undefined> {
  const meta = await getPlanMeta(db, planId);
  if (meta === undefined) return undefined;
  return meta.sectors;
}

/**
 * PLAN-009: multi-sector TC guard. A TC is allowed when ANY of the plan's
 * effective sectors is in their assigned set. Non-TC roles are unrestricted.
 */
export function assertAnySectorAllowed(
  user: CurrentUser | undefined,
  sectors: string[],
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(user);
  if (!restriction) return { ok: true };
  if (sectors.some((s) => s && restriction.includes(s))) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

/**
 * Returns a 403 response body if a state-scoped role is accessing a plan
 * outside their state. HQ plans (locationType="hq" or stateId=null) always
 * deny state-scoped roles.
 *
 * Synchronous equality check against the Plan's already-known
 * stateId/locationType — distinct from lib/rbac.ts's async assertStateAllowed
 * (db, user, projectId), which looks up a Project's state via
 * project_states/project_assignments. The two were identically named in the
 * Express original despite checking different things, which is exactly the
 * kind of mix-up this distinct name avoids.
 */
export function assertPlanStateAllowed(
  user: CurrentUser | undefined,
  planStateId: number | null,
  planLocationType?: string | null,
): { ok: true } | { ok: false; status: 403; body: { error: string } } {
  const role = user?.role;
  const isStateRole = role === "state_program_officer" || role === "state_office_manager";
  if (!isStateRole) return { ok: true };
  // HQ plans: state-scoped users are always denied
  if (planLocationType === "hq" || planStateId === null) {
    return { ok: false, status: 403, body: { error: "hq_forbidden" } };
  }
  const userStateId = user?.stateId ?? null;
  if (userStateId === null || userStateId !== planStateId) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  return { ok: true };
}

// Exported for parity with the Express version's PLAN-ZR real-DB aggregate
// integration test note — the exact production SQL, not a copy that could drift.
export const planSummarySelect = `
  SELECT pl.id, pl.code, pl.title, pl.plan_type AS "planType", pl.frequency,
         pl.status, pl.project_id AS "projectId", p.title AS "projectTitle",
         pl.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
         pl.locality_id AS "localityId",
         COALESCE(pl.localities, '[]'::jsonb) AS "localities",
         pl.sector,
         -- PLAN-009: sectors is the authoritative effective-sectors array
         -- (sectors JSONB → [sector] → [project sector]); clients must not re-derive it.
         ${EFFECTIVE_SECTORS_SQL} AS "sectors",
         pl.responsible_name AS "responsibleName",
         pl.responsible_user_id AS "responsibleUserId", u.name AS "responsibleUserName",
         pl.start_date AS "startDate", pl.end_date AS "endDate",
         pl.budget_planned::float AS "budgetPlanned",
         pl.budget_actual::float AS "budgetActual",
         pl.funding_source AS "fundingSource",
         pl.currency,
         -- TRUE for records created before nullable budget/currency schema fix;
         -- these were silently stored as 0/USD and cannot be distinguished from genuine USD 0.
         pl.budget_legacy_unverified AS "budgetLegacyUnverified",
         -- Inferred locationType: explicit column value takes priority; fall back to state presence.
         COALESCE(pl.location_type,
           CASE WHEN pl.state_id IS NOT NULL THEN 'state' ELSE NULL END
         ) AS "locationType",
         -- Set when plan transitions to "approved" via final_approve; preserved through reopen.
         pl.last_final_approved_at AS "lastFinalApprovedAt",
         -- null when plan has no activities (genuine 0% vs no-denominator distinction)
         -- PLAN-BD-4: excludes cancelled activities; ROUND avoids int-truncation skew
         -- PLAN-015: activity aggregates come from a single pre-aggregated LEFT JOIN
         -- (pa_agg below) rather than per-row correlated subqueries.
         pa_agg."progressPct" AS "progressPct",
         COALESCE(pa_agg."activitiesCount", 0) AS "activitiesCount"
  FROM plans pl
  LEFT JOIN projects p ON p.id = pl.project_id
  LEFT JOIN states s ON s.id = pl.state_id
  LEFT JOIN users u ON u.id = pl.responsible_user_id
  LEFT JOIN (
    SELECT plan_id,
           ROUND(AVG(CASE WHEN status <> 'cancelled' THEN progress_pct END))::int AS "progressPct",
           COUNT(*)::int AS "activitiesCount"
    FROM plan_activities
    GROUP BY plan_id
  ) pa_agg ON pa_agg.plan_id = pl.id
`;

export async function getPlanActivities(db: QueryExecutor, planId: number) {
  const { rows } = await db.query(
    `SELECT pa.id, pa.plan_id AS "planId", pa.title, pa.description,
            pa.objective_index AS "objectiveIndex",
            pa.responsible_user_id AS "responsibleUserId", u.name AS "responsibleUserName",
            pa.responsible_name AS "responsibleName",
            pa.locality_name AS "localityName",
            pa.state_id AS "stateId", COALESCE(s.name, pa.state_name) AS "stateName",
            s.name_ar AS "stateNameAr",
            pa.planned_date AS "plannedDate",
            pa.target_beneficiaries AS "targetBeneficiaries",
            pa.priority,
            pa.expected_result AS "expectedResult",
            pa.start_date AS "startDate", pa.end_date AS "endDate",
            pa.status, pa.progress_pct AS "progressPct",
            pa.budget_planned::float AS "budgetPlanned",
            pa.budget_actual::float AS "budgetActual",
            pa.risk_id AS "riskId", r.title AS "riskTitle",
            pa.mitigation_action AS "mitigationAction",
            pa.expected_output AS "expectedOutput",
            pa.performance_indicator AS "performanceIndicator"
     FROM plan_activities pa
     LEFT JOIN users u ON u.id = pa.responsible_user_id
     LEFT JOIN risks r ON r.id = pa.risk_id
      LEFT JOIN states s ON s.id = pa.state_id
     WHERE pa.plan_id = $1 ORDER BY pa.id`,
    [planId],
  );
  return rows;
}

export async function getPlanLinkedRisks(db: QueryExecutor, planId: number) {
  const { rows } = await db.query(
    `SELECT r.id, r.title, r.description, r.category, r.severity, r.likelihood,
            r.status, r.state_id AS "stateId", r.project_id AS "projectId",
            r.plan_id AS "planId", r.plan_activity_id AS "planActivityId",
            r.assigned_to_id AS "assignedToId", u.name AS "assignedToName",
            r.mitigation_plan AS "mitigationPlan",
            r.follow_up_date AS "followUpDate",
            r.identified_at AS "identifiedAt"
     FROM risks r
     LEFT JOIN users u ON u.id = r.assigned_to_id
     WHERE r.plan_id = $1 OR r.plan_activity_id IN (SELECT id FROM plan_activities WHERE plan_id = $1)
     ORDER BY r.identified_at DESC`,
    [planId],
  );
  return rows;
}

export async function getPlanById(db: QueryExecutor, planId: number) {
  const r = await db.query<Record<string, unknown>>(`${planSummarySelect} WHERE pl.id = $1`, [planId]);
  if (r.rows.length === 0) return null;
  const summary = r.rows[0];
  const extras = await db.query<{ description: string | null; objectives: unknown; createdById: number | null; createdByName: string | null; createdAt: string; updatedAt: string }>(
    `SELECT pl.description, pl.objectives, pl.created_by_id AS "createdById",
            cu.name AS "createdByName", pl.created_at AS "createdAt", pl.updated_at AS "updatedAt"
     FROM plans pl LEFT JOIN users cu ON cu.id = pl.created_by_id WHERE pl.id = $1`,
    [planId],
  );
  const [activities, linkedRisks] = await Promise.all([
    getPlanActivities(db, planId),
    getPlanLinkedRisks(db, planId),
  ]);
  return {
    ...summary,
    description: extras.rows[0].description,
    objectives: extras.rows[0].objectives ?? [],
    activities,
    linkedRisks,
    createdById: extras.rows[0].createdById,
    createdByName: extras.rows[0].createdByName,
    createdAt: extras.rows[0].createdAt,
    updatedAt: extras.rows[0].updatedAt,
  };
}

/**
 * Runs the shared soft-duplicate query for the duplicate-check preflight.
 * Returns the total matching count plus the ID of the first (most recent)
 * matching plan so the accessibility check can decide whether the client may
 * be offered navigation to it.
 */
async function runSoftDuplicateQuery(
  db: QueryExecutor,
  params: unknown[],
  scopePredicate: string,
): Promise<{ count: number; firstId: number | null }> {
  const result = await db.query<{ n: number; first_id: number | null }>(
    `SELECT COUNT(*)::int AS n, MAX(id)::int AS first_id
     FROM plans
     WHERE plan_type = $1
       AND start_date = $2::date
       AND end_date   = $3::date
       AND ${scopePredicate}`,
    params,
  );
  return {
    count: result.rows[0]?.n ?? 0,
    firstId: result.rows[0]?.first_id ?? null,
  };
}

/**
 * Wave 2 soft-duplicate UX: mirrors the hard-path accessibility check.
 * Returns the plan ID only when the current actor's sector scope allows
 * viewing the matched plan (state scope is already enforced by the query's
 * scope predicate); otherwise null — no navigation is exposed out of scope.
 */
async function resolveAccessibleSoftPlanId(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  planId: number | null,
): Promise<number | null> {
  if (planId == null) return null;
  const matchedSectors = (await getPlanEffectiveSectors(db, planId)) ?? [];
  const sectorCheck = assertAnySectorAllowed(user, matchedSectors);
  return sectorCheck.ok ? planId : null;
}

export const plansRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

plansRoutes.use("/plans", attachCurrentUser, requireAuth);
plansRoutes.use("/plans/*", attachCurrentUser, requireAuth);

// ── Plan dashboard / duplicate-check registered BEFORE the :planId detail
// route (same fix as batch 3's donor-integrity-scan/duplicate-check for
// projects.ts — Hono, like Express, resolves an ambiguous static-vs-:param
// match in registration order). ──────────────────────────────────────────────
plansRoutes.get("/plans/dashboard", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const tcSectors = tcSectorRestriction(user);
    const isStateRole = user?.role === "state_office_manager" || user?.role === "state_program_officer";
    const userStateId = isStateRole ? (user?.stateId ?? null) : null;

    // Short-circuit: TC with no sector assignment sees nothing
    if (tcSectors !== null && tcSectors.length === 0) {
      const empty = { total: 0, active: 0, delayed: 0, completed: 0, draft: 0, budgetPlanned: 0, budgetActual: 0, burnRatePct: null, currency: null, currencyMixed: false, budgetByCurrency: [], riskCount: 0, activitiesTotal: 0, activitiesCompleted: 0 };
      return c.json({ totals: empty, byState: [], bySector: [], byType: [], upcomingDeadlines: [], delayedActivities: [] });
    }

    // Build parameterised conditions — order matters for $N references
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (tcSectors !== null && tcSectors.length > 0) {
      params.push(tcSectors);
      // PLAN-009: TC scope matches when ANY effective sector overlaps their assignment.
      conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${EFFECTIVE_SECTORS_SQL}) AS es WHERE es = ANY($${params.length}::text[]))`);
    }
    if (userStateId !== null) {
      params.push(userStateId);
      conditions.push(`pl.state_id = $${params.length}`);
    }

    const sectorCond = conditions.find((cnd) => cnd.includes("sector")) ?? null;
    const stateCond = conditions.find((cnd) => cnd.includes("state_id")) ?? null;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const baseFrom = `FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id ${whereClause}`;

    const delayedExtra = [
      sectorCond ? ` AND ${sectorCond}` : "",
      stateCond ? ` AND ${stateCond}` : "",
    ].join("");

    const [totals, byState, bySector, byType, upcoming, delayed, riskCount, activityRollup, budgetByCurrencyRows] = await Promise.all([
      db.query<{ status: string; n: number }>(
        `SELECT pl.status, COUNT(*)::int AS n ${baseFrom} GROUP BY pl.status`, params,
      ),
      db.query(
        `SELECT pl.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", COUNT(*)::int AS count
         FROM plans pl
         LEFT JOIN projects p ON p.id = pl.project_id
         LEFT JOIN states s ON s.id = pl.state_id
         ${whereClause}
         GROUP BY pl.state_id, s.name, s.name_ar ORDER BY count DESC`, params,
      ),
      db.query(
        `SELECT COALESCE((${EFFECTIVE_SECTORS_SQL}) ->> 0, 'Unspecified') AS sector, COUNT(*)::int AS count
         ${baseFrom} GROUP BY 1 ORDER BY count DESC`, params,
      ),
      db.query(
        `SELECT pl.plan_type AS "planType", COUNT(*)::int AS count ${baseFrom} GROUP BY pl.plan_type ORDER BY count DESC`, params,
      ),
      db.query(
        `SELECT pl.id AS "planId", pl.title, pl.end_date AS "endDate", pl.status,
                (pl.end_date - CURRENT_DATE)::int AS "daysRemaining"
         ${baseFrom}${whereClause ? " AND" : " WHERE"} pl.status NOT IN ('completed','cancelled','archived','rejected')
            AND pl.end_date >= CURRENT_DATE AND pl.end_date <= CURRENT_DATE + INTERVAL '30 days'
         ORDER BY pl.end_date ASC LIMIT 10`, params,
      ),
      db.query(
        `SELECT pa.id AS "activityId", pa.plan_id AS "planId", pl.title AS "planTitle",
                pa.title, pa.end_date AS "endDate", pa.status,
                s.name AS "stateName", s.name_ar AS "stateNameAr",
                -- daysPastDue: positive integer when past due, null otherwise (never negative)
                CASE WHEN pa.end_date IS NOT NULL AND pa.end_date < CURRENT_DATE
                     THEN (CURRENT_DATE - pa.end_date)::int
                     ELSE NULL END AS "daysPastDue",
                -- timingState: factual UI classification, not a workflow status
                CASE
                  WHEN pa.status = 'delayed' AND pa.end_date IS NOT NULL AND pa.end_date < CURRENT_DATE
                    THEN 'delayed_and_overdue'
                  WHEN pa.status = 'delayed'
                    THEN 'delayed'
                  ELSE 'overdue'
                END AS "timingState"
         FROM plan_activities pa
         JOIN plans pl ON pl.id = pa.plan_id
         LEFT JOIN projects p ON p.id = pl.project_id
         LEFT JOIN states s ON s.id = pl.state_id
         WHERE (pa.status = 'delayed' OR (pa.end_date < CURRENT_DATE AND pa.status NOT IN ('completed','cancelled')))
           ${delayedExtra}
         ORDER BY
           CASE WHEN pa.end_date IS NOT NULL AND pa.end_date < CURRENT_DATE THEN 0 ELSE 1 END ASC,
           pa.end_date ASC NULLS LAST
         LIMIT 50`, params,
      ),
      db.query<{ n: number }>(
        `SELECT COUNT(DISTINCT r.id)::int AS n FROM risks r
         JOIN plans pl ON (pl.id = r.plan_id OR pl.id = (SELECT plan_id FROM plan_activities WHERE id = r.plan_activity_id))
         LEFT JOIN projects p ON p.id = pl.project_id
         ${whereClause}`, params,
      ),
      db.query<{ total: number; completed: number }>(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN pa.status = 'completed' THEN 1 ELSE 0 END), 0)::int AS completed
         FROM plan_activities pa
         JOIN plans pl ON pl.id = pa.plan_id
         LEFT JOIN projects p ON p.id = pl.project_id
         ${whereClause}`, params,
      ),
      // PLAN-CURRENCY-MIX: budget totals grouped by Plan currency.
      db.query<{ currency: string; planned: number; actual: number }>(
        `SELECT pl.currency,
                COALESCE(SUM(pa.budget_planned)::float, 0) AS planned,
                COALESCE(SUM(pa.budget_actual)::float, 0) AS actual
         FROM plan_activities pa
         JOIN plans pl ON pl.id = pa.plan_id
         LEFT JOIN projects p ON p.id = pl.project_id
         ${whereClause}${whereClause ? " AND" : " WHERE"} pl.currency IS NOT NULL AND pl.currency <> ''
         GROUP BY pl.currency
         ORDER BY planned DESC`, params,
      ),
    ]);

    const statusMap: Record<string, number> = {};
    for (const r of totals.rows) statusMap[r.status] = r.n;
    const totalCount = Object.values(statusMap).reduce((a, b) => a + b, 0);

    // PLAN-CURRENCY-MIX: never sum budget_planned/budget_actual across
    // heterogeneous currencies into one figure.
    const budgetByCurrency = budgetByCurrencyRows.rows.map((r) => {
      const p = Number(r.planned ?? 0);
      const a = Number(r.actual ?? 0);
      return {
        currency: r.currency,
        budgetPlanned: p,
        budgetActual: a,
        burnRatePct: p > 0 ? Math.round((a / p) * 100) : null,
      };
    });
    const currencies = budgetByCurrency.map((r) => r.currency);
    const currencyMixed = currencies.length > 1;
    const currency = currencies.length === 1 ? currencies[0] : null;
    const planned = currencyMixed ? null : (budgetByCurrency[0]?.budgetPlanned ?? 0);
    const actual = currencyMixed ? null : (budgetByCurrency[0]?.budgetActual ?? 0);
    const burnRatePct = currencyMixed ? null : (planned != null && planned > 0 ? Math.round(((actual ?? 0) / planned) * 100) : null);

    // awaitingApproval: plans in the approval pipeline
    const awaitingApproval =
      (statusMap.submitted ?? 0) +
      (statusMap.technically_approved ?? 0) +
      (statusMap.coordination_approved ?? 0);

    return c.json({
      totals: {
        total: totalCount,
        active: (statusMap.active ?? 0) + (statusMap.in_progress ?? 0),
        delayed: statusMap.delayed ?? 0,
        completed: statusMap.completed ?? 0,
        draft: statusMap.draft ?? 0,
        awaitingApproval,
        statusBreakdown: statusMap,
        budgetPlanned: planned,
        budgetActual: actual,
        burnRatePct,
        currency,
        currencyMixed,
        budgetByCurrency,
        riskCount: riskCount.rows[0]?.n ?? 0,
        activitiesTotal: activityRollup.rows[0]?.total ?? 0,
        activitiesCompleted: activityRollup.rows[0]?.completed ?? 0,
      },
      byState: byState.rows,
      bySector: bySector.rows,
      byType: byType.rows,
      upcomingDeadlines: upcoming.rows,
      delayedActivities: delayed.rows,
    });
  } finally {
    close();
  }
});

/**
 * GET /plans/duplicate-check — Preflight duplicate detection for structured plan types.
 *
 * This is a best-effort preflight only. The backend CREATE guard inside the
 * transaction (POST /plans) is the authoritative duplicate check.
 *
 * PLAN-BD-2: Structured types (monthly/quarterly/annual) → matchType "hard".
 *            Irregular types (action/operational/emergency/custom) → matchType "soft".
 *            Non-blocking statuses: rejected, cancelled, archived.
 */
plansRoutes.get("/plans/duplicate-check", requirePerm("plans.create"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const planType = c.req.query("planType");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const rawProjectId = c.req.query("projectId");
    const rawStateId = c.req.query("stateId");
    const rawLocType = c.req.query("locationType");
    const rawDraftPlanId = c.req.query("draftPlanId");

    if (!planType || !PLAN_TYPES.has(planType)) {
      return c.json({ error: "invalid_plan_type" }, 400);
    }
    if (!startDate || !endDate) {
      return c.json({ error: "start_date_end_date_required" }, 400);
    }

    // Require strict YYYY-MM-DD format — do not rely on PostgreSQL date casts
    // to surface malformed values (PG is lenient on truncated inputs).
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
      return c.json({ error: "invalid_date_format", detail: "startDate and endDate must be YYYY-MM-DD" }, 400);
    }

    const projectId = rawProjectId != null ? Number(rawProjectId) : null;
    const stateId = rawStateId != null ? Number(rawStateId) : null;
    const locationType = rawLocType === "hq" ? "hq" : null;

    if (projectId !== null && (!Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0)) {
      return c.json({ error: "invalid_project_id" }, 400);
    }
    if (stateId !== null && (!Number.isFinite(stateId) || !Number.isInteger(stateId) || stateId <= 0)) {
      return c.json({ error: "invalid_state_id" }, 400);
    }

    // draftPlanId — the ID of the plan currently being edited (optional). When
    // provided, the hard check excludes this plan from the result so the user
    // is not blocked from saving their own draft after changing its dates or
    // type (self-duplicate scenario).
    let draftPlanId: number | null = null;
    if (rawDraftPlanId != null) {
      const parsed = Number(rawDraftPlanId);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        return c.json({ error: "invalid_draft_plan_id" }, 400);
      }
      draftPlanId = parsed;
    }

    // ── Scope security (mirrors CREATE validation) ────────────────────────────
    const isHq = locationType === "hq";
    const isPlannerStateRole = user.role === "state_program_officer" || user.role === "state_office_manager";
    if (isHq && isPlannerStateRole) {
      return c.json({ matchType: "none" });
    }
    if (!isHq) {
      if (stateId === null) {
        return c.json({ matchType: "none" });
      }
      const stateGuardCheck = assertPlanStateAllowed(user, stateId, null);
      if (!stateGuardCheck.ok) {
        return c.json({ matchType: "none" });
      }
    }

    // ── PLAN-BD-2: Structured vs irregular classification ─────────────────────
    const STRUCTURED_TYPES = new Set(["monthly", "quarterly", "annual"]);
    const isStructured = STRUCTURED_TYPES.has(planType);

    // ── Scope predicate (same shape for both hard and soft queries) ───────────
    const scopePredicate = `(
      ($4::int IS NOT NULL AND project_id = $4::int)
   OR ($4::int IS NULL AND $5 = 'hq' AND location_type = 'hq' AND state_id IS NULL)
   OR ($4::int IS NULL AND ($5 IS NULL OR $5 <> 'hq') AND location_type IS NULL AND state_id = $6::int)
    )`;

    const params: unknown[] = [planType, startDate, endDate, projectId, locationType, stateId];

    if (isStructured) {
      const selfExcludeClause = draftPlanId != null ? `AND id <> $7::int` : "";
      const hardParams = draftPlanId != null ? [...params, draftPlanId] : params;

      const hard = await db.query<{
        id: number; title: string; status: string;
        plan_type: string; start_date: unknown; end_date: unknown; sector: string | null;
      }>(
        `SELECT id, title, status, plan_type, start_date, end_date, sector
         FROM plans
         WHERE plan_type = $1
           AND start_date = $2::date
           AND end_date   = $3::date
           AND ${scopePredicate}
           AND status NOT IN ('rejected', 'cancelled', 'archived')
           ${selfExcludeClause}
         LIMIT 1`,
        hardParams,
      );

      if (hard.rows.length > 0) {
        const row = hard.rows[0];
        const pg = row.start_date;
        const pgE = row.end_date;
        const startIso = pg instanceof Date ? pg.toISOString().slice(0, 10) : String(pg).slice(0, 10);
        const endIso = pgE instanceof Date ? pgE.toISOString().slice(0, 10) : String(pgE).slice(0, 10);

        // ── Sector visibility check (TC restriction) ──────────────────────
        const matchedSectors = (await getPlanEffectiveSectors(db, row.id)) ?? [];
        const sectorCheck = assertAnySectorAllowed(user, matchedSectors);
        const canSeePlan = sectorCheck.ok;
        const isDraft = row.status === "draft";

        return c.json({
          matchType: "hard",
          existing: {
            planId: canSeePlan && isDraft ? row.id : null,
            title: canSeePlan ? row.title : null,
            status: canSeePlan ? row.status : null,
            planType: row.plan_type,
            startDate: startIso,
            endDate: endIso,
          },
        });
      }

      // Structured type with no hard match — also run soft warning query for awareness.
      const softStruct = await runSoftDuplicateQuery(db, params, scopePredicate);
      if (softStruct.count > 0) {
        const softPlanId = await resolveAccessibleSoftPlanId(db, user, softStruct.firstId);
        return c.json({ matchType: "soft", count: softStruct.count, planId: softPlanId });
      }

      return c.json({ matchType: "none" });
    } else {
      // ── Soft check only for irregular types ───────────────────────────────
      const softIrreg = await runSoftDuplicateQuery(db, params, scopePredicate);
      if (softIrreg.count > 0) {
        const softPlanId = await resolveAccessibleSoftPlanId(db, user, softIrreg.firstId);
        return c.json({ matchType: "soft", count: softIrreg.count, planId: softPlanId });
      }
      return c.json({ matchType: "none" });
    }
  } finally {
    close();
  }
});

plansRoutes.get("/plans", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const filters: string[] = [];
    const params: unknown[] = [];
    const planTypeQuery = c.req.query("planType");
    if (planTypeQuery) { params.push(planTypeQuery); filters.push(`pl.plan_type = $${params.length}`); }
    const frequencyQuery = c.req.query("frequency");
    if (frequencyQuery) { params.push(frequencyQuery); filters.push(`pl.frequency = $${params.length}`); }
    // State roles are clamped to their own state — a crafted ?stateId= param cannot bypass this.
    const isStateRole = user?.role === "state_program_officer" || user?.role === "state_office_manager";
    const stateIdQuery = c.req.query("stateId");
    const effectiveStateId = isStateRole
      ? (user?.stateId ?? null)
      : (stateIdQuery ? Number(stateIdQuery) : null);
    // Fail-closed: state-scoped users without an assigned stateId cannot see any plans.
    if (isStateRole && effectiveStateId === null) return c.json([]);
    if (effectiveStateId !== null) { params.push(effectiveStateId); filters.push(`pl.state_id = $${params.length}`); }
    const sectorQuery = c.req.query("sector");
    if (sectorQuery) { params.push(sectorQuery); filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${EFFECTIVE_SECTORS_SQL}) AS s WHERE s = $${params.length})`); }
    const projectIdQuery = c.req.query("projectId");
    if (projectIdQuery) { params.push(Number(projectIdQuery)); filters.push(`pl.project_id = $${params.length}`); }
    const statusQuery = c.req.query("status");
    if (statusQuery) { params.push(statusQuery); filters.push(`pl.status = $${params.length}`); }
    const responsibleUserIdQuery = c.req.query("responsibleUserId");
    if (responsibleUserIdQuery) { params.push(Number(responsibleUserIdQuery)); filters.push(`pl.responsible_user_id = $${params.length}`); }
    const searchQuery = c.req.query("search");
    if (searchQuery) {
      params.push(`%${searchQuery}%`);
      filters.push(`(pl.title ILIKE $${params.length} OR pl.code ILIKE $${params.length})`);
    }
    const tcSectors = tcSectorRestriction(user);
    if (tcSectors !== null) {
      if (tcSectors.length === 0) return c.json([]);
      params.push(tcSectors);
      // PLAN-009: TC can see a plan if any of its EFFECTIVE sectors overlaps their assignment.
      filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${EFFECTIVE_SECTORS_SQL}) AS s WHERE s = ANY($${params.length}::text[]))`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    // created_at DESC, id DESC — stable tie-breaker for plans created in the same second
    const { rows } = await db.query(`${planSummarySelect} ${where} ORDER BY pl.created_at DESC, pl.id DESC`, params);
    return c.json(rows);
  } finally {
    close();
  }
});

plansRoutes.get("/plans/:planId", async (c) => {
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const planId = Number(c.req.param("planId"));
    if (!Number.isFinite(planId)) return c.json({ error: "invalid_plan_id" }, 400);
    const meta = await getPlanMeta(db, planId);
    if (meta === undefined) return c.json({ error: "plan_not_found" }, 404);
    const sectorGuard = assertAnySectorAllowed(user, meta.sectors);
    if (!sectorGuard.ok) return c.json(sectorGuard.body, sectorGuard.status as any);
    const stateGuard = assertPlanStateAllowed(user, meta.stateId, meta.locationType);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    const plan = await getPlanById(db, planId);
    if (!plan) return c.json({ error: "plan_not_found" }, 404);
    return c.json(plan);
  } finally {
    close();
  }
});
