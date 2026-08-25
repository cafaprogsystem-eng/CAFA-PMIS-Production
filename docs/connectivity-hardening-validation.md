# Connectivity hardening validation

## Final runtime hardening record — 24 August 2026

### Root cause and resolution

Normal navigation could briefly display **Checking** because any ordinary
route-level transport error directly changed the global connectivity state
before the independent health probe had confirmed anything. A single 5xx could
also display **Degraded**, despite being insufficient evidence that the CAFA
service as a whole was unavailable.

The canonical reducer now preserves the displayed global state for isolated
route transport failures. Such failures only request a same-origin health
confirmation. A Degraded state requires two 5xx service-failure observations
within the five-second confirmation window; the initial API 5xx causes a health
probe and the second observation confirms the state. This leaves the approved
Offline model unchanged: only two same-origin health-probe *transport* failures
within the same window may enter Offline.

401, 403, validation errors, cancellations, browser events, and socket
reconnects cannot create a false global Offline or Degraded banner. Public
health success continues to preserve known authentication/access outcomes; only
successful authenticated API traffic clears them.

### Final runtime copy and gates

- The generic Degraded banner is intentionally neutral: **“The CAFA service is
  temporarily unavailable. Please try again shortly.”** The Arabic equivalent
  is localised in `common.sync.serviceUnavailable`. Neither version makes a
  claim about whether a user’s work was saved.
- A report operation that has actually persisted its durable local draft and
  queue entry now says: **“Draft saved on this device and queued to sync when a
  trusted connection returns.”** Failed saves retain their operation-specific
  error; the global banner does not imply local persistence.
- The role-switch harness requires `CAFA_DEMO_MODE=true` and a
  non-production environment. Production forces it off even if the variable is
  misconfigured. When disabled, the client does not send `X-User-Id`, the
  server ignores it, and `/api/users/switcher` returns 404 instead of exposing
  fixture identities.
- Global Search and the related command hints use matched English/Arabic
  `common.globalSearch` and `common.keys` resources. The Arabic keyboard terms
  are localised and remain compatible with RTL layout.

## Validation evidence

| Check | Result |
| --- | --- |
| Focused connectivity, save-message, and locale Vitest tests | Passed — 66 tests |
| Full API server Vitest suite | Passed — 2,975 tests; 1 expected skip |
| API contract generation | Passed — generated React client and Zod artefacts refreshed |
| Workspace TypeScript typecheck | Passed |
| CAFA PMIS lint (`--max-warnings=0`) | Passed |
| CAFA PMIS production PWA build | Passed — Workbox 86 precache entries |
| Diff whitespace check | Passed |
| Isolated offline-readiness Playwright file | **Blocked** — 20 scenarios skipped because `E2E_BASE_URL` and `E2E_USERNAME` are not available |

The broad offline Playwright command also collected unrelated sidebar visual
specifications from the shared `e2e` directory. Those snapshot tests failed
before an authenticated flow because their independent visual-test setup was
not provided; they are not evidence about this connectivity change. The
targeted `offline-readiness.spec.ts` invocation above is the relevant result.

### Authenticated browser certification block

No routed CAFA URL and no isolated staff username are available in this
environment. Consequently, no authenticated Dashboard, Projects, Plans,
Reports, User Management, Arabic-search, service-worker, or offline-recovery
browser success is claimed. To certify those flows, run the existing routed
suite with an isolated account and:

```text
E2E_BASE_URL=<routed staging or production URL>
E2E_USERNAME=<isolated staff account>
E2E_PASSWORD=<secret>
```

Set `E2E_CERTIFY_PRODUCTION=true` only for the production PWA certification
run. No credential values, URLs, screenshots, or invented browser evidence are
recorded here.

## Verdict

**Partially Closed.** The runtime changes, generated contract, focused tests,
full API suite, typechecks, lint, production build, and whitespace validation
are complete. Authenticated routed-browser acceptance remains an explicitly
recorded environmental block.