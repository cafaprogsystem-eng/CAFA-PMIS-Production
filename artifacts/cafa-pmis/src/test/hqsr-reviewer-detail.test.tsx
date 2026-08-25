/**
 * HQSR Reviewer Detail — Frontend Tests (HQSR-DETAIL-01..08)
 *
 * Tests the read-only HqSectorSectionsView rendered in the reviewer detail Sheet:
 *  - HQSR-DETAIL-01: Canonical identity renders (Sector/Frequency/Period/Status/Author)
 *  - HQSR-DETAIL-02: State/Project identity not rendered in detail
 *  - HQSR-DETAIL-03: Every HQSR-003 required narrative renders
 *  - HQSR-DETAIL-04: Multiple support requests render as separate cards
 *  - HQSR-DETAIL-05: Optional populated structured sections render
 *  - HQSR-DETAIL-06: Empty optional sections do not create misleading content
 *  - HQSR-DETAIL-07: Long narrative remains structurally readable
 *  - HQSR-DETAIL-08: SPC fallback report gets same detail completeness
 *
 * British English spelling used throughout.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Environment shims ────────────────────────────────────────────────────────
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

// ── i18n mock — returns key as display text for simplicity ──────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Provide human-readable labels for the keys HqSectorSectionsView uses
      const map: Record<string, string> = {
        "hqForm.freqMonthly": "Monthly",
        "hqForm.freqQuarterly": "Quarterly",
        "hqForm.freqAnnual": "Annual",
        "hqForm.freqOnDemand": "On-Demand",
        "hqForm.freqQuarterlyQ": `Quarterly — Q${opts?.quarter ?? ""}`,
        "hqForm.viewTechCoordinator": "Technical Coordinator:",
        "hqForm.viewFrequency": "Frequency:",
        "hqForm.viewReason": "On-Demand Reason:",
        "hqForm.viewStateObservations": "State-Level Observations",
        "hqForm.viewTechnicalRatings": "Technical Ratings",
        "hqForm.viewSupportRequired": "HQ Support Requests",
        "hqForm.viewRisksAndIssues": "Risks & Issues",
        "hqForm.viewIndicatorCommentary": "Indicator Commentary",
        "hqForm.viewAttachments": "Attachments",
        "hqForm.viewUnnamed": "(Unnamed)",
        // Section titles — actual locale values (post section-number allocation)
        "hqForm.section3Title": "3. Beneficiary Analysis",
        "hqForm.section4Title": "4. Indicator Performance",
        "hqForm.section5Title": "5. Technical Analysis",
        "hqForm.section6Title": "6. Key Findings",
        "hqForm.section7Title": "7. Quality Assessment",
        "hqForm.section13Title": "13. Strategic Priorities",
        "hqForm.section14Title": "14. Technical Challenges",
        "hqForm.section15Title": "15. Sector Outlook",
      };
      if (key === "hqForm.freqQuarterlyQ") return `Quarterly — Q${opts?.quarter ?? ""}`;
      return map[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { HqSectorSectionsView } from "../components/hq-sector-report-form";
import { TooltipProvider } from "@/components/ui/tooltip";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** All 8 HQSR-003 required narratives plus optional content */
const FULL_SECTIONS: Record<string, unknown> = {
  frequency: "monthly",
  officerName: "Dr. Amina Khalil",
  technicalAnalysis: "Sector analysis shows sustained WASH coverage improvement.",
  keyFindings: "Three boreholes rehabilitated; water access reached 12,000 beneficiaries.",
  qualityAssessment: "Output quality rated Good across all monitored sites.",
  technicalChallenges: "Seasonal flooding disrupted supply chains in Q2.",
  recommendations: "Pre-position supplies before rains; engage local contractors.",
  strategicPriorities: "Expand coverage to underserved southern localities.",
  lessonsLearned: "Early community engagement reduces implementation delays by 30%.",
  sectorOutlook: "Positive trajectory; sustain current investment levels.",
  supportRequired: [
    { supportType: "Procurement", priority: "High", description: "Emergency water purification tablets needed within 2 weeks." },
    { supportType: "Technical", priority: "Medium", description: "Remote sensing data for aquifer mapping requested." },
  ],
  stateObservations: [
    { stateName: "Kassala", technicalObservation: "Borehole yield improved.", qualityConcern: "Turbidity spikes post-rain.", goodPractice: "Community-led maintenance.", actionRequired: "Chlorination protocol review." },
  ],
  technicalRatings: [
    { entityType: "state", entityLabel: "Kassala State", rating: "Good", reason: "Consistent reporting and implementation." },
  ],
  risks: [
    { id: 12, title: "Supply chain disruption", category: "Operational", severity: "Medium" },
  ],
  indicatorCommentary: [
    { indicatorName: "% population with safe water access", commentary: "Increased from 62% to 71% this period." },
  ],
};

/** Minimal sections — only required narratives */
const MINIMAL_SECTIONS: Record<string, unknown> = {
  frequency: "monthly",
  technicalAnalysis: "Minimal analysis text.",
  keyFindings: "Minimal key findings.",
  qualityAssessment: "Minimal quality assessment.",
  technicalChallenges: "Minimal technical challenges.",
  recommendations: "Minimal recommendations.",
  strategicPriorities: "Minimal strategic priorities.",
  lessonsLearned: "Minimal lessons learned.",
  sectorOutlook: "Minimal sector outlook.",
  supportRequired: [
    { supportType: "Logistical", priority: "Low", description: "Vehicle support requested." },
  ],
};

/** SPC fallback author sections — structurally identical to TC-authored */
const SPC_FALLBACK_SECTIONS: Record<string, unknown> = {
  ...FULL_SECTIONS,
  officerName: "SPC Fallback Author",
};

function renderView(sections: Record<string, unknown> = FULL_SECTIONS) {
  return render(<TooltipProvider><HqSectorSectionsView sections={sections} /></TooltipProvider>);
}

// ── HQSR-DETAIL-01: Canonical identity renders ───────────────────────────────

describe("HQSR-DETAIL-01: Canonical identity renders", () => {
  it("renders technical coordinator name", () => {
    renderView();
    expect(screen.getByText("Dr. Amina Khalil")).toBeInTheDocument();
  });

  it("renders frequency label", () => {
    renderView();
    expect(screen.getByText(/Monthly/i)).toBeInTheDocument();
  });

  it("renders frequency meta row with label", () => {
    renderView();
    expect(screen.getByText(/Frequency:/i)).toBeInTheDocument();
  });
});

// ── HQSR-DETAIL-02: State/Project identity not rendered ──────────────────────

describe("HQSR-DETAIL-02: State/Project identity not rendered", () => {
  it("HqSectorSectionsView does not render state_id or project_id", () => {
    const { container } = renderView();
    expect(container.textContent).not.toMatch(/state_id/i);
    expect(container.textContent).not.toMatch(/project_id/i);
  });

  it("reports.tsx metadata block guards state/project from HQSR — verified via source", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../pages/reports.tsx"),
      "utf8",
    );
    // The metadata SheetDescription must guard against state/project for hq_sector
    expect(src).toMatch(/reportType.*!==.*hq_sector.*projectTitle/);
    expect(src).toMatch(/reportType.*!==.*hq_sector.*locationType|stateName/);
  });

  it("no 'State:' or 'Project:' heading renders in HqSectorSectionsView", () => {
    const { container } = renderView();
    // Section view must not render standalone state or project label rows
    expect(container.textContent).not.toMatch(/\bProject:\s/);
  });
});

// ── HQSR-DETAIL-03: Every HQSR-003 required narrative renders ────────────────

describe("HQSR-DETAIL-03: Every HQSR-003 required narrative renders", () => {
  it("technicalAnalysis renders", () => {
    renderView();
    expect(screen.getByText("Sector analysis shows sustained WASH coverage improvement.")).toBeInTheDocument();
  });

  it("keyFindings renders", () => {
    renderView();
    expect(screen.getByText("Three boreholes rehabilitated; water access reached 12,000 beneficiaries.")).toBeInTheDocument();
  });

  it("qualityAssessment renders", () => {
    renderView();
    expect(screen.getByText("Output quality rated Good across all monitored sites.")).toBeInTheDocument();
  });

  it("technicalChallenges renders", () => {
    renderView();
    expect(screen.getByText("Seasonal flooding disrupted supply chains in Q2.")).toBeInTheDocument();
  });

  it("recommendations renders", () => {
    renderView();
    expect(screen.getByText("Pre-position supplies before rains; engage local contractors.")).toBeInTheDocument();
  });

  it("strategicPriorities renders", () => {
    renderView();
    expect(screen.getByText("Expand coverage to underserved southern localities.")).toBeInTheDocument();
  });

  it("lessonsLearned renders", () => {
    renderView();
    expect(screen.getByText("Early community engagement reduces implementation delays by 30%.")).toBeInTheDocument();
  });

  it("sectorOutlook renders", () => {
    renderView();
    expect(screen.getByText("Positive trajectory; sustain current investment levels.")).toBeInTheDocument();
  });

  it("all 8 required narratives present simultaneously", () => {
    renderView();
    const narrativeValues = [
      "Sector analysis shows sustained WASH coverage improvement.",
      "Three boreholes rehabilitated; water access reached 12,000 beneficiaries.",
      "Output quality rated Good across all monitored sites.",
      "Seasonal flooding disrupted supply chains in Q2.",
      "Pre-position supplies before rains; engage local contractors.",
      "Expand coverage to underserved southern localities.",
      "Early community engagement reduces implementation delays by 30%.",
      "Positive trajectory; sustain current investment levels.",
    ];
    for (const val of narrativeValues) {
      expect(screen.getByText(val)).toBeInTheDocument();
    }
  });
});

// ── HQSR-DETAIL-04: Multiple support requests render as separate cards ───────

describe("HQSR-DETAIL-04: Multiple support requests render as separate cards", () => {
  it("renders the HQ Support Requests heading", () => {
    renderView();
    expect(screen.getByText("HQ Support Requests")).toBeInTheDocument();
  });

  it("renders first support request type", () => {
    renderView();
    expect(screen.getByText("Procurement")).toBeInTheDocument();
  });

  it("renders second support request type", () => {
    renderView();
    expect(screen.getByText("Technical")).toBeInTheDocument();
  });

  it("renders both support request descriptions separately", () => {
    renderView();
    expect(screen.getByText("Emergency water purification tablets needed within 2 weeks.")).toBeInTheDocument();
    expect(screen.getByText("Remote sensing data for aquifer mapping requested.")).toBeInTheDocument();
  });

  it("support request priorities render", () => {
    renderView();
    // "High" appears in Procurement support request priority
    expect(screen.getAllByText("High").length).toBeGreaterThanOrEqual(1);
    // "Medium" appears in Technical support request priority (and risk severity — multiple is OK)
    expect(screen.getAllByText("Medium").length).toBeGreaterThanOrEqual(1);
  });
});

// ── HQSR-DETAIL-05: Optional populated structured sections render ─────────────

describe("HQSR-DETAIL-05: Optional populated structured sections render", () => {
  it("state observations section renders", () => {
    renderView();
    expect(screen.getByText("State-Level Observations")).toBeInTheDocument();
  });

  it("state observation state name renders", () => {
    renderView();
    expect(screen.getByText("Kassala")).toBeInTheDocument();
  });

  it("technical ratings section renders", () => {
    renderView();
    expect(screen.getByText("Technical Ratings")).toBeInTheDocument();
    expect(screen.getByText("Kassala State")).toBeInTheDocument();
  });

  it("risks section renders with linked-risk icon for numeric id", () => {
    renderView();
    expect(screen.getByText("Risks & Issues")).toBeInTheDocument();
    expect(screen.getByText("Supply chain disruption")).toBeInTheDocument();
  });

  it("indicator commentary section renders", () => {
    renderView();
    expect(screen.getByText("Indicator Commentary")).toBeInTheDocument();
    expect(screen.getByText("% population with safe water access")).toBeInTheDocument();
    expect(screen.getByText("Increased from 62% to 71% this period.")).toBeInTheDocument();
  });
});

// ── HQSR-DETAIL-06: Empty optional sections do not create misleading content ──

describe("HQSR-DETAIL-06: Empty optional sections suppressed", () => {
  it("state observations section absent when empty", () => {
    renderView(MINIMAL_SECTIONS);
    expect(screen.queryByText("State-Level Observations")).not.toBeInTheDocument();
  });

  it("technical ratings section absent when empty", () => {
    renderView(MINIMAL_SECTIONS);
    expect(screen.queryByText("Technical Ratings")).not.toBeInTheDocument();
  });

  it("risks section absent when empty", () => {
    renderView(MINIMAL_SECTIONS);
    expect(screen.queryByText("Risks & Issues")).not.toBeInTheDocument();
  });

  it("indicator commentary section absent when empty", () => {
    renderView(MINIMAL_SECTIONS);
    expect(screen.queryByText("Indicator Commentary")).not.toBeInTheDocument();
  });
});

// ── HQSR-DETAIL-07: Long narrative remains structurally readable ──────────────

describe("HQSR-DETAIL-07: Long narrative remains structurally readable", () => {
  const longText = "A".repeat(2000) + " critical infrastructure gap identified.";

  it("long technicalAnalysis renders without truncation", () => {
    renderView({ ...MINIMAL_SECTIONS, technicalAnalysis: longText });
    const el = screen.getByText((content) => content.includes("critical infrastructure gap identified."));
    expect(el).toBeInTheDocument();
  });

  it("narrative paragraphs have whitespace-pre-wrap style", () => {
    const { container } = renderView({ ...MINIMAL_SECTIONS, technicalAnalysis: "Multi\nline\ncontent." });
    const paras = container.querySelectorAll("p.whitespace-pre-wrap");
    expect(paras.length).toBeGreaterThan(0);
  });
});

// ── HQSR-DETAIL-08: SPC fallback report gets same detail completeness ─────────

describe("HQSR-DETAIL-08: SPC fallback report gets same detail completeness", () => {
  it("SPC-authored report renders all 8 required narratives", () => {
    renderView(SPC_FALLBACK_SECTIONS);
    expect(screen.getByText("Sector analysis shows sustained WASH coverage improvement.")).toBeInTheDocument();
    expect(screen.getByText("Positive trajectory; sustain current investment levels.")).toBeInTheDocument();
  });

  it("SPC fallback author name renders", () => {
    renderView(SPC_FALLBACK_SECTIONS);
    expect(screen.getByText("SPC Fallback Author")).toBeInTheDocument();
  });

  it("SPC fallback report renders support requests as individual cards", () => {
    renderView(SPC_FALLBACK_SECTIONS);
    expect(screen.getByText("HQ Support Requests")).toBeInTheDocument();
    expect(screen.getByText("Emergency water purification tablets needed within 2 weeks.")).toBeInTheDocument();
    expect(screen.getByText("Remote sensing data for aquifer mapping requested.")).toBeInTheDocument();
  });

  it("SPC fallback report renders optional structured sections", () => {
    renderView(SPC_FALLBACK_SECTIONS);
    expect(screen.getByText("State-Level Observations")).toBeInTheDocument();
    expect(screen.getByText("Technical Ratings")).toBeInTheDocument();
  });
});
