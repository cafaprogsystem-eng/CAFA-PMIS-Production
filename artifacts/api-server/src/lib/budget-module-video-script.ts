import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for Budgets — expands the overview's one slide
// with per-state allocation and the allocation-cap rule (accurate against
// routes/projects.ts's BUD-BD-01 check), neither covered in the overview.

export const BUDGET_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Budgets",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on Budgets — tracking spend, allocating across states, and reading the numbers correctly.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "The Budget Overview", sectionAr: "نظرة عامة على الميزانية",
    titleEn: "The Budget Overview",
    pointsEn: [],
    narrationEn: "Section one: the budget overview page.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Budget",
    titleEn: "Totals & Multi-Currency",
    pointsEn: ["Aggregates figures from every project", "Three supported currencies: USD, SDG, and EUR", "Shows Total Approved, Spent to Date, and Remaining", "Burn rate is calculated automatically", "An alert fires as spending nears 90% of the approved budget"],
    narrationEn: "The Budget page aggregates figures from every project, in three supported currencies — US Dollar, Sudanese Pound, and Euro — showing total approved budget, spent to date, and what's remaining. The burn rate is calculated automatically, and an alert fires as spending nears ninety percent of the approved amount.",
    durationHint: 10,
    screenshotKey: "budget-overview",
    screenshotLayout: "full",
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Allocating Budget by State", sectionAr: "توزيع الميزانية على الولايات",
    titleEn: "Allocating Budget by State",
    pointsEn: [],
    narrationEn: "Section two: how a project's budget is split across the states it covers.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Budget",
    titleEn: "State Allocations Can't Exceed the Total",
    pointsEn: ["A project covering multiple states splits its budget between them", "Each state gets its own allocation, beneficiary target, and team", "The sum of all state allocations can never exceed the project total", "This is enforced when the project is created", "…and enforced again every time the budget is edited afterward"],
    narrationEn: "A project that covers more than one state splits its budget between them, and each state allocation carries its own beneficiary target and state team. The sum of every state's allocation can never exceed the project's total budget — the system checks this both when the project is first created, and again every time its budget is edited afterward.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Budget",
    titleEn: "Project-Level vs. Activity-Level Tracking",
    pointsEn: ["Project budget covers the whole project's approved amount", "Each activity has its own planned and spent budget", "Activity spend rolls up to show real burn rate", "Reports also capture planned budget and actual expenditure", "Together these give you three views of the same money"],
    narrationEn: "Budget is tracked at two levels: the project's overall approved amount, and each activity's own planned and spent figures, which roll up into the real burn rate. Reports add a third view, capturing planned budget and actual expenditure for the period being reported.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Budgets — Complete",
    pointsEn: ["You know how to read totals, currencies, and burn rate", "You know how state allocations are capped and tracked", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered the budget overview's totals and currencies, how state-level allocations are capped at the project total, and the difference between project-level and activity-level tracking. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const BUDGET_VIDEO_TITLE = "Budgets — Deep Dive";
export const BUDGET_VIDEO_MODULE = "budget";
