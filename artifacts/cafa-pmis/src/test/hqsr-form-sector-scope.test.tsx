/**
 * HQSR-001 rendered UI test — HQ Sector Report form sector scoping (FE-02).
 *
 * Renders the real HqSectorReportForm and asserts the Sector select options:
 *  - TC with assigned sector(s): only those sectors offered
 *  - TC with NO assigned sector: fail closed — zero sector options (never the
 *    full canonical fallback list)
 *  - super_admin: full canonical list
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SECTORS } from "../lib/sectors";

const i18nState = vi.hoisted(() => ({ language: "en" }));

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
    t: (key: string, def?: unknown) => {
      if (key === "hqForm.unavailable") {
        return i18nState.language === "ar" ? "غير متاح" : "Unavailable";
      }
      return typeof def === "string" ? def : key;
    },
    i18n: {
      language: i18nState.language,
      dir: () => i18nState.language === "ar" ? "rtl" : "ltr",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── API hook mocks — swappable current user via mutable holder ──────────────
const meHolder: { user: Record<string, unknown>; permissions: string[] } = {
  user: { id: 11, name: "TC", role: "technical_coordinator", sector: "WASH" },
  permissions: ["reports.create", "reports.view"],
};
vi.mock("@workspace/api-client-react", () => {
  const stable = <T,>(data: T) => {
    const res = { data, isLoading: false, isError: false, isPending: false, refetch: () => {} };
    return () => res;
  };
  const mutation = { mutateAsync: async () => ({ id: 1 }), isPending: false };
  return {
    useGetMe: () => ({ data: { user: meHolder.user, permissions: meHolder.permissions }, isLoading: false }),
    useListStates: stable([{ id: 1, name: "Khartoum" }]),
    useCreateReport: () => mutation,
    useTransitionReport: () => mutation,
    requestUploadUrl: vi.fn(),
  };
});

const unavailableSnapshot = {
  snapshot: {
    activeProjects: 1,
    activeStates: 1,
    activeLocalities: 1,
    activitiesImplemented: 1,
    beneficiariesReached: 1,
    indicatorProgressPct: null,
    delayedActivities: 0,
    openRisks: 0,
    pendingApprovals: 0,
  },
  stateSummaries: [],
  projectSummaries: [],
  beneficiaryBreakdown: { men: 0, women: 0, boys: 0, girls: 0 },
  beneficiaryByState: [],
  beneficiaryByProject: [],
  beneficiaryByDonor: [],
  indicators: [{
    name: "Evidence unavailable",
    target: null,
    achieved: null,
    progressPct: null,
    status: null,
  }],
};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
  ok: true,
  json: async () => String(input).includes("/dashboard/sector-snapshot")
    ? unavailableSnapshot
    : [],
}));
global.fetch = fetchMock as never;

import { HqSectorReportForm } from "../components/hq-sector-report-form";

function renderForm(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }), existingReport?: Record<string, unknown>) {
  return render(
    <QueryClientProvider client={qc}>
      <HqSectorReportForm onClose={() => {}} existingReport={existingReport as never} />
    </QueryClientProvider>,
  );
}

/** Opens the Sector select (first combobox in the form) and returns option texts. */
function openSectorOptions(): string[] {
  const triggers = screen.getAllByRole("combobox");
  fireEvent.click(triggers[0]);
  return screen.queryAllByRole("option").map((o) => o.textContent ?? "");
}

afterEach(() => {
  cleanup();
  fetchMock.mockClear();
  i18nState.language = "en";
});

describe("HQ Sector form — sector options scoping (HQSR-AUTH-FE-02)", () => {
  it("TC with a single assigned sector sees only that sector", () => {
    meHolder.user = { id: 11, name: "TC", role: "technical_coordinator", sector: "WASH" };
    renderForm();
    const opts = openSectorOptions();
    expect(opts).toEqual(["WASH"]);
  });

  it("multi-sector TC sees exactly the assigned sectors", () => {
    meHolder.user = { id: 12, name: "TC2", role: "technical_coordinator", sector: "WASH, Health" };
    renderForm();
    const opts = openSectorOptions();
    expect(opts.sort()).toEqual(["Health", "WASH"]);
  });

  it("TC with NO assigned sector fails closed — zero options, never the full list", () => {
    meHolder.user = { id: 13, name: "TC3", role: "technical_coordinator", sector: null };
    renderForm();
    const opts = openSectorOptions();
    expect(opts).toEqual([]);
  });

  it("super_admin sees the full canonical sector list", () => {
    meHolder.user = { id: 14, name: "Admin", role: "super_admin", sector: null };
    renderForm();
    const opts = openSectorOptions();
    expect(opts.sort()).toEqual([...SECTORS].sort());
  });

  it("does not reuse a former-sector snapshot after the same TC is re-scoped", async () => {
    meHolder.user = { id: 15, name: "TC", role: "technical_coordinator", sector: "WASH" };
    meHolder.permissions = ["reports.create", "reports.view"];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["sector-snapshot", "Health"], {
      snapshot: { activeProjects: 987654, activeStates: 1, activeLocalities: 1, activitiesImplemented: 1, beneficiariesReached: 1, indicatorProgressPct: 1, delayedActivities: 1, openRisks: 1, pendingApprovals: 1 },
      stateSummaries: [], projectSummaries: [], beneficiaryBreakdown: { men: 0, women: 0, boys: 0, girls: 0, total: 0 },
      beneficiariesByState: [], beneficiariesByProject: [], beneficiariesByDonor: [], indicators: [],
    });
    renderForm(qc, {
      id: 88, title: "Former Health report", status: "draft", reportType: "hq_sector",
      sector: "Health", kind: "monthly", period: "2026-08", reportingMonth: 8,
      reportingYear: 2026, sections: {},
    });
    await waitFor(() => expect(screen.queryByText("987654")).not.toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("sector-snapshot"), expect.anything());
  });

  it.each([
    ["en", "Unavailable"],
    ["ar", "غير متاح"],
  ])("renders unavailable snapshot evidence in %s without inventing 0%% or Off Track", async (language, unavailable) => {
    i18nState.language = language;
    meHolder.user = { id: 16, name: "TC", role: "technical_coordinator", sector: "WASH" };
    meHolder.permissions = ["reports.create", "reports.view"];

    renderForm(undefined, {
      id: 89,
      title: "WASH report",
      status: "draft",
      reportType: "hq_sector",
      sector: "WASH",
      kind: "monthly",
      period: "2026-08",
      reportingMonth: 8,
      reportingYear: 2026,
      sections: {},
    });

    await waitFor(() => expect(screen.getAllByText(unavailable)).toHaveLength(5));
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("Off Track")).not.toBeInTheDocument();
  });
});
