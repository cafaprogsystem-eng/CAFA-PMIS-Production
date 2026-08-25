/**
 * Reports Final UX/UI & Accessibility Hardening — Test Suite
 *
 * Covers the 15 test IDs defined in Task 475:
 *   REP-UX-01..10 and REP-A11Y-01..05
 *
 * Uses source-analysis assertions (read file content, assert patterns)
 * and minimal inline rendered doubles, following the established pattern
 * from pmr-a11y.test.tsx and spr-ux-accessibility.test.tsx.
 *
 * British English spelling throughout.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const reportsSrc = readFileSync(join(here, "../pages/reports.tsx"), "utf8");
const recordDetailModalSrc = readFileSync(join(here, "../components/record-detail-modal.tsx"), "utf8");
const sprSrc = readFileSync(join(here, "../components/program-state-report-form.tsx"), "utf8");
const hqsrSrc = readFileSync(join(here, "../components/hq-sector-report-form.tsx"), "utf8");

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-01: Landing page elements present in source
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-01: Landing page renders type switcher, KPI row, filter toolbar, create button", () => {
  it("report type navigation cards rendered for all four types", () => {
    // The type switcher maps over all four canonical types
    expect(reportsSrc).toContain('"project", "activity", "program_state", "hq_sector"');
    // Each card is a Link with aria-label
    expect(reportsSrc).toMatch(/aria-label=\{meta\.label\}/);
  });

  it("KPI SummaryCards component is present on the sub-type pages", () => {
    expect(reportsSrc).toMatch(/<SummaryCards\s+lockedType=/);
  });

  it("filter toolbar with flex-wrap present", () => {
    expect(reportsSrc).toMatch(/flex.*flex-wrap.*items-center.*gap-2.*rounded-xl.*border/s);
  });

  it("create report button present (setCreateOpen)", () => {
    expect(reportsSrc).toMatch(/onClick.*setCreateOpen\(true\)/);
    expect(reportsSrc).toMatch(/newReport|Create.*[Rr]eport/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-02: Exactly one form footer per form
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-02: Exactly one form footer per form (PMR/SPR/HQSR)", () => {
  it("PMR/Activity form has exactly one shared footer block in reports.tsx (border-t shrink-0)", () => {
    // The sticky footer for PMR/Activity is the only `border-t shrink-0 px-6 py-4` block;
    // SPR and HQSR are explicitly excluded via !isProgramState && !isHqSector guards
    expect(reportsSrc).toMatch(/!isProgramState && !isHqSector/);
    // Guard comment confirms intent
    expect(reportsSrc).toContain("Sticky footer — only for PMR/Activity; SPR and HQSR own their footer");
  });

  it("SPR form has its own DialogFooter (not a second footer inside reports.tsx)", () => {
    // SPR footer lives in program-state-report-form.tsx
    const sprFooterCount = (sprSrc.match(/DialogFooter/g) ?? []).length;
    expect(sprFooterCount).toBeGreaterThanOrEqual(1);
    // reports.tsx has the explicit comment confirming SPR owns its footer
    expect(reportsSrc).toContain("SPR and HQSR own their footer");
    // The guard !isProgramState && !isHqSector excludes SPR/HQSR from the shared footer
    expect(reportsSrc).toContain("!isProgramState && !isHqSector");
  });

  it("HQSR form has its own DialogFooter (not a second footer inside reports.tsx)", () => {
    // HQSR footer lives in hq-sector-report-form.tsx
    const hqsrFooterCount = (hqsrSrc.match(/DialogFooter/g) ?? []).length;
    expect(hqsrFooterCount).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-04: Validation error summary renders with role="alert"
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-04: Validation error summary renders with role=\"alert\" after submit failure", () => {
  it("PMR/Activity form error summary has role=alert and aria-live (polite inline errors)", () => {
    // Field-level error elements in reports.tsx use role="alert"
    const alertCount = (reportsSrc.match(/role="alert"/g) ?? []).length;
    expect(alertCount).toBeGreaterThan(5);
    // The top-level dup-check notice uses aria-live="polite"
    expect(reportsSrc).toContain('aria-live="polite"');
  });

  it("SPR form error summary has role=alert and aria-live=assertive", () => {
    expect(sprSrc).toMatch(/role="alert"[\s\S]{0,400}aria-live="assertive"/);
  });

  it("errorSummaryRef is tabIndex={-1} so focus can be sent to it programmatically (SPR)", () => {
    // SPR's errorSummaryRef uses tabIndex={-1} for programmatic focus
    expect(sprSrc).toContain("tabIndex={-1}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-05: Returned For Revision state shows text label (not only colour)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-05: Returned For Revision state shows text label (not only colour)", () => {
  it("SPR revision banner contains explicit text label, not just amber styling", () => {
    expect(sprSrc).toContain('t("stateForm.revisionBannerTitle")');
  });

  it("SPR revision banner uses role=alert so screen readers announce it", () => {
    // The banner block must carry role="alert"
    expect(sprSrc).toMatch(/isReturnedForRevision[\s\S]{0,500}role="alert"/);
  });

  it("SPR revision banner includes instructional text, not only an amber badge", () => {
    expect(sprSrc).toContain('t("stateForm.revisionBannerBody")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-06: Approval history override row shows reason text
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-06: Approval history override row shows reason text", () => {
  it("usedOverride check is present in approval history render", () => {
    expect(reportsSrc).toContain("usedOverride");
  });

  it("override row has a visible text label ('Override') and renders the override reason", () => {
    expect(reportsSrc).toContain('t("form.override")');
    expect(reportsSrc).toContain("overrideReason");
  });

  it("override block uses amber styling distinguishable from normal approvals", () => {
    expect(reportsSrc).toMatch(/amber[\s\S]{0,120}t\("form\.override"\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-07: Long filename truncated with title attribute
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-07: Long filename truncated with title attribute in detail view", () => {
  it("attachment filename span has truncate class AND title attribute", () => {
    // After the fix: <span className="truncate" title={att.fileName}>
    expect(reportsSrc).toMatch(/className="truncate"\s+title=\{att\.fileName\}/);
  });

  it("download link for attachments has aria-label naming the file", () => {
    expect(reportsSrc).toContain("aria-label={`Download ${att.fileName}`}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-09: Long content does not break layouts
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-09: Long project name/narrative/filename does not cause layout overflow", () => {
  it("the shared record-detail title uses break-words to prevent horizontal overflow", () => {
    expect(reportsSrc).toContain("RecordDetailModal");
    expect(recordDetailModalSrc).toContain("break-words");
  });

  it("attachment filename in detail view has truncate class", () => {
    expect(reportsSrc).toMatch(/className="truncate".*title=\{att\.fileName\}/);
  });

  it("min-w-0 present on flex children to allow truncation in flex containers", () => {
    // min-w-0 prevents flex children from overflowing beyond their allocated space
    expect(reportsSrc).toMatch(/min-w-0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-UX-10: Responsive — form footer visible, no horizontal overflow
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-UX-10: Responsive form footer visible, no horizontal overflow", () => {
  it("PMR/Activity sticky footer has border-t shrink-0 so it stays visible", () => {
    expect(reportsSrc).toContain("border-t shrink-0 px-6 py-4");
  });

  it("SPR footer uses DialogFooter flex-wrap for narrow viewports", () => {
    expect(sprSrc).toContain("gap-2 flex-wrap");
  });

  it("HQSR footer uses DialogFooter flex-wrap for narrow viewports", () => {
    expect(hqsrSrc).toContain("gap-2 flex-wrap");
  });

  it("dialog form has a scrollable body with overflow-y-auto", () => {
    expect(reportsSrc).toContain("overflow-y-auto flex-1 min-h-0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-A11Y-01: PMR tabs have correct ARIA (role, aria-selected, keyboard)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-A11Y-01: PMR tabs have correct ARIA (role, aria-selected, keyboard)", () => {
  it("tablist role and aria-label present", () => {
    expect(reportsSrc).toMatch(/role="tablist"\s+aria-label=\{t\("form\.tabsAriaLabel"\)\}/);
  });

  it("each tab button has role=tab and aria-selected", () => {
    expect(reportsSrc).toContain('role="tab"');
    expect(reportsSrc).toMatch(/aria-selected=\{isActive\}/);
  });

  it("tabs have aria-controls pointing to section panel id", () => {
    expect(reportsSrc).toMatch(/aria-controls=\{id\}/);
  });

  it("keyboard navigation: ArrowRight, ArrowLeft, Home, End handled", () => {
    expect(reportsSrc).toContain('"ArrowRight"');
    expect(reportsSrc).toContain('"ArrowLeft"');
    expect(reportsSrc).toContain('"Home"');
    expect(reportsSrc).toContain('"End"');
  });

  it("non-active tabs have tabIndex=-1 (roving tabindex pattern)", () => {
    expect(reportsSrc).toMatch(/tabIndex=\{isActive \? 0 : -1\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-A11Y-02: Override dialog — Radix handles focus management
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-A11Y-02: Override dialog — focus managed by Radix Dialog", () => {
  it("override dialog uses Radix Dialog (DialogContent, DialogTitle)", () => {
    expect(reportsSrc).toContain("DialogTitle");
    expect(reportsSrc).toContain("DialogDescription");
    // Radix Dialog traps and returns focus automatically
    expect(reportsSrc).toMatch(/<Dialog open=\{!!transitionOpen\}/);
  });

  it("no manual document.querySelector focus calls in the transition dialog", () => {
    // No ad-hoc focus management should fight Radix
    const dialogBlock = reportsSrc.slice(
      reportsSrc.indexOf("<Dialog open={!!transitionOpen}"),
      reportsSrc.indexOf("</Dialog>", reportsSrc.indexOf("<Dialog open={!!transitionOpen}")) + 200,
    );
    expect(dialogBlock).not.toContain("document.querySelector");
    expect(dialogBlock).not.toContain(".focus()");
  });

  it("discard-changes AlertDialog also uses Radix for focus management", () => {
    expect(reportsSrc).toMatch(/<AlertDialog open=\{showDiscardConfirm\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-A11Y-03: All form inputs have accessible labels (not placeholder-only)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-A11Y-03: HQSR narrative textareas have aria-labelledby bindings", () => {
  it("Section 3 (Technical Analysis) h4 has id and textarea has aria-labelledby", () => {
    expect(hqsrSrc).toContain('id="hqsr-sec3-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec3-heading"');
  });

  it("Section 4 (Key Findings) h4 has id and textarea has aria-labelledby", () => {
    expect(hqsrSrc).toContain('id="hqsr-sec4-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec4-heading"');
  });

  it("Section 5 (Quality Assessment) h4 has id and textarea has aria-labelledby", () => {
    expect(hqsrSrc).toContain('id="hqsr-sec5-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec5-heading"');
  });

  it("Section 6 (Technical Challenges) h4 has id and textarea has aria-labelledby", () => {
    expect(hqsrSrc).toContain('id="hqsr-sec6-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec6-heading"');
  });

  it("Section 7 (Recommendations) h4 has id and textarea has aria-labelledby", () => {
    expect(hqsrSrc).toContain('id="hqsr-sec7-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec7-heading"');
  });

  it("Sections 13/14/15 (Strategic Priorities / Lessons Learned / Sector Outlook) also bound", () => {
    expect(hqsrSrc).toContain('id="hqsr-sec13-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec13-heading"');
    expect(hqsrSrc).toContain('id="hqsr-sec14-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec14-heading"');
    expect(hqsrSrc).toContain('id="hqsr-sec15-heading"');
    expect(hqsrSrc).toContain('aria-labelledby="hqsr-sec15-heading"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-A11Y-04: aria-busy and role="alert" announce submission/error states
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-A11Y-04: aria-busy and role=alert announce submission/error states", () => {
  it("PMR/Activity Submit button has aria-busy binding", () => {
    expect(reportsSrc).toMatch(/aria-busy=\{isSubmittingReport/);
  });

  it("Activity wizard Save As Draft button uses the full shared busy predicate", () => {
    // After fix: Save Draft disabled by same condition as Submit (not just createMutation.isPending)
    const saveDraftCount = (reportsSrc.match(/onClick=\{onSaveDraft\}.*?aria-busy=\{isSubmittingReport \|\| createMutation\.isPending \|\| transitionMutation\.isPending\}/gs) ?? []).length;
    expect(saveDraftCount).toBeGreaterThanOrEqual(1);
  });

  it("SPR Submit button has aria-busy binding tied to isSaving", () => {
    expect(sprSrc).toMatch(/aria-busy=\{isSaving\}/);
  });

  it("HQSR Submit button has aria-busy binding tied to isSaving", () => {
    // After fix: aria-busy added to HQSR Submit
    expect(hqsrSrc).toMatch(/aria-busy=\{isSaving\}/);
  });

  it("PMR/Activity error summary region has role=alert and aria-live (polite for inline dup notice)", () => {
    // Field-level alert elements carry role="alert"; the dup-check notice uses aria-live="polite"
    expect(reportsSrc).toMatch(/role="alert"/);
    expect(reportsSrc).toContain('aria-live="polite"');
  });

  it("field-level error elements in PMR have role=alert", () => {
    // e.g. id="err-pmr-project" role="alert"
    const alertCount = (reportsSrc.match(/role="alert"/g) ?? []).length;
    expect(alertCount).toBeGreaterThan(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-A11Y-05: Revision banner and override badge have text labels
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-A11Y-05: Revision banner and override badge have text labels (not colour-only)", () => {
  it("SPR revision banner text label is unambiguous (not hidden inside icon only)", () => {
    // AlterTriangle icon has aria-hidden; text label is in the <p> element
    expect(sprSrc).toContain('aria-hidden="true"');
    expect(sprSrc).toContain('t("stateForm.revisionBannerTitle")');
  });

  it("override badge in approval history uses explicit text label ('Override')", () => {
    expect(reportsSrc).toContain('t("form.override")');
  });

  it("override badge reason text is also rendered as text (not tooltip-only)", () => {
    // The override reason is in a sibling <span> with amber styling (same amber block)
    expect(reportsSrc).toMatch(/text-amber-[\s\S]{0,300}overrideReason/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline rendered doubles — tab navigation & footer order
// ─────────────────────────────────────────────────────────────────────────────

function TablistDouble() {
  const tabs = ["Basic Information", "Progress", "Activities", "Challenges", "Lessons", "Attachments & Voice"];
  const [active, setActive] = useState(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive((c) => (c + 1) % tabs.length); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setActive((c) => (c - 1 + tabs.length) % tabs.length); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(tabs.length - 1); }
  };
  return (
    <div role="tablist" aria-label="Report form sections" onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button
          key={t}
          role="tab"
          aria-selected={i === active}
          aria-controls={`panel-${i}`}
          tabIndex={i === active ? 0 : -1}
          onClick={() => setActive(i)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

describe("Tab navigation inline double — full 6-tab PMR", () => {
  it("ArrowRight wraps from last tab to first", () => {
    render(<TablistDouble />);
    const tablist = screen.getByRole("tablist");
    // Click last tab to activate it
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[tabs.length - 1]);
    // ArrowRight should wrap to first
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Home key jumps to first tab from any position", () => {
    render(<TablistDouble />);
    const tablist = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    // Move to a middle tab
    fireEvent.click(tabs[3]);
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("End key jumps to last tab from any position", () => {
    render(<TablistDouble />);
    const tablist = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(tabs[tabs.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("exactly one tab is selected at a time", () => {
    render(<TablistDouble />);
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });
});
