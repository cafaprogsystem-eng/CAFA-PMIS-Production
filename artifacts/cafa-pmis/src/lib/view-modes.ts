import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type ViewMode = "table" | "card" | "list" | "compact" | "kanban" | "calendar" | "map";

export const RECORD_REGISTRY_VIEWS = ["table", "card", "compact"] as const;
export type RecordRegistryView = typeof RECORD_REGISTRY_VIEWS[number];

export function parseViewMode(value: string | null | undefined, available: readonly ViewMode[]): ViewMode | null {
  return value && available.includes(value as ViewMode) ? value as ViewMode : null;
}

export function withUrlViewMode(search: string, param: string, mode: ViewMode): string {
  const params = new URLSearchParams(search);
  params.set(param, mode);
  return params.toString();
}

/**
 * URL-backed view state for registries embedded in another page.
 * Each registry owns its query parameter, so changing a presentation does not
 * touch filters, pagination, expansion, or the Dashboard's tab parameter.
 */
export function useUrlViewMode(
  param: string,
  available: readonly ViewMode[],
  defaultMode: ViewMode = available[0] ?? "table",
): [ViewMode, (mode: ViewMode) => void] {
  const read = useCallback(() => {
    if (typeof window === "undefined") return defaultMode;
    return parseViewMode(new URLSearchParams(window.location.search).get(param), available) ?? defaultMode;
  }, [available, defaultMode, param]);
  const [mode, setModeState] = useState<ViewMode>(read);

  useEffect(() => {
    const onPopState = () => setModeState(read());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [read]);

  const setMode = useCallback((next: ViewMode) => {
    if (!available.includes(next) || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(param) === next) {
      setModeState(next);
      return;
    }
    url.search = withUrlViewMode(url.search, param, next);
    window.history.pushState({}, "", url.toString());
    setModeState(next);
  }, [available, param]);

  return [mode, setMode];
}

export interface ViewRecord {
  id: number | string;
  title: string;
  code?: string;
  subtitle?: string;
  status?: string;
  statusBadge?: ReactNode;
  tag?: string;
  date?: string | null;
  date2?: string | null;
  meta?: Array<{ label: string; value: string }>;
  progress?: { value: number; max: number; label?: string };
  stateNames?: string[];
  /** Arabic counterparts to stateNames, supplied by the same linked State registry. */
  stateNamesAr?: string[];
  /**
   * Opens the underlying record. View renderers pass their own focusable
   * surface so the shared detail coordinator can restore focus on close.
   */
  onClick?: (trigger?: HTMLElement | null) => void;
  /** Optional localised accessible name for the record activation surface. */
  ariaLabel?: string;
  actions?: ReactNode;
}

export function useViewMode(
  module: string,
  available: ViewMode[],
  defaultMode?: ViewMode,
): [ViewMode, (m: ViewMode) => void] {
  const key = `cafa.viewMode.${module}`;
  const [mode, setModeState] = useState<ViewMode>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (stored && available.includes(stored as ViewMode)) return stored as ViewMode;
    return defaultMode ?? available[0] ?? "table";
  });

  const setMode = (m: ViewMode) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, m);
    setModeState(m);
  };

  return [mode, setMode];
}
