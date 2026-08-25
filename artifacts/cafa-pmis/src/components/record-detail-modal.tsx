/**
 * RecordDetailModal
 *
 * Shared viewer container for substantive read-only records. It intentionally
 * owns only dialog presentation and accessibility; callers retain their
 * existing authorised data, actions, and workflow handling.
 *
 * Contract:
 * - wide, centred, viewport-constrained dialog on desktop
 * - near/full-screen fallback on small screens
 * - fixed header and optional footer around one independently scrolling body
 * - logical (RTL-safe) alignment and close placement
 * - optional safe loading, unavailable, and retryable-error presentations
 * - optional focus restoration for list/card triggers that are not DialogTrigger
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
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
        <div className="h-5 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
        <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <ErrorState
      variant={state === "unavailable" ? "not-found" : "server"}
      title={title ?? (state === "unavailable" ? "Record unavailable" : "Could not load record")}
      description={description ?? (
        state === "unavailable"
          ? "This record is unavailable or you no longer have access to it."
          : "The record could not be loaded. Please try again."
      )}
      onRetry={state === "error" ? onRetry : undefined}
    />
  );
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
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          role="dialog"
          aria-modal="true"
          className={cn(
            // Physical left + translate-x centring is direction-independent. Do
            // not replace left with logical start here: start resolves to right
            // in RTL while translate-x remains a physical leftward movement.
            "fixed left-1/2 top-1/2 z-50 flex h-[calc(100dvh-3rem)] max-h-[calc(100dvh-3rem)] w-[92vw] max-w-[1400px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-card-border bg-card text-start shadow-xl outline-none",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none",
            className,
          )}
          data-record-detail-modal
          onCloseAutoFocus={(event) => {
            if (!restoreFocusRef?.current) return;
            event.preventDefault();
            restoreFocusRef.current.focus();
          }}
          onAnimationEnd={(event) => {
            if (
              event.target === event.currentTarget
              && event.currentTarget.getAttribute("data-state") === "closed"
            ) {
              onCloseComplete?.();
            }
          }}
        >
          <header className="shrink-0 border-b bg-card px-5 py-3 sm:px-8">
            <div className="flex min-w-0 flex-wrap items-start gap-3">
              <div className="min-w-0 flex-[1_1_16rem]">
                <DialogTitle className="break-words text-base font-medium leading-snug text-foreground sm:text-lg">
                  {title}
                </DialogTitle>
                {description ? (
                  <DialogDescription className="mt-1 break-words text-start">
                    {description}
                  </DialogDescription>
                ) : (
                  <DialogDescription className="sr-only">{t("recordDetails.title")}</DialogDescription>
                )}
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
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ms-auto h-8 w-8 shrink-0"
                  aria-label={t("recordDetails.close")}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </header>

          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", bodyClassName)}>
            <div className="w-full px-5 py-6 sm:px-8">
              {state === "ready"
                ? children
                : <RecordDetailState state={state} title={stateTitle} description={stateDescription} onRetry={onRetry} />}
            </div>
          </div>

          {footer && (
            <footer className="shrink-0 border-t bg-card px-5 py-3 sm:px-8">
              <div className="flex w-full flex-wrap items-center gap-2">
                {footer}
              </div>
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}