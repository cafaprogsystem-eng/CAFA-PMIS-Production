---
name: UI Design System State
description: Current state of the CAFA PMIS design system upgrade — what's done and what remains for Phase 3+.
---

## What has been upgraded (Phase 1 + Phase 2)

### Design tokens (index.css)
- Primary: `#2563EB` (HSL 221 83% 53%)
- Background: `#F8FAFC`, border: `#E2E8F0`, text: `#0F172A` / `#64748B`
- Radius: `0.75rem`, white sidebar via `--sidebar: 0 0% 100%`
- Semantic color tokens: `--success`, `--warning`, `--info` + dark-mode variants
- CSS badge classes: `.badge-draft`, `.badge-submitted`, `.badge-approved`, etc.
- `page-enter` animation updated to cubic-bezier spring

### Layout (layout.tsx)
- White sidebar with blue active items (`bg-primary/10 text-primary`) and light hover
- Sticky header with scroll shadow
- Breadcrumb helper in header
- Logo in blue rounded-square icon box

### Core UI components (all upgraded, 0 typecheck errors)
- `button.tsx` — added `success`, `warning`, `info`, `xl` size variants; no more `hover-elevate` (was removed, no other files referenced it)
- `badge.tsx` — full semantic variant set: draft, submitted, approved, active, returned, rejected, completed, inactive, pending, closed, invited, suspended, critical, high, medium, low, excellent, good, needs-follow-up, insufficient
- `card.tsx` — uses `border-card-border shadow-sm` by default
- `input.tsx` — `rounded-lg`, focus ring `ring-primary/25 border-primary/50`
- `table.tsx` — `TableHead` now uppercase tracking-widest 11px; `TableCell` px-4 py-3; header bg-muted/40
- `select.tsx` — `rounded-lg`, matches input focus styles
- `dialog.tsx` — `backdrop-blur-sm`, `rounded-xl`, softer close button
- `tabs.tsx` — tabs with border, active state has card bg + border
- `dropdown-menu.tsx` — `rounded-xl bg-card shadow-lg`
- `textarea.tsx` — matches input styles, `min-h-[80px]`, resize-y
- `sheet.tsx` — `backdrop-blur-sm bg-card`

### format.ts
- `statusBadgeVariant()` now returns `BadgeVariant` type using new semantic variants
- New `severityBadgeVariant()` function returning `BadgeVariant` for risk severity
- Old `severityBadgeClass()` / `riskLevelClass()` kept as `@deprecated` for compat

### Dashboard (dashboard.tsx)
- H1 upgraded from `text-2xl font-semibold` to `text-3xl font-bold tracking-tight`
- `SectionHeader` h2 upgraded from `text-sm` to `text-base font-semibold tracking-tight`
- Role badge changed from `secondary` to `outline` with muted text

## All three tasks now COMPLETE (Tasks #1, #2, #3)

All hardcoded color patterns replaced. All deprecated helpers removed from call sites. Typecheck passes 0 errors.

### Files touched in Tasks #1–3
- `risks.tsx` — StatusBadge uses badge variants; summary KPI cards use token-based bg; h1 upgraded to text-3xl; all riskLevelClass → severityBadgeVariant
- `projects.tsx` — CoverageBadge uses submitted/completed variants
- `users.tsx` — STATUS_STYLES → STATUS_VARIANT with BadgeVariant; RoleBadge → completed/submitted variants
- `project-detail.tsx` — severityBadgeClass/riskLevelClass removed from imports and all call sites; Single/Multi-State badges use variants; activity budget tags use Badge variants; info banner uses token-based bg-muted/40; blue card border → bg-primary/5 border-primary/20
- `budget.tsx` — BudgetVarianceBadge uses Badge variants; BudgetProgressBar uses bg-destructive/bg-warning/bg-success tokens; ProgressBar burnRatePct uses bg-destructive; role banners use bg-warning/10 and bg-info/10; h2 upgraded to text-base font-semibold
- `plans.tsx` — statusBadgeClass deprecated stub; all call sites replaced with statusBadgeVariant
- `plan-detail.tsx` — statusBadgeClass import removed; uses statusBadgeVariant
- `planning-dashboard.tsx` — statusBadgeClass import removed; uses statusBadgeVariant
- `reports.tsx` — BudgetStatusBadge uses Badge variants; riskLevelClass → severityBadgeVariant

## Responsive audit completed (Phase 7)

All responsive fixes applied. Typecheck: 0 errors. No browser console errors.

### Changes made
- `index.css`: `overflow-x: clip` on body (prevents page-level horizontal scroll); h1–h3 now scale down on mobile (`text-2xl sm:text-3xl`, etc.)
- `dialog.tsx`: `w-[calc(100%-1.5rem)]` + `max-h-[calc(100dvh-1.5rem)] overflow-y-auto` + `p-4 sm:p-6` — modals now fit all phones
- `dashboard.tsx`: KPI grid gets `md:grid-cols-3` as intermediate step (was jumping 2→4)
- `kanban-board.tsx`: columns `w-64` → `w-[clamp(260px,30vw,340px)]`; scroll container uses `WebkitOverflowScrolling: touch`
- `messages.tsx`: `100vh` → `100dvh` (prevents clipping under mobile browser chrome)
- `ai-chat-widget.tsx`: `calc(100vh - 3rem)` → `calc(100dvh - 3rem)`
- `drive.tsx`: SelectTrigger `w-[170px]/w-[130px]` → `w-full sm:w-[170px]/sm:w-[130px]`
- `program-resources.tsx`: All filter SelectTriggers → `w-full sm:w-N`; date range div gets `flex-wrap`
- `password-resets.tsx`: SelectTrigger `w-[150px]` → `w-full sm:w-[150px]`
- `ai-settings.tsx`: SelectTrigger `w-[200px]` → `w-full sm:w-[200px]`
- `plans.tsx`: Removed deprecated `statusBadgeClass` export entirely (was causing Vite HMR warnings)

### Already solid (no changes needed)
Shell flex structure, mobile sidebar drawer (hamburger+overlay), main content padding (`p-4 sm:p-6 lg:p-8`), all Recharts charts (ResponsiveContainer), most table overflow-x-auto wrappers, messages panel mobile switching, DialogFooter flex-col-reverse on mobile, kanban scroll container.

## Design System Phase 3 — NEW PRIMITIVES (complete)

### New files created
- `src/components/ui/search-input.tsx` — SearchInput with leading icon, clearable ×, controlled value
- `src/components/ui/loading-overlay.tsx` — LoadingOverlay (scoped/fullscreen) + PageLoader
- `src/components/ui/error-state.tsx` — ErrorState (generic/server/network/permission/not-found/warning variants) + InlineError
- `src/components/ui/stat-card.tsx` — StatCard (reusable KpiCard) + StatPill; link or button modes
- `src/pages/design-system.tsx` — full live documentation page, route /design-system, super_admin only

### Enhancements to existing files
- `button.tsx` — added `isLoading` prop (renders Loader2 spinner, disables button, aria-busy)
- `badge.tsx` — added `open`, `warning`, `info` variants (brief requirement)
- `index.css` — added `--shadow-sm/md/lg/floating` tokens in @theme; responsive h1-h3 scaling; `overflow-x: clip` on body

## What remains (Phase 3+)

### Pages not yet visually polished
- Projects list + kanban (uses `CoverageBadge` with hardcoded `bg-blue-100` / `bg-violet-100` — should use badge variants)
- Project detail (multi-tab with state cards)
- Risks register (summary cards use hardcoded `bg-red-50 border-red-200` — could use semantic tokens)
- Reports (monthly/coordination)
- Budget module
- Users / User management
- Planning module
- Settings / Profile
- Training / Manual pages

### Key remaining items
- Replace hardcoded `bg-blue-50/border-blue-200` info banners with `bg-info/10 border-info/30` tokens
- Replace `CoverageBadge` hardcoded colors in projects.tsx with badge variants
- Risks summary cards could use `var(--destructive)/10` for red backgrounds
- Login page is INTENTIONALLY kept dark navy (brand choice — do not change)

### Communication Centre refinement boundary

- The main Communication workspace has completed its Phase 1 visual refinement:
  shell, sidebar, active header, message stream, and loading/empty/error states
  are intentionally compact and token-led.
- Composer, attachment/voice flows, mention/reaction pickers, creation/member
  dialogs, pinned/media panels, and auxiliary surfaces remain a separately
  scoped Phase 2.

**Why:** Keep visual work from accidentally widening into Communication
behaviour, security, realtime, or accessibility contracts that are already
functionally closed.

**How to apply:** Do not automatically continue into Phase 2. Treat those
deferred interaction surfaces as a separate approved scope while preserving the
Phase 1 visual sentinels.

### Notifications refinement boundary

- Notifications visual closure is complete for the inbox page, bell/popover,
  preferences, presentation states, and the embedded Dashboard summary entry
  point. These surfaces should remain compact, token-led, responsive, and
  RTL-safe.
- Phase 2 is not required and must not be started automatically. The Dashboard
  summary must treat a failed request as an explicit error state, never as an
  empty or “all caught up” result.

**Why:** Notification delivery, recipient, taxonomy, realtime, pagination, and
preference contracts are functionally closed and must not be widened during
visual follow-up work. The embedded summary is still a user-facing Notification
entry point, so its presentation must meet the same truthfulness standard.

**How to apply:** Keep visual changes limited to approved presentation scope;
preserve the `NOTIF-VIS` and `NOTIF-FINAL-VIS` sentinels and the existing
functional Notification regression suites. Do not create a new Notification
phase without a fresh, meaningful unaudited surface or an approved design goal.

**Why:** This file tracks design system state so future sessions don't re-investigate what's already done or re-attempt changes to the login page.

**How to apply:** When asked to continue Phase 3+, read this file first to know the baseline and the remaining work.
