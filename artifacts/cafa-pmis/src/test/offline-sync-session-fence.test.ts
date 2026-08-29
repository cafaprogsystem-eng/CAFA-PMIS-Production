import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/offline/db";
import { SyncService } from "@/lib/offline/sync-service";

describe("offline replay authenticated-session fence", () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.syncQueue.clear();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: LockOptions,
          callback: (lock: object) => Promise<unknown>,
        ) => callback({}),
      },
    });
  });

  afterEach(async () => {
    await db.syncQueue.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not start replay fetch after logout while body resolution is paused", async () => {
    let releaseMapping!: () => void;
    const mappingPaused = new Promise<void>((resolve) => {
      releaseMapping = resolve;
    });
    const mappingRead = vi.spyOn(db.localIdentityMappings, "get")
      .mockImplementation(async () => {
        await mappingPaused;
        return { serverEntityId: 91 } as never;
      });

    const service = new SyncService();
    localStorage.setItem("cafa.userId", "44");
    service.setUserId(44);
    await service.queue({
      method: "POST",
      url: "/api/reports",
      body: JSON.stringify({ projectId: "local:project-1" }),
      userId: 44,
    });

    const replay = service.processQueue();
    await vi.waitFor(() => expect(mappingRead).toHaveBeenCalledTimes(1));

    service.setUserId(null);
    localStorage.removeItem("cafa.userId");
    releaseMapping();
    await replay;

    expect(fetch).not.toHaveBeenCalled();
    const item = await db.syncQueue.toCollection().first();
    expect(item).toMatchObject({
      syncStatus: "pending",
      outcome: null,
      retryCount: 0,
    });
  });
});
