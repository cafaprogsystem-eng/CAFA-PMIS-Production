import { Link } from "wouter";
import { WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSyncContext } from "@/contexts/sync-context";

export function OfflineIndicator() {
  const { isOnline, connectivityState, isSyncing, pendingCount, failedCount, conflictCount } = useSyncContext();
  const { t } = useTranslation("common");

  // Authentication and authorisation are API outcomes, not connectivity
  // outages. The route/page owns how those errors are presented.
  if (connectivityState === "auth-required" || connectivityState === "access-denied") {
    return null;
  }

  if (connectivityState === "checking") {
    return (
      <div role="status" aria-live="polite" className="fixed bottom-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-medium text-amber-950 shadow-lg">
        <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
        {t("sync.checkingConnection")}
      </div>
    );
  }

  if (connectivityState === "degraded") {
    return (
      <div role="status" aria-live="polite" className="fixed bottom-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-orange-500 px-4 py-2.5 text-sm font-medium text-orange-950 shadow-lg">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {t("sync.serviceUnavailable")}
      </div>
    );
  }

  // Show nothing when fully online with nothing pending
  if (isOnline && !isSyncing && pendingCount === 0 && failedCount === 0 && conflictCount === 0) {
    return null;
  }

  // Back online + actively syncing
  if (isOnline && isSyncing) {
    return (
      <div role="status" aria-live="polite" className="fixed bottom-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
        <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
        {t("sync.backOnlineSyncing", { count: pendingCount })}
      </div>
    );
  }

  // Online but has failed or conflict items — show this BEFORE pending so urgent
  // issues are never hidden behind the lower-priority amber banner.
  if (isOnline && (failedCount > 0 || conflictCount > 0)) {
    return (
      <Link href="/sync-status">
        <div role="status" aria-live="assertive" className="fixed bottom-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-red-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg cursor-pointer hover:bg-red-600 transition-colors">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {t("sync.syncIssues", { count: failedCount + conflictCount })}
        </div>
      </Link>
    );
  }

  // Online but still has pending items (waiting for next sync trigger)
  if (isOnline && pendingCount > 0) {
    return (
      <Link href="/sync-status">
        <div className="fixed bottom-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-lg cursor-pointer hover:bg-amber-600 transition-colors">
          <RefreshCw className="h-4 w-4 shrink-0" />
          {t("sync.changesPendingSync", { count: pendingCount })}
        </div>
      </Link>
    );
  }

  // Currently offline — the most important state to communicate clearly.
  return (
    <div className="fixed bottom-0 inset-x-0 z-[100]">
      <div role="status" aria-live="polite" className="flex items-center justify-between gap-2 bg-yellow-500 px-4 py-2.5 text-sm font-semibold text-yellow-950 shadow-lg">
        <div className="flex items-center gap-2 min-w-0">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {t("sync.offlineBanner")}
            {pendingCount > 0 && (
              <span className="ms-1 font-normal opacity-80">
                {t("sync.changesQueued", { count: pendingCount })}
              </span>
            )}
          </span>
        </div>
        <Link href="/sync-status">
          <span className="text-xs underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity cursor-pointer shrink-0 whitespace-nowrap">
            {t("sync.viewQueue")}
          </span>
        </Link>
      </div>
    </div>
  );
}
