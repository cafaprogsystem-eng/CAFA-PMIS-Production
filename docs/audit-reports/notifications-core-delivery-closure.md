# Notifications Core Delivery Correctness — Wave 1 Closure

**Closure date:** 19 August 2026  
**Scope:** `NOTIF-001` and the canonical delivery-channel contract.  
**Status:** Closed after implementation and verification.

## Canonical delivery contract

Notification delivery now evaluates the two channels independently:

- `shouldCreateInApp` decides whether to persist an in-app notification and
  emit its realtime event.
- `shouldSendEmail` decides whether to invoke the mailer.

The two decisions are made before either channel executes. One channel no
longer returns early and accidentally prevents the other from being evaluated.

| Delivery option | In-app channel | Email channel |
|---|---|---|
| `both` | Evaluated against its own category preference | Evaluated against its own category preference and quiet hours |
| `inapp_only` | Evaluated and, if allowed, created | Not invoked |
| `email_only` | Not created | Evaluated and, if allowed, invoked |

Disabling an in-app category does not suppress an independently enabled email
category, and disabling an email category does not suppress an independently
enabled in-app category.

## Preserved behaviour

- Preference merge behaviour is unchanged.
- Mandatory security/critical notifications retain their canonical override:
  they bypass category preferences and quiet hours, and use the default
  dual-channel delivery policy.
- Quiet hours continue to suppress only non-mandatory email delivery; they do
  not suppress eligible in-app notifications.
- Realtime delivery occurs only after an in-app notification row is actually
  created.
- Email remains best-effort. Provider failure or stub mode cannot roll back or
  alter successful in-app persistence.
- Email-only delivery does not insert a notification row and therefore returns
  `0`, while still invoking the email channel when eligible.

## Digest boundary

Daily and weekly digest settings remain **COMING SOON / unavailable** until a
scheduler exists. This closure does not claim or implement scheduled digest
delivery, and does not redesign digest behaviour.

## Verification

Added `notifications-delivery.test.ts` with an exhaustive sentinel matrix:

- delivery: `both`, `inapp_only`, `email_only`;
- in-app category: enabled and disabled;
- email category: enabled and disabled;
- mandatory: true and false;
- quiet hours: active and inactive;
- provider outcomes: success, failure, and stub.

The matrix has 144 combinations, plus two side-effect isolation tests covering
email-only and email-failure behaviour.

Verified:

- **146 notification delivery tests passed**;
- correct in-app database insertion count for every matrix case;
- realtime emission only when an in-app row is created;
- email invocation only when the independent email decision permits it;
- no duplicate channel invocation or self-side effect;
- API production build passed.

No Communication Centre routes, visual surfaces, `NOTIF-002`, or `NOTIF-003`
were changed.

## Type-check note

The API workspace-wide TypeScript check remains blocked by existing generated
contract drift in Risk, Reports, and Plan test surfaces. After this closure's
fix, it reports no error in the notification delivery implementation; the API
production build and targeted tests above pass.