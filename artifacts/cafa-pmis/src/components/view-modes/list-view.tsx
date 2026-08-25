import { useTranslation } from "react-i18next";
import { Calendar, MapPin, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BidiIsolate } from "@/components/bidi-isolate";
import type { ViewRecord } from "@/lib/view-modes";

interface ListViewProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

function ListRow({ item }: { item: ViewRecord }) {
  const { i18n } = useTranslation();
  return (
    <div
      className={`relative flex items-center gap-4 px-4 py-3 border-b last:border-b-0 transition-colors ${item.onClick ? "cursor-pointer hover:bg-muted/40" : ""}`}
    >
      {item.onClick && (
        <button
          type="button"
          className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`View ${item.title}`}
          onClick={(event) => item.onClick?.(event.currentTarget)}
        />
      )}
      {/* Left: title + meta */}
      <div className="relative z-10 pointer-events-none flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          {item.code && <span className="font-mono text-xs text-muted-foreground"><BidiIsolate>{item.code}</BidiIsolate></span>}
          <span className="text-sm font-medium truncate">{item.title}</span>
          {item.tag && <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">{item.tag}</Badge>}
        </div>
        {item.subtitle && <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>}
        <div className="flex items-center gap-3 flex-wrap">
          {item.meta?.slice(0, 3).map(({ label, value }) => (
            <span key={label} className="text-xs text-muted-foreground">
              <span className="uppercase tracking-wider">{label}:</span>{" "}
              <span className="font-medium text-foreground/70">{value}</span>
            </span>
          ))}
          {item.stateNames && item.stateNames.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />{(i18n.language.startsWith("ar") && item.stateNamesAr?.length === item.stateNames.length
                ? item.stateNamesAr
                : item.stateNames).slice(0, 2).join(", ")}
            </span>
          )}
          {item.date && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" /><bdi dir="ltr">{item.date}</bdi>
            </span>
          )}
        </div>
      </div>

      {/* Right: badge + progress */}
      <div className="relative z-10 pointer-events-none flex items-center gap-3 shrink-0">
        {item.progress && item.progress.max > 0 && (
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/70 rounded-full"
                style={{ width: `${Math.min(100, (item.progress.value / item.progress.max) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-8">
              <bdi dir="ltr">{Math.round((item.progress.value / item.progress.max) * 100)}%</bdi>
            </span>
          </div>
        )}
        {item.statusBadge}
        {item.actions && <div className="pointer-events-auto">{item.actions}</div>}
        {item.onClick && <ChevronRight className="h-4 w-4 text-muted-foreground/50 rtl:rotate-180" />}
      </div>
    </div>
  );
}

export function ListView({ items, empty }: ListViewProps) {
  const { t } = useTranslation("common");
  if (items.length === 0) {
    return <div className="py-16 text-center">{empty ?? <p className="text-sm text-muted-foreground">{t("viewModes.noRecordsFound")}</p>}</div>;
  }
  return (
    <div className="divide-y divide-border/60">
      {items.map((item) => (
        <ListRow key={item.id} item={item} />
      ))}
    </div>
  );
}
