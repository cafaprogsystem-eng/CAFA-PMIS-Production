import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for Projects — expands the full-system
// overview's three slides with the actual approval chain, the required
// corrections mechanism, and project closure, none of which the overview
// covers.

export const PROJECTS_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Projects",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on the Projects module — registering, tracking, approving, and closing projects in CAFA PMIS.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Finding & Registering Projects", sectionAr: "البحث عن المشاريع وتسجيلها",
    titleEn: "Finding & Registering Projects",
    pointsEn: [],
    narrationEn: "Section one: finding existing projects, and registering a new one.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Projects",
    titleEn: "The Projects List",
    pointsEn: ["Every project shown with a colored status badge", "Filter by status, sector, state, or free-text search", "Sort by date, budget, or sector", "Export the filtered results to CSV", "Each project has a unique code: CAFA-PROJ-2026-001"],
    narrationEn: "The projects list shows every project with a colored status badge. Filter by status, sector, or state, or search by name or code, then sort by date, budget, or sector and export the filtered results to CSV. Every project gets a unique, year-scoped code like CAFA-PROJ-2026-001, assigned automatically.",
    durationHint: 10,
    screenshotKey: "projects-list",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Projects",
    titleEn: "Registering a New Project",
    pointsEn: ["The form spans six sections", "Basic info: name, sector, objective, dates", "Management level: HQ-managed or state-managed", "Geographic coverage: states and localities", "Staff role assignments for this project", "Budget, currency, and signed agreement documents"],
    narrationEn: "Registering a project walks you through six sections: basic information, management level — HQ-managed or state-managed — geographic coverage, staff role assignments, budget and currency, and finally uploading the signed agreement documents.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Project Detail", sectionAr: "تفاصيل المشروع",
    titleEn: "Project Detail",
    pointsEn: [],
    narrationEn: "Section two: the project detail page.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Projects",
    titleEn: "Tabs & Role-Based Actions",
    pointsEn: ["Overview: summary, geography, and a live budget bar", "Activities: output-level activity tracking", "Indicators: targets versus actuals", "Documents: view and upload agreements", "Comments: threaded review discussion", "Action buttons change based on your role and the project's status"],
    narrationEn: "The project detail page has five tabs — Overview, Activities, Indicators, Documents, and Comments. The action buttons at the top change depending on your role and the project's current status, so what one person can do here may look different for someone else.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 3, sectionEn: "Approval & Corrections", sectionAr: "الموافقة والتصحيحات",
    titleEn: "Approval & Corrections",
    pointsEn: [],
    narrationEn: "Section three: how a project moves through approval, and what happens when a reviewer asks for a correction.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Approvals",
    titleEn: "The Approval Chain",
    pointsEn: ["A State Officer submits the project first", "A Technical Coordinator gives technical approval", "A Senior Coordinator gives coordination approval", "The Program Manager gives final sign-off", "Leadership then activates it, and closes it when it ends", "Every transition is logged with who did it and when"],
    narrationEn: "A project moves through six stages: a state officer submits it, a technical coordinator reviews it, a senior coordinator gives coordination approval, the program manager gives final sign-off, leadership activates it, and it's closed once it ends. Every transition is recorded in the audit log with the user and timestamp.",
    durationHint: 10,
    // Reused here because the approval stage is exactly what the list's
    // colored status badges show — not shown for the registration form,
    // detail-page tabs, or corrections slides below, none of which are the
    // page this screenshot was actually captured from.
    screenshotKey: "projects-list",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Approvals",
    titleEn: "Required Corrections Block Approval",
    pointsEn: ["A reviewer can add a 'Required Correction' comment", "The submitter must resolve every one before re-submitting", "Final approval is blocked until all are resolved", "'Request Revision' sends the whole project back to its submitter", "The reason is automatically added to the comment thread"],
    narrationEn: "A reviewer can leave a 'Required Correction' comment directly on the project, and the submitter must resolve every one before final approval can proceed — it's genuinely blocked until then. 'Request Revision' sends the entire project back to whoever submitted it, with the reason automatically recorded in the comment thread.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Projects — Complete",
    pointsEn: ["You know how to find, register, and track a project", "You know the approval chain and how corrections work", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered finding and registering projects, the detail page's tabs and role-based actions, the six-stage approval chain, and how required corrections block final approval until resolved. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const PROJECTS_VIDEO_TITLE = "Projects — Deep Dive";
export const PROJECTS_VIDEO_MODULE = "projects";
