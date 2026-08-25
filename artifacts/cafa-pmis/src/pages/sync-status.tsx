import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { formatDistanceToNow } from "date-fns";
import {
  RefreshCw, Trash2, AlertCircle, CheckCircle2, Clock, Loader2,
  GitMerge, RotateCcw, Wifi, WifiOff, ChevronDown, ChevronRight,
  Paperclip, UploadCloud, XCircle, AlertTriangle, ServerCrash,
} from "lucide-react";
import { db, type SyncQueueItem, type SyncStatus, type AttachmentQueueItem, type AttachmentStatus } from "@/lib/offline/db";
import { syncService } from "@/lib/offline/sync-service";
import { dismissAttachment, tryUploadAttachment } from "@/lib/offline/attachment-store";
import { useSyncContext } from "@/contexts/sync-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

/* ── Sync queue status ────────────────────────────────────────────────── */

const STATUS_META: Record<SyncStatus, { labelKey: string; color: string; Icon: React.ElementType }> = {
  "local-draft": { labelKey: "sync.statusLocalDraft", color: "bg-slate-100 text-slate-800 border-slate-200", Icon: Clock },
  pending:  { labelKey: "sync.statusPending",  color: "bg-amber-100 text-amber-800 border-amber-200",  Icon: Clock },
  syncing:  { labelKey: "sync.statusSyncing",  color: "bg-blue-100 text-blue-800 border-blue-200",     Icon: Loader2 },
  synced:   { labelKey: "sync.statusSynced",   color: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: CheckCircle2 },
  failed:   { labelKey: "sync.statusFailed",   color: "bg-red-100 text-red-800 border-red-200",        Icon: AlertCircle },
  conflict: { labelKey: "sync.statusConflict", color: "bg-purple-100 text-purple-800 border-purple-200", Icon: GitMerge },
};

function StatusBadge({ status }: { status: SyncStatus }) {
  const { t } = useTranslation("common");
  const { labelKey, color, Icon } = STATUS_META[status];
  return (
    <Badge variant="outline" className={`gap-1 border ${color} text-xs`}>
      <Icon className={`h-3 w-3 ${status === "syncing" ? "animate-spin" : ""}`} />
      {t(labelKey)}
    </Badge>
  );
}

/* ── Conflict detail panel ────────────────────────────────────────────── */

/** Derive a server-side GET URL from the queued mutation URL. */
function buildServerUrl(item: SyncQueueItem): string | null {
  if (!item.entityId) return null;
  // Strip sub-paths like /transitions, /documents, /comments to get the entity root.
  const base = item.url.replace(/\/(transitions|documents|comments|members|messages|read).*$/, "");
  // Only proceed if the base path looks like /api/{entity}/{id}
  return /\/api\/[^/]+\/\d+$/.test(base) ? base : null;
}

function ConflictDetailPanel({
  item,
  onRetry,
  onDiscard,
}: {
  item: SyncQueueItem;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation("common");
  const [serverState, setServerState] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const serverUrl = buildServerUrl(item);

  const localData = (() => {
    if (!item.body) return null;
    try { return JSON.parse(item.body) as Record<string, unknown>; } catch { return null; }
  })();

  const loadServer = async () => {
    if (!serverUrl) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(serverUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as Record<string, unknown>;
      // API often wraps in { project: {...} } — unwrap one level if needed
      const unwrapped = Object.values(raw).find(
        (v) => typeof v === "object" && v !== null && !Array.isArray(v)
      ) as Record<string, unknown> | undefined;
      setServerState(unwrapped ?? raw);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const displayVal = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v as string | number | boolean);
  };

  const renderFields = (data: Record<string, unknown>, highlight?: Set<string>) =>
    Object.entries(data)
      .filter(([k]) => !["id", "createdAt", "created_at"].includes(k))
      .slice(0, 12)
      .map(([k, v]) => {
        const changed = highlight?.has(k);
        return (
          <div key={k} className={`flex gap-1.5 ${changed ? "bg-amber-50 rounded px-1 -mx-1" : ""}`}>
            <span className="font-medium text-gray-600 shrink-0 min-w-[80px]">{k}:</span>
            <span className={`truncate ${changed ? "text-amber-800 font-medium" : "text-gray-800"}`}>
              {displayVal(v)}
            </span>
          </div>
        );
      });

  // Compute keys that differ between local body and server state
  const changedKeys = new Set<string>();
  if (localData && serverState) {
    for (const [k, v] of Object.entries(localData)) {
      if (k in serverState && String(serverState[k]) !== String(v)) changedKeys.add(k);
    }
  }

  const serverUpdatedAt: string | null =
    typeof serverState?.updatedAt === "string" ? serverState.updatedAt
    : typeof serverState?.updated_at === "string" ? serverState.updated_at
    : null;

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-purple-900">
        <GitMerge className="h-4 w-4 shrink-0" />
        {t("sync.conflictHeading")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* ── Local version ── */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">
            {t("sync.yourOfflineChange")}
            <span className="ms-1.5 font-normal normal-case text-purple-500">
              ({item.method} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })})
            </span>
          </p>
          <div className="rounded bg-white border border-purple-200 p-2 text-xs space-y-1 max-h-44 overflow-y-auto">
            {localData ? renderFields(localData) : (
              <p className="text-gray-400 italic">{t("sync.noPayloadCaptured")}</p>
            )}
          </div>
        </div>

        {/* ── Server version ── */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">
            {t("sync.currentServerState")}
            {serverState && serverUpdatedAt && (
              <span className="ms-1.5 font-normal normal-case text-purple-500">
                {t("sync.serverUpdatedAgo", { ago: formatDistanceToNow(new Date(String(serverUpdatedAt)), { addSuffix: true }) })}
              </span>
            )}
          </p>

          {!serverState && !loading && !fetchError && serverUrl && (
            <button
              onClick={loadServer}
              className="w-full flex items-center justify-center gap-2 rounded border border-purple-300 bg-white px-2 py-4 text-xs text-purple-700 hover:bg-purple-50 transition-colors"
            >
              <ServerCrash className="h-4 w-4" />
              {t("sync.loadServerVersion")}
            </button>
          )}

          {!serverUrl && (
            <div className="rounded bg-white border border-purple-200 p-3 text-xs text-gray-400 italic">
              {t("sync.serverStateUnavailable")}
            </div>
          )}

          {loading && (
            <div className="rounded bg-white border border-purple-200 p-4 flex items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("sync.fetchingServerState")}
            </div>
          )}

          {fetchError && (
            <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700">
              <span className="font-medium">{t("sync.failedToLoad")}</span> {fetchError}
              <button onClick={loadServer} className="ms-2 underline">{t("sync.retry")}</button>
            </div>
          )}

          {serverState && (
            <div className="rounded bg-white border border-purple-200 p-2 text-xs space-y-1 max-h-44 overflow-y-auto">
              {renderFields(serverState, changedKeys)}
              {changedKeys.size > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠ {t("sync.fieldsDiffer", { count: changedKeys.size })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-1 border-t border-purple-200">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="gap-1.5 text-xs border-purple-300 text-purple-900 hover:bg-purple-100"
        >
          <RotateCcw className="h-3 w-3" /> {t("sync.keepLocalRetry")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDiscard}
          className="gap-1.5 text-xs border-red-300 text-red-700 hover:bg-red-50"
        >
          <Trash2 className="h-3 w-3" /> {t("sync.acceptServerDiscard")}
        </Button>
        {serverUrl && !serverState && (
          <Button
            size="sm"
            variant="ghost"
            onClick={loadServer}
            disabled={loading}
            className="gap-1.5 text-xs text-purple-600"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ServerCrash className="h-3 w-3" />}
            {t("sync.compareVersionsFirst")}
          </Button>
        )}
      </div>
    </div>
  );
}

function QueueItemRow({ item }: { item: SyncQueueItem }) {
  const { t } = useTranslation("common");
  const [expanded, setExpanded] = useState(false);

  const handleRetry = async () => {
    await syncService.retryItem(item.id!);
    toast.info(t("sync.itemQueuedForRetry"));
  };

  const handleDiscard = async () => {
    await syncService.discardItem(item.id!);
    toast.success(t("sync.itemDiscarded"));
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3">
        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-3 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpanded(!expanded);
            }
          }}
          aria-expanded={expanded}
          aria-controls={`sync-queue-detail-${item.id}`}
          aria-label={expanded ? t("sync.toggleDetailsHide", { label: item.label }) : t("sync.toggleDetailsShow", { label: item.label })}
        >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{item.label}</span>
            <Badge variant="secondary" className="text-xs">{item.module}</Badge>
            <StatusBadge status={item.syncStatus} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.method} {item.url.replace("/api", "")}
            {" · "}
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            {item.retryCount > 0 && ` · ${t("sync.retriesLabel", { count: item.retryCount })}`}
          </p>
        </div>
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />}
        </div>
        <div className="flex items-center gap-2 shrink-0 pe-3">
          {item.syncStatus === "failed" && (
            <Button size="sm" variant="outline" onClick={handleRetry} className="h-7 gap-1 text-xs">
              <RotateCcw className="h-3 w-3" /> {t("sync.retry")}
            </Button>
          )}
          {item.syncStatus !== "synced" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" aria-label={t("sync.discardThisChange")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("sync.discardThisChangeTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("sync.discardThisChangeDesc", { label: item.label })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("sync.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDiscard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {t("sync.discard")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {expanded && (
        <div id={`sync-queue-detail-${item.id}`} className="border-t bg-muted/20 px-3 py-2 space-y-1.5 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">{t("sync.clientId")}</span> {item.clientId}</div>
          {item.entityId && <div><span className="font-medium text-foreground">{t("sync.entityId")}</span> {item.entityId}</div>}
          {item.syncedAt && <div><span className="font-medium text-foreground">{t("sync.syncedLabel")}</span> {formatDistanceToNow(new Date(item.syncedAt), { addSuffix: true })}</div>}
          {item.lastError && (
            <div className="rounded bg-red-50 border border-red-100 p-2 text-red-700">
              <span className="font-medium">{t("sync.errorLabel")}</span> {item.lastError}
            </div>
          )}
          {item.syncStatus === "conflict" ? (
            <ConflictDetailPanel item={item} onRetry={handleRetry} onDiscard={handleDiscard} />
          ) : (
            item.body && (
              <details className="mt-1">
                <summary className="cursor-pointer font-medium text-foreground">{t("sync.payload")}</summary>
                <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-xs">
                  {(() => { try { return JSON.stringify(JSON.parse(item.body), null, 2); } catch { return item.body; } })()}
                </pre>
              </details>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ── Attachment queue ─────────────────────────────────────────────────── */

const ATTACHMENT_META: Record<AttachmentStatus, { labelKey: string; color: string; Icon: React.ElementType; hintKey: string }> = {
  pending: {
    labelKey: "sync.attPending",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    Icon: Clock,
    hintKey: "sync.attPendingHint",
  },
  uploading: {
    labelKey: "sync.attUploading",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    Icon: Loader2,
    hintKey: "sync.attUploadingHint",
  },
  uploaded: {
    labelKey: "sync.attUploaded",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    Icon: CheckCircle2,
    hintKey: "sync.attUploadedHint",
  },
  failed: {
    labelKey: "sync.attFailed",
    color: "bg-red-100 text-red-800 border-red-200",
    Icon: XCircle,
    hintKey: "sync.attFailedHint",
  },
  "re-select-required": {
    labelKey: "sync.attReSelect",
    color: "bg-orange-100 text-orange-800 border-orange-200",
    Icon: AlertTriangle,
    hintKey: "sync.attReSelectHint",
  },
};

function AttachmentStatusBadge({ status }: { status: AttachmentStatus }) {
  const { t } = useTranslation("common");
  const { labelKey, color, Icon } = ATTACHMENT_META[status];
  return (
    <Badge variant="outline" className={`gap-1 border ${color} text-xs`}>
      <Icon className={`h-3 w-3 ${status === "uploading" ? "animate-spin" : ""}`} />
      {t(labelKey)}
    </Badge>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function AttachmentRow({ item, isOnline }: { item: AttachmentQueueItem; isOnline: boolean }) {
  const { t } = useTranslation("common");
  const meta = ATTACHMENT_META[item.status];

  const handleRetry = async () => {
    const result = await tryUploadAttachment(item.id);
    if (result) {
      toast.success(t("sync.attachmentUploaded"));
    } else {
      toast.error(t("sync.attachmentUploadFailed"));
    }
  };

  const handleDismiss = async () => {
    await dismissAttachment(item.id);
    toast.success(t("sync.attachmentEntryRemoved"));
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
          <Paperclip className="h-4 w-4 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate max-w-[200px]">{item.fileName}</span>
            <AttachmentStatusBadge status={item.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatBytes(item.fileSize)} · {item.contentType}
            {" · "}
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          </p>
          <p className="text-xs text-muted-foreground mt-1 italic">{t(meta.hintKey)}</p>
          {item.lastError && (
            <p className="text-xs text-red-600 mt-1">{t("sync.errorLabel")} {item.lastError}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(item.status === "failed") && isOnline && (
            <Button size="sm" variant="outline" onClick={handleRetry} className="h-7 gap-1 text-xs">
              <UploadCloud className="h-3 w-3" /> {t("sync.retry")}
            </Button>
          )}
          {item.status !== "uploading" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" aria-label={t("sync.removeAttachmentEntry")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("sync.removeAttachmentTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("sync.removeAttachmentDesc", { fileName: item.fileName })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("sync.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDismiss}>{t("sync.remove")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

type FilterTab = "all" | SyncStatus;
type PageTab = "queue" | "attachments";

export default function SyncStatusPage() {
  const { t } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [pageTab, setPageTab] = useState<PageTab>("queue");
  const { isOnline, connectivityState, isSyncing, triggerSync, clearSynced, attachmentCount } = useSyncContext();

  const allItems = useLiveQuery(
    () => db.syncQueue.orderBy("createdAt").reverse().toArray(),
    [], []
  ) ?? [];

  const allAttachments: AttachmentQueueItem[] = useLiveQuery(
    () => db.attachmentQueue.orderBy("createdAt").reverse().toArray(),
    [], [] as AttachmentQueueItem[]
  ) ?? [];

  const counts = {
    all: allItems.length,
    pending: allItems.filter(i => i.syncStatus === "pending").length,
    syncing: allItems.filter(i => i.syncStatus === "syncing").length,
    synced: allItems.filter(i => i.syncStatus === "synced").length,
    failed: allItems.filter(i => i.syncStatus === "failed").length,
    conflict: allItems.filter(i => i.syncStatus === "conflict").length,
  };

  const filtered = activeTab === "all" ? allItems : allItems.filter(i => i.syncStatus === activeTab);

  const handleRetryAll = async () => {
    const failed = allItems.filter(i => i.syncStatus === "failed" || i.syncStatus === "conflict");
    await Promise.all(failed.map(i => syncService.retryItem(i.id!)));
    if (isOnline) await triggerSync();
    toast.info(t("sync.itemsQueuedForRetry", { count: failed.length }));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("sync.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("sync.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={connectivityState === "online" ? "default" : "secondary"}
            className={`gap-1.5 ${
              connectivityState === "online"
                ? "bg-emerald-600"
                : connectivityState === "offline" ? "bg-amber-500" : "bg-orange-500"
            }`}
          >
            {connectivityState === "online"
              ? <Wifi className="h-3 w-3" />
              : <WifiOff className="h-3 w-3" />}
            {connectivityState === "online"
              ? t("sync.online")
              : connectivityState === "offline"
                ? t("sync.offline")
                : connectivityState === "checking"
                  ? t("sync.checkingConnection")
                  : connectivityState === "degraded"
                    ? t("sync.serviceUnavailable")
                    : connectivityState === "auth-required"
                      ? t("sync.authenticationRequired")
                      : t("sync.accessDenied")}
          </Badge>
          {counts.synced > 0 && (
            <Button size="sm" variant="outline" onClick={clearSynced} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> {t("sync.clearSynced")}
            </Button>
          )}
          {(counts.failed > 0 || counts.conflict > 0) && (
            <Button size="sm" variant="outline" onClick={handleRetryAll} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> {t("sync.retryAll")}
            </Button>
          )}
          <Button
            size="sm"
            onClick={triggerSync}
            disabled={!isOnline || isSyncing || (counts.pending + counts.failed === 0)}
            className="gap-1.5 bg-[#1a2744] hover:bg-[#1a2744]/90 text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? t("sync.syncing") : t("sync.syncNow")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: t("sync.pending"), count: counts.pending, color: "text-amber-600 bg-amber-50 border-amber-100" },
          { label: t("sync.synced"),  count: counts.synced,  color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
          { label: t("sync.failed"),  count: counts.failed,  color: "text-red-600 bg-red-50 border-red-100" },
          { label: t("sync.conflicts"), count: counts.conflict, color: "text-purple-600 bg-purple-50 border-purple-100" },
        ] as const).map(({ label, count, color }) => (
          <Card key={label} className={`border ${color.split(" ")[2]}`}>
            <CardContent className="p-4">
              <p className={`text-2xl font-bold ${color.split(" ")[0]}`}>{count}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main tabs: Queue | Attachments */}
      <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as PageTab)}>
        <TabsList>
          <TabsTrigger value="queue">
            {t("sync.actionQueue")}
            {counts.all > 0 && (
              <Badge variant="secondary" className="ms-1.5 text-xs px-1.5"><bdi dir="ltr">{counts.all}</bdi></Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="attachments">
            {t("sync.attachments")}
            {attachmentCount > 0 && (
              <Badge variant="secondary" className="ms-1.5 text-xs px-1.5 bg-orange-100 text-orange-700"><bdi dir="ltr">{attachmentCount}</bdi></Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Action Queue tab ─────────────────────────────────────────── */}
        <TabsContent value="queue" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sync.actionQueue")}</CardTitle>
              <CardDescription>
                {t("sync.actionQueueDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {allItems.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700">{t("sync.noOfflineActions")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("sync.noOfflineActionsDesc")}
                  </p>
                </div>
              ) : (
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="all">{t("all")} ({counts.all})</TabsTrigger>
                    {counts.pending > 0 && <TabsTrigger value="pending">{t("sync.pending")} ({counts.pending})</TabsTrigger>}
                    {counts.synced > 0 && <TabsTrigger value="synced">{t("sync.synced")} ({counts.synced})</TabsTrigger>}
                    {counts.failed > 0 && <TabsTrigger value="failed">{t("sync.failed")} ({counts.failed})</TabsTrigger>}
                    {counts.conflict > 0 && <TabsTrigger value="conflict">{t("sync.conflicts")} ({counts.conflict})</TabsTrigger>}
                  </TabsList>
                  <TabsContent value={activeTab} className="space-y-2 m-0">
                    {filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">{t("sync.noItemsInCategory")}</p>
                    ) : (
                      filtered.map((item) => <QueueItemRow key={item.id} item={item} />)
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Attachments tab ──────────────────────────────────────────── */}
        <TabsContent value="attachments" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sync.attachmentQueue")}</CardTitle>
              <CardDescription>
                {t("sync.attachmentQueueDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {allAttachments.length === 0 ? (
                <div className="py-12 text-center">
                  <Paperclip className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700">{t("sync.noPendingAttachments")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("sync.noPendingAttachmentsDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Re-select required notice */}
                  {allAttachments.some(a => a.status === "re-select-required") && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 flex gap-2 text-sm text-orange-800 mb-4">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{t("sync.reSelectRequired")}</span>
                    </div>
                  )}
                  {allAttachments.map((item) => (
                    <AttachmentRow key={item.id} item={item} isOnline={isOnline} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
