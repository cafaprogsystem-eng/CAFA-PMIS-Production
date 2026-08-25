import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  BookOpen, ChevronRight, Users, CheckCircle, XCircle,
  LayoutDashboard, FileText, AlertTriangle,
  Bell, ShieldCheck, Eye, Pencil,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center">
        <div className="text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <p className="text-muted-foreground font-medium">{t("roleGuide.notFound")}</p>
          <Link href="/manual">
            <Button variant="link" size="sm" className="mt-2">← {t("manual.title")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      {/* Header */}
      <div className={`bg-gradient-to-br ${guide.color} text-white px-6 py-8`}>
        <div className="max-w-4xl mx-auto">
          <nav className="flex items-center gap-1.5 text-white/60 text-xs mb-5" aria-label={t("common:manualNav.breadcrumb")}>
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <Link href="/manual"><span className="hover:text-white cursor-pointer">{t("manual.title")}</span></Link>
            <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
            <span className="text-white/90">{t("roleGuide.title")}</span>
            <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
            <span className="text-white/90">{guide.label}</span>
          </nav>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-white/15" aria-hidden="true">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{guide.label}</h1>
              <p className="text-white/70 text-sm mt-0.5">{guide.subtitle}</p>
            </div>
          </div>
          {isCurrentRole && (
            <div className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-3 py-1 text-xs font-medium text-white mb-3">
              <Users className="h-3 w-3" aria-hidden="true" />
              {t("roleGuide.currentRole")}
            </div>
          )}
          <p className="text-white/75 text-sm max-w-2xl leading-relaxed">{guide.summary}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 flex gap-8">
        {/* Left sidebar — role nav */}
        <aside className="hidden lg:block w-48 shrink-0" aria-label={t("common:manualNav.allRoles")}>
          <div className="sticky top-4 space-y-0.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">{t("roleGuide.allRoles")}</p>
            {ALL_ROLES.map((r) => (
              <Link key={r} href={`/manual/guides/${r}`}>
                <div
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    r === role
                      ? "bg-[#eef4fb] text-[#1a3c5e] font-semibold"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                  aria-current={r === role ? "page" : undefined}
                >
                  <Users className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                   <span className="truncate">{lang === "ar" ? AR_ROLE_LABELS[r] : ROLE_LABELS[r]}</span>
                </div>
              </Link>
            ))}
            <div className="pt-3 mt-3 border-t border-slate-200">
              <Link href="/manual">
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-slate-100 cursor-pointer transition-colors">
                  <BookOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{t("manual.title")}</span>
                </div>
              </Link>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 space-y-5">
          {/* Role badge */}
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${guide.badgeColor}`}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {guide.label}
          </div>

          {/* Restrictions banner */}
          {guide.restrictions && guide.restrictions.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4" role="note">
              <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {t("roleGuide.importantRestrictions")}
              </p>
              <ul className="space-y-1">
                {guide.restrictions.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Access */}
          <Section icon={Eye} title={t("roleGuide.accessTitle")} color="text-blue-600 bg-blue-50">
            <ul className="space-y-1.5">
              {guide.access.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden="true" />
                  {a}
                </li>
              ))}
            </ul>
          </Section>

          {/* Can Create */}
          <Section icon={Pencil} title={t("roleGuide.createTitle")} color="text-emerald-600 bg-emerald-50">
            {guide.canCreate.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">{t("roleGuide.cannotCreate")}</p>
            ) : (
              <ul className="space-y-1.5">
                {guide.canCreate.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden="true" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Can Approve */}
          <Section icon={ShieldCheck} title={t("roleGuide.approvalTitle")} color="text-purple-600 bg-purple-50">
            {guide.canApprove.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">{t("roleGuide.noApproval")}</p>
            ) : (
              <ul className="space-y-1.5">
                {guide.canApprove.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-purple-500" aria-hidden="true" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Reports */}
          <Section icon={FileText} title={t("roleGuide.reportsTitle")} color="text-green-600 bg-green-50">
            <ul className="space-y-1.5">
              {guide.reports.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-green-500" aria-hidden="true" />
                  {r}
                </li>
              ))}
            </ul>
          </Section>

          {/* Dashboard */}
          <Section icon={LayoutDashboard} title={t("roleGuide.dashboardTitle")} color="text-[#2d6a9f] bg-[#eef4fb]">
            <p className="text-sm text-slate-700 leading-relaxed">{guide.dashboard}</p>
          </Section>

          {/* Notifications */}
          <Section icon={Bell} title={t("roleGuide.notificationsTitle")} color="text-violet-600 bg-violet-50">
            <ul className="space-y-1.5">
              {guide.notifications.map((n, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <Bell className="h-4 w-4 shrink-0 mt-0.5 text-violet-400" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </Section>

          {/* Tips */}
          <Section icon={BookOpen} title={t("roleGuide.tipsTitle")} color="text-amber-600 bg-amber-50">
            <ul className="space-y-2">
              {guide.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="shrink-0 h-5 w-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center mt-0.5" aria-hidden="true">{i + 1}</span>
                  {tip}
                </li>
              ))}
            </ul>
          </Section>

          {/* Navigation row */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <Link href="/manual">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> {t("manual.title")}
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              {ALL_ROLES.indexOf(role) > 0 && (
                <Link href={`/manual/guides/${ALL_ROLES[ALL_ROLES.indexOf(role) - 1]}`}>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs">← {t("roleGuide.previousRole")}</Button>
                </Link>
              )}
              {ALL_ROLES.indexOf(role) < ALL_ROLES.length - 1 && (
                <Link href={`/manual/guides/${ALL_ROLES[ALL_ROLES.indexOf(role) + 1]}`}>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs">{t("roleGuide.nextRole")} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /></Button>
                </Link>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({
  icon: Icon, title, color, children,
}: {
  icon: React.ElementType; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-50 bg-slate-50/50">
        <div className={`p-1.5 rounded-md ${color} opacity-90`} aria-hidden="true">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}
