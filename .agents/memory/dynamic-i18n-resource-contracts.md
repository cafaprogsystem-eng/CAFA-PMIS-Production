---
name: Dynamic i18n resource contracts
description: How to keep dynamic translation keys and external enum values from reaching users as internal identifiers.
---

When a component constructs i18n keys from an ordinal or API enum, ship the complete resource subtree in every production locale and test the source-to-resource contract for each reviewed dynamic prefix. Treat unknown server values as a localised safe label, never as the identifier itself.

**Why:** A whole missing resource subtree can make i18next return user-visible internal lookup keys even when locale-parity tests pass.

**How to apply:** Add the complete structurally parallel resources first, explicitly enumerate dynamic key families in the resource test, and render deterministic known and unknown values in both languages to catch raw visible or accessible output.