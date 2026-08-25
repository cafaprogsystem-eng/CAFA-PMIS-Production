import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Clock, GitMerge, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <div className={`mb-4 flex items-start gap-2 rounded-md border p-2 text-xs ${attention ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-muted/30 text-muted-foreground"}`} role={attention ? "alert" : "status"}>
      <Badge variant="outline" className="shrink-0 gap-1">
        <Icon className="h-3 w-3" />
        {t(`sync.status.${status}`)}
      </Badge>
      <span>{error || t(`sync.draftState.${status}`)}</span>
    </div>
  );
}