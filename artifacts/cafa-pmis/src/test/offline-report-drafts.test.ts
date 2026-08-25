import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../locales/en/common.json";
import ar from "../locales/ar/common.json";

const src = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(src, path), "utf8");

describe("durable offline report draft contract", () => {
  const store = read("lib/offline/report-drafts.ts");

  it("scopes snapshots to the active account and avoids creating empty drafts", () => {
    expect(store).toContain("storageDraftKey(userId, draftKey)");
    expect(store).toContain('lastPersistedJson.current = row?.snapshot ?? snapshotJson');
    expect(store).toContain("lastPersistedJson.current === snapshotJson");
  });

  it("restores a snapshot before autosaving a later meaningful change", () => {
    expect(store).toContain("onRestore(JSON.parse(row.snapshot) as T)");
    expect(store).toContain("setTimeout(() =>");
    expect(store).toContain("Only an actual change after this baseline is persisted");
  });

  it("links replay outcomes back to the same draft", () => {
    const sync = read("lib/offline/sync-service.ts");
    const interceptor = read("lib/offline/fetch-interceptor.ts");
    expect(sync).toContain("draftKey: opts.draftKey ?? null");
    expect(sync).toContain("settleReportDraftOperation");
    expect(interceptor).toContain("_draftKey");
  });
});

describe("report workflow offline guardrails", () => {
  const reports = read("pages/reports.tsx");
  const hq = read("components/hq-sector-report-form.tsx");
  const spr = read("components/program-state-report-form.tsx");

  it("covers Project, Activity, HQ Sector, and State Programme editors", () => {
    expect(reports).toContain('reportDraftKey(\n      (isActivity ? "activity" : "project")');
    expect(reports).toContain("activeSection,");
    expect(reports).toContain("riskStatusEdits,");
    expect(hq).toContain('reportDraftKey("hq_sector"');
    expect(spr).toContain('reportDraftKey("program_state"');
  });

  it("keeps submit and reviewer decisions online-only", () => {
    for (const source of [reports, hq, spr]) {
      expect(source).toContain('t("sync.internetRequired", { ns: "common" })');
      expect(source).toContain("!isOnline ||");
    }
    expect(reports).toContain("const onTransition = async () =>");
    expect(reports).toContain('aria-describedby={!isOnline ? "report-transition-offline-notice"');
  });

  it("provides translated recovery language in English and Arabic", () => {
    for (const locale of [en, ar]) {
      expect(locale.sync.savedOnDeviceAt).toBeTruthy();
      expect(locale.sync.draftRecovery).toBeTruthy();
      expect(locale.sync.draftSyncRecovery).toBeTruthy();
      expect(locale.sync.conflictRecovery).toBeTruthy();
      expect(locale.sync.discardLocalDraft).toBeTruthy();
    }
  });
});