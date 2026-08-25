---
name: Tracked migration immutability
description: How to safely correct production data introduced by an already-tracked migration.
---

Once a migration can have its checksum recorded in an environment, its SQL is immutable. Corrections to seed data or canonical labels must be expressed as a later, forward-only migration that recognizes both legacy and canonical values.

**Why:** The migration runner rejects a changed historical checksum before the service starts. Editing old migrations therefore blocks established environments instead of upgrading them.

**How to apply:** Keep the prior migration byte-for-byte unchanged. Add a new idempotent migration that updates records by stable identity (such as code) and recognized aliases, preserves relationships, and inserts only missing canonical records.