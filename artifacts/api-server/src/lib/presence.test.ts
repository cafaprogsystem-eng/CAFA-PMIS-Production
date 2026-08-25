import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESENCE_DISCONNECT_GRACE_MS,
  PresenceService,
  type PresenceTransition,
} from "./presence";

describe("authenticated realtime presence", () => {
  afterEach(() => vi.useRealTimers());

  it("aggregates tabs and devices, then transitions offline after the documented grace", () => {
    vi.useFakeTimers();
    const transitions: PresenceTransition[] = [];
    const presence = new PresenceService({ onTransition: (event) => { transitions.push(event); } });

    presence.register("socket-a", 7, "session-a");
    presence.register("socket-b", 7, "session-b");
    presence.removeConnection("socket-a");
    expect(presence.isOnline(7)).toBe(true);

    presence.removeConnection("socket-b");
    // The user remains online during the documented reconnect grace window.
    expect(presence.isOnline(7)).toBe(true);
    vi.advanceTimersByTime(PRESENCE_DISCONNECT_GRACE_MS - 1);
    expect(transitions).toEqual([{ userId: 7, online: true, lastSeenAt: null, version: 1 }]);

    vi.advanceTimersByTime(1);
    expect(presence.isOnline(7)).toBe(false);
    expect(transitions).toHaveLength(2);
    expect(transitions[1]).toMatchObject({ userId: 7, online: false });
    expect(transitions[1]?.lastSeenAt).toEqual(expect.any(String));
  });

  it("cancels the pending final disconnect when an authenticated socket reconnects", () => {
    vi.useFakeTimers();
    const transitions: PresenceTransition[] = [];
    const presence = new PresenceService({ onTransition: (event) => { transitions.push(event); } });

    presence.register("socket-a", 7, "session-a");
    presence.removeConnection("socket-a");
    vi.advanceTimersByTime(PRESENCE_DISCONNECT_GRACE_MS - 1);
    presence.register("socket-b", 7, "session-a");
    vi.advanceTimersByTime(PRESENCE_DISCONNECT_GRACE_MS);

    expect(presence.isOnline(7)).toBe(true);
    expect(transitions).toEqual([{ userId: 7, online: true, lastSeenAt: null, version: 1 }]);
  });

  it("removes only a revoked session immediately and preserves another active session", () => {
    const transitions: PresenceTransition[] = [];
    const presence = new PresenceService({ onTransition: (event) => { transitions.push(event); } });

    presence.register("socket-a", 7, "session-a");
    presence.register("socket-b", 7, "session-b");
    presence.removeSession("session-a");
    expect(presence.isOnline(7)).toBe(true);
    expect(transitions).toHaveLength(1);

    presence.removeSession("session-b");
    expect(presence.isOnline(7)).toBe(false);
    expect(transitions).toHaveLength(2);
    expect(transitions[1]).toMatchObject({ userId: 7, online: false });
  });

  it("starts empty after a new process-local service is created", () => {
    const first = new PresenceService();
    first.register("socket-a", 7, "session-a");
    expect(first.isOnline(7)).toBe(true);

    const restarted = new PresenceService();
    expect(restarted.isOnline(7)).toBe(false);
    expect(restarted.onlineUserIds()).toEqual([]);
  });

  it("marks an earlier final-offline transition stale when a user reconnects", () => {
    vi.useFakeTimers();
    const transitions: PresenceTransition[] = [];
    const presence = new PresenceService({ onTransition: (event) => { transitions.push(event); } });

    presence.register("socket-a", 7, "session-a");
    presence.removeConnection("socket-a");
    vi.advanceTimersByTime(PRESENCE_DISCONNECT_GRACE_MS);
    const offline = transitions[1]!;
    expect(offline.online).toBe(false);
    expect(presence.isCurrentTransition(7, offline.version)).toBe(true);

    presence.register("socket-b", 7, "session-a");
    expect(presence.isCurrentTransition(7, offline.version)).toBe(false);
    expect(transitions[2]).toMatchObject({ userId: 7, online: true });
  });
});