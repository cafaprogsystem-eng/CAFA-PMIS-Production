# Communication Centre Arabic Localisation and Accessibility Closure

**Closure date:** 20 August 2026  
**Scope:** `COMM-019` and `COMM-020` only.

## Scope preserved

This work is limited to the Communication Centre web UI. It does not change
Communication API enum values, message/mention identity semantics, attachment
proxy behaviour, authorisation, realtime/read-state behaviour, or any
Notifications behaviour.

User-generated message text, display names, attachment names, and server-owned
enum values remain data rather than translated UI copy.

## Arabic and RTL localisation

- The `messages` Arabic namespace is fully populated and has exact leaf-key
  parity with the English namespace (201 keys in each locale).
- Conversation types, actions, filters, composer states, empty/loading/error
  states, pagination, attachments, voice messages, reactions, pins, member
  controls, announcements, search, and confirmation wording use the Messages
  translation namespace.
- Date and time display in Messages and the header Communications dropdown now
  use the active application language instead of forced English formatting.
- Communication layout uses logical start/end, inline-padding, and inline-border
  utilities for the updated surfaces. The back arrow mirrors in RTL.
- Arabic UI strings are deliberately distinct from message content and
  attachment file names, which remain verbatim user data.

## Functional accessibility

- Icon-only controls have translated accessible names, including attachment,
  voice recording, emoji insertion, gallery, reactions, message options,
  media opening/downloading, and attachment removal.
- Image tiles in both message bubbles and the media gallery are semantic
  keyboard-operable buttons.
- Message hover actions remain exposed when a keyboard user focuses within a
  message group.
- Voice seek inputs have an accessible name.
- Conversation search and composer inputs have accessible names; visible
  creation-dialog labels are associated with their text controls, and select
  triggers have explicit names.
- Mention suggestions use listbox/option semantics with Arrow Up/Down,
  Enter/Tab selection, Escape dismissal, and `aria-activedescendant`.
- Load-more and retry controls retain native button semantics and use
  translated text.

## Closure classification

| Item | Classification | Reason |
|---|---|---|
| `COMM-019` | CLOSED | Communication Chrome is translated through a complete Arabic Messages namespace, respects active-locale dates/times, and uses RTL-safe layout utilities without altering canonical data values. |
| `COMM-020` | CLOSED | Identified interaction controls are named and keyboard-operable; media, mentions, focus-revealed message actions, voice seeking, form controls, retries, and pagination have deterministic regression coverage. |

## Verification evidence

- Communication locale/accessibility contract tests and rendered Communication
  control tests: **10 tests passed**.
- The test fixture renders a message image and asserts that the media tile,
  reaction control, message-options control, composer, upload, voice, and
  emoji controls are discoverable by translated accessible name.
- CAFA PMIS TypeScript check: **passed**.
- CAFA PMIS production build: **passed**.
  Vite emitted existing sourcemap-location and large-chunk warnings, but no
  build failure.
- The CAFA PMIS web workflow was restarted and is running without startup
  errors.
- Fresh-browser route validation redirected `/messages` to Sign In as expected
  without a crash or client runtime exception. The only browser-console entries
  were expected unauthenticated `401` requests during the redirect.
  Authenticated live validation was unavailable because no safe non-production
  session was provided; this is an environment limitation, not a product
  defect. Rendered tests cover the changed interactive controls directly.