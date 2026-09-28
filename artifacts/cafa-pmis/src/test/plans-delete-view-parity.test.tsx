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

  it("gates the delete action behind a confirmation dialog using the shared confirmation copy", () => {
    // A HeroUI alert dialog replaces the browser's native confirm().
    expect(src).not.toContain("confirm(");
    expect(src).toContain('role="alertdialog"');
    expect(src).toContain('{t("detail.deletePlanConfirm")}');
    expect(src).toContain("deleteMutation.mutate({ planId: deleteTarget.id })");
  });

  it("the shared viewRecords.actions slot (Card/List/Compact/Kanban/Calendar) renders the delete dropdown when canDelete is true", () => {
    // The actions expression must render for canDelete regardless of draft status,
    // not just for the pre-existing Continue Editing (draft-only) condition.
    expect(src).toMatch(/actions:\s*\n\s*\(canEditDrafts && p\.status === "draft"\) \|\| canDelete \? \(/);
    expect(src).toContain("<Trash2");
    expect(src).toContain("onDelete={() => handleDeletePlan(p)}");
  });

  it("the Table view (a separate inline render, not driven by viewRecords) also has its own Actions column and delete cell", () => {
    expect(src).toContain('{t("table.actions")}');
    // The DataGrid has an explicit actions column rendering the same menu.
    expect(src).toMatch(/\{ id: "actions",[\s\S]*?<PlanActionsMenu label=\{t\("table\.actionsAria"\)\} onDelete=\{\(\) => handleDeletePlan\(p\)\} \/>/);
  });

  it("both the card/list/etc actions slot and the Table cell use the same aria-label and delete menu item", () => {
    // Both surfaces render the one PlanActionsMenu (same label, same delete item).
    const menuUses = src.match(/<PlanActionsMenu label=\{t\("table\.actionsAria"\)\}/g) ?? [];
    expect(menuUses.length).toBe(2);
    expect(src.match(/function PlanActionsMenu/g) ?? []).toHaveLength(1);
    expect(src).toContain('<Label>{t("detail.deletePlanMenu")}</Label>');
  });

  it("viewRecords memo dependency array includes canDelete and handleDeletePlan (regression guard against stale closures)", () => {
    expect(src).toMatch(/\[paginatedPlans, t, i18n\.language, openRecord, canEditDrafts, continueEdit, canDelete, handleDeletePlan, planTypeLabel\]/);
  });
});
