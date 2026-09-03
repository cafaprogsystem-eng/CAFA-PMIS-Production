import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for the Audit Log — a module the full-system
// overview never covers at all. Accurate against permissionsFor() /
// currentUser.ts as of this writing: audit.view is granted to executive
// director, program manager, senior program coordinator, and technical
// coordinator, plus super admin via the wildcard permission.

export const AUDIT_LOG_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Audit Log",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on the Audit Log — a complete, tamper-evident record of every meaningful change in the system.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Who Can See It", sectionAr: "من يستطيع رؤيته",
    titleEn: "Who Can See It",
    pointsEn: [],
    narrationEn: "Section one: access to the audit log is deliberately narrow.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Audit Log",
    titleEn: "Four Roles, Plus Super Admin",
    pointsEn: ["Super Admin: full access, by system-wide permission", "Executive Director and Program Manager can view it", "Senior Program Coordinator and Technical Coordinator can too", "Every other role has no access to this page at all", "Viewing the log never lets you alter or delete an entry"],
    narrationEn: "Access to the audit log is deliberately narrow: Super Admin has full access system-wide, and the Executive Director, Program Manager, Senior Program Coordinator, and Technical Coordinator roles can view it. Every other role has no access to this page at all — and viewing it never lets anyone alter or delete an entry.",
    durationHint: 10,
    screenshotKey: "audit-log",
    screenshotLayout: "full",
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "What Gets Recorded", sectionAr: "ما الذي يتم تسجيله",
    titleEn: "What Gets Recorded",
    pointsEn: [],
    narrationEn: "Section two: the shape of a single audit entry, and how to find one.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Audit Log",
    titleEn: "Before & After, Every Time",
    pointsEn: ["Every create, update, approval, or deletion is logged", "Each entry captures a before-and-after snapshot of the change", "Plus who made it, and exactly when", "Entries are append-only — nothing here is ever edited or removed", "This makes the log non-repudiable: a permanent record of what happened"],
    narrationEn: "Every create, update, approval, or deletion across the system is logged, with each entry capturing a before-and-after snapshot of exactly what changed, who made the change, and precisely when. Entries are append-only — nothing in this log is ever edited or removed — which is what makes it a permanent, non-repudiable record.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Audit Log",
    titleEn: "Filtering to Find an Entry",
    pointsEn: ["Filter by module: Projects, Plans, Budgets, Reports, and more", "Filter by the user who made the change", "Filter by a specific date range", "Search results stay complete — filters narrow, they never hide", "Use it to reconstruct exactly what happened to a record over time"],
    narrationEn: "You can filter by module, from projects and plans to budgets and reports, by the specific user who made a change, or by a date range. Filters only narrow what you're looking at — they never hide anything from the underlying record — so you can reconstruct exactly what happened to any item over time.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Audit Log — Complete",
    pointsEn: ["You know which roles can view the audit log", "You know what an entry captures, and how to filter to find one", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered who can view the audit log, what a single entry captures, and how to filter it to reconstruct exactly what happened to any record. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const AUDIT_LOG_VIDEO_TITLE = "Audit Log — Deep Dive";
export const AUDIT_LOG_VIDEO_MODULE = "audit-log";
