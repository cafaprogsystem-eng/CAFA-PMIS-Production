import React from "react";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  draftFailure: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "drafts.myDrafts": "My Drafts",
      "drafts.savedDrafts": "Saved drafts",
      "drafts.noDrafts": "No drafts",
      "drafts.projectReports": "Project Reports",
      "drafts.activityReports": "Activity Reports",
      "drafts.hqReports": "HQ Sector Reports",
      "drafts.stateReports": "State Programme Reports",
      "drafts.projects": "Projects",
      "drafts.plans": "Plans",
      "operationalFollowUp.title": "Operational Follow-Up",
      "operationalFollowUp.description": "Facts requiring attention",
      "operationalFollowUp.draftProjects": "Draft Projects",
      "operationalFollowUp.draftReports": "Draft Reports",
      "operationalFollowUp.lateReports": "Late Reports",
      "operationalFollowUp.criticalRisks": "Critical Risks",
      "operationalFollowUp.returnedReports": "Returned Reports",
      "operationalFollowUp.insufficientData": "Insufficient data",
      "operationalFollowUp.categoriesNote": "Categories are independent",
      "sections.overdueReportsDesc": "Awaiting approval",
      "riskPanel.activeCriticalRisks": "Active critical risks",
      "lateReports.returned": "Returned for revision",
      "queryState.loadFailedTitle": "Some dashboard data is unavailable",
      "queryState.partial": "Some dashboard data is unavailable; totals are not complete.",
      "queryState.retry": "Try again",
    } as Record<string, string>)[key] ?? key,
    i18n: { language: "en", dir: () => "ltr" },
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListProjects: () => ({
    data: [], isLoading: false, isError: queryState.draftFailure,
    error: queryState.draftFailure ? { status: 500 } : undefined, refetch: vi.fn(),
  }),
  useListPlans: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useListReports: ({ reportType }: { reportType: string }) => ({
    data: {
      items: reportType === "activity"
        ? [{ id: 42, title: "Activity draft" }]
        : [],
    },
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
}));

import {
  MyDraftsWidget,
  OperationalFollowUp,
  lrHref,
} from "../pages/dashboard";

const dashboardSource = readFileSync("src/pages/dashboard.tsx", "utf8");

describe("rendered Dashboard fact destinations", () => {
  afterEach(() => { queryState.draftFailure = false; });

  it("withholds successful draft subsets when one member request fails", () => {
    queryState.draftFailure = true;
    render(<MyDraftsWidget />);

    expect(screen.getByText("Some dashboard data is unavailable")).toBeInTheDocument();
    expect(screen.getByText("Some dashboard data is unavailable").closest("[role=alert]")).toBeInTheDocument();
    // The activity-report response is successful, but its count must not be
    // rendered as a trustworthy partial total while project drafts failed.
    expect(screen.queryByRole("link", { name: /Activity Reports/ })).not.toBeInTheDocument();
  });

  it("renders Activity Reports in the all-Report draft population", () => {
    render(<MyDraftsWidget />);

    const activityLabel = screen.getByText("Activity Reports");
    expect(activityLabel).toBeInTheDocument();
    expect(activityLabel.closest("a")).toHaveAttribute(
      "href",
      "/reports/activity?status=draft",
    );
    expect(activityLabel.closest("a")).toHaveTextContent("1");
  });

  it("does not attach misleading single-type links to all-Report counts", () => {
    render(
      <OperationalFollowUp
        draftProjectCount={2}
        isDraftProjectsLoading={false}
        draftReportCount={4}
        isDraftReportsLoading={false}
        lateReportCount={3}
        isLateLoading={false}
        criticalRiskCount={1}
        isCriticalLoading={false}
        returnedReportCount={2}
        isReturnedLoading={false}
      />,
    );

    expect(screen.getByRole("group", { name: /Draft Reports: 4/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Late Reports: 3/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Returned Reports: 2/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Critical Risks: 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Critical Risks: 1/ })).not.toBeInTheDocument();
  });

  it("routes each canonical Report row to its own module and record", () => {
    expect(lrHref("project", 1)).toBe("/reports/project?open=1");
    expect(lrHref("activity", 2)).toBe("/reports/activity?open=2");
    expect(lrHref("program_state", 3)).toBe("/reports/program-state?open=3");
    expect(lrHref("hq_sector", 4)).toBe("/reports/hq-sector?open=4");
  });

  it("binds the late-report tile to the uncapped Reports summary aggregate", () => {
    expect(dashboardSource).toContain(
      "lateReportCount={reportsSummary?.awaitingApprovalOver14Days}",
    );
    expect(dashboardSource).toContain("isLateLoading={isReportsSummaryLoading}");
    expect(dashboardSource).not.toContain("lateReportCount={lateReports?.length}");
  });
});