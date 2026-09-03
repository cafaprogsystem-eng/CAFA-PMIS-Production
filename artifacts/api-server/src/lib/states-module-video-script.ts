import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for States — a module the full-system overview
// never covers at all. Accurate against routes/states.ts as of this writing:
// states carry two independent statuses, and manager assignment is
// deliberately owned by User Management, not this page.

export const STATES_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "States",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on State Administration — the canonical list of states CAFA operates in, and how their status is tracked.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "State Records", sectionAr: "سجلات الولايات",
    titleEn: "State Records",
    pointsEn: [],
    narrationEn: "Section one: what a state record actually tracks.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "States",
    titleEn: "Two Independent Statuses",
    pointsEn: ["Operational status: active or inactive", "Office status: present, absent, or unknown", "These track two different things and can differ", "A state's identity — its name and code — never changes", "Every project, plan, and report references a state by this stable identity"],
    narrationEn: "Every state carries two independent statuses: operational status, active or inactive, and office status, present, absent, or unknown — these track genuinely different things and can disagree with each other. A state's core identity, its name and code, never changes, since every project, plan, and report references it by that stable identity.",
    durationHint: 10,
    screenshotKey: "states",
    screenshotLayout: "full",
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Who Manages What", sectionAr: "من يدير ماذا",
    titleEn: "Who Manages What",
    pointsEn: [],
    narrationEn: "Section two: State Administration is read-only for one specific thing.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "States",
    titleEn: "Manager Assignment Lives in User Management",
    pointsEn: ["State Administration shows a state's assigned manager", "But it can't be changed from this page", "Assigning a State Office Manager happens in User Management instead", "This keeps 'who manages this state' as one single source of truth", "Editing a state's own status or office address stays here"],
    narrationEn: "State Administration shows you which manager is assigned to a state, but that assignment can't be changed from this page — it's set in User Management instead, when a State Office Manager's role is assigned. This keeps a single source of truth for who manages a state, while updating the state's own status or office address stays right here.",
    durationHint: 10,
    screenshotKey: "states",
    screenshotLayout: "full",
  },

  {
    type: "outro",
    titleEn: "States — Complete",
    pointsEn: ["You know the two independent status fields a state carries", "You know why manager assignment lives in User Management instead", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered the two independent statuses every state carries, and why assigning a state's manager is handled in User Management rather than here. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const STATES_VIDEO_TITLE = "States — Deep Dive";
export const STATES_VIDEO_MODULE = "states";
