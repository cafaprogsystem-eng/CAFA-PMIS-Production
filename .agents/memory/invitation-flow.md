---
name: Invitation activation flow
description: How the in-app invite link works without SMTP, and what to change when wiring a real provider.
---

CAFA PMIS user activation is **in-app only** — there is no SMTP/SendGrid yet. When an admin creates a user with `status=invited` (or empty password), the server:

1. Generates a 7-day `inviteToken` + `inviteExpiresAt` on the row.
2. Calls the stubbed mailer (`artifacts/api-server/src/lib/mailer.ts`) which, with `MAILER_ENABLED` unset/false, logs the rendered email payload as structured JSON via `req.log`/`logger` and returns ok.
3. Returns the `inviteToken` in the API response.

The Users page surfaces the resulting `${origin}/invite/{token}` link in a copy box so the admin can share it via their own channel. Resend regenerates the token; Cancel clears it and sets `status=deactivated`.

**Why:** the product needed activation to ship before mail delivery infra was finalized. The stub keeps the entire flow (token issue → public accept page → auto-login) testable end-to-end without secrets.

**How to apply when wiring a real provider:**

- Implement the provider call inside `sendEmail()` in `lib/mailer.ts` behind the existing `MAILER_ENABLED` flag — do not branch in route handlers.
- Stop returning `inviteToken` to clients once email delivery is reliable (it's only exposed to support the manual-share fallback).
- Hide the copy-link box in `pages/users.tsx` when delivery is reliable; keep it for super_admin as an audit/diagnostic tool.
- Keep `POST /auth/accept-invite` idempotent on its happy path — it both activates and auto-logs in via the same `cafa_sid` cookie used by `/auth/login`.
