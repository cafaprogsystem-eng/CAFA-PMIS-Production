/**
 * SPR-008 — State Programme Report duplicate-check UX (frontend).
 *
 * Renders the real ProgramStateReportForm in create mode and verifies:
 *  - SPR-DUP-FE-01: identity complete → debounced duplicate-check network call
 *  - SPR-DUP-FE-02: identity incomplete (no state) → no network call
 *  - SPR-DUP-FE-03/04: duplicate found → warning renders with period + status
 *  - SPR-DUP-FE-05: existing draft → "Continue Editing Existing Draft" button
 *  - SPR-DUP-FE-06: existing submitted → no edit button, factual message only
 *  - SPR-DUP-FE-07: edit mode → no duplicate-check fired at all
 *  - SPR-DUP-FE-08: backend 409 duplicate_report_period → friendly toast message
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import "@testing-library/jest-dom";

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
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "stateForm.duplicateDetected": "Duplicate Report Detected",
        "stateForm.continueEditingDraft": "Continue Editing Existing Draft",
        "status.submitted": "submitted",
        "status.draft": "draft",
      };
      if (key === "stateForm.duplicateDescription") {
        return `A State Programme Report already exists for this State and reporting period (${opts?.period} — ${opts?.status}).`;
      }
      return map[key] ?? (typeof opts === "string" ? opts : key);
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const { createMutateAsync, transitionMutateAsync, meHolder, toastError } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(async () => ({ id: 999 })),
  transitionMutateAsync: vi.fn(async () => ({})),
  meHolder: { user: { id: 21, name: "SPO User", role: "state_program_officer", stateId: 1 } as Record<string, unknown> },
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@workspace/api-client-react", () => {
  const stable = <T,>(data: T) => {
    const res = { data, isLoading: false, isError: false, isPending: false, refetch: () => {} };
    return () => res;
  };
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

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
let dupResponse: unknown = { matchType: "none" };

beforeEach(() => {
  fetchCalls.length = 0;
  dupResponse = { matchType: "none" };
  createMutateAsync.mockClear();
  toastError.mockClear();
  meHolder.user = { id: 21, name: "SPO User", role: "state_program_officer", stateId: 1 };
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).includes("/duplicate-check")) {
      return { ok: true, json: async () => dupResponse } as never;
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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProgramStateReportForm, friendlyCreateError, type ExistingSprReport } from "../components/program-state-report-form";

function renderForm(props: React.ComponentProps<typeof ProgramStateReportForm>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProgramStateReportForm {...props} />
    </QueryClientProvider>,
  );
}

const dupCalls = () => fetchCalls.filter((c) => c.url.includes("/duplicate-check"));

const existingDraft = {
  id: 55,
  title: "Khartoum — Monthly Programme Report — June 2026",
  status: "draft",
  reportType: "program_state",
  kind: "monthly",
  stateId: 1,
  period: "2026-06",
  reportingMonth: 6,
  reportingYear: 2026,
  sections: { frequency: "monthly" },
  activities: [],
  approvalHistory: [],
} as unknown as ExistingSprReport;

describe("SPR-008 — duplicate check firing", () => {
  it("SPR-DUP-FE-01: identity complete (SPO auto-state + default monthly period) → check fires", async () => {
    renderForm({ onClose: () => {} });
    await waitFor(() => expect(dupCalls().length).toBeGreaterThan(0), { timeout: 3000 });
    const url = new URL(dupCalls()[0].url, "http://localhost");
    expect(url.searchParams.get("reportType")).toBe("program_state");
    expect(url.searchParams.get("stateId")).toBe("1");
    expect(url.searchParams.get("frequency")).toBe("monthly");
    expect(url.searchParams.get("period")).toMatch(/^\d{4}-\d{2}$/);
  });

  it("SPR-DUP-FE-02: identity incomplete (super_admin, no state selected) → no check", async () => {
    meHolder.user = { id: 30, name: "Admin", role: "super_admin", stateId: null };
    renderForm({ onClose: () => {} });
    await new Promise((r) => setTimeout(r, 700));
    expect(dupCalls().length).toBe(0);
  });

  it("SPR-DUP-FE-07: edit mode → no duplicate check fired at all", async () => {
    renderForm({ onClose: () => {}, existingReport: existingDraft });
    await new Promise((r) => setTimeout(r, 700));
    expect(dupCalls().length).toBe(0);
  });
});

describe("SPR-008 — duplicate warning UI", () => {
  it("SPR-DUP-FE-03/04: duplicate found → alert renders with period and status context", async () => {
    dupResponse = { matchType: "exact", existingReport: { id: 55, title: "Existing", period: "2026-06", status: "submitted" } };
    renderForm({ onClose: () => {} });
    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert).toHaveTextContent("Duplicate Report Detected");
    expect(alert).toHaveTextContent("2026-06");
    expect(alert).toHaveTextContent("submitted");
  });

  it("SPR-DUP-FE-05: existing draft → Continue Editing button calls onOpenExistingDraft", async () => {
    dupResponse = { matchType: "exact", existingReport: { id: 55, title: "Existing", period: "2026-06", status: "draft" } };
    const onOpen = vi.fn();
    renderForm({ onClose: () => {}, onOpenExistingDraft: onOpen });
    const btn = await screen.findByRole("button", { name: /continue editing existing draft/i }, { timeout: 3000 });
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith(55);
  });

  it("SPR-DUP-FE-06: existing submitted → factual message, no edit button", async () => {
    dupResponse = { matchType: "exact", existingReport: { id: 55, title: "Existing", period: "2026-06", status: "submitted" } };
    renderForm({ onClose: () => {}, onOpenExistingDraft: vi.fn() });
    await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: /continue editing existing draft/i })).not.toBeInTheDocument();
  });
});

describe("SPR-008 — friendly 409 handling", () => {
  it("SPR-DUP-FE-08: backend race 409 duplicate_report_period → friendly message", () => {
    const msg = friendlyCreateError(new Error('409: {"error":"duplicate_report_period"}'));
    expect(msg).toContain("already exists for this State and reporting period");
  });

  it("existing mappings unchanged", () => {
    expect(friendlyCreateError(new Error("program_state_spo_available"))).toContain("State Programme Officer");
    expect(friendlyCreateError(new Error("state_required_for_super_admin_spr"))).toContain("select a State");
    expect(friendlyCreateError(new Error("something else"))).toBe("something else");
  });
});
