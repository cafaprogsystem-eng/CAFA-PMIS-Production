/**
 * State Programme and HQ Sector report forms on HeroUI: fixes made during
 * the move — the HQ form crash on the risk list envelope, the SPR risk query
 * that never matched, shifted HQ section headings, literal asterisks, English
 * option lists and unlabelled controls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const spr = readFileSync(resolve(root, "components/program-state-report-form.tsx"), "utf8");
const hq = readFileSync(resolve(root, "components/hq-sector-report-form.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(root, "locales/en/reports.json"), "utf8"));
const ar = JSON.parse(readFileSync(resolve(root, "locales/ar/reports.json"), "utf8"));

/** Values of a `const NAME = [ "…", … ] as const;` list in a source file. */
function constValues(src: string, name: string): string[] {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("REPORTS-HEROUI-SPR-HQSR", () => {
  it("HQ form accepts the paginated risk list instead of crashing on it", () => {
    // GET /api/risks answers { items, total, … }; calling .map on that object
    // threw and took the whole Reports page down.
    expect(hq).toContain("return Array.isArray(body) ? body : body.items ?? [];");
    expect(hq).not.toContain("return res.json() as Promise<ExistingRisk[]>;");
  });

  it("SPR asks for the State's active risks in a way the API understands", () => {
    // The API reads a single "status"; a repeated one matched nothing.
    expect(spr).not.toContain("status=open&status=under_mitigation");
    expect(spr).toContain("/api/risks?stateId=${v.stateId}&activeOnly=1&limit=200");
  });

  it("HQ section headings name the field under them", () => {
    const pairs: Array<[string, string, string]> = [
      ["section3Title", "technicalAnalysis", "Technical Analysis"],
      ["section4Title", "keyFindings", "Key Findings"],
      ["section5Title", "qualityAssessment", "Quality Assessment"],
      ["section6Title", "technicalChallenges", "Technical Challenges"],
      ["section7Title", "recommendations", "Recommendations"],
      ["section14Title", "lessonsLearned", "Lessons Learned"],
    ];
    for (const [key, field, title] of pairs) {
      expect(en.hqForm[key], key).toContain(title);
      const at = hq.indexOf(`t("hqForm.${key}")}</h4>`);
      expect(hq.slice(at, at + 300), key).toContain(`form.register("${field}")`);
    }
    expect(en.hqForm.section11Title).toContain("Indicator Commentary");
    expect(en.hqForm.section16Title).toContain("Supporting Documents");
    expect(en.hqForm.section17Title).toContain("Voice Note");
    expect(ar.hqForm.section3Title).toBe("3. التحليل التقني");
  });

  it("required markers come from isRequired, not asterisks in the text", () => {
    for (const lang of [en, ar]) {
      for (const [key, value] of Object.entries(lang.stateForm as Record<string, unknown>)) {
        if (typeof value === "string" && /Label$|Title$/.test(key)) expect(value.trim(), key).not.toMatch(/\*$/);
      }
    }
    expect(spr).toContain('<Field className="col-span-2" label={t("stateForm.reportTitleLabel")} isRequired>');
  });

  it("offers every stored option in Arabic without changing the stored value", () => {
    const lists: Array<[string, string, string]> = [
      [spr, "ACTIVITY_STATUS", "activityStatus"], [spr, "ATTACHMENT_TYPES", "attachmentTypes"],
      [spr, "ON_DEMAND_REASONS", "onDemandReasons"], [spr, "HQ_SUPPORT_TYPES", "supportTypes"],
      [spr, "PRIORITIES", "priorities"], [spr, "RISK_CATEGORIES", "riskCategories"],
      [hq, "ON_DEMAND_REASONS", "onDemandReasons"], [hq, "SUPPORT_TYPES", "supportTypes"],
      [hq, "RISK_CATEGORIES", "riskCategories"], [hq, "RISK_LIKELIHOODS", "likelihoods"],
      [hq, "TECHNICAL_RATINGS", "technicalRatings"], [hq, "ATTACHMENT_TYPES", "attachmentTypes"],
    ];
    for (const [src, name, group] of lists) {
      for (const value of constValues(src, name)) {
        expect(ar.formOptions[group]?.[value], `${group}.${value}`).toEqual(expect.any(String));
        expect(ar.formOptions[group][value], `${group}.${value}`).not.toBe(value);
      }
      expect(src).toContain(`optionLabel(t, "${group}"`);
    }
  });

  it("links every label to its control", () => {
    // The only bare <HLabel> is ChipSelect's, which React Aria's Select links itself.
    for (const src of [spr, hq]) {
      const unlinked = [...src.matchAll(/<HLabel(?![^>]*htmlFor)[^>]*>/g)].map((m) => m[0]);
      expect(unlinked.filter((l) => l !== "<HLabel>")).toEqual([]);
    }
    expect((spr.match(/<Field /g) ?? []).length).toBeGreaterThanOrEqual(25);
    expect((hq.match(/<Field /g) ?? []).length).toBeGreaterThanOrEqual(15);
  });

  it("names every icon-only delete button", () => {
    expect((hq.match(/aria-label=\{t\("hqForm\.removeItemAria"/g) ?? []).length).toBe(4);
    for (const src of [spr, hq]) {
      for (const m of src.matchAll(/<HButton[^>]*>\s*<Trash2/g)) expect(m[0]).toContain("aria-label=");
    }
  });

  it("shows risk details in the active language and keeps project names whole", () => {
    expect(hq).not.toContain("r.projectTitle.slice(0,20)}…");
    expect(hq).toContain('{r.status && <Chip size="sm" variant="tertiary">{riskStatusText(t, r.status)}</Chip>}');
    for (const form of ["zero", "one", "two", "few", "many", "other"]) {
      expect(ar.hqForm[`linkedRisks_${form}`], form).toEqual(expect.any(String));
      expect(ar.hqForm[`risksFound_${form}`], form).toEqual(expect.any(String));
    }
  });

  it("keeps the save/submit footer in view while the long forms scroll", () => {
    for (const src of [spr, hq]) {
      expect(src).toContain('className="sticky -bottom-4 z-10 -mx-5 -mb-4 flex flex-wrap justify-end gap-2');
      expect(src).not.toContain("DialogFooter");
    }
  });
});
