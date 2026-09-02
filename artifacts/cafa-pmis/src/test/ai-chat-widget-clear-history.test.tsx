/**
 * AI-CHAT-WIDGET-CLEAR-HISTORY — clearHistory() cleared the visible messages
 * immediately and fired DELETE /api/ai/history fire-and-forget, discarding
 * any error. If the request failed (network blip, session expiry), the UI
 * showed an empty chat as if history were cleared while the rows still
 * existed server-side. Fixed: the visible messages are only cleared after a
 * confirmed 2xx response; a failure shows an error and leaves the
 * conversation exactly as it was.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { user: { id: 1, name: "Amina Hassan", role: "program_manager" } } }),
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "widget.clearHistoryFailed") return "Could not clear chat history. Please try again.";
      return key.split(".").pop() ?? key;
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

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

import { AIChatWidget } from "../components/ai-chat-widget";

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AIChatWidget embedded />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeMemoryStorage());
  toastMock.error.mockReset();
  // jsdom does not implement scrollIntoView; the widget calls it (via a
  // setTimeout) whenever the message list changes.
  Element.prototype.scrollIntoView = vi.fn();
});

function mockFetchWith(opts: { historyOk: boolean; deleteOk: boolean }) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/api/ai/settings")) {
      return Promise.resolve({ ok: true, json: async () => ({ enabled: "true", envEnabled: true }) });
    }
    if (url.includes("/api/ai/history") && init?.method === "DELETE") {
      return Promise.resolve({ ok: opts.deleteOk, status: opts.deleteOk ? 200 : 500 });
    }
    if (url.includes("/api/ai/history")) {
      return Promise.resolve({
        ok: opts.historyOk,
        json: async () => ({ messages: opts.historyOk ? [{ id: 1, role: "user", content: "How do I submit a report?" }] : [] }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }));
}

describe("AI-CHAT-WIDGET-CLEAR-HISTORY", () => {
  it("clears the visible conversation only after a confirmed successful deletion", async () => {
    mockFetchWith({ historyOk: true, deleteOk: true });
    const user = userEvent.setup();
    renderWidget();

    expect(await screen.findByText("How do I submit a report?")).toBeInTheDocument();
    await user.click(screen.getByTitle("clearHistory"));

    await waitFor(() => expect(screen.queryByText("How do I submit a report?")).not.toBeInTheDocument());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the conversation visible when the deletion request fails", async () => {
    mockFetchWith({ historyOk: true, deleteOk: false });
    const user = userEvent.setup();
    renderWidget();

    expect(await screen.findByText("How do I submit a report?")).toBeInTheDocument();
    await user.click(screen.getByTitle("clearHistory"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Could not clear chat history. Please try again."));
    expect(screen.getByText("How do I submit a report?")).toBeInTheDocument();
  });
});
