---
name: i18n Phase 3 — Shell & RTL Foundation
description: What was done in Phase 3 and the rules for Phase 4+ business module work.
---

## What Phase 3 covered
Layout shell, sidebar RTL, header, breadcrumbs, profile menu, offline indicator,
notifications bell shell, messages dropdown shell, route error boundary, dialog/pagination
RTL, command palette, global search, bidi utility, 93 shell i18n tests.

## Completed components (all logical-CSS, all tNav/tCommon wired)
- `src/components/layout.tsx` — full sidebar RTL, route title map, navGroups translated
- `src/components/notifications-bell.tsx`
- `src/components/messages-dropdown.tsx`
- `src/components/offline-indicator.tsx`
- `src/components/route-error-boundary.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/pagination.tsx`
- `src/components/command-palette.tsx`
- `src/components/global-search.tsx` — **partially done; Phase 4 may extend**
- `src/components/bidi-isolate.tsx` — new utility

## Test file
`src/test/i18n-shell.test.ts` — 93 tests across §1–§7 (nav tooltips, brand, user menu,
command palette strings, pageTitles, cmdSubtitles, common sync, errors, RTL checks)

## Glossary alignment rule (discovered in Phase 3)
The Phase 2 glossary tests (`i18n-glossary.test.ts`) enforce exact Arabic strings for
top-level keys in `ar/common.json`. Any time you rewrite that file, verify these exact values:
- `risk` → "المخاطرة"
- `donor` → "الجهة المانحة"
- `submitted` → "مُقدَّم"   (note: fatha diacritic on م)
- `approved` → "مُعتمَد"
- `pending` → "قيد الانتظار"
- `reached_beneficiaries` → "المستفيدون الفعليون"

## Phase 4 scope (not started)
Business modules: Dashboard, Projects, Planning, Reports, Risks, Users, Audit Log.
Do NOT start until user confirms Phase 3 is accepted.

## Sidebar off-canvas transform — specificity pitfall (regression fixed)
`ltr:-translate-x-full` generates `[dir="ltr"] .ltr\:-translate-x-full` with specificity **(0,2,0)**.
`lg:translate-x-0` has specificity **(0,1,0)** inside a media query.
**The attribute selector always wins, hiding the desktop sidebar.**
**Rule:** Off-canvas transforms MUST use `max-lg:` scope:
```
max-lg:-translate-x-full max-lg:rtl:translate-x-full
```
Never use bare `ltr:-translate-x-full` or `rtl:translate-x-full` when a `lg:translate-x-0` override is expected.

## Architecture constants (carry forward)
- Provider order: LanguageProvider → RadixDirectionBridge → TooltipProvider → SyncProvider → Router
- `tNav` = `useTranslation("nav")`; `tCommon` = `useTranslation("common")`
- Tailwind logical CSS: `start-0`, `end-3`, `border-s`, `border-e`, `ps-*`, `pe-*`, `ms-*`, `me-*`
- RTL variants: `ltr:`, `rtl:`, `rtl:rotate-180`
- Module-level components that need i18n strings must receive them via props from the
  hook-owning parent (see GroupHeader.clearLabel / ItemRow.pinAriaLabel pattern in command-palette.tsx)

## Resource parity principle

**Why:** English fallback can make a missing Arabic resource invisible in
development while still shipping English UI to Arabic users.

**How to apply:** Any locale-key change must update both language resources and
keep the structural parity test at zero gaps; punctuation- and
interpolation-only fragments are the sole non-Arabic resource exception.
