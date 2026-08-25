---
name: Effective Access Inspector parity
description: Rules for keeping the admin effective-access view accurate as capabilities and scope policies evolve.
---

The effective-access Inspector must derive permissions with the canonical `permissionsFor()` function and represent every capability it can grant. Its machine-readable action identifiers are the stable interface for client localisation; do not make API English labels the source of Arabic presentation.

**Why:** A hand-maintained subset can silently report a granted capability as denied (or omit it), which makes an access audit tool misleading precisely when administrators rely on it to investigate access.

**How to apply:** When adding or changing any `permissionsFor()` capability, add or update the Inspector action and its EN/AR labels in the same change. Keep its capability-coverage regression guard passing. Model special route conditions and alternate scope paths explicitly rather than implying organisation-wide access; direct project assignments are a separate access path for state-scoped users.