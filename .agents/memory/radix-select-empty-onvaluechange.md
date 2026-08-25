---
name: Radix Select spurious empty onValueChange
description: Programmatic form.reset to a value whose SelectItem isn't mounted makes Radix Select fire onValueChange("") in jsdom, silently wiping the field.
---

Rule: any RHF-bound Radix `<Select onValueChange={...}>` whose value can be set programmatically (form.reset hydration) must guard the handler: `if (val) form.setValue(...)`.

**Why:** Radix Select keeps a hidden native `<select>` for form bubbling. When the controlled value changes to an item whose `SelectItem` isn't registered yet (content unmounted), the native select emits a change with `""`, which propagates to `onValueChange("")` and silently reverts the hydrated value. Seen during HQ Sector Report edit-mode hydration (frequency reverted to "" after reset to "on_demand").

**How to apply:** When hydrating edit forms via `form.reset`, add the empty-value guard on every Radix Select handler.
