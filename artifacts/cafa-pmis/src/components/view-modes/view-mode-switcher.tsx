import { useTranslation } from "react-i18next";
import { LayoutGrid, List, Table2, Rows3, Kanban, Calendar, Map } from "@/components/icons";
import { Tooltip } from "@heroui/react";
import { Segment } from "@heroui-pro/react/segment";
import type { ViewMode } from "@/lib/view-modes";

interface ViewModeSwitcherProps {
  available: ViewMode[];
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/**
 * Icon-only HeroUI Pro Segment, built like the icon segment in the Pro
 * navbar "Docs Site" example (size sm, 28px square items, 14px icons).
 * Each item keeps its name as aria-label and a tooltip.
 */
export function ViewModeSwitcher({ available, current, onChange }: ViewModeSwitcherProps) {
  const { t } = useTranslation("common");

  // §7: Tooltip labels — short, scannable names per spec
  const MODE_CONFIG: Record<ViewMode, { icon: typeof Table2; labelKey: string }> = {
    table:    { icon: Table2,      labelKey: "viewModes.table" },
    card:     { icon: LayoutGrid,  labelKey: "viewModes.card" },
    list:     { icon: List,        labelKey: "viewModes.list" },
    compact:  { icon: Rows3,       labelKey: "viewModes.compact" },
    kanban:   { icon: Kanban,      labelKey: "viewModes.kanban" },
    calendar: { icon: Calendar,    labelKey: "viewModes.calendar" },
    map:      { icon: Map,         labelKey: "viewModes.map" },
  };

  return (
    <Segment
      aria-label={t("viewModes.viewMode")}
      size="sm"
      className="gap-0"
      selectedKey={current}
      onSelectionChange={(key) => onChange(key as ViewMode)}
    >
      {available.map((mode) => {
        const { icon: Icon, labelKey } = MODE_CONFIG[mode];
        const label = t(labelKey);
        return (
          <Tooltip key={mode} delay={400}>
            <Segment.Item id={mode} aria-label={label} className="size-[28px] px-0">
              <Icon className="size-3.5" aria-hidden />
            </Segment.Item>
            <Tooltip.Content placement="bottom">{label}</Tooltip.Content>
          </Tooltip>
        );
      })}
    </Segment>
  );
}
