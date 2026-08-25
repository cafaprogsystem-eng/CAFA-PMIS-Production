import { useTranslation } from "react-i18next";
import { LayoutGrid, List, Table2, Rows3, Kanban, Calendar, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ViewMode } from "@/lib/view-modes";

interface ViewModeSwitcherProps {
  available: ViewMode[];
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
}

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
    <div className="inline-flex h-10 items-center gap-0.5 p-1 rounded-lg bg-muted border border-border/60" role="group" aria-label={t("viewModes.viewMode")}>
      {available.map((mode) => {
        const { icon: Icon, labelKey } = MODE_CONFIG[mode];
        const label = t(labelKey);
        const active = current === mode;
        return (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-all duration-150 ${
                  active
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                }`}
                onClick={() => onChange(mode)}
                aria-label={label}
                aria-pressed={active}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
