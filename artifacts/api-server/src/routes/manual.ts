import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";
import { logAudit, requirePerm } from "../middlewares/currentUser";
import { MANUAL_ARABIC_DRAFT, MANUAL_SOP_STEP_ARABIC_DRAFT } from "../lib/manual-arabic-draft";
import {
  legacyManualSourceChecksums,
  manualSourceChecksum,
} from "../lib/manual-localization-checksum";

const router: IRouter = Router();

const canEdit = (req: Request) =>
  ["super_admin", "program_manager"].includes(req.currentUser!.role);

const canEditContent = (req: Request) =>
  ["super_admin", "program_manager", "senior_program_coordinator"].includes(req.currentUser!.role);

/* ── Initial seed data ────────────────────────────────────────────────── */

type SeedChapter = {
  title: string;
  slug: string;
  description: string;
  icon: string;
  sections: { title: string; content: string }[];
  sops?: {
    processName: string;
    purpose: string;
    responsibleRole: string;
    steps: string[];
    requiredInputs: string;
    approvalFlow: string;
    outputs: string;
    timeline: string;
    relatedModule: string;
    notifications: string;
  }[];
};

const INITIAL_CHAPTERS: SeedChapter[] = [
  {
    title: "Introduction",
    slug: "introduction",
    description: "System overview, purpose, and getting started guide for all CAFA staff.",
    icon: "BookOpen",
    sections: [
      {
        title: "System Overview",
        content: `CAFA PMIS (Project Management Information System) is the central digital platform for the CAFA Development Organization (منظمة كافا للتنمية) Sudan operations. It enables staff to plan, implement, monitor, and report on humanitarian projects across the canonical 18-State Sudan registry.

The system provides a unified workspace for project tracking, beneficiary management, budget monitoring, risk assessment, and multi-level reporting — replacing fragmented spreadsheets with a structured, auditable workflow.

Key modules include: Dashboard, Projects, Planning, Budget, Reports (Project, HQ Sector, and State Programme), Risks, Notifications, Communication Centre, States, Users, Audit Log, AI, File & Archive, and this System Manual.`,
      },
      {
        title: "Getting Started",
        content: `To access CAFA PMIS, open a supported web browser and navigate to the system URL provided by your administrator.

Log in using your username (or email address) and password. New users receive an invitation link from the system administrator — follow the link to activate your account and set a password.

Upon logging in, you will see the Dashboard, which provides a real-time overview of active projects, beneficiaries, and key performance indicators relevant to your role.

Navigate using the left sidebar. The sidebar groups features by category: Overview, Operations, Planning, Reporting, Communication, and Administration. Clicking a group expands its sub-items.`,
      },
      {
        title: "System Requirements",
        content: `- Browser: Google Chrome (recommended), Mozilla Firefox, or Microsoft Edge — latest versions
- Internet: A stable internet connection is required at all times
- Screen: Minimum 1024×768 resolution; 1280×800 or higher recommended
- Language: English interface; Arabic interface is planned for a future release
- Documents: PDF reader required for viewing exported reports and manual chapters

For best performance, keep your browser updated and avoid using Internet Explorer.`,
      },
    ],
  },
  {
    title: "User Roles & Permissions",
    slug: "user-roles-permissions",
    description: "The eight CAFA staff roles, what each can do, and how role assignment works.",
    icon: "Users",
    sections: [
      {
        title: "Role Overview",
        content: `CAFA PMIS defines eight user roles, each with a specific scope of access:

- Super Admin: Full system access. Can create, edit, and delete all records, manage users, and view the audit log.
- Executive Director: Read-only access to all programme data and reports for senior oversight.
- Programme Manager: Approves projects, reports, and plans. Reviews all staff submissions. Manages users.
- Senior Programme Coordinator: Coordinates multi-state programmes. Reviews and coordinates submissions before Programme Manager approval.
- Technical Coordinator: Manages activities within assigned sector(s). Data access is automatically restricted to their sector.
- State Office Manager: Manages all CAFA operations within one assigned state. Oversees state-level staff and reporting.
- State Programme Officer: Operational field officer. Creates project registrations, plans, activity reports, and risk logs.
- Programme Assistant: Supports programme staff with data entry, document management, and administrative tasks. Limited write access.`,
      },
      {
        title: "Permission Matrix",
        content: `## Projects
- Super Admin: Create, edit, delete, approve
- Executive Director: View only
- Programme Manager: View, approve, close
- Senior Programme Coordinator: View, coordinate review
- Technical Coordinator: View (sector-restricted), technical review
- State Office Manager: Create, edit, view (own state)
- State Programme Officer: Create, submit
- Programme Assistant: View (assigned projects), data entry support

## Reports
- Super Admin: Full access
- Programme Manager: View, final approve
- Senior Programme Coordinator: View, coordinate review
- Technical Coordinator: Create, submit (sector-restricted)
- State Office Manager: Create, submit (state-level reports)
- State Programme Officer: Create, submit
- Programme Assistant: View (assigned)

## Plans
- Super Admin: Full access
- Programme Manager: View, final approve, activate
- Senior Programme Coordinator: View, coordinate review
- Technical Coordinator: Create, technical review (sector-restricted)
- State Office Manager: Create, submit
- State Programme Officer: Create, submit
- Programme Assistant: View (assigned)

## Users & Admin
- Super Admin: Full user management
- Programme Manager: View users
- All others: No access to user administration`,
      },
      {
        title: "Role Assignment & Changes",
        content: `User roles are assigned by the System Administrator during account creation. Users cannot change their own role.

To request a role change, contact your Programme Manager or System Administrator.

Technical Coordinators must have at least one programme sector assigned. Their access is automatically restricted to projects, plans, and reports within their assigned sector(s). A Technical Coordinator with no sector assigned is effectively locked out — this is intentional to prevent data leakage.

Role changes take effect immediately upon saving. The previous role and new role are recorded in the Audit Log.`,
      },
    ],
    sops: [
      {
        processName: "User Account Creation & Onboarding",
        purpose: "Create a new CAFA PMIS user account and onboard them to the system.",
        responsibleRole: "Super Admin",
        steps: [
          "Navigate to Administration → Users",
          "Click 'Create User' button",
          "Enter user name, email, username, role, state assignment (if applicable), and sector (for Technical Coordinators)",
          "Click 'Create User' — the system generates a unique 7-day invitation link",
          "Copy the invitation link displayed in the confirmation dialog",
          "Share the link with the new user via email or WhatsApp",
          "User clicks the link, sets their password, and their account becomes active",
          "Verify the user appears as 'Active' in the Users list",
        ],
        requiredInputs: "Full name, email address, role, state (for state-level roles), sector (for Technical Coordinators)",
        approvalFlow: "No approval required — admin action only",
        outputs: "Active user account; invitation link shared with new staff member",
        timeline: "Immediate — user can activate within 7 days of link generation",
        relatedModule: "Users",
        notifications: "No system notification. Admin shares link manually.",
      },
    ],
  },
  {
    title: "Dashboard",
    slug: "dashboard",
    description: "Reading the dashboard KPI cards, charts, and beneficiary breakdown.",
    icon: "LayoutDashboard",
    sections: [
      {
        title: "Dashboard Overview",
        content: `The Dashboard is the first screen displayed after login. It provides a real-time snapshot of CAFA's programme performance relevant to the logged-in user's role and permissions.

Data on the Dashboard is drawn live from the database — there is no caching delay. Refreshing the page will show the latest figures.

The dashboard is organised into: KPI Summary Cards (top row), Charts and Visualisations (middle), and Quick Navigation links.`,
      },
      {
        title: "KPI Summary Cards",
        content: `## Total Active Projects
Number of projects currently in Active or In Progress status. Click to navigate to the Projects list pre-filtered to active projects.

## Total Beneficiaries
Aggregated count of all registered beneficiaries across active projects. Click this card to open the Beneficiary Breakdown modal, which shows counts by gender (Male/Female), age (Boys/Girls), and displacement category (IDP, returnee, host community, refugee).

## Total Budget
Sum of all approved project budgets in USD equivalent. Projects budgeted in SDG are shown separately to avoid incorrect currency conversion.

## Budget Utilisation
Percentage of total approved budget spent to date (Actual ÷ Planned × 100%). A figure above 90% signals potential overrun; below 20% at mid-implementation may indicate delays.`,
      },
      {
        title: "Dashboard Charts",
        content: `## Projects by State
A bar chart showing how many active projects are running in each State in the canonical 18-State registry. Useful for understanding geographic programme coverage.

## Beneficiaries by Sector
A pie chart showing the distribution of beneficiaries across CAFA's programme sectors (WASH, Health, Protection, Education, etc.).

## Budget Burn Rate
A bar chart comparing planned vs. actual budget by project or state. Hover over bars to see exact figures.

Charts update automatically as underlying project data changes. No manual refresh is required.`,
      },
    ],
  },
  {
    title: "Projects",
    slug: "projects",
    description: "Registering projects, managing the lifecycle, outputs, activities, and documents.",
    icon: "FolderKanban",
    sections: [
      {
        title: "Project Overview",
        content: `Projects are the core unit of CAFA PMIS. Each project represents a funded humanitarian intervention with defined geography, target population, budget, outputs, and activities.

Every project is assigned a unique auto-generated code (e.g. CAFA-KRT-001 for a Khartoum project) and progresses through a structured approval workflow before becoming active for implementation.

Projects can be managed at two levels:
- HQ Managed: Projects overseen directly from CAFA headquarters, spanning multiple states.
- State Managed: Projects managed at state level with a state-based implementation team.`,
      },
      {
        title: "Creating a Project",
        content: `To register a new project:

1. Navigate to Projects in the sidebar.
2. Click "New Project" (top right).
3. Complete the registration form across 8 sections:

## Section 1 — Basics
Project title, sector, description, start and end dates.

## Section 2 — Management Level
Select HQ Managed or State Managed.

## Section 3 — Geography
Select one or more implementing states and localities.

## Section 4 — Role Assignments
Assign the Project Manager, Technical Coordinator(s), and State Programme Officers.

## Section 5 — Beneficiary Targets
Enter planned beneficiary counts by gender and age group.

## Section 6 — Budget & Currency
Enter total budget and select currency (USD or SDG).

## Section 7 — Outputs & Activities
Define project outputs and their associated activities and indicators.

## Section 8 — Documents
Upload signed project documents (proposal, donor agreement, etc.).

4. Click "Submit for Review" to start the approval workflow, or "Save as Draft" to save progress.`,
      },
      {
        title: "Project Workflow & Lifecycle",
        content: `Projects follow a structured approval chain before they can be activated:

Draft → Submitted → Technically Approved → Coordination Approved → Approved → Active → Closed

## Workflow Steps
- Submit (State Programme Officer): Submits the project for technical review.
- Technical Review (Technical Coordinator): Reviews sector-specific aspects.
- Coordination Review (Senior Programme Coordinator): Coordinates across states/sectors.
- Final Approval (Programme Manager): Signs off on the full project.
- Activate (Programme Manager): Moves the project to Active status for implementation.
- Close (Programme Manager): Formally closes completed or terminated projects.

Projects can also be Rejected or Returned for Revision at any review stage. A written reason must be provided and is automatically saved as a comment on the project.`,
      },
      {
        title: "Managing Documents",
        content: `Project documents are uploaded through the Documents section of the project detail page. Each document requires a type classification (e.g., Project Proposal, Donor Agreement, Completion Report).

Supported formats: PDF, DOCX, XLSX, JPG, PNG. Maximum size: 10 MB per file.

Documents are stored securely in CAFA object storage. To delete a document, click the delete icon next to it (only the uploader or an admin can delete).

All document uploads and deletions are recorded in the Audit Log.`,
      },
    ],
    sops: [
      {
        processName: "Project Registration",
        purpose: "Register a new humanitarian project in CAFA PMIS and initiate the approval workflow.",
        responsibleRole: "State Programme Officer / State Office Manager",
        steps: [
          "Ensure you have all required project information available: title, sector, geography, budget, assigned staff, and a signed project document",
          "Navigate to Projects → click 'New Project'",
          "Complete all 8 sections of the registration form",
          "Upload at least one signed project document in the Documents section",
          "Review all information carefully before submitting",
          "Click 'Submit for Review' — the project status changes to Submitted",
          "Notify the Technical Coordinator that a new project is pending their review",
          "Monitor the project status — you will receive in-app notifications on each approval step",
        ],
        requiredInputs: "Project title, sector, state(s), start/end dates, management level, responsible staff, budget, signed document",
        approvalFlow: "State Programme Officer → Technical Coordinator → Senior Programme Coordinator → Programme Manager → Activate",
        outputs: "Approved project with unique code (CAFA-{STATE}-{NNN}); project team notified",
        timeline: "Target: 5 working days from submission to approval",
        relatedModule: "Projects",
        notifications: "Notification sent to each reviewer at their stage; submitter notified on approval or rejection",
      },
    ],
  },
  {
    title: "Planning",
    slug: "planning",
    description: "Plan types, creating plans, objectives, activities, and the plan approval workflow.",
    icon: "CalendarClock",
    sections: [
      {
        title: "Plan Types",
        content: `CAFA PMIS supports six plan types to cover all operational planning needs:

- Monthly: Short-term implementation plans covering a single calendar month. Used for routine operational planning.
- Quarterly: Multi-month plans aligned with quarterly reporting and funding cycles.
- Annual: Full-year work plans, typically prepared and approved at the start of each year.
- Action Plan: Targeted plans for specific activities, events, or response interventions.
- Operational: Detailed plans governing day-to-day service delivery operations.
- Emergency: Rapid-onset plans for sudden humanitarian crises requiring immediate response.

Plans can be linked to a specific project or operate as standalone state/sector plans.`,
      },
      {
        title: "Creating a Plan",
        content: `To create a new plan:

1. Navigate to Planning → Plans (or Planning → Action Plans for action-type plans).
2. Click "New Plan".
3. Complete the plan form:

## Basics
Plan title, type, linked project (optional), state, sector, responsible staff, description.

## Objectives
Add one or more measurable objectives. Each objective has a title, priority (critical/high/medium/low), description, and expected outcome.

## Activities
Under each objective, add implementing activities with: title, start/end dates, responsible staff, status, progress percentage, planned/actual budget, expected output, and performance indicator.

## Budget
Enter total planned budget and actual expenditure to date.

4. Click "Submit for Review" to initiate the approval workflow, or "Save as Draft" to save progress.`,
      },
      {
        title: "Plan Approval Workflow",
        content: `Plans follow the same 5-stage approval chain used for Projects:

Draft → Submitted → Technically Approved → Coordination Approved → Approved → Active → In Progress → Completed / Delayed

## Key Rules
- Final Approval is blocked if there are any open "Required Correction" comments on the plan.
- Rejection and Revision requests require a written reason, which is automatically saved as a comment.
- Once a plan is Approved, it must be Activated before work can begin (status: Active).
- Plans can be marked as In Progress, Delayed, or Completed from Active/In Progress states.
- Completed or Cancelled plans can be Archived.

Notifications are sent to all relevant staff at each transition.`,
      },
    ],
    sops: [
      {
        processName: "Monthly Plan Submission",
        purpose: "Prepare and submit a monthly operational plan for approval before implementation begins.",
        responsibleRole: "State Programme Officer / State Office Manager",
        steps: [
          "Prepare the monthly plan at least 5 working days before the month start date",
          "Navigate to Planning → Plans → click 'New Plan'",
          "Select Plan Type: Monthly; enter the correct state, sector, and dates",
          "Add all planned objectives with clear, measurable expected outcomes",
          "Add all activities under each objective: dates, responsible staff, and budgets",
          "Review for completeness — all required fields must be filled",
          "Click 'Submit for Review'",
          "Follow up with the Technical Coordinator if not reviewed within 2 working days",
          "Once approved and activated, begin implementation",
          "Update activity progress percentages regularly throughout the month",
        ],
        requiredInputs: "Plan title, state, sector, start/end dates, responsible staff, at least one objective with one activity",
        approvalFlow: "State Programme Officer → Technical Coordinator → Senior Programme Coordinator → Programme Manager → Activate",
        outputs: "Approved and activated monthly plan; staff notified; activities ready for progress tracking",
        timeline: "Submit at least 5 days before month start; target approval within 3 working days",
        relatedModule: "Planning",
        notifications: "Reviewer notified on submission; submitter notified on approval, rejection, or revision request",
      },
    ],
  },
  {
    title: "Reports",
    slug: "reports",
    description: "Creating, managing, and approving the three types of CAFA narrative reports.",
    icon: "FileText",
    sections: [
      {
        title: "Report Types",
        content: `CAFA PMIS supports three types of narrative reports, each serving a different reporting audience:

## Project Report
Progress report for a specific project. Covers implementation progress, activities completed, budget utilisation, and beneficiaries reached. Submitted by the project team and reviewed through the 3-stage approval chain.

## HQ Sector Report
Sector-wide consolidated report compiled at headquarters level. Covers all projects and activities within a programme sector (e.g., all WASH activities across all states). Submitted by the Technical Coordinator for the sector.

## State Programme Report
State-level consolidated report covering all CAFA activities in a specific state. Submitted by the State Office Manager and reviewed by the Programme Manager.

All report types share a standard 4-section structure.`,
      },
      {
        title: "Report Structure (All Types)",
        content: `Every CAFA narrative report follows this standard structure:

## Section 1 — Cover Information
Auto-populated: report type, reporting period, state/sector, responsible staff, submission date.

## Section 2 — Progress Narrative
Free-text description of implementation progress against planned activities. Minimum 3 paragraphs recommended.

## Section 3 — Activities Implemented
A structured table of activities completed during the reporting period. For each activity, record: name, output/milestone, status (Planned/In Progress/Completed/Delayed/Cancelled), percentage complete, budget utilised, and beneficiaries reached.
Click "Add Activity" to add rows. Activities can be edited or deleted before submission.

## Section 4 — Challenges and Way Forward
Free-text description of challenges encountered and planned actions to address them.`,
      },
      {
        title: "Creating and Submitting a Report",
        content: `1. Navigate to Reports → select the relevant report type sub-page.
2. Click "New Report".
3. Select the reporting period (month/year), state or sector as applicable.
4. Complete Section 2 (Progress Narrative).
5. Add all activities in Section 3 using the "Add Activity" repeater.
6. Complete Section 4 (Challenges and Way Forward).
7. Click "Submit Report" to submit immediately, or "Save as Draft" to save progress for later.

Reports submitted immediately go to Submitted status and trigger a notification to the next reviewer.

## Export
Each report list page has an "Export CSV" button that downloads the currently filtered list as a spreadsheet.`,
      },
      {
        title: "Report Approval Workflow",
        content: `Reports follow a 3-stage approval chain:

Draft → Submitted → Coordination Approved → Approved → (Archived)

## Stage Details
- Submit: Report author submits the completed report.
- Coordination Review (Senior Programme Coordinator): Reviews for accuracy, completeness, and cross-state coordination.
- Final Approval (Programme Manager): Signs off on the report for official record.
- Archive: Approved reports can be archived to move them out of active view.

Reports can be Rejected or Returned for Revision at any stage. A written reason is required and is saved as a comment.

After final approval, reports can be exported as a reference document.`,
      },
    ],
    sops: [
      {
        processName: "Monthly Report Submission",
        purpose: "Compile and submit a project or state monthly progress report within the reporting deadline.",
        responsibleRole: "State Programme Officer / Technical Coordinator / State Office Manager",
        steps: [
          "Collect activity completion data from field staff before the reporting deadline",
          "Navigate to Reports → select your report type → click 'New Report'",
          "Select the correct reporting month and year",
          "Complete Section 2 with a clear narrative of progress — reference the plan and objectives",
          "Add all activities implemented during the month in Section 3",
          "Enter accurate beneficiary counts broken down by gender and age",
          "Complete Section 4 with specific challenges and concrete actions planned",
          "Review all sections for accuracy and completeness",
          "Click 'Submit Report' before the reporting deadline",
          "Notify your line manager / Senior Programme Coordinator that the report is submitted",
        ],
        requiredInputs: "Reporting period, Section 2 narrative, at least one activity record, Section 4 narrative",
        approvalFlow: "Author → Senior Programme Coordinator → Programme Manager",
        outputs: "Submitted report in system; reviewer notified; report accessible for approval",
        timeline: "Submit by the 5th working day of the following month",
        relatedModule: "Reports",
        notifications: "Reviewer notified on submission; author notified on approval, rejection, or return for revision",
      },
    ],
  },
  {
    title: "Budget",
    slug: "budget",
    description: "Budget fields, burn rate calculation, multi-currency handling, and finance dashboards.",
    icon: "PieChart",
    sections: [
      {
        title: "Budget Overview",
        content: `Budget tracking in CAFA PMIS operates at the project and plan level. Each project and plan carries a total planned budget and actual expenditure figure, enabling real-time burn rate monitoring.

The system does not replace CAFA's financial accounting software. It provides programme staff with visibility into budget utilisation to support management decisions, identify overspend risks, and report to donors.

The Budget page in the sidebar aggregates budget data across all active projects for a consolidated view.`,
      },
      {
        title: "Budget Fields",
        content: `## Project Budget Fields
- Budget Planned (Total): The total approved budget for the project (in selected currency).
- Budget Actual: Expenditure recorded to date.
- Burn Rate %: Actual ÷ Planned × 100.

## Plan Activity Budget Fields
Each plan activity has its own planned and actual budget, enabling granular tracking at the activity level.

## Currency
Projects and plans can be budgeted in USD (US Dollar) or SDG (Sudanese Pound). Select the correct currency at registration. The system does not convert currencies — all comparisons are within the same denomination.

For multi-currency programme analysis, use the CSV export and apply conversion in a spreadsheet.`,
      },
      {
        title: "Reading Burn Rate",
        content: `The burn rate percentage indicates how much of the approved budget has been consumed:

- 0–20%: Very low utilisation. If more than halfway through implementation, this may indicate delays.
- 20–70%: Normal range depending on implementation stage.
- 70–90%: Monitor closely — approaching budget limit.
- 90–100%: High risk of overrun. Review and notify the Programme Manager.
- Over 100%: Budget overrun — requires immediate escalation.

Burn rates are shown as colour-coded progress bars in the Budget page.

## Tips
- Update actual expenditure figures regularly (at minimum monthly).
- Flag projects with anomalous burn rates in the monthly report (Section 4).
- Use the risk register to log financial overrun risks before they become critical.`,
      },
    ],
  },
  {
    title: "Risks",
    slug: "risks",
    description: "Logging risks, the severity × likelihood matrix, and mitigation tracking.",
    icon: "AlertTriangle",
    sections: [
      {
        title: "Risk Overview",
        content: `The Risk Register captures operational, financial, programmatic, security, and environmental risks affecting CAFA projects and state operations.

Likelihood and Impact are each rated on a three-level scale: Low, Medium, and High. The Risk Score is calculated as the product of these two ratings (range 1–9). Risk levels are assigned as follows: Critical (score 9), High (6–8), Medium (2–5), and Low (score 1).

Critical and High risks require a documented mitigation plan and should be escalated to the Programme Manager.`,
      },
      {
        title: "Risk Categories",
        content: `CAFA PMIS classifies risks into five categories:

- Operational: Risks to day-to-day activities — logistics, staffing, access.
- Financial: Budget overruns, donor payment delays, exchange rate fluctuations.
- Programmatic: Risks to achieving project outcomes — low enrolment, partner capacity gaps.
- Security: Staff safety, asset security, site access.
- Environmental: Flooding, drought, seasonal access constraints.

Select the most accurate category when logging a risk. This enables filtering and thematic analysis across the risk register.`,
      },
      {
        title: "Logging and Managing Risks",
        content: `To log a new risk:

1. Navigate to Risks in the sidebar.
2. Click "Log New Risk".
3. Enter: Title, Category, Description. Severity and Likelihood each use a three-level scale (Low / Medium / High).
4. Link to a project if the risk affects a specific project.
5. Enter a Mitigation Plan — concrete steps to reduce the risk.
6. Save the risk. It appears in the register with its risk score and colour-coded level.

## Managing Existing Risks
- Edit risks as the situation evolves (e.g., severity changes after mitigation).
- Filter the register by category, level, state, or project.
- Export the full register as CSV for donor risk reporting.
- Log all emerging risks promptly — do not wait until they materialise.`,
      },
    ],
    sops: [
      {
        processName: "Risk Registration",
        purpose: "Log a new risk to the CAFA PMIS risk register for tracking and mitigation planning.",
        responsibleRole: "State Programme Officer / Technical Coordinator / State Office Manager",
        steps: [
          "Identify the risk through project monitoring, field reports, or staff feedback",
          "Navigate to Risks → click 'Log New Risk'",
          "Enter a clear, specific risk title (e.g., 'Flooding risk at Site B affecting latrine access')",
          "Select the most appropriate category",
          "Select Severity (Low / Medium / High) and Likelihood (Low / Medium / High)",
          "Link to the affected project if applicable",
          "Write a concrete mitigation plan with specific actions and responsible persons",
          "Save the risk",
          "If the risk level is Critical (score 9), notify your line manager immediately",
          "Review and update the risk status monthly or when the situation changes",
        ],
        requiredInputs: "Risk title, category, description, severity score, likelihood score, mitigation plan",
        approvalFlow: "No approval required — any authorised staff can log risks",
        outputs: "Risk record visible in register; risk score and level computed automatically",
        timeline: "Log within 24 hours of identifying the risk",
        relatedModule: "Risks",
        notifications: "No automatic notification — escalate Critical risks verbally or via the Communication Centre",
      },
    ],
  },
  {
    title: "Communication Centre",
    slug: "communication",
    description: "Real-time messaging, voice notes, file sharing, @mentions, pinned messages, and team collaboration features.",
    icon: "MessageSquare",
    sections: [
      {
        title: "Overview & Conversation Types",
        content: `The Communication Centre provides real-time messaging and collaboration for all CAFA PMIS users. It supports text, voice, images, documents, emojis, @mentions, and threaded replies — all secured within the system.

## Supported Conversation Types

| Type | Description |
|---|---|
| **Direct** | Private one-to-one message between two CAFA staff members |
| **Group** | Multi-user group conversation for a defined set of participants |
| **Project** | Conversation linked to a specific project, visible to all project team members |
| **State** | Conversation for all staff operating in a specific state |
| **Sector / TC Group** | Conversation for all staff within a Technical Coordinator's assigned sector |
| **Announcement** | Broadcast from HQ or management — members cannot reply |

## Starting a Conversation

1. Click **Communication** in the left sidebar to open the Messages page.
2. Click the **+** button (top right of the conversation list).
3. Select the conversation type from the modal.
4. For TC Groups, use the **TC Group** quick-create button — it auto-populates the sector and members.
5. Add participants, set a name, and click **Create**.

## Searching Conversations

Use the search bar at the top of the conversation list to filter by conversation name or participant. The tabs — All, Unread, Direct, Projects, States, Sectors, Broadcasts — help narrow down your view.`,
      },
      {
        title: "Voice Messages",
        content: `Users can record and send voice messages directly within any conversation — no external app required.

## How to Record a Voice Message

1. Open a conversation and locate the **microphone icon** (🎙) in the message input bar.
2. Click the icon to start recording. A red pulsing indicator confirms recording is active.
3. Speak your message. A live timer shows the recording duration.
4. Click **Stop** (■) to end the recording.

## How to Send a Voice Message

After stopping the recording, a preview bar appears with:
- A waveform / duration display
- A **Play** button to preview before sending
- A **Discard** button (✕) to cancel
- A **Send** button (→) to deliver

Click **Send** to publish the voice message to the conversation.

## How to Listen to a Voice Message

Received voice messages appear as audio player bubbles in the chat:
- Click **Play** (▶) to begin playback.
- Click **Pause** (⏸) to pause mid-playback.
- Drag the scrubber to jump to any point in the recording.
- The elapsed and remaining time are shown numerically.`,
      },
      {
        title: "Image Sharing",
        content: `Users can upload, preview, and download images directly within any conversation.

## Uploading Images

1. Click the **attachment icon** (📎) in the message input bar, or drag and drop an image file into the chat window.
2. A thumbnail preview appears in the pending files bar above the input.
3. Optionally type an accompanying caption, then click **Send**.
4. The image appears as a thumbnail bubble in the chat for all conversation members.

## Previewing Images (Lightbox)

Click on any image thumbnail in the chat to open the **Image Lightbox** — a fullscreen overlay that displays the full-resolution image. Press **Escape** or click outside to close.

## Downloading Images

In the lightbox view, click **Download** to save the image to your device. All images are also accessible from the **Media Gallery** (Photos tab).

## Supported Image Formats

JPEG, PNG, GIF, WebP, SVG.`,
      },
      {
        title: "Document Sharing",
        content: `Users can share documents and files in any conversation. All attachments are stored securely within CAFA PMIS.

## Uploading Documents

1. Click the **attachment icon** (📎) in the message input bar.
2. Select the file from your device. A file preview card (icon + filename) appears in the pending files bar.
3. Click **Send** to deliver the document to the conversation.

## Downloading Shared Documents

Click the file card in the chat and then click **Download** to save it to your device. Files are also accessible from the **Media Gallery** under the **Docs** tab.

## Supported File Types

| Category | Extensions |
|---|---|
| PDF | .pdf |
| Word | .doc, .docx |
| Excel | .xls, .xlsx |
| PowerPoint | .ppt, .pptx |
| Images | .jpg, .jpeg, .png, .gif, .webp |
| Others | .zip, .csv, .txt |

## File Size Limit

Individual file attachments are limited to **20 MB**. For larger files, use the project Documents module.

> **Note:** Message attachments are for informal coordination only. Official programme documents must be uploaded via the project Documents tab to appear in the project audit trail.`,
      },
      {
        title: "Media Gallery",
        content: `Each conversation has a **Media Gallery** that collects all shared media in one place for easy retrieval.

## Opening the Media Gallery

1. Open a conversation and click the **Media Gallery** icon (or ⋮ overflow menu → Media Gallery).
2. A side panel slides in from the right.

## Gallery Tabs

| Tab | Contents |
|---|---|
| **Photos** | All image files shared in the conversation, displayed as thumbnails |
| **Docs** | All non-image file attachments, listed with filename and sender |
| **Voice** | All voice message recordings, playable directly from the gallery |

## Using the Gallery

- Click any photo thumbnail to open it in the Image Lightbox.
- Click any document entry to download the file.
- Click the play button next to a voice entry to listen to the recording.
- Scroll down to load older media (lazy-loaded in batches).

The Media Gallery shows media from the full conversation history, regardless of how far back you'd need to scroll in the main chat.`,
      },
      {
        title: "Emoji Messages & Reactions",
        content: `The Communication Centre supports emoji characters in message text and emoji reactions on individual messages.

## Inserting Emojis in Messages

Type any emoji directly from your device keyboard or paste Unicode emoji characters into the message input. Emojis render visually in the sent message for all members.

## Emoji Reactions

Reactions let you respond to a message quickly without sending a reply.

### Adding a Reaction

1. Hover over any message bubble to reveal the action icons.
2. Click the **emoji icon** to open the reactions picker.
3. Choose from the six standard reactions: 👍 ❤️ 😂 👏 🎉 🙏
4. The reaction appears immediately as a pill below the message, visible to all members.

### Removing a Reaction

Click the same emoji pill below the message to toggle your reaction off.

### Viewing Reaction Counts

Each emoji pill shows the count of users who reacted. Hover over a pill to see the names of all users who used that reaction.`,
      },
      {
        title: "Message Reply",
        content: `Users can reply directly to any specific message, quoting it for context.

## Replying to a Message

1. Hover over the message you want to reply to.
2. Click the **Reply icon** (↩) in the action bar that appears.
3. A reply preview bar appears above the message input, showing the original sender's name and a short preview.
4. Type your reply and click **Send** (or press Enter).

## Supported Message Types for Reply

You can reply to text messages, voice messages, images, and document attachments.

## Navigating to the Original Message

Click on the quoted preview block within a reply to scroll the chat to the original message and briefly highlight it.

## Cancelling a Reply

Click the **✕** button in the reply preview bar to dismiss and return to normal composing.`,
      },
      {
        title: "Message Edit",
        content: `Users can correct their own text messages within a 15-minute window after sending.

## How to Edit a Message

1. Hover over your own message bubble.
2. Click the **⋮ (more options)** menu → **Edit Message**.
3. The message input switches to edit mode, pre-filled with the original text.
4. Make your changes and click **Save** (or press Enter).

## Edit Time Window

The edit option is only available for **15 minutes** after sending. This limit is enforced server-side.

## Visual Indicator

Edited messages display a small **"edited"** label with the edit timestamp below the bubble, visible to all members.

## What Cannot Be Edited

- Voice messages, file/image attachments, messages deleted for everyone, or messages older than 15 minutes.`,
      },
      {
        title: "Delete for Everyone",
        content: `Users can remove their own messages from a conversation within a 15-minute window.

## Delete for Me vs Delete for Everyone

| Option | Effect |
|---|---|
| **Delete for Me** | Removes the message from your own view only. Other members still see it. |
| **Delete for Everyone** | Removes the message from all members' views. Only available within 15 minutes of sending. |

## How to Delete a Message

1. Hover over your own message bubble.
2. Click the **⋮ (more options)** menu.
3. Select **Delete for Me** or **Delete for Everyone** (if within 15 minutes).
4. Confirm the deletion.

## What Members See After "Delete for Everyone"

The message bubble is replaced with: *"This message was deleted"*

## Important Notes

- Deletion is irreversible.
- The 15-minute window is enforced server-side.
- After the window closes, only "Delete for Me" is available.`,
      },
      {
        title: "@Mentions",
        content: `@Mentions let you notify a specific person in a conversation, ensuring they see your message.

## How to Mention Someone

1. In the message input bar, type **@** followed by the start of the person's name (e.g. \`@Fati\`).
2. A typeahead dropdown appears listing matching conversation members, each showing avatar, full name, and @handle.
3. Click a name (or press Enter / Tab) to insert the mention.
4. The mention appears highlighted in blue in your typed message.
5. Complete your message and send.

## What Happens When Someone Is Mentioned

- The mentioned user receives an **in-app notification** immediately.
- The unread count badge on their Messages icon increments.
- The @mention is displayed in bold blue inside the message bubble for all members.

## Who Can Be Mentioned

Any member currently in the conversation — all roles.

## Mention Etiquette

Only mention someone when you genuinely need their attention. Avoid over-mentioning in large groups — use Announcement type for broadcasts instead.`,
      },
      {
        title: "Pinned Messages",
        content: `Pinned messages stay visible at the top of the conversation for all members — ideal for decisions, deadlines, and important links.

## Who Can Pin Messages

Super Admin, Executive Director, Programme Manager, Senior Programme Coordinator, Technical Coordinator.

## How to Pin a Message

1. Hover over the message and click **⋮ (more options)** → **Pin Message**.
2. An amber **Pinned Bar** appears below the conversation header with a preview of the pinned message.

## The Pinned Bar & Viewer

Click the Pinned Bar to open the **Pinned Messages Viewer** — a side panel listing all pinned messages with sender, preview, pinner name, and pin timestamp.

## How to Unpin a Message

Click **⋮ menu** → **Unpin Message** on the message in chat, or access it from the Pinned Messages Viewer.

## Maximum Pinned Messages

Up to **10 messages** may be pinned per conversation. Unpin one before adding another if the limit is reached.`,
      },
      {
        title: "Notifications in Communication Centre",
        content: `The Communication Centre generates in-app notifications to keep users informed.

## Notification Events

| Event | Who Is Notified |
|---|---|
| New message | All conversation members (unread count badge) |
| @Mention | The mentioned user (immediate in-app notification) |
| Reply to your message | The original message sender |
| Message pinned | All conversation members |
| New announcement | All broadcast group members |

## Where to See Notifications

- **Message icon** (💬) in the top navigation bar — badge with unread conversation count; click for dropdown with recent conversations.
- **Bell icon** (🔔) — system-wide notifications including @mentions.
- **Full Notifications page** (\`/notifications\`) — filterable list with mark-as-read and mark-all-read.

## Poll Interval

Badges update every **30 seconds**. Real-time message delivery in open conversations is via WebSocket (instant).`,
      },
      {
        title: "Mobile & PWA Support",
        content: `The Communication Centre is fully functional on mobile browsers and supports PWA installation.

## Supported Platforms

| Platform | Access Method |
|---|---|
| **Desktop (Windows / macOS / Linux)** | Chrome, Firefox, Edge, Safari — full feature set |
| **Android** | Chrome browser; installable as PWA |
| **iPhone / iPad (iOS)** | Safari browser; Add to Home Screen for PWA mode |
| **PWA (Installed)** | Fullscreen, behaves like a native app |

## Mobile: Long-Press for Message Actions

On touch devices, **long-press** a message bubble (~0.5 seconds) to open the full action menu: Reply, Edit, Copy Text, Forward, Pin/Unpin, Delete for Me / Delete for Everyone.

## Mobile: Voice Recording

Tap 🎙. Grant microphone access when prompted by the browser.

## Installing as PWA

**Android (Chrome):** ⋮ menu → Add to Home screen → Install.

**iOS (Safari):** Share (□↑) → Add to Home Screen → Add.

## Offline Support

The PWA shell loads without internet. Messaging requires an active connection. If connectivity drops, a reconnecting indicator is shown; the socket reconnects automatically when the network is restored.`,
      },
      {
        title: "Communication Best Practices",
        content: `Follow these guidelines to keep the Communication Centre productive and secure.

## General Guidelines
- Use **Project conversations** for all project-related coordination — this ensures the full team is informed and messages are discoverable in context.
- Use **Direct messages** only for personal, sensitive, or one-to-one matters.
- Use **Announcements** for organisation-wide broadcasts from management.
- Tag key decisions in Project conversations so they are retrievable later.

## Security & Confidentiality
- **Never** share passwords, credentials, authentication tokens, or personal beneficiary data through the messaging system.
- Do not share classified situation reports in group chats with uncleared members.
- For urgent security incidents, use the established CAFA emergency communication chain.

## Message Etiquette
- Use @mentions only when a response is genuinely needed — avoid over-mentioning.
- Pin messages only for information that needs to remain visible to the whole group.
- Edit messages for corrections within the 15-minute window rather than sending a follow-up.
- Delete for Everyone only when a message was sent in error and must not remain on record.

## File Sharing
- Use message attachments for informal file sharing during coordination.
- Use project document uploads for official programme files that need audit tracking.

## Archiving & Muting
- Mute or archive conversations no longer in active use to reduce notification noise.
- Do not delete conversations — they form part of the programme audit trail.`,
      },
    ],
    sops: [
      {
        processName: "How to Start a New Conversation",
        purpose: "Guide any CAFA PMIS user through creating a new conversation of any type.",
        responsibleRole: "All staff",
        steps: [
          "Click 'Communication' in the left sidebar to open the Messages page",
          "Click the blue + icon in the top-right of the conversation list to open the New Conversation modal",
          "Select the conversation type: Direct, Group, Project, State, Sector, or Announcement (note: Announcements are broadcast-only — members cannot reply)",
          "Search for participants by name and enter a conversation name (for Direct: search for the person only)",
          "Click 'Create' — the conversation opens immediately",
          "Type your first message in the input bar and press Enter or click Send",
        ],
        requiredInputs: "Conversation type selection; participant names; conversation title (for group types)",
        approvalFlow: "No approval required — any authenticated user can create a conversation",
        outputs: "New conversation visible to all added participants",
        timeline: "Immediate",
        relatedModule: "Communication Centre",
        notifications: "No automatic notifications triggered by creating a conversation.",
      },
      {
        processName: "How to Send a Voice Message",
        purpose: "Enable users to record and send voice messages in any conversation.",
        responsibleRole: "All staff",
        steps: [
          "Open the target conversation in the Communication Centre",
          "Click the 🎙 microphone icon in the message input bar — grant microphone access if prompted by the browser",
          "Speak clearly into your device microphone; a red pulsing indicator and live timer confirm recording is active",
          "Click Stop (■) when finished — a preview bar appears with waveform and duration",
          "Click Play to preview, Discard (✕) to cancel and re-record, or Send (→) to publish the voice message to the conversation",
        ],
        requiredInputs: "Device with working microphone; browser microphone permission granted",
        approvalFlow: "No approval required",
        outputs: "Voice message delivered to the conversation and playable by all members",
        timeline: "Immediate upon sending",
        relatedModule: "Communication Centre",
        notifications: "Conversation members receive a standard new-message unread notification.",
      },
      {
        processName: "How to Pin a Message",
        purpose: "Pin important messages so they remain visible to all conversation members.",
        responsibleRole: "Super Admin, Executive Director, Programme Manager, Senior Programme Coordinator, Technical Coordinator",
        steps: [
          "Open the conversation containing the message you want to pin",
          "Hover over the message bubble — action icons appear on the right (on mobile: long-press the bubble)",
          "Click the ⋮ (more options) icon to open the action menu",
          "Click 'Pin Message' — the amber Pinned Bar appears below the conversation header (note: if 5 messages are already pinned, unpin one first)",
          "Click the Pinned Bar to open the Pinned Messages Viewer and confirm the message appears in the list",
        ],
        requiredInputs: "Eligible role (Super Admin / Executive Director / Programme Manager / Senior Programme Coordinator / Technical Coordinator); message must exist and not be deleted",
        approvalFlow: "No approval required — eligible roles can pin directly",
        outputs: "Message pinned; amber Pinned Bar displayed to all conversation members",
        timeline: "Immediate",
        relatedModule: "Communication Centre",
        notifications: "All conversation members see the updated Pinned Bar immediately.",
      },
    ],
  },
  {
    title: "Notifications",
    slug: "notifications",
    description: "Understanding system notifications, the bell icon, and marking items read.",
    icon: "Bell",
    sections: [
      {
        title: "What Triggers a Notification",
        content: `CAFA PMIS generates automatic notifications for key system events. Every notification is delivered to the relevant user's in-app inbox.

Events that generate notifications:

## Project Events
- Project submitted for review (→ Technical Coordinator notified)
- Project technically approved (→ Senior Programme Coordinator notified)
- Project coordination approved (→ Programme Manager notified)
- Project approved / rejected / returned for revision (→ submitter notified)
- User assigned to a project (→ assigned user notified)

## Report & Plan Events
- Report / plan submitted (→ next reviewer notified)
- Report / plan approved, rejected, or returned for revision (→ author notified)
- Required correction comment posted (→ author notified)

## User Events
- Invitation link generated (→ admin shares manually — no automatic email)`,
      },
      {
        title: "Managing Your Notifications",
        content: `## Accessing Notifications
Click the bell icon (🔔) in the top navigation bar. A red badge shows the count of unread notifications.

## Reading Notifications
The notification panel lists all recent notifications with a short description and timestamp. Click any notification to navigate directly to the relevant project, report, or plan.

## Marking as Read
Click "Mark as Read" on individual notifications, or use "Mark All Read" at the top of the panel to clear all unread counts at once.

## Refresh Rate
Notifications refresh automatically every 30 seconds. You do not need to reload the page.

## Tips
- Check your notifications at the start of each working day.
- Required Correction notifications require your action — the item cannot be approved until the correction is resolved.
- If you are not receiving expected notifications, ask your System Administrator to verify your account status and role assignment.`,
      },
    ],
  },
  {
    title: "Approvals Workflow",
    slug: "approvals-workflow",
    description: "The 5-stage approval chain, how to approve or reject, and required correction rules.",
    icon: "CheckCircle2",
    sections: [
      {
        title: "Approval Chain Overview",
        content: `All major entities in CAFA PMIS — Projects, Reports, and Plans — follow a structured multi-level approval chain. The chain ensures quality control, coordination, and accountability at each level.

Standard approval chain:

1. State Programme Officer (creates and submits)
2. Technical Coordinator (technical quality review)
3. Senior Programme Coordinator (coordination review)
4. Programme Manager (final approval)

Each approver receives an automatic notification when an item reaches their stage. They can review the item, read all previous comments, and then: Approve (move to next stage), Reject (send back to draft with reason), or Request Revision (return to draft with specific corrections needed).

Approval actions are recorded in the Audit Log with a timestamp.`,
      },
      {
        title: "How to Review and Approve",
        content: `1. Open the item (project, report, or plan) from the notification or from the relevant list page.
2. Review all sections of the item, including the Comments tab for previous reviewer feedback.
3. Check for any open Required Correction comments — these must be resolved before final approval.
4. If satisfied, locate the Workflow section (bottom of the detail page or a dedicated tab).
5. Click the appropriate action button:
   - "Approve" / "Coordinate" / "Final Approve" (depending on your role)
   - "Reject" — you must enter a written reason
   - "Request Revision" — you must enter specific corrections needed

Your action and any comments are saved immediately. The submitter or next reviewer receives a notification.`,
      },
      {
        title: "Required Corrections",
        content: `Required Correction is a special comment type that blocks final approval until resolved.

## How It Works
1. A reviewer posts a "Required Correction" comment specifying what must be changed.
2. The submitter receives a notification.
3. The submitter makes the necessary changes (by editing the project/report/plan).
4. The submitter clicks "Resolve" on the correction comment.
5. Once all required corrections are resolved, the final approval button becomes available.

## Why This Matters
This mechanism ensures that approval is not given to items with known data quality issues. Reviewers should use Required Correction comments for substantive issues, and regular comments for minor observations.

## Rejection vs. Revision
- Request Revision: Returns the item to Draft for the submitter to correct and re-submit.
- Reject: Permanently rejects the item. A new submission will be needed.`,
      },
    ],
    sops: [
      {
        processName: "Project Approval Process",
        purpose: "Review and approve a submitted project through the CAFA multi-level approval chain.",
        responsibleRole: "Technical Coordinator / Senior Programme Coordinator / Programme Manager",
        steps: [
          "Receive notification that a project is pending your review",
          "Open the project from the notification or the Projects list",
          "Review all project sections: Basics, Geography, Assignments, Beneficiaries, Budget, Activities, Documents",
          "Check the Comments tab for any existing feedback from other reviewers",
          "If information is missing or incorrect: post a Required Correction comment specifying what must be changed",
          "If the project meets quality standards: click your approval action in the Workflow section",
          "If rejecting: enter a clear, specific reason in the comment field",
          "Confirm your action — the submitter and next reviewer will be automatically notified",
          "Record your review in your worklog (per CAFA M&E requirements)",
        ],
        requiredInputs: "Completed project with all required fields; supporting documents uploaded",
        approvalFlow: "Technical Coordinator → Senior Programme Coordinator → Programme Manager",
        outputs: "Approved project ready for activation; or revision request sent to submitter",
        timeline: "Target: each review stage completed within 2 working days of notification",
        relatedModule: "Projects",
        notifications: "Submitter notified on approval/rejection/revision; next reviewer notified on approval",
      },
    ],
  },
  {
    title: "Documents & Attachments",
    slug: "documents-attachments",
    description: "Uploading, classifying, and managing project documents and file attachments.",
    icon: "Paperclip",
    sections: [
      {
        title: "Document Management Overview",
        content: `CAFA PMIS provides secure document storage linked directly to projects. Staff can attach, view, and manage key programme documents without needing to use external file sharing services.

Supported document types include: Project Proposals, Donor Agreements, Budget Revisions, Activity Completion Reports, Field Assessment Reports, and Other (custom classification).

All documents are stored in CAFA's secure object storage system. Access is controlled by the same role-based permissions that govern the rest of the system.`,
      },
      {
        title: "Uploading Documents",
        content: `To attach a document to a project:

1. Open the project detail page.
2. Navigate to the Documents section (tab or scroll to the bottom).
3. Click "Upload Document".
4. Select the document type from the dropdown.
5. Click "Choose File" and select the document from your device.
6. Click "Upload" — the document uploads and appears in the document list immediately.

## File Requirements
- Supported formats: PDF (recommended), DOCX, XLSX, JPG, PNG
- Maximum file size: 10 MB per file
- File names should be descriptive (e.g., "Al-Jazeera-WASH-Project-Proposal-2026.pdf")

## Versioning
CAFA PMIS does not automatically version documents. If you upload a revised document, add the version date to the filename to distinguish it from the original.`,
      },
      {
        title: "Viewing and Deleting Documents",
        content: `## Viewing
Click the document name or the download icon to open or save the file to your device. Documents open in your browser's default PDF viewer or trigger a download depending on the file type.

## Deleting
Only the document uploader or a System Administrator can delete a document. Click the delete icon next to the document and confirm the action. Deleted documents cannot be recovered — download a copy first if needed.

## Message Attachments
The Communication Centre also supports file attachments within messages. These are separate from project documents and are not visible in the project document list. Use message attachments for informal file sharing; use project documents for official programme files.`,
      },
    ],
  },
  {
    title: "Search, Filters & Export",
    slug: "search-filters-export",
    description: "Using search bars, filter panels, and CSV export across all CAFA modules.",
    icon: "Search",
    sections: [
      {
        title: "Global Search",
        content: `Most CAFA PMIS list pages include a search bar that filters displayed records in real time by title, code, or name. Searching is case-insensitive.

## Tips for Effective Searching
- Search by project code (e.g., "CAFA-KRT") to find projects in a specific state.
- Search by a staff member's name to find their assigned projects or reports.
- Search by keyword in the title (e.g., "WASH" or "emergency") to find thematic items.
- For the System Manual, use the search bar on the Manual home page to search across all chapter titles, section headings, and content.

Search results update as you type — no need to press Enter.`,
      },
      {
        title: "Filters",
        content: `In addition to keyword search, most list pages offer filter panels for structured narrowing:

## Common Filters
- Status: Filter by workflow status (Draft, Submitted, Approved, Active, etc.)
- State: Filter to records related to a specific Sudanese state.
- Sector: Filter by programme sector (WASH, Health, Protection, etc.)
- Reporting Period: Filter reports by month and year.
- Date Range: Filter by start date or end date ranges.

## Using Multiple Filters
Filters can be combined. For example: Status=Active AND State=Khartoum AND Sector=Health will show only active Health projects in Khartoum.

## Clearing Filters
Click "Clear Filters" or reset individual filter dropdowns to remove applied filters. The URL updates to reflect your filter state — you can bookmark a filtered view.`,
      },
      {
        title: "CSV Export",
        content: `Most CAFA PMIS list pages include an "Export CSV" button that downloads the currently displayed and filtered list as a CSV spreadsheet.

## What Is Exported
The CSV export includes all columns visible in the list, filtered according to your current search and filter settings. Only records visible in your role's permission scope are exported.

## Using the Export
1. Apply your desired filters to narrow the list.
2. Click "Export CSV" — the download begins immediately.
3. Open the file in Microsoft Excel, LibreOffice Calc, or Google Sheets.
4. Use the spreadsheet for offline analysis, reporting to donors, or sharing with partners.

## Limitations
- The CSV contains the data at the time of export. It does not update automatically.
- Binary files (documents, images) are not included in the CSV — only metadata (file names, dates).`,
      },
    ],
  },
  {
    title: "Admin Settings",
    slug: "admin-settings",
    description: "User management, invitation flow, role configuration, and audit log access.",
    icon: "Settings",
    sections: [
      {
        title: "User Management",
        content: `User management is accessible only to Super Admins (full write access) and Programme Managers (view access).

Navigate to Administration → Users to access the user management page.

## User Summary Cards
At the top of the page, summary cards show: Total Users, Active, Invited (pending acceptance), and Suspended. Clicking a card filters the list to that status group.

## User Table
The table shows all users with their name, role, state, status, and last login date. Use the search bar and filter dropdowns (by role, status, state) to find specific users.

## Creating a User
Click "Create User" and complete the form. See the User Onboarding SOP (Chapter 2) for the full process.

## Editing a User
Click the ⋮ menu next to any user and select "Edit" to update their name, role, state, sector, or contact details.`,
      },
      {
        title: "Invitation & Password Management",
        content: `## Invitation Flow
CAFA PMIS uses an invitation-based onboarding process. New users receive a unique invitation link (valid for 7 days) rather than being sent an auto-generated password. This ensures staff actively set their own password.

If an invitation link expires:
1. Navigate to Users.
2. Find the user with "Invited" status.
3. Click ⋮ → "Resend Invite" — a new 7-day link is generated.
4. Share the new link with the staff member.

## Password Reset
For active users who forget their password:
1. Navigate to Users → find the user.
2. Click ⋮ → "Reset Password".
3. Either: set a specific temporary password, or generate a new invitation link for them to self-reset.

## Account Status Actions
From the ⋮ menu administrators can: Suspend (temporarily block access), Activate (restore access), or Deactivate (permanently disable without deletion) any user account.`,
      },
      {
        title: "Audit Log",
        content: `The Audit Log provides a full immutable record of every significant action performed in CAFA PMIS.

Navigate to Administration → Audit Log to access it.

## What Is Recorded
- Every project, report, plan, risk, and user creation, edit, or deletion
- All workflow transitions (approvals, rejections, revisions)
- All document uploads and deletions
- User login events
- Role and status changes

## Reading the Audit Log
Each entry shows: Timestamp, User, Action type, Module, Entity ID, and before/after snapshots of changed fields.

## Use Cases
- Investigating a data discrepancy ("who changed this budget figure?")
- Confirming that an approval was made by the correct person
- Reviewing a staff member's activity history
- Donor audits requiring evidence of approval records

The Audit Log is read-only and cannot be edited or deleted, even by Super Admins.`,
      },
    ],
  },
  {
    title: "Data Quality Rules",
    slug: "data-quality",
    description: "Required fields, validation rules, common mistakes, and tips for clean data.",
    icon: "ShieldCheck",
    sections: [
      {
        title: "Required Fields by Module",
        content: `CAFA PMIS enforces required fields to maintain data quality. Attempting to submit or save a record without required fields will display a validation error.

## Projects (required)
Title, Sector, State(s), Start Date, End Date, Management Level, At least one Responsible User, Budget Total, Budget Currency.

## Reports (required)
Report Type, Reporting Month, Reporting Year, Sector (or linked Project), Section 2 Narrative text.

## Plans (required)
Title, Plan Type, State, Responsible User, Start Date, End Date. At least one Objective with one Activity.

## Risks (required)
Title, Category, Severity (Low / Medium / High), Likelihood (Low / Medium / High).

## Users (required)
Full Name, Email, Username, Role. Sector is required for Technical Coordinators.`,
      },
      {
        title: "Common Validation Errors",
        content: `## "End date must be after start date"
Check that the end date is at least one day later than the start date.

## "Budget must be a positive number"
Enter a value greater than zero. Do not enter commas in numbers — use "120000" not "120,000".

## "Required correction comments must be resolved before final approval"
Open the Comments tab of the project, report, or plan. Find any comments marked as Required Correction and resolve each one before attempting approval.

## "Sector is required for Technical Coordinators"
When creating or editing a Technical Coordinator account, the Sector field must have at least one sector selected.

## "Invitation token is invalid or expired"
The invitation link has been used or has expired (7 days). Ask the System Administrator to resend the invitation.

## "Invalid credentials"
Username or password is incorrect, or the account is not in Active status. Contact the System Administrator if you are sure the password is correct.`,
      },
      {
        title: "Tips for Maintaining Clean Data",
        content: `- Always review submitted data before saving drafts or submitting.
- Update project actual budget figures at least monthly — stale figures make burn rates unreliable.
- Enter beneficiary counts accurately — disaggregate by gender and age (Male/Female/Boys/Girls).
- Use the Comments feature to flag data quality issues rather than editing others' records.
- When in doubt, save as Draft and verify the data with field staff before submitting.
- For beneficiary data, use verified headcount from field registers — do not estimate.
- Keep risk registers updated: a resolved risk should be updated to Closed, not left as open.
- Standardise naming conventions for documents (include state code, date, and document type).`,
      },
    ],
  },
  {
    title: "Standard Operating Procedures",
    slug: "sops",
    description: "Master index of all SOPs embedded throughout this manual.",
    icon: "ClipboardList",
    sections: [
      {
        title: "SOP Overview",
        content: `This chapter provides a reference index of all Standard Operating Procedures (SOPs) embedded in this system manual. Each SOP defines a specific CAFA PMIS process with clear steps, responsible roles, required inputs, and expected outputs.

Full SOP details are found within the relevant module chapter. The list below provides quick navigation:

## All SOPs in This Manual

- SOP 1: User Account Creation & Onboarding (Chapter 2 — User Roles & Permissions)
- SOP 2: Project Registration (Chapter 4 — Projects)
- SOP 3: Monthly Plan Submission (Chapter 5 — Planning)
- SOP 4: Monthly Report Submission (Chapter 6 — Reports)
- SOP 5: Risk Registration (Chapter 8 — Risks)
- SOP 6: Project Approval Process (Chapter 11 — Approvals Workflow)

Additional SOPs will be added as modules are developed and reviewed.`,
      },
      {
        title: "SOP Compliance & Review",
        content: `All CAFA programme staff are expected to follow the SOPs in this manual. Deviations from defined processes must be documented and justified.

## Review Cycle
SOPs are reviewed and updated quarterly by the Programme Management Unit in coordination with the Operations team. Staff are notified of significant changes through the Communication Centre and by their line manager.

## Reporting SOP Issues
If you identify a step in an SOP that is incorrect, outdated, or unclear, report it to the Programme Manager or use the Communication Centre to message the PMU team.

## New SOPs
Proposals for new SOPs should be submitted to the Programme Manager with a draft process description. Approved SOPs are added to this manual by the System Administrator.`,
      },
    ],
  },
  {
    title: "Troubleshooting",
    slug: "troubleshooting",
    description: "Solutions to common login, data, workflow, and technical issues.",
    icon: "Wrench",
    sections: [
      {
        title: "Login & Account Issues",
        content: `## Cannot Log In
- Verify your username and password (both are case-sensitive).
- Ensure you are using the correct system URL.
- Your account must be in Active status — suspended or deactivated accounts cannot log in.
- If you receive "invalid credentials" even with the correct password, contact the System Administrator — your account may be suspended.

## Forgot Password
Contact your System Administrator. They can reset your password or generate a new invitation link for you to self-reset.

## Invitation Link Not Working
Invitation links expire after 7 days. Ask the System Administrator to resend your invitation. If the link works but shows an error, try opening it in a different browser (Chrome recommended).

## Session Expired
If you are logged out unexpectedly, your session has expired (sessions last 8 hours by default). Log in again. Enable "Remember me for 30 days" to extend your session on a trusted device.`,
      },
      {
        title: "Data & Workflow Issues",
        content: `## Data Not Appearing
- Refresh the page (Ctrl+R / Cmd+R).
- Check your active filters — a filter may be hiding the records you expect.
- Technical Coordinators: verify your sector assignment — you only see data for your assigned sector(s).
- If data was recently entered by another user, it may take a moment to appear. Wait 10 seconds and refresh.

## Cannot Approve / Submit
- Check that all required fields are completed (look for red validation messages).
- If the approve button is disabled, check the Comments tab for open Required Correction comments.
- Verify you have the correct role for the action — only specific roles can approve at each stage.
- If none of the above, contact the System Administrator.

## Workflow Stuck
If a project, report, or plan has been in a review stage for more than 5 working days without action:
1. Check that the reviewer is active in the system.
2. Send a direct message via the Communication Centre.
3. Escalate to the Programme Manager if unresolved.`,
      },
      {
        title: "Technical & Browser Issues",
        content: `## Slow Performance
- Close unused browser tabs and other applications.
- Check your internet connection speed.
- Avoid using CAFA PMIS on very slow connections (below 1 Mbps) — use a mobile hotspot if needed.

## Page Not Loading or Blank Screen
- Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac).
- Clear browser cache: Settings → Clear browsing data → Cached images and files.
- Try a different browser (Chrome is recommended).
- If the issue persists across browsers, the system may be temporarily down — check with the System Administrator.

## Form Not Submitting
- Scroll up to check for red validation error messages — they appear at the field that has an issue.
- Ensure all required fields (marked with *) are completed.
- Check that date fields have valid dates in the correct format.

## File Upload Not Working
- Check the file size is below 10 MB.
- Check the file format is supported (PDF, DOCX, XLSX, JPG, PNG).
- Try a different browser if the upload button is unresponsive.`,
      },
    ],
  },
  {
    title: "Annexes",
    slug: "annexes",
    description: "Glossary of key terms, common acronyms, and support contacts.",
    icon: "BookMarked",
    sections: [
      {
        title: "Glossary of Key Terms",
        content: `**Beneficiary**: An individual or household that directly receives CAFA humanitarian assistance. Disaggregated by gender (Male/Female), age (Adult/Boy/Girl), and displacement category.

**Burn Rate**: The percentage of approved budget spent to date: Actual ÷ Planned × 100%. Used to monitor financial risk.

**Displacement Category**: Classification of affected population type — IDP (Internally Displaced Person), Returnee (returned from displacement), Host Community (non-displaced resident near displaced populations), or Refugee (cross-border displaced person).

**IDP**: Internally Displaced Person — someone forced to flee their home but remaining within Sudan.

**KPI**: Key Performance Indicator — a measurable value used to evaluate programme performance against targets.

**Management Level**: Whether a project is overseen from CAFA HQ (HQ Managed) or from a state office (State Managed).

**Mitigation Plan**: A documented set of actions designed to reduce the probability or impact of a specific risk.

**Project Code**: A unique system-generated identifier for each project (format: CAFA-{STATE_CODE}-{NNN}).

**Required Correction**: A special comment type that blocks final approval until the submitter resolves it. Used to enforce data quality corrections.

**SOP**: Standard Operating Procedure — a defined, step-by-step process for completing a specific task.

**TC**: Technical Coordinator — a CAFA staff member assigned to oversee one or more programme sectors.

**WASH**: Water, Sanitation, and Hygiene — one of CAFA's core programme sectors.`,
      },
      {
        title: "Common Acronyms",
        content: `CAFA — CAFA Development Organization (منظمة كافا للتنمية)
PMIS — Project Management Information System
IDP — Internally Displaced Person
GBV — Gender-Based Violence
MPCA — Multi-Purpose Cash Assistance
NFI — Non-Food Items
SOP — Standard Operating Procedure
MEAL — Monitoring, Evaluation, Accountability and Learning
TOR — Terms of Reference
M&E — Monitoring and Evaluation
HH — Household
KPI — Key Performance Indicator
WASH — Water, Sanitation, and Hygiene
SDG — Sudanese Pound (currency)
USD — United States Dollar
UN — United Nations
OCHA — Office for the Coordination of Humanitarian Affairs
UNHCR — United Nations High Commissioner for Refugees
WFP — World Food Programme
NGO — Non-Governmental Organisation
PMU — Programme Management Unit
HQ — Headquarters`,
      },
      {
        title: "Support & Contacts",
        content: `## Technical Support
For technical issues with CAFA PMIS (login problems, system errors, data discrepancies), contact your System Administrator or Programme Manager.

## Manual Feedback
This manual is maintained by the CAFA Programme Management Unit (PMU). If you identify incorrect, outdated, or missing information:
1. Use the Communication Centre to message the PMU team directly.
2. Include the chapter name, section, and a description of the issue.

## System Administrator
Contact the designated CAFA System Administrator for: account creation, role changes, password resets, and technical access issues.

## Emergency Support
For urgent system issues outside working hours that are blocking critical operations, escalate through the established CAFA emergency communication chain.

## Reporting Manual Errors
All suggested corrections to this manual are reviewed by the PMU and incorporated in the next quarterly update cycle.`,
      },
    ],
  },
  {
    title: "AI",
    slug: "ai-assistant",
    description: "The AI assistant and administration settings for CAFA PMIS.",
    icon: "Bot",
    sections: [
      {
        title: "AI Overview",
        content: `The AI assistant is a built-in intelligent chat tool available to all authenticated CAFA PMIS users. It can answer questions about how to use the system, explain programme policies, help interpret data, and guide you through complex workflows.

## Accessing the AI assistant
Look for the **chat bubble icon** (💬) in the bottom-right corner of any page. Click it to open the assistant panel. The assistant is available on every page in the system — you do not need to navigate away from your current task.

## What It Can Do
- Answer questions about any CAFA PMIS module ("How do I submit a report?", "What does burn rate mean?")
- Explain approval workflows and who needs to approve what
- Provide role-specific guidance based on your user role
- Summarize programme data and help interpret reports
- Guide you through step-by-step processes

## What It Cannot Do
- The AI assistant cannot create, edit, or delete any records on your behalf
- It cannot access classified or restricted data outside your role permissions
- It does not replace official approvals or Programme Manager decisions

## Availability
The AI assistant is enabled by default. If you do not see the chat bubble, it may have been disabled by your System Administrator. Contact the System Administrator if you believe this is an error.`,
      },
      {
        title: "Using the AI assistant",
        content: `## Starting a Conversation
Click the chat bubble in the bottom-right corner to open the assistant. Type your question in the text box and press Enter (or click Send).

The assistant responds in real time using streaming text — you will see the response being written word by word. You can stop a response at any time by clicking the **Stop** button.

## Quick Prompt Chips
When you open the assistant, a set of **quick prompt chips** appears at the top of the chat panel. These are pre-written questions covering common tasks:
- "How do I create a new project?"
- "Explain the approval workflow"
- "How do I log a risk?"
- "What reports am I responsible for?"

Click any chip to send that question immediately without typing.

## Response Language
By default, the assistant responds in the same language you write in (auto-detect). If your System Administrator has set a preferred language, all responses will use that language. You can write in English or Arabic regardless of the language setting.

## Session Context
The assistant remembers the context of your conversation within a session. You can ask follow-up questions without repeating yourself — for example: "What is the approval chain for projects?" followed by "And how long does it usually take?" — the assistant understands the context.

## Clearing History
To start a fresh conversation, click the **Clear History** button (trash icon) at the top of the chat panel. This removes all previous messages from the current session. Your cleared history is permanently deleted.`,
      },
      {
        title: "AI Admin Settings",
        content: `Admin settings for the AI assistant are accessible only to **Super Admins** and **Executive Directors**. Navigate to **Administration → AI** in the sidebar.

## Enable / Disable
Use the toggle switch on the AI admin page to enable or disable the AI assistant system-wide. When disabled, the chat bubble is hidden for all users. No data is lost when the assistant is disabled — it can be re-enabled at any time.

## Custom System Instructions
Administrators can add custom instructions to supplement the assistant's default knowledge base. For example:
- Organization-specific policies and procedures
- Contacts for specific issues
- Reminders about reporting deadlines or programme priorities

Custom instructions appear in every assistant response and take precedence over generic guidance.

## Response Language Setting
Three options are available:
- **Auto** (default): the assistant responds in the language the user writes in
- **English**: all responses are in English regardless of the user's input language
- **Arabic**: all responses are in Arabic regardless of the user's input language

## Usage Logs
The Usage Logs tab on the AI admin page shows a searchable log of all AI conversations across all users. This is useful for understanding how staff use the assistant and identifying common questions that may indicate training gaps. Logs can be exported to CSV.`,
      },
    ],
  },
  {
    title: "File & Archive",
    slug: "document-repository",
    description: "Centralised document management — upload, organise, search, and manage all CAFA documents from one place.",
    icon: "Database",
    sections: [
      {
        title: "File & Archive Overview",
        content: `The File & Archive is CAFA PMIS's centralized file management system, powered by managed attachment storage. It provides a single location to view, upload, archive, and manage all documents associated with CAFA programmes — across all modules.

## Accessing File & Archive
Navigate to **File & Archive** in the sidebar (under Resources, shown as "Drive") to open the file management interface.

## Connection Status
At the top of the page, a status banner shows whether attachment storage is connected and its available capacity:
- ✅ Connected: shows the configured storage capacity and service status
- ❌ Not connected: the integration must be configured by the System Administrator before files can be uploaded

## What Is Stored Here
The File & Archive aggregates all files uploaded across the system:
- Project documents (proposals, donor agreements, reports)
- Report attachments and evidence files
- Plan documents
- Risk-related attachments
- System-generated PDFs and Excel exports
- User documents`,
      },
      {
        title: "Browsing and Filtering Files",
        content: `## File List
The main table shows all documents you have access to, sorted by upload date (newest first). Each row shows:
- File name and type icon (PDF, Word, Excel, Image, etc.)
- Module (which part of the system the file belongs to)
- Linked project (if applicable)
- File size
- Uploader name and role
- Status (Active / Archived / Deleted)
- Upload date

## Filters
Use the filter controls at the top of the table to narrow the list:
- **Search**: type any part of a filename to filter instantly
- **Module**: filter by which module the file belongs to (Projects, Reports, Plans, Risks, etc.)
- **Status**: Active (in use), Archived (retained but inactive), Deleted (soft-deleted, admin-visible only)

## Sorting
Click any column header to sort the table. A second click reverses the sort order.`,
      },
      {
        title: "Uploading Files",
        content: `## Who Can Upload
All authenticated users with write access to at least one module can upload files. The uploader's name and role are recorded automatically and cannot be changed.

## How to Upload
1. From the File & Archive page, click the **Upload File** button (top right).
2. Select a file from your device. Supported formats: PDF, DOCX, XLSX, JPG, PNG — maximum 10 MB per file.
3. The file is uploaded to managed attachment storage and indexed in the CAFA PMIS database.
4. The new file appears at the top of the file list with "Active" status.

## Uploading from Module Pages
Files can also be uploaded directly from within module pages — for example, the project registration form has a Documents section where you upload signed project documents. Those files also appear in the File & Archive.

## Supported File Types
- Documents: PDF, DOCX, DOC, RTF
- Spreadsheets: XLSX, XLS, CSV
- Images: JPG, JPEG, PNG, GIF
- Maximum size: 10 MB per file`,
      },
      {
        title: "File Actions — Archive, Download, Delete",
        content: `## Downloading a File
Click the **Download** button (↓) next to any file to open it in your browser or download it directly. Files are served through CAFA PMIS's authenticated download path.

## Archiving a File
Archiving moves a file to "Archived" status. Archived files remain in managed storage and the database but are hidden from regular views unless the Status filter is set to "Archived". Use archiving when a document is superseded by a newer version but must be retained for audit purposes.

To archive: click the ⋮ menu next to the file and select "Archive".

## Restoring an Archived File
To restore an archived file to "Active" status: filter by Archived status, find the file, click ⋮ → "Restore".

## Deleting a File
Deletion is a soft-delete — the file record is marked "Deleted" and hidden from all views, but the actual file in managed storage is retained for a configurable retention period. Hard deletion (permanent removal from managed storage) is performed only by the System Administrator.

To delete: click ⋮ → "Delete". You will be asked to confirm.

## Permissions
- Super Admin: can archive, restore, and delete any file
- Programme Manager: can archive and download
- All other roles: can only download files they have permission to view based on their module access`,
      },
    ],
    sops: [
      {
        processName: "Document Upload & Classification",
        purpose: "Upload a programme document to the CAFA PMIS File & Archive and ensure it is correctly classified.",
        responsibleRole: "State Programme Officer / Programme Manager",
        steps: [
          "Navigate to File & Archive in the sidebar",
          "Click 'Upload File'",
          "Select the file from your device (max 10 MB, supported formats: PDF/DOCX/XLSX/JPG/PNG)",
          "The system uploads the file to managed attachment storage and records metadata",
          "Verify the file appears in the list with 'Active' status",
          "If the file is linked to a specific project or module, also upload it from the relevant module page to create the cross-reference",
        ],
        requiredInputs: "The document file; knowledge of which module and project it belongs to",
        approvalFlow: "No approval required for uploads — any authorised user can upload",
        outputs: "File stored in managed attachment storage; record created in CAFA PMIS File & Archive",
        timeline: "Immediate",
        relatedModule: "File & Archive",
        notifications: "No automatic notification. Notify relevant staff manually via Communication Centre if action is required on the document.",
      },
    ],
  },
];

let terminologyMigrated = false;

async function ensureTerminologyMigrated() {
  if (terminologyMigrated) return;
  try {
    // ── Chapter title fixes (idempotent: only update when stale) ──────────
    const chapterTitleFixes: [string, string][] = [
      ['document-repository', 'File & Archive'],
      ['communication',       'Communication Centre'],
      ['ai-assistant',        'AI'],
    ];
    for (const [slug, title] of chapterTitleFixes) {
      await pool.query(
        `UPDATE manual_chapters SET title = $1, updated_at = NOW() WHERE slug = $2 AND title != $1`,
        [title, slug],
      );
    }

    // ── Obsolete terminology replacement (all displayed fields) ───────────
    const obsolete: [string, string][] = [
      ['Program Manager',         'Programme Manager'],
      ['State Program Officer',   'State Programme Officer'],
      ['Senior Program Coordinator', 'Senior Programme Coordinator'],
      ['Senior Coordinator',      'Senior Programme Coordinator'],
      ['Communication Center',    'Communication Centre'],
      ['Communication module',    'Communication Centre'],
      ['Document Repository',     'File & Archive'],
      ['AI Assistant Settings',   'AI'],
      ['AI Assistant',            'AI'],
      ['Program State Report',    'State Programme Report'],
      ['Program State',           'State Programme'],
    ];
    for (const [old, nw] of obsolete) {
      // chapter titles and descriptions
      await pool.query(
        `UPDATE manual_chapters SET
           title = REPLACE(title, $1, $2),
           description = REPLACE(COALESCE(description,''), $1, $2),
           updated_at = NOW()
         WHERE title LIKE '%' || $1 || '%'
            OR description LIKE '%' || $1 || '%'`,
        [old, nw],
      );
      // section titles and content
      await pool.query(
        `UPDATE manual_sections SET
           title = REPLACE(title, $1, $2),
           content = REPLACE(content, $1, $2)
         WHERE title LIKE '%' || $1 || '%'
            OR content LIKE '%' || $1 || '%'`,
        [old, nw],
      );
      // SOP all text fields
      await pool.query(
        `UPDATE manual_sops SET
           process_name     = REPLACE(COALESCE(process_name,''),     $1, $2),
           purpose          = REPLACE(COALESCE(purpose,''),          $1, $2),
           responsible_role = REPLACE(COALESCE(responsible_role,''), $1, $2),
           approval_flow    = REPLACE(COALESCE(approval_flow,''),    $1, $2),
           notifications    = REPLACE(COALESCE(notifications,''),    $1, $2),
           related_module   = REPLACE(COALESCE(related_module,''),   $1, $2)
         WHERE process_name     LIKE '%' || $1 || '%'
            OR purpose          LIKE '%' || $1 || '%'
            OR responsible_role LIKE '%' || $1 || '%'
            OR approval_flow    LIKE '%' || $1 || '%'
            OR notifications    LIKE '%' || $1 || '%'
            OR related_module   LIKE '%' || $1 || '%'`,
        [old, nw],
      );
      // FAQ questions and answers
      await pool.query(
        `UPDATE manual_faqs SET
           question = REPLACE(question, $1, $2),
           answer   = REPLACE(answer,   $1, $2)
         WHERE question LIKE '%' || $1 || '%'
            OR answer   LIKE '%' || $1 || '%'`,
        [old, nw],
      );
    }
    terminologyMigrated = true;
  } catch {
    // Non-fatal: migration retried on next request
    terminologyMigrated = false;
  }
}


let seeded = false;
type ManualLocale = "en" | "ar";

function getManualLocale(req: Request): ManualLocale {
  return String(req.query.locale ?? "en").toLowerCase() === "ar" ? "ar" : "en";
}

// Keep the translation seed deterministic and reviewable. Product names,
// acronyms, URLs, codes, and currency codes intentionally remain unchanged.
const ARABIC_MANUAL_TERMS: Array<[string, string]> = [
  ["State Programme Officer", "مسؤول البرنامج في الولاية"],
  ["State Office Manager", "مدير مكتب الولاية"],
  ["Senior Programme Coordinator", "منسق البرامج الأول"],
  ["Technical Coordinator", "المنسق التقني"],
  ["Programme Manager", "مدير البرامج"],
  ["Executive Director", "المدير التنفيذي"],
  ["Super Admin", "مسؤول النظام"],
  ["Project Officer", "مسؤول المشروع"],
  ["Programme Assistant", "مساعد البرامج"],
  ["Risk Register", "سجل المخاطر"],
  ["Communication Centre", "مركز الاتصالات"],
  ["File & Archive", "الملفات والأرشيف"],
  ["System Manual", "دليل النظام"],
  ["Project Report", "تقرير المشروع"],
  ["HQ Sector Report", "تقرير قطاع المقر"],
  ["State Programme Report", "تقرير برنامج الولاية"],
  ["Programme", "البرنامج"],
  ["Project", "المشروع"],
  ["Projects", "المشاريع"],
  ["Plan", "الخطة"],
  ["Plans", "الخطط"],
  ["Report", "التقرير"],
  ["Reports", "التقارير"],
  ["Budget", "الميزانية"],
  ["Budgets", "الميزانيات"],
  ["Dashboard", "لوحة التحكم"],
  ["Notifications", "الإشعارات"],
  ["Activities", "الأنشطة"],
  ["Activity", "النشاط"],
  ["Objectives", "الأهداف"],
  ["Objective", "الهدف"],
  ["State", "الولاية"],
  ["Sector", "القطاع"],
  ["Donor", "الجهة المانحة"],
  ["Users", "المستخدمون"],
  ["User", "المستخدم"],
  ["Approval", "الاعتماد"],
  ["Approvals", "الاعتمادات"],
  ["Review", "المراجعة"],
  ["Draft", "مسودة"],
  ["Submitted", "مُقدَّم"],
  ["Approved", "مُعتمَد"],
  ["Active", "نشط"],
  ["Completed", "مكتمل"],
  ["Cancelled", "ملغى"],
  ["Delayed", "متأخر"],
  ["Required Correction", "تصحيح مطلوب"],
  ["General / Cross-Cutting", "عام / متعدد القطاعات"],
  ["Purpose", "الغرض"],
  ["Responsible Role", "الدور المسؤول"],
  ["Required Inputs", "المدخلات المطلوبة"],
  ["Approval Flow", "مسار الاعتماد"],
  ["Outputs", "المخرجات"],
  ["Timeline", "الجدول الزمني"],
  ["Related Module", "الوحدة ذات الصلة"],
  ["Steps", "الخطوات"],
  ["Notifications", "الإشعارات"],
];

const ARABIC_CHAPTERS: Record<string, { title: string; description: string }> = {
  introduction: { title: "مقدمة", description: "نظرة عامة على النظام والغرض منه وخطوات البدء لجميع موظفي كافا." },
  "user-roles-permissions": { title: "أدوار المستخدمين والصلاحيات", description: "أدوار موظفي كافا وصلاحيات كل دور وطريقة تعيين الأدوار." },
  dashboard: { title: "لوحة التحكم", description: "قراءة بطاقات مؤشرات الأداء والرسوم البيانية وتوزيع المستفيدين." },
  projects: { title: "المشاريع", description: "تسجيل المشاريع وإدارة دورة حياتها ومخرجاتها وأنشطتها ووثائقها." },
  planning: { title: "التخطيط", description: "أنواع الخطط وإنشاؤها والأهداف والأنشطة ومسار اعتماد الخطط." },
  reports: { title: "التقارير", description: "إنشاء وإدارة واعتماد التقارير السردية في نظام CAFA PMIS." },
  budget: { title: "الميزانية", description: "حقول الميزانية وحساب معدل الصرف وإدارة العملات المتعددة ولوحات المتابعة المالية." },
  risks: { title: "المخاطر", description: "تسجيل المخاطر وتقييمها ومعالجتها ومتابعتها." },
  communication: { title: "مركز الاتصالات", description: "الرسائل والمحادثات والإشارات والتنبيهات الخاصة بالفرق." },
  notifications: { title: "الإشعارات", description: "تنبيهات النظام وتفضيلات تلقي الإشعارات." },
  "approvals-workflow": { title: "مسار الاعتمادات", description: "فهم مراحل المراجعة والاعتماد ومتابعة الطلبات المعلقة." },
  "documents-attachments": { title: "الوثائق والمرفقات", description: "رفع الوثائق وتصنيفها والوصول إليها بأمان." },
  "search-filters-export": { title: "البحث والتصفية والتصدير", description: "استخدام البحث والفلاتر وخيارات تصدير البيانات." },
  "admin-settings": { title: "إعدادات الإدارة", description: "إدارة المستخدمين والولايات وإعدادات النظام." },
  "data-quality": { title: "قواعد جودة البيانات", description: "التحقق من اكتمال البيانات ودقتها قبل اعتمادها." },
  sops: { title: "الإجراءات التشغيلية المعيارية", description: "إجراءات عملية موحدة لتنفيذ مهام النظام الرئيسية." },
  troubleshooting: { title: "استكشاف الأخطاء وإصلاحها", description: "حل المشكلات الشائعة والحصول على الدعم." },
  annexes: { title: "الملاحق", description: "مصطلحات ومراجع مساندة لاستخدام النظام." },
  "ai-assistant": { title: "المساعد الذكي", description: "استخدام المساعد الذكي وإعداداته في نظام CAFA PMIS." },
  "document-repository": { title: "الملفات والأرشيف", description: "إدارة الملفات والأرشفة والوصول إلى الوثائق المصرح بها." },
};

const MACHINE_DRAFT_GAPS: Record<string, string> = {
  "Data Quality Rules": "قواعد جودة البيانات",
  "Rules and validation guidance that keep programme information complete, accurate, and auditable.": "قواعد وإرشادات للتحقق تحافظ على اكتمال معلومات البرنامج ودقتها وقابليتها للتدقيق.",
  "Required fields, validation rules, common mistakes, and tips for clean data.": "الحقول المطلوبة وقواعد التحقق والأخطاء الشائعة ونصائح للحفاظ على بيانات سليمة.",
};

function arabicManualText(value: string | null | undefined): string {
  if (!value) return "";
  const directTranslation = MANUAL_ARABIC_DRAFT[value] ?? MACHINE_DRAFT_GAPS[value];
  if (directTranslation) return directTranslation;
  // The canonical seed keeps rich Manual bodies as a single field, while the
  // approved machine-draft corpus also records several of those bodies as
  // individually translated paragraph blocks. Recompose only when *every*
  // source block has an exact stored Arabic counterpart; never substitute
  // English or generate content during a request.
  const blocks = value.split(/\n\n+/);
  const composed = blocks.length > 1
    ? blocks.map((block) => MANUAL_ARABIC_DRAFT[block] ?? MACHINE_DRAFT_GAPS[block]).filter(Boolean)
    : [];
  const translation = composed.length === blocks.length ? composed.join("\n\n") : undefined;
  if (!translation) throw new Error(`Missing machine Arabic draft for Manual source: ${value.slice(0, 80)}`);
  return translation;
}

function parseManualSteps(value: unknown): unknown {
  let parsed = value;
  for (let attempt = 0; attempt < 2 && typeof parsed === "string"; attempt++) {
    try {
      const next = JSON.parse(parsed);
      if (!next || typeof next !== "object") return parsed;
      parsed = next;
    } catch {
      return parsed;
    }
  }
  return parsed;
}

function translateManualSteps(value: unknown, sopId?: number): unknown {
  const parsed = parseManualSteps(value);
  if (!Array.isArray(parsed)) return parsed;
  const structuredMappings = sopId ? MANUAL_SOP_STEP_ARABIC_DRAFT[sopId] : undefined;
  return parsed.map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return step;
    return Object.fromEntries(
      Object.entries(step).map(([key, item]) => [
        key,
        typeof item === "string" && item.trim()
          ? structuredMappings?.[item] ?? arabicManualText(item)
          : item,
      ]),
    );
  });
}

type ManualPreflight = {
  totalLocalizableFields: number;
  matchedMappings: number;
  missingMappings: number;
  blockers: Array<{ kind: string; id: number; field: string; state: "MISSING_TRANSLATION_MAPPING" }>;
};

async function runManualImportPreflight(): Promise<ManualPreflight> {
  const { rows } = await pool.query<{ kind: string; id: number; source: Record<string, unknown> }>(`
    SELECT 'chapter' AS kind, id,
      jsonb_build_object('title', title, 'description', description) AS source
      FROM manual_chapters
    UNION ALL SELECT 'section', id,
      jsonb_build_object('title', title, 'content', content)
      FROM manual_sections
    UNION ALL SELECT 'sop', id,
      jsonb_build_object('process_name', process_name, 'purpose', purpose,
        'responsible_role', responsible_role, 'steps', steps,
        'required_inputs', required_inputs, 'approval_flow', approval_flow,
        'outputs', outputs, 'timeline', timeline, 'related_module', related_module,
        'notifications', notifications)
      FROM manual_sops
    UNION ALL SELECT 'faq', id,
      jsonb_build_object('question', question, 'answer', answer, 'category', category)
      FROM manual_faqs
  `);
  const blockers: ManualPreflight["blockers"] = [];
  let totalLocalizableFields = 0;
  for (const row of rows) {
    for (const [field, value] of Object.entries(row.source)) {
      const values = field === "steps" ? [parseManualSteps(value)] : (Array.isArray(value) ? value : [value]);
      for (const item of values) {
        const items = field === "steps" && Array.isArray(item)
          ? item.flatMap((step) => step && typeof step === "object" ? Object.values(step) : [])
          : [item];
        for (const entry of items) {
          if (typeof entry !== "string" || !entry.trim()) continue;
          totalLocalizableFields++;
          const structuredMapping = field === "steps" && row.kind === "sop"
            ? MANUAL_SOP_STEP_ARABIC_DRAFT[row.id]?.[entry]
            : undefined;
          if (!MANUAL_ARABIC_DRAFT[entry] && !MACHINE_DRAFT_GAPS[entry] && !ARABIC_CHAPTERS[entry] && !structuredMapping) {
            blockers.push({ kind: row.kind, id: row.id, field, state: "MISSING_TRANSLATION_MAPPING" });
          }
        }
      }
    }
  }
  return {
    totalLocalizableFields,
    matchedMappings: totalLocalizableFields - blockers.length,
    missingMappings: blockers.length,
    blockers,
  };
}

async function ensureLocalizedCorpus(dbPool = pool): Promise<void> {
  // The operation is explicit and transactional. Runtime GET/search handlers
  // never call this function.
  const preflight = await runManualImportPreflight();
  if (preflight.missingMappings > 0) {
    const error = new Error("Manual localization preflight blocked import");
    Object.assign(error, { code: "PRECHECK_BLOCKED", preflight });
    throw error;
  }
  await ensureKCSetup();
  const client = await dbPool.connect();
  const pool = { query: client.query.bind(client) };
  await client.query("BEGIN");
  try {
  // Earlier draft imports predate lifecycle metadata and therefore received
  // the column default. Only records with no reviewer evidence are normalized;
  // reviewed/approved content is never reclassified or overwritten.
  await pool.query(`
    UPDATE manual_chapter_localizations
       SET translation_status = 'draft_machine_generated'
     WHERE locale = 'ar'
       AND translation_status = 'review_required'
       AND reviewed_at IS NULL
       AND reviewed_by_id IS NULL
  `);
  await pool.query(`
    INSERT INTO manual_chapter_localizations
      (chapter_id, locale, title, description)
    SELECT id, 'en', title, description FROM manual_chapters
    ON CONFLICT (chapter_id, locale) DO UPDATE
      SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
  `);
  const { rows: chapterRows } = await pool.query<{ id: number; title: string; description: string | null }>(
    "SELECT id, title, description FROM manual_chapters",
  );
  for (const row of chapterRows) {
    const source = { title: row.title, description: row.description };
    const checksum = manualSourceChecksum(source);
    const legacyChecksums = legacyManualSourceChecksums("chapter", row.id, source);
    await pool.query(
      `INSERT INTO manual_chapter_localizations (chapter_id, locale, title, description, translation_status)
       VALUES ($1,'ar',$2,$3,'draft_machine_generated')
       ON CONFLICT (chapter_id, locale) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
         translation_status='draft_machine_generated', updated_at=NOW()
        WHERE manual_chapter_localizations.translation_status = 'draft_machine_generated'
          AND manual_chapter_localizations.source_checksum IS NULL`,
      [row.id, arabicManualText(row.title), arabicManualText(row.description)],
    );
    await pool.query(
      `UPDATE manual_chapter_localizations
          SET translation_status=CASE WHEN source_checksum IS NOT NULL AND source_checksum IS DISTINCT FROM $2 AND source_checksum <> ALL($3::text[]) THEN 'review_required' ELSE translation_status END,
              source_checksum=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2 ELSE source_checksum END,
              source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
        WHERE chapter_id=$1 AND locale='ar'`,
      [row.id, checksum, legacyChecksums],
    );
  }
  const { rows: sections } = await pool.query<{ id: number; title: string; content: string }>(
    "SELECT id, title, content FROM manual_sections",
  );
  for (const row of sections) {
    const source = { title: row.title, content: row.content };
    const checksum = manualSourceChecksum(source);
    const legacyChecksums = legacyManualSourceChecksums("section", row.id, source);
    await pool.query(
      `INSERT INTO manual_section_localizations (section_id, locale, title, content, translation_status)
       VALUES ($1,'en',$2,$3,'review_required'), ($1,'ar',$4,$5,'draft_machine_generated')
       ON CONFLICT (section_id, locale) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, updated_at=NOW()
        WHERE manual_section_localizations.translation_status = 'draft_machine_generated'
          AND manual_section_localizations.source_checksum IS NULL`,
      [row.id, row.title, row.content, arabicManualText(row.title), arabicManualText(row.content)],
    );
    await pool.query(
      `UPDATE manual_section_localizations
          SET translation_status=CASE WHEN source_checksum IS NOT NULL AND source_checksum IS DISTINCT FROM $2 AND source_checksum <> ALL($3::text[]) THEN 'review_required' ELSE translation_status END,
              source_checksum=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2 ELSE source_checksum END,
              source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
        WHERE section_id=$1 AND locale='ar'`,
      [row.id, checksum, legacyChecksums],
    );
  }
  const { rows: sops } = await pool.query<{ id: number; process_name: string; purpose: string | null; responsible_role: string | null; steps: string[] | null; required_inputs: string | null; approval_flow: string | null; outputs: string | null; timeline: string | null; related_module: string | null; notifications: string | null }>(
    `SELECT id, process_name, purpose, responsible_role, steps, required_inputs, approval_flow, outputs, timeline, related_module, notifications FROM manual_sops`,
  );
  for (const row of sops) {
    const source = {
      process_name: row.process_name,
      purpose: row.purpose,
      responsible_role: row.responsible_role,
      steps: parseManualSteps(row.steps),
      required_inputs: row.required_inputs,
      approval_flow: row.approval_flow,
      outputs: row.outputs,
      timeline: row.timeline,
      related_module: row.related_module,
      notifications: row.notifications,
    };
    const checksum = manualSourceChecksum(source);
    const legacyChecksums = legacyManualSourceChecksums("sop", row.id, source);
    const ar = (v: string | null) => v ? arabicManualText(v) : null;
    const arSteps = translateManualSteps(row.steps, row.id);
    await pool.query(
      `INSERT INTO manual_sop_localizations
       (sop_id, locale, process_name, purpose, responsible_role, steps, required_inputs, approval_flow, outputs, timeline, related_module, notifications, translation_status)
       VALUES ($1,'en',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'review_required'),
              ($1,'ar',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'draft_machine_generated')
       ON CONFLICT (sop_id, locale) DO UPDATE SET process_name=EXCLUDED.process_name, purpose=EXCLUDED.purpose,
         responsible_role=EXCLUDED.responsible_role, steps=EXCLUDED.steps, required_inputs=EXCLUDED.required_inputs,
         approval_flow=EXCLUDED.approval_flow, outputs=EXCLUDED.outputs, timeline=EXCLUDED.timeline,
         related_module=EXCLUDED.related_module, notifications=EXCLUDED.notifications, updated_at=NOW()
        WHERE manual_sop_localizations.translation_status = 'draft_machine_generated'
          AND manual_sop_localizations.source_checksum IS NULL`,
      [row.id, row.process_name, row.purpose, row.responsible_role, row.steps ? JSON.stringify(row.steps) : null, row.required_inputs, row.approval_flow, row.outputs, row.timeline, row.related_module, row.notifications,
        ar(row.process_name) ?? row.process_name, ar(row.purpose), ar(row.responsible_role), JSON.stringify(arSteps), ar(row.required_inputs), ar(row.approval_flow), ar(row.outputs), ar(row.timeline), ar(row.related_module), ar(row.notifications)],
    );
    if ([7, 8, 9].includes(row.id)) {
      const { rows: existingRows } = await pool.query<{
        steps: unknown;
        source_checksum: string | null;
        translation_status: string;
        reviewed_at: Date | null;
        reviewed_by_id: number | null;
      }>(
        `SELECT steps, source_checksum, translation_status, reviewed_at, reviewed_by_id
           FROM manual_sop_localizations
          WHERE sop_id=$1 AND locale='ar'
          FOR UPDATE`,
        [row.id],
      );
      const existing = existingRows[0];
      let storedSteps = parseManualSteps(existing?.steps);
      if (existing && JSON.stringify(storedSteps) === JSON.stringify(arSteps)
          && !existing.reviewed_at && !existing.reviewed_by_id
          && existing.translation_status !== "reviewed"
          && existing.translation_status !== "approved"
          && existing.source_checksum !== checksum) {
        await pool.query(
          `UPDATE manual_sop_localizations
              SET source_checksum=$2, source_updated_at=NOW()
            WHERE sop_id=$1 AND locale='ar' AND source_checksum=$3`,
          [row.id, checksum, existing.source_checksum],
        );
      }
    }
    await pool.query(
      `UPDATE manual_sop_localizations
          SET translation_status=CASE
                WHEN source_checksum IS NOT NULL
                  AND source_checksum IS DISTINCT FROM $2
                  AND source_checksum <> ALL($3::text[])
                THEN 'review_required' ELSE translation_status END,
              source_checksum=CASE
                WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2
                ELSE source_checksum END,
              source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
        WHERE sop_id=$1 AND locale='ar'`,
      [row.id, checksum, legacyChecksums],
    );
  }
  const { rows: faqs } = await pool.query<{ id: number; question: string; answer: string; category: string }>(
    "SELECT id, question, answer, category FROM manual_faqs",
  );
  for (const row of faqs) {
    const source = { question: row.question, answer: row.answer, category: row.category };
    const checksum = manualSourceChecksum(source);
    const legacyChecksums = legacyManualSourceChecksums("faq", row.id, source);
    await pool.query(
      `INSERT INTO manual_faq_localizations (faq_id, locale, question, answer, category, translation_status)
       VALUES ($1,'en',$2,$3,$4,'review_required'), ($1,'ar',$5,$6,$7,'draft_machine_generated')
       ON CONFLICT (faq_id, locale) DO UPDATE SET question=EXCLUDED.question, answer=EXCLUDED.answer,
         category=EXCLUDED.category, updated_at=NOW()
        WHERE manual_faq_localizations.translation_status = 'draft_machine_generated'
          AND manual_faq_localizations.source_checksum IS NULL`,
        [row.id, row.question, row.answer, row.category, arabicManualText(row.question), arabicManualText(row.answer), arabicManualText(row.category)],
    );
    await pool.query(
      `UPDATE manual_faq_localizations
          SET translation_status=CASE
                WHEN source_checksum IS NOT NULL
                  AND source_checksum IS DISTINCT FROM $2
                  AND source_checksum <> ALL($3::text[])
                THEN 'review_required' ELSE translation_status END,
              source_checksum=CASE
                WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN $2
                ELSE source_checksum END,
              source_updated_at=CASE WHEN source_checksum IS NULL OR source_checksum = ANY($3::text[]) THEN NOW() ELSE source_updated_at END
        WHERE faq_id=$1 AND locale='ar'`,
      [row.id, checksum, legacyChecksums],
    );
  }
  await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSeeded() {
  if (seeded) return;
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM manual_chapters",
  );
  if (rows[0].n > 0) {
    seeded = true;
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let ci = 0; ci < INITIAL_CHAPTERS.length; ci++) {
      const ch = INITIAL_CHAPTERS[ci];
      const { rows: cr } = await client.query<{ id: number }>(
        `INSERT INTO manual_chapters (title, slug, description, icon, "order", language, status)
         VALUES ($1,$2,$3,$4,$5,'en','published') RETURNING id`,
        [ch.title, ch.slug, ch.description, ch.icon, ci + 1],
      );
      const chapterId = cr[0].id;
      for (let si = 0; si < ch.sections.length; si++) {
        const s = ch.sections[si];
        await client.query(
          `INSERT INTO manual_sections (chapter_id, title, content, "order") VALUES ($1,$2,$3,$4)`,
          [chapterId, s.title, s.content, si + 1],
        );
      }
      if (ch.sops) {
        for (let oi = 0; oi < ch.sops.length; oi++) {
          const sop = ch.sops[oi];
          await client.query(
            `INSERT INTO manual_sops
             (chapter_id, process_name, purpose, responsible_role, steps, required_inputs,
              approval_flow, outputs, timeline, related_module, notifications, "order")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              chapterId,
              sop.processName,
              sop.purpose,
              sop.responsibleRole,
              JSON.stringify(sop.steps),
              sop.requiredInputs,
              sop.approvalFlow,
              sop.outputs,
              sop.timeline,
              sop.relatedModule,
              sop.notifications,
              oi + 1,
            ],
          );
        }
      }
    }
    await client.query("COMMIT");
    seeded = true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const chapterSelect = (locale: ManualLocale = "en") => `
  SELECT mc.id,
         CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END AS title,
         mc.slug,
         CASE WHEN '${locale}' = 'ar' THEN mcl.description ELSE mc.description END AS description,
         mc.icon,
         mc."order", mc.language, mc.status,
         mc.created_by_id AS "createdById", mc.updated_by_id AS "updatedById",
         mc.created_at AS "createdAt", mc.updated_at AS "updatedAt",
         (SELECT COUNT(*)::int FROM manual_sections ms WHERE ms.chapter_id = mc.id) AS "sectionCount",
         (SELECT COUNT(*)::int FROM manual_sops mso WHERE mso.chapter_id = mc.id) AS "sopCount"
  FROM manual_chapters mc
  LEFT JOIN manual_chapter_localizations mcl
    ON mcl.chapter_id = mc.id AND mcl.locale = '${locale}'
`;

/* ── Routes ───────────────────────────────────────────────────────────── */

// GET /manual/search?q=   — searches sections, FAQs, and SOPs
router.get("/manual/search", async (req, res) => {
  await ensureSeeded();
  const locale = getManualLocale(req);
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) {
    res.json([]);
    return;
  }
  const like = `%${q}%`;
  // Sections (primary)
  const { rows: sectionRows } = await pool.query(
    `SELECT mc.id, mc.slug,
            CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END AS "chapterTitle",
            CASE WHEN '${locale}' = 'ar' THEN msl.title ELSE ms.title END AS "sectionTitle",
            LEFT(CASE WHEN '${locale}' = 'ar' THEN msl.content ELSE ms.content END, 200) AS "excerpt",
            'section' AS "resultType"
     FROM manual_sections ms
     JOIN manual_chapters mc ON mc.id = ms.chapter_id
     LEFT JOIN manual_chapter_localizations mcl ON mcl.chapter_id = mc.id AND mcl.locale = '${locale}'
     LEFT JOIN manual_section_localizations msl ON msl.section_id = ms.id AND msl.locale = '${locale}'
     WHERE mc.status = 'published'
       AND (CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END ILIKE $1
         OR CASE WHEN '${locale}' = 'ar' THEN msl.title ELSE ms.title END ILIKE $1
         OR CASE WHEN '${locale}' = 'ar' THEN msl.content ELSE ms.content END ILIKE $1)
     ORDER BY mc."order", ms."order"
     LIMIT 20`,
    [like],
  );
  // FAQs
  const { rows: faqRows } = await pool.query(
    `SELECT mf.id, 'faq' AS slug,
            CASE WHEN '${locale}' = 'ar' THEN mfl.category ELSE mf.category END AS "chapterTitle",
            CASE WHEN '${locale}' = 'ar' THEN mfl.question ELSE mf.question END AS "sectionTitle",
            LEFT(CASE WHEN '${locale}' = 'ar' THEN mfl.answer ELSE mf.answer END, 200) AS "excerpt",
            'faq' AS "resultType"
     FROM manual_faqs mf
     LEFT JOIN manual_faq_localizations mfl ON mfl.faq_id = mf.id AND mfl.locale = '${locale}'
     WHERE mf.status = 'published'
       AND (CASE WHEN '${locale}' = 'ar' THEN mfl.question ELSE mf.question END ILIKE $1
         OR CASE WHEN '${locale}' = 'ar' THEN mfl.answer ELSE mf.answer END ILIKE $1)
     ORDER BY mf.category, mf."order"
     LIMIT 10`,
    [like],
  ).catch(() => ({ rows: [] }));
  // SOPs
  const { rows: sopRows } = await pool.query(
    `SELECT mso.id, mc.slug,
            CASE WHEN '${locale}' = 'ar' THEN mcl.title ELSE mc.title END AS "chapterTitle",
            CASE WHEN '${locale}' = 'ar' THEN msol.process_name ELSE mso.process_name END AS "sectionTitle",
            LEFT(CASE WHEN '${locale}' = 'ar' THEN msol.purpose ELSE mso.purpose END, 200) AS "excerpt",
            'sop' AS "resultType"
     FROM manual_sops mso
     JOIN manual_chapters mc ON mc.id = mso.chapter_id
     LEFT JOIN manual_chapter_localizations mcl ON mcl.chapter_id = mc.id AND mcl.locale = '${locale}'
     LEFT JOIN manual_sop_localizations msol ON msol.sop_id = mso.id AND msol.locale = '${locale}'
     WHERE mc.status = 'published'
       AND (CASE WHEN '${locale}' = 'ar' THEN msol.process_name ELSE mso.process_name END ILIKE $1
         OR CASE WHEN '${locale}' = 'ar' THEN msol.purpose ELSE mso.purpose END ILIKE $1)
     ORDER BY mc."order", mso."order"
     LIMIT 10`,
    [like],
  ).catch(() => ({ rows: [] }));
  res.json([...sectionRows, ...faqRows, ...sopRows].slice(0, 30));
});

// Editing a chapter/section/SOP's English source content previously never
// touched its translated localization rows at all — translation_status only
// ever changed via the explicit admin "import machine draft" action
// (ensureLocalizedCorpus, checksum-diffed), so an ordinary content edit left
// a stale Arabic translation with no visible "needs review" signal anywhere.
// This marks every existing localization row for the edited entity stale
// immediately, the moment any translatable field is touched in the request —
// erring toward re-review even on a no-op resave, rather than ever missing
// a real content change.
async function markLocalizationsStale(
  table: "manual_chapter_localizations" | "manual_section_localizations" | "manual_sop_localizations",
  fkColumn: "chapter_id" | "section_id" | "sop_id",
  entityId: number,
) {
  await pool.query(
    `UPDATE ${table} SET translation_status = 'review_required', updated_at = NOW()
     WHERE ${fkColumn} = $1 AND translation_status <> 'review_required'`,
    [entityId],
  );
}

// GET /manual/chapters
router.get("/manual/chapters", async (req, res) => {
  await ensureSeeded();
  await ensureTerminologyMigrated();
  const locale = getManualLocale(req);
  const showAll = canEdit(req);
  const { rows } = await pool.query(
    `${chapterSelect(locale)}
     ${showAll ? "" : "WHERE mc.status = 'published'"}
     ORDER BY mc."order"`,
  );
  res.json(rows);
});

// POST /manual/chapters
router.post("/manual/chapters", requirePerm("manual.edit"), async (req, res) => {
  const { title, slug, description, icon, order, language, status } = req.body as Record<string, string>;
  if (!title?.trim() || !slug?.trim()) {
    res.status(400).json({ error: "title and slug are required" });
    return;
  }
  let id: number;
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO manual_chapters (title, slug, description, icon, "order", language, status, created_by_id, updated_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
      [title.trim(), slug.trim(), description ?? null, icon ?? "FileText", order ?? 999, language ?? "en", status ?? "draft", req.currentUser!.id],
    );
    id = rows[0].id;
  } catch (err) {
    const pg = err as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === "manual_chapters_slug_unique") {
      res.status(409).json({ error: "slug_taken" });
      return;
    }
    throw err;
  }
  await logAudit({ userId: req.currentUser!.id, action: "create", module: "manual_chapter", entityId: id, newValue: JSON.stringify({ title, slug }) });
  const { rows: ch } = await pool.query(`${chapterSelect()} WHERE mc.id = $1`, [id]);
  res.status(201).json(ch[0]);
});

// POST /manual/chapters/reorder  (must be before /:slug)
router.post("/manual/chapters/reorder", requirePerm("manual.edit"), async (req, res) => {
  const { orderedIds } = req.body as { orderedIds: number[] };
  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: "orderedIds array required" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(`UPDATE manual_chapters SET "order" = $1 WHERE id = $2`, [i + 1, orderedIds[i]]);
    }
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// GET /manual/chapters/:slug
router.get("/manual/chapters/:slug", async (req, res) => {
  await ensureSeeded();
  await ensureTerminologyMigrated();
  const { slug } = req.params;
  const locale = getManualLocale(req);
  const showAll = canEdit(req);
  const { rows: ch } = await pool.query(
    `${chapterSelect(locale)} WHERE mc.slug = $1 ${showAll ? "" : "AND mc.status = 'published'"}`,
    [slug],
  );
  if (!ch.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const chapter = ch[0] as Record<string, unknown>;
  const { rows: sections } = await pool.query(
    `SELECT ms.id, ms.chapter_id AS "chapterId",
            CASE WHEN '${locale}' = 'ar' THEN msl.title ELSE ms.title END AS title,
            CASE WHEN '${locale}' = 'ar' THEN msl.content ELSE ms.content END AS content,
            ms."order", ms.created_at AS "createdAt", ms.updated_at AS "updatedAt"
     FROM manual_sections ms
     LEFT JOIN manual_section_localizations msl ON msl.section_id = ms.id AND msl.locale = '${locale}'
     WHERE ms.chapter_id = $1 ORDER BY ms."order"`,
    [chapter.id],
  );
  const { rows: sops } = await pool.query(
    `SELECT mso.id, mso.chapter_id AS "chapterId",
            CASE WHEN '${locale}' = 'ar' THEN msol.process_name ELSE mso.process_name END AS "processName",
            CASE WHEN '${locale}' = 'ar' THEN msol.purpose ELSE mso.purpose END AS purpose,
            CASE WHEN '${locale}' = 'ar' THEN msol.responsible_role ELSE mso.responsible_role END AS "responsibleRole",
            CASE WHEN '${locale}' = 'ar' THEN msol.steps ELSE mso.steps END AS steps,
            CASE WHEN '${locale}' = 'ar' THEN msol.required_inputs ELSE mso.required_inputs END AS "requiredInputs",
            CASE WHEN '${locale}' = 'ar' THEN msol.approval_flow ELSE mso.approval_flow END AS "approvalFlow",
            CASE WHEN '${locale}' = 'ar' THEN msol.outputs ELSE mso.outputs END AS outputs,
            CASE WHEN '${locale}' = 'ar' THEN msol.timeline ELSE mso.timeline END AS timeline,
            CASE WHEN '${locale}' = 'ar' THEN msol.related_module ELSE mso.related_module END AS "relatedModule",
            CASE WHEN '${locale}' = 'ar' THEN msol.notifications ELSE mso.notifications END AS notifications,
            mso."order"
     FROM manual_sops mso
     LEFT JOIN manual_sop_localizations msol ON msol.sop_id = mso.id AND msol.locale = '${locale}'
     WHERE mso.chapter_id = $1 ORDER BY mso."order"`,
    [chapter.id],
  );
  res.json({ ...chapter, sections, sops });
});

// PATCH /manual/chapters/:slug
router.patch("/manual/chapters/:slug", requirePerm("manual.edit.content"), async (req, res) => {
  const { slug } = req.params;
  const { rows: existing } = await pool.query<{ id: number }>(
    "SELECT id FROM manual_chapters WHERE slug = $1",
    [slug],
  );
  if (!existing.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const chapterId = existing[0].id;
  const { title, description, icon, order, language, status } = req.body as Record<string, string>;
  if (title !== undefined && !title.trim()) {
    res.status(400).json({ error: "invalid_title" });
    return;
  }
  await pool.query(
    `UPDATE manual_chapters
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         icon = COALESCE($3, icon),
         "order" = COALESCE($4, "order"),
         language = COALESCE($5, language),
         status = COALESCE($6, status),
         updated_by_id = $7,
         updated_at = NOW()
     WHERE id = $8`,
    [title?.trim() ?? null, description ?? null, icon ?? null, order ?? null, language ?? null, status ?? null, req.currentUser!.id, chapterId],
  );
  if (title !== undefined || description !== undefined) {
    await markLocalizationsStale("manual_chapter_localizations", "chapter_id", chapterId);
  }
  await logAudit({ userId: req.currentUser!.id, action: "update", module: "manual_chapter", entityId: chapterId });
  const { rows: ch } = await pool.query(`${chapterSelect()} WHERE mc.id = $1`, [chapterId]);
  res.json(ch[0]);
});

// DELETE /manual/chapters/:id — by numeric ID, not slug: a slug is caller-
// supplied text, and even with the slug now unique, deleting by the row's
// own stable primary key is the precise, unambiguous target. Cascades to
// every dependent row (sections, SOPs, their localizations, and version
// history) since none of those carry a DB-level ON DELETE CASCADE.
router.delete("/manual/chapters/:id", requirePerm("manual.edit"), async (req, res) => {
  const chapterId = Number(req.params.id);
  if (!Number.isInteger(chapterId) || chapterId < 1) {
    res.status(400).json({ error: "invalid_chapter_id" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      "SELECT id FROM manual_chapters WHERE id = $1 FOR UPDATE",
      [chapterId],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "not_found" });
      return;
    }
    await client.query(
      `DELETE FROM manual_sop_localizations WHERE sop_id IN (SELECT id FROM manual_sops WHERE chapter_id = $1)`,
      [chapterId],
    );
    await client.query(`DELETE FROM manual_sops WHERE chapter_id = $1`, [chapterId]);
    await client.query(
      `DELETE FROM manual_section_localizations WHERE section_id IN (SELECT id FROM manual_sections WHERE chapter_id = $1)`,
      [chapterId],
    );
    await client.query(`DELETE FROM manual_sections WHERE chapter_id = $1`, [chapterId]);
    await client.query(`DELETE FROM manual_chapter_localizations WHERE chapter_id = $1`, [chapterId]);
    await client.query(`DELETE FROM manual_version_history WHERE chapter_id = $1`, [chapterId]);
    await client.query(`DELETE FROM manual_chapters WHERE id = $1`, [chapterId]);
    await logAudit({ userId: req.currentUser!.id, action: "delete", module: "manual_chapter", entityId: chapterId }, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

/* ── Sections ──────────────────────────────────────────────────────── */

router.post("/manual/chapters/:slug/sections", requirePerm("manual.edit.content"), async (req, res) => {
  const { slug } = req.params;
  const { rows: ch } = await pool.query<{ id: number }>(
    "SELECT id FROM manual_chapters WHERE slug = $1",
    [slug],
  );
  if (!ch.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const chapterId = ch[0].id;
  const { title, content, order } = req.body as { title: string; content?: string; order?: number };
  if (!title?.trim()) {
    res.status(400).json({ error: "title required" });
    return;
  }
  const { rows: maxOrder } = await pool.query<{ m: number }>(
    `SELECT COALESCE(MAX("order"), 0) AS m FROM manual_sections WHERE chapter_id = $1`,
    [chapterId],
  );
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO manual_sections (chapter_id, title, content, "order") VALUES ($1,$2,$3,$4) RETURNING id`,
    [chapterId, title.trim(), content ?? "", order ?? maxOrder[0].m + 1],
  );
  await logAudit({ userId: req.currentUser!.id, action: "create", module: "manual_section", entityId: rows[0].id });
  const { rows: sec } = await pool.query(
    `SELECT id, chapter_id AS "chapterId", title, content, "order", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM manual_sections WHERE id = $1`,
    [rows[0].id],
  );
  res.status(201).json(sec[0]);
});

router.patch("/manual/sections/:id", requirePerm("manual.edit.content"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: old } = await pool.query<{ content: string; chapter_id: number }>(
    "SELECT content, chapter_id FROM manual_sections WHERE id = $1",
    [id],
  );
  if (!old.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await pool.query(
    `INSERT INTO manual_version_history (chapter_id, section_id, previous_content, updated_by_id)
     VALUES ($1,$2,$3,$4)`,
    [old[0].chapter_id, id, old[0].content, req.currentUser!.id],
  );
  const { title, content, order } = req.body as { title?: string; content?: string; order?: number };
  if (title !== undefined && !title.trim()) {
    res.status(400).json({ error: "invalid_title" });
    return;
  }
  await pool.query(
    `UPDATE manual_sections
     SET title = COALESCE($1, title),
         content = COALESCE($2, content),
         "order" = COALESCE($3, "order"),
         updated_at = NOW()
     WHERE id = $4`,
    [title?.trim() ?? null, content ?? null, order ?? null, id],
  );
  if (title !== undefined || content !== undefined) {
    await markLocalizationsStale("manual_section_localizations", "section_id", id);
  }
  await logAudit({ userId: req.currentUser!.id, action: "update", module: "manual_section", entityId: id });
  const { rows } = await pool.query(
    `SELECT id, chapter_id AS "chapterId", title, content, "order", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM manual_sections WHERE id = $1`,
    [id],
  );
  res.json(rows[0]);
});

router.delete("/manual/sections/:id", requirePerm("manual.edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query("DELETE FROM manual_sections WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await logAudit({ userId: req.currentUser!.id, action: "delete", module: "manual_section", entityId: id });
  res.json({ ok: true });
});

/* ── SOPs ─────────────────────────────────────────────────────────── */

router.post("/manual/chapters/:slug/sops", requirePerm("manual.edit"), async (req, res) => {
  const { slug } = req.params;
  const { rows: ch } = await pool.query<{ id: number }>(
    "SELECT id FROM manual_chapters WHERE slug = $1",
    [slug],
  );
  if (!ch.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const chapterId = ch[0].id;
  const { processName, purpose, responsibleRole, steps, requiredInputs, approvalFlow, outputs, timeline, relatedModule, notifications, order } = req.body as Record<string, unknown>;
  if (typeof processName !== "string" || !processName.trim()) {
    res.status(400).json({ error: "processName required" });
    return;
  }
  const { rows: maxOrder } = await pool.query<{ m: number }>(
    `SELECT COALESCE(MAX("order"), 0) AS m FROM manual_sops WHERE chapter_id = $1`,
    [chapterId],
  );
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO manual_sops
     (chapter_id, process_name, purpose, responsible_role, steps, required_inputs,
      approval_flow, outputs, timeline, related_module, notifications, "order")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [chapterId, processName.trim(), purpose ?? null, responsibleRole ?? null, steps ? JSON.stringify(steps) : null,
     requiredInputs ?? null, approvalFlow ?? null, outputs ?? null, timeline ?? null,
     relatedModule ?? null, notifications ?? null, order ?? maxOrder[0].m + 1],
  );
  await logAudit({ userId: req.currentUser!.id, action: "create", module: "manual_sop", entityId: rows[0].id });
  const { rows: sop } = await pool.query(
    `SELECT id, chapter_id AS "chapterId", process_name AS "processName", purpose,
            responsible_role AS "responsibleRole", steps, required_inputs AS "requiredInputs",
            approval_flow AS "approvalFlow", outputs, timeline, related_module AS "relatedModule",
            notifications, "order" FROM manual_sops WHERE id = $1`,
    [rows[0].id],
  );
  res.status(201).json(sop[0]);
});

router.patch("/manual/sops/:id", requirePerm("manual.edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: old } = await pool.query("SELECT id FROM manual_sops WHERE id = $1", [id]);
  if (!old.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { processName, purpose, responsibleRole, steps, requiredInputs, approvalFlow, outputs, timeline, relatedModule, notifications } = req.body as Record<string, unknown>;
  if (processName !== undefined && (typeof processName !== "string" || !processName.trim())) {
    res.status(400).json({ error: "invalid_process_name" });
    return;
  }
  await pool.query(
    `UPDATE manual_sops SET
     process_name = COALESCE($1, process_name),
     purpose = COALESCE($2, purpose),
     responsible_role = COALESCE($3, responsible_role),
     steps = COALESCE($4, steps),
     required_inputs = COALESCE($5, required_inputs),
     approval_flow = COALESCE($6, approval_flow),
     outputs = COALESCE($7, outputs),
     timeline = COALESCE($8, timeline),
     related_module = COALESCE($9, related_module),
     notifications = COALESCE($10, notifications),
     updated_at = NOW()
     WHERE id = $11`,
    [typeof processName === "string" ? processName.trim() : null, purpose ?? null, responsibleRole ?? null, steps ? JSON.stringify(steps) : null,
     requiredInputs ?? null, approvalFlow ?? null, outputs ?? null, timeline ?? null,
     relatedModule ?? null, notifications ?? null, id],
  );
  if ([processName, purpose, responsibleRole, steps, requiredInputs, approvalFlow, outputs, timeline, relatedModule, notifications].some((v) => v !== undefined)) {
    await markLocalizationsStale("manual_sop_localizations", "sop_id", id);
  }
  await logAudit({ userId: req.currentUser!.id, action: "update", module: "manual_sop", entityId: id });
  const { rows } = await pool.query(
    `SELECT id, chapter_id AS "chapterId", process_name AS "processName", purpose,
            responsible_role AS "responsibleRole", steps, required_inputs AS "requiredInputs",
            approval_flow AS "approvalFlow", outputs, timeline, related_module AS "relatedModule",
            notifications, "order" FROM manual_sops WHERE id = $1`,
    [id],
  );
  res.json(rows[0]);
});

router.delete("/manual/sops/:id", requirePerm("manual.edit"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query("DELETE FROM manual_sops WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await logAudit({ userId: req.currentUser!.id, action: "delete", module: "manual_sop", entityId: id });
  res.json({ ok: true });
});

/* ── Knowledge Center FAQ seed ───────────────────────────────────── */

let kcSetupDone = false;
async function ensureKCSetup(): Promise<void> {
  if (kcSetupDone) return;
  try {
    const { rows: cnt } = await pool.query<{ c: string }>(`SELECT COUNT(*) AS c FROM manual_faqs`);
    if (Number(cnt[0].c) === 0) await seedFAQs();
    kcSetupDone = true;
    // Idempotent: fix obsolete terminology in existing rows (no-op if already correct)
    await ensureTerminologyMigrated();
  } catch {
    kcSetupDone = false;
  }
}

type FaqSeed = { question: string; answer: string; category: string; order: number };

const FAQ_SEED: FaqSeed[] = [
  // Projects
  { category: "Projects", order: 1, question: "How do I create a new project?", answer: "Navigate to Projects in the sidebar and click 'New Project'. Complete all 8 sections of the registration form (Basics, Management Level, Geography, Role Assignments, Beneficiary Targets, Budget, Outputs, Documents), then click 'Submit for Review' or 'Save as Draft'." },
  { category: "Projects", order: 2, question: "What is the difference between HQ Managed and State Managed?", answer: "HQ Managed projects are overseen directly from CAFA headquarters and may span multiple states. State Managed projects are managed at state level by a state-based team. The management level determines the approval chain and who can edit the project." },
  { category: "Projects", order: 3, question: "How are project codes generated?", answer: "Project codes are auto-generated by the system in the format CAFA-{STATE_CODE}-{NNN}, for example CAFA-KRT-001 for a Khartoum project. You cannot change a project code once it is assigned." },
  { category: "Projects", order: 4, question: "Can a project cover multiple states?", answer: "Yes. In the Geography section of the project form, you can select multiple implementing states and their localities. Use the multi-state picker to add all relevant states." },
  { category: "Projects", order: 5, question: "What documents are required to submit a project?", answer: "At least one signed project document (such as a project proposal or donor agreement) is required before the project can be submitted for review. Supported formats: PDF, DOCX, XLSX, JPG, PNG — maximum 10 MB per file." },
  // Reports
  { category: "Reports", order: 1, question: "What are the three report types?", answer: "1. Project Report — progress report for a specific project. 2. HQ Sector Report — sector-wide consolidated report for a programme sector. 3. State Programme Report — state-level consolidated report covering all CAFA activities in a state." },
  { category: "Reports", order: 2, question: "How do I submit a report?", answer: "Go to Reports in the sidebar, select the relevant sub-page (Project, HQ Sector, or State Programme), click 'New Report', complete all four sections (Cover, Progress Narrative, Activities, Challenges), then click 'Submit Report'." },
  { category: "Reports", order: 3, question: "Why is my report stuck in 'Submitted' status?", answer: "The report is waiting for the Senior Programme Coordinator to review it. If it has been more than 2 working days, send a direct message via the Communication Centre. You can also check the Pending Approvals panel on the Dashboard." },
  { category: "Reports", order: 4, question: "Can I edit a report after submission?", answer: "No — once submitted, you cannot edit the report directly. The reviewer can return it to you for revision (status: Returned for Revision). You will be notified, and then you can edit and resubmit." },
  { category: "Reports", order: 5, question: "How do I export report data?", answer: "Each report list page has an 'Export CSV' button (top right). This downloads the current filtered list as a spreadsheet. Individual reports can be printed or saved as PDF from the report detail view." },
  // Risks
  { category: "Risks", order: 1, question: "What risk categories does CAFA use?", answer: "CAFA tracks five risk categories: Operational (day-to-day implementation risks), Security (staff and asset safety), Financial (budget and compliance), Programmatic (quality and outcome risks), and Environmental (natural hazards and climate factors)." },
  { category: "Risks", order: 2, question: "How is risk severity calculated?", answer: "CAFA's Risk Register uses a 3×3 matrix. Likelihood and Impact are each rated Low, Medium, or High. The Risk Score (1–9) is the product of these ratings. Bands: Critical = 9, High = 6–8, Medium = 2–5, Low = 1." },
  { category: "Risks", order: 3, question: "Who is notified when a critical risk is logged?", answer: "When a risk reaches Critical level, the system automatically notifies the Executive Director, Programme Manager, and Senior Programme Coordinator. High risks notify the Programme Manager and Senior Programme Coordinator. This happens automatically — no manual escalation is needed." },
  { category: "Risks", order: 4, question: "How do I close a risk?", answer: "Open the risk record and click the status action button to change it to 'Resolved' or 'Closed'. Add a closure note explaining how the risk was mitigated. Closed risks remain in the system for audit purposes." },
  // Planning
  { category: "Planning", order: 1, question: "What plan types are available?", answer: "CAFA PMIS supports six plan types: Monthly, Quarterly, Annual, Action Plan, Operational, and Emergency. Each serves a different planning horizon. Plans can optionally be linked to a specific project." },
  { category: "Planning", order: 2, question: "How far in advance should I submit a monthly plan?", answer: "Monthly plans should be submitted at least 5 working days before the month start date to allow time for the full approval chain (Technical Coordinator → Senior Programme Coordinator → Programme Manager → Activation). Late submissions may delay the start of implementation." },
  { category: "Planning", order: 3, question: "Can I link a plan to a project?", answer: "Yes. In the plan creation form, there is an optional 'Linked Project' field. Linking a plan to a project helps the system track implementation progress against project outputs and activities." },
  { category: "Planning", order: 4, question: "What is the difference between 'Approved' and 'Active' plan status?", answer: "'Approved' means the plan has passed the full approval chain. 'Active' means the Programme Manager has activated the plan, making it ready for implementation. You must wait for Active status before beginning work on plan activities." },
  // Notifications
  { category: "Notifications", order: 1, question: "How do I manage my notification preferences?", answer: "Go to your profile (click your name in the top right) → Manage Notification Preferences. Or navigate directly to Settings → Notification Preferences. You can toggle individual alert types for in-app and email channels, set a quiet hours window, and choose a delivery schedule." },
  { category: "Notifications", order: 2, question: "Why am I not receiving email notifications?", answer: "Email delivery requires the organization's mail server to be configured by the System Administrator. Check your Notification Preferences to ensure email is enabled for the relevant alert type. Also check your spam/junk folder." },
  { category: "Notifications", order: 3, question: "Can I turn off notifications for specific modules?", answer: "Yes. In Notification Preferences, you can individually toggle notifications for Approvals, Comments, Assignments, @Mentions, Due Dates, Risks, and System alerts. Some critical alerts (critical risks, security emails) cannot be disabled." },
  { category: "Notifications", order: 4, question: "What are quiet hours?", answer: "Quiet hours suppress email notifications during a time window you specify (e.g. 10pm to 7am). In-app notifications are still stored and visible when you log in. Mandatory alerts like critical risk escalations are delivered regardless of quiet hours." },
  // User Accounts
  { category: "User Accounts", order: 1, question: "How do I reset my password?", answer: "If you are logged out, click 'Forgot password?' on the login screen and enter your email address. If you are logged in, go to your Profile and use the 'Change Password' section. If neither works, ask the System Administrator to reset it for you." },
  { category: "User Accounts", order: 2, question: "My invitation link has expired — what do I do?", answer: "Invitation links expire after 7 days. Contact your System Administrator and ask them to resend the invitation. In the Users page, they can click the ⋮ menu on your account and select 'Resend Invitation'." },
  { category: "User Accounts", order: 3, question: "Can I change my own role?", answer: "No. User roles can only be changed by the System Administrator (Super Admin). Contact your line manager or the PMU to request a role change." },
  { category: "User Accounts", order: 4, question: "What happens to my data if my account is suspended?", answer: "Suspending an account prevents login but does not delete any data. All projects, reports, and plans created by the account remain intact. The account can be re-activated at any time by the System Administrator." },
  { category: "User Accounts", order: 5, question: "I can see my data has changed — how do I find out who changed it?", answer: "All data changes are recorded in the Audit Log (Administration → Audit Log). You can filter by module, action type, and date range to see exactly who changed what and when." },
  // Password Reset
  { category: "Password Reset", order: 1, question: "How long does an invitation link last?", answer: "Invitation links are valid for 7 days from the time they are generated. If the link expires, the System Administrator must resend the invitation from the Users management page." },
  { category: "Password Reset", order: 2, question: "The password reset page says 'invalid token' — what should I do?", answer: "The reset link has expired or was already used. Each password reset link can only be used once. Request a new reset link from the login page or ask the System Administrator to resend your invitation." },
  { category: "Password Reset", order: 3, question: "What are the password requirements?", answer: "Passwords must be at least 8 characters long and contain a mix of letters and numbers. Avoid using your username or obvious information. You can use a passphrase for a strong, memorable password." },
  // Offline Mode
  { category: "Offline Mode", order: 1, question: "Does CAFA PMIS work without internet?", answer: "CAFA PMIS is a Progressive Web App (PWA). Core pages and recently viewed data are cached so you can continue reading them offline. Active data entry (creating projects, submitting reports) requires an internet connection. Install the app on your device for the best offline experience." },
  { category: "Offline Mode", order: 2, question: "How do I install CAFA PMIS as an app on my device?", answer: "On Android: open the app in Chrome, tap the three-dot menu, and select 'Add to Home Screen' or 'Install App'. On iPhone/iPad: open in Safari, tap the Share button, then 'Add to Home Screen'. On desktop (Chrome/Edge): click the install icon in the address bar. Once installed, the app opens in a standalone window without the browser toolbar." },
  { category: "Offline Mode", order: 3, question: "What should I do if the system is down?", answer: "If CAFA PMIS is unavailable, collect data on paper or in a spreadsheet. As soon as the system is back online, enter the data with the correct dates. Flag any backdated entries with a note in the comments. Contact the System Administrator to report the outage." },
];

async function seedFAQs() {
  for (const f of FAQ_SEED) {
    await pool.query(
      `INSERT INTO manual_faqs (question, answer, category, "order") VALUES ($1,$2,$3,$4)`,
      [f.question, f.answer, f.category, f.order],
    );
  }
}

/* ── KC routes ───────────────────────────────────────────────────── */

// GET /manual/faqs
router.get("/manual/faqs", async (req, res) => {
  await ensureKCSetup();
  await ensureSeeded();
  const locale = getManualLocale(req);
  const { rows } = await pool.query(
    `SELECT mf.id,
            CASE WHEN '${locale}' = 'ar' THEN mfl.question ELSE mf.question END AS question,
            CASE WHEN '${locale}' = 'ar' THEN mfl.answer ELSE mf.answer END AS answer,
            CASE WHEN '${locale}' = 'ar' THEN mfl.category ELSE mf.category END AS category,
            mf."order"
     FROM manual_faqs mf
     LEFT JOIN manual_faq_localizations mfl ON mfl.faq_id = mf.id AND mfl.locale = '${locale}'
     WHERE mf.status = 'published'
     ORDER BY CASE WHEN '${locale}' = 'ar' THEN mfl.category ELSE mf.category END, mf."order"`,
  );
  const grouped: Record<string, { id: number; question: string; answer: string; order: number }[]> = {};
  for (const r of rows as { id: number; question: string; answer: string; category: string; order: number }[]) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push({ id: r.id, question: r.question, answer: r.answer, order: r.order });
  }
  res.json(grouped);
});

// Editorial inventory used by regression checks. It deliberately reports
// missing records instead of substituting English source values for Arabic.
router.get("/manual/localization-parity", async (req, res) => {
  if (!canEdit(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  await ensureSeeded();
  const locale = getManualLocale(req);
  const checks = await Promise.all([
    pool.query<{ total: string; missing: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.title) = '')::text AS missing
       FROM manual_chapters base
       LEFT JOIN manual_chapter_localizations l ON l.chapter_id = base.id AND l.locale = $1`,
      [locale],
    ),
    pool.query<{ total: string; missing: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.title) = '' OR BTRIM(l.content) = '')::text AS missing
       FROM manual_sections base
       LEFT JOIN manual_section_localizations l ON l.section_id = base.id AND l.locale = $1`,
      [locale],
    ),
    pool.query<{ total: string; missing: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.process_name) = '')::text AS missing
       FROM manual_sops base
       LEFT JOIN manual_sop_localizations l ON l.sop_id = base.id AND l.locale = $1`,
      [locale],
    ),
    pool.query<{ total: string; missing: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE l.id IS NULL OR BTRIM(l.question) = '' OR BTRIM(l.answer) = '')::text AS missing
       FROM manual_faqs base
       LEFT JOIN manual_faq_localizations l ON l.faq_id = base.id AND l.locale = $1`,
      [locale],
    ),
  ]);
  const [chapters, sections, sops, faqs] = checks.map(({ rows }) => ({
    total: Number(rows[0].total),
    missing: Number(rows[0].missing),
  }));
  const missing = chapters.missing + sections.missing + sops.missing + faqs.missing;
  const [sourceRows, localizedRows] = await Promise.all([
    pool.query<{ kind: string; id: number; source: unknown }>(`
      SELECT 'chapter' AS kind, id, jsonb_build_object('title', title, 'description', description) AS source FROM manual_chapters
      UNION ALL SELECT 'section', id, jsonb_build_object('title', title, 'content', content) FROM manual_sections
      UNION ALL SELECT 'sop', id, jsonb_build_object('process_name', process_name, 'purpose', purpose, 'responsible_role', responsible_role, 'steps', steps, 'required_inputs', required_inputs, 'approval_flow', approval_flow, 'outputs', outputs, 'timeline', timeline, 'related_module', related_module, 'notifications', notifications) FROM manual_sops
      UNION ALL SELECT 'faq', id, jsonb_build_object('question', question, 'answer', answer, 'category', category) FROM manual_faqs
    `),
    pool.query<{ kind: string; source_id: number; source_checksum: string | null; translation_status: string }>(`
      SELECT 'chapter' AS kind, chapter_id AS source_id, source_checksum, translation_status FROM manual_chapter_localizations WHERE locale='ar'
      UNION ALL SELECT 'section', section_id, source_checksum, translation_status FROM manual_section_localizations WHERE locale='ar'
      UNION ALL SELECT 'sop', sop_id, source_checksum, translation_status FROM manual_sop_localizations WHERE locale='ar'
      UNION ALL SELECT 'faq', faq_id, source_checksum, translation_status FROM manual_faq_localizations WHERE locale='ar'
    `),
  ]);
  const localized = new Map(localizedRows.rows.map((row) => [`${row.kind}:${row.source_id}`, row]));
  const report = { inSync: 0, sourceChanged: 0, missingLocalizedRows: 0, missingMappings: 0, reviewed: 0, machineDraft: 0, orphaned: 0, invalid: 0, blockers: [] as Array<{ kind: string; id: number; state: string }> };
  for (const row of sourceRows.rows) {
    const key = `${row.kind}:${row.id}`;
    const loc = localized.get(key);
    const source = row.source as Record<string, unknown>;
    const fields = Object.entries(source).flatMap(([field, value]) => {
      if (field === "steps") {
        const parsed = parseManualSteps(value);
        return Array.isArray(parsed)
          ? parsed.flatMap((step) => step && typeof step === "object" ? Object.values(step) : [])
          : [];
      }
      return Array.isArray(value) ? value : [value];
    }).filter((value): value is string => typeof value === "string" && value.trim() !== "");
    const unmapped = locale === "ar" && fields.some((value) =>
      !MANUAL_ARABIC_DRAFT[value]
      && !MACHINE_DRAFT_GAPS[value]
      && !ARABIC_CHAPTERS[String(value)]
      && !(row.kind === "sop" && MANUAL_SOP_STEP_ARABIC_DRAFT[row.id]?.[value]),
    );
    if (unmapped) {
      report.missingMappings++;
      report.blockers.push({ kind: row.kind, id: row.id, state: "MISSING_TRANSLATION_MAPPING" });
    }
    if (!loc) {
      report.missingLocalizedRows++;
      report.blockers.push({ kind: row.kind, id: row.id, state: "MISSING_LOCALIZED_ROW" });
      continue;
    }
    if (loc.translation_status === "reviewed" || loc.translation_status === "approved") report.reviewed++;
    if (loc.translation_status === "draft_machine_generated") report.machineDraft++;
    if (loc.source_checksum === manualSourceChecksum(source)) report.inSync++;
    else {
      report.sourceChanged++;
      report.blockers.push({ kind: row.kind, id: row.id, state: "SOURCE_CHANGED" });
    }
  }
  const localKeys = new Set(sourceRows.rows.map((row) => `${row.kind}:${row.id}`));
  report.orphaned = localizedRows.rows.filter((row) => !localKeys.has(`${row.kind}:${row.source_id}`)).length;
  res.json({ locale, chapters, sections, sops, faqs, missing, complete: missing === 0, totalSources: sourceRows.rows.length, localizableFields: sourceRows.rows.length, ...report, dryRun: true });
});

// Explicit editorial write boundary. This imports the checked-in
// machine-generated draft once; it is never invoked by Manual GET/search
// routes and never overwrites a human-reviewed translation.
router.post("/manual/localization/import-machine-draft", async (req, res) => {
  // Development permits the authenticated QA workflow to load the checked-in
  // draft. Production remains limited to the established Manual editors.
  if (process.env.NODE_ENV !== "development" && !canEdit(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const preflight = await runManualImportPreflight();
    if (preflight.missingMappings > 0) {
      res.status(409).json({ ok: false, state: "PRECHECK_BLOCKED", ...preflight });
      return;
    }
    await ensureSeeded();
    await ensureKCSetup();
    await ensureLocalizedCorpus();
  } catch (error) {
    if ((error as { code?: string }).code === "PRECHECK_BLOCKED") {
      const details = error as Error & { preflight: ManualPreflight };
      res.status(409).json({ ok: false, state: "PRECHECK_BLOCKED", ...details.preflight });
      return;
    }
    res.status(500).json({ ok: false, state: "TRANSACTION_FAILED", rolledBack: true });
    return;
  }
  res.json({
    ok: true,
    status: "draft_machine_generated",
    reviewStatus: "review_required",
  });
});

router.patch("/manual/localizations/:kind/:id", requirePerm("manual.edit.content"), async (req, res) => {
  const { kind, id } = req.params;
  const { status, reviewed, ...fields } = req.body as Record<string, unknown>;
  const nextStatus = status === "reviewed" || status === "approved" ? status : "review_required";
  const reviewedAt = reviewed === true || nextStatus === "reviewed" || nextStatus === "approved" ? "NOW()" : "NULL";
  const reviewer = reviewedAt === "NOW()" ? req.currentUser!.id : null;
  const table = kind === "chapter" ? "manual_chapter_localizations"
    : kind === "section" ? "manual_section_localizations"
    : kind === "sop" ? "manual_sop_localizations"
    : kind === "faq" ? "manual_faq_localizations" : null;
  const key = kind === "chapter" ? "chapter_id" : kind === "section" ? "section_id" : kind === "sop" ? "sop_id" : "faq_id";
  if (!table || !Number.isInteger(Number(id)) || fields.locale !== "ar") {
    res.status(400).json({ error: "kind, numeric id, and locale=ar are required" });
    return;
  }
  const allowed = ["title", "description", "content", "process_name", "purpose", "responsible_role", "steps", "required_inputs", "approval_flow", "outputs", "timeline", "related_module", "notifications", "question", "answer", "category"];
  const assignments = Object.keys(fields).filter((name) => allowed.includes(name)).map((name, index) => `"${name}" = $${index + 1}`);
  const values = Object.keys(fields).filter((name) => allowed.includes(name)).map((name) => fields[name]);
  if (!assignments.length) {
    res.status(400).json({ error: "at least one localized field is required" });
    return;
  }
  values.push(nextStatus, reviewer);
  const statusParam = values.length - 1;
  const reviewerParam = values.length;
  await pool.query(
    `UPDATE ${table} SET ${assignments.join(", ")}, translation_status=$${statusParam},
       reviewed_at=${reviewedAt === "NOW()" ? "NOW()" : "NULL"}, reviewed_by_id=$${reviewerParam}, updated_at=NOW()
     WHERE ${key}=$${values.length + 1} AND locale='ar'`,
    [...values, Number(id)],
  );
  res.json({ ok: true, status: nextStatus, reviewRequired: nextStatus !== "approved" && nextStatus !== "reviewed" });
});

// GET /manual/popular
router.get("/manual/popular", async (req, res) => {
  await ensureKCSetup();
  const { rows } = await pool.query(
    `SELECT mc.id, mc.title, mc.slug, mc.description, mc.icon, mc."order", mc.status,
            COALESCE(mc.view_count, 0) AS "viewCount",
            mc.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM manual_sections ms WHERE ms.chapter_id = mc.id) AS "sectionCount",
            (SELECT COUNT(*)::int FROM manual_sops mso WHERE mso.chapter_id = mc.id) AS "sopCount"
     FROM manual_chapters mc
     WHERE mc.status = 'published'
     ORDER BY COALESCE(mc.view_count, 0) DESC, mc."order"
     LIMIT 6`,
  );
  res.json(rows);
});

// POST /manual/chapters/:slug/view  (increment view counter)
router.post("/manual/chapters/:slug/view", async (req, res) => {
  await ensureKCSetup();
  await pool.query(
    `UPDATE manual_chapters SET view_count = COALESCE(view_count, 0) + 1 WHERE slug = $1`,
    [req.params.slug],
  );
  res.json({ ok: true });
});

// POST /manual/chapters/:slug/feedback
router.post("/manual/chapters/:slug/feedback", async (req, res) => {
  await ensureKCSetup();
  const { slug } = req.params;
  const { helpful } = req.body as { helpful: boolean };
  if (typeof helpful !== "boolean") {
    res.status(400).json({ error: "helpful (boolean) required" });
    return;
  }
  await pool.query(
    `INSERT INTO manual_feedback (chapter_slug, user_id, helpful) VALUES ($1,$2,$3)`,
    [slug, req.currentUser?.id ?? null, helpful],
  );
  const { rows } = await pool.query<{ helpful: boolean; count: string }>(
    `SELECT helpful, COUNT(*) AS count FROM manual_feedback WHERE chapter_slug = $1 GROUP BY helpful`,
    [slug],
  );
  const stats = { helpful: 0, notHelpful: 0 };
  for (const r of rows) {
    if (r.helpful) stats.helpful = Number(r.count);
    else stats.notHelpful = Number(r.count);
  }
  res.json({ ok: true, stats });
});

// GET /manual/chapters/:slug/feedback  (get feedback stats for a chapter)
router.get("/manual/chapters/:slug/feedback", async (req, res) => {
  await ensureKCSetup();
  const { slug } = req.params;
  const { rows } = await pool.query<{ helpful: boolean; count: string }>(
    `SELECT helpful, COUNT(*) AS count FROM manual_feedback WHERE chapter_slug = $1 GROUP BY helpful`,
    [slug],
  );
  const stats = { helpful: 0, notHelpful: 0 };
  for (const r of rows) {
    if (r.helpful) stats.helpful = Number(r.count);
    else stats.notHelpful = Number(r.count);
  }
  res.json(stats);
});

export default router;
