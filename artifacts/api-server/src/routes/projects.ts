import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import {
  CreateProjectBody,
  TransitionProjectBody,
  AddProjectDocumentBody,
  UpsertProjectStateAllocationsBody,
  CorrectProjectDonorBody,
} from "@workspace/api-zod";
import { logAudit, tcSectorRestriction, assertStateAllowed, requirePerm, permissionsFor, hasPerm } from "../middlewares/currentUser";
import { getProjectDeletionMode, validateDeletionReason } from "../lib/project-deletion";
import { hasFullOperationalAccess } from "../lib/accessControl";
import { VALID_SECTOR_SET, ASSISTANCE_MODALITY_SET, validateSubSectorsMulti } from "../lib/sectors";
import { unresolvedRequiredCorrections } from "./comments";
import { notifyEntityActors, notifyEntityActorsDeduped, notifyNextApprover, createNotification, createNotificationDeduped } from "../lib/notifications";
import { contentDispositionHeader } from "../lib/contentDisposition";
import { realtime } from "../lib/realtime";
import { SCHEDULED_FREQUENCIES, type ScheduledFrequency } from "../lib/reportConstants";
import { deleteStorageObjectSafely } from "../lib/objectStorage";
import { verifyUploadToken } from "../lib/uploadToken";
import { assertActiveState } from "../lib/state-master";
import {
  isConfirmedUnlinkedPlaceholderDonor,
  scanFocusedProjectDonors,
  validateDonorName,
} from "../lib/projectDataIntegrity";
import { isExactDevelopmentTestRetirementTarget } from "../lib/developmentTestRetirement";

/**
 * A State-scoped project write must remain wholly within the caller's assigned
 * State. This intentionally applies independently of record-level access:
 * being assigned to an existing project must never permit an SPO/SOM to add a
 * second State or HQ operations while editing its draft.
 */
function violatesStateScopedProjectWrite(
  req: Request,
  body: {
    stateIds?: number[];
    stateAllocations?: Array<{ stateId: number }>;
    outputs?: Array<{ activities?: Array<{ stateId?: number | null }> }>;
  },
  hasHqOperations: boolean,
): boolean {
  const user = req.currentUser;
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

// Returns the project's primary sector (for TC guards). Undefined = not found.

// NOTE: Schema additions and data migration for sector unification are handled
// by the tracked migration runner (src/lib/run-migrations.ts + migrations/002_sector_unification.sql).
// That migration runs before the server accepts traffic in index.ts.

async function getProjectSector(projectId: number): Promise<string | null | undefined> {
  const r = await pool.query<{ sector: string | null }>(
    `SELECT sector FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId],
  );
  if (r.rows.length === 0) return undefined;
  return r.rows[0].sector;
}

function validProjectDocumentDescriptor(
  document: { objectPath?: string; uploadToken?: string; fileName: string; contentType: string; size: number },
  userId: number,
): boolean {
  if (!document.objectPath) return true;
  try {
    const descriptor = verifyUploadToken(document.uploadToken ?? "");
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

/**
 * Loads the effective sector set for a Project: union of primary sector
 * (if non-blank) and all canonical values in the sectors[] JSONB column.
 * Returns undefined when the project does not exist or is deleted.
 */
async function getProjectEffectiveSectors(
  projectId: number,
): Promise<{ primary: string | null; all: string[] } | undefined> {
  const r = await pool.query<{ sector: string | null; sectors: string[] }>(
    `SELECT sector, COALESCE(sectors, '[]'::jsonb)::jsonb AS sectors
     FROM projects
     WHERE id = $1 AND deleted_at IS NULL`,
    [projectId],
  );
  if (r.rows.length === 0) return undefined;
  const primary = r.rows[0].sector ?? null;
  const secondary: string[] = Array.isArray(r.rows[0].sectors) ? r.rows[0].sectors : [];
  // Deduplicated union of primary + sectors[]
  const all = [...new Set([...(primary ? [primary] : []), ...secondary])];
  return { primary, all };
}

/**
 * Returns the lifecycle gate classification for a given Project status.
 * Returns undefined when the project does not exist or is deleted.
 */
async function getProjectDocGate(
  projectId: number,
): Promise<"mutable" | "operational" | "frozen" | undefined> {
  const r = await pool.query<{ status: string }>(
    `SELECT status FROM projects WHERE id = $1 AND deleted_at IS NULL`,
    [projectId],
  );
  if (r.rows.length === 0) return undefined;
  const status = r.rows[0].status;
  if (["completed", "closed"].includes(status)) return "frozen";
  if (["approved", "active"].includes(status)) return "operational";
  // draft, submitted, state_reviewed, technically_approved, coordination_approved, rejected
  return "mutable";
}

/**
 * Checks whether the current actor (TC) is in scope for a given Project's
 * effective sector set. Non-TC actors always pass (null restriction = org-wide).
 * TC with no assigned sectors → fail closed.
 * Project with no effective sectors → fail closed for TC.
 */
function assertEffectiveSectorAllowedForProject(
  req: Request,
  effectiveSectors: string[],
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(req);
  if (!restriction) return { ok: true };           // non-TC: pass
  if (restriction.length === 0) return { ok: false, status: 403, body: { error: "sector_forbidden" } }; // TC no sectors
  if (effectiveSectors.length === 0) return { ok: false, status: 403, body: { error: "sector_forbidden" } }; // project no sectors
  const allowed = effectiveSectors.some(s => restriction.includes(s));
  return allowed ? { ok: true } : { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

const router: IRouter = Router();

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

// ── Donors ────────────────────────────────────────────────────────────────────

// PRJ-036: donor reference data requires an explicit project-domain read permission.
router.get("/donors", requirePerm("projects.view"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, abbreviation, country, contact_name AS "contactName",
              contact_email AS "contactEmail", created_at AS "createdAt"
       FROM donors ORDER BY name`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/donors", requirePerm("projects.create"), async (req, res, next) => {
  try {
    const { name, abbreviation, country, contactName, contactEmail } = req.body as {
      name: string;
      abbreviation?: string;
      country?: string;
      contactName?: string;
      contactEmail?: string;
    };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const donorValidation = validateDonorName(name);
    if (!donorValidation.ok) {
      res.status(422).json({
        error: donorValidation.error,
        field: "name",
        message: donorValidation.message,
      });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO donors (name, abbreviation, country, contact_name, contact_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, abbreviation, country,
                 contact_name AS "contactName", contact_email AS "contactEmail",
                 created_at AS "createdAt"`,
      [name.trim(), abbreviation ?? null, country ?? null, contactName ?? null, contactEmail ?? null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── Administrative donor correction ────────────────────────────────────────────

/**
 * Corrects only a confirmed, unlinked placeholder donor on an already
 * submitted/approved/active project. This deliberately does not use the
 * general project PATCH route: that route can replace nested project data and
 * is intentionally unavailable after submission.
 */
router.get("/projects/donor-integrity-scan", requirePerm("projects.donor.correct"), async (_req, res, next): Promise<void> => {
  try {
    const scan = await scanFocusedProjectDonors();
    res.json(scan);
  } catch (err) {
    next(err);
  }
});

/**
 * Retires the reviewed historical development fixture without invoking the
 * normal pre-approval permanent-delete policy. This is deliberately not a
 * general cleanup endpoint: it is exact-identity allowlisted and unavailable
 * unless the API is running in development mode.
 */
router.post("/projects/:projectId/development-test-retirement", requirePerm("projects.delete"), async (req, res, next): Promise<void> => {
  if (process.env.NODE_ENV !== "development") {
    res.status(404).json({ error: "development_only" });
    return;
  }
  const projectId = Number(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId);
  if (!Number.isInteger(projectId) || projectId < 1) {
    res.status(400).json({ error: "invalid_project_id" });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5) {
    res.status(400).json({ error: "retirement_reason_required" });
    return;
  }
  const confirmationCode = typeof req.body?.confirmationCode === "string" ? req.body.confirmationCode.trim() : "";
  if (confirmationCode !== "CAFA-MPLQLM3M") {
    res.status(400).json({ error: "retirement_confirmation_required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const projectResult = await client.query<{
      id: number;
      code: string;
      title: string;
      status: string;
      donor: string | null;
      donor_id: number | null;
      deleted_at: Date | null;
    }>(
      `SELECT id, code, title, status, donor, donor_id, deleted_at
         FROM projects
        WHERE id = $1
        FOR UPDATE`,
      [projectId],
    );
    const project = projectResult.rows[0];
    if (!project || project.deleted_at !== null) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    if (!isExactDevelopmentTestRetirementTarget(project)) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "development_fixture_identity_mismatch" });
      return;
    }
    if (project.status !== "submitted") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "development_fixture_lifecycle_mismatch", status: project.status });
      return;
    }
    const deletionAudience = await realtime.captureOperationalAudience?.("project", project.id, client);

    const now = new Date();
    await client.query(
      `INSERT INTO audit_log
        (user_id, action, module, entity_id, old_value, new_value)
       VALUES ($1, 'development_test_retired', 'projects', $2, $3, $4)`,
      [
        req.currentUser!.id,
        project.id,
        JSON.stringify({
          id: project.id,
          code: project.code,
          title: project.title,
          status: project.status,
          donor: project.donor,
          donorId: project.donor_id,
        }),
        JSON.stringify({
          retirement: "development test-data cleanup",
          deletionMode: "soft",
          deletedBy: req.currentUser!.id,
          deletedByName: req.currentUser!.name,
          reason,
          timestamp: now.toISOString(),
        }),
      ],
    );
    await client.query(
      `UPDATE projects
          SET deleted_at = $1, deleted_by = $2, deletion_reason = $3, deletion_mode = 'soft'
        WHERE id = $4 AND deleted_at IS NULL`,
      [now, req.currentUser!.id, reason, project.id],
    );
    await client.query("COMMIT");
    realtime.broadcastUpdate({
      module: "projects",
      action: "deleted",
      entityId: project.id,
      actorId: req.currentUser!.id,
      actorName: req.currentUser!.name,
      deletionAudience,
    });
    res.json({
      projectId: project.id,
      projectCode: project.code,
      retirement: "development test-data cleanup",
      deletionMode: "soft",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    next(err);
  } finally {
    client.release();
  }
});

router.post("/projects/:projectId/donor-correction", requirePerm("projects.donor.correct"), async (req, res, next): Promise<void> => {
  const client = await pool.connect();
  try {
    const parsed = CorrectProjectDonorBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.reason.trim()) {
      res.status(400).json({ error: "correction_reason_required" });
      return;
    }
    const projectId = Number(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId);
    if (!Number.isInteger(projectId) || projectId < 1) {
      res.status(400).json({ error: "invalid_project_id" });
      return;
    }

    await client.query("BEGIN");
    const projectResult = await client.query<{
      id: number;
      code: string;
      status: string;
      donor: string | null;
      donor_id: number | null;
      donor_registry_name: string | null;
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
      res.status(404).json({ error: "project_not_found" });
      return;
    }
    if (!["submitted", "approved", "active"].includes(project.status)) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "invalid_project_lifecycle", status: project.status });
      return;
    }
    if (!isConfirmedUnlinkedPlaceholderDonor({
      donor: project.donor,
      donorId: project.donor_id,
      donorRegistryName: project.donor_registry_name,
    })) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "donor_not_confirmed_placeholder" });
      return;
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
        res.status(422).json({ error: "invalid_donor_id" });
        return;
      }
      const donorValidation = validateDonorName(donor.name);
      if (!donorValidation.ok) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "placeholder_donor", field: "donorId" });
        return;
      }
      nextDonorName = donor.name;
    }

    const reason = parsed.data.reason.trim();
    const oldValue = JSON.stringify({
      donor: project.donor,
      donorId: project.donor_id,
      provenance: "unlinked_free_text",
    });
    const newValue = JSON.stringify({
      donor: nextDonorName,
      donorId: nextDonorId,
      reason,
      correction: "administrative donor correction",
    });
    const updated = await client.query<{
      id: number;
      code: string;
      status: string;
      donor: string;
      donor_id: number | null;
    }>(
      `UPDATE projects
          SET donor = $1, donor_id = $2, updated_at = NOW()
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING id, code, status, donor, donor_id`,
      [nextDonorName, nextDonorId, projectId],
    );
    if (updated.rows.length !== 1) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "project_changed" });
      return;
    }
    await client.query(
      `INSERT INTO audit_log
        (user_id, action, module, entity_id, old_value, new_value)
       VALUES ($1, 'donor_corrected', 'projects', $2, $3, $4)`,
      [req.currentUser!.id, projectId, oldValue, newValue],
    );
    await client.query("COMMIT");

    const result = updated.rows[0];
    realtime.broadcastUpdate({
      module: "projects",
      action: "donor_corrected",
      entityId: projectId,
      actorId: req.currentUser!.id,
      actorName: req.currentUser!.name,
    });
    res.json({
      projectId: result.id,
      projectCode: result.code,
      status: result.status,
      donor: result.donor,
      donorId: result.donor_id,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    next(err);
  } finally {
    client.release();
  }
});

// ── Project list query helpers ────────────────────────────────────────────────

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

async function getAssignments(projectId: number) {
  const { rows } = await pool.query(
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
 * PRJ-009 — Public document DTO allow-list.
 * The public API response for a project document contains ONLY these fields.
 * Internal storage details (objectPath, bucket names, raw
 * provider keys) must never leave the server.
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

async function getDocuments(projectId: number) {
  const { rows } = await pool.query(
    `SELECT pd.id, pd.project_id AS "projectId", pd.category, pd.kind,
            pd.file_name AS "fileName",
            pd.content_type AS "contentType", pd.size,
            u.name AS "uploadedByName", pd.uploaded_at AS "uploadedAt",
            pd.availability_status AS "availabilityStatus"
     FROM project_documents pd LEFT JOIN users u ON u.id = pd.uploaded_by_id
     WHERE pd.project_id = $1 ORDER BY pd.category, pd.uploaded_at DESC`,
    [projectId],
  );
  // PRJ-009: every caller (documents list, project detail, enrichProject)
  // returns these rows to clients — sanitise at the source.
  return rows.map(toPublicDocumentDto);
}

async function getLocalities(projectId: number) {
  const { rows } = await pool.query(
    `SELECT id, name, display_order AS "displayOrder"
     FROM project_free_localities
     WHERE project_id = $1
     ORDER BY display_order, id`,
    [projectId],
  );
  return rows;
}

async function enrichProject(row: Record<string, unknown>, createdByName: string | null) {
  const id = Number(row.id);
  const [assignments, documents, localities] = await Promise.all([
    getAssignments(id),
    getDocuments(id),
    getLocalities(id),
  ]);
  return { ...row, createdByName, assignments, documents, localities };
}

/**
 * Fire budget-threshold notifications for a project.
 * Called (fire-and-forget via `void`) after every project transition.
 * Uses a 24-hour dedup window so a single project does not spam users.
 */
async function checkAndFireBudgetAlert(projectId: number): Promise<void> {
  try {
    const r = await pool.query<{ budget: number; spent: number; title: string; code: string }>(
      `SELECT p.budget_total::float AS budget,
              COALESCE(SUM(a.budget_spent), 0)::float AS spent,
              p.title, p.code
       FROM projects p
       LEFT JOIN activities a ON a.project_id = p.id
       WHERE p.id = $1
       GROUP BY p.id, p.budget_total, p.title, p.code`,
      [projectId],
    );
    if (!r.rows[0] || r.rows[0].budget <= 0) return;
    const { budget, spent, title, code } = r.rows[0];
    const burnRatePct = Math.round((spent / budget) * 100);
    if (burnRatePct < 80) return;

    const kind    = burnRatePct >= 100 ? "budget_exceeded" : "budget_high";
    const label   = burnRatePct >= 100 ? "EXCEEDED (≥100%)" : `HIGH (${burnRatePct}%)`;
    const message = `Budget alert — ${code}: ${title} burn rate is ${label}`;
    const link    = `/projects/${projectId}`;
    // A budget alert is one event per threshold and calendar day. This replaces
    // the former generic entity/kind time window with explicit event inputs.
    const dedupeKey = `budget-alert:${projectId}:${kind}:${burnRatePct}:${new Date().toISOString().slice(0, 10)}`;

    // Notify senior management + project team members
    const { rows: mgmtUsers } = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role IN ('program_manager','senior_program_coordinator') AND status = 'active'`,
    );
    const { rows: assigned } = await pool.query<{ user_id: number }>(
      `SELECT DISTINCT user_id FROM project_assignments WHERE project_id = $1`,
      [projectId],
    );
    const recipients = new Set<number>([
      ...mgmtUsers.map(u => u.id),
      ...assigned.map(a => a.user_id),
    ]);
    for (const userId of recipients) {
      await createNotificationDeduped({
        userId,
        kind,
        entityType: "project",
        entityId: projectId,
        message,
        link,
        dedupeKey,
      });
    }
  } catch {
    // Non-critical — budget alerts must not block the main transition response
  }
}

// ── Project list ──────────────────────────────────────────────────────────────

router.get("/projects", async (req, res, next) => {
  try {
    // Always exclude soft-deleted projects from normal operational lists.
    const filters: string[] = ["p.deleted_at IS NULL"];
    const params: unknown[] = [];
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    const effectiveStateId = isStateRole
      ? (req.currentUser?.stateId ?? null)
      : (req.query.stateId ? Number(req.query.stateId) : null);
    // PRJ-028: state roles with no assigned State fail closed (no visibility).
    if (isStateRole && effectiveStateId === null) {
      res.json([]);
      return;
    }
    if (effectiveStateId !== null) {
      params.push(effectiveStateId);
      const stateParamIdx = params.length;
      if (isStateRole && req.currentUser?.id != null) {
        // PRJ-028: list/detail scope parity — a state-role user directly assigned via
        // project_assignments (user-specific, user_id column) also sees the project in
        // the list. The user_id predicate is naturally scoped to the current user, so
        // same-State peers do not inherit visibility through another user's assignment.
        params.push(req.currentUser.id);
        filters.push(
          `(EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${stateParamIdx})` +
          ` OR EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = p.id AND pa.user_id = $${params.length}))`,
        );
      } else {
        filters.push(`EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${stateParamIdx})`);
      }
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`p.status = $${params.length}`);
    }
    if (req.query.sector) {
      params.push(String(req.query.sector));
      filters.push(`(p.sector = $${params.length} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors,'[]'::jsonb)) s WHERE s = $${params.length}))`);
    }
    if (req.query.managementLevel) {
      params.push(String(req.query.managementLevel));
      filters.push(`p.management_level = $${params.length}`);
    }
    // Full-text search across title, code, donor name, agreement number
    if (req.query.q && String(req.query.q).trim()) {
      params.push(`%${String(req.query.q).trim()}%`);
      const n = params.length;
      filters.push(`(p.title ILIKE $${n} OR p.code ILIKE $${n} OR p.donor ILIKE $${n} OR p.agreement_number ILIKE $${n})`);
    }
    // Donor text filter (exact-ish — ILIKE for partial match)
    if (req.query.donor && String(req.query.donor).trim()) {
      params.push(`%${String(req.query.donor).trim()}%`);
      filters.push(`p.donor ILIKE $${params.length}`);
    }
    // Donor ID filter (for projects linked to a reusable Donor record)
    if (req.query.donorId) {
      const did = Number(req.query.donorId);
      if (!Number.isNaN(did)) {
        params.push(did);
        filters.push(`p.donor_id = $${params.length}`);
      }
    }
    const tcSectors = tcSectorRestriction(req);
    if (tcSectors) {
      params.push(tcSectors);
      // TC can see projects where their sector appears in either the primary sector or the sectors array
      filters.push(`(p.sector = ANY($${params.length}::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors,'[]'::jsonb)) s WHERE s = ANY($${params.length}::text[])))`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${projectSummarySelect} ${where} ORDER BY p.created_at DESC`,
      params,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── Project create ────────────────────────────────────────────────────────────

router.post("/projects", requirePerm("projects.create"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = CreateProjectBody.parse(req.body);
    if (violatesStateScopedProjectWrite(
      req,
      body,
      (req.body as Record<string, unknown>).hasHqOperations === true,
    )) {
      res.status(403).json({ error: "state_forbidden" });
      return;
    }
    const reportingCoverage = resolveReportingCoverage(req.body as Record<string, unknown>, body.startDate, body.endDate);
    if (!reportingCoverage) {
      res.status(422).json({ error: "invalid_reporting_coverage", message: "Reporting coverage must be a valid inclusive date range." });
      return;
    }
    const donorValidation = validateDonorName(body.donor);
    if (!donorValidation.ok) {
      res.status(422).json({
        error: donorValidation.error,
        field: "donor",
        message: donorValidation.message,
      });
      return;
    }
    // Uploaded project documents must be bound to this user by a signed
    // descriptor. A client may not claim an arbitrary object path during
    // project creation (before the project has an ID to bind to).
    for (const d of body.documents ?? []) {
      if (!validProjectDocumentDescriptor(d, req.currentUser!.id)) {
        res.status(422).json({ error: "invalid_document_upload_descriptor" });
        return;
      }
    }

    // Date range validation — end must not precede start
    if (body.startDate && body.endDate && new Date(body.endDate) < new Date(body.startDate)) {
      res.status(400).json({
        error: "invalid_date_range",
        detail: "End Date cannot be before Start Date",
        fields: [{ path: "endDate", message: "End Date cannot be before Start Date" }],
      });
      return;
    }

    // Budget validation — must be zero or a positive number
    if ((body.budgetTotal ?? 0) < 0) {
      res.status(400).json({
        error: "validation_error",
        detail: "budgetTotal: Budget must be zero or a positive number",
        fields: [{ path: "budgetTotal", message: "Budget must be zero or a positive number" }],
      });
      return;
    }

    // ── BUD-BD-01: allocation cap check at create time ────────────────────────
    // budget_total and state allocations arrive together in the create body, so
    // enforce SUM(allocations) <= budget_total unconditionally (including
    // budget_total = 0) before anything is written.
    for (const alloc of body.stateAllocations ?? []) {
      if ((alloc.budgetAllocation ?? 0) < 0) {
        res.status(422).json({ error: "invalid_allocation", message: "Budget allocation cannot be negative." });
        return;
      }
    }
    const createAllocTotal = (body.stateAllocations ?? []).reduce((s, a) => s + (a.budgetAllocation ?? 0), 0);
    if (createAllocTotal > (body.budgetTotal ?? 0)) {
      res.status(422).json({
        error: "over_allocation",
        message: `Total state allocations (${createAllocTotal.toFixed(2)}) would exceed the project budget (${(body.budgetTotal ?? 0).toFixed(2)}).`,
      });
      return;
    }

    // Scheduled Reporting Frequency — required for all NEW projects (Task #325 / Model D).
    // 'on_demand' is not a valid scheduled frequency; historical NULLs exist only on
    // projects created before this field was introduced.
    const rawReportingFrequency = (req.body as Record<string, unknown>).reportingFrequency;
    if (
      typeof rawReportingFrequency !== "string" ||
      !(SCHEDULED_FREQUENCIES as readonly string[]).includes(rawReportingFrequency)
    ) {
      res.status(400).json({
        error: "invalid_reporting_frequency",
        field: "reportingFrequency",
        code: "invalid_reporting_frequency",
        message: "Scheduled Reporting Frequency is required and must be one of: monthly, quarterly, annual.",
      });
      return;
    }
    const reportingFrequency = rawReportingFrequency as ScheduledFrequency;

    // Management level — read from body (not in generated Zod schema but validated here)
    const VALID_MGMT = new Set(["hq_managed", "state_managed"]);
    const rawMgmt = (req.body as { managementLevel?: string }).managementLevel;
    const managementLevel = VALID_MGMT.has(rawMgmt ?? "") ? rawMgmt! : "hq_managed";

    // Resolve primary sector from sectors array or legacy sector field
    const sectorsArr = body.sectors ?? (body.sector ? [body.sector] : []);
    const primarySector = sectorsArr[0] ?? body.sector ?? "";

    // ── Sector validation — validate ALL sectors in the array ────────────────
    const invalidSecs = sectorsArr.filter(s => s && !VALID_SECTOR_SET.has(s));
    if (invalidSecs.length > 0) {
      res.status(422).json({
        error: "invalid_sector",
        field: "sectors",
        code: "invalid_sector",
        message: `Unrecognised sector(s): ${invalidSecs.join(", ")}. Allowed: ${[...VALID_SECTOR_SET].join(", ")}`,
      });
      return;
    }
    // Reject duplicate sectors — require each sector to appear at most once
    const sectorsSeen = new Set<string>();
    const duplicateSectors = sectorsArr.filter((s: string) => {
      if (sectorsSeen.has(s)) return true;
      sectorsSeen.add(s);
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
      const activeState = await assertActiveState(Number(stateId));
      if (!activeState.ok) {
        res.status(422).json({ error: activeState.error, message: "Projects can only be assigned to active States." });
        return;
      }
    }

    // Sub-sector validation — each sub-sector must belong to one of the selected sectors
    const subSectors: string[] = body.subSectors ?? [];
    if (subSectors.length > 0 && uniqueSectors.length > 0) {
      const subErr = validateSubSectorsMulti(uniqueSectors, subSectors);
      if (subErr) {
        res.status(422).json({ error: "invalid_sub_sector", field: "subSectors", code: "invalid_sub_sector", message: subErr });
        return;
      }
    }

    // Assistance modality validation (now from parsed Zod body)
    const assistanceModality = body.assistanceModality ?? null;
    if (assistanceModality && !ASSISTANCE_MODALITY_SET.has(assistanceModality)) {
      res.status(422).json({
        error: "invalid_assistance_modality",
        field: "assistanceModality",
        code: "invalid_assistance_modality",
        message: `"${assistanceModality}" is not a recognised assistance modality.`,
      });
      return;
    }

    // Operational Locations: at least one of HQ or a linked state is required.
    // management_level alone is NOT sufficient — hasHqOperations must be explicitly true.
    {
      const hqOps = (req.body as Record<string, unknown>).hasHqOperations === true;
      if (!hqOps && (body.stateIds ?? []).length === 0) {
        res.status(422).json({
          error: "no_operational_location",
          message: "A project must have at least one Operational Location: select HQ or at least one state.",
        });
        return;
      }
    }

    await client.query("BEGIN");

    // Resolve donor: if donorId provided look up name; if free-text donor provided keep it
    // BUD-DONOR-008: reject a nonexistent donorId immediately so bogus FK values cannot
    // be persisted. The transaction (BEGIN at line above) is already open — ROLLBACK is safe.
    // Use `!= null` (not truthy check) so that donorId=0 is also validated — `if (body.donorId)`
    // would skip the lookup for 0, persisting an invalid FK reference.
    let resolvedDonorName = body.donor ?? "";
    if (body.donorId != null) {
      // FOR KEY SHARE prevents the donor row from being deleted between this validation
      // and the INSERT COMMIT — if a concurrent deletion wins, the lock blocks it until
      // ROLLBACK releases, giving a deterministic 422 rather than an FK violation / 500.
      // client.release() is deliberately omitted here — the finally block owns exactly
      // one release for all code paths that reach this point.
      const dr = await client.query<{ name: string }>(`SELECT name FROM donors WHERE id = $1 FOR KEY SHARE`, [body.donorId]);
      if (!dr.rows[0]) {
        await client.query("ROLLBACK");
        res.status(422).json({
          error: "invalid_donor_id",
          field: "donorId",
          message: "The specified donor does not exist.",
        });
        return;
      }
      resolvedDonorName = dr.rows[0].name;
      const linkedDonorValidation = validateDonorName(resolvedDonorName);
      if (!linkedDonorValidation.ok) {
        await client.query("ROLLBACK");
        res.status(422).json({
          error: linkedDonorValidation.error,
          field: "donorId",
          message: linkedDonorValidation.message,
        });
        return;
      }
    }
    if (!resolvedDonorName && body.donorId == null) resolvedDonorName = "Unknown";

    // New format: CAFA-PROJ-{YEAR}-{NNN} — stable, state-agnostic, year-scoped sequence
    //
    // PRJ-008/PRJ-018 — concurrency safety: a transaction-scoped advisory lock
    // keyed to the year namespace serialises code allocation so two concurrent
    // creates in the same year cannot compute the same MAX+1 sequence. The lock
    // releases automatically on COMMIT/ROLLBACK. Defence-in-depth: migration
    // 024 adds a UNIQUE constraint on projects.code; a 23505 unique violation
    // is mapped to 409 { error: "project_code_conflict" } at the catch site.
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
    const result = await client.query(
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
        req.currentUser?.id ?? null,
        managementLevel,
        (body as Record<string, unknown>).hasHqOperations === true,
        reportingFrequency,
      ],
    );
    const project = result.rows[0];

    for (const sid of body.stateIds ?? []) {
      await client.query(
        `INSERT INTO project_states (project_id, state_id) VALUES ($1, $2)`,
        [project.id, sid],
      );
    }
    for (const alloc of body.stateAllocations ?? []) {
      await client.query(
        `INSERT INTO project_state_allocations
           (project_id, state_id, budget_allocation, beneficiary_target,
            beneficiary_male, beneficiary_female, beneficiary_boys, beneficiary_girls,
            activity_target, indicator_target, state_lead, state_team, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
        [
          project.id,
          alloc.stateId,
          alloc.budgetAllocation ?? null,
          alloc.beneficiaryTarget ?? null,
          alloc.beneficiaryMale ?? null,
          alloc.beneficiaryFemale ?? null,
          alloc.beneficiaryBoys ?? null,
          alloc.beneficiaryGirls ?? null,
          alloc.activityTarget ?? null,
          alloc.indicatorTarget ?? null,
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
        [project.id, localityName.trim(), localityOrder++],
      );
    }
    for (const a of body.assignments ?? []) {
      const displayName = a.name?.trim() || null;
      await client.query(
        `INSERT INTO project_assignments (project_id, user_id, name, role) VALUES ($1, $2, $3, $4)`,
        [project.id, a.userId ?? null, displayName, a.role],
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
          project.id,
          d.category ?? "optional",
          d.kind,
          d.fileName,
          d.contentType,
          d.size,
          d.objectPath ?? "",
          req.currentUser?.id ?? null,
        ],
      );
    }

    // Results Framework: Output → Indicators (per output) → Activities (with optional indicator link)
    let outIdx = 0;
    for (const out of body.outputs ?? []) {
      outIdx += 1;
      const outCode = `OUT-${outIdx}`;
      const outRow = await client.query(
        `INSERT INTO outputs (project_id, code, title, description, target) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [project.id, outCode, out.title, out.description ?? null, out.target ?? 0],
      );
      const outputId = outRow.rows[0].id as number;

      // Insert output-level indicators first, collect their IDs for activity linkage
      const indicatorIds: number[] = [];
      const outputIndicators = out.indicators ?? [];
      for (let ii = 0; ii < outputIndicators.length; ii++) {
        const ind = outputIndicators[ii];
        const indRow = await client.query(
          `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            project.id,
            outputId,
            `IND-${outIdx}.${ii + 1}`,
            ind.title,
            ind.unit ?? "count",
            ind.target ?? 0,
            primarySector,
          ],
        );
        indicatorIds.push(indRow.rows[0].id as number);
      }

      // Legacy: single output-level indicator via indicatorTitle field
      if (outputIndicators.length === 0 && out.indicatorTitle) {
        const indRow = await client.query(
          `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            project.id,
            outputId,
            `IND-${outIdx}.0`,
            out.indicatorTitle,
            out.indicatorUnit ?? "count",
            out.indicatorTarget ?? 0,
            primarySector,
          ],
        );
        indicatorIds.push(indRow.rows[0].id as number);
      }

      let actIdx = 0;
      for (const act of out.activities ?? []) {
        actIdx += 1;
        const actCode = `ACT-${outIdx}.${actIdx}`;

        // Resolve linked indicator: prefer indicatorIndex into output's indicators array
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
            project.id,
            outputId,
            linkedIndicatorId,
            act.stateId ?? null,
            act.localityName?.trim() ?? null,
            actCode,
            act.title,
            act.description ?? null,
            act.target ?? 0,
            act.status ?? "planned",
            act.plannedStart,
            act.plannedEnd,
            act.budgetPlanned,
          ],
        );

        // Legacy: activity-embedded indicator (when no indicators array on output)
        if (outputIndicators.length === 0 && act.indicatorTitle && !out.indicatorTitle) {
          await client.query(
            `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              project.id,
              outputId,
              `IND-${outIdx}.${actIdx}`,
              act.indicatorTitle,
              act.indicatorUnit ?? "count",
              act.indicatorTarget ?? 0,
              primarySector,
            ],
          );
        }
      }
    }
    await client.query("COMMIT");

    // G-06: notify project creator
    await createNotificationDeduped({
      userId: req.currentUser!.id,
      kind: "project_created",
      entityType: "project",
      entityId: project.id,
      message: `Project "${project.title}" was created successfully`,
      link: `/projects/${project.id}`,
      dedupeKey: `project-created:${project.id}`,
    });

    // Notify newly assigned users (F2: project assignment notifications)
    for (const a of body.assignments ?? []) {
      if (a.userId && a.userId !== req.currentUser?.id) {
        await createNotificationDeduped({
          userId: a.userId,
          kind: "project_assigned",
          entityType: "project",
          entityId: project.id,
          message: `You were assigned to project "${project.title}" as ${a.role || "team member"}`,
          link: `/projects/${project.id}`,
          dedupeKey: `project-assignment:${project.id}:${a.userId}:${a.role || "team member"}`,
        });
      }
    }

    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "create",
      module: "projects",
      entityId: project.id,
      newValue: project.title,
    });
    const enriched = await enrichProject(project, req.currentUser?.name ?? null);
    realtime.broadcastUpdate({
      module: "projects",
      action: "created",
      entityId: project.id,
      actorId: req.currentUser?.id,
      actorName: req.currentUser?.name,
    });
    res.status(201).json(enriched);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    // PRJ-018: unique violation on projects.code (constraint added in migration
    // 024) must surface as a clean 409, never a raw SQL error.
    if (
      typeof err === "object" && err !== null &&
      (err as { code?: string }).code === "23505" &&
      String((err as { constraint?: string }).constraint ?? "").includes("projects_code_unique")
    ) {
      res.status(409).json({ error: "project_code_conflict" });
      return;
    }
    next(err);
  } finally {
    client.release();
  }
});

// ── Duplicate check ───────────────────────────────────────────────────────────
// PRJ-002: Explicit project-domain permission guard prevents unauthorised callers
// from enumerating Project metadata. The guard uses an any-projects-permission
// check rather than a single requirePerm call so that every project-domain role
// is covered without conflating view and create semantics:
//   - Viewer          → projects.view
//   - SPO / SOM       → projects.view.state  (state-scoped; further filtered below)
//   - ED              → projects.delete
//   - TC / SPC / SPO  → projects.create, projects.update
//   - PM / Super Admin→ projects.create, projects.update, projects.delete (or *)
// Callers whose role carries no projects.* permission at all receive 403.

router.get("/projects/duplicate-check", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    // Inline project-domain gate (PRJ-002).
    const callerPerms = permissionsFor(req.currentUser);
    const hasProjectAccess = hasPerm(callerPerms, "*") || callerPerms.some((p) => p.startsWith("projects."));
    if (!hasProjectAccess) {
      res.status(403).json({ error: "forbidden", message: "You do not have access to project data." });
      return;
    }

    const { agreementNumber, donor, title, excludeId } = req.query as {
      agreementNumber?: string; donor?: string; title?: string; excludeId?: string;
    };
    if (!agreementNumber?.trim()) { res.json({ matchType: "none" }); return; }

    const user = req.currentUser;
    const tcSectors = tcSectorRestriction(req);
    const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";

    // Fail-closed: TC with no assigned sectors sees nothing — no enumeration leak.
    if (tcSectors !== null && tcSectors.length === 0) {
      res.json({ matchType: "none" }); return;
    }
    // Fail-closed: State role with no stateId sees nothing.
    if (isStateRole && (user.stateId ?? null) === null) {
      res.json({ matchType: "none" }); return;
    }

    const excludeIdNum = excludeId ? parseInt(excludeId, 10) : null;
    // Use unknown[] to accommodate mixed scalar / array params for scope clauses.
    const params: unknown[] = [agreementNumber.trim()];
    const excludeClause = excludeIdNum && !isNaN(excludeIdNum)
      ? ` AND p.id != $${params.push(excludeIdNum)}`
      : "";

    // TC sector scope: restrict to projects within assigned sectors only.
    // PRJ-BD-05: mirrors the list query — check primary sector OR sectors[] JSONB.
    let sectorClause = "";
    if (tcSectors !== null) {
      params.push(tcSectors);
      sectorClause = ` AND (p.sector = ANY($${params.length}::text[]) OR EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors, '[]'::jsonb)) s
  WHERE s = ANY($${params.length}::text[])
))`;
    }

    // State role scope: restrict to projects linked to the actor's state.
    let stateClause = "";
    if (isStateRole) {
      params.push(user.stateId!);
      stateClause = ` AND EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${params.length})`;
    }

    // Response minimisation (PRJ-002): omit internal IDs, budget data, assignments,
    // and State allocation data. Only fields required for the duplicate-check UX are returned.
    const { rows } = await pool.query(
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

    if (rows.length === 0) { res.json({ matchType: "none" }); return; }

    // Exact match: same agreementNumber + donor + title
    if (donor?.trim() && title?.trim()) {
      const exact = rows.find(
        r => r.donor?.toLowerCase() === donor.trim().toLowerCase()
          && r.title?.toLowerCase() === title.trim().toLowerCase(),
      );
      if (exact) { res.json({ matchType: "exact", existingProject: exact }); return; }
    }

    // Agreement warning: same agreementNumber but different title
    if (title?.trim()) {
      const warn = rows.find(r => r.title?.toLowerCase() !== title.trim().toLowerCase());
      if (warn) { res.json({ matchType: "agreement_warning", existingProject: warn }); return; }
    }

    res.json({ matchType: "none" });
  } catch (err) {
    next(err);
  }
});

// ── Project merge ─────────────────────────────────────────────────────────────
// PRJ-007: Sector and State scope guards added. TC and SPO must have access to
// the project before they can merge additional states/sectors/localities into it.

router.post("/projects/:projectId/merge", requirePerm("projects.update"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.projectId);
    const { stateIds = [], sectors = [], localities = [] } = req.body as {
      stateIds?: number[]; sectors?: string[]; localities?: string[];
    };

    // Fetch project — also enforces deleted_at IS NULL (preserves PRJ-026).
    const { rows: [proj] } = await client.query(
      `SELECT id, sector, sectors FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    if (!proj) { res.status(404).json({ error: "not_found" }); return; }

    // PRJ-007: Enforce Sector scope for TC callers.
    // PRJ-BD-05: use effective sector set (union of primary + sectors[]).
    const effectiveSectorsForMerge = [...new Set([
      ...((proj.sector as string | null) ? [(proj.sector as string)] : []),
      ...((proj.sectors as string[]) ?? []),
    ])];
    const sectorGuardMerge = assertEffectiveSectorAllowedForProject(req, effectiveSectorsForMerge);
    if (!sectorGuardMerge.ok) { res.status(sectorGuardMerge.status).json(sectorGuardMerge.body); return; }

    // PRJ-007: Enforce State scope for SPO/SOM callers.
    const stateGuardMerge = await assertStateAllowed(req, projectId);
    if (!stateGuardMerge.ok) { res.status(stateGuardMerge.status).json(stateGuardMerge.body); return; }

    // A state-role user's record-level access to this project does not expand
    // their destination-State authority. In particular, an SPO may be directly
    // assigned to a project outside their ordinary State, but may only add their
    // own State to it. Check this before looking up target State metadata so an
    // out-of-scope caller cannot learn whether another State is active.
    const isStateScopedMergeCaller = req.currentUser?.role === "state_program_officer"
      || req.currentUser?.role === "state_office_manager";
    if (isStateScopedMergeCaller && stateIds.some((stateId) => Number(stateId) !== req.currentUser!.stateId)) {
      res.status(403).json({ error: "state_forbidden" });
      return;
    }

    // project_states links are operational writes. Historical links remain
    // readable after a State is retired, but a merge must never add an inactive
    // (or unknown) destination State. This intentionally happens before BEGIN,
    // so no supplied State can be inserted before all have been validated.
    for (const stateId of stateIds) {
      const activeState = await assertActiveState(Number(stateId));
      if (!activeState.ok) {
        res.status(422).json({
          error: activeState.error,
          message: "Projects can only be assigned to active States.",
        });
        return;
      }
    }

    await client.query("BEGIN");

    for (const sid of stateIds) {
      await client.query(
        `INSERT INTO project_states (project_id, state_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [projectId, sid],
      );
    }

    if (sectors.length > 0) {
      // Validate all incoming sectors before merging — reject unrecognised values
      const invalidMergeSecs = sectors.filter((s: string) => !VALID_SECTOR_SET.has(s));
      if (invalidMergeSecs.length > 0) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "invalid_sector", field: "sectors", code: "invalid_sector", message: `Unrecognised sector(s): ${invalidMergeSecs.join(", ")}` });
        return;
      }
      // Reject duplicates within the incoming set
      const mergeSeenSectors = new Set<string>();
      const mergeDupSectors = sectors.filter((s: string) => {
        if (mergeSeenSectors.has(s)) return true;
        mergeSeenSectors.add(s);
        return false;
      });
      if (mergeDupSectors.length > 0) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "duplicate_sector", field: "sectors", code: "duplicate_sector", message: `Duplicate sector(s): ${[...new Set(mergeDupSectors)].join(", ")}. Each sector must appear at most once.` });
        return;
      }
      const existing: string[] = (proj.sectors as string[]) ?? [];
      const merged = [...new Set([...existing, ...sectors])];
      await client.query(
        `UPDATE projects SET sectors = $1::jsonb WHERE id = $2`,
        [JSON.stringify(merged), projectId],
      );
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

    const { rows: [updated] } = await client.query(
      `${projectSummarySelect} WHERE p.id = $1`,
      [projectId],
    );

    await logAudit({ userId: req.currentUser!.id, action: "merge", module: "project", entityId: projectId, newValue: JSON.stringify({ stateIds, sectors, localities }) });
    realtime.broadcastUpdate({
      module: "projects",
      action: "merged",
      entityId: projectId,
      actorId: req.currentUser!.id,
      actorName: req.currentUser!.name,
    });
    res.json(updated);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── Project detail ────────────────────────────────────────────────────────────

router.get("/projects/:projectId", async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const projectRes = await pool.query(
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
         p.currency,
              u.name AS "createdByName",
              p.created_at AS "createdAt"
       FROM projects p
       LEFT JOIN users u ON u.id = p.created_by_id
       LEFT JOIN donors d ON d.id = p.donor_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId],
    );
    if (projectRes.rows.length === 0) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const projectRow = projectRes.rows[0];
    const [outputs, activities, indicators, risks, reports, beneficiaries, states, history, spent, assignments, documents, localities] = await Promise.all([
      pool.query(
        `SELECT id, code, title, description, COALESCE(target::float, 0) AS target
         FROM outputs WHERE project_id = $1 ORDER BY code`,
        [projectId],
      ),
      pool.query(
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
      pool.query(
        `SELECT id, code, title, unit, target::float AS target, achieved::float AS achieved,
                output_id AS "outputId", sector
         FROM indicators WHERE project_id = $1 ORDER BY code`,
        [projectId],
      ),
      pool.query(
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
      pool.query(
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
      pool.query(
        `SELECT (COALESCE(beneficiaries_male,0) + COALESCE(beneficiaries_female,0) +
                 COALESCE(beneficiaries_boys,0) + COALESCE(beneficiaries_girls,0))::int AS reached
         FROM projects WHERE id = $1`,
        [projectId],
      ),
      pool.query(
        `SELECT s.id, s.name FROM project_states ps JOIN states s ON s.id = ps.state_id WHERE ps.project_id = $1`,
        [projectId],
      ),
      pool.query(
        `SELECT a.id, a.action, a.from_status AS "fromStatus", a.to_status AS "toStatus",
                u.name AS "actorName", u.role_label AS "actorRole",
                a.comment, a.timestamp
         FROM approvals a JOIN users u ON u.id = a.actor_id
         WHERE a.entity_type = 'project' AND a.entity_id = $1 ORDER BY a.timestamp ASC`,
        [projectId],
      ),
      pool.query(`SELECT COALESCE(SUM(budget_spent)::float, 0) AS spent FROM activities WHERE project_id = $1`, [projectId]),
      getAssignments(projectId),
      getDocuments(projectId),
      getLocalities(projectId),
    ]);
    res.json({
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
  } catch (err) {
    next(err);
  }
});

// ── Update draft project ────────────────────────────────────────────────────

router.patch("/projects/:projectId/reporting-coverage", async (req, res, next) => {
  if (!req.currentUser) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  if (!["executive_director", "program_manager", "super_admin"].includes(req.currentUser.role)) {
    res.status(403).json({ error: "reporting_coverage_management_required" });
    return;
  }
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const projectId = Number(req.params.projectId as string);
    if (!Number.isInteger(projectId) || projectId < 1) { res.status(400).json({ error: "invalid_project_id" }); return; }
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
    if (!project) { res.status(404).json({ error: "project_not_found" }); return; }
    if (project.status === "draft") { res.status(409).json({ error: "reporting_coverage_requires_non_draft_project" }); return; }
    const sectorGuard = assertEffectiveSectorAllowedForProject(req, [...new Set([...(project.sector ? [project.sector] : []), ...(project.sectors ?? [])])]);
    if (!sectorGuard.ok) { res.status(sectorGuard.status).json(sectorGuard.body); return; }
    const isStateRole = ["state_program_officer", "state_office_manager"].includes(req.currentUser!.role);
    if (isStateRole) {
      const scope = await client.query(`SELECT 1 FROM project_states WHERE project_id=$1 AND state_id=$2 LIMIT 1`, [projectId, req.currentUser!.stateId]);
      if (!req.currentUser!.stateId || !scope.rows.length) { res.status(403).json({ error: "state_scope_forbidden" }); return; }
    }
    const raw = req.body as Record<string, unknown>;
    const coverage = resolveReportingCoverage(raw, "__missing__", "__missing__");
    if (
      !coverage ||
      raw.reportingStartDate === undefined ||
      raw.reportingEndDate === undefined ||
      typeof raw.expectedReportingStartDate !== "string" ||
      typeof raw.expectedReportingEndDate !== "string"
    ) {
      res.status(422).json({ error: "invalid_reporting_coverage" }); return;
    }
    if (
      raw.expectedReportingStartDate !== project.reportingStartDate ||
      raw.expectedReportingEndDate !== project.reportingEndDate
    ) {
      res.status(409).json({ error: "reporting_coverage_conflict" });
      return;
    }
    await client.query(`UPDATE projects SET reporting_start_date=$1, reporting_end_date=$2, updated_at=NOW() WHERE id=$3`,
      [coverage.start, coverage.end, projectId]);
    await client.query(
      `INSERT INTO audit_log (user_id, action, module, entity_id, old_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.currentUser!.id, "reporting_coverage_updated", "projects", projectId,
        JSON.stringify({ reportingStartDate: project.reportingStartDate, reportingEndDate: project.reportingEndDate }),
        JSON.stringify({ reportingStartDate: coverage.start, reportingEndDate: coverage.end })],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    res.json({ projectId, reportingStartDate: coverage.start, reportingEndDate: coverage.end });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    transactionOpen = false;
    next(error);
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

router.patch("/projects/:projectId", requirePerm("projects.update"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.projectId as string);

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
    if (check.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) {
      res.status(stateGuard.status).json(stateGuard.body);
      return;
    }
    if (check.rows[0].status !== "draft") {
      res.status(409).json({ error: "Only draft projects can be updated" });
      return;
    }
    const effectiveSectorsForPatch = [...new Set([
      ...(check.rows[0].sector ? [check.rows[0].sector] : []),
      ...(Array.isArray(check.rows[0].sectors) ? check.rows[0].sectors : []),
    ])];
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectorsForPatch);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }

    const body = CreateProjectBody.parse(req.body);
    const isStateRole = ["state_program_officer", "state_office_manager"].includes(req.currentUser!.role);
    const existingScopeOutsideCaller = isStateRole && (
      check.rows[0].has_hq_operations === true
      || (check.rows[0].state_ids ?? []).some((stateId) => stateId !== req.currentUser!.stateId)
    );
    const rawPatchHqOperations = (req.body as Record<string, unknown>).hasHqOperations;
    // PATCH normally preserves an omitted HQ flag. State callers must therefore
    // explicitly clear it before they can edit a historical draft that claims HQ.
    const effectivePatchHqOperations = rawPatchHqOperations === true ||
      (rawPatchHqOperations !== false && check.rows[0].has_hq_operations === true);
    if (existingScopeOutsideCaller || violatesStateScopedProjectWrite(req, body, effectivePatchHqOperations)) {
      res.status(403).json({ error: "state_forbidden" });
      return;
    }
    const reportingCoverage = resolveReportingCoverage(req.body as Record<string, unknown>, body.startDate, body.endDate);
    if (!reportingCoverage) {
      res.status(422).json({ error: "invalid_reporting_coverage", message: "Reporting coverage must be a valid inclusive date range." });
      return;
    }
    const donorValidation = validateDonorName(body.donor);
    if (!donorValidation.ok) {
      res.status(422).json({
        error: donorValidation.error,
        field: "donor",
        message: donorValidation.message,
      });
      return;
    }
    // PATCH replaces project_state links and allocations wholesale. Retaining
    // inactive historical links is safe for reads, but this replacement is a
    // new operational assignment and must target active registry records only.
    for (const stateId of [
      ...(body.stateIds ?? []),
      ...(body.stateAllocations ?? []).map((allocation) => allocation.stateId),
    ]) {
      const activeState = await assertActiveState(Number(stateId));
      if (!activeState.ok) {
        res.status(422).json({
          error: activeState.error,
          message: "Projects can only be assigned to active States.",
        });
        return;
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
        || (!existing && !validProjectDocumentDescriptor(d, req.currentUser!.id))
      ) {
        res.status(422).json({ error: "invalid_document_upload_descriptor" });
        return;
      }
    }
    if (body.startDate && body.endDate && new Date(body.endDate) < new Date(body.startDate)) {
      res.status(400).json({ error: "invalid_date_range", detail: "End Date cannot be before Start Date" });
      return;
    }

    // Budget validation — must be zero or a positive number (parity with create)
    if ((body.budgetTotal ?? 0) < 0) {
      res.status(400).json({
        error: "validation_error",
        detail: "budgetTotal: Budget must be zero or a positive number",
        fields: [{ path: "budgetTotal", message: "Budget must be zero or a positive number" }],
      });
      return;
    }

    // Operational Locations: at least one of HQ or a linked state is required.
    {
      const rawHqOps = (req.body as Record<string, unknown>).hasHqOperations;
      const hqOps = rawHqOps === true;
      if (!hqOps && (body.stateIds ?? []).length === 0) {
        res.status(422).json({
          error: "no_operational_location",
          message: "A project must have at least one Operational Location: select HQ or at least one state.",
        });
        return;
      }
    }

    const sectorsArr = body.sectors ?? (body.sector ? [body.sector] : []);
    const primarySector = sectorsArr[0] ?? body.sector ?? "";

    // Validate ALL sectors (not just primary) — reject any retired/unsupported value
    const invalidPatchSecs = sectorsArr.filter((s: string) => s && !VALID_SECTOR_SET.has(s));
    if (invalidPatchSecs.length > 0) {
      res.status(422).json({ error: "invalid_sector", field: "sectors", code: "invalid_sector", message: `Unrecognised sector(s): ${invalidPatchSecs.join(", ")}. Allowed: ${[...VALID_SECTOR_SET].join(", ")}` });
      return;
    }
    // Reject duplicate sectors in PATCH too
    const patchSectorsSeen = new Set<string>();
    const patchDuplicates = sectorsArr.filter((s: string) => {
      if (patchSectorsSeen.has(s)) return true;
      patchSectorsSeen.add(s);
      return false;
    });
    if (patchDuplicates.length > 0) {
      res.status(422).json({ error: "duplicate_sector", field: "sectors", code: "duplicate_sector", message: `Duplicate sector(s): ${[...new Set(patchDuplicates)].join(", ")}. Each sector must appear at most once.` });
      return;
    }
    const uniquePatchSectors = sectorsArr;
    const patchSubSectors: string[] = body.subSectors ?? [];
    if (patchSubSectors.length > 0 && uniquePatchSectors.length > 0) {
      const subErr = validateSubSectorsMulti(uniquePatchSectors, patchSubSectors);
      if (subErr) { res.status(422).json({ error: "invalid_sub_sector", field: "subSectors", code: "invalid_sub_sector", message: subErr }); return; }
    }
    const patchModality = body.assistanceModality ?? null;
    if (patchModality && !ASSISTANCE_MODALITY_SET.has(patchModality)) {
      res.status(422).json({ error: "invalid_assistance_modality", field: "assistanceModality", code: "invalid_assistance_modality", message: `"${patchModality}" is not a recognised assistance modality.` });
      return;
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

    // ── BUD-DONOR-008: Validate donor ID inside the transaction, after FOR UPDATE ──
    // Moving the lookup here closes the pre-transaction race window (spec §27) and
    // ensures Full Operational Access cannot bypass the donor existence check.
    // Use `!= null` (not truthy check) so that donorId=0 is also validated — `if (body.donorId)`
    // would skip the lookup for 0, persisting an invalid FK reference.
    // FOR KEY SHARE prevents concurrent donor deletion from causing an FK violation / 500
    // after this check passes. client.release() is deliberately omitted — the finally
    // block owns exactly one release for all code paths that reach this point.
    if (body.donorId != null) {
      const dr = await client.query<{ name: string }>(`SELECT name FROM donors WHERE id = $1 FOR KEY SHARE`, [body.donorId]);
      if (!dr.rows[0]) {
        await client.query("ROLLBACK");
        res.status(422).json({
          error: "invalid_donor_id",
          field: "donorId",
          message: "The specified donor does not exist.",
        });
        return;
      }
      resolvedDonorName = dr.rows[0].name;
      const linkedDonorValidation = validateDonorName(resolvedDonorName);
      if (!linkedDonorValidation.ok) {
        await client.query("ROLLBACK");
        res.status(422).json({
          error: linkedDonorValidation.error,
          field: "donorId",
          message: linkedDonorValidation.message,
        });
        return;
      }
    }
    if (!resolvedDonorName && body.donorId == null) resolvedDonorName = "Unknown";

    // ── BUD-BD-01: allocation cap check ────────────────────────────────────────
    // The PATCH always writes budget_total and wholesale-replaces state
    // allocations, so the post-PATCH state is exactly the incoming payload.
    // Enforce SUM(allocations) <= budget_total unconditionally (including
    // budget_total = 0). Covers the budget-reduction gap: lowering the budget
    // while keeping existing allocations in the payload is rejected here.
    const patchEffectiveBudget = body.budgetTotal ?? 0;
    for (const alloc of body.stateAllocations ?? []) {
      if ((alloc.budgetAllocation ?? 0) < 0) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "invalid_allocation", message: "Budget allocation cannot be negative." });
        return;
      }
    }
    const patchAllocTotal = (body.stateAllocations ?? []).reduce((s, a) => s + (a.budgetAllocation ?? 0), 0);
    if (patchAllocTotal > patchEffectiveBudget) {
      await client.query("ROLLBACK");
      res.status(422).json({
        error: "over_allocation",
        message: `Total state allocations (${patchAllocTotal.toFixed(2)}) would exceed the project budget (${patchEffectiveBudget.toFixed(2)}). Reduce allocations before lowering the budget.`,
      });
      return;
    }

    // ── PRJ-BD-03: Load existing activity spend BEFORE touching rows ──────────
    // budget_spent and progress_pct must survive ordinary content edits.
    // This SELECT runs inside the transaction so the read is atomic with writes.
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
    // IDs of incoming activities that matched an existing row (will be preserved)
    const matchedActivityIds: number[] = [];

    const rawHasHqOps = (req.body as Record<string, unknown>).hasHqOperations;
    const hasHqOpsUpdate = typeof rawHasHqOps === "boolean" ? rawHasHqOps : undefined;

    // Scheduled Reporting Frequency (Task #325): optional on PATCH.
    // - Absent from body → column unchanged (standard PATCH semantics)
    // - null → explicitly cleared (historical projects may remain unconfigured)
    // - Otherwise must be a scheduled frequency; 'on_demand' is rejected.
    // Changing the frequency NEVER touches the reports table — existing PMRs
    // (including drafts) keep their kind unchanged; the change is prospective only.
    const freqProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "reportingFrequency");
    const rawFreqPatch = (req.body as Record<string, unknown>).reportingFrequency;
    if (
      freqProvided &&
      rawFreqPatch !== null &&
      (typeof rawFreqPatch !== "string" || !(SCHEDULED_FREQUENCIES as readonly string[]).includes(rawFreqPatch))
    ) {
      res.status(400).json({
        error: "invalid_reporting_frequency",
        field: "reportingFrequency",
        code: "invalid_reporting_frequency",
        message: "Scheduled Reporting Frequency must be one of: monthly, quarterly, annual (or null to leave unconfigured).",
      });
      return;
    }
    const freqPatchValue = freqProvided ? (rawFreqPatch as ScheduledFrequency | null) : null;

    const baseRevision = req.header("x-base-revision");
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
      res.status(409).json({ error: "offline_conflict", code: "revision_mismatch", message: "The project changed while this draft was offline." });
      return;
    }

    // Indicators (like Outputs) have no client-supplied id in the request
    // body, so — unlike activities — they are always deleted and reinserted
    // with fresh ids on every PATCH. Their `code` column ("IND-{output}.{n}")
    // is deterministic from output/indicator position and is the only stable
    // identity available; read the prior (code -> achieved) map before the
    // delete so an ordinary content edit (title/target/unit change) doesn't
    // silently zero out already-recorded indicator progress. Reordering or
    // adding/removing an output ahead of an existing one will still shift the
    // codes and lose the match — a known limit of position-based identity.
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
    // The registry is a dependent index, not a document owner. Remove its
    // entries in the same transaction before replacing parent-owned documents.
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
         alloc.budgetAllocation ?? null, alloc.beneficiaryTarget ?? null,
         alloc.beneficiaryMale ?? null, alloc.beneficiaryFemale ?? null,
         alloc.beneficiaryBoys ?? null, alloc.beneficiaryGirls ?? null,
         alloc.activityTarget ?? null, alloc.indicatorTarget ?? null,
         alloc.stateLead ?? null,
         JSON.stringify((alloc as Record<string, unknown>).stateTeam ?? []),
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
         d.objectPath ?? "", req.currentUser?.id ?? null],
      );
    }
    // ── PRJ-BD-03: Extract raw activity ids from request body (server-side only) ─
    // The generated CreateProjectBody schema does not include id on activities, so
    // we read the raw body alongside the parsed body.  Only numeric positive
    // integer ids that belong to this project (present in spendMap) are honoured.
    const rawOutputsArr: Record<string, unknown>[] = Array.isArray(
      (req.body as Record<string, unknown>).outputs,
    ) ? ((req.body as Record<string, unknown>).outputs as Record<string, unknown>[]) : [];

    let outIdx = 0;
    const outBodyArr = body.outputs ?? [];
    for (let oi = 0; oi < outBodyArr.length; oi++) {
      const out = outBodyArr[oi];
      outIdx += 1;
      const outRow = await client.query(
        `INSERT INTO outputs (project_id, code, title, description, target) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [projectId, `OUT-${outIdx}`, out.title, out.description ?? null, out.target ?? 0],
      );
      const outputId = outRow.rows[0].id as number;
      const indicatorIds: number[] = [];
      const outIndicators = out.indicators ?? [];
      for (let ii = 0; ii < outIndicators.length; ii++) {
        const ind = outIndicators[ii];
        const indicatorCode = `IND-${outIdx}.${ii + 1}`;
        const preservedAchieved = indicatorAchievedByCode.get(indicatorCode) ?? 0;
        const indRow = await client.query(
          `INSERT INTO indicators (project_id, output_id, code, title, unit, target, sector, achieved)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [projectId, outputId, indicatorCode, ind.title, ind.unit ?? "count", ind.target ?? 0, primarySector, preservedAchieved],
        );
        indicatorIds.push(indRow.rows[0].id as number);
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

        // Extract optional activity id from raw body — must be owned by this project
        const rawId = (rawActsArr[ai] as Record<string, unknown>)?.id;
        const incomingId = typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0 ? rawId : undefined;
        const spendData = incomingId !== undefined && spendMap.has(incomingId) ? spendMap.get(incomingId)! : null;
        const incomingStateId = act.stateId ?? null;
        // Historical inactive links may remain readable and be retained unchanged,
        // but every new or changed operational activity assignment must target an
        // active canonical State.
        if ((spendData === null || spendData.stateId !== incomingStateId) && incomingStateId !== null) {
          const activeState = await assertActiveState(Number(incomingStateId));
          if (!activeState.ok) {
            await client.query("ROLLBACK");
            res.status(422).json({
              error: activeState.error,
              message: "Project activities can only be assigned to active States.",
            });
            return;
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
          // New activity (no id or id not owned by this project) — INSERT with zero spend
          await client.query(
            `INSERT INTO activities
               (project_id, output_id, indicator_id, state_id, locality_name,
                code, title, description, target, status, planned_start, planned_end,
                budget_planned, budget_spent, progress_pct)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0)`,
            [projectId, outputId, linkedIndicatorId, act.stateId ?? null,
             act.localityName?.trim() ?? null,
             `ACT-${outIdx}.${actIdx}`, act.title, act.description ?? null,
             act.target ?? 0, act.status ?? "planned",
             act.plannedStart, act.plannedEnd, act.budgetPlanned],
          );
        }
      }
    }

    // ── PRJ-BD-03: Delete activities removed from the payload ─────────────────
    // Activities with non-zero budget_spent that are deleted here will lose their
    // spend data — this is intentional (the user explicitly removed the activity).
    // The permanent-delete route already blocks project-level deletion when any
    // activity has spend, so removal of individual activities with spend is
    // permitted during content editing.
    if (matchedActivityIds.length > 0) {
      await client.query(
        `DELETE FROM activities WHERE project_id=$1 AND id != ALL($2::int[])`,
        [projectId, matchedActivityIds],
      );
    } else {
      // No existing activities were retained — delete any remaining rows
      await client.query("DELETE FROM activities WHERE project_id=$1", [projectId]);
    }

    await client.query("COMMIT");
    // BUD audit: when the budget changed, record the old/new figures alongside the title.
    const budgetChanged = patchEffectiveBudget !== oldBudgetTotal;
    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "update",
      module: "projects",
      entityId: projectId,
      newValue: budgetChanged
        ? JSON.stringify({ title: body.title, oldBudget: oldBudgetTotal, newBudget: patchEffectiveBudget })
        : body.title,
    });
    realtime.broadcastUpdate({ module: "projects", action: "updated", entityId: projectId, actorId: req.currentUser?.id, actorName: req.currentUser?.name });
    const enriched = await enrichProject({ id: projectId, title: body.title } as Record<string, unknown>, req.currentUser?.name ?? null);
    res.json(enriched);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
});

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

router.post("/projects/:projectId/transitions", async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "no current user" });
      return;
    }
    const projectId = Number(req.params.projectId);
    const body = TransitionProjectBody.parse(req.body);
    const transition = PROJECT_TRANSITIONS[body.action];
    if (!transition) {
      res.status(400).json({ error: `invalid action: ${body.action}` });
      return;
    }
    // reject/request_revision use stage-aware permission evaluation (checked after
    // the source status is loaded); all other transitions keep static permissions.
    const isStageAwareAction = body.action === "reject" || body.action === "request_revision";
    const transitionPerm = PROJECT_TRANSITION_PERMS[body.action];
    if (transitionPerm && !isStageAwareAction) {
      const perms = permissionsFor(req.currentUser);
      if (!perms.includes("*") && !perms.includes(transitionPerm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: transitionPerm });
        return;
      }
    }
    const cur = await pool.query(
      `SELECT status, sector, COALESCE(sectors, '[]'::jsonb)::jsonb AS sectors, management_level AS "managementLevel"
       FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    if (cur.rows.length === 0) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const effectiveSectorsForTransition = [...new Set([
      ...(cur.rows[0].sector ? [cur.rows[0].sector as string] : []),
      ...(Array.isArray(cur.rows[0].sectors) ? (cur.rows[0].sectors as string[]) : []),
    ])];
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectorsForTransition);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const fromStatus = cur.rows[0].status as string;
    const mgmt = cur.rows[0].managementLevel as string;
    if (!transition.from.includes(fromStatus)) {
      res.status(400).json({ error: `cannot ${body.action} from ${fromStatus}` });
      return;
    }
    // PRJ-BD-02: stage-aware permission for reject/request_revision. Full Access
    // ("*") still applies, but never overrides the source-status validation above.
    if (isStageAwareAction) {
      const requiredPerm = stageAwareNegativePerm(fromStatus);
      if (!requiredPerm) {
        res.status(400).json({ error: `cannot ${body.action} from ${fromStatus}` });
        return;
      }
      const perms = permissionsFor(req.currentUser);
      if (!perms.includes("*") && !perms.includes(requiredPerm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: requiredPerm });
        return;
      }
    }
    void mgmt;

    if (body.action === "final_approve") {
      // Gate 1: unresolved required corrections
      const n = await unresolvedRequiredCorrections("project", projectId);
      if (n > 0) {
        res.status(409).json({ error: "unresolved_required_corrections", count: n });
        return;
      }
      // Gate 2: must have at least one agreement doc AND one budget doc
      const docCheck = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE category = 'agreement') AS agreement_count,
           COUNT(*) FILTER (WHERE category = 'budget') AS budget_count
         FROM project_documents WHERE project_id = $1`,
        [projectId],
      );
      const { agreement_count, budget_count } = docCheck.rows[0] as { agreement_count: string; budget_count: string };
      if (Number(agreement_count) === 0) {
        res.status(409).json({ error: "missing_required_document", detail: "At least one Agreement document is required before final approval." });
        return;
      }
      if (Number(budget_count) === 0) {
        res.status(409).json({ error: "missing_required_document", detail: "At least one Budget document is required before final approval." });
        return;
      }
      // Gate 3: detailed cost breakdown must not exceed the approved total.
      // A project may be saved as a draft with a mismatched breakdown (e.g.
      // costs not itemised yet), but final approval is the point at which the
      // budget is locked in, so an over-allocated breakdown must not slip
      // through silently — the response carries both figures so the caller
      // can show exactly how far over the total the breakdown is.
      const costCheck = await pool.query(
        `SELECT budget_total::float AS "budgetTotal",
                COALESCE(direct_cost::float, 0) AS "directCost",
                COALESCE(indirect_cost::float, 0) AS "indirectCost",
                COALESCE(cafa_contribution::float, 0) AS "cafaContribution"
         FROM projects WHERE id = $1`,
        [projectId],
      );
      const costRow = costCheck.rows[0] as {
        budgetTotal: number; directCost: number; indirectCost: number; cafaContribution: number;
      };
      const detailedCostTotal = costRow.directCost + costRow.indirectCost + costRow.cafaContribution;
      if (detailedCostTotal > costRow.budgetTotal) {
        res.status(409).json({
          error: "budget_breakdown_exceeds_total",
          detail: `Detailed costs (Direct + Indirect + CAFA Contribution = ${detailedCostTotal.toFixed(2)}) exceed the approved Budget Total (${costRow.budgetTotal.toFixed(2)}).`,
          budgetTotal: costRow.budgetTotal,
          detailedCostTotal,
        });
        return;
      }
      // Gate 4: disaggregated beneficiary counts must not exceed the target,
      // mirroring the budget-breakdown gate above (allowed to mismatch while
      // a draft; must not exceed the target at the point final approval locks
      // the project's commitments in).
      const beneficiaryCheck = await pool.query(
        `SELECT beneficiaries_target AS "beneficiariesTarget",
                COALESCE(beneficiaries_male, 0) AS "beneficiariesMale",
                COALESCE(beneficiaries_female, 0) AS "beneficiariesFemale",
                COALESCE(beneficiaries_boys, 0) AS "beneficiariesBoys",
                COALESCE(beneficiaries_girls, 0) AS "beneficiariesGirls"
         FROM projects WHERE id = $1`,
        [projectId],
      );
      const beneficiaryRow = beneficiaryCheck.rows[0] as {
        beneficiariesTarget: number | null;
        beneficiariesMale: number; beneficiariesFemale: number; beneficiariesBoys: number; beneficiariesGirls: number;
      };
      const beneficiarySum =
        beneficiaryRow.beneficiariesMale + beneficiaryRow.beneficiariesFemale
        + beneficiaryRow.beneficiariesBoys + beneficiaryRow.beneficiariesGirls;
      const beneficiaryTarget = beneficiaryRow.beneficiariesTarget ?? 0;
      if (beneficiarySum > beneficiaryTarget) {
        res.status(409).json({
          error: "beneficiaries_breakdown_exceeds_target",
          detail: `Disaggregated beneficiaries (Male + Female + Boys + Girls = ${beneficiarySum}) exceed the Beneficiaries Target (${beneficiaryTarget}).`,
          beneficiariesTarget: beneficiaryTarget,
          beneficiarySum,
        });
        return;
      }
    }

    const commentText = String(body.comment ?? "").trim();
    if ((body.action === "request_revision" || body.action === "reject") && !commentText) {
      res.status(400).json({ error: "comment_required_for_revision_or_reject" });
      return;
    }

    // Atomic CAS transition (mirrors the PLAN-004 pattern in plans.ts): the
    // UPDATE includes an AND status = $fromStatus predicate. If a concurrent
    // transition on this same project already changed the status between our
    // read above and this write — e.g. one actor approves while another
    // rejects the same coordination_approved project at nearly the same
    // moment — rowCount is 0 and we report a 409 conflict instead of
    // silently letting whichever transition committed last win with no
    // signal that the other one's approval/rejection was effectively lost.
    // The approval record and optional comment are written in the same
    // transaction, so a partial commit (status changed, no approval row) is
    // impossible.
    let updatedRow: Record<string, unknown> | undefined;
    const transitionClient = await pool.connect();
    try {
      await transitionClient.query("BEGIN");
      const casResult = await transitionClient.query(
        `UPDATE projects SET status = $1 WHERE id = $2 AND status = $3 AND deleted_at IS NULL ${projectReturning}`,
        [transition.to, projectId, fromStatus],
      );
      if (casResult.rowCount === 0) {
        await transitionClient.query("ROLLBACK");
        res.status(409).json({
          error: "project_status_conflict",
          message: "The project status has changed; please refresh and try again.",
        });
        return;
      }
      updatedRow = casResult.rows[0];
      await transitionClient.query(
        `INSERT INTO approvals (entity_type, entity_id, action, from_status, to_status, actor_id, comment)
         VALUES ('project', $1, $2, $3, $4, $5, $6)`,
        [projectId, body.action, fromStatus, transition.to, req.currentUser.id, body.comment ?? null],
      );

      if (commentText && (body.action === "request_revision" || body.action === "reject")) {
        await transitionClient.query(
          `INSERT INTO comments (entity_type, entity_id, comment_type, author_id, body)
           VALUES ('project', $1, $2, $3, $4)`,
          [
            projectId,
            body.action === "request_revision" ? "revision_request" : "rejection_reason",
            req.currentUser.id,
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

    await logAudit({
      userId: req.currentUser.id,
      action: body.action,
      module: "projects",
      entityId: projectId,
      oldValue: fromStatus,
      newValue: transition.to,
    });

    const kindMap: Record<string, string> = {
      request_revision: "returned",
      reject: "rejected",
      final_approve: "approved",
      submit: "resubmitted",
      technical_review: "technically_reviewed",
      coordination_review: "coordination_reviewed",
      activate: "activated",
      close: "closed",
    };
    const transitionDedupeKey =
      `project-transition:${projectId}:${body.action}:${fromStatus}:${transition.to}`;
    await notifyEntityActorsDeduped({
      entityType: "project",
      entityId: projectId,
      kind: kindMap[body.action] ?? "system",
      message: `Project transitioned ${fromStatus} → ${transition.to} by ${req.currentUser.name}${commentText ? `: ${commentText}` : ""}`,
      dedupeKey: transitionDedupeKey,
      link: `/projects/${projectId}`,
      exceptUserId: req.currentUser.id,
      mandatory: body.action === "reject" || body.action === "request_revision",
    });
    // G-01: notify next approver in chain
    const projectSector = (cur.rows[0].sector as string | null) ?? null;
    await notifyNextApprover({
      action: body.action,
      entityType: "project",
      entityId: projectId,
      sector: projectSector,
      message: `A project requires your review by ${req.currentUser.name}`,
      link: `/projects/${projectId}`,
      exceptUserId: req.currentUser.id,
      dedupeKey: `${transitionDedupeKey}:next-approver`,
    });

    const enriched = await enrichProject(updatedRow!, null);
    realtime.broadcastUpdate({
      module: "projects",
      action: body.action,
      entityId: projectId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
      data: { from: fromStatus, to: transition.to },
    });
    res.json(enriched);
    // Fire-and-forget budget alert — does not block the response
    void checkAndFireBudgetAlert(projectId);
  } catch (err) {
    next(err);
  }
});

// ── Project documents ─────────────────────────────────────────────────────────

router.get("/projects/:projectId/documents", async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const rows = await getDocuments(projectId);
    res.json(rows.map(toPublicDocumentDto));
  } catch (err) {
    next(err);
  }
});

router.post("/projects/:projectId/documents", requirePerm("documents.upload"), async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "no current user" });
      return;
    }
    const projectId = Number(req.params.projectId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    // PRJ-BD-04: Fully-atomic gate + insert for upload.
    // SELECT … FOR UPDATE locks the project row, preventing a concurrent freeze
    // transition from slipping a document into a project that becomes closed
    // between the status read and the INSERT.
    // Parse body first so invalid payloads fail fast before acquiring a connection.
    const body = AddProjectDocumentBody.parse(req.body);

    let uploadResult: { rows: Record<string, unknown>[] };
    const uploadTxClient = await pool.connect();
    try {
      await uploadTxClient.query("BEGIN");

      // Lock project against concurrent status transitions
      const { rows: projRows } = await uploadTxClient.query<{ status: string }>(
        `SELECT status FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [projectId],
      );
      if (!projRows.length) {
        await uploadTxClient.query("ROLLBACK");
        res.status(404).json({ error: "project_not_found" }); return;
      }

      const projectStatus = projRows[0].status;
      const uploadTxGate: "mutable" | "operational" | "frozen" =
        ["completed", "closed"].includes(projectStatus) ? "frozen"
        : ["approved", "active"].includes(projectStatus) ? "operational"
        : "mutable";

      if (uploadTxGate === "frozen") {
        await uploadTxClient.query("ROLLBACK");
        res.status(409).json({
          error: "project_documents_frozen",
          message: "Project documents are locked because the project is closed.",
        }); return;
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
          req.currentUser.id,
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

    // Post-commit: audit + notification (best-effort, outside TX)
    await logAudit({
      userId: req.currentUser.id,
      action: "document_upload",
      module: "projects",
      entityId: projectId,
      newValue: `${body.kind}: ${body.fileName}`,
    });
    await notifyEntityActors({
      entityType: "project",
      entityId: projectId,
      kind: "document_uploaded",
      message: `A new document was uploaded to your project: ${body.fileName}`,
      link: `/projects/${projectId}`,
      exceptUserId: req.currentUser.id,
      dedupeKey: `project-document-upload:${projectId}:${uploadResult.rows[0].id}`,
    });
    realtime.broadcastUpdate({
      module: "projects",
      action: "document_created",
      entityId: projectId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    res.status(201).json(toPublicDocumentDto({ ...uploadResult.rows[0], uploadedByName: req.currentUser.name }));
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId/documents/:documentId/download", requirePerm("documents.view"), async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const projectId = Number(req.params.projectId);
    const documentId = Number(req.params.documentId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }

    const { rows } = await pool.query(
      `SELECT id, file_name AS "fileName", content_type AS "contentType",
              object_path AS "objectPath", availability_status AS "availabilityStatus"
       FROM project_documents WHERE id = $1 AND project_id = $2`,
      [documentId, projectId],
    );
    if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
    const doc = rows[0];
    if (doc.availabilityStatus === "unavailable") {
      res.status(410).json({ error: "file_unavailable", message: "File Unavailable" }); return;
    }

    if (!doc.objectPath) {
      res.status(410).json({ error: "file_unavailable", message: "Historical file requires owner reconciliation." });
      return;
    }

    // Canonical object-storage documents proxy-stream directly. Never redirect
    // to /storage/objects/... because that leaks an internal object identity.
    const { ObjectStorageService, ObjectNotFoundError, isStorageConfigured } = await import("../lib/objectStorage");
    const storageStatus = isStorageConfigured();
    if (!storageStatus.configured) { res.status(503).json({ error: "storage_not_configured" }); return; }
    try {
      const objectStorageService = new ObjectStorageService();
      const rawPath = String(doc.objectPath ?? "");
      const normalizedPath = rawPath.startsWith("/objects/") ? rawPath : `/objects/${rawPath}`;
      const storageFile = await objectStorageService.getObjectEntityFile(normalizedPath);
      const storageResponse = await objectStorageService.downloadObject(storageFile);
      res.setHeader("Content-Type", storageResponse.headers.get("Content-Type") || doc.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", contentDispositionHeader(doc.fileName, "attachment"));
      const contentLength = storageResponse.headers.get("Content-Length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (!storageResponse.body) { res.status(502).json({ error: "storage_unavailable" }); return; }
      const { Readable } = await import("stream");
      Readable.fromWeb(storageResponse.body as import("stream/web").ReadableStream).pipe(res);
      return;
    } catch (storageErr) {
      if (storageErr instanceof ObjectNotFoundError) { res.status(404).json({ error: "file_not_found" }); return; }
      throw storageErr;
    }
  } catch (err) { next(err); }
});

// ── Project deletion info (for frontend dialog) ───────────────────────────────
// Returns { canDelete, mode } without performing any mutation.
router.get("/projects/:projectId/deletion-info", async (req, res, next) => {
  try {
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const projectId = Number(req.params.projectId as string);
    if (isNaN(projectId)) { res.status(400).json({ error: "invalid project id" }); return; }

    const perms = permissionsFor(req.currentUser);
    const userCanDelete = hasPerm(perms, "projects.delete");

    if (!userCanDelete) {
      res.json({ canDelete: false, mode: null });
      return;
    }

    const { rows } = await pool.query<{ id: number; code: string; title: string; status: string; sector: string; sectors: string[]; deleted_at: Date | null }>(
      `SELECT id, code, title, status, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors, deleted_at FROM projects WHERE id = $1`,
      [projectId],
    );
    if (rows.length === 0 || rows[0].deleted_at !== null) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const project = rows[0];
    if (isExactDevelopmentTestRetirementTarget(project)) {
      res.json({ canDelete: false, mode: null, reason: "development_fixture_retirement_required" });
      return;
    }
    // PRJ-BD-05: Use effective-sector set (primary ∪ sectors[]) for TC scope guard.
    const deleteInfoSectors = [...new Set([
      ...(project.sector ? [project.sector] : []),
      ...(Array.isArray(project.sectors) ? project.sectors : []),
    ])];
    const sectorGuard = assertEffectiveSectorAllowedForProject(req, deleteInfoSectors);
    if (!sectorGuard.ok) { res.json({ canDelete: false, mode: null }); return; }

    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.json({ canDelete: false, mode: null }); return; }

    const { rows: historyRows } = await pool.query<{ toStatus: string }>(
      `SELECT to_status AS "toStatus" FROM approvals WHERE entity_type = 'project' AND entity_id = $1`,
      [projectId],
    );

    const mode = getProjectDeletionMode(project, historyRows, true);
    res.json({ canDelete: true, mode });
  } catch (err) { next(err); }
});

// ── Project deletion (permanent or soft based on approval history) ─────────────
// Permission: projects.delete (ED and PM only; super_admin via *).
// Body: { reason: string }
// Sequence per spec §13: auth → lock → determine mode → validate → check protected → audit → delete/soft-delete → commit.
router.delete("/projects/:projectId", requirePerm("projects.delete"), async (req, res, next) => {
  const client = await pool.connect();
  try {
    // 1. Authenticated — enforced by requirePerm above.
    if (!req.currentUser) { res.status(401).json({ error: "unauthorized" }); return; }
    const projectId = Number(req.params.projectId as string);
    if (isNaN(projectId)) { res.status(400).json({ error: "invalid project id" }); return; }

    // 7. Validate reason before acquiring locks.
    const { reason } = req.body as { reason?: string };
    const reasonError = validateDeletionReason(reason);
    if (reasonError) { res.status(400).json({ error: "deletion_reason_required", message: reasonError }); return; }
    const cleanReason = (reason as string).trim();

    await client.query("BEGIN");

    // 4. Lock the project row to prevent concurrent deletions.
    const { rows: projectRows } = await client.query<{
      id: number; code: string; title: string; status: string; sector: string; sectors: string[]; deleted_at: Date | null;
    }>(
      `SELECT id, code, title, status, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors, deleted_at FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );
    if (projectRows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "project not found" }); return;
    }
    const project = projectRows[0];
    if (project.deleted_at !== null) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "project already deleted" }); return;
    }
    // The reviewed historical development fixture must never pass through the
    // generic pre-approval permanent-delete path. Its dedicated, development-
    // only retirement operation preserves its child records and history.
    if (isExactDevelopmentTestRetirementTarget(project)) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "development_fixture_retirement_required",
        message: "This reviewed development fixture must be retired through the development-only soft-retirement action.",
      }); return;
    }

    // 3. Verify sector scope — PRJ-BD-05: effective sector set (primary ∪ sectors[]).
    const deleteSectors = [...new Set([
      ...(project.sector ? [project.sector] : []),
      ...(Array.isArray(project.sectors) ? project.sectors : []),
    ])];
    const sectorGuard = assertEffectiveSectorAllowedForProject(req, deleteSectors);
    if (!sectorGuard.ok) {
      await client.query("ROLLBACK");
      res.status(sectorGuard.status).json(sectorGuard.body); return;
    }

    // 3. Verify state scope.
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) {
      await client.query("ROLLBACK");
      res.status(stateGuard.status).json(stateGuard.body); return;
    }
    // 5. Determine whether Final Approval was ever reached (using approvals history).
    const { rows: historyRows } = await client.query<{ toStatus: string }>(
      `SELECT to_status AS "toStatus" FROM approvals WHERE entity_type = 'project' AND entity_id = $1`,
      [projectId],
    );

    // 6. Resolve deletion mode. canDelete=true because requirePerm already passed.
    const mode = getProjectDeletionMode(project, historyRows, true);
    let deletionAudience: Awaited<ReturnType<typeof realtime.captureOperationalAudience>> | undefined;

    const now = new Date();
    const userId = req.currentUser.id;

    // 8. Check protected dependencies before permanent delete.
    if (mode === "permanent") {
      const { rows: spentRows } = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM activities WHERE project_id = $1 AND budget_spent > 0`,
        [projectId],
      );
      if (spentRows[0].cnt > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "protected_records",
          message: "This Project contains protected historical records (posted financial expenditure) and cannot be permanently deleted.",
        }); return;
      }

      const { rows: reportRows } = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM reports WHERE project_id = $1 AND status != 'draft'`,
        [projectId],
      );
      if (reportRows[0].cnt > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "protected_records",
          message: "This Project contains protected historical records (finalised reports) and cannot be permanently deleted.",
        }); return;
      }

      // Lock the exact assignment evidence used by the post-delete audience
      // exception. A concurrent assignment revocation must either commit before
      // this capture (and be excluded) or wait until this deletion removes the
      // assignment itself; it must never invalidate a captured SPO grant in
      // between capture and the cascade delete below.
      await client.query(
        `SELECT project_id, user_id FROM project_assignments WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      );
      deletionAudience = await realtime.captureOperationalAudience?.(
        "project",
        projectId,
        client,
        { projectAssignmentRemovedByDeletion: true },
      );
    } else {
      deletionAudience = await realtime.captureOperationalAudience?.("project", projectId, client);
    }

    // 9. Write audit event BEFORE deletion — must survive permanent delete.
    await client.query(
      `INSERT INTO audit_log (user_id, action, module, entity_id, old_value, new_value)
       VALUES ($1, $2, 'projects', $3, $4, $5)`,
      [
        userId,
        mode === "permanent" ? "permanent_delete" : "soft_delete",
        projectId,
        JSON.stringify({ code: project.code, title: project.title, status: project.status }),
        JSON.stringify({
          deletedBy: userId,
          deletedByName: req.currentUser.name,
          deletedByRole: req.currentUser.role,
          deletionMode: mode,
          reason: cleanReason,
          timestamp: now.toISOString(),
        }),
      ],
    );

    let canonicalAttachmentPaths: string[] = [];

    if (mode === "permanent") {
      // 10. Delete eligible dependent records in dependency order (no blind cascade).
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

      // RISK-005: referential + storage cleanup for linked Risks.
      // Risks are deleted FIRST (RETURNING id), and their application-managed
      // children (plan_activities.risk_id and risk comments — no
      // have DB-level FKs) are purged AFTER. Ordering matters for concurrency:
      // risk-comment and risk-attachment writers lock the parent risk row
      // (SELECT … FOR UPDATE) in the same transaction as their INSERT, so this
      // DELETE blocks until any in-flight writer commits — and the purges
      // below then see the committed child rows. A writer arriving after this
      // DELETE blocks on the row lock and fails closed once it finds no risk.
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

      // 11. Delete the project row itself.
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

    // 12. Commit.
    await client.query("COMMIT");

    for (const path of canonicalAttachmentPaths) {
      await deleteStorageObjectSafely(path).catch((storageErr) => {
        console.error("[project-delete] Canonical attachment storage cleanup failed:", storageErr);
      });
    }

    realtime.broadcastUpdate({
      module: "projects",
      action: "deleted",
      entityId: projectId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
      deletionAudience,
    });
    res.json({ deletionMode: mode, projectId, projectCode: project.code });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.delete("/projects/:projectId/documents/:documentId", requirePerm("documents.upload"), async (req, res, next) => {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "no current user" });
      return;
    }
    const projectId = Number(req.params.projectId);
    const documentId = Number(req.params.documentId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }

    // PRJ-BD-04: Fully-atomic gate + delete + audit.
    // SELECT projects FOR UPDATE locks the project row so a concurrent status
    // transition cannot sneak between the gate check and the DELETE.
    // DELETE ... RETURNING captures metadata atomically — no audit if 0 rows deleted.
    // Storage cleanup runs post-commit (best-effort; deletion already committed).
    let isDeleteOverride = false;
    let deleteOverrideReason: string | null = null;

    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");

      // Lock project against concurrent status transitions
      const { rows: projRows } = await txClient.query<{ status: string }>(
        `SELECT status FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [projectId],
      );
      if (!projRows.length) {
        await txClient.query("ROLLBACK");
        res.status(404).json({ error: "project_not_found" }); return;
      }

      const projectStatus = projRows[0].status;
      const txGate: "mutable" | "operational" | "frozen" =
        ["completed", "closed"].includes(projectStatus) ? "frozen"
        : ["approved", "active"].includes(projectStatus) ? "operational"
        : "mutable";

      if (txGate === "frozen") {
        await txClient.query("ROLLBACK");
        res.status(409).json({
          error: "project_documents_frozen",
          message: "Project documents are locked because the project is closed.",
        }); return;
      }

      if (txGate === "operational") {
        const isOverrideActor = hasFullOperationalAccess(req.currentUser);
        if (!isOverrideActor) {
          await txClient.query("ROLLBACK");
          res.status(409).json({
            error: "project_document_locked_after_approval",
            message: "This document cannot be deleted after project approval.",
          }); return;
        }
        const rawReason = String((req.body as Record<string, unknown>)?.overrideReason ?? "").trim();
        if (!rawReason) {
          await txClient.query("ROLLBACK");
          res.status(400).json({
            error: "override_reason_required",
            message: "An override reason is required to delete a document from an approved project.",
          }); return;
        }
        isDeleteOverride = true;
        deleteOverrideReason = rawReason;
      }

      // Delete and capture metadata atomically; no audit if the row is already gone
      const { rows: deletedRows } = await txClient.query<{
        file_name: string; kind: string; category: string;
      }>(
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
        res.status(404).json({ error: "document_not_found" }); return;
      }

      const deletedDoc = deletedRows[0];
      // Document identity preserved in audit even after the row is gone
      const docLabel = `${deletedDoc.file_name} (${deletedDoc.kind})`;

      await txClient.query(
        `INSERT INTO audit_log
           (user_id, action, module, entity_id, old_value, new_value, used_override, override_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.currentUser.id,
          isDeleteOverride ? "document_delete_override" : "document_delete",
          "projects",
          projectId,
          docLabel,
          isDeleteOverride ? deleteOverrideReason : null,
          isDeleteOverride,
          isDeleteOverride ? deleteOverrideReason : null,
        ],
      );

      await txClient.query("COMMIT");
    } catch (txErr) {
      await txClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    realtime.broadcastUpdate({
      module: "projects",
      action: "document_deleted",
      entityId: projectId,
      actorId: req.currentUser.id,
      actorName: req.currentUser.name,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── Project report KPIs (aggregated from project reports) ─────────────────────

// PRJ-034 — Canonical KPI source contract (documented, not a dual-source defect):
//   • Beneficiary/budget aggregates (beneficiariesReached, totalPlannedBudget,
//     totalActualExpenditure, burnRatePct) — canonical source is the `reports`
//     table's relational columns (beneficiaries_*, planned_budget,
//     actual_expenditure). These are report-level totals.
//   • Activity completion/progress KPIs (totalActivities, completedActivities,
//     activityCompletionPct, avgActivityProgressPct, activitiesOn/Under/Over
//     Budget) — canonical source is the JSONB `reports.activities` array
//     (per-report activity snapshots), expanded via jsonb_array_elements.
//     There is NO fallback to the relational `activities` table and this
//     endpoint deliberately never JOINs it — the relational table holds the
//     project's planned Results-Framework activities, not reported progress,
//     so joining it would double-count. Each dimension has exactly one source.
router.get("/projects/:projectId/report-kpis", async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }

    const { rows } = await pool.query<{
      reportCount: string;
      beneficiariesReached: string;
      totalPlannedBudget: string;
      totalActualExpenditure: string;
      latestPeriod: string | null;
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

    // Aggregate activities from all qualifying project reports
    const activitiesRes = await pool.query<{
      totalActivities: string;
      completedActivities: string;
      avgPercent: string;
    }>(`
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

    // Budget status counts from activity JSONB
    const budgetStatusRes = await pool.query<{
      onBudget: string;
      underBudget: string;
      overBudget: string;
    }>(`
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

    res.json({
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
  } catch (err) {
    next(err);
  }
});

// ── Project activities ────────────────────────────────────────────────────────

// ── Scoped activities list — Activity Report selector ────────────────────────
// Returns activities the current user is authorised to report on.
// Optional ?projectId= narrows results to a specific project (used as a filter,
// not a security boundary — the WHERE clause still enforces role scoping).
router.get("/activities", async (req, res, next) => {
  try {
    const user = req.currentUser;
    if (!user) { res.status(401).json({ error: "unauthorized" }); return; }

    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    const role = user.role ?? "";

    // ── Explicit role allowlist (fail-closed) ────────────────────────────────
    // Organisation-wide visibility: only granted to these explicitly authorised roles.
    const ORG_WIDE_ROLES = new Set([
      "super_admin",
      "executive_director",
      "program_manager",
      "senior_program_coordinator",
    ]);
    // State-scoped: restricted to activities in their assigned state.
    // Canonical backend role IDs only — aliases "state_manager" and "state_officer" removed.
    const STATE_SCOPED_ROLES = new Set([
      "state_program_officer",
      "state_office_manager",
    ]);
    // Sector-scoped: restricted to their assigned sector(s).
    const SECTOR_SCOPED_ROLES = new Set([
      "technical_coordinator",
      "hq_sector_coordinator",
      "hq_sector_officer",
    ]);
    const ALL_KNOWN_ROLES = new Set([
      ...ORG_WIDE_ROLES,
      ...STATE_SCOPED_ROLES,
      ...SECTOR_SCOPED_ROLES,
    ]);

    if (!ALL_KNOWN_ROLES.has(role)) {
      // Fail closed: unrecognised or unapproved roles may not browse activities.
      res.status(403).json({ error: "role_not_authorised_for_activity_access" });
      return;
    }

    const params: unknown[] = [];
    const conditions: string[] = [];

    // State-scoped roles — restrict to their single assigned state.
    // Fail-closed: a state-role user with no stateId returns an empty list.
    if (STATE_SCOPED_ROLES.has(role)) {
      const userStateId = user.stateId ?? null;
      if (userStateId === null) {
        res.json([]);
        return;
      }
      params.push(userStateId);
      conditions.push(`(a.state_id = $${params.length} OR p.id IN (SELECT project_id FROM project_states WHERE state_id = $${params.length}))`);
    }

    // Technical Coordinator — sector-scoped ONLY (no state restriction).
    // Geographic scope is determined exclusively by assigned sectors, matching
    // the tcSectorRestriction() contract in currentUser.ts: empty sectors list
    // means "no sectors assigned" → fail-closed, returns nothing.
    // For standalone activities (project_id IS NULL) the authoritative sector is
    // a.sector itself — it must fall within the TC's assigned sectors.
    if (role === "technical_coordinator") {
      const tcSectors = user.sectors ?? []; // null → [] (fail-closed)
      if (tcSectors.length === 0) {
        res.json([]);
        return;
      }
      params.push(tcSectors);
      conditions.push(
        `(p.sector = ANY($${params.length}::text[]) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.sectors, '[]'::jsonb)) s WHERE s = ANY($${params.length}::text[])) OR (a.project_id IS NULL AND a.sector = ANY($${params.length}::text[])))`
      );
    }

    // HQ sector roles — restricted to their assigned sector; standalone activities included.
    // For standalone activities (project_id IS NULL) the authoritative sector is
    // a.sector itself — it must match the user's assigned sector.
    if (role === "hq_sector_coordinator" || role === "hq_sector_officer") {
      const userSector = user.sector ?? null;
      if (!userSector) {
        res.json([]);
        return;
      }
      params.push(userSector);
      conditions.push(
        `(p.sector = $${params.length} OR (a.project_id IS NULL AND a.sector = $${params.length}))`
      );
    }

    // Org-wide roles: no extra conditions — all activities visible up to LIMIT.

    // Optional project filter — narrows the list; does not widen the authorisation boundary.
    if (projectId && !Number.isNaN(projectId)) {
      params.push(projectId);
      conditions.push(`a.project_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Optional locationType filter — org-wide users may filter by HQ or state.
    // State-scoped roles already have their state clamped above; locationType filter
    // is ignored for them (they cannot see HQ activities anyway).
    if (!STATE_SCOPED_ROLES.has(role)) {
      const ltFilter = req.query.locationType ? String(req.query.locationType) : null;
      if (ltFilter === "hq") {
        conditions.push(`a.location_type = 'hq'`);
      } else if (ltFilter === "state") {
        conditions.push(`(a.location_type = 'state' OR (a.location_type IS NULL AND a.state_id IS NOT NULL))`);
      }
    }

    const { rows } = await pool.query(
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
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId/activities", async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const { rows } = await pool.query(
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
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId/indicators", async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    const effectiveSectors = await getProjectEffectiveSectors(projectId);
    if (!effectiveSectors) { res.status(404).json({ error: "project not found" }); return; }
    const guard = assertEffectiveSectorAllowedForProject(req, effectiveSectors.all);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
    const stateGuard = await assertStateAllowed(req, projectId);
    if (!stateGuard.ok) { res.status(stateGuard.status).json(stateGuard.body); return; }
    const { rows } = await pool.query(
      `SELECT id, code, title, unit, target::float AS target, achieved::float AS achieved,
              output_id AS "outputId", sector
       FROM indicators WHERE project_id = $1 ORDER BY code`,
      [projectId],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── Project budget ────────────────────────────────────────────────────────────
// PRJ-014: Explicit permission guard and TC Sector scope added. budget.view is
// the established read-only financial permission shared by all legitimate budget
// readers: PM, SPC, TC (own-sector), ED, SOM (own-state), SPO (own-state),
// Viewer, and Super Admin. projects.update would exclude ED and SOM, which hold
// budget.view but not projects.update, so budget.view is the correct gate here.

router.get("/projects/:projectId/budget", requirePerm("budget.view"), async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    // Include deleted_at IS NULL, sector and sectors for scope enforcement.
    const proj = await pool.query(
      `SELECT budget_total::float AS total, sector, COALESCE(sectors,'[]'::jsonb)::jsonb AS sectors FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    if (proj.rows.length === 0) {
      res.status(404).json({ error: "project not found" });
      return;
    }

    // PRJ-014: Sector scope enforcement for TC callers.
    // PRJ-BD-05: use effective sector set (union of primary + sectors[]).
    const effectiveSectorsForBudget = [...new Set([
      ...(proj.rows[0].sector ? [proj.rows[0].sector as string] : []),
      ...((proj.rows[0].sectors as string[]) ?? []),
    ])];
    const sectorGuardBudget = assertEffectiveSectorAllowedForProject(req, effectiveSectorsForBudget);
    if (!sectorGuardBudget.ok) { res.status(sectorGuardBudget.status).json(sectorGuardBudget.body); return; }

    // ── State-role security guard ─────────────────────────────────────────────
    // Uses the same centralized guard as every other project route (state_office_manager
    // scoped to project_states, state_program_officer scoped to their explicit
    // project_assignments) instead of this endpoint's own independently-broader
    // OR-of-both-tables check.
    const stateGuardBudget = await assertStateAllowed(req, projectId);
    if (!stateGuardBudget.ok) { res.status(stateGuardBudget.status).json(stateGuardBudget.body); return; }
    // ─────────────────────────────────────────────────────────────────────────
    const total = proj.rows[0].total as number;
    const outputs = await pool.query(
      `SELECT id, code, title FROM outputs WHERE project_id = $1 ORDER BY code`,
      [projectId],
    );
    const activities = await pool.query(
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
      // matches Dashboard's convention: a manufactured 0% would misread as
      // "fully unspent" rather than "no budget recorded yet".
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
    // activities.output_id is nullable by design (standalone activities with
    // no output parent), and their spend was previously invisible to this
    // total even though Dashboard's own budget queries (SUM(budget_spent)
    // FROM activities, ungated by output) always included it. A project with
    // spend on unlinked activities showed a lower "spent" and healthier burn
    // rate here than on the Dashboard for the exact same project.
    const spent = activities.rows.reduce((s, a) => s + Number(a.spent), 0);
    const remaining = total - spent;
    const burnRatePct = total > 0 ? Math.round((spent / total) * 100) : null;
    // ── Monthly burn chart — deterministic, derived from activity date ranges ──
    // Distribute each activity's budget linearly across its planned_start → planned_end
    // window and accumulate per calendar month. This replaces the prior Math.random()
    // implementation that returned non-deterministic data on every request.
    const now = new Date();
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const monthLabel = monthStart.toLocaleString("en", { month: "short", year: "2-digit" });
      let cumulPlanned = 0;
      let cumulActual  = 0;
      for (const a of activities.rows) {
        if (!a.plannedStart || !a.plannedEnd) continue;
        const actStart = new Date(a.plannedStart as string);
        const actEnd   = new Date(a.plannedEnd   as string);
        const durationMs = actEnd.getTime() - actStart.getTime();
        if (durationMs <= 0) continue;
        // Fraction of activity that falls on or before end of this month
        const cappedEnd = monthEnd < actEnd ? monthEnd : actEnd;
        const elapsedMs = Math.max(0, cappedEnd.getTime() - actStart.getTime());
        const frac = Math.min(1, elapsedMs / durationMs);
        cumulPlanned += frac * Number(a.planned);
        cumulActual  += frac * Number(a.spent);
      }
      monthly.push({ month: monthLabel, planned: Math.round(cumulPlanned), actual: Math.round(cumulActual) });
    }
    const alerts: Array<{ level: string; message: string }> = [];
    if (burnRatePct !== null && burnRatePct > 80) alerts.push({ level: "high", message: `Burn rate at ${burnRatePct}% — review remaining activities` });
    for (const line of lines) {
      if (line.burnRatePct !== null && line.burnRatePct > 90) alerts.push({ level: "high", message: `${line.label} overspending (${line.burnRatePct}%)` });
      else if (line.burnRatePct !== null && line.burnRatePct < 20 && total > 0) alerts.push({ level: "medium", message: `${line.label} under-utilized (${line.burnRatePct}%)` });
    }
    res.json({ projectId, total, spent, remaining, burnRatePct, lines, monthly, alerts });
  } catch (err) {
    next(err);
  }
});

// ── State Allocations ─────────────────────────────────────────────────────────

// PRJ-005: Explicit permission guard and project-access scope guards added.
// budget.view is the established read-only financial permission covering all
// legitimate allocation readers, including ED and SOM who lack projects.update
// but must be able to read allocation data within their scope.
router.get("/projects/:projectId/state-allocations", requirePerm("budget.view"), async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId as string);

    // Sector scope guard (TC callers).
    // PRJ-BD-05: use effective sector set (union of primary + sectors[]).
    const scopeSectorAlloc = await getProjectEffectiveSectors(projectId);
    if (!scopeSectorAlloc) { res.status(404).json({ error: "project not found" }); return; }
    const sectorGuardAllocGet = assertEffectiveSectorAllowedForProject(req, scopeSectorAlloc.all);
    if (!sectorGuardAllocGet.ok) { res.status(sectorGuardAllocGet.status).json(sectorGuardAllocGet.body); return; }

    // State scope guard (SPO/SOM callers). assertStateAllowed fails closed for null stateId.
    const stateGuardAllocGet = await assertStateAllowed(req, projectId);
    if (!stateGuardAllocGet.ok) { res.status(stateGuardAllocGet.status).json(stateGuardAllocGet.body); return; }

    // Row-level filter: State roles see only their own State's allocation row.
    // This preserves existing SPO/SOM clamping behaviour post-scope-check.
    const isStateRole = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    const stateIdFilter = isStateRole ? (req.currentUser?.stateId ?? null) : null;
    const params: unknown[] = [projectId];
    let stateClause = "";
    if (stateIdFilter !== null) {
      params.push(stateIdFilter);
      stateClause = ` AND psa.state_id = $${params.length}`;
    }
    const { rows } = await pool.query(
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
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/projects/:projectId/state-allocations", requirePerm("projects.update"), async (req, res, next) => {
  // Parse before acquiring a client so malformed bodies cannot begin, roll back,
  // or otherwise resemble a financial mutation.
  const { allocations } = UpsertProjectStateAllocationsBody.parse(req.body);
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.projectId);
    // Keep the replace-all write route aligned with its required OpenAPI body.
    // In particular, an omitted allocations array must be rejected rather than
    // being interpreted as an empty replacement that erases stored allocations.

    // Sector and state scope guards (mirrors other project mutation endpoints).
    // Note: early returns here do NOT call client.release() — the finally block owns cleanup.
    // PRJ-BD-05: use effective sector set (union of primary + sectors[]).
    const scopeSector = await getProjectEffectiveSectors(projectId);
    if (!scopeSector) { res.status(404).json({ error: "project not found" }); return; }
    const sectorGuardAlloc = assertEffectiveSectorAllowedForProject(req, scopeSector.all);
    if (!sectorGuardAlloc.ok) { res.status(sectorGuardAlloc.status).json(sectorGuardAlloc.body); return; }
    const stateGuardAlloc = await assertStateAllowed(req, projectId);
    if (!stateGuardAlloc.ok) { res.status(stateGuardAlloc.status).json(stateGuardAlloc.body); return; }

    // PRJ-033: Validate that every supplied stateId is linked to this project via
    // project_states. Full Operational Access (PM/Super Admin) does NOT bypass this
    // constraint — a PM cannot allocate to a state not linked to the project.
    if (allocations && allocations.length > 0) {
      const suppliedStateIds = allocations.map((a) => a.stateId);
      const { rows: linkedStateRows } = await pool.query<{ state_id: number }>(
        `SELECT state_id FROM project_states WHERE project_id = $1 AND state_id = ANY($2::int[])`,
        [projectId, suppliedStateIds],
      );
      const linkedStateIdSet = new Set(linkedStateRows.map((r) => r.state_id));
      const unlinked = suppliedStateIds.find((sid) => !linkedStateIdSet.has(sid));
      if (unlinked !== undefined) {
        // No client.release() here — the finally block owns cleanup for all early exits.
        res.status(422).json({
          error: "project_state_not_linked",
          message: "The specified state is not linked to this project.",
        });
        return;
      }
      // A pre-existing inactive project_state relationship remains readable for
      // history, but this replace-all allocation write is new financial work.
      // Do not permit it to add or refresh funds against an inactive State.
      for (const stateId of suppliedStateIds) {
        const activeState = await assertActiveState(Number(stateId));
        if (!activeState.ok) {
          res.status(422).json({
            error: activeState.error,
            message: "State allocations can only be created for active States.",
          });
          return;
        }
      }
    }

    // Validate all allocations before touching the DB.
    for (const alloc of allocations ?? []) {
      if ((alloc.budgetAllocation ?? 0) < 0) {
        res.status(422).json({ error: "invalid_allocation", message: "Budget allocation cannot be negative." });
        return;
      }
    }

    const allocTotal = (allocations ?? []).reduce((s, a) => s + (a.budgetAllocation ?? 0), 0);

    await client.query("BEGIN");
    // BUD-BD-01: read the project budget INSIDE the transaction under a row lock so
    // a concurrent budget PATCH or allocation replace cannot race past the cap check.
    const { rows: projBudgetRows } = await client.query<{ budget: number }>(
      `SELECT COALESCE(budget_total::float, 0) AS budget FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [projectId],
    );
    if (!projBudgetRows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "project not found" });
      return;
    }
    const projectBudget = projBudgetRows[0].budget;
    // Over-allocation guard: sum of submitted allocations must not exceed project
    // budget_total. UNCONDITIONAL — applies when budget_total = 0 too (a positive
    // allocation against a zero budget is over-cap). Actor-independent: PM/SA
    // cannot bypass.
    if (allocTotal > projectBudget) {
      await client.query("ROLLBACK");
      res.status(422).json({
        error: "over_allocation",
        message: `Total state allocations (${allocTotal.toFixed(2)}) would exceed the project budget (${projectBudget.toFixed(2)}).`,
      });
      return;
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
          alloc.budgetAllocation ?? null,
          alloc.beneficiaryTarget ?? null,
          alloc.beneficiaryMale ?? null,
          alloc.beneficiaryFemale ?? null,
          alloc.beneficiaryBoys ?? null,
          alloc.beneficiaryGirls ?? null,
          alloc.activityTarget ?? null,
          alloc.indicatorTarget ?? null,
          alloc.stateLead ?? null,
          JSON.stringify(alloc.stateTeam ?? []),
          alloc.notes ?? null,
        ],
      );
    }
    await client.query("COMMIT");

    // BUD audit: state allocation replacement is a financial mutation and must be traceable.
    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "state_allocations_replace",
      module: "projects",
      entityId: projectId,
      newValue: JSON.stringify(
        (allocations ?? []).map((a) => ({ stateId: a.stateId, budgetAllocation: a.budgetAllocation ?? null })),
      ),
    });
    realtime.broadcastUpdate({
      module: "projects",
      action: "state_allocations_updated",
      entityId: projectId,
      actorId: req.currentUser?.id,
      actorName: req.currentUser?.name,
    });

    // Return allocations scoped to the requesting state role (same semantics as GET).
    const isStateRolePost = req.currentUser?.role === "state_program_officer" || req.currentUser?.role === "state_office_manager";
    const stateIdFilterPost = isStateRolePost ? (req.currentUser?.stateId ?? null) : null;
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
    res.json(rows);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

export default router;
