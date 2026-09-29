/**
 * Reports registry and viewer fixes made while moving them to HeroUI:
 * translated workflow, history, activity-status and dialog text, the
 * recovered-draft button key, and the shared record viewer's fallbacks.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const page = readFileSync(resolve(root, "pages/reports.tsx"), "utf8");
const modal = readFileSync(resolve(root, "components/record-detail-modal.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(root, "locales/en/reports.json"), "utf8"));
const ar = JSON.parse(readFileSync(resolve(root, "locales/ar/reports.json"), "utf8"));
const commonAr = JSON.parse(readFileSync(resolve(root, "locales/ar/common.json"), "utf8"));

describe("REPORTS-HEROUI-REGISTRY", () => {
  it("resolves Continue editing from the common namespace (the reports key never existed)", () => {
    expect(page).not.toMatch(/t\("continueEditing"\)/);
    expect(page).toContain('t("continueEditing", { ns: "common" })');
    expect(en.continueEditing).toBeUndefined();
  });

  it("translates the workflow path, approval-history actions and actor roles", () => {
    expect(page).toContain("t(`approval.workflowPaths.${wp}`");
    expect(page).not.toContain('"State Authored Workflow"');
    expect(page).toContain("t(`approval.historyActions.${h.action}`");
    expect(page).toContain("t(`roles.${h.actorRole}`, { ns: \"users\"");
    for (const action of ["submit", "technical_review", "coordination_review", "final_approve", "request_revision", "reject"]) {
      expect(ar.approval.historyActions[action]).toEqual(expect.any(String));
    }
  });

  it("names approval-chain roles in the active language in the abbreviation tooltips", () => {
    expect(page).toContain("t(`roles.${WORKFLOW_ROLE_KEYS[abbr]}`, { defaultValue: roles[i] })");
  });

  it("translates stored activity statuses and progress-field labels in the viewer", () => {
    expect(page).toContain("t(`form.activityStatusValues.${ACTIVITY_STATUS_KEYS[raw]}`)");
    expect(ar.form.activityStatusValues.inProgress).toBe("قيد التنفيذ");
    // Progress fields used the raw English label (s.label) instead of the translated one.
    expect(page).not.toContain('s.label.replace(" *", "")');
    expect(page).toContain("<ViewerField key={sec.key} label={configuredFieldLabel(sec)} value={val} />");
  });

  it("keeps the transition, discard, remove-section and delete dialogs translated", () => {
    expect(page).not.toMatch(/>\s*Confirm\s*</);
    expect(page).not.toContain("Discard unsaved changes?");
    expect(page).not.toContain("Remove this section?");
    expect(page).not.toContain("This will permanently delete the draft report");
    for (const key of ["discardTitle", "discardDescription", "keepEditing", "discard", "removeSectionTitle", "removeSectionDescription", "removeSection"]) {
      expect(ar.form[key]).toEqual(expect.any(String));
    }
    expect(ar.detail.confirm).toBe("تأكيد");
  });

  it("isolates dates and numbers, and lets user-entered titles keep their own direction", () => {
    expect(page).toContain('<dd className="font-medium"><bdi dir="ltr">{formatDate(selected.periodStart)}');
    expect(page).toContain('value.toLocaleString("en-GB")');
    expect(page).toContain('dir="auto" className="line-clamp-2 whitespace-normal text-sm font-medium leading-snug text-page-start" title={r.title}');
  });

  it("gives the shared record viewer translated unavailable/error states", () => {
    expect(modal).not.toContain('"Record unavailable"');
    expect(modal).toContain('t("recordDetails.unavailable")');
    expect(commonAr.recordDetails.unavailable).toEqual(expect.any(String));
    expect(commonAr.recordDetails.retry).toEqual(expect.any(String));
  });
});
