/**
 * Reports page ?open=<reportId> deep link — rendered tests.
 *
 * The PMR completeness panel and consolidated view link to
 * /reports/project?open=<id>. The page resolves the id through the authorised
 * single-report endpoint (GET /api/reports/:id), so the exact report opens
 * even when it is NOT on the current page of the list or is excluded by the
 * active filters. RBAC stays server-side: a 403/404 opens nothing.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown) => (typeof def === "string" ? def : key),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// The deep-link target is deliberately NOT in the mocked list — it must be
// resolved via GET /api/reports/:id, independent of pagination/filters.
const TARGET_REPORT = {
  id: 321,
  title: "July PMR — South Kordofan (deep link target)",
  reportType: "project",
  kind: "monthly",
  status: "submitted",
  period: "2026-07",
  reportingYear: 2026,
  reportingMonth: 7,
  quarter: null,
  projectId: 7,
  projectTitle: "Water Project",
  stateId: 1,
  stateName: "Khartoum",
  sector: "WASH",
  submittedAt: "2026-08-05T09:00:00.000Z",
  submittedById: 9,
  submittedByName: "SPO User",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-05T09:00:00.000Z",
  narrative: "Deep link narrative body",
  sections: {},
  activities: [],
  history: [],
};

const LIST_ONLY_REPORT = vi.hoisted(() => ({
  id: 500,
  title: "August PMR — first page filler",
  reportType: "project",
  kind: "monthly",
  status: "submitted",
  period: "2026-08",
  reportingYear: 2026,
  reportingMonth: 8,
  quarter: null,
  projectId: 7,
  projectTitle: "Water Project",
  stateId: 1,
  stateName: "Khartoum",
  sector: "WASH",
  submittedAt: "2026-09-05T09:00:00.000Z",
  submittedById: 9,
  submittedByName: "SPO User",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-05T09:00:00.000Z",
  narrative: "Filler narrative",
  sections: {},
  activities: [],
}));

// Module-level stable results — fresh objects per render cause effect loops.
vi.mock("@workspace/api-client-react", () => {
  const stable = <T,>(data: T) => {
    const res = { data, isLoading: false, isError: false, isPending: false, refetch: () => {} };
    return () => res;
  };
  const mutation = { mutateAsync: async () => ({ id: 1 }), isPending: false };
  return {
    useGetMe: stable({
      user: { id: 9, name: "SPO User", role: "state_program_officer", roleLabel: "State Program Officer", stateId: 1 },
      permissions: ["reports.view", "reports.create", "comments.view", "comments.create"],
    }),
    useListReports: stable({ items: [LIST_ONLY_REPORT], total: 26, page: 1, pageSize: 25 }),
    useListReportAuthors: stable({ items: [] }),
    useListProjects: stable([
      { id: 7, title: "Water Project", code: "WP-01", stateIds: [1, 2], currency: "USD", status: "active" },
    ]),
    useListStates: stable([{ id: 1, name: "Khartoum" }]),
    useCreateReport: () => mutation,
    useTransitionReport: () => mutation,
    useGetReportAggregates: stable(undefined),
    useGetReportsSummary: stable(undefined),
    useGetReportsStats: stable(undefined),
    useListVoiceNotes: stable([]),
    requestUploadUrl: async () => ({ uploadUrl: "", fileUrl: "" }),
  };
});

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

function installFetch() {
  fetchMock.mockImplementation(async (url: unknown) => {
    const u = String(url);
    if (/\/api\/reports\/321$/.test(u)) {
      return { ok: true, json: async () => TARGET_REPORT, headers: { get: () => null } };
    }
    if (/\/api\/reports\/\d+$/.test(u)) {
      return { ok: false, status: 404, json: async () => ({ error: "report not found" }), headers: { get: () => null } };
    }
    return {
      ok: true,
      json: async () => (u.includes("/comments") || u.includes("/attachments") ? [] : { items: [] }),
      headers: { get: () => null },
    };
  });
}

import ReportsPage from "../pages/reports";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ReportsPage lockedType="project" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  installFetch();
});

describe("Reports page ?open= deep link", () => {
  it("opens the exact report via the single-report endpoint even when absent from the visible list, then strips the param", async () => {
    window.history.replaceState({}, "", "/reports/project?open=321");
    renderPage();
    // Target is NOT in the list — it must come from GET /api/reports/321
    await waitFor(() => {
      expect(screen.getAllByText(/deep link target/).length).toBeGreaterThan(0);
    });
    expect(fetchMock.mock.calls.some(([u]) => /\/api\/reports\/321$/.test(String(u)))).toBe(true);
    expect(window.location.search).not.toContain("open=");
  });

  it("opens nothing for a nonexistent or inaccessible id (server 403/404)", async () => {
    window.history.replaceState({}, "", "/reports/project?open=999999");
    renderPage();
    await screen.findAllByText(/first page filler/); // list rendered
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => /\/api\/reports\/999999$/.test(String(u)))).toBe(true);
    });
    // No detail sheet — target title never appears, filler stays list-only
    expect(screen.queryByText(/deep link target/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/first page filler/).length).toBe(1);
    window.history.replaceState({}, "", "/reports/project");
  });

  it("ignores a malformed open param", async () => {
    window.history.replaceState({}, "", "/reports/project?open=abc");
    renderPage();
    await screen.findAllByText(/first page filler/);
    expect(fetchMock.mock.calls.some(([u]) => /\/api\/reports\/(abc|NaN)$/.test(String(u)))).toBe(false);
    window.history.replaceState({}, "", "/reports/project");
  });
});
