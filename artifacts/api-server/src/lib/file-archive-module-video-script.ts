import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for File & Archive — a module the full-system
// overview never covers at all. Accurate against routes/files.ts as of this
// writing: it's a metadata registry over project/plan/report attachments
// plus standalone resource uploads, not a separate storage system of its own.

export const FILE_ARCHIVE_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "File & Archive",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on File and Archive — finding every document in the system in one place.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "One Place for Every Document", sectionAr: "مكان واحد لكل الوثائق",
    titleEn: "One Place for Every Document",
    pointsEn: [],
    narrationEn: "Section one: what File and Archive actually is, and searching it.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "File & Archive",
    titleEn: "A Registry, Not a Separate Storage",
    pointsEn: ["Brings together files already attached to projects, plans, and reports", "Plus standalone resource files uploaded directly here", "It doesn't own or move the original file — just makes it discoverable", "Filter by source: project, plan, report, or standalone resource", "Filter by status: active, archived, or deleted"],
    narrationEn: "File and Archive is a registry over documents that already exist — files attached to projects, plans, and reports, plus standalone resource files uploaded directly here. It doesn't take ownership of the underlying file; it just makes everything discoverable in one place. Filter by where a file came from, or by whether it's active, archived, or deleted.",
    durationHint: 10,
    screenshotKey: "file-archive",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "File & Archive",
    titleEn: "Classification & Confidentiality",
    pointsEn: ["Sixteen approved filing categories, from Governance to Technical Resources", "Every file carries a confidentiality level", "Public, internal, confidential, or restricted", "Search by keyword across the whole registry", "Filter by classification to narrow results fast"],
    narrationEn: "Every file is filed under one of sixteen approved categories, from governance and legal down to technical resources, and carries a confidentiality level — public, internal, confidential, or restricted. Search by keyword across the whole registry, or filter by classification to narrow things down quickly.",
    durationHint: 10,
    screenshotKey: "file-archive",
    screenshotLayout: "full",
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Uploading a Standalone Resource", sectionAr: "رفع ملف مستقل",
    titleEn: "Uploading a Standalone Resource",
    pointsEn: [],
    narrationEn: "Section two: uploading a file that isn't tied to a specific project.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "File & Archive",
    titleEn: "Resource Uploads Are Restricted",
    pointsEn: ["A standalone resource isn't attached to any project, plan, or report", "Only Super Admin, Executive Director, and Program Manager can manage them", "Project, plan, and report attachments stay owned by their own modules", "Uploading a new version replaces the file, not the history", "Deleting a resource here never touches a project's own documents"],
    narrationEn: "A standalone resource upload isn't tied to any project, plan, or report — and only the Super Admin, Executive Director, and Program Manager roles can manage them. Attachments that belong to a project, plan, or report stay owned by those modules and aren't affected by anything done here. Replacing a resource uploads a new version without losing its history.",
    durationHint: 10,
    screenshotKey: "file-archive",
    screenshotLayout: "full",
  },

  {
    type: "outro",
    titleEn: "File & Archive — Complete",
    pointsEn: ["You know it's a registry, not a separate storage system", "You know classification, confidentiality, and who manages resources", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered how File and Archive brings documents together from across the system, its classification and confidentiality levels, and who's allowed to manage standalone resource uploads. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const FILE_ARCHIVE_VIDEO_TITLE = "File & Archive — Deep Dive";
export const FILE_ARCHIVE_VIDEO_MODULE = "file-archive";
