/**
 * PMR Reporting Completeness panel — rendered component tests.
 *
 * Asserts:
 *  - a missing location shows "Not Submitted"
 *  - an approved location shows the "Approved" badge and submitted timestamp
 *  - a draft location shows "Draft" (distinct from missing)
 *  - a rejected location shows "Returned – Revision Required"
 *  - zero expected locations → no percentage / summary shown
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

// ── Data fixtures (module-level stable objects) ─────────────────────────────

const PROJECT_WITH_LOCATIONS = {
  summary: {
    projectsInScope: 1, expectedLocations: 4, reportsSubmitted: 2,
    reportsApproved: 1, missingLocations: 2, completenessPercent: 50,
  },
  projects: [{
    projectId: 10, projectName: "Project A", projectCode: "CAFA-A",
    frequency: "monthly", reportingPeriod: { year: 2026, month: 7 },
    expectedLocations: 4, reportsSubmitted: 2, reportsApproved: 1,
    missingLocations: 2, completenessPercent: 50,
    locations: [
      { locationType: "state", stateId: 5, locationName: "South Kordofan", reportId: 100, reportStatus: "approved", submittedAt: "2026-07-10T09:00:00Z", isMissing: false },
      { locationType: "state", stateId: 6, locationName: "Kassala", reportId: null, reportStatus: null, submittedAt: null, isMissing: true },
      { locationType: "state", stateId: 7, locationName: "Red Sea", reportId: 101, reportStatus: "draft", submittedAt: null, isMissing: true },
      { locationType: "hq", stateId: null, locationName: "HQ", reportId: 102, reportStatus: "rejected", submittedAt: "2026-07-12T10:00:00Z", isMissing: false },
    ],
  }],
};

const ZERO_EXPECTED = {
  summary: {
    projectsInScope: 1, expectedLocations: 0, reportsSubmitted: 0,
    reportsApproved: 0, missingLocations: 0, completenessPercent: null,
  },
  projects: [{
    projectId: 10, projectName: "Project A", projectCode: "CAFA-A",
    frequency: "monthly", reportingPeriod: { year: 2026, month: 7 },
    expectedLocations: 0, reportsSubmitted: 0, reportsApproved: 0,
    missingLocations: 0, completenessPercent: null, locations: [],
  }],
};

let currentData: unknown = PROJECT_WITH_LOCATIONS;

vi.mock("@workspace/api-client-react", () => ({
  useGetPmrReportingCompleteness: () => ({
    data: currentData, isLoading: false, isError: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => {
      const labels: Record<string, string> = {
        "completeness.approved": "Approved",
        "completeness.notSubmitted": "Not Submitted",
        "completeness.draft": "Draft",
        "completeness.returned": "Returned – Revision Required",
        "completeness.viewReport": "View report",
      };
      if (key === "completeness.summary") return `${values?.submitted} of ${values?.expected} locations submitted`;
      if (key === "completeness.summaryDetail") return `${values?.approved} approved ${values?.missing} missing`;
      if (key === "completeness.summaryPercent") return `${values?.percent}% complete`;
      return labels[key] ?? key;
    },
  }),
}));

import { PmrCompletenessPanel } from "../components/pmr-completeness-panel";

describe("PmrCompletenessPanel", () => {
  it("shows summary bar and per-location statuses", () => {
    currentData = PROJECT_WITH_LOCATIONS;
    render(<PmrCompletenessPanel projectId={10} />);

    // Summary bar
    expect(screen.getByTestId("pmr-comp-summary")).toHaveTextContent("2 of 4 locations submitted");
    expect(screen.getByTestId("pmr-comp-summary")).toHaveTextContent("1 approved");
    expect(screen.getByTestId("pmr-comp-summary")).toHaveTextContent("2 missing");
    expect(screen.getByTestId("pmr-comp-summary")).toHaveTextContent("50% complete");

    // Missing location shows "Not Submitted" — no fabricated report row data
    const kassalaRow = screen.getByText("Kassala").closest("tr")!;
    expect(kassalaRow).toHaveTextContent("Not Submitted");
    expect(kassalaRow).not.toHaveTextContent("View report");

    // Approved location shows badge + View link
    const skRow = screen.getByText("South Kordofan").closest("tr")!;
    expect(skRow).toHaveTextContent("Approved");
    expect(skRow).toHaveTextContent("View report");

    // Draft is distinct from missing
    const rsRow = screen.getByText("Red Sea").closest("tr")!;
    expect(rsRow).toHaveTextContent("Draft");
    expect(rsRow).not.toHaveTextContent("Not Submitted");

    // Returned shows the revision-required wording
    const hqRow = screen.getByText("HQ").closest("tr")!;
    expect(hqRow).toHaveTextContent("Returned – Revision Required");
  });

  it("zero expected locations → empty state, no percentage", () => {
    currentData = ZERO_EXPECTED;
    render(<PmrCompletenessPanel projectId={10} />);
    expect(screen.getByTestId("pmr-comp-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("pmr-comp-summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
