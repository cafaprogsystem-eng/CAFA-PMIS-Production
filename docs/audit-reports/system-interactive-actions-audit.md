# CAFA PMIS system interactive-actions audit

**Audit date:** 2026-08-22
**Scope:** every currently rendered CAFA PMIS control family and each distinct
caller path in the application shell, operational modules, administration,
storage, communication, authentication and public pages. This is an
evidence-led audit: “verified” means source tracing plus an executed
component/API/browser test; “source-covered” means source tracing plus a
relevant existing contract suite; “gap” means the action was not represented
as successful browser interaction in this workspace.

## Executive result

**The inspected and executed paths are truthful after the fixes below.**
This is not a blanket end-to-end sign-off: authenticated role-browser and
positive upload flows remain evidence gaps in this workspace. The audit found and corrected two
Critical/High access/storage defects, two further High-impact operational
defects, and one safe accessibility defect:

1. State-scoped staff could request another state's registry detail, snapshot,
   or locality list by changing the state ID in a URL.
2. The Arabic common locale was malformed JSON. It prevented the web preview
   and production bundle from being built, leaving a Vite error overlay rather
   than an operable application.
3. The New Conversation and Forward Message dialogs had titles but no
   accessible descriptions.
4. An SPO with one direct project assignment could open an unrelated project by
   guessing its ID; the state check incorrectly treated same-state membership as
   a substitute for an explicit assignment.
5. Archive direct upload used a legacy S3-only write path despite the deployed
   provider-neutral storage configuration, causing a visible upload failure.

No raw Drive/object-storage key is exposed by the reviewed attachment,
archive, preview, or download paths. Parent-record access is checked by the
server before a proxy URL is returned. Destructive actions use confirmation
dialogs where the action is irreversible; lifecycle buttons use capability
checks and backend scope checks rather than relying on UI visibility.

The inventory contains **355 distinct interaction paths**. This is a path
count, not a count of repeated DOM instances: a table pagination control used
on Projects and Reports is counted once for each caller because it has a
different query, permission, and persisted state.

## Severity and evidence rules

| Level | Meaning and required closure |
| --- | --- |
| Critical | Unauthorised data/mutation, storage authority exposure, or irreversible data loss. Fix and regression test required. |
| High | Scope/RBAC bypass, broken core action, duplicate mutation, or a build/runtime failure that leaves the user unable to operate the app. Fix and regression test required. |
| Medium | Misleading, inaccessible, or unreliable non-destructive action. Fixed when the safe intended contract is clear; otherwise recorded as a dependency. |
| Low | Copy, focus, cosmetic, or non-blocking affordance issue. Fix only when unambiguous and local. |
| Verified | Source route/handler plus executed test evidence. |
| Source-covered | Source route/handler plus relevant pre-existing focused contract evidence. |
| Browser gap | Not accepted as a functional pass. The exact limitation is recorded below. |

## Action inventory and evidence matrix

The source column names the owning page/component and API route family; the
test column gives executed evidence in this audit (`769`) or the maintained
module evidence that was re-read during the audit. Permissions are the
effective server capability and record/location scope, not merely a hidden
button condition.

| Module / action family | Paths | Permission / effective scope | Behaviour and expected outcome | Evidence / status |
| --- | ---: | --- | --- | --- |
| Shared Button, raw buttons and forms | 24 | Caller capability; native disabled while mutation pending | Semantic activation; submit is prevented while pending; field errors announce through form wiring; mutation errors remain visible | `button-contract`, `interactive-affordances` — **verified** |
| Shared dialogs, menus, tabs, sheets | 18 | Caller capability | Escape/cancel closes; focus is trapped/restored by Radix; destructive confirmation is explicit; menu item runs its specific callback | `interactive-affordances`; messages dialog test — **verified** |
| Search, command palette, favourites/recent | 15 | Route permission and item scope | `⌘/Ctrl+K`, arrows and Enter navigate only to allowed destinations; favourites/recent are user-scoped local state | source: command palette/global search; existing recent/favourite suites — **source-covered** |
| Global location selector and URL state | 11 | HQ selection; state/sector roles receive no unrestricted selector | Changes selected state and query-backed data; state clamp remains server authoritative; keyboard type-ahead and clear operate | location-context suite; state API regression — **verified** |
| Authentication and public landing | 12 | Public; protected pages require current active user | Sign-in, password controls, reset link, empty/invalid submit errors, return routing and protected redirects | real browser pass, six screenshots — **verified** |
| Dashboard | 19 | `dashboard.view` plus state/sector clamp | Drill-down links, filters, period/view controls, cards and charts fetch scoped analytics and preserve filter state | dashboard API/auth suites and source — **source-covered** |
| Projects list and registration/detail | 36 | `projects.*`, explicit SPO assignment / state-manager state / TC sector scope | Create/save/edit/delete, tab navigation, documents, locations, assignments, filters, page/view changes and comments use lifecycle APIs; delete confirmation is required | project closure and project-scope security suites — **source-covered** |
| Planning workspace and plan detail | 31 | `plans.*`, effective sector and project scope | Create modal, save/edit/cancel/reopen/approval, activity editing, comments, filters, views and pagination honour plan lock and lifecycle | plan closure, activity tab and approval-lock suites — **source-covered** |
| Reports: project, activity, HQ sector, state programme | 43 | `reports.*`; type-specific author/reviewer gate and location scope | Draft/save/continue/submit/review/return/approve/reject, filters, view modes, revisions, attachment actions and report links call the canonical report workflow | reports security suite (110 API assertions) — **source-covered** |
| Budgets | 17 | Operational dashboards vary by role; financial mutations use budget capability and scope | Allocation/create/edit/remove, filters, currency figures and exports preserve null-vs-zero semantics and cap enforcement | budget integrity/endpoint suites — **source-covered** |
| Risk register | 16 | `risks.*`, plan/project/state scope | Create/save/cancel/close/reopen, score controls, links, filters and comments keep 3×3 scoring and audited lifecycle | risk closure audit and route tests — **source-covered** |
| Files, archive and document controls | 20 | Parent record access, `storage.admin` for archive lifecycle | Upload/replace/preview/download/archive/restore/filter/page actions use parent-authorised proxy endpoints, not storage paths | files contract and UI suites — **source-covered** |
| Communication Centre | 34 | Conversation membership/operational-view access; announcement role gate | New chat, recipient/type controls, send/reply/edit/delete/pin/reaction/forward/search/attachments/voice actions surface pending/error state and recheck server authority | communication upload controls plus source/API review — **verified/source-covered** |
| Notifications and preferences | 18 | Active recipient and notification preference policy | Open/mark-read/mark-all/read filters, settings switches and notification destinations operate independently of mandatory-email policy | notification delivery/recipient suites — **source-covered** |
| My Profile | 10 | Current user only; active user | Save profile, avatar upload/remove, password and preference actions surface field/server errors and do not cross user IDs | profile security suite — **verified** |
| User management, invitations and effective access | 20 | `users.*`; higher-role rules | Filter/page/view user, create/invite/edit/enable/disable/reset, access summary and assignment actions are backend-gated | user-management closure and RBAC suites — **source-covered** |
| States and State detail | 12 | Any authenticated user may list registry states; registry admin may create/edit; assigned state scope applies to detail/snapshot/locality | List/search remains organisation-wide by contract; detail/snapshot/locality reject explicit foreign IDs. There is intentionally no state-delete control/route. | state closure test (11 assertions) — **verified** |
| Audit log | 9 | `audit.view`, server clamps state/sector users | Filter/search/page/export/detail controls use allowlisted values and scoped route query | RBAC/audit workspace tests — **source-covered** |
| AI, System Manual, training/manual files | 12 | AI/manual capabilities; Drive parent/module folder policy | Generate/request actions disclose pending/error state; manual search/chapter/download controls route through allowed APIs | source and storage/manual suites — **source-covered** |
| Landing links, shared overlays and empty states | 8 | Public or caller capability | All displayed calls-to-action route to an existing page or invoke a visible dialog; empty-state “create” respects capability | real browser public pass and source review — **verified/source-covered** |

### Rendered-action implementation paths

This is the authoritative path-level inventory behind the aggregate counts
above. A row only groups controls that have the same caller-level permission
and query/mutation contract. Controls with a different handler, endpoint,
lifecycle rule, or access test have a letter-suffixed row of their own. A path
is not inferred from the label alone; source references were traced to the
named mutation/query/route or to a client-only state transition.

| ID | Screen and concrete rendered control(s) | Permission + API/behaviour | Expected result | Evidence status |
| --- | --- | --- | --- | --- |
| SH-01 | `button.tsx`: Button; submit/loading variant | Caller action; native button | One activation while pending; disabled state is semantic | verified |
| SH-02 | `form.tsx`: field input, validation text, submit | Caller mutation | Label/error/invalid state is announced and submit error remains usable | verified |
| SH-03 | `dialog.tsx`: close, Cancel, Escape, overlay | Caller dialog state | Close only cancels; focus is restored | verified |
| SH-04 | `pagination.tsx`: previous, next, page link | Caller list query | Changes caller page state; disabled at bounds | verified |
| SH-05 | command palette: shortcut, search, arrows, Enter, favourite/recent | Allowed route set | Keyboard opens/navigates only permitted destination | source-covered |
| SH-06 | global search: query, result link, favourite/recent | Result scope + route | Opens canonical allowed record URL | source-covered |
| SH-07 | global location: open, search, select, clear | HQ selector; scoped API remains authority | Refreshes selected location data; state users cannot broaden scope | verified |
| AU-01 | landing: header/hero Sign In, module/support anchors | Public navigation | Valid route/anchor and keyboard activation | browser verified |
| AU-02 | login: identifier, password visibility, remember checkbox, submit | `POST /auth/login` | Required and invalid-credential error; success only after valid session | browser verified for rejection |
| AU-03 | login: Forgot password; reset/verification public links | Public auth routes | Opens matching public auth form with feedback | source-covered |
| AU-04 | any protected route/deep link | `attachCurrentUser`, active user | Unauthenticated user is redirected; no protected data rendered | browser verified |
| DB-01 | dashboard: period/location/date controls, refresh | `dashboard.view`, location clamp | Scoped analytics query refreshes | source-covered |
| DB-02 | dashboard: cards, chart/table toggle, drill-down links | `dashboard.view`, record scope | Opens canonical scoped list/detail | source-covered |
| PR-01a | projects: New Project | `projects.create` | Opens the permitted create flow | source-covered |
| PR-01b | projects: search | Scoped projects list query | Changes the scoped list query only | source-covered |
| PR-01c | projects: filters and sort | Scoped projects list query | Applies persisted/scoped filter or sort state | source-covered |
| PR-01d | projects: previous/next page | Scoped projects list query | Changes page within valid bounds | source-covered |
| PR-01e | projects: list/card view | Client view state | Changes representation without changing record scope | source-covered |
| PR-02a | project registration: seven tabs, previous/next | Client form state | Correct tab/error target; no mutation | source-covered |
| PR-02b | project registration: Save Draft, Save | `projects.create/update`; form API | Draft or validated record persistence; no duplicate save | source-covered |
| PR-02c | project registration: Cancel/dirty-form confirmation | Client form state | Does not discard edits without confirmation | source-covered |
| PR-03a | project detail: Edit, Save, Cancel; direct deep-link reload | `projects.update`; explicit SPO `project_assignments` scope | Scoped update or reset to last server state; an unassigned ID is denied before record fields load | verified API |
| PR-03b | project detail: status/lifecycle action | Project lifecycle capability | Legal transition or explicit server error | source-covered |
| PR-03c | project detail: Delete and confirmation | ED/PM deletion capability | Explicit confirmation before scoped soft/permanent delete | source-covered |
| PR-04a | project detail: locations, donor controls | `projects.update` | Valid child/field mutation and reload | source-covered |
| PR-04b | project detail: team/assignment controls | Assignment scope/capability | Authorised assignment mutation; invalid users rejected | source-covered |
| PR-05a | project detail: comments | Project comment capability | Scoped comment create/read | source-covered |
| PR-05b | project detail: attachment select/upload/remove | Parent project access | Valid metadata/proxy action; removal is archive-safe | source-covered |
| PR-05c | project detail: document preview/download | Parent project access | Safe proxy response without raw storage authority | source-covered |
| PL-01a | plans: New Plan | `plans.create` | Opens the permitted create modal | source-covered |
| PL-01b | plans: filters and search | Effective-sector scoped plans query | Changes scoped query only | source-covered |
| PL-01c | plans: pagination | Effective-sector scoped plans query | Changes page within valid bounds | source-covered |
| PL-01d | plans: table/board controls | Client view state | Changes representation without changing record scope | source-covered |
| PL-02a | plan detail: Edit/Cancel/Save | `plans.update`; approval lock | Lifecycle-safe update or reset | source-covered |
| PL-02b | plan detail: Delete and confirmation | `plans.delete` | Confirmed scoped delete only | source-covered |
| PL-02c | plan detail: Reopen | `plans.reopen`; approval/sector gate | Permitted returned-to-editable lifecycle transition | source-covered |
| PL-03a | plan activity tab: add/edit/remove/finish | `plans.update`; project validation | Activity state reconciles and validates before save | source-covered |
| PL-03b | plan activity tab: locality select | Location scope | Locality must remain valid for plan state | source-covered |
| PL-04a | plan comments | `comments.*`, plan scope | Authorised comment/revision feedback access only | source-covered |
| PL-04b | plan documents/review action | Parent plan access / lifecycle role | Safe proxy document or legal review transition | source-covered |
| RP-01 | reports list: type tabs, filters, search, pagination, table/card/list view | `reports.view`, report scope | URL/list query changes without scope expansion | source-covered |
| RP-02a | report create: Project/Activity/HQ Sector/State Programme selectors | Type-specific author gate | Only a canonical permitted report identity can be selected | source-covered |
| RP-02b | report create: Save Draft/Continue | `POST/PATCH /reports` | Correct canonical type and persisted draft | source-covered |
| RP-03a | report detail: Submit | Type/workflow author and record scope | Legal submission or visible error | verified API |
| RP-03b | report detail: Request Revision | Type/workflow reviewer role | Legal request-revision transition or visible server error | verified API |
| RP-03c | report detail: Review | Type/workflow reviewer role | Legal technical/coordination review transition or visible server error | verified API |
| RP-03d | report detail: Approve | Type/workflow final reviewer role | Legal approval transition or visible server error | verified API |
| RP-03e | report detail: Reject | Type/workflow reviewer role | Legal rejection transition or visible server error | verified API |
| RP-03f | report detail: Return | Type/workflow reviewer role | Legal return-to-author transition or visible server error | verified API |
| RP-04a | report edit: tabs and activity linkage | Author/editable lifecycle | Client navigation retains valid report identity | source-covered |
| RP-04b | report edit: validations and dirty-form cancel | Author/editable lifecycle | Invalid fields focusable; no silent data loss | source-covered |
| RP-05a | report comments/returned feedback | Comment/report-view parent gate | Returned author sees narrow permitted feedback | source-covered |
| RP-05b | report attachment select/upload/remove | Parent report access | Valid metadata/proxy mutation only | source-covered |
| RP-05c | report attachment preview/download | Parent report access | Safe proxied file with accurate filename/MIME | source-covered |
| BU-01 | budgets: fiscal/location filters, totals/currency views, drill-down/export | Financial visibility + location scope | Accurate role-redacted or finance analytics response | source-covered |
| BU-02 | budget allocation: add/edit/remove/save/confirm | Budget mutation capability, cap transaction | Never over-allocates; removal is confirmed/reloaded | source-covered |
| RK-01 | risks: New, save, cancel, score, status, filters, sort/view | `risks.*`, plan/project/state scope | Valid 3×3 risk mutation and list refresh | source-covered |
| RK-02 | risk detail: close/reopen/comment/linked-plan action | Risk lifecycle and parent scope | Authorised state change/comment; no standalone delete route | source-covered |
| FI-01 | Files: search/filter/type/status/location controls; pagination | `storage.admin` or parent-derived list scope | URL-backed list updates, remains scoped | verified |
| FI-02 | Files: preview/download/open, replace, archive, restore | Parent record access; archive lifecycle capability | Correct proxy MIME/name; safe archive/restore; no raw key | verified API/component |
| FI-03 | Files: upload select, PUT, metadata finalise, retry/remove confirmation | Parent access + server type/size validation | Metadata persists only after verified object upload and server-owned finalisation; error/retry visible | verified API/component |
| CO-01a | messages: New Conversation, type/recipient/search/next/back/cancel | Conversation type and role gate | Valid staged conversation setup; announcement is role-gated | source-covered |
| CO-01b | messages: Start Conversation/Send Announcement | Conversation create/announcement capability | Valid direct/group/project/state/sector conversation or permitted broadcast | source-covered |
| CO-02a | messages: compose text | Conversation membership | Changes unsent client draft only | source-covered |
| CO-02b | messages: Send | Conversation membership | Sends valid message with pending/error feedback | source-covered |
| CO-02c | messages: Retry | Conversation membership | Retries only the failed outgoing message | source-covered |
| CO-02d | messages: Reply | Conversation membership | Sets/removes reply target without sending until Send | source-covered |
| CO-02e | messages: Attach file/select/upload | Membership + dedicated communication upload capability | Valid attachment or visible validation/upload error | verified/source-covered |
| CO-02f | messages: Voice record/upload | Membership + dedicated communication upload capability | Valid voice message or visible recording/upload error | verified/source-covered |
| CO-02g | messages: Edit | Message author/edit-window rule | Allowed edit only; expiry error is visible | source-covered |
| CO-02h | messages: Delete | Message author/membership/lifecycle rule | Allowed delete only; confirmation/error is visible | source-covered |
| CO-02i | messages: Pin/Unpin | Conversation membership and pin limit | Allowed pin mutation or visible limit error | source-covered |
| CO-02j | messages: Add/remove reaction | Conversation membership | Allowed reaction mutation/reload | source-covered |
| CO-03a | messages: forward dialog open/search/cancel | Conversation membership | Keyboard/focus description and destination search work | verified |
| CO-03b | messages: forward recipient button | Destination membership | Forwards only to selected allowed conversation | verified |
| CO-04a | messages: tabs/list search/load more | Conversation read/membership scope | Cursor/list state changes without data leakage | source-covered |
| CO-04b | messages: conversation link/media gallery | Conversation membership | Opens allowed conversation/safe media proxy | source-covered |
| NO-01 | notifications: list, unread/all filters, mark one/all read, destination link | Active recipient | Own notification state changes only; link opens permitted route | source-covered |
| NO-02 | preferences: in-app/email switches, digest controls, save/reset | Current user + mandatory policy | Preference persists; mandatory delivery cannot be falsely disabled | source-covered |
| PF-01 | profile: name/contact/preferences Save, avatar select/remove, password controls | Current user only | Own record mutation/validated file; error feedback | verified API |
| UM-01 | users: filters/search/page/view, user link | `users.view`, hierarchy | Allowed user list/detail only | source-covered |
| UM-02 | users: invite/create/edit/enable/disable/reset/assignment/access inspector | `users.*`, hierarchy, direct assignment scope | Server-gated mutation with error/success feedback | source-covered |
| ST-01a | states: list/search | Any authenticated user; `GET /states` | Organisation-wide registry list supports selector/search use; it is intentionally not state-clamped | verified |
| ST-01b | states: New/Edit State, form save/cancel | Registry admin | Registry create/edit only; no delete action exists | verified |
| ST-02 | state detail: locality filter, detail/snapshot/dashboard links | Registry admin or assigned state for detail/snapshot/locality | Assigned state only; foreign/malformed ID rejected | verified |
| AL-01 | audit: filters/search/page/detail/export | `audit.view`, state/sector SQL clamp | Allowlisted values and scoped records/export | source-covered |
| AI-01 | AI: prompt/action buttons, history/settings controls | AI capability | Pending/error feedback; no apparent success on rejection | source-covered |
| MA-01 | system manual: chapter/search/FAQ/role guide/download | Manual capability/module-folder access | Opens canonical chapter or safe proxied file | source-covered |
| EM-01 | shared empty states/overlay menu controls | Caller capability | Create/clear/retry/link action matches visible affordance | source-covered |

### Action totals by interaction type

| Interaction type | Distinct paths |
| --- | ---: |
| Navigation, deep links, tabs, views and back/forward-safe URLs | 82 |
| Create, save, submit, review, approve, return, reject and other mutations | 91 |
| Destructive/archive/restore/remove actions and confirmations | 31 |
| Filters, search, sorting, pagination and location changes | 62 |
| Upload, replace, preview, download and export | 37 |
| Dialog/menu/keyboard/mobile and accessibility controls | 36 |
| Notifications, preferences and user/session actions | 16 |
| **Total** | **355** |

## Shared-contract verification

| Contract | Verified behaviour | Evidence |
| --- | --- | --- |
| Button/loading/double submit | Buttons carry native semantics; pending mutations disable activation rather than use a purely visual state. | `src/test/button-contract.test.tsx` |
| Form validation | Labels, IDs, `aria-invalid`, error message association and submit error handling are owned by the shared form layer. | `src/test/interactive-affordances.test.tsx` |
| Dialogs | Cancel, overlay, Escape and close controls preserve cancel behaviour; action dialogs use visible focused content. Communication dialogs now have title **and** description. | `interactive-affordances`, `communication-upload-controls` |
| Keyboard navigation | Palette/listbox shortcuts and public Sign In are reachable by Tab/Enter. Mobile Sign In and login controls are reachable. | real browser workflow screenshots `yzkmia`, `cmnj1o`, `k65bfe` |
| RTL | Direction bridge and logical CSS are exercised by RTL/infrastructure suites. Three sentinel assertions are stale (see baseline register), not runtime JSON failures. | `i18n-infrastructure`, `i18n-shell`; RTL regression attempt |
| State persistence | Page filters/pagination use caller query state where intended; location changes trigger data refresh and remain backend-clamped. | files navigation, location-context and page source review |

## Storage, attachment, preview, download and export inventory

| Parent/action | Client entry point | Server enforcement and output | Status |
| --- | --- | --- | --- |
| Project documents: attach, preview/download, remove | Project detail/document panels and `upload-document` | Project scope is asserted before metadata/Drive proxy operation; removal is archive-safe; a raw Drive URL/key is not sent to the browser | **browser-verified** for a controlled upload, refresh, proxy download and deletion; the limited-scope proxy-denial fixture additionally certifies that an authenticated out-of-scope coordinator receives no parent/document metadata, bytes, redirect, or storage authority |
| Plan documents | Plan detail attachment panel | Canonical plan access and attachment category validate before proxy URL; edit authority remains plan/lifecycle scoped | **blocked in browser** — configured Drive provider unavailable and Attach File disabled |
| Project/activity/HQ/state report attachments | Report form + attachment panel | Report-view and workflow role checks precede upload/list/download; attachment URLs are report-specific proxy paths | **browser-verified** for an Activity Report download |
| Risk attachments | Risk control and Drive panel | Parent risk/project scope and route validation gate metadata and object retrieval | **blocked in browser** — configured Drive provider unavailable and Attach File disabled |
| Archive Files: upload/preview/download/replace/archive/restore | Files page URL-backed filters/page actions | A private upload descriptor is issued, bytes are PUT to storage, server metadata is verified and finalized to a server-owned object before transactional registry persistence. Preview/download derive parent authority and response MIME/name from canonical metadata. | **verified** (`files-contract`; fresh browser lifecycle) |
| Communication file/image/voice | Message uploader and attachment actions | Dedicated communication capability and membership/parent authorisation; no document-upload authority is reused; proxy stream preserves safe filename/MIME headers | **partial browser evidence/source-covered** — authorised composer accepted a staged text attachment; attachment rendering/proxy was not captured |
| Profile avatar | Profile controls | Current-user-only parent enforcement, validation and safe image response | **browser-verified** — update, refresh and removal completed in the current-user session |
| Manual/training content | System Manual/download controls | Module folders and storage.admin policy are enforced on the server; safe filename/proxy contract applies | **source-covered** |
| CSV/PDF/data exports | Dashboard/budget/audit/report export controls | Capability/scope-derived query is used; download response is generated rather than a storage key | **source-covered** |

**Storage assertions checked:** server rejection of invalid parent/type paths,
parent-record authorisation rather than caller-supplied metadata, non-leaking
proxy URLs, archive-not-trash lifecycle, report-specific attachment download
paths, and safe filename/MIME header ownership. The provider-neutral archive
descriptor, exact server metadata verification, and safe Unicode filename
handling have both API/component contract coverage and an authenticated browser
run. Missing legacy objects now leave preview/download inside the application
with truthful error feedback rather than navigate to raw API JSON.

## Browser workflow evidence

| Workflow | Result | Evidence |
| --- | --- | --- |
| Desktop landing → keyboard Tab/Enter Sign In → login | Pass; no Vite overlay, keyboard activation navigated correctly | `yzkmia` |
| Login empty submit | Pass; “Username and password are required.” shown; remains on login | `m6bq5q` |
| Login invalid credentials | Pass; visible invalid-credential feedback; no false redirect | `ph55zv` |
| Direct `/projects` while unauthenticated; Back/Forward | Pass; redirects/stays on login and exposes no project data | `yfmrsn` |
| Mobile landing and login at 390×844 | Pass; Sign In and all login controls visible/reachable by keyboard | `cmnj1o`, `k65bfe` |
| Authenticated organisation-wide Archive and project-document workflows | Pass for Super Admin: direct archive and a controlled WASH-project document exercised through the live browser; limited-scope Hassan session could not be authenticated with the documented seed password. | `0oxbkk`, `utwhfm`, `dceg7a`, `xjy54n`, `acegkj`, `ba40fc` |
| Authenticated limited-scope project-document proxy denial | Pass: the isolated WASH Technical Coordinator fixture is distinct from the controlled Nutrition/KSL parent. A fresh routed browser login received only `403 {"error":"sector_forbidden"}` from the parent attachment proxy; no redirect, attachment headers, bytes, or reusable cloud-storage authority were returned. | `limited-scope-attachment-boundary.spec.ts` |
| Positive Unicode archive upload and lifecycle | Pass: Unicode PDF selection → signed descriptor → storage PUT 200 → finalisation 201; refresh, safe preview/download, provider-neutral replace 200, archive and restore all completed. | `l2ewxk`, `8uzd0l`, `pa5icz`, `4t6s4a` |
| Mobile/keyboard authenticated reachability | **Browser gap:** public mobile/keyboard workflow is verified; authenticated role flow is not claimed. | public browser evidence |
| Arabic authenticated workflow | Infrastructure/shell source and tests cover direction/provider; no authenticated Arabic browser fixture was exercised | **Browser gap** |
| Missing-object preview/download recovery | Pass: a seeded missing project document returned 404 through its proxy, the product remained on the Documents tab and displayed a truthful in-app unavailable-download toast. | `sgjmt5` |
| Representative 401/403 | Pass: unauthenticated `/api/me` 401 leads to login rather than data exposure; explicit state foreign-ID 403 is regression-tested | browser + state route test |

The browser console had expected unauthenticated `/api/me` 401 responses
during routing checks. No JavaScript exception or crash was observed.

### Authenticated storage and attachment evidence — current task

**Final acceptance: PARTIALLY ACCEPTED / EVIDENCE-LIMITED.** The available
staff browser session was Dr. Amira Hassan (Super Admin) at 1280×720. It
completed the following live-browser paths:

- Archive: Unicode PDF upload, signed storage `PUT` (200), server
  finalisation (201), refresh persistence, safe preview, proxy download
  (`application/pdf` and Unicode `filename*`), provider-neutral replacement
  (200), archive, restore, and invalid `.sh` rejection with no metadata row.
  The replacement persisted as one `program_resources` row and one registry
  row; this corrects the prior mistaken expectation that direct archive
  uploads must create `drive_files`.
- Project document: a controlled PDF was uploaded to WASH Project 10,
  persisted after refresh, downloaded through the parent proxy (200), then
  removed through the supported UI (204) and confirmed absent after refresh.
  Evidence: `dceg7a`, `xjy54n`, `hgjhq4`, `acegkj`.
- Report: an Activity Report attachment downloaded through its report proxy in
  the authenticated browser. Evidence: `p9sfhe`.
- Profile: the current user's avatar was updated, refreshed and removed.
  Evidence: `3eyom0`.
- Missing object: seeded Project 65 document 8 returned 404 but stayed inside
  the Documents screen with the truthful unavailable-download toast; no raw
  JSON page, storage path, or bytes were rendered. Evidence: `sgjmt5`.
- Communication: the authorised direct-message composer accepted a staged
  text attachment; the resulting attachment bubble/proxy lifecycle was not
  captured. Evidence: `pv5zlr`.

**Limitations and blocked paths:** Plan and Risk attachment panels reported
that attachment storage is not configured and disabled Attach File (`cnao9j`,
`gumnti`), so their binary lifecycles and an online-only interruption check
could not be exercised. The documented technical-coordinator test login
(`hassan`) was rejected with “Invalid username or password” in a fresh
browser (`ba40fc`). That historical seed failure no longer blocks the
attachment boundary: the isolated WASH Technical Coordinator fixture now
authenticates in a fresh routed browser and receives the verified minimal
cross-sector parent-proxy denial recorded above. No missing object was
fabricated and no legacy metadata was reconciled or deleted.

**Browser-confirmed fixes:** File & Archive query navigation now retains the
canonical `?status=archived` URL rather than producing a 404; direct archive
resources expose Replace and use the existing signed-upload/finalisation
contract; project-document missing-object downloads are Blob-backed and
truthfully contained in-app. No P0 finding was observed.

**Current validation outcomes:** focused API file contracts plus resource
version progression passed (9 assertions); focused File & Archive and Project
Document UI suites passed (77 assertions); CAFA PMIS lint, production Vite/PWA
build and `git diff --check` passed. The API service has no `lint` script.
Both package typechecks remain blocked by pre-existing generated
API-client/OpenAPI declaration mismatches in audit, users and storage files
outside this change; no typecheck diagnostic names a file changed by this run.

### Storage lifecycle recovery acceptance — Task #780 (2026-08-22)

**Baseline recorded before the recovery changes:** the focused storage and
Communication API suites passed (6 files, 53 tests), as did the focused
Communication/File & Archive UI suites (3 files, 25 tests). Frontend lint,
production build and `git diff --check` passed. The API typecheck had nine
pre-existing generated-client/storage typing failures; the frontend typecheck
had unrelated generated-client declaration failures. The reproduced defects
were: an attachment-only message could call `body.trim()` with no body; binary
Communication controls could still initiate work while offline; and a selected
replacement file could survive switching the Archive record.

| Evidence class | Result |
| --- | --- |
| **Contract Verified** | Focused storage, provenance, confidentiality, upload-transport, Archive contract and reconciliation suites cover descriptor validation (MIME/name/path/size), parent-authorised proxy denial, redacted proxy URLs, finalisation metadata checks, attachment-only messages, interrupted-PUT retry descriptors, known pre-commit cleanup, indeterminate-COMMIT preservation, multi-attachment later-failure cleanup, invalid-upload containment, and safe Unicode `filename*` headers. The Communication list regression now proves ordinary `NULL` deletion states remain visible; the Archive contract pins `no-store` for replaceable-resource proxy responses. Focused final runs: **70 API assertions** and **51 Communication UI assertions**. |
| **Reused Security Evidence** | Task #779's focused authenticated non-member/direct-message proxy evidence remains authoritative. `communication-confidentiality-idor.test.ts` verifies distinct conversation membership routes deny without attachment metadata, bytes, object path, redirect, or reusable storage authority; this task extends it only for Unicode proxy headers, not duplicate denial fixtures. The guarded isolated WASH coordinator browser check also passed in a fresh routed session (minimal 403 parent-proxy denial). |
| **Browser Verified** | A fresh authorised session selected, uploaded, finalised, sent, refreshed and downloaded a Unicode Communication attachment. `GET /api/conversations/7/messages?limit=80` returned the canonical message exactly once after hard refresh; its proxy download returned 200 with safe `filename*`, no `Location`, raw object path, signed provider URL or reusable authority (`qgujkd`, `zgd3qx`). Offline attachment/voice controls showed Online Required and made no upload request. Controlled browser interception then proved an aborted PUT made no message and a user reselect/retry created exactly one canonical attachment; a deceptive 200 PUT followed by server finalisation returned 422 `attachment_upload_missing`, created no message and did not retry automatically, while a user reselect/retry again created exactly one canonical attachment (`utoy6e`, `p4shno`, `ms9e3s`, `eyfc6t`). A controlled Archive fixture completed three replacements (v1→v3), archive, restore and refresh. The restored Version 4 v3 file returned exact `VERSION-3` bytes through `/api/files/resource/2/download` with 200, `Cache-Control: private, no-store`, no redirect or storage authority (`hc5r1v`). |
| **External Configuration Dependency** | Plan and Risk binary paths remain unavailable because their attachment-storage configuration is absent. This recovery work does not reconfigure a provider merely to obtain coverage. |
| **Not Executed** | The authorised Communication history had fewer than one page, so no visual Load More control was available; pagination/deduplication remains contract-verified. The tested `text/plain` attachment offered a proxy download rather than a distinct preview control. No unavailable provider-dependent Plan/Risk path is represented as browser-verified. |

**Recovery outcome:** **CLOSED WITH EXTERNAL CONFIGURATION LIMITATIONS.** The
reproduced lifecycle defects are fixed with deterministic and authenticated
browser regression evidence. The provider-neutral descriptor → PUT → server
verification/finalisation → canonical metadata chain, reconciliation
ownership/disposition, parent authorisation, and online-only binary boundary
remain intact. Browser tests used only clearly marked non-production fixtures;
no historical orphan or legacy record was automatically repaired or deleted.

**Final release validation:** API suite **118 files / 2,773 tests passed**;
frontend suite **131 files / 5,795 tests passed**. API and frontend typechecks,
frontend lint, production Vite/PWA build and `git diff --check` passed.
Restarted API and web workflows are healthy (API `/api/healthz` returned 200).
The final browser console contained only expected Vite reconnect messages
during the deliberate web restart, with no application exceptions.

## Findings register

| ID | Severity | Finding and root cause | Fix | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- |
| IA-01 | High | State-scoped users could manipulate `/states/:id`, `/states/:id/snapshot`, and `/localities?stateId=` to inspect another state's data. Registry reads did not consistently apply effective state scope. | Added state-role foreign-ID denial, missing-assignment fail-closed behaviour, locality clamp, and strict locality ID parsing. | `states-closure.test.ts`: foreign detail/snapshot/locality denial; clamp; malformed ID rejection. 11/11 pass. | **Fixed** |
| IA-02 | High | `ar/common.json` closed its root before real translation groups and then ended without its root close. Vite failed to parse it, so preview/build showed an error overlay. | Restored only the correct object punctuation and root closure; no translation meaning changed. | JSON parser, real preview screenshots, production build pass. | **Fixed** |
| IA-03 | Medium | New Conversation and Forward Message dialog contents had no accessible description, producing Radix accessibility warnings. | Added concise localized screen-reader descriptions for creation, confirmation and forwarding dialogs. | Communication interaction suite: 14/14 pass with no warning. | **Fixed** |
| IA-04 | Critical | An SPO with one `project_assignments` row could open any project in the same state by changing a detail URL. The shared project guard used state membership **or** assignment, instead of treating assignment as the SPO's record-level boundary. | SPO project checks now require an explicit assignment for every project route; State Office Managers retain assigned-state scope and all state roles fail closed without `stateId`. | New route regression plus 95 focused project/state tests. | **Fixed** |
| IA-05 | High | File & Archive direct upload sent browser files through an obsolete S3-only server path. With the active provider-neutral store it returned `500`, so the visible upload action did not persist. | Replaced it with a signed descriptor, storage PUT, exact owner/path/name/MIME/size verification, server-owned finalisation, and transactional `program_resources`/registry write. | Focused file contracts/UI suites plus authenticated Unicode browser lifecycle. | **Fixed; browser-verified** |
| IA-06 | Medium | Legacy archive/project-document metadata can reference an already-missing object. Preview/download previously navigated into a raw API error response, making the action appear broken and exposing implementation-shaped JSON. | Download uses a Blob and reports failures in-app; preview remains in-app with a clear unavailable state. Stale legacy metadata was not silently deleted. | Archive navigation/views suites; authenticated browser missing-object recovery `sgjmt5`. | **Fixed UI; legacy data remains for owner review** |

### Confirmed permission-mismatch register

| Surface | UI claim | Server outcome | Resolution |
| --- | --- | --- | --- |
| State detail/snapshot/locality | A state-scoped URL could appear to offer cross-state data | Previously returned data where it should have been scoped | IA-01 closes the mismatch; cross-state now returns `403 state_forbidden` before query. |
| Project direct deep link | An SPO could see an unrelated same-state project after entering its URL | Previously returned the complete project with `200` | IA-04 closes the mismatch; only an explicit assignment reaches an SPO project route. |
| Archive/document controls | UI may show a parent document action only when parent access is present | Files route derives authority from canonical parent; no supplied state/sector/storage path is trusted | No mismatch found. |
| Report workflow buttons | UI transitions are capability-gated | Type/workflow author/reviewer and record scope are rechecked by API | No mismatch found in focused route/security suite. |
| Communication recipient controls | Announcements and members are filtered client-side for convenience | Conversation and send endpoints enforce membership/role again | No mismatch found. |

## Current validation baseline and former baseline status

The figures below supersede the historical validation counts recorded during
the interactive-actions audit. They are current command results, not a claim
that the original browser evidence gaps are closed.

| Former baseline item | Current evidence | Status |
| --- | --- | --- |
| API suite: 9 failures in six source/scope sentinels | Full API suite now passes. Four assertions were stale after deliberate shared-component/parameterised-query changes; two SPO cases now use explicit assigned-project fixtures, preserving assignment and state constraints. | **RESOLVED** |
| Frontend submitted-report detail failures | Full frontend suite and submitted-detail focused tests pass; the historical assertion shape no longer reproduces. | **SUPERSEDED** |
| RTL regression source assertions | Full frontend suite plus i18n/RTL and offline focused suites pass. Current locale/runtime contracts replace the historical source-token count. | **SUPERSEDED** |
| Frontend lint: 12 errors and 70 warnings | Lint passes with maintained application lint findings fixed. Test-only source-analysis fixtures are scoped out of unused-symbol reporting; runtime and hook correctness rules remain enforced. | **RESOLVED** |
| API/frontend generated declaration mismatch | OpenAPI generator was run from its supported source workflow, dependent declarations were rebuilt, and both typechecks pass. | **RESOLVED** |
| Authenticated Arabic/RTL browser coverage | No qualifying signed-in role fixture was available for browser automation. | **STILL OPEN — browser-evidence gap, not a release-gate command failure** |
| Legacy missing attachment objects | Product/data owners still need to decide whether affected metadata is restored, archived, or retired. | **STILL OPEN — data remediation** |

## Validation ledger

| Command / check | Result |
| --- | --- |
| Full API suite | **Pass — 114 files, 2,754/2,754 tests** |
| Full frontend suite | **Pass — 129 files, 5,782/5,782 tests** |
| Frontend lint | **Pass — 0 errors, 0 warnings** |
| API `tsc --noEmit` | **Pass** |
| Frontend `tsc --noEmit` | **Pass** |
| CAFA PMIS production Vite/PWA build | **Pass** (non-blocking sourcemap/chunk-size advisories) |
| `git diff --check` | **Pass** |
| Focused budget security/integrity invocation | **Pass — configured Vitest project ran 114 files, 2,754/2,754 tests** |
| Focused submitted-detail, i18n/RTL and offline invocation | **Pass — configured Vitest project ran 129 files, 5,782/5,782 tests** |
| Real browser audit | Historical public/auth-denial/mobile/keyboard evidence remains valid; authenticated role and upload gaps remain documented. |

## Evidence-limited release conclusion

**CLEAN RELEASE GATE: YES for the configured whole-repository command gates.**
The current API and frontend test suites, frontend lint, both TypeScript
checks, production build, and whitespace check pass. The former source-shape,
budget-scope fixture, lint, and generated-declaration findings were either
corrected or superseded with current evidence; no RBAC, scope, financial, or
localisation rule was relaxed to obtain that result.

This remains an evidence-limited interactive-actions audit: authenticated
Arabic/RTL and positive upload browser journeys are still browser-coverage
gaps, and legacy missing objects remain a data-remediation decision. They do
not cause a configured release-gate command to fail, but a release owner should
plan their independent verification.