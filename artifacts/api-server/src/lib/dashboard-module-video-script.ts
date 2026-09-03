import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for the Dashboard — the full-system walkthrough
// only gives this three shallow slides; this expands it with the actual
// scope-of-view rule (org-wide vs your own state/sector) and the sector
// achievement view, both real features the overview never mentions.

export const DASHBOARD_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Dashboard",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on the CAFA PMIS Dashboard — your real-time overview of projects, beneficiaries, budget, and what needs your attention.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Key Performance Indicators", sectionAr: "مؤشرات الأداء الرئيسية",
    titleEn: "Key Performance Indicators",
    pointsEn: [],
    narrationEn: "Section one: the key performance indicator cards.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Dashboard",
    titleEn: "The KPI Cards",
    pointsEn: ["Active, Submitted, and Under Review project counts", "Total beneficiaries across all projects", "Budget utilization as a live percentage", "Every number updates in real time as data changes", "Click any card to jump straight to its detail"],
    narrationEn: "The dashboard opens with a row of KPI cards: active, submitted, and under-review project counts, total beneficiaries, and budget utilization as a live percentage. Every number reflects the current state of the system — there's nothing to refresh. Click any card to go straight to its underlying detail.",
    durationHint: 10,
    screenshotKey: "dashboard",
    screenshotLayout: "full",
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Dashboard",
    titleEn: "Beneficiary Breakdown",
    pointsEn: ["Click the Total Beneficiaries card to open the breakdown", "Split by category: IDP, Returnee, Host, Refugee", "Split by gender: Male, Female", "Split by age group: Adults, Boys, Girls", "Disability and special-needs figures included"],
    narrationEn: "Clicking the Total Beneficiaries card opens a full breakdown: by category — internally displaced, returnee, host community, and refugee — and further split by gender, age group, and disability or special needs.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "What You See Depends On Your Role", sectionAr: "ما تراه يعتمد على دورك",
    titleEn: "What You See Depends On Your Role",
    pointsEn: [],
    narrationEn: "Section two: what you see on the dashboard depends on your role.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Scope of View",
    titleEn: "Org-Wide vs. Your Own Scope",
    pointsEn: ["Leadership and coordination roles see the whole organisation", "A State Office Manager sees only their own state's numbers", "A Technical Coordinator sees only their assigned sectors", "The same dashboard layout adapts its data, not its design", "This scoping is enforced by the server, not just hidden in the UI"],
    narrationEn: "The dashboard looks the same for everyone, but the numbers behind it don't. Leadership and coordination roles see organisation-wide figures, a State Office Manager sees only their own state's data, and a Technical Coordinator sees only the sectors they're assigned to. This scoping is enforced on the server — it isn't just hidden in the interface.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Sector Achievement",
    titleEn: "Sector Achievement View",
    pointsEn: ["Shows which sectors have the highest indicator completion", "Compares target vs. achieved across every active project", "Helps identify sectors falling behind early", "Available to roles with organisation-wide visibility", "Links directly into the Reports and Plans behind each figure"],
    narrationEn: "The sector achievement view compares target against achieved indicator values across every active project, sector by sector — a quick way to see which sectors are on track and which are falling behind, with links straight into the reports and plans behind each figure.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 3, sectionEn: "Staying on Top of Things", sectionAr: "متابعة المستجدات",
    titleEn: "Staying on Top of Things",
    pointsEn: [],
    narrationEn: "Section three: pending approvals and recent activity.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Approvals & Activity",
    titleEn: "Pending Approvals & Recent Activity",
    pointsEn: ["Pending Approvals lists everything waiting on your action", "Click any item to go directly to it", "Recent Activity shows the latest changes system-wide", "Includes submissions, approvals, and newly logged risks", "Both refresh automatically — no manual reload needed"],
    narrationEn: "The Pending Approvals section lists every item waiting on your action — click one to go straight to it. Recent Activity shows the latest changes across the system: submissions, approvals, and newly logged risks. Both refresh automatically.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Dashboard — Complete",
    pointsEn: ["You know how to read every KPI and who sees what", "You know how to drill into beneficiaries and sector achievement", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered the dashboard's KPIs, the beneficiary breakdown, how visibility scoping works by role, sector achievement, and staying on top of approvals and activity. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const DASHBOARD_VIDEO_TITLE = "Dashboard — Deep Dive";
export const DASHBOARD_VIDEO_MODULE = "dashboard";
