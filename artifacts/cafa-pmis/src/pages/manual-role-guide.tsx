import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  BookOpen, ChevronRight, Users, CheckCircle, XCircle,
  LayoutDashboard, FileText, AlertTriangle,
  Bell, ShieldCheck, Eye, Pencil,
  ArrowRight,
} from "@/components/icons";
import { Card, Chip } from "@heroui/react";
import { useGetMe } from "@workspace/api-client-react";
import { useLanguage } from "@/contexts/language-context";
import { ROLE_GUIDE_ARABIC_DRAFT } from "@/lib/role-guide-arabic-draft";

// ── Role data ─────────────────────────────────────────────────────────────

type RoleGuide = {
  label: string;
  subtitle: string;
  color: string;
  badgeColor: string;
  summary: string;
  access: string[];
  canCreate: string[];
  canApprove: string[];
  reports: string[];
  dashboard: string;
  notifications: string[];
  tips: string[];
  restrictions?: string[];
};

const GUIDES: Record<string, RoleGuide> = {
  super_admin: {
    label: "Super Admin",
    subtitle: "Full system administrator",
    color: "from-red-700 to-red-900",
    badgeColor: "bg-red-100 text-red-700 border-red-200",
    summary: "Super Admins have unrestricted access to the entire CAFA PMIS. They are responsible for user management, system configuration, and data integrity oversight.",
    access: ["All modules and data across all states and sectors", "User management (create, edit, suspend, deactivate)", "Audit log — full history of all system actions", "System Manual editing and chapter management", "AI settings and usage logs", "All project, report, plan, and risk records"],
    canCreate: ["Users and invitations", "Projects (all states and sectors)", "Reports of all types", "Plans of all types", "Risks", "Manual chapters and sections"],
    canApprove: ["Projects at any stage", "Reports at any stage", "Plans at any stage"],
    reports: ["Project Reports", "HQ Sector Reports", "State Programme Reports", "Custom dashboard exports"],
    dashboard: "Full strategic dashboard with all KPI cards, all charts, all states, Donor Portfolio view, and Pending Approvals panel.",
    notifications: ["All approval requests and decisions", "Critical and high-level risks", "Assignments", "@Mentions", "Due date reminders", "System events and security alerts"],
    tips: ["Always use the Audit Log to investigate unexpected data changes.", "Avoid using the Super Admin account for daily operations — create a personal account with the appropriate role.", "Run the seed script after a fresh deployment to restore demo users."],
  },

  executive_director: {
    label: "Executive Director",
    subtitle: "Strategic oversight — read-only",
    color: "from-purple-700 to-purple-900",
    badgeColor: "bg-purple-100 text-purple-700 border-purple-200",
    summary: "The Executive Director has read-only access to all programme data for senior oversight. They cannot create or approve records, but receive escalated risk notifications.",
    access: ["All projects (read-only)", "All reports (read-only)", "All plans (read-only)", "Dashboard — full strategic view", "Risk register (read-only)", "State and sector performance data"],
    canCreate: [],
    canApprove: [],
    reports: ["View all report types (read-only)", "Dashboard exports"],
    dashboard: "Full strategic dashboard — same as Programme Manager. All KPI cards, all charts, Donor Portfolio, and State Performance table.",
    notifications: ["Critical risk escalations (mandatory)", "High-level risk escalations", "Major approval milestones"],
    tips: ["Use the Dashboard for daily programme overview.", "The Beneficiary Breakdown modal (click Total Beneficiaries on dashboard) provides disaggregated data.", "For detailed project data, navigate to Projects and use the search and filter options."],
    restrictions: ["Cannot create, edit, or delete any records", "Cannot approve or reject projects, reports, or plans", "Cannot manage users"],
  },

  program_manager: {
    label: "Programme Manager",
    subtitle: "Final approvals and programme oversight",
    color: "from-blue-700 to-blue-900",
    badgeColor: "bg-blue-100 text-blue-700 border-blue-200",
    summary: "Programme Managers give final approval for projects, reports, and plans. They also activate approved projects and plans, and manage the user directory.",
    access: ["All projects across all states and sectors", "All reports across all states and sectors", "All plans", "User directory (read and limited admin)", "Risk register across all sectors", "Budget and donor portfolio data"],
    canCreate: ["Projects", "Reports", "Plans", "Manual chapters and SOPs"],
    canApprove: ["Projects — final approval (4th stage)", "Plans — final approval and activation", "Reports — final approval (3rd stage)", "Project activation (Approved → Active)", "Project closure"],
    reports: ["Project Reports", "HQ Sector Reports", "State Programme Reports"],
    dashboard: "Full strategic dashboard. All KPI cards, all charts, Budget & Beneficiary snapshot strip, Pending Approvals panel, State Performance table.",
    notifications: ["All approval requests at Programme Manager stage", "Critical and high-level risks", "Overdue approvals", "Assignments", "@Mentions"],
    tips: ["Check the Pending Approvals panel on the Dashboard daily.", "Use Required Correction comments to flag data issues without rejecting a submission outright.", "Activate approved projects promptly — state officers cannot begin implementation until a project is Active."],
  },

  senior_program_coordinator: {
    label: "Senior Programme Coordinator",
    subtitle: "Coordination review — multi-state programmes",
    color: "from-indigo-700 to-indigo-900",
    badgeColor: "bg-indigo-100 text-indigo-700 border-indigo-200",
    summary: "Senior Programme Coordinators perform coordination reviews — the 3rd stage of the approval chain for projects, reports, and plans. They coordinate cross-state and cross-sector activities.",
    access: ["All projects (view and coordination review)", "All reports (view and coordination review)", "All plans (view and coordination review)", "Risk register", "System Manual (content editing)"],
    canCreate: ["Projects", "Reports", "Plans", "Manual section content edits"],
    canApprove: ["Projects — coordination approval (3rd stage)", "Plans — coordination approval", "Reports — coordination approval (2nd stage)"],
    reports: ["Project Reports", "HQ Sector Reports", "State Programme Reports"],
    dashboard: "Operational dashboard — project counts, beneficiaries, budget, approval queue, Reporting Analytics strip.",
    notifications: ["Coordination review requests", "Project and report transitions", "@Mentions and comments", "High-level risks", "Assignments"],
    tips: ["Use the Comments panel to provide structured feedback to submitters before advancing to the next stage.", "For complex multi-state projects, check all state localities are correctly assigned before coordinating."],
  },

  technical_coordinator: {
    label: "Technical Coordinator",
    subtitle: "Sector-restricted technical review",
    color: "from-teal-700 to-teal-900",
    badgeColor: "bg-teal-100 text-teal-700 border-teal-200",
    summary: "Technical Coordinators review projects, plans, and reports within their assigned programme sector(s). All data access is automatically restricted to their sector. A TC with no sector assigned is effectively locked out.",
    access: ["Projects in assigned sector(s) only", "Reports for assigned sector(s) only", "Plans for assigned sector(s) only", "Risk register (sector-restricted)", "Risks with no project link — excluded"],
    canCreate: ["Projects (within assigned sector)", "Reports (within assigned sector)", "Plans (within assigned sector)", "Risks (for sector-linked projects)"],
    canApprove: ["Projects — technical approval (2nd stage)", "Plans — technical approval"],
    reports: ["Project Reports (sector-restricted)", "HQ Sector Reports (own sector)"],
    dashboard: "Focused TC dashboard — sector KPIs, sector project counts, pending technical approvals, sector risk summary.",
    notifications: ["Technical review requests", "Project transitions in assigned sector", "@Mentions", "Due dates for sector activities"],
    tips: ["Your sector assignment controls everything you can see. If data seems missing, verify your sector assignment with the System Administrator.", "When a project spans multiple sectors, you will only see it if one of your sectors matches.", "A TC with a blank sector field is fail-closed — you will see nothing. Report this to your admin immediately."],
    restrictions: ["Cannot see projects, reports, or plans outside assigned sector(s)", "Cannot access user management", "Cannot view budget data for other sectors"],
  },

  state_office_manager: {
    label: "State Office Manager",
    subtitle: "State-level operations and staff management",
    color: "from-green-700 to-green-900",
    badgeColor: "bg-green-100 text-green-700 border-green-200",
    summary: "State Office Managers oversee all CAFA operations within one assigned state. They manage state-level staff, create and edit state-level records, submit reports, and monitor the performance of their state's projects.",
    access: ["All projects in assigned state", "All reports for assigned state", "All plans for assigned state", "Risk register for assigned state", "State-level dashboard", "State programme officers reporting to them"],
    canCreate: ["Projects (state-managed)", "State Programme Reports", "Plans (monthly/quarterly)", "Risks"],
    canApprove: ["None — monitoring and oversight role; approval authority sits at HQ"],
    reports: ["State Programme Reports", "Project Reports for state projects"],
    dashboard: "State dashboard — state KPIs, projects by locality, beneficiary breakdown for the state, pending submissions.",
    notifications: ["State project transitions", "Risk escalations in assigned state", "Overdue plans and reports", "@Mentions", "Assignments to state staff"],
    tips: ["Use the State Detail page (States module → your state) for a geographic breakdown of all activities.", "Coordinate with Technical Coordinators for sector-specific reviews of state projects.", "Monitor your state officers' submission progress from the Dashboard — overdue submissions appear in the Pending Approvals panel."],
  },

  state_program_officer: {
    label: "State Programme Officer",
    subtitle: "Field operations — project and report creation",
    color: "from-amber-600 to-amber-800",
    badgeColor: "bg-amber-100 text-amber-700 border-amber-200",
    summary: "State Programme Officers are the primary data entry role in CAFA PMIS. They create project registrations, submit plans, log risks, and compile reports from field operations in their assigned state.",
    access: ["Projects they are assigned to", "Reports they create", "Plans they create", "Risk register (create and update)", "System Manual (read-only)", "File & Archive (upload and download)"],
    canCreate: ["Projects (state-managed)", "Project Reports", "State Programme Reports", "Plans (monthly/action/operational)", "Risks", "Comments on assigned entities"],
    canApprove: ["None — State Programme Officers submit; approval happens upstream"],
    reports: ["Project Reports", "State Programme Reports"],
    dashboard: "Compact state officer dashboard — assigned projects, pending submissions, recent activities, risk status.",
    notifications: ["Approval decisions on your submissions", "Revision requests (Required Correction comments)", "Due date reminders", "@Mentions", "Assignments"],
    tips: ["Save projects and reports as Draft before submitting — you can continue editing them later.", "Always upload at least one signed document before submitting a project.", "Check the Comments tab regularly — reviewers may post Required Correction comments that need your attention before approval can proceed."],
  },

  project_officer: {
    label: "Project Officer",
    subtitle: "Project-specific data entry and reporting",
    color: "from-orange-600 to-orange-800",
    badgeColor: "bg-orange-100 text-orange-700 border-orange-200",
    summary: "Project Officers support specific projects with data entry, activity tracking, and reporting. Their access is limited to the projects they are assigned to.",
    access: ["Projects they are assigned to (read and limited edit)", "Reports for assigned projects", "Risk register for assigned projects", "File & Archive (upload and download)"],
    canCreate: ["Activity logs and progress updates for assigned projects", "Document uploads for assigned projects", "Comments on assigned entities"],
    canApprove: ["None — Project Officers do not have approval authority"],
    reports: ["Project Reports (assigned projects only)"],
    dashboard: "Basic dashboard — assigned project summaries and upcoming deadlines.",
    notifications: ["Assignments and task updates", "@Mentions", "Due date reminders for assigned work"],
    tips: ["Keep activity progress updated regularly — your Programme Officer relies on this data for reports.", "Upload supporting documents for activities as they are completed.", "If you need access to records you cannot see, ask your line manager to update your project assignment."],
    restrictions: ["Cannot create projects, plans, or risks independently", "Cannot approve or reject any records", "Cannot access user management or audit log"],
  },

  program_assistant: {
    label: "Programme Assistant",
    subtitle: "Administrative support and data entry",
    color: "from-slate-600 to-slate-800",
    badgeColor: "bg-slate-100 text-slate-700 border-slate-200",
    summary: "Programme Assistants support programme staff with data entry, document management, and administrative tasks. They have limited write access — primarily viewing assigned records and assisting with document uploads.",
    access: ["Projects they are assigned to (read-only)", "Reports they are involved with (read-only)", "Plans they are supporting (read-only)", "System Manual (read-only)", "File & Archive (upload and download)"],
    canCreate: ["Document uploads for assigned projects and reports", "Comments on assigned entities"],
    canApprove: ["None — Programme Assistants do not have approval authority"],
    reports: ["View assigned reports (read-only)"],
    dashboard: "Basic dashboard — assigned project summaries and upcoming deadlines.",
    notifications: ["Assignments and task updates", "@Mentions", "Due date reminders for assigned work"],
    tips: ["Use File & Archive to upload and organise files as directed by your Programme Officer or Manager.", "If you need access to records you cannot see, ask your line manager to update your project assignment."],
    restrictions: ["Cannot create projects, reports, plans, or risks independently", "Cannot approve or reject any records", "Cannot access user management or audit log", "Cannot view records outside your assignments"],
  },

  viewer: {
    label: "Viewer",
    subtitle: "Read-only access to assigned data",
    color: "from-gray-600 to-gray-800",
    badgeColor: "bg-gray-100 text-gray-700 border-gray-200",
    summary: "Viewers have read-only access to specific programme data they have been granted access to. This role is typically used for donors, partners, or external stakeholders who need visibility without any edit access.",
    access: ["Projects explicitly shared with them (read-only)", "Reports explicitly shared with them (read-only)", "System Manual (read-only)"],
    canCreate: [],
    canApprove: [],
    reports: ["View shared reports (read-only)"],
    dashboard: "Limited dashboard — only data within their granted access scope.",
    notifications: ["Minimal — only explicit assignments"],
    tips: ["Contact your CAFA system administrator if you need access to additional records.", "Use the System Manual to understand programme terminology and processes."],
    restrictions: ["Cannot create, edit, or delete any records", "Cannot approve or reject anything", "Cannot access user management, audit log, or financial data", "Data access is strictly limited to explicitly granted records"],
  },
};

const ALL_ROLES = Object.keys(GUIDES);

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  executive_director: "Executive Director",
  program_manager: "Programme Manager",
  senior_program_coordinator: "Senior Programme Coordinator",
  technical_coordinator: "Technical Coordinator",
  state_office_manager: "State Office Manager",
  state_program_officer: "State Programme Officer",
  project_officer: "Project Officer",
  program_assistant: "Programme Assistant",
  viewer: "Viewer",
};

const AR_ROLE_LABELS: Record<string, string> = {
  super_admin: "مسؤول النظام",
  executive_director: "المدير التنفيذي",
  program_manager: "مدير البرامج",
  senior_program_coordinator: "منسق البرامج الأول",
  technical_coordinator: "المنسق التقني",
  state_office_manager: "مدير مكتب الولاية",
  state_program_officer: "مسؤول البرنامج في الولاية",
  project_officer: "مسؤول المشروع",
  program_assistant: "مساعد البرامج",
  viewer: "مستخدم للعرض",
};

function arabicRoleGuide(role: string, guide: RoleGuide): RoleGuide {
  const translate = (value: string) =>
    ROLE_GUIDE_ARABIC_DRAFT[value] ?? "تتطلب هذه الفقرة مراجعة تحريرية عربية.";
  return {
    ...guide,
    label: translate(guide.label),
    subtitle: translate(guide.subtitle),
    summary: translate(guide.summary),
    access: guide.access.map(translate),
    canCreate: guide.canCreate.map(translate),
    canApprove: guide.canApprove.map(translate),
    reports: guide.reports.map(translate),
    dashboard: translate(guide.dashboard),
    notifications: guide.notifications.map(translate),
    tips: guide.tips.map(translate),
    restrictions: guide.restrictions?.map(translate),
  };
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ManualRoleGuide({ role }: { role: string }) {
  const { t } = useTranslation("knowledge");
  const { lang } = useLanguage();
  const { data: me } = useGetMe();
  const guide = GUIDES[role] && (lang === "ar" ? arabicRoleGuide(role, GUIDES[role]) : GUIDES[role]);
  const currentUserRole = me?.user.role ?? "";
  const isCurrentRole = role === currentUserRole;

  if (!guide) {
    return (
      <Card className="mx-auto max-w-md items-center py-16 text-center">
        <Users className="size-12 text-[var(--muted)] opacity-30" aria-hidden="true" />
        <p className="font-medium text-[var(--muted)]">{t("roleGuide.notFound")}</p>
        <Link href="/manual" className="text-sm text-[var(--accent)] hover:underline">
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">←</span> {t("manual.title")}
        </Link>
      </Card>
    );
  }

  const index = ALL_ROLES.indexOf(role);
  const navLink = "flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <Card className="p-5 sm:p-6">
        <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]" aria-label={t("common:manualNav.breadcrumb")}>
          <BookOpen className="size-3.5" aria-hidden="true" />
          <Link href="/manual" className="hover:text-[var(--accent)]">{t("manual.title")}</Link>
          <ChevronRight className="size-3 rtl:rotate-180" aria-hidden="true" />
          <span>{t("roleGuide.title")}</span>
          <ChevronRight className="size-3 rtl:rotate-180" aria-hidden="true" />
          <span className="text-[var(--foreground)]">{guide.label}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-xl bg-[var(--accent)]/10 p-2.5 text-[var(--accent)]" aria-hidden="true">
            <Users className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{guide.label}</h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{guide.subtitle}</p>
          </div>
          {isCurrentRole && (
            <Chip size="sm" variant="soft" color="accent" className="gap-1">
              <Users className="size-3" aria-hidden="true" />
              {t("roleGuide.currentRole")}
            </Chip>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{guide.summary}</p>
      </Card>

      <div className="flex gap-6">
        {/* Start sidebar — role nav */}
        <aside className="hidden w-52 shrink-0 lg:block" aria-label={t("common:manualNav.allRoles")}>
          <Card className="sticky top-4 gap-0.5 p-2">
            <p className="mb-1 px-2 pt-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)] rtl:tracking-normal">{t("roleGuide.allRoles")}</p>
            {ALL_ROLES.map((r) => (
              <Link
                key={r}
                href={`/manual/guides/${r}`}
                aria-current={r === role ? "page" : undefined}
                className={`${navLink} ${r === role
                  ? "bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--default)] hover:text-[var(--foreground)]"}`}
              >
                <Users className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                <span className="truncate">{lang === "ar" ? AR_ROLE_LABELS[r] : ROLE_LABELS[r]}</span>
              </Link>
            ))}
            <div className="mt-2 border-t border-[var(--border)] pt-2">
              <Link href="/manual" className={`${navLink} text-[var(--muted)] hover:bg-[var(--default)]`}>
                <BookOpen className="size-3 shrink-0" aria-hidden="true" />
                <span>{t("manual.title")}</span>
              </Link>
            </div>
          </Card>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 space-y-5">
          {/* Restrictions banner */}
          {guide.restrictions && guide.restrictions.length > 0 && (
            <div className="rounded-2xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4" role="note">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <AlertTriangle className="size-3.5 text-[var(--warning)]" aria-hidden="true" /> {t("roleGuide.importantRestrictions")}
              </p>
              <ul className="space-y-1">
                {guide.restrictions.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Access */}
          <Section icon={Eye} title={t("roleGuide.accessTitle")} color="accent">
            <ul className="space-y-1.5">
              {guide.access.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
                  {a}
                </li>
              ))}
            </ul>
          </Section>

          {/* Can Create */}
          <Section icon={Pencil} title={t("roleGuide.createTitle")} color="success">
            {guide.canCreate.length === 0 ? (
              <p className="text-sm italic text-[var(--muted)]">{t("roleGuide.cannotCreate")}</p>
            ) : (
              <ul className="space-y-1.5">
                {guide.canCreate.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Can Approve */}
          <Section icon={ShieldCheck} title={t("roleGuide.approvalTitle")} color="accent">
            {guide.canApprove.length === 0 ? (
              <p className="text-sm italic text-[var(--muted)]">{t("roleGuide.noApproval")}</p>
            ) : (
              <ul className="space-y-1.5">
                {guide.canApprove.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Reports */}
          <Section icon={FileText} title={t("roleGuide.reportsTitle")} color="success">
            <ul className="space-y-1.5">
              {guide.reports.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
                  {r}
                </li>
              ))}
            </ul>
          </Section>

          {/* Dashboard */}
          <Section icon={LayoutDashboard} title={t("roleGuide.dashboardTitle")} color="accent">
            <p className="text-sm leading-relaxed">{guide.dashboard}</p>
          </Section>

          {/* Notifications */}
          <Section icon={Bell} title={t("roleGuide.notificationsTitle")} color="accent">
            <ul className="space-y-1.5">
              {guide.notifications.map((n, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Bell className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </Section>

          {/* Tips */}
          <Section icon={BookOpen} title={t("roleGuide.tipsTitle")} color="warning">
            <ul className="space-y-2">
              {guide.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--warning)]/15 text-xs font-bold text-[var(--warning)]" aria-hidden="true">{i + 1}</span>
                  {tip}
                </li>
              ))}
            </ul>
          </Section>

          {/* Navigation row */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <Link href="/manual" className="button button--secondary button--sm gap-1.5">
              <BookOpen className="size-3.5" aria-hidden="true" /> {t("manual.title")}
            </Link>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <Link href={`/manual/guides/${ALL_ROLES[index - 1]}`} className="button button--ghost button--sm gap-1.5">
                  <ArrowRight className="size-3.5 rotate-180 rtl:rotate-0" aria-hidden="true" /> {t("roleGuide.previousRole")}
                </Link>
              )}
              {index < ALL_ROLES.length - 1 && (
                <Link href={`/manual/guides/${ALL_ROLES[index + 1]}`} className="button button--ghost button--sm gap-1.5">
                  {t("roleGuide.nextRole")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

const SECTION_TONES: Record<"accent" | "success" | "warning", string> = {
  accent: "bg-[var(--accent)]/10 text-[var(--accent)]",
  success: "bg-[var(--success)]/10 text-[var(--success)]",
  warning: "bg-[var(--warning)]/15 text-[var(--warning)]",
};

function Section({
  icon: Icon, title, color, children,
}: {
  icon: React.ElementType; title: string; color: keyof typeof SECTION_TONES; children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--default)]/50 px-5 py-3.5">
        <span className={`rounded-md p-1.5 ${SECTION_TONES[color]}`} aria-hidden="true">
          <Icon className="size-3.5" />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}
