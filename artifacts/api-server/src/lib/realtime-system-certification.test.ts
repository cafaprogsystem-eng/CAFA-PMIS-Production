import { afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import {
  PostCommitDomainEvents,
  RealtimeService,
  createDomainEvent,
  type OperationalEventTransport,
  type OperationalRecordAccessUser,
} from "./realtime";

type Peer = {
  id: number;
  user: OperationalRecordAccessUser;
  emit: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
};

function peer(id: number, user: OperationalRecordAccessUser): Peer {
  return {
    id,
    user,
    emit: vi.fn(),
    leave: vi.fn().mockResolvedValue(undefined),
  };
}

function transport(peers: Peer[]): OperationalEventTransport {
  return {
    allCandidateSockets: async () => peers as never[],
    recordWatchers: async () => peers as never[],
  };
}

describe("system-wide realtime certification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers a committed Project update to an authorised peer only", async () => {
    const authorised = peer(101, {
      id: 101,
      role: "program_manager",
      stateId: null,
      sectors: null,
    });
    const wrongState = peer(102, {
      id: 102,
      role: "state_office_manager",
      stateId: 9,
      sectors: null,
    });
    const wrongSector = peer(103, {
      id: 103,
      role: "technical_coordinator",
      stateId: null,
      sectors: ["WASH"],
    });
    const unassigned = peer(104, {
      id: 104,
      role: "state_program_officer",
      stateId: 7,
      sectors: null,
    });
    const peers = [authorised, wrongState, wrongSector, unassigned];
    const service = new RealtimeService(transport(peers));
    (service as unknown as { io: Record<string, never> }).io = {};

    const query = vi.spyOn(pool, "query") as unknown as {
      mockImplementation: (
        implementation: (sql: string, params?: unknown[]) => Promise<unknown>,
      ) => void;
    };
    query.mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT sector, COALESCE(sectors")) {
        return { rows: [{ sector: "Health", sectors: [] }], rowCount: 1 };
      }
      if (sql.includes("FROM project_states")) {
        return params?.[1] === 7
          ? { rows: [{ projectId: 1 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM project_assignments")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected access query: ${sql}`);
    });

    const refresh = service as unknown as {
      refreshSocketUser: (socket: Peer) => Promise<OperationalRecordAccessUser>;
    };
    refresh.refreshSocketUser = async (socket) => socket.user;

    await service.publishDomainEvent({
      entityType: "project",
      entityId: 1,
      action: "updated",
      revision: 12,
      scope: { stateIds: [7], sectors: ["Health"] },
    });

    expect(authorised.emit).toHaveBeenCalledWith(
      "domain:event",
      expect.objectContaining({
        version: 1,
        entityType: "project",
        entityId: 1,
        action: "updated",
        revision: 12,
      }),
    );
    expect(authorised.emit.mock.calls[0]?.[1]).not.toHaveProperty("data");
    expect(wrongState.emit).not.toHaveBeenCalledWith(
      "domain:event",
      expect.anything(),
    );
    expect(wrongSector.emit).not.toHaveBeenCalledWith(
      "domain:event",
      expect.anything(),
    );
    expect(unassigned.emit).not.toHaveBeenCalledWith(
      "domain:event",
      expect.anything(),
    );
    expect(wrongState.leave).toHaveBeenCalledWith("record:project:1");
    expect(wrongSector.leave).toHaveBeenCalledWith("record:project:1");
    expect(unassigned.leave).toHaveBeenCalledWith("record:project:1");
  });

  it("rechecks changed role and sector scope before every subsequent delivery", async () => {
    const changingPeer = peer(201, {
      id: 201,
      role: "program_manager",
      stateId: null,
      sectors: null,
    });
    const service = new RealtimeService(transport([changingPeer]));
    (service as unknown as { io: Record<string, never> }).io = {};
    const query = vi.spyOn(pool, "query") as unknown as {
      mockImplementation: (
        implementation: (sql: string, params?: unknown[]) => Promise<unknown>,
      ) => void;
    };
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT sector, COALESCE(sectors")) {
        return { rows: [{ sector: "Health", sectors: [] }], rowCount: 1 };
      }
      throw new Error(`Unexpected access query: ${sql}`);
    });
    const refresh = service as unknown as {
      refreshSocketUser: (socket: Peer) => Promise<OperationalRecordAccessUser>;
    };
    refresh.refreshSocketUser = async (socket) => socket.user;

    await service.publishDomainEvent({
      entityType: "project",
      entityId: 2,
      action: "updated",
    });
    changingPeer.user = {
      id: 201,
      role: "technical_coordinator",
      stateId: null,
      sectors: ["WASH"],
    };
    await service.publishDomainEvent({
      entityType: "project",
      entityId: 2,
      action: "updated",
    });

    expect(changingPeer.emit).toHaveBeenCalledTimes(1);
    expect(changingPeer.leave).toHaveBeenCalledWith("record:project:2");
  });

  it("keeps post-commit publication separate from rollback and duplicate delivery", async () => {
    const published: unknown[] = [];
    const commitEvents = new PostCommitDomainEvents(async (event) => {
      published.push(createDomainEvent(event, "2026-08-25T10:00:00.000Z"));
    });
    for (const entityType of ["project", "report", "plan", "risk"] as const) {
      commitEvents.enqueue({
        entityType,
        entityId: 3,
        action: "updated",
        revision: 1,
      });
    }

    expect(published).toHaveLength(0);
    await commitEvents.flush();
    await commitEvents.flush();
    expect(published).toHaveLength(4);
    expect(
      new Set(
        (published as Array<{ entityType: string }>).map(
          (event) => event.entityType,
        ),
      ),
    ).toEqual(new Set(["project", "report", "plan", "risk"]));

    const rolledBack: unknown[] = [];
    const rollbackEvents = new PostCommitDomainEvents(async (event) => {
      rolledBack.push(event);
    });
    rollbackEvents.enqueue({
      entityType: "report",
      entityId: 4,
      action: "submitted",
    });
    rollbackEvents.discard();
    await rollbackEvents.flush();
    expect(rolledBack).toHaveLength(0);
  });

  it("keeps attachment metadata identity-only and notification hints private", async () => {
    const target = peer(301, {
      id: 301,
      role: "viewer",
      stateId: null,
      sectors: null,
    });
    const otherUser = peer(302, {
      id: 302,
      role: "viewer",
      stateId: null,
      sectors: null,
    });
    const service = new RealtimeService();
    const room = vi.fn().mockReturnValue({
      fetchSockets: vi.fn().mockResolvedValue([target, otherUser]),
    });
    (service as unknown as { io: { in: typeof room } }).io = { in: room };
    const refresh = service as unknown as {
      refreshSocketUser: (socket: Peer) => Promise<OperationalRecordAccessUser>;
    };
    refresh.refreshSocketUser = async (socket) => socket.user;

    await service.publishSupportingEventToUser(301, {
      entityType: "notification",
      entityId: 44,
      action: "created",
      scope: { projectId: 7 },
    });

    expect(room).toHaveBeenCalledWith("user:301");
    expect(target.emit).toHaveBeenCalledWith(
      "domain:event",
      expect.objectContaining({
        entityType: "notification",
        entityId: 44,
        action: "created",
      }),
    );
    expect(target.emit.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(otherUser.emit).not.toHaveBeenCalled();

    const attachment = createDomainEvent({
      entityType: "attachment",
      entityId: 45,
      action: "updated",
      scope: { projectId: 7 },
    });
    expect(attachment).toEqual(
      expect.objectContaining({
        entityType: "attachment",
        entityId: 45,
      }),
    );
    expect(attachment).not.toHaveProperty("objectPath");
  });

  it("does not turn a failed transport or rolled-back mutation into false realtime success", async () => {
    const failedTransport = new RealtimeService({
      allCandidateSockets: async () => {
        throw new Error("transport_unavailable");
      },
      recordWatchers: async () => [],
    });

    await expect(
      failedTransport.publishDomainEvent({
        entityType: "risk",
        entityId: 99,
        action: "updated",
      }),
    ).resolves.toBeUndefined();

    const publish = vi.fn().mockResolvedValue(undefined);
    const rollback = new PostCommitDomainEvents(publish);
    rollback.enqueue({ entityType: "risk", entityId: 99, action: "updated" });
    rollback.discard();
    expect(publish).not.toHaveBeenCalled();
  });
});
