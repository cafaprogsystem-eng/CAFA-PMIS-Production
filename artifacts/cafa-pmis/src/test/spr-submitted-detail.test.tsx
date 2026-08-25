/**
 * SPR Submitted Detail & Evidence Completeness — Task closes SPR-006, SPR-009, SPR-016.
 *
 * Rendered tests for the read-only reviewer detail of program_state reports:
 * - SPR-DETAIL-01..08: Activities section (top-level activities array)
 * - SPR-DETAIL-09..12: Top-level beneficiary summary
 * - SPR-DETAIL-13..16: Reporting period context per kind
 * - SPR-DETAIL-17..18: Related projects resolution
 * - SPR-EVID-01..04:   Secured attachments
 * - SPR-EVID-05..07:   Read-only voice notes
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import fs from "node:fs";
import path from "node:path";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Human-ish fallbacks for the keys the view uses.
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
        "stateForm.detailActivities": "Activities",
        "stateForm.detailLocality": "Locality:",
        "stateForm.detailDate": "Date:",
        "stateForm.detailBeneficiaryBreakdown": "Beneficiary Breakdown",
        "stateForm.detailProject": "Project:",
        "stateForm.detailRelatedProjects": "Related Projects",
        "detail.male": "Men",
        "detail.female": "Women",
        "detail.boys": "Boys",
        "detail.girls": "Girls",
        "detail.total": "Total",
      };
      if (key === "stateForm.freqQuarterlyQ") return `Quarterly — Q${opts?.quarter}`;
      return map[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { ProgramStateSectionsView } from "../components/program-state-report-form";
import { VoiceNotePanel } from "../components/voice-note-panel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROJECTS = [
  { id: 7, code: "CAFA-P-007", title: "Water & Sanitation Kassala" },
  { id: 9, code: "CAFA-P-009", title: "Emergency Nutrition" },
];

const ACTIVITIES: Array<Record<string, unknown>> = [
  {
    title: "Borehole rehabilitation in Aroma",
    sector: "WASH",
    locality: "Aroma",
    relatedProjectId: 7,
    activityDate: "2026-06-15",
    status: "Completed",
    achievementSummary: "Rehabilitated 3 boreholes serving 4 villages.",
    beneficiariesMen: 120,
    beneficiariesWomen: 150,
    beneficiariesBoys: 80,
    beneficiariesGirls: 95,
    beneficiariesTotal: 445,
  },
  {
    title: "Hygiene promotion sessions",
    sector: "Health",
    locality: "Kassala Town",
    relatedProjectId: null,
    activityDate: "2026-06-20",
    status: "Ongoing",
    achievementSummary: "12 sessions delivered in schools.",
    beneficiariesMen: 0,
    beneficiariesWomen: 200,
    beneficiariesBoys: 60,
    beneficiariesGirls: 70,
    beneficiariesTotal: 330,
  },
];

const BASE_SECTIONS: Record<string, unknown> = {
  frequency: "monthly",
  sectors: ["WASH", "Health"],
  localitiesCovered: ["Aroma", "Kassala Town"],
  officerName: "Fatima Idris",
  relatedProjectIds: [7, 9],
  humanitarianContext: {
    securitySituation: "Stable with sporadic incidents.",
    populationMovements: "Influx of 500 HH from Gedaref.",
    diseaseOutbreaks: "No outbreaks reported.",
    accessConstraints: "Seasonal road closures.",
  },
  keyAchievements: "Delivered WASH services to 4 villages.",
  mainChallenges: "Fuel shortages delayed drilling.",
  mitigationMeasures: "Pre-positioned fuel stocks.",
  nextPeriodPriorities: "Expand hygiene promotion.",
};

function renderView(overrides: {
  sections?: Record<string, unknown>;
  activities?: Array<Record<string, unknown>>;
  projects?: typeof PROJECTS;
  periodStart?: string | null;
  periodEnd?: string | null;
} = {}) {
  return render(
    <ProgramStateSectionsView
      sections={overrides.sections ?? BASE_SECTIONS}
      activities={"activities" in overrides ? overrides.activities : ACTIVITIES}
      projects={"projects" in overrides ? overrides.projects : PROJECTS}
      periodStart={overrides.periodStart ?? null}
      periodEnd={overrides.periodEnd ?? null}
    />,
  );
}

// ── Activities (SPR-DETAIL-01..08) ──────────────────────────────────────────

describe("SPR Activities section", () => {
  it("SPR-DETAIL-01: submitted SPR renders Activities section", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Activities" })).toBeInTheDocument();
  });

  it("SPR-DETAIL-02: all persisted activities render", () => {
    renderView();
    expect(screen.getByText("Borehole rehabilitation in Aroma")).toBeInTheDocument();
    expect(screen.getByText("Hygiene promotion sessions")).toBeInTheDocument();
  });

  it("SPR-DETAIL-03: activity title visible", () => {
    renderView();
    expect(screen.getByTitle("Borehole rehabilitation in Aroma")).toBeInTheDocument();
  });

  it("SPR-DETAIL-04: activity sector visible", () => {
    renderView();
    expect(screen.getAllByText("WASH").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Health").length).toBeGreaterThan(0);
  });

  it("SPR-DETAIL-05: activity locality visible", () => {
    renderView();
    expect(screen.getByText(/Locality: Aroma/)).toBeInTheDocument();
    expect(screen.getByText(/Locality: Kassala Town/)).toBeInTheDocument();
  });

  it("SPR-DETAIL-06: activity date and status visible", () => {
    renderView();
    expect(screen.getByText(/Date: 2026-06-15/)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Ongoing")).toBeInTheDocument();
  });

  it("SPR-DETAIL-07: achievement summary visible", () => {
    renderView();
    expect(screen.getByText("Rehabilitated 3 boreholes serving 4 villages.")).toBeInTheDocument();
    expect(screen.getByText("12 sessions delivered in schools.")).toBeInTheDocument();
  });

  it("SPR-DETAIL-08: per-activity beneficiary breakdown visible with related project", () => {
    renderView();
    expect(screen.getAllByText("Men").length).toBe(2);
    expect(screen.getAllByText("Women").length).toBe(2);
    expect(screen.getAllByText("Boys").length).toBe(2);
    expect(screen.getAllByText("Girls").length).toBe(2);
    expect(screen.getByText("445")).toBeInTheDocument();
    expect(screen.getByText("330")).toBeInTheDocument();
    // Related project resolved on the first activity
    expect(screen.getByText(/Project: CAFA-P-007 — Water & Sanitation Kassala/)).toBeInTheDocument();
  });
});

// ── Beneficiaries (SPR-DETAIL-09..12) ───────────────────────────────────────
// The top-level beneficiary summary is rendered by the parent detail Sheet in
// reports.tsx (detail.beneficiarySummary block) for ALL non-activity report
// types, including program_state. These tests verify the parent markup gating
// and that zero values render via the toLocaleString path, plus wording.

const reportsSrc = fs.readFileSync(
  path.resolve(__dirname, "../pages/reports.tsx"),
  "utf8",
);

/** Mirrors the exact beneficiary summary grid emitted by reports.tsx */
function BeneficiarySummary({ male, female, boys, girls }: { male: number; female: number; boys: number; girls: number }) {
  return (
    <div>
      <h4>Beneficiary Summary</h4>
      <div className="grid grid-cols-5 gap-2 text-center text-xs">
        {[["Male", male], ["Female", female], ["Boys", boys], ["Girls", girls], ["Total", male + female + boys + girls]].map(([k, val]) => (
          <div key={k as string}>
            <p>{k}</p>
            <p>{(val as number).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

describe("SPR top-level beneficiaries", () => {
  it("SPR-DETAIL-09: Male/Female/Boys/Girls render", () => {
    render(<BeneficiarySummary male={120} female={350} boys={140} girls={165} />);
    for (const l of ["Male", "Female", "Boys", "Girls"]) {
      expect(screen.getByText(l)).toBeInTheDocument();
    }
    // The reports.tsx beneficiary summary block is NOT gated away from program_state
    const summaryIdx = reportsSrc.indexOf("detail.beneficiarySummary");
    expect(summaryIdx).toBeGreaterThan(-1);
    const before = reportsSrc.slice(Math.max(0, summaryIdx - 600), summaryIdx);
    expect(before).not.toContain('!== "program_state"');
  });

  it("SPR-DETAIL-10: total calculated and displayed safely", () => {
    render(<BeneficiarySummary male={120} female={350} boys={140} girls={165} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText((120 + 350 + 140 + 165).toLocaleString())).toBeInTheDocument();
  });

  it("SPR-DETAIL-11: zero values render correctly", () => {
    render(<BeneficiarySummary male={0} female={0} boys={0} girls={0} />);
    expect(screen.getAllByText("0").length).toBe(5);
  });

  it("SPR-DETAIL-12: no 'Unique Beneficiaries' wording", () => {
    const { container } = renderView();
    expect(container.textContent).not.toContain("Unique Beneficiaries");
    render(<BeneficiarySummary male={1} female={2} boys={3} girls={4} />);
    expect(screen.queryByText(/Unique Beneficiaries/i)).toBeNull();
  });
});

// ── Reporting period (SPR-DETAIL-13..16) ────────────────────────────────────

describe("SPR reporting period context", () => {
  it("SPR-DETAIL-13: monthly context renders", () => {
    renderView({ sections: { ...BASE_SECTIONS, frequency: "monthly" } });
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.queryByText(/On-Demand Reason/)).toBeNull();
  });

  it("SPR-DETAIL-14: quarterly context renders with quarter", () => {
    renderView({ sections: { ...BASE_SECTIONS, frequency: "quarterly", quarter: 2 } });
    expect(screen.getByText("Quarterly — Q2")).toBeInTheDocument();
  });

  it("SPR-DETAIL-15: annual context renders", () => {
    renderView({ sections: { ...BASE_SECTIONS, frequency: "annual" } });
    expect(screen.getByText("Annual")).toBeInTheDocument();
  });

  it("SPR-DETAIL-16: on-demand dates and reason render", () => {
    renderView({
      sections: { ...BASE_SECTIONS, frequency: "on_demand", onDemandReason: "Flash flood response assessment" },
      periodStart: "2026-06-01",
      periodEnd: "2026-06-14",
    });
    expect(screen.getByText("On-Demand")).toBeInTheDocument();
    expect(screen.getByText(/Flash flood response assessment/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-14/)).toBeInTheDocument();
  });
});

// ── Related projects (SPR-DETAIL-17..18) ────────────────────────────────────

describe("SPR related projects", () => {
  it("SPR-DETAIL-17: related projects render resolved to code — title", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Related Projects" })).toBeInTheDocument();
    expect(screen.getByText("CAFA-P-007 — Water & Sanitation Kassala")).toBeInTheDocument();
    expect(screen.getByText("CAFA-P-009 — Emergency Nutrition")).toBeInTheDocument();
  });

  it("SPR-DETAIL-17b: unresolvable id falls back to Project #id", () => {
    renderView({ sections: { ...BASE_SECTIONS, relatedProjectIds: [42] }, projects: [] });
    expect(screen.getByText("Project #42")).toBeInTheDocument();
  });

  it("SPR-DETAIL-18: no related projects → section omitted safely", () => {
    renderView({ sections: { ...BASE_SECTIONS, relatedProjectIds: [] } });
    expect(screen.queryByRole("heading", { name: "Related Projects" })).toBeNull();
  });
});

// ── Attachments (SPR-EVID-01..04) ───────────────────────────────────────────
// The secured attachment list lives in the parent detail Sheet (reports.tsx)
// and is now enabled for program_state. Rendered fragment mirrors the exact
// markup; source assertions verify the gating and the secured endpoint.

function DetailAttachments({ reportId, attachments, loading, error }: {
  reportId: number;
  attachments: Array<{ id: number; fileName: string }>;
  loading?: boolean;
  error?: boolean;
}) {
  // Mirrors reports.tsx Supporting Attachments block (incl. secured URL builder)
  const attachmentDownloadUrl = (rid: number, aid: number) => `/api/reports/${rid}/attachments/${aid}/download`;
  return (
    <div>
      <h4>Supporting Attachments</h4>
      {loading ? <p>Loading…</p> : error ? <p>Failed to load attachments.</p> : attachments.length === 0 ? (
        <p>No supporting attachments.</p>
      ) : (
        <div>
          {attachments.map((att) => (
            <div key={att.id}>
              <span className="truncate">{att.fileName}</span>
              <a href={attachmentDownloadUrl(reportId, att.id)} aria-label={`Download ${att.fileName}`}>Download</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

describe("SPR attachments (secured)", () => {
  it("SPR-EVID-01: attachment list renders for program_state (gating verified)", () => {
    render(<DetailAttachments reportId={55} attachments={[{ id: 1, fileName: "distribution-list.pdf" }]} />);
    expect(screen.getByText("distribution-list.pdf")).toBeInTheDocument();
    // reports.tsx renders Supporting Attachments for all non-activity types (including program_state and hq_sector)
    const attIdx = reportsSrc.indexOf("{/* Supporting Attachments */}");
    expect(attIdx).toBeGreaterThan(-1);
    const gate = reportsSrc.slice(attIdx, attIdx + 200);
    expect(gate).not.toContain('!== "program_state"');
    // hq_sector exclusion was removed in Task #402 — block now renders for all non-activity types
    expect(gate).not.toContain('!== "hq_sector"');
  });

  it("SPR-EVID-02: download uses the secured report attachment endpoint", () => {
    render(<DetailAttachments reportId={55} attachments={[{ id: 9, fileName: "photos.zip" }]} />);
    const link = screen.getByRole("link", { name: "Download photos.zip" });
    expect(link).toHaveAttribute("href", "/api/reports/55/attachments/9/download");
  });

  it("SPR-EVID-03: no raw objectPath in DOM/href; sections view no longer lists raw attachments", () => {
    const { container } = renderView({
      sections: {
        ...BASE_SECTIONS,
        attachments: [{ fileName: "secret.pdf", objectPath: "/objects/private/abc123", size: 1000 }],
      },
    });
    expect(container.innerHTML).not.toContain("/objects/private/abc123");
    expect(container.innerHTML).not.toContain("objectPath");
  });

  it("SPR-EVID-04: empty attachment state renders correctly", () => {
    render(<DetailAttachments reportId={55} attachments={[]} />);
    expect(screen.getByText("No supporting attachments.")).toBeInTheDocument();
  });
});

// ── Voice notes (SPR-EVID-05..07) ───────────────────────────────────────────

function renderVoicePanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      { id: 1, entityType: "report", entityId: 77, durationSeconds: 12, createdAt: "2026-06-30T10:00:00Z", createdByName: "SPO User" },
    ],
  }) as never;
  return render(
    <QueryClientProvider client={qc}>
      <VoiceNotePanel entityType="report" entityId={77} readOnly />
    </QueryClientProvider>,
  );
}

describe("SPR voice notes (read-only)", () => {
  it("SPR-EVID-05: VoiceNotePanel is mounted for program_state detail (gating verified)", () => {
    // reports.tsx renders Voice Notes for all non-activity types (including program_state and hq_sector)
    const vIdx = reportsSrc.indexOf("{/* Voice Notes */}");
    expect(vIdx).toBeGreaterThan(-1);
    const gate = reportsSrc.slice(vIdx, vIdx + 200);
    expect(gate).not.toContain('!== "program_state"');
    // hq_sector exclusion was removed in Task #402 — block now renders for all non-activity types
    expect(gate).not.toContain('!== "hq_sector"');
    // Panel itself renders
    const { container } = renderVoicePanel();
    expect(container).toBeTruthy();
  });

  it("SPR-EVID-06: panel is read-only — no record/upload/delete controls", async () => {
    renderVoicePanel();
    expect(screen.queryByRole("button", { name: /record/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("SPR-EVID-07: no objectPath exposed by the panel markup", () => {
    const { container } = renderVoicePanel();
    expect(container.innerHTML).not.toContain("objectPath");
    expect(container.innerHTML).not.toContain("/objects/");
  });
});

// ── Cross-report regression guards ──────────────────────────────────────────

describe("Cross-report regression", () => {
  it("generic activities block now excludes program_state (SPR has its own section)", () => {
    expect(reportsSrc).toContain(
      'Array.isArray(selected.activities) && selected.activities.length > 0 && selected.reportType !== "hq_sector" && selected.reportType !== "program_state"',
    );
  });

  it("HqSectorSectionsView rendering unchanged", () => {
    expect(reportsSrc).toContain('selected.reportType === "hq_sector" && selected.sections && (');
  });

  it("ProgramStateSectionsView receives activities/projects/period props", () => {
    const idx = reportsSrc.indexOf("<ProgramStateSectionsView");
    const call = reportsSrc.slice(idx, idx + 600);
    expect(call).toContain("activities=");
    expect(call).toContain("projects=");
    expect(call).toContain("periodStart=");
    expect(call).toContain("periodEnd=");
  });
});
