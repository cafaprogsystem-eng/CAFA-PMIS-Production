import type { ReactNode } from "react";
import { toast as sonner } from "sonner";

/**
 * Compatibility adapter: the old Radix `useToast()` call shape, rendered by
 * the app's single Sonner toaster so every toast looks and stacks the same.
 */
type ToastInput = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
};

function toast({ title, description, variant }: ToastInput) {
  const show = variant === "destructive" ? sonner.error : sonner;
  const id = show(title ?? description ?? "", title ? { description } : undefined);
  return { id: String(id), dismiss: () => sonner.dismiss(id) };
}

function useToast() {
  return { toast, dismiss: (id?: string) => sonner.dismiss(id) };
}

export { useToast, toast };
