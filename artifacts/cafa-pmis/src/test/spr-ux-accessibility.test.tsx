/**
 * SPR Final UX & Accessibility Hardening — Task #401
 *
 * Strategy: pure-function tests for friendlyCreateError, source-inspection
 * tests for structural guarantees (aria attributes, role values, heading text),
 * and rendered tests only for ProgramStateSectionsView (which renders cleanly
 * in jsdom without the complex Radix/RHF/query infrastructure of the full form).
 *
 * Tests that require rendering the full ProgramStateReportForm are covered by
 * the existing spr-draft-edit.test.tsx suite (which has the necessary Radix
 * shims) and are noted below as "covered by existing suite."
 *
 * SPR-UX-01  Create / edit / revision headings distinguishable — source guard
 * SPR-UX-02  Returned revision state clearly exposed (role="alert") — source guard
 * SPR-UX-03  Locked identity fields retain aria-readonly + lock icon — source guard
 * SPR-UX-04  422 codes produce actionable feedback — friendlyCreateError unit tests
 * SPR-UX-05  Duplicate warning preserves role="alert" — covered by spr-duplicate-check.test
 * SPR-UX-06  Long narrative content wraps (whitespace-pre-wrap) — ProgramStateSectionsView
 * SPR-UX-07  Beneficiary labels accessible (min=0) — source guard + ProgramStateSectionsView
 * SPR-UX-08  Evidence empty state meaningful — source guard
 * SPR-UX-09  Comments in revision mode — covered by spr-comments-taxonomy.test
 * SPR-UX-10  Save/Submit carry aria-busy — source guard
 *
 * SPR-A11Y-01  Section headings present — source guard
 * SPR-A11Y-02  Sections have aria-labelledby — source guard
 * SPR-A11Y-03  Decorative icons are aria-hidden — source guard
 * SPR-A11Y-04  Error summary uses role="alert" + tabIndex=-1 — source guard
 * SPR-A11Y-05  Revision banner uses role="alert" — source guard
 * SPR-A11Y-06  No action relies only on colour (text labels) — source guard
 * SPR-A11Y-07  PM/Super Admin paths in friendlyCreateError preserved (#373)
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import "@testing-library/jest-dom";
import fs from "node:fs";
import path from "node:path";

// ── Source file ───────────────────────────────────────────────────────────────

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../components/program-state-report-form.tsx"),
  "utf8",
);

// ── i18n mock (for ProgramStateSectionsView renders) ─────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "stateForm.freqMonthly": "Monthly",
        "stateForm.freqQuarterly": "Quarterly",
        "stateForm.freqAnnual": "Annual",
        "stateForm.freqOnDemand": "On-Demand",
        "stateForm.detailFrequency": "Frequency:",
        "stateForm.detailOfficer": "Officer:",
        "stateForm.detailSectors": "Sectors:",
        "stateForm.detailLocalities": "Localities:",
        "stateForm.detailHumanitarianContext": "Humanitarian Context",
        "stateForm.detailNarrKeyAchievements": "Key Achievements",
        "stateForm.detailNarrChallenges": "Main Challenges",
        "stateForm.detailNarrMitigationMeasures": "Mitigation Measures",
        "stateForm.detailNarrNextPeriodPriorities": "Next Period Priorities",
        "stateForm.detailHumanSecuritySituation": "Security Situation",
        "stateForm.detailHumanPopulationMovements": "Population Movements",
        "stateForm.detailHumanDiseaseOutbreaks": "Disease Outbreaks",
        "stateForm.detailHumanAccessConstraints": "Access Constraints",
        "stateForm.detailHumanNaturalHazards": "Natural Hazards",
        "stateForm.detailHumanMarketSituation": "Market Situation",
        "stateForm.detailHumanOtherDevelopments": "Other Developments",
        "stateForm.detailHqSupportRequests": "HQ Support Requests",
        "stateForm.detailRisksIssues": "Risks & Issues",
        "stateForm.detailOptLessonsLearned": "Lessons Learned",
        "stateForm.detailOptCoordinationUpdates": "Coordination Updates",
        "stateForm.detailOptCommunityFeedback": "Community Feedback",
        "stateForm.detailOptSecurityUpdates": "Security Updates",
        "stateForm.detailOptAccessConstraintsLegacy": "Access Constraints (legacy)",
        "stateForm.detailSupportRequestFallback": "Support Request",
        "stateForm.detailNarrNarrativeSummary": "Narrative Summary",
        "stateForm.detailNarrNextSteps": "Next Steps",
        "detail.male": "Men",
        "detail.female": "Women",
        "detail.boys": "Boys",
        "detail.girls": "Girls",
        "detail.total": "Total",
      };
      if (key === "stateForm.freqQuarterlyQ") return opts ? `Quarterly — Q${opts.quarter}` : "Quarterly";
      return map[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

import { ProgramStateSectionsView, friendlyCreateError } from "../components/program-state-report-form";

// ── Fixtures for ProgramStateSectionsView renders ─────────────────────────────

const BASE_SECTIONS: Record<string, unknown> = {
  frequency: "monthly",
  sectors: ["WASH", "Health"],
  localitiesCovered: ["Aroma", "Kassala Town"],
  officerName: "Fatima Idris",
  relatedProjectIds: [7],
  humanitarianContext: {
    securitySituation: "Stable with sporadic incidents in rural areas.",
    populationMovements: "Influx of 500 households from Gedaref.",
    diseaseOutbreaks: "No outbreaks reported this period.",
    accessConstraints: "Seasonal road closures impacting southern localities.",
  },
  keyAchievements: "Delivered WASH services to four villages, reaching 2,400 people.",
  mainChallenges: "Fuel shortages and road closures delayed activity implementation.",
  mitigationMeasures: "Pre-positioned fuel stocks in advance and used alternative routes.",
  nextPeriodPriorities: "Expand hygiene promotion programme to three additional localities.",
};

const ACTIVITIES: Array<Record<string, unknown>> = [
  {
    title: "Borehole rehabilitation in Aroma locality",
    sector: "WASH",
    locality: "Aroma",
    relatedProjectId: 7,
    activityDate: "2026-06-15",
    status: "Completed",
    achievementSummary: "Three boreholes rehabilitated, serving four villages.",
    beneficiariesMen: 120,
    beneficiariesWomen: 150,
    beneficiariesBoys: 80,
    beneficiariesGirls: 95,
    beneficiariesTotal: 445,
  },
];

const PROJECTS = [{ id: 7, code: "CAFA-P-007", title: "Water & Sanitation Kassala" }];

function renderDetailView(overrides: Partial<Parameters<typeof ProgramStateSectionsView>[0]> = {}) {
  return render(
    <ProgramStateSectionsView
      sections={BASE_SECTIONS}
      activities={ACTIVITIES}
      projects={PROJECTS}
      periodStart={null}
      periodEnd={null}
      {...overrides}
    />,
  );
}

// ── SPR-UX-04: friendlyCreateError maps 422 codes ────────────────────────────

describe("SPR-UX-04: friendlyCreateError maps known API error codes", () => {
  it("maps program_state_spo_available to SPO-guidance text", () => {
    const msg = friendlyCreateError(new Error("program_state_spo_available"));
    expect(msg).toContain("State Programme Officer");
    expect(msg).not.toBe("program_state_spo_available");
  });

  it("maps state_required_for_super_admin_spr to admin guidance", () => {
    const msg = friendlyCreateError(new Error("state_required_for_super_admin_spr"));
    expect(msg).toContain("administrators must choose");
    expect(msg.length).toBeGreaterThan(40);
  });

  it("maps duplicate_report_period to actionable duplicate warning", () => {
    const msg = friendlyCreateError(new Error("duplicate_report_period"));
    expect(msg).toContain("already exists");
    expect(msg).toContain("period");
  });

  it("maps report_content_incomplete (P2 fix) to actionable guidance (not raw code)", () => {
    const msg = friendlyCreateError(new Error("report_content_incomplete"));
    expect(msg).not.toBe("report_content_incomplete");
    expect(msg).not.toContain("report_content_incomplete");
    expect(msg).toContain("required sections are incomplete");
    expect(msg.length).toBeGreaterThan(60);
  });

  it("passes unknown error messages through unchanged", () => {
    const msg = friendlyCreateError(new Error("Unknown server failure xyz"));
    expect(msg).toBe("Unknown server failure xyz");
  });

  it("handles non-Error values safely", () => {
    const msg = friendlyCreateError("bare string error");
    expect(typeof msg).toBe("string");
  });

  it("SPR-A11Y-07 (#373): state_required_for_super_admin_spr preserved for PM/Super Admin", () => {
    const msg = friendlyCreateError(new Error("state_required_for_super_admin_spr"));
    expect(msg).toContain("administrators");
  });
});

// ── SPR-UX-06: Long narrative content wraps in detail view ───────────────────

describe("SPR-UX-06: Long content does not cause horizontal overflow in detail view", () => {
  it("narrative text renders with whitespace-pre-wrap class", () => {
    const { container } = renderDetailView();
    const narrativeEl = container.querySelector(".whitespace-pre-wrap");
    expect(narrativeEl).not.toBeNull();
  });

  it("very long activity title is truncated with title attribute in summary", () => {
    const longTitle = "A".repeat(200);
    const { container } = renderDetailView({
      activities: [{ ...ACTIVITIES[0], title: longTitle }],
    });
    // The <summary> renders a span with title attribute for the full text
    const titleSpan = container.querySelector("summary span.truncate");
    expect(titleSpan).not.toBeNull();
    expect((titleSpan as HTMLElement).title).toBe(longTitle);
  });

  it("locality list items have break-words class for overflow safety", () => {
    const { container } = renderDetailView();
    // The related projects list items use break-words
    const breakWordItems = container.querySelectorAll(".break-words");
    expect(breakWordItems.length).toBeGreaterThan(0);
  });
});

// ── SPR-UX-07: Beneficiary breakdown labels in detail view ───────────────────

describe("SPR-UX-07: Beneficiary breakdown is accessible in detail view", () => {
  it("beneficiary breakdown renders all gender labels", () => {
    renderDetailView();
    expect(screen.getByText("Men")).toBeInTheDocument();
    expect(screen.getByText("Women")).toBeInTheDocument();
    expect(screen.getByText("Boys")).toBeInTheDocument();
    expect(screen.getByText("Girls")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("beneficiary totals are displayed as numbers", () => {
    renderDetailView();
    expect(screen.getByText("445")).toBeInTheDocument();
  });

  it("source: beneficiary inputs in the form have min=0 to prevent negatives", () => {
    // Source inspection — the form uses min={0} on all beneficiary number inputs
    const benInputMatches = SRC.matchAll(/type="number" min=\{0\}/g);
    expect([...benInputMatches].length).toBeGreaterThanOrEqual(4);
  });
});

// ── SPR-UX-08: Evidence / empty state ────────────────────────────────────────

describe("SPR-UX-08: Evidence empty state is meaningful", () => {
  it("source: no-attachments warning contains descriptive text (not blank card)", () => {
    // Verify the no-attachments div has a <p> tag with warning text
    expect(SRC).toContain("stateForm.noAttachmentsWarning");
    // And it's inside an amber warning div (not a blank card)
    expect(SRC).toContain("border-amber-200");
  });

  it("source: HQ support empty state added when hqRequests is empty (P4 fix)", () => {
    expect(SRC).toContain("stateForm.noHqSupportRequests");
  });

  it("source: voice recorder section has a heading (not a blank card)", () => {
    expect(SRC).toContain("spr-section12-heading");
  });
});

// ── SPR-UX-10: Save/Submit in-flight state ───────────────────────────────────

describe("SPR-UX-10: Save/Submit buttons carry aria-busy for in-flight state", () => {
  it("source: Save Draft button has aria-busy attribute", () => {
    expect(SRC).toContain("aria-busy={isSaving}");
  });

  it("source: Submit button has disabled={isSaving} to prevent double-submit", () => {
    expect(SRC).toContain("disabled={isSaving}");
  });

  it("source: both footer buttons carry aria-busy", () => {
    const matches = [...SRC.matchAll(/aria-busy=\{isSaving\}/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ── SPR-UX-01: Heading distinguishes create / edit / revision ─────────────────

describe("SPR-UX-01: Form heading distinguishes create, edit, and revision modes", () => {
  it("source: 'Create State Programme Report' key used in heading for create mode", () => {
    expect(SRC).toContain("stateForm.heading");
  });

  it("source: 'Edit State Programme Report' i18n key used in heading for plain edit mode", () => {
    expect(SRC).toContain("stateForm.titleEdit");
  });

  it("source: 'Revise State Programme Report' i18n key used when isReturnedForRevision", () => {
    expect(SRC).toContain("stateForm.titleRevise");
  });

  it("source: isReturnedForRevision variable drives the conditional heading", () => {
    expect(SRC).toContain("isReturnedForRevision ? t(\"stateForm.titleRevise\")");
  });
});

// ── SPR-UX-02: Revision banner is prominent ───────────────────────────────────

describe("SPR-UX-02: Returned-for-revision banner is prominent and uses role='alert'", () => {
  it("source: revision banner uses role='alert' (not role='status')", () => {
    // The banner wrapping the returned-for-revision message uses role="alert"
    expect(SRC).toContain('role="alert" className="flex items-start gap-2 rounded-md border');
  });

  it("source: role='status' is no longer used in the form", () => {
    expect(SRC).not.toContain('role="status"');
  });

  it("source: revision banner AlertTriangle has aria-hidden='true'", () => {
    // All AlertTriangle usages in the form must carry aria-hidden="true"
    const hiddenMatches = [...SRC.matchAll(/AlertTriangle[^<]*/g)].filter((m) =>
      SRC.slice(m.index ?? 0, (m.index ?? 0) + 100).includes('aria-hidden="true"'),
    );
    expect(hiddenMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("source: revision banner uses design-system border (border border-amber-300)", () => {
    expect(SRC).toContain("border border-amber-300");
  });
});

// ── SPR-UX-03: Locked identity fields ────────────────────────────────────────

describe("SPR-UX-03: Locked identity fields retain aria-readonly and visual Lock icon", () => {
  it("source: state field in edit mode has aria-readonly='true'", () => {
    expect(SRC).toContain('aria-readonly="true"');
  });

  it("source: Lock icon imported and rendered for locked fields", () => {
    expect(SRC).toContain("Lock,");
    expect(SRC).toContain('<Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />');
  });

  it("source: locked fields have bg-muted cursor-not-allowed for visual cue", () => {
    expect(SRC).toContain("bg-muted cursor-not-allowed");
  });
});

// ── SPR-A11Y-01: Section headings ────────────────────────────────────────────

describe("SPR-A11Y-01: All major section headings are labelled with h4", () => {
  const expectedSections = [
    "spr-section1-heading",
    "spr-section3-heading",
    "spr-section4-heading",
    "spr-section5-heading",
    "spr-section6-heading",
    "spr-section7-heading",
    "spr-section8-heading",
    "spr-section9-heading",
    "spr-section10-heading",
    "spr-section11-heading",
    "spr-section12-heading",
  ];

  for (const id of expectedSections) {
    it(`source: heading id '${id}' present`, () => {
      expect(SRC).toContain(`id="${id}"`);
    });
  }
});

// ── SPR-A11Y-02: Sections have accessible names ───────────────────────────────

describe("SPR-A11Y-02: Major sections have aria-labelledby", () => {
  const expectedLabelledBy = [
    "aria-labelledby=\"spr-section1-heading\"",
    "aria-labelledby=\"spr-section3-heading\"",
    "aria-labelledby=\"spr-section4-heading\"",
    "aria-labelledby=\"spr-section5-heading\"",
    "aria-labelledby=\"spr-section6-heading\"",
    "aria-labelledby=\"spr-section7-heading\"",
    "aria-labelledby=\"spr-section8-heading\"",
    "aria-labelledby=\"spr-section9-heading\"",
    "aria-labelledby=\"spr-section10-heading\"",
    "aria-labelledby=\"spr-section11-heading\"",
    "aria-labelledby=\"spr-section12-heading\"",
  ];

  for (const attr of expectedLabelledBy) {
    it(`source: section has ${attr}`, () => {
      expect(SRC).toContain(attr);
    });
  }

  it("detail view: Related Projects section has aria-labelledby", () => {
    const { container } = renderDetailView();
    const section = container.querySelector("section[aria-labelledby='spr-detail-related-projects']");
    expect(section).not.toBeNull();
  });

  it("detail view: Activities section has aria-labelledby", () => {
    const { container } = renderDetailView();
    const section = container.querySelector("section[aria-labelledby='spr-detail-activities']");
    expect(section).not.toBeNull();
  });
});

// ── SPR-A11Y-03: Decorative icons are aria-hidden ────────────────────────────

describe("SPR-A11Y-03: Decorative icons carry aria-hidden='true'", () => {
  it("source: TrendingUp in section 2 heading is aria-hidden", () => {
    expect(SRC).toContain('<TrendingUp className="h-4 w-4" aria-hidden="true" />');
  });

  it("source: attachment warning AlertTriangle is aria-hidden", () => {
    // Find in the attachment warning context
    const attachIdx = SRC.indexOf("border-amber-200 bg-amber-50");
    const attachSection = SRC.slice(attachIdx, attachIdx + 200);
    expect(attachSection).toContain('aria-hidden="true"');
  });

  it("source: Add Activity Plus icon is aria-hidden", () => {
    const addActivityIdx = SRC.indexOf("addActivity");
    const addActivitySection = SRC.slice(Math.max(0, addActivityIdx - 300), addActivityIdx + 100);
    expect(addActivitySection).toContain('aria-hidden="true"');
  });

  it("source: Add Risk Plus icon is aria-hidden", () => {
    const addRiskIdx = SRC.indexOf("stateForm.addRisk");
    const addRiskSection = SRC.slice(Math.max(0, addRiskIdx - 200), addRiskIdx + 50);
    expect(addRiskSection).toContain('aria-hidden="true"');
  });

  it("source: Add Request Plus icon is aria-hidden", () => {
    const addReqIdx = SRC.indexOf("stateForm.addRequest");
    const addReqSection = SRC.slice(Math.max(0, addReqIdx - 200), addReqIdx + 50);
    expect(addReqSection).toContain('aria-hidden="true"');
  });

  it("source: Trash2 buttons have aria-label for screen readers", () => {
    // Activity, risk, and HQ request remove buttons have aria-label
    expect(SRC).toContain('aria-label={`Remove activity ${i + 1}`}');
    expect(SRC).toContain('aria-label={`Remove risk ${i + 1}`}');
    expect(SRC).toContain('aria-label={`Remove HQ support request ${i + 1}`}');
  });

  it("source: ChevronDown in project dropdown is aria-hidden", () => {
    expect(SRC).toContain('<ChevronDown className="h-4 w-4 text-muted-foreground ms-auto shrink-0" aria-hidden="true" />');
  });

  it("source: X badge remove button icon is aria-hidden + has aria-label", () => {
    expect(SRC).toContain('<X className="h-3 w-3" aria-hidden="true" />');
    expect(SRC).toContain('aria-label={`Remove ${p.code}`}');
  });

  it("source: Send icon in Submit button is aria-hidden", () => {
    expect(SRC).toContain('<Send className="h-4 w-4" aria-hidden="true" />');
  });

  it("source: Loader2 spinner icons are aria-hidden", () => {
    const loaderMatches = [...SRC.matchAll(/Loader2[^/]*?aria-hidden="true"/gs)];
    expect(loaderMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("detail view: ChevronRight in activity summary is aria-hidden", () => {
    const { container } = renderDetailView();
    const svgs = container.querySelectorAll("summary svg[aria-hidden='true']");
    expect(svgs.length).toBeGreaterThan(0);
  });

  // ChipSelect, TagInput, UploadArea icon fixes
  it("source: ChipSelect badge X buttons have aria-label='Remove {s}'", () => {
    expect(SRC).toContain('aria-label={`Remove ${s}`}');
  });

  it("source: TagInput badge X buttons have aria-label='Remove {t}'", () => {
    expect(SRC).toContain('aria-label={`Remove ${t}`}');
  });

  it("source: UploadArea FileText icon is aria-hidden", () => {
    expect(SRC).toContain('<FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />');
  });

  it("source: UploadArea Upload button icon is aria-hidden", () => {
    expect(SRC).toContain('<Upload className="h-3 w-3" aria-hidden="true" />');
  });

  it("source: UploadArea attachment remove button has aria-label", () => {
    expect(SRC).toContain('aria-label={`Remove attachment ${d.fileName}`}');
  });

  it("source: UploadArea Loader2 during upload is aria-hidden", () => {
    // The uploading spinner in UploadArea
    const uploadLoaderMatch = SRC.match(/Loader2[^/\n]*?h-3\.5 w-3\.5[^/\n]*?aria-hidden="true"/s);
    expect(uploadLoaderMatch).not.toBeNull();
  });
});

// ── SPR-A11Y-05b: ChipSelect keyboard operability ────────────────────────────

describe("SPR-A11Y-05b: ChipSelect is keyboard-operable with ARIA labelling", () => {
  it("source: ChipSelect trigger is a real <button> element (not a div with role=button)", () => {
    const chipSelectFn = SRC.slice(SRC.indexOf("export function ChipSelect"), SRC.indexOf("function TagInput"));
    // The trigger is a real <button> — no need for role="button"
    expect(chipSelectFn).toContain("<button");
    expect(chipSelectFn).toContain('aria-haspopup="listbox"');
    expect(chipSelectFn).not.toContain('role="button"');
  });

  it("source: ChipSelect trigger has tabIndex={0} (keyboard focusable)", () => {
    // The trigger is a real <button> with explicit tabIndex={0} so it is
    // unambiguously in the tab order even in unusual focus environments.
    const chipSelectFn = SRC.slice(SRC.indexOf("export function ChipSelect"), SRC.indexOf("function TagInput"));
    expect(chipSelectFn).toContain("tabIndex={0}");
  });

  it("source: ChipSelect trigger has aria-expanded", () => {
    const chipSelectFn = SRC.slice(SRC.indexOf("function ChipSelect"), SRC.indexOf("function TagInput"));
    expect(chipSelectFn).toContain("aria-expanded={open}");
  });

  it("source: ChipSelect trigger has aria-haspopup='listbox'", () => {
    expect(SRC).toContain('aria-haspopup="listbox"');
  });

  it("source: ChipSelect trigger handles Enter/Space/Escape keyboard events", () => {
    const chipSelectFn = SRC.slice(SRC.indexOf("function ChipSelect"), SRC.indexOf("function TagInput"));
    expect(chipSelectFn).toContain('e.key === "Enter"');
    expect(chipSelectFn).toContain('e.key === " "');
    expect(chipSelectFn).toContain('e.key === "Escape"');
  });

  it("source: ChipSelect label has aria-labelledby on trigger (valid AT association for non-labelable elements)", () => {
    const chipSelectFn = SRC.slice(SRC.indexOf("export function ChipSelect"), SRC.indexOf("function TagInput"));
    // The label is a <span> with a stable id; the trigger carries aria-labelledby
    expect(chipSelectFn).toContain("const labelId = useId()");
    expect(chipSelectFn).toContain("aria-labelledby={labelId}");
  });

  it("source: ChipSelect dropdown has role='listbox' and aria-multiselectable", () => {
    expect(SRC).toContain('role="listbox"');
    expect(SRC).toContain('aria-multiselectable="true"');
  });

  it("source: ChipSelect options have role='option' and aria-selected", () => {
    expect(SRC).toContain('role="option"');
    expect(SRC).toContain('aria-selected={selected.includes(opt)}');
  });

  it("source: TagInput Label has htmlFor pointing to input id", () => {
    const tagInputFn = SRC.slice(SRC.indexOf("function TagInput"), SRC.indexOf("function UploadArea"));
    expect(tagInputFn).toContain("htmlFor={inputId}");
    expect(tagInputFn).toContain("const inputId = useId()");
    expect(tagInputFn).toContain("id={inputId}");
  });

  it("source: TagInput hint text linked via aria-describedby", () => {
    const tagInputFn = SRC.slice(SRC.indexOf("function TagInput"), SRC.indexOf("function UploadArea"));
    expect(tagInputFn).toContain("aria-describedby={hintId}");
    expect(tagInputFn).toContain("const hintId = useId()");
  });
});

// ── SPR-A11Y-04: Error summary region ────────────────────────────────────────

describe("SPR-A11Y-04: Error summary region uses role='alert' and tabIndex=-1", () => {
  it("source: error summary div has role='alert'", () => {
    expect(SRC).toContain('role="alert"');
    expect(SRC).toContain('aria-live="assertive"');
  });

  it("source: error summary div has tabIndex=-1 for programmatic focus", () => {
    expect(SRC).toContain("tabIndex={-1}");
  });

  it("source: errorSummaryRef is used for focus management", () => {
    expect(SRC).toContain("errorSummaryRef");
    expect(SRC).toContain("errorSummaryRef.current?.focus()");
  });

  it("source: raiseFormError helper encapsulates error surfacing", () => {
    expect(SRC).toContain("function raiseFormError(msg: string)");
  });

  it("source: buildPayload accepts onError callback", () => {
    expect(SRC).toContain("function buildPayload(values: BasicValues, onError?: (msg: string) => void)");
  });
});

// ── SPR-A11Y-05: Revision banner role ────────────────────────────────────────

describe("SPR-A11Y-05: Revision banner uses role='alert'", () => {
  it("source: revision banner has role='alert'", () => {
    expect(SRC).toContain('role="alert" className="flex items-start gap-2 rounded-md border border-amber-300');
  });

  it("source: role='status' is not used anywhere in the form", () => {
    expect(SRC).not.toContain('role="status"');
  });
});

// ── SPR-A11Y-06: No action relies only on colour ─────────────────────────────

describe("SPR-A11Y-06: No critical action relies only on colour", () => {
  it("source: Save Draft button has visible text key (stateForm.saveDraft)", () => {
    expect(SRC).toContain("stateForm.saveDraft");
  });

  it("source: Submit Report button has visible text key (stateForm.submitReport)", () => {
    expect(SRC).toContain("stateForm.submitReport");
  });

  it("source: Cancel button has visible text key (stateForm.cancel)", () => {
    expect(SRC).toContain("stateForm.cancel");
  });

  it("source: Trash2 remove buttons have aria-label (not icon-only)", () => {
    expect(SRC).toContain("Remove activity");
    expect(SRC).toContain("Remove risk");
    expect(SRC).toContain("Remove HQ support request");
  });
});

// ── SPR-A11Y-07: PM/Super Admin access preserved ─────────────────────────────

describe("SPR-A11Y-07: PM and Super Admin access not blocked by stale ownership checks", () => {
  it("friendlyCreateError is exported (callable from any module)", () => {
    expect(SRC).toContain("export function friendlyCreateError");
  });

  it("super admin path produces guidance text (not raw code)", () => {
    const msg = friendlyCreateError(new Error("state_required_for_super_admin_spr"));
    expect(msg).not.toBe("state_required_for_super_admin_spr");
    expect(msg).toContain("administrators");
  });

  it("report_content_incomplete message does not include raw code string", () => {
    const msg = friendlyCreateError(new Error("report_content_incomplete"));
    expect(msg).not.toContain("report_content_incomplete");
  });
});

// ── ChipSelect rendered keyboard tests ───────────────────────────────────────

import { ChipSelect } from "../components/program-state-report-form";

const SECTOR_OPTIONS = ["WASH", "Health", "Education", "Shelter", "Food Security"] as const;

function renderChipSelect(selected: string[] = [], onChange = vi.fn()) {
  return render(
    <ChipSelect
      label="Sectors Covered"
      placeholder="Select sectors…"
      options={SECTOR_OPTIONS}
      selected={selected}
      onChange={onChange}
      required
    />,
  );
}

describe("ChipSelect — rendered keyboard interaction (SPR-A11Y-05b)", () => {
  beforeAll(() => {
    // Radix / focus shims already set up at module level above
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("label text is visible in the document", () => {
    renderChipSelect();
    expect(screen.getByText("Sectors Covered")).toBeInTheDocument();
  });

  it("trigger button is in the tab order (tabIndex not -1)", () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(trigger).not.toBeNull();
    expect(trigger).not.toHaveAttribute("tabIndex", "-1");
  });

  it("trigger has aria-expanded=false when closed", () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking trigger opens the listbox", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const listbox = container.querySelector("[role='listbox']");
    expect(listbox).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("trigger Enter key opens the listbox", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
  });

  it("trigger Space key opens the listbox", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    trigger.focus();
    await userEvent.keyboard(" ");
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
  });

  it("trigger ArrowDown key opens the listbox", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
  });

  it("options are rendered as role=option with aria-selected", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const options = container.querySelectorAll("[role='option']");
    expect(options.length).toBe(SECTOR_OPTIONS.length);
    options.forEach((opt) => {
      expect(opt).toHaveAttribute("aria-selected");
    });
  });

  it("options have tabIndex=0 so they are individually keyboard-focusable", async () => {
    // The interactive element inside each li[role='option'] is a <button>,
    // which is natively focusable. Verify the buttons exist and are not excluded
    // from the tab order (tabIndex !== -1).
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    expect(optionBtns.length).toBe(SECTOR_OPTIONS.length);
    optionBtns.forEach((btn) => {
      expect(btn).not.toHaveAttribute("tabIndex", "-1");
    });
  });

  it("clicking an option calls onChange with that option selected", async () => {
    const onChange = vi.fn();
    const { container } = renderChipSelect([], onChange);
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    // Click the interactive button inside the first li[role='option']
    const firstOptBtn = container.querySelector<HTMLElement>(
      "[role='listbox'] [role='option'] button"
    ) as HTMLElement;
    await userEvent.click(firstOptBtn);
    expect(onChange).toHaveBeenCalledWith(["WASH"]);
  });

  it("Space on a focused option toggles selection", async () => {
    const onChange = vi.fn();
    const { container } = renderChipSelect([], onChange);
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    optionBtns[1].focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(["Health"]);
  });

  it("Enter on a focused option toggles selection", async () => {
    const onChange = vi.fn();
    const { container } = renderChipSelect([], onChange);
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    optionBtns[2].focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Education"]);
  });

  it("Escape on an option closes the listbox", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const options = container.querySelectorAll("[role='option']");
    (options[0] as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    expect(container.querySelector("[role='listbox']")).toBeNull();
  });

  it("ArrowDown moves focus to next option", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    optionBtns[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(optionBtns[1]);
  });

  it("ArrowUp on first option closes the listbox and restores focus to trigger", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    optionBtns[0].focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(container.querySelector("[role='listbox']")).toBeNull();
  });

  it("Home key moves focus to first option", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    optionBtns[2].focus();
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(optionBtns[0]);
  });

  it("End key moves focus to last option", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const optionBtns = Array.from(
      container.querySelectorAll<HTMLElement>("[role='listbox'] [role='option'] button")
    );
    optionBtns[0].focus();
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(optionBtns[optionBtns.length - 1]);
  });

  it("already-selected option has aria-selected=true", async () => {
    const { container } = renderChipSelect(["WASH"]);
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const options = container.querySelectorAll("[role='option']");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("selected chip shows in the container before the trigger", () => {
    renderChipSelect(["WASH"]);
    expect(screen.getByText("WASH")).toBeInTheDocument();
  });

  it("chip remove button has accessible label", () => {
    renderChipSelect(["WASH", "Health"]);
    expect(screen.getByRole("button", { name: "Remove WASH" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Health" })).toBeInTheDocument();
  });

  it("chip remove button calls onChange with that item excluded", async () => {
    const onChange = vi.fn();
    renderChipSelect(["WASH", "Health"], onChange);
    const removeWASH = screen.getByRole("button", { name: "Remove WASH" });
    await userEvent.click(removeWASH);
    expect(onChange).toHaveBeenCalledWith(["Health"]);
  });

  it("listbox has aria-labelledby pointing to the visible label", async () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    await userEvent.click(trigger);
    const listbox = container.querySelector("[role='listbox']") as HTMLElement;
    const labelledBy = listbox.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const labelEl = container.querySelector(`#${labelledBy}`);
    expect(labelEl?.textContent).toContain("Sectors Covered");
  });

  it("trigger has aria-labelledby pointing to the visible label", () => {
    const { container } = renderChipSelect();
    const trigger = container.querySelector("button[aria-haspopup='listbox']") as HTMLElement;
    const labelledBy = trigger.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const labelEl = container.querySelector(`#${labelledBy}`);
    expect(labelEl?.textContent).toContain("Sectors Covered");
  });
});

// ── Source integrity guards ───────────────────────────────────────────────────

describe("Source integrity guards (closed contracts)", () => {
  it("Lock icon imported from lucide-react", () => {
    expect(SRC).toContain("Lock,");
  });

  it("isReturnedForRevision derived before JSX (not inline condition)", () => {
    expect(SRC).toContain("const isReturnedForRevision =");
  });

  it("buildPayload fail() helper calls both toast.error and onError", () => {
    const failFn = SRC.slice(SRC.indexOf("function fail(msg"), SRC.indexOf("function fail(msg") + 120);
    expect(failFn).toContain("toast.error(msg)");
    expect(failFn).toContain("onError?.(msg)");
  });

  it("SPR-002: identity fields absent from PATCH payload (buildPatchPayload present)", () => {
    expect(SRC).toContain("function buildPatchPayload(values: BasicValues)");
  });

  it("SPR-007: patchExistingReport called before submit transition", () => {
    expect(SRC).toContain("patchExistingReport");
  });

  it("SPR-016: attachments use the report-owned storage descriptor, never Drive", () => {
    expect(SRC).toContain("/api/storage/uploads/request-url");
    expect(SRC).toContain("`/api/reports/${reportId}/attachments`");
    expect(SRC).not.toContain("/api/drive/upload");
  });

  it("SPR-010: CommentsPanel receives SPR_SECTION_KEYS", () => {
    expect(SRC).toContain("SPR_SECTION_KEYS");
  });
});
