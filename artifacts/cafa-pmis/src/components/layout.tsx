import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getStateLabel } from "@/components/state-label";
import {
  LayoutDashboard,
  MapPin,
  FolderKanban,
  PieChart,
  ChartNoAxesColumn,
  AlertTriangle,
  ShieldAlert,
  UserCog,
  Menu,
  X,
  CalendarClock,
  CheckCircle2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  BookOpen,
  User,
  MonitorSmartphone,
  RefreshCw,
  CloudOff,
  Bot,
  Bell,
  Settings,
  Archive,
  Globe,
  Check,
} from "lucide-react";
import { LiveClock } from "@/components/live-clock";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { CommandPalette } from "@/components/command-palette";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useSyncContext } from "@/contexts/sync-context";
import { clearOfflineData, setOfflineUser } from "@/lib/offline/db";
import { clearAllAttachmentData } from "@/lib/offline/attachment-store";
import { syncService } from "@/lib/offline/sync-service";
import { inferItemMeta, clearItems } from "@/lib/recent-items";
import { clearFavorites } from "@/lib/favorites";
import { clearNotificationQueries } from "@/lib/notification-client";
import { useSocket } from "@/lib/socket";
import { useRecentItems } from "@/hooks/use-recent-items";
import cafaLogo from "@/assets/cafa-logo.png";
import {
  demoRoleHarnessEnabled,
  useGetMe,
  useListSwitcherUsers,
  getListSwitcherUsersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage, type Language } from "@/contexts/language-context";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NotificationsBell } from "@/components/notifications-bell";
import { MessagesDropdown } from "@/components/messages-dropdown";
import { GlobalSearch } from "@/components/global-search";
import { GlobalLocationSelector } from "@/components/global-location-selector";
import { GlobalLanguageSwitcher } from "@/components/global-language-switcher";
import { useLocationContext } from "@/contexts/location-context";
import { RecordDetailProvider } from "@/contexts/record-detail-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ─── Static page title map (English — used only for recent-item storage) ─ */
const STATIC_PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard", "/dashboard": "Dashboard",
  "/projects": "Projects", "/budget": "Budgets",
  "/plans": "Plans", "/planning": "Plans", "/planning-dashboard": "Plans",
  "/reports": "Reports", "/reports/project": "Project Reports",
  "/reports/hq-sector": "HQ Sector Reports", "/reports/program-state": "State Programme Reports",
  "/risks": "Risk Register", "/states": "States", "/users": "User Management",
  "/ai": "AI",
  "/audit-log": "Audit Log", "/messages": "Communication Centre",
  "/notifications": "Notifications", "/manual": "System Manual",
  "/sync-status": "Sync Status",
  "/document-management/file-archive": "File & Archive", "/files": "File & Archive",
  "/drive": "File & Archive", "/program-resources": "File & Archive",
};
function staticPageTitle(loc: string): string {
  if (STATIC_PAGE_TITLES[loc]) return STATIC_PAGE_TITLES[loc];
  for (const [p, t] of Object.entries(STATIC_PAGE_TITLES)) {
    if (p !== "/" && loc.startsWith(p)) return t;
  }
  return loc;
}

/* ─── Nav structure ──────────────────────────────────────────────────── */
type NavChild = { href: string; label: string };
type NavItem = {
  href: string;
  icon: React.ElementType;
  label: string;
  displayLabel?: string;
  children?: NavChild[];
  onClick?: () => void;
};
type NavGroup = { title: string; items: NavItem[] };
type NavEntry =
  | { kind: "group"; group: NavGroup }
  | { kind: "item"; item: NavItem };

/* ─── Main layout ────────────────────────────────────────────────────── */
export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("cafa.sidebarCollapsed") === "true"
  );
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
  );
  const [scrolled, setScrolled] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // A persisted desktop rail preference must never reduce the touch drawer to icons.
  const sidebarCollapsed = collapsed && !isNarrowViewport;

  const toggleExpanded = (href: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href); else next.add(href);
      return next;
    });
  };
  const [location, navigate] = useLocation();
  const [desktopView, setDesktopView] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("cafa.desktopView") === "true"
  );
  const mainRef = useRef<HTMLElement>(null);

  // Auto-close mobile drawer on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Keep the visual rail state aligned with Tailwind's lg breakpoint.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const syncViewport = () => setIsNarrowViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  // Track scroll position on main content for header shadow
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 4);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  // Apply desktop-view viewport override
  useEffect(() => {
    const applyViewport = (desktop: boolean) => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (meta) {
        meta.content = desktop
          ? "width=1280"
          : "width=device-width, initial-scale=1.0, viewport-fit=cover";
      }
    };
    applyViewport(desktopView);
  }, [desktopView]);

  const toggleDesktopView = () => {
    const next = !desktopView;
    setDesktopView(next);
    localStorage.setItem("cafa.desktopView", String(next));
  };
  const queryClient = useQueryClient();

  const { t: tNav } = useTranslation("nav");
  const { t: tCommon, i18n } = useTranslation("common");
  const { lang, setLang, direction } = useLanguage();

  // Direction-aware icons
  // In RTL: collapse points right (toward the sidebar), breadcrumb sep points left
  const CollapseIcon  = direction === "rtl" ? ChevronRight : ChevronLeft;
  const BreadcrumbSep = direction === "rtl" ? ChevronLeft  : ChevronRight;
  const SidebarExpandChevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const sidebarTooltipSide = direction === "rtl" ? "left" : "right";
  // `start-full` opens inward: it is left:100% in LTR and right:100% in RTL.
  const sidebarLogoutTooltipPosition = "start-full ms-2";

  const { data: meData } = useGetMe();
  const locationCtx = useLocationContext();
  const [mobilePicker, setMobilePicker] = useState(false);
  const { record } = useRecentItems();
  const { socket } = useSocket();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const userRoleEarly = meData?.user?.role ?? "";

  // Record page visit for recent history (user-scoped, rich metadata)
  // Placed after meData + record declarations to satisfy TDZ rules
  useEffect(() => {
    if (!meData?.user?.id) return;
    const title = staticPageTitle(location);
    const meta  = inferItemMeta(location);
    record({ type: meta.type, title, subtitle: meta.subtitle, path: location, recordId: meta.recordId, iconKey: meta.iconKey, iconBg: meta.iconBg });
    // `record` is stable (useCallback with userId dep); intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, meData?.user?.id]);
  const demoModeEnabled = demoRoleHarnessEnabled();
  const isSuperAdmin = userRoleEarly === "super_admin";
  const { data: usersData } = useListSwitcherUsers({
    query: { queryKey: getListSwitcherUsersQueryKey(), enabled: demoModeEnabled && isSuperAdmin },
  });


  const handleRoleSwitch = (userId: number) => {
    window.localStorage.setItem("cafa.userId", userId.toString());
    // Recipient-private data must never survive a demo identity change. Active
    // observers refetch with the new dev identity after this clear.
    clearNotificationQueries(queryClient);
    queryClient.clear();
    void queryClient.refetchQueries({ queryKey: ["auth", "me"], type: "active" });
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(`Logout failed with HTTP ${response.status}`);
      const body = await response.json().catch(() => null);
      if (body?.ok !== true) throw new Error("Logout response was not successful");
    } catch {
      // The server session may still be active, so keep all account-scoped
      // browser state and the current route intact for a safe retry.
      toast.error(tCommon("logoutFailed"), {
        description: tCommon("logoutFailedDescription"),
      });
      setIsLoggingOut(false);
      return;
    }

    // A confirmed server termination is the only point at which account-scoped
    // client state may be discarded. Public language and layout preferences are
    // intentionally not touched.
    socket?.disconnect();
    if (meData?.user?.id) {
      clearItems(meData.user.id);
      clearFavorites(meData.user.id);
    }
    window.localStorage.removeItem("cafa.userId");
    clearNotificationQueries(queryClient);
    queryClient.clear();
    syncService.setUserId(null);
    await Promise.allSettled([
      clearOfflineData(),
      clearAllAttachmentData(),
      setOfflineUser(null),
    ]);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.assign(`${base}/login`);
  };

  const { isInstallable, install } = usePwaInstall();
  const { pendingCount, failedCount, conflictCount, isSyncing } = useSyncContext();
  const syncBadgeCount = pendingCount + failedCount + conflictCount;

  const myPerms = meData?.permissions ?? [];
  const userRole = meData?.user?.role ?? "";
  const hasUsersPerm = myPerms.includes("*") || myPerms.includes("users.view") || myPerms.includes("users.manage");
  const canViewBudget = myPerms.includes("*") || myPerms.includes("budget.view") || myPerms.includes("budget.view.all") || myPerms.includes("budget.view.state") || myPerms.includes("budget.view.sector");
  const canViewMessages = myPerms.includes("*") || myPerms.includes("messages.view");
  const canViewFileArchive = myPerms.includes("*") ||
    myPerms.includes("program_resources.view") ||
    myPerms.includes("documents.view");
  const isAuditVisible = ["super_admin", "executive_director", "program_manager"].includes(userRole);
  const canViewAi = Boolean(meData?.user);

  const switcherUsers = usersData ?? [];

  const administrationItems: NavItem[] = [
    ...(hasUsersPerm
      ? [{ href: "/users", icon: UserCog, label: tNav("pageTitles.userManagement") }]
      : []),
    { href: "/states", icon: MapPin, label: tNav("items.states") },
    ...(isAuditVisible
      ? [{ href: "/audit-log", icon: ShieldAlert, label: tNav("items.auditLog") }]
      : []),
    ...(canViewAi
      ? [{ href: "/ai", icon: Bot, label: tNav("items.ai") }]
      : []),
  ];

  const navEntries: NavEntry[] = [
    {
      kind: "group",
      group: {
        title: tNav("groups.overview"),
        items: [
        { href: "/dashboard", icon: LayoutDashboard, label: tNav("items.dashboard") },
        ],
      },
    },
    {
      kind: "group",
      group: {
        title: tNav("groups.programmeManagement"),
        items: [
        { href: "/projects", icon: FolderKanban, label: tNav("items.projects") },
        { href: "/plans", icon: CalendarClock, label: tNav("items.planning") },
        ...(canViewBudget
          ? [{ href: "/budget", icon: PieChart, label: tNav("pageTitles.budgetAndFinance") }]
          : []),
        {
          href: "/reports",
          icon: ChartNoAxesColumn,
          label: tNav("items.reports"),
          children: [
            { href: "/reports/project",       label: tNav("items.projectReports")       },
            { href: "/reports/activity",      label: tNav("items.activityReports")      },
            { href: "/reports/program-state", label: tNav("items.stateProgrammeReports") },
            { href: "/reports/hq-sector",     label: tNav("items.hqSectorReports")      },
          ],
        },
        { href: "/risks", icon: AlertTriangle, label: tNav("pageTitles.riskRegister") },
        ],
      },
    },
    {
      kind: "group",
      group: {
        title: tNav("groups.communication"),
        items: [
        { href: "/notifications", icon: Bell, label: tNav("items.notifications") },
        ...(canViewMessages
          ? [{ href: "/messages", icon: MessageSquare, label: tNav("items.communicationCentre") }]
          : []),
        ],
      },
    },
    {
      kind: "group",
      group: {
        title: tNav("groups.dataManagement"),
        items: canViewFileArchive
          ? [{ href: "/document-management/file-archive", icon: Archive, label: tNav("items.fileArchive") }]
          : [],
      },
    },
    {
      kind: "group",
      group: {
        title: tNav("groups.administration"),
        items: administrationItems,
      },
    },
    {
      kind: "item",
      item: { href: "/manual", icon: BookOpen, label: tNav("items.systemManual") },
    },
  ];

  /* ─── Translated route → title map (derived from navigation entries) ── */
  const routeTitleMap = useMemo<Record<string, string>>(() => {
    // Seed with routes that have non-trivial paths not directly in nav
    const map: Record<string, string> = {
      "/": tNav("items.dashboard"),
      "/dashboard": tNav("items.dashboard"),
      "/planning": tNav("items.plans"),
      "/planning-dashboard": tNav("items.plans"),
      "/sync-status": tNav("items.syncStatus"),
    };
    for (const entry of navEntries) {
      const items = entry.kind === "group" ? entry.group.items : [entry.item];
      for (const item of items) {
        if (item.href && item.href !== "#") map[item.href] = item.label;
        if (item.children) {
          for (const c of item.children) map[c.href] = c.label;
        }
      }
    }
    return map;
  // navEntries changes whenever tNav language changes, so tNav dep is implicit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navEntries]);

  const pageTitle = routeTitleMap[location]
    ?? Object.entries(routeTitleMap)
         .filter(([p]) => p !== "/" && p !== "/dashboard")
         .find(([p]) => location.startsWith(p))?.[1]
    ?? "CAFA PMIS";

  const breadcrumbs = useMemo<{ label: string; href?: string }[]>(() => {
    if (location === "/" || location === "/dashboard") {
      return [{ label: tNav("items.dashboard") }];
    }
    const segments = location.split("/").filter(Boolean);
    const crumbs: { label: string; href?: string }[] = [{ label: tNav("home"), href: "/" }];
    let built = "";
    for (const seg of segments) {
      built += "/" + seg;
      const label = routeTitleMap[built]
        ?? (seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "));
      crumbs.push({ label, href: built });
    }
    if (crumbs.length > 1) crumbs[crumbs.length - 1].href = undefined;
    return crumbs;
  }, [location, routeTitleMap, tNav]);

  return (
    <RecordDetailProvider>
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">

        {/* ── Mobile overlay ─────────────────────────────────────── */}
        <div
          className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:hidden transition-opacity duration-200
            ${sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* ══════════════════════════════════════════════════════════
            SIDEBAR — White, rounded active items
            ══════════════════════════════════════════════════════════ */}
        <aside
          className={`
            fixed inset-y-0 z-50 flex flex-col bg-sidebar border-sidebar-border
            start-0 border-e
            transition-all duration-300 ease-in-out
            lg:static lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0
            ${sidebarOpen ? "" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full"}
            ${sidebarCollapsed ? "w-[60px]" : "w-[212px]"}
          `}
        >
          {/* ── Logo / brand ──────────────────────────────────────── */}
          <div className={`relative flex shrink-0 items-center border-b border-sidebar-border ${sidebarCollapsed ? "h-16 justify-center px-2" : "h-16 px-3"}`}>
            {sidebarCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { setCollapsed(false); localStorage.setItem("cafa.sidebarCollapsed", "false"); }}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                    aria-label={tNav("tooltips.expandSidebar")}
                  >
                    <img src={cafaLogo} alt={tNav("brand.name")} className="h-8 w-8 object-contain" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={sidebarTooltipSide} sideOffset={8} className="w-max whitespace-nowrap font-medium">{tNav("tooltips.platformName")}</TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex min-w-0 items-center gap-2.5 pe-10">
                <img src={cafaLogo} alt={tNav("brand.name")} className="h-9 w-9 shrink-0 object-contain" />
                <p data-testid="sidebar-brand-title" className="whitespace-nowrap text-[16px] font-medium leading-tight tracking-tight text-foreground">{tNav("brand.name")}</p>
              </div>
            )}
            {/* Mobile: close drawer  |  Desktop: collapse to icon rail */}
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="absolute end-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:hidden"
              aria-label={tNav("tooltips.closeMenu")}
            >
              <X className="h-4 w-4" />
            </button>
            {!sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => { setCollapsed(true); localStorage.setItem("cafa.sidebarCollapsed", "true"); }}
                  className="absolute end-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:flex"
                  aria-label={tNav("tooltips.collapseSidebar")}
                >
                  <CollapseIcon className="h-4 w-4" />
                </button>
            )}
          </div>

          {/* ── Nav ───────────────────────────────────────────────── */}
          <nav className="flex-1 min-h-0 overflow-y-auto px-2.5 py-3 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-sidebar-border [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/25" style={{ scrollbarWidth: "thin", scrollbarColor: "hsl(var(--border)) transparent" }}>
            {navEntries.map((entry) => {
              const visibleItems = (entry.kind === "group" ? entry.group.items : [entry.item]).filter(Boolean);
              if (visibleItems.length === 0) return null;
              return (
                <div key={entry.kind === "group" ? entry.group.title : entry.item.href} className="mb-4 last:mb-0">
                  {entry.kind === "group" && !sidebarCollapsed && (
                    <p data-testid="sidebar-group-heading" className="mb-2 px-2 text-[10px] font-medium uppercase leading-none tracking-[0.12em] text-sidebar-foreground/55 select-none">
                      {entry.group.title}
                    </p>
                  )}{entry.kind === "group" && sidebarCollapsed && <div className="my-2 border-t border-sidebar-border" />}
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const hasChildren = !!item.children?.length;
                      const isDirectlyActive = location === item.href;
                      const hasActiveChild = hasChildren &&
                        !!item.children?.some(c => location === c.href || (c.href !== "/" && location.startsWith(c.href)));
                      const isActive =
                        isDirectlyActive ||
                        (item.href !== "/" && item.href !== "#" && location.startsWith(item.href));
                      const isExpanded = hasChildren && (expandedItems.has(item.href) || hasActiveChild);

                      const iconEl = (
                        <item.icon className={`shrink-0 h-4 w-4 ${
                          (isDirectlyActive && !hasActiveChild) ? "text-primary" :
                          hasActiveChild ? "text-primary/80" :
                          isActive ? "text-primary" : "opacity-60"
                        }`} />
                      );

                      const handleClick = item.onClick
                        ? (e: React.MouseEvent) => { e.preventDefault(); item.onClick!(); }
                        : undefined;

                      // ── Collapsed mode: icon + tooltip ────────────────
                      if (sidebarCollapsed) {
                        return (
                          <Tooltip key={item.href + item.label}>
                            <TooltipTrigger asChild>
                              <Link
                                href={item.href}
                                onClick={handleClick}
                                aria-current={isDirectlyActive ? "page" : hasActiveChild ? "location" : undefined}
                                className={[
                                  "flex min-h-9 items-center justify-center rounded-lg px-2 transition-colors duration-150 ease-out w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                                  isActive
                                    ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
                                    : "text-sidebar-foreground/70 font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                ].join(" ")}
                              >
                                {iconEl}
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent side={sidebarTooltipSide} sideOffset={8} className="w-max whitespace-nowrap font-medium">{item.label}</TooltipContent>
                          </Tooltip>
                        );
                      }

                      // ── Expanded mode with children: split link + chevron ──
                      if (hasChildren) {
                        const parentRowCls = hasActiveChild
                          ? "bg-sidebar-primary/5 text-sidebar-primary"
                          : (isDirectlyActive && !hasActiveChild)
                          ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

                        return (
                          <div key={item.href + item.label}>
                            <div
                              className={`flex min-h-9 items-center rounded-lg transition-colors duration-150 ease-out ${parentRowCls}`}
                            >
                              <Link
                                href={item.href}
                                onClick={handleClick}
                                aria-current={isDirectlyActive ? "page" : undefined}
                                className={[
                                   "flex h-full min-w-0 flex-1 items-center gap-2 rounded-s-lg px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                                   "font-medium",
                                ].join(" ")}
                                title={item.label}
                              >
                                {iconEl}
                                <span className="truncate">{item.displayLabel ?? item.label}</span>
                              </Link>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(item.href)}
                                aria-expanded={isExpanded}
                                aria-label={isExpanded
                                  ? tNav("commandPalette.submenu.collapse", { label: item.label })
                                  : tNav("commandPalette.submenu.expand",   { label: item.label })}
                                className={[
                                  "shrink-0 flex items-center justify-center w-6 h-6 me-1.5 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                                   hasActiveChild
                                     ? "text-sidebar-primary/70 hover:text-sidebar-primary hover:bg-sidebar-accent"
                                    : (isDirectlyActive && !hasActiveChild)
                                     ? "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                                     : "text-sidebar-foreground/50 hover:text-sidebar-foreground",
                                ].join(" ")}
                              >
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none ${isExpanded ? "rotate-0" : "-rotate-90"}`} />
                              </button>
                            </div>
                            {isExpanded && (
                               <div className="mb-1 ms-[22px] mt-1 space-y-0.5 border-s border-sidebar-border/60 ps-2.5">
                                {item.children!.map((c) => {
                                  const childActive = location === c.href;
                                  return (
                                    <Link
                                      key={c.href}
                                      href={c.href}
                                        aria-current={childActive ? "page" : undefined}
                                      title={c.label.length > 22 ? c.label : undefined}
                                      className={[
                                        "flex items-center rounded-md px-2 min-h-[32px] py-0.5 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 truncate",
                                         childActive
                                           ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
                                           : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                      ].join(" ")}
                                    >
                                      {c.label}
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }

                      // ── Expanded mode without children: normal link ────
                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          onClick={handleClick}
                          aria-current={isActive ? "page" : undefined}
                          title={item.label}
                          className={[
                             "flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
                            isActive
                               ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
                               : "text-sidebar-foreground/70 font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          ].join(" ")}
                        >
                          {iconEl}
                          <span className="truncate">{item.displayLabel ?? item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* ── Mobile location selector — HQ-eligible roles only ────── */}
          {/* Hidden on desktop (lg+) — the header GlobalLocationSelector handles desktop.
              State-scoped roles (isEditable=false) see nothing — matching desktop behaviour. */}
          {locationCtx.isEditable && !sidebarCollapsed && (
            <div
              className="lg:hidden shrink-0 border-t border-sidebar-border px-2 py-2"
              data-testid="mobile-location-selector"
            >
              <button
                type="button"
                aria-label={`${tCommon("locationContext.activeLocation")}: ${
                  locationCtx.selectedStateId != null
                    ? (() => { const state = locationCtx.authorisedStates.find(s => s.id === locationCtx.selectedStateId); return state ? getStateLabel(state, i18n?.language) : ""; })()
                    : tCommon("locationContext.allLocations")
                }. ${tCommon("locationContext.changeLocation")}`}
                aria-expanded={mobilePicker}
                aria-haspopup="listbox"
                onClick={() => setMobilePicker(p => !p)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 min-h-[36px] text-start hover:bg-accent/50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-[12px] font-medium text-foreground/80 truncate">
                  {locationCtx.selectedStateId != null
                    ? (() => { const state = locationCtx.authorisedStates.find(s => s.id === locationCtx.selectedStateId); return state ? getStateLabel(state, i18n?.language) : tCommon("locationContext.allLocations"); })()
                    : tCommon("locationContext.allLocations")}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 ${mobilePicker ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {mobilePicker && (
                <div
                  role="listbox"
                  aria-label={tCommon("locationContext.label")}
                  className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border/60 bg-card shadow-sm"
                >
                  {/* All Locations option */}
                  <button
                    type="button"
                    role="option"
                    aria-selected={locationCtx.selectedStateId === null}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50 ${
                      locationCtx.selectedStateId === null ? "font-semibold text-primary" : "text-foreground/70"
                    }`}
                    onClick={() => { locationCtx.setSelectedStateId(null); setMobilePicker(false); }}
                  >
                    {locationCtx.selectedStateId === null && <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
                    {locationCtx.selectedStateId !== null && <span className="h-3 w-3 shrink-0" aria-hidden="true" />}
                    {tCommon("locationContext.allLocations")}
                  </button>
                  {/* State list */}
                  {locationCtx.authorisedStates.map(state => (
                    <button
                      key={state.id}
                      type="button"
                      role="option"
                      aria-selected={locationCtx.selectedStateId === state.id}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50 ${
                        locationCtx.selectedStateId === state.id ? "font-semibold text-primary" : "text-foreground/70"
                      }`}
                      onClick={() => { locationCtx.setSelectedStateId(state.id); setMobilePicker(false); }}
                    >
                      {locationCtx.selectedStateId === state.id && <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
                      {locationCtx.selectedStateId !== state.id && <span className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      {getStateLabel(state, i18n?.language)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {meData?.user && (
            <div className={`shrink-0 border-t border-sidebar-border ${sidebarCollapsed ? "flex flex-col items-center gap-1 py-2" : "px-2 py-2"}`}>
              {sidebarCollapsed ? (
                <>
                  {/* Collapsed: avatar keeps the profile/language menu, with a separate logout control. */}
                  <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent focus:outline-none focus:ring-2 focus:ring-ring"
                      aria-label={`${meData.user.name ?? "User"} — ${tNav("user.myProfile")}`}
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        {meData.user.avatarUrl && <AvatarImage src={`/api/storage${meData.user.avatarUrl}`} alt={meData.user.name ?? ""} className="object-cover" />}
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                          {meData.user.name?.substring(0, 2).toUpperCase() ?? "??"}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="end" className="w-52">
                    <DropdownMenuLabel className="font-normal py-2.5">
                      <p className="text-sm font-semibold text-foreground">{meData.user.name}</p>
                      <p className="text-xs text-muted-foreground">{meData.user.roleLabel}</p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="cursor-pointer flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {tNav("user.myProfile")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Language switcher */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="cursor-pointer">
                        <Globe className="h-4 w-4 me-2 text-muted-foreground" />
                        {tNav("language.switch")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {(["en", "ar"] as Language[]).map((code) => (
                          <DropdownMenuItem
                            key={code}
                            onSelect={() => setLang(code)}
                            className="cursor-pointer gap-2"
                          >
                            <Check className={`h-3.5 w-3.5 shrink-0 ${lang === code ? "opacity-100" : "opacity-0"}`} />
                            {code === "en" ? tNav("language.en") : tNav("language.ar")}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      data-testid="mobile-sidebar-logout"
                      className="cursor-pointer text-destructive focus:text-destructive"
                    >
                      <LogOut className="h-4 w-4 me-2" />
                      {tNav("user.signOut")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                  </DropdownMenu>
                <div className="group relative">
                      <button
                        type="button"
                        onClick={handleLogout}
                      disabled={isLoggingOut}
                      data-testid="sidebar-rail-logout"
                      aria-describedby="sidebar-logout-tooltip"
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={tNav("user.signOut")}
                        title={tNav("user.signOut")}
                      >
                        <LogOut className="h-4 w-4" />
                      </button>
                  <span
                    id="sidebar-logout-tooltip"
                    role="tooltip"
                    className={`pointer-events-none absolute top-1/2 z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${sidebarLogoutTooltipPosition}`}
                  >
                    {tNav("user.signOut")}
                  </span>
                </div>
                </>
              ) : (
                <div className="space-y-1">
                {/* Expanded: user identity menu followed by an explicit logout action. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors duration-150 hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      aria-label={`${meData.user.name ?? "User"} — ${tNav("user.myProfile")}`}
                      title={meData.user.name && meData.user.name.length > 20 ? meData.user.name : undefined}
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        {meData.user.avatarUrl && <AvatarImage src={`/api/storage${meData.user.avatarUrl}`} alt={meData.user.name ?? ""} className="object-cover" />}
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                          {meData.user.name?.substring(0, 2).toUpperCase() ?? "??"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium leading-tight text-foreground">{meData.user.name}</p>
                        <p className="mt-[1px] truncate text-[10px] leading-tight text-muted-foreground/70">{meData.user.roleLabel}</p>
                      </div>
                      <SidebarExpandChevron className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-56">
                    <DropdownMenuLabel className="font-normal py-2.5">
                      <p className="truncate text-sm font-medium text-foreground">{meData.user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{meData.user.roleLabel}</p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/profile" className="cursor-pointer flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {tNav("user.myProfile")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Language switcher */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="cursor-pointer">
                        <Globe className="h-4 w-4 me-2 text-muted-foreground" />
                        {tNav("language.switch")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {(["en", "ar"] as Language[]).map((code) => (
                          <DropdownMenuItem
                            key={code}
                            onSelect={() => setLang(code)}
                            className="cursor-pointer gap-2"
                          >
                            <Check className={`h-3.5 w-3.5 shrink-0 ${lang === code ? "opacity-100" : "opacity-0"}`} />
                            {code === "en" ? tNav("language.en") : tNav("language.ar")}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      data-testid="sidebar-profile-logout"
                      className="cursor-pointer text-destructive focus:text-destructive"
                    >
                      <LogOut className="h-4 w-4 me-2" />
                      {tNav("user.signOut")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    data-testid="sidebar-footer-logout"
                    className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={tNav("user.signOut")}
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    <span>{tNav("user.signOut")}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ══════════════════════════════════════════════════════════
            MAIN CONTENT AREA
            ══════════════════════════════════════════════════════════ */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

          {/* ══════════════════════════════════════════════════════
              HEADER — sticky, clean, premium
              ══════════════════════════════════════════════════════ */}
          <header className={`
            sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between
            bg-background/95 backdrop-blur-sm border-b border-border
            px-4 sm:px-6 gap-4 transition-shadow duration-200
            ${scrolled ? "shadow-sm" : ""}
          `}>

            {/* Left: hamburger (mobile) + breadcrumb/title */}
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors duration-150"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>

              {/* Breadcrumb — show on md+, plain title on mobile */}
              <div className="min-w-0">
                {breadcrumbs.length > 2 ? (
                  <nav className="hidden md:flex items-center gap-1 text-sm" aria-label={tCommon("breadcrumb")}>
                    {breadcrumbs.map((crumb, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <BreadcrumbSep className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                        {crumb.href ? (
                          <Link href={crumb.href} className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors duration-150 truncate max-w-[120px]">
                            {crumb.label}
                          </Link>
                        ) : (
                          <span className="text-sm font-semibold text-foreground truncate max-w-[160px]">{crumb.label}</span>
                        )}
                      </span>
                    ))}
                  </nav>
                ) : null}
                <h1 className={`font-semibold text-foreground truncate leading-tight ${breadcrumbs.length > 2 ? "text-sm md:hidden" : "text-[15px]"}`}>
                  {pageTitle}
                </h1>
              </div>

              {/* Live date & time — desktop/tablet only (hidden on mobile) */}
              {/* border-s/ps-3/ms-0.5: logical start border/padding/margin */}
              <div className="hidden md:flex items-center gap-2 shrink-0 border-s border-border/40 ps-3 ms-0.5">
                <LiveClock timezone={(meData?.user as unknown as Record<string, string | undefined>)?.timezone} />
              </div>
            </div>

            {/* Center: search */}
            <div className="hidden md:flex flex-1 max-w-[420px] mx-4">
              <GlobalSearch />
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-0.5 shrink-0">

              <GlobalLanguageSwitcher />

              {/* Global location scope selector — HQ roles only, hidden on mobile */}
              <div className="hidden md:flex me-1">
                <GlobalLocationSelector />
              </div>

              {/* Notification bell */}
              <NotificationsBell />

              {/* Messages */}
              <MessagesDropdown />

              {/* Desktop View toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 lg:hidden text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors duration-150"
                    onClick={toggleDesktopView}
                    aria-label={desktopView ? "Switch to Mobile View" : "Switch to Desktop View"}
                  >
                    <MonitorSmartphone className={`h-4 w-4 ${desktopView ? "text-primary" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {desktopView ? "Switch to Mobile View" : "Switch to Desktop View"}
                </TooltipContent>
              </Tooltip>

              {/* Sync status */}
              {syncBadgeCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`relative h-9 w-9 ${failedCount > 0 || conflictCount > 0 ? "text-red-500 hover:text-red-600" : "text-amber-500 hover:text-amber-600"}`}
                        onClick={() => navigate("/sync-status")}
                        aria-label={tNav("items.syncStatus")}
                      >
                        {isSyncing
                          ? <RefreshCw className="h-4 w-4 animate-spin" />
                          : failedCount > 0 || conflictCount > 0
                          ? <CloudOff className="h-4 w-4" />
                          : <RefreshCw className="h-4 w-4" />
                        }
                        {/* -end-0.5: logical end positioning (right in LTR, left in RTL) */}
                        <span className={`absolute -top-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold text-white ${failedCount > 0 || conflictCount > 0 ? "bg-red-500" : "bg-amber-500"}`}>
                          {syncBadgeCount > 9 ? "9+" : syncBadgeCount}
                        </span>
                      </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {isSyncing
                      ? tCommon("sync.syncingItems", { count: pendingCount })
                      : failedCount > 0
                      ? tCommon("sync.syncFailures", { count: failedCount })
                      : tCommon("sync.offlineChangesPending", { count: pendingCount })
                    }
                  </TooltipContent>
                </Tooltip>
              )}

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-9 w-auto rounded-full ps-1 pe-2.5 flex items-center gap-2 hover:bg-accent/80 ms-1 transition-colors duration-150"
                    aria-label={`${meData?.user?.name ?? "User"} — ${tNav("user.myProfile")}`}
                  >
                    <Avatar className="h-7 w-7">
                      {meData?.user?.avatarUrl && <AvatarImage src={`/api/storage${meData.user.avatarUrl}`} alt={meData.user.name ?? ""} className="object-cover" />}
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                        {meData?.user?.name?.substring(0, 2).toUpperCase() ?? "??"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden sm:flex flex-col items-start leading-tight">
                      <span className="text-sm font-semibold text-foreground">{meData?.user?.name ?? tCommon("loading")}</span>
                      <span className="text-xs text-muted-foreground/80">{meData?.user?.roleLabel ?? tCommon("role")}</span>
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {meData?.user?.avatarUrl && <AvatarImage src={`/api/storage${meData.user.avatarUrl}`} alt={meData.user.name ?? ""} className="object-cover" />}
                        <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                          {meData?.user?.name?.substring(0, 2).toUpperCase() ?? "??"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col space-y-0.5">
                        <p className="text-sm font-semibold text-foreground">{meData?.user?.name}</p>
                        <p className="text-xs text-muted-foreground">{meData?.user?.email}</p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {tNav("user.myProfile")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/notification-preferences" className="cursor-pointer flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      {tNav("user.notificationPreferences")}
                    </Link>
                  </DropdownMenuItem>
                  {isInstallable && (
                    <DropdownMenuItem onClick={install} className="cursor-pointer flex items-center gap-2">
                      <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
                      {tNav("user.installApp")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      data-testid="header-language-switcher"
                      className="cursor-pointer"
                    >
                      <Globe className="h-4 w-4 me-2 text-muted-foreground" />
                      {tNav("language.switch")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {(["en", "ar"] as Language[]).map((code) => (
                        <DropdownMenuItem
                          key={code}
                          data-testid={`header-language-${code}`}
                          onSelect={() => setLang(code)}
                          className="cursor-pointer gap-2"
                        >
                          <Check className={`h-3.5 w-3.5 shrink-0 ${lang === code ? "opacity-100" : "opacity-0"}`} />
                          {code === "en" ? tNav("language.en") : tNav("language.ar")}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    data-testid="header-profile-logout"
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4 me-2" />
                    {tNav("user.signOut")}
                  </DropdownMenuItem>
                  {demoModeEnabled && isSuperAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="font-normal">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {tNav("development.switchUser")}
                        </p>
                      </DropdownMenuLabel>
                      <div className="max-h-60 overflow-y-auto">
                        {switcherUsers.map((u) => (
                          <DropdownMenuItem
                            key={u.id}
                            onClick={() => handleRoleSwitch(u.id)}
                            className={`flex items-center gap-2 cursor-pointer ${u.id === meData?.user?.id ? "bg-accent" : ""}`}
                          >
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="font-medium text-sm truncate">{u.name}</span>
                              <span className="text-xs text-muted-foreground">{u.roleLabel} · {u.scope.toUpperCase()}</span>
                            </div>
                            {u.id === meData?.user?.id && (
                              <CheckCircle2 className="shrink-0 h-4 w-4 text-primary" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </div>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* ── Page content ─────────────────────────────────────── */}
          <main ref={mainRef} className="flex-1 overflow-y-auto p-4 md:p-5 lg:p-6 xl:p-8 page-enter">
            {children}
          </main>
        </div>
      </div>
      {/* ── AI Chat Widget ───────────────────────────────────── */}
      <AIChatWidget />
      {/* ── Command Palette ──────────────────────────────────── */}
      <CommandPalette />
    </TooltipProvider>
    </RecordDetailProvider>
  );
}
