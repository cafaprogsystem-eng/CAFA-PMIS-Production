import { describe, expect, it } from "vitest";
import {
  computeHierarchicalPerformance,
  normalizePerformanceLabel,
  type PgPool,
} from "../performanceEngine";

type ProjectRow = { id: number; code: string; title: string; sector?: unknown };
type IndicatorRow = { project_id: number; target: number | null; achieved: number | null };

function makePool(projectRows: ProjectRow[], indicatorRows: IndicatorRow[] = []): PgPool {
  return {
    query: async (sql: string) => {
      if (sql.includes("FROM projects p")) return { rows: projectRows };
      if (sql.includes("FROM project_states")) return { rows: [] };
      if (sql.includes("FROM indicators")) return { rows: indicatorRows };
      throw new Error(`Unexpected performance query: ${sql}`);
    },
  } as unknown as PgPool;
}

describe("hierarchical performance labels", () => {
  it("preserves a valid performance label", async () => {
    const result = await computeHierarchicalPerformance(
      makePool([{ id: 1, code: "P-1", title: "Health project", sector: "Health" }]),
      "",
      [],
    );

    expect(result.sectors[0]?.sector).toBe("Health");
    expect(result.sectors[0]?.projects[0]?.sector).toBe("Health");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", "   "],
    ["unresolved", "unresolved"],
    ["unknown", "Unknown"],
  ])("represents a %s label as the canonical unavailable state", (_name, label) => {
    expect(normalizePerformanceLabel(label)).toBeNull();
  });

  it("keeps unresolved and valid sectors in a valid hierarchy without inventing a label", async () => {
    const result = await computeHierarchicalPerformance(
      makePool([
        { id: 1, code: "P-1", title: "Known project", sector: "Health" },
        { id: 2, code: "P-2", title: "Unresolved project", sector: null },
        { id: 3, code: "P-3", title: "Placeholder project", sector: "unknown" },
      ], [
        { project_id: 1, target: 10, achieved: 8 },
        { project_id: 3, target: 10, achieved: 9 },
      ]),
      "",
      [],
    );

    expect(result).toMatchObject({
      averageSectorAchievementRate: 85,
      validSectorCount: 2,
      validProjectCount: 2,
    });
    expect(result.sectors.map((sector) => sector.sector)).toEqual(["Health", null]);
    expect(result.sectors[0]?.sectorAchievementRate).toBe(80);
    expect(result.sectors[1]?.sectorAchievementRate).toBe(90);
    expect(result.sectors.flatMap((sector) => sector.projects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: 2, sector: null }),
        expect.objectContaining({ projectId: 3, sector: null }),
      ]),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("hierarchical.");
    expect(serialized).not.toContain("undefined");
  });
});