import { Hono } from "hono";
import { CreateBeneficiaryBody } from "@workspace/api-zod";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, requirePerm, logAudit, type Variables } from "../lib/rbac";
import { resolveLocationContext } from "../lib/accessControl";

/** Ported from artifacts/api-server/src/routes/beneficiaries.ts. */

export const beneficiariesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

beneficiariesRoutes.use("/beneficiaries", attachCurrentUser, requireAuth);

beneficiariesRoutes.get("/beneficiaries", async (c) => {
  const user = c.get("currentUser")!;

  // Security: state-scoped roles (SOM, SPO) are always clamped to their own
  // stateId and cannot widen scope via a crafted ?stateId query param.
  // resolveLocationContext is the canonical helper for this pattern.
  const { stateId: effectiveStateId, denied } = resolveLocationContext(
    { id: user.id, role: user.role, stateId: user.stateId ?? null },
    c.req.query("stateId"),
  );
  if (denied) {
    // State-scoped role with no configured stateId: fail-closed, return empty.
    return c.json([]);
  }

  const filters: string[] = [];
  const params: unknown[] = [];
  // Use the clamped/resolved stateId instead of trusting the query directly.
  if (effectiveStateId != null) { params.push(effectiveStateId); filters.push(`b.state_id = $${params.length}`); }
  const projectId = c.req.query("projectId");
  if (projectId) { params.push(Number(projectId)); filters.push(`b.project_id = $${params.length}`); }
  const category = c.req.query("category");
  if (category) { params.push(category); filters.push(`b.category = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.code, b.name, b.gender, b.age_group AS "ageGroup", b.category, b.vulnerability,
              b.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr",
              l.name AS "localityName",
              b.project_id AS "projectId", p.title AS "projectTitle",
              b.assistance_received AS "assistanceReceived",
              b.date_of_assistance AS "dateOfAssistance",
              b.verification_status AS "verificationStatus"
       FROM beneficiaries b
       JOIN states s ON s.id = b.state_id
       LEFT JOIN localities l ON l.id = b.locality_id
       LEFT JOIN projects p ON p.id = b.project_id
       ${where}
       ORDER BY b.date_of_assistance DESC, b.id DESC
       LIMIT 500`,
      params,
    );
    return c.json(rows);
  } finally {
    close();
  }
});

beneficiariesRoutes.post("/beneficiaries", requirePerm("beneficiaries.create"), async (c) => {
  const user = c.get("currentUser")!;
  const body = CreateBeneficiaryBody.parse(await c.req.json());

  // Security: a state-scoped role (state_program_officer) must not be able
  // to attribute a beneficiary to a state outside their own assignment via
  // a crafted stateId in the request body. resolveLocationContext is the
  // same canonical clamp the GET route above uses — reuse it for writes.
  const { stateId: clampedStateId, denied } = resolveLocationContext(
    { id: user.id, role: user.role, stateId: user.stateId ?? null },
    String(body.stateId),
  );
  if (denied) {
    return c.json({ error: "forbidden", message: "No state assignment configured for this account." }, 403);
  }
  const stateId = clampedStateId ?? body.stateId;

  const { db, close } = openDb(c);
  try {
    const code = `BEN-${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await db.query<{
      id: number; code: string; name: string; gender: string; ageGroup: string; category: string;
      vulnerability: string | null; stateId: number; stateName: string; stateNameAr: string;
      localityName: string | null; projectId: number | null; projectTitle: string | null;
      assistanceReceived: string | null; dateOfAssistance: string | null; verificationStatus: string;
    }>(
      `INSERT INTO beneficiaries (code, name, gender, age_group, category, vulnerability, state_id, locality_id, project_id, assistance_received, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'verified')
       RETURNING id, code, name, gender, age_group AS "ageGroup", category, vulnerability,
                 state_id AS "stateId",
                 (SELECT name FROM states WHERE id = state_id) AS "stateName",
                 (SELECT name_ar FROM states WHERE id = state_id) AS "stateNameAr",
                 (SELECT name FROM localities WHERE id = locality_id) AS "localityName",
                 project_id AS "projectId",
                 (SELECT title FROM projects WHERE id = project_id) AS "projectTitle",
                 assistance_received AS "assistanceReceived",
                 date_of_assistance AS "dateOfAssistance",
                 verification_status AS "verificationStatus"`,
      [
        code, body.name, body.gender, body.ageGroup, body.category,
        body.vulnerability ?? null, stateId,
        body.localityId ?? null, body.projectId ?? null,
        body.assistanceReceived ?? null,
      ],
    );
    await logAudit(db, {
      userId: user.id,
      action: "create", module: "beneficiaries",
      entityId: rows[0].id, newValue: body.name,
    });
    return c.json(rows[0], 201);
  } finally {
    close();
  }
});
