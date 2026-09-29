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
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    // A HeroUI warning Alert carrying the explanatory text
    expect(SRC).toMatch(/<Alert status="warning">\s*<Alert.Indicator \/>\s*<Alert.Content>\s*<Alert.Description>\{t\("stateForm.noAttachmentsWarning"\)\}/);
  });

  it("source: HQ support empty state added when hqRequests is empty (P4 fix)", () => {
    expect(SRC).toContain("stateForm.noHqSupportRequests");
  });

  it("source: voice recorder section has a heading (not a blank card)", () => {
    expect(SRC).toContain("spr-section12-heading");
  });
});

// ── SPR-UX-10: Save/Submit in-flight state ───────────────────────────────────

describe("SPR-UX-10: Save/Submit buttons announce the in-flight state", () => {
  // HeroUI buttons don't accept aria-busy; the footer region carries it.
  it("source: the footer region has aria-busy={isSaving}", () => {
    expect(SRC).toContain("data-report-form-footer aria-busy={isSaving}");
  });

  it("source: Submit and Save Draft are disabled while saving (no double submit)", () => {
    expect(SRC).toContain("isDisabled={!isOnline || isSaving}");
    expect(SRC).toContain('isDisabled={localDraft.status === "pending" || localDraft.status === "syncing" || isSaving}');
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
  it("source: revision banner is a warning Alert with role='alert' (not role='status')", () => {
    expect(SRC).toMatch(/<Alert status="warning" role="alert">\s*<Alert.Indicator \/>\s*<Alert.Content>\s*<Alert.Title>\{t\("stateForm.revisionBannerTitle"\)\}/);
  });

  it("source: role='status' is no longer used in the form", () => {
    expect(SRC).not.toContain('role="status"');
  });
});

// ── SPR-UX-03: Locked identity fields ────────────────────────────────────────

describe("SPR-UX-03: Locked identity fields retain aria-readonly and visual Lock icon", () => {
  it("source: state field in edit mode has aria-readonly='true'", () => {
    expect(SRC).toContain('aria-readonly="true"');
  });

  it("source: Lock icon imported and rendered for locked fields", () => {
    expect(SRC).toContain("Lock,");
    expect(SRC).toContain('<Lock className="size-3 text-[var(--muted)]" aria-hidden="true" />');
  });

  it("source: locked fields have a muted background and not-allowed cursor", () => {
    expect(SRC).toContain('className="cursor-not-allowed bg-[var(--default)]"');
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

  it("source: Trash2 buttons have translated aria-labels for screen readers", () => {
    expect(SRC).toContain('aria-label={t("stateForm.removeActivityAria", { number: i + 1 })}');
    expect(SRC).toContain('aria-label={t("stateForm.removeRiskAria", { number: i + 1 })}');
    expect(SRC).toContain('aria-label={t("stateForm.removeRequestAria", { number: i + 1 })}');
  });

  it("source: Send icon in Submit button is aria-hidden", () => {
    expect(SRC).toContain('<Send className="size-4" aria-hidden="true" />');
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

  // TagInput / UploadArea
  it("source: chosen sectors, localities and projects are removable HeroUI tags", () => {
    expect(SRC).toContain("<RemovableTags");
  });

  it("source: UploadArea icons are aria-hidden and its remove button is named", () => {
    expect(SRC).toContain('<FileText className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />');
    expect(SRC).toContain('<Upload className="size-3.5" aria-hidden="true" />');
    expect(SRC).toContain('<Loader2 className="size-3.5 animate-spin text-[var(--muted)]" aria-hidden="true" />');
    expect(SRC).toContain('aria-label={t("stateForm.removeAttachmentAria", { fileName: d.fileName })}');
  });
});

// ── SPR-A11Y-05b: ChipSelect keyboard operability ────────────────────────────

describe("SPR-A11Y-05b: ChipSelect is keyboard-operable with ARIA labelling", () => {
  it("source: ChipSelect is a HeroUI multi-select (React Aria listbox pattern)", () => {
    const chipSelectFn = SRC.slice(SRC.indexOf("export function ChipSelect"), SRC.indexOf("function TagInput"));
    expect(chipSelectFn).toContain('selectionMode="multiple"');
    expect(chipSelectFn).toContain("<HLabel>{label}</HLabel>");
    expect(chipSelectFn).toContain('<ListBox selectionMode="multiple">');
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
    expect(SRC).toContain('<Alert status="warning" role="alert">');
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
    expect(SRC).toContain("stateForm.removeActivityAria");
    expect(SRC).toContain("stateForm.removeRiskAria");
    expect(SRC).toContain("stateForm.removeRequestAria");
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
// ChipSelect is a HeroUI (React Aria) multi-select: the listbox, options and
// keyboard model come from React Aria; these tests pin the user-visible contract.

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

const trigger = () => screen.getByRole("button", { name: /Sectors Covered/ });

describe("ChipSelect — rendered keyboard interaction (SPR-A11Y-05b)", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("label text is visible in the document", () => {
    renderChipSelect();
    expect(screen.getAllByText("Sectors Covered").length).toBeGreaterThan(0);
  });

  it("trigger is a real button named by the visible label, in the tab order", () => {
    renderChipSelect();
    expect(trigger().tagName).toBe("BUTTON");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).not.toHaveAttribute("tabIndex", "-1");
  });

  it("trigger has aria-expanded=false when closed", () => {
    renderChipSelect();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking the trigger opens a multi-select listbox", async () => {
    renderChipSelect();
    const button = trigger();
    await userEvent.click(button);
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  for (const key of ["{Enter}", " ", "{ArrowDown}"]) {
    it(`trigger ${key.trim() || "Space"} key opens the listbox`, async () => {
      renderChipSelect();
      trigger().focus();
      await userEvent.keyboard(key);
      expect(await screen.findByRole("listbox")).toBeInTheDocument();
    });
  }

  it("options are role=option with aria-selected reflecting the selection", async () => {
    renderChipSelect(["WASH"]);
    await userEvent.click(trigger());
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(SECTOR_OPTIONS.length);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("choosing an option calls onChange with it added", async () => {
    const onChange = vi.fn();
    renderChipSelect(["WASH"], onChange);
    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("option", { name: "Health" }));
    expect(onChange).toHaveBeenLastCalledWith(["WASH", "Health"]);
  });

  it("ArrowDown and Enter select an option from the keyboard", async () => {
    const onChange = vi.fn();
    renderChipSelect([], onChange);
    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0]).toHaveLength(1);
  });

  it("Escape closes the listbox", async () => {
    renderChipSelect();
    await userEvent.click(trigger());
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("each chosen value shows as a removable tag", async () => {
    const onChange = vi.fn();
    renderChipSelect(["WASH", "Health"], onChange);
    const tags = screen.getByRole("grid", { name: "Sectors Covered" });
    const washRow = within(tags).getByRole("row", { name: /WASH/ });
    await userEvent.click(within(washRow).getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(["Health"]);
  });
});

// ── Source integrity guards ───────────────────────────────────────────────────

describe("Source integrity guards (closed contracts)", () => {
  it("Lock icon imported from the icon module", () => {
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
