import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Chip, SearchField, Skeleton, Tabs } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import {
  Activity, AlertCircle, CheckCircle2, CircleFill, CircleOff, Clock, FilterX, Mail, RefreshCw, Users as UsersIcon, Wifi,
} from "@/components/icons";
import { useGetMe, useListUsers, getListUsersQueryKey } from "@workspace/api-client-react";
import { FilterKpi } from "@/components/filter-kpi";
import { SelectField } from "@/components/select-field";
import { RegistryPagination } from "@/components/registry-pagination";
import { ErrorState } from "@/components/ui/error-state";
import { getLinkedStateLabel } from "@/components/state-label";
import { formatDateTime } from "@/lib/format";
import { useSocket } from "@/lib/socket";

type EmailStatus = "pending" | "sent" | "failed";

type EmailLogEntry = {
  id: number;
  emailTo: string;
  emailType: string;
  subject: string;
  status: EmailStatus;
  providerName: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  userId: number | null;
  userName: string | null;
};

type EmailLogPage = { items: EmailLogEntry[]; total: number; limit: number; offset: number };

type PresenceUser = {
  id: number;
  name: string;
  email?: string | null;
  role: string;
  roleLabel?: string | null;
  stateId?: number | null;
  stateName?: string | null;
  stateNameAr?: string | null;
  isOnline?: boolean;
  lastSeenAt?: string | null;
};

type Tab = "email" | "presence";
type PresenceFilter = "" | "online" | "offline";

const PAGE_SIZE = 25;
const STATUSES: EmailStatus[] = ["sent", "failed", "pending"];
const STATUS_COLOR: Record<EmailStatus, "success" | "danger" | "warning"> = { sent: "success", failed: "danger", pending: "warning" };
// The presence list is one sorted page (online first); 200 covers every account.
const PRESENCE_PARAMS = { limit: 200 };

async function fetchEmailLogs(params: Record<string, string>): Promise<EmailLogPage> {
  const r = await fetch(`/api/admin/email-logs?${new URLSearchParams(params)}`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Waits until typing pauses, so the search doesn't fire a request per keystroke. */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Re-renders every minute so "5 minutes ago" stays true while the page is open. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

/** Relative time in the interface language, with Western digits. */
function relativeTime(iso: string, language: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const rtf = new Intl.RelativeTimeFormat(language === "ar" ? "ar-u-nu-latn" : "en-GB", { numeric: "auto" });
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

function PresenceValue({ isOnline, lastSeenAt }: { isOnline: boolean; lastSeenAt?: string | null }) {
  const { t, i18n } = useTranslation("users");
  const label = isOnline
    ? t("presence.online")
    : lastSeenAt
      ? t("presence.offlineLastSeen", { time: relativeTime(lastSeenAt, i18n.language) })
      : t("presence.offline");
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      {isOnline
        ? <CircleFill className="size-2.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
        : <CircleOff className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />}
      <span className={`truncate ${isOnline ? "font-medium text-[var(--success)]" : "text-[var(--muted)]"}`} title={label}>{label}</span>
    </span>
  );
}

function EmptyGrid({ icon: Icon, message, hint }: { icon: typeof Mail; message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-[var(--muted)]">
      <Icon className="size-8 opacity-40" aria-hidden="true" />
      <p className="text-sm font-medium">{message}</p>
      {hint && <p className="text-xs">{hint}</p>}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
    </div>
  );
}

export default function SystemMonitoringPage() {
  const { t, i18n } = useTranslation(["settings", "users"]);
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const { socket } = useSocket();
  const myPerms = me?.permissions ?? [];
  const canView = myPerms.includes("*") || myPerms.includes("system.monitoring.view");
  useMinuteTick();

  const [tab, setTab] = useState<Tab>("email");

  // ── Email log ──────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [status, setStatus] = useState<"" | EmailStatus>("");
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [search]);

  const logsQuery = useQuery({
    queryKey: ["admin-email-logs", "page", search, status, offset],
    queryFn: () => fetchEmailLogs({
      limit: String(PAGE_SIZE), offset: String(offset),
      ...(search ? { search } : {}), ...(status ? { status } : {}),
    }),
    enabled: canView && tab === "email",
    placeholderData: (previous) => previous,
  });

  // Exact counts per status for the current search: the API's filtered total,
  // one row each, so the KPIs never count only the rows on screen.
  const countsQuery = useQuery({
    queryKey: ["admin-email-logs", "counts", search],
    queryFn: async () => {
      const base = { limit: "1", ...(search ? { search } : {}) };
      const [all, ...byStatus] = await Promise.all([
        fetchEmailLogs(base),
        ...STATUSES.map((s) => fetchEmailLogs({ ...base, status: s })),
      ]);
      return { all: all.total, sent: byStatus[0].total, failed: byStatus[1].total, pending: byStatus[2].total };
    },
    enabled: canView && tab === "email",
  });

  const toggleStatus = (next: EmailStatus) => { setStatus((cur) => (cur === next ? "" : next)); setOffset(0); };
  const clearEmailFilters = () => { setSearchInput(""); setStatus(""); setOffset(0); };
  const hasEmailFilters = Boolean(searchInput || status);

  const emailTypeLabel = (kind: string) =>
    t(`systemMonitoring.emailTypes.${kind}`, { defaultValue: kind.replace(/_/g, " ") });

  const emailColumns: DataGridColumn<EmailLogEntry>[] = [
    { id: "recipient", header: t("systemMonitoring.colRecipient"), isRowHeader: true, width: 240, headerClassName: "w-[240px]",
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate text-sm" title={e.emailTo}><bdi dir="ltr">{e.emailTo}</bdi></p>
          <p dir="auto" className="mt-0.5 truncate text-xs text-[var(--muted)] text-page-start">{e.userName ?? "—"}</p>
        </div>
      ) },
    { id: "type", header: t("systemMonitoring.colType"), width: 170, headerClassName: "w-[170px]",
      cell: (e) => <Chip size="sm" variant="soft" className="max-w-full"><span className="truncate" title={e.emailType}>{emailTypeLabel(e.emailType)}</span></Chip> },
    { id: "subject", header: t("systemMonitoring.colSubject"),
      cell: (e) => (
        <div className="min-w-0">
          <p dir="auto" className="line-clamp-2 text-sm text-page-start">{e.subject}</p>
          {e.status === "failed" && e.errorMessage && (
            <p dir="auto" className="mt-0.5 line-clamp-2 text-xs text-[var(--danger)] text-page-start" title={e.errorMessage}>{e.errorMessage}</p>
          )}
        </div>
      ) },
    { id: "status", header: t("systemMonitoring.colStatus"), width: 120, headerClassName: "w-[120px]",
      cell: (e) => {
        const s = STATUSES.includes(e.status) ? e.status : "pending";
        return <Chip size="sm" variant="soft" color={STATUS_COLOR[s]}>{t(`systemMonitoring.status${s[0].toUpperCase()}${s.slice(1)}`)}</Chip>;
      } },
    { id: "provider", header: t("systemMonitoring.colProvider"), width: 110, headerClassName: "w-[110px]",
      cell: (e) => <span className="font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{e.providerName ?? "—"}</bdi></span> },
    { id: "time", header: t("systemMonitoring.colTime"), width: 150, headerClassName: "w-[150px]",
      cell: (e) => (
        <span className="whitespace-nowrap text-xs text-[var(--muted)]" title={relativeTime(e.sentAt ?? e.createdAt, i18n.language)}>
          <bdi dir="ltr">{formatDateTime(e.sentAt ?? e.createdAt)}</bdi>
        </span>
      ) },
  ];

  // ── Presence ───────────────────────────────────────────────────────────
  const usersQuery = useListUsers(
    PRESENCE_PARAMS,
    { query: { queryKey: getListUsersQueryKey(PRESENCE_PARAMS), enabled: canView && tab === "presence" } },
  );
  const [presenceSearch, setPresenceSearch] = useState("");
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>("");
  const [presencePage, setPresencePage] = useState(1);

  // Live presence: the server pushes presence:update; patch the cached list so
  // the page stays current without polling (this moved here from Users).
  useEffect(() => {
    if (!socket || !canView) return;
    const onPresenceUpdate = (event: { userId?: unknown; isOnline?: unknown; lastSeenAt?: unknown }) => {
      const { userId, isOnline } = event;
      if (!Number.isSafeInteger(userId) || typeof isOnline !== "boolean") return;
      const lastSeenAt = typeof event.lastSeenAt === "string" ? event.lastSeenAt : null;
      qc.setQueriesData<{ items: PresenceUser[] }>(
        { queryKey: getListUsersQueryKey() },
        (page) => page
          ? {
              ...page,
              items: page.items.map((u) => u.id === userId
                // Online events do not reset a truthful persisted history.
                ? { ...u, isOnline, lastSeenAt: isOnline ? u.lastSeenAt ?? null : lastSeenAt }
                : u),
            }
          : page,
      );
    };
    socket.on("presence:update", onPresenceUpdate as (...args: unknown[]) => void);
    return () => { socket.off("presence:update", onPresenceUpdate as (...args: unknown[]) => void); };
  }, [qc, socket, canView]);

  const allPresence = useMemo(() => {
    const items = [...((usersQuery.data?.items ?? []) as PresenceUser[])];
    return items.sort((a, b) => {
      if (Boolean(a.isOnline) !== Boolean(b.isOnline)) return a.isOnline ? -1 : 1;
      if (!a.isOnline) {
        const seen = (u: PresenceUser) => (u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0);
        if (seen(a) !== seen(b)) return seen(b) - seen(a);
      }
      return a.name.localeCompare(b.name, i18n.language);
    });
  }, [usersQuery.data, i18n.language]);

  const onlineCount = allPresence.filter((u) => u.isOnline).length;
  const presenceQ = presenceSearch.trim().toLowerCase();
  const filteredPresence = allPresence.filter((u) =>
    (!presenceFilter || (presenceFilter === "online") === Boolean(u.isOnline)) &&
    (!presenceQ || [u.name, u.email ?? ""].some((v) => v.toLowerCase().includes(presenceQ))));
  const presencePages = Math.max(1, Math.ceil(filteredPresence.length / PAGE_SIZE));
  const presenceRows = filteredPresence.slice((presencePage - 1) * PAGE_SIZE, presencePage * PAGE_SIZE);
  const togglePresence = (next: Exclude<PresenceFilter, "">) => { setPresenceFilter((cur) => (cur === next ? "" : next)); setPresencePage(1); };

  const presenceColumns: DataGridColumn<PresenceUser>[] = [
    { id: "name", header: t("systemMonitoring.colName"), isRowHeader: true, width: 260, headerClassName: "w-[260px]",
      cell: (u) => (
        <div className="min-w-0">
          <p dir="auto" className="truncate text-sm font-medium text-page-start" title={u.name}>{u.name}</p>
          {u.email && <p className="mt-0.5 truncate text-xs text-[var(--muted)]"><bdi dir="ltr">{u.email}</bdi></p>}
        </div>
      ) },
    { id: "role", header: t("systemMonitoring.colRole"), width: 200, headerClassName: "w-[200px]",
      cell: (u) => (
        <Chip size="sm" variant="soft" color="accent" className="max-w-full">
          <span className="truncate">{t(`users:roles.${u.role}`, { defaultValue: u.roleLabel ?? u.role })}</span>
        </Chip>
      ) },
    { id: "state", header: t("systemMonitoring.colState"), width: 160, headerClassName: "w-[160px]",
      cell: (u) => <span className="truncate text-sm">{u.stateId ? getLinkedStateLabel(u, i18n.language) : t("systemMonitoring.hq")}</span> },
    { id: "presence", header: t("systemMonitoring.tabPresence"),
      cell: (u) => <PresenceValue isOnline={u.isOnline === true} lastSeenAt={u.lastSeenAt} /> },
  ];

  const refresh = () => {
    if (tab === "email") void qc.invalidateQueries({ queryKey: ["admin-email-logs"] });
    else void usersQuery.refetch();
  };

  if (!canView) {
    return (
      <Alert status="danger" className="mx-auto max-w-xl">
        <Alert.Indicator />
        <Alert.Content><Alert.Description>{t("systemMonitoring.noPermission")}</Alert.Description></Alert.Content>
      </Alert>
    );
  }

  // Pager wording is shared with the Users registries.
  const pagerLabels = (page: number, totalPages: number) => ({
    region: t("users:pagination.region"),
    first: t("users:pagination.first"),
    previous: t("users:pagination.previous"),
    next: t("users:pagination.next"),
    last: t("users:pagination.last"),
    pageOf: t("users:pagination.pageOf", { page, totalPages }),
  });
  const logs = logsQuery.data;
  const counts = countsQuery.data;
  const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-GB"));

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Activity className="size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            {t("systemMonitoring.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("systemMonitoring.subtitle")}</p>
        </div>
        <Button variant="secondary" onPress={refresh} isPending={tab === "email" ? logsQuery.isFetching : usersQuery.isFetching} className="w-full sm:w-auto">
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("systemMonitoring.refresh")}
        </Button>
      </header>

      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as Tab)}>
        <Tabs.ListContainer className="w-fit max-w-full">
          <Tabs.List aria-label={t("systemMonitoring.title")}>
            <Tabs.Tab id="email" className="gap-1.5 whitespace-nowrap"><Mail className="size-4" aria-hidden="true" />{t("systemMonitoring.tabEmailLog")}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="presence" className="gap-1.5 whitespace-nowrap"><Wifi className="size-4" aria-hidden="true" />{t("systemMonitoring.tabPresence")}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="email" className="space-y-4 pt-4">
          {/* Each KPI filters the log by its status; a second press clears it. */}
          <section className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4" aria-label={t("systemMonitoring.summaryEmail")}>
            <FilterKpi icon={Mail} label={t("systemMonitoring.kpiTotal")} value={count(counts?.all)} pressed={!status} onToggle={() => { setStatus(""); setOffset(0); }} />
            <FilterKpi icon={CheckCircle2} status="success" label={t("systemMonitoring.statusSent")} value={count(counts?.sent)} pressed={status === "sent"} onToggle={() => toggleStatus("sent")} />
            <FilterKpi icon={AlertCircle} status="danger" label={t("systemMonitoring.statusFailed")} value={count(counts?.failed)} pressed={status === "failed"} onToggle={() => toggleStatus("failed")} />
            <FilterKpi icon={Clock} status="warning" label={t("systemMonitoring.statusPending")} value={count(counts?.pending)} pressed={status === "pending"} onToggle={() => toggleStatus("pending")} />
          </section>

          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 lg:flex-row lg:items-center">
              <SearchField aria-label={t("systemMonitoring.searchPlaceholder")} value={searchInput} onChange={setSearchInput} className="w-full lg:max-w-sm">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t("systemMonitoring.searchPlaceholder")} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <div className="flex flex-wrap items-center gap-2">
                <SelectField
                  aria-label={t("systemMonitoring.colStatus")}
                  value={status || "all"}
                  onChange={(v) => { setStatus(v === "all" ? "" : (v as EmailStatus)); setOffset(0); }}
                  triggerClassName="whitespace-nowrap sm:w-40"
                  options={[
                    { value: "all", label: t("systemMonitoring.allStatuses") },
                    ...STATUSES.map((s) => ({ value: s, label: t(`systemMonitoring.status${s[0].toUpperCase()}${s.slice(1)}`) })),
                  ]}
                />
                {hasEmailFilters && (
                  <Button variant="ghost" size="sm" onPress={clearEmailFilters}>
                    <FilterX className="size-4" aria-hidden="true" /> {t("systemMonitoring.clearFilters")}
                  </Button>
                )}
              </div>
            </div>
            {logsQuery.isLoading ? (
              <GridSkeleton />
            ) : logsQuery.isError ? (
              <div className="p-4"><ErrorState compact variant="server" title={t("systemMonitoring.loadFailed")} onRetry={() => logsQuery.refetch()} /></div>
            ) : (
              <div role="region" aria-label={t("systemMonitoring.tabEmailLog")}>
                <DataGrid
                  aria-label={t("systemMonitoring.tabEmailLog")}
                  data={logs?.items ?? []}
                  columns={emailColumns}
                  getRowId={(e) => e.id}
                  contentClassName="min-w-[1000px] table-fixed"
                  verticalAlign="middle"
                  renderEmptyState={() => (
                    <EmptyGrid icon={Mail} message={t("systemMonitoring.noLogs")} hint={hasEmailFilters ? t("systemMonitoring.clearSearch") : undefined} />
                  )}
                />
              </div>
            )}
            {logs && !logsQuery.isError && (
              <div className="border-t border-[var(--border)]">
                <RegistryPagination
                  className="px-4 py-3"
                  page={Math.floor(offset / PAGE_SIZE) + 1}
                  totalPages={Math.max(1, Math.ceil(logs.total / PAGE_SIZE))}
                  labels={pagerLabels(Math.floor(offset / PAGE_SIZE) + 1, Math.max(1, Math.ceil(logs.total / PAGE_SIZE)))}
                  onPageChange={(next) => setOffset((next - 1) * PAGE_SIZE)}
                  summary={t("systemMonitoring.showing", { from: logs.total ? logs.offset + 1 : 0, to: logs.offset + logs.items.length, total: logs.total })}
                />
              </div>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="presence" className="space-y-4 pt-4">
          <section className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-3" aria-label={t("systemMonitoring.summaryPresence")}>
            <FilterKpi icon={UsersIcon} label={t("systemMonitoring.kpiUsers")} value={usersQuery.data ? count(allPresence.length) : "—"} pressed={!presenceFilter} onToggle={() => { setPresenceFilter(""); setPresencePage(1); }} />
            <FilterKpi icon={Wifi} status="success" label={t("systemMonitoring.kpiOnline")} value={usersQuery.data ? count(onlineCount) : "—"} pressed={presenceFilter === "online"} onToggle={() => togglePresence("online")} />
            <FilterKpi icon={CircleOff} label={t("systemMonitoring.kpiOffline")} value={usersQuery.data ? count(allPresence.length - onlineCount) : "—"} pressed={presenceFilter === "offline"} onToggle={() => togglePresence("offline")} />
          </section>

          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex flex-col gap-2 border-b border-[var(--border)] p-4 lg:flex-row lg:items-center lg:justify-between">
              <SearchField aria-label={t("systemMonitoring.presenceSearch")} value={presenceSearch} onChange={(v) => { setPresenceSearch(v); setPresencePage(1); }} className="w-full lg:max-w-sm">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t("systemMonitoring.presenceSearch")} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <p className="text-xs text-[var(--muted)]">{t("systemMonitoring.presenceSubtitle")}</p>
            </div>
            {usersQuery.isLoading ? (
              <GridSkeleton />
            ) : usersQuery.isError ? (
              <div className="p-4"><ErrorState compact variant="server" title={t("systemMonitoring.loadFailed")} onRetry={() => usersQuery.refetch()} /></div>
            ) : (
              <div role="region" aria-label={t("systemMonitoring.tabPresence")}>
                <DataGrid
                  aria-label={t("systemMonitoring.tabPresence")}
                  data={presenceRows}
                  columns={presenceColumns}
                  getRowId={(u) => u.id}
                  contentClassName="min-w-[820px] table-fixed"
                  verticalAlign="middle"
                  renderEmptyState={() => <EmptyGrid icon={UsersIcon} message={t("systemMonitoring.noUsers")} />}
                />
              </div>
            )}
            {usersQuery.data && !usersQuery.isError && (
              <div className="border-t border-[var(--border)]">
                <RegistryPagination
                  className="px-4 py-3"
                  page={presencePage}
                  totalPages={presencePages}
                  labels={pagerLabels(presencePage, presencePages)}
                  onPageChange={setPresencePage}
                  summary={t("systemMonitoring.showing", {
                    from: filteredPresence.length ? (presencePage - 1) * PAGE_SIZE + 1 : 0,
                    to: (presencePage - 1) * PAGE_SIZE + presenceRows.length,
                    total: filteredPresence.length,
                  })}
                />
              </div>
            )}
          </Card>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
