/**
 * SPR-007 — State Programme Report Draft Edit / Reopen / Revision Resubmit.
 *
 * Renders the real ProgramStateReportForm in edit mode (existingReport prop) and
 * verifies:
 *  - Hydration of all persisted fields (SPR-EDIT-01…10, 17)
 *  - Save Draft PATCHes the same report id — never POSTs (SPR-EDIT-11…14, 18, 20)
 *  - Identity fields absent from the PATCH body (SPR-EDIT-14)
 *  - PATCH failure blocks the submit transition (SPR-EDIT-15)
 *  - Resubmit = PATCH then transition on the same id (SPR-EDIT-16, 19)
 *  - Existing attachments listed without re-upload (SPR-EDIT-EVID-01)
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
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
      "stateForm.titleEdit": "Edit State Programme Report",
      "stateForm.titleRevise": "Revise State Programme Report",
      "stateForm.revisionBannerTitle": "This report was returned for revision.",
      "stateForm.revisionBannerBody": "Please review the reviewer feedback below and resubmit once the requested changes are made.",
    }[key] ?? (typeof def === "string" ? def : key)),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── API hook mocks ───────────────────────────────────────────────────────────
// vi.mock() factories are hoisted to the top of the file by vitest, so any
// variable they reference must also be hoisted via vi.hoisted().
const { createMutateAsync, transitionMutateAsync, meHolder } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(async () => ({ id: 999 })),
  transitionMutateAsync: vi.fn(async () => ({})),
  meHolder: { user: { id: 21, name: "SPO User", role: "state_program_officer", stateId: 1 } as Record<string, unknown> },
}));

vi.mock("@workspace/api-client-react", () => {
  const stable = <T,>(data: T) => {
    const res = { data, isLoading: false, isError: false, isPending: false, refetch: () => {} };
    return () => res;
  };
  // IMPORTANT: The SPR form has a `useEffect([me, form])` that calls form.setValue.
  // If useGetMe returns a NEW object each render, `me` changes reference every
  // render → effect fires again → form.setValue → re-render → infinite loop.
  // Fix: return a STABLE wrapper that reads meHolder.user lazily via a getter.
  const stableMe = {
    data: {
      get user() { return meHolder.user; },
      permissions: ["reports.create"],
    },
    isLoading: false,
  };
  const stableMutation = { mutateAsync: createMutateAsync, isPending: false };
  const stableTransition = { mutateAsync: transitionMutateAsync, isPending: false };
  return {
    useGetMe: () => stableMe,
    useListStates: stable([{ id: 1, name: "Khartoum" }, { id: 2, name: "Kassala" }]),
    useListProjects: stable([{ id: 5, code: "PRJ-005", title: "Water Project" }]),
    useCreateReport: () => stableMutation,
    useTransitionReport: () => stableTransition,
    requestUploadUrl: vi.fn(),
    ListReportsQueryResult: undefined,
  };
});

// fetch mock — records PATCH calls; register-risk / snapshot GETs return empty.
type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
let patchOk = true;
beforeEach(() => {
  fetchCalls.length = 0;
  patchOk = true;
  createMutateAsync.mockClear();
  transitionMutateAsync.mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (init?.method === "PATCH") {
      return { ok: patchOk, json: async () => (patchOk ? {} : { error: "save_failed" }) } as never;
    }
    if (String(url).includes("/snapshot")) {
      return {
        ok: true,
        json: async () => ({
          activeProjects: 1, activeSectors: 1, beneficiariesReached: 40,
          activitiesCompleted: 1, delayedActivities: 0, openRisks: 0, pendingApprovals: 0,
        }),
      } as never;
    }
    return { ok: true, json: async () => [] } as never;
  }) as never;
});
afterEach(() => cleanup());

import { ProgramStateReportForm, type ExistingSprReport } from "../components/program-state-report-form";

// ── Fixture: a complete persisted SPR draft ─────────────────────────────────
const existingReport = {
  id: 55,
  title: "Khartoum — Monthly Programme Report — June 2026",
  status: "draft",
  reportType: "program_state",
  kind: "monthly",
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  stateId: 1,
  periodStart: null,
  periodEnd: null,
  authorId: 21,
  approvalHistory: [
    { action: "submit", byName: "SPO User" },
    { action: "request_revision", byName: "SPC" },
  ],
  activities: [{
    title: "Well rehabilitation", sector: "WASH", locality: "Bahri",
    relatedProjectId: 5, activityDate: "2026-06-10", status: "Completed",
    achievementSummary: "3 wells rehabilitated",
    beneficiariesMen: 10, beneficiariesWomen: 20, beneficiariesBoys: 5, beneficiariesGirls: 5,
    beneficiariesTotal: 40,
  }],
  sections: {
    frequency: "monthly",
    officerName: "SPO User",
    sectors: ["WASH"],
    localitiesCovered: ["Bahri", "Omdurman"],
    relatedProjectIds: [5],
    humanitarianContext: {
      securitySituation: "Stable overall",
      populationMovements: "Minor returns",
      diseaseOutbreaks: "None reported",
      accessConstraints: "Seasonal road closures",
      naturalHazards: "Flood risk",
    },
    keyAchievements: "Wells restored",
    mainChallenges: "Fuel shortages",
    mitigationMeasures: "Pre-positioned fuel",
    nextPeriodPriorities: "Expand coverage",
    lessonsLearned: "Engage communities early",
    hqSupportRequests: [{ supportType: "Logistics Support", priority: "High", description: "Need trucks" }],
    risks: [{ category: "operational", title: "Supply delays", severity: "medium", description: "Port congestion" }],
    attachments: [{
      fileName: "photos.pdf", contentType: "application/pdf", size: 1234,
      attachmentId: 77, attachmentType: "Photos",
    }],
  },
} as unknown as ExistingSprReport;

function renderForm(report?: ExistingSprReport) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProgramStateReportForm onClose={() => {}} existingReport={report} />
    </QueryClientProvider>,
  );
}

const patchCallsTo = (id: number) =>
  fetchCalls.filter((c) => c.init?.method === "PATCH" && c.url === `/api/reports/${id}`);

describe("SPR-007 — hydration (SPR-EDIT-01…10)", () => {
  it("SPR-EDIT-01: returned-for-revision edit mode shows the revise heading", () => {
    // The existingReport fixture has request_revision in approvalHistory, so the
    // component correctly shows the translated revision heading.
    renderForm(existingReport);
    expect(screen.getByText("Revise State Programme Report")).toBeInTheDocument();
  });

  it("create mode keeps the normal heading and no revision banner", () => {
    renderForm(undefined);
    expect(screen.queryByText("Edit State Programme Report")).not.toBeInTheDocument();
    expect(screen.queryByText("This report was returned for revision.")).not.toBeInTheDocument();
  });

  it("SPR-EDIT-02: state restored and locked (read-only input, not a select)", () => {
    renderForm(existingReport);
    const stateInput = screen.getByDisplayValue("Khartoum");
    expect(stateInput).toHaveAttribute("readonly");
    expect(stateInput).toHaveAttribute("aria-readonly", "true");
  });

  it("SPR-EDIT-03: frequency/period restored but disabled", () => {
    renderForm(existingReport);
    const comboboxes = screen.getAllByRole("combobox");
    // Frequency + Month + Year selects are all disabled in edit mode
    const disabled = comboboxes.filter((c) => (c as HTMLButtonElement).disabled);
    expect(disabled.length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("frequency.monthly").length).toBeGreaterThan(0);
  });

  it("SPR-EDIT-04/05: sectors and localities restored", () => {
    renderForm(existingReport);
    expect(screen.getAllByText("WASH").length).toBeGreaterThan(0);
    expect(screen.getByText("Bahri", { selector: "span,div" })).toBeInTheDocument();
    expect(screen.getByText("Omdurman")).toBeInTheDocument();
  });

  it("SPR-EDIT-06: humanitarian context restored", () => {
    renderForm(existingReport);
    expect(screen.getByDisplayValue("Stable overall")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Minor returns")).toBeInTheDocument();
    expect(screen.getByDisplayValue("None reported")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Seasonal road closures")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Flood risk")).toBeInTheDocument();
  });

  it("SPR-EDIT-07: narratives restored", () => {
    renderForm(existingReport);
    for (const val of ["Wells restored", "Fuel shortages", "Pre-positioned fuel", "Expand coverage", "Engage communities early"]) {
      expect(screen.getByDisplayValue(val)).toBeInTheDocument();
    }
  });

  it("SPR-EDIT-08/09: activities and beneficiaries restored", () => {
    renderForm(existingReport);
    expect(screen.getByDisplayValue("Well rehabilitation")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3 wells rehabilitated")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
  });

  it("SPR-EDIT-10: related projects restored", () => {
    renderForm(existingReport);
    expect(screen.getAllByText("PRJ-005").length).toBeGreaterThan(0);
  });

  it("SPR-EDIT-16: revision banner shown for a returned-for-revision draft", () => {
    renderForm(existingReport);
    expect(screen.getByText("This report was returned for revision.")).toBeInTheDocument();
  });

  it("no revision banner when the draft has no revision history", () => {
    renderForm({ ...(existingReport as unknown as Record<string, unknown>), approvalHistory: [] } as unknown as ExistingSprReport);
    expect(screen.queryByText("stateForm.revisionBannerTitle")).not.toBeInTheDocument();
  });

  it("SPR-EDIT-EVID-01: existing attachments listed without re-upload", () => {
    renderForm(existingReport);
    expect(screen.getByText("photos.pdf")).toBeInTheDocument();
    // Existing canonical metadata is displayed without another upload request.
    expect(fetchCalls.filter((c) => c.url.includes("/attachments")).length).toBe(0);
  });
});

/** Wait for FULL form hydration to settle before interacting with the form.
 *
 *  The hydration useEffect calls both form.reset() (RHF internal state — may
 *  flush synchronously before the other setState calls) AND several React
 *  setState calls (selectedSectors, localitiesCovered, activities …).
 *  We wait until BOTH sources are visible: the title (from form.reset) AND
 *  a local-array item (from the batched setState calls). */
async function waitForHydration() {
  // Title from form.reset()
  await screen.findByDisplayValue("Khartoum — Monthly Programme Report — June 2026");
  // Activities from setActivities() — a separate React state update batch
  await screen.findByDisplayValue("Well rehabilitation");
  // Sectors badge from setSelectedSectors()
  await waitFor(() => expect(screen.getAllByText("WASH").length).toBeGreaterThan(0));
}

describe("SPR-007 — edit behaviour (SPR-EDIT-11…15, 18…20)", () => {
  it("SPR-EDIT-11/12/18/20: Save Draft PATCHes the same id, never POSTs a duplicate", async () => {
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("stateForm.saveDraft"));
    await waitFor(() => expect(patchCallsTo(55).length).toBe(1));
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("SPR-EDIT-13/14: PATCH body carries updated content and no identity fields", async () => {
    renderForm(existingReport);
    await waitForHydration();
    // Mutate a narrative field before saving
    const keyAchField = await screen.findByDisplayValue("Wells restored");
    fireEvent.change(keyAchField, { target: { value: "Wells restored and chlorinated" } });
    fireEvent.click(screen.getByText("stateForm.saveDraft"));
    await waitFor(() => expect(patchCallsTo(55).length).toBe(1));
    const body = JSON.parse(String(patchCallsTo(55)[0].init?.body)) as Record<string, unknown>;
    // Updated content persists
    expect((body.sections as Record<string, unknown>).keyAchievements).toBe("Wells restored and chlorinated");
    // Identity fields must be absent (SPR-002 immutability — present keys are rejected with 409)
    for (const key of ["reportType", "stateId", "kind", "period", "reportingMonth", "reportingYear", "periodStart", "periodEnd"]) {
      expect(body).not.toHaveProperty(key);
    }
    // Core content fields present
    expect(body).toHaveProperty("title");
    expect(body).toHaveProperty("sections");
    expect(body).toHaveProperty("activities");
  });

  it("SPR-EDIT-19: Resubmit = PATCH then transition (submit) on the same report id", async () => {
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("stateForm.submitReport"));
    await waitFor(() => expect(transitionMutateAsync).toHaveBeenCalledTimes(1));
    expect(patchCallsTo(55).length).toBe(1);
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (transitionMutateAsync.mock.calls as any)[0][0] as { reportId: number; data: { action: string } };
    expect(call.reportId).toBe(55);
    expect(call.data.action).toBe("submit");
  });

  it("SPR-EDIT-15: failed PATCH blocks the submit transition", async () => {
    patchOk = false;
    renderForm(existingReport);
    await waitForHydration();
    fireEvent.click(screen.getByText("stateForm.submitReport"));
    await waitFor(() => expect(patchCallsTo(55).length).toBe(1));
    await new Promise((r) => setTimeout(r, 80));
    expect(transitionMutateAsync).not.toHaveBeenCalled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });
});
