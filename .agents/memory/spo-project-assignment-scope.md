---
name: SPO project-assignment scope
description: Every report/project read path must clamp SPOs to project_assignments, not just their state
---

Rule: a state_program_officer's record-level project scope is explicit membership in `project_assignments`; a valid direct assignment may intentionally cross the officer's ordinary state. State Office Managers remain state-scoped. State-scoped roles with `stateId = null` fail closed (403).

**Why:** A browser audit confirmed that a state-or-assignment guard let an SPO open an unassigned same-state project by guessing its ID. Direct assignments are a deliberate exception to normal state visibility, not an alternative way to widen within-state visibility.

**How to apply:** For SPO project reads and deep links, check explicit assignment before returning any record fields; do not admit a same-state project merely because it is in the user’s state. Preserve the null-state fail-closed gate and deny with 404/403 without leaking existence. Deep links in the UI should resolve through an authorised single-item endpoint, never by scanning the paginated list.
