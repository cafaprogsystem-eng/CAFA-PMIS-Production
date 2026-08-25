# Projects Module Visual Refinement — Phase 2 Audit Report

**Task:** #539  
**Date:** 2026-08-18  
**File audited:** `artifacts/cafa-pmis/src/components/project-registration-form.tsx`  
**Scope:** Visual-only refinements to the 7-tab project registration and edit form.

---

## 1. Visual Issues Found and Resolution

### 1.1 Edit Loading: Bare Spinner → Structural Skeleton

**Issue:** When loading an existing project for editing, the component rendered a bare `py-20` spinner with no structural context.

**Fix:** Replaced with a structural skeleton matching the form shell:
- 7 tab button placeholders (Skeleton rows in a flex container)
- 2–3 field-row skeletons (label + input height pattern)
- Footer skeleton (one button placeholder left, two right)
- `aria-busy="true"` on the container div
- Visually-hidden "Loading project data" text for screen readers

**Status:** Fixed ✅

---

### 1.2 Generous Panel Spacing

**Issue:** Location tab used `space-y-6`; Timeline tab used `space-y-6`. These created excessive vertical gaps between field groups.

**Fix:**
- Location tab: `space-y-6` → `space-y-4`
- Timeline tab: `space-y-6` → `space-y-5`
- Review tab section container: `space-y-5` → `space-y-4`

**Status:** Fixed ✅

---

### 1.3 Activity Card Height

**Issue:** Output cards used `rounded-xl border bg-card`, header `p-5`, and body `px-5 pb-5 space-y-5 border-t pt-5`. With multiple outputs and activities per output, the Timeline tab became extremely tall.

**Fix:**
- Output card outer: `rounded-xl border bg-card` → `rounded-lg border bg-card`
- Output card header: `p-5` → `p-3`
- Output card body: `px-5 pb-5 space-y-5 border-t pt-5` → `px-4 pb-4 space-y-4 border-t pt-4`
- Activity card outer: `rounded-lg border bg-background` → `rounded-md border bg-muted/20`

**Status:** Fixed ✅

---

### 1.4 Full-Width Short Fields

**Issue:** Reporting frequency Select and date inputs stretched to full dialog width.

**Fix:**
- Reporting Frequency FormItem: added `max-w-xs` class
- Start/End date grid: `grid-cols-1 md:grid-cols-2 gap-4` → `grid-cols-2 gap-4 max-w-sm` — paired dates constrained to logical half-width unit

**Status:** Fixed ✅

---

### 1.5 Section Heading Consistency

**Issue:** Section headings used inconsistent patterns:
- Location tab "Target Beneficiaries": `text-sm font-semibold mb-3 flex items-center gap-2` with a horizontal rule
- Timeline tab "Implementation Period", "Funding": same inconsistent pattern
- Timeline tab "Results Framework": same
- Documents tab "Voice Note": same

**Fix:** Introduced a local `SectionHeading` component:
```tsx
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}
```
Applied consistently to: Target Beneficiaries (Location), Implementation Period, Funding, Results Framework (Timeline), Voice Note (Documents).

Note: "font-semibold" → "font-medium" is intentional — aligns with the UI Design System State (MEMORY.md: font-medium everywhere in card titles/labels).

**Status:** Fixed ✅

---

### 1.6 Documents Tab

**Issue:** Three stacked Cards with default padding added significant vertical length.

**Assessment:** The Cards already use `CardHeader pb-2` and compact content via `DocUploadSlot`. No additional padding reduction was necessary — the existing implementation is already compact with `pb-2` on the header. Cards maintain clear visual hierarchy.

**Status:** Already acceptable ✅

---

### 1.7 Review Tab

**Issue:** `space-y-5` on the review summary container and inner panel might feel loose.

**Fix:** Changed outer section class to `space-y-4` and inner content div to `space-y-4`.

**Assessment:** Label/value pairs already use `text-xs text-muted-foreground` / `text-sm font-medium` hierarchy consistently throughout.

**Status:** Fixed ✅

---

### 1.8 Label Casing

**Issue:** "Scheduled Reporting Frequency" was Title Case.

**Fix:** Changed to Sentence case: "Scheduled reporting frequency".

**Assessment of other labels:** All FormLabel text in translation keys already uses Sentence case (these are resolved via `t()` from the translation files). Hard-coded labels like "Scheduled Reporting Frequency" were the only direct violations found in the JSX.

**Status:** Fixed ✅

---

### 1.9 Add Activity / Add Indicator / Add Output Buttons

**Issue:** Buttons used `className="h-9 gap-2"` or `className="h-10 gap-2"` with `variant="outline"` — slightly oversized for inline add actions within compact output cards.

**Fix:** Changed all three to `size="sm" className="gap-1.5"` with `h-3.5 w-3.5` Plus icons. This reduces the button height to match the compact card context.

**Status:** Fixed ✅

---

### 1.10 New-Donor Wrapper

**Issue:** The new-donor sub-panel used `border rounded-md p-3 bg-muted/30` — indistinguishable from a general bordered group.

**Fix:** Added `border-dashed` to make it clearly read as a contextual input sub-panel, not an error box: `border border-dashed rounded-md p-3 bg-muted/30`.

**Status:** Fixed ✅

---

### 1.11 Footer Padding

**Issue:** Footer used `py-4` which added height on the sticky bar.

**Fix:** `py-4` → `py-3`. Also added explicit `border-t border-border` to the sticky container for visual clarity.

**Status:** Fixed ✅

---

### 1.12 Skeleton Accessibility

**Fix:** The edit loading skeleton container has `aria-busy="true"` and a visually-hidden "Loading project data" `<span className="sr-only">` text. Tab placeholders use `Skeleton` component (which renders with `aria-hidden="true"` via the base component's `animate-pulse` class).

**Status:** Fixed ✅

---

### 1.13 Team Tab Remove Button Accessibility

**Issue:** Team row remove button had no `aria-label`.

**Fix:** Added dynamic `aria-label` showing the role name: `aria-label={\`Remove ${PERSONNEL_ROLES.find(r => r.value === watch(...))?.label ?? "team"} assignment\`}`. Also added `aria-hidden="true"` to the Trash2 icon.

**Status:** Fixed ✅

---

### 1.14 Description Textarea

**Issue:** `rows={5}` was generous for short descriptions.

**Fix:** `rows={3}` with `resize-y` class, allowing users to expand if needed while defaulting to a compact height.

**Status:** Fixed ✅

---

## 2. Form Shell and Hierarchy

The form uses a consistent shell across create and edit modes:
- **Tab nav:** `role="tablist"` with keyboard navigation (ArrowLeft/Right/Home/End), error dot indicators per tab with `aria-label`
- **Panels:** `role="tabpanel"` with `aria-labelledby` pointing to the respective tab button; hidden when not active using the `hidden` attribute
- **Footer:** Sticky at `bottom-0`, single instance, `bg-background` prevents content bleed-through, `border-t border-border` for clear separation, `z-10` for stacking

---

## 3. Step Navigation

The 7-tab wizard navigation was already well-implemented (keyboard, focus, aria). Phase 2 changes made no structural modifications to the navigation. Minor: tab button touch targets remain at `px-3 py-1.5` — appropriate for the 7-tab horizontal scroll container.

---

## 4. Section Heading Pattern

**Canonical pattern** (defined at module level, not exported):
```tsx
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}
```

Applied to: Target Beneficiaries, Implementation Period, Funding, Results Framework (with description), Voice Note (with description). Plans and Reports Phase 2 can use this same pattern.

---

## 5. Field Density (Per Tab)

### Tab 1 — Basic
- `space-y-4` ✅ was already appropriate
- Reporting Frequency: `max-w-xs` added ✅
- Description Textarea: `rows={3}` with `resize-y` ✅

### Tab 2 — Location
- `space-y-4` (was `space-y-6`) ✅
- State checkbox grid: `max-h-60 overflow-y-auto` retained ✅
- Beneficiary grid: `grid-cols-2 md:grid-cols-4 gap-3` retained ✅
- Section heading standardised ✅

### Tab 3 — Donor
- `space-y-4` ✅ was already appropriate
- Agreement dates: `grid-cols-1 md:grid-cols-2 gap-4` retained ✅
- New-donor wrapper: added `border-dashed` ✅

### Tab 4 — Timeline & Budget
- `space-y-5` (was `space-y-6`) ✅
- Start/End dates: constrained to `grid-cols-2 gap-4 max-w-sm` ✅
- Budget grid: `grid-cols-2 md:grid-cols-3 gap-4` retained (Currency adjacent to Budget Total) ✅
- Section headings standardised ✅

### Tab 5 — Team
- `space-y-3` ✅ was already compact
- Remove button: added `aria-label` ✅

### Tab 6 — Documents
- `space-y-4` ✅ was already appropriate
- Cards: already compact with `pb-2` CardHeader ✅
- Voice note section heading standardised ✅

### Tab 7 — Review
- `space-y-4` (was `space-y-5`) ✅
- Label/value density consistent throughout ✅

---

## 6. Activity Card Compaction

Before:
- Outer: `rounded-xl border bg-card`
- Header: `p-5`
- Body: `px-5 pb-5 space-y-5 border-t pt-5`
- Activity row: `rounded-lg border bg-background`

After:
- Outer: `rounded-lg border bg-card`
- Header: `p-3`
- Body: `px-4 pb-4 space-y-4 border-t pt-4`
- Activity row: `rounded-md border bg-muted/20`

Activity field groups (A: identity 2-col, B: schedule 1/2/4-col, C: assignment 1/2/3-col) were already well-structured. Group layout unchanged — only outer container sizing reduced.

---

## 7. Recorded Expenditure Presentation

Recorded expenditure is shown as a compact amber notice band within the activity card body (only in edit mode for activities with spend > 0):
```
<div className="... bg-amber-50 border border-amber-200 ... text-xs text-amber-800" aria-live="polite">
  <TriangleAlert .../>
  <span><span className="font-medium">Recorded Expenditure:</span> 12,500 USD <span ...>(read-only — cannot be edited here)</span></span>
</div>
```
The spend value is clearly visible but subordinate to the activity title. It is not editable. The `aria-live="polite"` attribute ensures screen readers announce the value when it becomes visible.

---

## 8. Documents Panel

Three Cards (Agreement required, Budget required, Supporting optional):
- Each uses `CardHeader pb-2` for compact heading area
- Coloured accent dots distinguish required (orange, blue) from optional (muted)
- Lock notices: compact `flex items-start gap-2` banners with `text-sm` (amber for operational, muted for frozen)
- Voice recorder section uses SectionHeading pattern — compact and subordinate

---

## 9. Sticky Footer

```
sticky bottom-0 -mx-6 -mb-6 mt-6 border-t border-border bg-background z-10
```
- `border-t border-border`: subtle top border
- `bg-background`: prevents content showing through on scroll
- `py-3` (was `py-4`): compact height
- `z-10`: no stacking issues with Radix dropdowns (they use z-50+)
- Mobile: `flex-col-reverse gap-2` stacks buttons with primary at top
- Desktop: `sm:flex-row sm:items-center sm:justify-between` single row
- All buttons have accessible labels

---

## 10. Responsive Verification

### 1440px+
- Dialog `max-w-4xl` centres content appropriately
- `max-w-xs` on Reporting Frequency and `max-w-sm` on date pairs prevent excessive stretch

### 1280px (priority)
- Tab nav fits in one row (7 compact tabs with `px-3 py-1.5`)
- 2-column date grid (`max-w-sm`) and 3-column budget grid work within dialog width
- Activity cards compact enough for usable Timeline tab

### 1024px
- 2-column grids: `grid-cols-1 md:grid-cols-2` → collapse to single column
- Budget grid: `grid-cols-2 md:grid-cols-3` → 2 columns
- Tab nav has `overflow-x-auto` for horizontal scroll

### 768px / narrow
- All field grids collapse to single column
- Footer: `flex-col-reverse gap-2` stacks buttons vertically
- Sector/state checkboxes: `grid-cols-2` retains 2-col at narrow widths

---

## 11. Accessibility Findings

| Finding | Resolution |
|---|---|
| Edit loading: no skeleton, no aria-busy | Fixed: skeleton with aria-busy="true" + sr-only text |
| Team remove button: no aria-label | Fixed: dynamic aria-label with role name |
| Decorative icons in section headers | Existing icons already have aria-hidden="true" |
| Activity remove button: generic aria-label | Existing: `t("form.output.removeActivity")` — adequate |
| Dialog focus trap | Handled by Radix Dialog (DialogContent uses `@radix-ui/react-dialog`) |
| Recorded expenditure: aria-live | Already present: `aria-live="polite"` |

---

## 12. No Backend/API/Governance Changes Confirmed

The following files were **NOT modified** by this task:
- No backend routes (`artifacts/api-server/src/routes/`)
- No OpenAPI contracts (`openapi/`)
- No generated API types (`lib/api-client-react/`)
- No migrations (`run-migrations.ts` or `migrations/`)
- No project workflow, permissions, or RBAC logic
- No duplicate-detection logic
- No project-code generation
- No activity spend/progress calculations
- No state allocation rules
- No document lifecycle logic
- No Full Operational Access overrides

**Only modified:** `artifacts/cafa-pmis/src/components/project-registration-form.tsx` (visual/CSS/accessibility changes only).

**New files created:**
- `artifacts/cafa-pmis/src/test/projects-form-visual.test.tsx` (visual contract tests PRJ-FORM-VIS-01 to -10)
- `docs/audit-reports/projects-visual-refinement-phase-2.md` (this file)

---

## 13. Next Phase

**Projects Phase 3 — Project Detail Header + Overview.** Do NOT start automatically.

Phase 3 scope: visual refinement of the project detail page header (status badge, breadcrumb, action buttons), the Overview tab (budget summary cards, timeline indicator, sector/state chips), and the KPI row. Target file: `artifacts/cafa-pmis/src/pages/project-detail.tsx`.
