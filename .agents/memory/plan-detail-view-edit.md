---
name: Plan Details view/edit architecture
description: How view/edit mode is implemented in plan-detail.tsx; what canEdit controls; how formatPlanType unifies label display.
---

## Rule
`isEditing = useState(isNew)` — existing plans open in read-only view mode; new plans start in edit mode.

## Key contracts
- **canEdit** = `hasPerm("*") || hasPerm("plans.create") || hasPerm("projects.create")` — no status restriction; PATCH /plans/:planId also has no status gate server-side (requirePerm("plans.update") only).
- **Approved plans can be edited** by any user with plans.update / plans.create permission — no backend guard.
- **"Edit Plan"** button shown in view mode when canEdit=true; clicking sets isEditing=true.
- **Cancel** calls `onCancel()` which runs `window.confirm("Discard unsaved changes?")` then resets form from `existing` and sets isEditing=false.
- **Save success** (`updateMutation.onSuccess`) calls `setIsEditing(false)` to return to view mode.
- **Delete Plan** is in the overflow `DropdownMenu` (⋮ button), not a persistent sticky footer.
- **formatPlanType** in `lib/format.ts` is the single source of truth for plan type labels; PLAN_TYPE_LABELS in plan-detail.tsx also updated to match ("Annual" not "Annual Plan").
- **PlanStatusBadge** and **DetailField** are module-scope components (not defined inside PlanDetailPage).
- **404/403** both surface as `planError=true` from useGetPlan's isError; render a graceful error card with back link.

**Why:** Spec §2 requires enterprise view-mode-by-default; spec §4 preserves approved plan safety; spec §5 unifies status labels via formatStatusLabel.
