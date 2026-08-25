import { useState, useEffect, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Settings, ToggleLeft, ToggleRight, RefreshCw,
  Search, Download, Activity, Users, MessageSquare, Globe, Shield
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetMe } from "@workspace/api-client-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";

type AiSettings = {
  enabled: string;
  envEnabled?: boolean;
  reason?: string;
  systemPromptExtra: string | null;
  responseLanguage: string;
  updatedAt?: string;
};

type LogMsg = {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  module: string | null;
  createdAt: string;
  userId: number;
  userName: string;
  userRole: string;
};

export function AIAdministrationPanel({ showHeading = true }: { showHeading?: boolean }) {
  const { t } = useTranslation("ai");
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const isAdmin = me?.user?.role === "super_admin" || me?.user?.role === "executive_director";

  const [extraPrompt, setExtraPrompt] = useState("");
  const [responseLang, setResponseLang] = useState("auto");
  const [logSearch, setLogSearch] = useState("");
  const [tab, setTab] = useState("settings");

  const { data: settings, isLoading: settingsLoading } = useQuery<AiSettings>({
    queryKey: ["ai-settings"],
    queryFn: async () => {
      const r = await fetch("/api/ai/settings", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  useEffect(() => {
    if (settings) {
      setExtraPrompt(settings.systemPromptExtra ?? "");
      setResponseLang(settings.responseLanguage ?? "auto");
    }
  }, [settings]);

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["ai-logs", logSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (logSearch) params.set("search", logSearch);
      const r = await fetch(`/api/ai/logs?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ messages: LogMsg[]; total: number }>;
    },
    enabled: isAdmin && tab === "logs",
  });

  const saveMut = useMutation({
    mutationFn: async (data: { enabled: string; systemPromptExtra: string; responseLanguage: string }) => {
      const r = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed");
    },
    // Optimistic update: flip the badge and button label immediately on click,
    // before the server round-trip completes.
    onMutate: async (incoming) => {
      await qc.cancelQueries({ queryKey: ["ai-settings"] });
      const previous = qc.getQueryData<AiSettings>(["ai-settings"]);
      qc.setQueryData<AiSettings>(["ai-settings"], (old) => ({
        ...(old ?? { systemPromptExtra: null, responseLanguage: "auto" }),
        enabled: incoming.enabled,
      }));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Roll back on failure
      if (context?.previous) qc.setQueryData(["ai-settings"], context.previous);
      toast.error(t("settings.saveFailed"));
    },
    onSuccess: () => {
      // Confirm with server truth — also refreshes the floating widget
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      toast.success(t("settings.saveSuccess"));
    },
  });

  // Explicit enable/disable handlers — each hardcodes the value it sends so there
  // is no ambiguity from reading a potentially stale query snapshot.
  const handleEnable = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    saveMut.mutate({ enabled: "true", systemPromptExtra: extraPrompt, responseLanguage: responseLang });
  };

  const handleDisable = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    saveMut.mutate({ enabled: "false", systemPromptExtra: extraPrompt, responseLanguage: responseLang });
  };

  const savePrompt = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    saveMut.mutate({
      enabled: settings?.enabled ?? "true",
      systemPromptExtra: extraPrompt,
      responseLanguage: responseLang,
    });
  };

  const exportLogs = () => {
    if (!logsData?.messages) return;
    const rows = [
      ["ID", "Session", "Role", "User", "User Role", "Module", "Content", "Timestamp"],
      ...logsData.messages.map(m => [
        m.id, m.sessionId, m.role, m.userName, m.userRole,
        m.module ?? "", m.content.replace(/"/g, '""'), formatDateTime(m.createdAt),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ai-chat-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground text-sm">{t("settings.noPermission")}</p>
      </div>
    );
  }

  // `enabled` reflects the DB-configured state so the toggle always shows what
  // the admin has saved. `envEnabled` is a separate server-side flag (AI_ENABLED
  // env var); when false, AI won't function even if DB says enabled.
  const enabled = settings?.enabled !== "false";
  const envEnabled = settings?.envEnabled !== false; // true when AI_ENABLED=true on server
  const sessions = logsData ? new Set(logsData.messages.map(m => m.sessionId)).size : 0;
  const uniqueUsers = logsData ? new Set(logsData.messages.map(m => m.userId)).size : 0;

  return (
    <div className="space-y-6">
      {/* UAT mode notice — shown when the AI_ENABLED env var is not set on the server */}
      {settings && !envEnabled && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <span className="mt-0.5 text-base">⚙️</span>
          <div>
            <p className="font-semibold">{t("settings.uatTitle")}</p>
            <p className="mt-0.5">{t("settings.uatDesc")}</p>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between">
        {showHeading && (
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Bot className="h-7 w-7 text-primary" /> {t("settings.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("settings.subtitle")}</p>
          </div>
        )}
        <Badge className={enabled && envEnabled ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground border-border"}>
          {enabled && envEnabled ? t("settings.statusActive") : enabled ? t("settings.statusUat") : t("settings.statusDisabled")}
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="settings" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> {t("settings.tabSettings")}</TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> {t("settings.tabLogs")}</TabsTrigger>
        </TabsList>

        {/* ── Settings tab ─────────────────────────────────────────────────── */}
        <TabsContent value="settings" className="space-y-5 mt-5">
          {settingsLoading ? (
            <div className="space-y-4">
              <div className="rounded-xl border p-5 space-y-3">
                <Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" />
                <div className="flex items-center justify-between pt-1"><div className="space-y-1.5"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-60" /></div><Skeleton className="h-9 w-24 rounded-md" /></div>
              </div>
              <div className="rounded-xl border p-5 space-y-3">
                <Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" />
                <Skeleton className="h-9 w-48 rounded-md" />
              </div>
              <div className="rounded-xl border p-5 space-y-3">
                <Skeleton className="h-4 w-52" /><Skeleton className="h-3 w-80" />
                <Skeleton className="h-28 w-full rounded-md" /><Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </div>
          ) : (
            <>
              {/* Enable / disable */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("settings.assistantStatus")}</CardTitle>
                  <CardDescription>{t("settings.assistantStatusDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{enabled ? t("settings.aiEnabled") : t("settings.aiDisabled")}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {enabled ? t("settings.aiEnabledDesc") : t("settings.aiDisabledDesc")}
                      </p>
                    </div>
                    {enabled ? (
                      <Button type="button" variant="outline" onClick={handleDisable} disabled={saveMut.isPending}
                        className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/10">
                        <ToggleRight className="h-4 w-4" />
                        {saveMut.isPending ? t("settings.saving") : t("settings.disable")}
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" onClick={handleEnable} disabled={saveMut.isPending}
                        className="gap-2 text-success border-success/20 hover:bg-success/10">
                        <ToggleLeft className="h-4 w-4" />
                        {saveMut.isPending ? t("settings.saving") : t("settings.enable")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Response language */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> {t("settings.responseLanguage")}</CardTitle>
                  <CardDescription>{t("settings.responseLanguageDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Select value={responseLang} onValueChange={setResponseLang}>
                    <SelectTrigger className="w-full sm:w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("settings.langAuto")}</SelectItem>
                      <SelectItem value="en">{t("settings.langEn")}</SelectItem>
                      <SelectItem value="ar">{t("settings.langAr")}</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* System prompt extra */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" /> {t("settings.additionalInstructions")}</CardTitle>
                  <CardDescription>
                    {t("settings.additionalInstructionsDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <textarea
                    value={extraPrompt}
                    onChange={e => setExtraPrompt(e.target.value)}
                    rows={6}
                    placeholder={t("settings.promptPlaceholder")}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y leading-relaxed"
                  />
                  <Button type="button" onClick={savePrompt} disabled={saveMut.isPending}>
              {saveMut.isPending ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t("settings.saving")}</> : t("settings.save")}
                  </Button>
                </CardContent>
              </Card>

              {/* Security notice */}
              <Card className="border-warning/30 bg-warning/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-warning"><Shield className="h-4 w-4" /> {t("settings.securityTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-warning/80 space-y-1">
                  <p>• {t("settings.security1")}</p>
                  <p>• {t("settings.security2")}</p>
                  <p>• {t("settings.security3")}</p>
                  <p>• {t("settings.security4")}</p>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Logs tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="logs" className="space-y-5 mt-5">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t("settings.totalMessages"), value: logsData?.total ?? "—", icon: MessageSquare, color: "" },
              { label: t("settings.sessions"), value: sessions || "—", icon: Activity, color: "text-info" },
              { label: t("settings.uniqueUsers"), value: uniqueUsers || "—", icon: Users, color: "text-primary" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`h-4 w-4 ${color || "text-muted-foreground"}`} />
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("settings.chatLog")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder={t("settings.searchLogs")} className="ps-9" value={logSearch}
                    onChange={e => setLogSearch(e.target.value)} />
                </div>
                <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["ai-logs"] })} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" /> {t("settings.refresh")}
                </Button>
                <Button variant="outline" size="sm" onClick={exportLogs} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" /> {t("settings.exportCsv")}
                </Button>
              </div>

              {logsLoading ? (
                <div className="divide-y -mx-4 border-t">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-5 w-28 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 flex-1 max-w-xs" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
              ) : !logsData?.messages.length ? (
                <div className="text-center py-14">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Bot className="h-8 w-8 opacity-30" />
                    <p className="text-sm font-medium">{t("settings.noLogs")}</p>
                    {logSearch && <p className="text-xs">{t("settings.clearSearch")}</p>}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead>{t("settings.logUser")}</TableHead>
                        <TableHead>{t("settings.logRole")}</TableHead>
                        <TableHead>{t("settings.logType")}</TableHead>
                        <TableHead>{t("settings.logPage")}</TableHead>
                        <TableHead>{t("settings.logMessage")}</TableHead>
                        <TableHead className="whitespace-nowrap">{t("settings.logTime")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logsData.messages.map(m => (
                        <TableRow key={m.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell>
                            <div className="font-medium text-sm">{m.userName}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">{m.userRole.replace(/_/g, " ")}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={m.role === "user"
                              ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/10 text-xs"
                              : "bg-muted text-muted-foreground border-border hover:bg-muted text-xs"}>
                              {m.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">{m.module ?? "—"}</TableCell>
                          <TableCell className="max-w-xs">
                            <p className="text-xs text-foreground/70 line-clamp-2">{m.content}</p>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(m.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {logsData && (
                <p className="text-xs text-muted-foreground mt-3">{logsData.total} {t("settings.totalMessages")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Legacy module entry retained for callers that still import the settings page. */
export default function AiSettingsPage() {
  return <AIAdministrationPanel />;
}
