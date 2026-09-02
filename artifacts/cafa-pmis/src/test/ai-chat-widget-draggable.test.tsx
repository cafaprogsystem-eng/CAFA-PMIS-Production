/**
 * AI-CHAT-WIDGET-DRAGGABLE — the floating AI widget was pinned to a single
 * fixed corner (bottom-right) with no way to move it. It's now draggable —
 * from the launcher bubble or the panel's header bar — via Pointer Events
 * (mouse, touch, and pen all go through the same code path), with the
 * dropped position remembered in localStorage and always clamped back
 * inside the current viewport.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../components/ui/tooltip";

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: { user: { id: 1, name: "Amina Hassan", role: "program_manager" } } }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key.split(".").pop() ?? key }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const STORAGE_KEY = "cafa.ai.widgetPosition";

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
      <TooltipProvider>
        <AIChatWidget />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeMemoryStorage());
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/ai/settings")) return Promise.resolve({ ok: true, json: async () => ({ enabled: "true", envEnabled: true }) });
    if (url.includes("/api/ai/history")) return Promise.resolve({ ok: true, json: async () => ({ messages: [] }) });
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }));
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom does not implement pointer capture at all.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
  // A fixed, non-zero starting rect for the launcher so drag-delta math is
  // deterministic regardless of jsdom's default (all-zero) layout rect.
  Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    left: 1000, top: 700, right: 1048, bottom: 748, width: 48, height: 48, x: 1000, y: 700, toJSON() { return this; },
  });
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
});

describe("AI-CHAT-WIDGET-DRAGGABLE", () => {
  it("defaults to the original bottom-right corner when no position has ever been saved", () => {
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });
    expect(launcher.style.right).toBe("1.5rem");
    expect(launcher.style.left).toBe("");
  });

  it("dragging the launcher past the click threshold moves it and persists the dropped position", () => {
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });

    fireEvent.pointerDown(launcher, { pointerId: 1, clientX: 1024, clientY: 724, pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(launcher, { pointerId: 1, clientX: 1024, clientY: 624 }); // 100px up — past the threshold
    fireEvent.pointerUp(launcher, { pointerId: 1, clientX: 1024, clientY: 624 });

    // Started at rect.left/top = (1000, 700); moved by (0, -100) → (1000, 600).
    expect(launcher.style.left).toBe("1000px");
    expect(launcher.style.top).toBe("600px");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ x: 1000, y: 600 });
  });

  it("a plain click with no movement still toggles the panel open (drag threshold not crossed)", () => {
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });

    fireEvent.pointerDown(launcher, { pointerId: 2, clientX: 1024, clientY: 724, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(launcher, { pointerId: 2, clientX: 1024, clientY: 724 });
    fireEvent.click(launcher);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("a genuine drag suppresses the click that follows it (does not also toggle the panel)", () => {
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });

    fireEvent.pointerDown(launcher, { pointerId: 3, clientX: 1024, clientY: 724, pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(launcher, { pointerId: 3, clientX: 1100, clientY: 724 });
    fireEvent.pointerUp(launcher, { pointerId: 3, clientX: 1100, clientY: 724 });
    fireEvent.click(launcher); // the browser's own trailing click event after the drag

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clamps a drag that would otherwise land outside the viewport", () => {
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });

    fireEvent.pointerDown(launcher, { pointerId: 4, clientX: 1024, clientY: 724, pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(launcher, { pointerId: 4, clientX: 5000, clientY: 5000 }); // way off to the bottom-right
    fireEvent.pointerUp(launcher, { pointerId: 4, clientX: 5000, clientY: 5000 });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.x).toBeLessThanOrEqual(1280 - 48 - 8);
    expect(stored.y).toBeLessThanOrEqual(800 - 48 - 8);
  });

  it("works via touch pointer events, not just mouse", () => {
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });

    fireEvent.pointerDown(launcher, { pointerId: 5, clientX: 1024, clientY: 724, pointerType: "touch" });
    fireEvent.pointerMove(launcher, { pointerId: 5, clientX: 900, clientY: 724 });
    fireEvent.pointerUp(launcher, { pointerId: 5, clientX: 900, clientY: 724 });

    expect(launcher.style.left).toBe("876px"); // 1000 + (900 - 1024)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).x).toBe(876);
  });

  it("restores a previously saved position on mount instead of the default corner", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 200, y: 150 }));
    renderWidget();
    const launcher = screen.getByRole("button", { name: "openAssistant" });

    expect(launcher.style.left).toBe("200px");
    expect(launcher.style.top).toBe("150px");
    expect(launcher.style.right).toBe("");
  });

  it("re-clamps a restored position after the viewport shrinks (e.g. window resize)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 1200, y: 750 }));
    renderWidget();

    vi.stubGlobal("innerWidth", 500);
    vi.stubGlobal("innerHeight", 400);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const launcher = screen.getByRole("button", { name: "openAssistant" });
      expect(Number(launcher.style.left.replace("px", ""))).toBeLessThanOrEqual(500 - 48 - 8);
      expect(Number(launcher.style.top.replace("px", ""))).toBeLessThanOrEqual(400 - 48 - 8);
    });
  });

  it("dragging the panel header also moves and persists the widget's position", async () => {
    renderWidget();
    fireEvent.click(screen.getByRole("button", { name: "openAssistant" }));
    const header = await screen.findByText("assistantName");
    const headerBar = header.closest("[class*='cursor-grab'], div")!;

    fireEvent.pointerDown(headerBar, { pointerId: 6, clientX: 1024, clientY: 724, pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(headerBar, { pointerId: 6, clientX: 824, clientY: 724 });
    fireEvent.pointerUp(headerBar, { pointerId: 6, clientX: 824, clientY: 724 });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ x: 800, y: 700 });
  });
});
