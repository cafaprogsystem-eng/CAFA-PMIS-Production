import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ServerCrash,
  WifiOff,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ─────────────────────────────────────────────────────────────────────
 * ErrorState
 * Reusable error placeholder for failed loads, access denied, etc.
 *
 * Usage:
 *   <ErrorState
 *     variant="server"
 *     title={t("someTitleKey")}
 *     description={t("someDescriptionKey")}
 *     onRetry={refetch}
 *   />
 * ───────────────────────────────────────────────────────────────────── */

type ErrorVariant =
  | "generic"      // generic problem
  | "server"       // 5xx / unexpected error
  | "network"      // connectivity / offline
  | "permission"   // 403 / not authorised
  | "not-found"    // 404
  | "warning";     // soft warning (not a hard failure)

const VARIANT_CONFIG: Record<
  ErrorVariant,
  { icon: React.ElementType; iconClass: string; titleDefault: string; descDefault: string }
> = {
  generic: {
    icon: AlertCircle,
    iconClass: "text-destructive",
    titleDefault: "Something went wrong",
    descDefault: "An unexpected error occurred. Please try again.",
  },
  server: {
    icon: ServerCrash,
    iconClass: "text-destructive",
    titleDefault: "Server error",
    descDefault: "We couldn't complete your request. Our team has been notified.",
  },
  network: {
    icon: WifiOff,
    iconClass: "text-warning",
    titleDefault: "No connection",
    descDefault: "Check your internet connection and try again.",
  },
  permission: {
    icon: ShieldAlert,
    iconClass: "text-warning",
    titleDefault: "Access denied",
    descDefault: "You don't have permission to view this content.",
  },
  "not-found": {
    icon: AlertCircle,
    iconClass: "text-muted-foreground",
    titleDefault: "Not found",
    descDefault: "The resource you're looking for doesn't exist or has been removed.",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-warning",
    titleDefault: "Something needs attention",
    descDefault: "Review the details and take action if needed.",
  },
};

interface ErrorStateProps {
  variant?: ErrorVariant;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: React.ReactNode;
  className?: string;
  /** Compact mode — less padding, smaller type */
  compact?: boolean;
}

function ErrorState({
  variant = "generic",
  title,
  description,
  onRetry,
  retryLabel = "Try again",
  action,
  className,
  compact = false,
}: ErrorStateProps) {
  const { icon: Icon, iconClass, titleDefault, descDefault } = VARIANT_CONFIG[variant];

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-6 px-4" : "gap-4 py-12 px-6",
        className
      )}
    >
      {/* Icon container */}
      <div
        className={cn(
          "flex items-center justify-center rounded-xl bg-muted/60",
          compact ? "h-10 w-10" : "h-14 w-14"
        )}
      >
        <Icon className={cn(compact ? "h-5 w-5" : "h-7 w-7", iconClass)} />
      </div>

      {/* Copy */}
      <div className={cn("max-w-sm", compact ? "space-y-0.5" : "space-y-1.5")}>
        <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>
          {title ?? titleDefault}
        </p>
        <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm leading-relaxed")}>
          {description ?? descDefault}
        </p>
      </div>

      {/* Actions */}
      {(onRetry || action) && (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {onRetry && (
            <Button
              variant="outline"
              size={compact ? "sm" : "default"}
              onClick={onRetry}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   InlineError
   One-liner error message for inside forms or small areas.
───────────────────────────────────────────────────────────────────── */
function InlineError({ message, className }: { message: string; className?: string }) {
  return (
    <p
      role="alert"
      className={cn("flex items-center gap-1.5 text-sm text-destructive", className)}
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

export { ErrorState, InlineError };
export type { ErrorVariant };
