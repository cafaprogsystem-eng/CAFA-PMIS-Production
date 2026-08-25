/**
 * Creates the isolated, non-production fixture used by the routed browser
 * attachment-boundary check.
 *
 * This script is deliberately opt-in. It never runs in production, never
 * prints the password, and only creates records with the CAFA-E2E marker.
 *
 * Required environment:
 *   E2E_ENABLE_NON_PRODUCTION_FIXTURES=true
 *   E2E_LIMITED_SCOPE_PASSWORD=<Replit Secret>
 */

import bcrypt from "bcryptjs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const FIXTURE_USERNAME = "e2e.tc.attachment.boundary";
const FIXTURE_EMAIL = "e2e.tc.attachment.boundary@example.invalid";
const FIXTURE_SECTOR = "WASH";
const FIXTURE_STATE_CODE = "KRT";

const PARENT_PROJECT_CODE = "CAFA-E2E-ATTACHMENT-BOUNDARY";
const PARENT_PROJECT_TITLE = "E2E Attachment Boundary Parent — Nutrition";
const PARENT_SECTOR = "Nutrition";
const PARENT_STATE_CODE = "KSL";
const PARENT_DOCUMENT_NAME = "e2e-out-of-scope-attachment.txt";
const PARENT_OBJECT_PATH = "e2e-fixtures/attachment-boundary/no-object-is-read.txt";
const BROWSER_FIXTURE_DESCRIPTOR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../cafa-pmis/e2e/.limited-scope-attachment-fixture.json",
);

function requireFixtureEnvironment(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to provision the limited-scope fixture in production.");
  }
  if (process.env.E2E_ENABLE_NON_PRODUCTION_FIXTURES !== "true") {
    throw new Error("Set E2E_ENABLE_NON_PRODUCTION_FIXTURES=true to provision this non-production fixture.");
  }
  const password = process.env.E2E_LIMITED_SCOPE_PASSWORD;
  if (!password) {
    throw new Error("E2E_LIMITED_SCOPE_PASSWORD must be configured as a secret.");
  }
  return password;
}

async function getStateId(client: Awaited<ReturnType<typeof pool.connect>>, code: string): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM states WHERE code = $1 LIMIT 1`,
    [code],
  );
  if (!rows[0]) throw new Error(`Required fixture state ${code} was not found.`);
  return rows[0].id;
}

async function main() {
  const password = requireFixtureEnvironment();
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const fixtureStateId = await getStateId(client, FIXTURE_STATE_CODE);
    const parentStateId = await getStateId(client, PARENT_STATE_CODE);

    const existingUser = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE username = $1 LIMIT 1 FOR UPDATE`,
      [FIXTURE_USERNAME],
    );
    let fixtureUserId: number;
    if (existingUser.rows[0]) {
      fixtureUserId = existingUser.rows[0].id;
      await client.query(
        `UPDATE users
            SET name = 'E2E Limited Scope Technical Coordinator',
                email = $1,
                password_hash = $2,
                role = 'technical_coordinator',
                role_label = 'Technical Coordinator',
                scope = 'sector',
                state_id = $3,
                sector = $4,
                status = 'active',
                email_verified = true,
                invite_token = NULL,
                invite_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $5`,
        [FIXTURE_EMAIL, passwordHash, fixtureStateId, FIXTURE_SECTOR, fixtureUserId],
      );
    } else {
      const insertedUser = await client.query<{ id: number }>(
        `INSERT INTO users
           (name, email, username, password_hash, role, role_label, scope, state_id, sector, status, email_verified)
         VALUES
           ('E2E Limited Scope Technical Coordinator', $1, $2, $3,
            'technical_coordinator', 'Technical Coordinator', 'sector', $4, $5, 'active', true)
         RETURNING id`,
        [FIXTURE_EMAIL, FIXTURE_USERNAME, passwordHash, fixtureStateId, FIXTURE_SECTOR],
      );
      fixtureUserId = insertedUser.rows[0]!.id;
    }

    const existingProject = await client.query<{ id: number }>(
      `SELECT id FROM projects WHERE code = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [PARENT_PROJECT_CODE],
    );
    let parentProjectId: number;
    if (existingProject.rows[0]) {
      parentProjectId = existingProject.rows[0].id;
      await client.query(
        `UPDATE projects
            SET title = $1,
                status = 'draft',
                sector = $2,
                sectors = $3::jsonb,
                donor = 'CAFA E2E Fixture',
                start_date = DATE '2026-01-01',
                end_date = DATE '2026-12-31',
                budget_total = 0,
                management_level = 'state_managed',
                deleted_at = NULL,
                deleted_by = NULL,
                deletion_reason = NULL,
                deletion_mode = NULL,
                updated_at = NOW()
          WHERE id = $4`,
        [PARENT_PROJECT_TITLE, PARENT_SECTOR, JSON.stringify([PARENT_SECTOR]), parentProjectId],
      );
    } else {
      const insertedProject = await client.query<{ id: number }>(
        `INSERT INTO projects
           (code, title, status, sector, sectors, donor, start_date, end_date, budget_total, management_level)
         VALUES
           ($1, $2, 'draft', $3, $4::jsonb, 'CAFA E2E Fixture',
            DATE '2026-01-01', DATE '2026-12-31', 0, 'state_managed')
         RETURNING id`,
        [PARENT_PROJECT_CODE, PARENT_PROJECT_TITLE, PARENT_SECTOR, JSON.stringify([PARENT_SECTOR])],
      );
      parentProjectId = insertedProject.rows[0]!.id;
    }

    await client.query(`DELETE FROM project_states WHERE project_id = $1`, [parentProjectId]);
    await client.query(
      `INSERT INTO project_states (project_id, state_id) VALUES ($1, $2)`,
      [parentProjectId, parentStateId],
    );

    const existingDocument = await client.query<{ id: number }>(
      `SELECT id
         FROM project_documents
        WHERE project_id = $1 AND file_name = $2
        LIMIT 1
        FOR UPDATE`,
      [parentProjectId, PARENT_DOCUMENT_NAME],
    );
    let parentDocumentId: number;
    if (existingDocument.rows[0]) {
      parentDocumentId = existingDocument.rows[0].id;
      await client.query(
        `UPDATE project_documents
            SET kind = 'e2e_fixture',
                category = 'optional',
                content_type = 'text/plain',
                size = 0,
                object_path = $1,
                drive_file_id = NULL
          WHERE id = $2`,
        [PARENT_OBJECT_PATH, parentDocumentId],
      );
    } else {
      const insertedDocument = await client.query<{ id: number }>(
        `INSERT INTO project_documents
           (project_id, kind, category, file_name, content_type, size, object_path, uploaded_by_id)
         VALUES
           ($1, 'e2e_fixture', 'optional', $2, 'text/plain', 0, $3, $4)
         RETURNING id`,
        [parentProjectId, PARENT_DOCUMENT_NAME, PARENT_OBJECT_PATH, fixtureUserId],
      );
      parentDocumentId = insertedDocument.rows[0]!.id;
    }

    await client.query("COMMIT");

    // The browser suite consumes this atomically-written, non-secret descriptor
    // rather than an arbitrary ID supplied through its environment. It is only
    // written after the transaction committed the exact fixture markers.
    const descriptor = {
      version: 1,
      provisionedAt: new Date().toISOString(),
      fixture: {
        username: FIXTURE_USERNAME,
        email: FIXTURE_EMAIL,
        role: "technical_coordinator",
        sector: FIXTURE_SECTOR,
        stateCode: FIXTURE_STATE_CODE,
      },
      parent: {
        projectId: parentProjectId,
        projectCode: PARENT_PROJECT_CODE,
        sector: PARENT_SECTOR,
        stateCode: PARENT_STATE_CODE,
        documentId: parentDocumentId,
        documentName: PARENT_DOCUMENT_NAME,
      },
    };
    await mkdir(dirname(BROWSER_FIXTURE_DESCRIPTOR), { recursive: true });
    const temporaryDescriptor = `${BROWSER_FIXTURE_DESCRIPTOR}.tmp`;
    await writeFile(temporaryDescriptor, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });
    await rename(temporaryDescriptor, BROWSER_FIXTURE_DESCRIPTOR);

    // IDs, codes, and scope markers are intentionally non-secret. The password
    // is neither emitted nor persisted outside its bcrypt hash.
    console.log(JSON.stringify({
      fixtureDescriptor: BROWSER_FIXTURE_DESCRIPTOR,
      fixture: descriptor.fixture,
      parent: descriptor.parent,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});