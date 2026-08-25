---
name: Report attachment registration resilience
description: Safe persistence and retry rules for canonical report attachments.
---

Canonical report attachment registration must persist a safe `report_attachments` identity plus the user-selected attachment type into report presentation data immediately. Forms may retain that identifier and display metadata, but must never retain or expose the object-storage path.

**Why:** A file registered after the report save otherwise disappears from the editor and loses its category on reopen. Clearing all pending files only after a batch completes also causes a retry to re-register earlier successes if a later file fails.

**How to apply:** Treat every successful registration as an individual state transition: replace only that file's browser-local payload with the canonical attachment ID and preserve remaining local files for retry. Once a create succeeds, retain the report ID for any recovery save so it PATCHes the existing draft instead of creating another report.