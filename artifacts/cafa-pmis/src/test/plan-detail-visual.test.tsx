/**
 * PLAN-DETAIL-VIS-01 through PLAN-DETAIL-VIS-10
 * Plans Module Visual Refinement — Phase 3: Plan Detail page
 * (Overview / Activities read view / Workflow)
 *
 * Visual contract tests for the plan detail read-only and edit surfaces.
 *
 * Architecture notes:
 * - Module-level stable mock objects prevent infinite effect loops in rendered tests.
 * - All API hooks mocked at module level; MOCK_STATE holds the mutable plan/me/pending flags.
 * - No backend, API, migration, or workflow logic is exercised here.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";

// ─── Mutable mock state (module-level, reset per test) ────────────────────────

const MOCK_ME_ADMIN = {
  user: { id: 1, role: "pm", status: "active" },
  permissions: ["*"],
};
const MOCK_ME_VIEWER = {
  user: { id: 2, role: "state_officer", status: "active" },
  permissions: ["plans.view"],
};
const MOCK_STATES = [
  { id: 1, name: "Khartoum" },
  { id: 2, name: "Blue Nile" },
];
const MOCK_ACTIVITY = {
  id: 7,
  title: "Vaccination Campaign",
  stateId: 1,
  stateName: "Khartoum",
  localityName: "Kadugli",
  plannedDate: "2026-05-15",
  targetBeneficiaries: 1250,
  budgetPlanned: 8000,
  budgetActual: 0,
  priority: "high",
  expectedResult: "1,250 children vaccinated",
  status: "planned",
  progressPct: 0,
  responsibleName: "Dr Ahmed",
  description: "",
  riskId: null,
  mitigationAction: "",
  expectedOutput: "",
  performanceIndicator: "",
  objectiveIndex: null,
  startDate: null,
  endDate: null,
};

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    code: "CAFA-PLAN-KH-001",
    title: "Q2 2026 Health Plan",
    planType: "quarterly",
    status: "draft",
    stateId: 1,
    stateName: "Khartoum",
    sectors: ["Health"],
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    budgetPlanned: 50000,
    budgetActual: 0,
    progressPct: null,
    activities: [MOCK_ACTIVITY],
    linkedRisks: [],
    ...overrides,
  };
}

const MOCK_STATE: {
  me: typeof MOCK_ME_ADMIN;
  plan: ReturnType<typeof basePlan>;
  comments: Array<{ commentType: string; authorName: string; body: string; createdAt: string }>;
  updatePending: boolean;
} = {
  me: MOCK_ME_ADMIN,
  plan: basePlan(),
  comments: [],
  updatePending: false,
};

// ─── Mock all API hooks ────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: MOCK_STATE.me }),
  useListStates: () => ({ data: MOCK_STATES }),
  useListProjects: () => ({ data: [] }),
  useListRisks: () => ({ data: [] }),
  useCreatePlan: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePlan: () => ({ mutate: vi.fn(), isPending: MOCK_STATE.updatePending }),
  useTransitionPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePlan: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useGetPlan: () => ({ data: MOCK_STATE.plan, isLoading: false, isError: false }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: MOCK_STATE.comments }),
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/plans/42", vi.fn()],
  useParams: () => ({ planId: "42" }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/components/comments-panel", () => ({ CommentsPanel: () => null }));
vi.mock("@/components/drive-attachment-panel", () => ({ DriveAttachmentPanel: () => null }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "detail.plan": "Plan",
        "detail.newPlan": "New Plan",
        "detail.planTitle": "Plan title",
        "detail.planType": "Plan type",
        "detail.statePh": "Select state",
        "detail.responsiblePerson": "Responsible person",
        "detail.sectors": "Sectors",
        "detail.sectorsDesc": "Select applicable sectors",
        "detail.atLeastOneSector": "At least one sector is required",
        "detail.startDate": "Start date",
        "detail.endDate": "End date",
        "detail.description": "Description",
        "detail.section1": "Plan Details",
        "detail.section2": "Related Project",
        "detail.section2Optional": "(optional)",
        "detail.section2Desc": "Link this plan to a project",
        "detail.section3": "Localities",
        "detail.section3Desc": "Add localities",
        "detail.section3DescWithProject": " from the linked project",
        "detail.section4": "Activities",
        "detail.section4Desc": "Plan activities",
        "detail.section5": "Budget & Totals",
        "detail.section6": "Linked Risks",
        "detail.tabPlan": "Plan",
        "detail.tabComments": "Comments",
        "detail.tabWorkflow": "Workflow",
        "detail.tabAttachments": "Attachments",
        "detail.noLinkedRisks": "No linked risks",
        "detail.workflowCurrentStatus": "Current Status",
        "detail.workflowActionsAvailable": "Available Actions",
        "detail.workflowApprovalChain": "Approval chain:",
        "detail.workflowApprovalChainValue": "Technical → Coordination → Final",
        "detail.workflowNoTransitions": "No transitions available",
        "detail.standalonePlan": "Standalone plan",
        "detail.currency": "Currency",
        "detail.planBudgetPlanned": "Planned budget",
        "detail.planBudgetActual": "Actual budget",
        "detail.fundingSource": "Funding source",
        "detail.totalActivities": "Total Activities",
        "detail.totalBeneficiaries": "Total Beneficiaries",
        "detail.activityBudget": "Activity Budget",
        "detail.burnRate": "Burn Rate",
        "detail.plannedTotal": "Planned total",
        "detail.actual": "actual",
        "detail.delayedCount": "delayed",
        "detail.zeroDelayed": "0 delayed",
        "detail.none": "None",
        "fields.state": "State",
        "activity.addActivity": "Add Activity",
        "activity.addFirstActivity": "Add First Activity",
        "activity.noActivities": "No activities",
        "activity.noActivitiesDesc": "Add at least one activity",
        "activity.activityNum": `Activity ${opts?.num ?? ""}`,
        "activity.activityTitle": "Activity title",
        "activity.locality": "Locality",
        "activity.plannedDate": "Planned date",
        "activity.priority": "Priority",
        "activity.responsiblePerson": "Responsible person",
        "activity.targetBeneficiaries": "Target beneficiaries",
        "activity.plannedBudget": "Planned budget",
        "activity.expectedResult": "Expected result",
        "activity.status": "Status",
        "activity.progressPct": "Progress %",
        "activity.budgetActual": "Actual budget",
        "activity.linkedRisk": "Linked risk",
        "activity.showOptional": "Show additional fields",
        "activity.hideOptional": "Hide additional fields",
        "activity.expectedOutput": "Expected output",
        "activity.performanceIndicator": "Performance indicator",
        "activity.activityName": "Activity description",
        "activity.completed": "completed",
        "detail.revisionRequested": "Revision Requested",
        "detail.revisionRequestedAria": "Revision requested",
        "detail.revisionFeedback": "Please address the feedback above and resubmit.",
        "detail.editPlan": "Edit Plan",
        "detail.cancelEdit": "Cancel",
        "detail.saveChanges": "Save Changes",
        "detail.planProgress": "Plan Progress",
        "detail.noActivitiesForProgress": "No Activities available for Progress calculation.",
      };
      return map[key] ?? key;
    },
  }),
}));

// ─── Component import (after mocks) ───────────────────────────────────────────

import PlanDetailPage from "@/pages/plan-detail";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

beforeEach(() => {
  MOCK_STATE.me = MOCK_ME_ADMIN;
  MOCK_STATE.plan = basePlan();
  MOCK_STATE.comments = [];
  MOCK_STATE.updatePending = false;
  window.history.replaceState({}, "", "/plans/42");
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Plan Detail Visual — Phase 3 (PLAN-DETAIL-VIS)", () => {
  it("PLAN-DETAIL-VIS-01: plan title is the primary element (h1)", () => {
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Q2 2026 Health Plan");
  });

  it("PLAN-DETAIL-VIS-02: status badge and plan type are human-readable text", () => {
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quarterly").length).toBeGreaterThan(0);
    // no raw machine tokens visible
    expect(screen.queryByText("draft")).not.toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-03: null progressPct renders '—', not '0%' (PLAN-465)", () => {
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    const label = screen.getByText("Plan Progress");
    const container = label.closest("div") as HTMLElement;
    expect(within(container).getByText("—")).toBeInTheDocument();
    expect(within(container).queryByText("0%")).not.toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-04: draft plan shows 'Edit Plan' button when user can edit", () => {
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    expect(screen.getByRole("button", { name: /Edit Plan/i })).toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-05: rejected plan renders no Edit or Resubmit button", () => {
    MOCK_STATE.plan = basePlan({ status: "rejected" });
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    expect(screen.queryByRole("button", { name: /Edit Plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resubmit/i })).not.toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-06: revision banner renders when status=draft with a revision request", () => {
    MOCK_STATE.comments = [
      { commentType: "revision_request", authorName: "Jane Reviewer", body: "Fix the budget.", createdAt: "2026-07-01T10:00:00Z" },
    ];
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    const banner = screen.getByRole("status", { name: "Revision requested" });
    expect(within(banner).getByText("Revision Requested")).toBeInTheDocument();
    expect(within(banner).getByText("Jane Reviewer")).toBeInTheDocument();
    expect(within(banner).getByText(/Fix the budget\./)).toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-07: activity values in read-only view match source data with no disabled inputs", () => {
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    // Read-only definition list values
    expect(screen.getByText("Kadugli")).toBeInTheDocument();
    expect(screen.getAllByText("1,250").length).toBeGreaterThan(0);
    expect(screen.getByText("1,250 children vaccinated")).toBeInTheDocument();
    expect(screen.getByText("Dr Ahmed")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // Header carries the title — no duplicated title field
    expect(screen.getByText(/Activity 1: Vaccination Campaign/)).toBeInTheDocument();
    // No form inputs (disabled or otherwise) inside the Activities section
    const section = screen.getByText("Activities").closest('[class*="rounded"]') as HTMLElement;
    const inputs = section ? section.querySelectorAll("input, textarea") : [];
    expect(inputs.length).toBe(0);
    // Editor in view mode must see no activity mutation affordances until entering edit mode
    expect(screen.queryByRole("button", { name: /Add Activity/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove activity/i })).not.toBeInTheDocument();
    // Status and Progress always render — even the default planned / 0% case
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  });

  it("PLAN-DETAIL-VIS-07b: read-only activity status/progress render exactly for all lifecycle states", () => {
    MOCK_STATE.plan = basePlan({
      activities: [
        { ...MOCK_ACTIVITY, id: 1, title: "A planned", status: "planned", progressPct: 0 },
        { ...MOCK_ACTIVITY, id: 2, title: "B running", status: "in_progress", progressPct: 45 },
        { ...MOCK_ACTIVITY, id: 3, title: "C done", status: "completed", progressPct: 100 },
        { ...MOCK_ACTIVITY, id: 4, title: "D cancelled", status: "cancelled", progressPct: 20 },
      ],
    });
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    // Human-readable status labels, exact progress values preserved
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("45%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20%").length).toBeGreaterThan(0);
  });

  it("PLAN-DETAIL-VIS-08: workflow tab trigger is present and accessible", () => {
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    expect(screen.getByRole("tab", { name: "Workflow" })).toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-09: header and sticky footer Save/Cancel share pending state", async () => {
    const user = userEvent.setup();
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    await user.click(screen.getByRole("button", { name: /Edit Plan/i }));
    const saveButtons = screen.getAllByRole("button", { name: /Save Changes/i });
    const cancelButtons = screen.getAllByRole("button", { name: /Cancel/i });
    expect(saveButtons.length).toBe(2);
    expect(cancelButtons.length).toBe(2);
    // Not pending: all enabled
    [...saveButtons, ...cancelButtons].forEach((b) => expect(b).not.toBeDisabled());
    expect(screen.getByTestId("edit-sticky-footer")).toBeInTheDocument();
  });

  it("PLAN-DETAIL-VIS-10: functional contracts unchanged — viewer sees read-only surfaces, no edit affordances", () => {
    MOCK_STATE.me = MOCK_ME_VIEWER;
    render(<Wrapper><PlanDetailPage /></Wrapper>);
    // No Edit Plan for viewer
    expect(screen.queryByRole("button", { name: /Edit Plan/i })).not.toBeInTheDocument();
    // Read-only linkage text, not a select
    expect(screen.getByText("Standalone plan")).toBeInTheDocument();
    // Progress contract intact
    const label = screen.getByText("Plan Progress");
    expect(within(label.closest("div") as HTMLElement).getByText("—")).toBeInTheDocument();
    // No Add Activity button
    expect(screen.queryByRole("button", { name: /Add Activity/i })).not.toBeInTheDocument();
  });
});
