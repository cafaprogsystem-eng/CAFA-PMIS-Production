import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getOfflineUser, type ReportDraftSnapshot, type ReportDraftStatus, type SyncFailureCode } from "./db";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ReportDraftType = ReportDraftSnapshot["reportType"];

/**
 * A local draft untouched for this long is flagged stale: the reporting
 * period it targets, or the user's access to its project/state/sector, may
 * have changed since the last save. The server re-validates everything on
 * actual submit regardless — this is purely an early, visible warning so a
 * user resuming very old offline content notices before investing more time
 * in a period/scope that may no longer be valid.
 */
export const DRAFT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isDraftStale(updatedAt: number, now: number = Date.now()): boolean {
  return now - updatedAt > DRAFT_STALE_AFTER_MS;
}

export interface ReportDraftStoreOptions<T> {
  /** A stable identity for one editor (for example project:new or report:42). */
  draftKey: string;
  reportType: ReportDraftType;
  serverReportId?: number | null;
  baseRevision?: string | null;
  title?: string;
  snapshot: T;
  /** Called once when an existing device snapshot is found. */
  onRestore: (snapshot: T) => void;
  enabled?: boolean;
}

function currentUserId(): number | null {
  const active = getOfflineUser();
  if (active !== null) return active;
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem("cafa.userId");
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Storage keys include the account so a shared device cannot cross-pollinate drafts. */
export function storageDraftKey(userId: number, draftKey: string): string {
  return `${userId}:${draftKey}`;
}

export function reportDraftKey(reportType: ReportDraftType, identity: string | number = "new"): string {
  return `${reportType}:${identity}`;
}

function safeTitle(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : "";
}

export async function getReportDraft(draftKey: string, userId = currentUserId()): Promise<ReportDraftSnapshot | undefined> {
  if (userId === null) return undefined;
  return db.reportDrafts.get(storageDraftKey(userId, draftKey));
}

export async function listReportDrafts(
  reportType?: ReportDraftType,
  userId = currentUserId(),
): Promise<ReportDraftSnapshot[]> {
  if (userId === null) return [];
  return db.reportDrafts.where("userId").equals(userId).and((row) =>
    reportType ? row.reportType === reportType : true,
  ).sortBy("updatedAt");
}

export async function saveReportDraft<T>(
  options: Omit<ReportDraftStoreOptions<T>, "snapshot" | "onRestore" | "enabled">,
  snapshot: T,
): Promise<ReportDraftSnapshot | undefined> {
  const userId = currentUserId();
  if (userId === null) return undefined;
  const key = storageDraftKey(userId, options.draftKey);
  const now = Date.now();
  const previous = await db.reportDrafts.get(key);
  const row: ReportDraftSnapshot = {
    draftKey: key,
    userId,
    reportType: options.reportType,
    serverReportId: options.serverReportId ?? previous?.serverReportId ?? null,
    snapshot: JSON.stringify(snapshot),
    title: safeTitle(options.title ?? previous?.title),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    lastSavedAt: now,
    // A local edit supersedes a prior success; the next explicit Save Draft or
    // queued replay is what makes it server-authoritative again.
    status: "local-draft",
    baseRevision: options.baseRevision ?? previous?.baseRevision ?? null,
    // An edit after a queued save is newer local work. It must not be settled
    // or discarded when that earlier operation eventually completes.
    syncOperationId: null,
    failureCode: null,
    lastError: null,
  };
  await db.reportDrafts.put(row);
  return row;
}

export async function markReportDraftPending(
  draftKey: string,
  syncOperationId?: string | null,
): Promise<void> {
  const existing = await db.reportDrafts.get(draftKey);
  if (!existing) return;
  await db.reportDrafts.update(draftKey, {
    status: "pending",
    syncOperationId: syncOperationId ?? existing.syncOperationId,
    failureCode: null,
    lastError: null,
    updatedAt: Date.now(),
  });
}

export async function settleReportDraftOperation(
  draftKey: string,
  operationId: string,
  status: Extract<ReportDraftStatus, "synced" | "failed" | "conflict">,
  failureCode: SyncFailureCode | null,
  lastError: string | null,
): Promise<void> {
  const existing = await db.reportDrafts.get(draftKey);
  // Never settle a later local edit using an older replay result.
  if (!existing || existing.syncOperationId !== operationId) return;
  if (status === "synced") {
    await db.reportDrafts.delete(draftKey);
    return;
  }
  await db.reportDrafts.update(draftKey, {
    status,
    failureCode,
    lastError,
    updatedAt: Date.now(),
  });
}

export async function removeReportDraft(draftKey: string): Promise<void> {
  await db.reportDrafts.delete(draftKey);
}

/**
 * Connects an editor to the durable snapshot store. It deliberately does not
 * submit anything by itself: server draft creation/update stays behind the
 * existing Save Draft action and the reviewed offline queue.
 */
export function useOfflineReportDraft<T>({
  draftKey,
  reportType,
  serverReportId,
  baseRevision,
  title,
  snapshot,
  onRestore,
  enabled = true,
}: ReportDraftStoreOptions<T>) {
  const userId = currentUserId();
  const storageKey = userId === null ? null : storageDraftKey(userId, draftKey);
  const [loaded, setLoaded] = useState(!enabled || userId === null);
  const restoredRef = useRef(false);
  const lastPersistedJson = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stored = useLiveQuery(
    () => storageKey ? db.reportDrafts.get(storageKey) : undefined,
    [storageKey],
  );

  const snapshotJson = useMemo(() => {
    try { return JSON.stringify(snapshot); } catch { return ""; }
  }, [snapshot]);

  useEffect(() => {
    restoredRef.current = false;
    lastPersistedJson.current = null;
    setLoaded(!enabled || storageKey === null);
    if (!enabled || storageKey === null) return;
    let cancelled = false;
    void db.reportDrafts.get(storageKey).then((row) => {
      if (cancelled) return;
      if (row && !restoredRef.current) {
        try {
          onRestore(JSON.parse(row.snapshot) as T);
          restoredRef.current = true;
        } catch {
          // Corrupt local content must not prevent the editor opening.
        }
      }
      // Opening an untouched editor must not create an empty "draft" row.
      // Only an actual change after this baseline is persisted.
      lastPersistedJson.current = row?.snapshot ?? snapshotJson;
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  // onRestore is intentionally the caller's stable restore callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, snapshotJson, storageKey]);

  useEffect(() => {
    if (
      !enabled ||
      !loaded ||
      userId === null ||
      !snapshotJson ||
      lastPersistedJson.current === snapshotJson
    ) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveReportDraft(
        { draftKey, reportType, serverReportId, baseRevision, title },
        snapshot,
      ).then(() => {
        lastPersistedJson.current = snapshotJson;
      }).catch(() => {
        // IndexedDB can be unavailable in private browsing; keeping the form
        // usable is safer than converting a local persistence error into data loss.
      });
    }, 650);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [baseRevision, draftKey, enabled, loaded, reportType, serverReportId, snapshot, snapshotJson, title, userId]);

  const status = stored?.status ?? "local-draft";
  return {
    stored,
    hasLocalDraft: Boolean(stored),
    isStale: stored ? isDraftStale(stored.updatedAt) : false,
    status,
    storageKey,
    saveNow: () => saveReportDraft(
      { draftKey, reportType, serverReportId, baseRevision, title },
      snapshot,
    ),
    markPending: async (operationId?: string | null) => {
      if (!storageKey) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const row = await saveReportDraft(
        { draftKey, reportType, serverReportId, baseRevision, title },
        snapshot,
      );
      if (row) {
        lastPersistedJson.current = JSON.stringify(snapshot);
        await markReportDraftPending(row.draftKey, operationId);
      }
    },
    remove: async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (storageKey) await removeReportDraft(storageKey);
      lastPersistedJson.current = snapshotJson;
    },
  };
}

export function useOfflineReportDrafts(reportType?: ReportDraftType) {
  const userId = currentUserId();
  return useLiveQuery(
    () => listReportDrafts(reportType, userId),
    [reportType, userId],
    [] as ReportDraftSnapshot[],
  ) ?? [];
}

export function OfflineReportDraftStatus({
  status,
  savedAt,
  error,
  onDiscard,
  className,
  isStale = false,
}: {
  status: ReportDraftStatus;
  savedAt?: number;
  error?: string | null;
  onDiscard?: () => void;
  className?: string;
  /** True when the draft hasn't been touched in over DRAFT_STALE_AFTER_MS —
   *  see useOfflineReportDraft's isStale. */
  isStale?: boolean;
}) {
  const { t, i18n } = useTranslation("common");
  const label = t(`sync.status.${status}`, { defaultValue: status });
  const needsRecovery = status === "failed" || status === "conflict";
  return createElement(
    "div",
    { className: cn("space-y-1 text-xs text-muted-foreground", className), role: needsRecovery ? "alert" : "status" },
    createElement(
      "div",
      { className: "flex items-center gap-2" },
    createElement(
      Badge,
      { variant: status === "conflict" || status === "failed" ? "destructive" : "secondary", className: "text-[10px]" },
      label,
    ),
    savedAt
      ? createElement("span", null, t("sync.savedOnDeviceAt", { date: new Date(savedAt).toLocaleString(i18n.language) }))
      : null,
    ),
    needsRecovery
      ? createElement(
        "div",
        { className: "space-y-1 rounded border border-destructive/25 bg-destructive/5 p-2" },
        createElement("p", null, status === "conflict" ? t("sync.conflictRecovery") : t("sync.draftSyncRecovery")),
        error ? createElement("p", { className: "break-words text-muted-foreground" }, error) : null,
        onDiscard
          ? createElement(
            "button",
            { type: "button", onClick: onDiscard, className: "font-medium text-destructive underline underline-offset-2" },
            t("sync.discardLocalDraft"),
          )
          : null,
      )
      : null,
    // Staleness is a softer, secondary warning — skip it when the recovery
    // banner above is already showing to avoid stacking two alerts.
    !needsRecovery && isStale
      ? createElement(
        "div",
        { role: "alert", className: "rounded border border-warning/30 bg-warning/10 p-2 text-warning" },
        t("sync.staleDraftWarning", { days: Math.floor(DRAFT_STALE_AFTER_MS / (24 * 60 * 60 * 1000)) }),
      )
      : null,
  );
}