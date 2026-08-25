---
name: Global Location Context Architecture
description: How the global location selector is implemented for HQ roles — context, persistence, and page wiring.
---

# Global Location Context Architecture

## Rule
LocationProvider wraps the authenticated Router (inside AuthGate's SocketProvider in App.tsx). The context exposes `selectedStateId: number | null` (null = All Locations HQ) to all pages. GlobalLocationSelector in the header is visible only when `isEditable = true`.

**Why:** HQ roles (super_admin, executive_director, program_manager, senior_program_coordinator, technical_coordinator) can scope all data to a specific state without changing their RBAC. State-scoped roles (state_office_manager, state_program_officer, viewer) have a fixed scope.

## How to apply
- Import `useLocationContext` from `@/contexts/location-context` to read the selected state.
- In Dashboard: `summaryParams` uses `selectedStateId` directly (no local stateId filter).
- In Projects/Reports/Plans/Budget: a `useEffect(() => { setLocalStateId(ctxStateId); }, [ctxStateId])` syncs local state with context.
- In Risks: a mount-only `useEffect([], [])` reads `window.location.search` and navigates to include context stateId if none is in URL.
- URL persistence: `history.replaceState` keeps `?location=<stateId>` in URL; `popstate` listener syncs Back/Forward; sessionStorage is the cross-navigation fallback.
- Backend: `resolveLocationContext(user, queryStateId)` helper in `artifacts/api-server/src/lib/accessControl.ts` enforces state-scoped role clamping. Dashboard already has equivalent logic via `userScope()`.
- i18n keys: `locationContext.allLocations`, `locationContext.label`, `locationContext.searchPlaceholder`, `locationContext.noLocations` in both `en/common.json` and `ar/common.json`.
