---
name: jsdom localStorage unavailable under Node 26
description: 16 frontend test files fail with "Cannot read properties of undefined (reading 'getItem'/'setItem')" — test-environment setup issue, not an app bug.
---
16 test files in `artifacts/cafa-pmis` fail (159 tests total, confirmed via a temporary `git stash` compare against an untouched baseline — same failures pre-exist on main, unrelated to whatever feature work is in progress) with errors like `TypeError: Cannot read properties of undefined (reading 'getItem')` at `window.localStorage`, thrown from app code (e.g. `src/lib/offline/report-drafts.ts`) during component render inside jsdom.

**Why:** jsdom's `window.localStorage` is not available out of the box under the current Node version (26.8.1) used to run vitest — it needs Node's own `--localstorage-file` flag (or an equivalent jsdom/vitest environment option) to back `localStorage` with a real file, which the current vitest setup does not pass.

**Status:** Not yet fixed — purely a test-environment configuration gap, not application code. Affected files include `reports-form-visual.test.tsx`, `reports-open-param.test.tsx`, `profile-security-ui.test.tsx`, `spr-draft-edit.test.tsx`, `spr-duplicate-check.test.tsx`, `spr-hqsr-form-visual.test.tsx`, and others that render a page/component touching `localStorage` (offline drafts, recent items, favorites, language preference).

**How to apply when picked up:** pass `--localstorage-file <path>` to the Node process running vitest (or configure it via the vitest/vite config's `test.environmentOptions`), or add a jsdom localStorage polyfill in the test setup file, then re-run the full frontend suite to confirm the count drops to zero and no other regressions were masked underneath these failures.
