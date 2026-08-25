# Notifications Visual Refinement — Phase 1

**Date:** 20 August 2026  
**Scope:** Notifications page, notification bell/popover, Notification
Preferences, and their loading, empty, error, responsive, RTL, and
accessibility presentation.

## 1. Scope

Phase 1 refines the existing Notification frontend into a compact enterprise
inbox and settings surface. It covers visual hierarchy, density, spacing,
read/unread treatment, long-content handling, responsive sizing, and accessible
interaction affordances.

It does not change backend routes, database data, migrations, generated clients,
notification delivery, recipients, event taxonomy, deduplication, realtime,
cache/session isolation, pagination behaviour, internal-link authorisation, or
preferences business rules.

## 2. Functional Baseline Preserved

The existing zero-residual Notification module remains unchanged:

- `NOTIF-001` delivery behaviour;
- `NOTIF-002` recipient eligibility and self-notification rules;
- `NOTIF-003` atomic event deduplication;
- `NOTIF-004` caller correctness;
- `NOTIF-005` canonical taxonomy/presentation mapping;
- `NOTIF-006` preference business rules and mandatory delivery overrides;
- `NOTIF-007` realtime/cache isolation;
- `NOTIF-008` server-side bounded pagination and stable ordering;
- `NOTIF-009` truthful error handling;
- `NOTIF-010` Arabic/localisation parity.

The notification page and bell retain their original request shapes, polling,
invalidation, safe internal-link guard, mark-read mutations, mark-all mutation,
filter semantics, server pagination, and locale-aware timestamps. Preferences
retain the same saved values, mandatory controls, validation, and unavailable
digest state.

Historical duplicate notification groups remain visible historical data; no UI
logic hides, deletes, or merges them.

## 3. Current-Head Visual Assessment

Before refinement, the functional surfaces were complete but read as several
independent alert-card treatments rather than one cohesive inbox:

- the Notifications and Preferences titles were larger/heavier than comparable
  enterprise surfaces;
- toolbar controls and list rows carried more padding and elevation than needed
  for frequent scanning;
- read/unread hierarchy was present but could better combine text emphasis,
  marker, and structural treatment;
- the bell preview used a wide fixed desktop surface;
- preference tabs and rows were correct but less compact than their settings
  purpose requires;
- daily/weekly digest options were disabled through opacity, which could look
  unavailable due to an error rather than intentionally deferred.

## 4. Notifications Page

- Reduced the page title to the established `text-2xl`, `font-semibold`,
  `tracking-tight` hierarchy.
- Kept the unread summary as compact metadata rather than an oversized KPI.
- Kept the page as one clear header → toolbar → inbox-list flow.
- Tightened ordinary spacing, toolbar padding, row padding, skeletons, empty
  states, and pagination control.
- Removed list-card elevation in favour of a restrained structural border and
  row separators.
- Avoided fabricating a “caught up” summary when the request has an error:
  loading uses a small summary skeleton and error uses the explicit error copy.

## 5. Notification Items

- Reworked items as compact inbox rows rather than standalone cards.
- Added a small muted icon container, primary readable message, subordinate kind
  and entity metadata, tertiary timestamp, and clear but restrained unread
  marker.
- Unread rows combine a subtle background, start border, message weight, and
  labelled indicator; read rows retain full readable contrast.
- Canonical translated kind and entity labels remain secondary. No raw enum
  values are exposed.
- Long messages use `min-w-0` and safe word wrapping. Metadata wraps naturally,
  avoiding page-level horizontal overflow for long English, Arabic, mixed
  direction, URL-like, and unbroken content.
- The existing safe navigation and mark-as-read actions are retained. Open-link
  action is focus-visible and immediately visible on smaller screens.

## 6. Filters / Pagination

- Retained All/Unread and server-backed module filtering semantics.
- Compact tabs retain a clear selected state and safe unread count presentation
  (`99+` in the visual summary).
- Search has a leading icon, visible focus treatment, and responsive width.
- Module filter and search become full-width as required on narrow layouts.
- Existing bounded Load more behaviour stays server-driven and is rendered as a
  compact integrated action.

## 7. Bell / Popover

- Refined the bell into a compact, focus-visible hit target.
- Kept a semantic, logical-end unread badge with a controlled `99+` display so
  large counts do not distort the application header.
- Suppresses unread count presentation when no reliable bell response exists,
  rather than fabricating zero on error.
- Reduced the popover to a viewport-safe width with constrained internal
  scrolling.
- Tightened popover header, recent rows, loading skeletons, and footer while
  preserving the hierarchy: title/count, mark all when meaningful, recent
  preview rows, View all.
- Loading, empty, and error branches remain distinct, with Retry retained.

## 8. Preferences

- Refined Notification Preferences into a denser settings surface with a compact
  breadcrumb, restrained title, smaller gaps, compact tabs, and neutral
  structural section cards.
- In-app and email preferences keep label/description/control alignment with
  concise separators.
- Delivery choices are grouped into a compact, bordered radio list.
- Mandatory settings remain disabled and visibly required; their existing
  business rules are unchanged.
- Quiet-hours values retain the same control semantics but stack safely on
  narrow screens.
- Daily and weekly digest options remain disabled and now carry a restrained
  localised “Coming soon” tag, preventing any claim that a scheduler exists.

## 9. Loading / Empty / Error

- Page and bell use row-shaped skeletons approximating final notification
  rows.
- A background refetch preserves existing query content rather than replacing
  it with a full-page skeleton.
- True empty, filtered-search empty, and explicit request-error states remain
  distinct.
- Error branches present concise translated copy plus Retry; they never
  masquerade as zero unread or an empty inbox.

## 10. Responsive

- Notifications page uses a wider but still readable enterprise max width.
- Toolbar controls wrap and become flexible/full-width below the small-screen
  breakpoint.
- List rows retain hierarchy and safe text wrapping at mobile widths.
- Bell popover uses a viewport-safe width and `100dvh`-aware maximum height.
- Preferences use responsive page padding, compact tabs, and a one-column
  quiet-hours layout on narrow screens.

## 11. Arabic / RTL

- Page and popover retain `dir={i18n.dir()}`.
- Existing logical start/end borders, spacing, and badge positioning remain in
  use; no physical left/right layout utility was added.
- View-all arrow remains RTL-aware.
- English and Arabic notification namespaces keep identical key structures,
  including the new localised “Coming soon” label.
- Persisted messages, names, entity labels, and free text remain verbatim.

## 12. Accessibility

- Bell trigger has a localised accessible name and visible focus ring.
- Large-count badge has an accessible unread label.
- Notification navigation and mark-read controls remain keyboard operable with
  visible focus treatment.
- Tabs, search, filters, Load more, Retry, preference switches, radio groups,
  and disabled digest controls retain their existing semantic controls.
- Unread state is communicated by a labelled marker and text weight/structure,
  not colour alone.
- No hover-only requirement was introduced; the page action remains available
  on mobile and is focus-revealed on larger screens.

## 13. Visual Sentinels

Added `src/test/notifications-visual-refinement.test.tsx`:

| Sentinel | Coverage |
|---|---|
| NOTIF-VIS-01 | Compact page title and hierarchy |
| NOTIF-VIS-02 | Cohesive scan-friendly inbox list |
| NOTIF-VIS-03 | Read/unread distinction without colour-only meaning |
| NOTIF-VIS-04 | Safe long-content wrapping |
| NOTIF-VIS-05 | Truthful loading, empty, and error branches |
| NOTIF-VIS-06 | Compact responsive filters |
| NOTIF-VIS-07 | Compact, clear bell/popover preview |
| NOTIF-VIS-08 | Safe large unread badge count |
| NOTIF-VIS-09 | Compact scannable preference rows |
| NOTIF-VIS-10 | Disabled digest controls with Coming soon treatment |
| NOTIF-VIS-11 | Arabic/RTL presentation hooks |
| NOTIF-VIS-12 | Preserved notification functional contracts |

Rendered tests cover the key visible controls and state indicators; narrow source
checks protect styling/state branches that are not reliably observable through
the DOM alone.

## 14. Regression

| Verification | Result |
|---|---:|
| Notification frontend suite | **22 passed / 22 total** |
| Notification API regression | **228 passed / 228 total** |

Frontend coverage:

- `src/test/notifications-visual-refinement.test.tsx`
- `src/test/notifications-i18n.test.tsx`
- `src/test/notifications-hardening.test.ts`

The API regression covered ten existing suites for notification links,
taxonomies, recipient deduplication, delivery, profile preferences, route
hardening, and caller-specific routing.

## 15. TypeScript / Build

- CAFA PMIS frontend TypeScript check: **passed**.
- CAFA PMIS frontend production build: **passed**.
- Phase 1 changed-file errors: **0**.
- Notification-owned frontend errors: **0**.

Existing build output contains unrelated sourcemap-location and chunk-size
warnings; the production build itself completed successfully.

## 16. Browser Verification

**AUTHENTICATED BROWSER VERIFICATION — ENVIRONMENT LIMITATION**

No safe authenticated non-production browser session was available. The
protected Notifications route redirects to Sign In correctly in the
unauthenticated environment; expected `401` responses are not treated as
application errors. No production credentials were used.

Automated rendered and visual-sentinel coverage provides the available
verification evidence. An authenticated desktop/tablet/mobile English/Arabic
visual pass remains an environment-only opportunity.

## 17. Residual Visual Findings

**NONE**

The authenticated-browser environment limitation above is not a known visual
defect. No Notification Phase 2 or final visual closure work was started.