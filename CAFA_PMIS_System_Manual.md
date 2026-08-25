# CAFA PMIS — System Manual
## Children & Adolescents Foundation Africa
### Program Management Information System
#### Version 1.0 | Sudan Operations | 2026

---

> **Prepared for:** All CAFA staff at Headquarters and State Offices  
> **Classification:** Internal Operational Document  
> **Language:** English (Arabic labels included where applicable)

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Dashboard](#3-dashboard)
4. [Projects Module](#4-projects-module)
5. [Planning / Action Plan Module](#5-planning--action-plan-module)
6. [Reports Module](#6-reports-module)
7. [Budget & Finance Tracking](#7-budget--finance-tracking)
8. [Risk Management Module](#8-risk-management-module)
9. [Communication Module](#9-communication-module)
10. [Notifications](#10-notifications)
11. [Approvals Workflow](#11-approvals-workflow)
12. [Documents & Attachments](#12-documents--attachments)
13. [Search, Filters & Export](#13-search-filters--export)
14. [User Management & Admin Settings](#14-user-management--admin-settings)
15. [Data Quality Rules](#15-data-quality-rules)
16. [Standard Operating Procedures](#16-standard-operating-procedures)
17. [Troubleshooting](#17-troubleshooting)
18. [Annexes](#18-annexes)

---

## 1. Introduction

### 1.1 Purpose of the System

The **CAFA Program Management Information System (PMIS)** is a centralised, web-based platform built to support the operational and programmatic work of the Children & Adolescents Foundation Africa (CAFA) across its 15 state offices in Sudan. The system replaces fragmented spreadsheet-based tracking and email-driven approvals with a unified, auditable, and role-secured digital environment.

The PMIS enables CAFA to:

- Register, monitor, and close projects across all sectors and donor mandates
- Submit, review, and approve programmatic and financial reports through a structured multi-stage workflow
- Plan activities at monthly, quarterly, and annual levels and track implementation progress
- Manage budgets and track planned versus actual expenditure
- Identify, log, and mitigate programmatic and operational risks
- Communicate across teams via a built-in messaging system
- Maintain a full audit trail of every action taken on any record

### 1.2 Target Users

| User Group | Location | Primary Use |
|---|---|---|
| Program Manager | HQ – Khartoum | Oversight, final approvals, strategic reporting |
| Senior Program Coordinator | HQ | Coordination approvals, plan review |
| Technical Coordinators (TC) | HQ – by sector | Sector-level review, technical approval |
| State Program Officers (SPO) | State Offices (18 states) | Data entry, report submission, planning |
| Executive Director | HQ | Read-only executive oversight |
| Super Admin | HQ – IT/Admin | System configuration, user management |

### 1.3 System Scope

The PMIS covers the following operational areas:

- **15 Sudanese States** with locality-level data granularity
- **11 Sectors**: WASH, Health, Protection, Child Protection, GBV, Education, Livelihoods, MPCA, Nutrition, Shelter/NFI, Multi-Sector
- **Project lifecycle**: registration → submission → approval → activation → closure
- **Reporting**: Project reports, HQ Sector reports, Program State reports
- **Planning**: Monthly, Quarterly, Annual, Action, Operational, Emergency plans
- **Finance**: Budget tracking at project and activity levels
- **Risk management**: Heatmap-based risk register
- **Communication**: Internal messaging across teams and projects

### 1.4 Key Principles

| Principle | Application in PMIS |
|---|---|
| **Accountability** | Every create/edit/approve action is logged in the audit trail with the user, timestamp, and before/after values |
| **Transparency** | Approval chain status is visible to all participants; rejection reasons are recorded |
| **Data Quality** | Mandatory field validation, duplicate prevention, and review responsibilities are enforced by the system |
| **Role-Based Access** | Every user sees and can act only on what their role permits; Technical Coordinators are sector-restricted |

---

## 2. User Roles & Permissions

The PMIS uses seven active roles. Role assignment is managed by the Super Admin and cannot be self-selected.

### 2.1 Role Summary

| Role (EN) | Role (AR) | Abbreviation |
|---|---|---|
| Super Admin | مدير النظام | SA |
| Executive Director | المدير التنفيذي | ED |
| Program Manager | مدير البرنامج | PM |
| Senior Program Coordinator | المنسق الأول للبرنامج | SPC |
| Technical Coordinator | المنسق التقني | TC |
| State Program Officer | مسؤول برنامج الولاية | SPO |
| State Manager | مدير مكتب الولاية | SM |

### 2.2 Detailed Permissions by Module

#### Projects

| Action | SA | ED | PM | SPC | TC | SPO | SM |
|---|---|---|---|---|---|---|---|
| View all projects | ✓ | ✓ | ✓ | ✓ | Sector only | Own state | ✓ |
| Create project | ✓ | — | ✓ | ✓ | — | ✓ | — |
| Edit draft project | ✓ | — | ✓ | ✓ | — | ✓ | — |
| Submit for approval | ✓ | — | ✓ | ✓ | — | ✓ | — |
| Technical approve | ✓ | — | — | — | ✓ | — | — |
| Coordination approve | ✓ | — | — | ✓ | — | — | — |
| Final approve | ✓ | — | ✓ | — | — | — | — |
| Activate project | ✓ | — | ✓ | — | — | — | — |
| Close project | ✓ | — | ✓ | — | — | — | — |
| Delete project | ✓ | — | — | — | — | — | — |
| Upload documents | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export data | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

#### Reports

| Action | SA | ED | PM | SPC | TC | SPO | SM |
|---|---|---|---|---|---|---|---|
| View all reports | ✓ | ✓ | ✓ | ✓ | Sector only | Own state | ✓ |
| Create / submit report | ✓ | — | — | ✓ | ✓ | ✓ | — |
| Coordination approve | ✓ | — | — | ✓ | — | — | — |
| Final approve | ✓ | — | ✓ | — | — | — | — |
| Archive report | ✓ | — | ✓ | — | — | — | — |
| Request revision | ✓ | — | ✓ | ✓ | ✓ | — | — |
| Export CSV | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

#### Plans

| Action | SA | ED | PM | SPC | TC | SPO | SM |
|---|---|---|---|---|---|---|---|
| View plans | ✓ | ✓ | ✓ | ✓ | Sector only | Own state | ✓ |
| Create / edit plan | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| Submit plan | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| Technical approve | ✓ | — | — | — | ✓ | — | — |
| Coordination approve | ✓ | — | — | ✓ | — | — | — |
| Final approve | ✓ | — | ✓ | — | — | — | — |
| Activate / mark in progress | ✓ | — | ✓ | — | — | — | — |

#### Users (Administration)

| Action | SA | All Others |
|---|---|---|
| View user list | ✓ | PM (read only) |
| Create user / send invite | ✓ | — |
| Edit user profile | ✓ | — |
| Reset password | ✓ | — |
| Suspend / deactivate | ✓ | — |
| Delete user | ✓ | — |

### 2.3 Technical Coordinator Sector Restriction

Technical Coordinators are assigned to one or more sectors (e.g., WASH, Health, Protection). The PMIS enforces this restriction automatically:

- TC users **only see** projects, reports, risks, and plans belonging to their assigned sector(s)
- Attempting to access a record in an unassigned sector returns a `403 Forbidden` error
- This restriction is **fail-closed**: a TC with no sector assignment has access to nothing
- Sector assignment is managed by the Super Admin in the User Management module

---

## 3. Dashboard

The Dashboard (`/`) is the first screen after login. It provides a real-time overview of program status.

### 3.1 Summary Cards

| Card | Data Source | Who Sees It |
|---|---|---|
| Total Projects | Count of all active projects | All roles |
| Active Projects | Projects with status `active` | All roles |
| Total Beneficiaries | Aggregated from project forms | All roles |
| Total Budget (USD) | Sum of approved project budgets | PM, SPC, SA, ED |

Clicking **Total Beneficiaries** opens a breakdown modal showing:
- Male adults / Female adults / Boys / Girls
- By beneficiary category: IDP, Returnee, Host Community, Refugee

### 3.2 Project Status Overview

A status distribution view shows the count of projects across workflow stages:
- Draft · Submitted · Technically Approved · Coordination Approved · Approved · Active · Closed

### 3.3 Budget Overview

Shows planned vs. actual expenditure across all active projects, displayed as a bar chart by sector.

### 3.4 State Performance Map

An interactive list of the 15 operational states, each showing:
- Number of active projects
- Beneficiary count
- Budget utilisation
- Clicking a state navigates to the State Detail page

### 3.5 Recent Activity Feed

The last 20 system actions (project status changes, report submissions, approvals, etc.) relevant to the logged-in user's role and sector.

### 3.6 Notifications Panel

A summary of unread notifications with a link to the full Notifications inbox. The notification bell in the top navigation bar shows the unread count.

---

## 4. Projects Module

### 4.1 Navigating to Projects

From the sidebar: **Projects** → `/projects`

The list page shows all projects the user has permission to view, with:
- Project code (e.g., `CAFA-KHR-001`)
- Title, sector, state(s), management level
- Current workflow status with colour-coded badge
- Budget total and currency
- Start/end dates
- Quick action buttons (View, Continue workflow)

### 4.2 Creating a New Project

**Step 1 — Basics**

| Field | Required | Notes |
|---|---|---|
| Project Title | ✓ | Maximum 200 characters |
| Description | ✓ | Free text |
| Donor | ✓ | Text field |
| Sector | ✓ | Select from 11 CAFA sectors |
| Start Date | ✓ | ISO date |
| End Date | ✓ | Must be after start date |
| Status | Auto | System sets to `draft` on creation |

**Step 2 — Management Level**

Select whether the project is:
- **HQ Managed** (`hq_managed`): Managed from Khartoum headquarters
- **State Managed** (`state_managed`): Managed from a specific state office

> Note: Management level affects the approval workflow. State-managed projects follow a slightly longer chain.

**Step 3 — Geography**

- Select the primary **State** (required)
- Add additional states if the project operates across multiple states
- For each state, select the relevant **Localities**

**Step 4 — Project Code**

The system auto-generates a unique project code in the format:  
`CAFA-{STATE_CODE}-{NNN}`  
where `STATE_CODE` is the two/three-letter state abbreviation and `NNN` is a zero-padded sequential number.  
Example: `CAFA-KHR-003` (Third project registered in Khartoum).

**Step 5 — Role Assignments**

Assign specific CAFA staff to the project:

| Role | Description |
|---|---|
| Project Lead | Primary responsible person |
| Focal Point | State-level contact |
| Finance Officer | Budget tracking responsibility |
| M&E Officer | Monitoring and reporting |

**Step 6 — Beneficiary Targets**

Enter planned beneficiary counts by category:

| Column | Field |
|---|---|
| IDP | Males, Females, Boys, Girls |
| Returnee | Males, Females, Boys, Girls |
| Host Community | Males, Females, Boys, Girls |
| Refugee | Males, Females, Boys, Girls |

Totals are calculated automatically.

**Step 7 — Budget & Currency**

- Select currency: **USD** or **SDG**
- Enter the total approved budget (`Budget Total`)
- Budget breakdown by output is added in the Outputs section

**Step 8 — Outputs, Activities & Indicators**

For each project output:
1. Enter the output title and description
2. Add activities under the output (with responsible staff and timeline)
3. Add indicators with baseline, target, and unit of measure

**Step 9 — Documents**

Upload signed project documents (MoU, grant agreement, MEAL framework, etc.):
- Accepted formats: PDF, DOCX, XLSX, JPG, PNG (max 50 MB per file)
- Documents are stored in object storage and linked to the project record
- Each document shows uploader name, upload date, and file size

**Step 10 — Save & Submit**

- **Save as Draft**: Saves progress without submitting
- **Submit for Review**: Moves the project to `submitted` status and triggers notifications to the Technical Coordinator(s) for the project's sector

### 4.3 Project Approval Workflow

```
Draft → Submitted → Technically Approved → Coordination Approved → Approved → Active → Closed
```

| Stage | Transition | Responsible Role | System Action |
|---|---|---|---|
| Draft | `submit` | SPO / SPC / PM | Notifies TC(s) for project sector |
| Submitted | `technically_approve` | Technical Coordinator | Notifies SPC |
| Technically Approved | `coordination_approve` | Senior Program Coordinator | Notifies PM |
| Coordination Approved | `approve` | Program Manager | Notifies project team |
| Approved | `activate` | Program Manager | Project becomes active |
| Active | `close` | Program Manager | Project is closed |

**Rejection / Revision Request** (available at any stage):
- Reviewer clicks **Request Revision** or **Reject**
- Must enter a reason (becomes a comment of type `rejection_reason` or `revision_request`)
- Project returns to the previous stage
- Submitter receives a notification with the reason

> **Important**: Final approval (`approve`) is blocked if any open **Required Correction** comments exist on the project. These must be resolved before the approval button becomes active.

### 4.4 Project Detail Page

The project detail page (`/projects/:id`) displays all project information in collapsible sections:
- Basics · Geography · Assignments · Beneficiaries · Budget · Outputs/Activities/Indicators · Documents · Comments · Workflow History · Audit Log

### 4.5 Project Closure

Before closing a project, ensure:
- All reports for the project period are submitted and approved
- Final financial reconciliation is recorded
- Closure documentation is uploaded to the Documents section
- The Program Manager executes the `close` transition

---

## 5. Planning / Action Plan Module

### 5.1 Plan Types

| Type | Typical Cadence | Purpose |
|---|---|---|
| Monthly | Every month | Detailed activity schedule for the month |
| Quarterly | Every 3 months | Programme-level planning and review |
| Annual | Once per year | Strategic annual work plan |
| Action Plan | As needed | Specific response or project action plan |
| Operational | As needed | Operational logistics planning |
| Emergency | As needed | Rapid-onset emergency response |

### 5.2 Navigating to Plans

From the sidebar:
- **Planning → Plans** (`/plans`) — All plan types
- **Planning → Action Plans** (`/plans/action`) — Action Plans only
- **Planning → Planning Dashboard** (`/planning-dashboard`) — Aggregated KPIs

### 5.3 Creating a Plan

> **Important**: Plans use a single route `/plans/:planId` where `planId = "new"` triggers create mode.

**Required Fields:**

| Field | Notes |
|---|---|
| Plan Type | Select from 6 types |
| Title | Descriptive name |
| Sector | Restricts visibility for TC users |
| State | Linked state office |
| Start Date / End Date | Planning period |
| Project Link | Optional – link to an existing project |
| Objectives | Add one or more objectives as JSON |
| Budget (Planned) | Overall planned budget |
| Currency | USD or SDG |

**Plan Code**: Auto-generated as `CAFA-PLAN-{STATE_CODE}-{NNN}` (race-safe with retry on conflict).

### 5.4 Plan Activities

Each plan can have multiple activities:

| Field | Notes |
|---|---|
| Activity Title | Description of what will be done |
| Output | Link to a project output (optional) |
| Responsible Staff | Assigned CAFA staff member |
| Start / End Date | Activity timeline |
| Location | State + Locality |
| Budget Planned | Budget for this activity |
| Budget Actual | Updated as implementation proceeds |
| Progress % | 0–100 |
| Status | Planned / In Progress / Completed / Delayed / Cancelled |
| Risk Link | Link to a risk record (optional) |
| Notes | Free text |

### 5.5 Plan Approval Workflow

```
Draft → Submitted → Technically Approved → Coordination Approved → Approved → Active → In Progress → Completed/Delayed → Archived
```

Additional transitions: `reject`, `request_revision`, `cancel`

| Stage | Responsible Role |
|---|---|
| Submit | SPO / TC / SPC / PM |
| Technical Approve | Technical Coordinator (sector-restricted) |
| Coordination Approve | Senior Program Coordinator |
| Final Approve | Program Manager |
| Activate → In Progress | Program Manager |

> **Final approval is blocked** if unresolved Required Correction comments exist on the plan.

### 5.6 Linking Plans to Risks

Activities within a plan can be linked to risk records. This linkage:
- Appears on both the Plan Activity and the Risk record
- Allows tracking whether mitigation activities are on schedule
- Helps report on risk response progress

---

## 6. Reports Module

### 6.1 Report Types

| Type | Audience | Cadence |
|---|---|---|
| Project Report | Donor / PM | Monthly / Quarterly |
| HQ Sector Report | Program Manager / ED | Monthly |
| Program State Report | HQ | Monthly |

### 6.2 Navigating to Reports

From the sidebar:
- **Reports → Project Reports** (`/reports/project`)
- **Reports → HQ Sector Reports** (`/reports/hq-sector`)
- **Reports → Program State Reports** (`/reports/program-state`)

Each page shows a filtered list of reports for that type.

### 6.3 Report Sections

All report types share a common structure:

| Section | Content |
|---|---|
| **Section 1** — Cover | Report type, period, state/sector, submitter |
| **Section 2** — Progress Narrative | Free-text narrative on achievements vs. plan |
| **Section 3** — Activities Implemented | Repeating table of activities (see 6.4) |
| **Section 4** — Challenges & Constraints | Free-text narrative |
| **Reference Card** | Auto-pulled project data (read-only reference) |

### 6.4 Section 3 — Activities Implemented

| Field | Project Report | HQ Sector Report | Program State Report |
|---|---|---|---|
| Activity Name | ✓ | ✓ | ✓ |
| Output / Outcome | ✓ | ✓ | ✓ |
| Milestone | ✓ | ✓ | ✓ |
| Status | ✓ | ✓ | ✓ |
| Progress % | ✓ | ✓ | ✓ |
| Budget (Planned / Actual) | ✓ | — | — |
| Beneficiaries (M/F/B/G) | ✓ | ✓ | ✓ |
| Related Project | — | ✓ | ✓ |
| State | — | ✓ | — |
| Sector | — | — | ✓ |

Activity status options: **Planned · In Progress · Completed · Delayed · Cancelled**

### 6.5 Beneficiary Entry

Beneficiary numbers are entered manually per report:
- Male Adults (رجال) | Female Adults (نساء) | Boys (أولاد) | Girls (بنات)
- Total is calculated automatically
- For **Project Reports** only: Planned budget + Actual budget → system calculates Remaining and Burn %

### 6.6 Submitting a Report

1. Click **New Report** from the report list page
2. Fill in all required sections
3. Click **Submit Report** — this creates the report AND immediately fires the `submit` transition (no two-step process)
4. A notification is sent to the Senior Program Coordinator

> Note: **Save as Draft** is available to save progress without submitting.

### 6.7 Report Approval Workflow

```
Draft → Submitted → Coordination Approved → Approved (→ Archived)
```

| Stage | Responsible | Notification Sent To |
|---|---|---|
| Submit | SPO / TC / SPC | Senior Program Coordinator |
| Coordination Approve | SPC | Program Manager |
| Final Approve | Program Manager | Submitter + Team |
| Archive | PM / SA | — |

**Rejection / Revision Request**:
- Reviewer clicks **Return for Revision**
- Enters mandatory reason
- Report returns to `draft` (or `submitted` depending on stage)
- Submitter notified with reason

### 6.8 Export

Each report list page includes an **Export CSV** button that downloads all visible (filtered) reports as a spreadsheet.

---

## 7. Budget & Finance Tracking

### 7.1 Budget Setup

Project budgets are established during project registration:
- **Budget Total**: Total approved funding for the project
- **Currency**: USD or SDG
- Activity-level budgets are entered in the plan/activity module

### 7.2 Budget Tracking in Reports

Project Reports (Section 3) capture:
- **Planned Budget**: Amount budgeted for each activity
- **Actual Budget**: Amount spent as of the reporting period
- **Remaining**: Auto-calculated (Planned − Actual)
- **Burn %**: Auto-calculated (Actual ÷ Planned × 100)

### 7.3 Budget Overview on Dashboard

The dashboard **Budget Overview** widget shows:
- Total planned budget across all active projects
- Total actual expenditure reported to date
- Variance (planned minus actual)
- Burn rate by sector

### 7.4 Viewing State-Level Budget Data

From the sidebar: **States → [State Name]** → Budget section shows all project budgets for that state.

---

## 8. Risk Management Module

### 8.1 Navigating to Risks

From the sidebar: **Risks** (`/risks`)

### 8.2 Creating a Risk

| Field | Required | Options |
|---|---|---|
| Title | ✓ | Free text |
| Description | ✓ | Free text |
| Category | ✓ | Operational / Security / Financial / Programmatic / Environmental |
| Likelihood | ✓ | Low / Medium / High |
| Impact | ✓ | Low / Medium / High (Critical accepted as High) |
| Risk Score | Auto | Likelihood × Impact (1–9) |
| Severity | Auto | Low (1) / Medium (2–5) / High (6–8) / Critical (9) |
| Mitigation Measures | ✓ | Free text – what actions will reduce the risk |
| Risk Owner | ✓ | Assigned CAFA staff member |
| Status | ✓ | Open / Monitoring / Mitigating / Closed |
| Project Link | Optional | Link to an existing project |
| Plan / Activity Link | Optional | Link to a plan activity |
| State | Optional | Relevant state |

### 8.3 Risk Heatmap

The risk list page displays a **3×3 matrix** showing risk distribution by likelihood and impact. Click any cell to filter the list to risks in that zone.

### 8.4 Risk Severity Colour Coding

| Score | Label | Colour |
|---|---|---|
| 1 | Low | Green |
| 2–5 | Medium | Yellow |
| 6–8 | High | Orange |
| 9 | Critical | Red |

### 8.5 Sector Restriction for TC Users

Technical Coordinators can only view and manage risks linked to projects within their assigned sectors. Risks with no project link are not visible to TC users.

---

## 9. Communication Module

### 9.1 Overview

The PMIS includes a built-in messaging system accessible from the sidebar under **Communication → Messages** (`/messages`). The interface is a two-pane design:
- **Left pane**: Conversation list with search and filter tabs
- **Right pane**: Chat window for the selected conversation

### 9.2 Conversation Types

| Type | Arabic | Purpose |
|---|---|---|
| Direct | محادثة مباشرة | One-to-one private message between two users |
| Group | مجموعة | Custom group chat with selected members |
| Project | مجموعة المشروع | All staff assigned to a specific project |
| State | مجموعة الولاية | All staff in a specific state office |
| Sector | مجموعة القطاع | All staff in a specific sector team |

### 9.3 Starting a Conversation

1. Click **New Chat** (top of the conversation list)
2. Select the conversation **Type**
3. For group/project/state/sector chats: enter a **Name**
4. Use the **member search** to find and add staff
5. Click **Start Conversation**

### 9.4 Sending Messages

- Type your message in the input bar at the bottom of the chat window
- Press **Enter** to send, or **Shift+Enter** for a new line
- Click the **📎 (paperclip)** icon to attach files (uploaded via secure presigned URL)
- Accepted attachments: images, PDF, DOCX, XLSX, and other common formats

### 9.5 Message Features

| Feature | How to Use |
|---|---|
| **Reply** | Hover over a message → click ⋮ → Reply. The quoted message appears above your input |
| **Edit** | Hover → ⋮ → Edit (own messages only). The message shows "edited" after saving |
| **Delete** | Hover → ⋮ → Delete (own messages only). Shows "🚫 This message was deleted" |
| **File Attachment** | Click the paperclip icon, select files |

### 9.6 Conversation Filters

Use the tabs at the top of the conversation list to filter:
- **All** — All conversations
- **Unread** — Conversations with unread messages
- **Direct** — One-to-one messages only
- **Projects** — Project group chats
- **States** — State office chats
- **Sectors** — Sector team chats

### 9.7 Unread Badge

The Messages icon in the top navigation bar shows the total number of conversations with unread messages.

### 9.8 File Sharing Rules

- Maximum file size: 50 MB per attachment
- Files are stored in secure object storage
- Links expire after 7 days for non-authenticated access (internal links remain permanent)

### 9.9 Communication Rules & Etiquette

1. Use the PMIS messaging system for all project-related communication to maintain a traceable record
2. Direct messages are private between sender and recipient
3. Group/project/state chats are visible to all members
4. Do not share personal data, passwords, or sensitive financial information via messages
5. For urgent matters requiring response within 2 hours, also notify the recipient by phone

---

## 10. Notifications

### 10.1 Notification Bell

The 🔔 bell icon in the top navigation bar shows the count of unread notifications. The count refreshes every 30 seconds.

### 10.2 Notification Types

| Trigger | Recipients | Message Template |
|---|---|---|
| Project submitted | TC(s) for the project sector | "New project [CODE] awaiting technical review" |
| Project technically approved | SPC | "Project [CODE] has passed technical review" |
| Project coordination approved | PM | "Project [CODE] awaiting your final approval" |
| Project approved | Submitter + Assignees | "Project [CODE] has been approved" |
| Project activated | Project team | "Project [CODE] is now active" |
| Project rejected | Submitter | "Project [CODE] was rejected: [reason]" |
| Project revision requested | Submitter | "Revision requested on [CODE]: [reason]" |
| Report submitted | SPC | "New report awaiting coordination review" |
| Report approved | Submitter | "Your report has been approved" |
| Plan submitted | TC / SPC | "New plan submitted for review" |
| Plan approved | Submitter | "Your plan has been approved" |
| Required correction posted | Submitter | "A required correction has been posted on [entity]" |

### 10.3 Viewing Notifications

Click the 🔔 bell to open the notifications panel:
- Each notification shows: type icon, message text, entity name, time elapsed
- Click a notification to navigate directly to the relevant record
- Mark individual or all notifications as read
- Notifications are retained for 90 days

### 10.4 Permission-Based Visibility

Notifications are sent only to users who have permission to view the related record. TC users receive notifications only for their assigned sectors.

---

## 11. Approvals Workflow

### 11.1 General Approval Principles

All major entities in the PMIS (Projects, Reports, Plans) follow a **multi-stage approval chain**. Each stage:
1. Can be **approved** (moves to the next stage)
2. Can have a **revision requested** (returns to submitter with a reason)
3. Can be **rejected** (terminal — entity returns to draft with reason)

### 11.2 Project Approval Chain

```
SPO/SPC creates project (Draft)
    ↓ submit
Technical Coordinator reviews (Submitted)
    ↓ technically_approve / request_revision / reject
Senior Program Coordinator reviews (Technically Approved)
    ↓ coordination_approve / request_revision / reject
Program Manager final-approves (Coordination Approved)
    ↓ approve [blocked if Required Corrections exist]
Project Approved
    ↓ activate (by PM)
Project Active
    ↓ close (by PM)
Project Closed
```

### 11.3 Report Approval Chain

```
SPO / TC / SPC submits report (→ Submitted in one action)
    ↓
Senior Program Coordinator coordinates (Submitted → Coordination Approved)
    ↓
Program Manager final-approves (→ Approved)
    ↓
[Optional] Archive (→ Archived)
```

### 11.4 Plan Approval Chain

```
Draft → Submitted → Technically Approved → Coordination Approved → Approved → Active → In Progress → Completed/Delayed/Archived
```

Additional: `reject`, `request_revision`, `cancel` transitions available at multiple stages.

### 11.5 Required Corrections Gate

At the final approval step for **Projects** and **Plans**, the system checks for unresolved `required_correction` comments. If any exist:
- The **Approve** button is disabled
- An error message shows: "X required correction(s) must be resolved before approval"
- The reviewer or submitter must resolve all required corrections first

### 11.6 Approval History

Every transition is recorded with:
- Who performed the action
- Timestamp
- Comment (for rejections/revisions)
- Previous and new status

This history is visible on the entity detail page under **Workflow History**.

### 11.7 Audit Trail

Every create, edit, approve, and delete action is written to the **Audit Log** (`/audit-log`), accessible only to Super Admins and Program Managers. Each entry includes:
- User name and role
- Action type
- Module and entity ID
- Old value (before change)
- New value (after change)
- Timestamp

---

## 12. Documents & Attachments

### 12.1 Uploading Documents

Documents are uploaded through individual module forms:
- **Projects**: Step 9 of the registration form
- **Reports**: Evidence attachments (future enhancement)
- **Plans**: Activity attachments (future enhancement)

Upload process:
1. Click **Upload Document** / drag and drop a file
2. The system requests a presigned upload URL from the storage service
3. The file is uploaded directly to secure object storage
4. A record is created linking the file to the entity

### 12.2 Accepted File Types

| Category | Formats |
|---|---|
| Documents | PDF, DOCX, DOC, TXT, RTF |
| Spreadsheets | XLSX, XLS, CSV |
| Images | JPG, JPEG, PNG, WEBP |
| Presentations | PPTX, PPT |

Maximum size: **50 MB** per file.

### 12.3 Accessing Uploaded Documents

- Documents are listed in the **Documents** section of each entity's detail page
- Each entry shows: file name, uploader, upload date, file size
- Click the file name to download
- Only users with view permission for the entity can access its documents

### 12.4 Deleting Documents

Documents can be deleted by the uploader or by a Super Admin. Deletion is permanent.

---

## 13. Search, Filters & Export

### 13.1 Module Search

Each list page (Projects, Reports, Plans, Risks, Users) includes a **search bar** at the top:
- Projects: search by title, code, sector, donor
- Reports: search by type, state, submitter, status
- Plans: search by title, type, sector
- Users: search by name, email, username

### 13.2 Filters

In addition to text search, each list page provides filter controls:

**Projects filters:**
- Status · Sector · State · Management Level · Date range

**Reports filters:**
- Status · Report Type · State · Sector · Project · Reporting Month · Reporting Year · Submitter

**Plans filters:**
- Status · Plan Type · Sector · State · Date range

**Risks filters:**
- Status · Category · Severity · Linked Project · State

### 13.3 Sorting

Click any column header to sort the list in ascending or descending order.

### 13.4 Export to CSV

Every list page with tabular data includes an **Export CSV** button:
- Applies current filters before exporting
- Downloads a `.csv` file suitable for Excel / Google Sheets
- Column headers are in English

### 13.5 Audit Log Export

The Audit Log page supports filtered CSV export by date range, module, and user.

---

## 14. User Management & Admin Settings

### 14.1 Accessing User Management

From the sidebar: **Administration → Users** (`/users`)  
Visible to: **Super Admin** (full access) and **Program Manager** (read only)

### 14.2 User List

The list shows all system users with:
- Name, username, email, role, assigned state
- Status badge: Active (أخضر) · Invited (أزرق) · Suspended (برتقالي) · Inactive · Deactivated

Summary cards at the top show counts by status and by role.

### 14.3 Creating a User

1. Click **New User**
2. Fill in: Full name · Username · Email · Role · State (if applicable) · Sector (for TC role)
3. Set an initial password **or** leave blank to generate an invite link
4. Click **Create User**

**Invitation Flow** (when no password is set):
- System generates a 7-day invite token
- An `/invite/{token}` link is displayed to the Admin
- Admin shares this link with the new user (via email or messaging)
- User clicks the link, sets their password, and is automatically logged in
- Invite tokens expire after 7 days; the Admin can re-issue with **Resend Invite**

### 14.4 Editing a User

Click the **⋮ menu** on any user row → **Edit**:
- Update name, email, role, state, sector assignment
- Changing role to Technical Coordinator requires selecting at least one sector
- Changes take effect immediately on next login

### 14.5 User Status Actions

| Action | Result | Who Can Perform |
|---|---|---|
| Activate | Sets status to `active` | Super Admin |
| Suspend | Blocks login; status = `suspended` | Super Admin |
| Deactivate | Soft-delete; status = `deactivated` | Super Admin |
| Delete | Permanent removal | Super Admin |

### 14.6 Password Reset

From the user row → **Reset Password**:
- **Set new password**: Admin enters a new password directly
- **Re-issue invite link**: Generates a new 7-day token and link

### 14.7 Audit Log

From the sidebar: **Administration → Audit Log** (`/audit-log`)

Shows a searchable, filterable log of all system actions. Useful for:
- Investigating data discrepancies
- Compliance and accountability reviews
- Donor audits

---

## 15. Data Quality Rules

### 15.1 Mandatory Fields

The system enforces mandatory fields at the point of save/submit. A record cannot be saved if required fields are empty. Common mandatory fields include:

| Module | Mandatory Fields |
|---|---|
| Project | Title, Sector, State, Start/End Date, Donor, Budget |
| Report | Report Type, Reporting Period, State/Sector, Section 2 Narrative |
| Plan | Type, Title, Sector, State, Start/End Date |
| Risk | Title, Category, Likelihood, Impact, Mitigation |
| User | Full Name, Username, Email, Role |

### 15.2 Field Validation Rules

| Validation | Example |
|---|---|
| Date range | End date must be after start date |
| Budget | Must be a positive number |
| Progress % | Must be between 0 and 100 |
| Email | Must be a valid email address format |
| Username | Unique across all users; no spaces |
| Sector (TC) | At least one sector required for TC role |
| Invite token | Expires 7 days after generation |

### 15.3 Duplicate Prevention

- Project codes are system-generated and guaranteed unique
- Plan codes are system-generated with race-safe retry
- User emails and usernames must be unique system-wide
- Duplicate submission of the same report period for the same project/state/sector requires a specific justification (implemented via comment)

### 15.4 Reporting Deadlines (Recommended)

| Report Type | Submission Deadline |
|---|---|
| Monthly Project Report | 5th of the following month |
| Quarterly Report | 10th of the month following quarter end |
| Annual Report | 31st January of the following year |
| HQ Sector Report | 7th of the following month |
| Program State Report | 7th of the following month |

### 15.5 Data Correction Process

If data was entered incorrectly after approval:
1. The submitter requests a revision through the **Request Revision** button (if in a reviewable state)
2. If the record is already approved/active, contact the Super Admin to return it to `draft` state
3. Corrections are recorded in the Audit Log automatically
4. The corrected record must go through the full approval process again

---

## 16. Standard Operating Procedures

### SOP-01: New Project Registration

| Field | Details |
|---|---|
| **Process Name** | New Project Registration |
| **Purpose** | Register a new project in the PMIS with all required information |
| **Responsible** | State Program Officer / Senior Program Coordinator |
| **Inputs** | Signed project document, approved budget, donor agreement |

**Steps:**
1. Log in to PMIS and navigate to **Projects → New Project**
2. Complete all 9 registration form sections (Basics → Documents)
3. Assign project team members in the **Role Assignments** section
4. Upload the signed project document in the **Documents** section
5. Click **Submit for Review**
6. Confirm the submission notification appears

**Approval Flow:** SPO/SPC → TC → SPC → PM → Activation  
**Output:** Active project record with auto-generated project code  
**Timeline:** Registration within 3 days of project approval; full activation within 5 working days  
**Notifications:** TC receives review request; PM receives final approval request

---

### SOP-02: Monthly Report Submission

| Field | Details |
|---|---|
| **Process Name** | Monthly Progress Report Submission |
| **Purpose** | Document monthly programme progress for review and approval |
| **Responsible** | State Program Officer (Project Reports) / SPC (HQ Sector Reports) |
| **Inputs** | Activity completion data, beneficiary figures, expenditure data |

**Steps:**
1. Navigate to **Reports → [Report Type]**
2. Click **New Report**
3. Select the reporting month/year and linked project or state
4. Complete Section 2 (Progress Narrative)
5. Add all activities implemented in Section 3 (click **+ Add Activity** for each)
6. Enter beneficiary figures (M/F/B/G) for each activity
7. Complete Section 4 (Challenges)
8. Click **Submit Report**

**Approval Flow:** Submit (auto) → SPC Coordination Approval → PM Final Approval  
**Output:** Approved report record available for export  
**Timeline:** Submit by the 5th; approved by the 15th of the following month  
**Notifications:** SPC notified on submission; PM notified on coordination approval

---

### SOP-03: Plan Creation and Approval

| Field | Details |
|---|---|
| **Process Name** | Operational Plan Creation |
| **Purpose** | Create and get approval for a monthly/quarterly/action plan |
| **Responsible** | State Program Officer / Technical Coordinator |
| **Inputs** | Approved project work plan, activity schedules, budget allocation |

**Steps:**
1. Navigate to **Planning → Plans → New Plan**
2. Select plan type and enter all required fields
3. Add activities in the **Activities** section with timeline, budget, and responsible staff
4. Link activities to risks where mitigation actions are planned
5. Click **Submit for Review**
6. Respond to any required corrections raised by the TC
7. Once approved, the PM activates the plan (status: Active → In Progress)

**Approval Flow:** Submit → TC Technical Approval → SPC Coordination Approval → PM Final Approval  
**Output:** Active plan available for progress tracking  
**Timeline:** Submit 5 days before plan period begins  
**Notifications:** TC, SPC, PM notified at each stage

---

### SOP-04: Risk Registration and Management

| Field | Details |
|---|---|
| **Process Name** | Risk Registration |
| **Purpose** | Document and track programme and operational risks |
| **Responsible** | Any CAFA staff with relevant knowledge; Risk Owner assigned |
| **Inputs** | Risk identification (field observation, assessment, reports) |

**Steps:**
1. Navigate to **Risks → New Risk**
2. Enter title, description, and select category
3. Select Likelihood (Low / Medium / High) and Impact (Low / Medium / High) — system calculates the risk score (1–9) and level
4. Enter mitigation measures and assign a risk owner
5. Link to a project or plan activity if relevant
6. Click **Save**
7. Update status regularly (Open → Monitoring → Mitigating → Closed)

**Output:** Risk record in the register (3×3 matrix), linked to relevant projects and plans  
**Review Frequency:** Monthly review of all Open/Monitoring risks  
**Notifications:** Risk owner receives a notification when assigned

---

### SOP-05: User Onboarding

| Field | Details |
|---|---|
| **Process Name** | New User Setup |
| **Purpose** | Create a PMIS account for a new staff member |
| **Responsible** | Super Admin |
| **Inputs** | Staff name, email, assigned role, state/sector |

**Steps:**
1. Navigate to **Administration → Users → New User**
2. Enter full name, username, email address, and select role
3. Select state (for SPO/SM) or sector(s) (for TC)
4. Leave password blank to generate an invite link
5. Click **Create User**
6. Copy the invite link shown on screen and share it with the new user via a secure channel
7. Confirm with the user that they have logged in successfully
8. If the link expires before use, click **Resend Invite** on the user row

**Output:** Active user account; user can log in and begin using the system  
**Timeline:** Account creation same day as onboarding; link shared within 24 hours

---

## 17. Troubleshooting

### 17.1 Cannot Log In

| Symptom | Likely Cause | Solution |
|---|---|---|
| "Invalid credentials" message | Wrong username or password | Check username spelling; try email instead of username; contact Admin for password reset |
| "Account suspended" message | Account has been suspended | Contact Super Admin to reinstate |
| Page keeps redirecting to login | Session expired | Log in again |
| Invite link "expired" | Token is older than 7 days | Ask Admin to resend the invite |

### 17.2 Missing Data or Permission Denied

| Symptom | Likely Cause | Solution |
|---|---|---|
| Cannot see a project/report | Role or sector restriction | Confirm with Admin that your role has access; TC must be assigned the correct sector |
| "403 Forbidden" error | Record is in a sector not assigned to your TC account | Contact Admin to update sector assignment |
| Module not visible in sidebar | Role does not have access | Contact Admin to verify role assignment |

### 17.3 File Upload Failure

| Symptom | Likely Cause | Solution |
|---|---|---|
| "Upload failed" toast | File exceeds 50 MB | Compress the file or split into parts |
| Upload stuck at 0% | Network timeout | Check internet connection; try a different browser |
| Wrong file type rejected | Format not accepted | Convert to PDF or an accepted format |

### 17.4 Report Submission Issues

| Symptom | Likely Cause | Solution |
|---|---|---|
| Submit button disabled | Required fields are empty | Check all mandatory fields are filled (highlighted in red) |
| "Unresolved required corrections" | Open Required Correction comment | View Comments section and address all required corrections |
| Report disappears from list | Filtered out | Clear all filters; check Status filter |

### 17.5 Notification Not Appearing

| Symptom | Likely Cause | Solution |
|---|---|---|
| No notification after approval | Email/notification settings | Notifications are in-app only (bell icon); check the bell |
| Bell count does not update | Browser cache | Hard refresh (Ctrl+Shift+R); wait up to 30 seconds |
| Notification leads to "Not Found" | Record was deleted | Acknowledge and ignore the notification |

### 17.6 Export Error

| Symptom | Likely Cause | Solution |
|---|---|---|
| CSV downloads but is empty | No records match current filters | Remove filters and try again |
| Downloaded file has wrong columns | Wrong report type selected | Confirm the correct report type tab is active |
| Download does not start | Pop-up blocked | Allow pop-ups for the PMIS domain in your browser |

---

## 18. Annexes

### Annex A — Role Permission Matrix (Summary)

| Module / Action | SA | ED | PM | SPC | TC | SPO | SM |
|---|---|---|---|---|---|---|---|
| **Projects** | | | | | | | |
| View | ✓ | ✓ | ✓ | ✓ | Sector | State | ✓ |
| Create/Edit | ✓ | — | ✓ | ✓ | — | ✓ | — |
| Approve (Final) | ✓ | — | ✓ | — | — | — | — |
| **Reports** | | | | | | | |
| Submit | ✓ | — | — | ✓ | ✓ | ✓ | — |
| Approve (Final) | ✓ | — | ✓ | — | — | — | — |
| **Plans** | | | | | | | |
| Create/Edit | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| Approve (Final) | ✓ | — | ✓ | — | — | — | — |
| **Risks** | ✓ | ✓ | ✓ | ✓ | Sector | ✓ | ✓ |
| **Messages** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Users (Admin)** | ✓ | — | Read | — | — | — | — |
| **Audit Log** | ✓ | — | ✓ | — | — | — | — |

---

### Annex B — Approval Flow Diagrams

#### Project Approval Flow

```
[SPO / SPC] ──submit──▶ [TC] ──technically_approve──▶ [SPC] ──coordination_approve──▶ [PM]
                          │                               │                               │
                  request_revision              request_revision                    approve
                     / reject                    / reject                               │
                          │                               │                             ▼
                     [Draft]                         [Draft]                    [Approved → Active]
```

#### Report Approval Flow

```
[SPO / TC / SPC] ──submit──▶ [SPC] ──coordination_approve──▶ [PM] ──approve──▶ [Approved]
                                │                                │
                       return_for_revision              return_for_revision
                                │                                │
                           [Draft]                          [Submitted]
```

#### Plan Approval Flow

```
[SPO / TC / SPC / PM] ──submit──▶ [TC] ──▶ [SPC] ──▶ [PM] ──approve──▶ [Active] ──▶ [In Progress]
                                                                                           │
                                                                               Completed / Delayed / Archived
```

---

### Annex C — Report Submission Timeline

| Report Type | Submitted By | Due Date | SPC Review By | PM Approval By |
|---|---|---|---|---|
| Monthly Project Report | SPO | 5th of next month | 10th | 15th |
| HQ Sector Report | SPC / TC | 7th of next month | 12th | 17th |
| Program State Report | SM / SPO | 7th of next month | 12th | 17th |
| Quarterly Report | SPC | 10th after quarter end | 17th | 22nd |
| Annual Report | SPC | 31st January | 10th February | 20th February |

---

### Annex D — Data Entry Checklist (New Project)

- [ ] Project title entered (clear and descriptive)
- [ ] Correct sector selected
- [ ] Primary state and all operational localities selected
- [ ] Start and end dates confirmed against donor agreement
- [ ] Management level correctly set (HQ or State)
- [ ] Project team assigned (Project Lead, Finance Officer, M&E Officer)
- [ ] Beneficiary targets entered for all relevant categories
- [ ] Budget total matches donor agreement
- [ ] Currency selected (USD / SDG)
- [ ] At least one output and one activity added
- [ ] Signed project/grant document uploaded
- [ ] Project submitted for review (not left as draft)

---

### Annex E — User Onboarding Checklist

- [ ] Username and email address prepared (no duplicates)
- [ ] Correct role confirmed with line manager
- [ ] State assigned (for state-based roles)
- [ ] Sector(s) assigned (for Technical Coordinator role)
- [ ] User account created in PMIS
- [ ] Invite link copied and shared securely with new user
- [ ] User confirmed successful login
- [ ] User oriented on: Dashboard · Projects · Reports · Plans relevant to their role
- [ ] User briefed on data quality rules (Annex D)
- [ ] User added to relevant project group chats in Messages module

---

### Annex F — Notification Reference

| Event | Who is Notified |
|---|---|
| Project submitted | TC(s) assigned to project sector |
| Project technically approved | Senior Program Coordinator |
| Project coordination approved | Program Manager |
| Project approved | All project assignees |
| Project activated | All project assignees |
| Project rejected/revision | Original submitter |
| Report submitted | Senior Program Coordinator |
| Report coordination approved | Program Manager |
| Report approved | Report submitter |
| Plan submitted | TC and SPC |
| Plan approved | Plan submitter + team |
| Required correction added | Entity submitter |
| New direct message | Message recipient |

---

*End of CAFA PMIS System Manual — Version 1.0*

*For technical support or to report system errors, contact the CAFA IT/Admin team.*  
*For operational guidance, contact the Programme Quality and Accountability unit at HQ.*

---
**Document Control**

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | May 2026 | CAFA Programme Unit | Initial release |
