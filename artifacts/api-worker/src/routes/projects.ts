import { Hono } from "hono";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, tcSectorRestriction, assertStateAllowed, type CurrentUser, type Variables } from "../lib/rbac";

/**
 * Ported from artifacts/api-server/src/routes/projects.ts — READ paths only
 * (list + detail) for this batch. projects.ts is the largest and most
 * complex file in the whole migration (4008 lines): the write routes
 * (create/update/transitions/delete) run inside real Postgres transactions
 * with row locking (budget allocation caps, optimistic concurrency via
 * x-base-revision, nested results-framework writes for outputs/indicators/
 * activities) and deserve a dedicated, separately-verified batch rather
 * than being rushed through alongside everything else. Deferred to that
 * batch: POST/PATCH/DELETE /projects, /transitions, /merge,
 * /duplicate-check, /donors*, /development-test-retirement,
 * /donor-correction, /deletion-info, /reporting-coverage,
 * /documents (project-level), /activities, /indicators, /budget,
 * /state-allocations, /report-kpis.
 *
 * Also not ported here: notification creation (createNotificationDeduped,
 * notifyEntityActors, checkAndFireBudgetAlert — lib/notifications.ts's
 * ~900-line preference/dedup engine, same reasoning as it was deferred for
 * routes/notifications.ts) and realtime.broadcastUpdate (deferred to the
 * Durable Objects phase, same as everywhere else).
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

export const projectsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

projectsRoutes.use("/projects", attachCurrentUser, requireAuth);
projectsRoutes.use("/projects/:projectId", attachCurrentUser, requireAuth);

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
