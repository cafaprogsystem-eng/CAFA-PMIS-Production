import { useTranslation } from "react-i18next";
import { useSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

export function ConnectionStatus({ className }: { className?: string }) {
  const { t } = useTranslation("common");
  const { status } = useSocket();

  if (status === "connected") {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium text-emerald-600 select-none",
          className,
        )}
        title={t("connectionStatus.liveTitle")}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        {t("connectionStatus.live")}
      </div>
    );
  }

  if (status === "reconnecting") {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium text-amber-600 select-none",
          className,
        )}
        title={t("connectionStatus.reconnectingTitle")}
      >
        <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" />
        {t("connectionStatus.reconnecting")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium text-muted-foreground select-none",
        className,
      )}
      title={t("connectionStatus.disconnectedTitle")}
    >
      <span className="h-2 w-2 rounded-full bg-gray-300" />
      {t("connectionStatus.disconnected")}
    </div>
  );
}
