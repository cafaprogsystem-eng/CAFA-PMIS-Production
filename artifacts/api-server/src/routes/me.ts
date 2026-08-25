import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { isDemoRoleHarnessEnabled, permissionsFor } from "../middlewares/currentUser";

const router: IRouter = Router();

router.get("/me", (req, res) => {
  if (!req.currentUser) {
    res.status(401).json({ error: "no current user" });
    return;
  }
  res.json({
    user: {
      id: req.currentUser.id,
      name: req.currentUser.name,
      email: req.currentUser.email,
      role: req.currentUser.role,
      roleLabel: req.currentUser.roleLabel,
      scope: req.currentUser.scope,
      stateId: req.currentUser.stateId,
      stateName: req.currentUser.stateName,
      stateNameAr: req.currentUser.stateNameAr,
      sector: req.currentUser.sector,
      avatarUrl: req.currentUser.avatarUrl,
    },
    permissions: permissionsFor(req.currentUser),
  });
});

// /users/switcher — restricted to super_admin only.
// Exposes all active user IDs + roles and enables identity impersonation in dev;
// must not be accessible to any other role.
router.get("/users/switcher", async (req, res, next) => {
  // A disabled harness intentionally looks absent so production does not
  // expose a discoverable impersonation endpoint or fixture identity list.
  if (!isDemoRoleHarnessEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!req.currentUser || req.currentUser.role !== "super_admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.role, u.role_label AS "roleLabel", u.scope,
             u.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", u.sector
      FROM users u
      LEFT JOIN states s ON s.id = u.state_id
      WHERE u.status = 'active'
      ORDER BY
        CASE u.scope WHEN 'hq' THEN 0 ELSE 1 END,
        u.role, u.name
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
