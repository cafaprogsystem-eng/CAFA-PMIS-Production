/**
 * AI-CHAT-WIDGET-HISTORY-PERSISTENCE — GET /ai/history was fully implemented
 * server-side but never called from the widget: sessionId was a fresh
 * crypto.randomUUID() on every mount with nothing persisted, so a page
 * reload or widget close/reopen always lost the visible conversation even
 * though every message had been saved all along. Fixed: the session id is
 * now persisted in localStorage and the widget loads that session's prior
 * messages on mount before falling back to the welcome message.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { user: { id: 1, name: "Amina Hassan", role: "program_manager" } } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "widget.welcome") return `Welcome${(opts?.name as string) ?? ""}`;
      return key.split(".").pop() ?? key;
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { AIChatWidget } from "../components/ai-chat-widget";

// This test environment's global `localStorage` is unreliable (a known,
// pre-existing gap — see other localStorage-dependent test files), so stub a
// minimal in-memory implementation rather than depend on the ambient one.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeMemoryStorage());
});

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AIChatWidget embedded />
    </QueryClientProvider>,
  );
}

function mockFetchWith(historyMessages: Array<{ id: number; role: "user" | "assistant"; content: string }>) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/ai/settings")) {
      return Promise.resolve({ ok: true, json: async () => ({ enabled: "true", envEnabled: true }) });
    }
    if (url.includes("/api/ai/history")) {
      return Promise.resolve({ ok: true, json: async () => ({ messages: historyMessages }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }));
}

describe("AI-CHAT-WIDGET-HISTORY-PERSISTENCE", () => {
  it("persists a stable session id across mounts instead of generating a fresh one each time", () => {
    mockFetchWith([]);
    const { unmount } = renderWidget();
    const firstSessionId = localStorage.getItem("cafa.ai.sessionId");
    expect(firstSessionId).toBeTruthy();
    unmount();

    renderWidget();
    expect(localStorage.getItem("cafa.ai.sessionId")).toBe(firstSessionId);
  });

  it("fetches this session's history scoped by the persisted session id", async () => {
    mockFetchWith([]);
    renderWidget();
    await waitFor(() => {
      const sessionId = localStorage.getItem("cafa.ai.sessionId");
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/ai/history?sessionId=${encodeURIComponent(sessionId!)}`),
        expect.objectContaining({ credentials: "include" }),
      );
    });
  });

  it("restores prior messages from history instead of showing the welcome message", async () => {
    mockFetchWith([
      { id: 2, role: "assistant", content: "Sure, here is how to submit a report." },
      { id: 1, role: "user", content: "How do I submit a report?" },
    ]);
    renderWidget();

    expect(await screen.findByText("How do I submit a report?")).toBeInTheDocument();
    expect(screen.getByText("Sure, here is how to submit a report.")).toBeInTheDocument();
    expect(screen.queryByText(/^Welcome/)).not.toBeInTheDocument();
  });

  it("falls back to the welcome message when there is no prior history", async () => {
    mockFetchWith([]);
    renderWidget();

    expect(await screen.findByText(/^Welcome/)).toBeInTheDocument();
  });
});
