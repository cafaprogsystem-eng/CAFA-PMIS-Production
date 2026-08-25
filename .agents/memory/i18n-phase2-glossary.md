---
name: i18n Phase 2 — Arabic Glossary & Standards
description: Authoritative Arabic terminology, English conflicts found, files seeded, and consistency test architecture.
---

## What was established

Phase 2 created the single authoritative Arabic terminology glossary and seeded the three shared namespaces.

### Files created / modified
- `src/locales/CAFA_ARABIC_GLOSSARY.md` — canonical reference (never modify without team review)
- `src/locales/ar/common.json` — fully seeded (all 170+ keys translated)
- `src/locales/ar/nav.json` — fully seeded (all groups/items/user/tooltips/brand)
- `src/locales/ar/errors.json` — fully seeded (all 36 keys translated)
- `src/test/i18n-glossary.test.ts` — 63 consistency tests across 6 groups

### Approved canonical terms (subset — see glossary for full list)
| English | Arabic |
|---|---|
| Draft | مسودة |
| Submitted | مُقدَّم |
| Approved | مُعتمَد |
| Technically Approved | موافقة تقنية |
| Coordination Approved | موافقة التنسيق |
| Returned | مُعاد |
| Active | نشط |
| Completed | مكتمل |
| Cancelled | ملغى |
| Project | المشروع |
| Plan | الخطة |
| State (administrative) | الولاية |
| Sector | القطاع |
| Donor | الجهة المانحة |
| Dashboard | لوحة التحكم |
| Budget | الميزانية |
| Reports | التقارير |
| Risks | المخاطر |

### English terminology conflicts to resolve before Phase 3
1. `super_admin` → "System Administrator" (dashboard.tsx) vs "Super Admin" (manual-role-guide.tsx) → **Use "Super Admin"** → Arabic: مسؤول النظام
2. `state_office_manager` → "State Manager" (dashboard.tsx) vs "State Office Manager" (manual-role-guide.tsx) → **Use "State Office Manager"** → Arabic: مدير مكتب الولاية
3. `emergency` plan type → "Emergency" (plans.tsx PLAN_TYPES) vs "Emergency Response" (plan-detail.tsx) → **Use "Emergency Response"** short: استجابة للطوارئ
4. `planning.json status` is incomplete — missing: returned, technically_approved, coordination_approved, cancelled, in_progress, delayed → add in Phase 3 planning module

### Label maps to migrate in Phase 3+ (do NOT refactor UI in Phase 2)
- `plan-detail.tsx` PLAN_TYPE_LABELS → `planning.planTypes.*`
- `dashboard.tsx` ROLE_LABELS → `users.roles.*`
- `manual-role-guide.tsx` ROLE_LABELS → `users.roles.*`
- `budget.tsx` STATUS_LABELS → `common.*`
- `format.ts` formatStatusLabel / formatPlanType → `t()` calls
- `plans.tsx` PLAN_TYPES[].label / PLAN_KANBAN_COLS → `planning.planTypes.*` / `common.*`

### Bidi rule
URL, CAFA PMIS brand, currency codes (USD/EUR/SDG), project/plan codes — never translate, always keep LTR. Implement `dir="ltr"` / `<bdi>` in Phase 3+.

**Why:** Approved by spec §15/§16. Breaking this rule during translation will create visual corruption in RTL mode.
