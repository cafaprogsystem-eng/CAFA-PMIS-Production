# CAFA PMIS — System Manual

**Version:** 2.0  
**Last Updated:** June 2026  
**Status:** ✅ PRODUCTION CERTIFIED  
**Prepared by:** CAFA Development Organization / منظمة كافا للتنمية

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Login & Authentication](#2-login--authentication)
3. [Dashboard](#3-dashboard)
4. [Projects Module](#4-projects-module)
5. [Planning Module](#5-planning-module)
6. [Budget Module](#6-budget-module)
7. [Risks Module](#7-risks-module)
8. [Reports Module](#8-reports-module)
9. [Notifications](#9-notifications)
10. [Document Repository](#10-document-repository)
11. [AI Assistant](#11-ai-assistant)
12. [Users & Administration](#12-users--administration)
13. [Offline / PWA Mode](#13-offline--pwa-mode)
14. [Security](#14-security)
15. [Troubleshooting](#15-troubleshooting)
16. [Frequently Asked Questions](#16-frequently-asked-questions)

---

## 1. Introduction

### 1.1 About CAFA PMIS

CAFA PMIS is the Project Management Information System for the **CAFA Development Organization (منظمة كافا للتنمية)**, built to manage Sudan humanitarian operations. The system gives staff a single platform to:

- Track projects across all 18 Sudanese states and the current canonical humanitarian sectors
- Register, monitor, and report on beneficiaries
- Manage multi-level approval workflows for projects, plans, and reports
- Log and triage operational and security risks
- Maintain organizational budgets and donor portfolios
- Collaborate via messages, comments, and an AI assistant
- Work fully offline in low-connectivity field environments

### 1.2 System Objectives

| Objective | Description |
|---|---|
| **Transparency** | All project data, approvals, and changes are audited and visible to authorised staff |
| **Accountability** | Multi-stage approval chains ensure peer review before key decisions |
| **Field Resilience** | Offline mode keeps staff productive without internet connectivity |
| **Data Integrity** | Idempotency keys and conflict resolution prevent duplicate submissions |
| **Role Security** | Granular role-based access ensures staff see only what they need |

### 1.3 Operational Coverage

- **15 Sudanese States** — all CAFA operational states
- **9 Humanitarian Sectors** — Health, WASH, Protection, Education, MPCA / Cash Assistance, Food Security & Livelihoods, Agriculture & Livelihoods, Nutrition, Shelter / NFI
- **7 User Roles** — from Super Admin to State Officer

### 1.4 User Roles Overview

| Role | Arabic Equivalent | Scope | Primary Responsibilities |
|---|---|---|---|
| **Super Admin** | المشرف العام | Global | Full system control, user management, AI settings, audit access |
| **Executive Director** | المدير التنفيذي | Global | Strategic dashboards, final oversight, read-only on operational data |
| **Program Manager** | مدير البرامج | Global | Final approval on projects, reports, and plans; user admin |
| **Senior Coordinator** | المنسق الأول | HQ | Coordination-level approvals; comments; plan management |
| **Technical Coordinator** | المنسق الفني | Sector-restricted | Technical review of projects/reports in their assigned sector(s) |
| **State Manager** | مدير الولاية | State-restricted | State-level oversight; monitoring; submit projects and plans |
| **State Officer** | مسؤول الولاية | State-restricted | Data entry; project submission; report drafting |

> **💡 Tip:** Use the avatar in the top-right corner to switch between demo users and see how the interface changes per role.

> **⚠️ Warning:** Only a Super Admin or Program Manager can create new users or change role assignments. Never share login credentials.

---

## 2. Login & Authentication

### 2.1 Login Process

1. Navigate to the CAFA PMIS URL in your browser.
2. Enter your **Username** (e.g. `amira`) or **Email address**.
3. Enter your **Password**.
4. Optionally tick **Remember me** to stay logged in for 30 days (default session is 8 hours).
5. Click **Sign In**.

If your account is not in `active` status you will receive an `invalid_credentials` error — contact your administrator.

> **💡 Tip:** The login page is fully bilingual. Toggle between English and Arabic using the language selector in the top-right corner of the login screen. Your preference is saved locally.

**Demo Credentials (development environment only):**

| Username | Role |
|---|---|
| `amira` | Super Admin |
| `fatima` | Program Manager |
| `ahmed.m` | Senior Coordinator |
| `hassan` | Technical Coordinator |
| `mona` | State Officer |

Password for all demo users: **`cafa2026`**

### 2.2 Password Reset

Password resets are performed by an administrator:

1. Admin navigates to **Users** (sidebar).
2. Clicks the row action menu (⋮) for the relevant user.
3. Selects **Reset Password**.
4. Either sets a new password directly, or re-issues an invite link with a fresh 7-day token.

> **⚠️ Warning:** There is no self-service "forgot password" email flow in the current version. Contact your Super Admin if you cannot log in.

### 2.3 Invitation Flow

When a new user is created with `Invited` status:

1. The system generates a secure invite token (valid for **7 days**).
2. The admin copies the `/invite/{token}` link shown in the create dialog.
3. The admin shares the link manually (email, WhatsApp, etc.).
4. The new user opens the link, sets their password, and is automatically logged in.

> **⚠️ Warning:** Invite tokens expire after 7 days. If the user does not accept in time, use **Resend Invite** from the Users page row menu.

### 2.4 Session Management

| Setting | Value |
|---|---|
| Standard session duration | 8 hours |
| "Remember me" session duration | 30 days |
| Session cookie | `cafa_sid` — secure, HttpOnly, not accessible to JavaScript |
| Logout | Avatar → **Sign out** — immediately invalidates the session |

> **💡 Tip:** Always log out from shared computers. The session cookie cannot be read by malicious scripts but it will persist until the browser is closed if you do not sign out.

---

## 3. Dashboard

### 3.1 Dashboard Overview

The dashboard is the default landing page after login. Its content adapts to your role — strategic roles see organisation-wide KPIs; state roles see their assigned state's data.

**Dashboard role groups:**

| Group | Roles |
|---|---|
| Strategic | Super Admin, Executive Director |
| Operational | Program Manager, Senior Coordinator |
| Technical | Technical Coordinator |
| State | State Manager, State Officer |

### 3.2 KPI Summary Cards

Strategic and Operational roles see **8 KPI cards**; State roles see **6 cards**. Every card is clickable and navigates to the corresponding module filtered to the relevant data.

| Card | Meaning | Clickable To |
|---|---|---|
| Total Projects | All registered projects | Projects list |
| Active Projects | Projects in `active` status | Projects list (filtered) |
| Total Beneficiaries | Aggregated across active projects | Beneficiary breakdown modal |
| Open Risks | Risks in `open` or `monitoring` status | Risks list |
| Critical Risks | Risks with computed level = `critical` | Risks list (filtered) |
| Completed Projects | Projects in `closed` status | Projects list (filtered) |
| Reports Submitted | Reports awaiting review | Reports list |
| Reports Pending | Draft reports not yet submitted | Reports list |

### 3.3 Dashboard Charts

| Chart | Type | Description |
|---|---|---|
| Monthly Achievement | Area chart | Progress percentage month-by-month |
| Sector Performance | Bar chart | Output achievement by sector |
| Projects by State | Bar chart | Count of projects per state |
| Donor Portfolio | Bar chart | Budget allocation by donor |
| Reports by Type | Bar chart | Project / HQ Sector / State report counts |
| Risk by State | Bar chart | Open risk count per state |
| Reports Status | Pie chart | Distribution across draft / submitted / approved |

### 3.4 Additional Dashboard Panels

- **Budget & Beneficiary Snapshot** — Total approved budget, spent, and beneficiary counts (HQ roles only)
- **Reporting Analytics Strip** — Submission rates and approval timelines (all roles)
- **Pending Approvals Panel** — Items waiting for your action with direct links
- **State Performance Table** — Row-per-state KPIs (HQ roles)
- **Beneficiary Breakdown Modal** — Opens from the "Total Beneficiaries" card; shows IDP / returnee / host community / refugee breakdown with gender and disability disaggregation

### 3.5 KPI Interpretation Guide

| Colour | Meaning |
|---|---|
| 🟢 Green | On track / above target |
| 🟡 Amber | Approaching threshold / needs attention |
| 🔴 Red | Below target / critical |

> **💡 Tip:** Dashboard data is computed live from the database — there is no need to refresh manually. Use the browser refresh (F5) if data appears stale.

---

## 4. Projects Module

### 4.1 Project Overview

Projects are the core tracking unit in CAFA PMIS. Each project captures:

- **Identity** — title, code (auto-generated), sector, description
- **Geography** — one or more states and localities
- **Management Level** — `HQ Managed` or `State Managed`
- **Team** — role assignments (State Program Officer, Technical Coordinator, etc.)
- **Beneficiary Targets** — by category and gender
- **Budget** — total approved budget with currency
- **Outputs, Activities, Indicators** — logical framework elements
- **Documents** — signed project documents stored securely
- **Lifecycle Status** — driven by the approval workflow

**Project code format:** `CAFA-{STATE_CODE}-{NNN}` (auto-generated on creation)

### 4.2 Creating a Project

> **Required permissions:** `projects.create` — State Officer, State Manager, Senior Coordinator, Program Manager, Super Admin

**Steps:**

1. Navigate to **Projects** in the sidebar.
2. Click **+ New Project**.
3. Complete the registration form across **8 sections**:

| Section | Key Fields |
|---|---|
| **1. Basics** | Title, sector, description, start date, end date |
| **2. Management Level** | HQ Managed or State Managed |
| **3. Geography** | State(s), localities within each state |
| **4. Role Assignments** | Assign staff by role (State Program Officer, TC, etc.) |
| **5. Beneficiary Targets** | Male / Female / Boys / Girls by category |
| **6. Budget & Currency** | Total approved budget, currency (SDG / USD / EUR / GBP) |
| **7. Outputs & Activities** | Objectives, activities, indicators, progress |
| **8. Documents** | Upload at least one signed project document |

4. Click **Submit for Review** (or **Save as Draft** to continue later).

> **⚠️ Warning:** Project codes are assigned automatically on creation. Do not attempt to type a code manually — it will be overwritten.

> **💡 Tip:** You must upload at least one document before submitting. Supported formats: PDF, DOCX, XLSX, PNG, JPG.

### 4.3 Project Approval Workflow

```
draft → submitted → technically_approved → coordination_approved → approved → active → closed
```

| Transition | Action | Performed By |
|---|---|---|
| `submit` | Submit for review | State Officer / State Manager |
| `technical_review` | Technical approval | Technical Coordinator |
| `coordination_review` | Coordination approval | Senior Coordinator |
| `final_approve` | Final approval | Program Manager |
| `activate` | Mark as active | Program Manager / Super Admin |
| `close` | Close the project | Program Manager / Super Admin |
| `request_revision` | Return for revision | Any approver in chain |
| `reject` | Reject the project | Any approver in chain |

> **⚠️ Warning:** `final_approve` is **blocked** if there are any unresolved `required_correction` comments on the project. Resolve all correction threads before approving.

> **⚠️ Warning:** Rejecting or requesting revision requires a mandatory comment explaining the reason. The system will not allow the action without it.

**Notification on every transition:** the submitter and all assigned staff receive an in-app notification when the project status changes.

### 4.4 Editing a Project

1. Navigate to the project detail page (click the project title or code).
2. Click **Edit** (top-right).
3. Modify the relevant section.
4. Click **Save**.

> **💡 Tip:** Projects in `approved` or `active` status can still be edited for non-critical fields. Budget and sector changes should be discussed with the Program Manager before editing.

### 4.5 Managing Project Documents

1. Open the project detail page.
2. Click the **Documents** tab.
3. Click **Upload Document** — select category and file.
4. Documents are uploaded to CAFA secure object storage.
5. To delete a document: click the delete icon (only the uploader or an admin can delete).

> **⚠️ Warning:** Document deletion is permanent. Download a copy before deleting if you may need it in future.

### 4.6 Project Lifecycle Summary

| Status | Meaning |
|---|---|
| `draft` | Created, not yet submitted |
| `submitted` | Awaiting Technical Coordinator review |
| `technically_approved` | TC approved; awaiting Senior Coordinator |
| `coordination_approved` | SC approved; awaiting Program Manager |
| `approved` | Fully approved; ready to activate |
| `active` | Actively being implemented |
| `closed` | Implementation completed |
| `rejected` | Rejected by an approver |

---

## 5. Planning Module

### 5.1 Plan Types

CAFA PMIS supports **6 plan types**:

| Type | Purpose |
|---|---|
| **Monthly** | Operational targets for a single month |
| **Quarterly** | Activity targets across a quarter |
| **Annual** | Year-level programmatic plan |
| **Action Plan** | Task-oriented plan for a specific initiative |
| **Operational Plan** | Field operations scheduling |
| **Emergency Plan** | Rapid-response plan for crises |

Plans can optionally be linked to an existing project.

**Plan code format:** `CAFA-PLAN-{STATE_CODE}-{NNN}`

> **💡 Tip:** Access Action Plans directly from **Planning → Action Plans** in the sidebar. All other plan types are under **Planning → Plans**.

### 5.2 Creating a Plan

> **Required permissions:** `plans.create`

1. Navigate to **Planning → Plans** (or **Action Plans**).
2. Click **+ New Plan**.
3. At the URL `/plans/new` — fill in:

| Field | Required | Notes |
|---|---|---|
| Title | ✅ | |
| Type | ✅ | Monthly / Quarterly / Annual / Action / Operational / Emergency |
| State | ✅ | |
| Sector | ✅ | Must match your assigned sector if you are a TC |
| Linked Project | Optional | Links plan objectives to a project |
| Responsible Staff | ✅ | |
| Start / End Dates | ✅ | |
| Description | ✅ | |

4. Add **Objectives** — each with title, priority, description, and expected outcome.
5. Under each objective, add **Activities** with: title, dates, responsible staff, status, progress %, planned/actual budget, expected output, and performance indicator.
6. Click **Submit** or **Save as Draft**.

### 5.3 Plan Approval Workflow

```
draft → submitted → technically_approved → coordination_approved → approved → active → in_progress → completed
                                                                                   ↘ delayed
```

| Transition | Performed By |
|---|---|
| `submit` | Plan author |
| `technical_review` | Technical Coordinator |
| `coordination_review` | Senior Coordinator |
| `final_approve` | Program Manager |
| `activate` | Program Manager / Super Admin |
| `start` | Plan manager |
| `mark_delayed` | Plan manager |
| `complete` | Plan manager |
| `cancel` | Any approver (at any stage) |
| `request_revision` / `reject` | Any approver |
| `archive` | Program Manager |

> **⚠️ Warning:** `final_approve` is blocked while unresolved `required_correction` comments exist. Resolve them first.

### 5.4 Planning Dashboard

Navigate to **Planning → Planning Dashboard** for an aggregated view of:
- Plan counts by type and status
- Achievement rates across objectives
- Delayed vs. on-track plans
- Budget utilisation across all active plans

---

## 6. Budget Module

### 6.1 Budget Overview

Budget tracking in CAFA PMIS is project-centric. Each project carries a **Total Approved Budget** field, a currency, and output/activity-level budget allocations.

Navigate to **Budget** in the sidebar to see the organisation-wide budget dashboard.

### 6.2 Budget Fields (per project)

| Field | Description |
|---|---|
| **Total Approved Budget** | The full donor-approved budget |
| **Currency** | SDG / USD / EUR / GBP |
| **Per-Activity Budget** | Planned vs. Actual spend tracked per activity |
| **Burn %** | Auto-calculated: Actual ÷ Planned × 100 |
| **Budget Remaining** | Auto-calculated: Planned − Actual |

### 6.3 Budget Utilisation Tracking

Budget utilisation is tracked at three levels:

1. **Activity level** — Each activity records planned and actual budget
2. **Project level** — Aggregated from all activities
3. **Organisation level** — Aggregated across all active projects; shown on the Budget page and the dashboard Donor Portfolio chart

> **💡 Tip:** The **Donor Portfolio** chart on the dashboard shows budget allocation by donor source. Use it to spot over/under-spent donor lines quickly.

### 6.4 Budget Reports

Budget data flows into the **Project Report** type (Section 4 of the report form). Reports capture:
- Planned budget for the reporting period
- Actual budget spent
- Auto-calculated remaining and burn %
- Beneficiary counts (manual entry, disaggregated by gender and age)

> **⚠️ Warning:** Budget figures in reports are manually entered narratives. They are not automatically pulled from activity records. Always reconcile against the project's activity-level budget before submitting.

---

## 7. Risks Module

### 7.1 Risk Overview

CAFA PMIS tracks operational, security, financial, programmatic, and environmental risks. Navigate to **Risks** in the sidebar.

### 7.2 Creating a Risk

> **Required permissions:** `risks.create`

1. Navigate to **Risks → + New Risk**.
2. Fill in:

| Field | Required | Options / Notes |
|---|---|---|
| Title | ✅ | |
| Description | ✅ | |
| Category | ✅ | Operational / Security / Financial / Programmatic / Environmental |
| Likelihood | ✅ | Low / Medium / High |
| Severity / Impact | ✅ | Low / Medium / High / Critical |
| State | Optional | |
| Linked Project | Optional | |
| Assigned To | Optional | User responsible for mitigation |
| Mitigation Plan | Optional | Free text |
| Due Date | Optional | |

### 7.3 Risk Scoring (Heatmap)

The system automatically computes a **Risk Level** from Likelihood × Impact:

| | Low Impact | Medium Impact | High/Critical Impact |
|---|---|---|---|
| **Low Likelihood** | Low (1) | Low (2) | Medium (3) |
| **Medium Likelihood** | Low (2) | Medium (4) | High (6) |
| **High Likelihood** | Medium (3) | High (6) | **Critical (9)** |

**Thresholds:**
- Score ≥ 9 → 🔴 **Critical**
- Score ≥ 6 → 🟠 **High**
- Score ≥ 2 → 🟡 **Medium**
- Score < 2 → 🟢 **Low**

### 7.4 Risk Status Changes

| Status | Meaning |
|---|---|
| `open` | Risk identified, no mitigations applied yet |
| `monitoring` | Mitigations in place; being watched |
| `mitigated` | Risk resolved or controls fully in place |
| `closed` | Risk no longer relevant |

To change status: open the risk detail page → click **Change Status** → select new status → save.

### 7.5 Risk Notifications & Escalation

The system automatically sends in-app notifications when:

| Event | Notified Parties |
|---|---|
| New risk created | All assigned staff + Program Manager |
| Risk updated | Assigned user + Senior Coordinator |
| Risk level becomes **Critical** | Assigned user + Program Manager (24 h dedup) |
| Risk level becomes **High** | Assigned user + Senior Coordinator (24 h dedup) |
| Severity downgraded | Assigned user + Program Manager + Senior Coordinator |
| Risk status changed | Assigned user + Program Manager + Senior Coordinator |
| Risk linked to a project | Project team notified |

> **⚠️ Warning:** Critical risk notifications are deduplicated — a second notification is not sent within 24 hours of the first to avoid alert fatigue. If you update a critical risk and no notification appears, this is expected behaviour.

---

## 8. Reports Module

### 8.1 Report Types

CAFA PMIS supports **3 report types**, each accessible from a dedicated sidebar entry:

| Type | Sidebar Entry | Audience |
|---|---|---|
| **Project Report** | Reports → Project Reports | Project-level progress |
| **HQ Sector Report** | Reports → HQ Sector Reports | Sector-wide HQ view |
| **State Program Report** | Reports → State Program Reports | State-level operational view |

### 8.2 Report Structure (All Types)

Every report has 4 sections:

| Section | Content |
|---|---|
| **Section 1 — Header** | Report type, period (month + year), state, sector, linked project |
| **Section 2 — Progress Narrative** | Free text: achievements, outputs reached, key milestones |
| **Section 3 — Activities Implemented** | Repeater: add/edit/delete activities with status, budget, beneficiaries |
| **Section 4 — Challenges & Recommendations** | Free text: obstacles encountered, proposed actions |

**Section 3 Activity Fields by Report Type:**

| Field | Project Report | HQ Sector Report | State Report |
|---|---|---|---|
| Activity name | ✅ | ✅ | ✅ |
| Output / Milestone | ✅ | ✅ | ✅ |
| Status | ✅ | ✅ | ✅ |
| Progress % | ✅ | ✅ | ✅ |
| Planned / Actual Budget | ✅ | — | — |
| Beneficiaries (M/F/B/G) | ✅ | ✅ | ✅ |
| Related Project | — | ✅ | ✅ |
| State | — | ✅ | — |
| Sector | — | — | ✅ |

**Activity status options:** Planned / In Progress / Completed / Delayed / Cancelled

### 8.3 Creating and Submitting a Report

1. Navigate to the relevant report sub-page (**Project / HQ Sector / State**).
2. Click **+ New Report**.
3. Complete all 4 sections.
4. Click **Submit Report** — this creates the report and immediately fires the `submit` transition.
5. Alternatively, click **Save as Draft** to return later.

> **💡 Tip:** Auto-pulled project reference data (aggregated from activity records) is shown in a **Reference Card** in the detail sheet. It is read-only and for your reference only — it does not populate the report fields automatically.

### 8.4 Report Submission & Approval Workflow

```
draft → submitted → coordination_approved → approved → archived
```

| Transition | Performed By | Notes |
|---|---|---|
| `submit` | Report author | Creates or resubmits the report |
| `coordination_review` | Senior Coordinator | Coordination-level check |
| `final_approve` | Program Manager | Final sign-off |
| `request_revision` | Senior Coordinator | Returns to draft; comment required |
| `reject` | Senior Coordinator / PM | Requires mandatory comment |
| `archive` | Program Manager | After approval; long-term storage |

### 8.5 Exporting Reports

Each report list page has an **Export CSV** button. The export includes all visible filtered rows.

---

## 9. Notifications

### 9.1 Notification Centre

The **Bell icon** in the top navigation bar shows your unread notification count. Click it to open the notification popover with recent alerts. Click **View all** to go to the full Notifications page at `/notifications`.

### 9.2 Notification Types

| Kind | Trigger |
|---|---|
| `project_created` | New project registered |
| `project_assigned` | You were assigned to a project |
| `resubmitted` | Project resubmitted after revision |
| `technically_approved` | Project technically approved |
| `coordination_approved` | Project coordination approved |
| `approved` | Project fully approved |
| `rejected` | Project rejected |
| `document_uploaded` | Document added to a project |
| `risk_created` | New risk logged |
| `risk_updated` | Risk record edited |
| `risk_critical` | Risk reached Critical level |
| `risk_high` | Risk reached High level |
| `risk_severity_downgraded` | Risk severity decreased |
| `risk_status_changed` | Risk status updated |
| `comment_added` | New comment on your project or report |

### 9.3 Notification Filters

On the full Notifications page:
- **Tabs:** All / Unread
- **Module filter:** Projects / Reports / Plans / Risks / Comments
- **Search:** Full-text search across notification messages
- **Mark as read:** Per-item or **Mark all read**
- **Pagination:** Load more button for older notifications

### 9.4 Notification Polling

The bell icon and messages dropdown poll automatically every **30 seconds** — no manual refresh needed.

### 9.5 Comments & Annotations

Comments can be added to any project or report from the **Comments** tab on the detail page.

**Comment types and who can post them:**

| Comment Type | Allowed Roles |
|---|---|
| `general` | All roles |
| `technical` | Technical Coordinator, Senior Coordinator, Program Manager |
| `required_correction` | Technical Coordinator, Senior Coordinator, Program Manager |
| `approval_note` | Senior Coordinator, Program Manager |
| `rejection_reason` | Senior Coordinator, Program Manager |
| `revision_request` | Senior Coordinator, Program Manager |
| `coordination` | Senior Coordinator, Program Manager |
| `observation` | All roles |

> **⚠️ Warning:** An open `required_correction` comment blocks the `final_approve` action on a project or plan. The approver must resolve the thread before proceeding.

---

## 10. Document Repository

### 10.1 Overview

Project documents are attached per-project through the **Documents** tab on the project detail page. Documents are stored in CAFA secure object storage (cloud-backed with presigned URL access).

### 10.2 Uploading Documents

1. Open a project detail page.
2. Click the **Documents** tab.
3. Click **Upload Document**.
4. Select a **Category** (e.g. Project Proposal, Donor Agreement, Completion Report, MOU, Other).
5. Select the file from your device.
6. Click **Upload**.

**Supported formats:** PDF, DOCX, XLSX, PNG, JPG  
**Max file size:** Determined by your browser and network — recommend under 50 MB per file.

> **💡 Tip:** Use descriptive file names before uploading — the original filename is preserved in the system and shown in document listings.

### 10.3 Downloading Documents

1. Navigate to the project → **Documents** tab.
2. Click the file name or the **Download** icon.
3. The browser will either open or download the file via a secure presigned URL.

> **⚠️ Warning:** Presigned download URLs expire after a short window (typically 15 minutes). If a download link fails, refresh the page and try again.

### 10.4 Deleting Documents

Only the original uploader or a Super Admin can delete a document:

1. Navigate to the project → **Documents** tab.
2. Click the **Delete** icon next to the document.
3. Confirm the deletion.

> **⚠️ Warning:** Deletion is permanent and is recorded in the Audit Log.

### 10.5 Document Permissions

| Action | Who Can Perform |
|---|---|
| Upload | Any user with `projects.edit` on the project |
| Download | Any user with project read access |
| Delete | Original uploader or Super Admin |
| View list | Any user with project access |

---

## 11. AI Assistant

### 11.1 Overview

The **AI Assistant** is a floating chat widget available to all authenticated users. It appears as a chat bubble in the bottom-right corner of every page.

Click the bubble to open the chat panel. Click the minimise button (−) to collapse it without losing your conversation history.

### 11.2 Available Functions

The AI Assistant can help with:

| Function | Examples |
|---|---|
| **System navigation** | "How do I submit a project?" / "Where do I find risks?" |
| **Role-specific guidance** | Adapts answers to your role and sector |
| **CAFA knowledge base** | Sudan programme context, sector definitions, reporting guidance |
| **Workflow explanation** | Approval chains, who approves what, what each status means |
| **Data queries** | "How many projects are active?" / "What is the risk level calculation?" |
| **Document help** | Upload instructions, supported formats, permissions |
| **Offline mode guidance** | How sync works, what to do when conflicts occur |
| **FAQ** | Quick answers to common system questions |

### 11.3 AI Assistant Controls

| Control | Function |
|---|---|
| **Send** button | Submit your message |
| **Quick prompts** | Clickable chips with common questions |
| **Stop** button | Cancel a streaming response in progress |
| **Clear history** | Wipe your conversation and start fresh |
| **Minimise** | Collapse the widget — conversation is preserved |

### 11.4 Admin Settings

> **Required roles:** Super Admin, Executive Director

Navigate to **Admin → AI Settings** (sidebar):

| Setting | Description |
|---|---|
| Enable / Disable | Toggle the assistant on or off for all users |
| Extra System Instructions | Inject additional context into the AI's system prompt |
| Response Language | `Auto` (matches user language) / English / Arabic |
| Usage Logs | View conversation logs; export as CSV |

> **⚠️ Warning:** Disabling the AI assistant removes the widget for all users immediately. Re-enabling restores it without data loss.

### 11.5 Privacy & Data

- Conversations are stored per-user in the CAFA database.
- Admins can view usage logs but not individual user messages through the standard UI.
- Conversation history is cleared when you click **Clear history** in the widget.
- AI responses are generated by an external language model — do not paste passwords, PII, or confidential donor agreements into the chat.

---

## 12. Users & Administration

### 12.1 Accessing User Management

Navigate to **Users** in the sidebar.

**Read access:** Program Manager and above  
**Write access:** Super Admin only

### 12.2 User List & Filters

The Users page shows a summary card strip (Total / Active / Invited / Suspended, breakdown by role and state) and a searchable, filterable table.

**Filters:**
- Search by name, email, or username
- Filter by role
- Filter by status
- Filter by state

### 12.3 Creating a User

1. Click **+ New User**.
2. Fill in:

| Field | Required | Notes |
|---|---|---|
| Full Name | ✅ | |
| Username | ✅ | Used for login |
| Email | ✅ | |
| Role | ✅ | Select from 7 roles |
| State | ✅ for state roles | Required for State Manager / State Officer |
| Sector | ✅ for TC | Multi-select; must be non-empty for Technical Coordinator |
| Status | ✅ | `Active` (with password) or `Invited` (sends invite link) |
| Password | If Active | Minimum 8 characters |

3. Click **Create User**.
4. If status = `Invited`: copy the invite link from the dialog and share it with the user.

### 12.4 Editing a User

1. Click the user row or the edit (✏️) icon.
2. Modify the required fields.
3. Click **Save**.

> **💡 Tip:** Changing a user's role to Technical Coordinator will require you to also assign at least one sector. The sector field appears automatically when the TC role is selected.

### 12.5 Role Assignments

Each role restricts access to specific data:

| Role | State Restriction | Sector Restriction |
|---|---|---|
| Super Admin | None | None |
| Executive Director | None | None |
| Program Manager | None | None |
| Senior Coordinator | None | None |
| Technical Coordinator | None | **Assigned sector(s) only** |
| State Manager | **Assigned state only** | None |
| State Officer | **Assigned state only** | None |

> **⚠️ Warning:** A Technical Coordinator with an empty sector assignment is **deny-all** — they will see no projects, reports, or risks. Always assign at least one sector when creating or editing a TC user.

### 12.6 Inviting Users

See [Section 2.3 — Invitation Flow](#23-invitation-flow).

**Resend Invite:** Row menu (⋮) → **Resend Invite** — generates a new 7-day token.  
**Cancel Invite:** Row menu (⋮) → **Cancel Invite** — invalidates the token immediately.

### 12.7 User Status Actions

| Status | Meaning | Available Actions |
|---|---|---|
| `active` | Can log in and use the system | Suspend / Deactivate |
| `invited` | Invite sent; awaiting acceptance | Resend Invite / Cancel Invite |
| `suspended` | Temporarily blocked | Activate |
| `inactive` | Not yet onboarded | Activate |
| `deactivated` | Permanently disabled | — |

> **⚠️ Warning:** Deactivating a user is not the same as deleting them. Their audit trail, comments, and work history are preserved. Deactivated accounts cannot log in and their username/email cannot be reused without re-activating first.

### 12.8 Deleting a User

1. Click the delete (🗑️) icon on the user row.
2. Confirm the deletion dialog.

> **⚠️ Warning:** User deletion permanently removes the account and may affect audit log records. Prefer **Deactivate** over delete for staff who have left.

---

## 13. Offline / PWA Mode

### 13.1 What is Offline Mode?

CAFA PMIS is a **Progressive Web App (PWA)** — it works in areas with poor or no internet connectivity. The offline layer automatically:

- Caches API responses for read access when offline
- Queues mutations (creates, edits) to replay when connectivity returns
- Shows a clear status indicator so you always know the sync state

### 13.2 Installing CAFA PMIS on Your Device

**On Android (Chrome):**
1. Open CAFA PMIS in Chrome.
2. Tap the three-dot menu → **Add to Home Screen**.
3. Confirm → the app icon appears on your home screen.
4. Open the app from the icon — it runs in standalone mode (no browser chrome).

**On iOS (Safari):**
1. Open CAFA PMIS in Safari.
2. Tap the **Share** button (square with arrow).
3. Tap **Add to Home Screen**.
4. Confirm → the app icon appears on your home screen.

> **💡 Tip:** The PWA installed from the home screen loads faster, uses less data, and works offline. It is the recommended way to use CAFA PMIS in the field.

### 13.3 How Offline Mode Works

When your device goes offline, CAFA PMIS:

1. **Detects loss of connectivity** — via a probe to `/api/healthz` (not just the browser's `navigator.onLine`, which is unreliable in some network configurations)
2. **Shows the offline indicator** — a banner appears below the top navigation bar
3. **Serves cached data** — read requests (GET) are answered from the local Dexie (IndexedDB) cache
4. **Queues writes** — create/edit/delete actions are stored in the sync queue

**What you can do offline:**
- Browse all previously loaded projects, reports, risks, plans, and users
- Draft new records (they will be queued for sync)
- View your notifications and messages
- Use the AI assistant (limited — requires connectivity for AI responses)

**What requires connectivity:**
- Final approval transitions on projects and reports
- User management actions (create, edit, delete users)
- File uploads and downloads
- Budget management
- Invitation management

### 13.4 Offline Status Indicator

The offline banner at the top of the screen shows 5 states:

| State | Indicator | Meaning |
|---|---|---|
| **Online** | Hidden | All good — no indicator shown |
| **Syncing** | 🔄 Blue | Replaying queued items |
| **Pending** | 🟡 Amber | Items in queue waiting to sync |
| **Failed / Conflict** | 🔴 Red | Some items failed or conflicted |
| **Offline** | ⬤ Grey | No network connectivity |

Click the indicator (or navigate to **Sync Status** from the sidebar) for a detailed view of every queued item.

### 13.5 Synchronisation

When connectivity is restored, CAFA PMIS:

1. **Detects reconnection** — via a periodic 30-second probe
2. **Processes the sync queue** — items replayed in FIFO (first-in-first-out) order
3. **Sends idempotency keys** — prevents duplicate submissions if the network drops mid-sync
4. **Retries failures** — up to 3 automatic retries before marking an item `failed`
5. **Notifies you** — status badges update in real-time

> **💡 Tip:** After returning to connectivity, wait 30–60 seconds for the sync probe to detect it. You can also manually trigger sync from the **Sync Status** page.

### 13.6 Conflict Resolution

A **conflict** occurs when the server's version of a record has been modified by someone else since you last loaded it.

**To resolve a conflict:**

1. Navigate to the **Sync Status** page (sidebar or click the red offline indicator).
2. Find the item showing **Conflict**.
3. Click **View Conflict** — a side-by-side panel shows your local version vs the current server version with field-level diff highlighting.
4. Choose:
   - **Keep Mine** — discard server changes and apply your version
   - **Accept Server Version** — discard your local changes

> **⚠️ Warning:** Conflict resolution is permanent — once you choose, the discarded version is gone. When in doubt, screenshot both versions before choosing.

### 13.7 Storage Quota

CAFA PMIS monitors how much local device storage it is using. If usage reaches:

- **80%** — an amber warning toast appears
- **95%** — a red critical toast appears

To free space: clear resolved sync items from the **Sync Status** page, or log out (which clears all local data).

---

## 14. Security

### 14.1 Access Control

All routes require authentication. Unauthenticated requests receive a `401 Unauthorized` response before any other processing occurs.

Every action is validated against the user's role permissions server-side — the UI access restrictions are reinforced at the API level.

### 14.2 Role-Based Permissions

Permissions are expressed as dot-namespaced strings (e.g. `projects.create`, `reports.approve.final`). The permission set is computed from the user's `role` field.

| Permission | Who Has It |
|---|---|
| `*` (all) | Super Admin |
| `projects.create` | State Officer and above |
| `projects.approve.technical` | Technical Coordinator |
| `projects.approve.coordination` | Senior Coordinator |
| `projects.approve.final` | Program Manager |
| `reports.approve.coordination` | Senior Coordinator |
| `reports.approve.final` | Program Manager |
| `risks.create` | Technical Coordinator and above |
| `users.view` | Program Manager and above |
| `users.manage` | Super Admin only |
| `ai.settings` | Super Admin, Executive Director |

### 14.3 Sector-Based Restrictions (Technical Coordinator)

Technical Coordinators see only records in their assigned sector(s). This restriction is enforced at both the list-query level (SQL WHERE clause) and the detail-endpoint level.

**Fail-closed:** A TC with an empty sector list is denied access to all project/report/risk data until at least one sector is assigned.

### 14.4 State-Based Restrictions (State Roles)

State Managers and State Officers are restricted to data in their assigned state for most actions. HQ-level list views (projects, reports, risks) do not yet apply a state filter — state restriction is enforced on creation and detail/mutation endpoints.

### 14.5 Session Security

| Mechanism | Detail |
|---|---|
| Session cookie | `cafa_sid` — `httpOnly`, `sameSite=lax`, `secure` in production |
| Session signing | HMAC-signed with `SESSION_SECRET` from environment |
| Session duration | 8 h standard / 30 d "remember me" |
| Login rejection | Non-active accounts receive a generic `invalid_credentials` error — account status is not disclosed |
| Audit logging | Every mutating API action is logged with before/after snapshots to the `audit_log` table |

### 14.6 Data Protection

| Area | Protection |
|---|---|
| Passwords | Hashed with bcryptjs (no plaintext storage) |
| Documents | Stored in private object storage; accessed via presigned URLs |
| Sensitive endpoints | Excluded from the offline cache (`/api/users`, `/api/audit-log`, `/api/budget`) |
| Audit log | Immutable append-only log; visible to Super Admin |
| Cross-user data | Offline cache entries are user-keyed; data from user A is never served to user B |

### 14.7 Idempotency & Replay Safety

Every queued sync item carries a unique **client ID**. The server records this ID in the `idempotency_log` table for 24 hours. Duplicate replays (e.g. from a flaky network) are detected and the cached response is returned — the underlying mutation is **not** applied twice.

---

## 15. Troubleshooting

### 15.1 Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| Page shows blank / white screen | JavaScript error | Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) |
| Data not updating | Browser cache | Hard-refresh or clear site data |
| Cannot see some projects/reports | Role/sector restriction | Contact your Super Admin to verify permissions |
| Action buttons missing | Insufficient permissions | Your role does not have this permission — contact admin |
| Export CSV downloads empty file | No results match current filters | Clear filters and try again |

### 15.2 Login Issues

| Symptom | Fix |
|---|---|
| `invalid_credentials` error | Check username/email and password; account may be suspended — contact admin |
| Invite link says "expired" | Ask admin to use **Resend Invite** to generate a fresh 7-day link |
| Invite link says "already used" | Your account is already active — try logging in normally |
| Session keeps expiring | Check if "Remember me" was ticked; your IT team may block persistent cookies |

### 15.3 Offline / Sync Issues

| Symptom | Fix |
|---|---|
| Sync queue stuck on "Syncing" | Navigate to Sync Status → use **Retry All** |
| Item shows "Failed" after 3 retries | Open the item detail — check the error message; may need to re-enter manually |
| Conflict appearing unexpectedly | Another user edited the same record — use the conflict panel to review and resolve |
| Storage quota warning | Go to Sync Status → clear completed items; or log out and back in |
| Offline banner not disappearing | Connectivity probe takes up to 30 s to detect reconnection; wait or manually trigger sync |

### 15.4 Notification Issues

| Symptom | Fix |
|---|---|
| Not receiving notifications for your project | Verify you are assigned to the project (Role Assignments tab) |
| Notification count stuck | Hard-refresh the page — notification poll runs every 30 s |
| Old notifications not clearing | Use **Mark all read** on the Notifications page |
| Approver not notified | Check that the next approver's account is `active` and has the correct role |

### 15.5 Mobile / PWA Issues

| Symptom | Fix |
|---|---|
| App not working after installation | Clear the app data in device Settings → Apps → CAFA PMIS → Clear Data |
| Splash screen stuck on first launch | Force-close the app and reopen; wait up to 10 s on first load |
| Changes not syncing on mobile | Check device internet connection; open the app and wait 60 s for the sync probe |
| App asking to install again | The service worker may have been cleared — reinstall from the browser |

---

## 16. Frequently Asked Questions

**Q: What do I do if my project was rejected?**  
A: Open the project detail page → go to the **Comments** tab to read the rejection reason left by the approver. Make the requested changes → click **Resubmit**. The project returns to the beginning of the approval chain.

**Q: Can I edit a project after it has been approved?**  
A: Yes, most fields can still be edited. However, budget and sector changes on an approved project should be discussed with the Program Manager first. All changes are logged in the Audit Log.

**Q: How do I know which step my project is at in the approval chain?**  
A: The project detail page shows the current status and the full approval chain timeline. Each step shows who took the action and when.

**Q: Why can I not see some projects?**  
A: If you are a Technical Coordinator, you only see projects in your assigned sector. If you are a State role, you see projects in your assigned state. Contact your Super Admin if you believe you should have broader access.

**Q: What is the difference between "Suspend" and "Deactivate" for a user?**  
A: **Suspend** is temporary — the account is blocked but can be re-activated. **Deactivate** is a longer-term action indicating the user has left. Both preserve audit history. Neither deletes the account.

**Q: How long does offline data last before it is cleared?**  
A: Cached API responses have a 24-hour TTL. Stale entries are cleaned up automatically on app start. Sync queue items remain until successfully synced, manually cleared, or you log out.

**Q: What happens if I lose connectivity during an approval action?**  
A: Approval transitions (submit, approve, reject) are blocked offline for safety — they will not be queued. Wait until connectivity is restored to perform approval actions.

**Q: Can two people edit the same project at the same time?**  
A: Yes, but the second save will trigger a **conflict** when synced. Use the conflict resolution panel to compare and choose the correct version.

**Q: How do I install CAFA PMIS on my phone?**  
A: See [Section 13.2 — Installing CAFA PMIS on Your Device](#132-installing-cafa-pmis-on-your-device).

**Q: Why is the AI Assistant not available?**  
A: Your Super Admin may have disabled it. Contact them to re-enable. If you see the widget but get an error, check your internet connectivity — the AI requires an active connection.

**Q: Who do I contact for technical support?**  
A: Contact your organisation's CAFA PMIS system administrator (Super Admin role). For infrastructure issues (server down, database errors), escalate to the CAFA IT team.

---

## Validation Checklist

### Active Modules — All Documented

| Module | Sidebar Entry | Documented | Status |
|---|---|---|---|
| Dashboard | Dashboard | ✅ Section 3 | Active |
| Projects | Projects | ✅ Section 4 | Active |
| Planning | Planning | ✅ Section 5 | Active |
| Planning Dashboard | Planning → Planning Dashboard | ✅ Section 5.4 | Active |
| Action Plans | Planning → Action Plans | ✅ Section 5.1 | Active |
| Budget | Budget | ✅ Section 6 | Active |
| Risks | Risks | ✅ Section 7 | Active |
| Reports — Project | Reports → Project Reports | ✅ Section 8 | Active |
| Reports — HQ Sector | Reports → HQ Sector Reports | ✅ Section 8 | Active |
| Reports — State | Reports → State Program Reports | ✅ Section 8 | Active |
| Messages / Communication | Messages (topbar + sidebar) | ✅ Section 9 | Active |
| Notifications | Bell icon + /notifications | ✅ Section 9 | Active |
| Document Repository | Project → Documents tab | ✅ Section 10 | Active |
| AI Assistant | Chat widget (all pages) | ✅ Section 11 | Active |
| AI Settings | Admin → AI Settings | ✅ Section 11.4 | Active |
| Users | Users | ✅ Section 12 | Active |
| System Manual | Resources → System Manual | ✅ This document | Active |
| Audit Log | Admin → Audit Log | ✅ Section 14.4 | Active |
| Offline / Sync | Sync Status | ✅ Section 13 | Active |

### Obsolete Modules — None Present

No obsolete modules (field_officer, community_mobilizer, budget_controller, old sector groups) appear in the active UI or documentation.

### Role Names — Production Verified

✅ super_admin · executive_director · program_manager · senior_coordinator · technical_coordinator · state_manager · state_officer

### Sector Names — Production Verified

✅ Health · WASH · Protection · Education · MPCA / Cash Assistance · Food Security & Livelihoods · Agriculture & Livelihoods · Nutrition · Shelter / NFI

---

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ✅  SYSTEM MANUAL COMPLETE                                     ║
║   ✅  READY FOR USER TRAINING                                    ║
║                                                                  ║
║   Chapters: 16   Modules documented: 19   Obsolete: 0          ║
║   Role names verified · Sector names verified                    ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```
