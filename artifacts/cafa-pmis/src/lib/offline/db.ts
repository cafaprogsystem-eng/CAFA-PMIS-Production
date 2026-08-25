import Dexie, { type Table } from "dexie";

export type SyncStatus = "local-draft" | "pending" | "syncing" | "synced" | "failed" | "conflict";
export type ActionType = "create" | "update" | "delete" | "transition" | "other";
export type SyncFailureCode =
  | "network"
  | "session-expired"
  | "permission-denied"
  | "rejected"
  | "conflict"
  | "dependency"
  | "storage";
export type AttachmentStatus =
  | "pending"           // File is in memory — will auto-upload on reconnect
  | "uploading"         // Upload in progress
  | "uploaded"          // Successfully uploaded
  | "failed"            // Upload failed — can retry if file still in memory
  | "re-select-required"; // File no longer in memory — user must re-select

export type ReportDraftStatus = SyncStatus;

export interface ReportDraftSnapshot {
  /** Stable local identity. Includes the authenticated user in its lookup path. */
  draftKey: string;
  userId: number;
  reportType: "project" | "activity" | "program_state" | "hq_sector";
  /** Existing server record, when editing; null for a local-first draft. */
  serverReportId: number | null;
  /** JSON-serialised editor state. Binary fields are intentionally excluded. */
  snapshot: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
  status: ReportDraftStatus;
  baseRevision: string | null;
  syncOperationId: string | null;
  failureCode: SyncFailureCode | null;
  lastError: string | null;
}

export interface SyncQueueItem {
  id?: number;
  /** Stable operation identity. Never regenerate this during replay. */
  operationId: string;
  /** Kept as a compatibility alias for existing UI and server header names. */
  clientId: string;
  /** Authenticated account that owns this operation. */
  userId: number;
  actionType: ActionType;
  module: string;
  entityType: string;
  entityId: string | null;
  label: string;
  method: string;
  url: string;
  body: string | null;
  createdBy: number | null;
  createdAt: number;
  syncStatus: SyncStatus;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: number;
  lastAttemptAt: number | null;
  /** Stable identity used by a locally-created parent/child record. */
  localEntityId: string | null;
  /** Operation IDs that must be synced first. */
  dependencyIds: string[];
  /** Server revision observed when this draft was edited. */
  baseRevision: string | null;
  /** Links a replayed draft mutation to its durable editor snapshot. */
  draftKey: string | null;
  failureCode: SyncFailureCode | null;
  outcome: "synced" | "failed" | "conflict" | null;
  lastError: string | null;
  syncedAt: number | null;
}

export type FormDraftModule = "projects" | "plans" | "risks";

export interface FormDraftScope {
  /** Authorised state IDs at the time the draft was saved. */
  stateIds: number[];
  /** Authorised sectors at the time the draft was saved. */
  sectors: string[];
  /** Authorised server record IDs at the time the draft was saved. */
  projectIds: number[];
}

export interface FormDraft {
  /** User-scoped stable key, never a server record identifier. */
  key: string;
  userId: number;
  module: FormDraftModule;
  /** "new" or a server ID; local records use localEntityId. */
  recordKey: string;
  localEntityId: string | null;
  serverEntityId: number | null;
  label: string;
  /** JSON containing only safe, operational form fields. */
  payload: string;
  scope: FormDraftScope;
  baseRevision: string | null;
  status: Extract<SyncStatus, "local-draft" | "pending" | "synced" | "failed" | "conflict">;
  operationId: string | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

export interface LocalIdentityMapping {
  key: string;
  userId: number;
  localEntityId: string;
  module: FormDraftModule;
  serverEntityId: number;
  syncedAt: number;
}

export interface ApiCacheEntry {
  /** User-scoped primary key; URL alone is never a cache key. */
  cacheKey: string;
  url: string;
  data: string;
  status: number;
  cachedAt: number;
  ttlSeconds: number;
  /** User ID who owns this cache entry. Used to prevent cross-user data leaks. */
  userId: number;
}

/**
 * Attachment queue entry.
 *
 * Binary file data is NOT stored here — only metadata. The actual File object
 * lives in the in-memory cache inside attachment-store.ts for the duration of
 * the browser tab session. If the page is reloaded the file reference is lost
 * and the status is downgraded to "re-select-required".
 */
export interface AttachmentQueueItem {
  /** UUID generated on creation. Used as the key in the in-memory file cache. */
  id: string;
  userId: number;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: AttachmentStatus;
  createdAt: number;
  uploadedAt: number | null;
  lastError: string | null;
  /** Object path returned by the storage provider after a successful upload. */
  objectPath: string | null;
}

export const LEGACY_DATABASE_NAME = "cafa-pmis-v1";
export const CANONICAL_DATABASE_NAME = "cafa-pmis-v2";
export const OFFLINE_SCHEMA_VERSION = 1;
const LEGACY_MIGRATION_KEY = "legacy-v1-to-v2";

export interface OfflineMigrationState {
  key: string;
  status: "completed";
  sourceDatabase: string;
  sourceVersion: number;
  migratedAt: number;
  copiedByStore: Record<string, number>;
  quarantinedByStore: Record<string, number>;
}

type RawRow = Record<string, unknown>;

interface LegacySnapshot {
  version: number;
  stores: Map<string, unknown[]>;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRawRow(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Open the old database without asking IndexedDB to upgrade it. This is
 * deliberately native IDB rather than another Dexie instance: a Dexie schema
 * declaration for v1-v3 would replay the unsafe v4 primary-key change.
 */
async function readLegacySnapshot(): Promise<LegacySnapshot | null> {
  if (typeof indexedDB === "undefined") return null;

  // Avoid creating cafa-pmis-v1 on a fresh browser. `databases()` is available
  // in current Chromium, Firefox, and Safari versions; the fallback is still
  // safe because an empty v1 database is aborted before it is committed.
  const knownDatabases = typeof indexedDB.databases === "function"
    ? await indexedDB.databases()
    : null;
  if (knownDatabases && !knownDatabases.some((info) => info.name === LEGACY_DATABASE_NAME)) {
    return null;
  }

  return new Promise<LegacySnapshot | null>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DATABASE_NAME);
    let openedEmptyDatabase = false;
    request.onupgradeneeded = (event) => {
      if ((event as IDBVersionChangeEvent).oldVersion === 0) {
        openedEmptyDatabase = true;
        // Do not leave an empty legacy database behind on a fresh browser.
        request.transaction?.abort();
      }
    };
    request.onerror = () => {
      if (openedEmptyDatabase && request.error?.name === "AbortError") {
        resolve(null);
        return;
      }
      reject(request.error ?? new Error("Unable to read legacy IndexedDB"));
    };
    request.onsuccess = async () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      try {
        const storeNames = Array.from(database.objectStoreNames);
        const stores = new Map<string, unknown[]>();
        if (storeNames.length > 0) {
          const transaction = database.transaction(storeNames, "readonly");
          const rows = await Promise.all(
            storeNames.map((name) => requestResult(transaction.objectStore(name).getAll())),
          );
          storeNames.forEach((name, index) => stores.set(name, rows[index] as unknown[]));
        }
        resolve({ version: database.version, stores });
      } catch (error) {
        reject(error);
      } finally {
        database.close();
      }
    };
  });
}

function ownedRow(row: RawRow): row is RawRow & { userId: number } {
  return positiveInteger(row.userId);
}

function cacheRow(row: unknown): ApiCacheEntry | null {
  // v1-v3 rows were keyed by URL and normally had no userId. A row is only
  // attributable when it carries a valid account ID and complete cache
  // metadata. Never infer ownership from the URL, payload, or current user.
  if (
    !isRawRow(row) ||
    !ownedRow(row) ||
    typeof row.url !== "string" ||
    typeof row.data !== "string" ||
    !finiteNumber(row.status) ||
    !finiteNumber(row.cachedAt) ||
    !finiteNumber(row.ttlSeconds)
  ) {
    return null;
  }
  return {
    cacheKey: cacheKey(row.userId, row.url),
    url: row.url,
    data: row.data,
    status: row.status,
    cachedAt: row.cachedAt,
    ttlSeconds: row.ttlSeconds,
    userId: row.userId,
  };
}

function isAccountScopedKey(value: unknown, userId: number): boolean {
  return typeof value === "string" && value.startsWith(`${userId}:`);
}

function primaryKeyForStore(storeName: string, row: RawRow): string | number | null {
  if (storeName === "syncQueue") return positiveInteger(row.id) ? row.id : null;
  if (storeName === "apiCache") return null;
  const key = storeName === "attachmentQueue"
    ? row.id
    : storeName === "reportDrafts"
      ? row.draftKey
      : row.key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

function migratableDurableRow(storeName: string, value: unknown): value is RawRow & { userId: number } {
  if (!isRawRow(value) || !ownedRow(value) || primaryKeyForStore(storeName, value) === null) {
    return false;
  }
  if (storeName === "syncQueue") {
    return (
      typeof value.operationId === "string" &&
      value.operationId.length > 0 &&
      (value.draftKey === null || value.draftKey === undefined || isAccountScopedKey(value.draftKey, value.userId))
    );
  }
  if (storeName === "reportDrafts") return isAccountScopedKey(value.draftKey, value.userId);
  if (storeName === "formDrafts") return isAccountScopedKey(value.key, value.userId);
  if (storeName === "localIdentityMappings") return isAccountScopedKey(value.key, value.userId);
  return true;
}

function tableForStore(storeName: string, database: CafaOfflineDB): Table<RawRow, string | number> {
  return database.table(storeName) as unknown as Table<RawRow, string | number>;
}

class CafaOfflineDB extends Dexie {
  syncQueue!: Table<SyncQueueItem, number>;
  apiCache!: Table<ApiCacheEntry, string>;
  attachmentQueue!: Table<AttachmentQueueItem, string>;
  reportDrafts!: Table<ReportDraftSnapshot, string>;
  formDrafts!: Table<FormDraft, string>;
  localIdentityMappings!: Table<LocalIdentityMapping, string>;
  offlineMeta!: Table<OfflineMigrationState, string>;

  constructor() {
    super(CANONICAL_DATABASE_NAME);
    this.version(OFFLINE_SCHEMA_VERSION).stores({
      syncQueue: "++id, operationId, clientId, userId, syncStatus, createdAt, nextAttemptAt, module, localEntityId",
      apiCache: "cacheKey, [userId+url], userId, cachedAt",
      attachmentQueue: "id, userId, status, createdAt",
      reportDrafts: "draftKey, userId, [userId+updatedAt], reportType, status, serverReportId",
      formDrafts: "key, userId, [userId+module], updatedAt, status, localEntityId",
      localIdentityMappings: "key, userId, localEntityId, [userId+localEntityId]",
      offlineMeta: "key",
    });
  }
}

export const db = new CafaOfflineDB();

/**
 * Copy only account-owned records from the old database. The whole canonical
 * write is one transaction: an interrupted copy rolls back completely and a
 * later open can retry without duplicate queue, draft, mapping, or cache rows.
 * The old database is never modified or deleted.
 */
export async function migrateLegacyOfflineDatabase(): Promise<OfflineMigrationState | null> {
  const completed = await db.offlineMeta.get(LEGACY_MIGRATION_KEY);
  if (completed?.status === "completed") return completed;

  const legacy = await readLegacySnapshot();
  if (!legacy) return null;

  const copiedByStore: Record<string, number> = {};
  const quarantinedByStore: Record<string, number> = {};
  const sourceRows = (name: string) => legacy.stores.get(name) ?? [];
  const targetStores = [
    "syncQueue",
    "apiCache",
    "attachmentQueue",
    "reportDrafts",
    "formDrafts",
    "localIdentityMappings",
  ] as const;

  // A legacy URL-keyed cache could contain one row per URL, while a newer
  // source is cacheKey-keyed. Re-derive the key in both cases and select the
  // newest row deterministically before entering the write transaction.
  const cacheRows = new Map<string, ApiCacheEntry>();
  for (const row of sourceRows("apiCache")) {
    const normalized = cacheRow(row);
    if (!normalized) {
      quarantinedByStore.apiCache = (quarantinedByStore.apiCache ?? 0) + 1;
      continue;
    }
    const previous = cacheRows.get(normalized.cacheKey);
    if (!previous || normalized.cachedAt > previous.cachedAt) cacheRows.set(normalized.cacheKey, normalized);
  }
  copiedByStore.apiCache = cacheRows.size;

  const durableRows = new Map<string, RawRow[]>();
  for (const storeName of targetStores) {
    if (storeName === "apiCache") continue;
    const rows = sourceRows(storeName);
    const safeRows: RawRow[] = [];
    for (const row of rows) {
      if (!migratableDurableRow(storeName, row)) {
        if (rows.length > 0) quarantinedByStore[storeName] = (quarantinedByStore[storeName] ?? 0) + 1;
        continue;
      }
      safeRows.push(row);
    }
    durableRows.set(storeName, safeRows);
    copiedByStore[storeName] = safeRows.length;
  }

  const state: OfflineMigrationState = {
    key: LEGACY_MIGRATION_KEY,
    status: "completed",
    sourceDatabase: LEGACY_DATABASE_NAME,
    sourceVersion: legacy.version,
    migratedAt: Date.now(),
    copiedByStore,
    quarantinedByStore,
  };

  await db.transaction(
    "rw",
    [
      db.syncQueue,
      db.apiCache,
      db.attachmentQueue,
      db.reportDrafts,
      db.formDrafts,
      db.localIdentityMappings,
      db.offlineMeta,
    ],
    async () => {
      for (const row of cacheRows.values()) {
        const existing = await db.apiCache.get(row.cacheKey);
        if (!existing) await db.apiCache.add(row);
      }

      for (const storeName of targetStores) {
        if (storeName === "apiCache") continue;
        const table = tableForStore(storeName, db);
        for (const row of durableRows.get(storeName) ?? []) {
          const primaryKey = primaryKeyForStore(storeName, row);
          if (primaryKey === null) continue;
          if (storeName === "syncQueue") {
            const operationId = row.operationId as string;
            const existingOperation = await db.syncQueue.where("operationId").equals(operationId).first();
            if (existingOperation) continue;
            const existingId = await db.syncQueue.get(primaryKey as number);
            if (existingId) {
              // The old auto-increment ID is not durable identity. Keep both
              // operations by letting the canonical store allocate a new ID.
              const withoutLegacyId = { ...row };
              delete withoutLegacyId.id;
              await db.syncQueue.add(withoutLegacyId as unknown as SyncQueueItem);
              continue;
            }
          }
          const existing = await table.get(primaryKey);
          if (!existing) await table.add(row);
        }
      }
      await db.offlineMeta.put(state);
    },
  );
  return state;
}

// Dexie's ready hook is awaited by all normal table consumers, including
// useLiveQuery. Do not suppress a migration failure here: leaving Dexie closed
// prevents a new canonical queue/draft row from colliding with un-copied
// legacy data. A later open retries the intact source copy transaction.
db.on("ready", () => migrateLegacyOfflineDatabase());

/**
 * Initialise the canonical schema during application startup rather than
 * waiting for the first authenticated cache or queue operation. Browsers
 * without IndexedDB remain usable online; offline features simply stay
 * unavailable and log a diagnostic-safe warning.
 */
export const offlineDatabaseReady = typeof indexedDB === "undefined"
  ? Promise.resolve()
  : db.open().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`[offline] Canonical database unavailable (${name})`);
  });

let activeUserId: number | null = null;

/** Switch the local security context. A known-to-known account change purges
 * stale browser state so a shared device cannot reveal the previous account. */
export async function setOfflineUser(userId: number | null): Promise<void> {
  if (activeUserId !== null && activeUserId !== userId) {
    await clearOfflineData();
  }
  activeUserId = userId;
}

export function getOfflineUser(): number | null {
  return activeUserId;
}

export function cacheKey(userId: number, url: string): string {
  return `${userId}:${url}`;
}

export async function clearOfflineData(): Promise<void> {
  await Promise.all([
    db.syncQueue.clear(),
    db.apiCache.clear(),
    db.attachmentQueue.clear(),
    db.reportDrafts.clear(),
    db.formDrafts.clear(),
    db.localIdentityMappings.clear(),
  ]);
}

/** Clear only the API cache (keeps the sync queue and attachment queue intact). */
export async function clearApiCache(userId?: number): Promise<void> {
  if (userId === undefined) {
    await db.apiCache.clear();
    return;
  }
  await db.apiCache.where("userId").equals(userId).delete();
}
