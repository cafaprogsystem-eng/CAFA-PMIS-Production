# Communication Centre Visual Refinement — Phase 1

**Date:** 20 August 2026  
**Scope:** Main messaging workspace only: page shell, conversation sidebar, active
conversation header, message stream, and loading/empty/error states.

## 1. Scope

Phase 1 refines the visual hierarchy, density, spacing, surface treatment,
responsive structure, long-content handling, and interaction states of the
Communication Centre workspace.

It does not redesign the composer, upload/recording flow, mention picker,
reaction picker, creation dialog, member management, media/pinned panels, or
auxiliary search/media surfaces. Those remain intentionally deferred to Phase 2.

## 2. Functional Baseline Preserved

No backend, database, route, OpenAPI, generated-client, permission, security,
realtime, notification, pagination, reaction, pin, or message lifecycle
behaviour changed.

The previously closed Communication baseline remains intact:

- `COMM-001`–`COMM-020`: CLOSED;
- `COMM-021`: accepted no-per-message-receipt design constraint;
- Direct Messages remain member-only for every role;
- non-Direct operational access, `unreadCount: null`, cursor pagination, Load
  older, Load more, private Delete For Me, shared Delete For Everyone,
  structured mentions, proxy-only attachments, and identity/refetch realtime
  remain unchanged.

## 3. Current-Head Visual Assessment

Before this refinement, the main screen already had functional local scrolling,
responsive list/detail routing, skeletons, empty states, and accessible
controls. Its remaining visual issues were presentation-level:

- the workspace boundary read more like adjacent generic panels than one
  cohesive collaboration workspace;
- sidebar rows were slightly roomier than necessary for high-volume scanning;
- selected/focus hierarchy was less explicit than it could be;
- the header and empty states used more vertical emphasis than the messaging
  surface needs;
- long message content and shared deletion treatment could be more deliberate;
- desktop hover-only visual affordance for actions did not make mobile access
  immediately obvious.

## 4. Workspace Shell

- Created a cohesive viewport-aware messaging workspace with restrained
  structural borders and an existing-token surface.
- Preserved `100dvh` viewport safety and local internal scrolling without a
  brittle fixed pixel height.
- Used a responsive sidebar clamp on desktop/tablet to protect active
  conversation space.
- Retained the focused list/detail navigation pattern on mobile.
- Kept the screen dense and structural rather than introducing nested card
  stacks, large shadows, or decorative surfaces.

## 5. Conversation Sidebar

- Tightened the sidebar header, search, filters, list rows, skeletons, and
  pagination control into one clear hierarchy.
- Kept the primary New Conversation action visible but compact.
- Refined the search input with token-backed surface, visible focus treatment,
  accessible placeholder, and search icon.
- Retained current server-side search/filter behaviour and made filter state
  explicit with `aria-pressed`.
- Reduced row padding/avatar size while preserving comfortable click targets.
- Added visually restrained selected, hover, focus-visible, timestamp, and
  unread treatments.
- Long names truncate with full-name title access; message previews remain
  single-line and server-authorised.
- `unreadCount: null` is not coerced or rendered as zero.
- Kept true-empty and filtered/search-empty presentations visually distinct.
- Made Load more a compact integrated footer control while retaining cursor,
  loading, error/retry, and keyboard behaviour.

## 6. Conversation Header

- Reduced the active header to a compact persistent orientation surface.
- Retained avatar/type identity, relevant current metadata, media action, and
  type label without inventing presence, receipt, or unsupported status data.
- Added safe truncation plus full-value title access for long conversation
  names; actions remain within the viewport.
- Preserved the existing RTL-aware mobile back action.

## 7. Message Stream

- Tightened stream padding and spacing while retaining local history scrolling.
- Applied a readable responsive maximum width to bubbles and
  `overflow-wrap:anywhere`/preserved whitespace for long Arabic, English, URL,
  filename, mixed-language, and unbroken-token content.
- Kept own/other ownership position and token-backed contrast distinct without
  relying on colour alone.
- Refined non-own bubbles, reply context, forwarded indicator, reactions,
  attachments, image dimensions, and voice alignment without altering their
  data or actions.
- Made reply context visually subordinate with a logical border-start and
  muted surface.
- Made shared-deletion tombstones intentionally subdued/dashed without exposing
  deleted content. Private hides remain absent rather than replaced with a
  placeholder.
- Retained keyboard focus reveal on desktop and made compact message actions
  visibly reachable on mobile, without hiding actions behind hover alone.

## 8. Loading / Empty / Error States

- Sidebar loading uses row-shaped avatar/name/preview/timestamp skeletons.
- Initial history loading uses message-shaped alternating skeletons.
- Loading older stays local to the top history control and does not replace
  loaded messages.
- Sidebar error, filtered/true empty, no active conversation, selected
  conversation with no messages, and history error remain distinct states.
- Empty states are intentionally restrained and no heavier than the active
  messaging surface.

## 9. Responsive Behaviour

- Desktop/tablet use a responsive clamped sidebar with a structural divider.
- The mobile flow remains list-first/detail-first rather than crushing two
  columns together.
- Existing navigation, Back control, local list/history scrolling, and composer
  boundary are retained.
- Message bubbles and media previews have responsive maximum widths/heights;
  long content does not require page-level horizontal scrolling.

## 10. Arabic / RTL Preservation

- Continued use of logical `start`/`end` utilities and RTL-aware mobile Back
  arrow.
- No physical left/right/border-left/border-right utility was introduced.
- Existing English/Arabic Message namespace parity remains covered.
- Locale-aware date/time formatting is unchanged.
- User-authored message content, names, entity names, and filenames remain
  verbatim rather than translated.

## 11. Accessibility Preservation

- Conversation rows remain native buttons, keyboard-operable, and now expose
  selected state through `aria-current`.
- Filter controls expose pressed state and retain visible keyboard focus.
- Long row/header names preserve full values via titles while visually
  truncating.
- Message action controls preserve translated accessible names and
  focus-visible reveal.
- Media, voice, attachments, mentions, reply context, pagination, and retry
  controls retain their existing semantic/keyboard contracts.

## 12. Visual Sentinels

Added `src/test/communication-visual-refinement.test.ts`:

| Sentinel | Coverage |
|---|---|
| COMM-VIS-01 | Compact cohesive viewport-aware workspace shell |
| COMM-VIS-02 | Responsive sidebar/detail and focused mobile flow |
| COMM-VIS-03 | Compact scannable conversation rows |
| COMM-VIS-04 | Long conversation-name truncation and full-value access |
| COMM-VIS-05 | `unreadCount: null` is never rendered as zero |
| COMM-VIS-06 | Selected and keyboard conversation state |
| COMM-VIS-07 | Compact truncation-safe active header |
| COMM-VIS-08 | Long message wrapping and readable maximum width |
| COMM-VIS-09 | Visually subordinate reply preview |
| COMM-VIS-10 | Focus-accessible/mobile-reachable message actions |
| COMM-VIS-11 | Initial versus incremental history loading |
| COMM-VIS-12 | No-active-conversation versus no-messages distinction |

The same suite also guards no Seen/Delivered UI, absence of `objectPath` in the
public attachment shape, preserved RTL hooks, and availability of Load older /
Load more. Existing rendered Communication tests continue to cover interactive
controls, socket cleanup, keyboard media/action access, and upload capability
visibility.

## 13. Regression Results

| Verification | Result |
|---|---:|
| Phase 1 visual/frontend suite | **29 passed / 29 total** |
| Backend Communication regression | **105 passed / 105 total** |

Frontend suite files:

- `src/test/communication-visual-refinement.test.ts`
- `src/test/communication-i18n-accessibility-contract.test.ts`
- `src/test/communication-upload-controls.test.tsx`
- `src/lib/message-upload.test.ts`

Backend coverage was run across the seven existing Communication lifecycle,
confidentiality/IDOR, contract, mentions/validation, upload capability,
upload transport, and attachment provenance suites.

## 14. TypeScript / Build

- CAFA PMIS frontend TypeScript check: **passed**.
- CAFA PMIS frontend production build: **passed**.
- Phase 1 changed-file errors: **0**.
- Communication-owned frontend errors: **0**.

Existing unrelated repository diagnostics were not changed.

## 15. Browser Verification

**AUTHENTICATED BROWSER VERIFICATION — ENVIRONMENT LIMITATION**

No safe authenticated non-production browser session was available. `/messages`
redirected to Sign In correctly; expected unauthenticated `401` requests were
the only browser-console errors. No production credentials were used.

Automated rendered and source-informed visual sentinel evidence remains valid.
An authenticated visual pass at desktop, laptop, tablet, mobile, English, and
Arabic is the remaining environment-only verification opportunity.

## 16. Deferred Phase 2 Items

- Composer visual/interaction redesign.
- Attachment upload interaction.
- Voice recording interaction.
- Mention picker visual treatment.
- Reaction picker visual treatment.
- Create Conversation dialog.
- Member management.
- Pinned/media panels.
- Search/media auxiliary surfaces.

No Phase 2 implementation was started.

## 17. Residual Visual Findings

**NONE**

The only outstanding item is the authenticated-browser environment limitation
recorded above; it is not a known visual defect or Communication software
residual.