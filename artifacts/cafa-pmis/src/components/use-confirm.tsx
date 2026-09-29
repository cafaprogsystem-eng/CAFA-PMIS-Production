import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmModal } from "@/components/confirm-modal";

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "danger" | "primary";
  backdropClassName?: string;
};

/**
 * Promise-based confirmation on the shared HeroUI ConfirmModal, so a flow that
 * used `if (!window.confirm(...)) return;` becomes
 * `if (!(await confirm({...}))) return;` without restructuring. Render the
 * returned dialog once in the component.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false); // a newer request replaces an unanswered one
    setOptions(next);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = (
    <ConfirmModal
      isOpen={options !== null}
      title={options?.title ?? ""}
      message={options?.message ?? ""}
      confirmLabel={options?.confirmLabel ?? ""}
      cancelLabel={options?.cancelLabel ?? ""}
      tone={options?.tone ?? "primary"}
      backdropClassName={options?.backdropClassName}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return [confirm, dialog];
}
