---
name: Offline draft scope recovery
description: Safety rule for restoring operational drafts against cached reference data.
---

Durable operational drafts must wait for the current user's authorised reference data to load, then validate every restored relationship against it before placing values into a form. Missing or stale references must be cleared for repair, never trusted.

**Why:** A user-scoped browser draft can outlive a role, location, or parent-record change. Restoring it before reference data is available, or validating against an unfiltered list, can silently reintroduce an unauthorised State, Sector, Project, or Risk relationship.

**How to apply:** Gate recovery on safely cached authorised reference queries; validate top-level and nested relationships using the current scope. Keep the draft itself for recovery feedback, but do not restore invalid relationships. Financial, attachment, and lifecycle fields belong outside the offline operational draft shape.