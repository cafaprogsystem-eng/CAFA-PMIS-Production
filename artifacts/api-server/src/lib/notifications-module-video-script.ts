import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for Notifications — expands the overview's one
// slide with the comment-type system (accurate against the earlier
// full-system script's own Notifications & Comments section) as its own
// dedicated depth.

export const NOTIFICATIONS_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Notifications",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on Notifications — staying informed the moment something needs your attention.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "The Notification Bell", sectionAr: "جرس الإشعارات",
    titleEn: "The Notification Bell",
    pointsEn: [],
    narrationEn: "Section one: the notification bell, and the full notifications page.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Notifications",
    titleEn: "Bell Icon & Full Page",
    pointsEn: ["Shows your unread count in the top bar", "Refreshes automatically every 30 seconds", "Categories: Projects, Reports, Plans, Risks", "The full notifications page lists everything, with filters", "Mark all as read in one click when you're caught up"],
    narrationEn: "The bell icon in the top bar shows your unread count and refreshes automatically every thirty seconds, across categories like projects, reports, plans, and risks. The full notifications page lists everything with filters, and you can mark it all as read in one click once you're caught up.",
    durationHint: 10,
    screenshotKey: "notifications",
    screenshotLayout: "full",
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Comments Drive Most Notifications", sectionAr: "التعليقات مصدر أغلب الإشعارات",
    titleEn: "Comments Drive Most Notifications",
    pointsEn: [],
    narrationEn: "Section two: the comment system behind many of your notifications.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Notifications",
    titleEn: "Eight Comment Types",
    pointsEn: ["General, Technical, and Observation comments", "Required Correction — blocks approval until resolved", "Approval Note and Rejection Reason", "Revision Request and Coordination comments", "Which types you can post depends on your role"],
    narrationEn: "Comments come in eight types — general, technical, and observation notes, required correction, which blocks approval until it's resolved, approval note, rejection reason, revision request, and coordination. Which of these you're allowed to post depends on your role.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Notifications",
    titleEn: "Where Comments Show Up",
    pointsEn: ["Visible directly on the project or report they belong to", "Organised as threads, not a flat list", "A required correction must be marked resolved before moving on", "Posting one notifies whoever needs to see it", "Everything is timestamped with who wrote it"],
    narrationEn: "Comments appear directly on the project or report they belong to, organised as threads rather than a flat list. A required correction has to be marked resolved before the item can move forward, and posting any comment notifies whoever needs to see it — every comment is timestamped with who wrote it.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Notifications — Complete",
    pointsEn: ["You know how the bell and full notifications page work", "You know the eight comment types and how they drive notifications", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered the notification bell and full notifications page, the eight comment types, and how required corrections and other comments drive the notifications you see. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const NOTIFICATIONS_VIDEO_TITLE = "Notifications — Deep Dive";
export const NOTIFICATIONS_VIDEO_MODULE = "notifications";
