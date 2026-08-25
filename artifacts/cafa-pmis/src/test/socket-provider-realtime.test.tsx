import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getGetProjectQueryKey,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const socketHarness = vi.hoisted(() => {
  type Listener = (payload?: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const managerListeners = new Map<string, Set<Listener>>();
  const add = (target: Map<string, Set<Listener>>, name: string, listener: Listener) => {
    const set = target.get(name) ?? new Set<Listener>();
    set.add(listener);
    target.set(name, set);
  };
  const remove = (target: Map<string, Set<Listener>>, name: string, listener: Listener) => {
    target.get(name)?.delete(listener);
  };
  const socket = {
    connected: true,
    on: vi.fn((name: string, listener: Listener) => add(listeners, name, listener)),
    off: vi.fn((name: string, listener: Listener) => remove(listeners, name, listener)),
    emit: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((name: string, listener: Listener) => add(managerListeners, name, listener)),
      off: vi.fn((name: string, listener: Listener) => remove(managerListeners, name, listener)),
    },
  };
  return {
    socket,
    io: vi.fn(() => socket),
    emit(name: string, payload?: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    },
    reset() {
      listeners.clear();
      managerListeners.clear();
      socket.connected = true;
      socket.on.mockClear();
      socket.off.mockClear();
      socket.emit.mockClear();
      socket.disconnect.mockClear();
      socket.io.on.mockClear();
      socket.io.off.mockClear();
      this.io.mockClear();
    },
  };
});

vi.mock("socket.io-client", () => ({
  io: socketHarness.io,
}));

import { SocketProvider } from "@/lib/socket";

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderProvider(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <SocketProvider userId={44}>
        <div>realtime client</div>
      </SocketProvider>
    </QueryClientProvider>,
  );
}

describe("SocketProvider realtime convergence", () => {
  beforeEach(() => {
    socketHarness.reset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 44, role: "program_manager", stateId: null, status: "active" },
        permissions: ["projects.view"],
      }),
    }));
  });

  it("uses canonical events to refresh the matching generated project detail/list keys", async () => {
    const client = makeClient();
    const listKey = getListProjectsQueryKey({ status: "draft" });
    const detailKey = getGetProjectQueryKey(9);
    client.setQueryData(["auth", "me"], {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    });
    client.setQueryData(listKey, { cached: true });
    client.setQueryData(detailKey, { cached: true });
    renderProvider(client);

    socketHarness.emit("domain:event", {
      version: 1,
      entityType: "project",
      entityId: 9,
      action: "updated",
      revision: 2,
      occurredAt: "2026-08-25T10:00:00.000Z",
    });

    await waitFor(() => {
      expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });
  });

  it("ignores duplicate or older revisions after the newest domain event", async () => {
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    client.setQueryData(["auth", "me"], {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    });
    renderProvider(client);

    socketHarness.emit("domain:event", {
      version: 1,
      entityType: "project",
      entityId: 9,
      action: "updated",
      revision: 8,
      occurredAt: "2026-08-25T10:00:00.000Z",
    });
    const callsAfterNewest = invalidate.mock.calls.length;
    socketHarness.emit("domain:event", {
      version: 1,
      entityType: "project",
      entityId: 9,
      action: "updated",
      revision: 8,
      occurredAt: "2026-08-25T10:00:01.000Z",
    });
    socketHarness.emit("domain:event", {
      version: 1,
      entityType: "project",
      entityId: 9,
      action: "updated",
      revision: 7,
      occurredAt: "2026-08-25T10:00:02.000Z",
    });

    expect(invalidate).toHaveBeenCalled();
    expect(invalidate.mock.calls).toHaveLength(callsAfterNewest);
  });

  it("keeps notification invalidation recipient-private and catches up after reconnect", async () => {
    const client = makeClient();
    const mine = ["notifications", 44, "bell"] as const;
    const anotherUser = ["notifications", 45, "bell"] as const;
    const conversations = ["conversations", "all", ""] as const;
    const projects = getListProjectsQueryKey({ status: "active" });
    client.setQueryData(["auth", "me"], {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    });
    for (const key of [mine, anotherUser, conversations, projects]) client.setQueryData(key, { cached: true });
    renderProvider(client);

    socketHarness.emit("notification:new", {});
    await waitFor(() => {
      expect(client.getQueryState(mine)?.isInvalidated).toBe(true);
      expect(client.getQueryState(anotherUser)?.isInvalidated).toBe(false);
      expect(client.getQueryState(conversations)?.isInvalidated).toBe(true);
    });

    client.setQueryData(projects, { cached: true });
    socketHarness.emit("connect");
    await waitFor(() => {
      expect(client.getQueryState(projects)?.isInvalidated).toBe(true);
      expect(fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ credentials: "include" }));
    });
  });

  it("removes an access-revoked detail cache and tears every listener down", async () => {
    const client = makeClient();
    const detailKey = getGetProjectQueryKey(9);
    const documentsKey = ["project-documents", 9] as const;
    const listKey = getListProjectsQueryKey({ status: "active" });
    client.setQueryData(["auth", "me"], {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    });
    client.setQueryData(detailKey, { cached: true });
    client.setQueryData(documentsKey, { cached: true });
    client.setQueryData(listKey, { cached: true });
    const rendered = renderProvider(client);

    socketHarness.emit("record:access", {
      entityType: "project",
      entityId: 9,
      allowed: false,
    });
    await waitFor(() => {
      expect(client.getQueryData(detailKey)).toBeUndefined();
      expect(client.getQueryData(documentsKey)).toBeUndefined();
      expect(client.getQueryData(listKey)).toBeUndefined();
    });

    rendered.unmount();
    expect(socketHarness.socket.disconnect).toHaveBeenCalledOnce();
    expect(socketHarness.socket.off).toHaveBeenCalledWith("domain:event", expect.any(Function));
    expect(socketHarness.socket.off).toHaveBeenCalledWith("notification:new", expect.any(Function));
    expect(socketHarness.socket.io.off).toHaveBeenCalledWith("reconnect_attempt", expect.any(Function));
  });

  it("purges an unknown cache owner before reconnect catch-up can refetch it", async () => {
    const client = makeClient();
    const projects = getListProjectsQueryKey({ status: "active" });
    const files = ["files", "mine"] as const;
    // Simulates a cache which survived an earlier identity reset before the
    // authenticated provider received the next auth/me result.
    client.setQueryData(projects, { cached: "former-user" });
    client.setQueryData(files, { cached: "former-user" });
    renderProvider(client);

    socketHarness.emit("connect");

    await waitFor(() => {
      expect(client.getQueryData(projects)).toBeUndefined();
      expect(client.getQueryData(files)).toBeUndefined();
      expect(client.getQueryData(["auth", "me"])).toMatchObject({ user: { id: 44 } });
    });
  });

  it("purges protected caches and disconnects when an authorization change finds no active session", async () => {
    const client = makeClient();
    const projects = getListProjectsQueryKey({ status: "active" });
    client.setQueryData(["auth", "me"], {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    });
    client.setQueryData(projects, { cached: "protected" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => null,
    }));
    renderProvider(client);

    socketHarness.emit("domain:event", {
      version: 1,
      entityType: "user",
      entityId: 44,
      action: "authorization_changed",
      occurredAt: "2026-08-25T10:00:00.000Z",
    });

    await waitFor(() => {
      expect(client.getQueryData(projects)).toBeUndefined();
      expect(client.getQueryData(["auth", "me"])).toBeNull();
      expect(socketHarness.socket.disconnect).toHaveBeenCalledOnce();
    });
  });

  it("cannot restore auth data after the provider unmounts during a delayed identity refresh", async () => {
    let resolveIdentity!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    })));
    const client = makeClient();
    client.setQueryData(["auth", "me"], {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    });
    const rendered = renderProvider(client);

    socketHarness.emit("connect");
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    rendered.unmount();
    client.clear();
    resolveIdentity(new Response(JSON.stringify({
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await Promise.resolve();
    await Promise.resolve();
    expect(client.getQueryData(["auth", "me"])).toBeUndefined();
  });

  it("ignores an older reconnect identity response when a newer one is pending", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    })));
    const client = makeClient();
    const initialAuth = {
      user: { id: 44, role: "program_manager", stateId: null, status: "active" },
      permissions: ["projects.view"],
    };
    client.setQueryData(["auth", "me"], initialAuth);
    renderProvider(client);

    socketHarness.emit("connect");
    socketHarness.emit("connect");
    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0](new Response(JSON.stringify({
      user: { id: 44, role: "super_admin", stateId: null, status: "active" },
      permissions: ["users.manage"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getQueryData(["auth", "me"])).toEqual(initialAuth);

    resolvers[1](new Response(JSON.stringify(initialAuth), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await waitFor(() => expect(client.getQueryData(["auth", "me"])).toEqual(initialAuth));
  });
});