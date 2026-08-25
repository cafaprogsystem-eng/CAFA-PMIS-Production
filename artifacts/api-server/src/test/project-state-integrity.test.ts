import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
}));

const { assertActiveState } = await import("../lib/state-master");
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsSource = readFileSync(
  path.join(here, "..", "lib", "run-migrations.ts"),
  "utf8",
);
const projectsSource = readFileSync(
  path.join(here, "..", "routes", "projects.ts"),
  "utf8",
);

function migrationSegment(name: string): string {
  const start = migrationsSource.indexOf(`name: "${name}"`);
  expect(start, `migration ${name} should exist`).toBeGreaterThan(-1);
  const following = migrationsSource.indexOf('\n  {\n    name:', start + 1);
  return following === -1 ? migrationsSource.slice(start) : migrationsSource.slice(start, following);
}

describe("project-State link integrity", () => {
  it("accepts an existing active canonical State", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 7,
        name: "Kassala State",
        nameAr: "ولاية كسلا",
        code: "KSL",
        operationalStatus: "active",
        officeStatus: "present",
      }],
    });

    await expect(assertActiveState(7)).resolves.toMatchObject({ ok: true });
  });

  it("rejects a State assignment that is absent from the canonical registry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(assertActiveState(3)).resolves.toEqual({
      ok: false,
      error: "invalid_state",
    });
  });

  it("keeps valid project write paths behind canonical State validation", () => {
    expect(projectsSource).toMatch(/for \(const stateId of \[\s*\.\.\.\(body\.stateIds \?\? \[\]\)/);
    expect(projectsSource).toMatch(/assertActiveState\(Number\(stateId\)\)/);
    expect(projectsSource).toMatch(/projects can only be assigned to active states/i);
    expect(projectsSource).toMatch(/projects can only be assigned to active states/i);
  });

  it("records orphaned links without inventing a replacement, then enforces a State FK", () => {
    const sql = migrationSegment("056_project_state_link_integrity");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS project_state_integrity_reviews");
    expect(sql).toContain("manual_correction_required");
    expect(sql).toMatch(/INSERT INTO project_state_integrity_reviews[\s\S]*LEFT JOIN states s ON s\.id = ps\.state_id/);
    expect(sql).toMatch(/DELETE FROM project_states ps[\s\S]*NOT EXISTS \([\s\S]*states s WHERE s\.id = ps\.state_id/);
    expect(sql).toMatch(/FOREIGN KEY \(state_id\) REFERENCES states\(id\) ON DELETE RESTRICT NOT VALID/);
    expect(sql).toContain("VALIDATE CONSTRAINT project_states_state_fk");
    expect(sql).not.toMatch(/UPDATE project_states[\s\S]*SET state_id/i);
  });

  it("archives the pathological missing-project and missing-State link before State cleanup", () => {
    const sql = migrationSegment("056_project_state_link_evidence_prearchive");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS project_state_integrity_reviews");
    expect(sql).toMatch(/LEFT JOIN projects p ON p\.id = ps\.project_id/);
    expect(sql).toMatch(/LEFT JOIN states s ON s\.id = ps\.state_id/);
    expect(sql).toMatch(/WHERE p\.id IS NULL\s+AND s\.id IS NULL/);
    expect(sql).toContain("'[missing project #' || ps.project_id || ']'");
    expect(sql).toContain("Raw IDs were retained");
  });

  it("leaves historical valid State relationships readable", () => {
    expect(projectsSource).toContain(
      "JOIN states s ON s.id = ps.state_id WHERE ps.project_id = p.id",
    );
  });
});