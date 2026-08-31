import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RecordDetailProvider } from "@/contexts/record-detail-context";

const { apiState, setLocation } = vi.hoisted(() => ({
  setLocation: vi.fn(),
  apiState: {
    permissions: ["plans.update"] as string[],
    plans: [] as Array<Record<string, unknown>>,
    lastQuery: {} as Record<string, unknown>,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string; page?: number; totalPages?: number }) => {
      if (key === "pagination.pageOf") return `${options?.page} / ${options?.totalPages}`;
      return ({
      continueEditing: "Continue Editing",
      continueEditingAriaLabel: `Continue Editing ${options?.title ?? ""}`,
      "recordDetails.close": "Close record details",
      "pagination.firstPage": "First page",
      "pagination.previousPage": "Previous page",
      "pagination.nextPage": "Next page",
      "pagination.lastPage": "Last page",
      "plansPage.draftPlans": "Draft Plans",
      "plansPage.awaitingApproval": "Awaiting Approval",
      "plansPage.activePlans": "Active Plans",
      "plansPage.completedPlans": "Completed Plans",
      "viewModes.table": "Table",
      "viewModes.card": "Card",
      "viewModes.list": "List",
      "viewModes.compact": "Compact",
      "viewModes.kanban": "Kanban",
      "viewModes.calendar": "Calendar",
      "table.status": "Status",
      }[key] ?? key);
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({
    data: { user: { id: 1, role: "program_manager" }, permissions: apiState.permissions },
  }),
  useListPlans: (query: Record<string, unknown>) => {
    apiState.lastQuery = query;
    return { data: apiState.plans, isLoading: false, isError: false };
  },
  useListStates: () => ({ data: [{ id: 1, name: "Khartoum" }] }),
  useGetPlanningDashboard: () => ({
    data: {
      totals: { total: 7, draft: 1, awaitingApproval: 3, active: 2, completed: 1 },
      upcomingDeadlines: [],
      delayedActivities: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/plans", setLocation],
  Link: ({ href, children, onClick, ...props }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          setLocation(href);
        }
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/pages/plan-detail", () => ({
  default: ({ planId }: { planId: string }) => <p>Shared Plan Detail {planId}</p>,
}));

vi.mock("@/pages/project-detail", () => ({
  default: () => <p>Shared Project Detail</p>,
}));

vi.mock("@/components/create-plan-registration-dialog", () => ({
  CreatePlanRegistrationDialog: () => null,
}));

vi.mock("@/components/drive-attachment-panel", () => ({
  AttachmentCountBadge: () => null,
}));

import PlansPage from "@/pages/plans";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({
    matches: false, media, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  apiState.permissions = ["plans.update"];
});

function plan(id: number, status: string, title: string) {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
  return {
    id,
    title,
    code: `CAFA-PLAN-${id}`,
    planType: "monthly",
    status,
    stateName: "Khartoum",
    stateId: 1,
    startDate: date,
    endDate: date,
    budgetPlanned: null,
    currency: "USD",
    progressPct: null,
  };
}

function renderWorkspace() {
  return render(
    <RecordDetailProvider>
      <TooltipProvider>
        <PlansPage />
      </TooltipProvider>
    </RecordDetailProvider>,
  );
}

describe("Plans workspace interaction contract", () => {
  it("uses one paginated record collection in every presentation and opens records through the shared coordinator", () => {
    apiState.plans = [
      plan(1, "draft", "Draft Plan"),
      ...Array.from({ length: 20 }, (_, index) => plan(index + 2, "completed", `Completed ${index + 2}`)),
    ];
    renderWorkspace();

    const tableTitle = screen.getByRole("link", { name: "Draft Plan" });
    expect(tableTitle).toHaveAttribute("href", "/plans/1");
    fireEvent.click(tableTitle);
    expect(screen.getByRole("dialog", { name: "Plan details" })).toHaveTextContent("Shared Plan Detail 1");
    fireEvent.click(screen.getByRole("button", { name: "Close record details" }));
    expect(screen.queryByText("Completed 21")).not.toBeInTheDocument();

    for (const mode of ["Card", "List", "Compact", "Kanban", "Calendar"]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      const view = screen.getByRole("button", { name: "View Draft Plan" });
      fireEvent.click(view);
      expect(screen.getByRole("dialog", { name: "Plan details" })).toHaveTextContent("Shared Plan Detail 1");
      fireEvent.click(screen.getByRole("button", { name: "Close record details" }));
      expect(screen.queryByText("Completed 21")).not.toBeInTheDocument();
    }
  });

  it("keeps the current page when changing presentation and exposes pagination outside the table", () => {
    apiState.plans = [
      plan(1, "draft", "Draft Plan"),
      ...Array.from({ length: 20 }, (_, index) => plan(index + 2, "completed", `Completed ${index + 2}`)),
    ];
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Completed 21")).toBeInTheDocument();
    expect(screen.queryByText("Draft Plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Card" }));
    expect(screen.getByText("Completed 21")).toBeInTheDocument();
    expect(screen.queryByText("Draft Plan")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("keeps Continue Editing separate from View in every non-table presentation", () => {
    apiState.plans = [plan(1, "draft", "Draft Plan")];
    renderWorkspace();

    for (const mode of ["Card", "List", "Compact", "Kanban", "Calendar"]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      const edit = screen.getByRole("button", { name: "Continue Editing Draft Plan" });
      fireEvent.click(edit);
      expect(setLocation).toHaveBeenLastCalledWith("/plans/1?edit=1");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  });

  it("gates draft editing on plans.update while retaining read-only viewing", () => {
    apiState.permissions = [];
    apiState.plans = [plan(1, "draft", "Draft Plan")];
    renderWorkspace();

    expect(screen.queryByRole("button", { name: /Continue Editing/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Card" }));
    const view = screen.getByRole("button", { name: "View Draft Plan" });
    fireEvent.click(view);
    expect(screen.getByRole("dialog", { name: "Plan details" })).toHaveTextContent("Shared Plan Detail 1");
  });

  it("synchronises KPI aggregate filters with the canonical status state and lets users toggle them off", async () => {
    apiState.plans = [
      plan(1, "draft", "Draft Plan"),
      plan(2, "submitted", "Submitted Plan"),
      plan(3, "technically_approved", "Technical Plan"),
      plan(4, "coordination_approved", "Coordination Plan"),
      plan(5, "active", "Active Plan"),
      plan(6, "in_progress", "In Progress Plan"),
      plan(7, "completed", "Completed Plan"),
    ];
    renderWorkspace();

    const awaiting = screen.getByRole("button", { name: "Awaiting Approval" });
    expect(awaiting).toHaveAttribute("aria-pressed", "false");
    awaiting.focus();
    await userEvent.keyboard("{Enter}");
    expect(awaiting).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Submitted Plan")).toBeInTheDocument();
    expect(screen.getByText("Technical Plan")).toBeInTheDocument();
    expect(screen.getByText("Coordination Plan")).toBeInTheDocument();
    expect(screen.queryByText("Draft Plan")).not.toBeInTheDocument();
    expect(apiState.lastQuery).not.toHaveProperty("status");

    await userEvent.keyboard(" ");
    expect(awaiting).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Draft Plan")).toBeInTheDocument();
    expect(screen.getByText("Completed Plan")).toBeInTheDocument();
  });

  it("keeps Total Plans static and exposes every actual status subset as a pressed toggle", () => {
    apiState.plans = [plan(1, "draft", "Draft Plan")];
    renderWorkspace();

    expect(screen.queryByRole("button", { name: "Total Plans" })).not.toBeInTheDocument();
    for (const label of ["Draft Plans", "Awaiting Approval", "Active Plans", "Completed Plans"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("resets a later page when a status subset is selected and supports keyboard sorting", () => {
    apiState.plans = [
      plan(1, "draft", "Draft Plan"),
      ...Array.from({ length: 20 }, (_, index) => plan(index + 2, "completed", `Completed ${index + 2}`)),
    ];
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Draft Plans" }));
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("Draft Plan")).toBeInTheDocument();

    const statusHead = screen.getByRole("columnheader", { name: /Sort by Status/i });
    statusHead.focus();
    fireEvent.keyDown(statusHead, { key: "Enter" });
    expect(statusHead).toHaveAttribute("aria-sort", "ascending");
  });

  it("does not offer Continue Editing for a non-draft plan and supports keyboard View", async () => {
    apiState.plans = [plan(2, "completed", "Completed Plan")];
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Card" }));

    expect(screen.queryByRole("button", { name: /Continue Editing/ })).not.toBeInTheDocument();
    const view = screen.getByRole("button", { name: "View Completed Plan" });
    view.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Plan details" })).toHaveTextContent("Shared Plan Detail 2");
  });
});