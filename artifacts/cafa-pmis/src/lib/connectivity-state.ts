/**
 * Canonical CAFA reachability state.
 *
 * Browser online/offline events, realtime transport, and individual HTTP
 * failures are evidence about connectivity, not connectivity themselves.
 * Only two independent transport failures in the confirmation window promote
 * the state to offline.
 */
export type ConnectivityStatus =
  | "online"
  | "checking"
  | "offline"
  | "degraded"
  | "auth-required"
  | "access-denied";

export type ConnectivityReason =
  | "initial"
  | "browser-offline"
  | "browser-online"
  | "probe-success"
  | "api-success"
  | "transport-failure"
  | "offline-confirmed"
  | "api-unavailable"
  | "authentication-required"
  | "access-denied"
  | "client-error";

export interface ConnectivitySnapshot {
  status: ConnectivityStatus;
  reason: ConnectivityReason;
  /** A public reachability probe must never erase a known 401/403 outcome. */
  accessOutcome: "auth-required" | "access-denied" | null;
  consecutiveTransportFailures: number;
  lastTransportFailureAt: number | null;
  /** Server errors need the same bounded confirmation as transport loss before
   * they can change a global service-state banner. */
  consecutiveServiceFailures: number;
  lastServiceFailureAt: number | null;
  changedAt: number;
}

export type ConnectivityEvidence =
  | { kind: "browser-offline" }
  | { kind: "browser-online" }
  | { kind: "probe-success" }
  | { kind: "probe-http"; status: number }
  | { kind: "api-success" }
  | { kind: "api-http"; status: number }
  | { kind: "api-transport-failure" }
  | { kind: "transport-failure" };

export const INITIAL_CONNECTIVITY: ConnectivitySnapshot = {
  status: "online",
  reason: "initial",
  accessOutcome: null,
  consecutiveTransportFailures: 0,
  lastTransportFailureAt: null,
  consecutiveServiceFailures: 0,
  lastServiceFailureAt: null,
  changedAt: 0,
};

const CONFIRMATION_FAILURES = 2;
export const CONNECTIVITY_CONFIRMATION_WINDOW_MS = 5_000;

function next(
  previous: ConnectivitySnapshot,
  values: Pick<ConnectivitySnapshot, "status" | "reason" | "consecutiveTransportFailures">
    & Partial<Pick<ConnectivitySnapshot,
      "accessOutcome" | "lastTransportFailureAt" | "consecutiveServiceFailures" | "lastServiceFailureAt"
    >>,
  at: number,
): ConnectivitySnapshot {
  return {
    ...previous,
    ...values,
    changedAt: at,
  };
}

function reduceServiceUnavailable(
  previous: ConnectivitySnapshot,
  at: number,
): ConnectivitySnapshot {
  const isWithinConfirmationWindow = previous.lastServiceFailureAt !== null
    && at - previous.lastServiceFailureAt <= CONNECTIVITY_CONFIRMATION_WINDOW_MS;
  const failures = isWithinConfirmationWindow
    ? previous.consecutiveServiceFailures + 1
    : 1;
  const confirmed = failures >= CONFIRMATION_FAILURES;
  return next(previous, {
    // An individual route 5xx is not enough to claim that the whole service is
    // unavailable. Preserve a known auth/access outcome until authenticated
    // traffic resolves it; only repeated CAFA service evidence shows Degraded.
    status: confirmed ? "degraded" : previous.accessOutcome ?? previous.status,
    reason: confirmed ? "api-unavailable" : previous.reason,
    consecutiveTransportFailures: 0,
    lastTransportFailureAt: null,
    consecutiveServiceFailures: failures,
    lastServiceFailureAt: at,
  }, at);
}

function reduceHttp(
  previous: ConnectivitySnapshot,
  status: number,
  at: number,
): ConnectivitySnapshot {
  if (status === 401) {
    return next(previous, {
      status: "auth-required",
      reason: "authentication-required",
      accessOutcome: "auth-required",
      consecutiveTransportFailures: 0,
      lastTransportFailureAt: null,
      consecutiveServiceFailures: 0,
      lastServiceFailureAt: null,
    }, at);
  }
  if (status === 403) {
    return next(previous, {
      status: "access-denied",
      reason: "access-denied",
      accessOutcome: "access-denied",
      consecutiveTransportFailures: 0,
      lastTransportFailureAt: null,
      consecutiveServiceFailures: 0,
      lastServiceFailureAt: null,
    }, at);
  }
  if (status >= 500) {
    return reduceServiceUnavailable(previous, at);
  }
  // A validation, not-found, or other business response proves that CAFA
  // answered. It must not be converted into a network outage.
  return next(previous, {
    status: previous.accessOutcome ?? "online",
    reason: "client-error",
    consecutiveTransportFailures: 0,
    lastTransportFailureAt: null,
    consecutiveServiceFailures: 0,
    lastServiceFailureAt: null,
  }, at);
}

export function reduceConnectivity(
  previous: ConnectivitySnapshot,
  evidence: ConnectivityEvidence,
  at = Date.now(),
): ConnectivitySnapshot {
  switch (evidence.kind) {
    case "browser-offline":
      return next(previous, {
        status: "checking",
        reason: "browser-offline",
        consecutiveTransportFailures: previous.consecutiveTransportFailures,
      }, at);
    case "browser-online":
      return next(previous, {
        status: "checking",
        reason: "browser-online",
        consecutiveTransportFailures: previous.consecutiveTransportFailures,
      }, at);
    case "probe-success":
      return next(previous, {
        status: previous.accessOutcome ?? "online",
        reason: previous.accessOutcome === "auth-required"
          ? "authentication-required"
          : previous.accessOutcome === "access-denied" ? "access-denied" : "probe-success",
        consecutiveTransportFailures: 0,
        lastTransportFailureAt: null,
        consecutiveServiceFailures: 0,
        lastServiceFailureAt: null,
      }, at);
    case "api-success":
      return next(previous, {
        status: "online",
        reason: "api-success",
        accessOutcome: null,
        consecutiveTransportFailures: 0,
        lastTransportFailureAt: null,
        consecutiveServiceFailures: 0,
        lastServiceFailureAt: null,
      }, at);
    case "probe-http":
    case "api-http":
      return reduceHttp(previous, evidence.status, at);
    case "api-transport-failure":
      // A request can be cancelled by a proxy, throttled, or fail on one
      // route while CAFA remains reachable. It requests a health confirmation
      // but cannot itself activate the secure offline policy or flap the
      // global banner. The subsequent health probe owns every visible change.
      return previous;
    case "transport-failure": {
      const isWithinConfirmationWindow = previous.lastTransportFailureAt !== null
        && at - previous.lastTransportFailureAt <= CONNECTIVITY_CONFIRMATION_WINDOW_MS;
      const failures = isWithinConfirmationWindow
        ? previous.consecutiveTransportFailures + 1
        : 1;
      return next(previous, {
        status: failures >= CONFIRMATION_FAILURES ? "offline" : "checking",
        reason: failures >= CONFIRMATION_FAILURES ? "offline-confirmed" : "transport-failure",
        consecutiveTransportFailures: failures,
        lastTransportFailureAt: at,
        consecutiveServiceFailures: 0,
        lastServiceFailureAt: null,
      }, at);
    }
  }
}

let current = { ...INITIAL_CONNECTIVITY };
const listeners = new Set<() => void>();
const confirmationListeners = new Set<() => void>();

export function getConnectivitySnapshot(): ConnectivitySnapshot {
  return current;
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Request a same-origin health confirmation without treating a route failure
 * as proof that the whole CAFA service is unreachable. */
export function requestConnectivityConfirmation(): void {
  for (const listener of confirmationListeners) listener();
}

export function subscribeConnectivityConfirmations(listener: () => void): () => void {
  confirmationListeners.add(listener);
  return () => confirmationListeners.delete(listener);
}

export function recordConnectivityEvidence(evidence: ConnectivityEvidence): ConnectivitySnapshot {
  const updated = reduceConnectivity(current, evidence);
  // Keep the snapshot reference stable for duplicate notifications.
  if (
    updated.status === current.status &&
    updated.reason === current.reason &&
    updated.accessOutcome === current.accessOutcome &&
    updated.consecutiveTransportFailures === current.consecutiveTransportFailures &&
    updated.lastTransportFailureAt === current.lastTransportFailureAt &&
    updated.consecutiveServiceFailures === current.consecutiveServiceFailures &&
    updated.lastServiceFailureAt === current.lastServiceFailureAt
  ) {
    return current;
  }
  current = updated;
  for (const listener of listeners) listener();
  return current;
}

/** Test-only reset, also useful for deterministic embedded browser harnesses. */
export function resetConnectivityState(): void {
  current = { ...INITIAL_CONNECTIVITY };
  for (const listener of listeners) listener();
}