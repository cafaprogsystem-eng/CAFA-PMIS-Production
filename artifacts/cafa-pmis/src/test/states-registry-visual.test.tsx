import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StatesPage from "../pages/states";

const hooks = vi.hoisted(() => ({
  list: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  lifecycle: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListStatesQueryKey: () => ["/api/states"],
  useListStates: hooks.list,
  useGetMe: hooks.me,
  useCreateState: hooks.create,
  useUpdateState: hooks.update,
  useUpdateStateLifecycle: hooks.lifecycle,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { search?: string }) => options?.search ? `${key}:${options.search}` : key }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><StatesPage /></QueryClientProvider>);
}

describe("STATE-VIS State registry workspace", () => {
  beforeEach(() => {
    hooks.me.mockReturnValue({ data: { user: { role: "viewer" }, permissions: ["states.view"] } });
    hooks.create.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    hooks.update.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    hooks.lifecycle.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  });

  it("STATE-VIS-01 renders truthful registry columns and hides mutation controls for non-administrators", () => {
    hooks.list.mockReturnValue({
      data: [{ id: 1, name: "North", code: "NO", officeAddress: "Main Office", managerName: "Amina", localitiesCount: 3 }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("statesPage.registryNoticeTitle")).toBeInTheDocument();
    expect(screen.getAllByText("North")).toHaveLength(2);
    expect(screen.getAllByText("Main Office")).toHaveLength(2);
    expect(screen.queryByText("statesPage.add")).not.toBeInTheDocument();
    expect(screen.queryByText(/Active projects/i)).not.toBeInTheDocument();
  });

  it("STATE-VIS-02 distinguishes request failure from an empty registry and provides retry", () => {
    hooks.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderPage();

    expect(screen.getByText("statesPage.loadError")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "statesPage.retry" })).toBeInTheDocument();
    expect(screen.queryByText("statesPage.emptyTitle")).not.toBeInTheDocument();
  });

  it("STATE-VIS-03 exposes a labelled keyboard-searchable State registry with a distinct no-results state", () => {
    hooks.list.mockReturnValue({
      data: [{ id: 1, name: "North", code: "NO", officeAddress: null, managerName: null, localitiesCount: 0 }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    const search = screen.getByRole("textbox", { name: "statesPage.searchLabel" });
    fireEvent.change(search, { target: { value: "does not exist" } });

    expect(screen.getByText("statesPage.noResultsTitle")).toBeInTheDocument();
    expect(screen.getByText("statesPage.noResultsDescription:does not exist")).toBeInTheDocument();
  });

  it("STATE-VIS-04 shows the authorised add action for the State-registry administrator matrix", () => {
    hooks.me.mockReturnValue({ data: { user: { role: "program_manager" }, permissions: [] } });
    hooks.list.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderPage();

    expect(screen.getByRole("button", { name: "statesPage.add" })).toBeInTheDocument();
    expect(screen.getByText("statesPage.emptyAdminDescription")).toBeInTheDocument();
  });
});