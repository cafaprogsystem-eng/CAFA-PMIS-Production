import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for User Management — expands the overview's
// one slide with the full role list and status lifecycle, neither covered
// in depth there.

export const USERS_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "User Management",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on User Management — creating accounts, assigning roles, and managing their status.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Who Can Manage Users", sectionAr: "من يستطيع إدارة المستخدمين",
    titleEn: "Who Can Manage Users",
    pointsEn: [],
    narrationEn: "Section one: who has access to User Management, and at what level.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Users",
    titleEn: "Full Access vs. Read-Only",
    pointsEn: ["Super Admin: full read and write access", "Executive Director: can view every user, not edit them", "Program Manager: read-only access to the users list", "Everyone else has no access to this page at all", "Creating, editing, or deactivating a user is Super Admin only"],
    narrationEn: "User Management is fully accessible only to the Super Admin role — full read and write. The Executive Director and Program Manager can both view the users list, but neither can create, edit, or deactivate anyone. Every other role has no access to this page at all.",
    durationHint: 10,
    screenshotKey: "users",
    screenshotLayout: "full",
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Creating & Inviting a User", sectionAr: "إنشاء ودعوة مستخدم",
    titleEn: "Creating & Inviting a User",
    pointsEn: [],
    narrationEn: "Section two: creating a new account and getting it into someone's hands.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Users",
    titleEn: "Creating an Account",
    pointsEn: ["Name, email, role, and status", "A Technical Coordinator must have sectors assigned", "A state-scoped role must have a state assigned", "The account starts as 'invited', with no password set", "An invite link is generated for the new user to activate it"],
    narrationEn: "Creating an account means setting a name, email, role, and status. A Technical Coordinator must have sectors assigned, and a state-scoped role must have a state assigned. The account starts as 'invited' with no password set, and an invite link is generated for the new user to activate it themselves.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Users",
    titleEn: "Managing Account Status",
    pointsEn: ["Active, Invited, Suspended, Inactive, or Deactivated", "Only an Active account can sign in at all", "Suspending someone is reversible; deactivating is more final", "A re-invite can be issued if the original link expired", "Every status change is recorded in the audit log"],
    narrationEn: "An account moves through active, invited, suspended, inactive, or deactivated status — only active accounts can sign in. Suspending someone is reversible, while deactivating is more final. A re-invite can be issued if the original link expired, and every status change is recorded in the audit log.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "User Management — Complete",
    pointsEn: ["You know who can manage users and at what access level", "You know how to create, invite, and manage account status", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered who has access to User Management and at what level, creating and inviting a new account, and managing an account's status through its lifecycle. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const USERS_VIDEO_TITLE = "User Management — Deep Dive";
export const USERS_VIDEO_MODULE = "users";
