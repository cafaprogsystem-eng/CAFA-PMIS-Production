import { RefreshCw } from "@/components/icons";
import { Alert, Button, Spinner } from "@heroui/react";
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
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--default)] px-3 py-2 text-sm text-[var(--muted)]" role="status">
        <Spinner size="sm" aria-hidden="true" />
        {loadingText}
      </div>
    );
  }

  return (
    <Alert status="danger" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{status === "error" ? errorText : emptyText}</Alert.Description>
      </Alert.Content>
      <Button variant="secondary" size="sm" onPress={onRetry}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        {retryText}
      </Button>
    </Alert>
  );
}
