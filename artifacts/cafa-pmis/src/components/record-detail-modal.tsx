/**
 * RecordDetailModal
 *
 * Shared viewer container for substantive read-only records. It intentionally
 * owns only dialog presentation and accessibility; callers retain their
 * existing authorised data, actions, and workflow handling.
 *
 * Contract:
 * - wide, centred, viewport-constrained HeroUI Modal ("cover" size) on desktop
 * - near/full-screen fallback on small screens
 * - fixed header and optional footer around one independently scrolling body
 * - logical (RTL-safe) alignment and close placement
 * - optional safe loading, unavailable, and retryable-error presentations
 * - optional focus restoration for list/card triggers that are not the trigger
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal } from "@heroui/react";
import { X } from "@/components/icons";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";

export type RecordDetailModalState = "ready" | "loading" | "unavailable" | "error";

export type RecordDetailModalProps = {
  open: boolean;
  onClose: () => void;
  /** Runs after the closing animation, once focus restoration can complete. */
  onCloseComplete?: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Badges or compact contextual metadata displayed in the fixed header. */
  metadata?: React.ReactNode;
  /** Authorised record actions displayed in the fixed header. */
  headerActions?: React.ReactNode;
  /** Authorised workflow actions that remain visible below the scroll body. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** Restores focus after close when a list row/card opened the dialog. */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  state?: RecordDetailModalState;
  stateTitle?: string;
  stateDescription?: string;
  onRetry?: () => void;
  className?: string;
  bodyClassName?: string;
};

function RecordDetailState({
  state,
  title,
  description,
  onRetry,
}: {
  state: Exclude<RecordDetailModalState, "ready">;
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation("common");
  if (state === "loading") {
    return (
      <div className="space-y-4 px-1 py-2" aria-busy="true" aria-label={t("recordDetails.loading")}>
        <div className="h-5 w-2/5 animate-pulse rounded bg-[var(--default)]" />
        <div className="h-4 w-full animate-pulse rounded bg-[var(--default)]" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--default)]" />
        <div className="h-32 w-full animate-pulse rounded-lg bg-[var(--default)]" />
      </div>
    );
  }

  return (
    <ErrorState
      variant={state === "unavailable" ? "not-found" : "server"}
      title={title ?? (state === "unavailable" ? t("recordDetails.unavailable") : t("recordDetails.error"))}
      description={description ?? (
        state === "unavailable" ? t("recordDetails.unavailableDescription") : t("recordDetails.errorDescription")
      )}
      retryLabel={t("recordDetails.retry")}
      onRetry={state === "error" ? onRetry : undefined}
    />
  );
}

/**
 * Rendered inside the dialog: it unmounts only after the exit animation has
 * finished, which is when focus can be restored and follow-up overlays opened.
 */
function CloseCompleteSentinel({ onUnmount }: { onUnmount: () => void }) {
  const latest = React.useRef(onUnmount);
  latest.current = onUnmount;
  React.useEffect(() => () => latest.current(), []);
  return null;
}

export function RecordDetailModal({
  open,
  onClose,
  onCloseComplete,
  title,
  description,
  metadata,
  headerActions,
  footer,
  children,
  restoreFocusRef,
  state = "ready",
  stateTitle,
  stateDescription,
  onRetry,
  className,
  bodyClassName,
}: RecordDetailModalProps) {
  const { t } = useTranslation("common");
  const descriptionId = React.useId();
  const afterClose = React.useCallback(() => {
    restoreFocusRef?.current?.focus();
    onCloseComplete?.();
  }, [onCloseComplete, restoreFocusRef]);

  return (
    <Modal isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="cover" scroll="inside" className="max-sm:p-0">
          <Modal.Dialog
            aria-describedby={descriptionId}
            className={cn(
              "flex h-[calc(100dvh-3rem)] max-h-[calc(100dvh-3rem)] w-[92vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 text-start",
              "max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none",
              className,
            )}
            data-record-detail-modal
          >
            <CloseCompleteSentinel onUnmount={afterClose} />
            <header className="shrink-0 border-b border-[var(--border)] px-5 py-3 sm:px-8">
              <div className="flex min-w-0 flex-wrap items-start gap-3">
                <div className="min-w-0 flex-[1_1_16rem]">
                  <Modal.Heading className="break-words text-base font-medium leading-snug sm:text-lg">
                    {title}
                  </Modal.Heading>
                  <p id={descriptionId} className={description ? "mt-1 break-words text-sm text-[var(--muted)]" : "sr-only"}>
                    {description ?? t("recordDetails.title")}
                  </p>
                  {metadata && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {metadata}
                    </div>
                  )}
                </div>
                {headerActions && (
                  <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
                    {headerActions}
                  </div>
                )}
                <Button
                  slot="close"
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="ms-auto shrink-0"
                  aria-label={t("recordDetails.close")}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </header>

            <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", bodyClassName)} data-record-detail-body>
              <div className="w-full px-5 py-6 sm:px-8">
                {state === "ready"
                  ? children
                  : <RecordDetailState state={state} title={stateTitle} description={stateDescription} onRetry={onRetry} />}
              </div>
            </div>

            {footer && (
              <footer className="shrink-0 border-t border-[var(--border)] px-5 py-3 sm:px-8" data-record-detail-footer>
                <div className="flex w-full flex-wrap items-center gap-2">
                  {footer}
                </div>
              </footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
