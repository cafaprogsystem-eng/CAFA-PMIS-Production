---
name: Create Plan Modal Architecture
description: Architecture of the Create Plan modal that replaced the /plans/new full-page form.
---

## Rule
`CreatePlanDialog` is the single Plan creation entry point. `/plans/new` is a retired route — PlanDetailPage redirects to `/plans` when `planId === "new"`.

## Why
The old full-page `/plans/new` form contained Activities, Budget, Geographical Coverage, and Related Project — far more than needed to establish a Draft. The modal collects only the 7 minimum fields and opens the created Draft in Plan Details edit mode.

## Component: `artifacts/cafa-pmis/src/components/create-plan-dialog.tsx`
- Pattern mirrors Create Project: `Dialog + max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden`
- Header: `px-6 pt-6 pb-4 border-b shrink-0` / `DialogTitle` + `DialogDescription`
- Body: `overflow-y-auto flex-1 px-6 py-6`
- Footer: `px-6 py-4 border-t shrink-0`
- 7 fields: title, planType, stateId, responsibleName, sectors[], startDate, endDate (+ optional description)
- `submitted` flag (not `touched`) gates error display — no premature validation messages
- TC sectors: reads `me.user.sector` (comma-separated) cast via `(me?.user as unknown as Record<string, string|undefined>)?.sector`
- On success: toast "Plan Created" + "[code] has been created as a Draft." → invalidate `/api/plans` + `/api/plans/dashboard` → navigate to `/plans/${id}?edit=1`

## plans.tsx
- `canCreate = hasPerm(perms, "*") || hasPerm(perms, "plans.create")` — `projects.create` removed (spec §4)
- `[createDialogOpen, setCreateDialogOpen]` state — button onClick, not Link href
- `<CreatePlanDialog open={...} onOpenChange={...} defaultPlanType={lockedType} />` at JSX bottom

## plan-detail.tsx
- `isNew` redirect: `useEffect(() => { if (isNew) setLocation("/plans"); }, [isNew, setLocation])`
- `if (isNew) return null` guard after all hooks (before main render)
- `useState(false)` for `isEditing` (not `useState(isNew)`)
- Edit mode via `?edit=1`: `useEffect` + `useRef(false)` guard; only fires when `canEdit && hasEditParam && !isNew`
- Section 1 title: `{t("detail.section1")}` → "1. Plan details" (i18n key was already correct)
- `useRef` added to imports

## Registration-session token architecture (fully hardened — three-pass model)
Table: `plan_registration_sessions` (id, plan_id, user_id, token_hash, created_at, expires_at, closed_at).
Helper: `artifacts/api-server/src/lib/plan-registration-session.ts` — createRegistrationSession / validateRegistrationSession / closeRegistrationSession / revokeRegistrationSessionsByPlan.
Token: randomBytes(32).toString('hex') raw; SHA-256 hash stored in DB; raw token returned once in POST /plans response as `registrationToken`.
Expiry: 2 hours (REGISTRATION_SESSION_EXPIRY_HOURS).

PATCH /plans/:planId permission logic:
1. If user has `plans.update` → allow immediately (no token needed).
2. If user has `plans.create` only → require `req.body.registrationToken`; call validateRegistrationSession(token, planId, userId); also check plan status=draft. Any failure → 403.
3. Otherwise → 403.

Creator + draft + approvalCount alone is NOT sufficient (old bypass REMOVED). The token is the sole proof.

Session revocation:
- Save & Finish (PATCH with closeRegistration:true): atomically close within PATCH transaction via client.query UPDATE.
- Cancel/Close (frontend calls POST /plans/:planId/close-registration with token): closes session, writes audit.
- Submit transition: revokeRegistrationSessionsByPlan(planId) called before status UPDATE.
- Natural expiry: expires_at > NOW() check in validateRegistrationSession.

Frontend: registrationToken stored in React state only (not localStorage, not sessionStorage). Cleared in handleReset. Page refresh loses token → view-only (safe behaviour). Close-registration API called on cancel only — NOT on initial Save & Finish.

## Initial Save & Finish (Path B) — atomic equivalence

POST /plans accepts optional `closeRegistration: true` (initial Save & Finish before any draft save).
When present:
1. createRegistrationSession(client, planId, userId) → rawToken (inside BEGIN)
2. Immediately UPDATE plan_registration_sessions SET closed_at=NOW() (inside same BEGIN, using sha256(rawToken) to identify the row)
3. COMMIT — Plan + closed session both committed; no active session survives.
4. Audit event: `registration_completed` (not `registration_started`)
5. Response: plan object only — no `registrationToken` field.

Without the flag (Save As Draft): session left active, raw token returned in response, audit = `registration_started`.

Frontend handleComplete(): when draftPlanId == null, passes `{ ...payload, closeRegistration: true }` in the POST body.
createMutation.onSuccess complete-path: NO closeRegistrationApi() call — the server guarantees the session is already closed.
No second network request after successful initial Save & Finish.

**Why:** the old fire-and-forget closeRegistrationApi().catch(()=>{}) left an active 2-hour session when the separate Close call failed — not acceptable for an explicit Save & Finish.
**How to apply:** any future path that creates-then-completes in one step must pass closeRegistration=true in the POST body. Never add a post-onSuccess close call for the complete path.

## Tab 5 final action
Label: **"Save & Finish"** (not "Complete Plan" or "Save Changes").
Sends `status: "draft"` — does NOT submit, trigger any approval transition, or change plan status.
Success toast: "Plan Registration Completed" + "[Code] has been saved as a Draft. Review the Plan and submit it for approval when ready."

## How to apply
- Any new Plan creation must go through `CreatePlanRegistrationDialog` (5-tab).
- Any endpoint that reads `canCreate` in plans.tsx must use `plans.create` only — not `projects.create`.
- The old `create-plan-dialog.tsx` is deleted — do not reference it.
- "Save & Finish" must always send `status: "draft"`. Submit For Approval is a separate explicit action in Plan Details.
- When modifying the PATCH handler, preserve both the `hasUpdatePerm` fast-path and the creation-session three-condition check in that order.
