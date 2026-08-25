import 
{
 describe, expect, it, vi 
}
 from "vitest"
;

import 
{
 pool 
}
 from "@workspace/db"
;

import 
{

  PostCommitDomainEvents,
  RealtimeService,
  canAccessOperationalRecord,
  canMutateOperationalRecord,
  createDomainEvent,
  messageRealtimeEvent,
  parseOperationalEntityId,
  parseOperationalEntityType,
  parseRealtimeConversationId,
  parseSupportingEntityType,
}
 from "./realtime"
;

import type 
{
 RealtimeQueryExecutor 
}
 from "./realtime"
;

import type 
{
 PresenceTransition 
}
 from "./presence"
;


describe("Communication realtime event boundary", () => 
{

  it.each([
    undefined,
    null,
    0,
    -1,
    1.5,
    "101",
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects malformed conversation ID %j", (value) => 
{

    expect(parseRealtimeConversationId(value)).toBeNull()
;

  
}
)
;


  it("accepts only a positive numeric conversation ID", () => 
{

    expect(parseRealtimeConversationId(101)).toBe(101)
;

  
}
)
;


  it("reduces new-message broadcasts to safe refetch identity hints", () => 
{

    expect(messageRealtimeEvent(
{

      id: 55,
      conversationId: 101,
      body: "private message body",
      attachments: [
{
 objectPath: "private/internal-object" 
}
],
      replyBody: "recipient-specific reply preview",
      hiddenForUserId: 9,
    
}
)).toEqual(
{

      conversationId: 101,
      change: "message:new",
      messageId: 55,
    
}
)
;

  
}
)
;


  it("disconnects only sockets belonging to a revoked server session", async () => 
{

    const matchingDisconnect = vi.fn()
;

    const otherDisconnect = vi.fn()
;

    const service = new RealtimeService()
;

    const fetchSockets = vi.fn().mockResolvedValue([
      
{
 rtSessionId: "session-a", disconnect: matchingDisconnect 
}
,
      
{
 rtSessionId: "session-b", disconnect: otherDisconnect 
}
,
    ])
;

    (service as unknown as 
{
 io: 
{
 fetchSockets: typeof fetchSockets 
}
 
}
).io = 
{
 fetchSockets 
}
;


    service.disconnectSession("session-a")
;


    await vi.waitFor(() => expect(matchingDisconnect).toHaveBeenCalledWith(true))
;

    expect(otherDisconnect).not.toHaveBeenCalled()
;

  
}
)
;


  it("delivers peer presence only to an authorised open conversation", async () => 
{

    const service = new RealtimeService()
;

    const allowedEmit = vi.fn()
;

    const deniedEmit = vi.fn()
;

    const allowedLeave = vi.fn().mockResolvedValue(undefined)
;

    const deniedLeave = vi.fn().mockResolvedValue(undefined)
;

    const allowedSocket = 
{
 rtUser: 
{
 id: 11, role: "viewer" 
}
, emit: allowedEmit, leave: allowedLeave 
}
;

    const deniedSocket = 
{
 rtUser: 
{
 id: 12, role: "viewer" 
}
, emit: deniedEmit, leave: deniedLeave 
}
;

    const fetchSockets = vi.fn().mockResolvedValue([allowedSocket, deniedSocket])
;

    const room = vi.fn().mockReturnValue(
{
 fetchSockets 
}
)
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockImplementation: (
        implementation: (sql: string, params?: unknown[]) => Promise<unknown>,
      ) => void
;

    
}
;

    query.mockImplementation(async (sql, params) => 
{

      if (sql.includes("SELECT DISTINCT conversation_id")) return {
 rows: [
{
 conversationId: 44 
}
] 
}
;

      if (sql.includes("SELECT 1 FROM conversation_members")) 
{

        return {
 rows: [], rowCount: params?.[1] === 11 ? 1 : 0 
}
;

      
}

      throw new Error(`Unexpected query: ${sql}`)
;

    
}
)
;


    const internal = service as unknown as 
{

      io: 
{
 in: typeof room 
}
;

      presence: 
{
 isCurrentTransition: () => boolean 
}
;

      refreshSocketUser: (socket: 
{
 rtUser: 
{
 id: number
;
 role: string 
}
 
}
) => Promise<
{
 id: number
;
 role: string 
}
>
;

      emitAuthorizedConversationPresence: (transition: PresenceTransition) => Promise<void>
;

    
}
;

    internal.io = 
{
 in: room 
}
;

    internal.presence = 
{
 isCurrentTransition: () => true 
}
;

    internal.refreshSocketUser = async (socket) => socket.rtUser
;


    await internal.emitAuthorizedConversationPresence(
{

      userId: 7,
      online: true,
      lastSeenAt: null,
      version: 1,
    
}
)
;


    expect(room).toHaveBeenCalledWith("conversation:44")
;

    expect(allowedEmit).toHaveBeenCalledWith("conversation:presence", 
{

      conversationId: 44,
      userId: 7,
      isOnline: true,
      lastSeenAt: null,
    
}
)
;

    expect(deniedEmit).not.toHaveBeenCalledWith("conversation:presence", expect.anything())
;

    expect(deniedLeave).toHaveBeenCalledWith("conversation:44")
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("uses the canonical active-session lookup during Socket.IO handshakes", async () => 
{

    const source = await import("node:fs/promises")
      .then((fs) => fs.readFile(new URL("./realtime.ts", import.meta.url), "utf8"))
;


    expect(source).toContain("getActiveSessionFromToken")
;

    expect(source).toContain("unsignSessionCookieValue")
;

    expect(source).toContain("rtSessionId = session.id")
;

    expect(source).toContain("this.presence.register(socket.id, row.id, session.id)")
;

    expect(source).toContain('socket.emit("presence:update"')
;

    expect(source).toContain("pingInterval: 25_000")
;

    expect(source).toContain("Permission refresh is asynchronous")
;

    expect(source).toContain("this.presence.isCurrentTransition(transition.userId, transition.version)")
;

    expect(source).toContain("emitAuthorizedConversationPresence")
;

    expect(source).toContain('socket.emit("conversation:presence"')
;

    expect(source).toContain("await canAccessConversation(conversationId, currentUser)")
;

    expect(source).not.toContain("if (unsigned && /^\\d+$/.test(unsigned))")
;

  
}
)
;

}
)
;


describe("operational domain-event boundary", () => 
{

  it("creates a versioned identity-only refetch hint and redacts unsafe scope values", () => 
{

    const event = createDomainEvent(
{

      entityType: "project",
      entityId: 42,
      action: "updated",
      revision: 7,
      scope: 
{

        stateIds: [2, 2, 0, -1],
        sectors: [" Health ", "", "Health"],
        projectId: 42,
      
}
,
    
}
, "2026-08-25T10:00:00.000Z")
;


    expect(event).toEqual(
{

      version: 1,
      entityType: "project",
      entityId: 42,
      action: "updated",
      revision: 7,
      occurredAt: "2026-08-25T10:00:00.000Z",
      scope: 
{
 stateIds: [2], sectors: ["Health"], projectId: 42 
}
,
    
}
)
;

    expect(event).not.toHaveProperty("data")
;

    expect(event).not.toHaveProperty("actor")
;

  
}
)
;


  it("rejects malformed operational record identifiers before they can form a room name", () => 
{

    expect(parseOperationalEntityType("project")).toBe("project")
;

    expect(parseOperationalEntityType("projects")).toBeNull()
;

    expect(parseOperationalEntityType("attachment")).toBeNull()
;

    expect(parseOperationalEntityId(12)).toBe(12)
;

    expect(parseOperationalEntityId("12")).toBeNull()
;

    expect(parseOperationalEntityId(0)).toBeNull()
;

    expect(parseOperationalEntityId(12.5)).toBeNull()
;

  
}
)
;


  it("dispatches queued invalidations only after an explicit post-commit flush", async () => 
{

    const publish = vi.fn().mockResolvedValue(undefined)
;

    const postCommit = new PostCommitDomainEvents(publish)
;

    postCommit.enqueue(
{
 entityType: "risk", entityId: 9, action: "updated" 
}
)
;

    expect(publish).not.toHaveBeenCalled()
;


    await postCommit.flush()
;

    expect(publish).toHaveBeenCalledTimes(1)
;

    expect(publish).toHaveBeenCalledWith(
{
 entityType: "risk", entityId: 9, action: "updated" 
}
)
;


    // Retried socket delivery is harmless because both instances carry only
    // the same record identity and clients refetch the authoritative state.
    await postCommit.flush()
;

    expect(publish).toHaveBeenCalledTimes(1)
;

  
}
)
;


  it("discards queued invalidations when a transaction rolls back", () => 
{

    const publish = vi.fn().mockResolvedValue(undefined)
;

    const postCommit = new PostCommitDomainEvents(publish)
;

    postCommit.enqueue(
{
 entityType: "plan", entityId: 4, action: "submitted" 
}
)
;

    postCommit.discard()
;

    expect(publish).not.toHaveBeenCalled()
;

    expect(() => postCommit.enqueue(
{
 entityType: "plan", entityId: 4, action: "updated" 
}
))
      .toThrow("post_commit_events_already_settled")
;

  
}
)
;


  it("enforces state, sector, and SPO project-assignment scope for projects", async () => 
{

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockImplementation: (
        implementation: (sql: string, params?: unknown[]) => Promise<unknown>,
      ) => void
;

    
}
;

    query.mockImplementation(async (sql, params) => 
{

      if (sql.includes("SELECT sector, COALESCE(sectors")) return {
 rows: [
{
 sector: "Health", sectors: ["Education"] 
}
] 
}
;

      if (sql.includes("FROM project_assignments")) 
{

        return {
 rows: [], rowCount: params?.[1] === 7 ? 1 : 0 
}
;

      
}

      throw new Error(`Unexpected query: ${sql}`)
;

    
}
)
;


    await expect(canAccessOperationalRecord(
      
{
 id: 7, role: "state_program_officer", stateId: 3, sectors: null 
}
,
      "project",
      88,
    )).resolves.toBe(true)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 8, role: "state_program_officer", stateId: 3, sectors: null 
}
,
      "project",
      88,
    )).resolves.toBe(false)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 9, role: "technical_coordinator", stateId: null, sectors: ["Education"] 
}
,
      "project",
      88,
    )).resolves.toBe(true)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 10, role: "technical_coordinator", stateId: null, sectors: ["WASH"] 
}
,
      "project",
      88,
    )).resolves.toBe(false)
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("enforces state and sector scope for reports without relying on Socket.IO rooms", async () => 
{

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // A stale report.sector must not widen a project report: the canonical
    // resolver selects projectSector for this report type.
    query.mockResolvedValue(
{

      rows: [
{

        reportType: "project",
        projectId: 10,
        projectSector: "Health",
        activitySector: null,
        effectiveSector: "Education",
        state_id: 5,
      
}
],
    
}
)
;


    await expect(canAccessOperationalRecord(
      
{
 id: 7, role: "state_program_officer", stateId: 3, sectors: null 
}
,
      "report",
      88,
    )).resolves.toBe(false)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 8, role: "technical_coordinator", stateId: null, sectors: ["Education"] 
}
,
      "report",
      88,
    )).resolves.toBe(false)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 9, role: "technical_coordinator", stateId: null, sectors: ["Health"] 
}
,
      "report",
      88,
    )).resolves.toBe(true)
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("denies an SPO a same-state report unless the linked project is assigned", async () => 
{

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValueOnce: (value: unknown) => void
;

    
}
;

    query.mockResolvedValueOnce(
{

      rows: [
{

        reportType: "project",
        projectId: 10,
        projectSector: "Health",
        activitySector: null,
        effectiveSector: "Health",
      
}
],
    
}
)
;

    query.mockResolvedValueOnce(
{
 rows: [
{
 state_id: 5, project_id: 10 
}
] 
}
)
;

    query.mockResolvedValueOnce(
{
 rows: [], rowCount: 0 
}
)
;


    await expect(canAccessOperationalRecord(
      
{
 id: 7, role: "state_program_officer", stateId: 5, sectors: null 
}
,
      "report",
      88,
    )).resolves.toBe(false)
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("removes a record watcher rather than delivering after its session is revoked", async () => 
{

    const service = new RealtimeService()
;

    const emit = vi.fn()
;

    const leave = vi.fn().mockResolvedValue(undefined)
;

    const socket = 
{

      rtSessionId: "revoked-session",
      rtUser: 
{
 id: 11, name: "Viewer", role: "viewer", stateId: null, sectors: null 
}
,
      data: 
{
}
,
      emit,
      leave,
    
}
;

    const fetchSockets = vi.fn().mockResolvedValue([socket])
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // getActiveSessionById finds no active row, so record access must never be
    // checked or emitted to this stale transport.
    query.mockResolvedValue(
{
 rows: [] 
}
)
;

    (service as unknown as 
{
 io: 
{
 fetchSockets: typeof fetchSockets 
}
 
}
).io = 
{
 fetchSockets 
}
;


    await (service as unknown as 
{

      emitAuthorizedDomainEvent: (event: ReturnType<typeof createDomainEvent>) => Promise<void>
;

    
}
).emitAuthorizedDomainEvent(createDomainEvent(
{

      entityType: "project",
      entityId: 4,
      action: "updated",
    
}
))
;


    expect(leave).toHaveBeenCalledWith("record:project:4")
;

    expect(emit).not.toHaveBeenCalledWith("domain:event", expect.anything())
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("keeps lock ownership behind the matching edit permission", () => 
{

    expect(canMutateOperationalRecord(
      
{
 id: 1, role: "viewer", stateId: null, sectors: null 
}
,
      "project",
    )).toBe(false)
;

    expect(canMutateOperationalRecord(
      
{
 id: 2, role: "state_program_officer", stateId: 3, sectors: null 
}
,
      "project",
    )).toBe(true)
;

  
}
)
;


  it("uses a plan's canonical project-sector fallback for Technical Coordinators", async () => 
{

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // The production SQL resolves `plans.sectors → plans.sector → project.sector`
;

    // this row represents the final project-sector fallback.
    query.mockResolvedValue(
{

      rows: [
{
 state_id: 4, location_type: "state", sectors: ["Education"] 
}
],
    
}
)
;


    await expect(canAccessOperationalRecord(
      
{
 id: 3, role: "technical_coordinator", stateId: null, sectors: ["Education"] 
}
,
      "plan",
      17,
    )).resolves.toBe(true)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 4, role: "technical_coordinator", stateId: null, sectors: ["Health"] 
}
,
      "plan",
      17,
    )).resolves.toBe(false)
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("authorizes risk invalidations by the canonical project sector", async () => 
{

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    query.mockResolvedValue(
{
 rows: [
{
 state_id: 4, sector: "Health" 
}
] 
}
)
;


    await expect(canAccessOperationalRecord(
      
{
 id: 31, role: "technical_coordinator", stateId: null, sectors: ["Health"] 
}
,
      "risk",
      51,
    )).resolves.toBe(true)
;

    await expect(canAccessOperationalRecord(
      
{
 id: 32, role: "technical_coordinator", stateId: null, sectors: ["WASH"] 
}
,
      "risk",
      51,
    )).resolves.toBe(false)
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("delivers a safe invalidation only to the currently authorised risk viewer", async () => 
{

    const service = new RealtimeService()
;

    const allowedEmit = vi.fn()
;

    const deniedEmit = vi.fn()
;

    const allowedLeave = vi.fn().mockResolvedValue(undefined)
;

    const deniedLeave = vi.fn().mockResolvedValue(undefined)
;

    const allowedSocket = 
{
 emit: allowedEmit, leave: allowedLeave 
}
;

    const deniedSocket = 
{
 emit: deniedEmit, leave: deniedLeave 
}
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    query.mockResolvedValue(
{
 rows: [
{
 state_id: 4, sector: "Health" 
}
] 
}
)
;


    const internal = service as unknown as 
{

      io: Record<string, never>
;

      operationalTransport: 
{
 allCandidateSockets: () => Promise<unknown[]> 
}
;

      refreshSocketUser: (socket: unknown) => Promise<
{
 id: number
;
 role: string
;
 stateId: number | null
;
 sectors: string[] | null 
}
>
;

      emitAuthorizedDomainEvent: (event: ReturnType<typeof createDomainEvent>) => Promise<void>
;

    
}
;

    internal.io = 
{
}
;

    internal.operationalTransport = 
{

      allCandidateSockets: async () => [allowedSocket, deniedSocket],
    
}
;

    internal.refreshSocketUser = async (socket) => socket === allowedSocket
      ? 
{
 id: 41, role: "technical_coordinator", stateId: null, sectors: ["Health"] 
}

      : 
{
 id: 42, role: "technical_coordinator", stateId: null, sectors: ["WASH"] 
}
;


    await internal.emitAuthorizedDomainEvent(createDomainEvent(
{

      entityType: "risk",
      entityId: 51,
      action: "updated",
    
}
))
;


    expect(allowedEmit).toHaveBeenCalledWith("domain:event", expect.objectContaining(
{

      entityType: "risk",
      entityId: 51,
      action: "updated",
    
}
))
;

    expect(deniedEmit).not.toHaveBeenCalledWith("domain:event", expect.anything())
;

    expect(deniedLeave).toHaveBeenCalledWith("record:risk:51")
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("delivers a committed deletion only to its private pre-delete audience", async () => 
{

    const service = new RealtimeService()
;

    const allowedEmit = vi.fn()
;

    const deniedEmit = vi.fn()
;

    const allowedSocket = 
{
 emit: allowedEmit, leave: vi.fn().mockResolvedValue(undefined) 
}
;

    const deniedSocket = 
{
 emit: deniedEmit, leave: vi.fn().mockResolvedValue(undefined) 
}
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // The record has already been hard-deleted, so canonical lookup cannot
    // authorise either socket. Only the server-private transaction snapshot may
    // bridge this post-commit invalidation.
    query.mockResolvedValue(
{
 rows: [] 
}
)
;


    const internal = service as unknown as 
{

      io: Record<string, never>
;

      operationalTransport: 
{
 allCandidateSockets: () => Promise<unknown[]> 
}
;

      refreshSocketUser: (socket: unknown) => Promise<
{
 id: number
;
 role: string
;
 stateId: number | null
;
 sectors: string[] | null 
}
>
;

      emitAuthorizedDomainEvent: (
        event: ReturnType<typeof createDomainEvent>,
        legacyEvent?: undefined,
        preDeleteAudience?: readonly 
{

          userId: number
;

          role: string
;

          stateId: number | null
;

          sectors: string[] | null
;

        
}[],
      ) => Promise<void>
;

    
}
;

    internal.io = 
{
}
;

    internal.operationalTransport = 
{

      allCandidateSockets: async () => [allowedSocket, deniedSocket],
    
}
;

    internal.refreshSocketUser = async (socket) => socket === allowedSocket
      ? 
{
 id: 61, role: "technical_coordinator", stateId: null, sectors: ["Health"] 
}

      : 
{
 id: 62, role: "technical_coordinator", stateId: null, sectors: ["Health"] 
}
;


    await internal.emitAuthorizedDomainEvent(createDomainEvent(
{

      entityType: "risk",
      entityId: 77,
      action: "deleted",
    
}
), undefined, [
{

      userId: 61,
      role: "technical_coordinator",
      stateId: null,
      sectors: ["Health"],
    
}
])
;


    expect(allowedEmit).toHaveBeenCalledWith("domain:event", expect.objectContaining(
{

      entityType: "risk",
      entityId: 77,
      action: "deleted",
    
}
))
;

    expect(deniedEmit).not.toHaveBeenCalledWith("domain:event", expect.anything())
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("withholds a deletion invalidation when a snapshotted TC loses the record sector", async () => 
{

    const service = new RealtimeService()
;

    const emit = vi.fn()
;

    const leave = vi.fn().mockResolvedValue(undefined)
;

    const socket = 
{
 emit, leave 
}
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    query.mockResolvedValue(
{
 rows: [] 
}
)
;


    const internal = service as unknown as 
{

      io: Record<string, never>
;

      operationalTransport: 
{
 allCandidateSockets: () => Promise<unknown[]> 
}
;

      refreshSocketUser: () => Promise<
{
 id: number
;
 role: string
;
 stateId: number | null
;
 sectors: string[] | null 
}
>
;

      emitAuthorizedDomainEvent: (
        event: ReturnType<typeof createDomainEvent>,
        legacyEvent?: undefined,
        preDeleteAudience?: readonly 
{

          userId: number
;

          role: string
;

          stateId: number | null
;

          sectors: string[] | null
;

        
}[],
      ) => Promise<void>
;

    
}
;

    internal.io = 
{
}
;

    internal.operationalTransport = 
{
 allCandidateSockets: async () => [socket] 
}
;

    internal.refreshSocketUser = async () => (
{

      id: 71,
      role: "technical_coordinator",
      stateId: null,
      sectors: ["WASH"],
    
}
)
;


    await internal.emitAuthorizedDomainEvent(createDomainEvent(
{

      entityType: "risk",
      entityId: 78,
      action: "deleted",
    
}
), undefined, [
{

      userId: 71,
      role: "technical_coordinator",
      stateId: null,
      sectors: ["Health"],
    
}
])
;


    expect(emit).not.toHaveBeenCalledWith("domain:event", expect.anything())
;

    expect(leave).toHaveBeenCalledWith("record:risk:78")
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("keeps an SPO project-deletion grant limited to the locked deletion transaction", async () => 
{

    const service = new RealtimeService()
;

    const emit = vi.fn()
;

    const socket = 
{
 emit, leave: vi.fn().mockResolvedValue(undefined) 
}
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // The project and its project_assignments have already been removed by the
    // same successful transaction that captured this private grant.
    query.mockResolvedValue(
{
 rows: [] 
}
)
;


    const internal = service as unknown as 
{

      io: Record<string, never>
;

      operationalTransport: 
{
 allCandidateSockets: () => Promise<unknown[]> 
}
;

      refreshSocketUser: () => Promise<
{
 id: number
;
 role: string
;
 stateId: number | null
;
 sectors: string[] | null 
}
>
;

      emitAuthorizedDomainEvent: (
        event: ReturnType<typeof createDomainEvent>,
        legacyEvent?: undefined,
        preDeleteAudience?: readonly 
{

          userId: number
;

          role: string
;

          stateId: number | null
;

          sectors: string[] | null
;

          projectAssignmentId?: number
;

          assignmentRemovedByDeletion?: boolean
;

        
}[],
      ) => Promise<void>
;

    
}
;

    internal.io = 
{
}
;

    internal.operationalTransport = 
{
 allCandidateSockets: async () => [socket] 
}
;

    internal.refreshSocketUser = async () => (
{

      id: 81,
      role: "state_program_officer",
      stateId: 4,
      sectors: null,
    
}
)
;


    await internal.emitAuthorizedDomainEvent(createDomainEvent(
{

      entityType: "project",
      entityId: 91,
      action: "deleted",
    
}
), undefined, [
{

      userId: 81,
      role: "state_program_officer",
      stateId: 4,
      sectors: null,
      projectAssignmentId: 91,
      assignmentRemovedByDeletion: true,
    
}
])
;


    expect(emit).toHaveBeenCalledWith("domain:event", expect.objectContaining(
{

      entityType: "project",
      entityId: 91,
      action: "deleted",
    
}
))
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("requires a live SPO assignment for a soft-deleted project", async () => 
{

    const service = new RealtimeService()
;

    const emit = vi.fn()
;

    const socket = 
{
 emit, leave: vi.fn().mockResolvedValue(undefined) 
}
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // The canonical project and its live assignment are absent after soft
    // deletion, so a grant must not bypass the dynamic assignment predicate.
    query.mockResolvedValue(
{
 rows: [], rowCount: 0 
}
)
;


    const internal = service as unknown as 
{

      io: Record<string, never>
;

      operationalTransport: 
{
 allCandidateSockets: () => Promise<unknown[]> 
}
;

      refreshSocketUser: () => Promise<
{
 id: number
;
 role: string
;
 stateId: number | null
;
 sectors: string[] | null 
}
>
;

      emitAuthorizedDomainEvent: (
        event: ReturnType<typeof createDomainEvent>,
        legacyEvent?: undefined,
        preDeleteAudience?: readonly 
{

          userId: number
;

          role: string
;

          stateId: number | null
;

          sectors: string[] | null
;

          projectAssignmentId?: number
;

          assignmentRemovedByDeletion?: boolean
;

        
}[],
      ) => Promise<void>
;

    
}
;

    internal.io = 
{
}
;

    internal.operationalTransport = 
{
 allCandidateSockets: async () => [socket] 
}
;

    internal.refreshSocketUser = async () => (
{

      id: 82,
      role: "state_program_officer",
      stateId: 4,
      sectors: null,
    
}
)
;


    await internal.emitAuthorizedDomainEvent(createDomainEvent(
{

      entityType: "project",
      entityId: 92,
      action: "deleted",
    
}
), undefined, [
{

      userId: 82,
      role: "state_program_officer",
      stateId: 4,
      sectors: null,
      projectAssignmentId: 92,
      assignmentRemovedByDeletion: false,
    
}
])
;


    expect(emit).not.toHaveBeenCalledWith("domain:event", expect.anything())
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("captures deletion authority through the caller's transaction executor", async () => 
{

    const service = new RealtimeService()
;

    const transactionQuery = vi.fn(async (sql: string) => 
{

      if (sql.includes("FROM users")) 
{

        return {

          rows: [
{

            id: 83,
            role: "state_program_officer",
            state_id: 4,
            sector: null,
          
}
],
          rowCount: 1,
        
}
;

      
}

      if (sql.includes("FROM projects")) 
{

        return {

          rows: [
{
 sector: "Health", sectors: [] 
}
],
          rowCount: 1,
        
}
;

      
}

      if (sql.includes("FROM project_assignments")) 
{

        return {
 rows: [
{
 "?column?": 1 
}
], rowCount: 1 
}
;

      
}

      throw new Error(`Unexpected transaction query: ${sql}`)
;

    
}
)
;

    const executor = 
{
 query: transactionQuery 
} as unknown as RealtimeQueryExecutor
;


    const grants = await service.captureOperationalAudience(
      "project",
      93,
      executor,
      
{
 projectAssignmentRemovedByDeletion: true 
}
,
    )
;


    expect(grants).toEqual([expect.objectContaining(
{

      userId: 83,
      projectAssignmentId: 93,
      assignmentRemovedByDeletion: true,
    
}
)])
;

    expect(transactionQuery).toHaveBeenCalledTimes(3)
;

  
}
)
;

}
)
;


describe("supporting-surface domain-event boundary", () => 
{

  it("keeps supporting events versioned, identity-only, and limited to the approved entity families", () => 
{

    expect(parseSupportingEntityType("attachment")).toBe("attachment")
;

    expect(parseSupportingEntityType("object_path")).toBeNull()
;

    expect(createDomainEvent(
{

      entityType: "attachment",
      entityId: 91,
      action: "deleted",
      scope: 
{
 projectId: 7 
}
,
    
}
, "2026-08-25T10:00:00.000Z")).toEqual(
{

      version: 1,
      entityType: "attachment",
      entityId: 91,
      action: "deleted",
      occurredAt: "2026-08-25T10:00:00.000Z",
      scope: 
{
 projectId: 7 
}
,
    
}
)
;

  
}
)
;


  it("sends private notification hints only to the target user's active sessions", async () => 
{

    const service = new RealtimeService()
;

    const targetEmit = vi.fn()
;

    const wrongEmit = vi.fn()
;

    const target = 
{
 rtUser: 
{
 id: 19, role: "viewer" 
}
, emit: targetEmit 
}
;

    const wrong = 
{
 rtUser: 
{
 id: 21, role: "viewer" 
}
, emit: wrongEmit 
}
;

    const fetchSockets = vi.fn().mockResolvedValue([target, wrong])
;

    const room = vi.fn().mockReturnValue(
{
 fetchSockets 
}
)
;

    (service as unknown as 
{
 io: 
{
 in: typeof room 
}
 
}
).io = 
{
 in: room 
}
;

    (service as unknown as 
{

      refreshSocketUser: (socket: 
{
 rtUser: 
{
 id: number
;
 role: string 
}
 
}
) => Promise<
{
 id: number
;
 role: string 
}
>
;

    
}
).refreshSocketUser = async (socket) => socket.rtUser
;


    await service.publishSupportingEventToUser(19, 
{

      entityType: "notification",
      entityId: 71,
      action: "read",
    
}
)
;


    expect(room).toHaveBeenCalledWith("user:19")
;

    expect(targetEmit).toHaveBeenCalledWith("domain:event", expect.objectContaining(
{

      entityType: "notification", entityId: 71, action: "read",
    
}
))
;

    expect(wrongEmit).not.toHaveBeenCalled()
;

  
}
)
;


  it("does not broaden state delivery beyond registry or matching State scope", async () => 
{

    const service = new RealtimeService()
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    query.mockResolvedValue(
{
 rows: [
{
 operationalStatus: "active" 
}
] 
}
)
;

    const canAccess = (service as unknown as 
{

      canAccessSupportingEvent: (
        user: 
{
 id: number
;
 role: string
;
 stateId: number | null
;
 sectors: string[] | null 
}
,
        event: ReturnType<typeof createDomainEvent>,
      ) => Promise<boolean>
;

    
}
).canAccessSupportingEvent
;

    const event = createDomainEvent(
{
 entityType: "state", entityId: 9, action: "updated" 
}
)
;


    await expect(canAccess(
{
 id: 1, role: "state_program_officer", stateId: 8, sectors: null 
}
, event))
      .resolves.toBe(false)
;

    await expect(canAccess(
{
 id: 2, role: "state_program_officer", stateId: 9, sectors: null 
}
, event))
      .resolves.toBe(true)
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("does not send legacy notification content to a stale socket in a user room", async () => 
{

    const service = new RealtimeService()
;

    const activeEmit = vi.fn()
;

    const staleEmit = vi.fn()
;

    const active = 
{
 rtUser: 
{
 id: 42, role: "viewer" 
}
, emit: activeEmit 
}
;

    const stale = 
{
 rtUser: 
{
 id: 42, role: "viewer" 
}
, emit: staleEmit 
}
;

    const room = vi.fn().mockReturnValue(
{
 fetchSockets: vi.fn().mockResolvedValue([active, stale]) 
}
)
;

    (service as unknown as 
{
 io: 
{
 in: typeof room 
}
 
}
).io = 
{
 in: room 
}
;

    (service as unknown as 
{

      refreshSocketUser: (socket: typeof active) => Promise<
{
 id: number
;
 role: string 
}
 | null>
;

    
}
).refreshSocketUser = async (socket) => socket === active ? socket.rtUser : null
;


    await service.broadcastToUser(42, 
{

      module: "notifications", action: "created", entityId: 7,
      data: 
{
 message: "private notification content" 
}
,
    
}
)
;


    expect(activeEmit).toHaveBeenCalledWith("notification:new", expect.anything())
;

    expect(staleEmit).not.toHaveBeenCalled()
;

  
}
)
;


  it("sends a removed conversation member only the access-revoked signal", async () => 
{

    const service = new RealtimeService()
;

    const emit = vi.fn()
;

    const leave = vi.fn().mockResolvedValue(undefined)
;

    const socket = 
{
 rtUser: 
{
 id: 55, role: "viewer" 
}
, emit, leave 
}
;

    const room = vi.fn().mockReturnValue(
{
 fetchSockets: vi.fn().mockResolvedValue([socket]) 
}
)
;

    const query = vi.spyOn(pool, "query") as unknown as 
{

      mockResolvedValue: (value: unknown) => void
;

    
}
;

    // The recipient is not a member after the committed removal.
    query.mockResolvedValue(
{
 rows: [] 
}
)
;

    (service as unknown as 
{
 io: 
{
 in: typeof room 
}
 
}
).io = 
{
 in: room 
}
;

    (service as unknown as 
{

      refreshSocketUser: (socket: 
{
 rtUser: 
{
 id: number
;
 role: string 
}
 
}
) => Promise<
{
 id: number
;
 role: string
;
 stateId: null
;
 sectors: null 
}
>
;

      emitAuthorizedConversationUpdateToUser: (userId: number, conversationId: number) => Promise<void>
;

    
}
).refreshSocketUser = async (current) => (
{
 ...current.rtUser, stateId: null, sectors: null 
}
)
;


    await (service as unknown as 
{

      emitAuthorizedConversationUpdateToUser: (userId: number, conversationId: number) => Promise<void>
;

    
}
).emitAuthorizedConversationUpdateToUser(55, 11)
;


    expect(emit).toHaveBeenCalledWith("conversation:access", 
{

      conversationId: 11, allowed: false, reason: "access_revoked",
    
}
)
;

    expect(emit).not.toHaveBeenCalledWith("conversation:updated", expect.anything())
;

    vi.restoreAllMocks()
;

  
}
)
;


  it("does not turn a durable supporting mutation into a failure when transport delivery fails", async () => 
{

    const service = new RealtimeService()
;

    (service as unknown as 
{

      emitAuthorizedSupportingEvent: () => Promise<void>
;

    
}
).emitAuthorizedSupportingEvent = async () => 
{

      throw new Error("socket_adapter_unavailable")
;

    
}
;


    await expect(service.publishSupportingEvent(
{

      entityType: "file", entityId: 88, action: "updated",
    
}
)).resolves.toBeUndefined()
;

  
}
)
;


  it("does not turn a durable conversation message into a failure when delivery fails", async () => 
{

    const service = new RealtimeService()
;

    (service as unknown as 
{

      emitAuthorizedConversation: () => Promise<void>
;

    
}
).emitAuthorizedConversation = async () => 
{

      throw new Error("socket_adapter_unavailable")
;

    
}
;


    await expect(service.broadcastMessage([], 
{

      id: 10, conversationId: 7, body: "durable message",
    
}
)).resolves.toBeUndefined()
;

  
}
)
;


  it("does not leave a rejected private conversation invalidation behind a committed hide", async () => 
{

    const service = new RealtimeService()
;

    const room = vi.fn().mockReturnValue(
{

      fetchSockets: vi.fn().mockRejectedValue(new Error("socket_adapter_unavailable")),
    
}
)
;

    (service as unknown as 
{
 io: 
{
 in: typeof room 
}
 
}
).io = 
{
 in: room 
}
;


    await expect(service.broadcastPersonalConversationUpdate(3, 7)).resolves.toBeUndefined()
;

  
}
)
;

}
)
;
