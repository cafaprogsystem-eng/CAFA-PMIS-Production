import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { CreateBeneficiaryBody } from "@workspace/api-zod";
import { logAudit, requirePerm } from "../middlewares/currentUser";
import { resolveLocationContext } from "../lib/accessControl";

const router: IRouter = Router();

router.get("/beneficiaries", async (req, res, next) => {
  try {
    // Security: state-scoped roles (SOM, SPO) are always clamped to their own
    // stateId and cannot widen scope via a crafted ?stateId query param.
    // resolveLocationContext is the canonical helper for this pattern.
    const user = req.currentUser;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const { stateId: effectiveStateId, denied } = resolveLocationContext(
      { id: user.id, role: user.role, stateId: user.stateId ?? null },
      req.query.stateId as string | undefined,
    );
    if (denied) {
      // State-scoped role with no configured stateId: fail-closed, return empty
      res.json([]);
      return;
    }

    const filters: string[] = [];
    const params: unknown[] = [];
    // Use the clamped/resolved stateId instead of trusting req.query directly
    if (effectiveStateId != null) { params.push(effectiveStateId); filters.push(`b.state_id = $${params.length}`); }
    if (req.query.projectId) { params.push(Number(req.query.projectId)); filters.push(`b.project_id = $${params.length}`); }
    if (req.query.category) { params.push(String(req.query.category)); filters.push(`b.category = $${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
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
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/beneficiaries", requirePerm("beneficiaries.create"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const body = CreateBeneficiaryBody.parse(req.body);

    // Security: a state-scoped role (state_program_officer) must not be able
    // to attribute a beneficiary to a state outside their own assignment via
    // a crafted stateId in the request body. resolveLocationContext is the
    // same canonical clamp the GET route above uses — reuse it for writes.
    const { stateId: clampedStateId, denied } = resolveLocationContext(
      { id: user.id, role: user.role, stateId: user.stateId ?? null },
      String(body.stateId),
    );
    if (denied) {
      res.status(403).json({ error: "forbidden", message: "No state assignment configured for this account." });
      return;
    }
    const stateId = clampedStateId ?? body.stateId;

    const code = `BEN-${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await pool.query(
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
    await logAudit({
      userId: req.currentUser?.id ?? null,
      action: "create", module: "beneficiaries",
      entityId: rows[0].id, newValue: body.name,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
