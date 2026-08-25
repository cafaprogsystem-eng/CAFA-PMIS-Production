---
name: Sidebar visual regression stability
description: Deterministic sidebar snapshots need live viewport geometry and exhaustive snapshot-update guarding.
---

Use `window.innerWidth` and `window.innerHeight` from the rendered page—not
Playwright's configured viewport metadata—when calculating a screenshot clip
after a responsive resize. Include a small, fixed inward shell slice with the
sidebar so visual baselines cover anchoring and mobile drawer overlays without
capturing unstable page content.

**Why:** configured desktop viewport information can persist while the page is
rendering at a mobile size, clipping an RTL drawer capture at the edge and
hiding its overlay boundary.

**How to apply:** for sidebar or similar responsive visual checks, calculate
the clip from the live document direction and dimensions. Snapshot-update
guards must reject both bare Playwright flags and assignment forms such as
`--update-snapshots=all`; normal CI commands must never carry an update flag.