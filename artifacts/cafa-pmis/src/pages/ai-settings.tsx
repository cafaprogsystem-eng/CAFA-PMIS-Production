import { Fragment, useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Settings, RefreshCw, Loader2,
  Download, Activity, Users, MessageSquare, Globe, Shield,
} from "@/components/icons";
import { Alert, Button, Card, Chip, Description, Label, SearchField, Skeleton, Switch, Tabs, TextArea, TextField } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { SelectField } from "@/components/select-field";
import { useIsMobile } from "@/hooks/use-mobile";
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
  const myPerms = me?.permissions ?? [];
  // Matches the backend exactly: ai.settings.manage (SA/ED) can view+edit the
  // Settings tab; ai.logs.view (SA/ED, and PM for monitoring oversight) can
  // view the Logs tab. A PM has logs access only — no Settings tab at all,
  // since PUT /ai/settings itself requires ai.settings.manage and would 403.
  const canManageSettings = myPerms.includes("*") || myPerms.includes("ai.settings.manage");
  const canViewLogs = myPerms.includes("*") || myPerms.includes("ai.logs.view");
  const isAdmin = canManageSettings || canViewLogs;

  const [extraPrompt, setExtraPrompt] = useState("");
  const [responseLang, setResponseLang] = useState("auto");
  const [logSearch, setLogSearch] = useState("");
  const [tab, setTab] = useState("settings");
  // KPIGroup has no responsive orientation of its own.
  const isMobile = useIsMobile();

  // `me` resolves asynchronously, so canManageSettings is false on the very
  // first render even for an admin — correct the default tab once it lands,
  // for a logs-only viewer (e.g. program_manager) who has no Settings tab.
  useEffect(() => {
    if (me && !canManageSettings && canViewLogs) setTab("logs");
  }, [me, canManageSettings, canViewLogs]);

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
    enabled: canViewLogs && tab === "logs",
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

  // The status switch sends the exact value it was flipped to, so there is no
  // ambiguity from reading a potentially stale query snapshot.
  const setAssistantEnabled = (next: boolean) => {
    saveMut.mutate({ enabled: next ? "true" : "false", systemPromptExtra: extraPrompt, responseLanguage: responseLang });
  };

  const savePrompt = () => {
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

  // Chat log columns (HeroUI Pro DataGrid); sortable by user and time.
  const logColumns = useMemo<DataGridColumn<LogMsg>[]>(() => [
    { id: "user", header: t("settings.logUser"), isRowHeader: true, allowsSorting: true, minWidth: 140,
      sortFn: (a, b) => a.userName.localeCompare(b.userName),
      cell: (m) => <span className="text-sm font-medium text-foreground">{m.userName}</span> },
    { id: "role", header: t("settings.logRole"), minWidth: 130,
      cell: (m) => <Chip size="sm" variant="soft" color="default" className="capitalize">{m.userRole.replace(/_/g, " ")}</Chip> },
    { id: "type", header: t("settings.logType"), width: 110,
      cell: (m) => <Chip size="sm" variant="soft" color={m.role === "user" ? "accent" : "default"}>{m.role}</Chip> },
    { id: "page", header: t("settings.logPage"), width: 110,
      cell: (m) => <span className="font-mono text-xs text-muted-foreground">{m.module ?? "—"}</span> },
    { id: "message", header: t("settings.logMessage"), minWidth: 260,
      cell: (m) => <p className="line-clamp-2 text-xs text-foreground/80">{m.content}</p> },
    { id: "time", header: t("settings.logTime"), allowsSorting: true, width: 170,
      sortFn: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      cell: (m) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span> },
  ], [t]);

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
        <Alert status="warning">
          <Alert.Indicator><Settings className="size-4" aria-hidden /></Alert.Indicator>
          <Alert.Content>
            <Alert.Title>{t("settings.uatTitle")}</Alert.Title>
            <Alert.Description>{t("settings.uatDesc")}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div className="flex items-start justify-between gap-3">
        {showHeading && (
          <div>
            <h1 className="text-foreground text-xl font-semibold flex items-center gap-2">
              <Bot className="size-5 text-primary" /> {t("settings.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("settings.subtitle")}</p>
          </div>
        )}
        <Chip size="sm" variant="soft" color={enabled && envEnabled ? "success" : enabled ? "warning" : "default"}>
          {enabled && envEnabled ? t("settings.statusActive") : enabled ? t("settings.statusUat") : t("settings.statusDisabled")}
        </Chip>
      </div>

      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label={t("settings.title")}>
            {canManageSettings ? (
              <Tabs.Tab id="settings" className="gap-1.5 whitespace-nowrap"><Settings className="size-3.5" aria-hidden /> {t("settings.tabSettings")}<Tabs.Indicator /></Tabs.Tab>
            ) : null}
            <Tabs.Tab id="logs" className="gap-1.5 whitespace-nowrap"><Activity className="size-3.5" aria-hidden /> {t("settings.tabLogs")}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        {/* ── Settings tab — ai.settings.manage only (a logs-only viewer, e.g. program_manager, never sees this) ── */}
        {canManageSettings && (
        <Tabs.Panel id="settings" className="space-y-4 mt-5">
          {settingsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-56 w-full rounded-2xl" />
            </div>
          ) : (
            <>
              {/* Enable / disable */}
              <Card>
                <Card.Header>
                  <Card.Title className="text-base">{t("settings.assistantStatus")}</Card.Title>
                  <Card.Description>{t("settings.assistantStatusDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                  <Switch isSelected={enabled} onChange={setAssistantEnabled} isDisabled={saveMut.isPending} className="w-full">
                    <Switch.Content className="w-full justify-between gap-4">
                      <div className="flex flex-col gap-0.5">
                        <Label>{enabled ? t("settings.aiEnabled") : t("settings.aiDisabled")}</Label>
                        <Description>{enabled ? t("settings.aiEnabledDesc") : t("settings.aiDisabledDesc")}</Description>
                      </div>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                    </Switch.Content>
                  </Switch>
                </Card.Content>
              </Card>

              {/* Response language */}
              <Card>
                <Card.Header>
                  <Card.Title className="text-base flex items-center gap-2"><Globe className="size-4 text-muted-foreground" /> {t("settings.responseLanguage")}</Card.Title>
                  <Card.Description>{t("settings.responseLanguageDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                  <SelectField
                    aria-label={t("settings.responseLanguage")}
                    value={responseLang}
                    onChange={setResponseLang}
                    options={[
                      { value: "auto", label: t("settings.langAuto") },
                      { value: "en", label: t("settings.langEn") },
                      { value: "ar", label: t("settings.langAr") },
                    ]}
                    className="w-full sm:w-[240px]"
                    triggerClassName="w-full"
                  />
                </Card.Content>
              </Card>

              {/* System prompt extra */}
              <Card>
                <Card.Header>
                  <Card.Title className="text-base flex items-center gap-2"><MessageSquare className="size-4 text-muted-foreground" /> {t("settings.additionalInstructions")}</Card.Title>
                  <Card.Description>{t("settings.additionalInstructionsDesc")}</Card.Description>
                </Card.Header>
                <Card.Content className="space-y-3">
                  <TextField value={extraPrompt} onChange={setExtraPrompt} aria-label={t("settings.additionalInstructions")} fullWidth>
                    <TextArea rows={6} placeholder={t("settings.promptPlaceholder")} className="resize-y leading-relaxed" />
                  </TextField>
                  <Button onPress={savePrompt} isDisabled={saveMut.isPending}>
                    {saveMut.isPending ? <><Loader2 className="size-4" /> {t("settings.saving")}</> : t("settings.save")}
                  </Button>
                </Card.Content>
              </Card>

              {/* Security notice */}
              <Alert status="warning">
                <Alert.Indicator><Shield className="size-4" aria-hidden /></Alert.Indicator>
                <Alert.Content>
                  <Alert.Title>{t("settings.securityTitle")}</Alert.Title>
                  <ul className="mt-1 list-disc space-y-0.5 ps-4 text-xs text-muted-foreground">
                    <li>{t("settings.security1")}</li>
                    <li>{t("settings.security2")}</li>
                    <li>{t("settings.security3")}</li>
                    <li>{t("settings.security4")}</li>
                  </ul>
                </Alert.Content>
              </Alert>
            </>
          )}
        </Tabs.Panel>
        )}

        {/* ── Logs tab ─────────────────────────────────────────────────────── */}
        <Tabs.Panel id="logs" className="space-y-4 mt-5">
          {/* Stats — HeroUI Pro KPI group */}
          <KPIGroup orientation={isMobile ? "vertical" : "horizontal"}>
            {[
              { key: "messages", label: t("settings.totalMessages"), value: logsData?.total, Icon: MessageSquare },
              { key: "sessions", label: t("settings.sessions"), value: logsData ? sessions : undefined, Icon: Activity },
              { key: "users", label: t("settings.uniqueUsers"), value: logsData ? uniqueUsers : undefined, Icon: Users },
            ].map(({ key, label, value, Icon }, index) => (
              <Fragment key={key}>
                {index > 0 && <KPIGroup.Separator />}
                <KPI>
                  <KPI.Header>
                    <KPI.Icon><Icon className="size-4" aria-hidden /></KPI.Icon>
                    <KPI.Title>{label}</KPI.Title>
                  </KPI.Header>
                  <KPI.Content>
                    {value === undefined ? <span className="text-2xl font-semibold text-muted-foreground">—</span> : <KPI.Value value={value} />}
                  </KPI.Content>
                </KPI>
              </Fragment>
            ))}
          </KPIGroup>

          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("settings.chatLog")}</Card.Title>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <SearchField value={logSearch} onChange={setLogSearch} aria-label={t("settings.searchLogs")} className="min-w-0 flex-1 basis-60">
                  <SearchField.Group className="w-full">
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder={t("settings.searchLogs")} />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <Button variant="outline" size="sm" onPress={() => qc.invalidateQueries({ queryKey: ["ai-logs"] })}>
                  <RefreshCw className="size-3.5" /> {t("settings.refresh")}
                </Button>
                <Button variant="outline" size="sm" onPress={exportLogs}>
                  <Download className="size-3.5" /> {t("settings.exportCsv")}
                </Button>
              </div>

              {logsLoading ? (
                <div className="space-y-2">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                </div>
              ) : !logsData?.messages.length ? (
                <div className="text-center py-14">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Bot className="size-8 opacity-30" />
                    <p className="text-sm font-medium">{t("settings.noLogs")}</p>
                    {logSearch && <p className="text-xs">{t("settings.clearSearch")}</p>}
                  </div>
                </div>
              ) : (
                <DataGrid
                  aria-label={t("settings.chatLog")}
                  data={logsData.messages}
                  columns={logColumns}
                  getRowId={(m) => m.id}
                  defaultSortDescriptor={{ column: "time", direction: "descending" }}
                />
              )}
              {logsData && (
                <p className="text-xs text-muted-foreground">{logsData.total} {t("settings.totalMessages")}</p>
              )}
            </Card.Content>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

/** Legacy module entry retained for callers that still import the settings page. */
export default function AiSettingsPage() {
  return <AIAdministrationPanel />;
}
