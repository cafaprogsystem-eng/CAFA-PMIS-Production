import type { ReactNode } from "react";
import { Button, Modal } from "@heroui/react";
import { AlertTriangle } from "@/components/icons";

/**
 * Confirmation dialog on the HeroUI Modal (role="alertdialog"), replacing the
 * shadcn AlertDialog and native confirm(). The cancel button takes focus so a
 * stray Enter never confirms. `tone="danger"` is for destructive actions.
 * While `isPending`, both buttons are locked and Escape / outside press are
 * ignored, so an in-flight action can't be abandoned half way.
 */
export function ConfirmModal({
  isOpen, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, isPending, tone = "danger", children, backdropClassName,
}: {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  tone?: "danger" | "primary";
  /** Extra content under the message, e.g. an error alert. */
  children?: ReactNode;
  /** Raises the dialog above a custom overlay (e.g. the command palette at z-200). */
  backdropClassName?: string;
}) {
  const danger = tone === "danger";
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open && !isPending) onCancel(); }}>
      <Modal.Backdrop isDismissable={!isPending} className={backdropClassName}>
        <Modal.Container size="sm">
          <Modal.Dialog role="alertdialog">
            <Modal.Header>
              <Modal.Icon
                className={danger
                  ? "bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]"
                  : "bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] text-[var(--warning)]"}
              >
                <AlertTriangle className="size-5" aria-hidden="true" />
              </Modal.Icon>
              <Modal.Heading>{title}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{message}</p>
            </Modal.Header>
            {children && <Modal.Body>{children}</Modal.Body>}
            <Modal.Footer>
              <Button variant="secondary" autoFocus onPress={onCancel} isDisabled={isPending}>{cancelLabel}</Button>
              <Button variant={danger ? "danger" : "primary"} onPress={onConfirm} isPending={isPending}>{confirmLabel}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
