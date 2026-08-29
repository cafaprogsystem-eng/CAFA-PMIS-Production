import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelCriticalPrefetch,
  prefetchCriticalData,
} from "@/lib/offline/prefetch";

describe("authenticated offline prefetch lifecycle", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cancelCriticalPrefetch();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not duplicate the identity check and cancels delayed staff warmups", async () => {
    await prefetchCriticalData();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/states");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/me")).toBe(false);

    cancelCriticalPrefetch();
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await prefetchCriticalData();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});