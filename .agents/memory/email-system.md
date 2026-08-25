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
