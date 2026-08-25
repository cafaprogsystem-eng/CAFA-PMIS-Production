# Project Document Evidence Security Closure — PRJ-009 & PRJ-010

**Date:** 17 August 2026
**Scope:** `GET/POST /projects/:id/documents`, `GET /projects/:projectId/documents/:documentId/download`
**Out of scope (untouched):** Plans and Reports document APIs, upload flow design, lifecycle gates, Task #472 authorisation logic, OpenAPI.

---

## Finding status

| Finding | Description | Status |
|---|---|---|
| **PRJ-009** | Document list/upload responses leaked `objectPath` and `driveFileId` | **CLOSED** |
| **PRJ-010** | Legacy download branch redirected to `/storage/objects/<objectPath>`, exposing the internal object path in the `Location` header | **CLOSED** |

## PRJ-009 — Public document contract

A strict allow-list DTO mapper `toPublicDocumentDto(row)` in `artifacts/api-server/src/routes/projects.ts` is now the only shape that leaves the server for project documents. Public fields:

```
id, projectId, category, kind, fileName, contentType, size, uploadedByName, uploadedAt
```

- `getDocuments()` sanitises at the source — its `SELECT` no longer reads `object_path`/`drive_file_id` at all, and every row is passed through `toPublicDocumentDto`. This covers **all** response paths: the standalone documents list, `GET /projects/:id` (nested `project.documents`), and `enrichProject` (project list enrichment).
- `POST /projects/:id/documents` → `res.status(201).json(toPublicDocumentDto({ ...row, uploadedByName }))`

**objectPath removal confirmation:** `objectPath`, `object_path`, `driveFileId`, `drive_file_id`, bucket names, and raw storage keys are absent from both responses. The DTO is an explicit allow-list — any new column added to `project_documents` is excluded by default. A sentinel test (PRJ-DOC-DTO-01/01b) asserts the response key set is *strictly equal* to the allow-list, so any unknown key fails the suite.

## PRJ-010 — Download architecture

`GET /projects/:projectId/documents/:documentId/download` now **proxies/streams for both branches**; no redirect exists anywhere in the route:

- **Drive-backed** (`driveFileId` set): unchanged — resolves the S3 key from `drive_files`, streams via `downloadFileStream` with `Content-Type` + `Content-Disposition: attachment`.
- **Legacy object storage** (`objectPath`): the `res.redirect('/storage/objects/…')` line is removed. The handler now calls `ObjectStorageService.getObjectEntityFile()` → `downloadObject()` and pipes the storage response body to the client with `Content-Type`, `Content-Length`, and a **safe** `Content-Disposition` filename (quotes and CR/LF stripped, then URI-encoded). Errors map to `404` (`ObjectNotFoundError`), `503` (storage not configured), `502` (empty storage body).

**Storage abstraction:** the route uses only the opaque `StorageFile` handle from `lib/objectStorage.ts`; no provider detail (GCS/S3/Replit) or bucket/key is inspected or emitted.

## Security posture

- **State/sector security:** guard order unchanged and verified — effective-sector guard and `assertStateAllowed` run **before** any document SQL or storage access; tests spy on storage to prove zero storage calls when a guard fires (PRJ-DOC-SEC-04/05).
- **Full Operational Access:** PM and Super Admin downloads succeed with no internal path in body or `Location` (PRJ-DOC-SEC-07/08).
- **TC secondary-sector access (Task #456):** regression-verified (PRJ-DOC-SEC-06).
- **Cross-project ID substitution:** blocked by `WHERE id = $1 AND project_id = $2`; asserted (PRJ-DOC-DL-06).
- **Project-detail nesting:** `GET /projects/:id` nested `project.documents` verified to match the strict allow-list with no internal storage values anywhere in the serialised response (PRJ-DOC-SEC-09).
- **Drive-backed documents:** branch untouched; streaming behaviour unchanged.

## Lifecycle regression

- `prj-doc-lifecycle.test.ts`, `prj-closure-sentinel.test.ts`, `prj-final-closure.test.ts` — **102 tests pass**.
- `prj-multisector-scope.test.ts`, `project-bd-sentinels.test.ts` — **42 tests pass**.

## OpenAPI / generated types

No OpenAPI spec exists for these routes; none was added (per scope). The frontend (`project-detail.tsx`) inline document types no longer declare `objectPath`/`driveFileId`; the download action continues to use the `/download` endpoint. Upload-request-side `objectPath` (client → server) is unchanged and legitimate.

## Files changed

- `artifacts/api-server/src/routes/projects.ts` — DTO mapper; applied to GET list and POST upload responses; legacy download branch replaced with proxy stream.
- `artifacts/cafa-pmis/src/pages/project-detail.tsx` — removed `objectPath`/`driveFileId` from document response types.
- `artifacts/api-server/src/test/prj-doc-security.test.ts` — new suite (16 tests).
- `docs/audit-reports/project-document-security-closure.md` — this report.

## Test totals

| Suite | Result |
|---|---|
| prj-doc-security.test.ts (SEC-01..09, DL-01..06, DTO-01/01b) | 17 / 17 pass |
| prj-doc-lifecycle + prj-closure-sentinel + prj-final-closure | 102 / 102 pass |
| prj-multisector-scope + project-bd-sentinels | 42 / 42 pass |

## TypeScript

`tsc --noEmit` on api-server and cafa-pmis introduces **zero new errors** (identical pre-existing baseline of unrelated errors in reports/risks/plans, tracked by Task #146). No errors in `projects.ts` or `project-detail.tsx`.

## Closure confirmation

PRJ-009 and PRJ-010 are **CLOSED** with direct current-code proof: allow-list DTO with strict-equality sentinel test, and a redirect-free, fully proxied download path for both Drive-backed and legacy documents.
