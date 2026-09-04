---
name: Email system configuration
description: How the mailer works, which env vars control it, and what was built for the email verification + invitation flows.
---

## Provider selection
- `EMAIL_PROVIDER=resend|sendgrid|smtp|stub` — controls which backend to use
- `EMAIL_ENABLED=true` — must be set to actually send; when false (or unset), falls back to stub logging and returns `devVerifyLink` / `devResetLink` in API responses
- `MAILER_ENABLED` is a deprecated alias for `EMAIL_ENABLED` (backward compat kept)

## Required env vars for live sending
```
EMAIL_ENABLED=true
EMAIL_PROVIDER=resend          # or sendgrid / smtp
EMAIL_API_KEY=re_xxx           # Resend or SendGrid API key
EMAIL_FROM_ADDRESS=noreply@example.org
EMAIL_FROM_NAME=CAFA Program Management System
EMAIL_REPLY_TO=support@example.org   # optional
APP_BASE_URL=https://your-domain.replit.app
```

## SMTP-specific extras
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=secret
SMTP_SECURE=false   # true for port 465
```

## What was built
- `email_logs` table — every send attempt logged with status (pending/sent/failed), provider, messageId, error
- Delivery-facing invitation UI must consume the mailer's explicit `pending`/`sent`/`failed` outcome, not infer state from a `delivered` boolean.
  **Why:** Stub mode is intentionally pending, while a configured provider can fail; both return `delivered: false` but must never be presented as the same outcome.
  **How to apply:** Preserve `emailDelivered` only for compatibility and return/persist the delivery status when a user-facing workflow needs accurate delivery copy.
- `email_verification_tokens` table — 24h single-use tokens for email verification
- `users.email_verified` + `users.email_verified_at` — verification state
- `POST /auth/send-verification-email` — public, rate-limited (5/hr/IP), returns devVerifyLink in stub mode
- `GET /auth/verify-email?token=` — public, marks email_verified=true
- `POST /users/:id/resend-verification` — admin, re-issues verification token
- Accepting an invite automatically sets email_verified=true (proves email ownership)
- mailer.ts has retry logic (3 attempts with 1s/2s backoff)

## Templates available
renderPasswordResetEmail, renderPasswordResetConfirmEmail, renderInviteEmail, renderVerifyEmail, renderAccountActivatedEmail, renderAccountDeactivatedEmail

## New frontend pages (all outside AuthGate)
- `/verify-email?token=` — validates token, shows success/error state
- `/email-verification-sent?email=` — "check your inbox" with resend button
- `/password-reset-sent?email=` — neutral confirmation after forgot-password

**Why:** Tokens are hashed before DB storage (SHA-256); neutral responses prevent email enumeration; invite-accept proves email ownership so no separate verification needed for invited users.

## Monthly reporting reminder requires EMAIL_PROVIDER=resend — or the whole server refuses to boot
`lib/scheduler.ts`'s `startSchedulers()` calls `assertMonthlyReminderMailerConfiguration()` (in `mailer.ts`) before starting anything, and `index.ts` crashes the process (`process.exit(1)`) on any startup throw. That assertion throws whenever `EMAIL_ENABLED=true` and `EMAIL_PROVIDER` is anything other than `resend` (SMTP and SendGrid can't guarantee crash-safe idempotent delivery, so a duplicate reminder send is possible with them) — and this only matters if the monthly-reporting scheduler is itself enabled (`MONTHLY_REPORTING_ENABLED`, defaults to `true`).

**Why this matters for going live:** `infra/aws-staging/template.yaml`'s application task currently sets `EMAIL_PROVIDER=smtp` with `EMAIL_ENABLED=false` (stub mode, safe for now). The moment `EMAIL_ENABLED` is flipped to `true` for real delivery without also changing `EMAIL_PROVIDER` to `resend`, the entire API server will crash-loop at startup — not just the reminder feature failing quietly.

**How to apply:** when configuring real email for production, either set `EMAIL_PROVIDER=resend` specifically, or explicitly set `MONTHLY_REPORTING_ENABLED=false` if another provider (SMTP/SendGrid) is required for the other email types and the monthly reminder is deliberately being deferred.

The monthly-reporting scheduler itself is a real, running in-process `setInterval` poller (not EventBridge/external cron) — confirmed active on staging via `SCHEDULER_ENABLED=true` in the application task definition. Manual verification without waiting for the schedule: `POST /reports/monthly-reporting/evaluate` (permission `reports.approve.final`), body `{"dryRun": true}` to preview without sending.
