/**
 * Risk Register — Form Visual Sentinels (Phase 2)
 * RISK-FORM-VIS-01 through RISK-FORM-VIS-10
 *
 * Verifies the visual refinement requirements for the Create dialog and
 * Edit sheet: section headings, responsive grids, textarea resize, category
 * labels, footer order, skeleton, label associations, and Phase 1 import
 * integrity.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { readFile } from "node:fs/promises";

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
      const map: Record<string, string> = {
        "fields.title": "Risk Title",
        "fields.titlePh": "Brief risk description",
        "fields.description": "Detailed Description",
        "fields.descriptionPh": "Detailed description…",
        "fields.probability": "Probability",
        "fields.impact": "Impact",
        "fields.category": "Category",
        "fields.status": "Status",
        "fields.responsiblePerson": "Responsible person",
        "fields.linkedProject": "Linked project",
        "fields.mitigationAction": "Mitigation Action",
        "fields.mitigationPh": "Mitigation steps…",
        "fields.dueDate": "Due Date",
        "fields.state": "State",
        "sections.riskIdentification": "Risk identification",
        "sections.riskAssessment": "Risk assessment",
        "sections.ownershipFollowUp": "Ownership & follow-up",
        "form.cancel": "Cancel",
        "status.open": "Open",
        "status.under_mitigation": "Under Mitigation",
        "status.closed": "Closed",
        "unassigned": "Unassigned",
        "newRisk": "Register Risk",
        "registerRisk": "Register Risk",
        "registering": "Registering…",
        "saving": "Saving…",
        "saveChanges": "Save Changes",
        "editingRisk": "Editing risk",
        "page.registerNewRisk": "Register New Risk",
        "page.registerNewRiskDesc": "Add a risk to the central register.",
        "noRisks": "No risks found",
        "noRisksFiltered": "No risks match the selected filters.",
        "loadError": "Could not load risks",
        "loadErrorDesc": "Please try again.",
        "title": "Risk Register",
        "page.description": "Operational risks",
        "page.loading": "Loading…",
        "stats.critical": "Critical",
        "stats.criticalSub": "Immediate action",
        "stats.high": "High",
        "stats.highSub": "Risk level",
        "stats.medium": "Medium",
        "stats.mediumSub": "Risk level",
        "stats.low": "Low",
        "stats.lowSub": "Risk level",
        "filters.searchPlaceholder": "Search…",
        "filters.allLevels": "All levels",
        "filters.allStatuses": "All statuses",
        "filters.allCategories": "All categories",
        "filters.allProjects": "All projects",
        "filters.allStates": "All states",
        "filters.allPersons": "All persons",
        "pagination.previous": "Previous",
        "pagination.next": "Next",
        "detail.tabDetails": "Details",
        "detail.tabComments": "Comments",
        "detail.tabHistory": "History",
        "detail.tabAttachments": "Attachments",
        "detail.category": "Category",
        "detail.status": "Status",
        "detail.probability": "Probability",
        "detail.impact": "Impact",
        "detail.riskLevel": "Risk Level",
        "detail.responsiblePerson": "Responsible Person",
        "detail.dateIdentified": "Date Identified",
        "detail.dueDate": "Due Date",
        "detail.description": "Description",
        "detail.mitigationAction": "Mitigation Action",
        "detail.editRisk": "Edit Risk",
      };
      if (opts?.count !== undefined) return `${String(opts.count)} items`;
      if (opts?.page !== undefined) return `Page ${String(opts.page)} of ${String(opts.totalPages ?? 1)}`;
      return map[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ── wouter mock ───────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useParams: () => ({}),
  useLocation: () => ["/risks", vi.fn()],
  useSearch: () => "",
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...(rest as object)}>{children}</a>
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

// ── API mock ──────────────────────────────────────────────────────────────────
const LOADED_DATA = {
  items: [],
  total: 0,
  totalPages: 1,
  summary: { critical: 0, high: 0, medium: 0, low: 0, open: 0 },
};

vi.mock("@workspace/api-client-react", () => ({
  useListRisks: () => ({ data: LOADED_DATA, isLoading: false, isError: false, refetch: vi.fn() }),
  useListProjects: () => ({ data: [{ id: 10, code: "PRJ-001", title: "Health Programme" }] }),
  useListStates: () => ({ data: [{ id: 1, name: "Kano" }] }),
  useListUsers: () => ({ data: [{ id: 1, name: "Alice", role: "program_manager", status: "active" }] }),
  useCreateRisk: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRisk: () => ({ mutate: vi.fn(), isPending: false }),
  useGetMe: () => ({
    data: {
      user: { id: 99, role: "program_manager" },
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
  LocationSelector: () => <div data-testid="location-selector" />,
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

// ── Imports (after all mocks) ─────────────────────────────────────────────────
import RisksPage from "@/pages/risks";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderPage() {
  return render(
    <TooltipProvider>
      <RisksPage />
    </TooltipProvider>,
  );
}

async function openCreateDialog() {
  renderPage();
  const trigger = screen.getByRole("button", { name: /Register Risk/i });
  fireEvent.click(trigger);
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-01: Create DialogContent has section heading elements rendered
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-01: Create dialog has section heading elements", () => {
  it("source contains section heading text for all three sections", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain('t("sections.riskIdentification")');
    expect(src).toContain('t("sections.riskAssessment")');
    expect(src).toContain('t("sections.ownershipFollowUp")');
  });

  it("section headings use font-semibold class", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    const sectionMatches = src.match(/text-sm font-semibold text-foreground/g) ?? [];
    // Should appear for all sections in both create and edit forms
    expect(sectionMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("section headings have border-b separator treatment", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("border-b border-border/40 pb-1 mb-3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-02: DialogContent max-width is max-w-2xl or larger
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-02: Create dialog is max-w-2xl (not max-w-xl)", () => {
  it("DialogContent uses max-w-2xl", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // The create dialog should be max-w-2xl
    expect(src).toContain("max-w-2xl max-h-[90vh] overflow-y-auto");
  });

  it("DialogContent does not use max-w-xl alone (the old narrow width)", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // max-w-xl should not appear as the dialog width (it was the old value)
    const dialogContentMatch = src.match(/DialogContent className="([^"]+)"/);
    if (dialogContentMatch) {
      expect(dialogContentMatch[1]).not.toBe("max-w-xl max-h-[90vh] overflow-y-auto");
    }
    // Record detail sizing is owned by the shared modal, not this create dialog.
    expect(src).not.toContain('"max-w-xl max-h-[90vh] overflow-y-auto"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-03: Short-field wrappers include a max-w constraint
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-03: Short structured fields have max-w constraints", () => {
  it("source contains max-w-xs wrappers for short fields", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    const maxWXsCount = (src.match(/max-w-xs/g) ?? []).length;
    // Likelihood, Impact (create), Due Date (create+edit), Likelihood, Impact (edit)
    expect(maxWXsCount).toBeGreaterThanOrEqual(4);
  });

  it("due date inputs are wrapped in max-w-xs containers", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // Check that due date sections have max-w-xs
    expect(src).toContain('className="max-w-xs"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-04: Narrative Textareas have resize-y class
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-04: Narrative textarea fields have resize-y", () => {
  it("all Textarea elements in the forms have resize-y class", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    const textareaMatches = src.match(/<Textarea[^/]*className="[^"]*resize-y[^"]*"/g) ?? [];
    // description (create), mitigationPlan (create), description (edit), mitigationPlan (edit)
    expect(textareaMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("no Textarea in the form sections lacks resize-y", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // Check that each Textarea in the form has resize-y
    // We look for Textarea with register() but without resize-y (would be a miss)
    const textareasWithRegister = src.match(/<Textarea rows=\{[23]\}[^>]*>/g) ?? [];
    for (const ta of textareasWithRegister) {
      expect(ta).toContain("resize-y");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-05: Category SelectItems render human-readable labels, not raw lowercase
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-05: Category SelectItems use displayCategory(), not raw enum", () => {
  it("displayCategory function is defined in source", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("function displayCategory(");
  });

  it("displayCategory maps all 5 canonical category values to title-case labels", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("security: \"Security\"");
    expect(src).toContain("operational: \"Operational\"");
    expect(src).toContain("financial: \"Financial\"");
    expect(src).toContain("programmatic: \"Programmatic\"");
    expect(src).toContain("environmental: \"Environmental\"");
  });

  it("category SelectItems use displayCategory(c) not raw c with className capitalize", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // Category labels are resolved through the canonical i18n presentation map,
    // with the legacy formatter as an English fallback.
    expect(src).toContain("displayCategory(c)");
    const formCategoryLabels = src.match(/CATEGORIES\.map\(\(c\) => <SelectItem key=\{c\} value=\{c\}>\{t\(`presentation\.categories\.\$\{c\}`, \{ defaultValue: displayCategory\(c\) \}\)\}<\/SelectItem>\)/g) ?? [];
    expect(formCategoryLabels).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-06: Create form contains no editable Status Select
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-06: Create form has no status field (status defaults to open)", () => {
  it("create dialog source section has no status select", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // The create dialog must not have an id create-status
    expect(src).not.toContain('"create-status"');
    expect(src).not.toContain("'create-status'");
  });

  it("defaultValues in createForm sets severity (not a user-editable status)", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("severity: \"medium\"");
    // status is not in createForm defaultValues (server defaults to open)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-07: Edit footer has Cancel before Save (DOM order)
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-07: Edit footer Cancel button appears before Save button in source", () => {
  it("in the edit form footer, Cancel appears before Save Changes in source order", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    const editFormStart = src.indexOf('"edit-title"');
    const editFormEnd = src.indexOf("</form>", editFormStart);
    const editFormSrc = src.slice(editFormStart, editFormEnd);
    const cancelIdx = editFormSrc.indexOf('t("form.cancel")');
    const saveIdx = editFormSrc.indexOf('t("saveChanges")');
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeLessThan(saveIdx);
  });

  it("edit footer Cancel is variant=outline (left/secondary action)", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    const editFormStart = src.indexOf('"edit-title"');
    const editFormEnd = src.indexOf("</form>", editFormStart);
    const editFormSrc = src.slice(editFormStart, editFormEnd);
    // The Cancel button should be variant="outline"
    expect(editFormSrc).toContain('<Button type="button" variant="outline"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-08: Edit loading state renders skeleton when form is not populated
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-08: Edit mode renders skeleton during isResetting phase", () => {
  it("isResetting state variable is declared in RiskDetailModal", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("isResetting");
    expect(src).toContain("setIsResetting");
  });

  it("skeleton is rendered when isResetting is true (aria-busy)", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain('aria-busy="true"');
  });

  it("skeleton uses Skeleton components with appropriate size classes", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // The edit skeleton should have multiple Skeleton elements
    const skeletonMatches = src.match(/<Skeleton className="h-10 rounded-md"/g) ?? [];
    expect(skeletonMatches.length).toBeGreaterThanOrEqual(4);
  });

  it("skeleton remains until the next animation frame for a visible populate phase", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("requestAnimationFrame(() => setIsResetting(false))");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-09: All Labels have htmlFor matching a control id
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-09: Labels have htmlFor and controls have matching id", () => {
  it("create form labels have htmlFor attributes", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    // Verify create form field id/htmlFor pairs exist
    expect(src).toContain('htmlFor="create-title"');
    expect(src).toContain('id="create-title"');
    expect(src).toContain('htmlFor="create-description"');
    expect(src).toContain('id="create-description"');
    expect(src).toContain('htmlFor="create-category"');
    expect(src).toContain('id="create-category"');
    expect(src).toContain('htmlFor="create-location"');
    expect(src).toContain('id="create-location"');
    expect(src).toContain('htmlFor="create-likelihood"');
    expect(src).toContain('id="create-likelihood"');
    expect(src).toContain('htmlFor="create-impact"');
    expect(src).toContain('id="create-impact"');
    expect(src).toContain('htmlFor="create-due-date"');
    expect(src).toContain('id="create-due-date"');
    expect(src).toContain('htmlFor="create-mitigation"');
    expect(src).toContain('id="create-mitigation"');
  });

  it("edit form labels have htmlFor attributes", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain('htmlFor="edit-title"');
    expect(src).toContain('id="edit-title"');
    expect(src).toContain('htmlFor="edit-description"');
    expect(src).toContain('id="edit-description"');
    expect(src).toContain('htmlFor="edit-category"');
    expect(src).toContain('id="edit-category"');
    expect(src).toContain('htmlFor="edit-status"');
    expect(src).toContain('id="edit-status"');
    expect(src).toContain('htmlFor="edit-likelihood"');
    expect(src).toContain('id="edit-likelihood"');
    expect(src).toContain('htmlFor="edit-impact"');
    expect(src).toContain('id="edit-impact"');
    expect(src).toContain('htmlFor="edit-due-date"');
    expect(src).toContain('id="edit-due-date"');
    expect(src).toContain('htmlFor="edit-mitigation"');
    expect(src).toContain('id="edit-mitigation"');
  });

  it("create form renders labels with correct text when dialog is opened", async () => {
    await openCreateDialog();
    // Key labels should be visible after the dialog is opened
    expect(screen.getByText("Risk identification")).toBeInTheDocument();
    expect(screen.getByText("Risk assessment")).toBeInTheDocument();
    expect(screen.getByText("Ownership & follow-up")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-FORM-VIS-10: Phase 1 RISK-VIS suite imports compile without error
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-FORM-VIS-10: Phase 1 RISK-VIS sentinels remain intact", () => {
  it("Phase 1 test file exists and exports are intact", async () => {
    const src = await readFile("src/test/risk-visual.test.tsx", "utf-8");
    expect(src).toContain("RISK-VIS-01");
    expect(src).toContain("RISK-VIS-10");
    expect(src).toContain("parseRiskRegisterState");
    expect(src).toContain("buildRiskRegisterLocation");
  });

  it("parseRiskRegisterState is still exported from risks.tsx", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("export function parseRiskRegisterState");
  });

  it("buildRiskRegisterLocation is still exported from risks.tsx", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain("export function buildRiskRegisterLocation");
  });

  it("risks locale file has editingRisk key (Phase 2 addition)", async () => {
    const risksRaw = await import("@/locales/en/risks.json");
    const risks = risksRaw as unknown as Record<string, string>;
    expect(typeof risks.editingRisk).toBe("string");
    expect(risks.editingRisk).toBe("Editing risk");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK-DETAIL-VIS: Shared record-detail layout contract
// ─────────────────────────────────────────────────────────────────────────────
describe("RISK-DETAIL-VIS: risk detail uses the shared wide rail without changing behaviour", () => {
  it("risk detail tabs fill the shared rail and keep their own tab overflow", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain('<Tabs defaultValue="details" className="w-full min-w-0">');
    expect(src).toContain('className="mb-4 w-full overflow-x-auto pb-1"');
  });

  it("risk detail metadata is responsive while narrative fields keep local readable measures", async () => {
    const src = await readFile("src/pages/risks.tsx", "utf-8");
    expect(src).toContain('grid gap-x-6 gap-y-4 text-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-4');
    expect(src).toContain('className="max-w-2xl"');
  });
});
