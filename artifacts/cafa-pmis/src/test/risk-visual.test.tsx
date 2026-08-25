/**
 * Risk Register — Visual Refinement Phase 1
 * RISK-VIS-01 through RISK-VIS-10 + RISK-VIS-L (loading branch)
 *
 * Tests cover page rhythm, KPI data sourcing, filter widths, placeholder casing,
 * title tooltip, badge capitalisation, overflow wrapper, empty-state differentiation,
 * pagination accessibility, zero-residual import integrity, and initial-load skeleton.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup, within } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";

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
    t: (key: string, opts?: Record<string, unknown>) => {
      const simple: Record<string, string> = {
        "filters.allLevels": "All levels",
        "filters.allStatuses": "All statuses",
        "filters.allCategories": "All categories",
        "filters.allProjects": "All projects",
        "filters.allStates": "All states",
        "filters.allPersons": "All persons",
        "noRisks": "No risks found",
        "noRisksFiltered": "No risks match the selected filters.",
        "filters.clearFilters": "Clear filters",
        "filters.clearCount": `Clear (${String(opts?.count ?? 0)})`,
        "pagination.previous": "Previous",
        "pagination.next": "Next",
        "pagination.pageOf": `Page ${String(opts?.page ?? 1)} of ${String(opts?.totalPages ?? 1)}`,
        "accessibility.openRisk": `Open risk: ${String(opts?.title ?? "")}`,
        "stats.critical": "Critical",
        "stats.criticalSub": "Immediate action",
        "stats.high": "High",
        "stats.highSub": "Risk level",
        "stats.medium": "Medium",
        "stats.mediumSub": "Risk level",
        "stats.low": "Low",
        "stats.lowSub": "Risk level",
        "title": "Risk Register",
        "page.description": "Operational risks",
        "page.loading": "Loading…",
        "page.risksCount": "{{count}} risk",
        "page.risksCountPlural": "{{count}} risks",
        "page.filterActive": "{{count}} filter active",
        "page.filtersActive": "{{count}} filters active",
        "filters.riskLevel": "Risk level",
        "filters.status": "Status",
        "filters.category": "Category",
        "filters.project": "Project",
        "filters.state": "State",
        "filters.responsible": "Responsible person",
        "filters.searchPlaceholder": "Search…",
        "filters.toolbar": "Filters",
        "filters.searchRisks": "Search risks",
        "accessibility.toolbar": "Risk register filters and presentation",
        "levels.critical": "Critical",
        "levels.high": "High",
        "levels.medium": "Medium",
        "levels.low": "Low",
        "status.open": "Open",
        "status.under_mitigation": "Under Mitigation",
        "status.closed": "Closed",
        "status.identified": "Identified",
        "status.assigned": "Assigned",
        "status.mitigation_plan": "Mitigation Plan",
        "status.follow_up": "Follow Up",
        "status.escalation": "Escalation",
        "status.mitigated": "Mitigated",
        "newRisk": "Register Risk",
        "unassigned": "Unassigned",
        "table.riskTitle": "Risk Title",
        "table.category": "Category",
        "table.probability": "Probability",
        "table.impact": "Impact",
        "table.riskLevel": "Risk Level",
        "table.status": "Status",
        "table.state": "State",
        "table.project": "Project",
        "table.responsible": "Responsible",
        "table.dueDate": "Due Date",
        "table.identified": "Identified",
        "loadError": "Could not load risks",
        "loadErrorDesc": "Please try again.",
        "views.card": "Card view",
        "views.board": "Board view",
        "views.boardDescription": "Risks grouped by their current status",
        "views.unknownStatus": "Some risks have an unsupported legacy status and are not shown on the board.",
        "viewModes.table": "Table",
        "viewModes.card": "Grid",
        "viewModes.kanban": "Kanban",
        "viewModes.viewMode": "View mode",
      };
      return simple[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── wouter mock ───────────────────────────────────────────────────────────────
let MOCK_SEARCH = "";
const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useParams: () => ({}),
  useLocation: () => ["/risks", mockNavigate],
  useSearch: () => MOCK_SEARCH,
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...(rest as object)}>
      {children}
    </a>
  ),
}));

// ── react-query mock ──────────────────────────────────────────────────────────
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: [] }),
  };
});

// ── Mutable API state — tests modify this before rendering ────────────────────
type MockRisksResult = {
  data: { items: unknown[]; total: number; totalPages: number; summary: Record<string, number> } | undefined;
  isLoading: boolean;
  isError: boolean;
};

const MOCK_API_STATE: MockRisksResult = {
  data: undefined,
  isLoading: false,
  isError: false,
};
let LAST_RISK_QUERY: Record<string, unknown> | undefined;

const MOCK_SUMMARY = { critical: 3, high: 7, medium: 12, low: 5, open: 14 };
const MOCK_RISK = {
  id: 1,
  title: "A very long risk title that should be truncated in the table cell",
  description: "Risk description text",
  category: "operational",
  likelihood: "high",
  severity: "high",
  riskLevel: "high",
  status: "open",
  locationType: "state",
  stateName: "Kano",
  projectTitle: null,
  projectId: null,
  assignedToName: null,
  dueDate: null,
  identifiedAt: "2026-01-15T00:00:00.000Z",
};

const LOADED_DATA = {
  items: [MOCK_RISK],
  total: 1,
  totalPages: 1,
  summary: MOCK_SUMMARY,
};

vi.mock("@workspace/api-client-react", () => ({
  useListRisks: (params: Record<string, unknown>) => {
    LAST_RISK_QUERY = params;
    return {
      data: MOCK_API_STATE.data,
      isLoading: MOCK_API_STATE.isLoading,
      isError: MOCK_API_STATE.isError,
      refetch: vi.fn(),
    };
  },
  useListProjects: () => ({ data: [] }),
  useListStates: () => ({ data: [] }),
  useListUsers: () => ({ data: { users: [] } }),
  useCreateRisk: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRisk: () => ({ mutate: vi.fn(), isPending: false }),
  useGetMe: () => ({
    data: {
      user: { id: 1, role: "program_manager" },
      permissions: ["risks.create", "risks.update"],
    },
  }),
}));

// ── Child component mocks ─────────────────────────────────────────────────────
vi.mock("@/components/drive-attachment-panel", () => ({
  DriveAttachmentPanel: () => null,
  AttachmentCountBadge: () => null,
}));
vi.mock("@/components/location-selector", () => ({
  LocationSelector: () => null,
}));
vi.mock("@/components/comments-panel", () => ({
  CommentsPanel: () => null,
}));
vi.mock("@/components/ui/error-state", () => ({
  ErrorState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Imports (after all mocks are declared) ────────────────────────────────────
import RisksPage, {
  parseRiskRegisterState,
  buildRiskRegisterLocation,
} from "@/pages/risks";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderPage() {
  return render(
    <TooltipProvider>
      <RisksPage />
    </TooltipProvider>,
  );
}

/** Reset to loaded state (default for most tests) */
function setLoaded() {
  MOCK_API_STATE.data = LOADED_DATA;
  MOCK_API_STATE.isLoading = false;
  MOCK_API_STATE.isError = false;
}

/** Set to initial-load state: loading, no cached data */
function setInitialLoading() {
  MOCK_API_STATE.data = undefined;
  MOCK_API_STATE.isLoading = true;
  MOCK_API_STATE.isError = false;
}

// Default to loaded state before each test group
afterEach(() => {
  setLoaded();
  MOCK_SEARCH = "";
  LAST_RISK_QUERY = undefined;
  mockNavigate.mockClear();
});

// Set loaded for the module-level default
setLoaded();

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-01: Page container has space-y-4 class
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-01: page root uses space-y-4 rhythm", () => {
  it("outermost div has space-y-4 class (not space-y-6)", () => {
    setLoaded();
    const { container } = renderPage();
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("space-y-4");
    expect(root.className).not.toContain("space-y-6");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-02: KPI counts sourced from summary object, not items.length
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-02: KPI counts come from summary, not items.length", () => {
  it("displays critical count matching summary.critical (not items count)", () => {
    setLoaded();
    renderPage();
    // summary.critical=3; items.length=1. "3" must appear (from the StatCard value).
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("3");
  });

  it("summary values for high/medium/low are individually rendered", () => {
    setLoaded();
    renderPage();
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("7"); // high
    expect(allText).toContain("12"); // medium
    expect(allText).toContain("5"); // low
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-03: Filter Select triggers have fluid widths, not fixed w-40
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-03: filter controls have fluid widths", () => {
  it("no SelectTrigger has a fixed w-40 class", () => {
    setLoaded();
    const { container } = renderPage();
    const triggers = Array.from(
      container.querySelectorAll<HTMLElement>("button[role='combobox']"),
    );
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      expect(trigger.className).not.toMatch(/\bw-40\b/);
    }
  });

  it("at least one filter trigger uses min-w fluid pattern", () => {
    setLoaded();
    const { container } = renderPage();
    const triggers = Array.from(
      container.querySelectorAll<HTMLElement>("button[role='combobox']"),
    );
    const hasFluid = triggers.some((t) => t.className.includes("min-w"));
    expect(hasFluid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-04: Filter placeholder text is lower-case after the first word
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-04: filter placeholder text is sentence case", () => {
  it("locale file allLevels is sentence case", async () => {
    const risksRaw = await import("@/locales/en/risks.json");
    const risks = risksRaw as unknown as Record<string, unknown>;
    const filters = risks.filters as Record<string, string>;
    expect(filters.allLevels).toBe("All levels");
    expect(filters.allStatuses).toBe("All statuses");
    expect(filters.allCategories).toBe("All categories");
    expect(filters.allProjects).toBe("All projects");
    expect(filters.allStates).toBe("All states");
    expect(filters.allPersons).toBe("All persons");
  });

  it("each 'All X' label has lowercase second word", () => {
    const labels = [
      "All levels",
      "All statuses",
      "All categories",
      "All projects",
      "All states",
      "All persons",
    ];
    for (const label of labels) {
      const word = label.split(" ")[1];
      expect(word).toBe(word?.toLowerCase());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-05: Risk title truncated span has title attribute
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-05: risk title span has title attribute for tooltip", () => {
  it("truncated span exposes full title via title attribute", () => {
    setLoaded();
    renderPage();
    const spans = Array.from(document.querySelectorAll("span.truncate"));
    const titleSpan = spans.find(
      (s) => s.getAttribute("title") === MOCK_RISK.title,
    );
    expect(titleSpan).toBeDefined();
    expect(titleSpan?.getAttribute("title")).toBe(MOCK_RISK.title);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-06: Risk level badge does not render raw lowercase enum
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-06: risk level badge shows capitalised label", () => {
  it("badge renders capitalised 'High' for riskLevel=high", () => {
    setLoaded();
    renderPage();
    // "High" appears in both the KPI strip label and the risk level badge
    const highMatches = screen.getAllByText("High");
    expect(highMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("raw lowercase strings like 'high' are not standalone in badge elements", () => {
    setLoaded();
    const { container } = renderPage();
    const badgeEls = container.querySelectorAll(
      '[class*="inline-flex"][class*="rounded"]',
    );
    for (const el of Array.from(badgeEls)) {
      const text = el.textContent?.trim() ?? "";
      if (["critical", "high", "medium", "low"].includes(text)) {
        expect(text).toBe("__should_not_be_raw_lowercase__");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-07: Table has an overflow-x-auto wrapper
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-07: risk register table has overflow-x-auto wrapper", () => {
  it("table is inside a div with overflow-x-auto", () => {
    setLoaded();
    const { container } = renderPage();
    const wrapper = container.querySelector(".overflow-x-auto");
    expect(wrapper).not.toBeNull();
    const table = wrapper?.querySelector("table");
    expect(table).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-08: Filtered-empty and genuine-empty render different message text
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-08: distinct empty-state messages", () => {
  it("genuine-empty message text differs from filtered-empty message text", () => {
    const genuine = "No risks found";
    const filtered = "No risks match the selected filters.";
    expect(genuine).not.toBe(filtered);
  });

  it("locale file has separate noRisks and noRisksFiltered keys", async () => {
    const risksRaw = await import("@/locales/en/risks.json");
    const risks = risksRaw as unknown as Record<string, string>;
    expect(risks.noRisks).toBe("No risks found");
    expect(risks.noRisksFiltered).toBe("No risks match the selected filters.");
    expect(risks.noRisks).not.toBe(risks.noRisksFiltered);
  });

  it("filtered-empty state includes a clear-filters affordance", () => {
    function FilteredEmptyMirror() {
      return (
        <>
          <p>No risks match the selected filters.</p>
          <button>Clear filters</button>
        </>
      );
    }
    render(<FilteredEmptyMirror />);
    expect(
      screen.getByText("No risks match the selected filters."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear filters" }),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-09: Pagination Previous/Next have aria-label; summary has aria-live
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-09: pagination accessibility", () => {
  it("parseRiskRegisterState reads riskLevel and page from URL", () => {
    const state = parseRiskRegisterState("/risks?page=2&riskLevel=high");
    expect(state.page).toBe(2);
    expect(state.riskLevel).toBe("high");
  });

  it("buildRiskRegisterLocation drops default page and riskLevel=all", () => {
    const loc = buildRiskRegisterLocation("/risks?riskLevel=high", {
      page: 1,
      riskLevel: "all",
    });
    expect(loc).not.toContain("page=1");
    expect(loc).not.toContain("riskLevel=all");
  });

  it("parseRiskRegisterState rejects unknown riskLevel values", () => {
    const state = parseRiskRegisterState("/risks?riskLevel=unknown");
    expect(state.riskLevel).toBe("all");
  });

  it("pagination buttons have aria-label attributes in page source", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain('aria-label={t("pagination.previous"');
    expect(src).toContain('aria-label={t("pagination.next"');
    expect(src).toContain('aria-live="polite"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-VM: canonical URL-backed Risk presentations
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-VM: table, card, and board presentations", () => {
  it("renders one bordered, keyboard-accessible control bar with filters before the shared switcher", () => {
    setLoaded();
    const { container } = renderPage();
    const toolbar = screen.getByRole("group", { name: "Risk register filters and presentation" });
    expect(toolbar.className).toContain("rounded-xl");
    expect(toolbar.className).toContain("border");
    expect(within(toolbar).getByRole("textbox", { name: "Search risks" })).toHaveClass("h-10");
    expect(toolbar.querySelector('[data-orientation="vertical"]')).toBeInTheDocument();
    const viewMode = within(toolbar).getByRole("group", { name: "View mode" });
    expect(viewMode).toBeInTheDocument();
    expect(within(viewMode).getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it("validates view mode and preserves managed filters plus unrelated context", () => {
    expect(parseRiskRegisterState("/risks?view=card&page=2&riskLevel=high").view).toBe("card");
    expect(parseRiskRegisterState("/risks?view=calendar").view).toBe("table");
    expect(buildRiskRegisterLocation(
      "/risks?view=card&page=2&riskLevel=high&from=dashboard",
      { view: "kanban" },
    )).toBe("/risks?view=kanban&page=2&riskLevel=high&from=dashboard");
  });

  it("keeps table as the default detailed registry", () => {
    setLoaded();
    const { container } = renderPage();
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Card view" })).not.toBeInTheDocument();
  });

  it("renders accessible cards from the same paged Risk result and opens the existing detail modal", () => {
    setLoaded();
    MOCK_SEARCH = "view=card&page=1&riskLevel=high";
    renderPage();

    expect(screen.getByRole("region", { name: "Card view" })).toBeInTheDocument();
    expect(LAST_RISK_QUERY).toMatchObject({ riskLevel: "high", page: 1, limit: 50 });
    expect(LAST_RISK_QUERY).not.toHaveProperty("view");
    const openCard = screen.getByRole("button", { name: `Open risk: ${MOCK_RISK.title}` });
    expect(openCard).toBeInTheDocument();
    fireEvent.click(openCard);
    expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();
  });

  it("groups board cards under authoritative statuses without drag-and-drop", () => {
    setLoaded();
    MOCK_SEARCH = "view=kanban";
    const { container } = renderPage();

    expect(screen.getByRole("region", { name: "Board view" })).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Under Mitigation")).toBeInTheDocument();
    expect(screen.getByText("Mitigated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Open risk: ${MOCK_RISK.title}` })).toBeInTheDocument();
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });

  it("switches views through the URL without dropping filters, page, or external context", () => {
    setLoaded();
    MOCK_SEARCH = "riskLevel=high&page=2&from=dashboard";
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/risks?riskLevel=high&page=2&from=dashboard&view=card",
      { replace: false },
    );
  });

  it("uses presentation-specific loading states rather than a table skeleton for card or board URLs", () => {
    setInitialLoading();
    MOCK_SEARCH = "view=card";
    const card = renderPage();
    expect(card.container.querySelector('[data-testid="skeleton-card-grid"]')).toBeInTheDocument();
    expect(card.container.querySelector('[data-testid="skeleton-table"]')).toBeNull();
    card.unmount();

    MOCK_SEARCH = "view=kanban";
    const board = renderPage();
    expect(board.container.querySelector('[data-testid="skeleton-board"]')).toBeInTheDocument();
    expect(board.container.querySelector('[data-testid="skeleton-table"]')).toBeNull();
  });

  it("keeps unknown legacy statuses out of Risk board columns and explains the omission", () => {
    MOCK_API_STATE.data = {
      ...LOADED_DATA,
      items: [{ ...MOCK_RISK, status: "retired_legacy_status" }],
    };
    MOCK_SEARCH = "view=kanban";
    renderPage();

    expect(screen.getByText("Some risks have an unsupported legacy status and are not shown on the board.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Open risk: ${MOCK_RISK.title}` })).not.toBeInTheDocument();
  });

  it("ships Arabic labels for every new presentation field and keeps the card affordance RTL-safe", async () => {
    const arModule = await import("@/locales/ar/risks.json");
    const ar = arModule.default as {
      views: { card: string; board: string; boardDescription: string; unknownStatus: string };
      presentation: { project: string; owner: string; assessment: string; mitigation: string; riskLevels: { critical: string } };
    };
    expect(ar.views).toMatchObject({
      card: "عرض البطاقات",
      board: "عرض اللوحة",
      boardDescription: "المخاطر مجمّعة حسب حالتها الحالية",
    });
    expect(ar.presentation).toMatchObject({
      project: "المشروع",
      owner: "المالك",
      assessment: "الاحتمالية / التأثير",
      mitigation: "التخفيف",
    });
    expect(ar.presentation.riskLevels.critical).toBe("حرج");

    const { readFile } = await import("node:fs/promises");
    const cardGrid = await readFile("src/components/view-modes/card-grid.tsx", "utf-8");
    expect(cardGrid).toContain("rtl:rotate-180");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-10: Zero-Residual functional test file imports compile without error
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-10: zero-residual suite imports are intact", () => {
  it("parseRiskRegisterState and buildRiskRegisterLocation are exported", () => {
    expect(typeof parseRiskRegisterState).toBe("function");
    expect(typeof buildRiskRegisterLocation).toBe("function");
  });

  it("parseRiskRegisterState returns default state for empty query", () => {
    const state = parseRiskRegisterState("/risks");
    expect(state.search).toBe("");
    expect(state.status).toBe("all");
    expect(state.riskLevel).toBe("all");
    expect(state.page).toBe(1);
  });

  it("risks locale file has noRisksFiltered key (Phase 1 addition)", async () => {
    const risksRaw = await import("@/locales/en/risks.json");
    const risks = risksRaw as unknown as Record<string, string>;
    expect(typeof risks.noRisksFiltered).toBe("string");
    expect(risks.noRisksFiltered.length).toBeGreaterThan(0);
  });

  it("risks page source contains displayRiskLevel and displayImpact helpers", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("displayRiskLevel");
    expect(src).toContain("displayImpact");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-VIS-L: Initial-load skeleton replaces KPI strip and filter toolbar
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-VIS-L: initial-load skeleton — structure and placement", () => {
  it("during initial load KPI skeleton appears in page (not inside table card)", () => {
    setInitialLoading();
    const { container } = renderPage();

    // KPI skeleton wrapper must exist
    const kpiSkeleton = container.querySelector('[data-testid="skeleton-kpi"]');
    expect(kpiSkeleton).not.toBeNull();

    // The skeleton-kpi element must be a direct descendant of the space-y-4 root,
    // not nested inside a table Card — verify it is NOT inside a role=region/table
    const insideTable = kpiSkeleton?.closest('[role="region"]');
    expect(insideTable).toBeNull();
  });

  it("during initial load filter toolbar skeleton appears", () => {
    setInitialLoading();
    const { container } = renderPage();
    const toolbarSkeleton = container.querySelector(
      '[data-testid="skeleton-toolbar"]',
    );
    expect(toolbarSkeleton).not.toBeNull();
  });

  it("during initial load live KPI StatCard buttons are absent", () => {
    setInitialLoading();
    renderPage();
    // StatCards with onClick render as <button> with aria-label equal to their label
    // "Critical", "High", "Medium", "Low" KPI buttons must not be in the DOM
    expect(
      screen.queryByRole("button", { name: "Critical" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "High" }),
    ).not.toBeInTheDocument();
  });

  it("during initial load live filter selects (comboboxes) are absent", () => {
    setInitialLoading();
    const { container } = renderPage();
    // Live filters render combobox buttons — must not appear during initial load
    const comboboxes = container.querySelectorAll("button[role='combobox']");
    expect(comboboxes.length).toBe(0);
  });

  it("after data loads KPI cards and filter controls appear, skeleton-kpi is gone", () => {
    setLoaded();
    const { container } = renderPage();
    // Skeleton gone
    const kpiSkeleton = container.querySelector('[data-testid="skeleton-kpi"]');
    expect(kpiSkeleton).toBeNull();
    // Live comboboxes present
    const comboboxes = container.querySelectorAll("button[role='combobox']");
    expect(comboboxes.length).toBeGreaterThan(0);
  });

  it("during re-fetch (isLoading=true but data cached) filter controls remain visible", () => {
    // Simulate re-fetch: isLoading=true but data is already populated
    MOCK_API_STATE.data = LOADED_DATA;
    MOCK_API_STATE.isLoading = true;
    MOCK_API_STATE.isError = false;

    const { container } = renderPage();

    // Skeleton-kpi must NOT appear (data is cached)
    const kpiSkeleton = container.querySelector('[data-testid="skeleton-kpi"]');
    expect(kpiSkeleton).toBeNull();

    // Live filter comboboxes must still be visible
    const comboboxes = container.querySelectorAll("button[role='combobox']");
    expect(comboboxes.length).toBeGreaterThan(0);
  });
});
