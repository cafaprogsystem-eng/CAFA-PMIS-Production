---
name: File-picker button activation
description: Safe interaction pattern for styled file-upload actions.
---

Use a ref-backed hidden file input and call its `.click()` from the visible Button. Do not nest an enabled button inside a label and depend on label activation.

**Why:** Browsers can suppress label activation when the original click target is an interactive descendant, leaving an apparently enabled upload action unable to open the file picker.

**How to apply:** For any upload action that uses the shared Button primitive, keep the file input separate, connect it through an explicit ref and `onClick`, and conditionally hide the action icon when the Button supplies its loading spinner.