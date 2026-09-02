export type SlideType = "intro" | "section-header" | "content" | "outro";

export type MockupElement = {
  kind: "box" | "text" | "highlight" | "cursor" | "button" | "input";
  x: number; y: number; w?: number; h?: number;
  color?: string; text?: string; fontSize?: number;
};

export type FullSlide = {
  type: SlideType;
  sectionNum?: number;
  sectionEn?: string;
  sectionAr?: string;
  titleEn: string;
  pointsEn: string[];
  narrationEn: string;
  durationHint: number;
  mockup?: MockupElement[];
  // Real screenshot support: when screenshotKey is set AND
  // data/training-screenshots/<screenshotKey>.png exists at render time, the
  // video generator composites that real captured screenshot instead of
  // drawing `mockup` — see scripts/capture-training-screenshots.mjs. `mockup`
  // is kept as a fallback for slides that already have a screenshotKey, so a
  // render started before the screenshot is captured still produces a
  // complete video. "card" reuses the narrow floating-panel treatment
  // (login-sized screens); "full" fills the frame with the real screenshot
  // and puts the title/bullets in a lower-third band (wide, full-page
  // screens like Dashboard or Projects that don't fit a narrow card).
  screenshotKey?: string;
  screenshotLayout?: "card" | "full";
};

// Mockup panel occupies x: 730..1250, y: 90..640 (right 40% of frame)

export const mkPanel = (): MockupElement[] => [
  { kind: "box", x: 730, y: 90, w: 530, h: 550, color: "white@0.97" },
];

export const mkHeader = (label: string): MockupElement[] => [
  { kind: "box", x: 730, y: 90, w: 530, h: 55, color: "0x1a2744" },
  { kind: "text", x: 750, y: 107, text: label, color: "white", fontSize: 18 },
];

export const mkInput = (x: number, y: number, w: number, placeholder: string, highlight = false): MockupElement[] => [
  { kind: "box", x, y, w, h: 34, color: "0xf3f4f6" },
  { kind: "text", x: x + 10, y: y + 9, text: placeholder, color: "0xaaaaaa", fontSize: 14 },
  ...(highlight ? [{ kind: "highlight" as const, x: x - 2, y: y - 2, w: w + 4, h: 38, color: "0xFFD700@0.6" }] : []),
];

export const mkButton = (x: number, y: number, w: number, label: string, color = "0x1a2744"): MockupElement[] => [
  { kind: "box", x, y, w, h: 38, color },
  { kind: "text", x: x + 12, y: y + 11, text: label, color: "white", fontSize: 15 },
];

export const mkCursor = (x: number, y: number): MockupElement => ({ kind: "cursor", x, y });

export const mkStatusBadge = (x: number, y: number, label: string, color: string): MockupElement[] => [
  { kind: "box", x, y, w: 90, h: 24, color },
  { kind: "text", x: x + 8, y: y + 5, text: label, color: "white", fontSize: 11 },
];

export const FULL_SYSTEM_SCRIPT: FullSlide[] = [

  // =========================================================
  // INTRO
  // =========================================================
  {
    type: "intro",
    titleEn: "CAFA Program Management System",
    pointsEn: ["Complete System Training", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the complete training guide for the CAFA Program Management System. In this video we'll walk through every module of the system, step by step.",
    durationHint: 8,
  },

  // =========================================================
  // SECTION 1 — Login & Email Verification
  // =========================================================
  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Login & Email Verification", sectionAr: "تسجيل الدخول والتحقق من البريد الإلكتروني",
    titleEn: "Login & Email Verification",
    pointsEn: [],
    narrationEn: "Section one: logging in and verifying your email address.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Login",
    titleEn: "Accessing the System",
    pointsEn: ["Open the CAFA PMIS in your browser", "Enter your Username or Email address", "Enter your Password (case sensitive)", "Tick 'Remember me' for 30-day sessions", "Click the Sign In button"],
    narrationEn: "To access the system, open your browser and go to the CAFA PMIS link. Enter your registered username or email address, followed by your password. You can tick 'Remember me' to stay signed in for thirty days. Click the Sign In button to continue.",
    durationHint: 10,
    screenshotKey: "login",
    screenshotLayout: "card",
    mockup: [
      ...mkPanel(),
      ...mkHeader("CAFA PMIS — Sign In"),
      { kind: "text", x: 870, y: 165, text: "Welcome Back!", color: "0x1a2744", fontSize: 20 },
      ...mkInput(750, 205, 480, "Username or Email"),
      ...mkInput(750, 260, 480, "Password  ••••••••", true),
      { kind: "box", x: 750, y: 310, w: 22, h: 22, color: "0xdddddd" },
      { kind: "text", x: 780, y: 314, text: "Remember me for 30 days", color: "0x555555", fontSize: 13 },
      ...mkButton(750, 350, 480, "Sign In"),
      { kind: "text", x: 870, y: 407, text: "Forgot password?", color: "0x2563eb", fontSize: 13 },
      mkCursor(1230, 353),
    ],
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Login",
    titleEn: "Login Security & Roles",
    pointsEn: ["Only ACTIVE accounts can log in", "Login bumps your Last Login timestamp", "Non-active accounts get generic error", "Session cookie valid 8 hours (or 30 days)", "7 roles control what you see & can do"],
    narrationEn: "Only active accounts can sign in to the system. If your account is suspended or not yet active, you'll see a generic error message without any detail about why. Your session lasts eight hours, or thirty days if you selected 'Remember me'. Your role determines exactly which pages and actions are available to you.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("System Roles"),
      { kind: "text", x: 745, y: 162, text: "Super Admin", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 187, text: "Executive Director", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 212, text: "Program Manager", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 237, text: "Senior Coordinator", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 262, text: "Technical Coordinator", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 287, text: "State Manager", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 312, text: "State Officer", color: "0x1a2744", fontSize: 15 },
      { kind: "highlight", x: 735, y: 153, w: 510, h: 30, color: "0xFFD700@0.35" },
    ],
  },

  // =========================================================
  // SECTION 2 — Password Reset
  // =========================================================
  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Password Reset", sectionAr: "إعادة تعيين كلمة المرور",
    titleEn: "Password Reset",
    pointsEn: [],
    narrationEn: "Section two: resetting your password.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Password Reset",
    titleEn: "Forgot Your Password?",
    pointsEn: ["Click 'Forgot password?' on the login page", "Enter your registered email address", "System sends a secure reset link", "Link expires after 30 minutes", "Only active accounts receive the link"],
    narrationEn: "If you've forgotten your password, click 'Forgot password?' on the login page. Enter your registered email address and click Send. You'll receive a secure reset link that stays valid for only thirty minutes.",
    durationHint: 10,
    screenshotKey: "forgot-password",
    screenshotLayout: "card",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Forgot Password"),
      { kind: "text", x: 870, y: 168, text: "Reset your password", color: "0x1a2744", fontSize: 18 },
      { kind: "text", x: 750, y: 208, text: "Enter your registered email:", color: "0x555555", fontSize: 14 },
      ...mkInput(750, 228, 480, "m@example.com", true),
      ...mkButton(750, 282, 480, "Send Reset Link", "0x1a2744"),
      { kind: "text", x: 760, y: 338, text: "Link expires in 30 minutes", color: "0xef4444", fontSize: 13 },
      mkCursor(1230, 285),
    ],
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Password Reset",
    titleEn: "Setting a New Password",
    pointsEn: ["Open the reset link from your email", "Enter a new password (min 8 characters)", "Confirm the new password matches", "Strength bar guides you (Weak→Strong)", "Submit — you are logged in automatically"],
    narrationEn: "Open the reset link from your email. Enter a new password of at least eight characters. Watch the strength indicator and aim for a 'Strong' rating. Confirm the new password, then click Save — you'll be signed in automatically.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Set New Password"),
      ...mkInput(750, 168, 480, "New password"),
      { kind: "box", x: 750, y: 210, w: 480, h: 8, color: "0xe5e7eb" },
      { kind: "box", x: 750, y: 210, w: 320, h: 8, color: "0x22c55e" },
      { kind: "text", x: 750, y: 225, text: "Strength: Strong", color: "0x22c55e", fontSize: 13 },
      ...mkInput(750, 248, 480, "Confirm password", true),
      ...mkButton(750, 298, 480, "Save New Password"),
      mkCursor(1230, 301),
    ],
  },

  // =========================================================
  // SECTION 3 — Dashboard
  // =========================================================
  {
    type: "section-header",
    sectionNum: 3, sectionEn: "Dashboard", sectionAr: "لوحة المعلومات",
    titleEn: "Dashboard Overview",
    pointsEn: [],
    narrationEn: "Section three: the Dashboard.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Dashboard",
    titleEn: "Key Performance Indicators",
    pointsEn: ["Real-time project & beneficiary counts", "Active Projects / Submitted / Under Review", "Total Beneficiaries by category", "Budget utilization across all projects", "Click any card to drill down"],
    narrationEn: "The Dashboard shows your key performance indicators in real time. The cards cover Active, Submitted, and Under Review projects, total beneficiaries, and overall budget utilization. Click any card to jump straight to its details.",
    durationHint: 10,
    screenshotKey: "dashboard",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      { kind: "box", x: 730, y: 90, w: 140, h: 550, color: "0x1a2744" },
      { kind: "text", x: 748, y: 113, text: "Dashboard", color: "0xe8a012", fontSize: 14 },
      { kind: "text", x: 748, y: 143, text: "Projects", color: "white", fontSize: 13 },
      { kind: "text", x: 748, y: 168, text: "Reports", color: "white", fontSize: 13 },
      { kind: "text", x: 748, y: 193, text: "Plans", color: "white", fontSize: 13 },
      { kind: "box", x: 875, y: 100, w: 168, h: 75, color: "0xf0fdf4" },
      { kind: "text", x: 885, y: 115, text: "Active Projects", color: "0x166534", fontSize: 13 },
      { kind: "text", x: 920, y: 138, text: "12", color: "0x166534", fontSize: 24 },
      { kind: "box", x: 1055, y: 100, w: 168, h: 75, color: "0xeff6ff" },
      { kind: "text", x: 1065, y: 115, text: "Beneficiaries", color: "0x1e40af", fontSize: 13 },
      { kind: "text", x: 1095, y: 138, text: "47K", color: "0x1e40af", fontSize: 24 },
      { kind: "box", x: 875, y: 185, w: 348, h: 70, color: "0xfefce8" },
      { kind: "text", x: 885, y: 200, text: "Budget Utilization", color: "0x92400e", fontSize: 13 },
      { kind: "box", x: 885, y: 222, w: 320, h: 16, color: "0xe5e7eb" },
      { kind: "box", x: 885, y: 222, w: 214, h: 16, color: "0xf59e0b" },
      { kind: "text", x: 885, y: 242, text: "67% of approved budget", color: "0x92400e", fontSize: 12 },
    ],
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Dashboard",
    titleEn: "Beneficiary Breakdown Modal",
    pointsEn: ["Click the 'Total Beneficiaries' KPI card", "Modal opens with full disaggregation", "Breakdown: IDP / Returnee / Host / Refugee", "Gender disaggregation: Male / Female", "Age disaggregation: Adults / Boys / Girls", "Disability and special-needs data"],
    narrationEn: "Click the 'Total Beneficiaries' card to open the full breakdown. It shows beneficiaries by category — internally displaced, returnee, host community, and refugee — with further disaggregation by gender, age group, and disability or special needs.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Beneficiary Breakdown"),
      { kind: "box", x: 738, y: 155, w: 506, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 745, y: 167, text: "IDPs", color: "0x374151", fontSize: 15 },
      { kind: "box", x: 840, y: 167, w: 360, h: 16, color: "0xe5e7eb" },
      { kind: "box", x: 840, y: 167, w: 270, h: 16, color: "0x3b82f6" },
      { kind: "text", x: 1205, y: 167, text: "75%", color: "0x374151", fontSize: 14 },
      { kind: "text", x: 745, y: 200, text: "Returnees", color: "0x374151", fontSize: 15 },
      { kind: "box", x: 840, y: 200, w: 360, h: 16, color: "0xe5e7eb" },
      { kind: "box", x: 840, y: 200, w: 90, h: 16, color: "0x22c55e" },
      { kind: "text", x: 1205, y: 200, text: "25%", color: "0x374151", fontSize: 14 },
      { kind: "text", x: 745, y: 235, text: "Male", color: "0x374151", fontSize: 15 },
      { kind: "box", x: 840, y: 235, w: 360, h: 16, color: "0xe5e7eb" },
      { kind: "box", x: 840, y: 235, w: 198, h: 16, color: "0x6366f1" },
      { kind: "text", x: 1205, y: 235, text: "55%", color: "0x374151", fontSize: 14 },
      { kind: "highlight", x: 735, y: 152, w: 510, h: 110, color: "0xFFD700@0.15" },
    ],
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Dashboard",
    titleEn: "Pending Approvals & Recent Activity",
    pointsEn: ["Pending Approvals section lists items awaiting your action", "Click any item to go directly to it", "Recent Activity shows latest changes", "Notifications alert you to new items", "State Performance chart by state"],
    narrationEn: "The Pending Approvals section lists every item waiting on your action. Click any item to go straight to it. The Recent Activity feed shows the latest updates across the system, including project submissions, report approvals, and other recent changes.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Pending Approvals"),
      { kind: "box", x: 738, y: 152, w: 506, h: 50, color: "0xfef2f2" },
      { kind: "text", x: 748, y: 163, text: "CAFA-KH-001 needs technical review", color: "0x991b1b", fontSize: 13 },
      { kind: "text", x: 748, y: 183, text: "Report Q1-2026 awaiting approval", color: "0x991b1b", fontSize: 13 },
      { kind: "box", x: 738, y: 210, w: 506, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 748, y: 220, text: "Recent Activity", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 748, y: 245, text: "Ahmed M. submitted project CAFA-SD-012", color: "0x555555", fontSize: 13 },
      { kind: "text", x: 748, y: 268, text: "Fatima A. approved report RPT-2026-Q2", color: "0x555555", fontSize: 13 },
      { kind: "text", x: 748, y: 291, text: "New risk logged: Khartoum operations", color: "0x555555", fontSize: 13 },
      { kind: "highlight", x: 734, y: 149, w: 514, h: 55, color: "0xef4444@0.2" },
      mkCursor(1145, 170),
    ],
  },

  // =========================================================
  // SECTION 4 — Projects
  // =========================================================
  {
    type: "section-header",
    sectionNum: 4, sectionEn: "Projects Module", sectionAr: "وحدة المشاريع",
    titleEn: "Projects Module",
    pointsEn: [],
    narrationEn: "Section four: the Projects module.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 4, sectionEn: "Projects",
    titleEn: "Projects List & Filters",
    pointsEn: ["Navigate to Projects in the sidebar", "View all projects with status badges", "Filter by: Status / Sector / State / Search", "Sort by date, budget, or sector", "Export filtered results to CSV"],
    narrationEn: "Go to the Projects section from the sidebar. You'll see every project listed with a colored status badge. Filter the list by status, sector, or state, or search by name or code. To export the data, click the Export CSV button.",
    durationHint: 10,
    screenshotKey: "projects-list",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Projects"),
      { kind: "box", x: 738, y: 152, w: 340, h: 30, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 162, text: "Search projects...", color: "0xaaaaaa", fontSize: 14 },
      ...mkButton(1090, 152, 130, "Register Project", "0x1a2744"),
      { kind: "box", x: 738, y: 192, w: 506, h: 34, color: "0xf9fafb" },
      { kind: "text", x: 748, y: 204, text: "Project Name", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 940, y: 204, text: "Sector", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 1070, y: 204, text: "Status", color: "0x6b7280", fontSize: 13 },
      { kind: "box", x: 738, y: 230, w: 506, h: 34, color: "white" },
      { kind: "text", x: 748, y: 242, text: "CAFA-KH-001 Health Project", color: "0x1a2744", fontSize: 13 },
      ...mkStatusBadge(1070, 239, "Active", "0x16a34a"),
      { kind: "box", x: 738, y: 268, w: 506, h: 34, color: "0xfafafa" },
      { kind: "text", x: 748, y: 280, text: "CAFA-KH-002 WASH Programme", color: "0x1a2744", fontSize: 13 },
      ...mkStatusBadge(1070, 277, "Submitted", "0xd97706"),
      { kind: "box", x: 738, y: 306, w: 506, h: 34, color: "white" },
      { kind: "text", x: 748, y: 318, text: "CAFA-SD-003 Education Support", color: "0x1a2744", fontSize: 13 },
      ...mkStatusBadge(1070, 315, "Draft", "0x6b7280"),
    ],
  },
  {
    type: "content",
    sectionNum: 4, sectionEn: "Projects",
    titleEn: "Registering a New Project",
    pointsEn: ["Click 'Register Project' button", "Section 1: Basic info — Name, Sector, Dates", "Section 2: Management level (HQ / State)", "Section 3: States & localities covered", "Section 4: Staff role assignments", "Section 5: Budget & currency (USD/SDG/EUR)", "Section 6: Upload signed documents"],
    narrationEn: "To register a new project, click the 'Register Project' button. The form spans six sections: basic information, management level, geographic coverage, staff role assignments, budget and currency, and finally uploading signed documents.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Register New Project"),
      { kind: "text", x: 748, y: 162, text: "Project Name *", color: "0x374151", fontSize: 13 },
      ...mkInput(738, 178, 506, "e.g. CAFA Health Project Khartoum"),
      { kind: "text", x: 748, y: 225, text: "Sector *", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 738, y: 241, w: 240, h: 34, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 253, text: "Health", color: "0x374151", fontSize: 14 },
      { kind: "text", x: 748, y: 291, text: "Budget *", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 738, y: 307, w: 240, h: 34, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 319, text: "150,000", color: "0x374151", fontSize: 14 },
      { kind: "box", x: 990, y: 307, w: 100, h: 34, color: "0xf3f4f6" },
      { kind: "text", x: 1000, y: 319, text: "USD", color: "0x374151", fontSize: 14 },
      { kind: "highlight", x: 734, y: 300, w: 370, h: 48, color: "0xFFD700@0.4" },
      mkCursor(738, 307),
    ],
  },
  {
    type: "content",
    sectionNum: 4, sectionEn: "Projects",
    titleEn: "Project Detail — Tabs & Actions",
    pointsEn: ["Overview tab: summary, geography, budget bar", "Activities tab: output-level activity tracking", "Indicators tab: targets vs. actuals", "Documents tab: upload & view agreements", "Comments tab: threaded review comments", "Action buttons change based on your role"],
    narrationEn: "The project detail page has five tabs: Overview, Activities, Indicators, Documents, and Comments. The action buttons at the top change depending on your role and the project's current status. An authorized staff member can submit the project, withdraw a submission, or add a comment.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("CAFA-KH-001 Health Project"),
      { kind: "box", x: 738, y: 152, w: 506, h: 34, color: "0xf9fafb" },
      { kind: "text", x: 748, y: 164, text: "Overview", color: "0x1a2744", fontSize: 13 },
      { kind: "text", x: 828, y: 164, text: "Activities", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 920, y: 164, text: "Documents", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 1030, y: 164, text: "Comments", color: "0x6b7280", fontSize: 13 },
      { kind: "box", x: 738, y: 186, w: 130, h: 1, color: "0x1a2744" },
      { kind: "text", x: 748, y: 202, text: "Sector: Health", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 748, y: 222, text: "State: Khartoum State", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 748, y: 242, text: "Budget: $150,000 USD", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 748, y: 262, w: 440, h: 14, color: "0xe5e7eb" },
      { kind: "box", x: 748, y: 262, w: 295, h: 14, color: "0xf59e0b" },
      { kind: "text", x: 748, y: 282, text: "67% spent", color: "0x6b7280", fontSize: 12 },
      ...mkButton(748, 300, 150, "Submit for Review", "0x1a2744"),
      ...mkButton(910, 300, 120, "Add Comment", "0x6b7280"),
      { kind: "highlight", x: 744, y: 297, w: 155, h: 40, color: "0xFFD700@0.4" },
      mkCursor(900, 315),
    ],
  },

  // =========================================================
  // SECTION 5 — Plans
  // =========================================================
  {
    type: "section-header",
    sectionNum: 5, sectionEn: "Planning Module", sectionAr: "وحدة التخطيط",
    titleEn: "Planning Module",
    pointsEn: [],
    narrationEn: "Section five: the Planning module.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 5, sectionEn: "Plans",
    titleEn: "Plan Types & Creating a Plan",
    pointsEn: ["6 plan types: Monthly, Quarterly, Annual, Action, Operational, Emergency", "Navigate to Planning → Plans → New Plan", "Select type, state, sector", "Optionally link the plan to a project", "Add activities with budget & targets", "Code auto-generated: CAFA-PLAN-KH-001"],
    narrationEn: "The system supports six plan types: monthly, quarterly, annual, action, operational, and emergency. To create a new plan, go to Planning and click New Plan, then choose the type, state, and sector. You can optionally link the plan to an existing project. The plan code is generated automatically.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("New Plan"),
      { kind: "text", x: 748, y: 162, text: "Plan Type *", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 738, y: 178, w: 506, h: 34, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 190, text: "Monthly Plan", color: "0x374151", fontSize: 14 },
      { kind: "text", x: 748, y: 226, text: "State *", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 738, y: 242, w: 240, h: 34, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 254, text: "Khartoum State", color: "0x374151", fontSize: 14 },
      { kind: "text", x: 748, y: 292, text: "Sector *", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 738, y: 308, w: 240, h: 34, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 320, text: "Health", color: "0x374151", fontSize: 14 },
      { kind: "highlight", x: 734, y: 175, w: 514, h: 40, color: "0xFFD700@0.35" },
      mkCursor(1240, 192),
    ],
  },
  {
    type: "content",
    sectionNum: 5, sectionEn: "Plans",
    titleEn: "Plan Activities & Approval Workflow",
    pointsEn: ["Each plan contains activities with: Title, Responsible Person, Dates, Budget", "Progress percentage updated as work proceeds", "Draft → Submitted → Technically Approved", "→ Coordination Approved → Approved → Active", "→ In Progress → Completed / Delayed", "Final approval blocked if open corrections exist"],
    narrationEn: "Each plan contains activities with a responsible person, dates, an allocated budget, and a progress percentage. A plan moves through a multi-stage approval chain — from draft all the way to activation and completion. Final approval is blocked until every required correction has been resolved.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Plan Workflow"),
      { kind: "text", x: 748, y: 162, text: "Draft", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 810, y: 162, text: "→", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 830, y: 162, text: "Submitted", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 920, y: 162, text: "→", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 940, y: 162, text: "Tech. Approved", color: "0x16a34a", fontSize: 13 },
      { kind: "text", x: 748, y: 192, text: "→ Coord. Approved → Approved", color: "0x16a34a", fontSize: 13 },
      { kind: "text", x: 748, y: 215, text: "→ Active → In Progress → Completed", color: "0x1a2744", fontSize: 13 },
      { kind: "box", x: 738, y: 240, w: 506, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 748, y: 255, text: "Activity: Community Health Training", color: "0x374151", fontSize: 13 },
      { kind: "box", x: 738, y: 272, w: 400, h: 14, color: "0xe5e7eb" },
      { kind: "box", x: 738, y: 272, w: 240, h: 14, color: "0x3b82f6" },
      { kind: "text", x: 748, y: 293, text: "Progress: 60%", color: "0x6b7280", fontSize: 12 },
    ],
  },

  // =========================================================
  // SECTION 6 — Reports
  // =========================================================
  {
    type: "section-header",
    sectionNum: 6, sectionEn: "Reports Module", sectionAr: "وحدة التقارير",
    titleEn: "Reports Module",
    pointsEn: [],
    narrationEn: "Section six: the Reports module.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 6, sectionEn: "Reports",
    titleEn: "3 Report Types",
    pointsEn: ["Project Reports — progress for a single project", "HQ Sector Reports — sector-wide narrative", "Program State Reports — per-state overview", "All types: Monthly / Quarterly / Annual / Ad-hoc", "Navigate: Reports → select type from landing page"],
    narrationEn: "The system supports three report types: project reports for tracking an individual project, headquarters sector reports covering a whole sector, and program state reports for a state-level overview. Reports can be submitted monthly, quarterly, annually, or as an ad-hoc report whenever needed.",
    durationHint: 10,
    screenshotKey: "reports-landing",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Reports"),
      { kind: "box", x: 738, y: 155, w: 506, h: 85, color: "0xeff6ff" },
      { kind: "text", x: 760, y: 172, text: "Project Reports", color: "0x1e40af", fontSize: 16 },
      { kind: "text", x: 760, y: 195, text: "Track progress by project", color: "0x6b7280", fontSize: 13 },
      { kind: "box", x: 738, y: 248, w: 506, h: 85, color: "0xf0fdf4" },
      { kind: "text", x: 760, y: 265, text: "HQ Sector Reports", color: "0x166534", fontSize: 16 },
      { kind: "text", x: 760, y: 288, text: "Sector-wide reporting", color: "0x6b7280", fontSize: 13 },
      { kind: "box", x: 738, y: 340, w: 506, h: 85, color: "0xfefce8" },
      { kind: "text", x: 760, y: 357, text: "Program State Reports", color: "0x92400e", fontSize: 16 },
      { kind: "text", x: 760, y: 380, text: "State-level programme overview", color: "0x6b7280", fontSize: 13 },
      { kind: "highlight", x: 734, y: 152, w: 514, h: 92, color: "0x3b82f6@0.15" },
      mkCursor(1230, 196),
    ],
  },
  {
    type: "content",
    sectionNum: 6, sectionEn: "Reports",
    titleEn: "Writing & Submitting a Report",
    pointsEn: ["Section 2: Narrative progress (free text)", "Section 3: Activities Implemented (repeater rows)", "Each activity: Name, Status, Budget, Beneficiaries", "Section 4: Challenges & Recommendations", "Beneficiary counts: M / F / Boys / Girls (auto-totals)", "Footer: Save Draft  ·  Submit Report"],
    narrationEn: "A report has four sections: a free-text progress narrative, a repeating list of activities implemented, challenges and recommendations, and manually entered beneficiary counts by gender and age group. Click 'Save as Draft' to save your progress, or 'Submit Report' to send it for review.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Project Report — Q2 2026"),
      { kind: "text", x: 748, y: 162, text: "Section 2 — Progress Narrative", color: "0x1a2744", fontSize: 14 },
      { kind: "box", x: 738, y: 180, w: 506, h: 70, color: "0xf9fafb" },
      { kind: "text", x: 748, y: 192, text: "This quarter the team completed...", color: "0x9ca3af", fontSize: 13 },
      { kind: "text", x: 748, y: 262, text: "Section 3 — Activities", color: "0x1a2744", fontSize: 14 },
      { kind: "box", x: 738, y: 280, w: 506, h: 30, color: "0xf9fafb" },
      { kind: "text", x: 748, y: 291, text: "Community training | Completed | 45%", color: "0x374151", fontSize: 12 },
      { kind: "box", x: 738, y: 315, w: 506, h: 30, color: "white" },
      { kind: "text", x: 748, y: 326, text: "+ Add activity row", color: "0x3b82f6", fontSize: 13 },
      ...mkButton(738, 360, 220, "Save as Draft", "0x6b7280"),
      ...mkButton(970, 360, 200, "Submit Report", "0x1a2744"),
      { kind: "highlight", x: 966, y: 357, w: 204, h: 44, color: "0xFFD700@0.4" },
      mkCursor(1170, 375),
    ],
  },

  // =========================================================
  // SECTION 7 — Approval Workflows
  // =========================================================
  {
    type: "section-header",
    sectionNum: 7, sectionEn: "Approval Workflows", sectionAr: "مسارات الموافقة",
    titleEn: "Approval Workflows",
    pointsEn: [],
    narrationEn: "Section seven: approval workflows.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 7, sectionEn: "Approvals",
    titleEn: "Project Approval Chain",
    pointsEn: ["1. State Officer submits project (Draft → Submitted)", "2. Technical Coordinator: technically_approved", "3. Senior Coordinator: coordination_approved", "4. Program Manager: approved (final sign-off)", "5. Executive/Admin: activate → mark active", "6. Closed when project ends"],
    narrationEn: "A project passes through six stages: it's submitted by a state officer, reviewed by a technical coordinator, then a senior coordinator, then given final sign-off by the program manager, activated, and finally closed once it ends. Every transition is logged with the user's name and timestamp in the audit log.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Project Approval Chain"),
      { kind: "text", x: 748, y: 162, text: "State Officer", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 860, y: 162, text: "→  Submitted", color: "0xd97706", fontSize: 13 },
      { kind: "box", x: 738, y: 180, w: 506, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 748, y: 195, text: "Technical Coordinator", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 890, y: 195, text: "→  Tech. Approved", color: "0x16a34a", fontSize: 13 },
      { kind: "box", x: 738, y: 213, w: 506, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 748, y: 228, text: "Senior Coordinator", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 880, y: 228, text: "→  Coord. Approved", color: "0x16a34a", fontSize: 13 },
      { kind: "box", x: 738, y: 246, w: 506, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 748, y: 261, text: "Program Manager", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 876, y: 261, text: "→  Approved ✓", color: "0x16a34a", fontSize: 14 },
      { kind: "highlight", x: 734, y: 257, w: 514, h: 32, color: "0x22c55e@0.2" },
    ],
  },
  {
    type: "content",
    sectionNum: 7, sectionEn: "Approvals",
    titleEn: "Required Corrections & Revision Requests",
    pointsEn: ["Reviewers add 'Required Correction' comments", "Submitter must resolve each correction", "Status: Unresolved → Resolved", "Final approval BLOCKED until all resolved", "'Request Revision' sends entity back to submitter", "Rationale auto-mirrored into comment thread"],
    narrationEn: "Reviewers can add 'Required Correction' comments on a project or report. The submitter must respond to each one and mark it resolved. Final approval is blocked until every open correction is resolved. 'Request Revision' sends the item back to its submitter, and the reason is automatically added to the comment thread.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Required Corrections"),
      { kind: "box", x: 738, y: 152, w: 506, h: 65, color: "0xfef2f2" },
      { kind: "text", x: 748, y: 163, text: "Open correction (unresolved)", color: "0x991b1b", fontSize: 13 },
      { kind: "text", x: 748, y: 182, text: "Budget figures need to be revised", color: "0x555555", fontSize: 12 },
      { kind: "text", x: 748, y: 198, text: "— by Program Manager", color: "0x9ca3af", fontSize: 11 },
      { kind: "box", x: 738, y: 225, w: 506, h: 65, color: "0xf0fdf4" },
      { kind: "text", x: 748, y: 236, text: "Resolved correction", color: "0x166534", fontSize: 13 },
      { kind: "text", x: 748, y: 255, text: "State coverage clarified ✓", color: "0x555555", fontSize: 12 },
      ...mkButton(738, 310, 230, "Request Revision", "0xdc2626"),
      { kind: "highlight", x: 734, y: 149, w: 514, h: 70, color: "0xef4444@0.15" },
    ],
  },

  // =========================================================
  // SECTION 8 — Risks
  // =========================================================
  {
    type: "section-header",
    sectionNum: 8, sectionEn: "Risks Module", sectionAr: "وحدة المخاطر",
    titleEn: "Risks Module",
    pointsEn: [],
    narrationEn: "Section eight: the Risks module.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 8, sectionEn: "Risks",
    titleEn: "Risk Heatmap & Logging a Risk",
    pointsEn: ["Navigate to Risks in the sidebar", "3×3 matrix: Likelihood (Low/Medium/High) × Impact (Low/Medium/High); scores 1–9", "Click any matrix cell to see its risks", "Click 'Log Risk' to add a new risk", "Fill: Title, Category, Description, Severity, Likelihood", "Optional: link risk to a project or plan activity"],
    narrationEn: "The Risks page shows a heatmap of risks plotted by severity against likelihood. Click any cell to see the risks it contains. To log a new risk, click 'Log Risk', enter a title, category, and description, then set its severity and likelihood.",
    durationHint: 10,
    screenshotKey: "risk-heatmap",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Risk Heatmap"),
      { kind: "text", x: 748, y: 162, text: "Severity →", color: "0x6b7280", fontSize: 12 },
      ...([0,1,2,3,4].flatMap(i => [0,1,2,3,4].map(j => ({
        kind: "box" as const,
        x: 760 + j * 90, y: 180 + i * 72, w: 82, h: 64,
        color: (i + j >= 6) ? "0xef4444@0.7" : (i + j >= 4) ? "0xf59e0b@0.7" : "0x22c55e@0.7",
      })))),
      { kind: "highlight", x: 940, y: 180, w: 82, h: 64, color: "0xFFFFFF@0.4" },
      { kind: "text", x: 950, y: 205, text: "3", color: "0x1a2744", fontSize: 20 },
    ],
  },
  {
    type: "content",
    sectionNum: 8, sectionEn: "Risks",
    titleEn: "Risk Monitoring & Mitigation",
    pointsEn: ["Risk statuses: Open / Mitigated / Closed", "Filter risks by category, severity, project", "Each risk has a Mitigation Plan text field", "Risks linked to plans appear in plan activities", "Notifications sent to project team on new risks", "Export risk log as CSV"],
    narrationEn: "Every risk has one of three statuses: open, mitigated, or closed. Enter a mitigation plan in the risk's text field to document the steps being taken. You can filter the risk list by category, severity, or project. The system automatically notifies the project team whenever a new risk is logged.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Risk Log"),
      { kind: "box", x: 738, y: 152, w: 506, h: 34, color: "white" },
      { kind: "text", x: 748, y: 163, text: "Security risk — Khartoum field ops", color: "0x374151", fontSize: 13 },
      ...mkStatusBadge(1140, 159, "Open", "0xef4444"),
      { kind: "box", x: 738, y: 190, w: 506, h: 34, color: "0xfafafa" },
      { kind: "text", x: 748, y: 201, text: "Budget shortfall Q3", color: "0x374151", fontSize: 13 },
      ...mkStatusBadge(1140, 197, "Mitigated", "0xf59e0b"),
      { kind: "box", x: 738, y: 228, w: 506, h: 34, color: "white" },
      { kind: "text", x: 748, y: 239, text: "Staff rotation disruption", color: "0x374151", fontSize: 13 },
      ...mkStatusBadge(1140, 235, "Closed", "0x6b7280"),
      { kind: "highlight", x: 734, y: 149, w: 514, h: 38, color: "0xef4444@0.15" },
    ],
  },

  // =========================================================
  // SECTION 9 — Budget
  // =========================================================
  {
    type: "section-header",
    sectionNum: 9, sectionEn: "Budget Management", sectionAr: "إدارة الميزانية",
    titleEn: "Budget Management",
    pointsEn: [],
    narrationEn: "Section nine: budget management.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 9, sectionEn: "Budget",
    titleEn: "Budget Overview & Multi-Currency",
    pointsEn: ["Budget page aggregates all project budgets", "Supported currencies: USD, SDG, EUR", "Shows: Total Approved / Spent / Remaining", "Burn rate % calculated automatically", "Project-level and output-level budget tracking", "Alert when spending nears 90% of budget"],
    narrationEn: "The Budget page aggregates figures from every project and compares them against amounts spent and remaining. The system supports three currencies — US Dollar, Sudanese Pound, and Euro. The burn rate is calculated automatically, and an alert is sent as spending approaches ninety percent of the approved budget.",
    durationHint: 10,
    screenshotKey: "budget-overview",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Budget Overview"),
      { kind: "text", x: 748, y: 162, text: "Total Approved Budget", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 1090, y: 162, text: "$1,250,000", color: "0x1a2744", fontSize: 16 },
      { kind: "text", x: 748, y: 195, text: "Spent to Date", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 1090, y: 195, text: "$838,000", color: "0xd97706", fontSize: 16 },
      { kind: "text", x: 748, y: 228, text: "Remaining", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 1090, y: 228, text: "$412,000", color: "0x16a34a", fontSize: 16 },
      { kind: "box", x: 748, y: 260, w: 480, h: 20, color: "0xe5e7eb" },
      { kind: "box", x: 748, y: 260, w: 322, h: 20, color: "0xf59e0b" },
      { kind: "text", x: 748, y: 287, text: "Burn Rate: 67%  |  On track", color: "0x6b7280", fontSize: 13 },
      { kind: "highlight", x: 744, y: 256, w: 492, h: 34, color: "0xf59e0b@0.25" },
    ],
  },

  // =========================================================
  // SECTION 10 — Notifications & Comments
  // =========================================================
  {
    type: "section-header",
    sectionNum: 10, sectionEn: "Notifications & Comments", sectionAr: "الإشعارات والتعليقات",
    titleEn: "Notifications & Comments",
    pointsEn: [],
    narrationEn: "Section ten: notifications and comments.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 10, sectionEn: "Notifications",
    titleEn: "Notification Bell & Messages",
    pointsEn: ["Bell icon in the topbar shows unread count", "Polls every 30 seconds automatically", "Categories: Projects / Reports / Plans / Risks", "Messages icon shows recent conversations", "Full notifications page at /notifications", "Filter by module, search, mark-all-read"],
    narrationEn: "The bell icon in the top bar shows your unread notification count and refreshes automatically every thirty seconds. Click the bell to see the latest notifications, or go to the full notifications page to view them all, filter by module, and mark everything as read.",
    durationHint: 10,
    screenshotKey: "notifications",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Notifications"),
      { kind: "box", x: 738, y: 152, w: 506, h: 55, color: "0xfef2f2" },
      { kind: "text", x: 748, y: 163, text: "Project approval needed", color: "0x991b1b", fontSize: 13 },
      { kind: "text", x: 748, y: 183, text: "CAFA-KH-001 awaits your review", color: "0x555555", fontSize: 12 },
      { kind: "box", x: 738, y: 213, w: 506, h: 55, color: "white" },
      { kind: "text", x: 748, y: 224, text: "Report submitted", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 748, y: 244, text: "Ahmed M. submitted Q2 report", color: "0x555555", fontSize: 12 },
      { kind: "box", x: 738, y: 274, w: 506, h: 55, color: "0xfafafa" },
      { kind: "text", x: 748, y: 285, text: "New risk logged", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 748, y: 305, text: "Risk added to Khartoum Health project", color: "0x555555", fontSize: 12 },
      ...mkButton(738, 345, 220, "Mark All as Read", "0x6b7280"),
    ],
  },
  {
    type: "content",
    sectionNum: 10, sectionEn: "Comments",
    titleEn: "Threaded Comments System",
    pointsEn: ["8 comment types: General / Technical / Required Correction / Approval Note / Rejection Reason / Revision Request / Coordination / Observation", "Role-based type restrictions per commenter", "Resolve/reopen corrections within threads", "All comments logged with user + timestamp", "Comments visible on project & report detail"],
    narrationEn: "The system supports eight comment types, organized as threaded discussions on projects and reports. Which comment type a user can post depends on their role. A 'Required Correction' comment must be marked resolved before the item can continue through the approval chain.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("Comments Thread"),
      { kind: "box", x: 738, y: 152, w: 506, h: 60, color: "0xfef2f2" },
      { kind: "text", x: 748, y: 163, text: "Required Correction — Program Manager", color: "0x991b1b", fontSize: 12 },
      { kind: "text", x: 748, y: 181, text: "Budget section needs revision", color: "0x555555", fontSize: 12 },
      { kind: "text", x: 748, y: 199, text: "Status: UNRESOLVED", color: "0xef4444", fontSize: 11 },
      { kind: "box", x: 738, y: 220, w: 506, h: 55, color: "white" },
      { kind: "text", x: 748, y: 231, text: "Approval Note — Senior Coordinator", color: "0x16a34a", fontSize: 12 },
      { kind: "text", x: 748, y: 249, text: "Field coverage looks comprehensive", color: "0x555555", fontSize: 12 },
      ...mkButton(738, 290, 200, "Add Comment", "0x1a2744"),
      { kind: "highlight", x: 734, y: 149, w: 514, h: 65, color: "0xef4444@0.15" },
      mkCursor(1230, 163),
    ],
  },

  // =========================================================
  // SECTION 11 — Users & Roles
  // =========================================================
  {
    type: "section-header",
    sectionNum: 11, sectionEn: "Users & Roles", sectionAr: "المستخدمون والأدوار",
    titleEn: "Users & Roles",
    pointsEn: [],
    narrationEn: "Section eleven: users and roles.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 11, sectionEn: "Users",
    titleEn: "User Management (Admin Only)",
    pointsEn: ["Navigate to Admin → Users (/users)", "Super Admin: full read/write access", "Program Manager: read-only users list", "Create user: sets Name, Email, Role, Status", "Technical Coordinator: must assign sectors", "Invited users receive a /invite/{token} link"],
    narrationEn: "User management is available to Super Admins with full read and write access, and to Program Managers with read-only access to the users list. To create a new user, enter their name, email, and role. Technical Coordinators must also have sectors assigned. An invited user receives an activation link that the administrator shares with them.",
    durationHint: 10,
    screenshotKey: "users",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("User Management"),
      { kind: "box", x: 738, y: 152, w: 340, h: 30, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 162, text: "Search users...", color: "0xaaaaaa", fontSize: 14 },
      ...mkButton(1090, 152, 120, "Add User", "0x1a2744"),
      { kind: "box", x: 738, y: 192, w: 506, h: 35, color: "0xf9fafb" },
      { kind: "text", x: 748, y: 205, text: "Amira Hassan", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 920, y: 205, text: "Super Admin", color: "0x6b7280", fontSize: 13 },
      ...mkStatusBadge(1140, 200, "Active", "0x16a34a"),
      { kind: "box", x: 738, y: 231, w: 506, h: 35, color: "white" },
      { kind: "text", x: 748, y: 244, text: "Fatima Ahmed", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 920, y: 244, text: "Program Mgr", color: "0x6b7280", fontSize: 13 },
      ...mkStatusBadge(1140, 239, "Active", "0x16a34a"),
      { kind: "box", x: 738, y: 270, w: 506, h: 35, color: "0xfafafa" },
      { kind: "text", x: 748, y: 283, text: "Omar Khalid", color: "0x374151", fontSize: 13 },
      { kind: "text", x: 920, y: 283, text: "State Officer", color: "0x6b7280", fontSize: 13 },
      ...mkStatusBadge(1140, 278, "Invited", "0xd97706"),
    ],
  },

  // =========================================================
  // SECTION 12 — System Manual
  // =========================================================
  {
    type: "section-header",
    sectionNum: 12, sectionEn: "System Manual", sectionAr: "دليل النظام",
    titleEn: "System Manual",
    pointsEn: [],
    narrationEn: "Section twelve: the System Manual.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 12, sectionEn: "Manual",
    titleEn: "Manual Chapters & SOPs",
    pointsEn: ["Sidebar: Resources → Manual", "20+ auto-seeded chapters with icons", "Standard Operating Procedures per chapter", "Search across all sections and content", "Three-column detail: index / content / ToC", "Export chapter as PDF or Word document"],
    narrationEn: "The System Manual has more than twenty chapters covering every module, each with its own standard operating procedures. You can search the manual's content by keyword, and every chapter can be exported as a PDF or Word document. There's also a video library section for watching and downloading training videos.",
    durationHint: 9,
    screenshotKey: "manual",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("System Manual"),
      { kind: "box", x: 738, y: 152, w: 506, h: 30, color: "0xf3f4f6" },
      { kind: "text", x: 748, y: 162, text: "Search chapters and content...", color: "0xaaaaaa", fontSize: 14 },
      { kind: "box", x: 738, y: 192, w: 160, h: 90, color: "0xfafafa" },
      { kind: "text", x: 750, y: 215, text: "Ch.1 Overview", color: "0x1a2744", fontSize: 13 },
      { kind: "box", x: 908, y: 192, w: 160, h: 90, color: "0xfafafa" },
      { kind: "text", x: 920, y: 215, text: "Ch.2 Login", color: "0x1a2744", fontSize: 13 },
      { kind: "box", x: 1078, y: 192, w: 160, h: 90, color: "0xfafafa" },
      { kind: "text", x: 1090, y: 215, text: "Ch.3 Dashboard", color: "0x1a2744", fontSize: 13 },
    ],
  },

  // =========================================================
  // SECTION 13 — Audit Log
  // =========================================================
  {
    type: "section-header",
    sectionNum: 13, sectionEn: "Audit Log", sectionAr: "سجل التدقيق",
    titleEn: "Audit Log",
    pointsEn: [],
    narrationEn: "Section thirteen: the Audit Log.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 13, sectionEn: "Audit Log",
    titleEn: "Full Audit Trail",
    pointsEn: ["Every mutating action logged automatically", "Captures: User, Timestamp, Action, Module", "Before & after snapshots of changed data", "Filter by module, user, date range", "Navigate to Admin → Audit Log (/audit-log)", "Non-repudiable — cannot be edited or deleted"],
    narrationEn: "Every change made in the system is logged automatically in the audit log, along with the user, timestamp, module, and a before-and-after snapshot of the data. The audit log cannot be edited or deleted, and can be filtered by module, user, or date range.",
    durationHint: 10,
    screenshotKey: "audit-log",
    screenshotLayout: "full",
    mockup: [
      ...mkPanel(),
      ...mkHeader("Audit Log"),
      { kind: "box", x: 738, y: 152, w: 506, h: 35, color: "0xf9fafb" },
      { kind: "text", x: 748, y: 163, text: "User", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 848, y: 163, text: "Action", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 1028, y: 163, text: "Module", color: "0x6b7280", fontSize: 13 },
      { kind: "text", x: 1160, y: 163, text: "Time", color: "0x6b7280", fontSize: 13 },
      { kind: "box", x: 738, y: 190, w: 506, h: 30, color: "white" },
      { kind: "text", x: 748, y: 200, text: "Amira", color: "0x374151", fontSize: 12 },
      { kind: "text", x: 848, y: 200, text: "approve_project", color: "0x374151", fontSize: 12 },
      { kind: "text", x: 1028, y: 200, text: "Projects", color: "0x374151", fontSize: 12 },
      { kind: "text", x: 1160, y: 200, text: "09:42", color: "0x6b7280", fontSize: 12 },
      { kind: "box", x: 738, y: 224, w: 506, h: 30, color: "0xfafafa" },
      { kind: "text", x: 748, y: 234, text: "Ahmed M.", color: "0x374151", fontSize: 12 },
      { kind: "text", x: 848, y: 234, text: "submit_report", color: "0x374151", fontSize: 12 },
      { kind: "text", x: 1028, y: 234, text: "Reports", color: "0x374151", fontSize: 12 },
      { kind: "text", x: 1160, y: 234, text: "08:15", color: "0x6b7280", fontSize: 12 },
    ],
  },

  // =========================================================
  // SECTION 14 — Logout
  // =========================================================
  {
    type: "section-header",
    sectionNum: 14, sectionEn: "Logout & Session Management", sectionAr: "تسجيل الخروج وإدارة الجلسة",
    titleEn: "Logout",
    pointsEn: [],
    narrationEn: "Section fourteen: logout and session management.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 14, sectionEn: "Logout",
    titleEn: "Secure Logout",
    pointsEn: ["Click your avatar (top-right corner)", "Select 'Logout' from the dropdown", "Session cookie cleared from browser", "Server-side session invalidated", "Auto-logout after 8 hours of inactivity", "Any open tabs will redirect to login"],
    narrationEn: "To log out, click your avatar in the top-right corner and select Logout. The session cookie is cleared from your browser and the session is invalidated on the server immediately. You'll also be logged out automatically after eight hours of inactivity.",
    durationHint: 9,
    mockup: [
      ...mkPanel(),
      ...mkHeader("User Menu"),
      { kind: "box", x: 900, y: 165, w: 290, h: 170, color: "white" },
      { kind: "box", x: 900, y: 165, w: 290, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 920, y: 185, text: "Amira Hassan", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 920, y: 208, text: "Super Admin", color: "0x6b7280", fontSize: 13 },
      { kind: "box", x: 900, y: 225, w: 290, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 920, y: 245, text: "Profile Settings", color: "0x374151", fontSize: 14 },
      { kind: "text", x: 920, y: 272, text: "System Manual", color: "0x374151", fontSize: 14 },
      { kind: "box", x: 900, y: 290, w: 290, h: 1, color: "0xe5e7eb" },
      { kind: "text", x: 920, y: 308, text: "Logout", color: "0xef4444", fontSize: 14 },
      { kind: "highlight", x: 896, y: 300, w: 298, h: 36, color: "0xef4444@0.15" },
      mkCursor(1185, 312),
    ],
  },

  // =========================================================
  // OUTRO
  // =========================================================
  {
    type: "outro",
    titleEn: "Training Complete",
    pointsEn: ["You are ready to use CAFA PMIS", "For support: pmis-support@cafa.org", "Manual: /manual", "CAFA Development Organization"],
    narrationEn: "You've now walked through every module of the CAFA Program Management System. The system is ready for you to use. For technical support, please reach out at pmis-support@cafa.org. Thank you for watching.",
    durationHint: 8,
  },
];

export const FULL_VIDEO_TITLE = "Full CAFA Program Management System Training";
export const FULL_VIDEO_MODULE = "full-system";
