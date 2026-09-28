import { Fragment, useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
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
  Check,
  Search,
} from "@/components/icons";
import { AppLayout as ShellLayout } from "@heroui-pro/react/app-layout";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { Navbar } from "@heroui-pro/react/navbar";
import { Avatar, Breadcrumbs, Button, Dropdown, Label, RouterProvider, Separator, type Key } from "@heroui/react";
import { LiveClock } from "@/components/live-clock";
import { AIChatWidget } from "@/components/ai-chat-widget";
import { CommandPalette } from "@/components/command-palette";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { stopAuthenticatedBackgroundWork, useSyncContext } from "@/contexts/sync-context";
import { clearApiCache, clearOfflineData, setOfflineUser } from "@/lib/offline/db";
import { clearAllAttachmentData } from "@/lib/offline/attachment-store";
import { syncService } from "@/lib/offline/sync-service";
import { inferItemMeta, clearItems } from "@/lib/recent-items";
import { clearFavorites } from "@/lib/favorites";
import { clearNotificationQueries } from "@/lib/notification-client";
import { useSocket } from "@/lib/socket";
import { invalidateAuthenticatedSession } from "@/lib/authenticated-session";
import { useRecentItems } from "@/hooks/use-recent-items";
import cafaLogo from "@/assets/cafa-icon.png";
import {
  demoRoleHarnessEnabled,
  useGetMe,
  useListSwitcherUsers,
  getListSwitcherUsersQueryKey,
} from "@workspace/api-client-react";
import { useLanguage, type Language } from "@/contexts/language-context";
import { NotificationsBell } from "@/components/notifications-bell";
import { MessagesDropdown } from "@/components/messages-dropdown";
import { GlobalSearch } from "@/components/global-search";
import { GlobalLocationSelector } from "@/components/global-location-selector";
import { GlobalLanguageSwitcher } from "@/components/global-language-switcher";
import { useLocationContext } from "@/contexts/location-context";
import { RecordDetailProvider } from "@/contexts/record-detail-context";
import { TooltipProvider } from "@/components/ui/tooltip";

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

type ShellUser = { name?: string | null; email?: string | null; roleLabel?: string | null; avatarUrl?: string | null };

function UserAvatar({ user, className = "size-7" }: { user: ShellUser | undefined; className?: string }) {
  return (
    // Soft avatar as in the Pro navbar examples (brand accent instead of the
    // demo's green).
    <Avatar className={`shrink-0 ${className}`} color="accent" variant="soft">
      {user?.avatarUrl && <Avatar.Image src={`/api/storage${user.avatarUrl}`} alt={user.name ?? ""} className="object-cover" />}
      <Avatar.Fallback className="text-xs font-semibold">
        {user?.name?.substring(0, 2).toUpperCase() ?? "??"}
      </Avatar.Fallback>
    </Avatar>
  );
}

/**
 * Navigation tree shared by the desktop sidebar and the mobile sheet, so the
 * two can never drift apart. Group labels and item labels hide automatically
 * in the collapsed icon rail, where each item shows its label as a tooltip.
 */
function SidebarNavigation({
  entries, location, expandedKeys, onExpandedChange, menuLabel,
}: {
  entries: NavEntry[];
  location: string;
  expandedKeys: Set<Key>;
  onExpandedChange: (keys: Set<Key>) => void;
  menuLabel: (entry: NavEntry) => string;
}) {
  // Groups are divided by a Sidebar.Separator between them, as in the Pro
  // "With Groups" example; a standalone item (the manual) is a label-less
  // group after the same divider.
  const visibleEntries = entries.filter((entry) =>
    (entry.kind === "group" ? entry.group.items : [entry.item]).some(Boolean));
  return (
    <>
      {visibleEntries.map((entry, index) => {
        const visibleItems = (entry.kind === "group" ? entry.group.items : [entry.item]).filter(Boolean);
        const key = entry.kind === "group" ? entry.group.title : entry.item.href;
        return (
          <Fragment key={key}>
            {index > 0 && <Sidebar.Separator />}
            <Sidebar.Group>
              {entry.kind === "group" && <Sidebar.GroupLabel data-testid="sidebar-group-heading">{entry.group.title}</Sidebar.GroupLabel>}
              <Sidebar.Menu aria-label={menuLabel(entry)} expandedKeys={expandedKeys} onExpandedChange={onExpandedChange}>
                {visibleItems.map((item) => {
                  const hasChildren = !!item.children?.length;
                  const isDirectlyActive = location === item.href;
                  const isActive = isDirectlyActive || (item.href !== "/" && item.href !== "#" && location.startsWith(item.href));
                  return (
                    <Sidebar.MenuItem
                      key={item.href}
                      id={item.href}
                      href={item.href}
                      textValue={item.label}
                      isCurrent={hasChildren ? isDirectlyActive : isActive}
                    >
                      <Sidebar.MenuIcon><item.icon className="size-4" aria-hidden /></Sidebar.MenuIcon>
                      <Sidebar.MenuLabel>
                        {item.displayLabel ?? item.label}
                        {hasChildren && (
                          <Sidebar.MenuTrigger>
                            <Sidebar.MenuIndicator />
                          </Sidebar.MenuTrigger>
                        )}
                      </Sidebar.MenuLabel>
                      {hasChildren && (
                        <Sidebar.Submenu>
                          {item.children!.map((c) => (
                            <Sidebar.MenuItem key={c.href} id={c.href} href={c.href} textValue={c.label} isCurrent={location === c.href}>
                              <Sidebar.MenuLabel>{c.label}</Sidebar.MenuLabel>
                            </Sidebar.MenuItem>
                          ))}
                        </Sidebar.Submenu>
                      )}
                    </Sidebar.MenuItem>
                  );
                })}
              </Sidebar.Menu>
            </Sidebar.Group>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Footer actions of the desktop sidebar and the mobile sheet, as in the HeroUI
 * Pro examples (plain icon + label rows). The signed-in user is shown by the
 * navbar avatar menu, as in Pro.
 */
function SidebarAccount({
  onLogout, isLoggingOut, labels,
}: {
  onLogout: () => void;
  isLoggingOut: boolean;
  labels: { account: string; signOut: string };
}) {
  return (
    <Sidebar.Menu aria-label={labels.account}>
      <Sidebar.MenuItem
        id="sign-out"
        textValue={labels.signOut}
        onAction={onLogout}
        isDisabled={isLoggingOut}
        data-testid="sidebar-footer-logout"
      >
        <Sidebar.MenuIcon><LogOut className="size-4" aria-hidden /></Sidebar.MenuIcon>
        <Sidebar.MenuLabel>{labels.signOut}</Sidebar.MenuLabel>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  );
}

/**
 * Location scope picker for the mobile sheet (HQ-eligible roles only). The
 * header GlobalLocationSelector is hidden below md, where this replaces it.
 */
function MobileLocationPicker() {
  const locationCtx = useLocationContext();
  const { t: tCommon, i18n } = useTranslation("common");
  const [mobilePicker, setMobilePicker] = useState(false);
  if (!locationCtx.isEditable) return null;
  const selectedLabel = locationCtx.selectedStateId != null
    ? (() => { const state = locationCtx.authorisedStates.find(s => s.id === locationCtx.selectedStateId); return state ? getStateLabel(state, i18n?.language) : tCommon("locationContext.allLocations"); })()
    : tCommon("locationContext.allLocations");
  return (
    <div className="border-t border-sidebar-border px-2 py-2" data-testid="mobile-location-selector">
      <button
        type="button"
        aria-label={`${tCommon("locationContext.activeLocation")}: ${selectedLabel}. ${tCommon("locationContext.changeLocation")}`}
        aria-expanded={mobilePicker}
        aria-haspopup="listbox"
        onClick={() => setMobilePicker(p => !p)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 min-h-[36px] text-start hover:bg-accent/50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-[12px] font-medium text-foreground/80 truncate">{selectedLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 ${mobilePicker ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {mobilePicker && (
        <div role="listbox" aria-label={tCommon("locationContext.label")} className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border/60 bg-card shadow-sm">
          {[{ id: null as number | null, label: tCommon("locationContext.allLocations") }, ...locationCtx.authorisedStates.map(state => ({ id: state.id as number | null, label: getStateLabel(state, i18n?.language) }))].map(option => {
            const selected = locationCtx.selectedStateId === option.id;
            return (
              <button
                key={option.id ?? "all"}
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50 ${selected ? "font-semibold text-primary" : "text-foreground/70"}`}
                onClick={() => { locationCtx.setSelectedStateId(option.id); setMobilePicker(false); }}
              >
                {selected ? <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" /> : <span className="h-3 w-3 shrink-0" aria-hidden="true" />}
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Main layout ────────────────────────────────────────────────────── */
export function AppLayout({ children }: { children: React.ReactNode }) {
  // Persisted desktop preference for the icon rail (same key as before the
  // HeroUI Pro shell, so existing users keep their choice).
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("cafa.sidebarCollapsed") === "true"
  );
  const sidebarCollapsed = collapsed;
  const setSidebarOpen = (open: boolean) => {
    setCollapsed(!open);
    localStorage.setItem("cafa.sidebarCollapsed", String(!open));
  };
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(new Set());
  const [location, navigate] = useLocation();
  const [desktopView, setDesktopView] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("cafa.desktopView") === "true"
  );

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
  const { t: tCommon } = useTranslation("common");
  const { lang, setLang, direction } = useLanguage();

  // Direction-aware shell: HeroUI Pro positions the sidebar physically
  // (sidebarSide), so it follows the reading direction explicitly.
  const isRtl = direction === "rtl";
  const BreadcrumbSep = isRtl ? ChevronLeft : ChevronRight;

  const { data: meData } = useGetMe();
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
    const formerUserId = meData?.user?.id;
    window.localStorage.setItem("cafa.userId", userId.toString());
    // Recipient-private data must never survive a demo identity change. Active
    // observers refetch with the new dev identity after this clear.
    clearNotificationQueries(queryClient);
    queryClient.clear();
    void (async () => {
      if (formerUserId) await clearApiCache(formerUserId);
      window.location.reload();
    })();
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
    invalidateAuthenticatedSession();
    stopAuthenticatedBackgroundWork();
    await queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
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
      // Parent segment of the File & Archive route (it redirects there); without
      // a label the breadcrumb fell back to the raw English path "Document management".
      "/document-management": tNav("groups.dataManagement"),
      // Reached from the header, not the sidebar; the breadcrumb showed "Messages".
      "/messages": tNav("items.communicationCentre"),
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
      const parent = built;
      built += "/" + seg;
      // A record id (/projects/31) is named by its record type, not its number.
      const recordLabel = /^\d+$/.test(seg)
        ? parent === "/projects" ? tCommon("recordDetails.projectTitle")
          : parent === "/plans" ? tCommon("recordDetails.planTitle")
          : parent === "/messages" ? tCommon("recordDetails.conversationTitle")
          : tCommon("recordDetails.title")
        : undefined;
      const label = routeTitleMap[built]
        ?? recordLabel
        ?? (seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "));
      crumbs.push({ label, href: built });
    }
    if (crumbs.length > 1) crumbs[crumbs.length - 1].href = undefined;
    return crumbs;
  }, [location, routeTitleMap, tNav, tCommon]);

  // Icon of the navigation entry the current page belongs to (longest match),
  // shown on the last breadcrumb as in the Pro "With Breadcrumbs" example.
  let currentNavItem: NavItem | undefined;
  for (const entry of navEntries) {
    for (const item of entry.kind === "group" ? entry.group.items : [entry.item]) {
      if (!item) continue;
      const hit = location === item.href || (item.href !== "/" && location.startsWith(item.href + "/"))
        || (item.href === "/" && location === "/dashboard");
      if (hit && (!currentNavItem || item.href.length > currentNavItem.href.length)) currentNavItem = item;
    }
  }
  const CurrentIcon = currentNavItem?.icon;

  // A Reports child route keeps its parent expanded, as before.
  const reportsChildActive = location.startsWith("/reports/");
  const effectiveExpandedKeys = useMemo(
    () => (reportsChildActive ? new Set<Key>([...expandedKeys, "/reports"]) : expandedKeys),
    [expandedKeys, reportsChildActive],
  );
  const navMenuLabel = (entry: NavEntry) => (entry.kind === "group" ? entry.group.title : entry.item.label);
  const accountLabels = { account: tNav("user.myProfile"), signOut: tNav("user.signOut") };

  // In the icon rail the title hides (data-sidebar="label") and the logo
  // carries the product name as a tooltip instead.
  const brand = (
    <Sidebar.Tooltip content={tNav("tooltips.platformName")} placement={isRtl ? "left" : "right"}>
      <div className="flex min-w-0 items-center gap-3 px-1 py-2">
        <img src={cafaLogo} alt={tNav("brand.name")} className="size-6 shrink-0 object-contain" />
        <span data-testid="sidebar-brand-title" data-sidebar="label" className="text-foreground truncate text-sm font-semibold">{tNav("brand.name")}</span>
      </div>
    </Sidebar.Tooltip>
  );
  const navigation = (
    <SidebarNavigation
      entries={navEntries}
      location={location}
      expandedKeys={effectiveExpandedKeys}
      onExpandedChange={setExpandedKeys}
      menuLabel={navMenuLabel}
    />
  );

  const onUserMenuAction = (key: Key) => {
    if (key === "profile") navigate("/profile");
    else if (key === "notification-preferences") navigate("/notification-preferences");
    else if (key === "install") void install();
    else if (key === "lang-en") setLang("en");
    else if (key === "lang-ar") setLang("ar");
    else if (key === "sign-out") void handleLogout();
    else if (typeof key === "string" && key.startsWith("switch-")) handleRoleSwitch(Number(key.slice("switch-".length)));
  };

  return (
    <RecordDetailProvider>
    <TooltipProvider delayDuration={200}>
    {/* Every React Aria link in the shell and the pages (sidebar, navbar,
        breadcrumbs, menus) routes through wouter instead of reloading. */}
    <RouterProvider navigate={navigate}>
      <ShellLayout
        navigate={navigate}
        sidebarSide={isRtl ? "right" : "left"}
        sidebarOpen={!sidebarCollapsed}
        onSidebarOpenChange={setSidebarOpen}
        scrollMode="content"
        sidebar={
          <>
            <Sidebar>
              <Sidebar.Header>{brand}</Sidebar.Header>
              <Sidebar.Content>{navigation}</Sidebar.Content>
              {meData?.user && (
                <Sidebar.Footer>
                  <SidebarAccount onLogout={handleLogout} isLoggingOut={isLoggingOut} labels={accountLabels} />
                </Sidebar.Footer>
              )}
              <Sidebar.Rail />
            </Sidebar>
            <Sidebar.Mobile>
              <Sidebar.Header>{brand}</Sidebar.Header>
              <Sidebar.Content>{navigation}</Sidebar.Content>
              <MobileLocationPicker />
              {meData?.user && (
                <Sidebar.Footer>
                  <SidebarAccount onLogout={handleLogout} isLoggingOut={isLoggingOut} labels={accountLabels} />
                </Sidebar.Footer>
              )}
            </Sidebar.Mobile>
          </>
        }
        navbar={
          <Navbar maxWidth="full">
            <Navbar.Header>
              <ShellLayout.MenuToggle className="shrink-0" aria-label={tNav("tooltips.openMenu")} />
              <Sidebar.Trigger className="shrink-0" aria-label={sidebarCollapsed ? tNav("tooltips.expandSidebar") : tNav("tooltips.collapseSidebar")} />

              {/* Page trail, as in the Pro "With Breadcrumbs" example: earlier
                  crumbs muted (middle ones hidden on phones), the current page
                  semibold with its navigation icon. */}
              <Breadcrumbs className="min-w-0 max-w-[40%] shrink-0" aria-label={tCommon("breadcrumb")} separator={<BreadcrumbSep className="size-3.5 text-[var(--muted)]" aria-hidden />}>
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  const isMiddle = !isLast && index > 0;
                  return (
                    <Breadcrumbs.Item
                      key={`${crumb.label}-${index}`}
                      href={isLast ? undefined : crumb.href}
                      className={`min-w-0 ${isLast ? "font-semibold" : "text-[var(--muted)]"} ${isMiddle ? "hidden md:flex" : ""}`}
                    >
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                        {isLast && CurrentIcon ? <CurrentIcon className="size-4 shrink-0" aria-hidden /> : null}
                        <span className="truncate" {...(isLast ? { "data-testid": "shell-page-title" } : {})}>{isLast && !/\/\d+$/.test(location) ? pageTitle : crumb.label}</span>
                      </span>
                    </Breadcrumbs.Item>
                  );
                })}
              </Breadcrumbs>

              <Navbar.Spacer />

              {/* Search, centred between the trail and the actions */}
              <div className="hidden lg:flex min-w-0 flex-[0_1_420px]">
                <GlobalSearch />
              </div>

              <Navbar.Spacer />

              {/* Live date & time — desktop/tablet only */}
              <div className="hidden md:flex items-center">
                <LiveClock timezone={(meData?.user as unknown as Record<string, string | undefined>)?.timezone} />
              </div>

              {/* Global location scope selector — HQ roles only, hidden on mobile */}
              <div className="hidden md:flex items-center">
                <GlobalLocationSelector />
              </div>

              <Navbar.Content className="gap-0">
                {/* Where the inline field does not fit (md–lg), search is an
                    icon item opening the command palette, as in the Pro
                    AppLayout example. */}
                <Navbar.Item
                  className="hidden md:flex lg:hidden"
                  aria-label={tCommon("globalSearch.openCommandPalette")}
                  onClick={() => document.dispatchEvent(new CustomEvent("open-command-palette"))}
                >
                  <Search className="size-4" aria-hidden />
                </Navbar.Item>
                <GlobalLanguageSwitcher />
                <NotificationsBell />
                <MessagesDropdown />

                {/* Desktop View toggle (touch/narrow viewports) */}
                <Navbar.Item
                  className="lg:hidden"
                  onClick={toggleDesktopView}
                  aria-label={desktopView ? "Switch to Mobile View" : "Switch to Desktop View"}
                  aria-pressed={desktopView}
                >
                  <MonitorSmartphone className={`size-4 ${desktopView ? "text-[var(--accent)]" : ""}`} aria-hidden />
                </Navbar.Item>

                {/* Sync status */}
                {syncBadgeCount > 0 && (
                  <Navbar.Item
                    onClick={() => navigate("/sync-status")}
                    aria-label={`${tNav("items.syncStatus")}: ${
                      isSyncing
                        ? tCommon("sync.syncingItems", { count: pendingCount })
                        : failedCount > 0
                        ? tCommon("sync.syncFailures", { count: failedCount })
                        : tCommon("sync.offlineChangesPending", { count: pendingCount })
                    }`}
                    className={failedCount > 0 || conflictCount > 0 ? "text-[var(--danger)]" : "text-[var(--warning)]"}
                  >
                    {isSyncing
                      ? <RefreshCw className="size-4 animate-spin" aria-hidden />
                      : failedCount > 0 || conflictCount > 0
                      ? <CloudOff className="size-4" aria-hidden />
                      : <RefreshCw className="size-4" aria-hidden />
                    }
                    {/* -end-0.5: logical end positioning (right in LTR, left in RTL) */}
                    <span className={`absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ${failedCount > 0 || conflictCount > 0 ? "bg-[var(--danger)]" : "bg-[var(--warning)]"}`} aria-hidden>
                      {syncBadgeCount > 9 ? "9+" : syncBadgeCount}
                    </span>
                  </Navbar.Item>
                )}

                <Navbar.Separator className="mx-2" />

                {/* User menu */}
                <Dropdown>
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label={`${meData?.user?.name ?? "User"} — ${tNav("user.myProfile")}`}
                  >
                    <UserAvatar user={meData?.user} />
                  </Button>
                  <Dropdown.Popover placement="bottom end" className="min-w-[200px]">
                    {/* Identity header, as in the Pro "With Avatar" example */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <UserAvatar user={meData?.user} className="size-8" />
                      <div className="flex min-w-0 flex-col">
                        <span className="text-foreground truncate text-sm font-medium leading-tight">{meData?.user?.name}</span>
                        <span className="text-[var(--muted)] truncate text-xs leading-tight">{meData?.user?.roleLabel ?? meData?.user?.email}</span>
                      </div>
                    </div>
                    <Separator />
                    <Dropdown.Menu aria-label={tNav("user.myProfile")} onAction={onUserMenuAction}>
                      <Dropdown.Item id="profile" textValue={tNav("user.myProfile")}>
                        <User className="text-[var(--muted)] size-4" aria-hidden />
                        <Label>{tNav("user.myProfile")}</Label>
                      </Dropdown.Item>
                      <Dropdown.Item id="notification-preferences" textValue={tNav("user.notificationPreferences")}>
                        <Settings className="text-[var(--muted)] size-4" aria-hidden />
                        <Label>{tNav("user.notificationPreferences")}</Label>
                      </Dropdown.Item>
                      {isInstallable ? (
                        <Dropdown.Item id="install" textValue={tNav("user.installApp")}>
                          <MonitorSmartphone className="text-[var(--muted)] size-4" aria-hidden />
                          <Label>{tNav("user.installApp")}</Label>
                        </Dropdown.Item>
                      ) : null}
                      <Dropdown.Section aria-label={tNav("language.switch")} data-testid="header-language-switcher">
                        {(["en", "ar"] as Language[]).map((code) => (
                          <Dropdown.Item key={code} id={`lang-${code}`} textValue={code === "en" ? tNav("language.en") : tNav("language.ar")} data-testid={`header-language-${code}`}>
                            <Check className={`h-3.5 w-3.5 shrink-0 ${lang === code ? "opacity-100" : "opacity-0"}`} aria-hidden />
                            <Label>{code === "en" ? tNav("language.en") : tNav("language.ar")}</Label>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Section>
                      <Dropdown.Item id="sign-out" textValue={tNav("user.signOut")} variant="danger" isDisabled={isLoggingOut} data-testid="header-profile-logout">
                        <LogOut className="size-4" aria-hidden />
                        <Label>{tNav("user.signOut")}</Label>
                      </Dropdown.Item>
                      {demoModeEnabled && isSuperAdmin ? (
                        <Dropdown.Section aria-label={tNav("development.switchUser")}>
                          {switcherUsers.map((u) => (
                            <Dropdown.Item key={u.id} id={`switch-${u.id}`} textValue={u.name} className={u.id === meData?.user?.id ? "bg-accent" : ""}>
                              <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">{u.name}</span>
                                <span className="text-xs text-muted-foreground">{u.roleLabel} · {u.scope.toUpperCase()}</span>
                              </div>
                              {u.id === meData?.user?.id && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Section>
                      ) : null}
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </Navbar.Content>
            </Navbar.Header>
          </Navbar>
        }
      >
        <div className="p-4 md:p-5 lg:p-6 xl:p-8 page-enter">
          {children}
        </div>
      </ShellLayout>
      {/* ── AI Chat Widget ───────────────────────────────────── */}
      <AIChatWidget />
      {/* ── Command Palette ──────────────────────────────────── */}
      <CommandPalette />
    </RouterProvider>
    </TooltipProvider>
    </RecordDetailProvider>
  );
}
