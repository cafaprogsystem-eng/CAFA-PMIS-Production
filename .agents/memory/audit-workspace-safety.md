---
name: Audit workspace safety contract
description: Security and validation rules for the Audit Log’s paginated query and structured event changes.
---

Audit Log query validation must be based on the generated OpenAPI schema and then add strict calendar-date and cross-field refinements in the shared API-Zod wrapper. Audit before/after values may only expose an explicit allowlist of named, non-sensitive fields; unstructured scalar values must never be rendered.

**Why:** OpenAPI parameter schemas do not express real calendar validity or relationships such as matching module aliases. A denylist of audit payload keys can expose opaque credentials whose key/value does not contain a recognisable sensitive word.

**How to apply:** When extending audit filters, update OpenAPI and regenerate first, then add any cross-field refinements to the shared strict wrapper used by the route. When adding audit change detail, explicitly review and add a field to the allowlist rather than broadening fallback rendering.