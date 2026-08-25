# Risk Register — Comments & Attachments Security / Functional Closure

Task 569 · RISK-001 & RISK-004 · August 2026

## 1. RISK-001 status: **CLOSED**

Risk Comments were completely non-functional because the shared comments route
rejected `entityType="risk"` before any scope check ran. `"risk"` is now a
valid entity type on both `GET /comments` and `POST /comments`, guarded by the
canonical Risk access rules.

## 2. RISK-004 status: **CLOSED**

All Drive routes touching `module='risks'` rows now enforce a parent-Risk
access check. Previously, every route was `requireAuth` only and filtered (if
at all) on the drive file's own caller-supplied state/sector metadata — an
IDOR path allowing any authenticated user to list, download, upload, replace
or delete risk attachments across states and sectors.

## 3. Comments architecture (RISK-001)

File: `artifacts/api-server/src/routes/comments.ts`

- `VALID_ENTITY_TYPES` now includes `"risk"`.
- `loadEntityMeta` gained a risk branch: the TC sector authority is the
  **linked project's primary sector only** (`LEFT JOIN projects`); a
  standalone risk has a null sector, so `assertSectorAllowed` fails closed
  for Technical Coordinators — mirroring the `GET /risks` list filter.
  A missing risk returns **404 entity_not_found**.
- New `assertRiskStateScope(req, riskId)` helper mirrors
  `PATCH /risks/:riskId` / `GET /risks/:riskId/history`: SPO/SOM must match
  `risks.state_id`; a state user with a null `stateId` fails closed (403).
  It is called in both the GET and POST handlers **before** any comment
  SELECT or INSERT.
- **Read gate** — risk comment reads are governed by canonical risk read
  authority (`risks.view` or `risks.view.state`) plus the scope checks above,
  not by `comments.create`. SPO/SOM can therefore read risk comments within
  their own state.
- **Create gate** — `comments.create` (HQ roles + ED) **or** canonical risk
  mutation authority (`risks.update`, e.g. SPO within their state). SOM stays
  read-only for risks, consistent with its view-only monitoring role. The
  role→comment-type allow-list, body trimming, and blank-body 400 are
  unchanged for all entities.
- `entityLink("risk")` resolves to `/risks` for notifications.
- No Risk approval workflow or new notification behaviour was invented;
  `actorsForEntity("risk")` returns an empty set, so the generic fan-out is a
  no-op for risks (documented, not changed).

## 4. Attachment access model (RISK-004)

File: `artifacts/api-server/src/routes/drive.ts`

New helper `assertRiskAccessForDriveOperation(req, recordId)`:

1. Validates `recordId` is a positive integer → otherwise **404
   risk_not_found** (never 500).
2. Loads the risk with its linked project's sector; missing risk → **404**.
3. TC sector scope via `assertSectorAllowed` on the **parent risk's project
   sector** (standalone risk → null sector → TC fails closed).
4. SPO/SOM clamped to their own state; null `stateId` fails closed (403).
5. PM / super_admin pass — they are neither state roles nor TCs (Full
   Operational Access, Task #373).
6. Returns the loaded risk row for server-side metadata derivation.

Applied to (when the file/query targets `module='risks'`):

| Route | Guard | Extra |
|---|---|---|
| `GET /drive/files` (list) | ✔ before query | allow-list DTO |
| `POST /drive/upload` | ✔ before S3 upload | + `risks.update` mutation permission; `state_id`, `sector`, `project_id` derived from the loaded risk — caller-supplied values ignored |
| `GET /drive/files/:id/download` | ✔ replaces the file-metadata check | sanitised filename |
| `PATCH /drive/files/:id` (delete/status) | ✔ before UPDATE | + `risks.update` |
| `POST /drive/files/:id/replace` | ✔ before upload | + `risks.update`; allow-list DTO with `driveLink` nulled |
| `GET /drive/files/:id/versions` | ✔ | `driveLink` replaced with a presigned URL (or null) — raw S3 key never returned |
| `POST /drive/files/:id/log-access` | ✔ | 404 for missing files; guard runs before the audit write, preventing forged audit events |

**Generic listing bypass closed at SQL level** — `GET /drive/files` without
`module=risks` embeds a parent-risk authorisation predicate in the shared
WHERE clause (SPO/SOM: `EXISTS` match on the parent risk's `state_id`; TC:
`EXISTS` match on the linked project's sector; null-state/sectorless scoped
roles exclude all risk rows), so **both** the paginated rows and the
`COUNT(*)` total are computed over the accessible set only. Inaccessible risk
rows cannot leak through pagination totals, be enumerated by varying
`limit`/`offset`, or displace accessible records within a page. Orphaned risk
rows (no matching parent risk) fail closed for scoped roles via the `EXISTS`.
The allow-list DTO is applied to every risk row by the row's own `module`
regardless of the query path, and the presign fallback for risk rows is
**null-only** — the persisted raw `drive_link` (S3 object key) is never
returned on any path.

**Direct comment mutation guarded** — `PATCH /comments/:id` and
`DELETE /comments/:id` load the comment's parent entity and, for risk
comments, enforce the sector guard plus the SPO/SOM state clamp before any
UPDATE/DELETE; the permission gate is `comments.create` or, for risk
comments, canonical risk mutation authority (`risks.update`). A comment on an
inaccessible risk cannot be resolved, reopened, or deleted by direct ID.
The gate is enumeration-safe: callers with neither permission are rejected
before any lookup, and `risks.update`-only callers receive an identical 403
for absent IDs and for existing non-risk comments, so comment IDs cannot be
probed for existence. Callers with `comments.create` keep the previous
behaviour (404 for absent IDs).

The legacy `df.state_id` / `df.sector` filters remain in force for other
modules; for risks the parent-risk check supersedes them.

## 5. IDOR test results

All pass (see §9): an actor with access to Risk A cannot list/create comments
or list/download/delete attachments on Risk B; wrong state → 403; wrong TC
sector → 403; malformed or non-existent risk → 404; inaccessible risks never
return comment or file data.

## 6. DTO / security contract

For the risks module, list and upload responses use an allow-list DTO
(`riskAttachmentDto`) returning only: `id`, `name`, `mimeType`, `size`,
`status`, `createdAt`, `uploaderName`, `uploaderRole`, `driveLink`
(presigned, read-time), `versionNumber`.

Excluded: `driveFileId` (S3 object key), `recordId`, `projectId`, `sector`,
`visibilityLevel`, `permissionLevel`, `parentFileId`, `uploadedByUserId`.
The upload response additionally nulls `driveLink`, since at insert time it
still holds the raw S3 key. Other modules' DTOs are unchanged.

The replace response nulls `driveLink` (raw key at insert time) and the
versions response presigns or nulls it — no route returns the raw S3 object
key for a risk attachment.

`Content-Disposition` filenames are sanitised (`sanitiseFilename` strips path
separators and control characters) before `encodeURIComponent`.

## 7. Full Operational Access (Task #373)

Preserved: PM and super_admin pass every new guard. PM holds `risks.update`
via the Full Operational Access grants in `permissionsFor`; super_admin via
the `"*"` wildcard. Neither is subject to the state clamp or TC sector guard.

## 8. Audit logging state

- Comments: `comment_add` / `comment_reply` / `comment_resolve` /
  `comment_delete` already write to `audit_log` — risk comments inherit this
  with no additional work.
- Drive: `file_uploaded` / `file_downloaded` / `file_<status>` /
  `file_replaced` already write to `audit_log` — no gap.

## 9. Files changed

- `artifacts/api-server/src/routes/comments.ts` — risk entity type, risk
  meta/sector branch, `assertRiskStateScope`, GET/POST guards, entity link.
- `artifacts/api-server/src/routes/drive.ts` —
  `assertRiskAccessForDriveOperation`, `hasRiskMutationPerm`,
  `riskAttachmentDto`, `sanitiseFilename`, guards on the six routes above,
  server-derived upload metadata for risks.
- `artifacts/api-server/src/routes/__tests__/risk-comments-closure.test.ts` — new.
- `artifacts/api-server/src/routes/__tests__/risk-attachments-closure.test.ts` — new.
- `artifacts/api-server/src/routes/__tests__/risk-idor-routes.test.ts` — new; route-level IDOR tests exercising the real Express handlers with a mocked pool (cross-state comment GET/POST/PATCH/DELETE denials, generic drive-list partitioning + sanitisation, cross-state download denial where the file's own metadata would have passed).
- `artifacts/api-server/src/routes/__tests__/risk-audit.test.ts` —
  RISK-AUD-15 updated to assert the closure instead of the finding.
- `docs/audit-reports/risk-comments-attachments-security-closure.md` — this file.

## 10. Tests written

- RISK-COM-01 … RISK-COM-10 (`risk-comments-closure.test.ts`, 23 assertions)
- RISK-EVID-01 … RISK-EVID-10 (`risk-attachments-closure.test.ts`, 25 assertions)
- Full api-server suite: **73 files / 1,924 tests — all pass.**
- Frontend: no frontend changes; the pre-existing type errors in unrelated
  report components remain (tracked by Task #146) and are not attributable.

## 11. Remaining Risk Residuals

Findings from the Risk Register audit not addressed by this task:

- RISK-006, RISK-007, RISK-008, RISK-011 (reference, linkage & date
  integrity — Task #570).
