# Risk Register — Project Permanent Delete Closure

## RISK-005 Status: CLOSED

## Project Delete Transaction
`artifacts/api-server/src/routes/projects.ts` — `DELETE /projects/:projectId` (single transaction under `SELECT … FOR UPDATE` on the project row).

Final permanent-delete cascade order:

1. `comments` (entity_type='project')
2. `notifications` (entity_type='project')
3. `project_localities`
4. `project_free_localities`
5. `project_assignments`
6. `project_documents`
7. `project_state_allocations`
8. `project_states`
9. `indicators`
10. `activities`
11. `outputs`
12. `beneficiaries`
13. **NEW** — `DELETE FROM risks WHERE project_id = $1 RETURNING id` (collects `riskIds`)
14. **NEW** — `UPDATE plan_activities SET risk_id = NULL WHERE risk_id = ANY(riskIds)`
15. **NEW** — `DELETE FROM comments WHERE entity_type = 'risk' AND entity_id = ANY(riskIds)`
16. **NEW** — `DELETE FROM drive_files WHERE module = 'risks' AND record_id = ANY(riskIds) RETURNING drive_file_id`
17. `reports`
19. `plans`
20. `approvals`
21. `projects` row
22. `COMMIT`
23. **POST-COMMIT** — best-effort physical storage cleanup for the collected keys

`audit_log` rows remain intentionally preserved.

## Risk Referential Cleanup
- Risks are deleted **first**, with `RETURNING id` capturing the exact set destroyed; the application-managed children are purged **after**, inside the same transaction. This ordering is deliberate — see Failure / Concurrency Safety.
- `plan_activities.risk_id` is nulled by `riskIds` in-transaction — no dangling references survive the COMMIT. All riskId-scoped statements are skipped when the project has no risks (no unbounded statements).

## Plan / Plan Activity Semantics
- Plans and plan activities are preserved as records; only the `risk_id` foreign reference is nulled. `plan_activities.risk_id` has no DB-level FK (verified in `lib/db/src/schema/index.ts`), so cleanup is application-managed, as elsewhere in the codebase.

## Risk Comments
- `DELETE FROM comments WHERE entity_type = 'risk' AND entity_id = ANY(riskIds)` runs in-transaction. Old risk IDs can no longer be enumerated via the comments API after project deletion.

## Risk Attachments / Storage
- `drive_files` metadata deleted in-transaction by identity key (`module = 'risks' AND record_id`), never by supplemental `project_id` metadata; `RETURNING drive_file_id` captures the physical storage keys.
- Post-commit, physical cleanup follows the canonical document-delete pattern: `archiveFile(key)` with `deleteFile(key)` fallback via `lib/awsS3`, gated on `isConfigured()`, best-effort and non-fatal (errors are logged; the deletion response is unaffected).

## Soft Delete
- Soft-delete branch unchanged — only the project-row UPDATE; risks, comments, plan activity links and drive files are all preserved.

## Failure / Concurrency Safety
- Transaction rollback: any mid-cascade failure triggers ROLLBACK; project, risks, plan-activity links, risk comments and drive_files metadata all survive, and no storage cleanup is attempted.
- Risk create race: `risks.project_id` has **no DB-level FK** (schema verified — no `.references()`), so a plain existence check could let a risk INSERT land after the delete cascade. `POST /risks` therefore runs its INSERT in a transaction that re-checks the project under `SELECT … FOR UPDATE` (fails closed 422 `project_not_found`). If the create wins the lock, the delete's cascade removes the new risk; if the delete wins, the create fails closed.
- Risk child-writer races (comments, attachments): risk comments and risk attachment metadata also have no DB-level FKs, so a validate-then-insert writer racing the cascade could otherwise commit an orphan after the purge. The protocol serialises all interleavings on the **risk row lock**:
  - The cascade deletes risks first (`RETURNING id`) and purges children after.
  - `POST /comments` (entityType='risk') and `POST /drive/upload` (module='risks') lock the parent risk (`SELECT 1 FROM risks WHERE id = $1 FOR UPDATE`) in the same transaction as their INSERT.
  - Writer commits first → the cascade's `DELETE FROM risks` blocks on the row lock; once acquired, the subsequent child purges see the committed row and remove it.
  - Cascade wins → the writer's `FOR UPDATE` blocks until the delete commits, then finds no risk row and fails closed (comment: 404 `entity_not_found`; upload: 404 `risk_not_found` plus best-effort deletion of the already-uploaded physical object).
- Plan-activity risk links: `validateRiskReference` in `plans.ts` now locks the risk row `FOR SHARE` on the plan create/PATCH transaction client, holding the lock through the subsequent `plan_activities` write. A racing project delete blocks on the share lock until the plan transaction commits (its cascade then nulls the freshly written link), or wins the lock first and makes the validation fail closed (`risk_not_found`).
- Upload generic failure path: if the metadata INSERT/COMMIT fails for a risk attachment, the already-uploaded physical object is deleted best-effort before the error is rethrown — no orphaned storage from failed uploads.

## Files Changed
- `artifacts/api-server/src/routes/comments.ts` — risk comment INSERT transactionalised with parent-risk FOR UPDATE lock
- `artifacts/api-server/src/routes/drive.ts` — risk attachment metadata INSERT transactionalised with parent-risk FOR UPDATE lock + physical-object cleanup on fail-closed
- `artifacts/api-server/src/routes/projects.ts` — permanent-delete cascade: riskId collection, plan-activity null, risk comment purge, drive_files delete + RETURNING, post-commit storage cleanup
- `artifacts/api-server/src/routes/plans.ts` — `validateRiskReference` locks the risk row FOR SHARE through the plan-activity write
- `artifacts/api-server/src/routes/risks.ts` — create path: transactional FOR UPDATE project re-check + INSERT
- `artifacts/api-server/src/routes/__tests__/risk-project-delete.test.ts` — new suite (RISK-DEL-01 … RISK-DEL-15, 23 tests)
- `artifacts/api-server/src/routes/__tests__/risk-audit.test.ts`, `risk-reference-date-integrity-closure.test.ts`, `risk-residual-wave2.test.ts` — pool mock extended with `connect` (delegates to the same query mock)

## Tests
RISK-DEL-01 through RISK-DEL-17 (16 adds writer-coordination interleaving sentinels; 17 covers plan-activity risk-link locking and upload failure-path cleanup) (23 tests, all green). Full api-server suite: 2147 passed; the only failures (12, in `budget-role-gates-closure` and `dashboard-access-parity`) are pre-existing on the unmodified baseline (verified via git stash). `tsc --noEmit`: 13 errors, identical to baseline (all pre-existing, none in changed lines).

Pre-existing gap noted (out of scope, not regressed): project document physical Drive/S3 files are not cleaned up on project permanent delete.

## Remaining Risk Findings
None.

## Audit File
docs/audit-reports/risk-project-permanent-delete-closure.md
