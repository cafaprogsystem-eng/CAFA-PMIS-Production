import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity, Mail, RefreshCw, Search, Users as UsersIcon, Circle, CircleOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetMe, useListUsers, getListUsersQueryKey } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { getLinkedStateLabel } from "@/components/state-label";

type EmailLogEntry = {
  id: number;
  emailTo: string;
  emailType: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  providerName: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  userId: number | null;
  userName: string | null;
};

function EmailStatusBadge({ status }: { status: EmailLogEntry["status"] }) {
  const { t } = useTranslation("settings");
  if (status === "sent") {
    return <Badge className="bg-success/10 text-success border-success/20 hover:bg-success/10">{t("systemMonitoring.statusSent")}</Badge>;
  }
  if (status === "failed") {
    return <Badge className="bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/10">{t("systemMonitoring.statusFailed")}</Badge>;
  }
  return <Badge className="bg-muted text-muted-foreground border-border hover:bg-muted">{t("systemMonitoring.statusPending")}</Badge>;
}

function PresenceValue({ isOnline, lastSeenAt }: { isOnline: boolean; lastSeenAt?: string | null }) {
  const { t } = useTranslation("users");
  if (isOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
        <Circle className="h-2 w-2 fill-success text-success" /> {t("presence.online")}
      </span>
    );
  }
  const time = lastSeenAt ? formatDistanceToNow(new Date(lastSeenAt), { addSuffix: true }) : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <CircleOff className="h-2 w-2 text-muted-foreground" />
      {time ? t("presence.offlineLastSeen", { time }) : t("presence.offline")}
    </span>
  );
}

export default function SystemMonitoringPage() {
  const { t } = useTranslation(["settings", "users"]);
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const myPerms = me?.permissions ?? [];
  const canView = myPerms.includes("*") || myPerms.includes("system.monitoring.view");

  const [tab, setTab] = useState("email");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["admin-email-logs", search, status],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      const r = await fetch(`/api/admin/email-logs?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ items: EmailLogEntry[]; total: number }>;
    },
    enabled: canView && tab === "email",
  });

  const presenceParams = { limit: 200 };
  const { data: usersPage, isLoading: usersLoading } = useListUsers(
    presenceParams,
    { query: { queryKey: getListUsersQueryKey(presenceParams), enabled: canView && tab === "presence" } },
  );
  const presenceUsers = [...(usersPage?.items ?? [])].sort((a, b) => {
    if (Boolean(a.isOnline) === Boolean(b.isOnline)) return a.name.localeCompare(b.name);
    return a.isOnline ? -1 : 1;
  });

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-sm text-muted-foreground">{t("systemMonitoring.noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("systemMonitoring.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("systemMonitoring.subtitle")}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="email" className="gap-1.5"><Mail className="h-3.5 w-3.5" /> {t("systemMonitoring.tabEmailLog")}</TabsTrigger>
          <TabsTrigger value="presence" className="gap-1.5"><UsersIcon className="h-3.5 w-3.5" /> {t("systemMonitoring.tabPresence")}</TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="space-y-5 mt-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("systemMonitoring.tabEmailLog")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t("systemMonitoring.searchPlaceholder")}
                    className="ps-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("systemMonitoring.allStatuses")}</SelectItem>
                    <SelectItem value="sent">{t("systemMonitoring.statusSent")}</SelectItem>
                    <SelectItem value="failed">{t("systemMonitoring.statusFailed")}</SelectItem>
                    <SelectItem value="pending">{t("systemMonitoring.statusPending")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => qc.invalidateQueries({ queryKey: ["admin-email-logs"] })}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t("systemMonitoring.refresh")}
                </Button>
              </div>

              {logsLoading ? (
                <div className="divide-y -mx-4 border-t">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 flex-1 max-w-xs" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
              ) : !logsData?.items.length ? (
                <div className="text-center py-14">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Mail className="h-8 w-8 opacity-30" />
                    <p className="text-sm font-medium">{t("systemMonitoring.noLogs")}</p>
                    {(search || status !== "all") && <p className="text-xs">{t("systemMonitoring.clearSearch")}</p>}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead>{t("systemMonitoring.colRecipient")}</TableHead>
                        <TableHead>{t("systemMonitoring.colUser")}</TableHead>
                        <TableHead>{t("systemMonitoring.colType")}</TableHead>
                        <TableHead>{t("systemMonitoring.colSubject")}</TableHead>
                        <TableHead>{t("systemMonitoring.colStatus")}</TableHead>
                        <TableHead>{t("systemMonitoring.colProvider")}</TableHead>
                        <TableHead className="whitespace-nowrap">{t("systemMonitoring.colTime")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logsData.items.map((e) => (
                        <TableRow key={e.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="text-sm">{e.emailTo}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.userName ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-mono">{e.emailType}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="text-xs text-foreground/70 line-clamp-2">{e.subject}</p>
                            {e.status === "failed" && e.errorMessage && (
                              <p className="text-xs text-destructive/80 mt-0.5 line-clamp-1">{e.errorMessage}</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <EmailStatusBadge status={e.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{e.providerName ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(e.sentAt ?? e.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {logsData && (
                <p className="text-xs text-muted-foreground mt-3">{logsData.total} {t("systemMonitoring.totalEntries")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="presence" className="space-y-5 mt-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("systemMonitoring.tabPresence")}</CardTitle>
              <p className="text-xs text-muted-foreground">{t("systemMonitoring.presenceSubtitle")}</p>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="divide-y -mx-4 border-t">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
              ) : presenceUsers.length === 0 ? (
                <div className="text-center py-14 text-sm text-muted-foreground">{t("systemMonitoring.noUsers")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead>{t("systemMonitoring.colName")}</TableHead>
                        <TableHead>{t("systemMonitoring.colRole")}</TableHead>
                        <TableHead>{t("systemMonitoring.colState")}</TableHead>
                        <TableHead>{t("users:presence.header")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {presenceUsers.map((u) => (
                        <TableRow key={u.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="text-sm font-medium">{u.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">{u.role.replace(/_/g, " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {u.stateId ? getLinkedStateLabel(u) : "—"}
                          </TableCell>
                          <TableCell>
                            <PresenceValue isOnline={u.isOnline === true} lastSeenAt={u.lastSeenAt} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
