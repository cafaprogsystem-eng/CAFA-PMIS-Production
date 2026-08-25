/**
 * Risk Register — Residual Integrity Closure Wave 2 (frontend invariants)
 * (RISK-010 fallback rendering, RISK-016 envelope handling, #576 clear-null)
 * British English throughout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const risksPage = readFileSync(join(ROOT, "pages/risks.tsx"), "utf8");
const planDetail = readFileSync(join(ROOT, "pages/plan-detail.tsx"), "utf8");
const createPlanDialog = readFileSync(join(ROOT, "components/create-plan-registration-dialog.tsx"), "utf8");
const reportsPage = readFileSync(join(ROOT, "pages/reports.tsx"), "utf8");

// ── RISK-RES-08 (frontend) — paginated envelope handled everywhere ───────────
describe("RISK-016 frontend: paginated risk list envelope", () => {
  it("risks page reads items from the envelope", () => {
    expect(risksPage).toContain("risksRaw?.items");
    expect(risksPage).toContain('ListRisksQueryResult["items"][number]');
  });
  it("plan detail and create-plan dialog read items from the envelope", () => {
    expect(planDetail).toContain("risksData?.items");
    expect(createPlanDialog).toContain("risksData?.items");
  });
  it("reports page fetch unwraps the envelope (raw fetch consumer)", () => {
    expect(reportsPage).toContain("body.items ?? []");
  });
});

// ── RISK-RES-11/12 (frontend) — clearing sends explicit null (#576) ──────────
describe("#576 frontend: clearing assignee / due date sends null", () => {
  // Scope the omit checks to the edit-save block: the CREATE form may still
  // omit unset optional fields (no clearing semantics exist at create time).
  const editSaveBlock = risksPage.slice(
    risksPage.indexOf("const onSave = form.handleSubmit"),
    risksPage.indexOf("updateMutation.mutate"),
  );
  it("edit save includes assignedToId as explicit null when cleared (never omit)", () => {
    expect(editSaveBlock).toContain("cleaned.assignedToId = values.assignedToId ?? null");
    expect(editSaveBlock).not.toContain("delete cleaned.assignedToId");
  });
  it("edit save converts an empty due date to explicit null (never omit)", () => {
    expect(editSaveBlock).toContain("cleaned.dueDate = values.dueDate ? values.dueDate : null");
    expect(editSaveBlock).not.toContain("delete cleaned.dueDate");
  });
  it("the Unassigned option sets null (not undefined) in the edit form", () => {
    expect(risksPage).toContain('form.setValue("assignedToId", v === "__none__" ? null : Number(v))');
  });
});

// ── RISK-RES-04 (frontend) — soft-deleted project fallback (RISK-010) ────────
describe("RISK-010 frontend: soft-deleted project title fallback", () => {
  it("list renders a safe fallback when a linked project's title is null", () => {
    expect(risksPage).toMatch(/r\.projectTitle \|\| \(r\.projectId \? t\("projectRemoved"/);
  });
  it("detail sheet renders the fallback rather than the raw project id", () => {
    expect(risksPage).toMatch(/risk\.projectId \? ` · \$\{t\("projectRemoved"/);
    expect(risksPage).not.toContain("`Project #${risk.projectId}`");
  });
});
