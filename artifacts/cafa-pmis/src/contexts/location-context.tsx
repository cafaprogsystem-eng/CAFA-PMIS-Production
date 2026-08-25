/**
 * LocationContext — global location scope selector for HQ-level roles.
 *
 * HQ-eligible roles (super_admin, executive_director, program_manager,
 * senior_program_coordinator, technical_coordinator) can scope data to a
 * specific Sudan state or to the full "All Locations (HQ)" aggregate.
 *
 * State-scoped roles (state_office_manager, state_program_officer, viewer)
 * never see the selector — isEditable is always false for them.
 *
 * Effective data scope = User RBAC scope ∩ Selected Location ∩ Module filters.
 */
import {
  createContext, useContext, useEffect, useState, useMemo, useCallback,
  type ReactNode,
} from "react";
import { useGetMe, useListStates } from "@workspace/api-client-react";

/** HQ-eligible roles that see and use the location selector. */
const HQ_ELIGIBLE_ROLES = new Set([
  "super_admin",
  "executive_director",
  "program_manager",
  "senior_program_coordinator",
  "technical_coordinator",
]);

const LOCATION_PARAM = "location";
const STORAGE_KEY    = "cafa:locationCtx";

function readUrlParam(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get(LOCATION_PARAM);
    if (v && /^\d+$/.test(v)) { const n = Number(v); if (n > 0) return n; }
  } catch { /* ignore */ }
  return null;
}

function readSession(): number | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v && /^\d+$/.test(v)) { const n = Number(v); if (n > 0) return n; }
  } catch { /* ignore */ }
  return null;
}

function writeUrl(stateId: number | null): void {
  try {
    const url = new URL(window.location.href);
    if (stateId != null) url.searchParams.set(LOCATION_PARAM, String(stateId));
    else url.searchParams.delete(LOCATION_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch { /* ignore */ }
}

function writeSession(stateId: number | null): void {
  try {
    if (stateId != null) sessionStorage.setItem(STORAGE_KEY, String(stateId));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export interface LocationOption {
  id: number;
  name: string;
  nameAr: string;
}

interface LocationContextValue {
  /** Active state filter, or null = All Locations (HQ aggregate). */
  selectedStateId: number | null;
  /** Update the active location. Persists to URL and sessionStorage. */
  setSelectedStateId: (id: number | null) => void;
  /** False for state-scoped roles — the selector is hidden for them. */
  isEditable: boolean;
  /** Alpha-sorted states the current user may select. Empty for state-scoped roles. */
  authorisedStates: LocationOption[];
}

const LocationContext = createContext<LocationContextValue>({
  selectedStateId: null,
  setSelectedStateId: () => {},
  isEditable: false,
  authorisedStates: [],
});

export function LocationProvider({ children }: { children: ReactNode }) {
  const { data: me } = useGetMe();
  const { data: rawStates } = useListStates();

  const role = me?.user?.role ?? "";
  const isEditable = HQ_ELIGIBLE_ROLES.has(role);

  // Initialise from URL param (deep-links) → sessionStorage → null
  const [selectedStateId, setIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    return readUrlParam() ?? readSession() ?? null;
  });

  // Back/Forward navigation: re-read URL param on history traversal
  useEffect(() => {
    const onPop = () => setIdState(readUrlParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // When role changes to a state-scoped role, clear any stored selection
  useEffect(() => {
    if (role && !isEditable) {
      setIdState(null);
      writeSession(null);
    }
  }, [role, isEditable]);

  const setSelectedStateId = useCallback((id: number | null) => {
    setIdState(id);
    writeUrl(id);
    writeSession(id);
  }, []);

  // Alpha-sorted list of states the current user may select
  const authorisedStates = useMemo<LocationOption[]>(() => {
    if (!isEditable || !rawStates) return [];
    return rawStates
      .filter(s => s.operationalStatus === "active")
      .map(s => ({ id: s.id, name: s.name, nameAr: s.nameAr }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [isEditable, rawStates]);

  // If the stored selection is not in the authorised list (e.g. after role switch), reset
  useEffect(() => {
    if (!isEditable || selectedStateId == null || authorisedStates.length === 0) return;
    if (!authorisedStates.some(s => s.id === selectedStateId)) {
      setSelectedStateId(null);
    }
  }, [selectedStateId, authorisedStates, isEditable, setSelectedStateId]);

  return (
    <LocationContext.Provider
      value={{ selectedStateId, setSelectedStateId, isEditable, authorisedStates }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocationContext(): LocationContextValue {
  return useContext(LocationContext);
}
