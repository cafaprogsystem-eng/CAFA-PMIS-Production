/**
 * PLAN-FINAL-VIS-01 through PLAN-FINAL-VIS-10
 * Plans Module Visual Refinement — Phase 4 / Final Closure
 *
 * Closes #552: Budget & Totals view mode must render clean read-only figures
 * (dl/grid) instead of greyed-out form fields, plus module-wide consistency
 * verifications (null/zero semantics, rejection terminality, duplicate UX,
 * dual save-state, functional-contract safety).
 *
 * Architecture notes:
 * - Module-level stable mock objects prevent infinite effect loops.
 * - Rendered tests reuse the Phase 3 harness pattern (plan-detail-visual.test.tsx).
 * - Source-contract tests read the page source directly for cross-file checks.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

// ─── Mutable mock state ───────────────────────────────────────────────────────

const MOCK_ME_ADMIN = {
  user: { id: 1, role: "pm", status: "active" },
  permissions: ["*"],
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
    budgetActual: 12000,
    currency: "EUR",
    fundingSource: "EU Grant",
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

// ─── Mock API hooks ───────────────────────────────────────────────────────────

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
        "detail.section5": "Budget & Totals",
        "detail.currency": "Currency",
        "detail.planBudgetPlanned": "Planned budget",
        "detail.planBudgetActual": "Actual budget",
        "detail.fundingSource": "Funding source",
        "activity.progressPct": "Progress %",
        "activity.activityNum": `Activity ${opts?.num ?? ""}`,
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

// ─── Source helpers for cross-file contract checks ───────────────────────────

const SRC = path.resolve(__dirname, "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Plans Final Closure (PLAN-FINAL-VIS)", () => {
  it("PLAN-FINAL-VIS-01: Budget view mode uses dl/grid read presentation; no disabled inputs", () => {
    const { container } = render(<PlanDetailPage />, { wrapper: Wrapper });
    // View mode (not editing): budget figures rendered as definition list
    const dls = container.querySelectorAll("dl");
    expect(dls.length).toBeGreaterThan(0);
    // Budget section labels present as read text
    expect(screen.getAllByText("Planned budget").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Funding source").length).toBeGreaterThan(0);
    // No disabled Input/Select controls visible in view mode
    const disabledControls = container.querySelectorAll("input[disabled], select[disabled], button[disabled][role='combobox']");
    expect(disabledControls.length).toBe(0);
  });

  it("PLAN-FINAL-VIS-02: Budget edit controls present and enabled in edit mode", async () => {
    window.history.replaceState({}, "", "/plans/42?edit=1");
    const { container } = render(<PlanDetailPage />, { wrapper: Wrapper });
    const numberInputs = container.querySelectorAll("input[type='number']");
    expect(numberInputs.length).toBeGreaterThan(0);
    numberInputs.forEach((el) => expect(el).not.toBeDisabled());
  });

  it("PLAN-FINAL-VIS-03: Budget values use plan currency; no hardcoded $", () => {
    render(<PlanDetailPage />, { wrapper: Wrapper });
    // Plan currency is EUR; formatCurrency with currencyDisplay:"code" → "EUR 50,000"
    expect(screen.getByText(/EUR\s*50,000/)).toBeInTheDocument();
    expect(screen.getByText(/EUR\s*12,000/)).toBeInTheDocument();
    // Source contract: read-mode budget figures pass form.currency through
    const src = readSrc("pages/plan-detail.tsx");
    expect(src).toMatch(/formatCurrency\(form\.budgetPlanned, form\.currency\)/);
    expect(src).toMatch(/formatCurrency\(form\.budgetActual, form\.currency\)/);
  });

  it("PLAN-FINAL-VIS-04: null plan progress renders '—' in plans list and plan detail", () => {
    // Detail (rendered): progressPct is null in basePlan
    render(<PlanDetailPage />, { wrapper: Wrapper });
    // Null plan progress renders the em-dash with the explanatory title (PLAN-465)
    const dash = screen.getByTitle("No Activities available for Progress calculation.");
    expect(dash).toHaveTextContent("—");
    // List (source contract): null → em-dash, genuine 0 → "0%"
    const src = readSrc("pages/plans.tsx");
    expect(src).toMatch(/progressPct\s*==\s*null/);
    expect(src).toContain("—");
  });

  it("PLAN-FINAL-VIS-05: activity 0% renders as '0%' in the activities section (not '—')", () => {
    render(<PlanDetailPage />, { wrapper: Wrapper });
    // MOCK_ACTIVITY has progressPct: 0 — read view must show "0%"
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  });

  it("PLAN-FINAL-VIS-06: hard duplicate blocks submission; soft duplicate is advisory only", () => {
    const src = readSrc("components/create-plan-registration-dialog.tsx");
    // Hard match type blocks; soft warns
    expect(src).toMatch(/matchType === "hard"/);
    expect(src).toMatch(/matchType === "soft"/);
    expect(src).toContain("duplicate-hard-warning");
    // Hard duplicate participates in a submit-blocking condition
    expect(src).toMatch(/isHardDuplicate/);
  });

  it("PLAN-FINAL-VIS-07: rejected plan shows no Edit or Resubmit button", () => {
    MOCK_STATE.plan = basePlan({ status: "rejected" });
    render(<PlanDetailPage />, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: /edit plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resubmit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revise/i })).not.toBeInTheDocument();
  });

  it("PLAN-FINAL-VIS-08: returned-draft revision banner has amber treatment with quoted feedback", () => {
    MOCK_STATE.plan = basePlan({ status: "draft" });
    MOCK_STATE.comments = [
      { commentType: "revision_request", authorName: "SPC Reviewer", body: "Please refine the budget.", createdAt: "2026-08-01T10:00:00Z" },
    ];
    const { container } = render(<PlanDetailPage />, { wrapper: Wrapper });
    const banner = container.querySelector(".border-amber-300\\/60");
    expect(banner).not.toBeNull();
    expect(screen.getByText(/please refine the budget/i)).toBeInTheDocument();
  });

  it("PLAN-FINAL-VIS-09: header and footer Save/Cancel share isPending busy state", () => {
    window.history.replaceState({}, "", "/plans/42?edit=1");
    MOCK_STATE.updatePending = true;
    render(<PlanDetailPage />, { wrapper: Wrapper });
    const saveButtons = screen.getAllByRole("button", { name: /save changes/i });
    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    expect(saveButtons.length).toBeGreaterThanOrEqual(2);
    [...saveButtons, ...cancelButtons].forEach((b) => {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("aria-busy", "true");
    });
  });

  it("PLAN-FINAL-VIS-10: no Plans functional contract changed (visual-only closure)", () => {
    const detail = readSrc("pages/plan-detail.tsx");
    const list = readSrc("pages/plans.tsx");
    // Edit-mode budget controls unchanged (setField wiring intact)
    expect(detail).toMatch(/setField\("budgetPlanned", Number\(e\.target\.value\)\)/);
    expect(detail).toMatch(/setField\("budgetActual", Number\(e\.target\.value\)\)/);
    expect(detail).toMatch(/setField\("currency", v\)/);
    expect(detail).toMatch(/setField\("fundingSource", e\.target\.value\)/);
    // Rejection remains terminal
    expect(detail).toMatch(/POST_APPROVAL_LOCKED_STATUSES = new Set\(\[[^\]]*"rejected"/);
    // No uppercase tracking metadata labels remain in Plans module surfaces
    expect(detail).not.toMatch(/uppercase tracking-wid/);
    expect(list).not.toMatch(/uppercase tracking-wid/);
    expect(readSrc("components/create-plan-registration-dialog.tsx")).not.toMatch(/uppercase tracking-wid/);
  });
});
