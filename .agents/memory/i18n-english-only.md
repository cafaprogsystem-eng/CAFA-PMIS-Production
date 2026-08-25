---
name: i18n English-only lock
description: Arabic/RTL fully removed from the CAFA PMIS front-end; platform is locked to British English.
---

## Rule
The platform is locked to British English. Do not add Arabic translations, RTL CSS, language-switcher UI, or `changeLanguage` calls.

## What was changed
- All `src/locales/ar/` JSON files deleted (17 files).
- `src/i18n.ts` rewritten: Arabic removed, `lng` hardcoded to `"en"`, no `changeLanguage`.
- `LanguageProvider` simplified: always returns `{ lang: "en" }`; no `setLang`/`isRtl`.
- `src/index.css`: removed `--font-arabic`, `[dir="rtl"]` block, `.leading-snug-ar`.
- Layout, login, forgot-password, reset-password pages: language-switcher footers and all `isRtl` ternaries removed.
- Profile/users pages: Arabic `<SelectItem value="ar">` entries removed.

## Exceptions — keep these as-is
- `manual.tsx` `language` state — this is a **document language** field for the system manual content, not UI i18n.
- `ai-settings.tsx` `responseLang` — business logic controlling the AI response language, not the UI.

**Why:** Single professional system language (British English) was a product decision; react-i18next infrastructure is retained because components still call `useTranslation()` for their English strings.
