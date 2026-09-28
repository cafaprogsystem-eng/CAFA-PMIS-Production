import type { ElementType, ReactNode } from "react";
import { KPI } from "@heroui-pro/react/kpi";

/**
 * A Pro KPI that doubles as a filter toggle (a real button with aria-pressed)
 * when onToggle is given; a plain KPI otherwise. Shared by the registers
 * (Plans, Risks) so their summary strips look and behave the same.
 */
export function FilterKpi({
  icon: Icon, status, label, value, sub, pressed, onToggle,
}: {
  icon: ElementType;
  status?: "success" | "warning" | "danger";
  label: string;
  value: ReactNode;
  /** Short caption under the value. */
  sub?: ReactNode;
  pressed?: boolean;
  onToggle?: () => void;
}) {
  const kpi = (
    <KPI className={`h-full justify-start transition-shadow ${pressed ? "ring-2 ring-[var(--accent)]" : ""}`}>
      <KPI.Header>
        <KPI.Icon status={status}><Icon aria-hidden="true" /></KPI.Icon>
        <KPI.Title>{label}</KPI.Title>
      </KPI.Header>
      <KPI.Content>
        <dd className="kpi__value tabular-nums">{value}</dd>
        {sub ? <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p> : null}
      </KPI.Content>
    </KPI>
  );
  if (!onToggle) return kpi;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!!pressed}
      onClick={onToggle}
      className="h-full rounded-[calc(var(--radius)*2.5)] text-start outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
    >
      {kpi}
    </button>
  );
}
