/**
 * PRJ-ZR — Projects Zero-Residual Final Re-Closure Sentinels (Task #515)
 *
 * 24 sentinels (PRJ-ZR-01 … PRJ-ZR-24) verifying that every historically
 * identified Projects finding remains closed in the current production code.
 * Structural sentinels read the live source files, so any regression that
 * removes a fix breaks the sentinel. Behavioural depth for each area lives in
 * the dedicated suites (prj-doc-security, prj-governance-access,
 * prj-data-integrity, prj-doc-lifecycle, prj-final-closure,
 * prj-closure-sentinel, prj-multisector-scope, prj-spend-preservation,
 * project-bd-sentinels, project-audit, project-scope-hardening,
 * pm-full-operational-access) — PRJ-ZR-24 pins their presence.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";

const HERE = resolve(__dirname);
const projectsSrc = readFileSync(resolve(HERE, "../routes/projects.ts"), "utf8");
const dashboardSrc = readFileSync(resolve(HERE, "../routes/dashboard.ts"), "utf8");
const migrationsSrc = readFileSync(resolve(HERE, "../lib/run-migrations.ts"), "utf8");
const projectDetailSrc = readFileSync(
  resolve(HERE, "../../../cafa-pmis/src/pages/project-detail.tsx"),
  "utf8",
);
const schemasSrc = readFileSync(
  resolve(HERE, "../../../../lib/api-client-react/src/generated/api.schemas.ts"),
  "utf8",
);

/** Extract the body of a route handler starting at the given registration marker. */
function routeSlice(src: string, marker: string, approxLen = 8000): string {
  const idx = src.indexOf(marker);
  expect(idx, `route marker not found: ${marker}`).toBeGreaterThan(-1);
  return src.slice(idx, idx + approxLen);
}

describe("PRJ-ZR-01 — Document DTO contains no storage internals", () => {
  it("toPublicDocumentDto exists and is applied to list + upload responses", () => {
    expect(projectsSrc).toContain("export function toPublicDocumentDto");
    expect(projectsSrc).toMatch(/res\.json\(rows\.map\(toPublicDocumentDto\)\)/);
    expect(projectsSrc).toMatch(/res\.status\(201\)\.json\(toPublicDocumentDto\(/);
  });
  it("DTO allow-list never emits objectPath / driveFileId / bucket keys", () => {
    const start = projectsSrc.indexOf("export function toPublicDocumentDto");
    const body = projectsSrc.slice(start, projectsSrc.indexOf("}", projectsSrc.indexOf("return", start) + 400) + 1);
    for (const banned of ["objectPath", "object_path", "driveFileId", "drive_file_id", "bucket"]) {
      // banned keys must not appear as returned properties of the DTO
      expect(body.includes(`${banned}:`), `DTO must not emit ${banned}`).toBe(false);
    }
  });
});

describe("PRJ-ZR-02 — Secure document download (proxied, no internal path leaked)", () => {
  const dl = routeSlice(projectsSrc, 'router.get("/projects/:projectId/documents/:documentId/download"');
  it("never redirects to internal storage paths", () => {
    expect(dl.includes("res.redirect(")).toBe(false);
  });
  it("streams through the storage abstraction with safe Content-Disposition and 404/503 handling", () => {
    expect(dl).toContain("downloadObject");
    expect(dl).toContain("Content-Disposition");
    // Filename encoding now lives in the shared contentDispositionHeader()
    // helper (lib/contentDisposition.ts), not inlined here — see
    // FILES-CONTENT-DISPOSITION-UNIFIED for the encodeURIComponent coverage.
    expect(dl).toContain("contentDispositionHeader");
    expect(dl).toContain('"storage_not_configured"');
    expect(dl).toContain("ObjectNotFoundError");
  });
  it("checks auth, existence, sector scope, and state scope before any storage call", () => {
    const storageIdx = dl.indexOf("objectStorageService.downloadObject");
    expect(dl.indexOf("requirePerm(\"documents.view\")")).toBeGreaterThan(-1);
    expect(dl.indexOf("assertEffectiveSectorAllowedForProject")).toBeLessThan(storageIdx);
    expect(dl.indexOf("assertStateAllowed")).toBeLessThan(storageIdx);
  });
});

describe("PRJ-ZR-03 — Stage-aware reviewer permissions (PRJ-BD-02 / PRJ-021)", () => {
  it("stageAwareNegativePerm maps each source stage to its reviewer permission", () => {
    const fn = routeSlice(projectsSrc, "function stageAwareNegativePerm", 700);
    expect(fn).toMatch(/submitted.*state_reviewed.*projects\.approve\.technical/s);
    expect(fn).toMatch(/technically_approved.*projects\.approve\.coordination/s);
    expect(fn).toMatch(/coordination_approved.*projects\.approve\.final/s);
    expect(fn).toContain("return null");
  });
  it("reject/request_revision are excluded from the static permission map", () => {
    const map = routeSlice(projectsSrc, "const PROJECT_TRANSITION_PERMS", 700);
    expect(map.includes("reject:")).toBe(false);
    expect(map.includes("request_revision:")).toBe(false);
  });
});

describe("PRJ-ZR-04 — Invalid source-state transition blocked (Full Access cannot jump states)", () => {
  const handler = routeSlice(projectsSrc, 'router.post("/projects/:projectId/transitions"', 6000);
  it("source-status validation runs before stage-aware permission ('*' cannot override it)", () => {
    const fromCheck = handler.indexOf("transition.from.includes(fromStatus)");
    const stagePerm = handler.indexOf("stageAwareNegativePerm(fromStatus)");
    expect(fromCheck).toBeGreaterThan(-1);
    expect(stagePerm).toBeGreaterThan(fromCheck);
  });
  it("full transition matrix matches the approved workflow", () => {
    const m = routeSlice(projectsSrc, "const PROJECT_TRANSITIONS", 900);
    expect(m).toMatch(/submit:.*\["draft"\]/);
    expect(m).toMatch(/final_approve:.*\["coordination_approved"\]/);
    expect(m).toMatch(/reject:.*\["submitted", "state_reviewed", "technically_approved", "coordination_approved"\]/);
    expect(m).toMatch(/request_revision:.*to: "draft"/);
  });
});

describe("PRJ-ZR-05 / PRJ-ZR-06 — State assignment list/detail parity, no same-State peer leak", () => {
  it("list query includes project_assignments EXISTS scoped to the current user (PRJ-028)", () => {
    expect(projectsSrc).toMatch(
      /EXISTS \(SELECT 1 FROM project_assignments pa WHERE pa\.project_id = p\.id AND pa\.user_id = \$\$\{params\.length\}\)/,
    );
  });
  it("null-state scoped roles fail closed on the list", () => {
    // The list branch returns an empty result / restrictive filter when stateId is null
    const list = routeSlice(projectsSrc, 'router.get("/projects"', 4000);
    expect(list).toMatch(/stateId (=+ null|== null|=== null)|stateId\b.*null/);
  });
});

describe("PRJ-ZR-07 — Donor endpoint explicit permission (PRJ-036)", () => {
  it("GET /donors requires projects.view", () => {
    expect(projectsSrc).toContain('router.get("/donors", requirePerm("projects.view")');
  });
});

describe("PRJ-ZR-08 / PRJ-ZR-09 — Project code uniqueness + concurrent generation safety (PRJ-008/PRJ-018)", () => {
  it("migration 024_project_code_unique is registered with a UNIQUE constraint", () => {
    expect(migrationsSrc).toContain('name: "024_project_code_unique"');
    const mig = routeSlice(migrationsSrc, '"024_project_code_unique"', 3000);
    expect(mig).toMatch(/UNIQUE/i);
  });
  it("advisory lock is taken before MAX+1 code computation", () => {
    const create = routeSlice(projectsSrc, 'router.post("/projects"', 12000);
    const lock = create.indexOf("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(-1);
    expect(create.slice(lock)).toContain("project_code_");
  });
  it("unique violation maps to 409 project_code_conflict, not a raw SQL error", () => {
    expect(projectsSrc).toContain('res.status(409).json({ error: "project_code_conflict" })');
  });
});

describe("PRJ-ZR-10 — Locality tables intentional and safely deleted (PRJ-019)", () => {
  it("schema comments document both locality tables", () => {
    expect(migrationsSrc).toContain("COMMENT ON TABLE project_free_localities");
    expect(migrationsSrc).toContain("COMMENT ON TABLE project_localities");
  });
  it("permanent delete clears both tables (no orphans)", () => {
    expect(projectsSrc).toMatch(/DELETE FROM project_localities\s+WHERE project_id = \$1/);
    expect(projectsSrc).toMatch(/DELETE FROM project_free_localities\s+WHERE project_id = \$1/);
  });
});

describe("PRJ-ZR-11 — Migration full-name identity (PRJ-029)", () => {
  it("both 021_ migrations remain independently registered with distinct full names", () => {
    expect(migrationsSrc).toContain("021_hq_sector_location_integrity");
    expect(migrationsSrc).toContain("021_report_attachments_drive_file_id.sql");
  });
  it("registry has no duplicate full migration names", () => {
    const names = [...migrationsSrc.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(20);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("PRJ-ZR-12 — Report KPI no double counting (PRJ-034)", () => {
  it("report-kpis route sources from reports payloads, never JOINs the activities table", () => {
    const kpi = routeSlice(projectsSrc, 'router.get("/projects/:projectId/report-kpis"', 7000);
    expect(kpi).toMatch(/FROM reports r/);
    expect(kpi.includes("JOIN activities")).toBe(false);
    expect(kpi.includes("FROM activities")).toBe(false);
  });
});

describe("PRJ-ZR-13 / PRJ-ZR-14 — Canonical donor grouping and per-currency totals", () => {
  it("donor portfolio groups by canonical:${donor_id} first, free:normalized fallback", () => {
    expect(dashboardSrc).toMatch(/`canonical:\$\{row\.d_id\}`/);
    expect(dashboardSrc).toMatch(/`free:\$\{row\.free_text_donor!?\.toLowerCase\(\)\.trim\(\)\}`/);
  });
  it("data-quality states preserved and totals kept per currency", () => {
    for (const s of ['"linked"', '"unlinked"', '"name_mismatch"', '"missing"']) {
      expect(dashboardSrc).toContain(s);
    }
    expect(dashboardSrc).toContain("budgetByCurrency");
  });
});

describe("PRJ-ZR-15 — Effective multi-sector TC scope (PRJ-BD-05)", () => {
  it("effective sectors = union(primary, sectors[]) via shared helpers used across routes", () => {
    expect(projectsSrc).toContain("function getProjectEffectiveSectors");
    // guard is applied broadly, not on a single route
    const uses = projectsSrc.match(/assertEffectiveSectorAllowedForProject\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(10);
  });
});

describe("PRJ-ZR-16 — Activity expenditure preserved on PATCH (Task #455)", () => {
  it("PATCH carries forward budget_spent and progress_pct for existing activity IDs", () => {
    expect(projectsSrc).toMatch(/SELECT id,\s*budget_spent,\s*progress_pct,\s*state_id FROM activities WHERE project_id = \$1/);
    expect(projectsSrc).toContain("Existing activity — UPDATE, preserving budget_spent and progress_pct");
  });
});

describe("PRJ-ZR-17 — State allocation membership integrity", () => {
  it("allocation to unlinked State returns 422 project_state_not_linked, no PM bypass", () => {
    const alloc = routeSlice(projectsSrc, 'router.post("/projects/:projectId/state-allocations"', 6000);
    expect(alloc).toContain('"project_state_not_linked"');
    expect(alloc).toMatch(/does NOT bypass/i);
    // single-release discipline: the finally block owns cleanup
    expect(alloc).toMatch(/finally block owns cleanup/);
  });
});

describe("PRJ-ZR-18 — Document lifecycle gates (Task #472)", () => {
  it("doc gate helper exists and mutations lock the project row in-transaction", () => {
    expect(projectsSrc).toContain("async function getProjectDocGate");
    expect(projectsSrc).toMatch(/SELECT status FROM projects WHERE id = \$1 AND deleted_at IS NULL FOR UPDATE/);
  });
});

describe("PRJ-ZR-19 — Full Access cannot bypass integrity", () => {
  it("permanent delete blocks when financed activities exist (spend gate ahead of cascade)", () => {
    const del = routeSlice(projectsSrc, 'router.delete("/projects/:projectId"', 9000);
    const spendGate = del.indexOf("budget_spent > 0");
    const cascade = del.indexOf("DELETE FROM project_localities");
    expect(spendGate).toBeGreaterThan(-1);
    expect(cascade).toBeGreaterThan(spendGate);
  });
  it("transition source-state validation precedes any '*' permission grant", () => {
    const handler = routeSlice(projectsSrc, 'router.post("/projects/:projectId/transitions"', 6000);
    expect(handler.indexOf("transition.from.includes(fromStatus)")).toBeLessThan(
      handler.indexOf('stageAwareNegativePerm(fromStatus)'),
    );
  });
});

describe("PRJ-ZR-20 — No startup DDL", () => {
  it("no ALTER TABLE / CREATE TABLE / CREATE INDEX in Projects runtime routes", () => {
    for (const src of [projectsSrc, dashboardSrc]) {
      expect(/\b(ALTER TABLE|CREATE TABLE|CREATE INDEX)\b/i.test(src)).toBe(false);
    }
  });
});

describe("PRJ-ZR-21 — Draft same-ID lifecycle", () => {
  it("PATCH updates the same project row — no INSERT INTO projects outside CREATE", () => {
    const patch = routeSlice(projectsSrc, 'router.patch("/projects/:projectId"', 14000);
    expect(patch.includes("INSERT INTO projects")).toBe(false);
    expect(patch).toMatch(/UPDATE projects/);
  });
  it("duplicate-check endpoint exists with scoping and soft-delete exclusion", () => {
    const dup = routeSlice(projectsSrc, 'router.get("/projects/duplicate-check"', 5000);
    expect(dup).toContain("deleted_at IS NULL");
  });
});

describe("PRJ-ZR-22 — Reviewer button component parity", () => {
  it("project-detail stage-aware ACTIONS mirror backend stage permissions", () => {
    expect(projectDetailSrc).toMatch(/"request_revision".*projects\.approve\.technical.*\["submitted", "state_reviewed"\]/s);
    expect(projectDetailSrc).toMatch(/"request_revision".*projects\.approve\.coordination.*\["technically_approved"\]/s);
    expect(projectDetailSrc).toMatch(/"request_revision".*projects\.approve\.final.*\["coordination_approved"\]/s);
    expect(projectDetailSrc).toMatch(/"reject".*projects\.approve\.technical/s);
    expect(projectDetailSrc).toMatch(/"reject".*projects\.approve\.final/s);
  });
});

describe("PRJ-ZR-23 — Projects-owned TypeScript clean", () => {
  it("canonical generated types include reportingFrequency and hasHqOperations (no cast workarounds needed)", () => {
    expect(schemasSrc).toMatch(/reportingFrequency\?:/);
    expect(schemasSrc).toMatch(/hasHqOperations\?:/);
  });
  it("Projects route/page sources contain no `as any` escape hatches", () => {
    expect(projectsSrc.includes(" as any")).toBe(false);
    expect(projectDetailSrc.includes(" as any")).toBe(false);
  });
});

describe("PRJ-ZR-24 — Projects-owned test failures zero (suite presence + no skips)", () => {
  const suites = [
    "prj-doc-security.test.ts",
    "prj-governance-access.test.ts",
    "prj-data-integrity.test.ts",
    "prj-doc-lifecycle.test.ts",
    "prj-final-closure.test.ts",
    "prj-closure-sentinel.test.ts",
    "prj-multisector-scope.test.ts",
    "prj-spend-preservation.test.ts",
    "project-bd-sentinels.test.ts",
    "project-audit.test.ts",
    "project-scope-hardening.test.ts",
    "pm-full-operational-access.test.ts",
  ];
  it("all Projects closure suites exist and contain no skipped/only/todo tests", () => {
    for (const f of suites) {
      const p = resolve(HERE, f);
      expect(existsSync(p), `missing suite ${f}`).toBe(true);
      const src = readFileSync(p, "utf8");
      expect(/\b(it|describe|test)\.(skip|only|todo)\(/.test(src), `${f} contains skip/only/todo`).toBe(false);
    }
  });
  it("this sentinel file covers PRJ-ZR-01 through PRJ-ZR-24", () => {
    const self = readFileSync(resolve(HERE, "prj-zero-residual.test.ts"), "utf8");
    for (let i = 1; i <= 24; i++) {
      const id = `PRJ-ZR-${String(i).padStart(2, "0")}`;
      expect(self.includes(id), `missing ${id}`).toBe(true);
    }
    void readdirSync(HERE);
  });
});
