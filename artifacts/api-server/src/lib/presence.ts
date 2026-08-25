/**
 * In-process authenticated realtime presence.
 *
 * Presence is intentionally derived only from Socket.IO connections that have
 * passed the server-side session and active-user checks. Socket.IO's transport
 * heartbeat uses a 25s ping interval and 20s ping timeout (configured by the
 * realtime service); no browser/network or HTTP heartbeat is a presence signal.
 *
 * A normal disconnect waits 5s before resolving the user's final connection.
 * This absorbs short reconnect races while still making an offline transition
 * explicit and durable. Explicit session revocation/deactivation bypasses the
 * grace period for the affected session/user.
 */

export const PRESENCE_DISCONNECT_GRACE_MS = 5_000;

export interface PresenceTransition {
  userId: number;
  online: boolean;
  lastSeenAt: string | null;
  /** Monotonic per-user ordering token; never exposed to clients. */
  version: number;
}

interface PresenceConnection {
  userId: number;
  sessionId: string;
}

export interface PresenceServiceOptions {
  disconnectGraceMs?: number;
  now?: () => Date;
  onTransition?: (transition: PresenceTransition) => void | Promise<void>;
}

export class PresenceService {
  private readonly connections = new Map<string, PresenceConnection>();
  private readonly connectionsByUser = new Map<number, Set<string>>();
  private readonly pendingOffline = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly pendingOfflineSessionIds = new Map<number, Set<string>>();
  private readonly transitionVersions = new Map<number, number>();
  private readonly disconnectGraceMs: number;
  private readonly now: () => Date;
  private readonly onTransition: (transition: PresenceTransition) => void | Promise<void>;

  constructor(options: PresenceServiceOptions = {}) {
    this.disconnectGraceMs = options.disconnectGraceMs ?? PRESENCE_DISCONNECT_GRACE_MS;
    this.now = options.now ?? (() => new Date());
    this.onTransition = options.onTransition ?? (() => undefined);
  }

  register(connectionId: string, userId: number, sessionId: string): void {
    const existing = this.connections.get(connectionId);
    if (existing) this.removeConnection(connectionId, true);

    const pending = this.pendingOffline.get(userId);
    if (pending) {
      clearTimeout(pending);
      this.pendingOffline.delete(userId);
      this.pendingOfflineSessionIds.delete(userId);
    }

    this.connections.set(connectionId, { userId, sessionId });
    const wasOffline = !this.connectionsByUser.has(userId);
    const userConnections = this.connectionsByUser.get(userId) ?? new Set<string>();
    userConnections.add(connectionId);
    this.connectionsByUser.set(userId, userConnections);

    if (wasOffline) this.emitTransition({ userId, online: true, lastSeenAt: null });
  }

  removeConnection(connectionId: string, immediate = false): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);

    const userConnections = this.connectionsByUser.get(connection.userId);
    if (!userConnections) return;
    userConnections.delete(connectionId);
    if (userConnections.size > 0) return;

    if (immediate) {
      this.resolveOffline(connection.userId);
      return;
    }

    const timer = setTimeout(() => {
      this.pendingOffline.delete(connection.userId);
      this.pendingOfflineSessionIds.delete(connection.userId);
      if ((this.connectionsByUser.get(connection.userId)?.size ?? 0) === 0) {
        this.resolveOffline(connection.userId);
      }
    }, this.disconnectGraceMs);
    this.pendingOffline.set(connection.userId, timer);
    this.pendingOfflineSessionIds.set(connection.userId, new Set([connection.sessionId]));
  }

  /** Remove every connection belonging to one server session immediately. */
  removeSession(sessionId: string): void {
    let removed = false;
    for (const [connectionId, connection] of this.connections) {
      if (connection.sessionId === sessionId) {
        removed = true;
        this.removeConnection(connectionId, true);
      }
    }
    if (removed) return;
    for (const [userId, sessionIds] of this.pendingOfflineSessionIds) {
      if (!sessionIds.has(sessionId)) continue;
      const pending = this.pendingOffline.get(userId);
      if (pending) clearTimeout(pending);
      this.pendingOffline.delete(userId);
      this.pendingOfflineSessionIds.delete(userId);
      this.resolveOffline(userId);
    }
  }

  /** Deactivation is an immediate user-wide presence revocation. */
  removeUser(userId: number): void {
    let removed = false;
    for (const [connectionId, connection] of this.connections) {
      if (connection.userId === userId) {
        removed = true;
        this.removeConnection(connectionId, true);
      }
    }
    const pending = this.pendingOffline.get(userId);
    if (pending) {
      clearTimeout(pending);
      this.pendingOffline.delete(userId);
      this.pendingOfflineSessionIds.delete(userId);
      if (!removed) this.resolveOffline(userId);
    }
  }

  isOnline(userId: number): boolean {
    // A final connection remains online until its grace timer resolves. This
    // prevents a reconnect race from producing a false offline transition.
    return this.connectionsByUser.has(userId);
  }

  onlineUserIds(): number[] {
    return [...this.connectionsByUser.keys()];
  }

  isCurrentTransition(userId: number, version: number): boolean {
    return this.transitionVersions.get(userId) === version;
  }

  /** Clear process-local state during shutdown; a new process starts empty. */
  clear(): void {
    for (const timer of this.pendingOffline.values()) clearTimeout(timer);
    this.pendingOffline.clear();
    this.pendingOfflineSessionIds.clear();
    this.connections.clear();
    this.connectionsByUser.clear();
    this.transitionVersions.clear();
  }

  private resolveOffline(userId: number): void {
    this.connectionsByUser.delete(userId);
    this.emitTransition({
      userId,
      online: false,
      lastSeenAt: this.now().toISOString(),
    });
  }

  private emitTransition(transition: Omit<PresenceTransition, "version">): void {
    const version = (this.transitionVersions.get(transition.userId) ?? 0) + 1;
    this.transitionVersions.set(transition.userId, version);
    void Promise.resolve(this.onTransition({ ...transition, version })).catch(() => {
      // The realtime service owns logging/persistence failures. Presence state
      // remains authoritative in memory even if a side effect is unavailable.
    });
  }
}