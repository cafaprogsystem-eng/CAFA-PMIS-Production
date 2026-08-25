import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  getGetBeneficiariesBreakdownQueryKey,
  getGetDashboardAttentionProjectsQueryKey,
  getGetDashboardLateReportsQueryKey,
  getGetDashboardNotificationsSummaryQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDonorPortfolioQueryKey,
  getGetPlanQueryKey,
  getGetPendingApprovalsQueryKey,
  getGetPlanningDashboardQueryKey,
  getGetProjectBudgetPerformanceQueryKey,
  getGetProjectBudgetQueryKey,
  getGetProjectQueryKey,
  getGetReportAggregatesQueryKey,
  getGetReportsStatsQueryKey,
  getGetReportsSummaryQueryKey,
  getListReportAuthorsQueryKey,
  getGetSectorBudgetQueryKey,
  getGetSectorPerformanceQueryKey,
  getGetStatePerformanceQueryKey,
  getGetUserEffectiveAccessQueryKey,
  getGetUserQueryKey,
  getGetUsersSummaryQueryKey,
  getListPlansQueryKey,
  getListProjectsQueryKey,
  getListReportsQueryKey,
  getListRisksQueryKey,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { clearNotificationQueries, invalidateNotificationQueries } from "@/lib/notification-client";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

type OperationalEntityType = "project" | "report" | "plan" | "risk";
type SupportingEntityType =
  | "notification"
  | "user"
  | "state"
  | "conversation"
  | "file"
  | "program_resource"
  | "attachment"
  | "attachment_reconciliation";
type RealtimeEntityType = OperationalEntityType | SupportingEntityType;

export interface DomainRealtimeEvent {
  version: 1;
  entityType: RealtimeEntityType;
  entityId: number;
  action: string;
  revision?: number;
  occurredAt: string;
  scope?: {
    stateIds?: number[];
    sectors?: string[];
    projectId?: number;
  };
}

interface SocketContextValue {
  socket: Socket | null;
  status: ConnectionStatus;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: "disconnected",
});

const OPERATIONAL_ENTITY_TYPES = new Set<OperationalEntityType>(["project", "report", "plan", "risk"]);
const SUPPORTING_ENTITY_TYPES = new Set<SupportingEntityType>([
  "notification",
  "user",
  "state",
  "conversation",
  "file",
  "program_resource",
  "attachment",
  "attachment_reconciliation",
]);
const ENTITY_TYPES = new Set<RealtimeEntityType>([
  ...OPERATIONAL_ENTITY_TYPES,
  ...SUPPORTING_ENTITY_TYPES,
]);

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && typeof value === "number" && value > 0;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Domain events are cache-invalidating hints, never a source of record data.
 * Reject malformed transport input before it can affect client cache state.
 */
export function parseDomainRealtimeEvent(value: unknown): DomainRealtimeEvent | null {
  if (!isObject(value)) return null;
  const entityType = value.entityType;
  const entityId = value.entityId;
  const action = value.action;
  const occurredAt = value.occurredAt;
  if (
    value.version !== 1 ||
    typeof entityType !== "string" ||
    !ENTITY_TYPES.has(entityType as RealtimeEntityType) ||
    !isPositiveInteger(entityId) ||
    typeof action !== "string" ||
    !action.trim() ||
    action.length > 80 ||
    typeof occurredAt !== "string" ||
    Number.isNaN(Date.parse(occurredAt))
  ) return null;
  if (value.revision !== undefined && (!isPositiveInteger(value.revision))) return null;
  return {
    version: 1,
    entityType: entityType as RealtimeEntityType,
    entityId,
    action: action.trim(),
    occurredAt,
    ...(value.revision !== undefined ? { revision: value.revision } : {}),
  };
}

const dashboardKeys = (): QueryKey[] => [
  getGetDashboardSummaryQueryKey(),
  getGetSectorPerformanceQueryKey(),
  getGetBeneficiariesBreakdownQueryKey(),
  getGetDonorPortfolioQueryKey(),
  getGetProjectBudgetPerformanceQueryKey(),
  getGetDashboardNotificationsSummaryQueryKey(),
  getGetDashboardAttentionProjectsQueryKey(),
  getGetDashboardLateReportsQueryKey(),
  getGetReportsSummaryQueryKey(),
  getGetStatePerformanceQueryKey(),
  getGetPendingApprovalsQueryKey(),
  getGetReportsStatsQueryKey(),
  getListReportAuthorsQueryKey(),
  // A custom hook owns the hierarchical-performance query.
  ["hierarchical-performance"],
  ["/api/dashboard/recent-activity"],
  ["/api/dashboard/agenda"],
  ["/api/dashboard/performance"],
  ["/api/dashboard/performance/states"],
  ["/api/dashboard/performance/projects"],
  ["/api/dashboard/pmr-reporting-completeness"],
];

const communicationsKeys = (conversationId?: number): QueryKey[] => [
  ["conversations"],
  ["conversations-header"],
  ["conversations-unread"],
  ["/api/conversations"],
  ["/api/conversations/unread-count"],
  ...(conversationId ? [
    ["conversation", conversationId],
    ["messages", conversationId],
    ["pinned", conversationId],
    ["media", conversationId],
    [`/api/conversations/${conversationId}`],
    [`/api/conversations/${conversationId}/messages`],
    [`/api/conversations/${conversationId}/pinned`],
    [`/api/conversations/${conversationId}/media`],
  ] : []),
];

/**
 * These keys intentionally use generated key factories or the established
 * custom page namespaces. A prefix invalidates every filter/pagination variant
 * of that resource while retaining unrelated module caches.
 */
export function queryKeysForDomainEvent(event: DomainRealtimeEvent): QueryKey[] {
  const { entityType, entityId } = event;
  if (!OPERATIONAL_ENTITY_TYPES.has(entityType as OperationalEntityType)) {
    switch (entityType) {
      case "notification":
        return [];
      case "user":
        return [
          getListUsersQueryKey(),
          getGetUsersSummaryQueryKey(),
          ["users-for-messaging"],
          ["/api/users"],
          ["/api/users/summary"],
        ];
      case "state":
        return [["/api/states"], ["states-list"], ["/api/localities"], ["/api/states/"]];
      case "conversation":
        return communicationsKeys(entityId);
      case "file":
      case "program_resource":
        return [["files"], ["/api/files"], ["program-resources"]];
      case "attachment":
        return [["plans"], ["/api/plans"], ["risks"], ["/api/risks"], ["files"]];
      case "attachment_reconciliation":
        return [["attachment-reconciliation"]];
    }
  }
  const commonOperational = [
    ...dashboardKeys(),
    getGetSectorBudgetQueryKey(),
    ["files"],
    ["/api/files"],
  ] as QueryKey[];

  switch (entityType) {
    case "project":
      return [
        getListProjectsQueryKey(),
        getGetProjectQueryKey(entityId),
        getGetProjectBudgetQueryKey(entityId),
        ["project-documents", entityId],
        ["project-report-kpis", entityId],
        [`/api/projects/${entityId}/state-allocations`],
        ["project-activities-for-report", entityId],
        ["scoped-activities-for-report", entityId],
        ["project-indicators-for-report", entityId],
        ["risks", "for-report", entityId],
        ["project", entityId],
        ["getProject", entityId],
        ["project-deletion-info", entityId],
        ...commonOperational,
      ];
    case "report":
      return [
        getListReportsQueryKey(),
        [`/api/reports/${entityId}`],
        getGetReportAggregatesQueryKey(entityId),
        [`/api/reports/${entityId}/attachments`],
        ["comments", "report", entityId],
        ["report-activity-facet"],
        ...dashboardKeys(),
        ["files"],
        ["/api/files"],
      ];
    case "plan":
      return [
        getListPlansQueryKey(),
        getGetPlanQueryKey(entityId),
        getGetPlanningDashboardQueryKey(),
        [`/api/plans/${entityId}/attachments`],
        ["attachments", "plans", entityId],
        ["plan", entityId],
        ["comments", "plan", entityId],
        ...commonOperational,
      ];
    case "risk":
      return [
        getListRisksQueryKey(),
        [`/api/risks/${entityId}`],
        [`/api/risks/${entityId}/attachments`],
        ["attachments", "risks", entityId],
        ["risk-history", entityId],
        ["risk-active-assignees"],
        ...commonOperational,
      ];
  }
  return [];
}

function invalidateKeys(queryClient: QueryClient, keys: QueryKey[]): void {
  const seen = new Set<string>();
  for (const queryKey of keys) {
    const signature = JSON.stringify(queryKey);
    if (seen.has(signature)) continue;
    seen.add(signature);
    // Inactive caches become stale; only visible observers are refetched.
    // This makes a reconnect bounded and avoids a whole-app network loop.
    void queryClient.invalidateQueries({ queryKey, refetchType: "active" });
  }
}

export function invalidateDomainEventQueries(
  queryClient: QueryClient,
  event: DomainRealtimeEvent,
): void {
  invalidateKeys(queryClient, queryKeysForDomainEvent(event));
}

function legacyEventToDomainEvent(value: unknown): DomainRealtimeEvent | null {
  if (!isObject(value) || !isPositiveInteger(value.entityId) || typeof value.action !== "string") return null;
  const entityTypeByModule: Record<string, OperationalEntityType> = {
    project: "project",
    projects: "project",
    report: "report",
    reports: "report",
    plan: "plan",
    plans: "plan",
    risk: "risk",
    risks: "risk",
  };
  const entityType = typeof value.module === "string" ? entityTypeByModule[value.module] : undefined;
  if (!entityType) return null;
  return {
    version: 1,
    entityType,
    entityId: value.entityId,
    action: value.action,
    occurredAt: new Date().toISOString(),
  };
}

/**
 * Older route mutations still emit module:update. Keep that compatibility path
 * narrow and route it through the same verified entity registry.
 */
export function invalidateLegacyModuleEventQueries(queryClient: QueryClient, value: unknown): void {
  const event = legacyEventToDomainEvent(value);
  if (event) {
    invalidateDomainEventQueries(queryClient, event);
    return;
  }
  if (!isObject(value) || typeof value.module !== "string") return;
  if (value.module === "notifications") {
    // Recipient-private notification keys require userId and are handled by
    // notification:new. Do not invalidate another recipient's cache here.
    return;
  }
  if (value.module === "comments") {
    invalidateKeys(queryClient, [["comments"]]);
  } else if (value.module === "files") {
    invalidateKeys(queryClient, [["files"], ["/api/files"]]);
  } else if (value.module === "users" || value.module === "user") {
    const entityId = isPositiveInteger(value.entityId) ? value.entityId : undefined;
    invalidateKeys(queryClient, [
      getListUsersQueryKey(),
      getGetUsersSummaryQueryKey(),
      ["password-reset-tokens"],
      ...(entityId ? [
        getGetUserQueryKey(entityId),
        getGetUserEffectiveAccessQueryKey(entityId),
      ] : []),
    ]);
  }
}

export function invalidateConversationQueries(queryClient: QueryClient, conversationId?: number): void {
  invalidateKeys(queryClient, communicationsKeys(conversationId));
}

const CATCHUP_CUSTOM_NAMESPACES = new Set([
  "project",
  "getProject",
  "project-deletion-info",
  "project-documents",
  "project-report-kpis",
  "project-activities-for-report",
  "scoped-activities-for-report",
  "project-indicators-for-report",
  "report-activity-facet",
  "comments",
  "plan",
  "attachments",
  "risk-history",
  "risk-active-assignees",
  "risks",
  "files",
  "hierarchical-performance",
  "conversations",
  "conversations-header",
  "conversations-unread",
  "conversation",
  "messages",
  "pinned",
  "media",
  "password-reset-tokens",
]);

function isRealtimeCatchupQuery(queryKey: QueryKey, userId: number): boolean {
  const root = queryKey[0];
  if (root === "notifications") return queryKey[1] === userId;
  if (typeof root !== "string") return false;
  if (CATCHUP_CUSTOM_NAMESPACES.has(root)) return true;
  // Generated resource detail keys are URL-first and cannot be reached through
  // their list keys. Restrict this to operational resources rather than every
  // `/api/*` query, so a reconnect remains a bounded data catch-up.
  return /^\/api\/(?:projects|reports|plans|risks|files|dashboard|conversations)(?:\/|$)/.test(root);
}

/**
 * A reconnect cannot replay transient events. Mark only operational surfaces
 * stale and refetch the currently mounted ones; unrelated routes stay untouched.
 */
export function invalidateRealtimeCatchupQueries(queryClient: QueryClient, userId: number): void {
  void queryClient.invalidateQueries({
    predicate: (query) => isRealtimeCatchupQuery(query.queryKey, userId),
    refetchType: "active",
  });
}

function removeEntityQueries(queryClient: QueryClient, entityType: OperationalEntityType, entityId: number): void {
  const event: DomainRealtimeEvent = {
    version: 1,
    entityType,
    entityId,
    action: "access_revoked",
    occurredAt: new Date().toISOString(),
  };
  // A revoked direct assignment can remove a record from list/dashboard
  // results as well as denying its detail endpoint. Remove every dependent
  // cached surface; a later authorised mount fetches fresh server-scoped data.
  for (const queryKey of queryKeysForDomainEvent(event)) {
    queryClient.removeQueries({ queryKey });
  }
}

type AuthSnapshot = {
  user?: { id?: number; role?: string; stateId?: number | null; sector?: string | null; status?: string };
  permissions?: string[];
};

function authFingerprint(value: AuthSnapshot | null | undefined): string | null {
  const user = value?.user;
  if (!user || !isPositiveInteger(user.id)) return null;
  return JSON.stringify({
    id: user.id,
    role: user.role ?? null,
    stateId: user.stateId ?? null,
    sector: user.sector ?? null,
    status: user.status ?? null,
    permissions: [...(value?.permissions ?? [])].sort(),
  });
}

type IdentityRefreshResult =
  | { status: "authenticated"; fingerprint: string }
  | { status: "unauthenticated"; fingerprint: null }
  | { status: "unavailable"; fingerprint: string | null };

async function refreshAuthenticatedIdentity(
  queryClient: QueryClient,
  previous: string | null,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<IdentityRefreshResult> {
  try {
    const response = await fetch("/api/me", {
      credentials: "include",
      cache: "no-store",
      signal,
    });
    if (!isCurrent()) return { status: "unavailable", fingerprint: previous };
    if (!response.ok && response.status !== 401) {
      return { status: "unavailable", fingerprint: previous };
    }
    const next = response.status === 401 ? null : await response.json() as AuthSnapshot;
    if (!isCurrent()) return { status: "unavailable", fingerprint: previous };
    const nextFingerprint = authFingerprint(next);
    if (next !== null && nextFingerprint === null) {
      return { status: "unavailable", fingerprint: previous };
    }
    // A changed authorisation scope must never retain data fetched under the
    // former authority. Keep auth/me so AuthGate can redirect on 401.
    if (nextFingerprint !== previous) {
      clearNotificationQueries(queryClient);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    }
    queryClient.setQueryData(["auth", "me"], next);
    if (next === null) return { status: "unauthenticated", fingerprint: null };
    // The malformed-auth guard above establishes this narrowing for callers.
    return { status: "authenticated", fingerprint: nextFingerprint as string };
  } catch {
    // Socket reachability is not connectivity truth and must not trigger PWA
    // offline mode or queue replay. The normal connectivity probe owns that.
    return { status: "unavailable", fingerprint: previous };
  }
}

export function SocketProvider({ children, userId }: { children: ReactNode; userId: number }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const lastRevisionRef = useRef(new Map<string, number>());
  const authRef = useRef<string | null>(authFingerprint(qc.getQueryData<AuthSnapshot>(["auth", "me"])));
  const providerGenerationRef = useRef(0);
  const identityRefreshGenerationRef = useRef(0);

  useEffect(() => {
    const providerGeneration = ++providerGenerationRef.current;
    const abortController = new AbortController();
    const s = io({
      path: "/api/socket.io",
      withCredentials: true,
      // The server authenticates using the existing session cookie. userId is
      // only the development role-switcher hint and is never authority.
      auth: { userId },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = s;
    setSocket(s);
    setStatus("connecting");

    const refreshIdentity = () => {
      const refreshGeneration = ++identityRefreshGenerationRef.current;
      return refreshAuthenticatedIdentity(
        qc,
        authRef.current,
        abortController.signal,
        () => (
          !abortController.signal.aborted
          && providerGenerationRef.current === providerGeneration
          && identityRefreshGenerationRef.current === refreshGeneration
        ),
      );
    };

    const onConnect = () => {
      setStatus("connected");
      // `connect` fires for the initial handshake and every reconnect. This
      // catches up active pages after a gap without assuming event delivery.
      void refreshIdentity().then((result) => {
        authRef.current = result.fingerprint;
        if (result.status === "unauthenticated") {
          s.disconnect();
          return;
        }
        if (result.status !== "authenticated") return;
        // Identity must be current before any cached operational views can be
        // refetched under this newly connected session.
        invalidateRealtimeCatchupQueries(qc, userId);
      });
    };
    const onDisconnect = (reason: string) => {
      setStatus("disconnected");
      // Server-initiated disconnects are used for session/account revocation.
      // Revalidate identity immediately; ordinary transport loss remains
      // separate from the PWA connectivity state and its replay policy.
      if (reason === "io server disconnect") {
        void refreshIdentity().then((result) => {
          authRef.current = result.fingerprint;
        });
      }
    };
    const onConnectError = (error: Error) => {
      if (error.message === "unauthorized" || error.message === "auth_error") {
        setStatus("disconnected");
        void refreshIdentity().then((result) => {
          authRef.current = result.fingerprint;
        });
        s.disconnect();
        return;
      }
      setStatus("reconnecting");
    };
    const onReconnectAttempt = () => setStatus("reconnecting");
    let notificationInvalidationQueued = false;
    const invalidateNotificationsOnce = () => {
      if (notificationInvalidationQueued) return;
      notificationInvalidationQueued = true;
      queueMicrotask(() => {
        notificationInvalidationQueued = false;
        invalidateNotificationQueries(qc, userId);
        invalidateConversationQueries(qc);
        invalidateKeys(qc, [getGetDashboardNotificationsSummaryQueryKey()]);
      });
    };
    const onDomainEvent = (value: unknown) => {
      const event = parseDomainRealtimeEvent(value);
      if (!event) return;
      if (event.entityType === "notification") {
        invalidateNotificationsOnce();
        return;
      }
      if (event.entityType === "user" && event.entityId === userId && event.action === "authorization_changed") {
        void refreshIdentity().then((result) => {
          authRef.current = result.fingerprint;
          if (result.status === "unauthenticated") s.disconnect();
        });
        return;
      }
      const revisionKey = `${event.entityType}:${event.entityId}`;
      const previousRevision = lastRevisionRef.current.get(revisionKey);
      if (event.revision !== undefined) {
        if (previousRevision !== undefined && event.revision <= previousRevision) return;
        lastRevisionRef.current.set(revisionKey, event.revision);
      }
      invalidateDomainEventQueries(qc, event);
    };
    const onModuleUpdate = (value: unknown) => invalidateLegacyModuleEventQueries(qc, value);
    const onNotification = () => invalidateNotificationsOnce();
    const onConversationChange = (value: unknown) => {
      const conversationId = isObject(value) && isPositiveInteger(value.conversationId)
        ? value.conversationId
        : isObject(value) && isPositiveInteger(value.convId)
          ? value.convId
          : undefined;
      invalidateConversationQueries(qc, conversationId);
    };
    const onRecordAccess = (value: unknown) => {
      if (!isObject(value) || value.allowed !== false || !isPositiveInteger(value.entityId)) return;
      if (typeof value.entityType !== "string" || !ENTITY_TYPES.has(value.entityType as OperationalEntityType)) return;
      removeEntityQueries(qc, value.entityType as OperationalEntityType, value.entityId);
      void refreshIdentity().then((result) => {
        authRef.current = result.fingerprint;
      });
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);
    s.io.on("reconnect_attempt", onReconnectAttempt);
    s.on("domain:event", onDomainEvent);
    s.on("module:update", onModuleUpdate);
    s.on("notification:new", onNotification);
    s.on("message:new", onConversationChange);
    s.on("conversation:changed", onConversationChange);
    s.on("conversation:updated", onConversationChange);
    s.on("conversation:personal", onConversationChange);
    s.on("record:access", onRecordAccess);

    return () => {
      abortController.abort();
      // Fence synthetic/ignored AbortSignal responses and any overlapping
      // reconnect refresh from writing into a later identity's QueryClient.
      if (providerGenerationRef.current === providerGeneration) {
        providerGenerationRef.current += 1;
      }
      identityRefreshGenerationRef.current += 1;
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
      s.io.off("reconnect_attempt", onReconnectAttempt);
      s.off("domain:event", onDomainEvent);
      s.off("module:update", onModuleUpdate);
      s.off("notification:new", onNotification);
      s.off("message:new", onConversationChange);
      s.off("conversation:changed", onConversationChange);
      s.off("conversation:updated", onConversationChange);
      s.off("conversation:personal", onConversationChange);
      s.off("record:access", onRecordAccess);
      s.disconnect();
      if (socketRef.current === s) socketRef.current = null;
      setSocket(null);
      setStatus("disconnected");
    };
  }, [qc, userId]);

  return createElement(SocketContext.Provider, { value: { socket, status } }, children);
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/**
 * Subscribe to module-level legacy real-time events.
 * `onEvent` should be wrapped in useCallback to avoid re-subscribing every render.
 */
export function useRealtime(
  module: string,
  onEvent: (event: Record<string, unknown>) => void,
): void {
  const { socket } = useContext(SocketContext);
  useEffect(() => {
    if (!socket) return;
    const handler = (event: Record<string, unknown>) => {
      if (event["module"] === module) onEvent(event);
    };
    socket.on("module:update", handler);
    return () => {
      socket.off("module:update", handler);
    };
  }, [socket, module, onEvent]);
}

/**
 * Tell the server to push record-level lock events for this entity to this client.
 * The Socket.IO room is per-connection, so it is rejoined after every reconnect.
 */
export function useWatchRecord(
  entityType: OperationalEntityType,
  entityId: number | undefined,
): void {
  const { socket } = useContext(SocketContext);
  useEffect(() => {
    if (!socket || !entityId) return;
    const watch = () => socket.emit("watch:record", { entityType, entityId });
    socket.on("connect", watch);
    if (socket.connected) watch();
    return () => {
      socket.off("connect", watch);
      socket.emit("unwatch:record", { entityType, entityId });
    };
  }, [socket, entityType, entityId]);
}
