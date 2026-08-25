# States Administration — Functional & Visual Closure

## Scope and registry contract

The State Administration area is a master-data registry, not an operational
dashboard. The canonical State record remains its stable numeric `id`, `name`,
`code`, optional `office_address`, and optional `manager_user_id`. The registry
displays the manager name as read-only reference information; it does not
create, assign, invite, edit, or otherwise manage users.

The supported State administration actions are:

| Action | Authorised roles | Notes |
| --- | --- | --- |
| Browse registry and State reference detail | Every authenticated staff member | Existing authenticated State read access is retained. |
| Create a State | Super Admin, Executive Director, Programme Manager | Server-authoritative local State registry matrix. |
| Edit name, code, office address | Super Admin, Executive Director, Programme Manager | The numeric State ID is unchanged. |

There is intentionally no State status, activation, archive, restore, delete,
or permanent-delete route or UI action. This preserves the existing ID-based
relationships rather than inventing a lifecycle absent from the underlying
record.

## Identity and historical-data preflight

Migration `034_state_registry_identity` was applied on 20 August 2026. Its
read-only preflight checks:

- normalised name and code duplicate groups;
- orphaned references from users, localities, project links and allocations,
  activities, beneficiaries, risks, plans, plan activities, reports,
  conversations, and manager references;
- unmatched legacy `plan_activities.state_name` values where no State ID exists.

The migration startup log contained no State preflight warning, which means no
findings were reported by those checks in the development database at runtime.
No reconciliation register is required for this closure. The migration never
merges, renames, deletes, or otherwise repairs historical data automatically.

For future writes, State values are NFKC-normalised and whitespace-collapsed by
the API, bounded to name 120 characters, code 24 characters, and office address
500 characters. A migration-backed trigger repeats trimming and bounds checks,
uses transaction-scoped advisory locks, and rejects case/whitespace-equivalent
name or code conflicts. This makes concurrent equivalent creates and renames
converge safely. API conflicts return `409 state_identity_conflict`; validation
and malformed IDs return client-safe `422` responses.

## Reference safety and deletion policy

State-linked operational records retain their established numeric references.
Projects, plans, reports, risks, budgets, communications, and User Management
were inspected only for this reference-safety verification and were not changed.
The State detail view exposes linked projects and locality references without
inventing aggregated programme, beneficiary, risk, progress, or budget KPIs.

## Inclusive registry experience

The responsive State workspace provides a compact table for wider screens and
structured cards on narrow screens. It has labelled keyboard search, visible
focus treatment from shared controls, logical `start`/`end` spacing, modal focus
management, labelled edit controls, field-level error associations, and distinct
loading, request-failure/retry, empty-registry, and no-search-results states.
English and Arabic State-specific labels use the Planning namespace. Canonical
State record values are not translated or changed in storage.

## Verification evidence

| Verification | Result |
| --- | --- |
| State route authority, guessed IDs, malformed/non-existent IDs including snapshot reads, validation, duplicate conflict, ID stability, audit-after-success, absent delete lifecycle | `states-closure.test.ts`: 8 passed |
| Database-backed equivalent concurrent State creates and renames | `states-concurrency-integration.test.ts`: runs against the development PostgreSQL migration and requires exactly one successful write |
| State loading/error/empty/search/admin visual and accessibility sentinels | `states-registry-visual.test.tsx`: 4 passed |
| State OpenAPI regenerated client and Zod surface | `useCreateState`, `useUpdateState`, `StateRecord`, and State validation schemas generated successfully |
| CAFA PMIS TypeScript check | Passed |
| CAFA PMIS production build | Passed |
| API server restart and State migration | Passed; migration 034 applied and server listening |
| Live browser end-to-end State workspace | Authentication-blocked in a fresh browser context: `/api/me` returned 401 and the app correctly redirected to Sign In. The registry itself could not be reached without test staff credentials; focused rendered UI tests cover the accessible States workspace. |

The broader API TypeScript check still reports pre-existing errors in
`objectStorage.ts` and `plans-aggregate-integration.test.ts`; they are outside
the State registry files and were not changed by this closure. The full frontend
lint command also has pre-existing repository errors outside the State registry.
The full API test suite was also run after the State-owned tests passed: its only
remaining failures are the existing `PLAN-RESP-01` Plans responsible-user case
and `RISK-RES-02` State Programme Officer risk-membership case, both returning
500 in their own route test harnesses. They neither import nor exercise the
State registry route and were not changed here.