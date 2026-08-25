---
name: Concurrent UI rebase scope
description: Keeping a focused UI change separate when a shared component changes concurrently.
---

When a concurrently merged shared UI change touches the same page or component, rebase the focused feature branch onto the current main baseline before final review. During conflicts, keep the current main implementation for unrelated interaction and layout behaviour, then reapply only the focused feature’s visual changes.

**Why:** Resolving against an older base can leave an intermediate version of a viewer or layout in the feature diff, even when the intended feature is unrelated. That obscures review scope and can reintroduce superseded behaviour.

**How to apply:** Before completion, compare the feature diff against the current main branch. If it contains unrelated shared-component changes from a concurrent merge, rebase, resolve in favour of main for those areas, and rerun the full suite.