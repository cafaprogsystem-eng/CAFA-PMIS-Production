import * as React from "react";
import { useLocation } from "wouter";
import { RecordDetailModal } from "@/components/record-detail-modal";
import ProjectDetailPage from "@/pages/project-detail";
import PlanDetailPage from "@/pages/plan-detail";

export type RecordDetailKind = "project" | "plan";
type RecordDetailHeader = { title: string; description?: string };

type RecordDetailRequest = {
  kind: RecordDetailKind;
  id: number;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
};

type RecordDetailContextValue = {
  openRecord: (kind: RecordDetailKind, id: number, trigger?: HTMLElement | null) => void;
  openRecordPath: (path: string, trigger?: HTMLElement | null) => boolean;
  closeRecord: () => void;
};

const RecordDetailContext = React.createContext<RecordDetailContextValue | null>(null);

function parseRecordHref(href: string): Pick<RecordDetailRequest, "kind" | "id"> | null {
  const match = href.match(/^\/(projects|plans)\/([1-9]\d*)$/);
  if (!match) return null;
  return { kind: match[1] === "projects" ? "project" : "plan", id: Number(match[2]) };
}

export function useRecordDetail() {
  const context = React.useContext(RecordDetailContext);
  // Page-level unit tests and isolated previews may render a workspace without
  // AppLayout. The live application always provides the coordinator.
  return context ?? {
    openRecord: () => undefined,
    openRecordPath: () => false,
    closeRecord: () => undefined,
  };
}

/**
 * Coordinates modal record viewing without changing the workspace route. Direct
 * /projects/:id and /plans/:id routes remain canonical refresh-safe fallbacks.
 */
export function RecordDetailProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [request, setRequest] = React.useState<RecordDetailRequest | null>(null);
  const [header, setHeader] = React.useState<RecordDetailHeader | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const closeRecord = React.useCallback(() => {
    setRequest(null);
    setHeader(null);
  }, []);

  const openRecord = React.useCallback((kind: RecordDetailKind, id: number, trigger?: HTMLElement | null) => {
    if (!Number.isSafeInteger(id) || id <= 0) return;
    triggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setHeader(null);
    setRequest({ kind, id, restoreFocusRef: triggerRef });
  }, []);

  const openRecordPath = React.useCallback((path: string, trigger?: HTMLElement | null) => {
    const parsed = parseRecordHref(path);
    if (!parsed) return false;
    openRecord(parsed.kind, parsed.id, trigger);
    return true;
  }, [openRecord]);

  React.useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || request
      ) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      // Keep record viewers single-layered: links inside any established dialog
      // retain their own route/action behaviour instead of opening another modal.
      if (!anchor || anchor.closest("[data-record-detail-modal], [role='dialog']")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.getAttribute("href") ?? "", window.location.href);
      if (url.origin !== window.location.origin || url.search || url.hash) return;
      const path = url.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ""), "") || url.pathname;
      if (!parseRecordHref(path)) return;
      event.preventDefault();
      openRecordPath(path, anchor);
    };
    // Wouter prevents default in an anchor's bubble handler. Capture is required
    // to hand eligible read-only links to the viewer before route navigation.
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [openRecordPath, request]);

  const continueEdit = React.useCallback(() => {
    if (!request) return;
    const route = request.kind === "project"
      ? `/projects/${request.id}?edit=1`
      : `/plans/${request.id}?edit=1`;
    setRequest(null);
    setLocation(route);
  }, [request, setLocation]);

  const value = React.useMemo(() => ({ openRecord, openRecordPath, closeRecord }), [openRecord, openRecordPath, closeRecord]);
  const fallbackTitle = request?.kind === "project" ? "Project details" : "Plan details";

  return (
    <RecordDetailContext.Provider value={value}>
      {children}
      <RecordDetailModal
        open={!!request}
        onClose={closeRecord}
        title={header?.title ?? fallbackTitle}
        description={header?.description ?? "Authorised record information and actions"}
        restoreFocusRef={request?.restoreFocusRef}
        bodyClassName="pb-8"
      >
        <div data-record-detail-modal>
          {request?.kind === "project" ? (
            <ProjectDetailPage
              params={{ projectId: String(request.id) }}
              embedded
              onContinueEdit={continueEdit}
              onRecordLoaded={setHeader}
            />
          ) : request?.kind === "plan" ? (
            <PlanDetailPage
              planId={String(request.id)}
              embedded
              onContinueEdit={continueEdit}
              onRecordLoaded={setHeader}
            />
          ) : null}
        </div>
      </RecordDetailModal>
    </RecordDetailContext.Provider>
  );
}