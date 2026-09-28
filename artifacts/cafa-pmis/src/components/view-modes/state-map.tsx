import { useTranslation } from "react-i18next";
import { Chip } from "@heroui/react";
import { MapPin } from "@/components/icons";
import type { ViewRecord } from "@/lib/view-modes";
import { StateLabel, getStateLabel } from "@/components/state-label";

interface StateMapProps {
  items: ViewRecord[];
  states: Array<{ id: number; name: string; nameAr?: string | null; code?: string }>;
  empty?: React.ReactNode;
}

// Approximate geographic grid positions for canonical Sudan State codes [row, col].
// Grid is 6 rows × 4 cols, west → east. It is laid out left-to-right in every
// language: it is a map, so east stays on the right.
const GEO_POSITIONS: Record<string, [number, number]> = {
  NOR: [0, 2], RDS: [0, 3], NDF: [1, 0], NKR: [1, 1], RVN: [1, 2], KSL: [1, 3],
  WDF: [2, 0], WKR: [2, 1], KRT: [2, 2], GDR: [2, 3], CDF: [3, 0], SKR: [3, 1],
  GZR: [3, 2], EDF: [4, 0], SDF: [4, 1], SNR: [4, 2], BNL: [4, 3], WNL: [5, 1],
};

/** Heat steps on the accent colour; 0 records stays neutral. */
function heatStyle(count: number, max: number): { className: string; style?: React.CSSProperties } {
  if (count === 0) return { className: "bg-[var(--default)] text-[var(--muted)]" };
  const intensity = max > 0 ? count / max : 0;
  const pct = Math.round(15 + intensity * 85);
  return {
    className: intensity > 0.55 ? "text-[var(--accent-foreground)]" : "text-[var(--foreground)]",
    style: { backgroundColor: `color-mix(in oklab, var(--accent) ${pct}%, var(--surface))` },
  };
}

type MapState = StateMapProps["states"][number];

function StateCell({ state, count, max, recordsLabel, className = "" }: {
  state: MapState; count: number; max: number; recordsLabel: string; className?: string;
}) {
  const heat = heatStyle(count, max);
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl p-2 text-center ${heat.className} ${className}`} style={heat.style}>
      <p className="text-xs font-semibold leading-tight" dir="auto"><StateLabel state={state} /></p>
      <p className="mt-1 text-xl font-bold tabular-nums">{count}</p>
      <p className="text-[10px] opacity-75">{recordsLabel}</p>
    </div>
  );
}

export function StateMap({ items, states, empty }: StateMapProps) {
  const { t, i18n } = useTranslation("common");

  if (items.length === 0) {
    return <div className="py-16 text-center">{empty ?? <p className="text-sm text-[var(--muted)]">{t("viewModes.noRecordsFound")}</p>}</div>;
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

  const ROWS = 6;
  const COLS = 4;
  const grid: Array<Array<{ state: MapState; count: number } | null>> = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const positionedStates = new Set<string>();
  for (const state of states) {
    const pos = state.code ? GEO_POSITIONS[state.code] : undefined;
    if (pos) {
      const [r, c] = pos;
      grid[r][c] = { state, count: countByState.get(state.name) ?? 0 };
      positionedStates.add(state.name);
    }
  }
  const unpositioned = states.filter((s) => !positionedStates.has(s.name));
  // Drop grid rows that hold no State so the map stays compact.
  const usedRows = grid.map((row, r) => ({ row, r })).filter(({ row }) => row.some(Boolean));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 text-[var(--muted)]" aria-hidden="true" />
        <p className="text-sm text-[var(--muted)]">{t("viewModes.distributionDesc", { count: states.length })}</p>
      </div>

      {usedRows.length > 0 && (
        <div dir="ltr" className="grid max-w-3xl gap-2" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {usedRows.map(({ row, r }) =>
            row.map((cell, c) => (
              <div key={`${r}-${c}`} dir={i18n?.dir?.() ?? undefined} className="min-h-[76px]">
                {cell && <StateCell state={cell.state} count={cell.count} max={maxCount} recordsLabel={t("viewModes.records")} className="h-full" />}
              </div>
            )),
          )}
        </div>
      )}

      {unpositioned.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-[var(--muted)]">{t("viewModes.otherStates")}</p>
          <div className="flex flex-wrap gap-2">
            {unpositioned.map((state) => (
              <StateCell key={state.id} state={state} count={countByState.get(state.name) ?? 0} max={maxCount} recordsLabel={t("viewModes.records")} className="min-w-[88px]" />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        {Array.from(countByState.entries())
          .filter(([, count]) => count > 0)
          .sort(([, a], [, b]) => b - a)
          .map(([name, count]) => (
            <Chip key={name} size="sm" variant="secondary">
              {getStateLabel(states.find((state) => state.name === name) ?? { name }, i18n.resolvedLanguage ?? i18n.language)}
              <span className="ms-1 font-bold tabular-nums">{count}</span>
            </Chip>
          ))}
      </div>
    </div>
  );
}
