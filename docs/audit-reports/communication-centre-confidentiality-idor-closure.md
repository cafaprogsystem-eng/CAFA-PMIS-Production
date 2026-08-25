# Communication Centre Confidentiality & IDOR Closure — Wave 1

**Closure date:** 19 August 2026  
**Scope:** `COMM-002`, `COMM-006`, `COMM-015`, and `COMM-016` only.  
**Status:** Closed after implementation and verification.

## Scope and non-goals

This closure addresses the approved confidentiality and IDOR issues in the
Communication Centre. It does not redesign notification delivery, delete-for-me
behaviour, message pagination, the wider upload lifecycle, schema normalisation,
or realtime fan-out.

Direct messages remain member-only for every role. Programme Manager and Super
Admin operational access continues to apply only to non-direct conversations.

## Implemented controls

### COMM-002 — Reply and forward provenance

- Message creation now validates a `replyToId` inside the insert transaction.
  The referenced message must exist, belong to the target conversation, and not
  be deleted. Cross-conversation and deleted reply sources are rejected before
  a message is inserted.
- Forward provenance is checked inside the same transaction. The source must
  exist, not be deleted, and be currently visible to the actor under the
  canonical conversation access model.
- Message listing and message mutation responses redact the body and sender of
  a reply source after that source is deleted.

### COMM-006 — Attachment and voice-note object access

- Stored Communication Centre attachments are represented internally by an
  object path but exposed to clients only as a message-bound proxy URL.
- The proxy resolves: attachment index → stored message → parent conversation
  → canonical access decision → storage object. A caller cannot establish
  access by providing a filename, storage path, or URL.
- The existing private object route now performs the same parent-conversation
  check when the requested object is a stored Communication Centre attachment.
  This prevents bypassing the proxy with a leaked or guessed object path.
- Direct-message attachment access requires real membership for ordinary users,
  Programme Manager, and Super Admin alike.
- Attachment MIME metadata cannot select arbitrary inline browser rendering.
  Only a small image/audio allow-list is served inline; all other files are
  sent as downloads with a safe binary MIME type.
- The web composer now uses the actual upload request/response contract and
  stores the private `objectPath` for server-side resolution. The returned
  message DTO replaces it with the authorised proxy URL.

### COMM-015 — Removed-member message edits

- Editing retains the author-only, not-deleted, and fifteen-minute-window
  requirements.
- It now also re-checks current canonical conversation access before mutation.
  A former member cannot edit a message merely because they originally sent it.

### COMM-016 — Read receipt determinism

- Read receipts are persisted only for a current membership row.
- A non-member receives a deterministic `403 read_receipt_forbidden`, rather
  than a false-success `204`.
- Full-access operational viewers are not silently added as members and do not
  receive a fake read acknowledgement for non-direct conversations.

## Adversarial verification

Dedicated route-level coverage was added in
`communication-confidentiality-idor.test.ts`. It verifies:

| Scenario | Expected result | Result |
|---|---|---|
| Cross-group reply reference | Rejected before insert | Pass |
| Cross-DM forward by non-member PM | `403`, direct-message privacy retained | Pass |
| Direct-message attachment, ordinary non-member | `403` | Pass |
| Direct-message attachment, Programme Manager | `403` | Pass |
| Direct-message attachment, Super Admin | `403` | Pass |
| Member attachment read | Parent-authorised object retrieval | Pass |
| PM operational viewer, non-direct attachment | Parent-authorised retrieval without fake membership | Pass |
| Non-existent message attachment | `404`, no storage read | Pass |
| Deleted reply reference in message output | Reply content and sender redacted | Pass |
| Removed message sender attempts edit | `403`, no update | Pass |
| Non-member mark-read, including PM viewer | `403`, no false `204` | Pass |
| Current member mark-read | Timestamp update and `204` | Pass |

## Verification evidence

- `pnpm --filter @workspace/api-server exec vitest run src/routes/communication-confidentiality-idor.test.ts src/routes/path-hardening.test.ts`  
  **Pass — 21 tests.**
- `pnpm --filter @workspace/api-server run build`  
  **Pass.**
- `pnpm --filter @workspace/cafa-pmis run build`  
  **Pass.**
- Restarted and checked both managed workflows:
  - `artifacts/api-server: API Server`
  - `artifacts/cafa-pmis: web`
  Both are running cleanly.
- Browser smoke check renders the unauthenticated landing page. The only
  browser console/API responses were expected `401` responses for unauthenticated
  calls; no authenticated multi-user session was available for a live IDOR probe.

## Type-check note

Workspace-wide TypeScript checks remain blocked by pre-existing generated API
contract drift in Risk/Reports/Plan surfaces. The reported errors are outside
this closure's changed files. The targeted API build, frontend production build,
and route-level adversarial suite above all pass.