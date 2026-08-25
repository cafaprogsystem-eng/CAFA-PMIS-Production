# Arabic Localisation Audit

**Audited:** 2026-08-22  
**Scope:** `artifacts/cafa-pmis/src/locales/{en,ar}` and UI source in
`artifacts/cafa-pmis/src/{pages,components}`  
**Purpose:** Record the current production-readiness verification for Arabic
resources, RTL layout, and visible-string regressions.

## Automated Quality Gates

| Gate | Location | What it protects |
|---|---|---|
| Key parity | `src/test/i18n-parity.test.ts` | Zero missing, orphan, empty, raw-key, or unexplained Latin Arabic-resource values in all 17 namespaces. |
| Glossary consistency | `src/test/i18n-glossary.test.ts` | Canonical terms, role labels, status labels, and structural validity across all namespaces. |
| Raw-string audit | `src/test/audit-hardcoded-strings.test.ts` | New user-facing English JSX, placeholders, ARIA labels, table headers, titles, and toasts. |

## Verification record

| Check | Outcome |
|---|---|
| Locale JSON parse and structural scan | 34 resources parsed; 17 English/Arabic namespace pairs have 0 missing keys, 0 orphan keys, and 0 empty Arabic values. |
| Localisation, glossary, RTL, raw-string, calendar, SPR accessibility, and User Management API-error tests | All focused localisation checks passed, including 117 assertions across the parity, RTL, and raw-string gates and 11 User Management error-localisation assertions. |
| Full frontend suite | `pnpm --filter @workspace/cafa-pmis test -- --run --reporter=dot` passed: 128 files, 5,778 tests. |
| Repository typecheck | `pnpm typecheck` passed across shared libraries, API server, CAFA PMIS, mockup sandbox, and scripts. |
| Production build | `pnpm --filter @workspace/cafa-pmis build` passed. Vite reported only existing source-map, dynamic-import, and chunk-size warnings. |
| Desktop and narrow mobile preview | Landing page rendered correctly at 1440×900 and 390×844 after a workflow restart. |
| Authenticated Arabic route walkthrough | Deferred to the existing staff-workflow verification task because no staff-only browser-test session is available; unauthenticated API probes correctly returned 401. |

The raw-string diagnostic is a blocking zero-finding gate. It records no
unexplained user-facing English candidates across the scanned production
surfaces.

The parity test is a **blocking production gate**. It requires exact
English/Arabic structure and non-empty Arabic values; it does not permit
English fallback resources as a translation completion mechanism.

## Namespace Key Parity Baseline

Counts represent recursively flattened string leaves. “Gap” means an English
key with no Arabic counterpart. Empty values are Arabic string leaves that are
empty or whitespace-only.

| Namespace | EN keys | AR keys | Gap | Empty values |
|---|---:|---:|---:|---:|
| ai | 116 | 116 | 0 | 0 |
| auth | 191 | 191 | 0 | 0 |
| budget | 198 | 198 | 0 | 0 |
| common | 491 | 491 | 0 | 0 |
| dashboard | 639 | 639 | 0 | 0 |
| errors | 35 | 35 | 0 | 0 |
| knowledge | 839 | 839 | 0 | 0 |
| landing | 168 | 168 | 0 | 0 |
| messages | 212 | 212 | 0 | 0 |
| nav | 101 | 101 | 0 | 0 |
| notifications | 190 | 190 | 0 | 0 |
| planning | 611 | 611 | 0 | 0 |
| projects | 475 | 475 | 0 | 0 |
| reports | 1059 | 1059 | 0 | 0 |
| risks | 183 | 183 | 0 | 0 |
| settings | 212 | 212 | 0 | 0 |
| users | 386 | 386 | 0 | 0 |
| **Total** | **6,106** | **6,106** | **0** | **0** |

The parity test includes all 17 production namespaces. It intentionally does
not accept an empty object or an English fallback as completed translation.
There are currently **0 present untranslated values** after the technical
allowlist excludes the compact `+{{count}}` count badge and `⌘K` keyboard
shortcut notation; any other non-Arabic Arabic-locale value fails the gate.

## Intentional Non-Translated Categories

The following values may remain Latin or otherwise retain their stored form.
They are explicitly documented in the parity test’s code-reviewed allowlist;
they must not be used to suppress ordinary UI copy.

| Category | Examples | Reason |
|---|---|---|
| Product and technical identifiers | `CAFA PMIS`, `CAFA`, `AI`, `API`, `URL`, `PDF`, `CSV`, `JSON`, `HTML`, `PWA`, `SMS`, `SOP`, `ID` | Names and technical acronyms are identifiers, not UI prose. |
| ISO currency codes | `USD`, `EUR`, `SDG`, `GBP`, `SAR` | Preserve ISO codes for financial clarity and data integrity. |
| Email examples and addresses | `your.name@cafa-sd.org` | Email syntax must remain LTR and unchanged. |
| Phone-number examples | `+249 9x xxx xxxx` | Format token, not translatable copy. |
| Stored user or operational data | Project/plan titles, donor/person names, uploaded file names, activity descriptions, user-composed messages | Display exactly as authored or stored. |
| Record and system codes | Project/plan codes, UUIDs, URLs, database identifiers | Must retain source value; use LTR isolation in Arabic UI where appropriate. |
| Required-field marker | `*` | Visual validation symbol, not a translation. |
| Keyboard shortcuts and count badges | `⌘K`, `+{{count}}` | Interaction notation and numeric display tokens, not UI prose. |

## Hard-Coded English String Audit

The scanner covers 138 `.ts`/`.tsx` files in `pages/` and `components/`. It
excludes test fixtures, generated code, comments, imports/exports, development
logs, technical identifiers, and strings already passed through `t(...)`.

### Current diagnostic findings

| Category | Suspected user-facing raw English strings |
|---|---:|
| `placeholder=` | 0 |
| `aria-label=` | 0 |
| `toast(...)` | 0 |
| JSX text nodes | 0 |
| `title=` attributes | 0 |
| Column `header:` values | 0 |
| **Total** | **0** |

The audit test prints this summary in every Vitest run. The exact reviewed
fingerprint is the empty source-file/category/value set (`0` findings;
SHA-256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`).
Any detected candidate fails CI. The baseline must never be changed merely to
accept new hard-coded English UI copy.

There are no current audit findings. The prior migration examples and
per-file counts have been retired rather than retained as a permitted
baseline. Any new detected candidate fails CI and must be fixed or recorded
as a narrowly justified technical/value exception.

## Glossary Contract

`src/locales/CAFA_ARABIC_GLOSSARY.md` is the authoritative terminology source.
It includes canonical product, action, workflow-status, financial, role, view
mode, and filter terminology. The glossary test checks:

- exact canonical values for common terms and navigation labels;
- Arabic structural validity for all 17 namespaces;
- canonical roles in `users`;
- equivalent literal status labels in planning, projects, reports, risks,
  dashboard, and budget where those keys exist;
- prevention of raw i18next key values.

Contextual sentences and gendered record-specific statuses are intentionally
not compared as generic status labels. For example, a notification sentence
such as “approved” may use a grammatically appropriate verbal phrase, while a
status badge must use the canonical noun/adjective label.

## Closure boundary

All locale-resource, runtime-copy, RTL, rendered-component, typecheck, full
test-suite, and production-build gates covered by this remediation pass. The
only outstanding evidence is an authenticated Arabic staff browser walkthrough,
which is deliberately tracked separately because this environment has no
authenticated staff browser session. That limitation does not relax any
automated localisation gate and must not be presented as completed browser
evidence.

Use the following checks for future localisation changes:

```bash
pnpm --filter @workspace/cafa-pmis exec vitest run src/test/i18n-parity.test.ts
pnpm --filter @workspace/cafa-pmis exec vitest run src/test/i18n-glossary.test.ts
pnpm --filter @workspace/cafa-pmis exec vitest run src/test/audit-hardcoded-strings.test.ts
```

Then refresh this table, lower applicable raw-string baseline counts, and retain
only justified Latin-only values in the parity allowlist.