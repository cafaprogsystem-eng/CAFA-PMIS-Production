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
  // Table and alternate views share one renderer, so they cannot drift apart.
  const renderStart = src.indexOf("const renderRowActions = useCallback((r: Report, inMenu = false) => {");
  const block = renderStart >= 0 ? src.slice(renderStart, src.indexOf("const viewRecords", renderStart)) : "";

  it("the shared row-actions renderer exists and feeds viewRecords", () => {
    expect(renderStart).toBeGreaterThan(-1);
    expect(src).toContain("actions: renderRowActions(r),");
  });

  it("the outer visibility gate is widened to either resume or delete permission", () => {
    expect(block).toContain("if (!canResume && !canDelete) return undefined;");
  });

  it("Submit and Duplicate are exposed via the row menu, gated by canResumeReportDraft", () => {
    expect(block).toContain("const canResume = canResumeReportDraft(r, perms, me?.user);");
    expect(block).toContain("handleDirectSubmit(r)");
    expect(block).toContain("handleDuplicateReport(r)");
    expect(block).toContain('t("list.submit")');
    expect(block).toContain('t("list.duplicate")');
  });

  it("Delete is exposed via the row menu, gated independently by canDeleteReportDraft", () => {
    expect(block).toContain("const canDelete = canDeleteReportDraft(r, perms, me?.user);");
    expect(block).toContain("...(canDelete ? [{ id: \"delete\"");
    expect(block).toContain("setDeleteTarget(r)");
    expect(block).toContain('t("list.deleteDraft")');
  });

  it("ContinueEditingAction is still rendered alongside the menu in the card/list views", () => {
    expect(block).toContain("<ContinueEditingAction");
    expect(block).toContain("{canResume && !inMenu && (");
  });

  it("all four non-table view modes (Card/List/Compact/Kanban) consume the same viewRecords array", () => {
    const consumers = [...src.matchAll(/items=\{viewRecords\}/g)];
    expect(consumers.length).toBe(4);
  });
});
