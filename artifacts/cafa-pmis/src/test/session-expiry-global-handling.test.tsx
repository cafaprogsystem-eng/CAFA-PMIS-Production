/**
 * SESSION-EXPIRY-GLOBAL-HANDLING — a 401 mid-session (an expired or
 * server-revoked session hit while submitting a form, or during a
 * background refetch) previously surfaced only through whatever generic
 * "Failed to save" toast that one page's own catch block happened to show —
 * with no indication the user needed to sign back in, and no redirect until
 * the next unrelated navigation happened to re-trigger AuthGate's own
 * /api/me check (staleTime: 60s). Fixed: appQueryClient's shared
 * QueryCache/MutationCache onError handlers now catch any ApiError with
 * status 401 — from any query or mutation in the app, not just pages that
 * happen to check for it themselves — show a clear "sign in again" toast,
 * and force AuthGate's /api/me query to re-run immediately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";
import { ApiError } from "@workspace/api-client-react";

const toastMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/contexts/sync-context", () => ({
  SyncProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/socket", () => ({
  SocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/location-context", () => ({
  LocationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/language-context", () => ({
  LanguageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLanguage: () => ({ direction: "ltr", setLang: vi.fn() }),
  hadStoredLangPreference: () => true,
}));
vi.mock("@radix-ui/react-direction", () => ({
  DirectionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/layout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/route-error-boundary", () => ({
  RouteErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/offline-indicator", () => ({ OfflineIndicator: () => null }));
vi.mock("@/components/pwa-update-prompt", () => ({ PwaUpdatePrompt: () => null }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/pages/login", () => ({ default: () => <div>Public sign-in shell</div> }));
vi.mock("@/pages/landing", () => ({ default: () => <div>Public landing shell</div> }));
vi.mock("@/pages/dashboard", () => ({ default: () => <div>Authenticated dashboard</div> }));

import App, { appQueryClient } from "@/App";

function sessionResponse(status: number, body?: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeApiError(status: number) {
  return new ApiError(new Response(null, { status, statusText: "Unauthorized" }), { error: "unauthorized" }, { method: "GET", url: "/api/some-resource" });
}

describe("SESSION-EXPIRY-GLOBAL-HANDLING", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cleanup();
    appQueryClient.clear();
    // A prior test's <Redirect> (e.g. to /login on session expiry) leaves
    // window.history pointed at that URL — reset to a known authenticated
    // route before every test regardless of what the last one left behind.
    window.history.replaceState({}, "", "/dashboard");
    toastMock.error.mockReset();
    toastMock.info.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    appQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it("shows a clear sign-in-again toast and refetches /api/me when a query throws a 401 ApiError", async () => {
    fetchMock.mockImplementation(async () => sessionResponse(200, {
      user: { id: 44, role: "program_manager", status: "active" },
      permissions: ["projects.view"],
    }));
    render(<App />);
    await screen.findByText("Authenticated dashboard");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Now the session has expired: the next /api/me refetch (forced by the
    // handler) must see a 401 for the redirect to actually happen.
    fetchMock.mockImplementation(async () => sessionResponse(401));

    await appQueryClient.fetchQuery({
      queryKey: ["some-other-resource"],
      queryFn: () => { throw fakeApiError(401); },
      retry: false,
    }).catch(() => {});

    expect(toastMock.error).toHaveBeenCalledWith(
      "Your session has expired. Please sign in again.",
      expect.objectContaining({ id: "session-expired" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Public sign-in shell")).toBeVisible();
  });

  it("shows the same toast for a mutation that throws a 401 ApiError", async () => {
    fetchMock.mockImplementation(async () => sessionResponse(200, {
      user: { id: 44, role: "program_manager", status: "active" },
      permissions: ["projects.view"],
    }));
    render(<App />);
    await screen.findByText("Authenticated dashboard");

    await appQueryClient.getMutationCache().build(appQueryClient, {
      mutationFn: () => { throw fakeApiError(401); },
    }).execute(undefined).catch(() => {});

    expect(toastMock.error).toHaveBeenCalledWith(
      "Your session has expired. Please sign in again.",
      expect.objectContaining({ id: "session-expired" }),
    );
  });

  it("does not fire the session-expiry toast for a non-401 error (e.g. a 500)", async () => {
    fetchMock.mockImplementation(async () => sessionResponse(200, {
      user: { id: 44, role: "program_manager", status: "active" },
      permissions: ["projects.view"],
    }));
    render(<App />);
    await screen.findByText("Authenticated dashboard");

    await appQueryClient.fetchQuery({
      queryKey: ["some-failing-resource"],
      queryFn: () => { throw fakeApiError(500); },
      retry: false,
    }).catch(() => {});

    expect(toastMock.error).not.toHaveBeenCalledWith(
      "Your session has expired. Please sign in again.",
      expect.anything(),
    );
  });
});
