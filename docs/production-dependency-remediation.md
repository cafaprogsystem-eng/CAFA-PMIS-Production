# Production Dependency Remediation Evidence

**Scope:** Task 812 — CAFA PMIS production dependency graph  
**Date:** 2026-08-23  
**Verdict:** **CLOSED** — B2 is no longer a deployment blocker.

## Decision

The canonical command `pnpm audit --prod --json` now reports **0 Critical,
0 High, 2 Moderate, and 1 Low** findings. No audit ignore, exclusion,
exit-code suppression, or development-only reclassification was used. The
audit command still returns a non-zero status because the retained Moderate/Low
findings are reported normally; the severity counts are the release decision
for this blocker.

## Baseline: shipped Critical/High inventory

The baseline was reproduced against the pre-change lockfile in an isolated
read-only worktree. It reported **0 Critical, 8 High, 6 Moderate, and 1 Low**
production findings.

| Advisory | Installed package/version | Shipped owner and ancestry | Runtime reachability | Remediation |
| --- | --- | --- | --- | --- |
| GHSA-4r6h-8v6p-xvw6 | `xlsx@0.18.5` | Direct CAFA PMIS web dependency | Budget project and sector workbook downloads | Removed the unmaintained package; replaced write-only export with `write-excel-file@4.1.1`. |
| GHSA-5pgg-2g8v-p4x9 | `xlsx@0.18.5` | Direct CAFA PMIS web dependency | Budget project and sector workbook downloads | Same replacement; no workbook parsing/import capability was added. |
| GHSA-hmw2-7cc7-3qxx | `form-data@2.5.5` | API → `@google-cloud/storage@7.19.0` → `retry-request@7.0.2` → `@types/request` | Object-storage provider support | Upgraded supported owner to `@google-cloud/storage@8.0.1`, resolving away the legacy chain. |
| GHSA-72gw-mp4g-v24j | `multer@2.1.1` | Direct API dependency | Multipart attachment and training-video upload handling | Upgraded to compatible `multer@2.2.0`. |
| GHSA-p6gq-j5cr-w38f | `nodemailer@8.0.9` | Direct API dependency | SMTP email and configured provider delivery for invitation, reset, and verification emails | Upgraded to `nodemailer@9.0.5` (manifest floor `^9.0.1`). |
| GHSA-96hv-2xvq-fx4p | `ws@8.20.1` | API → `socket.io@4.8.3` → `engine.io`; also client/realtime peers | Authenticated Socket.IO polling and WebSocket transport | Parent-scoped override resolves `ws@8.21.0` while retaining the Socket.IO 4.x API. |
| GHSA-2m8v-j782-fhvr | `socket.io-parser@4.2.6` | API/client `socket.io@4.8.3` and `socket.io-client@4.8.3` | Realtime message encoding on polling/WebSocket connections | Parent-scoped override resolves `socket.io-parser@4.2.7`. |
| GHSA-mwp4-54f8-5fhr | `ip-address@10.2.0` | API → `express-rate-limit@8.5.2` | Production request-rate-limit handling | Parent-scoped override resolves `ip-address@10.3.1`. |

The two `xlsx` advisories count as two distinct High findings for the same
direct package. No baseline Critical finding existed.

## Compatibility evidence

- The package changes are limited to the affected storage, upload, mail, and
  spreadsheet owners. Socket.IO remains on its compatible `4.8.x` release;
  only the vulnerable nested packages are parent-scoped overrides.
- The regenerated `pnpm-lock.yaml` removes `xlsx@0.18.5`, legacy
  `form-data@2.5.5`, `ws@8.20.1`, `socket.io-parser@4.2.6`,
  `ip-address@10.2.0`, `multer@2.1.1`, and `nodemailer@8.0.9`. The remaining
  lockfile movement follows the supported Google Storage v8 dependency chain
  and the replacement writer; no broad package upgrade was performed.
- The budget export replacement is browser-compatible and write-only. Its
  pure workbook definitions preserve the existing project sheets
  (`Summary`, `State Allocations`, `Activities`, `Budget Variance`), sector
  sheets (`Sector Summary`, `Projects`), data values, null presentation,
  numeric rounding, column widths, and dated download filenames.
- Attachment policy and object-storage authorisation are unchanged. Existing
  transport tests cover accepted, rejected, oversized, malformed-name, and
  unauthorised upload descriptors; the cleanup sweep covers a provider
  failure followed by durable retry.
- Mailer tests cover stubbed invitation/reset/verification content and the
  SMTP transport's sent/pending result contract. Realtime tests exercise
  authenticated polling, WebSocket upgrades, foreign-origin rejection, and
  production fail-closed origin configuration.

## Validation evidence

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (pnpm 10.26.1) | Passed |
| Focused workbook, mailer, upload, cleanup, and realtime tests | Passed |
| `pnpm --filter @workspace/cafa-pmis test` | Passed — 135 files / 5,817 tests |
| `pnpm --filter @workspace/api-server test` | Passed — 128 files / 2,931 tests |
| Frontend and API typechecks | Passed |
| `pnpm --filter @workspace/cafa-pmis lint` | Passed |
| `pnpm --filter @workspace/api-server build` | Passed |
| `pnpm --filter @workspace/cafa-pmis build` | Passed |
| `pnpm run check:api-contract` | Passed |
| `git diff --check` | Passed |
| Final `pnpm audit --prod --json` | 0 Critical / 0 High / 2 Moderate / 1 Low |
| Restarted API/web health and public preview smoke | Passed — API `/api/healthz` returned 200 and the web preview returned 200 |
| Authenticated browser budget-export smoke | Unable in this workspace — no controlled E2E username/base URL was available; no guessed credentials or data changes were used. The workbook binary and export definitions are covered by focused tests. |

## Residual findings

These findings are retained because they are Moderate/Low and outside this
task's narrowly scoped Critical/High remediation:

| Severity | Advisory | Installed version and ancestry | Fixed version |
| --- | --- | --- | --- |
| Moderate | GHSA-w5hq-g745-h8pq | `uuid@9.0.1`: API → `@google-cloud/storage@8.0.1` → `gaxios` | `>=11.1.1` |
| Moderate | GHSA-q8mj-m7cp-5q26 | `qs@6.15.1`: API → `express` | `>=6.15.2` |
| Low | GHSA-v422-hmwv-36x6 | `body-parser@2.2.2`: API → `express` | `>=2.3.0` |

## Next recommendation

**B3 only:** establish the canonical AWS storage configuration contract and
prove it in isolated staging, including authorised upload, promotion,
parent-authorised download, unavailable-object handling, cleanup, and
deletion. This is separate from B2 and should not reopen the dependency
remediation decision.