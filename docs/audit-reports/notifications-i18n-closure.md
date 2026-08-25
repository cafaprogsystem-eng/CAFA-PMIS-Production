# Notifications Arabic Localisation Closure

**Closure date:** 19 August 2026  
**Scope:** Task 642 — complete English/Arabic presentation parity for the Notification
Centre (page, bell, preferences) without modifying any delivery, recipient,
taxonomy, API, pagination, or preference-business-rules contract already closed in
the previous audit.

## What was done

### New files

| File | Purpose |
| --- | --- |
| `artifacts/cafa-pmis/src/lib/notification-presentation.ts` | Shared, pure presentation helpers: `canonicalNotificationKind` (applies legacy-alias mapping), `notificationKindTranslationKey` (maps canonical or aliased kind → `types.*` i18n key, with `types.unknown` for future/unknown values), `entityTypeTranslationKey` (entity type → `entityTypes.*`, with unknown fallback), `formatNotificationTime` (locale-aware `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` with `justNow` sentinel and invalid-date guard). |
| `artifacts/cafa-pmis/src/test/notifications-i18n.test.tsx` | NOTIF-I18N sentinel suite — 6 tests covering namespace structural parity, alias/unknown kind mapping with Arabic resolution, rendered Arabic page/bell/preferences, preserved persisted messages, disabled daily/weekly digest controls, and locale timestamp formatting. |

### Modified files

| File | Change summary |
| --- | --- |
| `artifacts/cafa-pmis/src/locales/en/notifications.json` | Added all missing keys: `types.*` for every canonical kind + `types.unknown`; `entityTypes.*` for every entity type + `entityTypes.unknown`; `time.justNow` / `time.unknown`; `moduleOptions.*` for the page filter; `preferences.inApp.*` / `preferences.email.*` item labels and descriptions; `timezones.*` for quiet-hours timezone select; `errorLoading` / `retry`; `unreadAriaLabel` / `openNotificationAriaLabel`. English key set is now the sole source of truth. |
| `artifacts/cafa-pmis/src/locales/ar/notifications.json` | Populated from empty `{}` to full structural mirror of the English file: all 100+ keys translated using the CAFA Arabic glossary and project-consistent terminology. |
| `artifacts/cafa-pmis/src/pages/notifications.tsx` | Replaced hard-coded English strings (`"just now"`, `"All Modules"`, `"Notifications could not be loaded."`, `"Retry"`, `aria-label="Unread"`, `aria-label="Open notification"`, `MODULE_OPTIONS`/`MODULE_LABEL` static arrays) with `t()` calls; switched `ago()` to `formatNotificationTime`; switched entity-type badge to `t(entityTypeTranslationKey(...))`; switched kind display (search) to `notificationKindTranslationKey`; logical CSS (`border-s-*` instead of `border-l-*`). |
| `artifacts/cafa-pmis/src/components/notifications-bell.tsx` | Moved from `nav` + `common` namespaces to `notifications`; removed hard-coded English error/retry text; added `dir={i18n.dir()}` to `PopoverContent`; replaced `ago()` with locale-aware `formatNotificationTime`; entity-type badge uses `entityTypeTranslationKey`; kind badge uses `notificationKindTranslationKey`. |
| `artifacts/cafa-pmis/src/pages/notification-preferences.tsx` | Converted `INAPP_ITEMS` and `EMAIL_ITEMS` static English arrays to i18n keys (`preferences.inApp.*`, `preferences.email.*`); `TIMEZONES` entries use `labelKey` instead of a hard-coded English label; `space-x-*` / `ml-*` replaced with `gap-*` / `ms-*` (logical); daily and weekly `RadioGroupItem` controls rendered disabled and visible (`opacity-60`, `cursor-not-allowed`) so the "coming soon" intent is clear in both languages; wrapper `div` gets `dir={i18n.dir()}` from the hook. |
| `artifacts/cafa-pmis/src/test/notifications-hardening.test.ts` | `NOTIF-ERROR-01` updated to assert `t("errorLoading")` / `t("retry")` calls rather than the old hard-coded English strings, preserving the intent of the test while reflecting the localised source. |

## What was not changed by this task

- No notification API server file was modified (all delivery, recipient
  eligibility, dedupe, event-key, pagination, and preference-business-rules
  code is unchanged).
- Persisted `message` and `entityName` values are displayed as stored — only
  system-interface text is translated.
- Historical notification rows were not rewritten.
- The `NOTIFICATION_KIND_REGISTRY`, `LEGACY_NOTIFICATION_KIND_ALIASES`, and
  `presentNotificationKind` server contracts are unchanged.
- `digest` shape remains `"immediate"` — daily/weekly are displayed disabled,
  never persisted.

> **Note on diff scope:** The git diff visible to reviewers at the time of this
> task's completion includes Communication Centre changes from the immediately
> preceding commit (Task 641, already merged). Those changes are entirely outside
> this task's scope and were not authored here. The only files modified by this
> task are the seven listed under "Modified files" and the two new files above.

## Regression evidence

| Validation | Result |
| --- | --- |
| Web TypeScript check (`pnpm --filter @workspace/cafa-pmis typecheck`) | **Passed** (0 errors) |
| Frontend notification hardening suite (4 tests, `notifications-hardening.test.ts`) | **4 passed** |
| Frontend notification i18n sentinel suite (6 tests, `notifications-i18n.test.tsx`) | **6 passed** |
| API notification suites — caller-taxonomy, delivery, recipient-dedupe, link-safety, route-hardening, preferences (6 files) | **183 passed** |
| Production build (`pnpm --filter @workspace/cafa-pmis build`) | **Passed** — `notifications-BcxRChL3.js` and `notification-preferences-DDRllMW7.js` emitted |

## Structural parity evidence

`NOTIF-I18N-01` asserts that `flattenKeys(ar).sort()` equals `flattenKeys(en).sort()`
for the `notifications` namespace — i.e. the Arabic file has exactly the same
dot-notation key set as the English file, no more and no less. This test passes.

## Kind presentation safety

Unknown future kinds (e.g. `"future_internal_kind"`) resolve to `types.unknown`
→ "Notification" (EN) / "إشعار" (AR). Historical `technically_approved` resolves
through the alias table to `types.technically_reviewed` → "تمت المراجعة الفنية" (AR).
Raw internal values never reach the UI.

## Residuals

None. All notification-owned system text is now translated. Persisted message
text and user-generated entity names remain untranslated by design.
