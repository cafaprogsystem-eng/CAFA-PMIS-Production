import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { BidiIsolate } from "@/components/bidi-isolate";
import type { ViewRecord } from "@/lib/view-modes";

interface CompactViewProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

function CompactRow({ item }: { item: ViewRecord }) {
  return (
    <div
      className={`relative flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 transition-colors text-sm ${item.onClick ? "cursor-pointer hover:bg-muted/40" : ""}`}
    >
      {item.onClick && (
        <button
          type="button"
          className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`View ${item.title}`}
          onClick={(event) => item.onClick?.(event.currentTarget)}
        />
      )}
      {item.code && (
        <span className="relative z-10 pointer-events-none font-mono text-xs text-muted-foreground w-28 shrink-0 truncate"><BidiIsolate>{item.code}</BidiIsolate></span>
      )}
      <span className="relative z-10 pointer-events-none flex-1 truncate font-medium">{item.title}</span>
      {item.tag && (
        <Badge variant="outline" className="relative z-10 pointer-events-none text-xs px-1.5 py-0 h-4 shrink-0 hidden sm:inline-flex">{item.tag}</Badge>
      )}
      {item.meta?.slice(0, 1).map(({ value }) => (
        <span key={value} className="relative z-10 pointer-events-none text-xs text-muted-foreground shrink-0 hidden md:inline">{value}</span>
      ))}
      {item.date && (
        <span className="relative z-10 pointer-events-none text-xs text-muted-foreground shrink-0 hidden sm:inline">{item.date}</span>
      )}
      {item.statusBadge && <span className="relative z-10 pointer-events-none shrink-0">{item.statusBadge}</span>}
      {item.actions && <span className="relative z-10 pointer-events-auto shrink-0">{item.actions}</span>}
    </div>
  );
}

export function CompactView({ items, empty }: CompactViewProps) {
  const { t } = useTranslation("common");
  if (items.length === 0) {
    return <div className="py-12 text-center">{empty ?? <p className="text-sm text-muted-foreground">{t("viewModes.noRecordsFound")}</p>}</div>;
  }
  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <span className="w-28 shrink-0">{t("viewModes.code")}</span>
        <span className="flex-1">{t("viewModes.title")}</span>
        <span className="hidden sm:inline w-24 text-end">{t("viewModes.status")}</span>
      </div>
      {items.map((item) => (
        <CompactRow key={item.id} item={item} />
      ))}
    </div>
  );
}
