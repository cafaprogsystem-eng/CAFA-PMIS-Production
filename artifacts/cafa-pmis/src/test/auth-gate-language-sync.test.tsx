/**
 * AUTH-GATE-LANGUAGE-SYNC — a saved Profile "Interface Language" preference
 * never actually applied on a device other than the one it was saved from:
 * LanguageProvider only ever read localStorage, and GET /me never even
 * returned the account's languagePreference for anything to sync from. A
 * user logging in on a new device/browser (or after clearing site data)
 * always saw English regardless of what they saved. Fixed: AuthGate now
 * adopts the account's languagePreference the first time it resolves on a
 * device with no local language choice already made — and never overrides
 * one that already exists (from a prior sync, or the deliberately
 * local-only quick switcher in the top nav).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";

vi.mock("@/contexts/sync-context", () => ({
  SyncProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/socket", () => ({
  SocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/location-context", () => ({
  LocationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/pages/login", () => ({ default: () => <div>Public sign-in shell</div> }));
vi.mock("@/pages/landing", () => ({ default: () => <div>Public landing shell</div> }));
vi.mock("@/pages/dashboard", () => ({ default: () => <div>Authenticated dashboard</div> }));

function sessionResponse(status: number, body?: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// This test environment's global localStorage is unreliable (a known,
// pre-existing gap — see other localStorage-dependent test files), and this
// test specifically exercises real read/write behaviour of it, so stub a
// minimal in-memory implementation instead of depending on the ambient one.
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

describe("AUTH-GATE-LANGUAGE-SYNC", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/dashboard");
    vi.stubGlobal("localStorage", makeMemoryStorage());
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("adopts the account's saved languagePreference on a fresh device with no local choice yet", async () => {
    // Re-import so language-context's module-level "had a stored preference
    // at load" snapshot is captured fresh, against the just-cleared storage.
    vi.resetModules();
    const { default: App, appQueryClient } = await import("@/App");
    appQueryClient.clear();
    fetchMock.mockImplementation(async () => sessionResponse(200, {
      user: { id: 44, role: "program_manager", status: "active", languagePreference: "ar" },
      permissions: ["projects.view"],
    }));

    render(<App />);

    await waitFor(() => expect(localStorage.getItem("cafa.lang")).toBe("ar"));
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("does not override a language already chosen on this device (e.g. via the quick switcher)", async () => {
    localStorage.setItem("cafa.lang", "en");
    vi.resetModules();
    const { default: App, appQueryClient } = await import("@/App");
    appQueryClient.clear();
    fetchMock.mockImplementation(async () => sessionResponse(200, {
      user: { id: 44, role: "program_manager", status: "active", languagePreference: "ar" },
      permissions: ["projects.view"],
    }));

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Give any (incorrect) sync a moment to have fired before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(localStorage.getItem("cafa.lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
