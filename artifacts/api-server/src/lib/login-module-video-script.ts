import {
  type FullSlide,
  mkPanel,
  mkHeader,
  mkInput,
  mkButton,
  mkCursor,
} from "./full-system-video-script";

// Deep-dive standalone video for Login, sessions, and email verification —
// the full-system walkthrough only gives this one shallow overview slide;
// this covers what actually happens behind the login form (accurate against
// artifacts/api-server/src/routes/auth.ts as of this writing): the specific
// error a user sees for each failure mode, the real lockout threshold, how a
// session actually ends, and the two genuinely separate flows that both
// touch "email" — invited-account setup and email address verification.

export const LOGIN_MODULE_SCRIPT: FullSlide[] = [

  // =========================================================
  // INTRO
  // =========================================================
  {
    type: "intro",
    titleEn: "Login & Email Verification",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on signing in to CAFA PMIS, keeping your session secure, and verifying your email address.",
    durationHint: 8,
  },

  // =========================================================
  // SECTION 1 — Accessing the System
  // =========================================================
  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Accessing the System", sectionAr: "الوصول إلى النظام",
    titleEn: "Accessing the System",
    pointsEn: [],
    narrationEn: "Section one: accessing the system.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Login",
    titleEn: "Signing In",
    pointsEn: ["Open the CAFA PMIS in your browser", "Enter your Username or Email address", "Enter your Password (case sensitive)", "Tick 'Remember me' for a 30-day session", "Click the Sign In button"],
    narrationEn: "To access the system, open your browser and go to the CAFA PMIS link. Enter your registered username or email address, followed by your password — passwords are case sensitive. You can tick 'Remember me' to stay signed in for thirty days instead of the default eight hours. Click Sign In to continue.",
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
    titleEn: "Roles Decide What You Can Do",
    pointsEn: ["7 roles: Super Admin down to State Program Officer", "Your role controls every page and action you can access", "Only ACTIVE accounts can sign in at all", "A non-active account gets one generic error", "Signing in updates your Last Login timestamp"],
    narrationEn: "The system has seven roles, from Super Admin down to State Program Officer, and your role controls exactly which pages and actions are available to you. Only an active account can sign in — if yours is suspended, invited but not yet activated, or deactivated, you'll see the same generic error either way, so the exact reason is never revealed to someone trying to guess it. A successful sign-in updates your account's Last Login timestamp.",
    durationHint: 10,
    mockup: [
      ...mkPanel(),
      ...mkHeader("System Roles"),
      { kind: "text", x: 745, y: 162, text: "Super Admin", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 187, text: "Executive Director", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 212, text: "Program Manager", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 237, text: "Senior Program Coordinator", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 262, text: "Technical Coordinator", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 287, text: "State Office Manager", color: "0x1a2744", fontSize: 15 },
      { kind: "text", x: 745, y: 312, text: "State Program Officer", color: "0x1a2744", fontSize: 15 },
      { kind: "highlight", x: 735, y: 153, w: 510, h: 30, color: "0x00B0EB@0.25" },
    ],
  },

  // =========================================================
  // SECTION 2 — What Can Go Wrong at Login
  // =========================================================
  {
    type: "section-header",
    sectionNum: 2, sectionEn: "What Can Go Wrong at Login", sectionAr: "أخطاء تسجيل الدخول",
    titleEn: "What Can Go Wrong at Login",
    pointsEn: [],
    narrationEn: "Section two: what can go wrong at login, and what each message actually means.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Login Errors",
    titleEn: "Reading a Login Error Correctly",
    pointsEn: ["Wrong username or password: generic 'invalid credentials'", "Account suspended or not yet active: same generic error", "A network problem: a distinct 'network error' message", "Too many attempts from your network: 'too many requests'", "None of these reveal which part was actually wrong"],
    narrationEn: "An incorrect username or password shows a generic 'invalid credentials' message, and a suspended or not-yet-active account shows that exact same message — this is deliberate, so no one can tell from the error alone whether an account exists or why it's blocked. A connectivity problem shows a distinct network-error message instead, and too many attempts in a short time shows a 'too many requests' message. None of these ever say which part specifically was wrong.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Login Errors",
    titleEn: "Repeated Failed Attempts Lock the Account",
    pointsEn: ["10 failed attempts against the same account within 15 minutes", "…locks that account for 15 minutes", "The lockout is per-account, not per-device", "Waiting out the 15 minutes clears it automatically", "Contact an administrator if you're locked out and can't wait"],
    narrationEn: "If ten sign-in attempts against the same account fail within a fifteen-minute window, that account is locked for fifteen minutes — this protects the account itself, regardless of which device or location the attempts came from. The lockout clears automatically once the fifteen minutes pass; there's nothing to reset manually. If you can't wait, contact an administrator.",
    durationHint: 10,
  },

  // =========================================================
  // SECTION 3 — Staying Signed In
  // =========================================================
  {
    type: "section-header",
    sectionNum: 3, sectionEn: "Staying Signed In", sectionAr: "البقاء مسجلاً للدخول",
    titleEn: "Staying Signed In",
    pointsEn: [],
    narrationEn: "Section three: staying signed in, and what happens when your session ends.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 3, sectionEn: "Sessions",
    titleEn: "How Long a Session Lasts",
    pointsEn: ["Default session: 8 hours from sign-in", "'Remember me' at login: 30 days instead", "Signing out ends the session immediately, everywhere", "An expired session sends you straight back to the login page", "Any unsaved work should be saved before a session runs out"],
    narrationEn: "By default your session lasts eight hours from when you signed in. Ticking 'Remember me' at login extends that to thirty days instead. Signing out ends the session immediately. If a session expires while you're using the system, you're automatically sent back to the login page the next time you try to do something — so it's worth saving any work in progress rather than leaving a tab open unattended for hours.",
    durationHint: 10,
  },

  // =========================================================
  // SECTION 4 — Email Verification
  // =========================================================
  {
    type: "section-header",
    sectionNum: 4, sectionEn: "Email Verification", sectionAr: "التحقق من البريد الإلكتروني",
    titleEn: "Email Verification",
    pointsEn: [],
    narrationEn: "Section four: verifying your email address.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 4, sectionEn: "Email Verification",
    titleEn: "Confirming Your Email Address",
    pointsEn: ["A verification link is sent to your email on request", "The link stays valid for 24 hours", "Opening it marks your email as verified", "Requesting a new link cancels any earlier unused one", "You can request at most 5 links per hour"],
    narrationEn: "Email verification is separate from your account being active — it confirms you actually control the email address on file. A verification link can be requested at any time and stays valid for twenty-four hours; opening it marks your email verified. Requesting a new link automatically cancels any earlier one you hadn't used yet, and you can request at most five links per hour.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 4, sectionEn: "Email Verification",
    titleEn: "If the Link Doesn't Work",
    pointsEn: ["A used link shows 'already used'", "An expired link (after 24 hours) shows 'link expired'", "Either way, just request a new verification email", "The request always replies the same way either way", "…so no one can tell if an address is registered from the reply"],
    narrationEn: "If a verification link has already been used, or if more than twenty-four hours have passed, opening it shows a clear message saying so — the fix in both cases is simply to request a new one. Note that requesting a verification email always gets the same reply regardless of whether that address is actually registered, so the response itself never reveals which emails exist in the system.",
    durationHint: 10,
  },

  // =========================================================
  // SECTION 5 — Invited Accounts
  // =========================================================
  {
    type: "section-header",
    sectionNum: 5, sectionEn: "Invited Accounts", sectionAr: "الحسابات المدعوة",
    titleEn: "Invited Accounts",
    pointsEn: [],
    narrationEn: "Section five: setting up an account you were invited to.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 5, sectionEn: "Invited Accounts",
    titleEn: "First-Time Setup From an Invite",
    pointsEn: ["An administrator creates your account and sends an invite link", "Your account starts with status 'invited', no password yet", "Opening the invite link lets you set your own password", "Setting it activates your account immediately", "This is separate from email verification — do both"],
    narrationEn: "When an administrator creates your account, it starts with an 'invited' status and no password set — instead, you receive an invite link. Opening that link lets you choose your own password, and setting it activates your account right away so you can sign in. This invite step is separate from email verification — completing your account setup doesn't automatically verify your email, so it's worth doing both.",
    durationHint: 10,
  },

  // =========================================================
  // OUTRO
  // =========================================================
  {
    type: "outro",
    titleEn: "Login & Email Verification — Complete",
    pointsEn: ["You know how to sign in, read login errors, and manage sessions", "You know how email verification and invited accounts work", "For support: pmis-support@cafa.org", "CAFA Development Organization"],
    narrationEn: "You've now covered signing in, reading login errors correctly, session duration, email verification, and setting up an invited account. For technical support, please reach out at pmis-support@cafa.org. Thank you for watching.",
    durationHint: 8,
  },
];

export const LOGIN_VIDEO_TITLE = "Login & Email Verification — Deep Dive";
export const LOGIN_VIDEO_MODULE = "login";
