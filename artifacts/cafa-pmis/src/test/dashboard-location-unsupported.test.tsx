import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.hasPointerCapture = originalHasPointerCapture;
  Element.prototype.setPointerCapture = originalSetPointerCapture;
  Element.prototype.releasePointerCapture = originalReleasePointerCapture;
});

const dashboardState = vi.hoisted(() => ({
  location: 7 as number | null, summaryError: false, fetching: false,
  language: "en", statePerformanceArgs: undefined as unknown,
  summary: undefined as { totalProjects: number } | undefined,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "queryState.unsupported": "This metric does not support the current filters.",
      "queryState.unsupportedDescription": "Clear the selected location, sector, donor, or date filters before viewing this dashboard panel.",
      "queryState.unavailable": dashboardState.language === "ar" ? "بيانات لوحة التحكم غير متاحة" : "Dashboard data is unavailable",
      "queryState.loadFailedDescription": "Current results could not be loaded. Values are not shown as zero.",
      "queryState.retry": "Try again",
      "queryState.refreshing": dashboardState.language === "ar" ? "جارٍ تحديث بيانات لوحة التحكم" : "Dashboard data is refreshing",
    } as Record<string, string>)[key] ?? key,
    i18n: { language: dashboardState.language, dir: () => dashboardState.language === "ar" ? "rtl" : "ltr" },
  }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined, isError: false, isLoading: false, refetch: vi.fn() }) }));
vi.mock("@/contexts/location-context", () => ({ useLocationContext: () => ({ selectedStateId: dashboardState.location }) }));
vi.mock("@workspace/api-client-react", () => {
  const query = () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
  return {
    useGetMe: () => ({ data: { user: { role: "program_manager" } } }),
    useGetDashboardSummary: () => ({ data: dashboardState.fetching ? { byStatus: [] } : dashboardState.summary, isLoading: false, isFetching: dashboardState.fetching, isError: dashboardState.summaryError, error: dashboardState.summaryError ? new Error("network") : undefined, refetch: vi.fn() }),
    useGetStatePerformance: (params: unknown) => {
      dashboardState.statePerformanceArgs = params;
      return query();
    },
    useGetSectorPerformance: query,
    useGetPendingApprovals: query, useGetReportsSummary: query, useGetBeneficiariesBreakdown: query,
    useGetDashboardAttentionProjects: query, useGetDashboardLateReports: query, useListProjects: query,
    useListPlans: query, useListReports: query, useGetDashboardNotificationsSummary: query,
    useGetDashboardAgenda: query,
    useListDonors: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
    customFetch: vi.fn(),
    getGetDonorPortfolioQueryKey: () => ["donor"], getGetDashboardSummaryQueryKey: () => ["summary"],
    getGetSectorPerformanceQueryKey: () => ["sector"], getGetProjectBudgetPerformanceQueryKey: () => ["budget"],
  };
});

import Dashboard from "../pages/dashboard";

describe("Dashboard HQ location filter safety", () => {
  afterEach(() => {
    dashboardState.location = 7;
    dashboardState.summaryError = false;
    dashboardState.fetching = false;
    dashboardState.language = "en";
    dashboardState.statePerformanceArgs = undefined;
    dashboardState.summary = undefined;
  });

  it("withholds prior KPI values when an HQ selected location is unsupported", () => {
    render(<Dashboard />);
    expect(screen.getByText("This metric does not support the current filters.")).toBeInTheDocument();
    expect(screen.getByText(/selected location, sector, donor, or date filters/i)).toBeInTheDocument();
    expect(screen.queryByText("kpi.totalProjects")).not.toBeInTheDocument();
  });
  it("withholds current KPI and secondary facts when a sector filter would mix populations", async () => {
    dashboardState.location = null;
    dashboardState.summary = { totalProjects: 987 };
    render(<Dashboard />);
    expect(screen.getByText("987")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "filters.allSectors" }));
    await userEvent.click(await screen.findByRole("option", { name: "Education" }));

    expect(screen.getByText("This metric does not support the current filters.")).toBeInTheDocument();
    expect(screen.queryByText("987")).not.toBeInTheDocument();
    expect(screen.queryByText("kpi.totalProjects")).not.toBeInTheDocument();
  });
  it("sends only the supported location and sector contract to state performance", () => {
    dashboardState.location = 7;
    render(<Dashboard />);
    expect(dashboardState.statePerformanceArgs).toEqual({ stateId: 7 });
    expect(dashboardState.statePerformanceArgs).not.toHaveProperty("donor");
    expect(dashboardState.statePerformanceArgs).not.toHaveProperty("dateFrom");
    expect(dashboardState.statePerformanceArgs).not.toHaveProperty("dateTo");
  });
  it.each([
    ["en", "Dashboard data is unavailable"],
    ["ar", "بيانات لوحة التحكم غير متاحة"],
  ])("renders translated %s network unavailability", (language, expected) => {
    dashboardState.location = null; dashboardState.summaryError = true; dashboardState.language = language;
    render(<div dir={language === "ar" ? "rtl" : "ltr"}><Dashboard /></div>);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
  it("announces a same-context refresh accessibly", () => {
    dashboardState.location = null; dashboardState.fetching = true; dashboardState.summaryError = false; dashboardState.language = "en";
    render(<Dashboard />);
    expect(screen.getByText("Dashboard data is refreshing").closest("[role=status]")).toBeInTheDocument();
  });
});