# Communication Upload & Voice Transport Closure

## Status

- **COMM-001: CLOSED** — the current Communication Centre path is reconciled
  end to end: it requests a private upload descriptor, writes bytes to that
  descriptor, stores the resulting private object path only in the message
  record, and returns an authorised message-bound proxy URL on reads.
- **COMM-007: CLOSED** — message attachments and voice recordings now require
  the dedicated `messages.attachments.upload` capability on both the server
  and composer controls.

## Current-Head Reconciliation

Wave 1 already established the confidentiality boundary: stored paths are
normalised private object references; message response DTOs replace them with
`/api/conversations/:conversationId/messages/:messageId/attachments/:index`;
and proxy reads authorise against the parent conversation. This closure did
not replace that model.

The remaining transport defect was in the composer. It sent
`scope: "messages"` but the storage route ignored that scope and required
`documents.upload`; it also read a stale `uploadUrl` spelling rather than the
generated `uploadURL` field. Both file and voice transport now share one typed
helper that uses the generated request/response contract, verifies the PUT
response, and passes the server-signed message descriptor with the subsequent
message create request.

## Attachment Upload

- Supported existing image and document MIME types continue through the
  private object upload flow.
- The storage request accepts documented `scope: "messages"` only for
  Communication Centre uploads. It is mutually exclusive with report-bound
  upload fields, so message capability cannot weaken report/document policy.
- The message create route independently requires the attachment capability
  when attachments are present. It verifies each signed descriptor against
  the current user, private object path, filename, MIME type, and declared
  size, then requires provider-authoritative metadata to match the signed byte
  count and canonical MIME type before storing the attachment. It then promotes
  the verified temporary object to a fresh server-controlled message key and
  stores only that immutable key. Arbitrary private paths and metadata cannot
  be attached to a message.
- MIME, 20 MB size, and filename checks remain server-side. Paths and control
  characters in filenames are rejected rather than silently becoming a
  Content-Disposition value.

## Voice Notes

The recorder produces the existing WebM/MP4 audio Blob. The shared transport
requests the same private descriptor, PUTs the audio bytes, then sends an
attachment with `type: "voice"` and duration metadata. Retrieved voice
attachments retain the existing safe audio inline allow-list and use the
message-bound proxy URL for playback.

## Permission Model

`messages.attachments.upload` is granted to the same eight valid CAFA roles
that can send Communication Centre messages; Super Admin receives it through
the existing wildcard. The composer hides file and microphone controls unless
the current permissions include that capability (or `*`), and the storage
route returns a `403` with the required capability for an unauthorised caller.
Report and generic document uploads continue to require `documents.upload`.

## Storage / Download Safety

Message DTOs expose proxy URLs rather than raw paths. The existing proxy route
continues to force `application/octet-stream` and attachment disposition for
unsafe MIME metadata, while only its conservative image/audio allow-list can
render inline. Existing route regressions confirm a direct-message member can
download/play an attachment and that ordinary non-members, Programme Managers,
and Super Admins are denied other users' direct-message attachments.

## Remaining Retention Decision

**COMM-BD-004 remains open.** A successful byte PUT can still become an orphan
if the subsequent message send fails, is cancelled, the conversation is
removed, or stored metadata fails integrity verification. No destructive
cleanup was added because storage retention and reconciliation ownership
remain a business decision. The generated private object path is unreferenced
in that failure case and can be safely identified by a future
retention/reconciliation process without exposing it to clients.

## Tests

- `communication-upload-transport.test.ts`: supported image, document, and
  voice descriptor requests; permission denial; MIME, size, filename, and
  scope validation; generated response field parity.
- `object-storage-upload-signing.test.ts`: direct-GCS canonical MIME signing
  and promotion from a temporary upload key to a fresh message-only key.
- `conversation-attachment-provenance.test.ts`: missing, report-bound,
  foreign-user, and stored-byte-mismatch descriptors are rejected before a
  message insert; a matching descriptor produces a proxy-only message response.
- `message-upload.test.ts`: generated `uploadURL` usage, private-path handoff,
  rejected byte upload handling, and capability-only UI gating.
- `communication-confidentiality-idor.test.ts`: retained direct-message
  non-member, Programme Manager, Super Admin, member proxy-read, and safe
  proxy header coverage.

### Verification evidence

- `pnpm --filter @workspace/api-server exec vitest run src/lib/uploadToken.test.ts src/lib/object-storage-upload-signing.test.ts src/routes/conversation-attachment-provenance.test.ts src/routes/communication-upload-transport.test.ts src/routes/communication-upload-capability.test.ts src/routes/communication-confidentiality-idor.test.ts src/routes/path-hardening.test.ts src/routes/att02-hardening.test.ts`
  **Pass — 99 tests.**
- `pnpm --filter @workspace/cafa-pmis exec vitest run src/lib/message-upload.test.ts`
  **Pass — 6 tests.**
- `pnpm --filter @workspace/api-server run build` and
  `pnpm --filter @workspace/cafa-pmis run build`
  **Pass.**
- `pnpm --filter @workspace/cafa-pmis run typecheck`
  **Pass.**
- API typecheck remains blocked only by seven pre-existing
  `plans-aggregate-integration.test.ts` `PoolClient` typing errors. The
  transport and provenance route tests, API build, generated contract build,
  and frontend typecheck all pass.

## Files Changed

- `lib/api-spec/openapi.yaml`
- `artifacts/api-server/src/middlewares/currentUser.ts`
- `artifacts/api-server/src/routes/storage.ts`
- `artifacts/api-server/src/routes/communication-upload-transport.test.ts`
- `artifacts/cafa-pmis/src/lib/message-upload.ts`
- `artifacts/cafa-pmis/src/lib/message-upload.test.ts`
- `artifacts/cafa-pmis/src/pages/messages.tsx`
- `docs/audit-reports/communication-upload-voice-closure.md`