# System-wide realtime synchronization certification

**Assessment date:** 25 August 2026  
**Scope:** CAFA PMIS single-process authenticated realtime transport, server
authorization, cache invalidation, post-commit publication, and offline/reconnect
boundaries.

## Closure result

The repository now has a representative certification matrix in
`artifacts/api-server/src/lib/realtime-system-certification.test.ts`. It proves
that a committed Project update is delivered to an authorised HQ peer while
State-scoped, sector-scoped, and unassigned project peers do not receive the
event. It also proves that role and sector changes are rechecked before the
next delivery, rather than trusting an earlier socket or room membership.

The event is an identity-only refetch hint. Record data, notification content,
attachment paths, actor data, and access grants do not cross the socket
boundary. HTTP queries remain the source of truth.

## Covered contract

| Boundary                                        | Evidence                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Project, report, plan, and risk publication     | Post-commit event-family matrix and client query invalidation registry                                            |
| State, sector, and project-assignment isolation | Multi-peer Project delivery matrix                                                                                |
| Soft deletion and private deletion audience     | Existing deletion-audience cases in `realtime.test.ts`                                                            |
| Notifications and user authorization changes    | Existing private supporting-event cases and SocketProvider auth-refresh cases                                     |
| Attachment metadata and parent-bound access     | Existing supporting-event and attachment access cases; identity-only assertion in the certification matrix        |
| Duplicate and missed delivery                   | Post-commit idempotent flush and reconnect catch-up invalidation                                                  |
| Rollback and failed transport                   | Discarded post-commit queue and best-effort transport failure cases                                               |
| Logout and session revocation                   | `routes/auth-logout.test.ts` and session-aware realtime cases                                                     |
| Offline separation and optimistic concurrency   | `test/offline-sync-foundation.test.ts`, frontend connectivity/offline tests, and revision precondition assertions |
| Client refetch and protected-cache eviction     | `socket-provider-realtime.test.tsx` and `realtime-query-invalidation.test.ts`                                     |

## Validation evidence

The following local commands passed on 25 August 2026:

| Check                                    | Result                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Focused realtime and offline suites      | 69 API tests and 33 frontend tests passed                           |
| Full API regression suite                | 3,060 tests passed; 1 test intentionally skipped                    |
| Full frontend regression suite           | 5,861 tests passed                                                  |
| Workspace typecheck                      | Passed across libraries, API, frontend, mockup sandbox, and scripts |
| Frontend lint                            | Passed with zero warnings                                           |
| API and frontend production builds       | Passed                                                              |
| API contract drift check                 | Passed after two deterministic code-generation passes               |
| Whitespace and new-file formatter checks | Passed                                                              |

The clean-tree release preflight remains intentionally deferred until these
task changes are merged, because that preflight correctly rejects an uncommitted
working tree. Its non-browser checks are otherwise represented by the commands
above.

```text
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/cafa-pmis test
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/cafa-pmis run build
pnpm --filter @workspace/cafa-pmis lint
pnpm run check:api-contract
git diff --check
```

No API contract changed in this certification work, so contract generation is
not required beyond the drift check.

## Browser evidence and remaining boundary

The local workspace does not have the required `E2E_BASE_URL` and
`E2E_USERNAME` configuration for approved authenticated browser sessions.
Therefore, no propagation timing or browser non-discovery claim is made here.
The automated matrix is not a substitute for that evidence.

This certification covers one API process. Multi-replica delivery remains a
future release requirement: a shared adapter must preserve candidate lookup and
per-recipient active-session, role, state, sector, assignment, and parent-access
checks inside `RealtimeService`. Redis or another shared transport alone would
not certify that boundary.
