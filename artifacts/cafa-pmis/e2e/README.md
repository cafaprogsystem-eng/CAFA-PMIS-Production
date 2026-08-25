# Offline browser acceptance suite

This suite uses a real Chromium browser and must point at a routed CAFA PMIS
environment where the web application and `/api` share the same origin. It
does not start Vite Preview itself because a standalone static server cannot
reproduce the artifact router that provides `/api`.

## Run

```sh
E2E_BASE_URL=https://<routed-preview-or-staging-url> \
E2E_USERNAME=<isolated-staff-user> \
E2E_PASSWORD=<password> \
E2E_CERTIFY_PRODUCTION=true \
pnpm test:offline-browser
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when the environment provides Chromium
through the system package manager rather than Playwright's managed browser.

## Certification preflight

The production certification flag is a mandatory release gate, not a test
filter. With `E2E_CERTIFY_PRODUCTION=true`, the Playwright configuration fails
before test discovery when `E2E_BASE_URL`, `E2E_USERNAME`, or `E2E_PASSWORD` is
missing. This prevents a run with skipped authentication tests from being
reported as a certification pass.

Running without those variables is useful only for checking that the suite is
discoverable: the current inventory is 18 tests across desktop and mobile
Chromium, and all authenticated tests will be skipped. A skipped run is not
certification evidence.

## Limited-scope attachment boundary

The project-document proxy denial check uses an isolated Technical Coordinator,
not a super-admin role switcher. It is strictly non-production:

```sh
E2E_ENABLE_NON_PRODUCTION_FIXTURES=true \
pnpm --filter @workspace/api-server run provision:limited-scope-attachment-fixture
```

The provisioning command requires `E2E_LIMITED_SCOPE_PASSWORD` as a secret and
refuses `NODE_ENV=production`. It creates only marked fixture records:

- `e2e.tc.attachment.boundary`, a Technical Coordinator restricted to the
  `WASH` sector with the `KRT` state assignment;
- `CAFA-E2E-ATTACHMENT-BOUNDARY`, a harmless Nutrition project in `KSL`, with
  an intentionally non-readable document object.

After committing the fixture transaction, the command atomically writes the
ignored non-secret descriptor
`e2e/.limited-scope-attachment-fixture.json`. The browser test accepts only
that descriptor when its fixture and parent markers match exactly; it never
accepts project/document IDs from environment variables. Then run:

```sh
E2E_BASE_URL=https://<routed-development-url> \
E2E_LIMITED_SCOPE_PASSWORD=<Replit Secret> \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<system-chromium> \
pnpm test:offline-browser --project=desktop-chromium \
  limited-scope-attachment-boundary.spec.ts
```

The test signs in in a fresh browser context and requests the parent
project-document proxy. It passes only when the WASH coordinator receives the
minimal `403 {"error":"sector_forbidden"}` response—without a redirect,
attachment headers, bytes, or reusable cloud-storage authority.

`E2E_CERTIFY_PRODUCTION=true` is deliberately explicit and fails fast if the
routed URL or isolated test credentials are missing. It enables worker and
full-network offline-reload assertions, including proof that the worker cache has
a built `/assets/*.js` application asset. A Vite development worker does not
precache the development module graph and cannot prove the application-shell
lifecycle.

## Evidence retained on failure

Playwright writes an HTML report, screenshots, and trace under
`test-results/offline-browser-report`. The suite is read-only: it signs in,
establishes an authenticated baseline, warms approved reads, checks browser
stores, simulates API and browser connectivity loss, exercises response
classification and confirmation-window expiry, and inspects the Arabic mobile
offline banner. Draft creation, replay exactly-once proof, attachment
reselection, multi-tab idempotency, permission removal, deleted parents,
session expiry, conflict-rebase, WebSocket-only loss, and browser restart
checks require explicitly seeded isolated fixtures or a supported browser
environment; they are release gates recorded in the readiness audit rather than
unsafe generic mutations against a shared environment.

## Sidebar visual regression suite

The sidebar suite uses the same Playwright/Chromium approach, but is a separate
project so its comparison policy and clean browser context cannot inherit
offline-readiness state. It exercises the real RBAC-filtered sidebar using an
isolated, non-production staff fixture. The selected fixture should be a
representative programme-management role with the approved navigation
permissions; it must not be a production account.

Required variables are intentionally fail-closed:

```sh
E2E_BASE_URL=https://<routed-non-production-url> \
E2E_LANDING_ALLOWED_HOSTS=<exact-routed-non-production-host> \
E2E_USERNAME=<isolated-staff-fixture> \
E2E_PASSWORD=<Replit Secret> \
E2E_VISUAL_SAFE_FIXTURE=true \
pnpm test:visual:sidebar
```

`E2E_BASE_URL` must be the routed web/API origin, not a standalone Vite server.
`E2E_VISUAL_SAFE_FIXTURE=true` is an explicit operator acknowledgement that the
account and URL are isolated from production. The suite never prints or stores
credentials. Each run creates a clean context, blocks service workers so stale
PWA assets cannot affect pixels, uses Chromium at UTC/en-US with device scale
factor 1, waits for the application fonts, and disables animation only in the
test harness.

### Approved baseline matrix

There are exactly eight version-controlled baselines in
`e2e/snapshots/sidebar/`:

- `sidebar-desktop-expanded-en.png`
- `sidebar-desktop-collapsed-en.png`
- `sidebar-reports-expanded-en.png`
- `sidebar-mobile-drawer-en.png`
- `sidebar-desktop-expanded-ar.png`
- `sidebar-desktop-collapsed-ar.png`
- `sidebar-reports-expanded-ar.png`
- `sidebar-mobile-drawer-ar.png`

The canonical viewport is 1440×900 for desktop and 390×844 for mobile.
Screenshots capture the real sidebar plus a deterministic 72px slice of its
adjacent shell, so anchoring, drawer boundaries, and clipping remain visible
without unrelated dashboard data; assertions cover document width, drawer
behaviour, route state, footer reachability, and RTL anchoring.
Comparison uses Chromium's screenshot matcher with threshold `0.2` and
`maxDiffPixelRatio: 0.005`: this tolerates minor anti-aliasing differences but
still fails meaningful spacing, width, missing-element, typography, and
alignment changes. On failure, Playwright retains the expected, actual, and
diff images under `test-results/sidebar-visual-artifacts` and the HTML report
under `test-results/sidebar-visual-report`.

### Intentional baseline updates

The normal command never updates snapshots. After an approved sidebar design
change, run the update command against the same routed fixture and canonical
Chromium environment:

```sh
E2E_BASE_URL=https://<routed-non-production-url> \
E2E_USERNAME=<isolated-staff-fixture> \
E2E_PASSWORD=<Replit Secret> \
E2E_VISUAL_SAFE_FIXTURE=true \
pnpm test:visual:sidebar:update
```

Review all eight changed images and the diff report, confirm the change is
intentional and contains no confidential fixture data, then commit the
baselines together with the test/configuration change. The configuration
rejects `--update-snapshots` unless the explicit update environment variable is
set, so CI and the normal command cannot silently regenerate approved images.
The repository's current GitHub workflow has no isolated routed fixture
secrets, so it is not wired as a falsely-green/skipped CI job; the command,
fail-closed configuration, and artifact paths are ready for the authoritative
frontend CI environment once those secrets are provisioned.

### Landing-page screenshot refresh

The landing page uses the four approved WebP captures in `src/assets/landing-*.webp`.
Their source routes, viewport, revision, and fixture confirmation are recorded in
`src/assets/landing-screenshots.provenance.json`. The committed baseline is a
real non-production capture set; the refresh command below captures the current
application through the normal sign-in flow and writes candidate files first:

```sh
E2E_BASE_URL=https://<routed-non-production-url> \
E2E_USERNAME=<isolated-staff-fixture> \
E2E_PASSWORD=<Replit Secret> \
E2E_VISUAL_SAFE_FIXTURE=true \
E2E_LANDING_SAFE_FIXTURE_CONFIRMATION=CAFA-PMIS-NONPROD-SYNTHETIC \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<system-chromium> \
pnpm capture:landing
```

For any remote host, `E2E_LANDING_ALLOWED_HOSTS` must include that exact
hostname. The workflow rejects all `.replit.app` deployment hosts, every
production-like hostname, and every unlisted routed host; only localhost is
implicitly allowed for development capture. Review all four candidate images for synthetic data, settled fonts, and the
intended sidebar state. Only then rerun with
`E2E_LANDING_ALLOW_REPLACEMENT=true -- --replace-approved-assets`. The script
rejects missing fixture acknowledgement, production hosts, incomplete
configuration, and replacement attempts without both explicit controls. It
never prints or stores credentials.