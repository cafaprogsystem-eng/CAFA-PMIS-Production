import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { getStateLabel } from "@/components/state-label";
import type { ViewRecord } from "@/lib/view-modes";

/** Accessible name for the control that opens a record. */
export function useOpenRecordLabel() {
  const { t } = useTranslation("common");
  return (item: ViewRecord) => item.ariaLabel ?? t("viewModes.openRecord", { title: item.title });
}

/** The record's States in the active language, e.g. "كسلا، النيل الأبيض +1". */
export function useStateNames() {
  const { t, i18n } = useTranslation("common");
  return (item: ViewRecord, max = 2) => {
    const names = item.stateNames ?? [];
    if (names.length === 0) return "";
    const lang = i18n?.resolvedLanguage ?? i18n?.language;
    const shown = names.slice(0, max).map((name, i) => getStateLabel({ name, nameAr: item.stateNamesAr?.[i] }, lang));
    const separator = t("viewModes.listSeparator", { defaultValue: ", " });
    return shown.join(separator) + (names.length > max ? ` +${names.length - max}` : "");
  };
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Holds a record's own actions (Continue Editing, the actions menu) inside a
 * surface that opens the record. Pointer, click and key events stay here, so
 * using an action never also opens the record.
 */
export function RecordActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      onPointerDown={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onClick={stop}
      onKeyDown={stop}
    >
      {children}
    </div>
  );
}

/** Status → column tone, shared by every kanban board. */
const STATUS_TONE: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  draft: "default", closed: "default", archived: "default", not_started: "default",
  submitted: "accent", state_reviewed: "accent", technically_approved: "accent",
  coordination_approved: "accent", awaiting_approval: "accent", in_progress: "accent",
  open: "accent", identified: "accent", under_review: "accent", planned: "accent", assigned: "accent", mitigation_plan: "accent",
  approved: "success", active: "success", completed: "success", mitigated: "success", resolved: "success",
  on_hold: "warning", returned: "warning", delayed: "warning", under_mitigation: "warning", monitoring: "warning", follow_up: "warning",
  rejected: "danger", cancelled: "danger", escalated: "danger", escalation: "danger",
};

export function statusTone(status: string) {
  return STATUS_TONE[status] ?? "default";
}

/** Opens the record for a React Aria collection row, passing the row as the trigger. */
export function openRow(container: HTMLElement | null, items: ViewRecord[], key: React.Key) {
  const item = items.find((i) => String(i.id) === String(key));
  if (!item?.onClick) return;
  const row = container?.querySelector<HTMLElement>(`[data-key="${CSS.escape(String(key))}"]`) ?? null;
  item.onClick(row);
}
