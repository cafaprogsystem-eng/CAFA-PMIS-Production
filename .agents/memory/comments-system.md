---
name: Comments & revision-gate duplication
description: Role-to-comment-type allow-list lives in two places (server + client). Keep them in lockstep, and remember the two transition gates that depend on this data.
---

The `ROLE_TYPE_ALLOW` map (which CAFA roles may post which `comment_type` values) is duplicated:

- Server enforcement: `artifacts/api-server/src/routes/comments.ts`
- Client UI gating: `artifacts/cafa-pmis/src/components/comments-panel.tsx`

**Why:** server is the security boundary, client is for UX; we never imported a shared module because `comments-panel.tsx` shouldn't reach into the server. Drift creates a confusing UX where the dropdown offers a type the server then rejects.

**How to apply:** any time you add/remove a role or comment type, update both files in the same change. The 8 comment types are also referenced by transition gates — don't rename them without searching for the string literals across both packages.

## Transition gates that read comments

`POST /projects/:id/transitions` and `POST /reports/:id/transitions` both call `unresolvedRequiredCorrections(entityType, entityId)` (exported from `routes/comments.ts`) and:

1. Block `final_approve` if count > 0 → returns `{ error: "unresolved_required_corrections", count }`.
2. Require non-empty `comment` for `request_revision` and `reject` → returns `{ error: "comment_required_for_revision_or_reject" }`; the comment text is auto-mirrored into the comment thread as `revision_request` / `rejection_reason`.

The frontend `useUnresolvedRequiredCorrections(entityType, entityId)` hook reads the same comments list to gate UI buttons (tooltip on disabled Final Approve). If you add a new "block-on-open" comment type, update both the hook's filter and the server helper, or the UI and server will disagree on whether approval is blocked.
