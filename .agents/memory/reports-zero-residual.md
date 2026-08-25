---
name: Reports zero-residual closure
description: Durable rules from the Reports module final closure audit (sentinel suite, JSONB validator safety, DDL ownership, contract-gap policy).
---

# Reports zero-residual closure

- The REP-ZR sentinel suite in the api-server tests is the authoritative regression guard for the Reports module. Any Reports change must keep it green.
- **Malformed JSONB entries are validation errors, not ignorable noise.** Draft saves are permissive, so stored JSONB arrays can hold null/array/scalar entries. Submit gates must (a) type-narrow before member access so they never 500, and (b) reject each non-plain-object entry as its own field error — silently filtering junk lets malformed persisted data reach approval.
  **Why:** a submit validator crashed on a null entry, and a filter-only fix let an otherwise-valid report with junk entries be approved.
  **How to apply:** any server-side submit/content gate iterating stored JSONB.
- **Route files must never run startup DDL** — schema is owned solely by tracked migrations; a sentinel guards recurrence.
- **Fix API contract gaps at the OpenAPI source + codegen, never with frontend casts.** Approval-history override fields are now typed on the generated ApprovalEntry.
- Rate limiters skip only outside production (`NODE_ENV !== "production"`); a sentinel asserts no other skip condition exists.
