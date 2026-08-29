import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import "@testing-library/jest-dom";

const lifecycle = vi.hoisted(() => ({
  events: [] as string[],
  syncMounts: 0,
  socketMounts: 0,
  locationMounts: 0,
}));

vi.mock("@/contexts/sync-context", () => ({
  SyncProvider: ({ children }: { children: ReactNode; userId: number }) => {
    lifecycle.syncMounts += 1;
    lifecycle.events.push("sync");
    return <>{children}</>;
  },
}));

vi.mock("@/lib/socket", () => ({
  SocketProvider: ({ children }: { children: ReactNode }) => {
    lifecycle.socketMounts += 1;
    lifecycle.events.push("socket");
    return <>{children}</>;
  },
}));

vi.mock("@/contexts/location-context", () => ({
  LocationProvider: ({ children }: { children: ReactNode }) => {
    lifecycle.locationMounts += 1;
    lifecycle.events.push("location");
    return <>{children}</>;
  },
}));

vi.mock("@/contexts/language-context", () => ({
  LanguageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLanguage: () => ({ direction: "ltr" }),
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
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("authenticated background lifecycle boundary", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cleanup();
    appQueryClient.clear();
    lifecycle.events.length = 0;
    lifecycle.syncMounts = 0;
    lifecycle.socketMounts = 0;
    lifecycle.locationMounts = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    appQueryClient.clear();
    vi.unstubAllGlobals();
  });

  it("renders a direct sign-in route without a session check or staff providers", async () => {
    window.history.replaceState({}, "", "/login");
    render(<App />);

    expect(await screen.findByText("Public sign-in shell")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lifecycle.syncMounts).toBe(0);
    expect(lifecycle.socketMounts).toBe(0);
    expect(lifecycle.locationMounts).toBe(0);
  });

  it("settles a signed-out landing visit after exactly one session request", async () => {
    window.history.replaceState({}, "", "/");
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      lifecycle.events.push(`fetch:${String(input)}`);
      return sessionResponse(401);
    });
    render(<App />);

    expect(await screen.findByText("Public landing shell")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/me", { credentials: "include" });
    expect(lifecycle.events).toEqual(["fetch:/api/me"]);
    expect(lifecycle.syncMounts).toBe(0);
    expect(lifecycle.socketMounts).toBe(0);
    expect(lifecycle.locationMounts).toBe(0);
  });

  it("settles an expired protected-route session into sign-in without staff work", async () => {
    window.history.replaceState({}, "", "/dashboard");
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      lifecycle.events.push(`fetch:${String(input)}`);
      return sessionResponse(401);
    });
    render(<App />);

    expect(await screen.findByText("Public sign-in shell")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lifecycle.events).toEqual(["fetch:/api/me"]);
    expect(lifecycle.syncMounts).toBe(0);
    expect(lifecycle.socketMounts).toBe(0);
    expect(lifecycle.locationMounts).toBe(0);
  });

  it("mounts realtime, location, and sync only after identity succeeds", async () => {
    window.history.replaceState({}, "", "/dashboard");
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      lifecycle.events.push(`fetch:${String(input)}`);
      return sessionResponse(200, {
        user: { id: 44, role: "program_manager", status: "active" },
        permissions: ["projects.view"],
      });
    });
    render(<App />);

    expect(await screen.findByText("Authenticated dashboard")).toBeVisible();
    await waitFor(() => expect(lifecycle.syncMounts).toBe(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lifecycle.events).toEqual([
      "fetch:/api/me",
      "socket",
      "location",
      "sync",
    ]);
  });
});
