import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StateReferenceStatus as Status } from "@/lib/state-reference-data";

type Props = {
  status: Exclude<Status, "ready">;
  loadingText: string;
  errorText: string;
  emptyText: string;
  retryText: string;
  onRetry: () => void;
};

export function StateReferenceStatus({
  status,
  loadingText,
  errorText,
  emptyText,
  retryText,
  onRetry,
}: Props) {
  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {loadingText}
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm" role="alert">
      <span className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {status === "error" ? errorText : emptyText}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        {retryText}
      </Button>
    </div>
  );
}