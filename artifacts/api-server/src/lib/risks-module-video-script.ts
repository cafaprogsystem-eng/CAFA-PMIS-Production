import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for the Risk Register — expands the overview's
// two slides with linking a risk to a plan activity and the record-lock
// mechanism, neither covered there.

export const RISKS_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Risk Register",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on the Risk Register — logging, tracking, and mitigating risk across CAFA PMIS.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "The Risk Heatmap", sectionAr: "خريطة المخاطر الحرارية",
    titleEn: "The Risk Heatmap",
    pointsEn: [],
    narrationEn: "Section one: reading the risk heatmap, and logging a new risk.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Risks",
    titleEn: "Reading the Heatmap",
    pointsEn: ["A 3x3 matrix: likelihood against impact", "Each cell scores from 1 to 9", "Click any cell to see the risks inside it", "Click 'Log Risk' to add a new one", "A risk can optionally be tied to a project or a plan activity"],
    narrationEn: "The Risk Register opens with a heatmap — a three-by-three matrix plotting likelihood against impact, each cell scoring from one to nine. Click any cell to see the risks inside it, or click 'Log Risk' to add a new one, optionally tied to a specific project or plan activity.",
    durationHint: 10,
    screenshotKey: "risk-heatmap",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Risks",
    titleEn: "Logging a Risk",
    pointsEn: ["Title, category, and a clear description", "Severity and likelihood, each rated independently", "An optional due date and follow-up date", "Assign it to whoever should own the mitigation", "Linking to a plan activity surfaces it right there too"],
    narrationEn: "Logging a risk means giving it a title, a category, and a clear description, then rating its severity and likelihood independently. You can set a due date and a follow-up date, and assign it to whoever should own the mitigation. Linking it to a plan activity makes it visible right there as well.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Monitoring & Mitigation", sectionAr: "المتابعة والتخفيف",
    titleEn: "Monitoring & Mitigation",
    pointsEn: [],
    narrationEn: "Section two: tracking a risk over time, and closing it out.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Risks",
    titleEn: "Tracking a Risk to Closure",
    pointsEn: ["Three statuses: Open, Mitigated, Closed", "A dedicated mitigation-plan text field documents actions taken", "Filter the risk log by category, severity, or project", "The project team is notified automatically when a new risk appears", "Export the risk log as CSV whenever you need it"],
    narrationEn: "Every risk carries one of three statuses — open, mitigated, or closed — and a dedicated mitigation-plan field to document what's being done about it. Filter the risk log by category, severity, or project, and the project team is notified automatically the moment a new risk is logged.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Risk Register — Complete",
    pointsEn: ["You know how to read the heatmap and log a risk", "You know how to track a risk through to closure", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered reading the risk heatmap, logging a new risk with a severity and likelihood rating, and tracking it through mitigation to closure. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const RISKS_VIDEO_TITLE = "Risk Register — Deep Dive";
export const RISKS_VIDEO_MODULE = "risks";
