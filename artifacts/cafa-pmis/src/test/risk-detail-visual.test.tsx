/**
 * Risk Register Detail — Visual Refinement Phase 3
 * RISK-DETAIL-VIS-01 through RISK-DETAIL-VIS-10
 *
 * These tests protect the read-only Risk Detail sheet and its shared operational
 * panels without changing their data, permission, or storage contracts.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import { readFile } from "node:fs/promises";

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
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, media: "", onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        title: "Risk Register", "page.description": "Operational risks",
        "page.loading": "Loading…", "page.risksCount": "risk", "page.risksCountPlural": "risks",
        "stats.critical": "Critical", "stats.criticalSub": "Immediate action",
        "stats.high": "High", "stats.highSub": "Risk level",
        "stats.medium": "Medium", "stats.mediumSub": "Risk level",
        "stats.low": "Low", "stats.lowSub": "Risk level",
        "filters.searchPlaceholder": "Search risks", "filters.allLevels": "All levels",
        "filters.allStatuses": "All statuses", "filters.allCategories": "All categories",
        "filters.allProjects": "All projects", "filters.allStates": "All states",
        "filters.allPersons": "All persons", "newRisk": "Register Risk",
        "table.riskTitle": "Risk title", "table.category": "Category",
        "table.probability": "Probability", "table.impact": "Impact",
        "table.riskLevel": "Risk level", "table.status": "Status", "table.state": "State",
        "table.project": "Project", "table.responsible": "Responsible",
        "table.dueDate": "Due date", "table.identified": "Identified",
        "detail.tabDetails": "Details", "detail.tabComments": "Comments",
        "detail.tabHistory": "History", "detail.tabAttachments": "Attachments",
        "detail.category": "Category", "detail.status": "Status",
        "detail.probability": "Probability", "detail.impact": "Impact",
        "detail.riskLevel": "Risk level", "detail.responsiblePerson": "Responsible person",
        "detail.dateIdentified": "Date identified", "detail.dueDate": "Due date",
        "detail.description": "Description", "detail.mitigationAction": "Mitigation action",
        "detail.editRisk": "Edit risk", unassigned: "Unassigned",
        "status.open": "Open", "status.under_mitigation": "Under Mitigation",
        "status.closed": "Closed", "status.identified": "Identified",
        "status.assigned": "Assigned", "status.mitigation_plan": "Mitigation Plan",
        "status.follow_up": "Follow Up", "status.escalation": "Escalation",
        "status.mitigated": "Mitigated",
        "pagination.previous": "Previous", "pagination.next": "Next",
        "history.noHistory": "No history recorded yet.", "history.system": "System",
        "projectRemoved": "[Project removed]",
      };
      if (key === "accessibility.openRisk") return `Open risk: ${String(options?.title ?? "")}`;
      return labels[key] ?? options?.defaultValue as string ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/risks", vi.fn()],
  useSearch: () => "",
  useParams: () => ({}),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  };
});

const risk = {
  id: 25,
  title: "Long operational risk title that must remain readable in the detail sheet",
  description: "Long narrative content\nthat remains visible and safely wraps on narrow screens.",
  mitigationPlan: "A detailed mitigation action with a deliberately long explanatory narrative.",
  category: "operational",
  likelihood: "high",
  impact: "medium",
  severity: "medium",
  riskLevel: "high",
  status: "under_mitigation",
  locationType: "state",
  stateName: "Kano",
  projectTitle: "Health Access Programme",
  projectId: 7,
  assignedToName: "A responsible colleague with a long display name",
  dueDate: "2026-09-30",
  identifiedAt: "2026-08-01T00:00:00.000Z",
};

vi.mock("@workspace/api-client-react", () => ({
  useListRisks: () => ({
    data: { items: [risk], total: 1, totalPages: 1, summary: { critical: 0, high: 1, medium: 0, low: 0, open: 1 } },
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useListProjects: () => ({ data: [] }),
  useListStates: () => ({ data: [] }),
  useListUsers: () => ({ data: { users: [] } }),
  useCreateRisk: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRisk: () => ({ mutate: vi.fn(), isPending: false }),
  useGetMe: () => ({ data: { user: { id: 1, role: "program_manager" }, permissions: ["risks.create", "risks.update"] } }),
}));

vi.mock("@/components/comments-panel", () => ({ CommentsPanel: () => <div>Comments panel</div> }));
vi.mock("@/components/drive-attachment-panel", () => ({
  DriveAttachmentPanel: () => <div>Attachments panel</div>,
  AttachmentCountBadge: () => null,
}));
vi.mock("@/components/location-selector", () => ({ LocationSelector: () => null }));
vi.mock("@/components/ui/error-state", () => ({ ErrorState: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RisksPage from "@/pages/risks";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderDetail() {
  render(<TooltipProvider><RisksPage /></TooltipProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Open risk:/i }));
}

describe("RISK-DETAIL-VIS-01: title and context hierarchy", () => {
  it("renders the title as the sheet heading with contextual location and project beneath", () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: risk.title })).toBeInTheDocument();
    expect(screen.getByText("Kano · Health Access Programme")).toBeInTheDocument();
  });
});

describe("RISK-DETAIL-VIS-02: semantic read mode", () => {
  it("uses a definition list for metadata and does not render disabled form controls", async () => {
    renderDetail();
    expect(document.querySelector("dl")).toBeInTheDocument();
    expect(document.querySelector("input:disabled, textarea:disabled, button[role='combobox']:disabled")).toBeNull();
  });
});

describe("RISK-DETAIL-VIS-03: readable assessment values", () => {
  it("renders human-readable likelihood, impact, risk level, and status labels", () => {
    renderDetail();
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Medium").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Under Mitigation").length).toBeGreaterThan(0);
  });
});

describe("RISK-DETAIL-VIS-04: no raw enum leakage", () => {
  it("does not expose raw assessment enums in the Detail presentation", () => {
    renderDetail();
    expect(screen.queryByText(/^under_mitigation$/)).not.toBeInTheDocument();
  });
});

describe("RISK-DETAIL-VIS-05: narrative safety", () => {
  it("uses whitespace and word-break protection for detail narratives", async () => {
    renderDetail();
    const source = await readFile("src/pages/risks.tsx", "utf8");
    expect(source).toContain("whitespace-pre-wrap break-words");
    expect(document.body.textContent).toContain("Long narrative content");
  });
});

describe("RISK-DETAIL-VIS-06: comments hierarchy and empty state", () => {
  it("keeps comments hierarchy, wrapping, empty state, and retry treatment", async () => {
    const source = await readFile("src/components/comments-panel.tsx", "utf8");
    expect(source).toContain("font-medium");
    expect(source).toContain("whitespace-pre-wrap break-words");
    expect(source).toContain('t("comments.empty")');
    expect(source).toContain('t("comments.loadFailed")');
    expect(source).toContain('aria-label={t("comments.delete")}');
  });
});

describe("RISK-DETAIL-VIS-07: accessible attachment names", () => {
  it("keeps the full attachment name accessible when the display name truncates", async () => {
    const source = await readFile("src/components/drive-attachment-panel.tsx", "utf8");
    expect(source).toContain('title={file.fileName}>{file.fileName}</span>');
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain('aria-label={t("driveAttachment.downloadFile")}');
    expect(source).toContain('aria-label={t("driveAttachment.openFile")}');
    expect(source).toContain('aria-label={t("driveAttachment.removeAttachment")}');
  });
});

describe("RISK-DETAIL-VIS-08: no attachment storage internals", () => {
  it("excludes storage internals from the rendered attachment row", async () => {
    const source = await readFile("src/components/drive-attachment-panel.tsx", "utf8");
    const rowStart = source.indexOf("{files.map((file) => <TableRow");
    const rowEnd = source.indexOf("</TableBody>", rowStart);
    const row = source.slice(rowStart, rowEnd);
    expect(row).not.toMatch(/file\.(?:objectPath|provider|uploadOperationId|driveFileId|driveLink)\b/);
  });
});

describe("RISK-DETAIL-VIS-09: compact readable history", () => {
  it("uses a compact, wrapping timeline with formatted timestamps and no JSON dump", async () => {
    const source = await readFile("src/pages/risks.tsx", "utf8");
    expect(source).toContain("formatDateTime(h.createdAt)");
    expect(source).toContain('value.startsWith("{") || value.startsWith("[")');
    expect(source).toContain('t("history.loadError"');
  });
});

describe("RISK-DETAIL-VIS-10: functional and security contracts stay intact", () => {
  it("retains secured risk attachment downloads and the existing comments/risk permission wiring", async () => {
    const [attachmentSource, commentsSource, attachmentsRouteSource] = await Promise.all([
      readFile("src/components/drive-attachment-panel.tsx", "utf8"),
      readFile("../api-server/src/routes/comments.ts", "utf8"),
      readFile("../api-server/src/routes/attachments.ts", "utf8"),
    ]);
    expect(attachmentSource).toContain("`/api/${module}/${recordId}/attachments`");
    expect(attachmentSource).toContain('"/api/attachments/upload-descriptors"');
    expect(attachmentSource).toContain("`/api/attachments/operations/${descriptor.operationId}/finalize`");
    expect(attachmentSource).toContain("`/api/attachments/${file.id}/${action}`");
    expect(attachmentSource).not.toContain("/api/drive");
    expect(commentsSource).toContain('entityType === "risk" && hasPerm(perms, "risks.update")');
    expect(attachmentsRouteSource).toContain('router.get("/risks/:riskId/attachments"');
    expect(attachmentsRouteSource).toContain("assertCanonicalParent(req, parentType, attachment.parentId)");
  });
});