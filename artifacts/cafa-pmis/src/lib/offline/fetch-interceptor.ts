import { db, cacheKey, setOfflineUser } from "./db";
import { syncService } from "./sync-service";
import { queueAttachment } from "./attachment-store";
import { explainOfflinePolicy, isAuthorisedOfflineRead } from "./policy";
import {
  getConnectivitySnapshot,
  recordConnectivityEvidence,
  requestConnectivityConfirmation,
} from "../connectivity-state";
import {
  getAuthenticatedSessionSnapshot,
  isAuthenticatedSessionCurrent,
  type AuthenticatedSessionSnapshot,
} from "../authenticated-session";

/* ── Offline-queued error (mutation was saved for later sync) ───────────── */

export class OfflineQueuedError extends Error {
  readonly clientId: string;
  constructor(clientId: string) {
    super("Action saved offline — will sync when connected");
    this.name = "OfflineQueuedError";
    this.clientId = clientId;
  }
}

export function isOfflineQueuedError(err: unknown): err is OfflineQueuedError {
  return (
    err instanceof OfflineQueuedError ||
    (typeof err === "object" && err !== null && (err as Error).name === "OfflineQueuedError")
  );
}

/* ── Offline-blocked error (action must NOT be queued offline) ──────────── */

export class OfflineBlockedError extends Error {
  readonly actionDescription: string;
  constructor(description: string) {
    super(`${description} cannot be done while offline`);
    this.name = "OfflineBlockedError";
    this.actionDescription = description;
  }
}

export function isOfflineBlockedError(err: unknown): err is OfflineBlockedError {
  return (
    err instanceof OfflineBlockedError ||
    (typeof err === "object" && err !== null && (err as Error).name === "OfflineBlockedError")
  );
}

/* ── Response cache ─────────────────────────────────────────────────────── */

// Seconds to keep each URL group in the Dexie API cache.
// Longer TTLs = more data available when offline for longer.
const TTL_MAP: Record<string, number> = {
  // Essentially static reference data
  states: 7 * 24 * 3600,
  sectors: 7 * 24 * 3600,
  "manual/chapters": 24 * 3600,
  "manual/sections": 24 * 3600,
  // Core project / operational data
  projects: 6 * 3600,
  plans: 6 * 3600,
  risks: 4 * 3600,
  reports: 4 * 3600,
  activities: 4 * 3600,
  indicators: 4 * 3600,
  outputs: 4 * 3600,
  // User data — shorter TTL so role changes propagate quickly
  me: 30 * 60,
  users: 30 * 60,
  // Frequently updated / live data — short TTLs
  notifications: 3 * 60,
  conversations: 3 * 60,
  messages: 3 * 60,
  dashboard: 5 * 60,
};

// Patterns that must never be cached (sensitive or high-churn data).
// - /api/audit-log: complete change history with sensitive before/after diffs
// - /api/users($|?): full user list with PII — matches bare /api/users AND
//   /api/users?... but NOT /api/users/switcher (needed offline for role UI)
// - /api/budget: financial allocation details
function getTtl(url: string): number {
  for (const [key, ttl] of Object.entries(TTL_MAP)) {
    if (url.includes(`/api/${key}`)) return ttl;
  }
  return 4 * 3600; // 4-hour default for unknown endpoints
}

async function getCached(url: string, userId: number | null): Promise<string | null> {
  if (userId === null || !isAuthorisedOfflineRead(url)) return null;
  try {
    const entry = await db.apiCache.get(cacheKey(userId, url));
    if (!entry) return null;
    if (entry.userId !== userId) return null;
    const ageSeconds = (Date.now() - entry.cachedAt) / 1000;
    if (ageSeconds > entry.ttlSeconds) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function cacheAuthenticatedResponse(
  url: string,
  data: string,
  session: AuthenticatedSessionSnapshot,
): Promise<void> {
  const userId = session.userId;
  if (
    userId === null
    || !isAuthenticatedSessionCurrent(session)
    || !isAuthorisedOfflineRead(url)
  ) return;
  const key = cacheKey(userId, url);
  try {
    await db.apiCache.put({
      cacheKey: key,
      url,
      data,
      status: 200,
      cachedAt: Date.now(),
      ttlSeconds: getTtl(url),
      userId,
    });
    // The authority can change while IndexedDB is committing. Delete a write
    // that landed after logout/scope invalidation so a late response cannot
    // recreate protected offline data after the purge.
    if (!isAuthenticatedSessionCurrent(session)) {
      await db.apiCache.delete(key);
    }
  } catch {
    // storage quota exceeded — silently ignore
  }
}

/** Derive the revision from an exact, authorised detail response. We never
 * guess from a list response: without a trustworthy precondition an offline
 * update is refused rather than risking a silent overwrite. */
async function cachedBaseRevision(url: string, userId: number): Promise<string | null> {
  try {
    const entry = await db.apiCache.get(cacheKey(userId, url));
    if (!entry || entry.userId !== userId) return null;
    const value = JSON.parse(entry.data) as unknown;
    const findRevision = (candidate: unknown): string | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const record = candidate as Record<string, unknown>;
      const revision = record.updatedAt ?? record.updated_at;
      if (typeof revision === "string" && !Number.isNaN(new Date(revision).getTime())) return revision;
      for (const nested of Object.values(record)) {
        const found = findRevision(nested);
        if (found) return found;
      }
      return null;
    };
    return findRevision(value);
  } catch {
    return null;
  }
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function resolveHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

async function resolveBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  // Don't try to serialise file/FormData uploads — queue the form fields only
  // if the content-type is application/json; otherwise fall through as null.
  if (init?.body) {
    if (typeof init.body === "string") return init.body;
    // FormData / Blobs cannot be serialised safely for the sync queue
    if (init.body instanceof FormData || init.body instanceof Blob) return null;
    try { return await new Response(init.body).text(); } catch { return null; }
  }
  if (input instanceof Request && input.method !== "GET") {
    const ct = (input as Request).headers.get("content-type") ?? "";
    if (ct.includes("multipart") || ct.includes("form-data")) return null;
    try { return await input.clone().text(); } catch { return null; }
  }
  return null;
}

/* ── Connectivity state ─────────────────────────────────────────────────── */

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && (error as Error).name === "AbortError";
}

function isHealthProbe(url: string): boolean {
  try {
    return new URL(url, window.location.origin).pathname === "/api/healthz";
  } catch {
    return url.split(/[?#]/, 1)[0] === "/api/healthz";
  }
}

function isCafaApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return url.startsWith("/api/");
  }
}

export function shouldSignalSessionExpiry(url: string, status: number): boolean {
  if (status !== 401) return false;
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    return pathname !== "/api/me" && !pathname.startsWith("/api/auth/");
  } catch {
    const pathname = url.split(/[?#]/, 1)[0];
    return pathname !== "/api/me" && !pathname.startsWith("/api/auth/");
  }
}

/* ── Installer ──────────────────────────────────────────────────────────── */

let installed = false;

export function installFetchInterceptor(getUserId: () => number | null): void {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);
    // Connectivity evidence must come only from the same-origin CAFA API.
    // A third-party URL containing "/api/" is never allowed to affect state.
    const isApi = isCafaApiUrl(url);
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
    const userId = getUserId();
    const authenticatedSession = getAuthenticatedSessionSnapshot();
    await setOfflineUser(userId);

    /* ── OFFLINE PATH ─────────────────────────────────────────────────── */
    // Read the canonical snapshot at interception time. This avoids a React
    // effect race after confirmation, while allowing the health probe to
    // prove recovery even while Offline.
    const isConfirmedOffline = getConnectivitySnapshot().status === "offline";
    if (isConfirmedOffline && isApi && !isHealthProbe(url)) {
      if (isMutation) {
        const body = await resolveBody(input, init);

        // ── Storage presigned-URL requests ──────────────────────────────
        // Intercept BEFORE the block-rule check so we can record the
        // attachment metadata before throwing.  The JSON body contains
        // {name, size, contentType} from the upload helper — we store those
        // in the attachmentQueue so the user sees a "re-select required"
        // badge in the Sync Status page.
        if (url.includes("/api/storage/uploads/request-url")) {
          if (body) {
            try {
              const { name = "unknown", size = 0, contentType = "application/octet-stream" } =
                JSON.parse(body) as { name?: string; size?: number; contentType?: string };
              queueAttachment({ fileName: name, fileSize: size, contentType }).catch(() => {});
            } catch {
              // ignore parse errors
            }
          }
          throw new OfflineBlockedError("File uploads");
        }

        const decision = explainOfflinePolicy(method, url, body);
        if (decision.kind !== "allowed-draft") {
          throw new OfflineBlockedError(decision.reason);
        }
        const headers = resolveHeaders(input, init);
        const parseMeta = (): Record<string, unknown> => {
          if (!body) return {};
          try {
            const parsed = JSON.parse(body) as unknown;
            return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
          } catch {
            return {};
          }
        };
        const meta = parseMeta();
        if (userId === null) throw new OfflineBlockedError("Draft saves");
        let baseRevision = headers.get("x-base-revision") ?? headers.get("if-match");
        if (["PATCH", "PUT"].includes(method)) {
          baseRevision ??= await cachedBaseRevision(url, userId);
          if (!baseRevision) {
            throw new OfflineBlockedError("This draft needs the latest server version");
          }
        }
        const clientId = await syncService.queue({
          method,
          url,
          body,
          userId,
          baseRevision,
          dependencyIds: (meta._dependsOn as string[] | undefined) ?? [],
          localEntityId: typeof meta._localId === "string" ? meta._localId : null,
          draftKey: typeof meta._draftKey === "string" ? meta._draftKey : null,
          operationId: typeof meta._syncOperationId === "string" ? meta._syncOperationId : undefined,
        });
        throw new OfflineQueuedError(clientId);
      }

      // Offline GET — try Dexie cache first, then fall through to SW cache
      const cached = await getCached(url, userId);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: { "content-type": "application/json", "x-from-offline-cache": "true" },
        });
      }
      throw new OfflineBlockedError("This data requires an internet connection");
    }

    /* ── ONLINE PATH ──────────────────────────────────────────────────── */
    try {
      const response = await originalFetch(input, init);
      // Health probes classify their own response so they are not counted
      // twice by this interceptor.
      if (isApi && !isHealthProbe(url)) {
        if (response.ok) recordConnectivityEvidence({ kind: "api-success" });
        else {
          recordConnectivityEvidence({ kind: "api-http", status: response.status });
          // A staff endpoint returning 401 means the established identity is
          // no longer authoritative. Reuse the socket provider's fail-closed
          // refresh path so active requests are cancelled and protected
          // caches are purged before the public shell is shown.
          if (shouldSignalSessionExpiry(url, response.status)) {
            window.dispatchEvent(new Event("cafa:authorization-changed"));
          }
          // One failed route is not global service evidence. A 5xx does,
          // however, ask the same bounded health confirmation used by a
          // transport failure so the banner can only become Degraded when the
          // CAFA service failure is confirmed independently.
          if (response.status >= 500) requestConnectivityConfirmation();
        }
      }

      // Cache successful GET API responses for offline use
      if (isApi && !isMutation && response.ok && response.status === 200) {
        response.clone().text().then((text) => {
          if (text.startsWith("{") || text.startsWith("[")) {
            void cacheAuthenticatedResponse(url, text, authenticatedSession);
          }
        }).catch(() => {});
      }

      return response;
    } catch (error) {
      // Abort is commonly TanStack Query cancellation or a component unmount,
      // neither of which is evidence that CAFA is unreachable.
      if (isApi && !isHealthProbe(url) && !isAbortError(error)) {
        recordConnectivityEvidence({ kind: "api-transport-failure" });
        requestConnectivityConfirmation();
      }
      throw error;
    }
  };
}
