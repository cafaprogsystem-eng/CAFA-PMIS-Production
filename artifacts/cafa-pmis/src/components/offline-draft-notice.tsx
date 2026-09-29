import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Clock, GitMerge, Loader2 } from "@/components/icons";
import { Chip } from "@heroui/react";
import type { DraftStatus } from "@/lib/offline/draft-store";

const icons = {
  "local-draft": Clock,
  pending: Clock,
  synced: CheckCircle2,
  failed: AlertCircle,
  conflict: GitMerge,
};

export function OfflineDraftNotice({ status, error }: { status: DraftStatus | null; error?: string | null }) {
  const { t } = useTranslation("common");
  if (!status) return null;
  const Icon = icons[status] ?? Loader2;
  const attention = status === "failed" || status === "conflict";
  return (
    <div className={`mb-4 flex items-start gap-2 rounded-xl border p-2 text-xs ${attention ? "border-[var(--danger)]/30 bg-[var(--danger)]/5 text-[var(--danger)]" : "border-[var(--border)] bg-[var(--default)] text-[var(--muted)]"}`} role={attention ? "alert" : "status"}>
      <Chip size="sm" variant="soft" color={attention ? "danger" : status === "synced" ? "success" : "default"} className="shrink-0 gap-1">
        <Icon className="size-3" aria-hidden="true" />
        {t(`sync.status.${status}`)}
      </Chip>
      <span>{error || t(`sync.draftState.${status}`)}</span>
    </div>
  );
}