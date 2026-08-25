# Landing Page Screenshot Handoff

## Approved capture inventory

The public landing page uses four optimised WebP captures from the real CAFA
PMIS interface. The assets, source routes, capture revision, date, viewport,
and non-production fixture confirmation are recorded in
`src/assets/landing-screenshots.provenance.json`.

| Asset | Demonstrates | Routed source |
| --- | --- | --- |
| `landing-dashboard.webp` | Strategic dashboard overview | `/dashboard` |
| `landing-projects.webp` | Projects workspace | `/projects` |
| `landing-plans.webp` | Plans workspace | `/plans` |
| `landing-ai.webp` | AI assistant workspace | `/ai` |

The approved baseline was captured on 2026-08-24 from revision
`9fb2589b4e71ae0082edeaa3940ed2b6e8612946`, through the repository's opt-in
non-production Programme Manager fixture. It contains synthetic fixture data
only and no credentials.

## Quality and delivery weight

- Each asset is a non-distorting WebP capture with a consistent 16:9 landing
  frame, `object-contain`, a reserved aspect-ratio canvas, and meaningful alt
  text.
- The first image is eager/high-priority; the other three are lazy-loaded.
- Each source is captured at a deterministic **1440×810@2x** and delivered at
  **2880×1620**, which is recorded and validated in provenance.
- The four delivered assets total **574,736 bytes** (about 561 KiB), down from
  **3,223,972 bytes** (about 3.07 MiB) for the four former PNG sources.
- The fabricated SVG product mock-ups and unreferenced PNG alternatives were
  removed; no product-mock-up import remains.

## Refresh procedure and safety

Run `pnpm capture:landing` only with the isolated fixture environment variables
documented in `e2e/README.md`. The command:

1. requires the normal sign-in flow, an explicit synthetic-fixture
   acknowledgement, and an exact `E2E_LANDING_ALLOWED_HOSTS` entry for any
   remote non-production host;
2. rejects production hosts and incomplete configuration before opening a
   browser;
3. rejects `.replit.app` deployment hosts, production-like names, and all
   unlisted routed hosts before opening a browser; then writes candidate
   captures outside the approved asset directory by default;
4. replaces approved assets only when both
   `--replace-approved-assets` and `E2E_LANDING_ALLOW_REPLACEMENT=true` are
   supplied; and
5. rewrites provenance with the route, deterministic 1440×810@2x viewport,
   source revision, date, and fixture confirmation.

## Validation evidence

- Focused landing content, image inventory, accessibility, and responsive-frame
  tests pass (47 assertions).
- The landing source, focused tests, and capture script typecheck; focused lint
  passes.
- Production Vite build passes and emits all four WebP assets.
- Real-browser checks found no horizontal overflow at 1440×900, 1024×768,
  768×1024, or 390×844 in English LTR or Arabic RTL. Keyboard focus reaches the
  skip link, and the mobile navigation opens normally.
- The full frontend suite passes: 135 files and 5,822 tests.