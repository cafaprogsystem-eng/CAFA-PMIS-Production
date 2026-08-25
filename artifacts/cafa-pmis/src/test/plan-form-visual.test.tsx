/**
 * PLAN-FORM-VIS — Plan Detail edit-mode visual contracts
 *
 * Plan Detail edit mode provides TWO action surfaces intentionally:
 *  1. Header Cancel/Save — always visible regardless of scroll position.
 *  2. Sticky footer Cancel/Save — supplementary convenience when the user
 *     has scrolled down through a long plan's activity cards.
 *
 * Both surfaces must be consistently disabled/aria-busy during mutation so
 * there is never a window where one is disabled while the other is active.
 *
 * Follows the same rendered-test pattern as plan-duplicate-ux.test.tsx.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Environment shims ─────────────────────────────────────────────────────────
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as never;
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── i18n mock ─────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "detail.editPlan": "Edit Plan",
      "detail.cancelEdit": "Cancel",
      "detail.saveChanges": "Save Changes",
    }[key] ?? key),
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── wouter: simulate visiting /plans/42 ──────────────────────────────────────
vi.mock("wouter", () => ({
  useParams: () => ({ planId: "42" }),
  useLocation: () => ["/plans/42", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// ── Stable plan fixture ───────────────────────────────────────────────────────
const EXISTING_PLAN = {
  id: 42,
  title: "Q3 Work Plan",
  code: "CAFA-PLAN-KH-042",
  type: "work_plan",
  planType: "work_plan",
  status: "draft",
  sector: "Education",
  stateId: 1,
  stateName: "Khartoum",
  projectId: null,
  projectTitle: null,
  startDate: "2026-07-01",
  endDate: "2026-09-30",
  objective: "Deliver education activities",
  activities: [],
  indicators: [],
  risks: [],
  createdAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-01T08:00:00.000Z",
  approvals: [],
  sectors: ["Education"],
  locationId: 1,
  locationName: "Khartoum",
  locationCode: "KH",
  locationType: "state",
};

// ── API hook mocks ────────────────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useGetPlan: () => ({
    data: EXISTING_PLAN,
    isLoading: false,
    isError: false,
  }),
  useCreatePlan: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 42 }),
    isPending: false,
  }),
  useUpdatePlan: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useTransitionPlan: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useDeletePlan: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useReopenPlan: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useListProjects: () => ({ data: [] }),
  useListStates: () => ({ data: [{ id: 1, name: "Khartoum", code: "KH" }] }),
  useListRisks: () => ({ data: [] }),
  useGetMe: () => ({
    data: {
      user: { id: 9, name: "SPO", role: "state_program_officer", stateId: 1 },
      permissions: [
        "plans.view",
        "plans.create",
        "plans.update",
        "plans.submit",
        "comments.view",
        "comments.create",
      ],
    },
    isLoading: false,
  }),
}));

// ── fetch mock: plan-detail comments query returns a plain array ──────────────
// plan-detail.tsx queryFn returns res.json() directly (not .items)
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({ ok: true, json: async () => [] }),
) as never;

import PlanDetailPage from "../pages/plan-detail";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderPlanDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <PlanDetailPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PLAN-FORM-VIS — Plan Detail edit-mode visual contracts", () => {

  /**
   * PLAN-FORM-VIS-01: Edit mode provides TWO action surfaces — header (always
   * visible) and sticky footer (scroll-bottom convenience). Both must have a
   * "Save Changes" button and a "Cancel" button. Neither surface may have an
   * enabled action while the other is disabled during a mutation.
   */
  it("PLAN-FORM-VIS-01: Edit mode renders Save Changes and Cancel in both header and sticky footer", async () => {
    renderPlanDetail();

    const editBtn = await screen.findByRole("button", { name: /edit plan/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      // Header: Save Changes button present
      const saveBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
        /save changes/i.test(b.textContent ?? ""),
      );
      // Both header and footer provide a Save Changes button — at least 2
      expect(saveBtns.length).toBeGreaterThanOrEqual(2);

      // Both header and footer provide a Cancel button
      const cancelBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
        /^cancel$/i.test(b.textContent?.trim() ?? ""),
      );
      expect(cancelBtns.length).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * PLAN-FORM-VIS-02: The sticky footer (data-testid="edit-sticky-footer")
   * is present in edit mode and contains both action buttons.
   */
  it("PLAN-FORM-VIS-02: Sticky footer is present with Cancel and Save Changes in edit mode", async () => {
    renderPlanDetail();

    const editBtn = await screen.findByRole("button", { name: /edit plan/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      const footer = document.querySelector('[data-testid="edit-sticky-footer"]');
      expect(footer).not.toBeNull();

      const footerBtns = Array.from(footer!.querySelectorAll("button"));
      const hasSave = footerBtns.some((b) => /save changes/i.test(b.textContent ?? ""));
      const hasCancel = footerBtns.some((b) => /cancel/i.test(b.textContent ?? ""));
      expect(hasSave).toBe(true);
      expect(hasCancel).toBe(true);
    });
  });

  /**
   * PLAN-FORM-VIS-03: ALL edit-mode action buttons across both surfaces
   * (header + sticky footer) have aria-busy wired — they report
   * aria-busy="false" when idle so the attribute can flip to "true" during
   * a save mutation without a DOM re-structure.
   */
  it("PLAN-FORM-VIS-03: All edit-mode action buttons have aria-busy wired on both surfaces", async () => {
    renderPlanDetail();

    const editBtn = await screen.findByRole("button", { name: /edit plan/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      // Collect all "Save Changes" and "Cancel" buttons across header + footer
      const actionBtns = Array.from(document.querySelectorAll("button")).filter((b) => {
        const txt = b.textContent?.trim() ?? "";
        return /save changes/i.test(txt) || /^cancel$/i.test(txt);
      });
      expect(actionBtns.length).toBeGreaterThanOrEqual(4); // 2 Save + 2 Cancel

      // Every action button must have aria-busy wired
      const busyWired = actionBtns.filter((b) => b.hasAttribute("aria-busy"));
      expect(busyWired.length).toBe(actionBtns.length);

      // When idle, aria-busy must be "false" on all wired buttons
      for (const btn of busyWired) {
        expect(btn.getAttribute("aria-busy")).toBe("false");
      }
    });
  });

  /**
   * PLAN-FORM-VIS-04: Cancelling edit mode from the sticky footer hides both
   * action surfaces and restores view mode. window.confirm is accepted.
   */
  it("PLAN-FORM-VIS-04: Cancelling from sticky footer exits edit mode and removes both action surfaces", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPlanDetail();

    const editBtn = await screen.findByRole("button", { name: /edit plan/i });
    fireEvent.click(editBtn);

    // Both surfaces appear
    await waitFor(() => {
      expect(document.querySelector('[data-testid="edit-sticky-footer"]')).not.toBeNull();
    });

    // Cancel from the sticky footer
    const footer = document.querySelector('[data-testid="edit-sticky-footer"]');
    const cancelBtn = Array.from(footer!.querySelectorAll("button")).find((b) =>
      /cancel/i.test(b.textContent ?? ""),
    );
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn!);

    // Both action surfaces disappear
    await waitFor(() => {
      expect(document.querySelector('[data-testid="edit-sticky-footer"]')).toBeNull();
      const saveBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
        /save changes/i.test(b.textContent ?? ""),
      );
      expect(saveBtns.length).toBe(0);
    });
  });
});
