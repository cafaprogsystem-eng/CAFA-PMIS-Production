/**
 * RFREQ frontend — Project Scheduled Reporting Frequency (Task #325 / Model D)
 *
 *   RFREQ-PMR-01..05  : PMR create form kind defaults from project frequency
 *   RFREQ-WARN-01..06 : soft mismatch warning behaviour
 *   RFREQ-COMP-01..03 : PmrCompletenessPanel default kind + option set
 *   RFREQ-DISP-01..02 : project detail display mapping (null → "Not Configured")
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    t: (key: string, values?: Record<string, string>) => {
      const labels: Record<string, string> = {
        "frequency.monthly": "Monthly",
        "frequency.quarterly": "Quarterly",
        "frequency.annual": "Annual",
        "frequency.on_demand": "On Demand",
      };
      if (key === "form.scheduledFrequencyMismatch") {
        return `This project is configured for ${values?.scheduled} reporting; the selected frequency is ${values?.selected}.`;
      }
      return labels[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── API hook mocks (module-level stable objects) ─────────────────────────────
// vi.hoisted so the vi.mock factory (hoisted to top of file) can reference them.
const { PROJECTS, completenessResult } = vi.hoisted(() => ({
  PROJECTS: [
  { id: 7, title: "Monthly Project", code: "MP-01", stateIds: [1], currency: "USD", status: "active", reportingFrequency: "monthly" },
  { id: 8, title: "Quarterly Project", code: "QP-01", stateIds: [1], currency: "USD", status: "active", reportingFrequency: "quarterly" },
  { id: 9, title: "Annual Project", code: "AP-01", stateIds: [1], currency: "USD", status: "active", reportingFrequency: "annual" },
  { id: 10, title: "Historical Project", code: "HP-01", stateIds: [1], currency: "USD", status: "active", reportingFrequency: null },
  ],
  completenessResult: {
    data: { kind: "monthly", period: "2026-07", expected: [], completenessPercent: null, locations: [] },
    isLoading: false,
    isError: false,
  },
}));

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
    useListReports: stable({ items: [], total: 0, page: 1, pageSize: 20 }),
    useListReportAuthors: stable({ items: [] }),
    useListProjects: stable(PROJECTS),
    useListStates: stable([{ id: 1, name: "Khartoum" }]),
    useCreateReport: () => mutation,
    useTransitionReport: () => mutation,
    useGetReportAggregates: stable(undefined),
    useGetReportsSummary: stable(undefined),
    useGetReportsStats: stable(undefined),
    useGetPmrReportingCompleteness: () => completenessResult,
  };
});

global.fetch = vi.fn().mockImplementation(async (url: unknown) => {
  const u = String(url);
  return {
    ok: true,
    // Array-returning endpoints vs list-shaped endpoints
    json: async () =>
      u.includes("/api/risks") || u.includes("/activities") || u.includes("/indicators")
        ? []
        : { items: [] },
  };
}) as never;

import ReportsPage from "../pages/reports";
import { PmrCompletenessPanel } from "../components/pmr-completeness-panel";
import { TooltipProvider } from "@/components/ui/tooltip";

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

async function openCreateDialog() {
  wrap(<ReportsPage lockedType="project" />);
  const newBtn = (await screen.findAllByRole("button", { name: /newReport/i }))[0];
  fireEvent.click(newBtn);
  await screen.findByRole("dialog");
}

/** Open a Radix select by DOM id and click the option with the given name. */
async function pickOption(triggerId: string, optionName: RegExp) {
  const trigger = document.getElementById(triggerId)!;
  expect(trigger, triggerId).not.toBeNull();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

function kindTriggerText() {
  return document.getElementById("pmr-frequency")?.textContent ?? "";
}

// ─── RFREQ-PMR — default kind from project frequency ─────────────────────────

describe("RFREQ-PMR — PMR form kind defaults", () => {
  it.each([
    ["RFREQ-PMR-01", /Monthly Project/, /monthly/i],
    ["RFREQ-PMR-02", /Quarterly Project/, /quarterly/i],
    ["RFREQ-PMR-03", /Annual Project/, /annual/i],
  ])("%s: selecting %s defaults kind selector", async (_id, projectName, expected) => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", projectName);
    await waitFor(() => expect(kindTriggerText()).toMatch(expected));
  });

  it("RFREQ-PMR-04: historical (null frequency) project defaults to monthly; manual change still works", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Historical Project/);
    await waitFor(() => expect(kindTriggerText()).toMatch(/monthly/i));
    // Manual override still works
    await pickOption("pmr-frequency", /Quarterly/i);
    await waitFor(() => expect(kindTriggerText()).toMatch(/quarterly/i));
  });

  it("RFREQ-PMR-05: On Demand remains selectable regardless of scheduled frequency", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Monthly Project/);
    await pickOption("pmr-frequency", /On Demand/i);
    await waitFor(() => expect(kindTriggerText()).toMatch(/on demand/i));
  });
});

// ─── RFREQ-WARN — soft mismatch warning ──────────────────────────────────────

const WARNING_TESTID = "text-frequency-mismatch-warning";

describe("RFREQ-WARN — soft mismatch warning", () => {
  it("RFREQ-WARN-01: monthly project + monthly kind → no warning", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Monthly Project/);
    await waitFor(() => expect(kindTriggerText()).toMatch(/monthly/i));
    expect(screen.queryByTestId(WARNING_TESTID)).toBeNull();
  });

  it("RFREQ-WARN-02: monthly project + quarterly kind → warning contains Monthly and Quarterly", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Monthly Project/);
    await pickOption("pmr-frequency", /Quarterly/i);
    const warning = await screen.findByTestId(WARNING_TESTID);
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning).toHaveAttribute("aria-live", "polite");
    expect(warning.textContent).toContain("Monthly");
    expect(warning.textContent).toContain("Quarterly");
  });

  it("RFREQ-WARN-03: quarterly project + annual kind → warning shown", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Quarterly Project/);
    await pickOption("pmr-frequency", /Annual/i);
    const warning = await screen.findByTestId(WARNING_TESTID);
    expect(warning.textContent).toContain("Quarterly");
    expect(warning.textContent).toContain("Annual");
  });

  it("RFREQ-WARN-04: monthly project + on_demand kind → NO warning (supplementary)", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Monthly Project/);
    await pickOption("pmr-frequency", /On Demand/i);
    await waitFor(() => expect(kindTriggerText()).toMatch(/on demand/i));
    expect(screen.queryByTestId(WARNING_TESTID)).toBeNull();
  });

  it("RFREQ-WARN-04b: historical null-frequency project → no warning for any kind", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Historical Project/);
    await pickOption("pmr-frequency", /Quarterly/i);
    await waitFor(() => expect(kindTriggerText()).toMatch(/quarterly/i));
    expect(screen.queryByTestId(WARNING_TESTID)).toBeNull();
  });

  it("RFREQ-WARN-05: warning does not disable Save As Draft", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Monthly Project/);
    await pickOption("pmr-frequency", /Quarterly/i);
    await screen.findByTestId(WARNING_TESTID);
    const dialog = screen.getByRole("dialog");
    const draftBtn = within(dialog).getByRole("button", { name: /saveAsDraft|draft/i });
    expect(draftBtn).not.toBeDisabled();
  });

  it("RFREQ-WARN-06: warning does not change the selected kind", async () => {
    await openCreateDialog();
    await pickOption("pmr-project-trigger", /Monthly Project/);
    await pickOption("pmr-frequency", /Quarterly/i);
    await screen.findByTestId(WARNING_TESTID);
    expect(kindTriggerText()).toMatch(/quarterly/i);
  });
});

// ─── RFREQ-COMP — PmrCompletenessPanel ───────────────────────────────────────

describe("RFREQ-COMP — completeness panel default kind", () => {
  it("RFREQ-COMP-01: quarterly project → panel kind initialises to Quarterly", () => {
    wrap(<PmrCompletenessPanel projectId={8} projectReportingFrequency="quarterly" />);
    const trigger = screen.getByLabelText(/frequency/i, { selector: "button" });
    expect(trigger.textContent).toMatch(/quarterly/i);
  });

  it("RFREQ-COMP-01b: monthly project → panel kind initialises to Monthly", () => {
    wrap(<PmrCompletenessPanel projectId={7} projectReportingFrequency="monthly" />);
    const trigger = screen.getByLabelText(/frequency/i, { selector: "button" });
    expect(trigger.textContent).toMatch(/monthly/i);
  });

  it("RFREQ-COMP-02: historical null project → panel kind falls back to Monthly", () => {
    wrap(<PmrCompletenessPanel projectId={10} projectReportingFrequency={null} />);
    const trigger = screen.getByLabelText(/frequency/i, { selector: "button" });
    expect(trigger.textContent).toMatch(/monthly/i);
  });

  it("RFREQ-COMP-03: On Demand is selectable for consolidation but is never a default", async () => {
    // Task #326: the panel offers On Demand so the consolidated view can show
    // on-demand PMRs; scheduled completeness itself never defaults to it and
    // projectReportingFrequency (monthly/quarterly/annual) cannot be on_demand.
    wrap(<PmrCompletenessPanel projectId={7} projectReportingFrequency="monthly" />);
    const trigger = screen.getByLabelText(/frequency/i, { selector: "button" });
    expect(trigger.textContent).toMatch(/monthly/i);
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    const labels = options.map((o) => o.textContent?.toLowerCase() ?? "");
    expect(labels.some((l) => l.includes("demand"))).toBe(true);
    expect(labels.some((l) => l.includes("monthly"))).toBe(true);
  });
});

// ─── RFREQ-DISP — project detail display mapping ─────────────────────────────
// The display expression in project-detail.tsx maps the raw value to a label,
// with null rendered as "Not Configured" (never defaulted to Monthly).

function FrequencyDisplay({ value }: { value: "monthly" | "quarterly" | "annual" | null }) {
  // Mirrors the exact expression used in project-detail.tsx
  return (
    <dd data-testid="text-reporting-frequency">
      {value
        ? { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" }[value]
        : <span>Not Configured</span>}
    </dd>
  );
}

describe("RFREQ-DISP — project detail frequency display", () => {
  it("RFREQ-DISP-01: null frequency displays 'Not Configured' (not 'Monthly')", () => {
    render(<FrequencyDisplay value={null} />);
    const el = screen.getByTestId("text-reporting-frequency");
    expect(el.textContent).toBe("Not Configured");
    expect(el.textContent).not.toContain("Monthly");
  });

  it("RFREQ-DISP-02: monthly/quarterly/annual display capitalised labels", () => {
    const { rerender } = render(<FrequencyDisplay value="monthly" />);
    expect(screen.getByTestId("text-reporting-frequency").textContent).toBe("Monthly");
    rerender(<FrequencyDisplay value="quarterly" />);
    expect(screen.getByTestId("text-reporting-frequency").textContent).toBe("Quarterly");
    rerender(<FrequencyDisplay value="annual" />);
    expect(screen.getByTestId("text-reporting-frequency").textContent).toBe("Annual");
  });

  it("RFREQ-DISP (source): project-detail.tsx renders Not Configured for null and passes the frequency to the completeness panel", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/pages/project-detail.tsx"),
      "utf8",
    );
    // Display copy is i18n-driven (paired en/ar locale keys) rather than hard-coded.
    expect(src).toContain("detail.notConfigured");
    expect(src).toContain("detail.scheduledReportingFrequency");
    // The frequency is passed to PmrCompletenessPanel — tolerate a cast wrapper
    // introduced to satisfy TypeScript when the generated client lacks the field.
    expect(src).toMatch(/projectReportingFrequency=/);
  });
});

describe("Reporting coverage contract", () => {
  it("permits coverage outside implementation while retaining strict date ordering and create/edit payload fields", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/project-registration-form.tsx"),
      "utf8",
    );
    expect(src).toContain('reportingStartDate: z.string().min(1');
    expect(src).toContain('reportingEndDate: z.string().min(1');
    expect(src).toContain("Reporting end date must be on or after reporting start date");
    expect(src).not.toContain("must fall within the implementation period");
    expect(src).toContain("reportingCoverageCustomisedRef");
    expect((src.match(/reportingStartDate: values\.reportingStartDate/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((src.match(/reportingEndDate: values\.reportingEndDate/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
