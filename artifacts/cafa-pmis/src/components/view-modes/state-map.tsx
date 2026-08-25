import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ViewRecord } from "@/lib/view-modes";
import { StateLabel, getStateLabel } from "@/components/state-label";

interface StateMapProps {
  items: ViewRecord[];
  states: Array<{ id: number; name: string; nameAr?: string | null; code?: string }>;
  empty?: React.ReactNode;
}

// Approximate geographic grid positions for canonical Sudan State codes [row, col].
// Grid is 6 rows × 4 cols
const GEO_POSITIONS: Record<string, [number, number]> = {
  NOR: [0, 2], RDS: [0, 3], NDF: [1, 0], NKR: [1, 1], RVN: [1, 2], KSL: [1, 3],
  WDF: [2, 0], WKR: [2, 1], KRT: [2, 2], GDR: [2, 3], CDF: [3, 0], SKR: [3, 1],
  GZR: [3, 2], EDF: [4, 0], SDF: [4, 1], SNR: [4, 2], BNL: [4, 3], WNL: [5, 1],
};

function heatColor(count: number, max: number): string {
  if (count === 0) return "bg-muted text-muted-foreground";
  const intensity = max > 0 ? count / max : 0;
  if (intensity <= 0.2) return "bg-blue-100 text-blue-800 border-blue-200";
  if (intensity <= 0.4) return "bg-blue-200 text-blue-900 border-blue-300";
  if (intensity <= 0.6) return "bg-primary/30 text-primary-foreground/90 border-primary/40";
  if (intensity <= 0.8) return "bg-primary/60 text-white border-primary/70";
  return "bg-primary text-primary-foreground border-primary";
}

export function StateMap({ items, states, empty }: StateMapProps) {
  const { t, i18n } = useTranslation("common");

  if (items.length === 0) {
    return <div className="py-16 text-center">{empty ?? <p className="text-sm text-muted-foreground">{t("viewModes.noRecordsFound")}</p>}</div>;
  }

  // Count items per state
  const countByState = new Map<string, number>();
  for (const state of states) countByState.set(state.name, 0);
  for (const item of items) {
    for (const name of item.stateNames ?? []) {
      countByState.set(name, (countByState.get(name) ?? 0) + 1);
    }
  }
  const maxCount = Math.max(...Array.from(countByState.values()), 1);

  // Build geographic grid
  const ROWS = 6;
  const COLS = 4;
  const grid: Array<Array<{ state: StateMapProps["states"][number]; count: number } | null>> = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  const positionedStates = new Set<string>();
  for (const state of states) {
    const pos = state.code ? GEO_POSITIONS[state.code] : undefined;
    if (pos) {
      const [r, c] = pos;
      if (r < ROWS && c < COLS) {
        grid[r][c] = { state, count: countByState.get(state.name) ?? 0 };
        positionedStates.add(state.name);
      }
    }
  }

  // Unpositioned states go below the grid
  const unpositioned = states.filter((s) => !positionedStates.has(s.name));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("viewModes.distributionDesc", { count: states.length })}
        </p>
      </div>

      {/* Geographic grid */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, auto)` }}>
        {grid.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              className={`min-h-[72px] rounded-lg border flex flex-col items-center justify-center p-2 text-center ${
                cell
                  ? heatColor(cell.count, maxCount)
                  : "bg-transparent border-transparent"
              }`}
              style={{ gridRow: r + 1, gridColumn: c + 1 }}
            >
              {cell && (
                <>
                  <p className="text-xs font-semibold leading-tight"><StateLabel state={cell.state} /></p>
                  <p className="text-xl font-bold mt-1">{cell.count}</p>
                  <p className="text-[9px] opacity-70">{t("viewModes.records")}</p>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Unpositioned states */}
      {unpositioned.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">{t("viewModes.otherStates")}</p>
          <div className="flex flex-wrap gap-2">
            {unpositioned.map((state) => {
              const count = countByState.get(state.name) ?? 0;
              return (
                <div
                  key={state.id}
                  className={`rounded-lg border px-3 py-2 text-center min-w-[80px] ${heatColor(count, maxCount)}`}
                >
                  <p className="text-xs font-semibold"><StateLabel state={state} /></p>
                  <p className="text-lg font-bold">{count}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        {Array.from(countByState.entries())
          .filter(([, count]) => count > 0)
          .sort(([, a], [, b]) => b - a)
          .map(([name, count]) => (
            <Badge key={name} variant="outline" className="gap-1">
              <span className="text-muted-foreground">
                {getStateLabel(states.find((state) => state.name === name) ?? { name }, i18n.resolvedLanguage ?? i18n.language)}
              </span>
              <span className="font-bold">{count}</span>
            </Badge>
          ))}
      </div>
    </div>
  );
}
