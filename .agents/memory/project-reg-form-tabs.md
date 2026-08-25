---
name: Project registration form tab structure
description: ProjectRegistrationForm uses a 7-tab section-nav pattern instead of a long linear scroll.
---

## Tab structure
Defined at module level in `project-registration-form.tsx`:

| Tab id       | Label               | Key fields                                      |
|-------------|---------------------|-------------------------------------------------|
| basic       | Basic Information   | title, description, classification, sectors     |
| location    | Location & Coverage | stateIds, localities, beneficiaries             |
| donor       | Donor & Agreement   | donorId, donor, agreementNumber, dates          |
| timeline    | Timeline & Budget   | startDate, endDate, budgetTotal, outputs        |
| team        | Project Team        | assignments                                     |
| documents   | Documents           | documents (+ voice note)                        |
| review      | Review              | read-only summary (no new fields)               |

## Module-level constants
`TABS`, `TAB_FIELDS: Record<TabId, string[]>`, `type TabId` — defined once at file top, never inline.

## State & navigation
- `activeTab` state, `activeTabIndex`, `goToNextTab`, `goToPrevTab` inside the component.
- `handleFormSubmit` wraps `form.handleSubmit(onSubmit, errorCb)` — errorCb iterates TAB_FIELDS to find the first tab containing an error key, then calls `setActiveTab` to jump there.
- `tabsWithErrors` derived from `form.formState.errors` + TAB_FIELDS — drives the red dot on tab buttons.

## Important: startDate / endDate location
These fields live in the **Timeline** tab only. They were moved out of the old section 1 (Basic) grid. Do not add them back to the Basic tab.

**Why:** Follows the "New Project Report" section-nav pattern for consistency; keeps the initial tab short and approachable.
