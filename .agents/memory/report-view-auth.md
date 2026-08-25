---
name: Report view auth helper
description: assertCanViewReport fail-closed rules and testing pattern
---
`assertCanViewReport` (lib/reportAuth.ts) guards report GET, attachment download/listing, and voice-note streams.

**Rule:** state roles (SPO/SOM) with no assigned state (`stateId=null`) must get 403 `state_scope_forbidden` — fail closed, matching `assertStateAllowed`.

**Why:** a truthy-check (`if (isStateRole && stateId)`) once made unassigned state users fail OPEN, exposing cross-state attachments/voice notes. Route-level tests (att02-hardening, path-hardening) always mock this helper, so its real logic needs direct unit tests (lib/reportAuth.test.ts, PMR-VAUTH-*).

**How to apply:** any change to reportAuth.ts must keep the null-state and empty-TC-sector fail-closed branches and their unit tests.
