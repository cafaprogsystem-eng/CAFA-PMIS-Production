---
name: Notification delivery-channel contract
description: Canonical rule for independently evaluating in-app and email notification delivery.
---

**Rule:** In-app and email notification channels must be evaluated and executed independently. `email_only` never creates an in-app row, `inapp_only` never invokes the mailer, and `both` evaluates each channel against its own category setting. Mandatory kinds retain their override of category preferences and quiet hours. Daily and weekly digests remain unavailable until a scheduler exists.

**Why:** An early return from the in-app path previously prevented eligible email-only and in-app-disabled/email-enabled notifications from reaching the mailer.

**How to apply:** Any future notification change must preserve separate `shouldCreateInApp` and `shouldSendEmail` decisions; realtime follows actual in-app persistence only, while mailer failures remain best-effort and cannot undo in-app delivery. Preference writes may reject unsupported values, but profile reads must canonicalise historic JSON to the current supported defaults rather than exposing legacy digest values or malformed keys through the API contract.