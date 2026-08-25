import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logAudit, tcSectorRestriction, requirePerm, permissionsFor } from "../middlewares/currentUser";
import { unresolvedRequiredCorrections } from "./comments";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { notifyEntityActorsDeduped, notifyNextApprover, createNotificationDeduped } from "../lib/notifications";
import { realtime } from "../lib/realtime";
import { deleteStorageObjectSafely } from "../lib/objectStorage";
import { assertActiveState } from "../lib/state-master";
import {
  ensureRegistrationSessionTable,
  createRegistrationSession,
  validateRegistrationSession,
  closeRegistrationSession,
  revokeRegistrationSessionsByPlan,
} from "../lib/plan-registration-session";

const router: IRouter = Router();

/**
 * Canonical Plan locality normaliser (spec §15 backend hardening).
 *
 * For each candidate value:
 *   1. Convert to string and trim leading/trailing whitespace.
 *   2. Collapse runs of internal whitespace to a single space.
 *   3. Discard empty / whitespace-only values.
 *   4. Deduplicate case-insensitively, preserving the casing of the first
 *      accepted occurrence (e.g. "Kassala" wins over a later "KASSALA").
 *
 * Examples:
 *   [" Kassala ", "KASSALA", "New   Halfa", "   ", ""]  →  ["Kassala", "New Halfa"]
 *   ["   ", ""]                                         →  []
 *   []                                                  →  []
 *
 * Used on both POST /plans and PATCH /plans/:planId so the database always
 * receives normalised data regardless of the caller.
 */
function normalisePlanLocalities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    // Collapse internal whitespace then trim; reject if empty after trimming.
    const v = String(raw).replace(/\s+/g, " ").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

// Note: plan_registration_sessions table is now created by the tracked migration
// runner (migration 001_plan_registration_sessions) in run-migrations.ts.
// The ensureRegistrationSessionTable() helper is kept for backward compat but
// is no longer called here at startup.

// Plan workflow per spec:
// State Program Officer -> Technical Coordinator -> Senior Program Coordinator -> Program Manager
// (State Office Manager is monitoring-only; no approval authority.)
// Beyond the approval chain, an approved plan can be activated/closed/archived.

// Statuses in which direct PATCH to editable fields is blocked.
// This includes all post-final-approval statuses AND the terminal pre-approval status "rejected".
// A plan must be explicitly reopened (if in REOPENABLE_STATUSES) before it can be edited again.
// "rejected" is included because it is terminal — PLAN-BD-5: no edit, no resubmit from rejected.
export const POST_APPROVAL_LOCKED_STATUSES = new Set(["approved", "active", "in_progress", "delayed", "completed", "cancelled", "archived", "rejected"]);

// Subset of locked statuses that may be reopened. Terminal statuses (completed/cancelled/archived)
// are excluded by default per spec §17.
export const REOPENABLE_STATUSES = new Set(["approved", "active", "in_progress", "delayed"]);

/**
 * Authoritative editability check for Plan content (spec §§7–8, §16).
 *
 * Two modes:
 *  1. Plan has NEVER been finally approved (`last_final_approved_at` is null)
 *     → editable if status is not in POST_APPROVAL_LOCKED_STATUSES.
 *  2. Plan HAS been finally approved
 *     → locked by default.  Only editable when a valid `approvals.action='reopen'`
 *        row exists with `created_at` STRICTLY AFTER `last_final_approved_at`.
 *        When the plan is finally approved again, `last_final_approved_at` advances
 *        so any earlier reopen events no longer authorise editing (spec §10).
 *
 * The `approvals` table is the single authoritative source of truth for Reopen
 * events.  The Audit Log is historical evidence only and MUST NOT be used here.
 *
 * Every endpoint that writes Plan content must call this helper.
 */
export async function isPlanCurrentlyEditable(
  planId: number,
  status: string,
  lastFinalApprovedAt: Date | string | null,
): Promise<boolean> {
  if (!lastFinalApprovedAt) {
    // Never finally approved — normal pre-approval status rules apply.
    return !POST_APPROVAL_LOCKED_STATUSES.has(status);
  }
  // Has been finally approved. A valid explicit Reopen after the latest approval
  // is required before any editing is permitted — current status alone is not enough.
  const reopen = await pool.query(
    `SELECT 1 FROM approvals
     WHERE entity_type = 'plan' AND entity_id = $1
       AND action = 'reopen'
       AND "timestamp" > $2
     LIMIT 1`,
    [planId, lastFinalApprovedAt],
  );
  if (reopen.rows.length === 0) return false;
  // Valid reopen exists — editable only if current status is pre-approval.
  return !POST_APPROVAL_LOCKED_STATUSES.has(status);
}

export const PLAN_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["draft"], to: "submitted" },
  technical_review: { from: ["submitted"], to: "technically_approved" },
  coordination_review: { from: ["technically_approved"], to: "coordination_approved" },
  final_approve: { from: ["coordination_approved"], to: "approved" },
  activate: { from: ["approved"], to: "active" },
  start: { from: ["active"], to: "in_progress" },
  mark_delayed: { from: ["active", "in_progress"], to: "delayed" },
  complete: { from: ["active", "in_progress", "delayed"], to: "completed" },
  cancel: { from: ["draft", "submitted", "technically_approved", "coordination_approved", "approved", "active", "in_progress", "delayed"], to: "cancelled" },
  archive: { from: ["completed", "cancelled"], to: "archived" },
  reject: { from: ["submitted", "technically_approved", "coordination_approved"], to: "rejected" },
  request_revision: { from: ["submitted", "technically_approved", "coordination_approved"], to: "draft" },
};

export const PLAN_TYPES = new Set(["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"]);
export const PLAN_FREQUENCIES = new Set(["weekly", "monthly", "quarterly", "annual", "on_demand"]);
const ACTIVITY_STATUSES = new Set(["planned", "in_progress", "completed", "delayed", "cancelled"]);

type PlanMeta = { sector: string | null; sectors: string[]; stateId: number | null; locationType: string | null };

// PLAN-009: single authoritative SQL fragment for a plan's effective sectors.
// Canonical model: the full `sectors` JSONB array when non-empty; else the legacy
// single `sector` column wrapped in an array; else the linked project's sector.
// Requires `plans pl LEFT JOIN projects p` aliases in the enclosing query.
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

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function getPlanMeta(planId: number, client: Queryable = pool): Promise<PlanMeta | undefined> {
  const r = await client.query(
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
  const sector = (row.sector as string | null) ?? null;
  const parsed = normaliseSectors(row.sectors);
  return {
    sector,
    // Defensive TS-side mirror of the SQL fallback chain: if the JSONB array is
    // empty, the effective single sector (plan → project COALESCE) stands in.
    sectors: parsed.length > 0 ? parsed : sector ? [sector] : [],
    stateId: (row.stateId as number | null) ?? null,
    locationType: (row.locationType as string | null) ?? null,
  };
}

/**
 * PLAN-009: authoritative effective-sectors resolver.
 * Returns the full sectors array for a plan (sectors JSONB → [sector] → [project sector]).
 * Accepts an optional transaction client so it can run inside FOR UPDATE transactions.
 * Returns undefined when the plan does not exist.
 */
export async function getPlanEffectiveSectors(planId: number, client: Queryable = pool): Promise<string[] | undefined> {
  const meta = await getPlanMeta(planId, client);
  if (meta === undefined) return undefined;
  return meta.sectors;
}

/**
 * PLAN-009: multi-sector TC guard. A TC is allowed when ANY of the plan's
 * effective sectors is in their assigned set. Non-TC roles are unrestricted.
 */
export function assertAnySectorAllowed(
  req: import("express").Request,
  sectors: string[],
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(req);
  if (!restriction) return { ok: true };
  if (sectors.some((s) => s && restriction.includes(s))) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

/**
 * Returns a 403 response body if a state-scoped role is accessing a plan outside their state.
 * HQ plans (locationType="hq" or stateId=null) always deny state-scoped roles.
 */
export function assertStateAllowed(
  req: import("express").Request,
  planStateId: number | null,
  planLocationType?: string | null,
): { ok: true } | { ok: false; status: 403; body: { error: string } } {
  const role = req.currentUser?.role;
  const isStateRole = role === "state_program_officer" || role === "state_office_manager";
  if (!isStateRole) return { ok: true };
  // HQ plans: state-scoped users are always denied
  if (planLocationType === "hq" || planStateId === null) {
    return { ok: false, status: 403, body: { error: "hq_forbidden" } };
  }
  const userStateId = req.currentUser?.stateId ?? null;
  if (userStateId === null || userStateId !== planStateId) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  return { ok: true };
}

// Exported for the PLAN-ZR real-DB aggregate integration test (#523) — the test
// must execute the exact production SQL, not a copy that could drift.
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
         -- (pa_agg below) rather than per-row correlated subqueries — the DB computes
         -- every plan's aggregates in one grouped pass over plan_activities.
         -- AVG over zero eligible rows (no activities, or all cancelled — the CASE
         -- WHEN yields NULL for cancelled) is NULL, preserving the null-vs-0 contract.
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

async function generatePlanCode(stateId: number): Promise<string> {
  const s = await pool.query<{ code: string }>(`SELECT code FROM states WHERE id = $1`, [stateId]);
  const stateCode = s.rows[0]?.code ?? "XX";
  const last = await pool.query<{ code: string }>(
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

/** Generates a sequential code for HQ plans: CAFA-PLAN-HQ-NNN. */
async function generateHqPlanCode(): Promise<string> {
  const last = await pool.query<{ code: string }>(
    `SELECT code FROM plans WHERE code LIKE 'CAFA-PLAN-HQ-%' ORDER BY id DESC LIMIT 1`,
  );
  let next = 1;
  if (last.rows.length > 0) {
    const m = last.rows[0].code.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `CAFA-PLAN-HQ-${String(next).padStart(3, "0")}`;
}

async function getPlanActivities(planId: number) {
  const { rows } = await pool.query(
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

async function getPlanLinkedRisks(planId: number) {
  const { rows } = await pool.query(
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

async function getPlanById(planId: number) {
  const r = await pool.query(`${planSummarySelect} WHERE pl.id = $1`, [planId]);
  if (r.rows.length === 0) return null;
  const summary = r.rows[0];
  const extras = await pool.query(
    `SELECT pl.description, pl.objectives, pl.created_by_id AS "createdById",
            cu.name AS "createdByName", pl.created_at AS "createdAt", pl.updated_at AS "updatedAt"
     FROM plans pl LEFT JOIN users cu ON cu.id = pl.created_by_id WHERE pl.id = $1`,
    [planId],
  );
  const [activities, linkedRisks] = await Promise.all([
    getPlanActivities(planId),
    getPlanLinkedRisks(planId),
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
 * Used consistently for:
 *   - POST  /plans            (closeRegistration=true)
 *   - PATCH /plans/:id        (closeRegistration=true)
 *   - POST  /plans/:id/transitions (action=submit)
 *
 * Operates on raw ActivityInput values BEFORE normalizeActivity coercion so
 * that invalid inputs (e.g. negative or decimal beneficiaries) are detected
 * rather than silently clamped.  For Submit, DB row values are mapped to
 * ActivityInput before calling this function.
 *
 * Returns null when all 7 conditions are satisfied, or an error-code string
 * identifying the first failing condition.
 *
 * The 7 required conditions:
 *   1. Meaningful title (non-empty after trim)
 *   2. Locality present and belonging to Plan Geographical Coverage
 *      (case-insensitive, whitespace-normalised comparison)
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
 * Used consistently for:
 *   - POST  /plans            (closeRegistration=true)
 *   - PATCH /plans/:id        (closeRegistration=true)
 *   - POST  /plans/:id/transitions (action=submit)
 *
 * Returns null when all Budget conditions are satisfied, or an error-code string.
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
 * Look up a user and verify they are active. Returns null if valid or not supplied.
 * Returns an error key string if the user is nonexistent or not active.
 * Canonical active rule: status = 'active' only.
 */
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
  userId: number | null | undefined,
  pgClient?: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
): Promise<string | null> {
  if (userId == null) return null; // NULL is valid
  // FOR SHARE when inside a transaction: prevents concurrent deactivation
  // from slipping between this check and the write that follows.
  const sql = pgClient
    ? `SELECT status FROM users WHERE id = $1 FOR SHARE`
    : `SELECT status FROM users WHERE id = $1`;
  const { rows } = pgClient
    ? await pgClient.query<{ status: string }>(sql, [userId])
    : await pool.query<{ status: string }>(sql, [userId]);
  if (rows.length === 0) return "responsible_user_not_found";
  if (rows[0].status !== "active") return "responsible_user_not_active";
  return null;
}

/**
 * RISK-007: verify a plan-activity risk reference points to an existing risk.
 * Bare existence check only — the actor is operating in Plan context and the
 * risk reference is an informational link, so no scope check beyond what the
 * plan route already enforces. Returns "risk_not_found" or null (valid).
 * Pass `pgClient` when calling inside an open transaction.
 *
 * RISK-005 (concurrency): plan_activities.risk_id has no DB-level FK, so the
 * existence check locks the risk row FOR SHARE on the transaction client and
 * the lock is held through the subsequent plan-activity write. A project
 * permanent delete (which deletes risks first) blocks on this share lock
 * until the plan transaction commits — its cascade then nulls the freshly
 * written link; conversely, once the delete holds the risk row lock, this
 * check blocks and then fails closed ("risk_not_found"). Both call sites run
 * inside the plan create/PATCH transaction and pass `pgClient`.
 */
async function validateRiskReference(
  riskId: number | null | undefined,
  pgClient?: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
): Promise<string | null> {
  if (riskId == null) return null; // NULL is valid — activity without a linked risk
  const sql = `SELECT id FROM risks WHERE id = $1 FOR SHARE`;
  const { rows } = pgClient
    ? await pgClient.query<{ id: number }>(sql, [riskId])
    : await pool.query<{ id: number }>(sql, [riskId]);
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
 * Returns a validation error string if the status+progressPct combination
 * violates the contract, or null if valid.
 *
 * completed   → must be exactly 100
 * in_progress → must be 1–99 inclusive
 * planned     → must be 0–99 inclusive
 * delayed     → must be 0–99 inclusive
 * cancelled   → 0–100 (historical; no status-driven constraint beyond bounds)
 */
export function validateActivityProgressConsistency(
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
 *
 *   Stage 1 — RAW: reject explicitly supplied unsupported status, non-numeric
 *     progress, and progress outside 0–100 BEFORE normalizeActivity runs.
 *     Omitted/null fields are allowed (they receive safe defaults in Stage 2).
 *
 *   Stage 2 — CONSISTENCY: normalize, then check the status+progressPct
 *     combination against the PLAN-BD-4 contract.
 *
 * Returns a non-empty array of human-readable error strings when any activity
 * fails; returns an empty array when all pass.
 */
function collectActivityProgressErrors(activities: ActivityInput[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < activities.length; i++) {
    const raw = activities[i];
    const titleRaw = String(raw.title ?? "").trim();
    const label = titleRaw ? `"${titleRaw}"` : `#${i + 1}`;

    // ── Stage 1: Raw input validation (before normalisation) ─────────────────
    // Status: if explicitly supplied and non-empty, must be a recognised value.
    // Omitted / null / empty string → silently defaulted to "planned" later.
    if (raw.status != null && raw.status !== "" && !ACTIVITY_STATUSES.has(raw.status)) {
      errors.push(
        `Activity ${i + 1} (${label}): Unsupported status "${raw.status}". ` +
        `Allowed: ${[...ACTIVITY_STATUSES].join(", ")}.`,
      );
      continue; // skip consistency check — status is already invalid
    }
    // progressPct: if explicitly supplied, must be a finite number in 0–100.
    // null / undefined → silently defaulted to 0 later.
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

router.get("/plans", async (req, res, next) => {
  try {
    const filters: string[] = [];
    const params: unknown[] = [];
    if (req.query.planType) { params.push(String(req.query.planType)); filters.push(`pl.plan_type = $${params.length}`); }
    if (req.query.frequency) { params.push(String(req.query.frequency)); filters.push(`pl.frequency = $${params.length}`); }
    // State roles are clamped to their own state — a crafted ?stateId= param cannot bypass this.
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    const effectiveStateId = isStateRole
      ? (req.currentUser?.stateId ?? null)
      : (req.query.stateId ? Number(req.query.stateId) : null);
    // Fail-closed: state-scoped users without an assigned stateId cannot see any plans.
    if (isStateRole && effectiveStateId === null) { res.json([]); return; }
    if (effectiveStateId !== null) { params.push(effectiveStateId); filters.push(`pl.state_id = $${params.length}`); }
    if (req.query.sector) { params.push(String(req.query.sector)); filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${EFFECTIVE_SECTORS_SQL}) AS s WHERE s = $${params.length})`); }
    if (req.query.projectId) { params.push(Number(req.query.projectId)); filters.push(`pl.project_id = $${params.length}`); }
    if (req.query.status) { params.push(String(req.query.status)); filters.push(`pl.status = $${params.length}`); }
    if (req.query.responsibleUserId) { params.push(Number(req.query.responsibleUserId)); filters.push(`pl.responsible_user_id = $${params.length}`); }
    if (req.query.search) {
      params.push(`%${String(req.query.search)}%`);
      filters.push(`(pl.title ILIKE $${params.length} OR pl.code ILIKE $${params.length})`);
    }
    const tcSectors = tcSectorRestriction(req);
    if (tcSectors !== null) {
      if (tcSectors.length === 0) { res.json([]); return; }
      params.push(tcSectors);
      // PLAN-009: TC can see a plan if any of its EFFECTIVE sectors overlaps their
      // assignment. The effective set is the precedence chain (non-empty sectors
      // array wins outright; legacy/project sector only as fallback) — never an OR
      // of both, which would leak plans whose stale legacy sector matches.
      filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${EFFECTIVE_SECTORS_SQL}) AS s WHERE s = ANY($${params.length}::text[]))`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    // created_at DESC, id DESC — stable tie-breaker for plans created in the same second
    const { rows } = await pool.query(`${planSummarySelect} ${where} ORDER BY pl.created_at DESC, pl.id DESC`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get("/plans/dashboard", async (req, res, next) => {
  try {
    const tcSectors = tcSectorRestriction(req);
    const isStateRole = req.currentUser?.role === "state_office_manager" || req.currentUser?.role === "state_program_officer";
    const userStateId = isStateRole ? (req.currentUser?.stateId ?? null) : null;

    // Short-circuit: TC with no sector assignment sees nothing
    if (tcSectors !== null && tcSectors.length === 0) {
      const empty = { total: 0, active: 0, delayed: 0, completed: 0, draft: 0, budgetPlanned: 0, budgetActual: 0, burnRatePct: 0, riskCount: 0, activitiesTotal: 0, activitiesCompleted: 0 };
      res.json({ totals: empty, byState: [], bySector: [], byType: [], upcomingDeadlines: [], delayedActivities: [] });
      return;
    }

    // Build parameterised conditions — order matters for $N references
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (tcSectors !== null && tcSectors.length > 0) {
      params.push(tcSectors);
      // PLAN-009: TC scope matches when ANY effective sector overlaps their assignment.
      // Effective sectors follow the precedence chain (non-empty sectors array wins
      // outright; legacy/project sector only as fallback) — never an OR of both.
      conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${EFFECTIVE_SECTORS_SQL}) AS es WHERE es = ANY($${params.length}::text[]))`);
    }
    if (userStateId !== null) {
      params.push(userStateId);
      conditions.push(`pl.state_id = $${params.length}`);
    }

    const sectorCond = conditions.find(c => c.includes("sector")) ?? null;
    const stateCond  = conditions.find(c => c.includes("state_id")) ?? null;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const baseFrom = `FROM plans pl LEFT JOIN projects p ON p.id = pl.project_id ${whereClause}`;

    // Delayed-activities query has its own FROM, so build its extra filters separately
    const delayedExtra = [
      sectorCond ? ` AND ${sectorCond}` : "",
      stateCond  ? ` AND ${stateCond}` : "",
    ].join("");

    const [totals, byState, bySector, byType, upcoming, delayed, riskCount, activityRollup] = await Promise.all([
      pool.query<{ status: string; n: number }>(
        `SELECT pl.status, COUNT(*)::int AS n ${baseFrom} GROUP BY pl.status`, params,
      ),
      pool.query(
        `SELECT pl.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", COUNT(*)::int AS count
         FROM plans pl
         LEFT JOIN projects p ON p.id = pl.project_id
         LEFT JOIN states s ON s.id = pl.state_id
         ${whereClause}
         GROUP BY pl.state_id, s.name, s.name_ar ORDER BY count DESC`, params,
      ),
      pool.query(
        `SELECT COALESCE((${EFFECTIVE_SECTORS_SQL}) ->> 0, 'Unspecified') AS sector, COUNT(*)::int AS count
         ${baseFrom} GROUP BY 1 ORDER BY count DESC`, params,
      ),
      pool.query(
        `SELECT pl.plan_type AS "planType", COUNT(*)::int AS count ${baseFrom} GROUP BY pl.plan_type ORDER BY count DESC`, params,
      ),
      pool.query(
        `SELECT pl.id AS "planId", pl.title, pl.end_date AS "endDate", pl.status,
                (pl.end_date - CURRENT_DATE)::int AS "daysRemaining"
         ${baseFrom}${whereClause ? " AND" : " WHERE"} pl.status NOT IN ('completed','cancelled','archived','rejected')
            AND pl.end_date >= CURRENT_DATE AND pl.end_date <= CURRENT_DATE + INTERVAL '30 days'
         ORDER BY pl.end_date ASC LIMIT 10`, params,
      ),
      pool.query(
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
           -- Overdue first (date has already passed), oldest first within that group
           CASE WHEN pa.end_date IS NOT NULL AND pa.end_date < CURRENT_DATE THEN 0 ELSE 1 END ASC,
           pa.end_date ASC NULLS LAST
         LIMIT 50`, params,
      ),
      pool.query<{ n: number }>(
        `SELECT COUNT(DISTINCT r.id)::int AS n FROM risks r
         JOIN plans pl ON (pl.id = r.plan_id OR pl.id = (SELECT plan_id FROM plan_activities WHERE id = r.plan_activity_id))
         LEFT JOIN projects p ON p.id = pl.project_id
         ${whereClause}`, params,
      ),
      pool.query<{ total: number; completed: number; planned: number; actual: number }>(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN pa.status = 'completed' THEN 1 ELSE 0 END), 0)::int AS completed,
                COALESCE(SUM(pa.budget_planned)::float, 0) AS planned,
                COALESCE(SUM(pa.budget_actual)::float, 0) AS actual
         FROM plan_activities pa
         JOIN plans pl ON pl.id = pa.plan_id
         LEFT JOIN projects p ON p.id = pl.project_id
         ${whereClause}`, params,
      ),
    ]);

    const statusMap: Record<string, number> = {};
    for (const r of totals.rows) statusMap[r.status] = r.n;
    const totalCount = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const planned = activityRollup.rows[0]?.planned ?? 0;
    const actual = activityRollup.rows[0]?.actual ?? 0;
    const burnRatePct = planned > 0 ? Math.round((actual / planned) * 100) : 0;

    // awaitingApproval: plans in the approval pipeline (submitted → technically_approved → coordination_approved)
    const awaitingApproval =
      (statusMap.submitted ?? 0) +
      (statusMap.technically_approved ?? 0) +
      (statusMap.coordination_approved ?? 0);

    res.json({
      totals: {
        total: totalCount,
        active: (statusMap.active ?? 0) + (statusMap.in_progress ?? 0),
        delayed: statusMap.delayed ?? 0,
        completed: statusMap.completed ?? 0,
        draft: statusMap.draft ?? 0,
        awaitingApproval,
        // Full status breakdown for reconciliation and transparency
        statusBreakdown: statusMap,
        budgetPlanned: planned,
        budgetActual: actual,
        burnRatePct,
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
  } catch (err) { next(err); }
});

/**
 * Runs the shared soft-duplicate query for the duplicate-check preflight.
 * Returns the total matching count plus the ID of the first (most recent)
 * matching plan so the accessibility check can decide whether the client may
 * be offered navigation to it.
 */
async function runSoftDuplicateQuery(
  params: unknown[],
  scopePredicate: string,
): Promise<{ count: number; firstId: number | null }> {
  const result = await pool.query<{ n: number; first_id: number | null }>(
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
  req: import("express").Request,
  planId: number | null,
): Promise<number | null> {
  if (planId == null) return null;
  const matchedSectors = (await getPlanEffectiveSectors(planId)) ?? [];
  const sectorCheck = assertAnySectorAllowed(req, matchedSectors);
  return sectorCheck.ok ? planId : null;
}

/**
 * GET /plans/duplicate-check — Preflight duplicate detection for structured plan types.
 *
 * This is a best-effort preflight only.  The backend CREATE guard inside the
 * transaction (POST /plans) is the authoritative duplicate check.  Network
 * errors or races between preflight and CREATE are handled by that guard.
 *
 * Scope security: applies the same state/sector restrictions as the plan list.
 * Actors cannot enumerate plan data outside their authorised scope.
 *
 * PLAN-BD-2: Structured types (monthly/quarterly/annual) → matchType "hard".
 *            Irregular types (action/operational/emergency/custom) → matchType "soft".
 *            Non-blocking statuses: rejected, cancelled, archived (per PLAN-BD-2 §11).
 */
router.get("/plans/duplicate-check", requirePerm("plans.create"), async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }

    const { planType, startDate, endDate } = req.query as Record<string, string | undefined>;
    const rawProjectId   = req.query.projectId   as string | undefined;
    const rawStateId     = req.query.stateId     as string | undefined;
    const rawLocType     = req.query.locationType as string | undefined;
    const rawDraftPlanId = req.query.draftPlanId  as string | undefined;

    if (!planType || !PLAN_TYPES.has(planType)) {
      res.status(400).json({ error: "invalid_plan_type" }); return;
    }
    if (!startDate || !endDate) {
      res.status(400).json({ error: "start_date_end_date_required" }); return;
    }

    // Require strict YYYY-MM-DD format — do not rely on PostgreSQL date casts
    // to surface malformed values (PG is lenient on truncated inputs).
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
      res.status(400).json({ error: "invalid_date_format", detail: "startDate and endDate must be YYYY-MM-DD" }); return;
    }

    const projectId  = rawProjectId != null ? Number(rawProjectId) : null;
    const stateId    = rawStateId   != null ? Number(rawStateId)   : null;
    const locationType = rawLocType === "hq" ? "hq" : null;

    if (projectId !== null && (!Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0)) {
      res.status(400).json({ error: "invalid_project_id" }); return;
    }
    if (stateId !== null && (!Number.isFinite(stateId) || !Number.isInteger(stateId) || stateId <= 0)) {
      res.status(400).json({ error: "invalid_state_id" }); return;
    }

    // draftPlanId — the ID of the plan currently being edited (optional).
    // When provided, the hard check excludes this plan from the result so the
    // user is not blocked from saving their own draft after changing its dates
    // or type (self-duplicate scenario).  Must be a positive integer.
    let draftPlanId: number | null = null;
    if (rawDraftPlanId != null) {
      const parsed = Number(rawDraftPlanId);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        res.status(400).json({ error: "invalid_draft_plan_id" }); return;
      }
      draftPlanId = parsed;
    }

    // ── Scope security (mirrors CREATE validation) ────────────────────────────
    const isHq = locationType === "hq";
    const isPlannerStateRole =
      req.currentUser.role === "state_program_officer" ||
      req.currentUser.role === "state_office_manager";
    if (isHq && isPlannerStateRole) {
      // HQ plans are out of scope for state-scoped roles — no data to show.
      res.json({ matchType: "none" }); return;
    }
    if (!isHq) {
      if (stateId === null) {
        // State plan without a stateId — fail-closed for safety.
        res.json({ matchType: "none" }); return;
      }
      const stateGuardCheck = assertStateAllowed(req, stateId, null);
      if (!stateGuardCheck.ok) {
        // Out-of-scope actor — return no data (not 403, to avoid enumeration).
        res.json({ matchType: "none" }); return;
      }
    }

    // ── PLAN-BD-2: Structured vs irregular classification ─────────────────────
    const STRUCTURED_TYPES = new Set(["monthly", "quarterly", "annual"]);
    const isStructured = STRUCTURED_TYPES.has(planType);

    // ── Scope predicate (same shape for both hard and soft queries) ───────────
    // Scope: project-linked | HQ | state-standalone (exactly mirrors INSERT logic).
    const scopePredicate = `(
      ($4::int IS NOT NULL AND project_id = $4::int)
   OR ($4::int IS NULL AND $5 = 'hq' AND location_type = 'hq' AND state_id IS NULL)
   OR ($4::int IS NULL AND ($5 IS NULL OR $5 <> 'hq') AND location_type IS NULL AND state_id = $6::int)
    )`;

    const params: unknown[] = [
      planType,
      startDate,
      endDate,
      projectId,      // $4
      locationType,   // $5
      stateId,        // $6
    ];

    if (isStructured) {
      // ── Hard check: statuses that block a new create ───────────────────────
      // Non-blocking (per PLAN-BD-2 §11): rejected, cancelled, archived.
      //
      // Self-duplicate exclusion: when draftPlanId is provided, exclude that
      // plan from the hard check so the user can continue editing their own
      // draft without being falsely blocked (save-draft-then-complete flow).
      const selfExcludeClause = draftPlanId != null ? `AND id <> $7::int` : "";
      const hardParams = draftPlanId != null ? [...params, draftPlanId] : params;

      const hard = await pool.query<{
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
        const endIso   = pgE instanceof Date ? pgE.toISOString().slice(0, 10) : String(pgE).slice(0, 10);

        // ── Sector visibility check (TC restriction) ──────────────────────
        // A TC can only see plans in their assigned sector(s). If the matched
        // plan is in a sector the actor cannot access, return a safe conflict
        // (confirms a block without leaking plan title, status, or draft ID).
        // PLAN-009: resolve the full effective sectors array via the
        // authoritative helper — never the legacy single-sector column.
        const matchedSectors = (await getPlanEffectiveSectors(row.id)) ?? [];
        const sectorCheck = assertAnySectorAllowed(req, matchedSectors);
        const canSeePlan  = sectorCheck.ok;
        const isDraft     = row.status === "draft";

        res.json({
          matchType: "hard",
          existing: {
            planId: canSeePlan && isDraft ? row.id : null,
            title:  canSeePlan ? row.title  : null,
            status: canSeePlan ? row.status : null,
            planType: row.plan_type,
            startDate: startIso,
            endDate: endIso,
          },
        }); return;
      }

      // Structured type with no hard match — also run soft warning query for awareness.
      const softStruct = await runSoftDuplicateQuery(params, scopePredicate);
      if (softStruct.count > 0) {
        // Wave 2 (soft duplicate UX): include the accessible plan's ID (same
        // pattern as the hard path) so the client can offer navigation.
        const softPlanId = await resolveAccessibleSoftPlanId(req, softStruct.firstId);
        res.json({ matchType: "soft", count: softStruct.count, planId: softPlanId }); return;
      }

      res.json({ matchType: "none" }); return;
    } else {
      // ── Soft check only for irregular types ───────────────────────────────
      const softIrreg = await runSoftDuplicateQuery(params, scopePredicate);
      if (softIrreg.count > 0) {
        // Wave 2 (soft duplicate UX): accessible existing plan ID enables a
        // "Review Existing Plan" affordance; null when out of the actor's scope.
        const softPlanId = await resolveAccessibleSoftPlanId(req, softIrreg.firstId);
        res.json({ matchType: "soft", count: softIrreg.count, planId: softPlanId }); return;
      }
      res.json({ matchType: "none" }); return;
    }
  } catch (err) { next(err); }
});

router.get("/plans/:planId", async (req, res, next) => {
  try {
    const planId = Number(req.params.planId);
    if (!Number.isFinite(planId)) { res.status(400).json({ error: "invalid_plan_id" }); return; }
    const meta = await getPlanMeta(planId);
    if (meta === undefined) { res.status(404).json({ error: "plan_not_found" }); return; }
    const sectorGuard = assertAnySectorAllowed(req, meta.sectors);
    if (!sectorGuard.ok) { res.status(sectorGuard.status).json(sectorGuard.body); return; }
    const stateGuard = assertStateAllowed(req, meta.stateId, meta.locationType);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const plan = await getPlanById(planId);
    if (!plan) { res.status(404).json({ error: "plan_not_found" }); return; }
    res.json(plan);
  } catch (err) { next(err); }
});

router.post("/plans", requirePerm("plans.create"), async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim();
    const frequency = String(body.frequency ?? "monthly");
    if (!title) { res.status(400).json({ error: "title_required" }); return; }
    if (body.frequency && !PLAN_FREQUENCIES.has(frequency)) { res.status(400).json({ error: "invalid_frequency" }); return; }
    // ── Location: HQ or State ────────────────────────────────────────────────
    const rawPlanLocationType = body.locationType === "hq" ? "hq" : null;
    const isHqPlan = rawPlanLocationType === "hq";
    const isPlannerStateRole =
      req.currentUser.role === "state_program_officer" ||
      req.currentUser.role === "state_office_manager";

    let stateId: number = 0; // 0 used as sentinel for HQ plans (not stored)
    if (isHqPlan) {
      // HQ plan: stateId is not required; state-scoped users are denied
      if (isPlannerStateRole) {
        res.status(403).json({ error: "hq_forbidden", message: "State-scoped users cannot create HQ plans." });
        return;
      }
      // Reject invalid combination: locationType=hq cannot include a stateId
      if (body.stateId != null) {
        res.status(400).json({ error: "invalid_location_combination", message: "locationType=hq cannot be combined with a stateId." });
        return;
      }
    } else {
      // State plan: stateId required
      stateId = Number(body.stateId);
      if (!Number.isFinite(stateId) || stateId === 0) { res.status(400).json({ error: "stateId_required" }); return; }
      const activeState = await assertActiveState(stateId);
      if (!activeState.ok) {
        res.status(422).json({ error: activeState.error, message: "Plans can only be created for an active State." });
        return;
      }

      // State roles may only create plans within their own assigned state.
      const stateGuardCreate = assertStateAllowed(req, stateId, null);
      if (!stateGuardCreate.ok) { res.status(stateGuardCreate.status).json(stateGuardCreate.body); return; }
    }

    // Save & Finish (closeRegistration=true) requires the complete Plan Details dataset.
    // Draft-only saves require only the minimum: title + state.
    const isCompleteSave = body.closeRegistration === true;

    // Plan type: always validated when provided; required only for complete saves.
    const planType = body.planType ? String(body.planType) : null;
    if (planType !== null && !PLAN_TYPES.has(planType)) { res.status(400).json({ error: "invalid_plan_type" }); return; }
    if (isCompleteSave && !planType) { res.status(400).json({ error: "invalid_plan_type" }); return; }

    // Dates: required for complete saves; absent dates are allowed for drafts.
    // Returns 422 (not 400) — data-integrity rejection consistent with other date-validation paths.
    if (isCompleteSave && (!body.startDate || !body.endDate)) {
      res.status(422).json({ error: "start_date_end_date_required" }); return;
    }

    // Validate date range using raw input — reject non-YYYY-MM-DD values (e.g. "2026-01-01junk")
    // before any truncation. The strict parser inside validatePlanDates requires exactly YYYY-MM-DD.
    // After passing validation, we persist only the canonical 10-char ISO form.
    const canonStartDate = body.startDate ? String(body.startDate).slice(0, 10) : null;
    const canonEndDate = body.endDate ? String(body.endDate).slice(0, 10) : null;
    const postDateError = validatePlanDates(
      body.startDate ? String(body.startDate) : null,   // raw — not sliced
      body.endDate ? String(body.endDate) : null,       // raw — not sliced
    );
    if (postDateError) { res.status(422).json({ error: postDateError }); return; }

    const sectors = Array.isArray(body.sectors) ? body.sectors.map(String).filter(Boolean) : [];
    const responsibleName = body.responsibleName ? String(body.responsibleName).trim() : "";

    // Sectors and responsible person: required for complete saves; optional for drafts.
    if (isCompleteSave) {
      if (sectors.length === 0) { res.status(400).json({ error: "at_least_one_sector_required" }); return; }
      if (!responsibleName) { res.status(400).json({ error: "responsible_name_required" }); return; }
    }

    // Canonical sector validation — reject any sector not in the approved 7-sector list.
    const invalidSectors = sectors.filter((s: string) => !VALID_SECTOR_SET.has(s));
    if (invalidSectors.length > 0) {
      res.status(422).json({
        error: "invalid_sector",
        field: "sectors",
        code: "invalid_sector",
        message: `Unrecognised sector(s): ${invalidSectors.join(", ")}. Allowed: ${[...VALID_SECTOR_SET].join(", ")}`,
      });
      return;
    }

    // Reject duplicate sectors with a structured error
    const seenSectors = new Set<string>();
    const duplicateSectors = sectors.filter((s: string) => {
      if (seenSectors.has(s)) return true;
      seenSectors.add(s);
      return false;
    });
    if (duplicateSectors.length > 0) {
      res.status(422).json({
        error: "duplicate_sector",
        field: "sectors",
        code: "duplicate_sector",
        message: `Duplicate sector(s): ${[...new Set(duplicateSectors)].join(", ")}. Each sector must appear at most once.`,
      });
      return;
    }

    // Use first sector as the legacy single-sector field for backward compat.
    const sector = sectors[0] ?? null;
    let effectiveSector: string | null = sector;
    if (!effectiveSector && body.projectId) {
      const p = await pool.query<{ sector: string }>(`SELECT sector FROM projects WHERE id = $1`, [Number(body.projectId)]);
      effectiveSector = p.rows[0]?.sector ?? null;
    }
    // Only apply the sector scope guard when the plan has a concrete sector assignment.
    // A draft with no sectors yet has no sector to scope-check.
    // PLAN-009: check the full sectors array (any overlap with TC assignment).
    if (sectors.length > 0 || effectiveSector) {
      const guard = assertAnySectorAllowed(req, sectors.length > 0 ? sectors : [effectiveSector as string]);
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    }

    // Save & Finish on first save: caller passes closeRegistration=true to signal
    // that the session should be closed within the same creation transaction so
    // no active session survives COMMIT (Path B — no draft exists yet).
    const doCloseOnCreate = body.closeRegistration === true;

    const code = isHqPlan ? await generateHqPlanCode() : await generatePlanCode(stateId);
    const objectives = Array.isArray(body.objectives) ? body.objectives : [];
    const activities: ActivityInput[] = Array.isArray(body.activities) ? body.activities : [];
    const localities = normalisePlanLocalities(body.localities);

    // ── Save & Finish (closeRegistration=true) pre-transaction validation ────────
    // Date requiredness is checked at line 832 (above) before reaching here.
    // Remaining checks: locality coverage, activity completeness, budget consistency.
    if (doCloseOnCreate) {
      if (localities.length === 0) {
        res.status(400).json({ error: "geographical_coverage_required" });
        return;
      }
      if (activities.length === 0) {
        res.status(400).json({ error: "at_least_one_activity_required" });
        return;
      }
      const postPlanCtx: PlanContext = {
        startDate: canonStartDate,
        endDate: canonEndDate,
        localities,
      };
      const hasCompleteOnCreate = activities.some(
        (a) => validatePlanActivityReadiness(a, postPlanCtx) === null,
      );
      if (!hasCompleteOnCreate) {
        res.status(400).json({ error: "at_least_one_complete_activity_required" });
        return;
      }
      // Budget consistency — uses the shared validatePlanBudgetReadiness helper.
      const actBudgetTotalOnCreate = activities.reduce((s, raw) => {
        const v = Number(raw.budgetPlanned ?? 0);
        return s + (Number.isFinite(v) && v >= 0 ? v : 0);
      }, 0);
      const budgetIssueOnCreate = validatePlanBudgetReadiness(
        String(body.currency ?? ""),
        Number(body.budgetPlanned ?? NaN),
        actBudgetTotalOnCreate,
      );
      if (budgetIssueOnCreate) {
        res.status(400).json({ error: budgetIssueOnCreate });
        return;
      }
    }

    // ── Activity status/progress consistency validation (PLAN-BD-4) ─────────────
    // Pure computation — runs before the transaction to avoid an unnecessary
    // ROLLBACK when the caller passes contradictory status+progressPct values.
    // All activities are validated together so the caller receives every error
    // at once rather than discovering them one by one.
    if (activities.length > 0) {
      const progressErrors = collectActivityProgressErrors(activities);
      if (progressErrors.length > 0) {
        res.status(422).json({ error: "activity_progress_invalid", details: progressErrors });
        return;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ── PLAN-BD-2: Hard duplicate guard for structured plan types ─────────────
      //
      // Structured types (monthly/quarterly/annual) use a backend hard guard.
      // Irregular types (action/operational/emergency/custom) skip this — soft
      // warning is frontend-only and creation is always permitted.
      //
      // Advisory lock serialises concurrent creates with the same canonical identity.
      // pg_advisory_xact_lock(int8) is held for the duration of the transaction and
      // released automatically at COMMIT/ROLLBACK.  The hash is deterministic —
      // same identity always maps to the same lock key.  The lock is PG-server-wide,
      // so concurrent creates from different app servers are also serialised.
      //
      // Non-blocking statuses (PLAN-BD-2 §11): rejected, cancelled, archived.
      const STRUCTURED_PLAN_TYPES = new Set(["monthly", "quarterly", "annual"]);
      if (planType && STRUCTURED_PLAN_TYPES.has(planType) && canonStartDate && canonEndDate) {
        const lockProjectId  = body.projectId == null ? null : Number(body.projectId);
        const lockStateId    = isHqPlan ? null : stateId;
        const lockLocType    = isHqPlan ? "hq" : null;

        // Deterministic scope-branch lock key (PLAN-BD-2 race safety):
        //   project-linked → "project:<id>"
        //   HQ             → "hq"
        //   state-standalone → "state:<id>"
        //
        // Using a CASE expression ensures project-linked plans always hash on
        // project_id regardless of any client-supplied stateId, closing the
        // race where two creates for the same project+period but different
        // stateIds acquire different lock keys and both insert successfully.
        //
        // $4 = lockProjectId, $5 = lockLocType ('hq'|null), $6 = lockStateId
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
           lockStateId   == null ? null : String(lockStateId)],
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
          [planType, canonStartDate, canonEndDate,
           lockProjectId, lockLocType, lockStateId],
        );

        if (dupResult.rows.length > 0) {
          await client.query("ROLLBACK");
          const existing = dupResult.rows[0];
          // Sector visibility check: TC actors must not receive metadata for
          // plans outside their assigned sector(s) — even in a 409 response.
          // PLAN-009: multi-sector resolution via the authoritative helper.
          const dupSectors = (await getPlanEffectiveSectors(existing.id)) ?? [];
          const dupSectorCheck = assertAnySectorAllowed(req, dupSectors);
          const canSeeExisting = dupSectorCheck.ok;
          res.status(409).json({
            error: "plan_duplicate_exists",
            existing: {
              planId: canSeeExisting && existing.status === "draft" ? existing.id : null,
              status: canSeeExisting ? existing.status : null,
            },
          }); return;
        }
      }

      // ── Responsible user validation — plan-level (inside transaction) ─────────
      // Uses FOR SHARE to lock the user row and serialise concurrent deactivations
      // against the INSERT write that immediately follows.
      const parsedPostResp = parseResponsibleUserId(body.responsibleUserId);
      if (parsedPostResp === "invalid") throw new PlanValidationError("invalid_responsible_user_id");
      const postPlanRespError = await validateResponsibleUser(parsedPostResp, client);
      if (postPlanRespError) throw new PlanValidationError(postPlanRespError);

      // ── Responsible user validation — activity-level (inside transaction) ─────
      // All activities on POST are new inserts — no grandfathering needed.
      for (const rawAct of activities) {
        const parsedActResp = parseResponsibleUserId(rawAct.responsibleUserId);
        if (parsedActResp === "invalid") throw new PlanValidationError("invalid_responsible_user_id", "activities.responsibleUserId");
        const actRespErr = await validateResponsibleUser(parsedActResp, client);
        if (actRespErr) throw new PlanValidationError(actRespErr, "activities.responsibleUserId");
        if (rawAct.stateId != null) {
          const activeState = await assertActiveState(Number(rawAct.stateId));
          if (!activeState.ok) {
            throw new PlanValidationError(activeState.error, "activities.stateId");
          }
        }
        // RISK-007: risk_id must reference an existing risk
        const actRiskErr = await validateRiskReference(rawAct.riskId == null ? null : Number(rawAct.riskId), client);
        if (actRiskErr) throw new PlanValidationError(actRiskErr, "activities.riskId");
      }
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
          parsedPostResp, // validated & parsed by parseResponsibleUserId above
          canonStartDate, canonEndDate,  // canonical YYYY-MM-DD, not raw body values
          "draft", // status is always forced to draft on creation; use /transitions to advance workflow
          body.description ?? null,
          JSON.stringify(objectives),
          body.budgetPlanned != null ? Number(body.budgetPlanned) : null,
          body.budgetActual != null ? Number(body.budgetActual) : null,
          body.fundingSource ? String(body.fundingSource).trim() : null,
          body.currency ? String(body.currency).trim() : null,
          isHqPlan ? "hq" : null,      // location_type
          req.currentUser.id,
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
      // Calling createRegistrationSession(client, …) with the open transaction
      // client ensures that if the INSERT fails, the whole transaction rolls back
      // and no orphan Plan row is left behind.  The raw token is captured here
      // and (conditionally) returned to the client after COMMIT; the hash is what
      // is stored in DB.
      const rawToken = await createRegistrationSession(client, planId, req.currentUser.id);

      // ── Initial Save & Finish (Path B) ────────────────────────────────────
      // When closeRegistration=true is set on POST, the caller intends to
      // complete Registration immediately without any subsequent PATCH.
      // Close the newly created session within the same transaction so no active
      // session survives COMMIT — equivalent to the atomic Path A (PATCH with
      // closeRegistration=true).
      if (doCloseOnCreate) {
        const { createHash: ch } = await import("crypto");
        const tokenHash = ch("sha256").update(rawToken).digest("hex");
        await client.query(
          `UPDATE plan_registration_sessions
           SET closed_at = NOW()
           WHERE plan_id    = $1
             AND user_id    = $2
             AND token_hash = $3
             AND closed_at IS NULL`,
          [planId, req.currentUser.id, tokenHash],
        );
      }

      await client.query("COMMIT");

      // ── Post-COMMIT side-effects (non-critical — Plan already persisted) ────
      await logAudit({
        userId: req.currentUser.id, action: "create", module: "plans", entityId: planId,
        newValue: `${code} ${title}`,
      });

      const plan = await getPlanById(planId);

      // Notify responsible user (F2: plan assignment notifications)
      const responsibleUserId = body.responsibleUserId == null ? null : Number(body.responsibleUserId);
      if (responsibleUserId && responsibleUserId !== req.currentUser.id) {
        await createNotificationDeduped({
          userId: responsibleUserId,
          kind: "plan_assigned",
          entityType: "plan",
          entityId: planId,
          message: `You were assigned as responsible for plan "${title}"`,
          link: `/plans/${planId}`,
          dedupeKey: `plan-assignment:${planId}:${responsibleUserId}`,
        });
      }

      // Emit the correct lifecycle audit event:
      //   Save As Draft   → registration_started  (active session returned to client)
      //   Save & Finish   → registration_completed (session closed in same transaction)
      await logAudit({
        userId: req.currentUser.id,
        action: doCloseOnCreate ? "registration_completed" : "registration_started",
        module: "plans", entityId: planId,
        newValue: `${code} ${title}`,
      });
      realtime.broadcastUpdate?.({
        module: "plans",
        action: "created",
        entityId: planId,
        actorId: req.currentUser.id,
        actorName: req.currentUser.name,
      });

      if (doCloseOnCreate) {
        // Registration already closed — do NOT return a usable token.
        res.status(201).json(plan);
      } else {
        // Return the raw token once — it is a bearer credential and must not be
        // logged, stored in the DB, or exposed outside this single HTTP response.
        res.status(201).json(Object.assign({}, plan, { registrationToken: rawToken }));
      }
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof PlanValidationError) {
        res.status(422).json({ error: err.code, ...(err.field ? { field: err.field } : {}) });
        return;
      }
      // PostgreSQL CHECK constraint violation (code 23514 = check_violation).
      // This can only fire if a concurrent write slips past validation and the DB
      // CHECK constraint rejects it (migration 026, plans_date_range_check).
      // Translate to the same 422 contract so the client always gets a structured error.
      if (err && typeof (err as { code?: string }).code === "string"
          && (err as { code: string }).code === "23514") {
        res.status(422).json({ error: "end_date_before_start_date" });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

router.patch("/plans/:planId", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }

    // ── Permission check (two valid paths) ───────────────────────────────────
    // Path 1 (normal): user holds plans.update — standard edit permission.
    // Path 2 (registration-session): user holds plans.create AND presents a
    //   valid, unexpired, unclosed Registration session token for this exact
    //   plan and user.  The token was issued by POST /plans at creation time
    //   and is stored only as a SHA-256 hash on the server.
    //
    //   Creator identity, draft status, and zero approvals are NOT sufficient
    //   alone.  The Registration session token is the authoritative proof.
    //   The session is revoked on Save & Finish, Cancel/Close, Submit, or expiry.
    //   plans.create does NOT permanently grant plans.update.
    const perms = permissionsFor(req.currentUser);
    const hasUpdatePerm = perms.includes("*") || perms.includes("plans.update");
    const hasCreatePerm = perms.includes("*") || perms.includes("plans.create");
    if (!hasUpdatePerm && !hasCreatePerm) {
      res.status(403).json({ error: "forbidden", requiredPermission: "plans.update" });
      return;
    }

    const planId = Number(req.params.planId as string);
    if (!Number.isFinite(planId)) { res.status(400).json({ error: "invalid_plan_id" }); return; }
    const meta = await getPlanMeta(planId);
    if (meta === undefined) { res.status(404).json({ error: "plan_not_found" }); return; }
    const guard = assertAnySectorAllowed(req, meta.sectors);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = assertStateAllowed(req, meta.stateId, meta.locationType);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }

    // ── Resolve registration-session eligibility ──────────────────────────────
    // Runs only when user lacks plans.update.  Creator identity, draft status,
    // and approvalCount are NOT sufficient — a valid server-side session token
    // is required on every request.
    const rawToken = typeof req.body?.registrationToken === "string" ? (req.body.registrationToken as string) : "";
    if (!hasUpdatePerm) {
      if (!rawToken) {
        res.status(403).json({
          error: "forbidden",
          message: "plans.update is required to edit an existing Plan. No active Registration session was provided.",
          requiredPermission: "plans.update",
        });
        return;
      }
      const sessionOk = await validateRegistrationSession(rawToken, planId, req.currentUser.id);
      if (!sessionOk) {
        res.status(403).json({
          error: "registration_session_invalid",
          message: "The Registration session is expired, closed, or does not match this Plan and user.",
          requiredPermission: "plans.update",
        });
        return;
      }
      // Additional safety: plan must still be in draft status.
      const planStatusRow = await pool.query<{ status: string }>(`SELECT status FROM plans WHERE id = $1`, [planId]);
      if (planStatusRow.rows[0]?.status !== "draft") {
        res.status(403).json({
          error: "registration_session_invalid",
          message: "Registration-session editing is only permitted while the Plan is in Draft status.",
          requiredPermission: "plans.update",
        });
        return;
      }
      // Registration session active: allow this request to proceed.
    }

    // Explicitly strip the Registration session bearer token and the close-session
    // flag from the body before any field is read for audit or update purposes.
    // These are control/credential fields — they must never appear in audit log
    // values, structured log payloads, or error traces.
    const {
      registrationToken: _tokenRedacted,
      closeRegistration,
      ...body
    } = req.body ?? {};

    const before = await pool.query<{
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
    if (before.rows.length === 0) { res.status(404).json({ error: "plan_not_found" }); return; }

    // §§7–8: Enforce historical edit lock — current status alone is NOT sufficient.
    // A previously-approved plan without a valid Reopen after the latest Final Approval
    // is read-only even if its status has somehow become a pre-approval value via a
    // different transition, legacy data, or administrative change.
    const editable = await isPlanCurrentlyEditable(
      planId,
      before.rows[0].status as string,
      before.rows[0].lastFinalApprovedAt as Date | null,
    );
    if (!editable) {
      res.status(409).json({ error: "plan_approval_locked", message: "This Plan is Approved and must be reopened before it can be edited." });
      return;
    }

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    };
    if (body.title !== undefined) set("title", String(body.title).trim());
    if (body.planType !== undefined) {
      if (!PLAN_TYPES.has(body.planType)) { res.status(400).json({ error: "invalid_plan_type" }); return; }
      set("plan_type", body.planType);
    }
    if (body.frequency !== undefined) {
      if (body.frequency && !PLAN_FREQUENCIES.has(body.frequency)) { res.status(400).json({ error: "invalid_frequency" }); return; }
      set("frequency", body.frequency || "monthly");
    }
    if (body.projectId !== undefined) set("project_id", body.projectId == null ? null : Number(body.projectId));
    if (body.stateId !== undefined) {
      const patchStateId = Number(body.stateId);
      if (!Number.isSafeInteger(patchStateId) || patchStateId < 1) {
        res.status(400).json({ error: "invalid_state" });
        return;
      }
      if (patchStateId !== meta.stateId) {
        // Authorisation must cover the destination as well as the Plan's current
        // State. Otherwise a state-scoped editor could move an authorised Plan
        // into another State by relying only on the source-state guard above.
        const targetStateGuard = assertStateAllowed(req, patchStateId, meta.locationType);
        if (!targetStateGuard.ok) {
          res.status(targetStateGuard.status).json(targetStateGuard.body);
          return;
        }
        // Changing a State assignment is an operational write. Historical
        // assignments are grandfathered when unchanged, but a new target must
        // exist and be active before it can be persisted.
        const activeState = await assertActiveState(patchStateId);
        if (!activeState.ok) {
          res.status(422).json({
            error: activeState.error,
            message: "Plans can only be assigned to an active State.",
          });
          return;
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
    // After canonical normalisation, whitespace-only values have already been stripped.
    if (closeRegistration === true && patchLocalities !== undefined && patchLocalities.length === 0) {
      res.status(400).json({ error: "geographical_coverage_required" });
      return;
    }

    // Legacy sector / canonical sectors consistency: the legacy column must remain
    // the first element of the canonical sectors array, and the UPDATE must emit
    // exactly one `sector` assignment regardless of which fields the client sends.
    let patchSector: string | null | undefined; // undefined = not in PATCH body
    if (body.sector !== undefined) {
      const sec = body.sector || null;
      if (sec && !VALID_SECTOR_SET.has(sec)) {
        res.status(422).json({ error: "invalid_sector", field: "sector", code: "invalid_sector", message: `"${sec}" is not a recognised main sector.` });
        return;
      }
      patchSector = sec;
    }
    if (body.sectors === undefined && patchSector !== undefined) {
      // Sector-only PATCH: only meaningful on a single-sector plan — there it
      // re-syncs the canonical array; on a multi-sector plan it would silently
      // desynchronise the legacy column, so it is rejected.
      if (meta.sectors.length > 1) {
        res.status(422).json({
          error: "sector_conflicts_with_sectors",
          field: "sector",
          code: "sector_conflicts_with_sectors",
          message: "This plan has multiple sectors. Update the sectors list instead of the single legacy sector field.",
        });
        return;
      }
      set("sector", patchSector);
      params.push(JSON.stringify(patchSector ? [patchSector] : []));
      setClauses.push(`sectors = $${params.length}::jsonb`);
    }
    if (body.sectors !== undefined) {
      const secs = Array.isArray(body.sectors) ? body.sectors.map(String).filter(Boolean) : [];
      const badSecs = secs.filter((s: string) => !VALID_SECTOR_SET.has(s));
      if (badSecs.length > 0) {
        res.status(422).json({ error: "invalid_sector", field: "sectors", code: "invalid_sector", message: `Unrecognised sector(s): ${badSecs.join(", ")}` });
        return;
      }
      // Reject duplicates
      const patchSeenSectors = new Set<string>();
      const patchDupSectors = secs.filter((s: string) => {
        if (patchSeenSectors.has(s)) return true;
        patchSeenSectors.add(s);
        return false;
      });
      if (patchDupSectors.length > 0) {
        res.status(422).json({ error: "duplicate_sector", field: "sectors", code: "duplicate_sector", message: `Duplicate sector(s): ${[...new Set(patchDupSectors)].join(", ")}. Each sector must appear at most once.` });
        return;
      }
      // Paired sector/sectors payload: legacy sector must equal the first element
      // of the canonical array (an empty array is always consistent — the chain
      // falls back to the legacy column).
      if (patchSector !== undefined && secs.length > 0 && patchSector !== secs[0]) {
        res.status(422).json({
          error: "sector_conflicts_with_sectors",
          field: "sector",
          code: "sector_conflicts_with_sectors",
          message: "The sector field must match the first entry of the sectors list.",
        });
        return;
      }
      params.push(JSON.stringify(secs));
      setClauses.push(`sectors = $${params.length}::jsonb`);
      // Keep legacy sector in sync with first element — exactly one assignment
      if (secs.length > 0) set("sector", secs[0]);
      else if (patchSector !== undefined) set("sector", patchSector);
    }
    if (body.responsibleName !== undefined) set("responsible_name", body.responsibleName ? String(body.responsibleName).trim() : null);
    // Parse and validate the submitted responsibleUserId.
    // undefined = field not in PATCH body → unchanged (grandfathered if already stored).
    // Grandfathering comparison and validation both run INSIDE the transaction (see below)
    // using the locked plan row, not the stale pre-transaction `before` snapshot.
    let patchNewRespId: number | null | undefined; // undefined = not in body
    if (body.responsibleUserId !== undefined) {
      const parsedPatchResp = parseResponsibleUserId(body.responsibleUserId);
      if (parsedPatchResp === "invalid") {
        res.status(422).json({ error: "invalid_responsible_user_id" });
        return;
      }
      patchNewRespId = parsedPatchResp;
      set("responsible_user_id", patchNewRespId!);
    }
    if (body.startDate !== undefined) {
      // Pre-transaction format check: reject non-YYYY-MM-DD values (e.g. "2026-01-01junk")
      // immediately — pure syntax, no DB state needed. Effective-range ordering is deferred
      // to inside the transaction where the plan row is locked (see below).
      if (body.startDate) {
        const fmtErr = validatePlanDates(String(body.startDate), null);
        if (fmtErr) { res.status(422).json({ error: fmtErr }); return; }
      }
      // Store only the canonical 10-char ISO form.
      const rawStart = body.startDate ? String(body.startDate) : null;
      set("start_date", rawStart ? rawStart.slice(0, 10) : null);
    }
    if (body.endDate !== undefined) {
      if (body.endDate) {
        const fmtErr = validatePlanDates(null, String(body.endDate));
        if (fmtErr) { res.status(422).json({ error: fmtErr }); return; }
      }
      const rawEnd = body.endDate ? String(body.endDate) : null;
      set("end_date", rawEnd ? rawEnd.slice(0, 10) : null);
    }

    // datesChanged: whether start_date or end_date is being written this PATCH.
    // The effective-range validation (end >= start) runs INSIDE the transaction with a
    // FOR UPDATE lock so concurrent partial-date PATCHes cannot bypass it.
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

    /**
     * Sentinel class for readiness-validation failures that occur inside the
     * transaction.  Throwing this (instead of returning early) ensures ROLLBACK
     * always fires before the 400 response is sent.
     */
    class CloseRegistrationError extends Error {
      constructor(public readonly code: string) { super(code); }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ── Consolidated plan-row lock: responsible user + date validation ─────────
      // A single SELECT … FOR UPDATE covers both checks. Any field in this block
      // uses the locked row's current values — never the stale pre-transaction
      // `before` snapshot — so concurrent PATCHes are serialised and cannot
      // produce inconsistent results.
      //
      // When closeRegistration=true, the Save & Finish block re-issues its own
      // SELECT … FOR UPDATE on the same row in the same transaction; PostgreSQL
      // makes that a no-op (already locked).
      // Activity mutations MUST also serialise on the parent plan row (plan lock
      // BEFORE activity locks — the same order used by the completion transition).
      // Otherwise an activity-only PATCH that passed the pre-transaction editability
      // check could block on the completion transaction's activity locks and then
      // write an incomplete or new activity into a freshly completed plan.
    const baseRevision = req.header("x-base-revision");
    const needsPlanLock = datesChanged || (patchNewRespId !== undefined) || Array.isArray(body.activities) || Boolean(baseRevision);
      if (needsPlanLock) {
        const lockedPlan = await client.query<{
          start_date: Date | string | null;
          end_date: Date | string | null;
          responsible_user_id: number | null;
          status: string;
          last_final_approved_at: Date | string | null;
          updated_at: Date | string;
        }>(
          `SELECT start_date, end_date, responsible_user_id, status, last_final_approved_at, updated_at
           FROM plans WHERE id = $1 FOR UPDATE`,
          [planId],
        );
        const lockedRow = lockedPlan.rows[0] ?? { start_date: null, end_date: null, responsible_user_id: null, status: "draft", last_final_approved_at: null, updated_at: new Date(0) };
        if (baseRevision && new Date(lockedRow.updated_at).getTime() !== new Date(baseRevision).getTime()) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "offline_conflict", code: "revision_mismatch", message: "The plan changed while this draft was offline." });
          return;
        }

        // Re-check editability under the lock — the pre-transaction check ran on a
        // stale snapshot; a plan approved/completed concurrently must reject content
        // writes. Mirrors isPlanCurrentlyEditable but reads approvals via the
        // transaction client for a consistent view.
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
          res.status(409).json({ error: "plan_approval_locked", message: "This Plan is Approved and must be reopened before it can be edited." });
          return;
        }

        // Responsible user — grandfathering: skip when the submitted value equals
        // the locked (not stale-before) stored value.
        if (patchNewRespId !== undefined) {
          const lockedRespId = lockedRow.responsible_user_id ?? null;
          const actualRespChanged = patchNewRespId !== lockedRespId;
          if (actualRespChanged) {
            const patchRespErr = await validateResponsibleUser(patchNewRespId, client);
            if (patchRespErr) throw new PlanValidationError(patchRespErr);
          }
        }

        // Date range — check effective ordering using locked dates (not stale).
        // Format of each supplied date was already validated pre-transaction above.
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
      }

      // ── Save & Finish readiness validation (inside the transaction) ──────────
      // Validation is performed AFTER BEGIN so that:
      //   1. The Plan row is locked (SELECT … FOR UPDATE), preventing concurrent
      //      PATCHes/Submits from modifying Plan fields between our read and commit.
      //   2. Persisted Activities (when body.activities is omitted) are read through
      //      the same client, giving a consistent snapshot within the transaction.
      //   3. Any validation failure triggers ROLLBACK via the CloseRegistrationError
      //      sentinel — no partial writes survive a failed readiness check.
      //
      // Effective Activity set:
      //   - body.activities supplied → those (replacement semantics; written below
      //     in the same transaction — validated input == committed input).
      //   - body.activities omitted  → persisted plan_activities rows (unchanged
      //     by this PATCH; read through the transaction for consistency).
      if (closeRegistration === true) {
        // Lock the Plan row for the duration of this transaction.
        // Since every Activity-mutation path for a Plan goes through PATCH (which
        // now acquires this lock), concurrent PATCHes on the same Plan are
        // serialised: the second will block on FOR UPDATE until we COMMIT.
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
          // Caller supplied a replacement collection — validate those.
          // The write block below persists this exact collection in the same
          // transaction, so validated input === committed input.
          patchActs = body.activities as ActivityInput[];
          if (patchActs.length === 0) {
            throw new CloseRegistrationError("at_least_one_activity_required");
          }
        } else {
          // body.activities omitted — plan_activities are unchanged by this PATCH.
          // Read persisted rows through the same transaction client so the snapshot
          // is consistent with the locked Plan row.
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
          if (persistedActRows.rows.length === 0) {
            throw new CloseRegistrationError("at_least_one_activity_required");
          }
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
        // A plan without a defined period cannot be finalised via the direct API.
        // Throws PlanValidationError (→ 422) for consistency with other date-validation paths.
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
          effectiveCurrency,
          effectiveBudgetPlanned,
          actBudgetTotalOnPatch,
        );
        if (budgetIssueOnPatch) throw new CloseRegistrationError(budgetIssueOnPatch);
      }
      // ─────────────────────────────────────────────────────────────────────────

      if (setClauses.length > 1) {
        await client.query(`UPDATE plans SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
      }
      if (Array.isArray(body.activities)) {
        const existing = await client.query<{ id: number; responsible_user_id: number | null; state_id: number | null }>(
          `SELECT id, responsible_user_id, state_id FROM plan_activities WHERE plan_id = $1 FOR UPDATE`,
          [planId],
        );
        const existingIds = new Set(existing.rows.map((r) => r.id));
        // Build a map of current responsible_user_id per activity ID for grandfathering.
        const currentRespMap = new Map<number, number | null>(
          existing.rows.map((r) => [r.id, r.responsible_user_id]),
        );
        const currentStateMap = new Map<number, number | null>(
          existing.rows.map((r) => [r.id, r.state_id]),
        );

        // ── Activity responsible-user validation (before any write) ───────────
        // Grandfathering: if an activity's responsibleUserId is unchanged from what
        // is currently stored (even if the user is now inactive), skip validation.
        // Only new assignments or changed assignments are validated.
        // Passes `client` so FOR SHARE serialises concurrent user deactivations.
        for (const raw of body.activities as ActivityInput[]) {
          const newResp = raw.responsibleUserId == null ? null : Number(raw.responsibleUserId);
          const actId = raw.id ? Number(raw.id) : null;
          const currentResp = actId != null ? (currentRespMap.get(actId) ?? undefined) : undefined;
          const isUnchanged = actId != null && currentResp === newResp;
          if (!isUnchanged) {
            const actRespErr = await validateResponsibleUser(newResp, client);
            if (actRespErr) {
              throw new PlanValidationError(actRespErr, "activities.responsibleUserId");
            }
          }
          const newStateId = raw.stateId == null ? null : Number(raw.stateId);
          const currentState = actId != null ? (currentStateMap.get(actId) ?? undefined) : undefined;
          if (!(actId != null && currentState === newStateId) && newStateId != null) {
            const activeState = await assertActiveState(newStateId);
            if (!activeState.ok) {
              throw new PlanValidationError(activeState.error, "activities.stateId");
            }
          }
          // RISK-007: risk_id must reference an existing risk (create + update)
          const actRiskErr = await validateRiskReference(raw.riskId == null ? null : Number(raw.riskId), client);
          if (actRiskErr) throw new PlanValidationError(actRiskErr, "activities.riskId");
        }

        // ── Activity status/progress consistency validation (PLAN-BD-4) ─────────
        // Validate the full activity array before any DB write. Throws
        // ActivityProgressValidationError so the surrounding catch block rolls back
        // the transaction and returns all errors together (422).
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
          // Clear plan_activity_id on any risks that reference these activities BEFORE
          // deleting the activity rows. There is no DB-level FK constraint on
          // risks.plan_activity_id, so the delete would otherwise silently create
          // dangling references. SET NULL preserves the risk in the register as an
          // activity-less entry (same pattern as the whole-plan delete handler).
          await client.query(
            `UPDATE risks SET plan_activity_id = NULL WHERE plan_activity_id = ANY($1::int[])`,
            [toDelete],
          );
          await client.query(`DELETE FROM plan_activities WHERE plan_id = $1 AND id = ANY($2::int[])`, [planId, toDelete]);
        }
      }
      // ── Atomically revoke Registration session on Save & Finish ───────────
      // When the client signals closeRegistration=true (Save & Finish),
      // the session is closed within the same transaction so the plan save
      // and session revocation are atomic — no window where the session
      // remains open after the final save completes.
      const doCloseSession = !hasUpdatePerm && closeRegistration === true && rawToken;
      if (doCloseSession) {
        const { createHash } = await import("crypto");
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        await client.query(
          `UPDATE plan_registration_sessions
           SET closed_at = NOW()
           WHERE plan_id    = $1
             AND user_id    = $2
             AND token_hash = $3
             AND closed_at IS NULL`,
          [planId, req.currentUser.id, tokenHash],
        );
      }
      // Sector-scope re-validation runs INSIDE the transaction so an unauthorised
      // sector move is rolled back, never committed. It covers sector, sectors and
      // projectId changes and reads the updated row via the transaction client —
      // a TC cannot reassign a plan to sectors outside their own assignment.
      if (body.sector !== undefined || body.sectors !== undefined || body.projectId !== undefined) {
        const proposedMeta = await getPlanMeta(planId, client);
        const postGuard = assertAnySectorAllowed(req, proposedMeta?.sectors ?? []);
        if (!postGuard.ok) {
          await client.query("ROLLBACK");
          res.status(postGuard.status).json(postGuard.body);
          return;
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof ActivityProgressValidationError) {
        res.status(422).json({ error: "activity_progress_invalid", details: err.details });
        return;
      }
      if (err instanceof PlanValidationError) {
        res.status(422).json({ error: err.code, ...(err.field ? { field: err.field } : {}) });
        return;
      }
      if (err instanceof CloseRegistrationError) {
        res.status(400).json({ error: err.code });
        return;
      }
      // PostgreSQL CHECK constraint violation (code 23514 = check_violation).
      // Translates any residual plans_date_range_check violation (e.g. concurrent write
      // that raced past transactional validation) into the same structured 422 contract.
      if (err && typeof (err as { code?: string }).code === "string"
          && (err as { code: string }).code === "23514") {
        res.status(422).json({ error: "end_date_before_start_date" });
        return;
      }
      throw err;
    } finally {
      client.release();
    }

    await logAudit({
      userId: req.currentUser.id, action: "update", module: "plans", entityId: planId,
      oldValue: before.rows[0].title, newValue: String(body.title ?? before.rows[0].title),
    });
    // Audit registration completion (Save & Finish)
    if (!hasUpdatePerm && closeRegistration === true) {
      await logAudit({
        userId: req.currentUser.id, action: "registration_completed", module: "plans", entityId: planId,
      });
    }
    realtime.broadcastUpdate?.({
      module: "plans",
      action: Array.isArray(body.activities) ? "activities_updated" : "updated",
      entityId: planId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    const plan = await getPlanById(planId);
    res.json(plan);
  } catch (err) { next(err); }
});

// ─── Close Registration Session ───────────────────────────────────────────────
// POST /plans/:planId/close-registration
// Explicitly revokes an active Registration session, preventing further creation-
// session PATCH calls.  Called by the frontend when the user explicitly cancels
// or closes Registration after a Draft has been saved.
//
// The saved Draft is preserved; only the temporary edit privilege is removed.
// Normal permissions (plans.update etc.) continue to apply to the persisted Draft.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/plans/:planId/close-registration", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const planId = Number(req.params.planId as string);
    if (!Number.isFinite(planId)) { res.status(400).json({ error: "invalid_plan_id" }); return; }

    const rawToken = typeof req.body?.registrationToken === "string" ? (req.body.registrationToken as string) : "";
    if (!rawToken) {
      res.status(400).json({ error: "registrationToken_required" });
      return;
    }

    // Validate that the token belongs to this user+plan before closing it.
    const sessionOk = await validateRegistrationSession(rawToken, planId, req.currentUser.id);
    if (!sessionOk) {
      // Already expired or closed — treat as success (idempotent).
      res.json({ closed: true });
      return;
    }

    await closeRegistrationSession(planId, req.currentUser.id, rawToken);
    await logAudit({
      userId: req.currentUser.id, action: "registration_closed", module: "plans", entityId: planId,
    });
    realtime.broadcastUpdate?.({
      module: "plans",
      action: "registration_closed",
      entityId: planId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    res.json({ closed: true });
  } catch (err) { next(err); }
});

router.delete("/plans/:planId", requirePerm("plans.delete", "You do not have permission to delete this Plan."), async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const planId = Number(req.params.planId);
    const meta = await getPlanMeta(planId);
    if (meta === undefined) { res.status(404).json({ error: "plan_not_found" }); return; }
    const guard = assertAnySectorAllowed(req, meta.sectors);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = assertStateAllowed(req, meta.stateId, meta.locationType);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    let deletionAudience: Awaited<ReturnType<typeof realtime.captureOperationalAudience>> | undefined;
    // ── Durable delete: DB first, storage post-COMMIT ────────────────────────
    //
    // Ordering rationale:
    //   • The delete transaction begins by acquiring an exclusive row lock on the
    //     plan row (SELECT … FOR UPDATE).  Because migration 024 added a
    //     FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE to
    //     plan_attachments, every concurrent attachment upload must acquire a KEY
    //     SHARE lock on the same plans row via the FK check.  KEY SHARE conflicts
    //     with FOR UPDATE — so new uploads block until this transaction commits,
    //     guaranteeing the path-collection SELECT sees the complete, stable set of
    //     attachments for this plan.
    //   • All DB rows are deleted inside a single atomic transaction (DB first).
    //   • Storage objects are deleted AFTER COMMIT (best-effort).
    //     – If the DB transaction fails → ROLLBACK, zero files deleted, consistent
    //       state.  (Storage-before-DB is the unsafe order: a DB rollback cannot
    //       restore an already-deleted storage object.)
    //     – If the DB transaction succeeds but a storage delete fails → the file
    //       becomes an orphan in object storage (inaccessible via DB), logged for
    //       admin reconciliation.  The 204 response still succeeds because the plan
    //       is gone from the DB and the orphaned file is recoverable by tooling.

    let attachmentObjectPaths: string[] = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the plan row exclusively.  This blocks concurrent attachment uploads
      // (which acquire KEY SHARE via the plan_attachments FK) until we COMMIT,
      // so the path-collection SELECT below is serialised with any in-flight upload.
      await client.query(`SELECT id FROM plans WHERE id = $1 FOR UPDATE`, [planId]);
      // Capture only after the parent lock is held. This prevents a concurrent
      // state/sector/project-scope edit from changing who is authorised between
      // the snapshot and the committed delete.
      deletionAudience = await realtime.captureOperationalAudience?.("plan", planId, client);

      // Collect attachment paths atomically under the exclusive lock.
      const attachmentPathsResult = await client.query<{ object_path: string }>(
        `SELECT object_path FROM plan_attachments WHERE plan_id = $1
         UNION ALL
         SELECT object_path FROM attachments WHERE parent_type = 'plan' AND parent_id = $1
         UNION ALL
         SELECT object_path FROM attachment_upload_operations WHERE parent_type = 'plan' AND parent_id = $1
         UNION ALL
         SELECT final_object_path AS object_path FROM attachment_upload_operations
          WHERE parent_type = 'plan' AND parent_id = $1 AND final_object_path IS NOT NULL`,
        [planId],
      );
      attachmentObjectPaths = attachmentPathsResult.rows.map((r) => r.object_path);

      // 1. Registration sessions — no FK to plans; must be cleaned explicitly.
      //    Any active session referencing this plan_id becomes a dangling orphan
      //    that would allow token-based PATCH calls on a non-existent plan.
      await client.query(`DELETE FROM plan_registration_sessions WHERE plan_id = $1`, [planId]);

      // 2. Comments — polymorphic reference (entity_type='plan', entity_id); no FK.
      //    Reviewer feedback (revision_request, rejection_reason) for a deleted plan
      //    has no operational retention value. Audit history is preserved via audit_log.
      await client.query(
        `DELETE FROM comments WHERE entity_type = 'plan' AND entity_id = $1`,
        [planId],
      );

      // 3. Approvals — polymorphic reference; no FK to plans.
      //    Workflow history for the plan (submit, review, reopen, etc.) is intentionally
      //    removed here because the plan itself no longer exists. Full audit evidence
      //    is retained in the audit_log table (which is NEVER deleted — see below).
      await client.query(
        `DELETE FROM approvals WHERE entity_type = 'plan' AND entity_id = $1`,
        [planId],
      );

      // 4. Risks — two unbound integer columns reference plan data (no DB-level FK constraints):
      //    a. risks.plan_id   — direct link to the plan itself.
      //    b. risks.plan_activity_id — link to a specific plan activity row.
      //    Both must be cleared before activities are deleted and before the plan row is removed.
      //    Operational risks must NOT be silently destroyed; SET NULL preserves them as
      //    plan-less / activity-less entries so they remain in the risk register.
      await client.query(
        `UPDATE risks
         SET plan_activity_id = NULL
         WHERE plan_activity_id IN (
           SELECT id FROM plan_activities WHERE plan_id = $1
         )`,
        [planId],
      );
      await client.query(`UPDATE risks SET plan_id = NULL WHERE plan_id = $1`, [planId]);

      // 5. Plan attachments — DB metadata rows deleted atomically in the transaction.
      //    Storage objects are deleted post-COMMIT (see below) — the DB is the
      //    source of truth; once metadata is gone the files are effectively inaccessible.
      await client.query(`DELETE FROM plan_attachments WHERE plan_id = $1`, [planId]);
      await client.query(
        `INSERT INTO attachment_upload_cleanup_jobs
           (operation_id, object_path, final_object_path)
         SELECT operation_id, object_path, final_object_path
         FROM attachment_upload_operations
         WHERE parent_type = 'plan' AND parent_id = $1
           AND status <> 'finalised'
         ON CONFLICT (operation_id) DO NOTHING`,
        [planId],
      );
      await client.query(`DELETE FROM attachment_upload_operations WHERE parent_type = 'plan' AND parent_id = $1`, [planId]);
      await client.query(`DELETE FROM attachments WHERE parent_type = 'plan' AND parent_id = $1`, [planId]);

      // 6. Plan activities — explicit delete (no FK cascade declared in plan_activities).
      //    risks.plan_activity_id has already been cleared above, so no dangling references remain.
      await client.query(`DELETE FROM plan_activities WHERE plan_id = $1`, [planId]);

      // 7. Plans — the plan row itself.
      await client.query(`DELETE FROM plans WHERE id = $1`, [planId]);

      // NOTE: audit_log rows referencing this plan are intentionally PRESERVED.
      //       The audit trail must survive plan deletion for governance purposes.

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // ── Post-COMMIT: delete storage objects (best-effort) ────────────────────
    // DB is committed at this point — the plan is gone.  Storage failures are
    // logged for admin reconciliation but do NOT fail the 204 response.
    for (const objectPath of attachmentObjectPaths) {
      try {
        await deleteStorageObjectSafely(objectPath);
      } catch (storErr) {
        console.error("[PLAN-DEL] post_commit storage_error planId=%d objectPath=%s err=%s", planId, objectPath, storErr);
        // Do not re-throw: the DB delete is committed; orphaned storage objects
        // are recoverable by admin tooling and do not represent user data loss.
      }
    }

    await logAudit({ userId: req.currentUser.id, action: "delete", module: "plans", entityId: planId });
    realtime.broadcastUpdate?.({
      module: "plans",
      action: "deleted",
      entityId: planId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
      deletionAudience,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

export const PLAN_TRANSITION_PERMS: Record<string, string> = {
  submit: "plans.create",
  technical_review: "projects.approve.technical",
  coordination_review: "plans.approve.coordination",
  final_approve: "plans.approve.final",
  activate: "plans.update",
  start: "plans.update",
  mark_delayed: "plans.update",
  complete: "plans.update",
  cancel: "plans.update",
  archive: "plans.update",
  reject: "projects.approve.technical",
  request_revision: "projects.approve.technical",
};

router.post("/plans/:planId/transitions", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const planId = Number(req.params.planId);
    const body = req.body ?? {};
    const action = String(body.action ?? "");
    const transition = PLAN_TRANSITIONS[action];
    if (!transition) { res.status(400).json({ error: `invalid_action:${action}` }); return; }
    const transitionPerm = PLAN_TRANSITION_PERMS[action];
    if (transitionPerm) {
      const perms = permissionsFor(req.currentUser);
      if (!perms.includes("*") && !perms.includes(transitionPerm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: transitionPerm });
        return;
      }
    }

    const cur = await pool.query(`SELECT status, sector, project_id, state_id AS "stateId" FROM plans WHERE id = $1`, [planId]);
    if (cur.rows.length === 0) { res.status(404).json({ error: "plan_not_found" }); return; }
    const meta = await getPlanMeta(planId);
    const sectorGuard = assertAnySectorAllowed(req, meta?.sectors ?? []);
    if (!sectorGuard.ok) { res.status(sectorGuard.status).json(sectorGuard.body); return; }
    const stateGuard = assertStateAllowed(req, cur.rows[0].stateId as number);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const fromStatus = cur.rows[0].status as string;
    if (!transition.from.includes(fromStatus)) {
      // PLAN-016: wrong-source status is a concurrency/state conflict → 409 Conflict.
      res.status(409).json({ error: `cannot_${action}_from_${fromStatus}` });
      return;
    }

    if (action === "submit") {
      // ─── Transactional Submit For Approval ──────────────────────────────
      // All validation, writes, and audit occur inside a single transaction
      // with a FOR UPDATE lock on the Plan row. This closes the TOCTOU race
      // between a concurrent PATCH / Save & Finish and this Submit, and also
      // prevents two concurrent Submit requests from both succeeding.
      class SubmitError extends Error {
        constructor(public readonly code: string, public readonly httpStatus: number = 400) { super(code); }
      }
      let submitFromStatus = "";
      let lockedEffectiveSector: string | null = null;
      const submitClient = await pool.connect();
      try {
        await submitClient.query("BEGIN");

        // §2 Lock the Plan row — row-level exclusive lock, same model as PATCH.
        // No concurrent PATCH or Submit on the same Plan can acquire this lock
        // until this transaction commits or rolls back.
        // NOTE: The projects row is intentionally NOT joined here. If the Plan
        // has its own sector the JOIN is unnecessary; if the Plan sector is blank
        // we need a separate FOR SHARE on the projects row (see below). A bare
        // LEFT JOIN without a project-row lock would leave the fallback sector
        // unprotected against a concurrent PATCH /projects/:id that changes sector.
        const lockedPlanResult = await submitClient.query<{
          status: string;
          description: string | null;
          start_date: Date | string | null;
          end_date: Date | string | null;
          localities: unknown;
          currency: string | null;
          budget_planned: number | null;
          planSector: string | null;
          planSectors: unknown;
          projectId: number | null;
          stateId: number | null;
        }>(
          `SELECT status, description, start_date, end_date,
                  COALESCE(localities, '[]'::jsonb) AS localities,
                  currency, budget_planned,
                  NULLIF(sector, '') AS "planSector",
                  COALESCE(sectors, '[]'::jsonb) AS "planSectors",
                  project_id AS "projectId",
                  state_id AS "stateId"
           FROM plans
           WHERE id = $1
           FOR UPDATE`,
          [planId],
        );
        if (lockedPlanResult.rows.length === 0) {
          throw new SubmitError("plan_not_found");
        }
        const lockedPlan = lockedPlanResult.rows[0];
        submitFromStatus = lockedPlan.status;

        // §3/§5 Resolve effective sector — Plan sector takes precedence.
        // If Plan.sector is blank and a linked project exists, read the project
        // sector with FOR SHARE. FOR SHARE blocks a concurrent UPDATE on the
        // projects row (which requires ROW EXCLUSIVE) so the sector value is
        // stable for the duration of this transaction.
        // When Plan.sector is non-blank, no project lock is required.
        // PLAN-009: effective sectors = full sectors array → [sector] → [project sector].
        let effectiveSectors: string[] = normaliseSectors(lockedPlan.planSectors);
        if (effectiveSectors.length === 0 && lockedPlan.planSector) {
          effectiveSectors = [lockedPlan.planSector];
        }
        if (effectiveSectors.length === 0 && lockedPlan.projectId !== null) {
          const projSectorResult = await submitClient.query<{ sector: string | null }>(
            `SELECT NULLIF(sector, '') AS sector FROM projects WHERE id = $1 FOR SHARE`,
            [lockedPlan.projectId],
          );
          const projSector = projSectorResult.rows[0]?.sector ?? null;
          if (projSector) effectiveSectors = [projSector];
        }
        lockedEffectiveSector = effectiveSectors[0] ?? null;

        // §5 Re-verify workflow eligibility from the locked Plan row.
        // The pre-transaction `fromStatus` read cannot protect against a concurrent
        // PATCH that changed the status between that read and the transaction start.
        // A wrong-source status discovered under the lock is a concurrency conflict,
        // consistent with the PLAN-016 alignment elsewhere → 409 Conflict.
        if (!transition.from.includes(lockedPlan.status)) {
          throw new SubmitError(`cannot_submit_from_${lockedPlan.status}`, 409);
        }

        // §1/§6 Re-check Plan-specific authorisation using locked Plan data.
        // Sector is now authoritative: Plan sector from FOR UPDATE, or project
        // sector from FOR SHARE — whichever applied. A concurrent Project PATCH
        // cannot change projects.sector until this transaction releases its FOR SHARE.
        const lockedSectorGuard = assertAnySectorAllowed(req, effectiveSectors);
        if (!lockedSectorGuard.ok) {
          throw new SubmitError(
            (lockedSectorGuard.body as { error: string }).error,
            lockedSectorGuard.status,
          );
        }
        const lockedStateGuard = assertStateAllowed(req, lockedPlan.stateId as number);
        if (!lockedStateGuard.ok) {
          throw new SubmitError(lockedStateGuard.body.error, lockedStateGuard.status);
        }

        // §4 Read persisted Activities through the transaction client (after lock).
        const lockedActsResult = await submitClient.query<{
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

        // §7 Readiness validation — all existing rules, against locked DB state.

        // Presence check: at least one Activity must exist.
        if (lockedActsResult.rows.length === 0) {
          throw new SubmitError("at_least_one_activity_required");
        }

        // Description is required for submission.
        if (!lockedPlan.description?.trim()) {
          throw new SubmitError("description_required");
        }

        // Geographical Coverage is required for submission.
        const submitPlanLocs = normalisePlanLocalities(lockedPlan.localities);
        if (submitPlanLocs.length === 0) {
          throw new SubmitError("geographical_coverage_required");
        }

        // Full 7-rule readiness check via the shared validator using authoritative DB state.
        const submitCtx: PlanContext = {
          startDate: pgDateToIso(lockedPlan.start_date ?? null),
          endDate: pgDateToIso(lockedPlan.end_date ?? null),
          localities: submitPlanLocs,
        };
        const submitActInputs: ActivityInput[] = lockedActsResult.rows.map((row) => ({
          title: row.title ?? "",
          localityName: row.locality_name ?? "",
          plannedDate: pgDateToIso(row.planned_date) ?? "",
          priority: row.priority ?? "",
          targetBeneficiaries: row.target_beneficiaries ?? undefined,
          budgetPlanned: row.budget_planned ?? undefined,
          expectedResult: row.expected_result ?? "",
        }));
        const hasCompleteOnSubmit = submitActInputs.some(
          (a) => validatePlanActivityReadiness(a, submitCtx) === null,
        );
        if (!hasCompleteOnSubmit) {
          throw new SubmitError("at_least_one_complete_activity_required");
        }

        // Budget consistency — read from DB; do NOT trust frontend totals.
        const submitActBudgetTotal = lockedActsResult.rows.reduce((s, row) => {
          const v = Number(row.budget_planned ?? 0);
          return s + (Number.isFinite(v) && v >= 0 ? v : 0);
        }, 0);
        const budgetIssueOnSubmit = validatePlanBudgetReadiness(
          lockedPlan.currency ?? "",
          lockedPlan.budget_planned ?? NaN,
          submitActBudgetTotal,
        );
        if (budgetIssueOnSubmit) {
          throw new SubmitError(budgetIssueOnSubmit);
        }

        // §12 Revoke active Registration sessions — once the Plan leaves Draft,
        // creation-session editing is permanently over. Inlined via transaction
        // client so revocation and status transition are atomic.
        await submitClient.query(
          `UPDATE plan_registration_sessions
           SET closed_at = NOW()
           WHERE plan_id   = $1
             AND closed_at IS NULL`,
          [planId],
        );

        // §6 Conditional status transition — WHERE id AND status = expected.
        // If a concurrent Submit already committed and changed the status,
        // this UPDATE matches zero rows and we fail without creating a duplicate
        // transition, approval, or audit record.
        const transitionResult = await submitClient.query(
          `UPDATE plans
           SET status = $1, updated_at = NOW()
           WHERE id = $2 AND status = $3`,
          [transition.to, planId, lockedPlan.status],
        );
        if ((transitionResult.rowCount ?? 0) !== 1) {
          throw new SubmitError(`cannot_submit_from_${lockedPlan.status}`);
        }

        // §10 Approval record — inside transaction for atomicity.
        await submitClient.query(
          `INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, comment)
           VALUES ('plan', $1, $2, $3, $4, $5, $6)`,
          [planId, action, lockedPlan.status, transition.to, req.currentUser.id, body.comment ?? null],
        );

        // §10 Audit log — inlined via transaction client for atomicity.
        await submitClient.query(
          `INSERT INTO audit_log (user_id, action, module, entity_id, old_value, new_value)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.currentUser.id, action, "plans", planId, lockedPlan.status, transition.to],
        );

        await submitClient.query("COMMIT");
      } catch (err) {
        await submitClient.query("ROLLBACK");
        if (err instanceof SubmitError) {
          res.status(err.httpStatus).json({ error: err.code });
          return;
        }
        throw err;
      } finally {
        submitClient.release();
      }

      // §10 Notifications — delivered after COMMIT. These are non-transactional:
      // they fan out to multiple users and may involve external delivery (email).
      // A notification failure must not roll back a successfully committed transition.
      // Use the effective sector captured from the locked Plan row (COALESCE of plan sector with project sector).
      const planSectorForNotify = lockedEffectiveSector;
      const submitDedupeKey =
        `plan-transition:${planId}:${action}:${submitFromStatus}:${transition.to}`;
      await notifyEntityActorsDeduped({
        entityType: "plan",
        entityId: planId,
        kind: "resubmitted",
        message: `Plan transitioned ${submitFromStatus} → ${transition.to} by ${req.currentUser.name}`,
        dedupeKey: submitDedupeKey,
        link: `/plans/${planId}`,
        exceptUserId: req.currentUser.id,
        mandatory: false,
      });
      await notifyNextApprover({
        action,
        entityType: "plan",
        entityId: planId,
        sector: planSectorForNotify,
        message: `A plan requires your review by ${req.currentUser.name}`,
        link: `/plans/${planId}`,
        exceptUserId: req.currentUser.id,
        dedupeKey: `${submitDedupeKey}:next-approver`,
      });

      realtime.broadcastUpdate?.({
        module: "plans",
        action,
        entityId: planId,
        actorId: req.currentUser.id,
        actorName: req.currentUser.name,
      });
      const plan = await getPlanById(planId);
      res.json(plan);
      return; // Submit is fully self-contained; shared code below is for other actions.
    }
    if (action === "final_approve") {
      const n = await unresolvedRequiredCorrections("plan", planId);
      if (n > 0) {
        res.status(409).json({ error: "unresolved_required_corrections", count: n });
        return;
      }
    }
    const commentText = String(body.comment ?? "").trim();
    if ((action === "request_revision" || action === "reject") && !commentText) {
      res.status(400).json({ error: "comment_required_for_revision_or_reject" });
      return;
    }

    // ─── PLAN-004: Atomic CAS Transition ─────────────────────────────────────────
    // All non-submit transitions are wrapped in a single client transaction.
    // The UPDATE includes an AND status = $expectedSource predicate (Compare-And-Swap).
    // If a concurrent transition already changed the status, rowCount = 0 → 409 Conflict.
    // Approval record, optional comment, and audit log are all inside the same transaction,
    // so a partial commit (status updated but no approval row) is impossible.
    // Notifications are sent AFTER COMMIT so a failed or stale transition produces none.
    const transitionClient = await pool.connect();
    try {
      await transitionClient.query("BEGIN");

      // ─── Completed-plan integrity gate (Wave 1) ────────────────────────────────
      // The `complete` transition is only permitted when every eligible
      // (non-cancelled) activity is completed at 100% progress, and at least one
      // such activity exists. This is race-safe: the plan row is locked FOR UPDATE
      // and the activity rows FOR UPDATE, so a concurrent activity mutation or
      // transition cannot slip past the gate before COMMIT. The gate applies to
      // ALL roles — PM/Super Admin Full Access does not bypass completion integrity.
      if (action === "complete") {
        const lockedPlan = await transitionClient.query<{ status: string }>(
          `SELECT status FROM plans WHERE id = $1 FOR UPDATE`,
          [planId],
        );
        if (lockedPlan.rows.length === 0) {
          await transitionClient.query("ROLLBACK");
          res.status(404).json({ error: "plan_not_found" });
          return;
        }
        if (lockedPlan.rows[0].status !== fromStatus || !transition.from.includes(lockedPlan.rows[0].status)) {
          await transitionClient.query("ROLLBACK");
          res.status(409).json({
            error: "plan_status_conflict",
            message: "The plan status has changed; please refresh and try again.",
          });
          return;
        }
        const acts = await transitionClient.query<{ status: string; progress_pct: number | null }>(
          `SELECT status, progress_pct FROM plan_activities
           WHERE plan_id = $1 AND status <> 'cancelled'
           FOR UPDATE`,
          [planId],
        );
        const incomplete =
          acts.rows.length === 0 ||
          acts.rows.some((a) => a.status !== "completed" || Number(a.progress_pct) !== 100);
        if (incomplete) {
          await transitionClient.query("ROLLBACK");
          res.status(409).json({
            error: "plan_activities_incomplete",
            message:
              "This plan cannot be marked as completed. Every non-cancelled activity must be completed with 100% progress, and at least one non-cancelled activity must exist.",
          });
          return;
        }
      }

      // CAS UPDATE — only succeeds if the plan is still in the expected source status.
      // Record the exact timestamp when a plan reaches final approval so the lock and
      // "Previously Approved" UX hint can reference it even after a later reopen.
      const casResult = await transitionClient.query(
        action === "final_approve"
          ? `UPDATE plans SET status = $1, updated_at = NOW(), last_final_approved_at = NOW()
             WHERE id = $2 AND status = $3
             RETURNING id`
          : `UPDATE plans SET status = $1, updated_at = NOW()
             WHERE id = $2 AND status = $3
             RETURNING id`,
        [transition.to, planId, fromStatus],
      );

      if ((casResult.rowCount ?? 0) === 0) {
        // Another concurrent transition committed first — the source status has changed.
        await transitionClient.query("ROLLBACK");
        res.status(409).json({
          error: "plan_status_conflict",
          message: "The plan status has changed; please refresh and try again.",
        });
        return;
      }

      // Approval record — inside transaction for atomicity.
      await transitionClient.query(
        `INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, comment)
         VALUES ('plan', $1, $2, $3, $4, $5, $6)`,
        [planId, action, fromStatus, transition.to, req.currentUser.id, body.comment ?? null],
      );

      // Optional comment for revision/rejection — inside transaction.
      if (commentText && (action === "request_revision" || action === "reject")) {
        await transitionClient.query(
          `INSERT INTO comments (entity_type, entity_id, comment_type, author_id, body)
           VALUES ('plan', $1, $2, $3, $4)`,
          [planId, action === "request_revision" ? "revision_request" : "rejection_reason", req.currentUser.id, commentText],
        );
      }

      // Audit log — inside transaction for internal consistency.
      await transitionClient.query(
        `INSERT INTO audit_log (user_id, action, module, entity_id, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.currentUser.id, action, "plans", planId, fromStatus, transition.to],
      );

      await transitionClient.query("COMMIT");
    } catch (err) {
      await transitionClient.query("ROLLBACK");
      throw err;
    } finally {
      transitionClient.release();
    }
    // ─── End PLAN-004 CAS Transaction ────────────────────────────────────────────

    // Notifications — delivered AFTER COMMIT only. A failed or stale transition
    // (rowCount=0 → early return above) produces zero notifications.
    const kindMap: Record<string, string> = {
      request_revision: "returned",
      reject: "rejected",
      final_approve: "approved",
      submit: "resubmitted",
      technical_review: "technically_reviewed",
      coordination_review: "coordination_reviewed",
      activate: "activated",
      start: "started",
      mark_delayed: "delayed",
      complete: "completed",
      cancel: "cancelled",
      archive: "archived",
    };
    const transitionDedupeKey =
      `plan-transition:${planId}:${action}:${fromStatus}:${transition.to}`;
    await notifyEntityActorsDeduped({
      entityType: "plan",
      entityId: planId,
      kind: kindMap[action] ?? "system",
      message: `Plan transitioned ${fromStatus} → ${transition.to} by ${req.currentUser.name}${commentText ? `: ${commentText}` : ""}`,
      dedupeKey: transitionDedupeKey,
      link: `/plans/${planId}`,
      exceptUserId: req.currentUser.id,
      mandatory: action === "reject" || action === "request_revision",
    });
    // G-01: notify next approver in chain
    // PLAN-009: canonical primary sector = first element of the effective sectors
    // array (resolved via the authoritative helper), never the raw legacy column.
    const planSectorForNotify = meta?.sectors[0] ?? null;
    await notifyNextApprover({
      action,
      entityType: "plan",
      entityId: planId,
      sector: planSectorForNotify,
      message: `A plan requires your review by ${req.currentUser.name}`,
      link: `/plans/${planId}`,
      exceptUserId: req.currentUser.id,
      dedupeKey: `${transitionDedupeKey}:next-approver`,
    });

    realtime.broadcastUpdate?.({
      module: "plans",
      action,
      entityId: planId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    const plan = await getPlanById(planId);
    res.json(plan);
  } catch (err) { next(err); }
});

// ─── Reopen For Editing ───────────────────────────────────────────────────────
// POST /plans/:planId/reopen
// Transitions an Approved (or post-approval) Plan back to Draft so it can be
// edited and re-submitted through the full approval workflow.
//
// Rules (spec §§3–14):
//  • Requires plans.reopen permission (separate from plans.update and plans.delete).
//  • Only allowed from REOPENABLE_STATUSES (not terminal: completed/cancelled/archived).
//  • A mandatory "reason" must be supplied in the request body.
//  • Sets status = "draft"; last_final_approved_at is PRESERVED (never cleared).
//  • Writes an approvals row and an audit log entry for the full history.
//  • Idempotent: if already in a pre-approval editable state, returns current plan.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/plans/:planId/reopen", requirePerm("plans.reopen", "You do not have permission to reopen this Plan."), async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const planId = Number(req.params.planId as string);
    if (!Number.isFinite(planId)) { res.status(400).json({ error: "invalid_plan_id" }); return; }

    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) { res.status(400).json({ error: "reason_required", message: "A reason for reopening is required." }); return; }

    const meta = await getPlanMeta(planId);
    if (meta === undefined) { res.status(404).json({ error: "plan_not_found" }); return; }

    const sectorGuard = assertAnySectorAllowed(req, meta.sectors);
    if (!sectorGuard.ok) { res.status(sectorGuard.status).json(sectorGuard.body); return; }
    const stateGuard = assertStateAllowed(req, meta.stateId, meta.locationType);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }

    // ─── PLAN-006: Reopen lock inside transaction ─────────────────────────────
    // The SELECT … FOR UPDATE and the mutation UPDATE must be on the same client
    // connection and inside the same BEGIN/COMMIT block.
    // Previously the FOR UPDATE was issued via pool.query() (a statement-level call),
    // which releases the lock immediately after the query completes — long before the
    // mutation transaction starts.  That gave zero concurrency protection.
    //
    // With this fix:
    //   1. BEGIN is issued first.
    //   2. SELECT … FOR UPDATE runs on the same client — row is locked.
    //   3. The editability check runs on the same client (reads approvals in the
    //      same transaction snapshot) — no race between check and mutation.
    //   4. UPDATE plans and INSERT INTO approvals run while the lock is held.
    //   5. COMMIT releases the lock atomically with the writes.
    //
    // A concurrent reopen attempt blocks on step 2.  When it eventually acquires the
    // lock, the status is already 'draft' — which is not in REOPENABLE_STATUSES —
    // so it returns a controlled conflict response without creating a duplicate
    // approval row.
    let currentStatus = "";
    let planCode = "";
    let planTitle = "";
    let lastFinalApprovedAt: string | null = null;
    let alreadyEditable = false;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the plan row — same client, same transaction.
      const cur = await client.query<{ status: string; code: string; title: string; last_final_approved_at: string | null }>(
        `SELECT status, code, title, last_final_approved_at FROM plans WHERE id = $1 FOR UPDATE`,
        [planId],
      );
      if (cur.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "plan_not_found" });
        return;
      }
      currentStatus       = cur.rows[0].status;
      planCode            = cur.rows[0].code;
      planTitle           = cur.rows[0].title;
      lastFinalApprovedAt = cur.rows[0].last_final_approved_at;

      // Idempotency: inline editability check using the locked row and transaction client.
      // Equivalent to isPlanCurrentlyEditable() but uses the same client/transaction so
      // the approvals read is consistent with the locked plan row.
      //   Case A: never finally approved + pre-approval status → alreadyEditable.
      //   Case B: previously approved + valid reopen event after last FA + pre-approval → alreadyEditable.
      //   Case C: previously approved, pre-approval status, but NO valid reopen event
      //           → NOT alreadyEditable; fall through to normal transition gate.
      if (!lastFinalApprovedAt) {
        alreadyEditable = !POST_APPROVAL_LOCKED_STATUSES.has(currentStatus);
      } else {
        const reopenCheck = await client.query(
          `SELECT 1 FROM approvals
           WHERE entity_type = 'plan' AND entity_id = $1
             AND action = 'reopen'
             AND "timestamp" > $2
           LIMIT 1`,
          [planId, lastFinalApprovedAt],
        );
        alreadyEditable = reopenCheck.rows.length > 0 && !POST_APPROVAL_LOCKED_STATUSES.has(currentStatus);
      }

      if (alreadyEditable) {
        await client.query("ROLLBACK");
        const plan = await getPlanById(planId);
        res.json({ ...plan, alreadyEditable: true });
        return;
      }

      // Not already editable. Check whether the current status permits a Reopen transition.
      // Terminal statuses (completed/cancelled/archived) cannot be reopened (§17).
      // A historically-locked pre-approval status (Case C) also fails here because
      // pre-approval statuses are not in REOPENABLE_STATUSES.
      if (!REOPENABLE_STATUSES.has(currentStatus)) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "cannot_reopen_terminal", message: `Plans with status "${currentStatus}" cannot be reopened. Terminal plans require a separate approved business rule.` });
        return;
      }

      // Mutation — still holding the FOR UPDATE row lock.
      await client.query(
        `UPDATE plans SET status = 'draft', updated_at = NOW() WHERE id = $1`,
        [planId],
      );
      await client.query(
        `INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, comment)
         VALUES ('plan', $1, 'reopen', $2, 'draft', $3, $4)`,
        [planId, currentStatus, req.currentUser.id, reason],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    // ─── End PLAN-006 Fix ─────────────────────────────────────────────────────

    await logAudit({
      userId: req.currentUser.id,
      action: "reopen",
      module: "plans",
      entityId: planId,
      oldValue: currentStatus,
      // newValue encodes all required §10 audit fields in a structured string.
      newValue: JSON.stringify({ status: "draft", planCode, planTitle, reason, previousFinalApprovalDate: lastFinalApprovedAt ?? null, reopenedByRole: req.currentUser.role }),
    });

    await notifyEntityActorsDeduped({
      entityType: "plan",
      entityId: planId,
      kind: "reopened",
      message: `Plan "${planTitle}" was reopened for editing by ${req.currentUser.name}. Reason: ${reason}`,
      dedupeKey: `plan-reopen:${planId}:${currentStatus}:draft`,
      link: `/plans/${planId}`,
      exceptUserId: req.currentUser.id,
      mandatory: true,
    });

    realtime.broadcastUpdate?.({
      module: "plans",
      action: "reopened",
      entityId: planId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    const plan = await getPlanById(planId);
    res.json(plan);
  } catch (err) { next(err); }
});

export default router;
