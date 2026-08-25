# Communication Centre Visual Refinement — Phase 2

**Date:** 20 August 2026  
**Scope:** Communication Centre interaction surfaces only: composer, attachments,
voice messages, mention and reaction pickers, conversation creation and member
selection, pinned messages, and media/files/voice browsing.

## Scope and preserved contracts

This refinement is presentation-only. It does not change any backend, database,
route, generated client, permission, offline-queue, realtime, notification,
attachment, mention, reaction, pin, conversation, membership, privacy, or
pagination behaviour.

The Phase 1 workspace shell remains intact: viewport-safe local scrolling,
responsive list/detail routing, conversation list, header, message stream, and
loading/empty/error treatment retain their established structure. The following
closed Communication rules also remain unchanged:

- Direct Messages are member-only, including for operational roles.
- Authorised non-member operational viewers never gain a membership record,
  read marker, or synthetic unread state.
- Attachment reads use authorised message-bound proxy URLs; no storage path is
  rendered by this UI.
- Delete For Me remains viewer-private; shared deletion remains separate.
- Realtime events remain identifier-led invalidations followed by authorised
  projections.
- Canonical reaction options, mentioned-user identifiers, upload capability,
  and existing recorder/upload mutations are retained.

## Current-head assessment

Before this work, the in-scope controls were functional and already used
translated labels, but had presentational gaps:

- the composer was a row of adjacent controls rather than one clearly bounded
  composition surface, and dense mobile spacing made its control hierarchy less
  immediate;
- pending non-image attachments lacked a visible size and full-name access;
- recording and preview states were usable but had less protection against
  narrow-width compression;
- the mention list and emoji popup could be visually tall relative to a mobile
  viewport;
- the creation dialog had scrolling content but no strongly separated
  viewport-safe action footer, and member chips only showed first names;
- pinned and gallery panels behaved as additional layout columns where open
  rather than compact responsive overlays, and the gallery had no error state.

These are presentation findings only. No functional or privacy defect was
observed in the existing implementation.

## Refinement delivered

### Composer, files, and voice

- The composer now uses tighter responsive spacing, a bounded text field, and
  visible focus treatment while retaining its Send-primary, disabled, pending,
  and keyboard contracts.
- Pending file chips remain compact, expose full filenames through titles,
  display available byte sizes, truncate safely, and keep translated removal
  actions. Image thumbnails remain small and removable without fake upload
  progress or storage metadata.
- Recording retains real MediaRecorder state and duration. Recording, stop,
  cancel, preview playback, send, and discard controls remain accessible and
  avoid overflow on narrow screens.
- The emoji picker is viewport-bounded. It still inserts at the current text
  cursor and uses the existing picker implementation.

### Mentions and reactions

- Mention suggestions retain their existing canonical member identities,
  listbox/option semantics, arrow-key selection, and `aria-activedescendant`
  contract while adding an explicit translated label and bounded scrolling.
- The reaction picker remains limited to the existing six allow-listed options,
  with the same toggle mutation and translated names.

### Conversation creation and members

- The New Conversation and announcement confirmation flow now has restrained
  responsive dimensions, a scrollable content region, and an anchored footer.
- Type-specific controls remain the only controls rendered for each
  conversation type. Announcement confirmation displays translated role labels
  rather than raw role payload values.
- Search results and selected-member chips use full-name truncation/title
  access, translated removal labels, listbox/option semantics, and visible
  keyboard focus.

### Pinned messages and media

- Pinned messages use a keyboard-operable trigger and a compact, responsive
  overlay with safe wrapping for long or mixed-direction content.
- The media/files/voice browser is a responsive overlay, not a persistent
  third column. Its tabs expose tab semantics, and it now distinguishes
  loading, empty, and retryable error states.
- File names and media actions remain proxy-URL based and keyboard-operable;
  no inaccessible/deleted/private content category was added.

## Localisation, RTL, and accessibility

- English and Arabic message dictionaries were kept structurally identical and
  include all new accessible names.
- Phase 2 layout uses logical start/end/border-start utilities and avoids
  physical left/right/border-left/border-right utilities.
- Controls retain translated accessible names, visible keyboard focus, native
  dialog focus management, listbox/option semantics where applicable, and
  full-value access for truncated labels.
- User-authored content, URLs, mentions, and file names remain verbatim and
  are protected from visual overflow using truncation or
  `overflow-wrap:anywhere`.

## Automated visual evidence

`src/test/communication-visual-refinement.test.ts` retains Phase 1
`COMM-VIS-01`–`COMM-VIS-12` and adds the concise source-contract sentinels
`COMM-FORM-VIS-01`–`COMM-FORM-VIS-12`. The rendered
`src/test/communication-upload-controls.test.tsx` suite additionally exercises
the composer send state, media tab semantics and keyboard movement, retryable
media errors, and the reachable creation-dialog footer.

| Sentinel | Coverage |
|---|---|
| COMM-FORM-VIS-01 | Compact bounded Send-primary composer |
| COMM-FORM-VIS-02 | Safe, removable pending attachments |
| COMM-FORM-VIS-03 | Accessible real recording state and duration |
| COMM-FORM-VIS-04 | Compact actionable voice preview |
| COMM-FORM-VIS-05 | Bounded, keyboard-labelled mentions |
| COMM-FORM-VIS-06 | Canonical accessible reaction options |
| COMM-FORM-VIS-07 | Responsive creation dialog and anchored footer |
| COMM-FORM-VIS-08 | Type-specific creation controls and role labels |
| COMM-FORM-VIS-09 | Searchable members and removable full-name chips |
| COMM-FORM-VIS-10 | Keyboard-operable pinned overlay |
| COMM-FORM-VIS-11 | Responsive media overlay and state distinctions |
| COMM-FORM-VIS-12 | Logical, translated focus and RTL hooks |

The existing rendered Communication upload-control suite continues to cover
attachment/voice capability visibility, keyboard-operable image/message
actions, route-ID hardening, socket listener cleanup, and the new Phase 2 DOM
interactions above.

## Verification

| Verification | Result |
|---|---:|
| Communication frontend suites | Passed — 45 tests |
| CAFA PMIS frontend TypeScript check | Passed |
| CAFA PMIS production build | Passed |
| Authenticated browser verification | See limitation below |

Focused frontend suites:

- `src/test/communication-visual-refinement.test.ts`
- `src/test/communication-i18n-accessibility-contract.test.ts`
- `src/test/communication-upload-controls.test.tsx`
- `src/lib/message-upload.test.ts`

## Browser verification limitation

No safe authenticated non-production browser session is available in this
environment. The messaging route redirects to Sign In when unauthenticated, so
an authenticated desktop/tablet/mobile English/Arabic visual pass cannot be
performed without using credentials. No production credentials were used.

Automated rendered interaction coverage, visual sentinels, typecheck, and the
production build provide the available evidence. An authenticated non-production
browser pass remains an environment-only verification opportunity, not a known
software residual.

## Deferrals and residual findings

No Phase 3 capability or behaviour was added. There are no known Phase 2 visual
residuals. The only outstanding evidence gap is the environment-only
authenticated browser limitation described above.