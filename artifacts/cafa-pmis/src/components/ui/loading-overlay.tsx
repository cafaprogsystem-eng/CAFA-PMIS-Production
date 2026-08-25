import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────
   LoadingOverlay
   Covers its nearest positioned parent with a semi-transparent overlay
   and a centred spinner.

   Usage (full-screen):
     <LoadingOverlay />

   Usage (scoped to a card):
     <div className="relative">
       <SomeContent />
       {isLoading && <LoadingOverlay />}
     </div>
───────────────────────────────────────────────────────────────────── */
interface LoadingOverlayProps {
  /** The message shown under the spinner. Defaults to "Loading…" */
  message?: string;
  /** When true, covers the full viewport instead of the nearest parent. */
  fullScreen?: boolean;
  className?: string;
}

function LoadingOverlay({
  message = "Loading…",
  fullScreen = false,
  className,
}: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        "bg-background/80 backdrop-blur-sm z-50",
        fullScreen ? "fixed inset-0" : "absolute inset-0 rounded-[inherit]",
        className
      )}
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {message && (
        <p className="text-sm font-medium text-muted-foreground">{message}</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PageLoader
   Full-screen loader for route/Suspense boundaries.
───────────────────────────────────────────────────────────────────── */
function PageLoader({ message }: { message?: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        {message && (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}

export { LoadingOverlay, PageLoader };
