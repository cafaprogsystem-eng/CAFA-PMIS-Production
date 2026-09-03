import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for Reports — expands the overview's two slides
// with reporting frequency/obligation and the reminder mechanism, neither
// covered there.

export const REPORTS_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Reports",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on Reports — the three report types, writing and submitting one, and how reporting reminders work.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Three Report Types", sectionAr: "أنواع التقارير الثلاثة",
    titleEn: "Three Report Types",
    pointsEn: [],
    narrationEn: "Section one: the three report types, and when each one applies.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Reports",
    titleEn: "Project, HQ Sector, and Program State",
    pointsEn: ["Project Reports track progress on a single project", "HQ Sector Reports give a sector-wide narrative", "Program State Reports give a per-state overview", "Every type can be Monthly, Quarterly, Annual, or Ad-hoc", "Start from Reports and pick the type from the landing page"],
    narrationEn: "The system supports three report types: project reports for tracking an individual project, HQ sector reports covering a whole sector, and program state reports giving a state-level overview. Any of them can be submitted monthly, quarterly, annually, or as an ad-hoc report whenever needed.",
    durationHint: 10,
    screenshotKey: "reports-landing",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Reports",
    titleEn: "Writing & Submitting a Report",
    pointsEn: ["A free-text progress narrative section", "A repeating list of activities implemented", "Challenges and recommendations", "Beneficiary counts by gender and age group", "Save as Draft to keep working, or Submit for review"],
    narrationEn: "A report has four sections: a free-text progress narrative, a repeating list of activities implemented, challenges and recommendations, and beneficiary counts entered by gender and age group. Save as Draft to keep working on it, or Submit to send it for review.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Staying On Schedule", sectionAr: "الالتزام بالمواعيد",
    titleEn: "Staying On Schedule",
    pointsEn: [],
    narrationEn: "Section two: reporting obligations and reminders.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Reports",
    titleEn: "Reporting Obligations & Reminders",
    pointsEn: ["Each project has its own reporting period and frequency", "The system tracks which reports are due and by when", "Reminders go out automatically as a due date approaches", "A late report shows up clearly wherever reporting compliance is tracked", "Submitting doesn't require a reminder — you can report any time"],
    narrationEn: "Every project carries its own reporting period and frequency, and the system tracks which reports are due and when. Reminders go out automatically as a due date approaches, and a late report shows up clearly wherever reporting compliance is tracked — though you're never required to wait for a reminder to submit one.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Reports — Complete",
    pointsEn: ["You know the three report types and when to use each", "You know how to write, submit, and stay on schedule", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered the three report types, writing and submitting a report, and how reporting obligations and reminders keep everyone on schedule. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const REPORTS_VIDEO_TITLE = "Reports — Deep Dive";
export const REPORTS_VIDEO_MODULE = "reports";
