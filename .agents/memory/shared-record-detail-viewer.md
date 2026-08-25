---
name: Shared Project and Plan record viewer
description: Rules for opening Projects and Plans in the shared RecordDetailModal without breaking canonical editing or dialog safety.
---

Read-only Project and Plan views are coordinated from the authenticated application shell rather than by replacing their canonical routes. The existing detail pages render in embedded mode and keep all authorised data, tabs, attachments, comments, history, and workflow behaviour.

**Why:** Staff need a consistent, focus-safe viewer while bookmarks, notifications, and explicit editing flows must remain refresh-safe canonical routes.

**How to apply:** Use the record-detail coordinator for a read-only Project or Plan entry point. Never intercept a URL with a query string (especially `?edit=1`), a download, or a link inside an existing dialog; those must retain their direct route/action semantics. Do not open a full-record modal from inside another dialog. Embedded viewers must never activate edit mode—Continue Edit closes the viewer and goes directly to the existing canonical editor.