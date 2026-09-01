/**
 * PLANS-DELETE-PARITY — plans.tsx previously offered no delete affordance in
 * ANY view mode (not even the table), unlike projects.tsx which already got a
 * delete/overflow menu across every view (Table/Card/List/Compact/Kanban/
 * Calendar). plans.delete is a real, backend-enforced permission already used
 * by plan-detail.tsx's own delete action — it is now reachable from the Plans
 * list/board/calendar views too, gated the same way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/plans.tsx"), "utf8");

describe("PLANS-DELETE-PARITY: delete is wired into the shared viewRecords actions slot and the Table view", () => {
  it("computes a plans.delete permission check, same contract as plan-detail.tsx's own delete action", () => {
    expect(src).toContain('const canDelete = hasPerm(me?.permissions, "*") || hasPerm(me?.permissions, "plans.delete");');
  });

  it("wires useDeletePlan with the same toast/invalidate contract as plan-detail.tsx", () => {
    expect(src).toContain("useDeletePlan({");
    expect(src).toContain('toast.success(t("toast.planDeleted"))');
    expect(src).toContain("qc.invalidateQueries()");
  });

  it("gates the delete action behind a confirm() dialog using the shared confirmation copy", () => {
    expect(src).toContain('confirm(t("detail.deletePlanConfirm"))');
    expect(src).toContain("deleteMutation.mutate({ planId: p.id })");
  });

  it("the shared viewRecords.actions slot (Card/List/Compact/Kanban/Calendar) renders the delete dropdown when canDelete is true", () => {
    // The actions expression must render for canDelete regardless of draft status,
    // not just for the pre-existing Continue Editing (draft-only) condition.
    expect(src).toMatch(/actions:\s*\n\s*\(canEditDrafts && p\.status === "draft"\) \|\| canDelete \? \(/);
    expect(src).toContain("<Trash2");
    expect(src).toContain("onClick={() => handleDeletePlan(p)}");
  });

  it("the Table view (a separate inline render, not driven by viewRecords) also has its own Actions column and delete cell", () => {
    expect(src).toContain('{t("table.actions")}');
    // Empty-state colSpan must have been widened from 8 to 9 for the new column.
    expect(src).toContain("colSpan={9}");
    expect(src).not.toContain("colSpan={8}");
  });

  it("both the card/list/etc actions slot and the Table cell use the same aria-label and delete menu item", () => {
    const ariaMatches = src.match(/aria-label=\{t\("table\.actionsAria"\)\}/g) ?? [];
    const deleteItemMatches = src.match(/\{t\("detail\.deletePlanMenu"\)\}/g) ?? [];
    // One instance in the shared viewRecords actions slot, one in the Table view's own cell.
    expect(ariaMatches.length).toBe(2);
    expect(deleteItemMatches.length).toBe(2);
  });

  it("viewRecords memo dependency array includes canDelete and handleDeletePlan (regression guard against stale closures)", () => {
    expect(src).toMatch(/\[paginatedPlans, t, i18n\.language, openRecord, canEditDrafts, continueEdit, canDelete, handleDeletePlan\]/);
  });
});
