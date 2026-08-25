import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "budgetWorkspace.donorToolbar": "Donor portfolio filters and presentation",
      "budgetWorkspace.projectToolbar": "Project budget performance filters and presentation",
      "budgetWorkspace.donorView": "Donor portfolio presentation",
      "budgetWorkspace.projectView": "Project budget presentation",
      "budgetWorkspace.searchDonors": "Search donor name, project code or title…",
      "budgetWorkspace.searchProjects": "Search project code, title or donor…",
      "budgetWorkspace.filterDataStatus": "Filter by data status",
      "budgetWorkspace.filterProjectStatus": "Project status",
      "budgetWorkspace.filterCurrency": "Currency",
      "budgetWorkspace.filterBudgetBasis": "Budget basis",
      "budgetWorkspace.filterDataAvailability": "Financial data availability",
      "budgetWorkspace.allCurrencies": "All currencies",
      "budgetWorkspace.dataAvailability": "Financial data availability",
      "budgetWorkspace.stateExpenditureUnavailable": "State-level expenditure unavailable",
      "budgetWorkspace.details": "Details",
      "budgetWorkspace.hideDetails": "Hide details",
      "viewModes.table": "Table",
      "viewModes.card": "Grid / Card",
      "viewModes.compact": "Compact List",
      "viewModes.viewMode": "View mode",
      "common:filter": "Filters",
    }[key] ?? key),
  }),
}));

vi.mock("@/contexts/record-detail-context", () => ({
  useRecordDetail: () => ({ openRecord: vi.fn() }),
}));

import {
  DonorPortfolioTable,
  ProjectBudgetPerformanceTable,
} from "@/pages/dashboard";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const donorRows = [{
  donorId: 1,
  donorName: "Example Donor",
  donor: "Example Donor",
  currency: "USD",
  currencyMixed: false,
  budgetByCurrency: [
    { currency: "USD", allocatedBudget: 1000, budgetTotal: 1000, budgetSpent: 250 },
    { currency: "EUR", allocatedBudget: 900, budgetTotal: 900, budgetSpent: 225 },
  ],
  allocatedBudget: 1000,
  budgetTotal: 1000,
  budgetSpent: 250,
  projects: 1,
  projectCount: 1,
  projectList: [],
  dataStatus: "linked",
  dataIssues: [],
  beneficiaries: 100,
}] as unknown as NonNullable<Parameters<typeof DonorPortfolioTable>[0]["data"]>;

const projectRows = [{
  id: 1,
  projectId: 1,
  projectCode: "CAFA-001",
  projectTitle: "Example project",
  projectStatus: "active",
  donorName: "Example Donor",
  currency: "USD",
  sector: "Health",
  budgetBasis: "Project-Level Budget",
  allocatedBudget: 1000,
  spent: 250,
  remainingBalance: 750,
  utilisationRate: 25,
  hasBudgetData: true,
  hasRecordedExpenditure: true,
  hasMissingCurrency: false,
  missingStateExpenditure: false,
}] as unknown as Parameters<typeof ProjectBudgetPerformanceTable>[0]["data"];

function renderWithTooltips(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("Budget registry toolbars", () => {
  it("renders the Donor Portfolio control bar and changes only its URL preference", () => {
    window.history.replaceState({}, "", "/budget?tab=overview&projectBudgetView=compact&external=keep");
    renderWithTooltips(
      <DonorPortfolioTable data={donorRows} isLoading={false} isError={false} onRetry={vi.fn()} />,
    );

    const toolbar = screen.getByRole("group", { name: "Donor portfolio filters and presentation" });
    expect(toolbar.className).toContain("rounded-xl");
    expect(toolbar.className).toContain("border");
    expect(within(toolbar).getByRole("searchbox", { name: "Search donor name, project code or title…" })).toHaveClass("h-10");
    expect(toolbar.querySelector('[data-orientation="vertical"]')).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Grid / Card" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(toolbar).getByRole("button", { name: "Grid / Card" }));
    expect(window.location.search).toBe("?tab=overview&projectBudgetView=compact&external=keep&donorPortfolioView=card");
  });

  it("renders the Project Budget Performance control bar and preserves every other URL context", () => {
    window.history.replaceState({}, "", "/budget?tab=overview&donorPortfolioView=card&external=keep");
    renderWithTooltips(
      <ProjectBudgetPerformanceTable
        data={projectRows}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        role="program_manager"
        spoStateId={null}
      />,
    );

    const toolbar = screen.getByRole("group", { name: "Project budget performance filters and presentation" });
    expect(toolbar.className).toContain("rounded-xl");
    expect(toolbar.className).toContain("border");
    expect(within(toolbar).getByRole("searchbox", { name: "Search project code, title or donor…" })).toHaveClass("h-10");
    expect(toolbar.querySelector('[data-orientation="vertical"]')).toBeInTheDocument();
    const compact = within(toolbar).getByRole("button", { name: "Compact List" });
    expect(compact.tagName).toBe("BUTTON");
    expect(compact).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(compact);
    expect(window.location.search).toBe("?tab=overview&donorPortfolioView=card&external=keep&projectBudgetView=compact");
  });

  it("accepts a controlled registry currency so overview KPIs cannot drift from donor figures", () => {
    renderWithTooltips(
      <DonorPortfolioTable
        data={donorRows}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        activeCurrency="EUR"
        onActiveCurrencyChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the canonical all-currencies mode as selected and keeps per-currency figures separate", () => {
    renderWithTooltips(
      <DonorPortfolioTable
        data={donorRows}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        activeCurrency="all"
        onActiveCurrencyChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "All currencies" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByText(/USD/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(0);
  });

  it("returns controlled Donor Portfolio pagination to page one when its currency changes", () => {
    const pagedDonors = Array.from({ length: 6 }, (_, index) => ({
      ...donorRows[0]!,
      donorId: index + 1,
      donorName: `Donor ${index + 1}`,
      donor: `Donor ${index + 1}`,
    })) as typeof donorRows;

    function ControlledPortfolio() {
      const [currency, setCurrency] = React.useState("USD");
      return (
        <DonorPortfolioTable
          data={pagedDonors}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
          activeCurrency={currency}
          onActiveCurrencyChange={setCurrency}
        />
      );
    }

    renderWithTooltips(<ControlledPortfolio />);
    fireEvent.click(screen.getByLabelText("next"));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "EUR" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});