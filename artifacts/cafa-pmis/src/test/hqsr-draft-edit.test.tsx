/**
 * HQSR-005 — HQ Sector Report Draft Edit / Reopen / Revision Resubmit.
 *
 * Renders the real HqSectorReportForm in edit mode (existingReport prop) and
 * verifies:
 *  - Hydration of all persisted fields (HQSR-EDIT-01…06)
 *  - Identity visible but locked; identity fields absent from PATCH
 *    (HQSR-EDIT-ID-01…07)
 *  - Save Draft PATCHes the same report id — never POSTs (HQSR-EDIT-SAVE-01…04)
 *  - Submit: PATCH first, transition only on PATCH success (HQSR-EDIT-SUB-01…05)
 *  - Revision banner + comments for returned drafts (HQSR-EDIT-REV-01…06)
 *  - PATCH never carries workflow_path / stateId / projectId
 *    (HQSR-EDIT-FB-02, HQSR-EDIT-ID-06)
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Environment shims for Radix in jsdom ────────────────────────────────────
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as never;
  }
});

// ── i18n mock ────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown) => ({
      "hqForm.titleEdit": "Edit HQ Sector Report",
      "hqForm.returnedForRevision": "Returned for Revision",
    }[key] ?? (typeof def === "string" ? def : key)),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── API hook mocks ───────────────────────────────────────────────────────────
const { createMutateAsync, transitionMutateAsync, meHolder } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(async () => ({ id: 999 })),
  transitionMutateAsync: vi.fn(async () => ({})),
  meHolder: {
    user: { id: 31, name: "TC User", role: "technical_coordinator", sector: "Health" } as Record<string, unknown>,
    permissions: ["reports.create", "comments.view", "comments.create"],
  },
}));

vi.mock("@workspace/api-client-react", () => {
  const stable = <T,>(data: T) => {
    const res = { data, isLoading: false, isError: false, isPending: false, refetch: () => {} };
    return () => res;
  };
  const stableMe = {
    data: {
      get user() { return meHolder.user; },
      get permissions() { return meHolder.permissions; },
    },
    isLoading: false,
  };
  const stableMutation = { mutateAsync: createMutateAsync, isPending: false };
  const stableTransition = { mutateAsync: transitionMutateAsync, isPending: false };
  return {
    useGetMe: () => stableMe,
    useListStates: stable([{ id: 1, name: "Khartoum" }, { id: 2, name: "Kassala" }]),
    useListProjects: stable([]),
    useCreateReport: () => stableMutation,
    useTransitionReport: () => stableTransition,
    requestUploadUrl: vi.fn(),
    ListReportsQueryResult: undefined,
  };
});

// fetch mock — records PATCH calls; risks/snapshot/comments GETs return safe data.
type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
let patchOk = true;
let commentsStatus = 200;
beforeEach(() => {
  fetchCalls.length = 0;
  patchOk = true;
  commentsStatus = 200;
  createMutateAsync.mockClear();
  transitionMutateAsync.mockClear();
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (init?.method === "PATCH") {
      return { ok: patchOk, json: async () => (patchOk ? {} : { error: "save_failed" }) } as never;
    }
    if (String(url).includes("/sector-snapshot")) {
      return {
        ok: true,
        json: async () => ({
          snapshot: {
            activeProjects: 1, activeStates: 1, activeLocalities: 2, activitiesImplemented: 1,
            beneficiariesReached: 40, indicatorProgressPct: 50, delayedActivities: 0,
            openRisks: 1, pendingApprovals: 0,
          },
          beneficiaryBreakdown: { men: 0, women: 0, boys: 0, girls: 0 },
          beneficiaryByState: [],
          beneficiaryByProject: [],
          beneficiaryByDonor: [],
          stateSummaries: [],
          projectSummaries: [],
          indicators: [],
        }),
      } as never;
    }
    if (String(url).includes("/api/risks")) {
      return {
        ok: true,
        json: async () => ([{
          id: 7, title: "Cold chain gaps", category: "operational", severity: "medium",
          status: "open", mitigationPlan: "Procure fridges", stateId: null,
        }]),
      } as never;
    }
    if (String(url).includes("/api/comments")) {
      // Real GET /comments contract: authorised HQSR author gets a flat array
      // of comment rows (TC holds comments.create; sector scope applies).
      // Tests can flip commentsStatus to 403 to model a denied request.
      if (commentsStatus !== 200) {
        return { ok: false, status: commentsStatus, json: async () => ({ error: "forbidden", requiredPermission: "comments.create" }) } as never;
      }
      return {
        ok: true, status: 200,
        json: async () => ([{
          id: 501, entityType: "report", entityId: 88, parentId: null, section: null,
          commentType: "revision_request", authorId: 5, authorName: "SPC Reviewer",
          authorRoleLabel: "Senior Programme Coordinator",
          body: "Please expand the quality assessment before resubmitting.",
          status: "open", resolvedAt: null, resolvedById: null,
          createdAt: "2026-06-20T10:00:00Z", updatedAt: "2026-06-20T10:00:00Z",
        }]),
      } as never;
    }
    return { ok: true, json: async () => [] } as never;
  }) as never;
});
afterEach(() => cleanup());

import { HqSectorReportForm, type ExistingHqsrReport } from "../components/hq-sector-report-form";

// ── Fixture: a complete persisted HQSR draft ────────────────────────────────
const existingReport = {
  id: 88,
  title: "Health — Monthly HQ Sector Report — June 2026",
  status: "draft",
  reportType: "hq_sector",
  sector: "Health",
  kind: "monthly",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  stateId: null,
  projectId: null,
  authorId: 31,
  approvalHistory: [
    { action: "submit", byName: "TC User" },
    { action: "request_revision", byName: "PM" },
  ],
  sections: {
    frequency: "monthly",
    period: "2026-06",
    officerName: "TC User",
    technicalAnalysis: "Coverage improved across states",
    keyFindings: "Immunisation up 12%",
    qualityAssessment: "Protocols followed",
    technicalChallenges: "Cold chain gaps persist",
    recommendations: "Procure solar fridges",
    strategicPriorities: "Expand outreach",
    lessonsLearned: "Engage state teams early",
    sectorOutlook: "Positive with caveats",
    supportRequired: [{ supportType: "Logistics Support", priority: "High", description: "Need cold-chain trucks" }],
    stateObservations: [{
      stateId: 1, technicalObservation: "Strong state team",
      qualityConcern: "Data timeliness", goodPractice: "Peer review", actionRequired: "Monthly check-ins",
    }],
    technicalRatings: [{ entityType: "state", entityLabel: "Khartoum", rating: "Good", reason: "Consistent delivery" }],
    risks: [{ id: 7, category: "operational", title: "Cold chain gaps", severity: "medium", description: "Procure fridges", riskStatus: "open" }],
    indicatorCommentary: [{ indicatorName: "Vaccination coverage", commentary: "On track" }],
    attachments: [{
      fileName: "coverage.pdf", contentType: "application/pdf", size: 4321,
      objectPath: "", driveFileId: 42, attachmentType: "Photos",
    }],
  },
} as unknown as ExistingHqsrReport;

const onDemandReport = {
  ...(existingReport as unknown as Record<string, unknown>),
  id: 89,
  kind: "on_demand",
  period: "2026-06-01 to 2026-06-15",
  reportingMonth: null,
  sections: {
    ...(existingReport as unknown as { sections: Record<string, unknown> }).sections,
    frequency: "on_demand",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-15",
    onDemandReason: "Donor Request",
  },
} as unknown as ExistingHqsrReport;

function renderForm(report?: ExistingHqsrReport) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HqSectorReportForm onClose={() => {}} existingReport={report} />
    </QueryClientProvider>,
  );
}

const patchCallsTo = (id: number) =>
  fetchCalls.filter((c) => c.init?.method === "PATCH" && c.url === `/api/reports/${id}`);

async function waitForHydration() {
  await screen.findByDisplayValue("Health — Monthly HQ Sector Report — June 2026");
  await screen.findByDisplayValue("Coverage improved across states");
  await waitFor(() => expect(screen.getByDisplayValue("Need cold-chain trucks")).toBeInTheDocument());
}

describe("HQSR-005 — hydration (HQSR-EDIT-01…06)", () => {
  it("HQSR-EDIT-01: edit mode shows the edit heading", () => {
    // The fixture has request_revision in approvalHistory, so the form
    // correctly shows the Revise heading (Phase 4 parity with SPR).
    renderForm(existingReport);
    expect(screen.getByText("hqForm.titleRevise")).toBeInTheDocument();
  });

  it("create mode keeps the normal heading and no revision banner", () => {
    renderForm(undefined);
    expect(screen.queryByText("Edit HQ Sector Report")).not.toBeInTheDocument();
    expect(screen.queryByText(/returned for revision/i)).not.toBeInTheDocument();
  });

  it("HQSR-EDIT-02: title hydrated", async () => {
    renderForm(existingReport);
    expect(await screen.findByDisplayValue("Health — Monthly HQ Sector Report — June 2026")).toBeInTheDocument();
  });

  it("HQSR-EDIT-03: all narrative sections hydrated", async () => {
    renderForm(existingReport);
    for (const val of [
      "Coverage improved across states", "Immunisation up 12%", "Protocols followed",
      "Cold chain gaps persist", "Procure solar fridges", "Expand outreach",
      "Engage state teams early", "Positive with caveats", "TC User",
    ]) {
      expect(await screen.findByDisplayValue(val)).toBeInTheDocument();
    }
  });

  it("HQSR-EDIT-04: structured arrays hydrated (support, observations, ratings, indicators, attachments)", async () => {
    renderForm(existingReport);
    expect(await screen.findByDisplayValue("Need cold-chain trucks")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Strong state team")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Consistent delivery")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vaccination coverage")).toBeInTheDocument();
    expect(screen.getByText("coverage.pdf")).toBeInTheDocument();
    // Existing attachment listed without re-upload
    expect(fetchCalls.filter((c) => c.url.includes("/api/drive/upload")).length).toBe(0);
  });

  it("HQSR-EDIT-05: missing/malformed optional nested content does not crash", () => {
    const sparse = {
      ...(existingReport as unknown as Record<string, unknown>),
      sections: { frequency: "monthly", officerName: null, supportRequired: "corrupt", stateObservations: [{}], risks: null },
      approvalHistory: undefined,
    } as unknown as ExistingHqsrReport;
    renderForm(sparse);
    expect(screen.getByText("Edit HQ Sector Report")).toBeInTheDocument();
  });

  it("HQSR-EDIT-06: on_demand kind hydrates onDemandReason and period bounds", async () => {
    renderForm(onDemandReport);
    expect(await screen.findByDisplayValue("2026-06-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-06-15")).toBeInTheDocument();
    expect(screen.getAllByText("Donor Request").length).toBeGreaterThan(0);
  });
});

describe("HQSR-005 — identity locked (HQSR-EDIT-ID-01…03, OVR-04)", () => {
  it("HQSR-EDIT-ID-01: sector visible but read-only (input, not a select)", () => {
    renderForm(existingReport);
    const sectorInput = screen.getByDisplayValue("Health");
    expect(sectorInput).toHaveAttribute("readonly");
    expect(sectorInput).toHaveAttribute("aria-readonly", "true");
  });

  it("HQSR-EDIT-ID-02/03: frequency and period controls disabled", () => {
    renderForm(existingReport);
    const comboboxes = screen.getAllByRole("combobox");
    // Frequency + Month + Year selects are all disabled in edit mode
    const disabled = comboboxes.filter((c) => (c as HTMLButtonElement).disabled);
    expect(disabled.length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("frequency.monthly").length).toBeGreaterThan(0);
  });

  it("HQSR-EDIT-OVR-04: Full Operational Access (PM) does not unlock identity controls", () => {
    meHolder.user = { id: 99, name: "PM User", role: "program_manager" };
    try {
      renderForm(existingReport);
      const sectorInput = screen.getByDisplayValue("Health");
      expect(sectorInput).toHaveAttribute("readonly");
      const disabled = screen.getAllByRole("combobox").filter((c) => (c as HTMLButtonElement).disabled);
      expect(disabled.length).toBeGreaterThanOrEqual(3);
    } finally {
      meHolder.user = { id: 31, name: "TC User", role: "technical_coordinator", sector: "Health" };
    }
  });
});

describe("HQSR-005 — save behaviour (HQSR-EDIT-SAVE-01…04, ID-04…07)", () => {
  it("HQSR-EDIT-SAVE-01/02: Save Draft PATCHes the same id, never POSTs", async () => {
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("hqForm.saveDraft"));
    await waitFor(() => expect(patchCallsTo(88).length).toBe(1));
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("HQSR-EDIT-SAVE-03 / ID-04…07: PATCH body is content-only — no identity fields", async () => {
    renderForm(existingReport);
    await waitForHydration();
    const field = await screen.findByDisplayValue("Immunisation up 12%");
    fireEvent.change(field, { target: { value: "Immunisation up 15%" } });
    fireEvent.click(screen.getByText("hqForm.saveDraft"));
    await waitFor(() => expect(patchCallsTo(88).length).toBe(1));
    const body = JSON.parse(String(patchCallsTo(88)[0].init?.body)) as Record<string, unknown>;
    expect((body.sections as Record<string, unknown>).keyFindings).toBe("Immunisation up 15%");
    // Identity fields must be absent (HQSR-002 — a present key is a 409 server-side)
    for (const key of [
      "reportType", "sector", "kind", "period", "reportingMonth", "reportingYear",
      "quarter", "periodStart", "periodEnd", "stateId", "projectId", "workflow_path", "workflowPath",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body).toHaveProperty("title");
    expect(body).toHaveProperty("sections");
    // Stored linked register risk survives the PATCH (id 7 selected at hydration)
    const risks = (body.sections as Record<string, unknown>).risks as Array<{ id: number }>;
    expect(risks.some((r) => r.id === 7)).toBe(true);
  });

  it("HQSR-EDIT-SAVE-04: successful PATCH stays in edit mode with identity unchanged", async () => {
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("hqForm.saveDraft"));
    await waitFor(() => expect(patchCallsTo(88).length).toBe(1));
    // Still in edit mode — heading (revise variant for this fixture) and locked identity intact
    expect(screen.getByText("hqForm.titleRevise")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Health")).toHaveAttribute("readonly");
  });
});

describe("HQSR-005 — submit behaviour (HQSR-EDIT-SUB-01…03, REV-06, FB tests)", () => {
  it("HQSR-EDIT-SUB-00: incomplete new reports never create or submit a metadata-only record", async () => {
    renderForm(undefined);
    fireEvent.click(screen.getByText("hqForm.submitReport"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(transitionMutateAsync).not.toHaveBeenCalled();
  });

  it("HQSR-EDIT-SUB-01/02 / REV-06: Resubmit = PATCH then transition on the same id", async () => {
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("hqForm.submitReport"));
    await waitFor(() => expect(transitionMutateAsync).toHaveBeenCalledTimes(1));
    expect(patchCallsTo(88).length).toBe(1);
    expect(createMutateAsync).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (transitionMutateAsync.mock.calls as any)[0][0] as { reportId: number; data: { action: string; comment?: string } };
    expect(call.reportId).toBe(88);
    expect(call.data.action).toBe("submit");
    expect(call.data.comment).toBe("Resubmission");
  });

  it("HQSR-EDIT-SUB-03: failed PATCH blocks the submit transition", async () => {
    patchOk = false;
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("hqForm.submitReport"));
    await waitFor(() => expect(patchCallsTo(88).length).toBe(1));
    await new Promise((r) => setTimeout(r, 80));
    expect(transitionMutateAsync).not.toHaveBeenCalled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("HQSR-EDIT-SUB-04/05: submit 422 leaves the draft saved and surfaces the error (no new report)", async () => {
    transitionMutateAsync.mockRejectedValueOnce(new Error("report_content_incomplete"));
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("hqForm.submitReport"));
    await waitFor(() => expect(transitionMutateAsync).toHaveBeenCalledTimes(1));
    expect(patchCallsTo(88).length).toBe(1); // content was saved first
    expect(createMutateAsync).not.toHaveBeenCalled(); // never falls back to POST
    // Form still open in edit mode (revise heading for this returned fixture)
    expect(screen.getByText("hqForm.titleRevise")).toBeInTheDocument();
  });
});

describe("HQSR-005 — revision banner (HQSR-EDIT-REV-02…05)", () => {
  it("HQSR-EDIT-REV-02: revision banner shown for a returned-for-revision draft", () => {
    renderForm(existingReport);
    expect(screen.getByText(/returned for revision/i)).toBeInTheDocument();
  });

  it("no revision banner when the draft has no revision history", () => {
    renderForm({ ...(existingReport as unknown as Record<string, unknown>), approvalHistory: [] } as unknown as ExistingHqsrReport);
    expect(screen.queryByText(/returned for revision/i)).not.toBeInTheDocument();
  });

  it("HQSR-EDIT-REV-03: reviewer comments fetched and displayed for the returned draft", async () => {
    renderForm(existingReport);
    await waitFor(() =>
      expect(fetchCalls.some((c) => c.url.includes("/api/comments?entityType=report&entityId=88"))).toBe(true));
    // The reviewer's comment body from the real contract shape is rendered.
    expect(await screen.findByText(/expand the quality assessment/i)).toBeInTheDocument();
  });

  it("comments GET returning 403 does not crash the form; banner still visible", async () => {
    commentsStatus = 403;
    renderForm(existingReport);
    await waitForHydration();
    expect(screen.getByText(/returned for revision/i)).toBeInTheDocument();
    expect(screen.queryByText(/expand the quality assessment/i)).not.toBeInTheDocument();
  });

  it("HQSR-EDIT-REV-04/05: content editable while identity stays locked", async () => {
    renderForm(existingReport);
    await waitForHydration();
    const field = screen.getByDisplayValue("Procure solar fridges");
    fireEvent.change(field, { target: { value: "Procure solar fridges urgently" } });
    expect(screen.getByDisplayValue("Procure solar fridges urgently")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Health")).toHaveAttribute("readonly");
  });
});
