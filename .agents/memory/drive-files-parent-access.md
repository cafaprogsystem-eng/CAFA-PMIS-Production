---
name: Canonical attachment parent-record authorisation rule
description: Attachment access comes from canonical parent records; historical imports derive their target from locked evidence, not a caller.
---

**Rule:** Authorise every attachment operation (list, upload, download, replace, versions, delete, access-logging) from the parent record it belongs to, never from the attachment row's own caller-supplied metadata; never return the raw storage key in any response. A historical import must derive and lock its destination from the source evidence, then recheck that parent immediately before registration.

**Why:** Attachment-row metadata is set at upload time by the caller, so filtering on it is an IDOR; a privileged migration form can otherwise reattach bytes to an unrelated parent; a leaked storage key bypasses access control entirely; and post-query filtering of paginated listings leaks counts.

**How to apply:** Guard single-record routes by loading the parent and applying its canonical scope checks before any query, mutation, or audit write. For paginated listings, put the parent-record authorisation into the SQL WHERE so both the page and the COUNT run over the accessible set. Derive upload metadata server-side, respond with allow-list DTOs, and serve downloads through authenticated parent-owned proxies. Keep historical providers outside normal runtime and give imports bounded retry leases.
