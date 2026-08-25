---
name: Responsive sidebar rail
description: Durable responsive and RTL constraints for the compact application sidebar.
---

Persisted sidebar-collapse preference is a desktop rail preference, not a mobile drawer preference. On a narrow viewport, always render the complete touch drawer even when the desktop rail was previously collapsed.

**Why:** A narrow icon-only drawer hides section labels, nested reports, account identity, and the labelled logout action; it also makes touch navigation depend on hover tooltips.

**How to apply:** Keep a derived effective collapsed state aligned to the CSS desktop breakpoint rather than changing or clearing the saved preference. Test the transition from a persisted collapsed desktop rail to a mobile drawer.

Collapsed-rail tooltips must open inward from the viewport edge and have a real visual focus and hover presentation in Arabic/RTL, not only an accessibility-tree description.

**Why:** Logical inline positioning can be counterintuitive on a right-aligned RTL rail, and some nested popper triggers can expose hidden screen-reader text without mounting a visible popup.

**How to apply:** Prefer collision-aware poppers for standard rail controls. Where a local tooltip is needed, logical `start-full` opens inward from the sidebar (right in LTR, left in RTL); bind it to the icon with an accessible description and browser-check its non-zero visible box in both directions.