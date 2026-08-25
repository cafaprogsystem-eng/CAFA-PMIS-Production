import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CANONICAL_DATABASE_NAME,
  db,
  LEGACY_DATABASE_NAME,
  migrateLegacyOfflineDatabase,
  offlineDatabaseReady,
} from "../lib/offline/db";

type LegacyStores = Record<string, unknown[]>;

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB deletion was blocked: ${name}`));
  });
}

function createLegacyDatabase(version: 3 | 6, rows: LegacyStores): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DATABASE_NAME, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (version === 3) {
        database.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
        database.createObjectStore("apiCache", { keyPath: "url" });
        database.createObjectStore("attachmentQueue", { keyPath: "id" });
        return;
      }
      database.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
      database.createObjectStore("apiCache", { keyPath: "cacheKey" });
      database.createObjectStore("attachmentQueue", { keyPath: "id" });
      database.createObjectStore("reportDrafts", { keyPath: "draftKey" });
      database.createObjectStore("formDrafts", { keyPath: "key" });
      database.createObjectStore("localIdentityMappings", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const storeNames = Object.keys(rows);
      if (storeNames.length === 0) {
        database.close();
        resolve();
        return;
      }
      const transaction = database.transaction(storeNames, "readwrite");
      for (const [storeName, storeRows] of Object.entries(rows)) {
      for (const row of storeRows) transaction.objectStore(storeName).put(row);
      }
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

const cacheFor = (userId: number, url: string) => ({
  cacheKey: `${userId}:${url}`,
  userId,
  url,
  data: JSON.stringify({ source: "legacy", userId }),
  status: 200,
  cachedAt: 1_700_000_000_000,
  ttlSeconds: 600,
});

beforeEach(async () => {
  await offlineDatabaseReady;
  db.close();
  await deleteDatabase(CANONICAL_DATABASE_NAME);
  await deleteDatabase(LEGACY_DATABASE_NAME);
});

afterEach(async () => {
  db.close();
  await deleteDatabase(CANONICAL_DATABASE_NAME);
  await deleteDatabase(LEGACY_DATABASE_NAME);
});

describe("IndexedDB primary-key bridge", () => {
  it("initialises a fresh canonical schema without recreating the old database", async () => {
    await db.open();

    expect(await db.apiCache.count()).toBe(0);
    expect(await db.offlineMeta.count()).toBe(0);
    const databaseNames = await indexedDB.databases();
    expect(databaseNames.map((database) => database.name)).toContain(CANONICAL_DATABASE_NAME);
    expect(databaseNames.map((database) => database.name)).not.toContain(LEGACY_DATABASE_NAME);
  });

  it("migrates only attributable v3 cache data under canonical account keys", async () => {
    const owned = {
      url: "/api/projects?stateId=2",
      userId: 41,
      data: JSON.stringify({ projects: ["owned"] }),
      status: 200,
      cachedAt: 1_700_000_000_000,
      ttlSeconds: 600,
    };
    await createLegacyDatabase(3, {
      apiCache: [
        owned,
        {
          url: "/api/projects?stateId=3",
          data: JSON.stringify({ projects: ["unowned"] }),
          status: 200,
          cachedAt: 1_700_000_000_001,
          ttlSeconds: 600,
        },
      ],
      syncQueue: [{ id: 1, clientId: "unowned-operation", syncStatus: "pending", createdAt: 1 }],
      attachmentQueue: [{ id: "unowned-file", status: "pending", createdAt: 1 }],
    });

    await db.open();
    const state = await migrateLegacyOfflineDatabase();

    expect(await db.apiCache.get("41:/api/projects?stateId=2")).toMatchObject({
      ...owned,
      cacheKey: "41:/api/projects?stateId=2",
    });
    expect(await db.apiCache.get("41:/api/projects?stateId=3")).toBeUndefined();
    expect(await db.syncQueue.count()).toBe(0);
    expect(await db.attachmentQueue.count()).toBe(0);
    expect(state?.sourceVersion).toBe(3);
    expect(state?.copiedByStore.apiCache).toBe(1);
    expect(state?.quarantinedByStore.apiCache).toBe(1);
    expect(state?.quarantinedByStore.syncQueue).toBe(1);
    expect(state?.quarantinedByStore.attachmentQueue).toBe(1);
  });

  it("preserves v6 account-owned caches, drafts, queue rows, and mappings idempotently", async () => {
    const url = "/api/projects/9";
    const queue = {
      id: 4,
      operationId: "operation-4",
      clientId: "operation-4",
      userId: 41,
      syncStatus: "pending",
      createdAt: 10,
      module: "projects",
    };
    await createLegacyDatabase(6, {
      apiCache: [cacheFor(41, url), { ...cacheFor(55, url), cacheKey: "wrong-key" }],
      syncQueue: [queue],
      attachmentQueue: [{ id: "attachment-1", userId: 41, status: "re-select-required", createdAt: 10 }],
      reportDrafts: [{ draftKey: "41:project:9", userId: 41, snapshot: "{}", updatedAt: 10 }],
      formDrafts: [{ key: "41:projects:9", userId: 41, payload: "{}", updatedAt: 10 }],
      localIdentityMappings: [{ key: "41:local:projects:x", userId: 41, localEntityId: "local:projects:x" }],
    });

    await db.open();
    const first = await migrateLegacyOfflineDatabase();
    const second = await migrateLegacyOfflineDatabase();

    expect(await db.apiCache.get(`41:${url}`)).toMatchObject(cacheFor(41, url));
    expect(await db.apiCache.get(`55:${url}`)).toMatchObject({
      ...cacheFor(55, url),
      cacheKey: `55:${url}`,
    });
    expect(await db.syncQueue.get(4)).toMatchObject(queue);
    expect(await db.attachmentQueue.get("attachment-1")).toMatchObject({ userId: 41 });
    expect(await db.reportDrafts.get("41:project:9")).toMatchObject({ userId: 41 });
    expect(await db.formDrafts.get("41:projects:9")).toMatchObject({ userId: 41 });
    expect(await db.localIdentityMappings.get("41:local:projects:x")).toMatchObject({ userId: 41 });
    expect(first).toEqual(second);
    expect(await db.apiCache.count()).toBe(2);
    expect(await db.syncQueue.count()).toBe(1);
    expect(await db.reportDrafts.count()).toBe(1);
    expect(await db.formDrafts.count()).toBe(1);
    expect(await db.localIdentityMappings.count()).toBe(1);
  });

  it("rolls back an interrupted copy and safely retries without duplicating records", async () => {
    await createLegacyDatabase(6, { apiCache: [cacheFor(41, "/api/risks")] });
    await db.open();
    // Opening intentionally exercises the production ready hook. Reset only
    // its canonical result so this test can force a mid-transaction abort
    // against the same untouched legacy source.
    await db.apiCache.clear();
    await db.offlineMeta.clear();

    const abortingHook = (_key: unknown, _row: unknown, transaction: { abort: () => void }) => {
      transaction.abort();
    };
    db.apiCache.hook("creating", abortingHook);
    await expect(migrateLegacyOfflineDatabase()).rejects.toThrow();
    db.apiCache.hook("creating").unsubscribe(abortingHook);

    expect(await db.apiCache.count()).toBe(0);
    expect(await db.offlineMeta.count()).toBe(0);

    await migrateLegacyOfflineDatabase();
    expect(await db.apiCache.count()).toBe(1);
    expect(await db.apiCache.get("41:/api/risks")).toMatchObject(cacheFor(41, "/api/risks"));
  });

  it("quarantines mismatched account-scoped durable keys instead of exposing them", async () => {
    await createLegacyDatabase(6, {
      syncQueue: [{
        id: 1,
        operationId: "wrong-draft-owner",
        clientId: "wrong-draft-owner",
        userId: 41,
        draftKey: "55:projects:9",
      }],
      reportDrafts: [{ draftKey: "55:project:9", userId: 41, snapshot: "{}" }],
      formDrafts: [{ key: "55:projects:9", userId: 41, payload: "{}" }],
      localIdentityMappings: [{ key: "55:local:projects:x", userId: 41, localEntityId: "local:projects:x" }],
    });

    await db.open();
    const state = await migrateLegacyOfflineDatabase();

    expect(await db.syncQueue.count()).toBe(0);
    expect(await db.reportDrafts.count()).toBe(0);
    expect(await db.formDrafts.count()).toBe(0);
    expect(await db.localIdentityMappings.count()).toBe(0);
    expect(state?.quarantinedByStore).toMatchObject({
      syncQueue: 1,
      reportDrafts: 1,
      formDrafts: 1,
      localIdentityMappings: 1,
    });
  });

  it("retains a legacy operation when its old numeric queue ID collides", async () => {
    const legacyQueue = {
      id: 7,
      operationId: "legacy-operation",
      clientId: "legacy-operation",
      userId: 41,
      syncStatus: "pending",
      createdAt: 10,
      module: "projects",
    };
    await createLegacyDatabase(6, { syncQueue: [legacyQueue] });
    await db.open();
    // Reproduce the state a failed prior migration could leave: no marker, but
    // a separately queued canonical operation already owns the legacy number.
    await db.syncQueue.clear();
    await db.offlineMeta.clear();
    await db.syncQueue.add({
      ...legacyQueue,
      id: 7,
      operationId: "canonical-operation",
      clientId: "canonical-operation",
    });

    await migrateLegacyOfflineDatabase();
    const operations = (await db.syncQueue.toArray()).map((item) => item.operationId).sort();

    expect(operations).toEqual(["canonical-operation", "legacy-operation"]);
    expect(await db.syncQueue.where("operationId").equals("legacy-operation").count()).toBe(1);
  });
});