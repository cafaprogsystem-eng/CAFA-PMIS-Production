/**
 * Project / Activity report form on HeroUI: fixes made during the move —
 * translated form chrome, options and validation messages, the stale-draft
 * reset, the inverted activities hint, and blank Sonner toasts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const page = readFileSync(resolve(root, "pages/reports.tsx"), "utf8");
const sonner = readFileSync(resolve(root, "components/ui/sonner.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(root, "locales/en/reports.json"), "utf8"));
const ar = JSON.parse(readFileSync(resolve(root, "locales/ar/reports.json"), "utf8"));

const formStart = page.indexOf("<Modal isOpen={createOpen}");
const formEnd = page.indexOf("</Modal>", formStart);
const form = page.slice(formStart, formEnd);
// JSX without {/* comments */}, so section comments don't count as visible text.
const formUi = form.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("REPORTS-HEROUI-FORM", () => {
  it("keeps Sonner toasts visible: the toast class must not collide with HeroUI's .toast", () => {
    // HeroUI hides the children of every .toast that isn't its own frontmost toast.
    expect(sonner).not.toMatch(/"group toast /);
    expect(sonner).not.toContain("group-[.toast]");
    expect(sonner).toContain("group app-toast");
  });

  it("resets to a blank report, not to the last draft that was edited", () => {
    // form.reset(draft) makes the draft react-hook-form's new defaults.
    expect(page).toContain("form.reset(blankFormValues());");
    expect(page).not.toMatch(/form\.reset\(\);/);
    expect(page).toContain("const form = useForm<FormShape>({ defaultValues: blankFormValues() });");
  });

  it("shows the right hint when a project has no activities (it was inverted)", () => {
    expect(form).toContain('{selectedProjectId ? t("formUi.noActivitiesYet") : t("formUi.selectProjectToLoad")}');
  });

  it("has no hard-coded English chrome left in the form", () => {
    for (const text of [
      ">Report Title<", "Results Achieved", '"Yes"', "No / Not Applicable", "Total Direct Reach:", "Add Unplanned Activity",
      "Unplanned Activity (Report Only)", "Actual Expenditure (This Period)", "Reason for Variance", "Achievement Summary",
      "Beneficiary Reach This Period", "% of Implementation", "Financial Summary", "Total Planned (Linked)",
      "Challenges & Next Steps", "Lessons Learned & Narrative", "Success Story / Case Example", "Add Coordination Update",
      "+ Add Files", "Retry Upload", "Previously saved recording", "Evidence &amp; Supporting Documents", "Voice Note (Optional)",
      "Progress & Achievements", "Section 3 —", ">Remove<",
    ]) {
      expect(formUi, text).not.toContain(text);
    }
  });

  it("translates stored option values without changing what is saved", () => {
    expect(page).toContain('["Procurement Delay", "procurementDelay"]');
    expect(page).toContain('["Progress Photos", "progressPhotos"]');
    expect(form).toContain("options={VARIANCE_REASONS.map(([value, key]) => ({ value, label: t(`formUi.varianceReasons.${key}`) }))}");
    expect(form).toContain("options={DOC_TYPES.map(([value, key]) => ({ value, label: t(`formUi.docTypes.${key}`) }))}");
    expect(form).toContain("options={activityStatusOptions}");
    expect(ar.formUi.varianceReasons.procurementDelay).toBe("تأخر المشتريات");
    expect(ar.formUi.docTypes.other).toBe("أخرى");
  });

  it("translates the project report's validation messages", () => {
    const validation = page.slice(page.indexOf("function validateBasicInfo"), page.indexOf("const onSaveDraft = form.handleSubmit"));
    expect(validation).not.toMatch(/"Report Title is required"|"State is required"|"Beneficiary values cannot be negative"/);
    expect(validation).toContain('t("formUi.errors.titleRequired")');
    for (const key of Object.keys(en.formUi.errors)) {
      expect(ar.formUi.errors[key], key).toEqual(expect.any(String));
    }
  });

  it("shows risk category and level in the active language", () => {
    expect(form).toContain('t(`presentation.categories.${risk.category}`, { ns: "risks", defaultValue: risk.category })');
    expect(form).toContain('t(`levels.${rl}`, { ns: "risks", defaultValue: rl })');
  });

  it("shows the locked State and project statuses in the active language", () => {
    expect(form).toContain('value={lockedState ? getStateLabel(lockedState, i18n.language) : ""}');
    expect(page).toContain('t(`status.${p.status}`, { ns: "projects", defaultValue: formatStatusLabel(p.status) })');
  });

  it("closes only through the unsaved-changes check, never by clicking outside", () => {
    expect(form).toContain("<Modal.Backdrop isDismissable={false}>");
    expect(form).toContain("else requestCloseForm();");
    expect(page).toMatch(/const requestCloseForm = \(\) => \{\n\s+if \(isFormDirty\) \{ setShowDiscardConfirm\(true\); return; \}/);
  });

  it("uses HeroUI controls only — no shadcn selects, inputs, dialogs or comboboxes", () => {
    for (const mod of ["ui/select", "ui/dialog", "ui/input", "ui/textarea", "ui/label", "ui/popover", "ui/command", "ui/badge"]) {
      expect(page).not.toContain(`@/components/${mod}"`);
    }
    expect(form).toContain("<SearchPickerField");
    // the only native inputs left are the hidden file pickers behind their labels
    const nativeInputs = form.match(/<input[\s\S]*?\/>/g) ?? [];
    expect(nativeInputs.length).toBe(2);
    for (const input of nativeInputs) expect(input).toContain('type="file"');
  });
});
