import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { formatDistanceToNow } from "date-fns";
import {
  RefreshCw, Trash2, AlertCircle, CheckCircle2, Clock, Loader2,
  GitMerge, RotateCcw, Wifi, WifiOff, ChevronDown, ChevronRight,
  Paperclip, UploadCloud, XCircle, AlertTriangle, ServerCrash,
} from "@/components/icons";
import { db, type SyncQueueItem, type SyncStatus, type AttachmentQueueItem, type AttachmentStatus } from "@/lib/offline/db";
import { syncService } from "@/lib/offline/sync-service";
import { dismissAttachment, tryUploadAttachment } from "@/lib/offline/attachment-store";
import { useSyncContext } from "@/contexts/sync-context";
import { Alert, AlertDialog, Button, Card, Chip, Tabs } from "@heroui/react";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Segment } from "@heroui-pro/react/segment";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

/* ── Sync queue status ────────────────────────────────────────────────── */

type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

const STATUS_META: Record<SyncStatus, { labelKey: string; color: ChipColor; Icon: React.ElementType }> = {
  "local-draft": { labelKey: "sync.statusLocalDraft", color: "default", Icon: Clock },
  pending:  { labelKey: "sync.statusPending",  color: "warning", Icon: Clock },
  syncing:  { labelKey: "sync.statusSyncing",  color: "default", Icon: Loader2 },
  synced:   { labelKey: "sync.statusSynced",   color: "success", Icon: CheckCircle2 },
  failed:   { labelKey: "sync.statusFailed",   color: "danger",  Icon: AlertCircle },
  conflict: { labelKey: "sync.statusConflict", color: "accent",  Icon: GitMerge },
};

function StatusBadge({ status }: { status: SyncStatus }) {
  const { t } = useTranslation("common");
  const { labelKey, color, Icon } = STATUS_META[status];
  return (
    <Chip size="sm" variant="soft" color={color} className="gap-1">
      <Icon className="size-3" />
      {t(labelKey)}
    </Chip>
  );
}

/** Icon button that asks for confirmation (HeroUI AlertDialog) before removing. */
function ConfirmRemove({ label, title, description, confirmLabel, cancelLabel, onConfirm }: {
  label: string; title: string; description: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} className="text-muted-foreground">
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog.Backdrop isKeyboardDismissDisabled={false}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger"><Trash2 className="size-5" /></AlertDialog.Icon>
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body><p>{description}</p></AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">{cancelLabel}</Button>
              <Button slot="close" variant="danger" onPress={onConfirm}>{confirmLabel}</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
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
          <div key={k} className={`flex gap-1.5 ${changed ? "bg-warning/10 rounded px-1 -mx-1" : ""}`}>
            <span className="font-medium text-muted-foreground shrink-0 min-w-[80px]">{k}:</span>
            <span className={`truncate ${changed ? "text-warning font-medium" : "text-foreground"}`}>
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
    <div className="rounded-xl border border-border bg-[var(--surface-secondary)] p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <GitMerge className="size-4 shrink-0 text-[var(--accent)]" />
        {t("sync.conflictHeading")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* ── Local version ── */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("sync.yourOfflineChange")}
            <span className="ms-1.5 font-normal">
              ({item.method} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })})
            </span>
          </p>
          <div className="rounded-lg bg-[var(--surface)] border border-border p-2 text-xs space-y-1 max-h-44 overflow-y-auto">
            {localData ? renderFields(localData) : (
              <p className="text-muted-foreground italic">{t("sync.noPayloadCaptured")}</p>
            )}
          </div>
        </div>

        {/* ── Server version ── */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("sync.currentServerState")}
            {serverState && serverUpdatedAt && (
              <span className="ms-1.5 font-normal">
                {t("sync.serverUpdatedAgo", { ago: formatDistanceToNow(new Date(String(serverUpdatedAt)), { addSuffix: true }) })}
              </span>
            )}
          </p>

          {!serverState && !loading && !fetchError && serverUrl && (
            <Button variant="outline" fullWidth className="h-auto py-4 text-xs" onPress={loadServer}>
              <ServerCrash className="size-4" />
              {t("sync.loadServerVersion")}
            </Button>
          )}

          {!serverUrl && (
            <div className="rounded-lg bg-[var(--surface)] border border-border p-3 text-xs text-muted-foreground italic">
              {t("sync.serverStateUnavailable")}
            </div>
          )}

          {loading && (
            <div className="rounded-lg bg-[var(--surface)] border border-border p-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4" /> {t("sync.fetchingServerState")}
            </div>
          )}

          {fetchError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive">
              <span className="font-medium">{t("sync.failedToLoad")}</span> {fetchError}
              <button onClick={loadServer} className="ms-2 underline">{t("sync.retry")}</button>
            </div>
          )}

          {serverState && (
            <div className="rounded-lg bg-[var(--surface)] border border-border p-2 text-xs space-y-1 max-h-44 overflow-y-auto">
              {renderFields(serverState, changedKeys)}
              {changedKeys.size > 0 && (
                <p className="text-xs text-warning mt-1">
                  ⚠ {t("sync.fieldsDiffer", { count: changedKeys.size })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button size="sm" variant="outline" onPress={onRetry}>
          <RotateCcw className="size-3.5" /> {t("sync.keepLocalRetry")}
        </Button>
        <Button size="sm" variant="danger-soft" onPress={onDiscard}>
          <Trash2 className="size-3.5" /> {t("sync.acceptServerDiscard")}
        </Button>
        {serverUrl && !serverState && (
          <Button size="sm" variant="ghost" onPress={loadServer} isDisabled={loading}>
            {loading ? <Loader2 className="size-3.5" /> : <ServerCrash className="size-3.5" />}
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
    <div className="border border-border rounded-xl overflow-hidden bg-[var(--surface)]">
      <div className="flex items-center gap-3">
        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl p-3 text-start transition-colors hover:bg-[var(--default)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset"
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
            <span className="font-medium text-sm text-foreground">{item.label}</span>
            <Chip size="sm" variant="soft" color="default">{item.module}</Chip>
            <StatusBadge status={item.syncStatus} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.method} {item.url.replace("/api", "")}
            {" · "}
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            {item.retryCount > 0 && ` · ${t("sync.retriesLabel", { count: item.retryCount })}`}
          </p>
        </div>
          {expanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />}
        </div>
        <div className="flex items-center gap-2 shrink-0 pe-3">
          {item.syncStatus === "failed" && (
            <Button size="sm" variant="outline" onPress={handleRetry}>
              <RotateCcw className="size-3.5" /> {t("sync.retry")}
            </Button>
          )}
          {item.syncStatus !== "synced" && (
            <ConfirmRemove
              label={t("sync.discardThisChange")}
              title={t("sync.discardThisChangeTitle")}
              description={t("sync.discardThisChangeDesc", { label: item.label })}
              confirmLabel={t("sync.discard")}
              cancelLabel={t("sync.cancel")}
              onConfirm={handleDiscard}
            />
          )}
        </div>
      </div>

      {expanded && (
        <div id={`sync-queue-detail-${item.id}`} className="border-t border-border bg-[var(--surface-secondary)]/60 px-3 py-2 space-y-1.5 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">{t("sync.clientId")}</span> {item.clientId}</div>
          {item.entityId && <div><span className="font-medium text-foreground">{t("sync.entityId")}</span> {item.entityId}</div>}
          {item.syncedAt && <div><span className="font-medium text-foreground">{t("sync.syncedLabel")}</span> {formatDistanceToNow(new Date(item.syncedAt), { addSuffix: true })}</div>}
          {item.lastError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2 text-destructive">
              <span className="font-medium">{t("sync.errorLabel")}</span> {item.lastError}
            </div>
          )}
          {item.syncStatus === "conflict" ? (
            <ConflictDetailPanel item={item} onRetry={handleRetry} onDiscard={handleDiscard} />
          ) : (
            item.body && (
              <details className="mt-1">
                <summary className="cursor-pointer font-medium text-foreground">{t("sync.payload")}</summary>
                <pre className="mt-1 overflow-auto rounded-lg bg-[var(--default)] p-2 text-xs text-foreground" dir="ltr">
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

const ATTACHMENT_META: Record<AttachmentStatus, { labelKey: string; color: ChipColor; Icon: React.ElementType; hintKey: string }> = {
  pending: {
    labelKey: "sync.attPending",
    color: "warning",
    Icon: Clock,
    hintKey: "sync.attPendingHint",
  },
  uploading: {
    labelKey: "sync.attUploading",
    color: "default",
    Icon: Loader2,
    hintKey: "sync.attUploadingHint",
  },
  uploaded: {
    labelKey: "sync.attUploaded",
    color: "success",
    Icon: CheckCircle2,
    hintKey: "sync.attUploadedHint",
  },
  failed: {
    labelKey: "sync.attFailed",
    color: "danger",
    Icon: XCircle,
    hintKey: "sync.attFailedHint",
  },
  "re-select-required": {
    labelKey: "sync.attReSelect",
    color: "warning",
    Icon: AlertTriangle,
    hintKey: "sync.attReSelectHint",
  },
};

function AttachmentStatusBadge({ status }: { status: AttachmentStatus }) {
  const { t } = useTranslation("common");
  const { labelKey, color, Icon } = ATTACHMENT_META[status];
  return (
    <Chip size="sm" variant="soft" color={color} className="gap-1">
      <Icon className="size-3" />
      {t(labelKey)}
    </Chip>
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
    <div className="border border-border rounded-xl overflow-hidden bg-[var(--surface)]">
      <div className="flex items-center gap-3 p-3">
        <div className="shrink-0 size-8 rounded-full bg-[var(--default)] flex items-center justify-center">
          <Paperclip className="size-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate max-w-[200px]">{item.fileName}</span>
            <AttachmentStatusBadge status={item.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatBytes(item.fileSize)} · {item.contentType}
            {" · "}
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          </p>
          <p className="text-xs text-muted-foreground mt-1 italic">{t(meta.hintKey)}</p>
          {item.lastError && (
            <p className="text-xs text-destructive mt-1">{t("sync.errorLabel")} {item.lastError}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(item.status === "failed") && isOnline && (
            <Button size="sm" variant="outline" onPress={handleRetry}>
              <UploadCloud className="size-3.5" /> {t("sync.retry")}
            </Button>
          )}
          {item.status !== "uploading" && (
            <ConfirmRemove
              label={t("sync.removeAttachmentEntry")}
              title={t("sync.removeAttachmentTitle")}
              description={t("sync.removeAttachmentDesc", { fileName: item.fileName })}
              confirmLabel={t("sync.remove")}
              cancelLabel={t("sync.cancel")}
              onConfirm={handleDismiss}
            />
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
  // KPIGroup has no responsive orientation of its own.
  const isMobile = useIsMobile();

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

  const connectivityLabel = connectivityState === "online"
    ? t("sync.online")
    : connectivityState === "offline"
      ? t("sync.offline")
      : connectivityState === "checking"
        ? t("sync.checkingConnection")
        : connectivityState === "degraded"
          ? t("sync.serviceUnavailable")
          : connectivityState === "auth-required"
            ? t("sync.authenticationRequired")
            : t("sync.accessDenied");

  const stats = [
    { key: "pending", label: t("sync.pending"), count: counts.pending, status: "warning" as const, Icon: Clock },
    { key: "synced", label: t("sync.synced"), count: counts.synced, status: "success" as const, Icon: CheckCircle2 },
    { key: "failed", label: t("sync.failed"), count: counts.failed, status: "danger" as const, Icon: AlertCircle },
    { key: "conflict", label: t("sync.conflicts"), count: counts.conflict, status: undefined, Icon: GitMerge },
  ];

  const filters: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: t("all"), count: counts.all },
    { id: "pending", label: t("sync.pending"), count: counts.pending },
    { id: "synced", label: t("sync.synced"), count: counts.synced },
    { id: "failed", label: t("sync.failed"), count: counts.failed },
    { id: "conflict", label: t("sync.conflicts"), count: counts.conflict },
  ].filter((f) => f.id === "all" || f.count > 0) as { id: FilterTab; label: string; count: number }[];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-foreground text-xl font-semibold">{t("sync.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("sync.description")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Chip size="sm" variant="soft" color={connectivityState === "online" ? "success" : "warning"} className="gap-1">
            {connectivityState === "online" ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            {connectivityLabel}
          </Chip>
          {counts.synced > 0 && (
            <Button size="sm" variant="outline" onPress={clearSynced}>
              <Trash2 className="size-3.5" /> {t("sync.clearSynced")}
            </Button>
          )}
          {(counts.failed > 0 || counts.conflict > 0) && (
            <Button size="sm" variant="outline" onPress={handleRetryAll}>
              <RotateCcw className="size-3.5" /> {t("sync.retryAll")}
            </Button>
          )}
          <Button
            size="sm"
            onPress={triggerSync}
            isDisabled={!isOnline || isSyncing || (counts.pending + counts.failed === 0)}
          >
            {isSyncing ? <Loader2 className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            {isSyncing ? t("sync.syncing") : t("sync.syncNow")}
          </Button>
        </div>
      </div>

      {/* Stats — HeroUI Pro KPI group */}
      <KPIGroup orientation={isMobile ? "vertical" : "horizontal"}>
        {stats.map(({ key, label, count, status, Icon }, index) => (
          <Fragment key={key}>
            {index > 0 && <KPIGroup.Separator />}
            <KPI>
              <KPI.Header>
                <KPI.Icon status={status}><Icon className="size-4" aria-hidden /></KPI.Icon>
                <KPI.Title>{label}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value value={count} />
              </KPI.Content>
            </KPI>
          </Fragment>
        ))}
      </KPIGroup>

      {/* Main tabs: Queue | Attachments */}
      <Tabs selectedKey={pageTab} onSelectionChange={(v) => setPageTab(v as PageTab)}>
        <Tabs.ListContainer>
          <Tabs.List aria-label={t("sync.title")}>
            <Tabs.Tab id="queue" className="gap-1.5 whitespace-nowrap">
              {t("sync.actionQueue")}
              {counts.all > 0 && <Chip size="sm" variant="soft" color="default"><bdi dir="ltr">{counts.all}</bdi></Chip>}
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="attachments" className="gap-1.5 whitespace-nowrap">
              {t("sync.attachments")}
              {attachmentCount > 0 && <Chip size="sm" variant="soft" color="warning"><bdi dir="ltr">{attachmentCount}</bdi></Chip>}
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        {/* ── Action Queue tab ─────────────────────────────────────────── */}
        <Tabs.Panel id="queue" className="mt-4">
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("sync.actionQueue")}</Card.Title>
              <Card.Description>{t("sync.actionQueueDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
              {allItems.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="size-10 text-success mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">{t("sync.noOfflineActions")}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("sync.noOfflineActionsDesc")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status filter — HeroUI Pro Segment */}
                  <div className="overflow-x-auto">
                    <Segment
                      aria-label={t("sync.title")}
                      size="sm"
                      selectedKey={activeTab}
                      onSelectionChange={(key) => setActiveTab(key as FilterTab)}
                    >
                      {filters.map((f) => (
                        <Segment.Item key={f.id} id={f.id} className="whitespace-nowrap">
                          {f.label} (<bdi dir="ltr">{f.count}</bdi>)
                        </Segment.Item>
                      ))}
                    </Segment>
                  </div>
                  <div className="space-y-2">
                    {filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">{t("sync.noItemsInCategory")}</p>
                    ) : (
                      filtered.map((item) => <QueueItemRow key={item.id} item={item} />)
                    )}
                  </div>
                </div>
              )}
            </Card.Content>
          </Card>
        </Tabs.Panel>

        {/* ── Attachments tab ──────────────────────────────────────────── */}
        <Tabs.Panel id="attachments" className="mt-4">
          <Card>
            <Card.Header>
              <Card.Title className="text-base">{t("sync.attachmentQueue")}</Card.Title>
              <Card.Description>{t("sync.attachmentQueueDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
              {allAttachments.length === 0 ? (
                <div className="py-12 text-center">
                  <Paperclip className="size-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">{t("sync.noPendingAttachments")}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("sync.noPendingAttachmentsDesc")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Re-select required notice */}
                  {allAttachments.some(a => a.status === "re-select-required") && (
                    <Alert status="warning" className="mb-4">
                      <Alert.Indicator><AlertTriangle className="size-4" aria-hidden /></Alert.Indicator>
                      <Alert.Content>
                        <Alert.Title>{t("sync.reSelectRequired")}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  {allAttachments.map((item) => (
                    <AttachmentRow key={item.id} item={item} isOnline={isOnline} />
                  ))}
                </div>
              )}
            </Card.Content>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
