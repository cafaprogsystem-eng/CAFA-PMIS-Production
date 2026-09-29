import { Hono } from "hono";
import {
  CreateProjectBody,
  TransitionProjectBody,
  AddProjectDocumentBody,
  CorrectProjectDonorBody,
  UpsertProjectStateAllocationsBody,
} from "@workspace/api-zod";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  hasPerm,
  permissionsFor,
  logAudit,
  tcSectorRestriction,
  assertStateAllowed,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { assertActiveState } from "../lib/state-master";
import { VALID_SECTOR_SET, ASSISTANCE_MODALITY_SET, validateSubSectorsMulti } from "../lib/sectors";
import { validateDonorName, isConfirmedUnlinkedPlaceholderDonor, scanFocusedProjectDonors } from "../lib/project-data-integrity";
import { verifyUploadToken } from "../lib/upload-token";
import { SCHEDULED_FREQUENCIES, type ScheduledFrequency } from "../lib/report-constants";
import { getProjectDeletionMode, validateDeletionReason } from "../lib/project-deletion";
import { isExactDevelopmentTestRetirementTarget } from "../lib/development-test-retirement";
import { deleteObjectSafely, getObjectEntityFile, downloadObject, ObjectNotFoundError } from "../lib/storage";
import { hasFullOperationalAccess } from "../lib/accessControl";
import { contentDispositionHeader } from "../lib/content-disposition";
import { broadcastUpdate, captureOperationalAudience } from "../lib/realtime";

/**
 * Ported from artifacts/api-server/src/routes/projects.ts. projects.ts is the
 * largest and most complex file in the whole migration (4008 lines), so it is
 * being ported in batches rather than all at once.
 *
 * Batch 1 (committed earlier): GET /projects (list) + GET /projects/:projectId
 * (detail) — read paths only.
 *
 * Batch 2 (committed earlier): the core project lifecycle — POST /projects
 * (create), PATCH /projects/:projectId (update), POST
 * /projects/:projectId/transitions (workflow), GET
 * /projects/:projectId/deletion-info, and DELETE /projects/:projectId
 * (permanent or soft, depending on approval history).
 *
 * Batch 3 (this addition): GET/POST /donors, GET /projects/donor-integrity-scan,
 * POST /projects/:projectId/donor-correction, GET /projects/duplicate-check,
 * POST /projects/:projectId/merge, PATCH /projects/:projectId/reporting-coverage,
 * GET/POST /projects/:projectId/documents, GET
 * /projects/:projectId/documents/:documentId/download, DELETE
 * /projects/:projectId/documents/:documentId, GET /projects/:projectId/report-kpis,
 * GET /activities, GET /projects/:projectId/activities, GET
 * /projects/:projectId/indicators, GET /projects/:projectId/budget, GET/POST
 * /projects/:projectId/state-allocations.
 *
 * FIXED while porting (see the batch 3 report) at all three
 * project_state_allocations INSERT sites in this file (project create,
 * project update, and this batch's dedicated state-allocations replace
 * route): the original coalesces every omitted allocation field —
 * budgetAllocation, beneficiaryTarget, beneficiaryMale/Female/Boys/Girls,
 * activityTarget, indicatorTarget — to `?? null`, but every one of those
 * columns is `NOT NULL DEFAULT 0`. A caller omitting any of them (all are
 * optional in the Zod schema) throws a live "violates not-null constraint"
 * 500, confirmed here against Neon. Changed to `?? 0` at all three sites, in
 * both this file and artifacts/api-server/src/routes/projects.ts.
 *
 * Intentionally NOT ported: POST /projects/:projectId/development-test-retirement.
 * The original guards this with `if (process.env.NODE_ENV !== "development")
 * return 404`, so in every real (non-dev) environment it is dead code — a
 * one-off cleanup action for a single historical fixture (see
 * lib/development-test-retirement.ts) that this fresh Neon database can never
 * contain. Porting it would mean adding a NODE_ENV-gated route with no
 * reachable path in any environment this Worker actually runs in.
 * runProjectDataIntegrityScan (a startup-time audit log, not a route) is
 * likewise not ported — see lib/project-data-integrity.ts's comment.
 *
 * realtime.broadcastUpdate / realtime.captureOperationalAudience are now
 * wired (Durable Objects phase, see lib/realtime.ts). Still not ported here
 * — deferred to the separate notifications-engine port: notification
 * creation (createNotificationDeduped, notifyEntityActors,
 * notifyEntityActorsDeduped, notifyNextApprover, checkAndFireBudgetAlert —
 * lib/notifications.ts's ~900-line preference/dedup engine). Every call site
 * where the original fired one of these is left as a comment naming what was
 * dropped, not silently omitted.
 */

interface EffectiveSectors {
  primary: string | null;
  all: string[];
}

async function getProjectEffectiveSectors(
  db: QueryExecutor,
  projectId: number,
): Promise<EffectiveSectors | undefined> {
  const r = await db.query<{ sector: string | null; sectors: string[] }>(
    `SELECT sector, COALESCE(sectors, '[]'::jsonb)::jsonb AS sectors
     FROM projects
     WHERE id = $1 AND deleted_at IS NULL`,
    [projectId],
  );
  if (r.rows.length === 0) return undefined;
  const primary = r.rows[0].sector ?? null;
  const secondary: string[] = Array.isArray(r.rows[0].sectors) ? r.rows[0].sectors : [];
  const all = [...new Set([...(primary ? [primary] : []), ...secondary])];
  return { primary, all };
}

/**
 * Checks whether the current actor (TC) is in scope for a given Project's
 * effective sector set. Non-TC actors always pass (null restriction = org-wide).
 */
function assertEffectiveSectorAllowedForProject(
  user: CurrentUser | undefined,
  effectiveSectors: string[],
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(user);
  if (!restriction) return { ok: true };
  if (restriction.length === 0) return { ok: false, status: 403, body: { error: "sector_forbidden" } };
  if (effectiveSectors.length === 0) return { ok: false, status: 403, body: { error: "sector_forbidden" } };
  const allowed = effectiveSectors.some((s) => restriction.includes(s));
  return allowed ? { ok: true } : { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

async function getAssignments(db: QueryExecutor, projectId: number) {
  const { rows } = await db.query(
    `SELECT pa.id, pa.user_id AS "userId",
            COALESCE(pa.name, u.name, '') AS "name",
            u.name AS "userName",
            u.role_label AS "userRoleLabel", pa.role
     FROM project_assignments pa LEFT JOIN users u ON u.id = pa.user_id
     WHERE pa.project_id = $1 ORDER BY pa.id`,
    [projectId],
  );
  return rows;
}

/**
 * PRJ-009 — Public document DTO allow-list. Internal storage details
 * (objectPath, bucket names, raw provider keys) must never leave the server.
 */
export function toPublicDocumentDto(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.projectId,
    category: row.category,
    kind: row.kind,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    uploadedByName: row.uploadedByName ?? null,
    uploadedAt: row.uploadedAt,
    availabilityStatus: row.availabilityStatus ?? "available",
  };
}

async function getDocuments(db: QueryExecutor, projectId: number) {
  const { rows } = await db.query(
    `SELECT pd.id, pd.project_id AS "projectId", pd.category, pd.kind,
            pd.file_name AS "fileName",
            pd.content_type AS "contentType", pd.size,
            u.name AS "uploadedByName", pd.uploaded_at AS "uploadedAt",
            pd.availability_status AS "availabilityStatus"
     FROM project_documents pd LEFT JOIN users u ON u.id = pd.uploaded_by_id
     WHERE pd.project_id = $1 ORDER BY pd.category, pd.uploaded_at DESC`,
    [projectId],
  );
  return rows.map(toPublicDocumentDto);
}

async function getLocalities(db: QueryExecutor, projectId: number) {
  const { rows } = await db.query(
    `SELECT id, name, display_order AS "displayOrder"
     FROM project_free_localities
     WHERE project_id = $1
     ORDER BY display_order, id`,
    [projectId],
  );
  return rows;
}

const projectSummarySelect = `
  SELECT p.id, p.code, p.title, p.status, p.sector,
         COALESCE(p.sectors, '[]'::jsonb) AS sectors,
         COALESCE(p.sub_sectors, '[]'::jsonb) AS "subSectors",
         p.assistance_modality AS "assistanceModality",
         p.migration_review_notes AS "migrationReviewNotes",
         p.classification, p.donor,
         p.donor_id AS "donorId",
         p.start_date AS "startDate", p.end_date AS "endDate",
         p.reporting_start_date AS "reportingStartDate", p.reporting_end_date AS "reportingEndDate",
         p.budget_total::float AS "budgetTotal",
         COALESCE((SELECT SUM(a.budget_spent)::float FROM activities a WHERE a.project_id = p.id), 0) AS "budgetSpent",
         p.beneficiaries_target AS "beneficiariesTarget",
         (COALESCE(p.beneficiaries_male,0) + COALESCE(p.beneficiaries_female,0) +
          COALESCE(p.beneficiaries_boys,0) + COALESCE(p.beneficiaries_girls,0))::int AS "beneficiariesReached",
         COALESCE((SELECT AVG(a.progress_pct)::int FROM activities a WHERE a.project_id = p.id), 0) AS "progressPct",
         p.management_level AS "managementLevel",
         p.has_hq_operations AS "hasHqOperations",
         p.reporting_frequency AS "reportingFrequency",
         p.currency,
         ARRAY(SELECT ps.state_id FROM project_states ps WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateIds",
         ARRAY(SELECT s.name FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateNames",
         ARRAY(SELECT s.name_ar FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateNamesAr"
  FROM projects p
`;

const projectReturning = `
  RETURNING id, code, title, status, sector,
            COALESCE(sectors, '[]'::jsonb) AS sectors,
            COALESCE(sub_sectors, '[]'::jsonb) AS "subSectors",
            assistance_modality AS "assistanceModality",
            migration_review_notes AS "migrationReviewNotes",
            classification, donor, donor_id AS "donorId",
            agreement_number AS "agreementNumber",
            agreement_start AS "agreementStart",
            agreement_end AS "agreementEnd",
            signed_date AS "signedDate",
            internal_notes AS "internalNotes",
            description, start_date AS "startDate", end_date AS "endDate",
            reporting_start_date AS "reportingStartDate", reporting_end_date AS "reportingEndDate",
            budget_total::float AS "budgetTotal",
            COALESCE(direct_cost::float, 0) AS "directCost",
            COALESCE(indirect_cost::float, 0) AS "indirectCost",
            COALESCE(cafa_contribution::float, 0) AS "cafaContribution",
            budget_version AS "budgetVersion",
            currency,
            beneficiaries_target AS "beneficiariesTarget",
            beneficiaries_male AS "beneficiariesMale",
            beneficiaries_female AS "beneficiariesFemale",
            beneficiaries_boys AS "beneficiariesBoys",
            beneficiaries_girls AS "beneficiariesGirls",
            COALESCE(activity_target, 0) AS "activityTarget",
            COALESCE(indicator_target, 0) AS "indicatorTarget",
            management_level AS "managementLevel",
            reporting_frequency AS "reportingFrequency",
            created_at AS "createdAt"
`;

/**
 * PRJ-009 allow-list DTO composition shared by create/update/transitions'
 * JSON responses (list/detail have their own inline SELECTs from batch 1).
 */
async function enrichProject(
  db: QueryExecutor,
  row: Record<string, unknown>,
  createdByName: string | null,
) {
  const id = Number(row.id);
  const [assignments, documents, localities] = await Promise.all([
    getAssignments(db, id),
    getDocuments(db, id),
    getLocalities(db, id),
  ]);
  return { ...row, createdByName, assignments, documents, localities };
}

/**
 * A State-scoped project write must remain wholly within the caller's assigned
 * State. This intentionally applies independently of record-level access:
 * being assigned to an existing project must never permit an SPO/SOM to add a
 * second State or HQ operations while editing its draft.
 */
function violatesStateScopedProjectWrite(
  user: CurrentUser | undefined,
  body: {
    stateIds?: number[];
    stateAllocations?: Array<{ stateId: number }>;
    outputs?: Array<{ activities?: Array<{ stateId?: number | null }> }>;
  },
  hasHqOperations: boolean,
): boolean {
  if (!user || !["state_program_officer", "state_office_manager"].includes(user.role)) return false;

  // Bad legacy user data must not turn a State role into an unscoped writer.
  if (user.stateId === null) return true;
  if (hasHqOperations) return true;

  const requestedStateIds = [
    ...(body.stateIds ?? []),
    ...(body.stateAllocations ?? []).map((allocation) => allocation.stateId),
    ...(body.outputs ?? []).flatMap((output) =>
      (output.activities ?? [])
        .map((activity) => activity.stateId)
        .filter((stateId): stateId is number => stateId != null),
    ),
  ];
  return requestedStateIds.some((stateId) => stateId !== user.stateId);
}

function validProjectDocumentDescriptor(
  secret: string,
  document: { objectPath?: string; uploadToken?: string; fileName: string; contentType: string; size: number },
  userId: number,
): boolean {
  if (!document.objectPath) return true;
  try {
    const descriptor = verifyUploadToken(document.uploadToken ?? "", secret);
    return descriptor.userId === userId
      && descriptor.scope === "documents"
      && descriptor.objectPath === document.objectPath
      && descriptor.fileName === document.fileName
      && descriptor.contentType === document.contentType
      && descriptor.maxSize === document.size;
  } catch {
    return false;
  }
}

type ExistingProjectDocument = {
  objectPath: string;
  fileName: string;
  contentType: string;
  size: number;
};

function matchesExistingProjectDocument(
  document: { objectPath?: string; fileName: string; contentType: string; size: number },
  existing: ExistingProjectDocument | undefined,
): boolean {
  return !!existing
    && existing.fileName === document.fileName
    && existing.contentType === document.contentType
    && Number(existing.size) === Number(document.size);
}

function resolveReportingCoverage(
  raw: Record<string, unknown>,
  startDate: string,
  endDate: string,
): { start: string; end: string } | null {
  const start = raw.reportingStartDate === undefined ? startDate : raw.reportingStartDate;
  const end = raw.reportingEndDate === undefined ? endDate : raw.reportingEndDate;
  if (typeof start !== "string" || typeof end !== "string") return null;
  const parse = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
      ? parsed.valueOf()
      : null;
  };
  const startAt = parse(start);
  const endAt = parse(end);
  return startAt !== null && endAt !== null && startAt <= endAt ? { start, end } : null;
}

/**
 * Ported from artifacts/api-server/src/routes/comments.ts's
 * unresolvedRequiredCorrections export — the one function projects.ts needs
 * from that file. Porting the rest of comments.ts is not required for this
 * batch, so only this standalone query is duplicated here.
 */
async function unresolvedRequiredCorrections(
  db: QueryExecutor,
  entityType: string,
  entityId: number,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM comments
     WHERE entity_type = $1 AND entity_id = $2 AND comment_type = 'required_correction' AND status = 'open'`,
    [entityType, entityId],
  );
  return rows[0]?.n ?? 0;
}

// ── Project workflow ──────────────────────────────────────────────────────────

const PROJECT_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["draft"], to: "submitted" },
  technical_review: { from: ["submitted", "state_reviewed"], to: "technically_approved" },
  coordination_review: { from: ["technically_approved"], to: "coordination_approved" },
  final_approve: { from: ["coordination_approved"], to: "approved" },
  activate: { from: ["approved"], to: "active" },
  close: { from: ["active"], to: "closed" },
  reject: { from: ["submitted", "state_reviewed", "technically_approved", "coordination_approved"], to: "rejected" },
  request_revision: { from: ["submitted", "state_reviewed", "technically_approved", "coordination_approved"], to: "draft" },
};

const PROJECT_TRANSITION_PERMS: Record<string, string> = {
  submit: "projects.create",
  technical_review: "projects.approve.technical",
  coordination_review: "projects.approve.coordination",
  final_approve: "projects.approve.final",
  activate: "projects.activate",
  close: "projects.close",
  // reject / request_revision are intentionally absent: they use stage-aware
  // permission evaluation (PRJ-BD-02 / PRJ-021) — see stageAwareNegativePerm.
};

/**
 * PRJ-BD-02 / PRJ-021 — stage-aware permission for negative transitions.
 * The permission required for reject/request_revision depends on the project's
 * current (source) status, so the reviewer who owns a stage can also close it
 * negatively:
 *   submitted | state_reviewed   → projects.approve.technical   (TC stage)
 *   technically_approved         → projects.approve.coordination (SPC stage)
 *   coordination_approved        → projects.approve.final        (PM stage)
 * Returns null for any other source status (transition is invalid anyway).
 */
function stageAwareNegativePerm(fromStatus: string): string | null {
  if (fromStatus === "submitted" || fromStatus === "state_reviewed") return "projects.approve.technical";
  if (fromStatus === "technically_approved") return "projects.approve.coordination";
  if (fromStatus === "coordination_approved") return "projects.approve.final";
  return null;
}

export const projectsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

projectsRoutes.use("/projects", attachCurrentUser, requireAuth);
projectsRoutes.use("/projects/*", attachCurrentUser, requireAuth);
projectsRoutes.use("/donors", attachCurrentUser, requireAuth);
projectsRoutes.use("/donors/*", attachCurrentUser, requireAuth);
projectsRoutes.use("/activities", attachCurrentUser, requireAuth);

// ── Project list ──────────────────────────────────────────────────────────────
projectsRoutes.get("/projects", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    // Always exclude soft-deleted projects from normal operational lists.
    const filters: string[] = ["p.deleted_at IS NULL"];
    const params: unknown[] = [];
    const isStateRole = user.role === "state_program_officer" || user.role === "state_office_manager";
    const stateIdQuery = c.req.query("stateId");
    const effectiveStateId = isStateRole
      ? (user.stateId ?? null)
      : (stateIdQuery ? Number(stateIdQuery) : null);
    // PRJ-028: state roles with no assigned State fail closed (no visibility).
    if (isStateRole && effectiveStateId === null) {
      return c.json([]);
    }
    if (effectiveStateId !== null) {
      params.push(effectiveStateId);
      const stateParamIdx = params.length;
      if (isStateRole) {
        // PRJ-028: list/detail scope parity — a state-role user directly assigned via
        // project_assignments (user-specific, user_id column) also sees the project in
        // the list. The user_id predicate is naturally scoped to the current user, so
        // same-State peers do not inherit visibility through another user's assignment.
        params.push(user.id);
        filters.push(
          `(EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${stateParamIdx})` +
          ` OR EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = p.id AND pa.user_id = $${params.length}))`,
        );
      } else {
        filters.push(`EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${stateParamIdx})`);
      }
    }
    const status = c.req.query("status");
    if (status) { params.push(status); filters.push(`p.status = $${params.length}`); }
    const sector = c.req.query("sector");
    if (sector) {
      params.push(sector);
      filters.push(`(p.sector = $${params.length} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors,'[]'::jsonb)) s WHERE s = $${params.length}))`);
    }
    const managementLevel = c.req.query("managementLevel");
    if (managementLevel) { params.push(managementLevel); filters.push(`p.management_level = $${params.length}`); }
    // Full-text search across title, code, donor name, agreement number
    const q = c.req.query("q");
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const n = params.length;
      filters.push(`(p.title ILIKE $${n} OR p.code ILIKE $${n} OR p.donor ILIKE $${n} OR p.agreement_number ILIKE $${n})`);
    }
    const donor = c.req.query("donor");
    if (donor && donor.trim()) {
      params.push(`%${donor.trim()}%`);
      filters.push(`p.donor ILIKE $${params.length}`);
    }
    const donorIdQuery = c.req.query("donorId");
    if (donorIdQuery) {
      const did = Number(donorIdQuery);
      if (!Number.isNaN(did)) { params.push(did); filters.push(`p.donor_id = $${params.length}`); }
    }
    const tcSectors = tcSectorRestriction(user);
    if (tcSectors) {
      params.push(tcSectors);
      // TC can see projects where their sector appears in either the primary sector or the sectors array
      filters.push(`(p.sector = ANY($${params.length}::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors,'[]'::jsonb)) s WHERE s = ANY($${params.length}::text[])))`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await db.query(
      `${projectSummarySelect} ${where} ORDER BY p.created_at DESC`,
      params,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

// ── Donor-integrity scan / duplicate check ────────────────────────────────────
// Registered here — BEFORE GET /projects/:projectId — because both are static
// path segments in the exact same position as :projectId
// ("/projects/donor-integrity-scan", "/projects/duplicate-check"). Hono, like
// Express, resolves an ambiguous match in registration order: appended after
// :projectId (as they originally were, mirroring their append-only position in
// this batch), a request to either path was silently swallowed by the detail
// route instead, which then did Number("donor-integrity-scan") → NaN and threw
// binding NaN into an integer column — a live 500 caught during batch 3
// testing, not a hypothetical. The Express original avoids this by registering
// them near the top of the file, well before its own /projects/:projectId.
projectsRoutes.get("/projects/donor-integrity-scan", requirePerm("projects.donor.correct"), async (c) => {
  const { db, close } = openDb(c);
  try {
    const scan = await scanFocusedProjectDonors(db);
    return c.json(scan);
  } finally {
    close();
  }
});

// PRJ-002: Explicit project-domain permission guard prevents unauthorised
// callers from enumerating Project metadata (any-projects-permission check
// rather than a single requirePerm, so every project-domain role is covered).
projectsRoutes.get("/projects/duplicate-check", async (c) => {
  const user = c.get("currentUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const { db, close } = openDb(c);
  try {
    const callerPerms = permissionsFor(user);
    const hasProjectAccess = hasPerm(callerPerms, "*") || callerPerms.some((p) => p.startsWith("projects."));
    if (!hasProjectAccess) {
      return c.json({ error: "forbidden", message: "You do not have access to project data." }, 403);
    }

    const agreementNumber = c.req.query("agreementNumber");
    const donor = c.req.query("donor");
    const title = c.req.query("title");
    const excludeId = c.req.query("excludeId");
    if (!agreementNumber?.trim()) return c.json({ matchType: "none" });

    const tcSectors = tcSectorRestriction(user);
    const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";

    // Fail-closed: TC with no assigned sectors sees nothing — no enumeration leak.
    if (tcSectors !== null && tcSectors.length === 0) return c.json({ matchType: "none" });
    // Fail-closed: State role with no stateId sees nothing.
    if (isStateRole && (user.stateId ?? null) === null) return c.json({ matchType: "none" });

    const excludeIdNum = excludeId ? parseInt(excludeId, 10) : null;
    const params: unknown[] = [agreementNumber.trim()];
    const excludeClause = excludeIdNum && !isNaN(excludeIdNum)
      ? ` AND p.id != $${params.push(excludeIdNum)}`
      : "";

    let sectorClause = "";
    if (tcSectors !== null) {
      params.push(tcSectors);
      sectorClause = ` AND (p.sector = ANY($${params.length}::text[]) OR EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors, '[]'::jsonb)) s
  WHERE s = ANY($${params.length}::text[])
))`;
    }

    let stateClause = "";
    if (isStateRole) {
      params.push(user.stateId!);
      stateClause = ` AND EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${params.length})`;
    }

    // Response minimisation (PRJ-002): omit internal IDs, budget data,
    // assignments, and State allocation data.
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT p.code, p.title, p.agreement_number AS "agreementNumber",
              p.donor, p.sector,
              COALESCE(p.sectors, '[]'::jsonb) AS sectors,
              ARRAY(SELECT ps.state_id FROM project_states ps WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateIds",
              ARRAY(SELECT s.name FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateNames",
              ARRAY(SELECT s.name_ar FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id ORDER BY ps.state_id) AS "stateNamesAr",
              ARRAY(SELECT pfl.name FROM project_free_localities pfl WHERE pfl.project_id = p.id) AS localities
       FROM projects p
       WHERE LOWER(p.agreement_number) = LOWER($1)
         AND p.deleted_at IS NULL${excludeClause}${sectorClause}${stateClause}
       ORDER BY p.created_at DESC LIMIT 10`,
      params,
    );

    if (rows.length === 0) return c.json({ matchType: "none" });

    if (donor?.trim() && title?.trim()) {
      const exact = rows.find(
        (r) => (r.donor as string | null)?.toLowerCase() === donor.trim().toLowerCase()
          && (r.title as string | null)?.toLowerCase() === title.trim().toLowerCase(),
      );
      if (exact) return c.json({ matchType: "exact", existingProject: exact });
    }

    if (title?.trim()) {
      const warn = rows.find((r) => (r.title as string | null)?.toLowerCase() !== title.trim().toLowerCase());
      if (warn) return c.json({ matchType: "agreement_warning", existingProject: warn });
    }

    return c.json({ matchType: "none" });
  } finally {
    close();
  }
});

// ── Project detail ────────────────────────────────────────────────────────────
projectsRoutes.get("/projects/:projectId", async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);

    const projectRes = await db.query<Record<string, unknown>>(
      `SELECT p.id, p.code, p.title, p.status, p.sector,
              COALESCE(p.sectors, '[]'::jsonb) AS sectors,
              COALESCE(p.sub_sectors, '[]'::jsonb) AS "subSectors",
              p.assistance_modality AS "assistanceModality",
              p.migration_review_notes AS "migrationReviewNotes",
              p.classification, p.donor, p.donor_id AS "donorId",
              d.name AS "donorName",
              p.agreement_number AS "agreementNumber",
              p.agreement_start AS "agreementStart",
              p.agreement_end AS "agreementEnd",
              p.signed_date AS "signedDate",
              p.internal_notes AS "internalNotes",
              p.description,
               p.start_date AS "startDate", p.end_date AS "endDate",
               p.reporting_start_date AS "reportingStartDate",
               p.reporting_end_date AS "reportingEndDate",
              p.budget_total::float AS "budgetTotal",
              COALESCE(p.direct_cost::float, 0) AS "directCost",
              COALESCE(p.indirect_cost::float, 0) AS "indirectCost",
              COALESCE(p.cafa_contribution::float, 0) AS "cafaContribution",
              p.budget_version AS "budgetVersion",
              p.currency,
              p.beneficiaries_target AS "beneficiariesTarget",
              p.beneficiaries_male AS "beneficiariesMale",
              p.beneficiaries_female AS "beneficiariesFemale",
              p.beneficiaries_boys AS "beneficiariesBoys",
              p.beneficiaries_girls AS "beneficiariesGirls",
              p.management_level AS "managementLevel",
              p.has_hq_operations AS "hasHqOperations",
              p.reporting_frequency AS "reportingFrequency",
              u.name AS "createdByName",
              p.created_at AS "createdAt"
       FROM projects p
       LEFT JOIN users u ON u.id = p.created_by_id
       LEFT JOIN donors d ON d.id = p.donor_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId],
    );
    if (projectRes.rows.length === 0) return c.json({ error: "project not found" }, 404);
    const projectRow = projectRes.rows[0] as Record<string, unknown>;

    const [outputs, activities, indicators, risks, reports, beneficiaries, states, history, spent, assignments, documents, localities] = await Promise.all([
      db.query(
        `SELECT id, code, title, description, COALESCE(target::float, 0) AS target
         FROM outputs WHERE project_id = $1 ORDER BY code`,
        [projectId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT a.id, a.code, a.title, a.description, a.status, a.progress_pct AS "progressPct",
                a.planned_start AS "plannedStart", a.planned_end AS "plannedEnd",
                a.output_id AS "outputId", o.title AS "outputTitle",
                a.indicator_id AS "indicatorId",
                a.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
                a.locality_name AS "localityName",
                COALESCE(a.target::float, 0) AS target,
                a.budget_planned::float AS "budgetPlanned",
                a.budget_spent::float AS "budgetSpent"
         FROM activities a
         LEFT JOIN outputs o ON o.id = a.output_id
         LEFT JOIN states s ON s.id = a.state_id
         WHERE a.project_id = $1 ORDER BY a.code`,
        [projectId],
      ),
      db.query(
        `SELECT id, code, title, unit, target::float AS target, achieved::float AS achieved,
                output_id AS "outputId", sector
         FROM indicators WHERE project_id = $1 ORDER BY code`,
        [projectId],
      ),
      db.query(
        `SELECT r.id, r.title, r.description, r.category, r.severity, r.likelihood, r.status,
                r.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
                r.project_id AS "projectId", p.title AS "projectTitle",
                u.name AS "assignedToName", r.mitigation_plan AS "mitigationPlan",
                r.identified_at AS "identifiedAt"
         FROM risks r LEFT JOIN states s ON s.id = r.state_id
         LEFT JOIN projects p ON p.id = r.project_id
         LEFT JOIN users u ON u.id = r.assigned_to_id
         WHERE r.project_id = $1 ORDER BY r.identified_at DESC`,
        [projectId],
      ),
      db.query<Record<string, unknown>>(
        `SELECT r.id, r.title, r.kind, r.status,
                r.project_id AS "projectId", p.title AS "projectTitle",
                r.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
                r.period, r.narrative,
                u.name AS "submittedByName", r.submitted_at AS "submittedAt"
         FROM reports r
         JOIN projects p ON p.id = r.project_id
         JOIN states s ON s.id = r.state_id
         JOIN users u ON u.id = r.submitted_by_id
         WHERE r.project_id = $1 ORDER BY r.submitted_at DESC`,
        [projectId],
      ),
      db.query<{ reached: number }>(
        `SELECT (COALESCE(beneficiaries_male,0) + COALESCE(beneficiaries_female,0) +
                 COALESCE(beneficiaries_boys,0) + COALESCE(beneficiaries_girls,0))::int AS reached
         FROM projects WHERE id = $1`,
        [projectId],
      ),
      db.query(
        `SELECT s.id, s.name FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = $1`,
        [projectId],
      ),
      db.query(
        `SELECT a.id, a.action, a.from_status AS "fromStatus", a.to_status AS "toStatus",
                u.name AS "actorName", u.role_label AS "actorRole",
                a.comment, a.timestamp
         FROM approvals a JOIN users u ON u.id = a.actor_id
         WHERE a.entity_type = 'project' AND a.entity_id = $1 ORDER BY a.timestamp ASC`,
        [projectId],
      ),
      db.query<{ spent: number }>(`SELECT COALESCE(SUM(budget_spent)::float, 0) AS spent FROM activities WHERE project_id = $1`, [projectId]),
      getAssignments(db, projectId),
      getDocuments(db, projectId),
      getLocalities(db, projectId),
    ]);
    return c.json({
      project: { ...projectRow, assignments, documents, localities },
      outputs: outputs.rows,
      activities: activities.rows.map((a) => ({ ...a, outputTitle: a.outputTitle ?? null })),
      indicators: indicators.rows,
      risks: risks.rows,
      reports: reports.rows.map((r) => ({ ...r, approvalHistory: [] })),
      beneficiariesReached: beneficiaries.rows[0].reached,
      beneficiariesTarget: projectRow.beneficiariesTarget,
      budgetTotal: projectRow.budgetTotal,
      budgetSpent: spent.rows[0].spent,
      states: states.rows,
      approvalHistory: history.rows,
    });
  } finally {
    close();
  }
});

// ── Project create ────────────────────────────────────────────────────────────
projectsRoutes.post("/projects", requirePerm("projects.create"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    const rawBody = await c.req.json<Record<string, unknown>>();
    const body = CreateProjectBody.parse(rawBody);
    if (violatesStateScopedProjectWrite(user, body, rawBody.hasHqOperations === true)) {
      return c.json({ error: "state_forbidden" }, 403);
    }
    const reportingCoverage = resolveReportingCoverage(rawBody, body.startDate, body.endDate);
    if (!reportingCoverage) {
      return c.json({ error: "invalid_reporting_coverage", message: "Reporting coverage must be a valid inclusive date range." }, 422);
    }
    const donorValidation = validateDonorName(body.donor);
    if (!donorValidation.ok) {
      return c.json({ error: donorValidation.error, field: "donor", message: donorValidation.message }, 422);
    }
    // Uploaded project documents must be bound to this user by a signed
    // descriptor. A client may not claim an arbitrary object path during
    // project creation (before the project has an ID to bind to).
    for (const d of body.documents ?? []) {
      if (!validProjectDocumentDescriptor(c.env.SESSION_SECRET, d, user.id)) {
        return c.json({ error: "invalid_document_upload_descriptor" }, 422);
      }
    }

    if (body.startDate && body.endDate && new Date(body.endDate) < new Date(body.startDate)) {
      return c.json({
        error: "invalid_date_range",
        detail: "End Date cannot be before Start Date",
        fields: [{ path: "endDate", message: "End Date cannot be before Start Date" }],
      }, 400);
    }

    if ((body.budgetTotal ?? 0) < 0) {
      return c.json({
        error: "validation_error",
        detail: "budgetTotal: Budget must be zero or a positive number",
        fields: [{ path: "budgetTotal", message: "Budget must be zero or a positive number" }],
      }, 400);
    }

    // ── BUD-BD-01: allocation cap check at create time ────────────────────────
    for (const alloc of body.stateAllocations ?? []) {
      if ((alloc.budgetAllocation ?? 0) < 0) {
        return c.json({ error: "invalid_allocation", message: "Budget allocation cannot be negative." }, 422);
      }
    }
    const createAllocTotal = (body.stateAllocations ?? []).reduce((s, a) => s + (a.budgetAllocation ?? 0), 0);
    if (createAllocTotal > (body.budgetTotal ?? 0)) {
      return c.json({
        error: "over_allocation",
        message: `Total state allocations (${createAllocTotal.toFixed(2)}) would exceed the project budget (${(body.budgetTotal ?? 0).toFixed(2)}).`,
      }, 422);
    }

    // Scheduled Reporting Frequency — required for all NEW projects (Task #325 / Model D).
    const rawReportingFrequency = rawBody.reportingFrequency;
    if (
      typeof rawReportingFrequency !== "string" ||
      !(SCHEDULED_FREQUENCIES as readonly string[]).includes(rawReportingFrequency)
    ) {
      return c.json({
        error: "invalid_reporting_frequency",
        field: "reportingFrequency",
        code: "invalid_reporting_frequency",
        message: "Scheduled Reporting Frequency is required and must be one of: monthly, quarterly, annual.",
      }, 400);
    }
    const reportingFrequency = rawReportingFrequency as ScheduledFrequency;

    // Management level — read from body (not in generated Zod schema but validated here)
    const VALID_MGMT = new Set(["hq_managed", "state_managed"]);
    const rawMgmt = rawBody.managementLevel as string | undefined;
    const managementLevel = VALID_MGMT.has(rawMgmt ?? "") ? rawMgmt! : "hq_managed";

    // Resolve primary sector from sectors array or legacy sector field
    const sectorsArr = body.sectors ?? (body.sector ? [body.sector] : []);
    const primarySector = sectorsArr[0] ?? body.sector ?? "";

    // ── Sector validation — validate ALL sectors in the array ────────────────
    const invalidSecs = sectorsArr.filter((s) => s && !VALID_SECTOR_SET.has(s));
    if (invalidSecs.length > 0) {
      return c.json({
        error: "invalid_sector",
        field: "sectors",
        code: "invalid_sector",
        message: `Unrecognised sector(s): ${invalidSecs.join(", ")}. Allowed: ${[...VALID_SECTOR_SET].join(", ")}`,
      }, 422);
    }
    // Reject duplicate sectors — require each sector to appear at most once
    const sectorsSeen = new Set<string>();
    const duplicateSectors = sectorsArr.filter((s) => {
      if (sectorsSeen.has(s)) return true;
      sectorsSeen.add(s);
      return false;
    });
    if (duplicateSectors.length > 0) {
      return c.json({
        error: "duplicate_sector",
        field: "sectors",
        code: "duplicate_sector",
        message: `Duplicate sector(s): ${[...new Set(duplicateSectors)].join(", ")}. Each sector must appear at most once.`,
      }, 422);
    }
    const uniqueSectors = sectorsArr;

    // New links and allocations are operational writes: historical projects
    // retain inactive state relationships, but new assignments cannot target one.
    for (const stateId of [
      ...(body.stateIds ?? []),
      ...(body.stateAllocations ?? []).map((allocation) => allocation.stateId),
      ...(body.outputs ?? []).flatMap((output) =>
        (output.activities ?? [])
          .map((activity) => activity.stateId)
          .filter((stateId): stateId is number => stateId != null),
      ),
    ]) {
      const activeState = await assertActiveState(db, Number(stateId));
      if (!activeState.ok) {
        return c.json({ error: activeState.error, message: "Projects can only be assigned to active States." }, 422);
      }
    }

    // Sub-sector validation — each sub-sector must belong to one of the selected sectors
    const subSectors: string[] = body.subSectors ?? [];
    if (subSectors.length > 0 && uniqueSectors.length > 0) {
      const subErr = validateSubSectorsMulti(uniqueSectors, subSectors);
      if (subErr) {
        return c.json({ error: "invalid_sub_sector", field: "subSectors", code: "invalid_sub_sector", message: subErr }, 422);
      }
    }

    // Assistance modality validation
    const assistanceModality = body.assistanceModality ?? null;
    if (assistanceModality && !ASSISTANCE_MODALITY_SET.has(assistanceModality)) {
      return c.json({
        error: "invalid_assistance_modality",
        field: "assistanceModality",
        code: "invalid_assistance_modality",
        message: `"${assistanceModality}" is not a recognised assistance modality.`,
      }, 422);
    }

    // Operational Locations: at least one of HQ or a linked state is required.
    {
      const hqOps = rawBody.hasHqOperations === true;
      if (!hqOps && (body.stateIds ?? []).length === 0) {
        return c.json({
          error: "no_operational_location",
          message: "A project must have at least one Operational Location: select HQ or at least one state.",
        }, 422);
      }
    }

    await client.query("BEGIN");

    // Resolve donor: if donorId provided look up name; if free-text donor provided keep it
    // BUD-DONOR-008: reject a nonexistent donorId immediately so bogus FK values cannot
    // be persisted. FOR KEY SHARE prevents the donor row from being deleted between
    // this validation and the INSERT COMMIT.
    let resolvedDonorName = body.donor ?? "";
    if (body.donorId != null) {
      const dr = await client.query<{ name: string }>(`SELECT name FROM donors WHERE id = $1 FOR KEY SHARE`, [body.donorId]);
      if (!dr.rows[0]) {
        await client.query("ROLLBACK");
        return c.json({
          error: "invalid_donor_id",
          field: "donorId",
          message: "The specified donor does not exist.",
        }, 422);
      }
      resolvedDonorName = dr.rows[0].name;
      const linkedDonorValidation = validateDonorName(resolvedDonorName);
      if (!linkedDonorValidation.ok) {
        await client.query("ROLLBACK");
        return c.json({
          error: linkedDonorValidation.error,
          field: "donorId",
          message: linkedDonorValidation.message,
        }, 422);
      }
    }
    if (!resolvedDonorName && body.donorId == null) resolvedDonorName = "Unknown";

    // New format: CAFA-PROJ-{YEAR}-{NNN} — stable, state-agnostic, year-scoped sequence.
    // PRJ-008/PRJ-018 — a transaction-scoped advisory lock keyed to the year
    // namespace serialises code allocation so two concurrent creates in the
    // same year cannot compute the same MAX+1 sequence. Defence-in-depth: a
    // UNIQUE constraint on projects.code; a 23505 unique violation is mapped
    // to 409 { error: "project_code_conflict" } in the catch below.
    const codeYear = new Date().getFullYear();
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`project_code_${codeYear}`]);
    const prefix = `CAFA-PROJ-${codeYear}-`;
    const seqRow = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM '[0-9]+$') AS INTEGER)), 0) + 1 AS next
         FROM projects WHERE code LIKE $1`,
      [`${prefix}%`],
    );
    const seq = seqRow.rows[0]?.next ?? 1;
    const code = `${prefix}${String(seq).padStart(3, "0")}`;
    const result = await client.query<Record<string, unknown>>(
      `INSERT INTO projects (
         code, title, status, sector, sectors, sub_sectors, assistance_modality, classification,
         donor, donor_id, agreement_number,
         agreement_start, agreement_end, signed_date, internal_notes,
         description, start_date, end_date, reporting_start_date, reporting_end_date,
         budget_total, direct_cost, indirect_cost, cafa_contribution, budget_version, currency,
         beneficiaries_target, beneficiaries_male, beneficiaries_female, beneficiaries_boys, beneficiaries_girls,
         activity_target, indicator_target,
         management_level, created_by_id,
         has_hq_operations,
         reporting_frequency
       )
       VALUES ($1, $2, 'draft', $3, $4::jsonb, $5::jsonb, $6, $7,
               $8, $9, $10,
               $11, $12, $13, $14,
               $15, $16, $17, $18, $19,
               $20, $21, $22, $23, $24, $25,
               $26, $27, $28, $29, $30,
               $31, $32,
               $34, $33,
               $35,
               $36)
       ${projectReturning}`,
      [
        code,
        body.title,
        primarySector,
        JSON.stringify(sectorsArr),
        JSON.stringify(subSectors),
        assistanceModality,
        body.classification ?? null,
        resolvedDonorName,
        body.donorId ?? null,
        body.agreementNumber,
        body.agreementStart ?? null,
        body.agreementEnd ?? null,
        body.signedDate ?? null,
        body.internalNotes ?? null,
        body.description,
        body.startDate,
        body.endDate,
        reportingCoverage.start,
        reportingCoverage.end,
        body.budgetTotal ?? 0,
        body.directCost ?? 0,
        body.indirectCost ?? 0,
        body.cafaContribution ?? 0,
        body.budgetVersion ?? null,
        body.currency ?? "USD",
        body.beneficiariesTarget ?? 0,
        body.beneficiariesMale ?? 0,
        body.beneficiariesFemale ?? 0,
        body.beneficiariesBoys ?? 0,
        body.beneficiariesGirls ?? 0,
        body.activityTarget ?? 0,
        body.indicatorTarget ?? 0,
        user.id,
        managementLevel,
        rawBody.hasHqOperations === true,
        reportingFrequency,
      ],
    );
    const project = result.rows[0];
    const projectId = project.id as number;

    for (const sid of body.stateIds ?? []) {
      await client.query(`INSERT INTO project_states (project_id, state_id) VALUES ($1, $2)`, [projectId, sid]);
    }
    for (const alloc of body.stateAllocations ?? []) {
      await client.query(
        `INSERT INTO project_state_allocations
           (project_id, state_id, budget_allocation, beneficiary_target,
            beneficiary_male, beneficiary_female, beneficiary_boys, beneficiary_girls,
            activity_target, indicator_target, state_lead, state_team, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
        [
          projectId,
          alloc.stateId,
          alloc.budgetAllocation ?? 0,
          alloc.beneficiaryTarget ?? 0,
          alloc.beneficiaryMale ?? 0,
          alloc.beneficiaryFemale ?? 0,
          alloc.beneficiaryBoys ?? 0,
          alloc.beneficiaryGirls ?? 0,
          alloc.activityTarget ?? 0,
          alloc.indicatorTarget ?? 0,
          alloc.stateLead ?? null,
          JSON.stringify(alloc.stateTeam ?? []),
          alloc.notes ?? null,
        ],
      );
    }
    let localityOrder = 0;
    for (const localityName of body.localities ?? []) {
      if (!localityName || !localityName.trim()) continue;
      await client.query(
        `INSERT INTO project_free_localities (project_id, name, display_order) VALUES ($1, $2, $3)`,
        [projectId, localityName.trim(), localityOrder++],
      );
    }
    for (const a of body.assignments ?? []) {
      const displayName = a.name?.trim() || null;
      await client.query(
        `INSERT INTO project_assignments (project_id, user_id, name, role) VALUES ($1, $2, $3, $4)`,
        [projectId, a.userId ?? null, displayName, a.role],
      );
    }
    for (const d of body.documents ?? []) {
      await client.query(
        `WITH inserted AS (
          INSERT INTO project_documents
            (project_id, category, kind, file_name, content_type, size, object_path, uploaded_by_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        )
        INSERT INTO document_registry_entries
          (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
        SELECT 'project_document', id, 'Project Documents', 'internal', 'project', $1 FROM inserted
        ON CONFLICT (source_kind, source_id) DO NOTHING`,
        [
          projectId,
          d.category ?? "optional",
          d.kind,
          d.fileName,
          d.contentType,
          d.size,
          d.objectPath ?? "",
          user.id,
        ],
      );
    }

    // Results Framework: Output → Indicators (per output) → Activities (with optional indicator link)
    let outIdx = 0;
    for (const out of body.outputs ?? []) {
      outIdx += 1;
      const outCode = `OUT-${outIdx}`;
      const outRow = await client.query<{ id: number }>(
        `INSERT INTO outputs (project_id, code, title, description, target) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [projectId, outCode, out.title, out.description ?? null, out.target ?? 0],
      );
      const outputId = outRow.rows[0].id;

      const indicatorIds: number[] = [];
      const outputIndicators = out.indicators ?? [];
      for (let ii = 0; ii < outputIndicators.length; ii++) {
        const ind = outputIndicators[ii];
        const indRow = await client.query<{ id: number }>(
          `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [projectId, outputId, `IND-${outIdx}.${ii + 1}`, ind.title, ind.unit ?? "count", ind.target ?? 0, primarySector],
        );
        indicatorIds.push(indRow.rows[0].id);
      }

      // Legacy: single output-level indicator via indicatorTitle field
      if (outputIndicators.length === 0 && out.indicatorTitle) {
        const indRow = await client.query<{ id: number }>(
          `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [projectId, outputId, `IND-${outIdx}.0`, out.indicatorTitle, out.indicatorUnit ?? "count", out.indicatorTarget ?? 0, primarySector],
        );
        indicatorIds.push(indRow.rows[0].id);
      }

      let actIdx = 0;
      for (const act of out.activities ?? []) {
        actIdx += 1;
        const actCode = `ACT-${outIdx}.${actIdx}`;

        let linkedIndicatorId: number | null = null;
        if (act.indicatorIndex !== undefined && indicatorIds[act.indicatorIndex] !== undefined) {
          linkedIndicatorId = indicatorIds[act.indicatorIndex];
        }

        await client.query(
          `INSERT INTO activities (
             project_id, output_id, indicator_id, state_id, locality_name,
             code, title, description, target,
             status, planned_start, planned_end, budget_planned
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            projectId, outputId, linkedIndicatorId, act.stateId ?? null,
            act.localityName?.trim() ?? null,
            actCode, act.title, act.description ?? null, act.target ?? 0,
            act.status ?? "planned", act.plannedStart, act.plannedEnd, act.budgetPlanned,
          ],
        );

        // Legacy: activity-embedded indicator (when no indicators array on output)
        if (outputIndicators.length === 0 && act.indicatorTitle && !out.indicatorTitle) {
          await client.query(
            `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [projectId, outputId, `IND-${outIdx}.${actIdx}`, act.indicatorTitle, act.indicatorUnit ?? "count", act.indicatorTarget ?? 0, primarySector],
          );
        }
      }
    }
    await client.query("COMMIT");

    // Dropped (deferred to the notifications-engine port): G-06 "project
    // created" notification to the creator, plus project_assigned
    // notifications to each newly-assigned user.

    await logAudit(db, {
      userId: user.id,
      action: "create",
      module: "projects",
      entityId: projectId,
      newValue: project.title as string,
    });
    const enriched = await enrichProject(db, project, user.name);
    await broadcastUpdate(c.env, { module: "projects", action: "created", entityId: projectId, actorId: user.id, actorName: user.name });
    return c.json(enriched, 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // PRJ-018: unique violation on projects.code must surface as a clean 409.
    if (
      typeof err === "object" && err !== null &&
      (err as { code?: string }).code === "23505" &&
      String((err as { constraint?: string }).constraint ?? "").includes("projects_code_unique")
    ) {
      return c.json({ error: "project_code_conflict" }, 409);
    }
    throw err;
  } finally {
    client.release();
    close();
  }
});

// ── Project update ────────────────────────────────────────────────────────────
projectsRoutes.patch("/projects/:projectId", requirePerm("projects.update"), async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    const check = await client.query<{
      status: string;
      sector: string | null;
      sectors: string[];
      has_hq_operations: boolean;
      state_ids: number[];
    }>(
      `SELECT status, sector, has_hq_operations,
              ARRAY(SELECT ps.state_id FROM project_states ps WHERE ps.project_id = projects.id) AS state_ids,
              COALESCE(sectors, '[]'::jsonb)::jsonb AS sectors FROM projects WHERE id = $1`,
      [projectId],
    );
    if (check.rows.length === 0) return c.json({ error: "Not found" }, 404);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    if (check.rows[0].status !== "draft") {
      return c.json({ error: "Only draft projects can be updated" }, 409);
    }
    const effectiveSectorsForPatch = [...new Set([
      ...(check.rows[0].sector ? [check.rows[0].sector] : []),
      ...(Array.isArray(check.rows[0].sectors) ? check.rows[0].sectors : []),
    ])];
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectorsForPatch);
    if (!guard.ok) return c.json(guard.body, guard.status as any);

    const rawBody = await c.req.json<Record<string, unknown>>();
    const body = CreateProjectBody.parse(rawBody);
    const isStateRole = ["state_program_officer", "state_office_manager"].includes(user.role);
    const existingScopeOutsideCaller = isStateRole && (
      check.rows[0].has_hq_operations === true
      || (check.rows[0].state_ids ?? []).some((stateId) => stateId !== user.stateId)
    );
    const rawPatchHqOperations = rawBody.hasHqOperations;
    // PATCH normally preserves an omitted HQ flag. State callers must therefore
    // explicitly clear it before they can edit a historical draft that claims HQ.
    const effectivePatchHqOperations = rawPatchHqOperations === true ||
      (rawPatchHqOperations !== false && check.rows[0].has_hq_operations === true);
    if (existingScopeOutsideCaller || violatesStateScopedProjectWrite(user, body, effectivePatchHqOperations)) {
      return c.json({ error: "state_forbidden" }, 403);
    }
    const reportingCoverage = resolveReportingCoverage(rawBody, body.startDate, body.endDate);
    if (!reportingCoverage) {
      return c.json({ error: "invalid_reporting_coverage", message: "Reporting coverage must be a valid inclusive date range." }, 422);
    }
    const donorValidation = validateDonorName(body.donor);
    if (!donorValidation.ok) {
      return c.json({ error: donorValidation.error, field: "donor", message: donorValidation.message }, 422);
    }
    // PATCH replaces project_state links and allocations wholesale, so any
    // active-state check below is against this new operational assignment.
    for (const stateId of [
      ...(body.stateIds ?? []),
      ...(body.stateAllocations ?? []).map((allocation) => allocation.stateId),
    ]) {
      const activeState = await assertActiveState(db, Number(stateId));
      if (!activeState.ok) {
        return c.json({ error: activeState.error, message: "Projects can only be assigned to active States." }, 422);
      }
    }
    const persistedDocuments = await client.query<ExistingProjectDocument>(
      `SELECT object_path AS "objectPath", file_name AS "fileName",
              content_type AS "contentType", size
       FROM project_documents
       WHERE project_id = $1 AND object_path IS NOT NULL AND object_path <> ''`,
      [projectId],
    );
    const existingByObjectPath = new Map(
      (Array.isArray(persistedDocuments.rows) ? persistedDocuments.rows : [])
        .map((document) => [document.objectPath, document]),
    );
    for (const d of body.documents ?? []) {
      const existing = d.objectPath ? existingByObjectPath.get(d.objectPath) : undefined;
      if (
        (d.objectPath && existing && !matchesExistingProjectDocument(d, existing))
        || (!existing && !validProjectDocumentDescriptor(c.env.SESSION_SECRET, d, user.id))
      ) {
        return c.json({ error: "invalid_document_upload_descriptor" }, 422);
      }
    }
    if (body.startDate && body.endDate && new Date(body.endDate) < new Date(body.startDate)) {
      return c.json({ error: "invalid_date_range", detail: "End Date cannot be before Start Date" }, 400);
    }

    if ((body.budgetTotal ?? 0) < 0) {
      return c.json({
        error: "validation_error",
        detail: "budgetTotal: Budget must be zero or a positive number",
        fields: [{ path: "budgetTotal", message: "Budget must be zero or a positive number" }],
      }, 400);
    }

    {
      const rawHqOps = rawBody.hasHqOperations;
      const hqOps = rawHqOps === true;
      if (!hqOps && (body.stateIds ?? []).length === 0) {
        return c.json({
          error: "no_operational_location",
          message: "A project must have at least one Operational Location: select HQ or at least one state.",
        }, 422);
      }
    }

    const sectorsArr = body.sectors ?? (body.sector ? [body.sector] : []);
    const primarySector = sectorsArr[0] ?? body.sector ?? "";

    const invalidPatchSecs = sectorsArr.filter((s) => s && !VALID_SECTOR_SET.has(s));
    if (invalidPatchSecs.length > 0) {
      return c.json({ error: "invalid_sector", field: "sectors", code: "invalid_sector", message: `Unrecognised sector(s): ${invalidPatchSecs.join(", ")}. Allowed: ${[...VALID_SECTOR_SET].join(", ")}` }, 422);
    }
    const patchSectorsSeen = new Set<string>();
    const patchDuplicates = sectorsArr.filter((s) => {
      if (patchSectorsSeen.has(s)) return true;
      patchSectorsSeen.add(s);
      return false;
    });
    if (patchDuplicates.length > 0) {
      return c.json({ error: "duplicate_sector", field: "sectors", code: "duplicate_sector", message: `Duplicate sector(s): ${[...new Set(patchDuplicates)].join(", ")}. Each sector must appear at most once.` }, 422);
    }
    const uniquePatchSectors = sectorsArr;
    const patchSubSectors: string[] = body.subSectors ?? [];
    if (patchSubSectors.length > 0 && uniquePatchSectors.length > 0) {
      const subErr = validateSubSectorsMulti(uniquePatchSectors, patchSubSectors);
      if (subErr) return c.json({ error: "invalid_sub_sector", field: "subSectors", code: "invalid_sub_sector", message: subErr }, 422);
    }
    const patchModality = body.assistanceModality ?? null;
    if (patchModality && !ASSISTANCE_MODALITY_SET.has(patchModality)) {
      return c.json({ error: "invalid_assistance_modality", field: "assistanceModality", code: "invalid_assistance_modality", message: `"${patchModality}" is not a recognised assistance modality.` }, 422);
    }

    let resolvedDonorName = body.donor ?? "";

    await client.query("BEGIN");

    // ── BUD-BD-01: lock the project row for the whole transaction ─────────────
    // Serialises this PATCH against the dedicated allocation replace endpoint so
    // a concurrent budget change and allocation write cannot both slip past the
    // cap check. Also captures the pre-PATCH budget for audit logging.
    const budgetLockRes = await client.query<{ budget: number }>(
      `SELECT COALESCE(budget_total::float, 0) AS budget FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    const oldBudgetTotal = budgetLockRes.rows[0]?.budget ?? 0;

    // ── BUD-DONOR-008: validate donor ID inside the transaction, after FOR UPDATE ──
    if (body.donorId != null) {
      const dr = await client.query<{ name: string }>(`SELECT name FROM donors WHERE id = $1 FOR KEY SHARE`, [body.donorId]);
      if (!dr.rows[0]) {
        await client.query("ROLLBACK");
        return c.json({ error: "invalid_donor_id", field: "donorId", message: "The specified donor does not exist." }, 422);
      }
      resolvedDonorName = dr.rows[0].name;
      const linkedDonorValidation = validateDonorName(resolvedDonorName);
      if (!linkedDonorValidation.ok) {
        await client.query("ROLLBACK");
        return c.json({ error: linkedDonorValidation.error, field: "donorId", message: linkedDonorValidation.message }, 422);
      }
    }
    if (!resolvedDonorName && body.donorId == null) resolvedDonorName = "Unknown";

    // ── BUD-BD-01: allocation cap check ────────────────────────────────────────
    const patchEffectiveBudget = body.budgetTotal ?? 0;
    for (const alloc of body.stateAllocations ?? []) {
      if ((alloc.budgetAllocation ?? 0) < 0) {
        await client.query("ROLLBACK");
        return c.json({ error: "invalid_allocation", message: "Budget allocation cannot be negative." }, 422);
      }
    }
    const patchAllocTotal = (body.stateAllocations ?? []).reduce((s, a) => s + (a.budgetAllocation ?? 0), 0);
    if (patchAllocTotal > patchEffectiveBudget) {
      await client.query("ROLLBACK");
      return c.json({
        error: "over_allocation",
        message: `Total state allocations (${patchAllocTotal.toFixed(2)}) would exceed the project budget (${patchEffectiveBudget.toFixed(2)}). Reduce allocations before lowering the budget.`,
      }, 422);
    }

    // ── PRJ-BD-03: load existing activity spend BEFORE touching rows ──────────
    // budget_spent and progress_pct must survive ordinary content edits.
    const existingSpendRes = await client.query<{ id: number; budget_spent: string; progress_pct: number; state_id: number | null }>(
      "SELECT id, budget_spent, progress_pct, state_id FROM activities WHERE project_id = $1",
      [projectId],
    );
    const spendMap = new Map<number, { budgetSpent: number; progressPct: number; stateId: number | null }>();
    for (const row of existingSpendRes.rows) {
      spendMap.set(row.id, {
        budgetSpent: Number(row.budget_spent),
        progressPct: row.progress_pct,
        stateId: row.state_id,
      });
    }
    const matchedActivityIds: number[] = [];

    const rawHasHqOps = rawBody.hasHqOperations;
    const hasHqOpsUpdate = typeof rawHasHqOps === "boolean" ? rawHasHqOps : undefined;

    // Scheduled Reporting Frequency (Task #325): optional on PATCH.
    // - Absent from body → column unchanged
    // - null → explicitly cleared
    // - Otherwise must be a scheduled frequency; 'on_demand' is rejected.
    const freqProvided = Object.prototype.hasOwnProperty.call(rawBody, "reportingFrequency");
    const rawFreqPatch = rawBody.reportingFrequency;
    if (
      freqProvided &&
      rawFreqPatch !== null &&
      (typeof rawFreqPatch !== "string" || !(SCHEDULED_FREQUENCIES as readonly string[]).includes(rawFreqPatch))
    ) {
      // NOTE (fixed while porting): the Express original returns here without
      // a ROLLBACK, leaving the transaction open on the connection it then
      // releases back to the pool — every other validation-failure branch in
      // this route rolls back first. Added here for correctness; behaviour is
      // otherwise identical.
      await client.query("ROLLBACK");
      return c.json({
        error: "invalid_reporting_frequency",
        field: "reportingFrequency",
        code: "invalid_reporting_frequency",
        message: "Scheduled Reporting Frequency must be one of: monthly, quarterly, annual (or null to leave unconfigured).",
      }, 400);
    }
    const freqPatchValue = freqProvided ? (rawFreqPatch as ScheduledFrequency | null) : null;

    const baseRevision = c.req.header("x-base-revision");
    const updateResult = await client.query(
      `UPDATE projects SET
         title=$1, description=$2, classification=$3,
         sector=$4, sectors=$5::jsonb,
         sub_sectors=$6::jsonb, assistance_modality=$7,
         donor=$8, donor_id=$9, agreement_number=$10,
         agreement_start=$11, agreement_end=$12, signed_date=$13, internal_notes=$14,
         start_date=$15, end_date=$16, reporting_start_date=$34, reporting_end_date=$35,
         budget_total=$17, direct_cost=$18, indirect_cost=$19,
         cafa_contribution=$20, budget_version=$21, currency=$22,
         beneficiaries_target=$23, beneficiaries_male=$24, beneficiaries_female=$25,
         beneficiaries_boys=$26, beneficiaries_girls=$27,
         activity_target=$28, indicator_target=$29,
         has_hq_operations=COALESCE($31, has_hq_operations),
         reporting_frequency=CASE WHEN $32::boolean THEN $33 ELSE reporting_frequency END,
         updated_at=NOW()
       WHERE id=$30${baseRevision ? " AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $36::timestamptz)" : ""}`,
      [
        body.title, body.description, body.classification ?? null,
        primarySector, JSON.stringify(uniquePatchSectors),
        JSON.stringify(patchSubSectors), patchModality,
        resolvedDonorName, body.donorId ?? null, body.agreementNumber,
        body.agreementStart ?? null, body.agreementEnd ?? null,
        body.signedDate ?? null, body.internalNotes ?? null,
        body.startDate, body.endDate,
        body.budgetTotal ?? 0, body.directCost ?? 0, body.indirectCost ?? 0,
        body.cafaContribution ?? 0, body.budgetVersion ?? null, body.currency ?? "USD",
        body.beneficiariesTarget ?? 0, body.beneficiariesMale ?? 0, body.beneficiariesFemale ?? 0,
        body.beneficiariesBoys ?? 0, body.beneficiariesGirls ?? 0,
        body.activityTarget ?? 0, body.indicatorTarget ?? 0,
        projectId,
        hasHqOpsUpdate ?? null,
        freqProvided,
        freqPatchValue,
        reportingCoverage.start,
        reportingCoverage.end,
        ...(baseRevision ? [baseRevision] : []),
      ],
    );
    if (baseRevision && updateResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return c.json({ error: "offline_conflict", code: "revision_mismatch", message: "The project changed while this draft was offline." }, 409);
    }

    // Indicators have no client-supplied id, so — unlike activities — they
    // are always deleted and reinserted with fresh ids on every PATCH. Their
    // deterministic `code` is the only stable identity; read the prior
    // (code -> achieved) map before the delete so an ordinary content edit
    // doesn't silently zero out already-recorded indicator progress.
    const existingIndicatorAchieved = await client.query<{ code: string; achieved: string }>(
      "SELECT code, achieved FROM indicators WHERE project_id=$1",
      [projectId],
    );
    const indicatorAchievedByCode = new Map<string, number>(
      existingIndicatorAchieved.rows.map((row) => [row.code, Number(row.achieved)]),
    );

    // Replace all nested data (activities handled separately below via upsert — PRJ-BD-03)
    await client.query("DELETE FROM indicators WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM outputs WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM project_states WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM project_state_allocations WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM project_free_localities WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM project_assignments WHERE project_id=$1", [projectId]);
    await client.query(
      `DELETE FROM document_registry_entries dre
       USING project_documents pd
       WHERE dre.source_kind = 'project_document'
         AND dre.source_id = pd.id
         AND pd.project_id = $1`,
      [projectId],
    );
    await client.query("DELETE FROM project_documents WHERE project_id=$1", [projectId]);

    for (const sid of body.stateIds ?? []) {
      await client.query(`INSERT INTO project_states (project_id, state_id) VALUES ($1,$2)`, [projectId, sid]);
    }
    for (const alloc of body.stateAllocations ?? []) {
      await client.query(
        `INSERT INTO project_state_allocations
           (project_id, state_id, budget_allocation, beneficiary_target,
            beneficiary_male, beneficiary_female, beneficiary_boys, beneficiary_girls,
            activity_target, indicator_target, state_lead, state_team, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
        [projectId, alloc.stateId,
         alloc.budgetAllocation ?? 0, alloc.beneficiaryTarget ?? 0,
         alloc.beneficiaryMale ?? 0, alloc.beneficiaryFemale ?? 0,
         alloc.beneficiaryBoys ?? 0, alloc.beneficiaryGirls ?? 0,
         alloc.activityTarget ?? 0, alloc.indicatorTarget ?? 0,
         alloc.stateLead ?? null,
         JSON.stringify(alloc.stateTeam ?? []),
         alloc.notes ?? null],
      );
    }
    let localityOrder = 0;
    for (const localityName of body.localities ?? []) {
      if (!localityName?.trim()) continue;
      await client.query(
        `INSERT INTO project_free_localities (project_id, name, display_order) VALUES ($1,$2,$3)`,
        [projectId, localityName.trim(), localityOrder++],
      );
    }
    for (const a of body.assignments ?? []) {
      await client.query(
        `INSERT INTO project_assignments (project_id, user_id, name, role) VALUES ($1,$2,$3,$4)`,
        [projectId, a.userId ?? null, a.name?.trim() || null, a.role],
      );
    }
    for (const d of body.documents ?? []) {
      await client.query(
        `WITH inserted AS (
           INSERT INTO project_documents
             (project_id, category, kind, file_name, content_type, size, object_path, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id
         )
         INSERT INTO document_registry_entries
           (source_kind, source_id, title, classification, confidentiality, related_record_type, related_record_id)
         SELECT 'project_document', id, $4, 'Project Documents', 'internal', 'project', $1
         FROM inserted
         ON CONFLICT (source_kind, source_id) DO NOTHING`,
        [projectId, d.category ?? "optional", d.kind,
         d.fileName, d.contentType, d.size,
         d.objectPath ?? "", user.id],
      );
    }

    // ── PRJ-BD-03: extract raw activity ids from the request body (server-side only) ─
    // The generated CreateProjectBody schema does not include id on activities, so
    // read the raw body alongside the parsed body. Only numeric positive integer
    // ids that belong to this project (present in spendMap) are honoured.
    const rawOutputsArr: Record<string, unknown>[] = Array.isArray(rawBody.outputs)
      ? (rawBody.outputs as Record<string, unknown>[])
      : [];

    let outIdx = 0;
    const outBodyArr = body.outputs ?? [];
    for (let oi = 0; oi < outBodyArr.length; oi++) {
      const out = outBodyArr[oi];
      outIdx += 1;
      const outRow = await client.query<{ id: number }>(
        `INSERT INTO outputs (project_id, code, title, description, target) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [projectId, `OUT-${outIdx}`, out.title, out.description ?? null, out.target ?? 0],
      );
      const outputId = outRow.rows[0].id;
      const indicatorIds: number[] = [];
      const outIndicators = out.indicators ?? [];
      for (let ii = 0; ii < outIndicators.length; ii++) {
        const ind = outIndicators[ii];
        const indicatorCode = `IND-${outIdx}.${ii + 1}`;
        const preservedAchieved = indicatorAchievedByCode.get(indicatorCode) ?? 0;
        const indRow = await client.query<{ id: number }>(
          `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector, achieved)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [projectId, outputId, indicatorCode, ind.title, ind.unit ?? "count", ind.target ?? 0, primarySector, preservedAchieved],
        );
        indicatorIds.push(indRow.rows[0].id);
      }

      const rawActsArr: Record<string, unknown>[] = Array.isArray(
        (rawOutputsArr[oi] as Record<string, unknown>)?.activities,
      ) ? ((rawOutputsArr[oi] as Record<string, unknown>).activities as Record<string, unknown>[]) : [];

      let actIdx = 0;
      const actBodyArr = out.activities ?? [];
      for (let ai = 0; ai < actBodyArr.length; ai++) {
        const act = actBodyArr[ai];
        actIdx += 1;
        let linkedIndicatorId: number | null = null;
        if (act.indicatorIndex !== undefined && indicatorIds[act.indicatorIndex] !== undefined) {
          linkedIndicatorId = indicatorIds[act.indicatorIndex];
        }

        const rawId = (rawActsArr[ai] as Record<string, unknown>)?.id;
        const incomingId = typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0 ? rawId : undefined;
        const spendData = incomingId !== undefined && spendMap.has(incomingId) ? spendMap.get(incomingId)! : null;
        const incomingStateId = act.stateId ?? null;
        if ((spendData === null || spendData.stateId !== incomingStateId) && incomingStateId !== null) {
          const activeState = await assertActiveState(db, Number(incomingStateId));
          if (!activeState.ok) {
            await client.query("ROLLBACK");
            return c.json({
              error: activeState.error,
              message: "Project activities can only be assigned to active States.",
            }, 422);
          }
        }

        if (spendData !== null && incomingId !== undefined) {
          // Existing activity — UPDATE, preserving budget_spent and progress_pct
          matchedActivityIds.push(incomingId);
          await client.query(
            `UPDATE activities SET
               output_id=$1, indicator_id=$2, state_id=$3, locality_name=$4,
               code=$5, title=$6, description=$7, target=$8, status=$9,
               planned_start=$10, planned_end=$11, budget_planned=$12
             WHERE id=$13 AND project_id=$14`,
            [outputId, linkedIndicatorId, act.stateId ?? null,
             act.localityName?.trim() ?? null,
             `ACT-${outIdx}.${actIdx}`, act.title, act.description ?? null,
             act.target ?? 0, act.status ?? "planned",
             act.plannedStart, act.plannedEnd, act.budgetPlanned,
             incomingId, projectId],
          );
        } else {
          // New activity (no id or id not owned by this project) — INSERT with zero spend.
          // FIXED while porting (see the batch 2 report): the original only
          // pushes onto matchedActivityIds for the UPDATE branch above, so a
          // brand-new activity inserted here had no id in that list — the
          // "delete activities removed from the payload" cleanup below then
          // deleted it again in the very same transaction whenever no
          // existing activity matched (first time activities are added, or
          // every existing id changed). RETURNING id and pushing it here
          // closes that gap; ported back into api-server too.
          const newActivityRow = await client.query<{ id: number }>(
            `INSERT INTO activities
               (project_id, output_id, indicator_id, state_id, locality_name,
                code, title, description, target, status, planned_start, planned_end,
                budget_planned, budget_spent, progress_pct)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0)
             RETURNING id`,
            [projectId, outputId, linkedIndicatorId, act.stateId ?? null,
             act.localityName?.trim() ?? null,
             `ACT-${outIdx}.${actIdx}`, act.title, act.description ?? null,
             act.target ?? 0, act.status ?? "planned",
             act.plannedStart, act.plannedEnd, act.budgetPlanned],
          );
          matchedActivityIds.push(newActivityRow.rows[0].id);
        }
      }
    }

    // ── PRJ-BD-03: delete activities removed from the payload ─────────────────
    // Activities with non-zero budget_spent that are deleted here will lose their
    // spend data — this is intentional (the user explicitly removed the activity).
    if (matchedActivityIds.length > 0) {
      await client.query(
        `DELETE FROM activities WHERE project_id=$1 AND id != ALL($2::int[])`,
        [projectId, matchedActivityIds],
      );
    } else {
      await client.query("DELETE FROM activities WHERE project_id=$1", [projectId]);
    }

    await client.query("COMMIT");
    // BUD audit: when the budget changed, record the old/new figures alongside the title.
    const budgetChanged = patchEffectiveBudget !== oldBudgetTotal;
    await logAudit(db, {
      userId: user.id,
      action: "update",
      module: "projects",
      entityId: projectId,
      newValue: budgetChanged
        ? JSON.stringify({ title: body.title, oldBudget: oldBudgetTotal, newBudget: patchEffectiveBudget })
        : body.title,
    });
    await broadcastUpdate(c.env, { module: "projects", action: "updated", entityId: projectId, actorId: user.id, actorName: user.name });
    const enriched = await enrichProject(db, { id: projectId, title: body.title } as Record<string, unknown>, user.name);
    return c.json(enriched);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    close();
  }
});

// ── Project workflow transitions ──────────────────────────────────────────────
projectsRoutes.post("/projects/:projectId/transitions", async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, pool, close } = openDb(c);
  try {
    const body = TransitionProjectBody.parse(await c.req.json());
    const transition = PROJECT_TRANSITIONS[body.action];
    if (!transition) {
      return c.json({ error: `invalid action: ${body.action}` }, 400);
    }
    // reject/request_revision use stage-aware permission evaluation (checked after
    // the source status is loaded); all other transitions keep static permissions.
    const isStageAwareAction = body.action === "reject" || body.action === "request_revision";
    const transitionPerm = PROJECT_TRANSITION_PERMS[body.action];
    if (transitionPerm && !isStageAwareAction) {
      const perms = permissionsFor(user);
      if (!perms.includes("*") && !perms.includes(transitionPerm)) {
        return c.json({ error: "forbidden", requiredPermission: transitionPerm }, 403);
      }
    }
    const cur = await db.query<{ status: string; sector: string | null; sectors: string[]; managementLevel: string }>(
      `SELECT status, sector, COALESCE(sectors, '[]'::jsonb)::jsonb AS sectors, management_level AS "managementLevel"
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    if (cur.rows.length === 0) {
      return c.json({ error: "project not found" }, 404);
    }
    const effectiveSectorsForTransition = [...new Set([
      ...(cur.rows[0].sector ? [cur.rows[0].sector] : []),
      ...(Array.isArray(cur.rows[0].sectors) ? cur.rows[0].sectors : []),
    ])];
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectorsForTransition);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    const fromStatus = cur.rows[0].status;
    if (!transition.from.includes(fromStatus)) {
      return c.json({ error: `cannot ${body.action} from ${fromStatus}` }, 400);
    }
    // PRJ-BD-02: stage-aware permission for reject/request_revision. Full Access
    // ("*") still applies, but never overrides the source-status validation above.
    if (isStageAwareAction) {
      const requiredPerm = stageAwareNegativePerm(fromStatus);
      if (!requiredPerm) {
        return c.json({ error: `cannot ${body.action} from ${fromStatus}` }, 400);
      }
      const perms = permissionsFor(user);
      if (!perms.includes("*") && !perms.includes(requiredPerm)) {
        return c.json({ error: "forbidden", requiredPermission: requiredPerm }, 403);
      }
    }

    if (body.action === "final_approve") {
      // Gate 1: unresolved required corrections
      const n = await unresolvedRequiredCorrections(db, "project", projectId);
      if (n > 0) {
        return c.json({ error: "unresolved_required_corrections", count: n }, 409);
      }
      // Gate 2: must have at least one agreement doc AND one budget doc
      const docCheck = await db.query<{ agreement_count: string; budget_count: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE category = 'agreement') AS agreement_count,
           COUNT(*) FILTER (WHERE category = 'budget') AS budget_count
         FROM project_documents WHERE project_id = $1`,
        [projectId],
      );
      const { agreement_count, budget_count } = docCheck.rows[0];
      if (Number(agreement_count) === 0) {
        return c.json({ error: "missing_required_document", detail: "At least one Agreement document is required before final approval." }, 409);
      }
      if (Number(budget_count) === 0) {
        return c.json({ error: "missing_required_document", detail: "At least one Budget document is required before final approval." }, 409);
      }
      // Gate 3: detailed cost breakdown must not exceed the approved total.
      const costCheck = await db.query<{
        budgetTotal: number; directCost: number; indirectCost: number; cafaContribution: number;
      }>(
        `SELECT budget_total::float AS "budgetTotal",
                COALESCE(direct_cost::float, 0) AS "directCost",
                COALESCE(indirect_cost::float, 0) AS "indirectCost",
                COALESCE(cafa_contribution::float, 0) AS "cafaContribution"
         FROM projects WHERE id = $1`,
        [projectId],
      );
      const costRow = costCheck.rows[0];
      const detailedCostTotal = costRow.directCost + costRow.indirectCost + costRow.cafaContribution;
      if (detailedCostTotal > costRow.budgetTotal) {
        return c.json({
          error: "budget_breakdown_exceeds_total",
          detail: `Detailed costs (Direct + Indirect + CAFA Contribution = ${detailedCostTotal.toFixed(2)}) exceed the approved Budget Total (${costRow.budgetTotal.toFixed(2)}).`,
          budgetTotal: costRow.budgetTotal,
          detailedCostTotal,
        }, 409);
      }
      // Gate 4: disaggregated beneficiary counts must not exceed the target.
      const beneficiaryCheck = await db.query<{
        beneficiariesTarget: number | null;
        beneficiariesMale: number; beneficiariesFemale: number; beneficiariesBoys: number; beneficiariesGirls: number;
      }>(
        `SELECT beneficiaries_target AS "beneficiariesTarget",
                COALESCE(beneficiaries_male, 0) AS "beneficiariesMale",
                COALESCE(beneficiaries_female, 0) AS "beneficiariesFemale",
                COALESCE(beneficiaries_boys, 0) AS "beneficiariesBoys",
                COALESCE(beneficiaries_girls, 0) AS "beneficiariesGirls"
         FROM projects WHERE id = $1`,
        [projectId],
      );
      const beneficiaryRow = beneficiaryCheck.rows[0];
      const beneficiarySum =
        beneficiaryRow.beneficiariesMale + beneficiaryRow.beneficiariesFemale
        + beneficiaryRow.beneficiariesBoys + beneficiaryRow.beneficiariesGirls;
      const beneficiaryTarget = beneficiaryRow.beneficiariesTarget ?? 0;
      if (beneficiarySum > beneficiaryTarget) {
        return c.json({
          error: "beneficiaries_breakdown_exceeds_target",
          detail: `Disaggregated beneficiaries (Male + Female + Boys + Girls = ${beneficiarySum}) exceed the Beneficiaries Target (${beneficiaryTarget}).`,
          beneficiariesTarget: beneficiaryTarget,
          beneficiarySum,
        }, 409);
      }
    }

    const commentText = String(body.comment ?? "").trim();
    if ((body.action === "request_revision" || body.action === "reject") && !commentText) {
      return c.json({ error: "comment_required_for_revision_or_reject" }, 400);
    }

    // Atomic CAS transition: the UPDATE includes an AND status = $fromStatus
    // predicate. If a concurrent transition on this same project already
    // changed the status between our read above and this write, rowCount is
    // 0 and we report a 409 conflict instead of silently letting whichever
    // transition committed last win with no signal that the other one's
    // approval/rejection was effectively lost. The approval record and
    // optional comment are written in the same transaction, so a partial
    // commit (status changed, no approval row) is impossible.
    let updatedRow: Record<string, unknown> | undefined;
    const transitionClient = await pool.connect();
    try {
      await transitionClient.query("BEGIN");
      const casResult = await transitionClient.query<Record<string, unknown>>(
        `UPDATE projects SET status = $1 WHERE id = $2 AND status = $3 AND deleted_at IS NULL ${projectReturning}`,
        [transition.to, projectId, fromStatus],
      );
      if (casResult.rowCount === 0) {
        await transitionClient.query("ROLLBACK");
        return c.json({
          error: "project_status_conflict",
          message: "The project status has changed; please refresh and try again.",
        }, 409);
      }
      updatedRow = casResult.rows[0];
      await transitionClient.query(
        `INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, comment)
         VALUES ('project', $1, $2, $3, $4, $5, $6)`,
        [projectId, body.action, fromStatus, transition.to, user.id, body.comment ?? null],
      );

      if (commentText && (body.action === "request_revision" || body.action === "reject")) {
        await transitionClient.query(
          `INSERT INTO comments (entity_type, entity_id, comment_type, author_id, body)
           VALUES ('project', $1, $2, $3, $4)`,
          [
            projectId,
            body.action === "request_revision" ? "revision_request" : "rejection_reason",
            user.id,
            commentText,
          ],
        );
      }
      await transitionClient.query("COMMIT");
    } catch (err) {
      await transitionClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      transitionClient.release();
    }

    await logAudit(db, {
      userId: user.id,
      action: body.action,
      module: "projects",
      entityId: projectId,
      oldValue: fromStatus,
      newValue: transition.to,
    });

    // Dropped (deferred to the notifications-engine port): notifyEntityActorsDeduped
    // (transition notice to entity actors) and notifyNextApprover (G-01, next
    // approver in chain). checkAndFireBudgetAlert (fire-and-forget budget
    // threshold notification) is dropped for the same reason.

    const enriched = await enrichProject(db, updatedRow!, null);
    await broadcastUpdate(c.env, {
      module: "projects", action: body.action, entityId: projectId, actorId: user.id, actorName: user.name,
      data: { from: fromStatus, to: transition.to },
    });
    return c.json(enriched);
  } finally {
    close();
  }
});

// ── Project deletion info ─────────────────────────────────────────────────────
projectsRoutes.get("/projects/:projectId/deletion-info", async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, close } = openDb(c);
  try {
    if (Number.isNaN(projectId)) return c.json({ error: "invalid project id" }, 400);
    const perms = permissionsFor(user);
    const userCanDelete = hasPerm(perms, "projects.delete");
    if (!userCanDelete) return c.json({ canDelete: false, mode: null });

    const { rows } = await db.query<{ id: number; code: string; title: string; status: string; sector: string; sectors: string[]; deleted_at: Date | null }>(
      `SELECT id, code, title, status, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors, deleted_at FROM projects WHERE id = $1`,
      [projectId],
    );
    if (rows.length === 0 || rows[0].deleted_at !== null) {
      return c.json({ error: "project not found" }, 404);
    }
    const project = rows[0];
    if (isExactDevelopmentTestRetirementTarget(project)) {
      return c.json({ canDelete: false, mode: null, reason: "development_fixture_retirement_required" });
    }
    // PRJ-BD-05: use effective-sector set (primary ∪ sectors[]) for TC scope guard.
    const deleteInfoSectors = [...new Set([
      ...(project.sector ? [project.sector] : []),
      ...(Array.isArray(project.sectors) ? project.sectors : []),
    ])];
    const sectorGuard = assertEffectiveSectorAllowedForProject(user, deleteInfoSectors);
    if (!sectorGuard.ok) return c.json({ canDelete: false, mode: null });

    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json({ canDelete: false, mode: null });

    const { rows: historyRows } = await db.query<{ toStatus: string }>(
      `SELECT to_status AS "toStatus" FROM approvals WHERE entity_type = 'project' AND entity_id = $1`,
      [projectId],
    );

    const mode = getProjectDeletionMode(project, historyRows, true);
    return c.json({ canDelete: true, mode });
  } finally {
    close();
  }
});

// ── Project deletion (permanent or soft based on approval history) ────────────
// Permission: projects.delete (ED and PM only; super_admin via *).
// Body: { reason: string }
// Sequence: auth → lock → determine mode → validate → check protected → audit → delete/soft-delete → commit.
projectsRoutes.delete("/projects/:projectId", requirePerm("projects.delete"), async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    if (Number.isNaN(projectId)) return c.json({ error: "invalid project id" }, 400);

    const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
    const reasonError = validateDeletionReason(reason);
    if (reasonError) return c.json({ error: "deletion_reason_required", message: reasonError }, 400);
    const cleanReason = (reason as string).trim();

    await client.query("BEGIN");

    // Lock the project row to prevent concurrent deletions.
    const { rows: projectRows } = await client.query<{
      id: number; code: string; title: string; status: string; sector: string; sectors: string[]; deleted_at: Date | null;
    }>(
      `SELECT id, code, title, status, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors, deleted_at FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    if (projectRows.length === 0) {
      await client.query("ROLLBACK");
      return c.json({ error: "project not found" }, 404);
    }
    const project = projectRows[0];
    if (project.deleted_at !== null) {
      await client.query("ROLLBACK");
      return c.json({ error: "project already deleted" }, 409);
    }
    // The reviewed historical development fixture must never pass through the
    // generic pre-approval permanent-delete path. Its dedicated, development-
    // only retirement operation preserves its child records and history.
    // (This can never match in a freshly-migrated database — there is no
    // project with this exact id/code/title combination — but the guard is
    // kept for parity in case historical data is ever imported.)
    if (isExactDevelopmentTestRetirementTarget(project)) {
      await client.query("ROLLBACK");
      return c.json({
        error: "development_fixture_retirement_required",
        message: "This reviewed development fixture must be retired through the development-only soft-retirement action.",
      }, 409);
    }

    // Verify sector scope — PRJ-BD-05: effective sector set (primary ∪ sectors[]).
    const deleteSectors = [...new Set([
      ...(project.sector ? [project.sector] : []),
      ...(Array.isArray(project.sectors) ? project.sectors : []),
    ])];
    const sectorGuard = assertEffectiveSectorAllowedForProject(user, deleteSectors);
    if (!sectorGuard.ok) {
      await client.query("ROLLBACK");
      return c.json(sectorGuard.body, sectorGuard.status as any);
    }

    // Verify state scope.
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) {
      await client.query("ROLLBACK");
      return c.json(stateGuard.body, stateGuard.status as any);
    }
    // Determine whether Final Approval was ever reached (using approvals history).
    const { rows: historyRows } = await client.query<{ toStatus: string }>(
      `SELECT to_status AS "toStatus" FROM approvals WHERE entity_type = 'project' AND entity_id = $1`,
      [projectId],
    );

    // Resolve deletion mode. canDelete=true because requirePerm already passed.
    const mode = getProjectDeletionMode(project, historyRows, true);

    const now = new Date();
    const userId = user.id;

    // Deletion audience must be captured now, while the record is still
    // visible to the canonical resolver (both modes end with a project row
    // canAccessOperationalRecord's own deleted_at IS NULL check can no longer
    // see — permanent removes the row outright, soft-delete sets deleted_at).
    // Only permanent delete actually removes project_assignments rows below.
    const deletionAudience = await captureOperationalAudience(client, "project", projectId, {
      projectAssignmentRemovedByDeletion: mode === "permanent",
    });

    // Check protected dependencies before permanent delete.
    if (mode === "permanent") {
      const { rows: spentRows } = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM activities WHERE project_id = $1 AND budget_spent > 0`,
        [projectId],
      );
      if (spentRows[0].cnt > 0) {
        await client.query("ROLLBACK");
        return c.json({
          error: "protected_records",
          message: "This Project contains protected historical records (posted financial expenditure) and cannot be permanently deleted.",
        }, 409);
      }

      const { rows: reportRows } = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM reports WHERE project_id = $1 AND status != 'draft'`,
        [projectId],
      );
      if (reportRows[0].cnt > 0) {
        await client.query("ROLLBACK");
        return c.json({
          error: "protected_records",
          message: "This Project contains protected historical records (finalised reports) and cannot be permanently deleted.",
        }, 409);
      }

      // Lock the exact assignment rows so a concurrent assignment revocation
      // must either commit before this cascade or wait until it removes the
      // assignment itself.
      await client.query(
        `SELECT project_id, user_id FROM project_assignments WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      );
    }

    // Write audit event BEFORE deletion — must survive permanent delete.
    await logAudit(client, {
      userId,
      action: mode === "permanent" ? "permanent_delete" : "soft_delete",
      module: "projects",
      entityId: projectId,
      oldValue: JSON.stringify({ code: project.code, title: project.title, status: project.status }),
      newValue: JSON.stringify({
        deletedBy: userId,
        deletedByName: user.name,
        deletedByRole: user.role,
        deletionMode: mode,
        reason: cleanReason,
        timestamp: now.toISOString(),
      }),
    });

    let canonicalAttachmentPaths: string[] = [];

    if (mode === "permanent") {
      // Delete eligible dependent records in dependency order (no blind cascade).
      await client.query(`DELETE FROM comments       WHERE entity_type = 'project' AND entity_id = $1`, [projectId]);
      await client.query(`DELETE FROM notifications  WHERE entity_type = 'project' AND entity_id = $1`, [projectId]);
      await client.query(`DELETE FROM project_localities       WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM project_free_localities  WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM project_assignments      WHERE project_id = $1`, [projectId]);
      await client.query(
        `DELETE FROM document_registry_entries dre
         USING project_documents pd
         WHERE dre.source_kind = 'project_document'
           AND dre.source_id = pd.id
           AND pd.project_id = $1`,
        [projectId],
      );
      await client.query(`DELETE FROM project_documents        WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM project_state_allocations WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM project_states           WHERE project_id = $1`, [projectId]);
      // Indicators must be deleted before outputs (FK dependency).
      await client.query(`DELETE FROM indicators  WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM activities  WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM outputs     WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM beneficiaries WHERE project_id = $1`, [projectId]);

      // RISK-005: referential + storage cleanup for linked Risks. Risks are
      // deleted FIRST (RETURNING id), and their application-managed children
      // (plan_activities.risk_id and risk comments) are purged AFTER.
      const riskResult = await client.query<{ id: number }>(
        `DELETE FROM risks WHERE project_id = $1 RETURNING id`,
        [projectId],
      );
      const riskIds = riskResult.rows.map((r) => r.id);
      if (riskIds.length > 0) {
        const canonicalResult = await client.query<{ object_path: string }>(
          `DELETE FROM attachments
           WHERE parent_type = 'risk' AND parent_id = ANY($1)
           RETURNING object_path`,
          [riskIds],
        );
        canonicalAttachmentPaths = canonicalResult.rows.map((row) => row.object_path);
        await client.query(
          `INSERT INTO attachment_upload_cleanup_jobs
             (operation_id, object_path, final_object_path)
           SELECT operation_id, object_path, final_object_path
           FROM attachment_upload_operations
           WHERE parent_type = 'risk' AND parent_id = ANY($1)
             AND status <> 'finalised'
           ON CONFLICT (operation_id) DO NOTHING`,
          [riskIds],
        );
        const pendingCanonicalResult = await client.query<{ object_path: string; final_object_path: string | null }>(
          `DELETE FROM attachment_upload_operations
           WHERE parent_type = 'risk' AND parent_id = ANY($1)
           RETURNING object_path, final_object_path`,
          [riskIds],
        );
        canonicalAttachmentPaths.push(...pendingCanonicalResult.rows.flatMap((row) =>
          [row.object_path, row.final_object_path].filter((path): path is string => Boolean(path)),
        ));
        // Null dangling plan-activity links — plans/activities themselves are
        // preserved semantically; only the foreign reference is cleared.
        await client.query(
          `UPDATE plan_activities SET risk_id = NULL WHERE risk_id = ANY($1)`,
          [riskIds],
        );
        // Purge risk comments (polymorphic; entity_type='risk') so old risk
        // IDs cannot be enumerated via the comments API after deletion.
        await client.query(
          `DELETE FROM comments WHERE entity_type = 'risk' AND entity_id = ANY($1)`,
          [riskIds],
        );
      }
      await client.query(`DELETE FROM reports      WHERE project_id = $1`, [projectId]);
      // Lock Plan parents before collecting both finalised and pending
      // canonical objects. This serialises a finalise operation with permanent
      // Project deletion so no promoted object loses its metadata owner.
      const plans = await client.query<{ id: number }>(
        `SELECT id FROM plans WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      );
      const planIds = plans.rows.map((row) => row.id);
      if (planIds.length > 0) {
        const planAttachmentResult = await client.query<{ object_path: string }>(
          `DELETE FROM attachments
           WHERE parent_type = 'plan' AND parent_id = ANY($1)
           RETURNING object_path`,
          [planIds],
        );
        await client.query(
          `INSERT INTO attachment_upload_cleanup_jobs
             (operation_id, object_path, final_object_path)
           SELECT operation_id, object_path, final_object_path
           FROM attachment_upload_operations
           WHERE parent_type = 'plan' AND parent_id = ANY($1)
             AND status <> 'finalised'
           ON CONFLICT (operation_id) DO NOTHING`,
          [planIds],
        );
        const pendingPlanResult = await client.query<{ object_path: string; final_object_path: string | null }>(
          `DELETE FROM attachment_upload_operations
           WHERE parent_type = 'plan' AND parent_id = ANY($1)
           RETURNING object_path, final_object_path`,
          [planIds],
        );
        canonicalAttachmentPaths.push(
          ...planAttachmentResult.rows.map((row) => row.object_path),
          ...pendingPlanResult.rows.flatMap((row) =>
            [row.object_path, row.final_object_path].filter((path): path is string => Boolean(path)),
          ),
        );
      }
      await client.query(`DELETE FROM plans        WHERE project_id = $1`, [projectId]);
      await client.query(`DELETE FROM approvals    WHERE entity_type = 'project' AND entity_id = $1`, [projectId]);
      // NOTE: audit_log rows are intentionally NOT deleted — they must survive permanent delete.

      // Delete the project row itself.
      await client.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    } else {
      // Soft delete: preserve all records; mark project as deleted.
      await client.query(
        `UPDATE projects
         SET deleted_at = $1, deleted_by = $2, deletion_reason = $3, deletion_mode = $4
         WHERE id = $5`,
        [now, userId, cleanReason, "soft", projectId],
      );
    }

    await client.query("COMMIT");

    for (const path of canonicalAttachmentPaths) {
      await deleteObjectSafely(c.env, path).catch((storageErr) => {
        console.error("[project-delete] Canonical attachment storage cleanup failed:", storageErr);
      });
    }

    await broadcastUpdate(c.env, {
      module: "projects", action: "deleted", entityId: projectId, actorId: user.id, actorName: user.name, deletionAudience,
    });
    return c.json({ deletionMode: mode, projectId, projectCode: project.code });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    close();
  }
});

// ── Donors ────────────────────────────────────────────────────────────────────
projectsRoutes.get("/donors", requirePerm("projects.view"), async (c) => {
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query(
      `SELECT id, name, abbreviation, country, contact_name AS "contactName",
              contact_email AS "contactEmail", created_at AS "createdAt"
       FROM donors ORDER BY name`,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

projectsRoutes.post("/donors", requirePerm("projects.create"), async (c) => {
  const { db, close } = openDb(c);
  try {
    const body = await c.req.json<{
      name?: string; abbreviation?: string; country?: string; contactName?: string; contactEmail?: string;
    }>();
    if (!body.name?.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    const donorValidation = validateDonorName(body.name);
    if (!donorValidation.ok) {
      return c.json({ error: donorValidation.error, field: "name", message: donorValidation.message }, 422);
    }
    const { rows } = await db.query(
      `INSERT INTO donors (name, abbreviation, country, contact_name, contact_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, abbreviation, country,
                 contact_name AS "contactName", contact_email AS "contactEmail",
                 created_at AS "createdAt"`,
      [body.name.trim(), body.abbreviation ?? null, body.country ?? null, body.contactName ?? null, body.contactEmail ?? null],
    );
    return c.json(rows[0], 201);
  } finally {
    close();
  }
});

// ── Administrative donor correction ────────────────────────────────────────────
// Corrects only a confirmed, unlinked placeholder donor on an already
// submitted/approved/active project. This deliberately does not use the
// general project PATCH route: that route can replace nested project data and
// is intentionally unavailable after submission. GET /projects/donor-integrity-scan
// (the read-only scan backing this) is registered earlier in the file, before
// GET /projects/:projectId — see that route's own comment for why.
projectsRoutes.post("/projects/:projectId/donor-correction", requirePerm("projects.donor.correct"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    const parsed = CorrectProjectDonorBody.safeParse(await c.req.json());
    if (!parsed.success || !parsed.data.reason.trim()) {
      return c.json({ error: "correction_reason_required" }, 400);
    }
    const projectId = Number(c.req.param("projectId"));
    if (!Number.isInteger(projectId) || projectId < 1) {
      return c.json({ error: "invalid_project_id" }, 400);
    }

    await client.query("BEGIN");
    const projectResult = await client.query<{
      id: number; code: string; status: string; donor: string | null; donor_id: number | null; donor_registry_name: string | null;
    }>(
      `SELECT p.id, p.code, p.status, p.donor, p.donor_id,
              d.name AS donor_registry_name
         FROM projects p
         LEFT JOIN donors d ON d.id = p.donor_id
        WHERE p.id = $1 AND p.deleted_at IS NULL
        FOR UPDATE OF p`,
      [projectId],
    );
    const project = projectResult.rows[0];
    if (!project) {
      await client.query("ROLLBACK");
      return c.json({ error: "project_not_found" }, 404);
    }
    if (!["submitted", "approved", "active"].includes(project.status)) {
      await client.query("ROLLBACK");
      return c.json({ error: "invalid_project_lifecycle", status: project.status }, 409);
    }
    if (!isConfirmedUnlinkedPlaceholderDonor({
      donor: project.donor,
      donorId: project.donor_id,
      donorRegistryName: project.donor_registry_name,
    })) {
      await client.query("ROLLBACK");
      return c.json({ error: "donor_not_confirmed_placeholder" }, 409);
    }

    const nextDonorId: number | null = parsed.data.donorId;
    let nextDonorName = "Unknown";
    if (nextDonorId !== null) {
      const donorResult = await client.query<{ id: number; name: string }>(
        `SELECT id, name FROM donors WHERE id = $1 FOR KEY SHARE`,
        [nextDonorId],
      );
      const donor = donorResult.rows[0];
      if (!donor) {
        await client.query("ROLLBACK");
        return c.json({ error: "invalid_donor_id" }, 422);
      }
      const donorValidation = validateDonorName(donor.name);
      if (!donorValidation.ok) {
        await client.query("ROLLBACK");
        return c.json({ error: "placeholder_donor", field: "donorId" }, 422);
      }
      nextDonorName = donor.name;
    }

    const reason = parsed.data.reason.trim();
    const oldValue = JSON.stringify({ donor: project.donor, donorId: project.donor_id, provenance: "unlinked_free_text" });
    const newValue = JSON.stringify({ donor: nextDonorName, donorId: nextDonorId, reason, correction: "administrative donor correction" });
    const updated = await client.query<{ id: number; code: string; status: string; donor: string; donor_id: number | null }>(
      `UPDATE projects
          SET donor = $1, donor_id = $2, updated_at = NOW()
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING id, code, status, donor, donor_id`,
      [nextDonorName, nextDonorId, projectId],
    );
    if (updated.rows.length !== 1) {
      await client.query("ROLLBACK");
      return c.json({ error: "project_changed" }, 409);
    }
    await logAudit(client, {
      userId: user.id,
      action: "donor_corrected",
      module: "projects",
      entityId: projectId,
      oldValue,
      newValue,
    });
    await client.query("COMMIT");

    const result = updated.rows[0];
    await broadcastUpdate(c.env, { module: "projects", action: "donor_corrected", entityId: projectId, actorId: user.id, actorName: user.name });
    return c.json({
      projectId: result.id,
      projectCode: result.code,
      status: result.status,
      donor: result.donor,
      donorId: result.donor_id,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    close();
  }
});

// ── Project merge ─────────────────────────────────────────────────────────────
// PRJ-007: Sector and State scope guards — TC and SPO must have access to the
// project before they can merge additional states/sectors/localities into it.
projectsRoutes.post("/projects/:projectId/merge", requirePerm("projects.update"), async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    const { stateIds = [], sectors = [], localities = [] } = await c.req.json<{
      stateIds?: number[]; sectors?: string[]; localities?: string[];
    }>();

    const { rows: [proj] } = await client.query<{ id: number; sector: string | null; sectors: string[] }>(
      `SELECT id, sector, sectors FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    if (!proj) return c.json({ error: "not_found" }, 404);

    // PRJ-BD-05: use effective sector set (union of primary + sectors[]).
    const effectiveSectorsForMerge = [...new Set([
      ...(proj.sector ? [proj.sector] : []),
      ...(proj.sectors ?? []),
    ])];
    const sectorGuardMerge = assertEffectiveSectorAllowedForProject(user, effectiveSectorsForMerge);
    if (!sectorGuardMerge.ok) return c.json(sectorGuardMerge.body, sectorGuardMerge.status as any);

    const stateGuardMerge = await assertStateAllowed(db, user, projectId);
    if (!stateGuardMerge.ok) return c.json(stateGuardMerge.body, stateGuardMerge.status as any);

    // A state-role user's record-level access to this project does not expand
    // their destination-State authority.
    const isStateScopedMergeCaller = user.role === "state_program_officer" || user.role === "state_office_manager";
    if (isStateScopedMergeCaller && stateIds.some((stateId) => Number(stateId) !== user.stateId)) {
      return c.json({ error: "state_forbidden" }, 403);
    }

    // project_states links are operational writes — a merge must never add an
    // inactive (or unknown) destination State. This happens before BEGIN, so
    // no supplied State can be inserted before all have been validated.
    for (const stateId of stateIds) {
      const activeState = await assertActiveState(db, Number(stateId));
      if (!activeState.ok) {
        return c.json({ error: activeState.error, message: "Projects can only be assigned to active States." }, 422);
      }
    }

    await client.query("BEGIN");

    for (const sid of stateIds) {
      await client.query(`INSERT INTO project_states (project_id, state_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [projectId, sid]);
    }

    if (sectors.length > 0) {
      const invalidMergeSecs = sectors.filter((s) => !VALID_SECTOR_SET.has(s));
      if (invalidMergeSecs.length > 0) {
        await client.query("ROLLBACK");
        return c.json({ error: "invalid_sector", field: "sectors", code: "invalid_sector", message: `Unrecognised sector(s): ${invalidMergeSecs.join(", ")}` }, 422);
      }
      const mergeSeenSectors = new Set<string>();
      const mergeDupSectors = sectors.filter((s) => {
        if (mergeSeenSectors.has(s)) return true;
        mergeSeenSectors.add(s);
        return false;
      });
      if (mergeDupSectors.length > 0) {
        await client.query("ROLLBACK");
        return c.json({ error: "duplicate_sector", field: "sectors", code: "duplicate_sector", message: `Duplicate sector(s): ${[...new Set(mergeDupSectors)].join(", ")}. Each sector must appear at most once.` }, 422);
      }
      const existing: string[] = proj.sectors ?? [];
      const merged = [...new Set([...existing, ...sectors])];
      await client.query(`UPDATE projects SET sectors = $1::jsonb WHERE id = $2`, [JSON.stringify(merged), projectId]);
    }

    for (const loc of localities) {
      await client.query(
        `INSERT INTO project_free_localities (project_id, name, display_order)
         SELECT $1, $2,
                COALESCE((SELECT MAX(display_order) FROM project_free_localities WHERE project_id = $1), 0) + 1
         WHERE NOT EXISTS (
           SELECT 1 FROM project_free_localities WHERE project_id = $1 AND LOWER(name) = LOWER($2)
         )`,
        [projectId, loc],
      );
    }

    await client.query("COMMIT");

    const { rows: [updated] } = await client.query(`${projectSummarySelect} WHERE p.id = $1`, [projectId]);

    await logAudit(db, { userId: user.id, action: "merge", module: "project", entityId: projectId, newValue: JSON.stringify({ stateIds, sectors, localities }) });
    await broadcastUpdate(c.env, { module: "projects", action: "merged", entityId: projectId, actorId: user.id, actorName: user.name });
    return c.json(updated);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    close();
  }
});

// ── Reporting coverage correction ─────────────────────────────────────────────
projectsRoutes.patch("/projects/:projectId/reporting-coverage", async (c) => {
  const user = c.get("currentUser");
  if (!user) return c.json({ error: "authentication_required" }, 401);
  if (!["executive_director", "program_manager", "super_admin"].includes(user.role)) {
    return c.json({ error: "reporting_coverage_management_required" }, 403);
  }
  const { pool, close } = openDb(c);
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const projectId = Number(c.req.param("projectId"));
    if (!Number.isInteger(projectId) || projectId < 1) return c.json({ error: "invalid_project_id" }, 400);
    await client.query("BEGIN");
    transactionOpen = true;
    const current = await client.query<{
      status: string; sector: string | null; sectors: string[];
      reportingStartDate: string; reportingEndDate: string;
    }>(
      `SELECT status, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors,
              reporting_start_date::text AS "reportingStartDate",
              reporting_end_date::text AS "reportingEndDate"
         FROM projects WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
      [projectId],
    );
    const project = current.rows[0];
    if (!project) return c.json({ error: "project_not_found" }, 404);
    if (project.status === "draft") return c.json({ error: "reporting_coverage_requires_non_draft_project" }, 409);
    const sectorGuard = assertEffectiveSectorAllowedForProject(user, [...new Set([...(project.sector ? [project.sector] : []), ...(project.sectors ?? [])])]);
    if (!sectorGuard.ok) return c.json(sectorGuard.body, sectorGuard.status as any);
    const isStateRole = ["state_program_officer", "state_office_manager"].includes(user.role);
    if (isStateRole) {
      const scope = await client.query(`SELECT 1 FROM project_states WHERE project_id=$1 AND state_id=$2 LIMIT 1`, [projectId, user.stateId]);
      if (!user.stateId || !scope.rows.length) return c.json({ error: "state_scope_forbidden" }, 403);
    }
    const raw = await c.req.json<Record<string, unknown>>();
    const coverage = resolveReportingCoverage(raw, "__missing__", "__missing__");
    if (
      !coverage ||
      raw.reportingStartDate === undefined ||
      raw.reportingEndDate === undefined ||
      typeof raw.expectedReportingStartDate !== "string" ||
      typeof raw.expectedReportingEndDate !== "string"
    ) {
      return c.json({ error: "invalid_reporting_coverage" }, 422);
    }
    if (
      raw.expectedReportingStartDate !== project.reportingStartDate ||
      raw.expectedReportingEndDate !== project.reportingEndDate
    ) {
      return c.json({ error: "reporting_coverage_conflict" }, 409);
    }
    await client.query(`UPDATE projects SET reporting_start_date=$1, reporting_end_date=$2, updated_at=NOW() WHERE id=$3`, [coverage.start, coverage.end, projectId]);
    await logAudit(client, {
      userId: user.id,
      action: "reporting_coverage_updated",
      module: "projects",
      entityId: projectId,
      oldValue: JSON.stringify({ reportingStartDate: project.reportingStartDate, reportingEndDate: project.reportingEndDate }),
      newValue: JSON.stringify({ reportingStartDate: coverage.start, reportingEndDate: coverage.end }),
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return c.json({ projectId, reportingStartDate: coverage.start, reportingEndDate: coverage.end });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    transactionOpen = false;
    throw error;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    close();
  }
});

// ── Project documents ─────────────────────────────────────────────────────────
projectsRoutes.get("/projects/:projectId/documents", async (c) => {
  const user = c.get("currentUser");
  const projectId = Number(c.req.param("projectId"));
  const { db, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    const rows = await getDocuments(db, projectId);
    return c.json(rows);
  } finally {
    close();
  }
});

projectsRoutes.post("/projects/:projectId/documents", requirePerm("documents.upload"), async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const { db, pool, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    // PRJ-BD-04: fully-atomic gate + insert for upload. SELECT … FOR UPDATE
    // locks the project row, preventing a concurrent freeze transition from
    // slipping a document into a project that becomes closed between the
    // status read and the INSERT. Parse the body first so invalid payloads
    // fail fast before acquiring a connection.
    const body = AddProjectDocumentBody.parse(await c.req.json());

    let uploadResult: { rows: Record<string, unknown>[] };
    const uploadTxClient = await pool.connect();
    try {
      await uploadTxClient.query("BEGIN");

      const { rows: projRows } = await uploadTxClient.query<{ status: string }>(
        `SELECT status FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [projectId],
      );
      if (!projRows.length) {
        await uploadTxClient.query("ROLLBACK");
        return c.json({ error: "project_not_found" }, 404);
      }

      const projectStatus = projRows[0].status;
      const uploadTxGate: "mutable" | "operational" | "frozen" =
        ["completed", "closed"].includes(projectStatus) ? "frozen"
        : ["approved", "active"].includes(projectStatus) ? "operational"
        : "mutable";

      if (uploadTxGate === "frozen") {
        await uploadTxClient.query("ROLLBACK");
        return c.json({
          error: "project_documents_frozen",
          message: "Project documents are locked because the project is closed.",
        }, 409);
      }
      // "mutable" and "operational" → upload permitted

      uploadResult = await uploadTxClient.query(
        `INSERT INTO project_documents
           (project_id, category, kind, file_name, content_type, size, object_path, uploaded_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, project_id AS "projectId", category, kind, file_name AS "fileName",
                   content_type AS "contentType", size, object_path AS "objectPath",
                   uploaded_at AS "uploadedAt"`,
        [
          projectId,
          body.category ?? "optional",
          body.kind,
          body.fileName,
          body.contentType,
          body.size,
          body.objectPath ?? "",
          user.id,
        ],
      );
      await uploadTxClient.query(
        `INSERT INTO document_registry_entries
          (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
         VALUES ('project_document', $1, 'Project Documents', 'internal', 'project', $2)
         ON CONFLICT (source_kind, source_id) DO NOTHING`,
        [uploadResult.rows[0].id, projectId],
      );

      await uploadTxClient.query("COMMIT");
    } catch (uploadTxErr) {
      await uploadTxClient.query("ROLLBACK").catch(() => {});
      throw uploadTxErr;
    } finally {
      uploadTxClient.release();
    }

    // Post-commit: audit (best-effort, outside TX).
    await logAudit(db, {
      userId: user.id,
      action: "document_upload",
      module: "projects",
      entityId: projectId,
      newValue: `${body.kind}: ${body.fileName}`,
    });
    // Dropped (deferred to the notifications-engine port): notifyEntityActors
    // ("document_uploaded" notice to project actors).
    await broadcastUpdate(c.env, { module: "projects", action: "document_created", entityId: projectId, actorId: user.id, actorName: user.name });
    return c.json(toPublicDocumentDto({ ...uploadResult.rows[0], uploadedByName: user.name }), 201);
  } finally {
    close();
  }
});

projectsRoutes.get("/projects/:projectId/documents/:documentId/download", requirePerm("documents.view"), async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const documentId = Number(c.req.param("documentId"));
  const { db, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);

    const { rows } = await db.query<{
      id: number; fileName: string; contentType: string; objectPath: string | null; availabilityStatus: string;
    }>(
      `SELECT id, file_name AS "fileName", content_type AS "contentType",
              object_path AS "objectPath", availability_status AS "availabilityStatus"
       FROM project_documents WHERE id = $1 AND project_id = $2`,
      [documentId, projectId],
    );
    if (!rows.length) return c.json({ error: "not_found" }, 404);
    const doc = rows[0];
    if (doc.availabilityStatus === "unavailable") {
      return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
    }
    if (!doc.objectPath) {
      return c.json({ error: "file_unavailable", message: "Historical file requires owner reconciliation." }, 410);
    }

    // Canonical object-storage documents proxy-stream directly. Never redirect
    // to a raw storage URL because that leaks an internal object identity.
    try {
      const rawPath = doc.objectPath;
      const normalizedPath = rawPath.startsWith("/objects/") ? rawPath : `/objects/${rawPath}`;
      const storageFile = await getObjectEntityFile(c.env, normalizedPath);
      const storageResponse = await downloadObject(c.env, storageFile);
      const headers = new Headers(storageResponse.headers);
      headers.set("Content-Type", storageResponse.headers.get("Content-Type") || doc.contentType || "application/octet-stream");
      headers.set("Content-Disposition", contentDispositionHeader(doc.fileName, "attachment"));
      return new Response(storageResponse.body, { headers });
    } catch (storageErr) {
      if (storageErr instanceof ObjectNotFoundError) return c.json({ error: "file_not_found" }, 404);
      throw storageErr;
    }
  } finally {
    close();
  }
});

projectsRoutes.delete("/projects/:projectId/documents/:documentId", requirePerm("documents.upload"), async (c) => {
  const user = c.get("currentUser")!;
  const projectId = Number(c.req.param("projectId"));
  const documentId = Number(c.req.param("documentId"));
  const { db, pool, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);

    // PRJ-BD-04: fully-atomic gate + delete + audit. SELECT projects FOR UPDATE
    // locks the project row so a concurrent status transition cannot sneak
    // between the gate check and the DELETE. Storage cleanup would run
    // post-commit (best-effort) — not needed here since project_documents
    // rows only ever carry object_path metadata, no separate storage delete
    // in the original either.
    let isDeleteOverride = false;
    let deleteOverrideReason: string | null = null;

    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");

      const { rows: projRows } = await txClient.query<{ status: string }>(
        `SELECT status FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [projectId],
      );
      if (!projRows.length) {
        await txClient.query("ROLLBACK");
        return c.json({ error: "project_not_found" }, 404);
      }

      const projectStatus = projRows[0].status;
      const txGate: "mutable" | "operational" | "frozen" =
        ["completed", "closed"].includes(projectStatus) ? "frozen"
        : ["approved", "active"].includes(projectStatus) ? "operational"
        : "mutable";

      if (txGate === "frozen") {
        await txClient.query("ROLLBACK");
        return c.json({
          error: "project_documents_frozen",
          message: "Project documents are locked because the project is closed.",
        }, 409);
      }

      if (txGate === "operational") {
        const isOverrideActor = hasFullOperationalAccess(user);
        if (!isOverrideActor) {
          await txClient.query("ROLLBACK");
          return c.json({
            error: "project_document_locked_after_approval",
            message: "This document cannot be deleted after project approval.",
          }, 409);
        }
        const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
        const rawReason = String(body?.overrideReason ?? "").trim();
        if (!rawReason) {
          await txClient.query("ROLLBACK");
          return c.json({
            error: "override_reason_required",
            message: "An override reason is required to delete a document from an approved project.",
          }, 400);
        }
        isDeleteOverride = true;
        deleteOverrideReason = rawReason;
      }

      // Delete and capture metadata atomically; no audit if the row is already gone.
      const { rows: deletedRows } = await txClient.query<{ file_name: string; kind: string; category: string }>(
        `WITH deleted AS (
           DELETE FROM project_documents WHERE id = $1 AND project_id = $2
           RETURNING id, file_name, kind, category
         ),
         registry_deleted AS (
           DELETE FROM document_registry_entries dre
           USING deleted
           WHERE dre.source_kind = 'project_document' AND dre.source_id = deleted.id
         )
         SELECT file_name, kind, category FROM deleted`,
        [documentId, projectId],
      );
      if (!deletedRows.length) {
        await txClient.query("ROLLBACK");
        return c.json({ error: "document_not_found" }, 404);
      }

      const deletedDoc = deletedRows[0];
      const docLabel = `${deletedDoc.file_name} (${deletedDoc.kind})`;

      await logAudit(txClient, {
        userId: user.id,
        action: isDeleteOverride ? "document_delete_override" : "document_delete",
        module: "projects",
        entityId: projectId,
        oldValue: docLabel,
        newValue: isDeleteOverride ? deleteOverrideReason : null,
        usedOverride: isDeleteOverride,
        overrideReason: isDeleteOverride ? deleteOverrideReason : null,
      });

      await txClient.query("COMMIT");
    } catch (txErr) {
      await txClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    await broadcastUpdate(c.env, { module: "projects", action: "document_deleted", entityId: projectId, actorId: user.id, actorName: user.name });
    return c.body(null, 204);
  } finally {
    close();
  }
});

// ── Project report KPIs (aggregated from project reports) ────────────────────
// PRJ-034 — canonical KPI source contract: beneficiary/budget aggregates come
// from the reports table's relational columns; activity completion/progress
// KPIs come from the reports.activities JSONB array (per-report snapshots),
// never JOINed against the relational activities table (that holds planned
// Results-Framework activities, not reported progress — joining it would
// double-count).
projectsRoutes.get("/projects/:projectId/report-kpis", async (c) => {
  const user = c.get("currentUser");
  const projectId = Number(c.req.param("projectId"));
  const { db, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);

    const { rows } = await db.query<{
      reportCount: string; beneficiariesReached: string; totalPlannedBudget: string; totalActualExpenditure: string; latestPeriod: string | null;
    }>(`
      SELECT
        COUNT(*)::text AS "reportCount",
        (COALESCE(SUM(r.beneficiaries_male),0) + COALESCE(SUM(r.beneficiaries_female),0) +
         COALESCE(SUM(r.beneficiaries_boys),0) + COALESCE(SUM(r.beneficiaries_girls),0))::text AS "beneficiariesReached",
        COALESCE(SUM(r.planned_budget), 0)::text AS "totalPlannedBudget",
        COALESCE(SUM(r.actual_expenditure), 0)::text AS "totalActualExpenditure",
        MAX(r.period) AS "latestPeriod"
      FROM reports r
      WHERE r.project_id = $1
        AND r.report_type = 'project'
        AND r.status NOT IN ('draft')
    `, [projectId]);

    const activitiesRes = await db.query<{ totalActivities: string; completedActivities: string; avgPercent: string }>(`
      SELECT
        COUNT(*)::text AS "totalActivities",
        COUNT(*) FILTER (WHERE act->>'status' = 'Completed')::text AS "completedActivities",
        COALESCE(AVG((act->>'percent')::numeric), 0)::text AS "avgPercent"
      FROM reports r,
           jsonb_array_elements(COALESCE(r.activities, '[]'::jsonb)) AS act
      WHERE r.project_id = $1
        AND r.report_type = 'project'
        AND r.status NOT IN ('draft')
    `, [projectId]);

    const budgetStatusRes = await db.query<{ onBudget: string; underBudget: string; overBudget: string }>(`
      SELECT
        COUNT(*) FILTER (
          WHERE (act->>'plannedBudget')::numeric > 0
            AND (act->>'actualExpenditure')::numeric = (act->>'plannedBudget')::numeric
        )::text AS "onBudget",
        COUNT(*) FILTER (
          WHERE (act->>'plannedBudget')::numeric > 0
            AND (act->>'actualExpenditure')::numeric < (act->>'plannedBudget')::numeric
        )::text AS "underBudget",
        COUNT(*) FILTER (
          WHERE (act->>'plannedBudget')::numeric > 0
            AND (act->>'actualExpenditure')::numeric > (act->>'plannedBudget')::numeric
        )::text AS "overBudget"
      FROM reports r,
           jsonb_array_elements(COALESCE(r.activities, '[]'::jsonb)) AS act
      WHERE r.project_id = $1
        AND r.report_type = 'project'
        AND r.status NOT IN ('draft')
        AND (act->>'plannedBudget') IS NOT NULL
    `, [projectId]);

    const row = rows[0];
    const actRow = activitiesRes.rows[0];
    const bsRow = budgetStatusRes.rows[0];
    const totalPlanned = Number(row.totalPlannedBudget);
    const totalSpent = Number(row.totalActualExpenditure);

    return c.json({
      reportCount: Number(row.reportCount),
      beneficiariesReached: Number(row.beneficiariesReached),
      totalPlannedBudget: totalPlanned,
      totalActualExpenditure: totalSpent,
      burnRatePct: totalPlanned > 0 ? Math.round((totalSpent / totalPlanned) * 100) : 0,
      totalActivities: Number(actRow.totalActivities),
      completedActivities: Number(actRow.completedActivities),
      activityCompletionPct: Number(actRow.totalActivities) > 0
        ? Math.round((Number(actRow.completedActivities) / Number(actRow.totalActivities)) * 100)
        : 0,
      avgActivityProgressPct: Math.round(Number(actRow.avgPercent)),
      latestPeriod: row.latestPeriod ?? null,
      activitiesOnBudget: Number(bsRow?.onBudget ?? 0),
      activitiesUnderBudget: Number(bsRow?.underBudget ?? 0),
      activitiesOverBudget: Number(bsRow?.overBudget ?? 0),
    });
  } finally {
    close();
  }
});

// ── Project activities ────────────────────────────────────────────────────────

// ── Scoped activities list — Activity Report selector ────────────────────────
// Returns activities the current user is authorised to report on. Optional
// ?projectId= narrows results to a specific project (a filter, not a security
// boundary — the WHERE clause still enforces role scoping).
projectsRoutes.get("/activities", async (c) => {
  const user = c.get("currentUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const { db, close } = openDb(c);
  try {
    const projectIdQuery = c.req.query("projectId");
    const projectId = projectIdQuery ? Number(projectIdQuery) : null;
    const role = user.role ?? "";

    // ── Explicit role allowlist (fail-closed) ────────────────────────────────
    const ORG_WIDE_ROLES = new Set(["super_admin", "executive_director", "program_manager", "senior_program_coordinator"]);
    const STATE_SCOPED_ROLES = new Set(["state_program_officer", "state_office_manager"]);
    const SECTOR_SCOPED_ROLES = new Set(["technical_coordinator", "hq_sector_coordinator", "hq_sector_officer"]);
    const ALL_KNOWN_ROLES = new Set([...ORG_WIDE_ROLES, ...STATE_SCOPED_ROLES, ...SECTOR_SCOPED_ROLES]);

    if (!ALL_KNOWN_ROLES.has(role)) {
      return c.json({ error: "role_not_authorised_for_activity_access" }, 403);
    }

    const params: unknown[] = [];
    const conditions: string[] = [];

    if (STATE_SCOPED_ROLES.has(role)) {
      const userStateId = user.stateId ?? null;
      if (userStateId === null) return c.json([]);
      params.push(userStateId);
      conditions.push(`(a.state_id = $${params.length} OR p.id IN (SELECT project_id FROM project_states WHERE state_id = $${params.length}))`);
    }

    // Technical Coordinator — sector-scoped ONLY (no state restriction).
    if (role === "technical_coordinator") {
      const tcSectors = user.sectors ?? [];
      if (tcSectors.length === 0) return c.json([]);
      params.push(tcSectors);
      conditions.push(
        `(p.sector = ANY($${params.length}::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors, '[]'::jsonb)) s WHERE s = ANY($${params.length}::text[])) OR (a.project_id IS NULL AND a.sector = ANY($${params.length}::text[])))`,
      );
    }

    // HQ sector roles — restricted to their assigned sector; standalone activities included.
    if (role === "hq_sector_coordinator" || role === "hq_sector_officer") {
      const userSector = user.sector ?? null;
      if (!userSector) return c.json([]);
      params.push(userSector);
      conditions.push(`(p.sector = $${params.length} OR (a.project_id IS NULL AND a.sector = $${params.length}))`);
    }

    // Optional project filter — narrows the list; does not widen the authorisation boundary.
    if (projectId && !Number.isNaN(projectId)) {
      params.push(projectId);
      conditions.push(`a.project_id = $${params.length}`);
    }

    // Optional locationType filter — org-wide users may filter by HQ or state.
    if (!STATE_SCOPED_ROLES.has(role)) {
      const ltFilter = c.req.query("locationType") ?? null;
      if (ltFilter === "hq") {
        conditions.push(`a.location_type = 'hq'`);
      } else if (ltFilter === "state") {
        conditions.push(`(a.location_type = 'state' OR (a.location_type IS NULL AND a.state_id IS NOT NULL))`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await db.query(
      `SELECT a.id, a.code, a.title, a.description, a.status,
              a.progress_pct::float            AS "progressPct",
              a.planned_start                  AS "plannedStart",
              a.planned_end                    AS "plannedEnd",
              a.output_id                      AS "outputId",
              o.title                          AS "outputTitle",
              a.indicator_id                   AS "indicatorId",
              COALESCE(a.location_type, CASE WHEN a.state_id IS NOT NULL THEN 'state' ELSE NULL END) AS "locationType",
              a.state_id                       AS "stateId",
              s.name                           AS "stateName",
              s.name_ar                        AS "stateNameAr",
              a.locality_name                  AS "localityName",
              a.project_id                     AS "projectId",
              p.title                          AS "projectTitle",
              p.code                           AS "projectCode",
              p.sector                         AS "sector",
              COALESCE(a.target::float, 0)     AS target,
              COALESCE(a.budget_planned::float, 0) AS "budgetPlanned",
              COALESCE(a.budget_spent::float, 0)   AS "budgetSpent"
       FROM activities a
       LEFT JOIN outputs o    ON o.id = a.output_id
       LEFT JOIN states  s    ON s.id = a.state_id
       LEFT JOIN projects p   ON p.id = a.project_id
       ${whereClause}
       ORDER BY a.code NULLS LAST, a.title
       LIMIT 200`,
      params,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

projectsRoutes.get("/projects/:projectId/activities", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    const { rows } = await db.query(
      `SELECT a.id, a.code, a.title, a.description, a.status, a.progress_pct AS "progressPct",
              a.planned_start AS "plannedStart", a.planned_end AS "plannedEnd",
              a.output_id AS "outputId", o.title AS "outputTitle",
              a.indicator_id AS "indicatorId",
              a.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
              a.locality_name AS "localityName",
              COALESCE(a.target::float, 0) AS target,
              a.budget_planned::float AS "budgetPlanned",
              a.budget_spent::float AS "budgetSpent"
       FROM activities a
       LEFT JOIN outputs o ON o.id = a.output_id
       LEFT JOIN states s ON s.id = a.state_id
       WHERE a.project_id = $1 ORDER BY a.code`,
      [projectId],
    );
    return c.json(rows);
  } finally {
    close();
  }
});

projectsRoutes.get("/projects/:projectId/indicators", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const user = c.get("currentUser");
  const { db, close } = openDb(c);
  try {
    const effectiveSectors = await getProjectEffectiveSectors(db, projectId);
    if (!effectiveSectors) return c.json({ error: "project not found" }, 404);
    const guard = assertEffectiveSectorAllowedForProject(user, effectiveSectors.all);
    if (!guard.ok) return c.json(guard.body, guard.status as any);
    const stateGuard = await assertStateAllowed(db, user, projectId);
    if (!stateGuard.ok) return c.json(stateGuard.body, stateGuard.status as any);
    const { rows } = await db.query(
      `SELECT id, code, title, unit, target::float AS target, achieved::float AS achieved,
              output_id AS "outputId", sector
       FROM indicators WHERE project_id = $1 ORDER BY code`,
      [projectId],
    );
    return c.json(rows);
  } finally {
    close();
  }
});

// ── Project budget ────────────────────────────────────────────────────────────
// PRJ-014: budget.view is the established read-only financial permission
// shared by every legitimate budget reader (PM, SPC, TC own-sector, ED, SOM
// own-state, SPO own-state, Viewer, Super Admin) — projects.update would
// exclude ED and SOM, who hold budget.view but not projects.update.
projectsRoutes.get("/projects/:projectId/budget", requirePerm("budget.view"), async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const proj = await db.query<{ total: number; sector: string | null; sectors: string[] }>(
      `SELECT budget_total::float AS total, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    if (proj.rows.length === 0) return c.json({ error: "project not found" }, 404);

    const effectiveSectorsForBudget = [...new Set([
      ...(proj.rows[0].sector ? [proj.rows[0].sector] : []),
      ...(proj.rows[0].sectors ?? []),
    ])];
    const sectorGuardBudget = assertEffectiveSectorAllowedForProject(user, effectiveSectorsForBudget);
    if (!sectorGuardBudget.ok) return c.json(sectorGuardBudget.body, sectorGuardBudget.status as any);

    const stateGuardBudget = await assertStateAllowed(db, user, projectId);
    if (!stateGuardBudget.ok) return c.json(stateGuardBudget.body, stateGuardBudget.status as any);

    const total = proj.rows[0].total;
    const outputs = await db.query<{ id: number; code: string; title: string }>(
      `SELECT id, code, title FROM outputs WHERE project_id = $1 ORDER BY code`,
      [projectId],
    );
    const activities = await db.query<{
      id: number; outputId: number | null; code: string; title: string;
      planned: number; spent: number; plannedStart: string | null; plannedEnd: string | null;
    }>(
      `SELECT id, output_id AS "outputId", code, title,
              budget_planned::float AS planned, budget_spent::float AS spent,
              planned_start AS "plannedStart", planned_end AS "plannedEnd"
       FROM activities WHERE project_id = $1 ORDER BY code`,
      [projectId],
    );
    const lines = outputs.rows.map((o) => {
      const acts = activities.rows.filter((a) => a.outputId === o.id);
      const planned = acts.reduce((s, a) => s + Number(a.planned), 0);
      const spent = acts.reduce((s, a) => s + Number(a.spent), 0);
      const remaining = planned - spent;
      // Null (not 0) when there's no valid planned amount to divide by —
      // a manufactured 0% would misread as "fully unspent".
      const burn = planned > 0 ? Math.round((spent / planned) * 100) : null;
      return {
        id: o.id,
        label: `${o.code} — ${o.title}`,
        level: "output",
        planned,
        spent,
        remaining,
        burnRatePct: burn,
        children: acts.map((a) => {
          const ap = Number(a.planned);
          const sp = Number(a.spent);
          return {
            id: a.id,
            label: `${a.code} — ${a.title}`,
            level: "activity",
            planned: ap,
            spent: sp,
            remaining: ap - sp,
            burnRatePct: ap > 0 ? Math.round((sp / ap) * 100) : null,
          };
        }),
      };
    });
    // Sum ALL activities, not just those grouped under an existing output —
    // output_id is nullable by design (standalone activities), and their
    // spend must still count toward the project total.
    const spent = activities.rows.reduce((s, a) => s + Number(a.spent), 0);
    const remaining = total - spent;
    const burnRatePct = total > 0 ? Math.round((spent / total) * 100) : null;
    // ── Monthly burn chart — deterministic, derived from activity date ranges ──
    // Distribute each activity's budget linearly across its planned_start →
    // planned_end window and accumulate per calendar month.
    const now = new Date();
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const monthLabel = monthStart.toLocaleString("en", { month: "short", year: "2-digit" });
      let cumulPlanned = 0;
      let cumulActual = 0;
      for (const a of activities.rows) {
        if (!a.plannedStart || !a.plannedEnd) continue;
        const actStart = new Date(a.plannedStart);
        const actEnd = new Date(a.plannedEnd);
        const durationMs = actEnd.getTime() - actStart.getTime();
        if (durationMs <= 0) continue;
        const cappedEnd = monthEnd < actEnd ? monthEnd : actEnd;
        const elapsedMs = Math.max(0, cappedEnd.getTime() - actStart.getTime());
        const frac = Math.min(1, elapsedMs / durationMs);
        cumulPlanned += frac * Number(a.planned);
        cumulActual += frac * Number(a.spent);
      }
      monthly.push({ month: monthLabel, planned: Math.round(cumulPlanned), actual: Math.round(cumulActual) });
    }
    const alerts: Array<{ level: string; message: string }> = [];
    if (burnRatePct !== null && burnRatePct > 80) alerts.push({ level: "high", message: `Burn rate at ${burnRatePct}% — review remaining activities` });
    for (const line of lines) {
      if (line.burnRatePct !== null && line.burnRatePct > 90) alerts.push({ level: "high", message: `${line.label} overspending (${line.burnRatePct}%)` });
      else if (line.burnRatePct !== null && line.burnRatePct < 20 && total > 0) alerts.push({ level: "medium", message: `${line.label} under-utilized (${line.burnRatePct}%)` });
    }
    return c.json({ projectId, total, spent, remaining, burnRatePct, lines, monthly, alerts });
  } finally {
    close();
  }
});

// ── State Allocations ─────────────────────────────────────────────────────────
// PRJ-005: budget.view covers all legitimate allocation readers, including ED
// and SOM who lack projects.update but must read allocation data in scope.
projectsRoutes.get("/projects/:projectId/state-allocations", requirePerm("budget.view"), async (c) => {
  const projectId = Number(c.req.param("projectId"));
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const scopeSectorAlloc = await getProjectEffectiveSectors(db, projectId);
    if (!scopeSectorAlloc) return c.json({ error: "project not found" }, 404);
    const sectorGuardAllocGet = assertEffectiveSectorAllowedForProject(user, scopeSectorAlloc.all);
    if (!sectorGuardAllocGet.ok) return c.json(sectorGuardAllocGet.body, sectorGuardAllocGet.status as any);

    const stateGuardAllocGet = await assertStateAllowed(db, user, projectId);
    if (!stateGuardAllocGet.ok) return c.json(stateGuardAllocGet.body, stateGuardAllocGet.status as any);

    // Row-level filter: State roles see only their own State's allocation row.
    const isStateRole = user.role === "state_program_officer" || user.role === "state_office_manager";
    const stateIdFilter = isStateRole ? (user.stateId ?? null) : null;
    const params: unknown[] = [projectId];
    let stateClause = "";
    if (stateIdFilter !== null) {
      params.push(stateIdFilter);
      stateClause = ` AND psa.state_id = $${params.length}`;
    }
    const { rows } = await db.query(
      `SELECT psa.id, psa.project_id AS "projectId", psa.state_id AS "stateId",
              s.name AS "stateName", s.name_ar AS "stateNameAr",
              COALESCE(psa.budget_allocation::float, 0) AS "budgetAllocation",
              COALESCE(psa.beneficiary_target, 0) AS "beneficiaryTarget",
              COALESCE(psa.beneficiary_male, 0) AS "beneficiaryMale",
              COALESCE(psa.beneficiary_female, 0) AS "beneficiaryFemale",
              COALESCE(psa.beneficiary_boys, 0) AS "beneficiaryBoys",
              COALESCE(psa.beneficiary_girls, 0) AS "beneficiaryGirls",
              COALESCE(psa.activity_target, 0) AS "activityTarget",
              COALESCE(psa.indicator_target, 0) AS "indicatorTarget",
              psa.state_lead AS "stateLead",
              COALESCE(psa.state_team, '[]'::jsonb) AS "stateTeam",
              psa.notes,
              psa.created_at AS "createdAt",
              psa.updated_at AS "updatedAt"
       FROM project_state_allocations psa
       JOIN states s ON s.id = psa.state_id
       WHERE psa.project_id = $1${stateClause}
       ORDER BY s.name`,
      params,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

projectsRoutes.post("/projects/:projectId/state-allocations", requirePerm("projects.update"), async (c) => {
  const user = c.get("currentUser")!;
  const { allocations } = UpsertProjectStateAllocationsBody.parse(await c.req.json());
  const projectId = Number(c.req.param("projectId"));
  const { db, pool, close } = openDb(c);
  const client = await pool.connect();
  try {
    // Sector and state scope guards (mirrors other project mutation endpoints).
    const scopeSector = await getProjectEffectiveSectors(db, projectId);
    if (!scopeSector) return c.json({ error: "project not found" }, 404);
    const sectorGuardAlloc = assertEffectiveSectorAllowedForProject(user, scopeSector.all);
    if (!sectorGuardAlloc.ok) return c.json(sectorGuardAlloc.body, sectorGuardAlloc.status as any);
    const stateGuardAlloc = await assertStateAllowed(db, user, projectId);
    if (!stateGuardAlloc.ok) return c.json(stateGuardAlloc.body, stateGuardAlloc.status as any);

    // PRJ-033: every supplied stateId must be linked to this project via
    // project_states. Full Operational Access (PM/Super Admin) does NOT
    // bypass this — a PM cannot allocate to a state not linked to the project.
    if (allocations && allocations.length > 0) {
      const suppliedStateIds = allocations.map((a) => a.stateId);
      const { rows: linkedStateRows } = await db.query<{ state_id: number }>(
        `SELECT state_id FROM project_states WHERE project_id = $1 AND state_id = ANY($2::int[])`,
        [projectId, suppliedStateIds],
      );
      const linkedStateIdSet = new Set(linkedStateRows.map((r) => r.state_id));
      const unlinked = suppliedStateIds.find((sid) => !linkedStateIdSet.has(sid));
      if (unlinked !== undefined) {
        return c.json({ error: "project_state_not_linked", message: "The specified state is not linked to this project." }, 422);
      }
      // A pre-existing inactive project_state relationship remains readable
      // for history, but this replace-all allocation write is new financial
      // work and must not add or refresh funds against an inactive State.
      for (const stateId of suppliedStateIds) {
        const activeState = await assertActiveState(db, Number(stateId));
        if (!activeState.ok) {
          return c.json({ error: activeState.error, message: "State allocations can only be created for active States." }, 422);
        }
      }
    }

    for (const alloc of allocations ?? []) {
      if ((alloc.budgetAllocation ?? 0) < 0) {
        return c.json({ error: "invalid_allocation", message: "Budget allocation cannot be negative." }, 422);
      }
    }

    const allocTotal = (allocations ?? []).reduce((s, a) => s + (a.budgetAllocation ?? 0), 0);

    await client.query("BEGIN");
    // BUD-BD-01: read the project budget INSIDE the transaction under a row
    // lock so a concurrent budget PATCH or allocation replace cannot race
    // past the cap check.
    const { rows: projBudgetRows } = await client.query<{ budget: number }>(
      `SELECT COALESCE(budget_total::float, 0) AS budget FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [projectId],
    );
    if (!projBudgetRows.length) {
      await client.query("ROLLBACK");
      return c.json({ error: "project not found" }, 404);
    }
    const projectBudget = projBudgetRows[0].budget;
    // Over-allocation guard: unconditional — applies when budget_total = 0
    // too, and actor-independent (PM/SA cannot bypass).
    if (allocTotal > projectBudget) {
      await client.query("ROLLBACK");
      return c.json({
        error: "over_allocation",
        message: `Total state allocations (${allocTotal.toFixed(2)}) would exceed the project budget (${projectBudget.toFixed(2)}).`,
      }, 422);
    }
    await client.query(`DELETE FROM project_state_allocations WHERE project_id = $1`, [projectId]);
    for (const alloc of allocations ?? []) {
      await client.query(
        `INSERT INTO project_state_allocations
           (project_id, state_id, budget_allocation, beneficiary_target,
            beneficiary_male, beneficiary_female, beneficiary_boys, beneficiary_girls,
            activity_target, indicator_target, state_lead, state_team, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
        [
          projectId,
          alloc.stateId,
          alloc.budgetAllocation ?? 0,
          alloc.beneficiaryTarget ?? 0,
          alloc.beneficiaryMale ?? 0,
          alloc.beneficiaryFemale ?? 0,
          alloc.beneficiaryBoys ?? 0,
          alloc.beneficiaryGirls ?? 0,
          alloc.activityTarget ?? 0,
          alloc.indicatorTarget ?? 0,
          alloc.stateLead ?? null,
          JSON.stringify(alloc.stateTeam ?? []),
          alloc.notes ?? null,
        ],
      );
    }
    await client.query("COMMIT");

    // BUD audit: state allocation replacement is a financial mutation and must be traceable.
    await logAudit(db, {
      userId: user.id,
      action: "state_allocations_replace",
      module: "projects",
      entityId: projectId,
      newValue: JSON.stringify((allocations ?? []).map((a) => ({ stateId: a.stateId, budgetAllocation: a.budgetAllocation ?? null }))),
    });
    await broadcastUpdate(c.env, { module: "projects", action: "state_allocations_updated", entityId: projectId, actorId: user.id, actorName: user.name });

    // Return allocations scoped to the requesting state role (same semantics as GET).
    const isStateRolePost = user.role === "state_program_officer" || user.role === "state_office_manager";
    const stateIdFilterPost = isStateRolePost ? (user.stateId ?? null) : null;
    const postParams: unknown[] = [projectId];
    let postStateClause = "";
    if (stateIdFilterPost !== null) {
      postParams.push(stateIdFilterPost);
      postStateClause = ` AND psa.state_id = $${postParams.length}`;
    }

    const { rows } = await client.query(
      `SELECT psa.id, psa.project_id AS "projectId", psa.state_id AS "stateId",
              s.name AS "stateName", s.name_ar AS "stateNameAr",
              COALESCE(psa.budget_allocation::float, 0) AS "budgetAllocation",
              COALESCE(psa.beneficiary_target, 0) AS "beneficiaryTarget",
              COALESCE(psa.beneficiary_male, 0) AS "beneficiaryMale",
              COALESCE(psa.beneficiary_female, 0) AS "beneficiaryFemale",
              COALESCE(psa.beneficiary_boys, 0) AS "beneficiaryBoys",
              COALESCE(psa.beneficiary_girls, 0) AS "beneficiaryGirls",
              COALESCE(psa.activity_target, 0) AS "activityTarget",
              COALESCE(psa.indicator_target, 0) AS "indicatorTarget",
              psa.state_lead AS "stateLead",
              COALESCE(psa.state_team, '[]'::jsonb) AS "stateTeam",
              psa.notes,
              psa.created_at AS "createdAt",
              psa.updated_at AS "updatedAt"
       FROM project_state_allocations psa
       JOIN states s ON s.id = psa.state_id
       WHERE psa.project_id = $1${postStateClause}
       ORDER BY s.name`,
      postParams,
    );
    return c.json(rows);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    close();
  }
});
