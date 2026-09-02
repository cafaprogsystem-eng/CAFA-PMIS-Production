/**
 * Demo-data seed for the training-video screenshot pipeline
 * (scripts/capture-training-screenshots.mjs). Creates exactly one demo user
 * and a small, clearly-labeled set of records so the 11 screenshot targets
 * in full-system-video-script.ts aren't empty — nothing here is meant to
 * resemble real CAFA staff, beneficiaries, or projects.
 *
 * Safe to run multiple times: every insert is idempotent (upsert by a
 * natural key, or an existence check first), so re-running never creates
 * duplicate rows. Forbidden in production — see scripts/seed.mjs, which is
 * the entry point that actually invokes this file.
 *
 * The demo user is created once with a randomly generated password, printed
 * to stdout only that first time (bcrypt is one-way, so this is the only
 * place it will ever be visible) — override it with the SEED_DEMO_PASSWORD
 * env var if you don't want the auto-generated one. Re-running this script
 * against an instance that already has the demo user leaves its password
 * untouched and says so, rather than silently reusing a stale or
 * newly-supplied one.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "./index";

const DEMO_EMAIL = "demo.trainer@cafa.systems";
const DEMO_USERNAME = "demo_trainer";
const DEMO_PROJECT_CODE = "CAFA-DEMO-001";
const DEMO_PLAN_CODE = "CAFA-PLAN-DEMO-001";

function generatePassword(): string {
  // 16 random bytes, base64url-encoded, then padded with a fixed
  // letter+digit suffix so it always satisfies the app's password policy
  // (length >= 10, at least one letter and one digit) regardless of what
  // the random bytes happen to encode to.
  const random = randomBytes(16).toString("base64url");
  return `${random}Aa1`;
}

async function findStateId(): Promise<number> {
  const byName = await pool.query<{ id: number }>(
    `SELECT id FROM states WHERE lower(btrim(name)) = 'khartoum' LIMIT 1`,
  );
  if (byName.rows.length) return byName.rows[0].id;
  const any = await pool.query<{ id: number }>(`SELECT id FROM states ORDER BY id LIMIT 1`);
  if (!any.rows.length) throw new Error("Seed blocked: no rows in states — run migrations first.");
  return any.rows[0].id;
}

async function seedDemoUser(): Promise<{ id: number; email: string; isNew: boolean; plaintextPassword: string | null }> {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1))`,
    [DEMO_EMAIL],
  );
  if (existing.rows.length) {
    return { id: existing.rows[0].id, email: DEMO_EMAIL, isNew: false, plaintextPassword: null };
  }

  const plaintextPassword = process.env.SEED_DEMO_PASSWORD || generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, 12);

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO users (
       name, email, username, password_hash, role, role_label, scope,
       status, email_verified, language_preference
     )
     VALUES ($1, $2, $3, $4, 'super_admin', 'Super Admin', 'hq', 'active', true, 'en')
     ON CONFLICT ((lower(btrim(email)))) DO NOTHING
     RETURNING id`,
    ["CAFA Demo Trainer", DEMO_EMAIL, DEMO_USERNAME, passwordHash],
  );

  if (inserted.rows.length) {
    return { id: inserted.rows[0].id, email: DEMO_EMAIL, isNew: true, plaintextPassword };
  }

  // Lost a race against a concurrent seed run — someone else's insert won.
  const raced = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1))`,
    [DEMO_EMAIL],
  );
  return { id: raced.rows[0].id, email: DEMO_EMAIL, isNew: false, plaintextPassword: null };
}

// A second, lower-privilege demo user purely so /users doesn't screenshot as
// a list of exactly one row. Not used for login anywhere.
async function seedSecondaryDemoUser(stateId: number): Promise<void> {
  await pool.query(
    `INSERT INTO users (
       name, email, username, password_hash, role, role_label, scope, state_id,
       status, email_verified, language_preference
     )
     VALUES ($1, $2, $3, NULL, 'state_program_officer', 'State Program Officer', 'state', $4, 'active', true, 'en')
     ON CONFLICT ((lower(btrim(email)))) DO NOTHING`,
    ["CAFA Demo Officer", "demo.officer@cafa.systems", "demo_officer", stateId],
  );
}

async function seedDemoProject(createdById: number): Promise<number> {
  const existing = await pool.query<{ id: number }>(`SELECT id FROM projects WHERE code = $1`, [DEMO_PROJECT_CODE]);
  if (existing.rows.length) return existing.rows[0].id;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 9, 1);
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO projects (
       code, title, objective, status, sector, sectors, donor,
       description, start_date, end_date, reporting_start_date, reporting_end_date,
       budget_total, direct_cost, indirect_cost, cafa_contribution, currency,
       beneficiaries_target, beneficiaries_male, beneficiaries_female, beneficiaries_boys, beneficiaries_girls,
       activity_target, indicator_target, management_level, created_by_id
     )
     VALUES ($1, $2, $3, 'active', $4, $5::jsonb, $6,
             $7, $8, $9, $8, $9,
             $10, $11, $12, $13, 'USD',
             $14, $15, $16, $17, $18,
             $19, $20, 'hq_managed', $21)
     RETURNING id`,
    [
      DEMO_PROJECT_CODE,
      "Demo Project — Community Health Programme",
      "Illustrative demo project used only for training-video screenshots.",
      "Health",
      JSON.stringify(["Health"]),
      "Demo Donor",
      "Sample project created for training-video screenshot capture — not a real programme.",
      toDateStr(start),
      toDateStr(end),
      250000,
      190000,
      35000,
      25000,
      5000,
      2200,
      1400,
      900,
      500,
      6,
      4,
      createdById,
    ],
  );
  return inserted.rows[0].id;
}

async function seedProjectState(projectId: number, stateId: number): Promise<void> {
  await pool.query(
    `INSERT INTO project_states (project_id, state_id)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM project_states WHERE project_id = $1 AND state_id = $2)`,
    [projectId, stateId],
  );
  await pool.query(
    `INSERT INTO project_state_allocations (project_id, state_id, budget_allocation, beneficiary_target)
     SELECT $1, $2, 250000, 6000
     WHERE NOT EXISTS (SELECT 1 FROM project_state_allocations WHERE project_id = $1 AND state_id = $2)`,
    [projectId, stateId],
  );
}

async function seedProjectAssignment(projectId: number, userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO project_assignments (project_id, user_id, role)
     SELECT $1, $2, 'program_manager'
     WHERE NOT EXISTS (SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2)`,
    [projectId, userId],
  );
}

async function seedActivity(projectId: number, stateId: number): Promise<void> {
  await pool.query(
    `INSERT INTO activities (project_id, state_id, code, title, description, target, status, progress_pct, budget_planned, budget_spent, sector, currency)
     SELECT $1, $2, 'DEMO-ACT-001', 'Community health outreach sessions', 'Demo activity for screenshot capture.', 40, 'in_progress', 60, 60000, 38000, 'Health', 'USD'
     WHERE NOT EXISTS (SELECT 1 FROM activities WHERE project_id = $1 AND code = 'DEMO-ACT-001')`,
    [projectId, stateId],
  );
}

async function seedDemoPlan(projectId: number, stateId: number, createdById: number): Promise<number> {
  const existing = await pool.query<{ id: number }>(`SELECT id FROM plans WHERE code = $1`, [DEMO_PLAN_CODE]);
  if (existing.rows.length) return existing.rows[0].id;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO plans (
       code, title, plan_type, project_id, state_id, sector, sectors,
       responsible_name, start_date, end_date, status, description,
       budget_planned, budget_actual, currency, created_by_id
     )
     VALUES ($1, $2, 'monthly', $3, $4, 'Health', $5::jsonb,
             'CAFA Demo Trainer', $6, $7, 'active', $8,
             60000, 38000, 'USD', $9)
     RETURNING id`,
    [
      DEMO_PLAN_CODE,
      "Demo Monthly Plan — Khartoum",
      projectId,
      stateId,
      JSON.stringify(["Health"]),
      toDateStr(start),
      toDateStr(end),
      "Sample monthly plan created for training-video screenshot capture.",
      createdById,
    ],
  );
  return inserted.rows[0].id;
}

async function seedPlanActivity(planId: number, stateId: number): Promise<void> {
  await pool.query(
    `INSERT INTO plan_activities (plan_id, title, description, state_id, target_beneficiaries, priority, status, progress_pct, budget_planned, budget_actual)
     SELECT $1, 'Community health training', 'Demo plan activity for screenshot capture.', $2, 200, 'medium', 'in_progress', 60, 60000, 38000
     WHERE NOT EXISTS (SELECT 1 FROM plan_activities WHERE plan_id = $1 AND title = 'Community health training')`,
    [planId, stateId],
  );
}

async function seedDemoReport(projectId: number, stateId: number, submittedById: number): Promise<void> {
  const now = new Date();
  await pool.query(
    `INSERT INTO reports (
       title, kind, report_type, project_id, state_id, period,
       reporting_month, reporting_year, narrative, challenges, recommendations,
       beneficiaries_male, beneficiaries_female, beneficiaries_boys, beneficiaries_girls,
       planned_budget, actual_expenditure, status, submitted_by_id
     )
     SELECT $1, 'monthly', 'project', $2, $3, $4,
            $5, $6, $7, $8, $9,
            1100, 700, 250, 150,
            60000, 38000, 'submitted', $10
     WHERE NOT EXISTS (SELECT 1 FROM reports WHERE project_id = $2 AND title = $1)`,
    [
      "Demo Project Report — " + now.toISOString().slice(0, 7),
      projectId,
      stateId,
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      now.getMonth() + 1,
      now.getFullYear(),
      "This is a sample narrative describing demo progress for training-video screenshot capture.",
      "No real challenges — this is demo content.",
      "No real recommendations — this is demo content.",
      submittedById,
    ],
  );
}

async function seedDemoRisk(projectId: number, stateId: number, assignedToId: number): Promise<void> {
  await pool.query(
    `INSERT INTO risks (title, description, category, severity, likelihood, status, state_id, project_id, assigned_to_id, mitigation_plan)
     SELECT $1, $2, 'operational', 'medium', 'medium', 'open', $3, $4, $5, $6
     WHERE NOT EXISTS (SELECT 1 FROM risks WHERE project_id = $4 AND title = $1)`,
    [
      "Demo Risk — Field access delay",
      "Sample risk created for training-video screenshot capture.",
      stateId,
      projectId,
      assignedToId,
      "Sample mitigation plan text for demo purposes.",
    ],
  );
}

async function seedDemoNotification(userId: number, projectId: number): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (user_id, kind, entity_type, entity_id, message, link)
     SELECT $1, 'project_update', 'project', $2, 'Demo Project was updated — sample notification for screenshot capture.', $3
     WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'project_update' AND entity_id = $2)`,
    [userId, projectId, `/projects/${projectId}`],
  );
}

async function seedDemoAuditEntry(userId: number, projectId: number): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (user_id, action, module, entity_id, new_value)
     SELECT $1, 'create_project', 'projects', $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE module = 'projects' AND entity_id = $2 AND action = 'create_project')`,
    [userId, projectId, JSON.stringify({ code: DEMO_PROJECT_CODE, status: "active" })],
  );
}

const DEMO_MANUAL_CHAPTERS = [
  { slug: "demo-getting-started", title: "Getting Started (Demo)", description: "Sample chapter for training-video screenshot capture.", order: 1 },
  { slug: "demo-login-and-access", title: "Login & Access (Demo)", description: "Sample chapter for training-video screenshot capture.", order: 2 },
  { slug: "demo-projects-module", title: "Projects Module (Demo)", description: "Sample chapter for training-video screenshot capture.", order: 3 },
];

async function seedManualChapters(): Promise<void> {
  for (const ch of DEMO_MANUAL_CHAPTERS) {
    await pool.query(
      `INSERT INTO manual_chapters (title, slug, description, icon, "order", language, status)
       VALUES ($1, $2, $3, 'FileText', $4, 'en', 'published')
       ON CONFLICT (slug) DO NOTHING`,
      [ch.title, ch.slug, ch.description, ch.order],
    );
  }
}

async function main(): Promise<void> {
  console.log("Seeding demo data for the training-video screenshot pipeline…");

  const stateId = await findStateId();

  const user = await seedDemoUser();
  if (user.isNew) {
    console.log("");
    console.log("Demo account created:");
    console.log(`  email:    ${user.email}`);
    console.log(`  password: ${user.plaintextPassword}`);
    console.log("This password is shown ONLY now — it is bcrypt-hashed in the database and cannot be");
    console.log("recovered later. Save it before it scrolls away. Re-running this script will NOT change it.");
    console.log("");
  } else {
    console.log(`Demo account already exists (${user.email}) — password left unchanged from its first creation.`);
  }

  await seedSecondaryDemoUser(stateId);

  const projectId = await seedDemoProject(user.id);
  await seedProjectState(projectId, stateId);
  await seedProjectAssignment(projectId, user.id);
  await seedActivity(projectId, stateId);

  const planId = await seedDemoPlan(projectId, stateId, user.id);
  await seedPlanActivity(planId, stateId);

  await seedDemoReport(projectId, stateId, user.id);
  await seedDemoRisk(projectId, stateId, user.id);
  await seedDemoNotification(user.id, projectId);
  await seedDemoAuditEntry(user.id, projectId);
  await seedManualChapters();

  console.log("Demo data seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
