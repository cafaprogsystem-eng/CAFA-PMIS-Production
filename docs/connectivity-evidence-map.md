# CAFA PMIS connectivity evidence map

The yellow Offline state represents a confirmed loss of access to the
same-origin CAFA API. It does not represent an API error, a login decision, or
the state of realtime updates.

## Evidence and transitions

| Signal | Previous behaviour/risk | Canonical handling |
| --- | --- | --- |
| `window` `offline` event | A browser hint could immediately show Offline in a proxied iframe. | Record `checking`; run a bounded same-origin probe. |
| `window` `online` event | A browser hint could immediately restore Online while the API remained unreachable. | Record `checking`; restore only after a successful probe. |
| Same-origin `GET /api/healthz` 2xx | Health was reduced to one boolean and a single failure showed Offline. | Record `probe-success`; restore Online and reset failures unless a known 401/403 still requires authenticated recovery. |
| Health probe timeout/transport error | One timeout was treated as a confirmed outage. | Record one transport failure, then confirm with a second probe; two failures inside a five-second window become Offline. |
| Health probe 4xx/5xx | Server/auth problems were indistinguishable from an outage. | 401 → Authentication required, 403 → Access denied, 5xx → Degraded; never Offline. |
| Normal same-origin API 2xx | Successful traffic did not help recover state. | Record recovery evidence and reset failed confirmations. |
| Normal API 401/403 | Could be misread as network failure. | Keep Authentication required and Access denied separate from Offline. |
| Normal API other 4xx | Validation/business failures could trigger offline handling. | Treat as proof CAFA answered; remain Online. |
| Normal API 5xx | Server failure could be presented as a user's offline state. | Degraded only; do not enable offline cache/queue policy. |
| Normal API transport failure | A single request can fail during a transient blip or path-specific proxy failure. | Request a same-origin health confirmation; it never directly counts toward Offline. |
| Request cancellation/AbortError | React Query cancellation can look like a network error. | Ignore as connectivity evidence. |
| Socket.IO connect/reconnect/disconnect | Realtime loss does not imply REST/API loss. | Keep in the realtime indicator only; never change CAFA connectivity. |
| React Query retries/focus/resume | Retries and lifecycle events are not proof by themselves. | Focus/resume requests a probe; only probe/API evidence transitions state. |
| Service worker/cache | Cached shell/data can hide API reachability or make a request appear successful. | API state uses same-origin health/traffic; offline reads remain gated by the canonical Offline state and existing Dexie policy. |
| Sync queue and attachment queue | Queue presence could be mistaken for an outage. | Queues do not change connectivity; replay runs only after confirmed Online. |
| External websites | Third-party reachability is not CAFA reachability and is privacy/availability-sensitive. | Never queried or used. |

## State contract

- **Online**: CAFA answered successfully; normal requests run and approved
  online-only actions are not converted to offline work.
- **Checking**: evidence is inconclusive; no offline cache or queue policy is
  enabled.
- **Offline**: two bounded transport confirmations failed; only this state
  enables the existing authorised cache and eligible draft queue.
- **Degraded**: CAFA answered with a server failure; work is not silently
  queued as if the user's network were offline.
- **Authentication required / Access denied**: CAFA answered with 401/403;
  route-level auth and permission handling remains responsible for the user
  experience. A public health probe cannot clear this outcome or resume queue
  replay; only a successful authenticated API response can.

The health route is public by design, lightweight, and sends `Cache-Control:
no-store, no-cache, must-revalidate` plus `Pragma: no-cache`.