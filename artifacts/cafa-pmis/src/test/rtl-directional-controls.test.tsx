import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const consolidatedReport = {
  project: { title: "Water Access" },
  period: { kind: "monthly", label: "January 2026" },
  completeness: {
    expectedLocations: 1,
    reportsSubmitted: 1,
    reportsApproved: 0,
    missingLocations: 0,
    completenessPercent: 100,
  },
  locations: [{
    locationType: "state",
    stateId: 1,
    locationName: "North Darfur",
    report: {
      reportId: 1,
      status: "submitted",
      submittedAt: null,
      activities: [],
      indicatorProgress: [],
      plannedBudget: null,
      actualExpenditure: null,
      currency: "USD",
    },
  }],
};

vi.mock("@workspace/api-client-react", () => ({
  useGetConsolidatedProjectReport: () => ({
    data: consolidatedReport,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "pagination.firstPage": "First page",
      "pagination.previousPage": "Previous page",
      "pagination.nextPage": "Next page",
      "pagination.lastPage": "Last page",
    }[key] ?? key),
    i18n: { language: "en", dir: () => "ltr" },
  }),
}));

import { ConsolidatedReportView } from "@/components/consolidated-report-view";
import { PlanPagination } from "@/pages/plans";

describe("RTL directional controls", () => {
  it("mirrors a closed consolidated-report accordion but uses a direction-neutral down chevron when open", () => {
    render(
      <div dir="rtl">
        <ConsolidatedReportView projectId={1} kind="monthly" reportingYear={2026} reportingMonth={1} />
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "North Darfur" });
    const chevron = trigger.querySelector("svg");
    expect(chevron).toHaveClass("rtl:scale-x-[-1]");
    expect(chevron).not.toHaveClass("rotate-90");

    fireEvent.click(trigger);
    expect(chevron).toHaveClass("rotate-90", "rtl:rotate-90");
    expect(chevron).not.toHaveClass("rtl:scale-x-[-1]");
  });

  it("mirrors every Plans pagination direction icon in RTL", () => {
    render(
      <div dir="rtl">
        <PlanPagination
          page={2}
          pageSize={10}
          totalCount={30}
          totalPages={3}
          onPageChange={vi.fn()}
          onPageSizeChange={vi.fn()}
        />
      </div>,
    );

    for (const label of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(screen.getByLabelText(label).querySelector("svg")).toHaveClass("rtl:rotate-180");
    }
  });
});