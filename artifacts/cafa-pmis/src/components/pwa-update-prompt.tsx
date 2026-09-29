import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import { RefreshCw, X } from "@/components/icons";

export function PwaUpdatePrompt() {
  const { t } = useTranslation("common");
  const [needRefresh, setNeedRefresh] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleUpdate = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) {
        setWaitingWorker(reg.waiting);
        setNeedRefresh(true);
        return;
      }
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(installing);
            setNeedRefresh(true);
          }
        });
      });
    };

    navigator.serviceWorker.ready.then(handleUpdate);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!dismissed) window.location.reload();
    });
  }, [dismissed]);

  const handleUpdate = () => {
    if (waitingWorker) waitingWorker.postMessage({ type: "SKIP_WAITING" });
    setDismissed(true);
  };

  if (!needRefresh || dismissed) return null;

  return (
    <div role="status" className="fixed bottom-16 start-1/2 z-[99] flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#1a2744] px-4 py-3 text-white shadow-2xl rtl:translate-x-1/2">
      <RefreshCw className="size-4 shrink-0 text-blue-300" aria-hidden="true" />
      <p className="flex-1 text-sm">{t("pwaUpdate.available")}</p>
      <Button size="sm" variant="secondary" className="bg-white text-[#1a2744]" onPress={handleUpdate}>
        {t("pwaUpdate.updateNow")}
      </Button>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="text-white/70 hover:text-white"
        aria-label={t("pwaUpdate.dismiss")}
        onPress={() => setDismissed(true)}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
