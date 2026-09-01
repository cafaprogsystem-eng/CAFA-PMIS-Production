/**
 * PRJ-VIEW-ACTIONS-PARITY — Card/List/Compact/Kanban/Calendar/Map views all
 * render off the shared `viewRecords` array, and only ever show whatever is
 * in each record's `actions` slot. That slot previously carried only the
 * "Continue Editing" action for drafts, so those views had no way to submit,
 * duplicate, or delete a project — only the Table view's own row markup did.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/projects.tsx"), "utf8");

describe("PRJ-VIEW-ACTIONS-PARITY — viewRecords carries delete/submit/duplicate for non-table views", () => {
  it("gates the shared actions slot on canDelete (or continue-editing) rather than draft-only", () => {
    expect(src).toContain('actions: (p.status === "draft" && canContinueEdit) || canDelete ? (');
  });

  it("wires delete into the shared actions slot via the same setDeleteTarget used by the table row", () => {
    expect(src).toMatch(/setDeleteTarget\(\{ id: p\.id, code: p\.code \?\? "", title: p\.title \}\)/);
  });

  it("wires submit and duplicate into the shared actions slot", () => {
    expect(src).toContain("handleDirectSubmitProject(p)");
    expect(src).toContain("handleDuplicateProject(p)");
  });

  it("includes canDelete and the action handlers in the viewRecords memo dependency array", () => {
    const memoMatch = src.match(/\[projects, openRecord, t, tCommon, canContinueEdit, continueEdit, canDelete, handleDirectSubmitProject, handleDuplicateProject\]/);
    expect(memoMatch).not.toBeNull();
  });
});
