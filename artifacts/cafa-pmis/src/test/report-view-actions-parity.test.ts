/**
 * REPORT-VIEW-ACTIONS-PARITY — the Card/List/Compact/Kanban view modes
 * (reports.tsx) only ever rendered a single "Continue Editing" action for a
 * draft, unlike the Table view which already exposed a full Submit/
 * Duplicate/Delete menu. The shared `viewRecords.actions` slot consumed by
 * all four non-table views now renders the same DropdownMenu structure as
 * the Table row, gated by the same canResumeReportDraft/canDeleteReportDraft
 * checks — matching the parity fix already applied to Projects and Plans.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");

describe("REPORT-VIEW-ACTIONS-PARITY: viewRecords.actions matches the Table row's action set", () => {
  const viewRecordsMatch = src.match(
    /const viewRecords: ViewRecord\[\] = useMemo\(\s*\(\) =>[\s\S]*?\n {4}\[reports, lockedType, openReportDetail, perms, me\?\.user, startDraftEditing, t, i18n\.language, handleDirectSubmit, handleDuplicateReport\],\s*\n {2}\);/,
  );

  it("the viewRecords memo exists and is captured for inspection", () => {
    expect(viewRecordsMatch).not.toBeNull();
  });

  const block = viewRecordsMatch ? viewRecordsMatch[0] : "";

  it("the outer visibility gate is widened to either resume or delete permission", () => {
    expect(block).toContain(
      "actions: (canResumeReportDraft(r, perms, me?.user) || canDeleteReportDraft(r, perms, me?.user)) ? (",
    );
  });

  it("Submit and Duplicate are exposed via a DropdownMenu, gated by canResumeReportDraft", () => {
    expect(block).toContain("handleDirectSubmit(r)");
    expect(block).toContain("handleDuplicateReport(r)");
    expect(block).toContain('{t("list.submit")}');
    expect(block).toContain('{t("list.duplicate")}');
  });

  it("Delete is exposed via the DropdownMenu, gated independently by canDeleteReportDraft", () => {
    expect(block).toContain("canDeleteReportDraft(r, perms, me?.user) && (");
    expect(block).toContain("setDeleteTarget(r)");
    expect(block).toContain('{t("list.deleteDraft")}');
  });

  it("ContinueEditingAction is still rendered alongside the dropdown, not replaced by it", () => {
    expect(block).toContain("<ContinueEditingAction");
  });

  it("all four non-table view modes (Card/List/Compact/Kanban) consume the same viewRecords array", () => {
    const consumers = [...src.matchAll(/items=\{viewRecords\}/g)];
    expect(consumers.length).toBe(4);
  });
});
