import { db, type SyncQueueItem, type ActionType, type SyncFailureCode, type FormDraftModule } from "./db";
import { markDraftResult, saveIdentityMapping } from "./draft-store";
import { settleReportDraftOperation } from "./report-drafts";

export interface QueueMutationOpts {
  method: string;
  url: string;
  body?: string | null;
  userId?: number | null;
  operationId?: string;
  baseRevision?: string | null;
  dependencyIds?: string[];
  localEntityId?: string | null;
  draftKey?: string | null;
}

export interface SyncResult {
  synced: number;
  failed: number;
  conflicts: number;
}

const MODULE_MAP: Record<string, string> = {
  projects: "Projects",
  reports: "Reports",
  plans: "Plans",
  risks: "Risks",
  comments: "Comments",
  conversations: "Messages",
  messages: "Messages",
  users: "Users",
  auth: "Auth",
  notifications: "Notifications",
  manual: "Manual",
  states: "States",
  budget: "Budget",
  storage: "Storage",
};

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const BASE_BACKOFF_MS = 5 * 1000;

type SyncOperationOutcome = SyncResult & { operations: Array<{
  operationId: string;
  status: SyncQueueItem["syncStatus"];
  failureCode: SyncFailureCode | null;
}> };

function parseModule(url: string): string {
  const seg = url.match(/\/api\/([^/?#]+)/)?.[1] ?? "unknown";
  return MODULE_MAP[seg] ?? seg;
}

function parseActionType(method: string, url: string): ActionType {
  const m = method.toUpperCase();
  if (m === "DELETE") return "delete";
  if (url.includes("/transitions")) return "transition";
  if (m === "POST") return "create";
  if (m === "PATCH" || m === "PUT") return "update";
  return "other";
}

function parseLabel(method: string, url: string, module: string): string {
  const action = parseActionType(method, url);
  const singular = module.replace(/s$/, "");
  const labels: Record<ActionType, string> = {
    create: `Create ${singular}`,
    update: `Update ${singular}`,
    delete: `Delete ${singular}`,
    transition: `Submit ${singular}`,
    other: `${module} action`,
  };
  return labels[action];
}

function isOperationalDraftKey(draftKey: string): boolean {
  const [, module, recordKey] = draftKey.split(":");
  return Boolean(recordKey && (module === "projects" || module === "plans" || module === "risks"));
}

async function settleDraftOperation(
  item: SyncQueueItem,
  status: "synced" | "failed" | "conflict",
  failureCode: SyncFailureCode | null,
  message: string | null,
): Promise<void> {
  if (!item.draftKey) return;
  if (isOperationalDraftKey(item.draftKey)) {
    await markDraftResult(
      item.draftKey,
      item.operationId,
      status,
      message ?? undefined,
      status === "synced" && item.actionType === "create",
    );
    return;
  }
  await settleReportDraftOperation(item.draftKey, item.operationId, status, failureCode, message);
}

export class SyncService extends EventTarget {
  private _running = false;
  private activeUserId: number | null = null;
  private replayGeneration = 0;
  private replayAbortController: AbortController | null = null;

  setUserId(userId: number | null): void {
    if (this.activeUserId === userId) return;
    this.activeUserId = userId;
    this.replayGeneration += 1;
    this.replayAbortController?.abort();
    this.replayAbortController = null;
  }

  async queue(opts: QueueMutationOpts): Promise<string> {
    if (opts.userId === null || opts.userId === undefined) {
      throw new Error("Cannot queue offline work without an authenticated user");
    }
    const clientId = opts.operationId ?? crypto.randomUUID();
    const module = parseModule(opts.url);
    const actionType = parseActionType(opts.method, opts.url);
    const entityId = opts.url.match(/\/api\/[^/]+\/([0-9]+)/)?.[1] ?? null;
    const item: SyncQueueItem = {
      clientId,
      operationId: clientId,
      userId: opts.userId,
      actionType,
      module,
      entityType: module.toLowerCase().replace(/s$/, ""),
      entityId,
      label: parseLabel(opts.method, opts.url, module),
      method: opts.method.toUpperCase(),
      url: opts.url,
      body: opts.body ?? null,
      createdBy: opts.userId,
      createdAt: Date.now(),
      syncStatus: "pending",
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      nextAttemptAt: 0,
      lastAttemptAt: null,
      localEntityId: opts.localEntityId ?? (actionType === "create" ? `local:${clientId}` : null),
      dependencyIds: opts.dependencyIds ?? [],
      baseRevision: opts.baseRevision ?? null,
      draftKey: opts.draftKey ?? null,
      failureCode: null,
      outcome: null,
      lastError: null,
      syncedAt: null,
    };
    // Link the durable snapshot before making its queue row visible. Both
    // writes commit together, so another tab can never replay this operation
    // against an unlinked snapshot and leave it stuck in Pending Sync.
    await db.transaction("rw", db.formDrafts, db.reportDrafts, db.syncQueue, async () => {
      if (item.draftKey && isOperationalDraftKey(item.draftKey)) {
        const [draftUserId, , recordKey] = item.draftKey.split(":");
        if (Number(draftUserId) === item.userId && recordKey) {
          const draft = await db.formDrafts.get(item.draftKey);
          if (draft) {
            await db.formDrafts.update(item.draftKey, {
              status: "pending",
              operationId: item.operationId,
              updatedAt: Date.now(),
              lastError: null,
            });
          }
        }
      } else if (item.draftKey) {
        const reportDraft = await db.reportDrafts.get(item.draftKey);
        if (reportDraft) {
          await db.reportDrafts.update(item.draftKey, {
            status: "pending",
            syncOperationId: item.operationId,
            failureCode: null,
            lastError: null,
            updatedAt: Date.now(),
          });
        }
      }
      await db.syncQueue.add(item);
    });
    this.dispatchEvent(new CustomEvent("change"));
    return clientId;
  }

  async processQueue(): Promise<SyncResult> {
    if (this._running) return { synced: 0, failed: 0, conflicts: 0 };
    if (this.activeUserId === null) return { synced: 0, failed: 0, conflicts: 0 };
    return this.withReplayLock(() => this.processQueueLocked());
  }

  private async processQueueLocked(): Promise<SyncResult> {
    if (this._running) return { synced: 0, failed: 0, conflicts: 0 };
    this._running = true;
    const replayGeneration = this.replayGeneration;
    const replayAbortController = new AbortController();
    this.replayAbortController = replayAbortController;
    let synced = 0, failed = 0, conflicts = 0;
    const operations: SyncOperationOutcome["operations"] = [];
    try {
      const items = await db.syncQueue
        .where("syncStatus")
        .equals("pending")
        .sortBy("createdAt");

      const eligible = items.filter((i) =>
        i.userId === this.activeUserId &&
        i.retryCount < i.maxRetries &&
        i.nextAttemptAt <= Date.now(),
      );

      for (const item of eligible) {
        if (!this.isReplayCurrent(item.userId, replayGeneration, replayAbortController.signal)) {
          // A shared browser changed accounts since this run started. Do not
          // ever send the previous user's work under the new session.
          continue;
        }
        const dependencies = await Promise.all(
          item.dependencyIds.map((operationId) =>
            db.syncQueue.where("operationId").equals(operationId).first(),
          ),
        );
        if (dependencies.some((dependency) =>
          dependency && dependency.userId === item.userId &&
          ["failed", "conflict"].includes(dependency.syncStatus),
        )) {
          await db.syncQueue.update(item.id!, {
            syncStatus: "failed",
            outcome: "failed",
            failureCode: "dependency",
            lastError: "A required offline change failed; review it before retrying this item.",
          });
          failed++;
          operations.push({ operationId: item.operationId, status: "failed", failureCode: "dependency" });
          continue;
        }
        if (dependencies.some((dependency) => dependency && dependency.syncStatus !== "synced")) {
          continue;
        }
        // Do not break on navigator.onLine — it is unreliable in proxied envs.
        // If the network is genuinely down the fetch below will throw and be caught.
        const claimed = await db.syncQueue.update(item.id!, {
          syncStatus: "syncing",
          lastAttemptAt: Date.now(),
        });
        if (!claimed) continue;
        this.dispatchEvent(new CustomEvent("change"));
        try {
          if (!this.isReplayCurrent(item.userId, replayGeneration, replayAbortController.signal)) {
            await this.restoreCancelledClaim(item);
            continue;
          }
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "x-client-id": item.operationId,
          };
          if (item.baseRevision) headers["x-base-revision"] = item.baseRevision;
          const replayBody = await this.resolveReplayBody(item);
          if (!this.isReplayCurrent(item.userId, replayGeneration, replayAbortController.signal)) {
            await this.restoreCancelledClaim(item);
            continue;
          }
          const res = await fetch(item.url, {
            method: item.method,
            headers,
            body: replayBody ?? undefined,
            credentials: "include",
            signal: replayAbortController.signal,
          });
          if (!this.isReplayCurrent(item.userId, replayGeneration, replayAbortController.signal)) {
            await this.restoreCancelledClaim(item);
            continue;
          }
          if (res.status === 409) {
            await db.syncQueue.update(item.id!, {
              syncStatus: "conflict",
              outcome: "conflict",
              failureCode: "conflict",
              lastError: "Conflict: server data changed while offline",
            });
            await settleDraftOperation(item, "conflict", "conflict", "Conflict: server data changed while offline");
            conflicts++;
            operations.push({ operationId: item.operationId, status: "conflict", failureCode: "conflict" });
          } else if (res.ok || res.status === 204) {
            const serverEntityId = await responseEntityId(res);
            if (item.actionType === "create" && item.localEntityId && serverEntityId) {
              await saveIdentityMapping({
                userId: item.userId,
                localEntityId: item.localEntityId,
                module: item.module.toLowerCase() as FormDraftModule,
                serverEntityId,
              });
            }
            await db.syncQueue.update(item.id!, {
              syncStatus: "synced",
              outcome: "synced",
              failureCode: null,
              lastError: null,
              syncedAt: Date.now(),
            });
            await settleDraftOperation(item, "synced", null, null);
            synced++;
            operations.push({ operationId: item.operationId, status: "synced", failureCode: null });
          } else {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            const newRetry = item.retryCount + 1;
            const failureCode = classifyFailure(res.status);
            const terminal = newRetry >= item.maxRetries || ["session-expired", "permission-denied", "rejected"].includes(failureCode);
            await db.syncQueue.update(item.id!, {
              syncStatus: terminal ? "failed" : "pending",
              outcome: terminal ? "failed" : null,
              retryCount: newRetry,
              nextAttemptAt: terminal ? 0 : Date.now() + backoffMs(newRetry),
              failureCode,
              lastError: errText.slice(0, 300),
            });
            if (terminal) await settleDraftOperation(item, "failed", failureCode, errText.slice(0, 300));
            failed++;
            operations.push({ operationId: item.operationId, status: terminal ? "failed" : "pending", failureCode });
          }
        } catch (err) {
          if (!this.isReplayCurrent(item.userId, replayGeneration, replayAbortController.signal)) {
            await this.restoreCancelledClaim(item);
            this.dispatchEvent(new CustomEvent("change"));
            continue;
          }
          if (err instanceof OfflineDependencyError) {
            const message = err.message.slice(0, 300);
            await db.syncQueue.update(item.id!, {
              syncStatus: "failed",
              outcome: "failed",
              failureCode: "dependency",
              lastError: message,
            });
            await settleDraftOperation(item, "failed", "dependency", message);
            failed++;
            operations.push({ operationId: item.operationId, status: "failed", failureCode: "dependency" });
            this.dispatchEvent(new CustomEvent("change"));
            continue;
          }
          const newRetry = item.retryCount + 1;
          const terminal = newRetry >= item.maxRetries;
          await db.syncQueue.update(item.id!, {
            syncStatus: terminal ? "failed" : "pending",
            outcome: terminal ? "failed" : null,
            retryCount: newRetry,
            nextAttemptAt: terminal ? 0 : Date.now() + backoffMs(newRetry),
            failureCode: "network",
            lastError: String(err).slice(0, 300),
          });
          if (terminal) await settleDraftOperation(item, "failed", "network", String(err).slice(0, 300));
          failed++;
          operations.push({ operationId: item.operationId, status: terminal ? "failed" : "pending", failureCode: "network" });
        }
        this.dispatchEvent(new CustomEvent("change"));
      }
    } finally {
      this._running = false;
      if (this.replayAbortController === replayAbortController) {
        this.replayAbortController = null;
      }
    }
    this.dispatchEvent(new CustomEvent("sync-complete", { detail: { synced, failed, conflicts, operations } }));
    return { synced, failed, conflicts };
  }

  async retryItem(id: number): Promise<void> {
    const item = await db.syncQueue.get(id);
    if (!item || item.userId !== this.activeUserId) return;
    await db.syncQueue.update(id, {
      syncStatus: "pending",
      outcome: null,
      retryCount: 0,
      nextAttemptAt: 0,
      failureCode: null,
      lastError: null,
    });
    this.dispatchEvent(new CustomEvent("change"));
  }

  async discardItem(id: number): Promise<void> {
    const item = await db.syncQueue.get(id);
    if (item?.userId === this.activeUserId) await db.syncQueue.delete(id);
    this.dispatchEvent(new CustomEvent("change"));
  }

  async clearSynced(): Promise<void> {
    if (this.activeUserId !== null) {
      await db.syncQueue.where("syncStatus").equals("synced").and((item) => item.userId === this.activeUserId).delete();
    }
    this.dispatchEvent(new CustomEvent("change"));
  }

  async getPendingCount(): Promise<number> {
    return this.countForUser(["pending", "syncing"]);
  }

  async getFailedCount(): Promise<number> {
    return this.countForUser(["failed"]);
  }

  async getConflictCount(): Promise<number> {
    return this.countForUser(["conflict"]);
  }

  private countForUser(statuses: SyncQueueItem["syncStatus"][]): Promise<number> {
    if (this.activeUserId === null) return Promise.resolve(0);
    return db.syncQueue.where("syncStatus").anyOf(statuses).and((item) => item.userId === this.activeUserId).count();
  }

  /** Only one tab may replay a user's queue. navigator.locks is authoritative
   * when available; the lease is a backwards-compatible fallback. */
  private async withReplayLock<T>(work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      const result = await navigator.locks.request(
        `cafa-offline-sync:${this.activeUserId}`,
        { ifAvailable: true },
        async (lock) => lock ? work() : null,
      );
      return result ?? ({ synced: 0, failed: 0, conflicts: 0 } as T);
    }
    // localStorage cannot provide an atomic compare-and-set lease. Failing
    // closed is safer than pretending it prevents two tabs from replaying.
    return { synced: 0, failed: 0, conflicts: 0 } as T;
  }

  private ownsCurrentBrowserSession(userId: number): boolean {
    if (this.activeUserId !== userId) return false;
    const stored = Number(localStorage.getItem("cafa.userId"));
    return Number.isInteger(stored) && stored === userId;
  }

  private isReplayCurrent(
    userId: number,
    generation: number,
    signal: AbortSignal,
  ): boolean {
    return !signal.aborted
      && generation === this.replayGeneration
      && this.ownsCurrentBrowserSession(userId);
  }

  private async restoreCancelledClaim(item: SyncQueueItem): Promise<void> {
    await db.syncQueue.update(item.id!, {
      syncStatus: "pending",
      outcome: null,
      lastError: "Sync paused because the authenticated session ended.",
      nextAttemptAt: Date.now() + BASE_BACKOFF_MS,
    });
  }

  /**
   * Queue metadata never reaches the API. Local parent IDs are only resolved
   * for relationship fields; a missing mapping fails closed before a request
   * can accidentally point at the wrong server record.
   */
  private async resolveReplayBody(item: SyncQueueItem): Promise<string | null> {
    if (!item.body) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(item.body);
    } catch {
      return item.body;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return item.body;
    const source = payload as Record<string, unknown>;
    const withoutMeta = { ...source };
    delete withoutMeta._dependsOn;
    delete withoutMeta._localId;
    delete withoutMeta._draftKey;
    const resolve = async (value: unknown, key?: string): Promise<unknown> => {
      if (Array.isArray(value)) return Promise.all(value.map((entry) => resolve(entry)));
      if (!value || typeof value !== "object") {
        if (typeof value === "string" && key && /(?:^|_)(?:project|plan|risk|activity|parent)Id$/i.test(key) && value.startsWith("local:")) {
          const mapping = await db.localIdentityMappings.get(`${item.userId}:${value}`);
          if (!mapping) throw new OfflineDependencyError(`The local parent ${value} has not synced yet.`);
          return mapping.serverEntityId;
        }
        return value;
      }
      const output: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        output[childKey] = await resolve(childValue, childKey);
      }
      return output;
    };
    return JSON.stringify(await resolve(withoutMeta));
  }
}

export const syncService = new SyncService();

class OfflineDependencyError extends Error {}

async function responseEntityId(res: Response): Promise<number | null> {
  try {
    const body = await res.clone().json() as Record<string, unknown>;
    const id = body.id
      ?? (body.project as Record<string, unknown> | undefined)?.id
      ?? (body.plan as Record<string, unknown> | undefined)?.id
      ?? (body.risk as Record<string, unknown> | undefined)?.id;
    const numberId = Number(id);
    return Number.isInteger(numberId) && numberId > 0 ? numberId : null;
  } catch {
    return null;
  }
}

function backoffMs(retryCount: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, retryCount - 1));
}

function classifyFailure(status: number): SyncFailureCode {
  // Another tab/process owns the same idempotency claim. This is transient:
  // retain the stable operation ID and retry on the normal backoff schedule.
  if (status === 425) return "network";
  if (status === 401) return "session-expired";
  if (status === 403) return "permission-denied";
  if (status === 409) return "conflict";
  return status >= 400 && status < 500 ? "rejected" : "network";
}
