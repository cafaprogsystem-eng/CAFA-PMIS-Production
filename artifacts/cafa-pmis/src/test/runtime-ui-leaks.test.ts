import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../locales/en/common.json";
import ar from "../locales/ar/common.json";
import enNav from "../locales/en/nav.json";
import arNav from "../locales/ar/nav.json";

const src = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(src, path), "utf8");
const readWorkspace = (path: string) => readFileSync(resolve(src, "../../..", path), "utf8");

describe("runtime-facing feedback contract", () => {
  it("uses neutral global service wording and a separate verified local-draft outcome", () => {
    for (const locale of [en, ar]) {
      expect(locale.sync.serviceUnavailable).not.toMatch(/not been saved|لم يتم حفظ/i);
      expect(locale.sync.draftQueuedOnDevice).toBeTruthy();
    }
    for (const source of [
      read("pages/reports.tsx"),
      read("components/program-state-report-form.tsx"),
      read("components/hq-sector-report-form.tsx"),
    ]) {
      expect(source).toContain('sync.draftQueuedOnDevice');
      expect(source).not.toContain('toast.info(t("sync.offlineBanner", { ns: "common" }))');
    }
  });

  it("keeps the demo role harness disabled unless a non-production build enables it", () => {
    expect(readWorkspace("lib/api-client-react/src/custom-fetch.ts")).toContain("demoRoleHarnessEnabled()");
    expect(read("components/layout.tsx")).toContain("enabled: demoModeEnabled && isSuperAdmin");
    expect(readWorkspace("artifacts/api-server/src/routes/me.ts")).toContain("if (!isDemoRoleHarnessEnabled())");
  });

  it("provides complete translated global-search and command shortcut resources", () => {
    for (const locale of [en, ar]) {
      expect(locale.globalSearch.placeholder).toBeTruthy();
      expect(locale.globalSearch.ariaLabel).toBeTruthy();
      expect(locale.globalSearch.searchResults).toBeTruthy();
      expect(locale.globalSearch.favorites).toBeTruthy();
      expect(locale.globalSearch.groups.projects).toBeTruthy();
      expect(locale.keys.tab).toBeTruthy();
      expect(locale.keys.esc).toBeTruthy();
    }
    for (const locale of [enNav, arNav]) {
      expect(locale.commandPalette.groups.projects).toBeTruthy();
      expect(locale.commandPalette.hints.navigate).toBeTruthy();
    }
    const search = read("components/global-search.tsx");
    const palette = read("components/command-palette.tsx");
    expect(search).toContain('t("globalSearch.placeholder")');
    expect(search).toContain('t("globalSearch.favorites")');
    expect(search).toContain('t("globalSearch.groups.projects")');
    expect(search).toContain('t("keys.esc")');
    expect(palette).toContain('tNav("commandPalette.groups.projects")');
    expect(palette).toContain('tNav("common:keys.esc")');
  });

  it("keeps calendar copy complete in both production locales", () => {
    for (const locale of [en, ar]) {
      expect(locale.calendarWidget).toBeTruthy();
      expect(locale.calendarWidget.months).toHaveLength(12);
      expect(locale.calendarWidget.days).toHaveLength(7);
      expect(new Set(locale.calendarWidget.days).size).toBe(7);
      expect(locale.calendarWidget.types.project).toBeTruthy();
      expect(locale.calendarWidget.types.plan_activity).toBeTruthy();
      expect(locale.calendarWidget.due.overdue).toBeTruthy();
      expect(locale.calendarWidget.unknownType).toBeTruthy();
      expect(locale.calendarWidget.unknownDue).toBeTruthy();
      expect(locale.calendarWidget.unknownStatus).toBeTruthy();
    }

    const calendar = read("components/calendar-widget.tsx");
    const pmr = read("components/pmr-completeness-panel.tsx");
    expect(calendar).toContain('calendarText(t, "calendarWidget.unknownType")');
    expect(calendar).toContain('calendarText(t, "calendarWidget.unknownDue")');
    expect(calendar).toContain('calendarText(t, "calendarWidget.unknownStatus")');
    expect(pmr).toContain('t(`common:calendarWidget.months.${i}`)');
  });
});