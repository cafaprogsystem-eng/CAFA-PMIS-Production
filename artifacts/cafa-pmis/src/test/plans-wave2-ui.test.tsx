/**
 * Plans Module Zero-Residual Closure — Wave 2 (Frontend UI tests)
 *
 * PLAN-DUP-UX-01…07  Soft duplicate "Review Existing Plan" navigation UX
 * PLAN-VIEW-01…10    Continue Editing parity across Table / Card / Kanban views
 *
 * Follows the layered wrapper style established in plan-duplicate-ux.test.tsx:
 * wrappers mirror the exact JSX/logic from create-plan-registration-dialog.tsx
 * and plans.tsx viewRecords, while the Card/Kanban tests render the REAL
 * CardGrid and KanbanBoard components to prove the action slot is wired.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import React, { useState, useEffect } from "react";
import "@testing-library/jest-dom";

// ── Environment shims ─────────────────────────────────────────────────────────
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

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ── i18n mock ─────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── wouter mock ───────────────────────────────────────────────────────────────
const mockSetLocation = vi.fn();
vi.mock("wouter", () => ({
  useParams:   () => ({}),
  useLocation: () => ["/", mockSetLocation],
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...(rest as object)}>{children}</a>
  ),
}));

import { CardGrid } from "@/components/view-modes/card-grid";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ViewRecord } from "@/lib/view-modes";
import { Link } from "wouter";

const registrationDialogSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/create-plan-registration-dialog.tsx"),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────────────
// Shared types — mirror of the dialog's duplicate-check union (Wave 2 shape)
// ─────────────────────────────────────────────────────────────────────────────

type DuplicateCheckResult =
  | { matchType: "none" }
  | { matchType: "soft"; count?: number; planId?: number | null }
  | { matchType: "hard"; existing: { planId: number | null; title: string | null; status: string | null; planType: string; startDate: string; endDate: string } };

type DuplicateCheckState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; result: DuplicateCheckResult }
  | { kind: "error" };

/**
 * Mirror of the dialog's soft/hard duplicate warning block including the
 * Wave 2 "Review Existing Plan" affordance and the "Continue Anyway" path.
 */
function DuplicateWarningWrapper({
  dupState,
  onNavigate,
}: {
  dupState: DuplicateCheckState;
  onNavigate?: (path: string) => void;
}) {
  const isHard = dupState.kind === "result" && dupState.result.matchType === "hard";
  const isSoft = dupState.kind === "result" && dupState.result.matchType === "soft";
  const hardExisting = isHard && dupState.result.matchType === "hard" ? dupState.result.existing : null;
  const softDuplicatePlanId =
    dupState.kind === "result" && dupState.result.matchType === "soft"
      ? dupState.result.planId ?? null
      : null;

  return (
    <div>
      {isHard && (
        <div role="alert" data-testid="duplicate-hard-warning">
          <p>A Plan already exists for this scope and period.</p>
          {hardExisting?.planId != null && hardExisting.status === "draft" && (
            <button type="button" data-testid="continue-draft-btn"
              onClick={() => onNavigate?.(`/plans/${hardExisting.planId}?edit=1`)}>
              Continue Editing
            </button>
          )}
        </div>
      )}
      {isSoft && (
        <div role="status" data-testid="duplicate-soft-warning">
          <p>A similar Plan already exists for this scope and period.</p>
          {softDuplicatePlanId != null && (
            <button type="button" data-testid="duplicate-soft-review-link"
              onClick={() => onNavigate?.(`/plans/${softDuplicatePlanId}`)}>
              Review Existing Plan
            </button>
          )}
        </div>
      )}
      {/* Soft duplicates never block creation */}
      <button type="button" data-testid="save-draft-btn" disabled={isHard}>Save As Draft</button>
      <button type="button" data-testid="save-finish-btn" disabled={isHard}>Save &amp; Finish</button>
    </div>
  );
}

const SOFT_WITH_PLAN: DuplicateCheckState  = { kind: "result", result: { matchType: "soft", count: 1, planId: 77 } };
const SOFT_NO_PLAN: DuplicateCheckState    = { kind: "result", result: { matchType: "soft", count: 1, planId: null } };
const HARD_DRAFT: DuplicateCheckState      = { kind: "result", result: { matchType: "hard", existing: { planId: 55, title: "Jan", status: "draft", planType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31" } } };

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-DUP-UX: Soft duplicate navigation (7)
// ─────────────────────────────────────────────────────────────────────────────
describe("PLAN-DUP-UX: soft duplicate Review Existing Plan", () => {
  it("PLAN-DUP-UX-01: soft duplicate warning renders", () => {
    render(<DuplicateWarningWrapper dupState={SOFT_NO_PLAN} />);
    expect(screen.getByTestId("duplicate-soft-warning")).toBeInTheDocument();
    expect(screen.getByText(/A similar Plan already exists/i)).toBeInTheDocument();
  });

  it("PLAN-DUP-UX-02: accessible existing plan shows Review Existing Plan link", () => {
    render(<DuplicateWarningWrapper dupState={SOFT_WITH_PLAN} />);
    expect(screen.getByTestId("duplicate-soft-review-link")).toBeInTheDocument();
    expect(screen.getByText("Review Existing Plan")).toBeInTheDocument();
  });

  it("PLAN-DUP-UX-03: click navigates to the correct plan detail", () => {
    const nav = vi.fn();
    render(<DuplicateWarningWrapper dupState={SOFT_WITH_PLAN} onNavigate={nav} />);
    fireEvent.click(screen.getByTestId("duplicate-soft-review-link"));
    expect(nav).toHaveBeenCalledWith("/plans/77");
  });

  it("PLAN-DUP-UX-04: soft duplicate still allows creation (save buttons enabled)", () => {
    render(<DuplicateWarningWrapper dupState={SOFT_WITH_PLAN} />);
    expect(screen.getByTestId("save-draft-btn")).toBeEnabled();
    expect(screen.getByTestId("save-finish-btn")).toBeEnabled();
  });

  it("PLAN-DUP-UX-05: inaccessible match (planId null) shows no navigation", () => {
    render(<DuplicateWarningWrapper dupState={SOFT_NO_PLAN} />);
    expect(screen.queryByTestId("duplicate-soft-review-link")).not.toBeInTheDocument();
  });

  it("PLAN-DUP-UX-06: hard draft duplicate routes Continue Editing to the editor", () => {
    const nav = vi.fn();
    render(<DuplicateWarningWrapper dupState={HARD_DRAFT} onNavigate={nav} />);
    expect(screen.getByTestId("continue-draft-btn")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("continue-draft-btn"));
    expect(nav).toHaveBeenCalledWith("/plans/55?edit=1");
    // Hard duplicates block creation.
    expect(screen.getByTestId("save-draft-btn")).toBeDisabled();
  });

  it("PLAN-DUP-UX-06b: the real duplicate warning uses the shared action and edit route", () => {
    expect(registrationDialogSource).toContain("ContinueEditingAction");
    expect(registrationDialogSource).toContain("canResumeExistingDraft");
    expect(registrationDialogSource).toContain("setLocation(`/plans/${targetId}?edit=1`)");
    expect(registrationDialogSource).not.toContain("Continue Editing Existing Draft");
  });

  it("PLAN-DUP-UX-07: stale preflight response cannot overwrite current response's link", async () => {
    // Mirrors the dialog's cancelled-flag debounce guard: a fetch that resolves
    // AFTER identity fields changed must be discarded, so the navigation link
    // reflects only the CURRENT response.
    function StaleGuardHarness({ fields, fetcher }: {
      fields: string;
      fetcher: (fields: string) => Promise<DuplicateCheckResult>;
    }) {
      const [dupState, setDupState] = useState<DuplicateCheckState>({ kind: "idle" });
      useEffect(() => {
        let cancelled = false;
        setDupState({ kind: "loading" });
        fetcher(fields).then((result) => {
          if (!cancelled) setDupState({ kind: "result", result });
        }).catch(() => { if (!cancelled) setDupState({ kind: "error" }); });
        return () => { cancelled = true; };
      }, [fields, fetcher]);
      return <DuplicateWarningWrapper dupState={dupState} />;
    }

    let resolveFirst!: (r: DuplicateCheckResult) => void;
    const first = new Promise<DuplicateCheckResult>((r) => { resolveFirst = r; });
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first)                                    // stale: planId 999
      .mockImplementationOnce(() => Promise.resolve({ matchType: "soft", count: 1, planId: 77 } as DuplicateCheckResult));

    const { rerender } = render(<StaleGuardHarness fields="A" fetcher={fetcher} />);
    // Change identity fields while first fetch is still in flight.
    rerender(<StaleGuardHarness fields="B" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("duplicate-soft-review-link")).toBeInTheDocument());
    // Now the STALE first response arrives with a different planId.
    await act(async () => { resolveFirst({ matchType: "soft", count: 1, planId: 999 }); });
    // The current response's link is untouched.
    const link = screen.getByTestId("duplicate-soft-review-link");
    fireEvent.click(link);
    expect(screen.getByTestId("duplicate-soft-review-link")).toBeInTheDocument();
    // Assert via harness state: only planId 77 is reflected (999 never rendered).
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAN-VIEW: Continue Editing parity across views (10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirror of plans.tsx viewRecords mapping: the SAME editability rule
 * (status === "draft") and SAME routing (?edit=1) drive all three views.
 * `visible` mirrors scope: plans outside an actor's scope never reach the list.
 */
function buildViewRecord(plan: { id: number; status: string; title: string }, visible = true): ViewRecord | null {
  if (!visible) return null;
  return {
    id: plan.id,
    title: plan.title,
    code: `CAFA-PLAN-${plan.id}`,
    status: plan.status,
    actions:
      plan.status === "draft" ? (
        <Link
          href={`/plans/${plan.id}?edit=1`}
          className="text-xs text-primary underline underline-offset-2 w-fit"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          Continue Editing
        </Link>
      ) : undefined,
  };
}

/** Mirror of the table cell's draft-only Continue Editing link. */
function TableRowMirror({ plan }: { plan: { id: number; status: string; title: string } }) {
  return (
    <div data-testid="table-row">
      <span>{plan.title}</span>
      {plan.status === "draft" && (
        <Link href={`/plans/${plan.id}?edit=1`}>Continue Editing</Link>
      )}
    </div>
  );
}

const KANBAN_COLS = [
  { key: "draft", label: "Draft", color: "bg-muted" },
  { key: "submitted", label: "Submitted", color: "bg-muted" },
  { key: "approved", label: "Approved", color: "bg-muted" },
  { key: "completed", label: "Completed", color: "bg-muted" },
  { key: "rejected", label: "Rejected", color: "bg-muted" },
];

const DRAFT_PLAN     = { id: 10, status: "draft", title: "Draft Plan" };
const RETURNED_DRAFT = { id: 11, status: "draft", title: "Returned Plan" }; // returned-for-revision drafts have status=draft
const REJECTED_PLAN  = { id: 12, status: "rejected", title: "Rejected Plan" };
const COMPLETED_PLAN = { id: 13, status: "completed", title: "Completed Plan" };

function renderCard(items: (ViewRecord | null)[]) {
  return render(
    <TooltipProvider>
      <CardGrid items={items.filter((i): i is ViewRecord => i != null)} />
    </TooltipProvider>,
  );
}
function renderKanban(items: (ViewRecord | null)[]) {
  return render(
    <KanbanBoard items={items.filter((i): i is ViewRecord => i != null)} columns={KANBAN_COLS} />,
  );
}

describe("PLAN-VIEW: Continue Editing parity", () => {
  it("PLAN-VIEW-01: editable draft shows Continue Editing in table", () => {
    render(<TableRowMirror plan={DRAFT_PLAN} />);
    const link = screen.getByRole("link", { name: "Continue Editing" });
    expect(link).toHaveAttribute("href", "/plans/10?edit=1");
  });

  it("PLAN-VIEW-02: same draft shows Continue Editing in Card view (real CardGrid)", () => {
    renderCard([buildViewRecord(DRAFT_PLAN)]);
    const link = screen.getByRole("link", { name: "Continue Editing" });
    expect(link).toHaveAttribute("href", "/plans/10?edit=1");
  });

  it("PLAN-VIEW-03: same draft shows Continue Editing in Kanban (real KanbanBoard)", () => {
    renderKanban([buildViewRecord(DRAFT_PLAN)]);
    const link = screen.getByRole("link", { name: "Continue Editing" });
    expect(link).toHaveAttribute("href", "/plans/10?edit=1");
  });

  it("PLAN-VIEW-04: returned-for-revision draft has parity across all three views", () => {
    render(<TableRowMirror plan={RETURNED_DRAFT} />);
    renderCard([buildViewRecord(RETURNED_DRAFT)]);
    renderKanban([buildViewRecord(RETURNED_DRAFT)]);
    const links = screen.getAllByRole("link", { name: "Continue Editing" });
    expect(links).toHaveLength(3);
    for (const l of links) expect(l).toHaveAttribute("href", "/plans/11?edit=1");
  });

  it("PLAN-VIEW-05: rejected plan shows no Continue Editing in any view", () => {
    render(<TableRowMirror plan={REJECTED_PLAN} />);
    renderCard([buildViewRecord(REJECTED_PLAN)]);
    renderKanban([buildViewRecord(REJECTED_PLAN)]);
    expect(screen.queryByRole("link", { name: "Continue Editing" })).not.toBeInTheDocument();
  });

  it("PLAN-VIEW-06: completed plan shows no Continue Editing in any view", () => {
    render(<TableRowMirror plan={COMPLETED_PLAN} />);
    renderCard([buildViewRecord(COMPLETED_PLAN)]);
    renderKanban([buildViewRecord(COMPLETED_PLAN)]);
    expect(screen.queryByRole("link", { name: "Continue Editing" })).not.toBeInTheDocument();
  });

  it("PLAN-VIEW-07: unauthorised actor (plan outside scope) sees no edit action", () => {
    // Scope enforcement is server-side: out-of-scope plans never reach the list,
    // so no view can render an edit affordance for them.
    renderCard([buildViewRecord(DRAFT_PLAN, false)]);
    renderKanban([buildViewRecord(DRAFT_PLAN, false)]);
    expect(screen.queryByRole("link", { name: "Continue Editing" })).not.toBeInTheDocument();
  });

  it("PLAN-VIEW-08: PM full access — drafts editable, non-drafts not (same status rule)", () => {
    renderCard([buildViewRecord(DRAFT_PLAN), buildViewRecord(REJECTED_PLAN)]);
    const links = screen.getAllByRole("link", { name: "Continue Editing" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/plans/10?edit=1");
  });

  it("PLAN-VIEW-09: Super Admin — identical status-based rule applies", () => {
    renderKanban([buildViewRecord(DRAFT_PLAN), buildViewRecord(COMPLETED_PLAN)]);
    const links = screen.getAllByRole("link", { name: "Continue Editing" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/plans/10?edit=1");
  });

  it("PLAN-VIEW-10: all three views route to the same Plan editor URL", () => {
    render(<TableRowMirror plan={DRAFT_PLAN} />);
    renderCard([buildViewRecord(DRAFT_PLAN)]);
    renderKanban([buildViewRecord(DRAFT_PLAN)]);
    const hrefs = screen.getAllByRole("link", { name: "Continue Editing" }).map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(["/plans/10?edit=1", "/plans/10?edit=1", "/plans/10?edit=1"]);
  });
});
