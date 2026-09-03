import { FULL_SYSTEM_SCRIPT, FULL_VIDEO_TITLE, FULL_VIDEO_MODULE } from "./full-system-video-script";
import { LOGIN_MODULE_SCRIPT, LOGIN_VIDEO_TITLE, LOGIN_VIDEO_MODULE } from "./login-module-video-script";
import { DASHBOARD_MODULE_SCRIPT, DASHBOARD_VIDEO_TITLE, DASHBOARD_VIDEO_MODULE } from "./dashboard-module-video-script";
import { PROJECTS_MODULE_SCRIPT, PROJECTS_VIDEO_TITLE, PROJECTS_VIDEO_MODULE } from "./projects-module-video-script";
import { PLANS_MODULE_SCRIPT, PLANS_VIDEO_TITLE, PLANS_VIDEO_MODULE } from "./plans-module-video-script";
import { BUDGET_MODULE_SCRIPT, BUDGET_VIDEO_TITLE, BUDGET_VIDEO_MODULE } from "./budget-module-video-script";
import { REPORTS_MODULE_SCRIPT, REPORTS_VIDEO_TITLE, REPORTS_VIDEO_MODULE } from "./reports-module-video-script";
import { RISKS_MODULE_SCRIPT, RISKS_VIDEO_TITLE, RISKS_VIDEO_MODULE } from "./risks-module-video-script";
import { COMMUNICATION_MODULE_SCRIPT, COMMUNICATION_VIDEO_TITLE, COMMUNICATION_VIDEO_MODULE } from "./communication-module-video-script";
import { NOTIFICATIONS_MODULE_SCRIPT, NOTIFICATIONS_VIDEO_TITLE, NOTIFICATIONS_VIDEO_MODULE } from "./notifications-module-video-script";
import { FILE_ARCHIVE_MODULE_SCRIPT, FILE_ARCHIVE_VIDEO_TITLE, FILE_ARCHIVE_VIDEO_MODULE } from "./file-archive-module-video-script";
import { USERS_MODULE_SCRIPT, USERS_VIDEO_TITLE, USERS_VIDEO_MODULE } from "./users-module-video-script";
import { STATES_MODULE_SCRIPT, STATES_VIDEO_TITLE, STATES_VIDEO_MODULE } from "./states-module-video-script";
import { AUDIT_LOG_MODULE_SCRIPT, AUDIT_LOG_VIDEO_TITLE, AUDIT_LOG_VIDEO_MODULE } from "./audit-log-module-video-script";
import type { ModuleVideoConfig } from "./video-generator";

// Every generatable training video, keyed by its training_videos.module_name.
// Add a new module video by writing its own <module>-module-video-script.ts
// (see login-module-video-script.ts for the pattern) and registering it here
// — routes/training-videos.ts's generate/regenerate endpoints are generic
// over this registry, so no route changes are needed per new module.
export type ModuleRegistryEntry = ModuleVideoConfig & {
  description: string;
};

export const TRAINING_VIDEO_MODULES: Record<string, ModuleRegistryEntry> = {
  [FULL_VIDEO_MODULE]: {
    moduleKey: FULL_VIDEO_MODULE,
    videoTitle: FULL_VIDEO_TITLE,
    introHeading: "Program Management System",
    introSubtitle: "Complete System Training Guide",
    slides: FULL_SYSTEM_SCRIPT,
    description: "Comprehensive walkthrough of all CAFA PMIS modules with English voice-over and captions.",
  },
  [LOGIN_VIDEO_MODULE]: {
    moduleKey: LOGIN_VIDEO_MODULE,
    videoTitle: LOGIN_VIDEO_TITLE,
    introHeading: "Login & Email Verification",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: LOGIN_MODULE_SCRIPT,
    description: "Deep dive into signing in, login errors and account lockout, session duration, email verification, and invited-account setup.",
  },
  [DASHBOARD_VIDEO_MODULE]: {
    moduleKey: DASHBOARD_VIDEO_MODULE,
    videoTitle: DASHBOARD_VIDEO_TITLE,
    introHeading: "Dashboard",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: DASHBOARD_MODULE_SCRIPT,
    description: "Deep dive into the KPI cards, role-scoped visibility, sector achievement, and pending approvals on the Dashboard.",
  },
  [PROJECTS_VIDEO_MODULE]: {
    moduleKey: PROJECTS_VIDEO_MODULE,
    videoTitle: PROJECTS_VIDEO_TITLE,
    introHeading: "Projects",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: PROJECTS_MODULE_SCRIPT,
    description: "Deep dive into finding and registering a project, the detail tabs, and the full approval and corrections chain.",
  },
  [PLANS_VIDEO_MODULE]: {
    moduleKey: PLANS_VIDEO_MODULE,
    videoTitle: PLANS_VIDEO_TITLE,
    introHeading: "Plans",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: PLANS_MODULE_SCRIPT,
    description: "Deep dive into creating a plan across its six types and the full status and reopen workflow.",
  },
  [BUDGET_VIDEO_MODULE]: {
    moduleKey: BUDGET_VIDEO_MODULE,
    videoTitle: BUDGET_VIDEO_TITLE,
    introHeading: "Budgets",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: BUDGET_MODULE_SCRIPT,
    description: "Deep dive into the budget overview and allocating budget by state under the BUD-BD-01 cap rule.",
  },
  [REPORTS_VIDEO_MODULE]: {
    moduleKey: REPORTS_VIDEO_MODULE,
    videoTitle: REPORTS_VIDEO_TITLE,
    introHeading: "Reports",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: REPORTS_MODULE_SCRIPT,
    description: "Deep dive into the three report types, writing and submitting a report, and staying on schedule.",
  },
  [RISKS_VIDEO_MODULE]: {
    moduleKey: RISKS_VIDEO_MODULE,
    videoTitle: RISKS_VIDEO_TITLE,
    introHeading: "Risk Register",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: RISKS_MODULE_SCRIPT,
    description: "Deep dive into the risk heatmap, logging a new risk, and ongoing monitoring and mitigation.",
  },
  [COMMUNICATION_VIDEO_MODULE]: {
    moduleKey: COMMUNICATION_VIDEO_MODULE,
    videoTitle: COMMUNICATION_VIDEO_TITLE,
    introHeading: "Communication Centre",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: COMMUNICATION_MODULE_SCRIPT,
    description: "Deep dive into direct and scoped group conversations, mentions, reactions, and message management.",
  },
  [NOTIFICATIONS_VIDEO_MODULE]: {
    moduleKey: NOTIFICATIONS_VIDEO_MODULE,
    videoTitle: NOTIFICATIONS_VIDEO_TITLE,
    introHeading: "Notifications",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: NOTIFICATIONS_MODULE_SCRIPT,
    description: "Deep dive into the notification bell, the full notifications page, and the eight comment types behind them.",
  },
  [FILE_ARCHIVE_VIDEO_MODULE]: {
    moduleKey: FILE_ARCHIVE_VIDEO_MODULE,
    videoTitle: FILE_ARCHIVE_VIDEO_TITLE,
    introHeading: "File & Archive",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: FILE_ARCHIVE_MODULE_SCRIPT,
    description: "Deep dive into the document registry, classification and confidentiality, and standalone resource uploads.",
  },
  [USERS_VIDEO_MODULE]: {
    moduleKey: USERS_VIDEO_MODULE,
    videoTitle: USERS_VIDEO_TITLE,
    introHeading: "User Management",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: USERS_MODULE_SCRIPT,
    description: "Deep dive into access levels, creating and inviting a user, and managing account status.",
  },
  [STATES_VIDEO_MODULE]: {
    moduleKey: STATES_VIDEO_MODULE,
    videoTitle: STATES_VIDEO_TITLE,
    introHeading: "States",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: STATES_MODULE_SCRIPT,
    description: "Deep dive into state operational and office status, and why manager assignment lives in User Management.",
  },
  [AUDIT_LOG_VIDEO_MODULE]: {
    moduleKey: AUDIT_LOG_VIDEO_MODULE,
    videoTitle: AUDIT_LOG_VIDEO_TITLE,
    introHeading: "Audit Log",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: AUDIT_LOG_MODULE_SCRIPT,
    description: "Deep dive into who can view the audit log, what each entry captures, and how to filter it.",
  },
};
