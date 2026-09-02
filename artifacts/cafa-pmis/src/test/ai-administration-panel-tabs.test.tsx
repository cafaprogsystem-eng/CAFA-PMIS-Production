/**
 * AI-ADMIN-PANEL-TABS — AIAdministrationPanel gated its entire Settings +
 * Logs section behind a single hardcoded super_admin/executive_director role
 * check, even though the backend already grants ai.logs.view (monitoring
 * oversight) to program_manager too. A PM with real backend access to the
 * logs had no frontend path to them at all. Fixed: the panel now shows the
 * Logs tab to anyone with ai.logs.view, and the Settings tab only to anyone
 * with ai.settings.manage (PUT /ai/settings itself requires that permission
 * and would 403 for a PM regardless of what the frontend showed).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

let currentPermissions: string[] = [];

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { permissions: currentPermissions } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key.split(".").pop() ?? key,
  }),
}));

import { AIAdministrationPanel } from "../pages/ai-settings";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AIAdministrationPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentPermissions = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/ai/settings")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ enabled: "true", envEnabled: true, systemPromptExtra: null, responseLanguage: "auto" }),
      });
    }
    if (url.includes("/api/ai/logs")) {
      return Promise.resolve({ ok: true, json: async () => ({ messages: [], total: 0 }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }));
});

describe("AI-ADMIN-PANEL-TABS", () => {
  it("shows a no-permission message for a role with neither ai.settings.manage nor ai.logs.view", async () => {
    currentPermissions = [];
    renderPanel();
    expect(await screen.findByText("noPermission")).toBeInTheDocument();
    expect(screen.queryByText("tabSettings")).not.toBeInTheDocument();
    expect(screen.queryByText("tabLogs")).not.toBeInTheDocument();
  });

  it("shows only the Logs tab (no Settings tab) for ai.logs.view alone — e.g. program_manager", async () => {
    currentPermissions = ["ai.logs.view"];
    renderPanel();
    expect(await screen.findByText("tabLogs")).toBeInTheDocument();
    expect(screen.queryByText("tabSettings")).not.toBeInTheDocument();
  });

  it("shows both tabs for ai.settings.manage — e.g. executive_director", async () => {
    currentPermissions = ["ai.settings.manage", "ai.logs.view"];
    renderPanel();
    await waitFor(() => expect(screen.getByText("tabSettings")).toBeInTheDocument());
    expect(screen.getByText("tabLogs")).toBeInTheDocument();
  });

  it("shows both tabs for the super_admin wildcard", async () => {
    currentPermissions = ["*"];
    renderPanel();
    await waitFor(() => expect(screen.getByText("tabSettings")).toBeInTheDocument());
    expect(screen.getByText("tabLogs")).toBeInTheDocument();
  });
});
