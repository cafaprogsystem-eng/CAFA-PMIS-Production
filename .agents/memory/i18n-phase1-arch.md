---
name: i18n Phase 1 Architecture
description: Arabic localisation infrastructure decisions and patterns established in Phase 1.
---

## What was built

**Phase 1 of CAFA PMIS Arabic localisation — infrastructure only. No module translation.**

### Key files changed
- `src/contexts/language-context.tsx` — fully unlocked; now exposes `lang`, `direction`, `setLang`
- `src/i18n.ts` — reads `localStorage["cafa.lang"]` before init; registers both `en` and `ar` resources; dev missing-key handler
- `src/App.tsx` — added `RadixDirectionBridge` wrapping `DirectionProvider` from `@radix-ui/react-direction`
- `src/components/layout.tsx` — language switcher in both collapsed and expanded profile dropdowns
- `index.html` — inline flash-prevention `<script>` before `#root`
- `src/lib/i18n.ts` — **DELETED** (orphaned LOGIN_STRINGS)
- `src/locales/ar/*.json` — 17 empty stub files (one per namespace)
- `src/test/i18n-infrastructure.test.ts` — 25 Phase 1 acceptance tests

### Architecture decisions

**LanguageContext unlocked:**
- `type Language = "en" | "ar"` — only two valid values
- `getStoredLang()` reads `localStorage["cafa.lang"]`, defaults to "en"
- `directionFor(lang)` → `"ltr" | "rtl"`
- `setLang()` → updates React state → `useEffect` updates `html.lang`, `html.dir`, localStorage, and calls `i18n.changeLanguage()`

**Why:** The old provider hard-locked to "en" and actively overwrote Arabic preferences. The new one is the single source of truth for language state.

**Provider order:** `QueryClient → LanguageProvider → RadixDirectionBridge (DirectionProvider) → TooltipProvider → SyncProvider → Router`

**Why:** `RadixDirectionBridge` must be inside `LanguageProvider` (needs `useLanguage()`) and outside all Radix components (Dialog, Popover, etc.). It reads `direction` from context and passes it to Radix's `DirectionProvider`.

**Flash prevention:** Inline `<script>` in `index.html` `<body>` reads `localStorage["cafa.lang"]` before React mounts and applies `html.lang` / `html.dir` immediately. Defaults to `"en"/"ltr"` on any error.

**Arabic stubs:** All 17 `ar/` namespace files are empty `{}`. `fallbackLng: "en"` ensures missing Arabic keys resolve to English text — never raw keys. Missing-key dev warning fires only for `"ar"` language hits.

**Language switcher:** In profile `DropdownMenuSub` in both collapsed (side="right") and expanded (side="top") sidebar profile menus. Options: English / العربية. Active option shows a checkmark.

**IBM Plex Sans Arabic** was already loaded in `index.html` fonts before Phase 1 — no font work needed.

### What Phase 1 does NOT do
- No module translation (dashboard, projects, plans, etc.)
- No physical CSS → logical CSS conversion (~700 instances, deferred to per-module phases)
- No bidi isolation for codes/IDs/emails (Phase 2+)
- No Arabic content in the 17 stub files (English fallback until translated)
- No RTL CSS fixes for tables, forms, charts (per-module)

### Package installed
- `@radix-ui/react-direction` — added to `artifacts/cafa-pmis/package.json`
