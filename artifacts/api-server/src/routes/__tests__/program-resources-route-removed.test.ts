/**
 * PROGRAM-RESOURCES-ROUTE-REMOVED — routes/program-resources.ts was a second,
 * completely separate, live API surface for the exact same program_resources
 * table already hardened in files.ts (confidentiality gate, sector scope,
 * state_id-scoped SPO access, orphaned document_registry_entries cleanup on
 * delete). Its GET routes had NO permission check at all (any authenticated
 * user could list/view every resource regardless of confidentiality/sector),
 * GET /:id returned the raw object_path directly in the JSON response, and
 * DELETE /:id never cleaned up the storage object or its
 * document_registry_entries row.
 *
 * Confirmed dead before removal: the frontend route (App.tsx) already
 * redirects "/program-resources" to the canonical File & Archive page via
 * LegacyFilesRedirect rather than rendering pages/program-resources.tsx (an
 * existing test, files-archive-navigation.test.ts's DOC-NAV-01/02/03, already
 * pinned `expect(app).not.toContain('component={ProgramResourcesPage}')`) —
 * this was leftover cleanup from an already-completed File & Archive
 * consolidation, not a live feature. Removed entirely (route file, frontend
 * page, and the router mount) rather than duplicating files.ts's hardening
 * into a second implementation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("PROGRAM-RESOURCES-ROUTE-REMOVED", () => {
  it("routes/program-resources.ts no longer exists", () => {
    expect(existsSync(resolve(__dirname, "../program-resources.ts"))).toBe(false);
  });

  it("routes/index.ts no longer imports or mounts it", () => {
    const src = readFileSync(resolve(__dirname, "../index.ts"), "utf8");
    expect(src).not.toContain("program-resources");
    expect(src).not.toContain("programResourcesRouter");
  });

  it("pages/program-resources.tsx no longer exists on the frontend", () => {
    expect(existsSync(resolve(__dirname, "../../../../cafa-pmis/src/pages/program-resources.tsx"))).toBe(false);
  });
});
