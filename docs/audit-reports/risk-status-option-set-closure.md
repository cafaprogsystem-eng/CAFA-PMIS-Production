# Risk Status Option Set Closure

## Status

CLOSED

## Canonical status set

The Risk API contract, generated `RiskStatus`, generated `UpdateRiskBody`, and
backend validation agree on these direct-edit values:

`open`, `under_mitigation`, `closed`, `identified`, `assigned`,
`mitigation_plan`, `follow_up`, `escalation`, and `mitigated`.

## Previous UI gap

The Edit Risk selector exposed only `open`, `under_mitigation`, and `closed`.
The remaining valid canonical values could be displayed from existing records
but could not be selected by an authorised editor.

## Final Edit behaviour

The editor now renders the complete shared frontend status option set. Select
item values remain the raw canonical enums, so the existing PATCH path submits
the selected value unchanged through `UpdateRiskBody`.

No transition filter or terminal-state lock was added. Risks currently marked
`closed` or `mitigated` can be set to any supported status by an already
authorised editor.

## Create behaviour

The Create Risk dialog still has no Status control. Its payload has no status
field and the existing API INSERT continues to create every risk as `open`.

## Localisation and presentation

Every canonical status has an English and Arabic `risks.status` label. The
shared status formatter supplies a readable title-cased fallback for unknown
future values rather than exposing underscore enums.

## Safety boundary

The Risk Register's intentionally narrow status filter remains separate from
the editor option set. Permissions, scope checks, backend routes, schema,
OpenAPI, and generated client behaviour were not changed.

## Tests

`RISK-STATUS-01` through `RISK-STATUS-10` cover canonical parity, Create
behaviour, Edit rendering, lack of transition filtering, reopening from closed
and mitigated states, bilingual labels, raw PATCH payloads, permission gating,
and the frontend/API contract boundary.

## Closure verdict

The Edit Risk UI is in parity with the supported direct PATCH status set while
preserving Create-as-open and all existing backend controls.