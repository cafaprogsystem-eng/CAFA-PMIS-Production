---
name: Connectivity evidence model
description: Rules for deciding verified Offline separately from API, session, and realtime outcomes.
---

Only bounded failures of the same-origin CAFA health probe may put the client
into verified Offline. Browser network events and normal request failures are
hints that request a probe; HTTP responses, cancellations, and realtime socket
state are never proof of an Offline outage. A Degraded service banner likewise
needs two bounded 5xx observations, not one route response.

**Why:** A single failed request can be route-specific, cancelled, an API
problem, or an authentication decision. Treating it as an outage incorrectly
enables offline cache and draft queue policies.

**How to apply:** Keep health probes cache-safe and public, require two
transport failures within the confirmation window for Offline and two
service-failure observations for Degraded, and restore normal replay only after
successful evidence. Preserve a known 401/403 across a public health success;
only authenticated API success may clear that gate.