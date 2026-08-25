# Notifications API, Preferences & List Closure

**Closure date:** 19 August 2026  
**Scope:** Current-head notification hardening for NOTIF-006, NOTIF-007,
NOTIF-008, and NOTIF-009.  
**Out of scope retained:** Communication Centre work, visual redesign, Arabic
translation, historical-row rewrites, and digest scheduling.

## Final finding status

| Finding | Status | Closure evidence |
| --- | --- | --- |
| NOTIF-006 — preference validation | **CLOSED** | The profile API accepts only strict canonical preference keys and values. Unsupported keys, malformed category values, invalid `HH:MM` quiet-hour values/timezones, and unavailable `daily`/`weekly` digests return 422. Historic malformed or unavailable settings remain stored but are canonicalised to safe defaults at the profile response boundary. |
| NOTIF-007 — realtime page freshness | **CLOSED** | Bell and notification page queries share a recipient-keyed `notifications` prefix. A `notification:new` event invalidates that prefix for the authenticated recipient, refreshing both immediately. |
| NOTIF-008 — list reliability | **CLOSED** | The private list validates boolean/module/limit/offset input, bounds `limit` to 1–200 and `offset` to 0–10,000, orders by `created_at DESC, id DESC`, and returns the documented `{ items, unread, pagination }` envelope. Direct read mutation validates IDs and updates only `id + user_id`. |
| NOTIF-009 — truthful fetch failures | **CLOSED** | Generated client calls throw on non-success responses. Bell and page render a visible retry state instead of converting failures to an empty inbox; cached unread data remains available through TanStack Query while a refetch has failed. |

## Additional hardening delivered

- New notification links are restricted to recognised internal CAFA PMIS routes
  before persistence. Historical links are not rewritten, but unsafe stored
  values are returned as `null` and are defensively checked again by the web
  client before navigation.
- Notification cache keys include the authenticated recipient. Logout removes
  notification state, while development role switching clears it and remounts
  the authenticated socket connection. Production socket identity continues to
  derive from the signed session cookie.
- The OpenAPI contract now documents list pagination, direct read/read-all
  mutations, canonical preference settings, and the profile validation response.
  API client and Zod outputs were regenerated from that contract.

## Regression evidence

| Validation | Result |
| --- | --- |
| Focused API notification routes, preference, link, delivery, recipient/dedupe, and caller-taxonomy suites | **182 tests passed across 6 files** |
| Frontend notification cache/link/error sentinels | **4 tests passed** |
| API build | **Passed** |
| Web build | **Passed** |
| Web TypeScript check | **Passed** |
| API TypeScript check | Existing failures remain only in object storage, communication-upload transport test typing, and plans aggregate integration test typing; no notification-hardening diagnostics remain. |
| Managed API and web workflow restart | **Passed**; API started with Socket.IO initialised and web Vite server ready. |
| Browser smoke | Protected `/notifications` redirected safely to a functioning login page without a crash. Authenticated browser interaction was unavailable because no test session was supplied. |

No historical notification or preference rows were rewritten or deleted.