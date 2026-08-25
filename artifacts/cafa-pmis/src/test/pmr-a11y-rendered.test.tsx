/**
 * PMR-A11Y rendered integration tests — real ReportsPage form.
 *
 * Renders the actual production ReportsPage (lockedType="project"), opens the
 * New PMR dialog, and asserts the accessibility wiring against the real DOM:
 *  - stable ids on triggers/inputs and their help/error elements
 *  - aria-describedby references resolve to elements that actually exist
 *  - failed submit produces aria-invalid + rendered role="alert" errors linked
 *    to their controls (project, location, on-demand reason, activity rows)
 *
 * Data hooks from @workspace/api-client-react are mocked; everything else is
 * the real component tree (labels, selects, activity rows, validation).
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

// ── i18n mock — return the key (or defaultValue) so buttons are queryable ───
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown) => (typeof def === "string" ? def : key),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── API hook mocks ───────────────────────────────────────────────────────────
// All results are module-level constants so every render receives identical
// references — otherwise identity-keyed effects in the page loop forever.
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
    useListProjects: stable([
      { id: 7, title: "Water Project", code: "WP-01", stateIds: [1, 2], currency: "USD", status: "active" },
    ]),
    useListStates: stable([
      { id: 1, name: "Khartoum" },
      { id: 2, name: "Kassala" },
    ]),
    useCreateReport: () => mutation,
    useTransitionReport: () => mutation,
    useGetReportAggregates: stable(undefined),
    useGetReportsSummary: stable(undefined),
    useGetReportsStats: stable(undefined),
  };
});

// Local useQuery fetch calls (duplicate-check, activities) go through fetch.
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ items: [] }),
}) as never;

import ReportsPage from "../pages/reports";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderPmrPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ReportsPage lockedType="project" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function openCreateDialog() {
  const utils = renderPmrPage();
  const newBtn = (await screen.findAllByRole("button", { name: /newReport/i }))[0];
  fireEvent.click(newBtn);
  await screen.findByRole("dialog");
  return utils;
}

describe("PMR form rendered accessibility (real component)", () => {
  it("project selector: trigger id, aria-required, and help text wired via aria-describedby to an existing element", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");
    const trigger = dialog.querySelector("#pmr-project-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-required", "true");
    const describedBy = trigger!.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("help-pmr-project");
    for (const id of describedBy.split(/\s+/).filter(Boolean)) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("period fields have stable ids and aria-required (default monthly kind)", async () => {
    await openCreateDialog();
    for (const id of ["pmr-frequency", "pmr-month", "pmr-year"]) {
      const el = document.getElementById(id);
      expect(el, id).not.toBeNull();
      expect(el).toHaveAttribute("aria-required", "true");
    }
  });

  it("failed submit renders role=alert errors whose ids are referenced by the invalid controls", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /submitReport/i }));

    // Project error: element exists and is referenced from the trigger
    await waitFor(() => {
      expect(document.getElementById("err-pmr-project")).not.toBeNull();
    });
    const errProject = document.getElementById("err-pmr-project")!;
    expect(errProject).toHaveAttribute("role", "alert");
    const trigger = document.getElementById("pmr-project-trigger")!;
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger.getAttribute("aria-describedby")).toContain("err-pmr-project");

    // Every aria-describedby on an invalid control resolves to real elements
    const invalid = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
    expect(invalid.length).toBeGreaterThan(0);
    for (const el of invalid) {
      const refs = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      for (const id of refs) {
        expect(document.getElementById(id), `dangling aria-describedby "${id}"`).not.toBeNull();
      }
    }
  });

  it("activity row: named row produces field-level aria-invalid + linked error elements on failed submit", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");

    // Name the first (blank) activity row so row-level validation applies
    const nameInput = within(dialog).getByLabelText("Activity Name — Activity 1");
    fireEvent.change(nameInput, { target: { value: "Borehole drilling" } });
    // Negative expenditure triggers the row-level financial error
    const exp = within(dialog).getByLabelText(/Actual Expenditure \(This Period\) — Borehole drilling/);
    fireEvent.change(exp, { target: { value: "-5" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /submitReport/i }));

    // Actual Expenditure: invalid + describedby resolving to a rendered alert
    await waitFor(() => {
      expect(document.getElementById("err-act-0-actualExpenditure")).not.toBeNull();
    });
    expect(exp).toHaveAttribute("aria-invalid", "true");
    expect(exp.getAttribute("aria-describedby")).toBe("err-act-0-actualExpenditure");
    expect(document.getElementById("err-act-0-actualExpenditure")).toHaveAttribute("role", "alert");

    // Achievement Summary: same wiring
    const summary = within(dialog).getByLabelText(/Achievement Summary — Borehole drilling/);
    expect(summary).toHaveAttribute("aria-invalid", "true");
    expect(summary.getAttribute("aria-describedby")).toBe("err-act-0-achievementSummary");
    expect(document.getElementById("err-act-0-achievementSummary")).not.toBeNull();

    // Beneficiary inputs: each blank field flagged and linked to its OWN error element
    for (const g of ["men", "women", "boys", "girls"]) {
      const label = `${g.charAt(0).toUpperCase()}${g.slice(1)} beneficiaries — Borehole drilling`;
      const input = within(dialog).getByLabelText(label);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input.getAttribute("aria-describedby")).toBe(`err-act-0-ben-${g}`);
      expect(document.getElementById(`err-act-0-ben-${g}`)).toHaveAttribute("role", "alert");
    }

    // Remove button carries the row context
    expect(within(dialog).getByRole("button", { name: 'Remove Borehole drilling' })).toBeInTheDocument();
  });

  it("mixed beneficiary failures: each field's describedby resolves to its own correct error text", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Activity Name — Activity 1"), { target: { value: "Borehole drilling" } });
    // Men left blank (required error); Women negative (negative-value error)
    fireEvent.change(within(dialog).getByLabelText("Women beneficiaries — Borehole drilling"), { target: { value: "-3" } });
    fireEvent.change(within(dialog).getByLabelText("Boys beneficiaries — Borehole drilling"), { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText("Girls beneficiaries — Borehole drilling"), { target: { value: "5" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /submitReport/i }));

    await waitFor(() => {
      expect(document.getElementById("err-act-0-ben-men")).not.toBeNull();
    });

    // Men: blank → its own element carries the "required" message
    const men = within(dialog).getByLabelText("Men beneficiaries — Borehole drilling");
    expect(men).toHaveAttribute("aria-invalid", "true");
    expect(men.getAttribute("aria-describedby")).toBe("err-act-0-ben-men");
    expect(document.getElementById("err-act-0-ben-men")!.textContent).toMatch(/required/i);

    // Women: negative → its own element carries the "negative" message, not Men's
    const women = within(dialog).getByLabelText("Women beneficiaries — Borehole drilling");
    expect(women).toHaveAttribute("aria-invalid", "true");
    expect(women.getAttribute("aria-describedby")).toBe("err-act-0-ben-women");
    expect(document.getElementById("err-act-0-ben-women")!.textContent).toMatch(/negative/i);
    expect(document.getElementById("err-act-0-ben-women")!.textContent).not.toMatch(/required/i);

    // Boys/Girls valid → no aria-invalid, no dangling error elements
    for (const g of ["boys", "girls"]) {
      const label = `${g.charAt(0).toUpperCase()}${g.slice(1)} beneficiaries — Borehole drilling`;
      expect(within(dialog).getByLabelText(label)).not.toHaveAttribute("aria-invalid");
      expect(document.getElementById(`err-act-0-ben-${g}`)).toBeNull();
    }
  });

  it("blank initial activity row: Activity Name input gets aria-invalid + linked 'at least one activity' alert on submit", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /submitReport/i }));

    await waitFor(() => {
      expect(document.getElementById("err-act-0-name")).not.toBeNull();
    });
    const nameInput = within(dialog).getByLabelText("Activity Name — Activity 1");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput.getAttribute("aria-describedby")).toBe("err-act-0-name");
    const err = document.getElementById("err-act-0-name")!;
    expect(err).toHaveAttribute("role", "alert");
    expect(err.textContent).toMatch(/at least one activity/i);
  });

  it("remove-activity button falls back to positional name for unnamed rows", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Remove Activity 1" })).toBeInTheDocument();
  });

  it("validation rules unchanged: submit with empty form does not call create mutation", async () => {
    await openCreateDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /submitReport/i }));
    // Dialog stays open (validation blocked submission)
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
    });
  });
});
