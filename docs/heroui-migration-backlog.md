# HeroUI migration — deferred items

Items found while moving the frontend (`artifacts/cafa-pmis`) onto HeroUI v3 and
HeroUI Pro that are deliberately out of the per-screen batches. Each is to be
picked up as its own piece of work.

## App-wide translation of data values

Some values reach the Arabic UI in English because they come from data, not from
the frontend's translation files. They appear across the whole app, so they are
to be handled together as a separate translation project rather than screen by
screen.

| Value | Where it comes from | Seen on |
| --- | --- | --- |
| Sector names (e.g. "WASH", "Food Security & Livelihoods") | Canonical sector list (`lib/sectors.ts`, API `VALID_SECTOR_SET`) | Projects registry, project details, dashboard, budgets, reports |
| Assistance modality (e.g. "In-Kind", "Cash") | `ASSISTANCE_MODALITIES` in the API and frontend | Project details, registration form |
| State names on activity records | Project detail API returns `stateName` without an Arabic name for activities | Project details → Activities |
| User role labels (e.g. "Programme Manager") | API-supplied role label strings | Project details → Approval history, assignments |
| Donor data-issue reasons beyond the four known codes | API `dataIssues` | Dashboard → Donor portfolio (known codes are translated) |

Frontend-owned strings and codes (statuses, workflow actions, document kinds,
risk values, report types, and so on) are translated within each migration
batch; only data-sourced values like those above are deferred.

## Other deferred items

- **Tooltips:** still on the shadcn Tooltip across most of the app; to be moved
  to the HeroUI Tooltip in one pass rather than per screen. A Radix tooltip
  wrapped around a HeroUI button opens on hover but not on keyboard focus, so
  migrated screens whose tooltip trigger is a HeroUI button (project
  registration form, project details documents and blocked workflow actions)
  already use the HeroUI Tooltip; other screens should do the same as their
  buttons move to HeroUI.
- **Arabic plural forms:** about 37 keys fall back to the `_other` form in
  Arabic; they could each get exact zero/one/two/few/many forms.
- **Unused pages:** `password-resets.tsx` and `planning-dashboard.tsx` are not
  routed; a decision on removing them is pending.
- **CI/Docker:** installing `@heroui-pro/react` needs `HEROUI_AUTH_TOKEN` in the
  CI and Docker build environments.
- **Start-up bundle:** the `@heroui/react` barrel keeps components imported
  through it in the start-up vendor chunk; a lazily-loaded screen that needs to
  keep a heavy HeroUI component out of it would need a different import route.
- **API-sourced English text:** budget alert messages (`GET /projects/:id/budget`
  → `alerts[].message`) arrive as English sentences; the Budgets page
  translates the alert level only. Translating the message needs the API to
  send a code plus parameters (like the validation errors do). Same family as
  the sector, modality and other data-sourced values already deferred.
- **Header popovers:** the Communication Centre and notifications popovers in
  the top bar (`messages-dropdown.tsx`, `notifications-bell.tsx`) still use the
  Radix Popover and shadcn Badge. They sit side by side, so they should move to
  the HeroUI Popover together rather than one per screen batch.
- **Messages stored with an English body:** voice and attachment-only messages
  are saved with the literal body "(Voice message)" or "(attachment)". The
  Communication Centre translates these for display, but other consumers
  (notifications, search, exports) may still show it; storing an empty body
  plus a type would remove it at the source.
