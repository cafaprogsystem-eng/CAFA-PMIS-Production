import { useState, useEffect } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PwaUpdatePrompt() {
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
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[99] flex items-center gap-3 rounded-xl bg-[#1a2744] px-4 py-3 text-white shadow-2xl max-w-sm w-[calc(100vw-2rem)]">
      <RefreshCw className="h-4 w-4 shrink-0 text-blue-300" />
      <p className="text-sm flex-1">A new version is available.</p>
      <Button size="sm" variant="secondary"
        className="h-7 text-xs px-3 bg-white text-[#1a2744] hover:bg-white/90"
        onClick={handleUpdate}>
        Update now
      </Button>
      <button onClick={() => setDismissed(true)}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
