import { Hono } from "hono";
import { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS } from "@workspace/plan-transitions";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  permissionsFor,
  logAudit,
  tcSectorRestriction,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { assertActiveState } from "../lib/state-master";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { createRegistrationSession, validateRegistrationSession, closeRegistrationSession } from "../lib/plan-registration-session";

/**
 * Ported from artifacts/api-server/src/routes/plans.ts (3340 lines, 10
 * routes) — third file of the post-projects.ts phase, and (like
 * projects.ts) large enough to need its own batches.
 *
 * Batch A (committed earlier): GET /plans (list), GET /plans/dashboard, GET
 * /plans/duplicate-check, GET /plans/:planId (detail) — read paths only,
 * plus every shared helper these need (getPlanMeta, getPlanEffectiveSectors,
 * assertAnySectorAllowed, assertPlanStateAllowed, planSummarySelect,
 * getPlanActivities, getPlanLinkedRisks, getPlanById, the soft-duplicate
 * helpers). PLAN_TRANSITIONS/PLAN_TRANSITION_PERMS come from the shared
 * @workspace/plan-transitions package (plain data, no Node-only imports),
 * exactly as the Express original imports them — re-exported here for the
 * batches that still need the workflow table.
 *
 * Batch B (this addition): POST /plans (create) and PATCH /plans/:planId
 * (update) — the two most intricate routes in the file. Both run inside real
 * Postgres transactions with row locking (SELECT … FOR UPDATE on the plan
 * row), optimistic concurrency via x-base-revision, the dual
 * plans.update-OR-registration-session-token authorisation path (a creator
 * can PATCH their own still-draft plan without plans.update as long as they
 * present the bearer token POST /plans issued), the Save & Finish
 * (closeRegistration=true) readiness gate shared with the future submit
 * transition (locality coverage, activity completeness, budget-vs-activities
 * consistency), and the PLAN-BD-2 hard/soft duplicate guard under an
 * advisory lock.
 *
 * Deferred to later batches: POST /plans/:planId/close-registration, DELETE
 * /plans/:planId, POST /plans/:planId/transitions, POST /plans/:planId/reopen.
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

type PlanCodeClient = { query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> };

/**
 * Generates a sequential code for State plans: CAFA-PLAN-{stateCode}-NNN.
 *
 * Must be called with the open transaction client that will also perform the
 * INSERT, AFTER "BEGIN". A transaction-scoped pg_advisory_xact_lock keyed to
 * the per-state code namespace serialises concurrent creates so two requests
 * for the same State cannot both compute the same MAX+1 sequence — the same
 * pattern used for projects.code. The lock releases automatically at
 * COMMIT/ROLLBACK.
 */
async function generatePlanCode(client: PlanCodeClient, stateId: number): Promise<string> {
  const s = await client.query<{ code: string }>(`SELECT code FROM states WHERE id = $1`, [stateId]);
  const stateCode = s.rows[0]?.code ?? "XX";
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`plan_code_${stateCode}`]);
  const last = await client.query<{ code: string }>(
    `SELECT code FROM plans WHERE code LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`CAFA-PLAN-${stateCode}-%`],
  );
  let next = 1;
  if (last.rows.length > 0) {
    const m = last.rows[0].code.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `CAFA-PLAN-${stateCode}-${String(next).padStart(3, "0")}`;
}

/**
 * Generates a sequential code for HQ plans: CAFA-PLAN-HQ-NNN.
 * Same concurrency-safety contract as generatePlanCode above.
 */
async function generateHqPlanCode(client: PlanCodeClient): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["plan_code_HQ"]);
  const last = await client.query<{ code: string }>(
    `SELECT code FROM plans WHERE code LIKE 'CAFA-PLAN-HQ-%' ORDER BY id DESC LIMIT 1`,
  );
  let next = 1;
  if (last.rows.length > 0) {
    const m = last.rows[0].code.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `CAFA-PLAN-HQ-${String(next).padStart(3, "0")}`;
}

type ActivityInput = {
  id?: number | null;
  title: string;
  description?: string | null;
  objectiveIndex?: number | null;
  responsibleUserId?: number | null;
  responsibleName?: string | null;
  localityName?: string | null;
  stateId?: number | null;
  stateName?: string | null;
  plannedDate?: string | null;
  targetBeneficiaries?: number;
  priority?: string;
  expectedResult?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  progressPct?: number;
  budgetPlanned?: number;
  budgetActual?: number;
  riskId?: number | null;
  mitigationAction?: string | null;
  expectedOutput?: string | null;
  performanceIndicator?: string | null;
};

const ACTIVITY_STATUSES = new Set(["planned", "in_progress", "completed", "delayed", "cancelled"]);
/** Approved Activity priority values — single source of truth for both normalisation and readiness checks. */
const ACTIVITY_PRIORITIES = new Set(["high", "medium", "low"]);

/**
 * Plan context passed to the shared Activity-readiness validator.
 * Dates are YYYY-MM-DD strings; null means no range constraint is enforced.
 * Localities are already canonically normalised (trimmed, non-empty).
 */
interface PlanContext {
  startDate: string | null;
  endDate: string | null;
  localities: string[];
}

/**
 * Single authoritative Activity-readiness validator.
 *
 * Used consistently for POST /plans, PATCH /plans/:id (both closeRegistration=true),
 * and the future POST /plans/:id/transitions (action=submit).
 *
 * Operates on raw ActivityInput values BEFORE normalizeActivity coercion so
 * that invalid inputs (e.g. negative or decimal beneficiaries) are detected
 * rather than silently clamped.
 *
 * Returns null when all 7 conditions are satisfied, or an error-code string
 * identifying the first failing condition:
 *   1. Meaningful title (non-empty after trim)
 *   2. Locality present and belonging to Plan Geographical Coverage
 *   3. Planned date exists and falls within Plan Start … Plan End
 *   4. Priority is an approved enum value (high | medium | low)
 *   5. Target beneficiaries is a finite integer >= 0
 *   6. Planned budget is a finite number >= 0
 *   7. Meaningful Expected Result (non-empty after trim)
 *
 * Responsible Person remains intentionally optional (not checked here).
 * State is inherited from the Plan and is not validated per Activity.
 */
function validatePlanActivityReadiness(
  raw: ActivityInput,
  ctx: PlanContext,
): string | null {
  // 1. Meaningful title
  if (!String(raw.title ?? "").trim()) return "blank_title";

  // 2. Locality present and in Plan's Geographical Coverage
  const loc = raw.localityName ? String(raw.localityName).trim().replace(/\s+/g, " ") : "";
  if (!loc) return "locality_missing";
  const normLoc = loc.toLowerCase();
  const inPlan = ctx.localities.some(
    (l) => l.trim().replace(/\s+/g, " ").toLowerCase() === normLoc,
  );
  if (!inPlan) return "locality_not_in_plan";

  // 3. Planned date within Plan date range
  const pd = raw.plannedDate ? String(raw.plannedDate).slice(0, 10) : "";
  if (!pd) return "planned_date_missing";
  if (ctx.startDate && pd < ctx.startDate) return "planned_date_before_start";
  if (ctx.endDate && pd > ctx.endDate) return "planned_date_after_end";

  // 4. Priority must be an approved enum value (not merely non-empty)
  if (!ACTIVITY_PRIORITIES.has(String(raw.priority ?? ""))) return "invalid_priority";

  // 5. Beneficiaries: finite integer >= 0 — no coercion; reject invalid values
  const ben = raw.targetBeneficiaries;
  if (
    ben === undefined ||
    ben === null ||
    !Number.isFinite(ben) ||
    ben < 0 ||
    !Number.isInteger(ben)
  ) return "invalid_beneficiaries";

  // 6. Budget: finite number >= 0 — no coercion; reject invalid values
  const bud = raw.budgetPlanned;
  if (bud === undefined || bud === null || !Number.isFinite(bud) || bud < 0) {
    return "invalid_budget";
  }

  // 7. Meaningful Expected Result
  if (!String(raw.expectedResult ?? "").trim()) return "blank_expected_result";

  return null; // all 7 conditions satisfied
}

/** Approved Plan-level currency codes — must match the frontend CURRENCIES constant. */
const VALID_CURRENCIES = new Set(["USD", "SDG", "EUR", "AED"]);

/**
 * Shared Plan Budget readiness validator.
 *
 * Used consistently for POST /plans, PATCH /plans/:id (both
 * closeRegistration=true), and the future POST /plans/:id/transitions
 * (action=submit).
 *
 * Conditions:
 *   1. Currency is a supported ISO code.
 *   2. Plan Planned Budget is a finite number >= 0.
 *   3. Sum of Activity Planned Budgets does not exceed Plan Planned Budget.
 */
function validatePlanBudgetReadiness(
  currency: string,
  budgetPlanned: number,
  activityBudgetTotal: number,
): string | null {
  if (!VALID_CURRENCIES.has(currency)) return "invalid_currency";
  if (!Number.isFinite(budgetPlanned) || budgetPlanned < 0) return "invalid_budget_planned";
  if (activityBudgetTotal > budgetPlanned) return "activity_budget_exceeds_plan";
  return null;
}

/** Normalise a pg Date-or-string column value to a YYYY-MM-DD string, or null. */
function pgDateToIso(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/**
 * Parse and validate a responsible-user ID from an untrusted request value.
 * Returns the numeric ID if valid, null if the value is null/undefined, or
 * "invalid" if the value is present but not a positive finite integer.
 */
function parseResponsibleUserId(val: unknown): number | null | "invalid" {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

/**
 * Validate a plan date range. Returns an error message string on failure, null on success.
 * Accepts ISO-format date strings or null/undefined.
 * end_date must be >= start_date when both are supplied.
 * Rejects impossible calendar dates (e.g. 2026-02-30) using strict parsing.
 */
function validatePlanDates(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string | null {
  if (!startDate && !endDate) return null; // both absent — valid (draft)

  // Strict calendar-date parser: rejects impossible dates that JS Date normalises
  function parseStrictDate(val: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
    const [y, m, d] = val.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return null; // calendar normalised — date was impossible
    }
    return dt;
  }

  if (startDate) {
    const parsed = parseStrictDate(startDate);
    if (!parsed) return "invalid_start_date";
  }
  if (endDate) {
    const parsed = parseStrictDate(endDate);
    if (!parsed) return "invalid_end_date";
  }
  if (startDate && endDate) {
    const s = parseStrictDate(startDate)!;
    const e = parseStrictDate(endDate)!;
    if (e < s) return "end_date_before_start_date";
  }
  return null;
}

/**
 * Sentinel class for 422 data-integrity validation failures that must fire inside
 * a transaction so ROLLBACK always fires before the error response is sent.
 * Used by both POST /plans and PATCH /plans/:id handlers.
 */
class PlanValidationError extends Error {
  constructor(public readonly code: string, public readonly field?: string) { super(code); }
}

/** Thrown when one or more activities violate the status/progress consistency contract (PLAN-BD-4). */
class ActivityProgressValidationError extends Error {
  constructor(public readonly details: string[]) { super("activity_progress_invalid"); }
}

/**
 * Sentinel class for readiness-validation failures (Save & Finish) that occur
 * inside the transaction. Throwing this (instead of returning early) ensures
 * ROLLBACK always fires before the 400 response is sent.
 */
class CloseRegistrationError extends Error {
  constructor(public readonly code: string) { super(code); }
}

/**
 * Look up a user and verify they are active.
 * Returns null when valid or not supplied.
 * Returns an error-key string if the user is nonexistent or not active.
 *
 * Pass `pgClient` when calling from inside an open transaction — this issues
 * a SELECT … FOR SHARE which serialises concurrent user deactivations against
 * the assignment write: any concurrent UPDATE to users.status on the same row
 * will block until this transaction commits or rolls back.
 */
async function validateResponsibleUser(
  db: QueryExecutor,
  userId: number | null | undefined,
  pgClient?: QueryExecutor,
): Promise<string | null> {
  if (userId == null) return null; // NULL is valid
  const sql = pgClient
    ? `SELECT status FROM users WHERE id = $1 FOR SHARE`
    : `SELECT status FROM users WHERE id = $1`;
  const { rows } = await (pgClient ?? db).query<{ status: string }>(sql, [userId]);
  if (rows.length === 0) return "responsible_user_not_found";
  if (rows[0].status !== "active") return "responsible_user_not_active";
  return null;
}

/**
 * RISK-007: verify a plan-activity risk reference points to an existing risk.
 * Bare existence check only. Returns "risk_not_found" or null (valid).
 *
 * RISK-005 (concurrency): plan_activities.risk_id has no DB-level FK, so the
 * existence check locks the risk row FOR SHARE on the transaction client and
 * the lock is held through the subsequent plan-activity write.
 */
async function validateRiskReference(
  db: QueryExecutor,
  riskId: number | null | undefined,
  pgClient?: QueryExecutor,
): Promise<string | null> {
  if (riskId == null) return null; // NULL is valid — activity without a linked risk
  const sql = `SELECT id FROM risks WHERE id = $1 FOR SHARE`;
  const { rows } = await (pgClient ?? db).query<{ id: number }>(sql, [riskId]);
  return rows.length === 0 ? "risk_not_found" : null;
}

function normalizeActivity(a: ActivityInput) {
  const status = a.status && ACTIVITY_STATUSES.has(a.status) ? a.status : "planned";
  const progressPct = Math.max(0, Math.min(100, Number(a.progressPct ?? 0)));
  const plannedDate = a.plannedDate || null;
  return {
    title: String(a.title ?? "").trim(),
    description: a.description ?? null,
    objectiveIndex: a.objectiveIndex == null ? null : Number(a.objectiveIndex),
    responsibleUserId: a.responsibleUserId == null ? null : Number(a.responsibleUserId),
    responsibleName: a.responsibleName ? String(a.responsibleName).trim() : null,
    localityName: a.localityName ? String(a.localityName).trim() : null,
    stateId: a.stateId == null ? null : Number(a.stateId),
    stateName: a.stateName ? String(a.stateName).trim() : null,
    plannedDate,
    targetBeneficiaries: Math.max(0, Number(a.targetBeneficiaries ?? 0)),
    priority: ACTIVITY_PRIORITIES.has(String(a.priority ?? "")) ? String(a.priority) : "medium",
    expectedResult: a.expectedResult ? String(a.expectedResult).trim() : null,
    startDate: a.startDate || plannedDate,
    endDate: a.endDate || plannedDate,
    status,
    progressPct,
    budgetPlanned: Math.max(0, Number(a.budgetPlanned ?? 0)),
    budgetActual: Math.max(0, Number(a.budgetActual ?? 0)),
    riskId: a.riskId == null ? null : Number(a.riskId),
    mitigationAction: a.mitigationAction ?? null,
    expectedOutput: a.expectedOutput ?? null,
    performanceIndicator: a.performanceIndicator ?? null,
  };
}

/**
 * PLAN-BD-4: Status/progress consistency contract.
 *
 * completed   → must be exactly 100
 * in_progress → must be 1–99 inclusive
 * planned     → must be 0–99 inclusive
 * delayed     → must be 0–99 inclusive
 * cancelled   → 0–100 (historical; no status-driven constraint beyond bounds)
 */
function validateActivityProgressConsistency(
  status: string,
  progressPct: number,
): string | null {
  switch (status) {
    case "completed":
      if (progressPct !== 100)
        return "Completed activities must have 100% progress.";
      break;
    case "in_progress":
      if (progressPct < 1 || progressPct > 99)
        return "In-progress activities must have progress between 1% and 99%.";
      break;
    case "planned":
    case "delayed":
      if (progressPct < 0 || progressPct > 99)
        return `${status.charAt(0).toUpperCase() + status.slice(1)} activities must have progress between 0% and 99%.`;
      break;
    case "cancelled":
      if (progressPct < 0 || progressPct > 100)
        return "Progress must be between 0% and 100%.";
      break;
    default:
      return "Unsupported activity status.";
  }
  return null;
}

/**
 * Validate and collect status/progress errors for an activity array (PLAN-BD-4).
 *
 * Runs in two stages per activity so that `normalizeActivity` coercions never
 * silently mask bad client input:
 *   Stage 1 — RAW: reject explicitly supplied unsupported status, non-numeric
 *     progress, and progress outside 0–100 BEFORE normalizeActivity runs.
 *   Stage 2 — CONSISTENCY: normalize, then check the status+progressPct
 *     combination against the PLAN-BD-4 contract.
 */
function collectActivityProgressErrors(activities: ActivityInput[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < activities.length; i++) {
    const raw = activities[i];
    const titleRaw = String(raw.title ?? "").trim();
    const label = titleRaw ? `"${titleRaw}"` : `#${i + 1}`;

    // ── Stage 1: Raw input validation (before normalisation) ─────────────────
    if (raw.status != null && raw.status !== "" && !ACTIVITY_STATUSES.has(raw.status)) {
      errors.push(
        `Activity ${i + 1} (${label}): Unsupported status "${raw.status}". ` +
        `Allowed: ${[...ACTIVITY_STATUSES].join(", ")}.`,
      );
      continue; // skip consistency check — status is already invalid
    }
    if (raw.progressPct != null) {
      const rawPct = Number(raw.progressPct);
      if (!Number.isFinite(rawPct)) {
        errors.push(`Activity ${i + 1} (${label}): Progress must be a number (got "${raw.progressPct}").`);
        continue;
      }
      if (rawPct < 0 || rawPct > 100) {
        errors.push(`Activity ${i + 1} (${label}): Progress must be between 0% and 100% (got ${rawPct}).`);
        continue;
      }
    }

    // ── Stage 2: Status/progress consistency (after normalisation) ────────────
    const a = normalizeActivity(raw);
    if (!a.title) continue; // blank-title rows are skipped during INSERT/UPDATE
    const err = validateActivityProgressConsistency(a.status, a.progressPct);
    if (err) errors.push(`Activity ${i + 1} (${label}): ${err}`);
  }
  return errors;
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

// ── Plan create ────────────────────────────────────────────────────────────
plansRoutes.post("/plans", requirePerm("plans.create"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const title = String(body.title ?? "").trim();
    const frequency = String(body.frequency ?? "monthly");
    if (!title) return c.json({ error: "title_required" }, 400);
    if (body.frequency && !PLAN_FREQUENCIES.has(frequency)) return c.json({ error: "invalid_frequency" }, 400);

    // ── Location: HQ or State ────────────────────────────────────────────────
    const rawPlanLocationType = body.locationType === "hq" ? "hq" : null;
    const isHqPlan = rawPlanLocationType === "hq";
    const isPlannerStateRole = user.role === "state_program_officer" || user.role === "state_office_manager";

    let stateId = 0; // 0 used as sentinel for HQ plans (not stored)
    if (isHqPlan) {
      // HQ plan: stateId is not required; state-scoped users are denied
      if (isPlannerStateRole) {
        return c.json({ error: "hq_forbidden", message: "State-scoped users cannot create HQ plans." }, 403);
      }
      // Reject invalid combination: locationType=hq cannot include a stateId
      if (body.stateId != null) {
        return c.json({ error: "invalid_location_combination", message: "locationType=hq cannot be combined with a stateId." }, 400);
      }
    } else {
      // State plan: stateId required
      stateId = Number(body.stateId);
      if (!Number.isFinite(stateId) || stateId === 0) return c.json({ error: "stateId_required" }, 400);
      const activeState = await assertActiveState(db, stateId);
      if (!activeState.ok) {
        return c.json({ error: activeState.error, message: "Plans can only be created for an active State." }, 422);
      }
      // State roles may only create plans within their own assigned state.
      const stateGuardCreate = assertPlanStateAllowed(user, stateId, null);
      if (!stateGuardCreate.ok) return c.json(stateGuardCreate.body, stateGuardCreate.status as any);
    }

    // Save & Finish (closeRegistration=true) requires the complete Plan Details dataset.
    // Draft-only saves require only the minimum: title + state.
    const isCompleteSave = body.closeRegistration === true;

    // Plan type: always validated when provided; required only for complete saves.
    const planType = body.planType ? String(body.planType) : null;
    if (planType !== null && !PLAN_TYPES.has(planType)) return c.json({ error: "invalid_plan_type" }, 400);
    if (isCompleteSave && !planType) return c.json({ error: "invalid_plan_type" }, 400);

    // Dates: required for complete saves; absent dates are allowed for drafts.
    if (isCompleteSave && (!body.startDate || !body.endDate)) {
      return c.json({ error: "start_date_end_date_required" }, 422);
    }

    // Validate date range using raw input — reject non-YYYY-MM-DD values before
    // any truncation. After passing validation, persist only the canonical
    // 10-char ISO form.
    const canonStartDate: string | null = body.startDate ? String(body.startDate).slice(0, 10) : null;
    const canonEndDate: string | null = body.endDate ? String(body.endDate).slice(0, 10) : null;
    const postDateError = validatePlanDates(
      body.startDate ? String(body.startDate) : null,
      body.endDate ? String(body.endDate) : null,
    );
    if (postDateError) return c.json({ error: postDateError }, 422);

    const sectors: string[] = Array.isArray(body.sectors) ? body.sectors.map(String).filter(Boolean) : [];
    const responsibleName = body.responsibleName ? String(body.responsibleName).trim() : "";

    // Sectors and responsible person: required for complete saves; optional for drafts.
    if (isCompleteSave) {
      if (sectors.length === 0) return c.json({ error: "at_least_one_sector_required" }, 400);
      if (!responsibleName) return c.json({ error: "responsible_name_required" }, 400);
    }

    // Canonical sector validation — reject any sector not in the approved 7-sector list.
    const invalidSectors = sectors.filter((s) => !VALID_SECTOR_SET.has(s));
    if (invalidSectors.length > 0) {
      return c.json({
        error: "invalid_sector", field: "sectors", code: "invalid_sector",
        message: `Unrecognised sector(s): ${invalidSectors.join(", ")}. Allowed: ${[...VALID_SECTOR_SET].join(", ")}`,
      }, 422);
    }

    // Reject duplicate sectors with a structured error
    const seenSectors = new Set<string>();
    const duplicateSectors = sectors.filter((s) => {
      if (seenSectors.has(s)) return true;
      seenSectors.add(s);
      return false;
    });
    if (duplicateSectors.length > 0) {
      return c.json({
        error: "duplicate_sector", field: "sectors", code: "duplicate_sector",
        message: `Duplicate sector(s): ${[...new Set(duplicateSectors)].join(", ")}. Each sector must appear at most once.`,
      }, 422);
    }

    // Use first sector as the legacy single-sector field for backward compat.
    const sector = sectors[0] ?? null;
    let effectiveSector: string | null = sector;
    if (!effectiveSector && body.projectId) {
      const p = await db.query<{ sector: string }>(`SELECT sector FROM projects WHERE id = $1`, [Number(body.projectId)]);
      effectiveSector = p.rows[0]?.sector ?? null;
    }
    // Only apply the sector scope guard when the plan has a concrete sector assignment.
    if (sectors.length > 0 || effectiveSector) {
      const guard = assertAnySectorAllowed(user, sectors.length > 0 ? sectors : [effectiveSector as string]);
      if (!guard.ok) return c.json(guard.body, guard.status as any);
    }

    // Save & Finish on first save: caller passes closeRegistration=true to signal
    // that the session should be closed within the same creation transaction so
    // no active session survives COMMIT.
    const doCloseOnCreate = body.closeRegistration === true;

    const objectives = Array.isArray(body.objectives) ? body.objectives : [];
    const activities: ActivityInput[] = Array.isArray(body.activities) ? body.activities : [];
    const localities = normalisePlanLocalities(body.localities);

    // ── Save & Finish (closeRegistration=true) pre-transaction validation ────────
    if (doCloseOnCreate) {
      if (localities.length === 0) return c.json({ error: "geographical_coverage_required" }, 400);
      if (activities.length === 0) return c.json({ error: "at_least_one_activity_required" }, 400);
      const postPlanCtx: PlanContext = { startDate: canonStartDate, endDate: canonEndDate, localities };
      const hasCompleteOnCreate = activities.some((a) => validatePlanActivityReadiness(a, postPlanCtx) === null);
      if (!hasCompleteOnCreate) return c.json({ error: "at_least_one_complete_activity_required" }, 400);
      // Budget consistency — uses the shared validatePlanBudgetReadiness helper.
      const actBudgetTotalOnCreate = activities.reduce((s, raw) => {
        const v = Number(raw.budgetPlanned ?? 0);
        return s + (Number.isFinite(v) && v >= 0 ? v : 0);
      }, 0);
      const budgetIssueOnCreate = validatePlanBudgetReadiness(
        String(body.currency ?? ""), Number(body.budgetPlanned ?? NaN), actBudgetTotalOnCreate,
      );
      if (budgetIssueOnCreate) return c.json({ error: budgetIssueOnCreate }, 400);
    }

    // ── Activity status/progress consistency validation (PLAN-BD-4) ─────────────
    // Pure computation — runs before the transaction to avoid an unnecessary
    // ROLLBACK when the caller passes contradictory status+progressPct values.
    if (activities.length > 0) {
      const progressErrors = collectActivityProgressErrors(activities);
      if (progressErrors.length > 0) {
        return c.json({ error: "activity_progress_invalid", details: progressErrors }, 422);
      }
    }

    await client.query("BEGIN");

    // ── PLAN-BD-2: Hard duplicate guard for structured plan types ─────────────
    // Structured types (monthly/quarterly/annual) use a backend hard guard.
    // Irregular types skip this — soft warning is frontend-only.
    // Advisory lock serialises concurrent creates with the same canonical identity.
    const STRUCTURED_PLAN_TYPES = new Set(["monthly", "quarterly", "annual"]);
    if (planType && STRUCTURED_PLAN_TYPES.has(planType) && canonStartDate && canonEndDate) {
      const lockProjectId = body.projectId == null ? null : Number(body.projectId);
      const lockStateId = isHqPlan ? null : stateId;
      const lockLocType = isHqPlan ? "hq" : null;

      // Deterministic scope-branch lock key (PLAN-BD-2 race safety):
      //   project-linked → "project:<id>", HQ → "hq", state-standalone → "state:<id>"
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtext($1 || $2 || $3 ||
             CASE
               WHEN $4::text IS NOT NULL THEN 'project:' || $4::text
               WHEN $5 = 'hq'           THEN 'hq'
               ELSE 'state:' || COALESCE($6::text, '')
             END
           )
         )`,
        [planType, canonStartDate, canonEndDate,
         lockProjectId == null ? null : String(lockProjectId),
         lockLocType,
         lockStateId == null ? null : String(lockStateId)],
      );

      // Hard duplicate check — same scope predicate as GET /plans/duplicate-check.
      const dupScopePredicate = `(
          ($4::int IS NOT NULL AND project_id = $4::int)
       OR ($4::int IS NULL AND $5 = 'hq' AND location_type = 'hq' AND state_id IS NULL)
       OR ($4::int IS NULL AND ($5 IS NULL OR $5 <> 'hq') AND location_type IS NULL AND state_id = $6::int)
      )`;
      const dupResult = await client.query<{ id: number; status: string; sector: string | null }>(
        `SELECT id, status, sector FROM plans
         WHERE plan_type = $1
           AND start_date = $2::date
           AND end_date   = $3::date
           AND ${dupScopePredicate}
           AND status NOT IN ('rejected', 'cancelled', 'archived')
         LIMIT 1`,
        [planType, canonStartDate, canonEndDate, lockProjectId, lockLocType, lockStateId],
      );

      if (dupResult.rows.length > 0) {
        await client.query("ROLLBACK");
        const existing = dupResult.rows[0];
        // Sector visibility check: TC actors must not receive metadata for
        // plans outside their assigned sector(s) — even in a 409 response.
        const dupSectors = (await getPlanEffectiveSectors(db, existing.id)) ?? [];
        const dupSectorCheck = assertAnySectorAllowed(user, dupSectors);
        const canSeeExisting = dupSectorCheck.ok;
        return c.json({
          error: "plan_duplicate_exists",
          existing: {
            planId: canSeeExisting && existing.status === "draft" ? existing.id : null,
            status: canSeeExisting ? existing.status : null,
          },
        }, 409);
      }
    }

    // ── Responsible user validation — plan-level (inside transaction) ─────────
    // Uses FOR SHARE to lock the user row and serialise concurrent deactivations
    // against the INSERT write that immediately follows.
    const parsedPostResp = parseResponsibleUserId(body.responsibleUserId);
    if (parsedPostResp === "invalid") throw new PlanValidationError("invalid_responsible_user_id");
    const postPlanRespError = await validateResponsibleUser(db, parsedPostResp, client);
    if (postPlanRespError) throw new PlanValidationError(postPlanRespError);

    // ── Responsible user validation — activity-level (inside transaction) ─────
    // All activities on POST are new inserts — no grandfathering needed.
    for (const rawAct of activities) {
      const parsedActResp = parseResponsibleUserId(rawAct.responsibleUserId);
      if (parsedActResp === "invalid") throw new PlanValidationError("invalid_responsible_user_id", "activities.responsibleUserId");
      const actRespErr = await validateResponsibleUser(db, parsedActResp, client);
      if (actRespErr) throw new PlanValidationError(actRespErr, "activities.responsibleUserId");
      if (rawAct.stateId != null) {
        const activeState = await assertActiveState(db, Number(rawAct.stateId));
        if (!activeState.ok) throw new PlanValidationError(activeState.error, "activities.stateId");
      }
      // RISK-007: risk_id must reference an existing risk
      const actRiskErr = await validateRiskReference(db, rawAct.riskId == null ? null : Number(rawAct.riskId), client);
      if (actRiskErr) throw new PlanValidationError(actRiskErr, "activities.riskId");
    }
    // PLAN-CODE-RACE: generated last, inside this same transaction, so the
    // advisory lock it acquires is held right up to this INSERT and released
    // only at COMMIT/ROLLBACK — no window for a second concurrent create to
    // compute the same sequence number.
    const code = isHqPlan ? await generateHqPlanCode(client) : await generatePlanCode(client, stateId);
    const planRes = await client.query<{ id: number }>(
      `INSERT INTO plans (code, title, plan_type, frequency, project_id, state_id, locality_id,
                          localities, sector, sectors, responsible_name, responsible_user_id,
                          start_date, end_date, status, description,
                          objectives, budget_planned, budget_actual, funding_source, currency,
                          location_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23)
       RETURNING id`,
      [
        code, title, planType ?? null, frequency,
        body.projectId == null ? null : Number(body.projectId),
        isHqPlan ? null : stateId,   // state_id: NULL for HQ plans
        body.localityId == null ? null : Number(body.localityId),
        JSON.stringify(localities),
        sector ?? null,
        JSON.stringify(sectors),
        responsibleName || null,
        parsedPostResp,
        canonStartDate, canonEndDate,  // canonical YYYY-MM-DD, not raw body values
        "draft", // status is always forced to draft on creation; use /transitions to advance workflow
        body.description ?? null,
        JSON.stringify(objectives),
        body.budgetPlanned != null ? Number(body.budgetPlanned) : null,
        body.budgetActual != null ? Number(body.budgetActual) : null,
        body.fundingSource ? String(body.fundingSource).trim() : null,
        body.currency ? String(body.currency).trim() : null,
        isHqPlan ? "hq" : null,      // location_type
        user.id,
      ],
    );
    const planId = planRes.rows[0].id;

    for (const raw of activities) {
      const a = normalizeActivity(raw);
      if (!a.title) continue;
      await client.query(
        `INSERT INTO plan_activities
           (plan_id, title, description, objective_index, responsible_user_id, responsible_name,
            locality_name, state_id, state_name, planned_date, target_beneficiaries, priority,
            expected_result, start_date, end_date,
            status, progress_pct, budget_planned, budget_actual, risk_id, mitigation_action,
            expected_output, performance_indicator)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          planId, a.title, a.description, a.objectiveIndex, a.responsibleUserId,
          a.responsibleName, a.localityName,
          a.stateId, a.stateName, a.plannedDate, a.targetBeneficiaries, a.priority,
          a.expectedResult,
          a.startDate, a.endDate, a.status, a.progressPct,
          a.budgetPlanned, a.budgetActual, a.riskId, a.mitigationAction,
          a.expectedOutput, a.performanceIndicator,
        ],
      );
    }
    // ── Registration session — created atomically inside the same transaction ─
    // If the INSERT fails, the whole transaction rolls back and no orphan Plan
    // row is left behind. The raw token is captured here and (conditionally)
    // returned to the client after COMMIT; only the hash is stored in DB.
    const rawToken = await createRegistrationSession(client, planId, user.id);

    // ── Initial Save & Finish (Path B) ────────────────────────────────────
    // When closeRegistration=true is set on POST, close the newly created
    // session within the same transaction so no active session survives COMMIT.
    if (doCloseOnCreate) {
      await closeRegistrationSession(client, planId, user.id, rawToken);
    }

    await client.query("COMMIT");

    // ── Post-COMMIT side-effects (non-critical — Plan already persisted) ────
    await logAudit(db, {
      userId: user.id, action: "create", module: "plans", entityId: planId,
      newValue: `${code} ${title}`,
    });

    const plan = await getPlanById(db, planId);

    // Dropped (deferred to the notifications-engine port): "plan_assigned"
    // notice to the responsible user (F2).

    // Emit the correct lifecycle audit event:
    //   Save As Draft   → registration_started  (active session returned to client)
    //   Save & Finish   → registration_completed (session closed in same transaction)
    await logAudit(db, {
      userId: user.id,
      action: doCloseOnCreate ? "registration_completed" : "registration_started",
      module: "plans", entityId: planId,
      newValue: `${code} ${title}`,
    });
    // Dropped: realtime.broadcastUpdate (Durable Objects phase).

    if (doCloseOnCreate) {
      // Registration already closed — do NOT return a usable token.
      return c.json(plan, 201);
    } else {
      // Return the raw token once — it is a bearer credential and must not be
      // logged, stored in the DB, or exposed outside this single HTTP response.
      return c.json({ ...(plan as object), registrationToken: rawToken }, 201);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof PlanValidationError) {
      return c.json({ error: err.code, ...(err.field ? { field: err.field } : {}) }, 422);
    }
    // PostgreSQL CHECK constraint violation (code 23514 = check_violation).
    if (err && typeof (err as { code?: string }).code === "string" && (err as { code: string }).code === "23514") {
      return c.json({ error: "end_date_before_start_date" }, 422);
    }
    // Unique violation on plans.code — defence-in-depth backstop.
    if (
      typeof err === "object" && err !== null &&
      (err as { code?: string }).code === "23505" &&
      String((err as { constraint?: string }).constraint ?? "").includes("plans_code_unique")
    ) {
      return c.json({ error: "plan_code_conflict" }, 409);
    }
    throw err;
  } finally {
    client.release();
    close();
  }
});

// ── Plan update ────────────────────────────────────────────────────────────
plansRoutes.patch("/plans/:planId", async (c) => {
  const user = c.get("currentUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    // ── Permission check (two valid paths) ───────────────────────────────────
    // Path 1 (normal): user holds plans.update.
    // Path 2 (registration-session): user holds plans.create AND presents a
    //   valid, unexpired, unclosed Registration session token for this exact
    //   plan and user. plans.create does NOT permanently grant plans.update.
    const perms = permissionsFor(user);
    const hasUpdatePerm = perms.includes("*") || perms.includes("plans.update");
    const hasCreatePerm = perms.includes("*") || perms.includes("plans.create");
    if (!hasUpdatePerm && !hasCreatePerm) {
      return c.json({ error: "forbidden", requiredPermission: "plans.update" }, 403);
    }

    const planId = Number(c.req.param("planId"));
    if (!Number.isFinite(planId)) return c.json({ error: "invalid_plan_id" }, 400);
    const meta = await getPlanMeta(db, planId);
    if (meta === undefined) return c.json({ error: "plan_not_found" }, 404);
    const guard = assertAnySectorAllowed(user, meta.sectors);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = assertPlanStateAllowed(user, meta.stateId, meta.locationType);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);

    const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, any>;

    // ── Resolve registration-session eligibility ──────────────────────────────
    // Runs only when user lacks plans.update. Creator identity, draft status,
    // and approvalCount are NOT sufficient — a valid server-side session token
    // is required on every request.
    const rawToken: string = typeof rawBody.registrationToken === "string" ? rawBody.registrationToken : "";
    if (!hasUpdatePerm) {
      if (!rawToken) {
        return c.json({
          error: "forbidden",
          message: "plans.update is required to edit an existing Plan. No active Registration session was provided.",
          requiredPermission: "plans.update",
        }, 403);
      }
      const sessionOk = await validateRegistrationSession(db, rawToken, planId, user.id);
      if (!sessionOk) {
        return c.json({
          error: "registration_session_invalid",
          message: "The Registration session is expired, closed, or does not match this Plan and user.",
          requiredPermission: "plans.update",
        }, 403);
      }
      // Additional safety: plan must still be in draft status.
      const planStatusRow = await db.query<{ status: string }>(`SELECT status FROM plans WHERE id = $1`, [planId]);
      if (planStatusRow.rows[0]?.status !== "draft") {
        return c.json({
          error: "registration_session_invalid",
          message: "Registration-session editing is only permitted while the Plan is in Draft status.",
          requiredPermission: "plans.update",
        }, 403);
      }
      // Registration session active: allow this request to proceed.
    }

    // Explicitly strip the Registration session bearer token and the close-session
    // flag from the body before any field is read for audit or update purposes —
    // these are control/credential fields and must never appear in audit values.
    const { registrationToken: _tokenRedacted, closeRegistration, ...body } = rawBody;

    const before = await db.query<{
      status: string;
      lastFinalApprovedAt: Date | null;
      start_date: Date | string | null;
      end_date: Date | string | null;
      title: string;
      responsible_user_id: number | null;
    }>(
      `SELECT status, last_final_approved_at AS "lastFinalApprovedAt", start_date, end_date, title, responsible_user_id FROM plans WHERE id = $1`,
      [planId],
    );
    if (before.rows.length === 0) return c.json({ error: "plan_not_found" }, 404);

    // §§7–8: Enforce historical edit lock — current status alone is NOT sufficient.
    const editable = await isPlanCurrentlyEditable(
      db, planId, before.rows[0].status, before.rows[0].lastFinalApprovedAt,
    );
    if (!editable) {
      return c.json({ error: "plan_approval_locked", message: "This Plan is Approved and must be reopened before it can be edited." }, 409);
    }

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    };
    if (body.title !== undefined) set("title", String(body.title).trim());
    if (body.planType !== undefined) {
      if (!PLAN_TYPES.has(body.planType)) return c.json({ error: "invalid_plan_type" }, 400);
      set("plan_type", body.planType);
    }
    if (body.frequency !== undefined) {
      if (body.frequency && !PLAN_FREQUENCIES.has(body.frequency)) return c.json({ error: "invalid_frequency" }, 400);
      set("frequency", body.frequency || "monthly");
    }
    if (body.projectId !== undefined) set("project_id", body.projectId == null ? null : Number(body.projectId));
    if (body.stateId !== undefined) {
      const patchStateId = Number(body.stateId);
      if (!Number.isSafeInteger(patchStateId) || patchStateId < 1) {
        return c.json({ error: "invalid_state" }, 400);
      }
      if (patchStateId !== meta.stateId) {
        // Authorisation must cover the destination as well as the Plan's current State.
        const targetStateGuard = assertPlanStateAllowed(user, patchStateId, meta.locationType);
        if (!targetStateGuard.ok) return c.json(targetStateGuard.body, targetStateGuard.status as any);
        // A new target must exist and be active before it can be persisted.
        const activeState = await assertActiveState(db, patchStateId);
        if (!activeState.ok) {
          return c.json({ error: activeState.error, message: "Plans can only be assigned to an active State." }, 422);
        }
      }
      set("state_id", patchStateId);
    }
    if (body.localityId !== undefined) set("locality_id", body.localityId == null ? null : Number(body.localityId));
    let patchLocalities: string[] | undefined;
    if (body.localities !== undefined) {
      const locs = normalisePlanLocalities(body.localities);
      patchLocalities = locs;
      params.push(JSON.stringify(locs));
      setClauses.push(`localities = $${params.length}::jsonb`);
    }
    // Save & Finish (closeRegistration=true) requires at least one meaningful Locality.
    if (closeRegistration === true && patchLocalities !== undefined && patchLocalities.length === 0) {
      return c.json({ error: "geographical_coverage_required" }, 400);
    }

    // Legacy sector / canonical sectors consistency: the legacy column must
    // remain the first element of the canonical sectors array.
    let patchSector: string | null | undefined; // undefined = not in PATCH body
    if (body.sector !== undefined) {
      const sec = body.sector || null;
      if (sec && !VALID_SECTOR_SET.has(sec)) {
        return c.json({ error: "invalid_sector", field: "sector", code: "invalid_sector", message: `"${sec}" is not a recognised main sector.` }, 422);
      }
      patchSector = sec;
    }
    if (body.sectors === undefined && patchSector !== undefined) {
      // Sector-only PATCH: only meaningful on a single-sector plan.
      if (meta.sectors.length > 1) {
        return c.json({
          error: "sector_conflicts_with_sectors", field: "sector", code: "sector_conflicts_with_sectors",
          message: "This plan has multiple sectors. Update the sectors list instead of the single legacy sector field.",
        }, 422);
      }
      set("sector", patchSector);
      params.push(JSON.stringify(patchSector ? [patchSector] : []));
      setClauses.push(`sectors = $${params.length}::jsonb`);
    }
    if (body.sectors !== undefined) {
      const secs: string[] = Array.isArray(body.sectors) ? body.sectors.map(String).filter(Boolean) : [];
      const badSecs = secs.filter((s) => !VALID_SECTOR_SET.has(s));
      if (badSecs.length > 0) {
        return c.json({ error: "invalid_sector", field: "sectors", code: "invalid_sector", message: `Unrecognised sector(s): ${badSecs.join(", ")}` }, 422);
      }
      const patchSeenSectors = new Set<string>();
      const patchDupSectors = secs.filter((s) => {
        if (patchSeenSectors.has(s)) return true;
        patchSeenSectors.add(s);
        return false;
      });
      if (patchDupSectors.length > 0) {
        return c.json({ error: "duplicate_sector", field: "sectors", code: "duplicate_sector", message: `Duplicate sector(s): ${[...new Set(patchDupSectors)].join(", ")}. Each sector must appear at most once.` }, 422);
      }
      // Paired sector/sectors payload: legacy sector must equal the first element.
      if (patchSector !== undefined && secs.length > 0 && patchSector !== secs[0]) {
        return c.json({
          error: "sector_conflicts_with_sectors", field: "sector", code: "sector_conflicts_with_sectors",
          message: "The sector field must match the first entry of the sectors list.",
        }, 422);
      }
      params.push(JSON.stringify(secs));
      setClauses.push(`sectors = $${params.length}::jsonb`);
      // Keep legacy sector in sync with first element — exactly one assignment
      if (secs.length > 0) set("sector", secs[0]);
      else if (patchSector !== undefined) set("sector", patchSector);
    }
    if (body.responsibleName !== undefined) set("responsible_name", body.responsibleName ? String(body.responsibleName).trim() : null);
    // undefined = field not in PATCH body → unchanged (grandfathered if already stored).
    let patchNewRespId: number | null | undefined;
    if (body.responsibleUserId !== undefined) {
      const parsedPatchResp = parseResponsibleUserId(body.responsibleUserId);
      if (parsedPatchResp === "invalid") return c.json({ error: "invalid_responsible_user_id" }, 422);
      patchNewRespId = parsedPatchResp;
      set("responsible_user_id", patchNewRespId!);
    }
    if (body.startDate !== undefined) {
      // Pre-transaction format check: reject non-YYYY-MM-DD values immediately.
      if (body.startDate) {
        const fmtErr = validatePlanDates(String(body.startDate), null);
        if (fmtErr) return c.json({ error: fmtErr }, 422);
      }
      const rawStart = body.startDate ? String(body.startDate) : null;
      set("start_date", rawStart ? rawStart.slice(0, 10) : null);
    }
    if (body.endDate !== undefined) {
      if (body.endDate) {
        const fmtErr = validatePlanDates(null, String(body.endDate));
        if (fmtErr) return c.json({ error: fmtErr }, 422);
      }
      const rawEnd = body.endDate ? String(body.endDate) : null;
      set("end_date", rawEnd ? rawEnd.slice(0, 10) : null);
    }

    // datesChanged: whether start_date or end_date is being written this PATCH.
    // The effective-range validation (end >= start) runs INSIDE the transaction
    // with a FOR UPDATE lock so concurrent partial-date PATCHes cannot bypass it.
    const datesChanged = body.startDate !== undefined || body.endDate !== undefined;

    // status must not be mutated via PATCH — use POST /plans/:planId/transitions.
    if (body.description !== undefined) set("description", body.description ?? null);
    if (body.objectives !== undefined) {
      params.push(JSON.stringify(Array.isArray(body.objectives) ? body.objectives : []));
      setClauses.push(`objectives = $${params.length}::jsonb`);
    }
    if (body.budgetPlanned !== undefined) set("budget_planned", body.budgetPlanned != null ? Number(body.budgetPlanned) : null);
    if (body.budgetActual !== undefined) set("budget_actual", body.budgetActual != null ? Number(body.budgetActual) : null);
    if (body.fundingSource !== undefined) set("funding_source", body.fundingSource ? String(body.fundingSource).trim() : null);
    if (body.currency !== undefined) set("currency", body.currency ? String(body.currency).trim() : null);

    params.push(planId);

    await client.query("BEGIN");

    // ── Consolidated plan-row lock: responsible user + date validation ─────────
    // A single SELECT … FOR UPDATE covers both checks. Any field in this block
    // uses the locked row's current values — never the stale pre-transaction
    // `before` snapshot — so concurrent PATCHes are serialised.
    const baseRevision = c.req.header("x-base-revision");
    // Budget-affecting fields also need the plan row locked.
    const budgetFieldsChanged = body.budgetPlanned !== undefined || body.currency !== undefined || Array.isArray(body.activities);
    const needsPlanLock = datesChanged || (patchNewRespId !== undefined) || Array.isArray(body.activities) || Boolean(baseRevision) || budgetFieldsChanged;
    if (needsPlanLock) {
      const lockedPlan = await client.query<{
        start_date: Date | string | null;
        end_date: Date | string | null;
        responsible_user_id: number | null;
        status: string;
        last_final_approved_at: Date | string | null;
        updated_at: Date | string;
        currency: string | null;
        budget_planned: number | null;
      }>(
        `SELECT start_date, end_date, responsible_user_id, status, last_final_approved_at, updated_at, currency, budget_planned
         FROM plans WHERE id = $1 FOR UPDATE`,
        [planId],
      );
      const lockedRow = lockedPlan.rows[0] ?? { start_date: null, end_date: null, responsible_user_id: null, status: "draft", last_final_approved_at: null, updated_at: new Date(0), currency: null, budget_planned: null };
      if (baseRevision && new Date(lockedRow.updated_at).getTime() !== new Date(baseRevision).getTime()) {
        await client.query("ROLLBACK");
        return c.json({ error: "offline_conflict", code: "revision_mismatch", message: "The plan changed while this draft was offline." }, 409);
      }

      // Re-check editability under the lock — the pre-transaction check ran on a
      // stale snapshot; a plan approved/completed concurrently must reject content writes.
      let stillEditable: boolean;
      if (!lockedRow.last_final_approved_at) {
        stillEditable = !POST_APPROVAL_LOCKED_STATUSES.has(lockedRow.status);
      } else {
        const reopenRow = await client.query(
          `SELECT 1 FROM approvals
           WHERE entity_type = 'plan' AND entity_id = $1
             AND action = 'reopen'
             AND "timestamp" > $2
           LIMIT 1`,
          [planId, lockedRow.last_final_approved_at],
        );
        stillEditable = reopenRow.rows.length > 0 && !POST_APPROVAL_LOCKED_STATUSES.has(lockedRow.status);
      }
      if (!stillEditable) {
        await client.query("ROLLBACK");
        return c.json({ error: "plan_approval_locked", message: "This Plan is Approved and must be reopened before it can be edited." }, 409);
      }

      // Responsible user — grandfathering: skip when the submitted value equals
      // the locked (not stale-before) stored value.
      if (patchNewRespId !== undefined) {
        const lockedRespId = lockedRow.responsible_user_id ?? null;
        const actualRespChanged = patchNewRespId !== lockedRespId;
        if (actualRespChanged) {
          const patchRespErr = await validateResponsibleUser(db, patchNewRespId, client);
          if (patchRespErr) throw new PlanValidationError(patchRespErr);
        }
      }

      // Date range — check effective ordering using locked dates (not stale).
      if (datesChanged) {
        const lockedStart = pgDateToIso(lockedRow.start_date);
        const lockedEnd = pgDateToIso(lockedRow.end_date);
        const rawEffStart = body.startDate !== undefined
          ? (body.startDate ? String(body.startDate) : null)
          : lockedStart;
        const rawEffEnd = body.endDate !== undefined
          ? (body.endDate ? String(body.endDate) : null)
          : lockedEnd;
        const txDateErr = validatePlanDates(rawEffStart, rawEffEnd);
        if (txDateErr) throw new PlanValidationError(txDateErr);
      }

      // ── Budget invariant re-check for ordinary (non Save & Finish) edits ────
      // A plain PATCH changing budgetPlanned/currency/activities once the Plan
      // is past Draft must not be allowed to silently break the
      // "activities total ≤ plan budget" invariant.
      if (closeRegistration !== true && budgetFieldsChanged && lockedRow.status !== "draft") {
        const postSubmitCurrency = body.currency !== undefined
          ? String(body.currency ?? "")
          : (lockedRow.currency ?? "");
        const postSubmitBudgetPlanned = body.budgetPlanned !== undefined
          ? Number(body.budgetPlanned ?? NaN)
          : (lockedRow.budget_planned ?? NaN);
        let postSubmitActTotal: number;
        if (Array.isArray(body.activities)) {
          postSubmitActTotal = (body.activities as ActivityInput[]).reduce((s, raw) => {
            const v = Number(raw.budgetPlanned ?? 0);
            return s + (Number.isFinite(v) && v >= 0 ? v : 0);
          }, 0);
        } else {
          const persistedActBudgets = await client.query<{ budget_planned: number | null }>(
            `SELECT budget_planned FROM plan_activities WHERE plan_id = $1`,
            [planId],
          );
          postSubmitActTotal = persistedActBudgets.rows.reduce((s, row) => {
            const v = Number(row.budget_planned ?? 0);
            return s + (Number.isFinite(v) && v >= 0 ? v : 0);
          }, 0);
        }
        const postSubmitBudgetIssue = validatePlanBudgetReadiness(
          postSubmitCurrency, postSubmitBudgetPlanned, postSubmitActTotal,
        );
        if (postSubmitBudgetIssue) throw new CloseRegistrationError(postSubmitBudgetIssue);
      }
    }

    // ── Save & Finish readiness validation (inside the transaction) ──────────
    if (closeRegistration === true) {
      // Lock the Plan row for the duration of this transaction (no-op if
      // already locked above by needsPlanLock).
      const patchPlanRow = await client.query<{
        start_date: Date | string | null;
        end_date: Date | string | null;
        localities: unknown;
        currency: string | null;
        budget_planned: number | null;
      }>(
        `SELECT start_date, end_date, COALESCE(localities, '[]'::jsonb) AS localities,
                currency, budget_planned
         FROM plans WHERE id = $1 FOR UPDATE`,
        [planId],
      );

      // Determine the effective Activity collection to validate.
      let patchActs: ActivityInput[];
      if (Array.isArray(body.activities)) {
        patchActs = body.activities as ActivityInput[];
        if (patchActs.length === 0) throw new CloseRegistrationError("at_least_one_activity_required");
      } else {
        // body.activities omitted — plan_activities are unchanged by this PATCH.
        const persistedActRows = await client.query<{
          title: string | null;
          locality_name: string | null;
          planned_date: Date | string | null;
          priority: string | null;
          target_beneficiaries: number | null;
          budget_planned: number | null;
          expected_result: string | null;
        }>(
          `SELECT title, locality_name, planned_date, priority,
                  target_beneficiaries, budget_planned, expected_result
           FROM plan_activities WHERE plan_id = $1`,
          [planId],
        );
        if (persistedActRows.rows.length === 0) throw new CloseRegistrationError("at_least_one_activity_required");
        patchActs = persistedActRows.rows.map((row): ActivityInput => ({
          title: row.title ?? "",
          localityName: row.locality_name ?? "",
          plannedDate: pgDateToIso(row.planned_date) ?? "",
          priority: row.priority ?? "",
          targetBeneficiaries: Number(row.target_beneficiaries ?? 0),
          budgetPlanned: Number(row.budget_planned ?? 0),
          expectedResult: row.expected_result ?? "",
          // Fields not required by readiness checks — safe defaults.
          status: "planned",
          progressPct: 0,
          budgetActual: 0,
        }));
      }

      const patchPlanEffectiveLocs =
        patchLocalities ??
        normalisePlanLocalities(patchPlanRow.rows[0]?.localities ?? []);
      const patchPlanCtx: PlanContext = {
        startDate: body.startDate
          ? String(body.startDate).slice(0, 10)
          : pgDateToIso(patchPlanRow.rows[0]?.start_date ?? null),
        endDate: body.endDate
          ? String(body.endDate).slice(0, 10)
          : pgDateToIso(patchPlanRow.rows[0]?.end_date ?? null),
        localities: patchPlanEffectiveLocs,
      };
      // Finalisation gate: both plan dates must be non-null at close-registration time.
      if (!patchPlanCtx.startDate || !patchPlanCtx.endDate) {
        throw new PlanValidationError("start_date_end_date_required");
      }
      if (!patchActs.some((a) => validatePlanActivityReadiness(a, patchPlanCtx) === null)) {
        throw new CloseRegistrationError("at_least_one_complete_activity_required");
      }
      // Budget consistency — shared validatePlanBudgetReadiness helper.
      const effectiveCurrency = body.currency !== undefined
        ? String(body.currency ?? "")
        : (patchPlanRow.rows[0]?.currency ?? "");
      const effectiveBudgetPlanned = body.budgetPlanned !== undefined
        ? Number(body.budgetPlanned ?? NaN)
        : (patchPlanRow.rows[0]?.budget_planned ?? NaN);
      const actBudgetTotalOnPatch = patchActs.reduce((s, raw) => {
        const v = Number(raw.budgetPlanned ?? 0);
        return s + (Number.isFinite(v) && v >= 0 ? v : 0);
      }, 0);
      const budgetIssueOnPatch = validatePlanBudgetReadiness(
        effectiveCurrency, effectiveBudgetPlanned, actBudgetTotalOnPatch,
      );
      if (budgetIssueOnPatch) throw new CloseRegistrationError(budgetIssueOnPatch);
    }

    if (setClauses.length > 1) {
      await client.query(`UPDATE plans SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
    }
    if (Array.isArray(body.activities)) {
      const existing = await client.query<{ id: number; responsible_user_id: number | null; state_id: number | null }>(
        `SELECT id, responsible_user_id, state_id FROM plan_activities WHERE plan_id = $1 FOR UPDATE`,
        [planId],
      );
      const existingIds = new Set(existing.rows.map((r) => r.id));
      // Build a map of current responsible_user_id / state_id per activity ID for grandfathering.
      const currentRespMap = new Map<number, number | null>(existing.rows.map((r) => [r.id, r.responsible_user_id]));
      const currentStateMap = new Map<number, number | null>(existing.rows.map((r) => [r.id, r.state_id]));

      // ── Activity responsible-user validation (before any write) ───────────
      // Grandfathering: if unchanged from what is currently stored, skip validation.
      for (const raw of body.activities as ActivityInput[]) {
        const newResp = raw.responsibleUserId == null ? null : Number(raw.responsibleUserId);
        const actId = raw.id ? Number(raw.id) : null;
        const currentResp = actId != null ? (currentRespMap.get(actId) ?? undefined) : undefined;
        const isUnchanged = actId != null && currentResp === newResp;
        if (!isUnchanged) {
          const actRespErr = await validateResponsibleUser(db, newResp, client);
          if (actRespErr) throw new PlanValidationError(actRespErr, "activities.responsibleUserId");
        }
        const newStateId = raw.stateId == null ? null : Number(raw.stateId);
        const currentState = actId != null ? (currentStateMap.get(actId) ?? undefined) : undefined;
        if (!(actId != null && currentState === newStateId) && newStateId != null) {
          const activeState = await assertActiveState(db, newStateId);
          if (!activeState.ok) throw new PlanValidationError(activeState.error, "activities.stateId");
        }
        // RISK-007: risk_id must reference an existing risk (create + update)
        const actRiskErr = await validateRiskReference(db, raw.riskId == null ? null : Number(raw.riskId), client);
        if (actRiskErr) throw new PlanValidationError(actRiskErr, "activities.riskId");
      }

      // ── Activity status/progress consistency validation (PLAN-BD-4) ─────────
      const patchProgressErrors = collectActivityProgressErrors(body.activities as ActivityInput[]);
      if (patchProgressErrors.length > 0) {
        throw new ActivityProgressValidationError(patchProgressErrors);
      }

      const keepIds = new Set<number>();
      for (const raw of body.activities as ActivityInput[]) {
        const a = normalizeActivity(raw);
        if (!a.title) continue;
        if (raw.id && existingIds.has(Number(raw.id))) {
          keepIds.add(Number(raw.id));
          await client.query(
            `UPDATE plan_activities SET title=$1, description=$2, objective_index=$3,
               responsible_user_id=$4, responsible_name=$5, locality_name=$6,
               state_id=$7, state_name=$8, planned_date=$9,
               target_beneficiaries=$10, priority=$11, expected_result=$12,
               start_date=$13, end_date=$14, status=$15, progress_pct=$16,
               budget_planned=$17, budget_actual=$18, risk_id=$19, mitigation_action=$20,
               expected_output=$21, performance_indicator=$22
             WHERE id=$23 AND plan_id=$24`,
            [
              a.title, a.description, a.objectiveIndex, a.responsibleUserId,
              a.responsibleName, a.localityName,
              a.stateId, a.stateName, a.plannedDate,
              a.targetBeneficiaries, a.priority, a.expectedResult,
              a.startDate, a.endDate, a.status, a.progressPct,
              a.budgetPlanned, a.budgetActual,
              a.riskId, a.mitigationAction, a.expectedOutput, a.performanceIndicator,
              Number(raw.id), planId,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO plan_activities
               (plan_id, title, description, objective_index, responsible_user_id, responsible_name,
                locality_name, state_id, state_name, planned_date, target_beneficiaries, priority,
                expected_result, start_date, end_date,
                status, progress_pct, budget_planned, budget_actual, risk_id, mitigation_action,
                expected_output, performance_indicator)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
            [
              planId, a.title, a.description, a.objectiveIndex, a.responsibleUserId,
              a.responsibleName, a.localityName,
              a.stateId, a.stateName, a.plannedDate, a.targetBeneficiaries, a.priority,
              a.expectedResult,
              a.startDate, a.endDate, a.status, a.progressPct,
              a.budgetPlanned, a.budgetActual,
              a.riskId, a.mitigationAction, a.expectedOutput, a.performanceIndicator,
            ],
          );
        }
      }
      const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        // Clear plan_activity_id on any risks that reference these activities
        // BEFORE deleting the activity rows — no DB-level FK, so the delete
        // would otherwise silently create dangling references.
        await client.query(`UPDATE risks SET plan_activity_id = NULL WHERE plan_activity_id = ANY($1::int[])`, [toDelete]);
        await client.query(`DELETE FROM plan_activities WHERE plan_id = $1 AND id = ANY($2::int[])`, [planId, toDelete]);
      }
    }
    // ── Atomically revoke Registration session on Save & Finish ───────────
    const doCloseSession = !hasUpdatePerm && closeRegistration === true && rawToken;
    if (doCloseSession) {
      await closeRegistrationSession(client, planId, user.id, rawToken);
    }
    // Sector-scope AND State-scope re-validation both run INSIDE the transaction
    // so an unauthorised move is rolled back, never committed — reading the
    // updated row via the transaction client, not the stale pre-transaction
    // `meta` snapshot the earlier guards used.
    if (body.sector !== undefined || body.sectors !== undefined || body.projectId !== undefined || body.stateId !== undefined) {
      const proposedMeta = await getPlanMeta(client, planId);
      const postGuard = assertAnySectorAllowed(user, proposedMeta?.sectors ?? []);
      if (!postGuard.ok) {
        await client.query("ROLLBACK");
        return c.json(postGuard.body, postGuard.status as any);
      }
      if (body.stateId !== undefined) {
        const postStateGuard = assertPlanStateAllowed(user, proposedMeta?.stateId ?? null, proposedMeta?.locationType ?? null);
        if (!postStateGuard.ok) {
          await client.query("ROLLBACK");
          return c.json(postStateGuard.body, postStateGuard.status as any);
        }
      }
    }
    await client.query("COMMIT");

    await logAudit(db, {
      userId: user.id, action: "update", module: "plans", entityId: planId,
      oldValue: before.rows[0].title, newValue: String(body.title ?? before.rows[0].title),
    });
    // Audit registration completion (Save & Finish)
    if (!hasUpdatePerm && closeRegistration === true) {
      await logAudit(db, { userId: user.id, action: "registration_completed", module: "plans", entityId: planId });
    }
    // Dropped: realtime.broadcastUpdate (Durable Objects phase).
    const plan = await getPlanById(db, planId);
    return c.json(plan);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof ActivityProgressValidationError) {
      return c.json({ error: "activity_progress_invalid", details: err.details }, 422);
    }
    if (err instanceof PlanValidationError) {
      return c.json({ error: err.code, ...(err.field ? { field: err.field } : {}) }, 422);
    }
    if (err instanceof CloseRegistrationError) {
      return c.json({ error: err.code }, 400);
    }
    // PostgreSQL CHECK constraint violation (code 23514 = check_violation).
    if (err && typeof (err as { code?: string }).code === "string" && (err as { code: string }).code === "23514") {
      return c.json({ error: "end_date_before_start_date" }, 422);
    }
    throw err;
  } finally {
    client.release();
    close();
  }
});
