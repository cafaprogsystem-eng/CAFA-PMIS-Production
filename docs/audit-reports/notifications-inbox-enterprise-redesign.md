# Notifications Inbox Enterprise Redesign — Closure Audit

## Executive status

**Complete.** The main `/notifications` page has been recomposed as a compact enterprise inbox for operational scanning. The work is presentation-only: no notification API, database, delivery, recipient, realtime, preference, pagination, cache, or safe-link behaviour was changed.

## Scope and authenticated findings

The audit covered the authenticated Notification inbox surface only:

- page shell, heading, unread summary, and bulk action;
- status tabs, search, and module filter;
- loading, populated, empty, and error list states;
- desktop and mobile row hierarchy;
- unread/read differentiation, keyboard access, and Arabic/RTL hooks;
- existing safe navigation, per-item read actions, bulk read action, and pagination presentation.

The browser session has no test credentials. A protected-route smoke check confirmed that `/notifications` redirects coherently to the Sign In page when unauthenticated rather than failing or rendering a blank page. Authenticated appearance was therefore verified through rendered component tests and source-backed behavioural assertions, not a live signed-in browser session.

## Visual decisions

| Area | Decision |
| --- | --- |
| Workspace | Increased the centred page bound from a narrow content column to `max-w-6xl`, retaining whitespace around the inbox. |
| Header | Uses a restrained title, localised unread summary, and compact outline bulk read action only when unread notifications exist. |
| Toolbar | Combines status tabs, search, and module filter in one responsive bordered toolbar. |
| List surface | Uses one bordered, divided surface instead of separate row cards. |
| Row structure | Desktop rows use fixed logical columns for icon/status, message, entity context, time, and an action area. Mobile rows keep the icon, message, actions, then place entity and time beneath the message. |
| Unread state | Removes the continuous unread edge border. Unread rows use a light row tint, a labelled dot, and message weight; read rows remain legible. |
| Metadata | Removes visual event-kind badges. The translated kind remains available to assistive technology beside the icon, while entity context stays visibly available. |
| Actions | Replaces text links with quiet icon controls. Linked unread items retain both independent **Open notification** and **Mark as read** actions, so marking read never requires navigation. |
| Direction and content | Uses logical positioning, RTL-aware open icon direction, `dir="auto"` on messages, and safe word wrapping for long or mixed-direction content. |

Time grouping was **not applied**. It is unnecessary for the requested scanning hierarchy and intentionally avoided to keep ordering, pagination, realtime, and localised-date presentation unchanged.

## Functional-contract reconciliation

The following contracts remain intact:

- recipient-scoped query keys and invalidation;
- `listNotifications`, `markNotificationRead`, and `markAllNotificationsRead` request paths;
- `safeNotificationLink` navigation guard;
- mark-read before linked navigation;
- independent mark-read control for linked and unlinked unread items;
- translated canonical/historical kind handling;
- pagination and Load more control;
- Arabic locale keys and active direction handling.

An independent implementation review initially identified that a linked item could only be marked read by opening it. The final action cell restores a separate icon-only mark-read control and the targeted regression test verifies it does not navigate.

## Regression coverage

`src/test/notifications-inbox-enterprise-redesign.test.tsx` adds:

1. `NOTIF-INBOX-VIS-01` — wider bounded workspace;
2. `NOTIF-INBOX-VIS-02` — quiet header, unread summary, and bulk action;
3. `NOTIF-INBOX-VIS-03` — cohesive responsive toolbar;
4. `NOTIF-INBOX-VIS-04` — unified list and stable desktop grid;
5. `NOTIF-INBOX-VIS-05` — restrained unread treatment without the edge border;
6. `NOTIF-INBOX-VIS-06` — primary-content hierarchy without visible event badges;
7. `NOTIF-INBOX-VIS-07` — safe open and independent read actions without navigation side effects;
8. `NOTIF-INBOX-VIS-08` — grid-matched loading skeletons;
9. `NOTIF-INBOX-VIS-09` — truthful error, empty, and retry states;
10. `NOTIF-INBOX-VIS-10` — practical mobile context/time reflow;
11. `NOTIF-INBOX-VIS-11` — long mixed-direction content, RTL, and focus hooks;
12. `NOTIF-INBOX-VIS-12` — localisation, pagination, and frozen data contracts.

The existing visual-refinement and final-closure checks were reconciled to the intentionally updated inbox structure. Existing localisation and client-hardening coverage remains in place.

## Verification evidence

| Check | Result |
| --- | --- |
| Notification frontend suites | Passed — 46 tests across 5 files, including the twelve new inbox sentinels. |
| Related API notification suites | Passed — 45 tests across 4 files. |
| Frontend TypeScript | Passed — `pnpm typecheck`. |
| Frontend production build | Passed — `pnpm build`. |
| Workflow | `artifacts/cafa-pmis: web` restarted and serving successfully. |
| Browser smoke check | `/notifications` redirected to the Sign In page when unauthenticated; expected `401` requests only. |
| Independent review | Completed; the linked-item read-action finding was corrected and covered. |

The production build emits pre-existing source-map resolution and bundle-size warnings. Neither blocks the build nor is caused by this inbox change.

## Residual register

| Residual | Classification | Disposition |
| --- | --- | --- |
| Live authenticated visual inspection | Verification limitation | No credentials are available; rendered component coverage exercises populated, error, empty, RTL, action, and responsive structural states. |
| Optional time grouping | Not applied by design | Omitted to preserve the existing ordering and pagination model without adding presentation ambiguity. |

No open implementation or visual defects were found within this task’s scope.