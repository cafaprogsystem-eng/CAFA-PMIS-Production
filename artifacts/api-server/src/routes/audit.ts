import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  auditActionCategorySql, AuditLogQueryParams, categorizeAuditAction, normalizeAuditActionCategory,
} from "@workspace/api-zod";
import { requirePerm } from "../middlewares/currentUser";

const router: IRouter = Router();

type SafeChange = { field: string; before: string | null; after: string | null };

const SENSITIVE_KEY = /password|token|secret|credential|authorization|cookie|session|jwt|private.?key|storage|object.?path|invite|hash|salt/i;
const VALUE_HIDDEN_MODULE = new Set([
  "ai", "auth", "conversation", "drive", "files", "messages", "password_reset", "profile",
  "voice_notes",
]);
const DISPLAYABLE_CHANGE_FIELDS = new Set([
  "title", "name", "code", "status", "state", "sector", "subsector", "subsectors",
  "assistancemodality", "startdate", "enddate", "date", "period", "currency",
  "budget", "budgettotal", "amount", "planned", "actual", "progress", "priority",
  "risklevel", "likelihood", "impact", "mitigation", "description", "category",
  "type", "frequency", "visibility", "active", "approved", "approvalstatus", "role",
]);

function safeText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || SENSITIVE_KEY.test(text)) return null;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function safeObject(value: unknown, prefix = ""): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (SENSITIVE_KEY.test(key) || /(^|[_-])id(s)?$|Id(s)?$/.test(key)) continue;
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!DISPLAYABLE_CHANGE_FIELDS.has(normalizedKey)) continue;
    const field = prefix ? `${prefix}.${key}` : key;
    if (raw === null || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      result.set(field, safeText(raw));
    }
  }
  return result;
}

function safeChanges(module: string, oldValue: unknown, newValue: unknown): SafeChange[] {
  if (VALUE_HIDDEN_MODULE.has(module)) return [];
  const oldText = typeof oldValue === "string" ? oldValue : oldValue == null ? null : String(oldValue);
  const newText = typeof newValue === "string" ? newValue : newValue == null ? null : String(newValue);
  let oldParsed: unknown = oldText;
  let newParsed: unknown = newText;
  try { if (oldText?.startsWith("{")) oldParsed = JSON.parse(oldText); } catch { /* scalar */ }
  try { if (newText?.startsWith("{")) newParsed = JSON.parse(newText); } catch { /* scalar */ }

  const oldMap = safeObject(oldParsed);
  const newMap = safeObject(newParsed);
  if (oldMap.size || newMap.size) {
    const fields = new Set([...oldMap.keys(), ...newMap.keys()]);
    return [...fields]
      .map((field) => ({ field, before: oldMap.get(field) ?? null, after: newMap.get(field) ?? null }))
      .filter((change) => change.before !== change.after)
      .slice(0, 8);
  }
  // Scalar history has no authoritative field name. Returning it as a generic
  // "value" can leak opaque credentials or sensitive free text, so only
  // explicitly named safe JSON properties are eligible for detail output.
  return [];
}

const entityReferenceSql = `
  CASE
    WHEN a.module IN ('project', 'projects') THEN (
      SELECT COALESCE(p.code, 'Project') || CASE WHEN p.title IS NULL THEN '' ELSE ' — ' || p.title END
      FROM projects p WHERE p.id = a.entity_id
    )
    WHEN a.module = 'plans' THEN (
      SELECT COALESCE(pl.code, 'Plan') || CASE WHEN pl.title IS NULL THEN '' ELSE ' — ' || pl.title END
      FROM plans pl WHERE pl.id = a.entity_id
    )
    WHEN a.module = 'reports' THEN (
      SELECT 'Report' || CASE WHEN r.title IS NULL THEN '' ELSE ' — ' || r.title END
      FROM reports r WHERE r.id = a.entity_id
    )
    WHEN a.module = 'risks' THEN (
      SELECT 'Risk' || CASE WHEN ri.title IS NULL THEN '' ELSE ' — ' || ri.title END
      FROM risks ri WHERE ri.id = a.entity_id
    )
    WHEN a.module = 'users' THEN (
      SELECT COALESCE(u2.name, u2.email, 'User') FROM users u2 WHERE u2.id = a.entity_id
    )
    WHEN a.module = 'states' THEN (
      SELECT s.name FROM states s WHERE s.id = a.entity_id
    )
    ELSE NULL
  END
`;

function emptyResponse(page: number, pageSize: number) {
  return { items: [], total: 0, page, pageSize, totalPages: 0, summary: { created: 0, updated: 0, deleted: 0, approved: 0 } };
}

/**
 * GET /audit-log
 *
 * The scope predicates in this route are intentionally independent from all
 * client filters. They are the authority for what a restricted role can see.
 */
router.get("/audit-log", requirePerm("audit.view"), async (req, res, next): Promise<void> => {
  try {
    const parsed = AuditLogQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_audit_filters" });
      return;
    }
    const query = parsed.data;
    const role = req.currentUser!.role;
    const userStateId = req.currentUser!.stateId;
    const userSectors = req.currentUser!.sectors;
    const baseFilters: string[] = [];
    const baseParams: unknown[] = [];
    const isStateRole = role === "state_office_manager" || role === "state_program_officer";
    const isTC = role === "technical_coordinator";

    if (isStateRole) {
      if (!userStateId) {
        res.json(emptyResponse(query.page, query.pageSize));
        return;
      }
      baseParams.push(userStateId);
      const p = baseParams.length;
      baseFilters.push(`(
        (a.module IN ('projects', 'project') AND a."entityId" IN (SELECT project_id FROM project_states WHERE state_id = $${p}))
        OR (a.module = 'reports' AND a."entityId" IN (SELECT id FROM reports WHERE state_id = $${p}))
        OR (a.module = 'risks' AND a."entityId" IN (SELECT id FROM risks WHERE state_id = $${p}))
        OR (a.module = 'plans' AND a."entityId" IN (SELECT id FROM plans WHERE state_id = $${p}))
      )`);
    } else if (isTC) {
      if (!userSectors || userSectors.length === 0) {
        res.json(emptyResponse(query.page, query.pageSize));
        return;
      }
      baseParams.push(userSectors);
      const p = baseParams.length;
      baseFilters.push(`(
        (a.module IN ('projects', 'project') AND a."entityId" IN (SELECT id FROM projects WHERE sector = ANY($${p}::text[])))
        OR (a.module = 'reports' AND a."entityId" IN (
          SELECT r.id FROM reports r WHERE r.sector = ANY($${p}::text[])
          OR r.project_id IN (SELECT id FROM projects WHERE sector = ANY($${p}::text[]))
        ))
        OR (a.module = 'risks' AND a."entityId" IN (
          SELECT ri.id FROM risks ri WHERE ri.project_id IN (SELECT id FROM projects WHERE sector = ANY($${p}::text[]))
        ))
        OR (a.module = 'plans' AND a."entityId" IN (SELECT id FROM plans WHERE sector = ANY($${p}::text[])))
      )`);
    }

    const module = query.module ?? query.entityType;
    if (module) { baseParams.push(module); baseFilters.push(`a.module = $${baseParams.length}`); }
    if (query.search) {
      baseParams.push(`%${query.search}%`);
      const p = baseParams.length;
      baseFilters.push(`(a.action ILIKE $${p} OR a.module ILIKE $${p} OR a."userName" ILIKE $${p} OR a."userEmail" ILIKE $${p} OR a.entity_reference ILIKE $${p})`);
    }
    if (query.dateFrom) { baseParams.push(query.dateFrom); baseFilters.push(`a.timestamp >= $${baseParams.length}::date`); }
    if (query.dateTo) { baseParams.push(query.dateTo); baseFilters.push(`a.timestamp < ($${baseParams.length}::date + interval '1 day')`); }

    const tableParams = [...baseParams];
    const tableFilters = [...baseFilters];
    const action = normalizeAuditActionCategory(query.action);
    if (action) {
      tableParams.push(action);
      tableFilters.push(`${auditActionCategorySql("a.action")} = $${tableParams.length}`);
    }
    const summaryWhere = baseFilters.length ? `WHERE ${baseFilters.join(" AND ")}` : "";
    const tableWhere = tableFilters.length ? `WHERE ${tableFilters.join(" AND ")}` : "";
    const categorySql = auditActionCategorySql("a.action");
    const base = `WITH audit_entries AS (
      SELECT a.id, a.user_id AS "userId", u.name AS "userName", u.email AS "userEmail",
             u.role_label AS "userRole", a.action, a.module, a.entity_id AS "entityId",
             a.old_value AS "oldValue", a.new_value AS "newValue", a.timestamp,
             a.used_override AS "usedOverride", a.override_reason AS "overrideReason",
             ${entityReferenceSql} AS entity_reference
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    )`;

    const countResult = await pool.query<{
      total: string; created: string; updated: string; deleted: string; approved: string;
    }>(`${base}
      SELECT
        (SELECT COUNT(*)::text FROM audit_entries a ${tableWhere}) AS total,
        COUNT(*) FILTER (WHERE ${categorySql} = 'created')::text AS created,
        COUNT(*) FILTER (WHERE ${categorySql} = 'updated')::text AS updated,
        COUNT(*) FILTER (WHERE ${categorySql} = 'deleted')::text AS deleted,
        COUNT(*) FILTER (WHERE ${categorySql} = 'approved')::text AS approved
      FROM audit_entries a ${summaryWhere}`, tableParams);

    const offset = (query.page - 1) * query.pageSize;
    const dataResult = await pool.query(`${base}
      SELECT a.id, a."userName", a."userEmail", a."userRole", a.action, a.module,
             a."entityId", a.entity_reference AS "entityReference", a.timestamp,
             a."usedOverride", a."overrideReason", a."oldValue", a."newValue"
      FROM audit_entries a ${tableWhere}
      ORDER BY a.timestamp DESC, a.id DESC
      LIMIT $${tableParams.length + 1} OFFSET $${tableParams.length + 2}`,
    [...tableParams, query.pageSize, offset]);

    const summaryRow = countResult.rows[0];
    const total = Number(summaryRow?.total ?? 0);
    const items = dataResult.rows.map((row: Record<string, unknown>) => {
      const moduleName = String(row.module ?? "");
      const changes = safeChanges(moduleName, row.oldValue, row.newValue);
      const category = categorizeAuditAction(String(row.action ?? ""));
      return {
        id: Number(row.id),
        userName: row.userName ? String(row.userName) : null,
        userEmail: row.userEmail ? String(row.userEmail) : null,
        userRole: row.userRole ? String(row.userRole) : null,
        action: String(row.action),
        module: moduleName,
        entityId: row.entityId == null ? null : Number(row.entityId),
        entityReference: row.entityReference ? String(row.entityReference) : null,
        timestamp: row.timestamp,
        actionCategory: category,
        changeSummary: changes.length ? `${changes.length} field${changes.length === 1 ? "" : "s"} changed` : "Event recorded",
        changes,
        usedOverride: Boolean(row.usedOverride),
        overrideReason: row.usedOverride ? safeText(row.overrideReason) : null,
      };
    });
    res.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total ? Math.ceil(total / query.pageSize) : 0,
      summary: {
        created: Number(summaryRow?.created ?? 0),
        updated: Number(summaryRow?.updated ?? 0),
        deleted: Number(summaryRow?.deleted ?? 0),
        approved: Number(summaryRow?.approved ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;