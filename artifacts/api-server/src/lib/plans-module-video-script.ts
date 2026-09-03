import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for Plans — expands the overview's two slides
// with the actual plan-status lifecycle in full and the reopen mechanism,
// which the overview never covers.

export const PLANS_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Plans",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on the Planning module — creating operational plans, tracking their activities, and moving them through approval.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Creating a Plan", sectionAr: "إنشاء خطة",
    titleEn: "Creating a Plan",
    pointsEn: [],
    narrationEn: "Section one: the six plan types, and creating a new plan.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Plans",
    titleEn: "Six Plan Types",
    pointsEn: ["Monthly, Quarterly, and Annual plans", "Action, Operational, and Emergency plans", "Every plan has a state and a sector", "A plan can optionally link to an existing project", "Its code is generated automatically, like CAFA-PLAN-KH-001"],
    narrationEn: "The system supports six plan types: monthly, quarterly, annual, action, operational, and emergency. Every plan is tied to a state and a sector, and can optionally link to an existing project. Its code is generated automatically.",
    durationHint: 10,
    screenshotKey: "plans",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Plans",
    titleEn: "Plan Activities",
    pointsEn: ["Each activity has a title, a responsible person, and dates", "A budget and a progress percentage", "Activities can link to a risk and its mitigation", "Priority: high, medium, or low", "Progress updates roll up into the plan's overall status"],
    narrationEn: "Each plan is made up of activities — a title, a responsible person, planned dates, a budget, and a progress percentage. An activity can link to a risk and its mitigation action, and carries its own priority. Activity progress rolls up into the plan's overall status.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "The Approval Workflow", sectionAr: "مسار الموافقة",
    titleEn: "The Approval Workflow",
    pointsEn: [],
    narrationEn: "Section two: how a plan moves from draft to completion.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Plans",
    titleEn: "The Full Status Lifecycle",
    pointsEn: ["Draft, then Submitted", "Technically Approved, then Coordination Approved", "Approved, then Active", "In Progress, then Completed", "Delayed and Cancelled are also possible at any point", "Final approval is blocked while open corrections remain"],
    narrationEn: "A plan's status moves from draft to submitted, technically approved, coordination approved, approved, active, in progress, and finally completed — with delayed or cancelled possible along the way. Just like projects, final approval is blocked until every open correction on the plan has been resolved.",
    durationHint: 10,
    screenshotKey: "plans",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Plans",
    titleEn: "Reopening an Approved Plan",
    pointsEn: ["Reopening is a separate permission from editing", "Only leadership and coordination roles can reopen", "A Technical Coordinator can only reopen within their own sector", "Reopening does not itself change the plan's data", "It's a deliberate, logged exception to normal approval flow"],
    narrationEn: "Once a plan is approved, editing it further needs a deliberate reopen action — a separate permission from ordinary editing, granted only to leadership and coordination roles, and for a Technical Coordinator, limited to their own sector. Reopening is logged as a deliberate exception, not a routine action.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Plans — Complete",
    pointsEn: ["You know the six plan types and how to build activities", "You know the full status lifecycle and how reopening works", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered the six plan types, building out plan activities, the full approval status lifecycle, and how reopening an approved plan works. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const PLANS_VIDEO_TITLE = "Plans — Deep Dive";
export const PLANS_VIDEO_MODULE = "plans";
