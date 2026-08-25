import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manual = readFileSync(new URL("../routes/manual.ts", import.meta.url), "utf8");
const entrypoint = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("controlled Manual localization importer", () => {
  it("has a read-only preflight before the write transaction", () => {
    const preflight = manual.indexOf("const preflight = await runManualImportPreflight()");
    const connect = manual.indexOf("const client = await dbPool.connect()", preflight);
    expect(preflight).toBeGreaterThan(-1);
    expect(connect).toBeGreaterThan(preflight);
  });

  it("blocks missing mappings with the explicit precheck state", () => {
    expect(manual).toContain('state: "PRECHECK_BLOCKED"');
    expect(manual).toContain("missingMappings > 0");
    expect(manual).toContain("res.status(409)");
  });

  it("returns stable source identity and field details for blockers", () => {
    expect(manual).toContain("kind: string; id: number; field: string");
    expect(manual).toContain("MISSING_TRANSLATION_MAPPING");
  });

  it("opens an explicit transaction only after preflight", () => {
    expect(manual).toContain('await client.query("BEGIN")');
    expect(manual).toContain('await client.query("COMMIT")');
    expect(manual).toContain('await client.query("ROLLBACK")');
  });

  it("persists source checksums inside the importer transaction", () => {
    expect(manual).toContain("source_checksum=CASE");
    expect(manual).toContain("manualSourceChecksum");
    expect(manual).toContain("source_updated_at");
  });

  it("preserves the prior checksum relationship when source content drifts", () => {
    expect(manual).toContain("source_checksum=CASE");
    expect(manual).toContain("source_checksum IS DISTINCT FROM $2");
    expect(manual).toContain("'review_required'");
  });

  it("does not overwrite checksum-tracked Arabic drafts on repeat imports", () => {
    expect(manual).toContain("source_checksum IS NULL");
    expect(manual).toContain("translation_status = 'draft_machine_generated'");
  });

  it("protects reviewed content with status-aware conflict handling", () => {
    expect(manual).toContain("reviewed_by_id");
    expect(manual).toContain("reviewed_at");
    expect(manual).toContain("translation_status");
  });

  it("reports deterministic reconciliation categories without writing", () => {
    expect(manual).toContain("dryRun: true");
    expect(manual).toContain("sourceChanged");
    expect(manual).toContain("orphaned");
    expect(manual).toContain("invalid");
  });

  it("keeps startup independent of localization import", () => {
    expect(entrypoint).not.toContain("initializeManualContent");
    expect(entrypoint).not.toContain("ensureLocalizedCorpus");
  });

  it("keeps normal reads separate from the explicit importer", () => {
    const importer = manual.indexOf('router.post("/manual/localization/import-machine-draft"');
    expect(importer).toBeGreaterThan(-1);
    for (const route of [
      'router.get("/manual/search"',
      'router.get("/manual/chapters"',
      'router.get("/manual/faqs"',
    ]) {
      expect(manual.indexOf(route)).toBeLessThan(importer);
    }
  });

  it("returns an explicit transaction failure instead of success after rollback", () => {
    expect(manual).toContain('state: "TRANSACTION_FAILED"');
    expect(manual).toContain("rolledBack: true");
  });
});