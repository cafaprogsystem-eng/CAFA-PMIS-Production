# Tracked schema reconciliation

## Method

The release baseline is created in a disposable PostgreSQL database by the
compiled tracked migration command (`dist/migrate.mjs`), starting with an empty
database. The resulting PostgreSQL catalog is compared with:

1. the ordered `MIGRATIONS` manifest and its recorded checksums;
2. direct runtime read/write SQL and its regression tests;
3. the maintained Drizzle reference where it describes an active contract; and
4. the historical development database, read only as evidence for bounded
   backfills.

The disposable test starts two migration commands concurrently, verifies every
history checksum, validates the plan-column contracts, and runs the command
again as a no-op.

## Accepted drift and forward migrations

| Item | Evidence and decision | Historical handling |
| --- | --- | --- |
| `plans.budget_legacy_unverified` | Active list/read contract. It is a non-null boolean with default `false`. | Migration 057 flags only IDs `10,11,14,15,16,17,18,19,20,22,24,57,58,59,60,61,62`, and only where the stored values are exactly `0` and `USD`. It never alters budget or currency. |
| `plans.last_final_approved_at` | Active write, read, attachment-authorisation, and edit-lock contract. A Plan is editable after final approval only when an explicit reopen follows this timestamp. | Migration 058 adds a nullable timestamp and backfills only `MAX(approvals.timestamp)` for `entity_type='plan'`, `action='final_approve'`, and `to_status='approved'`. Status and `updated_at` are never used as evidence; rows without a matching approval remain null. |

## Rejected differences

| Difference | Reason it is not migrated |
| --- | --- |
| `archive_items` | It is a query-local CTE in the unified file archive, not a relation. |
| Translation-review fields on canonical `manual_sections`, canonical `manual_sops`, and `outputs` | No active runtime SQL reads or writes these source-table fields. The active review lifecycle belongs to the localisation tables created in migrations 053–054. Adding unused columns or inventing a backfill would preserve stale declarative drift rather than a production requirement. |
| Historical-only tables and metadata present in the tracked manifest but absent from the Drizzle source model | They are explicit migration-owned evidence, reconciliation, or runner metadata. They already bootstrap cleanly and are not missing runtime relations. |

The final stable-sort column comparison found 15 declared-but-absent columns:
the five inactive editorial fields (`translation_status`, `source_checksum`,
`source_updated_at`, `reviewed_at`, and `reviewed_by_id`) on each of canonical
manual sections, canonical SOPs, and outputs. They are all covered by the
second rejection above. It also found 154 clean-bootstrap columns outside the
intentionally partial Drizzle mapping; they are migration-owned catalog,
historical-evidence, or direct-SQL runtime data, not missing clean-schema
contracts. No runtime-required declared column is absent from the clean result.

## Validation outcomes

| Gate | Outcome |
| --- | --- |
| Disposable clean bootstrap, concurrent runner, checksum history, Plan backfills, and no-op rerun | Passed (64 migrations) |
| API tests | Passed — ordinary suite: 144 files and 3,068 tests, with the two compiled-migration checks intentionally skipped until the post-build gate |
| Post-build disposable PostgreSQL migration gate | Passed — 5 focused checks, including clean bootstrap, concurrent execution, checksums, no-op rerun, bounded backfills, and reference parity |
| PWA tests | Passed — 141 files, 5,861 tests |
| Workspace typecheck | Passed |
| PWA lint | Passed with zero warnings |
| Generated API contract check | Passed; two generation passes were stable |
| Production API build | Passed |
| Production PWA build | Passed; existing sourcemap/chunk-size warnings did not fail the build |
| Production dependency audit | No high or critical findings; 1 low and 2 moderate findings remain advisory. `pnpm audit` exits non-zero whenever it reports any finding. |
| Whitespace check | Passed |
| Release-readiness preflight | Blocked locally only because the working tree is intentionally uncommitted. The script's AWS/staging checks are explicitly deferred and were not attempted. |
| Restarted API and PWA workflows | Passed; the API applied migration 058 and started normally |

## Closure

The reconciled runtime schema has **zero remaining confirmed missing
relations/columns** after migration 058. Rejected entries are deliberate
non-schema requirements, not outstanding migrations. The classification is
**closed** for tracked-schema reconciliation; release handoff still requires a
clean committed working tree.