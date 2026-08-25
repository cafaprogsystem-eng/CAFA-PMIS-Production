import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSocket, useWatchRecord } from "@/lib/socket";

interface LockState {
  locked: boolean;
  lockedBy: { id: number; name: string } | null;
  lockedAt: string | null;
}

interface RecordLockIndicatorProps {
  entityType: "project" | "report" | "plan" | "risk";
  entityId: number;
  currentUserId: number;
  /** Call this to acquire a lock when the user starts editing */
  onAcquireLock?: () => void;
}

export function RecordLockIndicator({
  entityType,
  entityId,
  currentUserId,
  onAcquireLock,
}: RecordLockIndicatorProps) {
  const { t } = useTranslation("common");
  const [lockState, setLockState] = useState<LockState | null>(null);
  const { socket } = useSocket();

  useWatchRecord(entityType, entityId);

  // Fetch initial lock state from server
  useEffect(() => {
    fetch(`/api/realtime/locks/${entityType}/${entityId}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LockState | null) => {
        if (d) setLockState(d);
      })
      .catch(() => {});
  }, [entityType, entityId]);

  // Listen for real-time lock events
  useEffect(() => {
    if (!socket) return;
    const handler = (event: {
      entityType: string;
      entityId: number;
      action: "locked" | "unlocked";
      lockedBy?: { id: number; name: string };
    }) => {
      if (event.entityType !== entityType || event.entityId !== entityId)
        return;
      if (event.action === "unlocked") {
        setLockState((prev) =>
          prev ? { ...prev, locked: false, lockedBy: null, lockedAt: null } : null,
        );
      } else if (event.action === "locked" && event.lockedBy) {
        setLockState({
          locked: true,
          lockedBy: event.lockedBy,
          lockedAt: new Date().toISOString(),
        });
      }
    };
    socket.on("record:lock", handler);
    return () => {
      socket.off("record:lock", handler);
    };
  }, [socket, entityType, entityId]);

  // Don't show warning if no lock, or the current user holds it
  if (!lockState?.locked || lockState.lockedBy?.id === currentUserId) {
    return null;
  }

  return (
    <Alert className="border-amber-200 bg-amber-50 mb-3">
      <Lock className="h-4 w-4 text-amber-600 shrink-0" />
      <AlertDescription className="text-amber-800 text-sm">
        <span className="font-semibold">{lockState.lockedBy?.name}</span>{" "}
        {t("recordLock.isEditing")}
        {onAcquireLock && (
          <button
            onClick={onAcquireLock}
            className="ms-2 underline text-amber-900 hover:text-amber-700 text-xs"
          >
            {t("recordLock.takeOver")}
          </button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Hook to acquire/release a record lock around an edit session */
export function useRecordLock(
  entityType: "project" | "report" | "plan" | "risk",
  entityId: number | undefined,
) {
  const acquire = async (): Promise<
    { ok: true } | { ok: false; error: string; lockedBy?: { id: number; name: string } }
  > => {
    if (!entityId) return { ok: false, error: "no_entity_id" };
    const r = await fetch("/api/realtime/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ entityType, entityId }),
    });
    if (r.ok) return { ok: true };
    const body = await r.json().catch(() => ({}));
    return { ok: false, error: body.error ?? "unknown", lockedBy: body.lockedBy };
  };

  const release = async (): Promise<void> => {
    if (!entityId) return;
    await fetch("/api/realtime/locks/release", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ entityType, entityId }),
    }).catch(() => {});
  };

  return { acquire, release };
}
