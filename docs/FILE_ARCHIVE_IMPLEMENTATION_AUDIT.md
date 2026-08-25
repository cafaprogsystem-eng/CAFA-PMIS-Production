# Canonical file storage architecture

## Runtime authority

CAFA PMIS uses `ObjectStorageService` as the only normal file-storage authority.
The selected `STORAGE_PROVIDER` (S3-compatible storage, GCS service account, or
the Replit sidecar) owns object bytes. User workflows create an upload
descriptor, upload the bytes, verify provider metadata, then finalise a
parent-bound attachment record transactionally.

Previews and downloads are authorised server proxies. They never expose object
keys, provider URLs, or signed URLs to the browser. Replacement promotes a
verified canonical object before it retires the prior metadata/object.

## Historical records

Rows copied into `legacy_storage_records` are unavailable by default and are
not part of normal upload, archive, preview, or download flows. A
storage administrator can use the separate `/storage-history` process only
when `HISTORICAL_IMPORT_S3_*` is explicitly configured. The importer verifies
the source size and MIME type, hashes the copied bytes, verifies the
destination metadata, records immutable attempt evidence, creates one
canonical attachment identity, and writes an audit event.

The source is never deleted. Missing, ambiguous, mismatched, inaccessible, or
deleted-parent records remain reconciliation records for an authorised owner
to keep unavailable, archive metadata, remove metadata, or recover manually.

## Operational policy

Normal deployments require only the configured central storage provider.
Historical-import credentials are optional, are read only during an explicit
administrator import request, and must not be configured for normal operation.