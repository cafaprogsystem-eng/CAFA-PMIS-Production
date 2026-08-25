---
name: Rendered page tests
description: How to render full pages (e.g. ReportsPage) in vitest/jsdom without loops or Radix crashes
---
Rule: when integration-testing a full page, mock `@workspace/api-client-react` so every hook returns the SAME module-level object each call; returning a fresh `{data:...}` per render triggers "Maximum update depth exceeded" via identity-keyed effects.
**Why:** page effects depend on hook data identity; unstable mocks loop forever.
**How to apply:** see `src/test/pmr-a11y-rendered.test.tsx` pattern — stable() factory, shared mutation object, TooltipProvider wrapper, jsdom shims (scrollIntoView, pointer capture, ResizeObserver, matchMedia), react-i18next mock returning keys, global fetch stub.
Also: PMR blank activity row has `actualExpenditure: undefined` → coerces to 0, so the "required" expenditure error never fires for it; use a negative value to exercise that error path in tests.
