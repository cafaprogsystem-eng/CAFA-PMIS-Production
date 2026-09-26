import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, permissionsFor, tcSectorRestriction, type Variables } from "../lib/rbac";

/**
 * Ported from artifacts/api-server/src/routes/search.ts.
 *
 * GET /search?q=<term>&limit=<n> — matching projects, plans, reports, risks,
 * documents, states, and (for admins/PMs) users. Each category capped at
 * `limit` results (default 5).
 */

export const searchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

searchRoutes.get("/search", attachCurrentUser, requireAuth, async (c) => {
  const raw = (c.req.query("q") ?? "").trim();
  if (!raw) {
    return c.json({ projects: [], plans: [], reports: [], risks: [], documents: [], users: [], states: [] });
  }

  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "5", 10) || 5), 20);
  const q = `%${raw}%`;

  const user = c.get("currentUser")!;
  const perms = permissionsFor(user);
  const hasAll = perms.includes("*");

  // ── RBAC helpers ──────────────────────────────────────────────────
  const isStateRole =
    user.role === "state_program_officer" || user.role === "state_office_manager";
  if (isStateRole && !user.stateId) {
    // Fail-closed: a state-scoped role with no assigned state must see
    // nothing, not an unscoped organisation-wide result set (same rule as
    // the report-list and plan-list scopes).
    return c.json({ error: "no state assigned" }, 403);
  }
  const canViewUsers =
    hasAll || perms.includes("users.view") || perms.includes("users.manage");
  const tcSectors = tcSectorRestriction(user);

  const { db, close } = openDb(c);
  try {
    // ── Projects ──────────────────────────────────────────────────────
    const projectParams: unknown[] = [q, limit];
    let projectWhere = `(p.title ILIKE $1 OR p.code ILIKE $1 OR p.donor ILIKE $1)`;
    if (isStateRole && user.stateId) {
      projectParams.push(user.stateId);
      projectWhere += ` AND EXISTS (
        SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.state_id = $${projectParams.length}
      )`;
    }
    if (tcSectors) {
      projectParams.push(tcSectors);
      projectWhere += ` AND (p.sector = ANY($${projectParams.length}::text[]))`;
    }

    // ── Reports ───────────────────────────────────────────────────────
    const reportParams: unknown[] = [q, limit];
    const reportFilters: string[] = [
      `(r.title ILIKE $1 OR p.title ILIKE $1 OR s.name ILIKE $1)`,
    ];
    if (isStateRole && user.stateId) {
      reportParams.push(user.stateId);
      reportFilters.push(`r.state_id = $${reportParams.length}`);
    }
    if (tcSectors) {
      reportParams.push(tcSectors);
      reportFilters.push(
        `(r.sector = ANY($${reportParams.length}::text[]) OR p.sector = ANY($${reportParams.length}::text[]))`,
      );
    }

    // ── Risks ─────────────────────────────────────────────────────────
    const riskParams: unknown[] = [q, limit];
    const riskFilters: string[] = [
      `(r.title ILIKE $1 OR r.category ILIKE $1 OR r.description ILIKE $1)`,
    ];
    if (isStateRole && user.stateId) {
      riskParams.push(user.stateId);
      riskFilters.push(`r.state_id = $${riskParams.length}`);
    }
    if (tcSectors) {
      riskParams.push(tcSectors);
      riskFilters.push(`p.sector = ANY($${riskParams.length}::text[])`);
    }

    // ── Plans ─────────────────────────────────────────────────────────
    const planParams: unknown[] = [q, limit];
    const planFilters: string[] = [
      `(pl.title ILIKE $1 OR pl.code ILIKE $1)`,
    ];
    if (isStateRole && user.stateId) {
      planParams.push(user.stateId);
      planFilters.push(`pl.state_id = $${planParams.length}`);
    }
    if (tcSectors) {
      planParams.push(tcSectors);
      planFilters.push(
        `(pl.sector = ANY($${planParams.length}::text[]) OR p.sector = ANY($${planParams.length}::text[]))`,
      );
    }

    // ── States ────────────────────────────────────────────────────────
    // States are not sector-partitioned (tcSectors does not apply here,
    // same as the users query below). A state-scoped role can only ever
    // match its own single assigned state.
    const stateParams: unknown[] = [q, limit];
    let stateWhere = `(s.name ILIKE $1 OR s.name_ar ILIKE $1 OR s.code ILIKE $1)`;
    if (isStateRole && user.stateId) {
      stateParams.push(user.stateId);
      stateWhere += ` AND s.id = $${stateParams.length}`;
    }

    // ── Documents (project_documents) ────────────────────────────────
    const docParams: unknown[] = [q, limit];
    const docFilters: string[] = [
      `(pd.file_name ILIKE $1 OR pd.category ILIKE $1 OR pd.kind ILIKE $1)`,
    ];
    if (isStateRole && user.stateId) {
      docParams.push(user.stateId);
      docFilters.push(
        `EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = pd.project_id AND ps.state_id = $${docParams.length})`,
      );
    }
    if (tcSectors) {
      docParams.push(tcSectors);
      docFilters.push(`p.sector = ANY($${docParams.length}::text[])`);
    }

    // ── Fire all queries in parallel ──────────────────────────────────
    const [projectsResult, reportsResult, usersResult, risksResult, plansResult, documentsResult, statesResult] =
      await Promise.all([
        db.query<{
          id: number; code: string; title: string; status: string; sector: string | null;
        }>(
          `SELECT p.id, p.code, p.title, p.status, p.sector
           FROM projects p
           WHERE ${projectWhere}
           ORDER BY (CASE WHEN p.status = 'active' THEN 0 ELSE 1 END), p.title
           LIMIT $2`,
          projectParams,
        ),

        db.query<{
          id: number; title: string; kind: string | null; status: string;
          reportType: string | null; projectTitle: string | null; stateName: string | null; stateNameAr: string | null;
          updatedAt: Date | null;
        }>(
          `SELECT r.id, r.title, r.kind, r.status,
                  r.report_type AS "reportType",
                  p.title AS "projectTitle",
                  s.name AS "stateName",
                  s.name_ar AS "stateNameAr",
                  r.submitted_at AS "updatedAt"
           FROM reports r
           LEFT JOIN projects p ON p.id = r.project_id
           LEFT JOIN states s ON s.id = r.state_id
           WHERE ${reportFilters.join(" AND ")}
           ORDER BY r.submitted_at DESC NULLS LAST
           LIMIT $2`,
          reportParams,
        ),

        canViewUsers
          ? db.query<{
              id: number; name: string; email: string; roleLabel: string; status: string;
            }>(
              `SELECT u.id, u.name, u.email,
                      u.role_label AS "roleLabel", u.status
               FROM users u
               WHERE (u.name ILIKE $1 OR u.email ILIKE $1 OR u.username ILIKE $1)
                 AND u.status != 'deactivated'
               ORDER BY u.name
               LIMIT $2`,
              [q, limit],
            )
          : Promise.resolve({
              rows: [] as { id: number; name: string; email: string; roleLabel: string; status: string }[],
              rowCount: 0,
            }),

        db.query<{
          id: number; title: string; category: string | null; severity: string; status: string;
          projectTitle: string | null; stateName: string | null; stateNameAr: string | null; updatedAt: Date | null;
        }>(
          `SELECT r.id, r.title, r.category, r.severity, r.status,
                  p.title AS "projectTitle", s.name AS "stateName", s.name_ar AS "stateNameAr",
                  r.updated_at AS "updatedAt"
           FROM risks r
           JOIN states s ON s.id = r.state_id
           LEFT JOIN projects p ON p.id = r.project_id
           WHERE ${riskFilters.join(" AND ")}
           ORDER BY (CASE WHEN r.status = 'open' THEN 0 ELSE 1 END), r.updated_at DESC NULLS LAST
           LIMIT $2`,
          riskParams,
        ),

        db.query<{
          id: number; title: string; code: string; planType: string | null; status: string;
          projectTitle: string | null; stateName: string | null; stateNameAr: string | null; updatedAt: Date | null;
        }>(
          `SELECT pl.id, pl.title, pl.code, pl.plan_type AS "planType", pl.status,
                  p.title AS "projectTitle", s.name AS "stateName", s.name_ar AS "stateNameAr",
                  pl.updated_at AS "updatedAt"
           FROM plans pl
           LEFT JOIN projects p ON p.id = pl.project_id
           LEFT JOIN states s ON s.id = pl.state_id
           WHERE ${planFilters.join(" AND ")}
           ORDER BY (CASE WHEN pl.status IN ('active','in_progress') THEN 0 ELSE 1 END), pl.updated_at DESC NULLS LAST
           LIMIT $2`,
          planParams,
        ),

        db.query<{
          id: number; fileName: string; category: string | null; kind: string | null;
          projectId: number | null; projectTitle: string | null; uploadedAt: Date | null;
        }>(
          `SELECT pd.id, pd.file_name AS "fileName", pd.category, pd.kind,
                  pd.project_id AS "projectId", p.title AS "projectTitle",
                  pd.uploaded_at AS "uploadedAt"
           FROM project_documents pd
           LEFT JOIN projects p ON p.id = pd.project_id
           WHERE ${docFilters.join(" AND ")}
           ORDER BY pd.uploaded_at DESC NULLS LAST
           LIMIT $2`,
          docParams,
        ),

        db.query<{
          id: number; name: string; nameAr: string; code: string;
          operationalStatus: string; officeStatus: string;
        }>(
          `SELECT s.id, s.name, s.name_ar AS "nameAr", s.code,
                  s.operational_status AS "operationalStatus", s.office_status AS "officeStatus"
           FROM states s
           WHERE ${stateWhere}
           ORDER BY s.name
           LIMIT $2`,
          stateParams,
        ),
      ]);

    return c.json({
      projects: projectsResult.rows,
      plans: plansResult.rows,
      reports: reportsResult.rows,
      risks: risksResult.rows,
      documents: documentsResult.rows,
      users: usersResult.rows,
      states: statesResult.rows,
    });
  } finally {
    close();
  }
});
