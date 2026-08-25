import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import i18n from "@/i18n";

const api = vi.hoisted(() => ({
  refetch: vi.fn(),
  useListAuditLog: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ navigate: vi.fn(), search: "?entityType=projects&page=2&pageSize=25" }));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { user: { id: 1, role: "program_manager" }, permissions: ["audit.view"] } }),
  useListAuditLog: api.useListAuditLog,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/audit-log", navigation.navigate],
  useSearch: () => navigation.search,
}));

import AuditLogPage from "@/pages/audit-log";

const page = {
  total: 43,
  page: 2,
  pageSize: 25,
  totalPages: 2,
  summary: { created: 4, updated: 12, deleted: 2, approved: 3 },
  items: [{
    id: 42,
    userName: "Amina Hassan",
    userEmail: "amina@example.test",
    userRole: "Programme Manager",
    action: "project_updated",
    module: "projects",
    entityId: 99,
    entityReference: "CAFA-01-005 — Health response",
    timestamp: "2026-08-21T09:00:00.000Z",
    actionCategory: "updated" as const,
    changeSummary: "1 field changed",
    changes: [{ field: "budget", before: "100", after: "120" }],
    usedOverride: false,
    overrideReason: null,
  }],
};

describe("Audit Log workspace", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    navigation.search = "?entityType=projects&page=2&pageSize=25";
    HTMLElement.prototype.scrollIntoView ??= vi.fn();
    HTMLElement.prototype.hasPointerCapture ??= () => false;
    HTMLElement.prototype.setPointerCapture ??= vi.fn();
    HTMLElement.prototype.releasePointerCapture ??= vi.fn();
    api.useListAuditLog.mockReturnValue({
      data: page, isLoading: false, isError: false, isFetching: false, refetch: api.refetch,
    });
  });

  afterEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("renders full-filter totals, structured safe detail disclosure, and accessible controls", () => {
    render(<AuditLogPage />);

    expect(screen.getByRole("heading", { name: "System Audit Log" })).toBeInTheDocument();
    expect(screen.getByText("43 matching events")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("CAFA-01-005 — Health response")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();

    const detailButton = screen.getByRole("button", { name: "Show event details" });
    fireEvent.click(detailButton);
    expect(detailButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Available changes")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("restores query filters and keeps a new search in the URL", () => {
    render(<AuditLogPage />);

    fireEvent.change(screen.getByLabelText("Search audit events"), { target: { value: "Health" } });
    expect(navigation.navigate).toHaveBeenCalledWith(
      "/audit-log?search=Health&entityType=projects",
      { replace: true },
    );
  });

  it("uses the same URL-backed action state for keyboard KPI toggles and the action dropdown", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AuditLogPage />);
    const created = screen.getByRole("button", { name: /^Created/ });

    expect(created).toHaveAttribute("aria-pressed", "false");
    created.focus();
    await user.keyboard("{Enter}");
    expect(navigation.navigate).toHaveBeenCalledWith(
      "/audit-log?action=created&entityType=projects",
      { replace: false },
    );

    navigation.search = "?action=created&entityType=projects&page=2&pageSize=25";
    rerender(<AuditLogPage />);
    expect(screen.getByRole("button", { name: /^Created/ })).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("{Enter}");
    expect(navigation.navigate).toHaveBeenLastCalledWith(
      "/audit-log?entityType=projects",
      { replace: false },
    );

    await user.click(screen.getByLabelText("Filter by action"));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigation.navigate).toHaveBeenLastCalledWith(
      "/audit-log?action=updated&entityType=projects",
      { replace: false },
    );
  });

  it("preserves non-action filters and page size when a KPI resets pagination", () => {
    navigation.search = "?search=Health&entityType=projects&dateFrom=2026-08-01&dateTo=2026-08-31&page=2&pageSize=50";
    render(<AuditLogPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Approved/ }));
    expect(navigation.navigate).toHaveBeenCalledWith(
      "/audit-log?search=Health&action=approved&entityType=projects&dateFrom=2026-08-01&dateTo=2026-08-31&pageSize=50",
      { replace: false },
    );
  });

  it("restores the supported module URL alias as the same entity filter", () => {
    navigation.search = "?module=reports&page=2";
    render(<AuditLogPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Deleted/ }));
    expect(navigation.navigate).toHaveBeenCalledWith(
      "/audit-log?action=deleted&entityType=reports",
      { replace: false },
    );
  });

  it("has an Arabic translation for every audit workspace string used by the page", async () => {
    await i18n.changeLanguage("ar");
    render(<AuditLogPage />);

    expect(screen.getByRole("heading", { name: "سجل تدقيق النظام" })).toBeInTheDocument();
    expect(screen.getByLabelText("البحث في أحداث التدقيق")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /تم الإنشاء/ })).toHaveAttribute("aria-pressed", "false");
  });
});