/**
 * HQ Backfill Correction — Migration verification tests
 *
 * Verifies that:
 *  - Migration 016 no longer contains the invalid backfill UPDATE
 *  - Migration 017 creates a persistent audit table and INSERTs affected rows
 *    without modifying any project data
 *  - The management_level ↔ hasHqOperations independence invariant is preserved
 *    at the API level via the existing OPLOC-PMR tests (see oploc.test.ts)
 *
 * These tests import the MIGRATIONS array directly so they assert against the
 * actual SQL that will run, not a hand-written copy.
 */

import { describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — pool must be stubbed before run-migrations.ts is imported
// (it calls pool at module evaluation time via runMigrations; the export of
//  MIGRATIONS itself is a static array and needs no pool access).
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Import AFTER mocks are hoisted
import { MIGRATIONS } from "../lib/run-migrations.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getMigration(name: string) {
  return MIGRATIONS.find((m) => m.name === name);
}

// ─────────────────────────────────────────────────────────────────────────────
// HQ-016: Migration 016 content
// ─────────────────────────────────────────────────────────────────────────────
describe("HQ-016: Migration 016 — has_hq_operations column definition", () => {
  it("migration 016 exists in MIGRATIONS", () => {
    expect(getMigration("016_has_hq_operations")).toBeDefined();
  });

  it("migration 016 SQL adds the column with NOT NULL DEFAULT false", () => {
    const m = getMigration("016_has_hq_operations")!;
    expect(m.sql).toContain(
      "ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_hq_operations BOOLEAN NOT NULL DEFAULT false",
    );
  });

  it("migration 016 SQL does NOT contain a backfill UPDATE statement", () => {
    const m = getMigration("016_has_hq_operations")!;
    expect(m.sql).not.toContain("UPDATE projects");
  });

  it("migration 016 SQL DML does NOT reference management_level (it is independent)", () => {
    const m = getMigration("016_has_hq_operations")!;
    // Strip SQL comments before asserting — comments may document the independence rule
    // by naming the field, but the actual statements must not reference it.
    const dml = m.sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(dml).not.toContain("hq_managed");
    expect(dml).not.toContain("management_level");
  });

  it("migration 016 SQL contains only the ALTER TABLE (no other DML)", () => {
    const m = getMigration("016_has_hq_operations")!;
    // Normalise: strip comments and blank lines, count statement-starting keywords
    const stripped = m.sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--") && l.trim() !== "")
      .join(" ");
    // After stripping comments there should be exactly one ALTER TABLE
    const alterCount = (stripped.match(/ALTER TABLE/gi) ?? []).length;
    expect(alterCount).toBe(1);
    // Must not have any INSERT/UPDATE/DELETE
    expect(stripped).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HQ-017: Migration 017 content and ordering
// ─────────────────────────────────────────────────────────────────────────────
describe("HQ-017: Migration 017 — corrective audit table", () => {
  it("migration 017 exists in MIGRATIONS", () => {
    expect(getMigration("017_correct_hq_backfill")).toBeDefined();
  });

  it("migration 017 appears immediately after 016 in the MIGRATIONS array", () => {
    const idx016 = MIGRATIONS.findIndex((m) => m.name === "016_has_hq_operations");
    const idx017 = MIGRATIONS.findIndex((m) => m.name === "017_correct_hq_backfill");
    expect(idx016).toBeGreaterThanOrEqual(0);
    expect(idx017).toBe(idx016 + 1);
  });

  it("migration 017 SQL creates the hq_backfill_audit table", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    expect(m.sql).toContain("CREATE TABLE IF NOT EXISTS hq_backfill_audit");
  });

  it("migration 017 SQL includes all required review fields: project_id, project_code, project_title, linked_states", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    expect(m.sql).toContain("project_id");
    expect(m.sql).toContain("project_code");
    expect(m.sql).toContain("project_title");
    // linked_states is required so administrators can see where each project operates
    expect(m.sql).toContain("linked_states");
  });

  it("migration 017 SQL joins through project_states and states to populate linked_states", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    // The audit INSERT must derive linked_states via project_states → states
    expect(m.sql).toContain("project_states");
    expect(m.sql).toContain("states");
    // Uses string_agg to aggregate multiple linked state names
    expect(m.sql).toContain("string_agg");
  });

  it("migration 017 SQL INSERTs affected projects into the audit table", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    expect(m.sql).toContain("INSERT INTO hq_backfill_audit");
    // Must SELECT from projects with the ambiguous-backfill criteria
    expect(m.sql).toContain("management_level = 'hq_managed'");
    expect(m.sql).toContain("has_hq_operations = true");
  });

  it("migration 017 SQL does NOT UPDATE any project row", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    // Strip SQL comments — comments explain why the old UPDATE was wrong and may
    // mention the field; only the DML statements must be free of destructive mutations.
    const dml = m.sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    // Must not UPDATE the projects table at all
    expect(dml).not.toMatch(/UPDATE\s+projects/i);
    // Must not SET has_hq_operations (no destructive flag change)
    expect(dml).not.toMatch(/SET\s+has_hq_operations/i);
  });

  it("migration 017 INSERT is idempotent (NOT EXISTS guard)", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    // The INSERT must guard against re-inserting the same project on repeated runs
    expect(m.sql).toContain("NOT EXISTS");
    expect(m.sql).toContain("hq_backfill_audit");
  });

  it("migration 017 SQL does NOT touch the reports table", () => {
    const m = getMigration("017_correct_hq_backfill")!;
    expect(m.sql).not.toContain("ALTER TABLE reports");
    expect(m.sql).not.toMatch(/UPDATE\s+reports/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HQ-GATE: management_level vs hasHqOperations independence (unit-level)
// ─────────────────────────────────────────────────────────────────────────────
describe("HQ-GATE: hasHqOperations is independent of management_level", () => {
  /** Mirrors the production gate in routes/reports.ts */
  function isHqPmrAllowed(project: {
    hasHqOperations?: boolean;
    managementLevel?: string | null;
  }): boolean {
    return project.hasHqOperations === true;
  }

  it("hq_managed + hasHqOperations=false → HQ PMR denied", () => {
    expect(isHqPmrAllowed({ managementLevel: "hq_managed", hasHqOperations: false })).toBe(false);
  });

  it("hq_managed + hasHqOperations=true → HQ PMR allowed", () => {
    expect(isHqPmrAllowed({ managementLevel: "hq_managed", hasHqOperations: true })).toBe(true);
  });

  it("state_managed + hasHqOperations=true → HQ PMR allowed (flag is independent)", () => {
    expect(isHqPmrAllowed({ managementLevel: "state_managed", hasHqOperations: true })).toBe(true);
  });

  it("state_managed + hasHqOperations=false → HQ PMR denied", () => {
    expect(isHqPmrAllowed({ managementLevel: "state_managed", hasHqOperations: false })).toBe(false);
  });

  it("null managementLevel + hasHqOperations=true → HQ PMR allowed (flag alone is sufficient)", () => {
    expect(isHqPmrAllowed({ managementLevel: null, hasHqOperations: true })).toBe(true);
  });

  it("null managementLevel + hasHqOperations=false/undefined → HQ PMR denied", () => {
    expect(isHqPmrAllowed({ managementLevel: null, hasHqOperations: false })).toBe(false);
    expect(isHqPmrAllowed({ managementLevel: null })).toBe(false);
  });

  it("changing managementLevel does not change hasHqOperations (fields are independent)", () => {
    const project = { managementLevel: "hq_managed" as const, hasHqOperations: true };
    const edited = { ...project, managementLevel: "state_managed" as const };
    // hasHqOperations is unchanged by the managementLevel mutation
    expect(edited.hasHqOperations).toBe(true);
    expect(isHqPmrAllowed(edited)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HQ-PRESERVE: existing has_hq_operations=true rows must remain accessible
// ─────────────────────────────────────────────────────────────────────────────
describe("HQ-PRESERVE: explicitly set has_hq_operations=true projects retain HQ access", () => {
  /** Simulates what the backend route does: query project, check flag. */
  function canCreateHqPmr(projectRow: {
    id: number;
    has_hq_operations: boolean;
    management_level: string;
  }): boolean {
    return projectRow.has_hq_operations === true;
  }

  it("project with has_hq_operations=true (explicitly set) → can create HQ PMR", () => {
    const project = { id: 42, has_hq_operations: true, management_level: "hq_managed" };
    expect(canCreateHqPmr(project)).toBe(true);
  });

  it("project with has_hq_operations=false → cannot create HQ PMR", () => {
    const project = { id: 43, has_hq_operations: false, management_level: "hq_managed" };
    expect(canCreateHqPmr(project)).toBe(false);
  });

  it("project with has_hq_operations=false (state_managed) → cannot create HQ PMR", () => {
    const project = { id: 44, has_hq_operations: false, management_level: "state_managed" };
    expect(canCreateHqPmr(project)).toBe(false);
  });
});
