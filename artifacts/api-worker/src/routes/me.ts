import { Hono } from "hono";
import type { Bindings } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, permissionsFor, isDemoRoleHarnessEnabled, type Variables } from "../lib/rbac";

/** Ported from artifacts/api-server/src/routes/me.ts. */

export const meRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

meRoutes.get("/me", attachCurrentUser, requireAuth, (c) => {
  const user = c.get("currentUser")!;
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleLabel: user.roleLabel,
      scope: user.scope,
      stateId: user.stateId,
      stateName: user.stateName,
      stateNameAr: user.stateNameAr,
      sector: user.sector,
      avatarUrl: user.avatarUrl,
      languagePreference: user.languagePreference,
    },
    permissions: permissionsFor(user),
  });
});

interface SwitcherRow extends Record<string, unknown> {
  id: number;
  name: string;
  role: string;
  roleLabel: string;
  scope: string;
  stateId: number | null;
  stateName: string | null;
  stateNameAr: string | null;
  sector: string | null;
}

// /users/switcher — restricted to super_admin only, and only when the demo
// role harness is enabled (never in production regardless of env flags —
// see isDemoRoleHarnessEnabled). Exposes all active user IDs + roles and
// enables identity impersonation in dev.
meRoutes.get("/users/switcher", attachCurrentUser, requireAuth, async (c) => {
  // A disabled harness intentionally looks absent so production does not
  // expose a discoverable impersonation endpoint or fixture identity list.
  if (!isDemoRoleHarnessEnabled(c.env)) {
    return c.json({ error: "not_found" }, 404);
  }
  const user = c.get("currentUser");
  if (!user || user.role !== "super_admin") {
    return c.json({ error: "forbidden" }, 403);
  }
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<SwitcherRow>(`
      SELECT u.id, u.name, u.role, u.role_label AS "roleLabel", u.scope,
             u.state_id AS "stateId", s.name AS "stateName", s.name_ar AS "stateNameAr", u.sector
      FROM users u
      LEFT JOIN states s ON s.id = u.state_id
      WHERE u.status = 'active'
      ORDER BY
        CASE u.scope WHEN 'hq' THEN 0 ELSE 1 END,
        u.role, u.name
    `);
    return c.json(rows);
  } finally {
    close();
  }
});
