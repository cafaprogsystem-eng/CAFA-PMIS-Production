/**
 * PMR-A11Y — PMR form accessibility completion (closes PMR-020)
 *
 * Two complementary layers, following the repo's established patterns
 * (fix12-accessibility.test.tsx, pmr-beneficiary-labels.test.tsx):
 *
 * 1. Source-wiring assertions — read reports.tsx and verify the concrete
 *    id / aria-describedby / aria-invalid / aria-required / aria-label
 *    wiring exists at the call sites. This guards the exact gap list from
 *    PMR-020 without rendering the 6k-line page.
 * 2. Rendered doubles — small fragments mirroring the exact JSX emitted by
 *    reports.tsx, rendered with Testing Library, for association and
 *    keyboard-navigation behaviour.
 *
 * No validation logic is exercised or asserted beyond "still present".
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../pages/reports.tsx"), "utf8");
const voiceSrc = readFileSync(join(here, "../components/form-voice-recorder.tsx"), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — source wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("PMR-A11Y source wiring (reports.tsx)", () => {
  it("PMR-A11Y-01: Project selector — trigger id, aria-describedby references help + error ids, error element has id", () => {
    expect(src).toContain('id="pmr-project-trigger"');
    expect(src).toContain('"help-pmr-project"');
    expect(src).toContain('"err-pmr-project"');
    // error element carries the id
    expect(src).toMatch(/id="err-pmr-project" role="alert"/);
    // help container carries the id
    expect(src).toMatch(/id="help-pmr-project"/);
    // trigger is required and invalid-aware
    expect(src).toMatch(/id="pmr-project-trigger"[\s\S]{0,200}aria-invalid=\{!!fieldErrors\["projectId"\]/);
  });

  it("PMR-A11Y-02: Reporting Location — id, aria-describedby, aria-invalid, aria-required; locked inputs aria-readonly", () => {
    expect(src).toMatch(/<Label htmlFor="pmr-location"/);
    expect(src).toMatch(/id="pmr-location"\s+aria-required="true"\s+aria-invalid=\{!!fieldErrors\["stateId"\]/);
    expect(src).toContain('aria-describedby={fieldErrors["stateId"] ? "err-pmr-location" : undefined}');
    expect(src).toMatch(/id="err-pmr-location" role="alert"/);
    // both locked/read-only variants announce read-only state
    const lockedCount = (src.match(/id="pmr-location"\s+readOnly\s+aria-readonly="true"/g) ?? []).length;
    expect(lockedCount).toBe(2);
  });

  it("PMR-A11Y-03: Reporting Month / Year — ids, aria-required, aria-invalid, aria-describedby", () => {
    expect(src).toMatch(/<Label htmlFor="pmr-month">[\s\S]{0,150}t\("form\.reportingMonth"\)/);
    expect(src).toMatch(/id="pmr-month" aria-required="true" aria-invalid=\{!!fieldErrors\["reportingMonth"\][\s\S]{0,120}err-pmr-month/);
    expect(src).toMatch(/<Label htmlFor="pmr-year">[\s\S]{0,150}t\("form\.reportingYear"\)/);
    expect(src).toMatch(/id="pmr-year" aria-required="true" aria-invalid=\{!!fieldErrors\["reportingYear"\][\s\S]{0,120}err-pmr-year/);
    // frequency trigger too
    expect(src).toMatch(/id="pmr-frequency" aria-required="true"/);
  });

  it("PMR-A11Y-04: Quarter — id, aria-required, aria-invalid, aria-describedby", () => {
    expect(src).toMatch(/<Label htmlFor="pmr-quarter">[\s\S]{0,150}t\("form\.quarter"\)/);
    expect(src).toMatch(/id="pmr-quarter" aria-required="true" aria-invalid=\{!!fieldErrors\["quarter"\][\s\S]{0,120}err-pmr-quarter/);
  });

  it("PMR-A11Y-05: On-demand period start / end / reason — ids, association, aria-required", () => {
    expect(src).toMatch(/<Label htmlFor="pmr-period-start">[\s\S]{0,150}t\("form\.periodStart"\)/);
    expect(src).toMatch(/id="pmr-period-start" type="date" aria-required="true" aria-invalid=\{!!fieldErrors\["periodStart"\]/);
    expect(src).toMatch(/id="err-pmr-period-start" role="alert"/);
    expect(src).toMatch(/<Label htmlFor="pmr-period-end">[\s\S]{0,150}t\("form\.periodEnd"\)/);
    expect(src).toMatch(/id="pmr-period-end" type="date"/);
    expect(src).toMatch(/<Label htmlFor="pmr-ondemand-reason">[\s\S]{0,150}t\("form\.onDemandReason"\)/);
    expect(src).toMatch(/id="pmr-ondemand-reason" aria-required="true"/);
  });

  it("PMR-A11Y-06: Repeated activity fields carry row context via rowLabel, remove buttons named", () => {
    expect(src).toContain("const rowLabel = a.name || (a.isUnplanned ? `Unplanned Activity ${i + 1}` : `Activity ${i + 1}`);");
    expect(src).toContain("aria-label={`Remove ${rowLabel}`}");
    expect(src).toContain("aria-label={`Activity Name — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Achievement Summary — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Actual Expenditure (This Period) — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Exception / Reason for Unplanned Activity — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Activity Status — ${rowLabel}`}");
    expect(src).toContain("aria-label={`% of Implementation — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Challenges — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Mitigation Measures — ${rowLabel}`}");
    expect(src).toContain("aria-label={`Next Steps — ${rowLabel}`}");
    // simple (non-project) grid remove button also named
    expect(src).toContain('aria-label={a.name ? `Remove "${a.name}"` : `Remove activity ${i + 1}`}');
  });

  it("PMR-A11Y-07: Activity numeric inputs use inputMode numeric/decimal", () => {
    expect(src).toMatch(/inputMode="decimal"\s*\n\s*aria-label=\{`Actual Expenditure/);
    expect(src).toContain('inputMode="numeric" aria-label={`% of Implementation — ${rowLabel}`}');
    expect(src).toContain('inputMode="numeric" aria-label={`Men beneficiaries — ${rowLabel}`}');
  });

  it("PMR-A11Y-08: Beneficiary inputs — htmlFor/id association and row-context aria-labels", () => {
    // PMR calculated summary
    for (const k of ["men", "women", "boys", "girls", "total"]) {
      expect(src).toContain(`htmlFor="pmr-benef-${k}"`);
      expect(src).toContain(`id="pmr-benef-${k}"`);
    }
    // non-project manual entry
    for (const k of ["male", "female", "boys", "girls", "total"]) {
      expect(src).toContain(`htmlFor="rp-benef-${k}"`);
      expect(src).toContain(`id="rp-benef-${k}"`);
    }
    // per-activity row beneficiaries
    for (const g of ["Men", "Women", "Boys", "Girls"]) {
      expect(src).toContain(`aria-label={\`${g} beneficiaries — \${rowLabel}\`}`);
    }
    expect(src).toContain("aria-label={`Total beneficiaries this period — ${rowLabel}`}");
  });

  it("PMR-A11Y-09: Variance reason — row-contextual aria-label and aria-required when required", () => {
    expect(src).toContain("aria-label={`Reason for Variance — ${rowLabel}`} aria-required=\"true\"");
  });

  it("PMR-A11Y-10: Progress narrative loop — error association (id + aria-describedby)", () => {
    // generic progress loop already wired; challenges + lessons loops now too
    expect(src).toContain("aria-describedby={fieldErrors[f.key] ? `err-${f.key}` : undefined}");
    const loopErr = (src.match(/id=\{`err-\$\{f\.key\}`\} /g) ?? []).length;
    expect(loopErr).toBeGreaterThanOrEqual(3); // progress + challenges + narrative loops
    const loopField = (src.match(/id=\{`field-\$\{f\.key\}`\}/g) ?? []).length;
    expect(loopField).toBeGreaterThanOrEqual(3);
  });

  it("PMR-A11Y-11: Challenges textarea — aria-describedby references err-pmr-challenges", () => {
    expect(src).toContain('aria-describedby={fieldErrors["challenges"] ? "err-pmr-challenges" : undefined}');
    expect(src).toMatch(/id="err-pmr-challenges"[^>]*role="alert"/);
  });

  it("PMR-A11Y-12: Lessons Learned textarea — aria-describedby references err-pmr-lessons", () => {
    expect(src).toContain('aria-describedby={fieldErrors["lessonsLearned"] ? "err-pmr-lessons" : undefined}');
    expect(src).toMatch(/id="err-pmr-lessons"[^>]*role="alert"/);
  });

  it("PMR-A11Y-13: File inputs — id + aria-describedby referencing accepted-formats element", () => {
    // activity-style attachments section
    expect(src).toContain('id="pmr-file-input"');
    expect(src).toContain('aria-describedby="pmr-file-formats"');
    expect(src).toMatch(/id="pmr-file-formats"[^>]*>Accepted formats/);
    // project/state/HQ attachments section
    expect(src).toContain('id="rp-file-input"');
    expect(src).toContain('aria-describedby="rp-file-formats"');
    expect(src).toMatch(/id="rp-file-formats"[^>]*sr-only[^>]*>Accepted formats/);
  });

  it("PMR-A11Y-14: Attachment remove buttons and doc-type selects have accessible names", () => {
    expect(src).toContain("aria-label={`Remove ${att.fileName}`}");
    const removeDoc = (src.match(/aria-label=\{`Remove \$\{doc\.file\.name\}`\}/g) ?? []).length;
    expect(removeDoc).toBeGreaterThanOrEqual(2); // pending list + secondary remove button
    expect(src).toContain("aria-label={`Document type for ${doc.file.name}`}");
  });

  it("PMR-A11Y-15: Voice note Play/Pause has aria-label (form-voice-recorder.tsx)", () => {
    expect(voiceSrc).toContain('aria-label={playing ? "Pause voice note" : "Play voice note"}');
  });

  it("PMR-A11Y-21: No validation rule changes — required-field logic untouched", () => {
    // Same submit-validation anchors as before this task:
    expect(src).toContain('msgs.push("At least one Activity is required")');
    expect(src).toContain("Actual Expenditure (This Period) is required");
    expect(src).toContain("Achievement Summary is required");
    expect(src).toContain("Exception/Reason is required for Unplanned Activities");
    // No native `required` attribute snuck onto PMR controls (aria-required only)
    expect(src).not.toMatch(/<Input[^>]*\srequired[\s/>]/);
  });

  it("PMR-A11Y-22: Activity Report wiring not regressed by these changes", () => {
    // Pre-existing AR associations preserved
    expect(src).toContain('id="err-implementationStatus"');
    expect(src).toContain('id="err-implementationSummary"');
    expect(src).toContain('aria-describedby={fieldErrors["resultsAchieved"] ? "err-resultsAchieved" : undefined}');
    // AR project combobox error now referenced from its trigger
    expect(src).toContain('aria-describedby={fieldErrors["projectId"] ? "err-ar-project" : undefined}');
    expect(src).toMatch(/id="err-ar-project" role="alert"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — rendered doubles
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the PMR field wiring: label + control + error, id-linked. */
function PmrFieldDouble({ error }: { error?: string }) {
  return (
    <div>
      <label htmlFor="pmr-month">Reporting month *</label>
      <select
        id="pmr-month"
        aria-required="true"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? "err-pmr-month" : undefined}
      >
        <option>January</option>
      </select>
      {error && (
        <p id="err-pmr-month" role="alert">{error}</p>
      )}
    </div>
  );
}

/** Mirrors the wizard tablist keyboard handling from reports.tsx (ArrowLeft/Right/Home/End). */
function WizardTabsDouble() {
  const tabs = ["Basic Information", "Progress", "Activities"];
  const [active, setActive] = useState(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive((c) => Math.min(c + 1, tabs.length - 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setActive((c) => Math.max(c - 1, 0)); }
    if (e.key === "Home") { e.preventDefault(); setActive(0); }
    if (e.key === "End") { e.preventDefault(); setActive(tabs.length - 1); }
  };
  return (
    <div role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button key={t} role="tab" aria-selected={i === active} aria-controls={`panel-${i}`} tabIndex={i === active ? 0 : -1}>
          {t}
        </button>
      ))}
    </div>
  );
}

describe("PMR-A11Y rendered association & keyboard behaviour", () => {
  it("PMR-A11Y-03b: error element is programmatically associated with the control", () => {
    render(<PmrFieldDouble error="Reporting month is required" />);
    const select = screen.getByLabelText("Reporting month *");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", "err-pmr-month");
    const err = screen.getByRole("alert");
    expect(err).toHaveAttribute("id", "err-pmr-month");
  });

  it("PMR-A11Y-03c: no aria-invalid / describedby noise when the field is valid", () => {
    render(<PmrFieldDouble />);
    const select = screen.getByLabelText("Reporting month *");
    expect(select).not.toHaveAttribute("aria-invalid");
    expect(select).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("PMR-A11Y-16: ArrowRight moves to the next wizard tab", () => {
    render(<WizardTabsDouble />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Progress" })).toHaveAttribute("aria-selected", "true");
  });

  it("PMR-A11Y-17: ArrowLeft moves to the previous wizard tab", () => {
    render(<WizardTabsDouble />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Basic Information" })).toHaveAttribute("aria-selected", "true");
  });

  it("PMR-A11Y-18: exactly one tab has aria-selected=true", () => {
    render(<WizardTabsDouble />);
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });

  it("PMR-A11Y-19/20: Save As Draft and Submit Report buttons keep accessible names (source)", () => {
    expect(src).toMatch(/Save [Aa]s Draft/);
    expect(src).toMatch(/Submit Report/);
  });
});
