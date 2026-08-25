---
name: Notification email_verified gate
description: The notification dispatcher gates optional email delivery on email_verified; mandatory emails bypass it; null/undefined treated as verified for legacy accounts.
---

# Notification email_verified delivery gate

## Rule
`resolveActiveRecipient` fetches `email_verified` alongside the recipient row. `shouldSendEmail` accepts an `emailVerified: boolean` parameter and returns false for optional notifications when it is false. Mandatory kinds (risk_critical, password_changed, etc.) bypass the gate entirely.

**Why:** Optional notification emails must not reach accounts whose address has not been confirmed. Security/critical emails (password reset, critical risk alerts) must always reach the user regardless of verification status.

**How to apply:**
- `email_verified !== false` is the idiomatic check — null/undefined is treated as verified for pre-verification legacy rows.
- `shouldSendEmail(prefs, emailKey, isMandatory, emailVerified)` — pass `isMandatory=true` to bypass.
- Frontend: optional email switches must use `disabled={isDisabled}` (not just `pointer-events-none`) so keyboard users cannot toggle them either. Add a defensive guard in the setter for belt-and-suspenders.
