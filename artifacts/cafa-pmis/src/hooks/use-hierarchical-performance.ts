import { useQuery } from "@tanstack/react-query";

export interface ProjectHierarchicalRow {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  /** Null means the source project is awaiting a resolved sector assignment. */
  sector: string | null;
  stateNames: string[];
  validIndicatorCount: number;
  missingIndicatorCount: number;
  /** Rounded to 1 dp. Null = no valid indicator data for this project. */
  projectAchievementRate: number | null;
}

export interface SectorHierarchicalRow {
  /** Null is the API's canonical unavailable state for unresolved sectors. */
  sector: string | null;
  projectCount: number;
  validProjectCount: number;
  insufficientProjectCount: number;
  /** Rounded to 1 dp. Null = no project in the sector has valid indicator data. */
  sectorAchievementRate: number | null;
  projects: ProjectHierarchicalRow[];
}

export interface HierarchicalPerformance {
  /** Rounded to 1 dp. Null = no sector has valid data. */
  averageSectorAchievementRate: number | null;
  validSectorCount: number;
  validProjectCount: number;
  sectors: SectorHierarchicalRow[];
}

export interface HierarchicalPerfParams {
  stateId?: number;
  sector?: string;
  donor?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Uses a caller-provided localized fallback and never exposes a raw API null. */
export function displayHierarchicalSectorLabel(
  sector: string | null | undefined,
  unavailableLabel: string,
): string {
  return typeof sector === "string" && sector.trim() ? sector : unavailableLabel;
}

export function useHierarchicalPerformance(params: HierarchicalPerfParams = {}) {
  const qs = new URLSearchParams();
  if (params.stateId)  qs.set("stateId",  String(params.stateId));
  if (params.sector)   qs.set("sector",   params.sector);
  if (params.donor)    qs.set("donor",    params.donor);
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo)   qs.set("dateTo",   params.dateTo);
  const qStr = qs.toString();

  return useQuery<HierarchicalPerformance>({
    queryKey: ["hierarchical-performance", params],
    queryFn: async () => {
      const res = await fetch(
        `/api/dashboard/hierarchical-performance${qStr ? `?${qStr}` : ""}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Hierarchical performance request failed: ${res.status}`);
      return res.json() as Promise<HierarchicalPerformance>;
    },
    staleTime: 30_000,
  });
}
