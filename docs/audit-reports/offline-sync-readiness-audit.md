# CAFA PMIS Controlled Offline Readiness Audit

**Audit date:** 23 August 2026
**Assessment scope:** authenticated application shell, user-scoped cached reads,
durable local drafts and queue state, reconnect/synchronisation, browser storage,
attachments, role/session boundaries, duplicate prevention, responsive UI, and the
release evidence required before a controlled offline claim.

## Executive decision

### Certification verdict: **Blocked**

The authenticated production/staging browser certification could not run.
`E2E_BASE_URL`, `E2E_USERNAME`, and `E2E_PASSWORD` were not available in the
certification environment. This verdict is a release-evidence outcome: it does
not claim that the offline implementation failed, and it does not permit an
Offline Ready claim.

### Capability status: **Partially Offline Ready — controlled foundation, not certified**

CAFA PMIS has a deliberately constrained offline foundation. It has browser-persisted
data stores, an allow-list policy, stable operation identifiers, dependency handling,
revision capture, server idempotency, a single-tab replay lock, explicit sync state,
and an attachment re-selection policy. The production build and the complete frontend
test suite pass.

It is **not** accurate to call CAFA PMIS **Offline Ready** yet. The outstanding
production-browser proof is material:

1. A full network-offline reload has not passed against a deployed production PWA.
   The development worker only precaches development `index.html` and registration
   code, not Vite's module graph; it cannot prove application-shell navigation.
2. The required browser fixtures for durable-draft recovery, session/permission
   changes, deleted parents, conflict edits, two tabs, and attachment reload were
   not made available in an isolated routed environment.
3. No binary attachment is durable across reload/restart. The application correctly
   communicates re-selection rather than claiming an upload is queued.

The allowed product statement is:

> “CAFA PMIS can safely retain selected device data and approved offline work
> locally, but its end-to-end production offline lifecycle has not yet been
> certified. A live connection remains required for all decisions, protected files,
> financial work, access changes, and any workflow outside the reviewed policy.”

## Evidence collected

### Automated verification

| Check | Result | Evidence |
| --- | --- | --- |
| Frontend production PWA build | **Pass** | `pnpm --filter @workspace/cafa-pmis build`; VitePWA generated a Workbox production worker with **90** precache entries, about **7.6 MiB**. Build emitted source-map and chunk-size warnings only. |
| Frontend offline/unit suite | **Pass** | `pnpm --filter @workspace/cafa-pmis test`; Vitest reported **133 files / 5,805 tests** passing. |
| Browser runner discovery | **Pass** | `pnpm test:offline-browser --list` discovers **18 tests** across desktop and 390×844 mobile Chromium. |
| Certification preflight | **Blocked** | `E2E_CERTIFY_PRODUCTION=true pnpm test:offline-browser` fails before discovery because `E2E_BASE_URL`, `E2E_USERNAME`, and `E2E_PASSWORD` are unavailable. |
| Unconfigured browser run | **Not evidence** | `pnpm test:offline-browser` exits with **18 skipped**, 0 executed, 0 passed, and 0 failed. Skips are not authenticated evidence. |
| Frontend typecheck | **Pass** | `pnpm --filter @workspace/cafa-pmis typecheck`. |
| Frontend lint | **Pass** | `pnpm --filter @workspace/cafa-pmis lint`. |
| API contract drift check | **Pass** | `pnpm check:api-contract`. |
| Routed authenticated browser — baseline, cache, recovery, and UI | **Blocked** | Requires the unavailable routed URL and isolated staff credentials; no authenticated browser result is claimed. |

### Current certification counts — 23 August 2026

| Count | Result |
| --- | ---: |
| Discovered | 18 |
| Executed | 0 |
| Passed | 0 |
| Failed | 0 |
| Skipped | 18 |
| Verdict | **Blocked** |

The historical non-production run below is retained as context only; it is not
the current certification evidence:

```text
PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" \
E2E_BASE_URL="https://<routed-preview>" \
E2E_USERNAME=<isolated-user> E2E_PASSWORD=<password> \
pnpm test:offline-browser

3 passed, 5 skipped
```

Those historical skips were deliberate release gates, not passing evidence. In
the current environment every test was skipped because the authentication gate
was not configured, and certification mode correctly treated the missing inputs
as a blocked configuration error rather than a green skipped run.

### Certification environment and scenario matrix

| Item | Observed state |
| --- | --- |
| Routed same-origin production/staging URL | **Unavailable** — no `E2E_BASE_URL` was supplied. |
| Isolated staff identity and role | **Unavailable** — no `E2E_USERNAME` or `E2E_PASSWORD` was supplied, so no authenticated role is claimed. |
| Browser | System Chromium executable was present; no authenticated session or production PWA page was opened. |
| Service-worker mode | Production assets were built locally, but no routed production/staging worker was available to control a browser page. |
| Fixture safety | No business record was created, submitted, approved, deleted, or mutated. The optional limited-scope attachment fixture was not provisioned or used. |
| Console, network, trace, screenshots | No authenticated browser evidence exists because the gate stopped before test execution. |

| Condition | Existing browser coverage | Current evidence | Certification outcome |
| --- | --- | --- | --- |
| Authenticated Online baseline and protected `/api/me` traffic | Dedicated baseline scenario | Not executed: credentials and routed URL unavailable | **Blocked** |
| Isolated request failure, 422, 500, 503, 401, 403, timeout, cancellation | Route-controlled classification scenario | Not executed | **Blocked** |
| Browser offline hint; two same-origin probe failures; confirmation-window expiry | Route-controlled browser scenario | Not executed | **Blocked** |
| Probe-driven recovery and no premature Offline banner removal | Route-controlled recovery scenario | Not executed | **Blocked** |
| Approved cached read and protected sensitive-read cache boundary | Route-controlled cached-read scenario | Not executed | **Blocked** |
| Physical browser network loss, accessible English/Arabic banner, and reconnect | Offline/recovery and mobile Arabic scenarios | Not executed | **Blocked** |
| Durable draft replays exactly once after reconnect | No approved isolated draft fixture is registered | Unit/source evidence only; no unsafe shared mutation attempted | **Unavailable — fixture required** |
| Sensitive workflow action and upload stay Online Required with no queue row | Policy/source tests; no approved mutation fixture is registered | Unit/source evidence only | **Unavailable — fixture required** |
| Production worker, warm-cache offline navigation, full offline reload | Production-only worker/reload scenarios | Not executed: no routed production/staging PWA | **Blocked** |
| Protected API cache boundaries and cross-account identity isolation | Source/unit controls only | No isolated second account or logout/switch fixture | **Unavailable — fixture required** |
| Browser restart, multi-tab replay lock, and WebSocket-only disconnect | No supported authenticated browser harness scenario | No fixture or realtime control available | **Unavailable — harness required** |
| Limited-scope protected attachment proxy denial | Separate non-production fixture scenario | Not executed: routed URL and descriptor unavailable | **Blocked** |

The test extensions in this certification record add an authenticated Online
baseline, representative 422/500/503 classification, and confirmation-window
expiry coverage to the existing routed Playwright runner. No P0/P1/P2 product
defect was observed or fixed because no mandatory authenticated scenario could
execute.

### Validation commands and changed files

| Validation | Result |
| --- | --- |
| `pnpm --filter @workspace/cafa-pmis test` | **Pass** — 133 files / 5,805 tests |
| `pnpm --filter @workspace/cafa-pmis typecheck` | **Pass** |
| `pnpm --filter @workspace/cafa-pmis lint` | **Pass** |
| `pnpm check:api-contract` | **Pass** |
| `pnpm --filter @workspace/cafa-pmis build` | **Pass** — production worker generated |
| `pnpm test:offline-browser --list` | **Pass** — 18 discovered |
| `pnpm test:offline-browser` | **Not certification evidence** — 18 skipped |
| `E2E_CERTIFY_PRODUCTION=true pnpm test:offline-browser` | **Blocked as designed** — mandatory routed URL and credentials missing |

Changed files: `artifacts/cafa-pmis/e2e/offline-readiness.spec.ts`,
`artifacts/cafa-pmis/e2e/README.md`,
`docs/connectivity-hardening-validation.md`, and this audit.

### Prior diagnostic browser evidence

An earlier authenticated Chromium diagnostic enabled the Vite development worker and
confirmed an active worker, Workbox cache, and the `cafa-pmis-v1` IndexedDB database
with API cache, draft, attachment, identity-map, and sync-queue stores. It also
proved why that does **not** establish readiness: full-network offline navigation to
`/`, `/index.html`, and `/dashboard` was blank or Chrome's
`ERR_INTERNET_DISCONNECTED`. Development service-worker registration is therefore
not used as certification evidence.

## Browser-test capability and repeatable procedure

`@playwright/test` is installed at the workspace root. Chromium is declared in
`.replit`, and `artifacts/cafa-pmis/playwright.offline.config.ts` records traces and
screenshots on failure. The suite is intentionally pointed at a supplied routed URL:
the static Vite preview does not reproduce the shared-origin web and `/api` artifact
router. The configuration fails before discovery when production certification
credentials or the routed URL are missing.

Run the production certification gate only with an isolated staff fixture:

```sh
E2E_BASE_URL=https://<routed-production-or-staging-url> \
E2E_USERNAME=<isolated-staff-user> \
E2E_PASSWORD=<password> \
E2E_CERTIFY_PRODUCTION=true \
pnpm test:offline-browser
```

The runner never embeds credentials and does not create, submit, approve, or delete
business records. Its usage and evidence locations are documented in
`artifacts/cafa-pmis/e2e/README.md`.

## Current controls verified in source and tests

| Control | Current safety property |
| --- | --- |
| User-scoped browser database | Offline cache, drafts, queue, identity mapping, and attachment metadata reside in Dexie `cafa-pmis-v1` and are associated with the current user. |
| Controlled policy | Sensitive deletes, user management, financial work, AI settings, final approvals, and other live-only actions fail closed offline. Allowed operations are queued only through the approved policy. |
| Durable draft/queue ordering | A draft snapshot is persisted under its stable operation ID before a replay-eligible queue item is inserted. |
| Replay and duplicate prevention | Queue rows retain a stable client operation ID; the server claims idempotency keys atomically and Web Locks coordinate a local replayer. This reduces duplicate risk, but it is not behavioural two-tab proof. |
| Reconnect and retries | Connectivity is probed by `SyncProvider`; queued work can resume automatically or through Sync Now. Retry, conflict, dependency, and failed states remain visible in Sync Status. |
| Parent and scope safety | Synchronisation validates ownership and current authority, halts unsafe dependencies, and does not silently remap stale local relationships. |
| Existing-record conflicts | Approved update payloads carry captured revision information; failures become a review state rather than an automatic overwrite. |
| Attachment honesty | Only attachment metadata is persisted. Following reload, restart, or another tab, the file is `re-select-required`; no binary queue is claimed durable. |
| Local storage resilience | Quota checking is advisory and surfaced to the user; it does not turn a failed persistence write into a false successful save. |

## Module matrix

This matrix records the supported policy and evidence status, not a promise that every
screen is production-certified offline.

| Area | Approved cached/offline behavior | Always live or re-select required | Browser evidence | Readiness |
| --- | --- | --- | --- | --- |
| Project, plan, risk views | Previously authorised non-sensitive reads; approved draft/queue paths only | Create/delete, financial changes, lifecycle decisions, protected documents | Cached project read passed | **Partial** |
| Project, activity, HQ sector, and state programme reports | Approved text/draft state and queue metadata can persist | Submit/review/approve, protected attachments and voice notes require live completion/re-selection | Cache and draft contracts pass in unit suite; reload fixture still needed | **Partial** |
| Activity reports | Previously authorised operational read and approved local draft work | Completion decisions, attachments, and unsupported parent changes | Unit contracts pass; browser lifecycle fixture open | **Partial** |
| Planning registration | Cached authorised lists/details only | New plan registration, budget, state transitions, delete | No production browser lifecycle proof | **Read-only foundation** |
| Budgets and financial analytics | No certified offline operational decision | All allocations, spend, financial edits/approvals and sensitive financial reads | Not eligible | **Live only** |
| Administration, users, permissions, audit | No approved sensitive offline read/write | All access and audit actions | Audit read is browser-blocked offline | **Live only** |
| Communications, notifications, AI | No certified offline send/reconciliation | Messages, voice, attachments, membership, AI actions | Not eligible | **Live only** |
| Files, Drive, evidence | Metadata status only | Upload, replacement, delete, protected download, binary persistence | Re-select policy covered; browser reload fixture open | **Live only for files** |
| Reference/manual data | Previously fetched non-sensitive content | Protected or uncached content | Cache architecture and browser read test | **Partial** |

## Security and failure-case evidence

| Scenario | Current expected safe outcome | Evidence status |
| --- | --- | --- |
| Repeated Sync Now / retry | Stable operation ID and server idempotency are intended to reduce duplicate server work | Implementation and focused-test evidence only; server idempotency expires after 24 hours, so delayed retries remain a material open risk |
| Connectivity returns during request | Probe-driven transition is intended to return to queue/sync semantics rather than pretend server confirmation | Implementation and focused-test evidence only; production browser run still required |
| Concurrent server edit | Captured revision is intended to make replay a conflict/review path rather than a silent overwrite | Implementation and focused-test evidence only; two-browser fixture still required |
| Two tabs | Web Lock is intended to permit one local queue replayer | Source/unit evidence only; two-tab browser trace still required |
| Permission removal or session expiry | Server reauthorises replay and should refuse unsafe work | Server boundary/source evidence only; dedicated browser fixture still required |
| Deleted parent or changed relationship | Dependency/identity validation is intended to prevent unsafe child replay | Source/unit evidence only; deleted-parent browser fixture still required |
| Account/cache isolation | Stores are user-scoped and stale drafts require authorised references before recovery | Source/unit evidence only; logout/switch browser cycle still required |
| Storage quota | Visible advisory warning; no false durability guarantee | Source/unit evidence only; full quota browser fixture still required |
| Attachment after reload/restart | File is deliberately re-select-required; metadata alone is never server proof | Policy/UI evidence only; browser restart fixture still required |

## Known limitations and release requirements

Before changing this verdict to **Offline Ready**, all of the following must produce
recorded browser and server evidence in a production PWA deployment:

1. Warm authenticated data, turn off network at browser level, reload and restart the
   browser, then show the application shell and only authorised cached data.
2. Create and edit an approved durable draft, reload/restart, reconnect, and verify
   exactly one server-side result after automatic sync and repeated Sync Now. Retain
   server idempotency keys for at least the maximum queued-operation lifetime, or
   prohibit delayed retries after the 24-hour server retention window.
3. Repeat with concurrent tabs, a server-side edit, a deleted parent, permission/scope
   removal, session expiry, logout/login as another user, and quota exhaustion.
4. Validate the failure states in English and Arabic/RTL at the supported mobile
   viewport, including screen-reader announcements and online-required controls.
5. Run the attachment scenario through reload/restart and show re-selection before any
   parent workflow can claim complete; do not certify binary persistence unless a
   durable binary store and quota evidence are introduced.
## Final recommendation

**Do not make an Offline Ready claim.** The certification verdict is
**Blocked**. The capability remains **Partially Offline Ready**: retain the
controlled offline policy and browser suite, use it as a release gate, and
complete the production lifecycle matrix above before enabling an operational
offline workflow.