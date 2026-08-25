---
name: API client declaration drift
description: Consumer typechecks validate emitted API-client declarations, which can lag behind contract source changes.
---

## Rule
Validate API-client contract changes from the consuming application, not only
from the client source tree.

**Why:** Composite TypeScript consumers use emitted declarations. A contract
change can look correct in source while consumers still receive a stale or
incompatible public declaration.

**How to apply:** Regenerate or rebuild the canonical client artifact before
consumer typechecks whenever its contract changes. Treat declaration drift as a
contract-build problem; do not patch consumers to accommodate stale types.
