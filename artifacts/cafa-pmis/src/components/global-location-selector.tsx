/**
 * GlobalLocationSelector — compact header control for HQ-level location scoping.
 *
 * Renders a bordered 36-px dropdown (pin icon + label + chevron).
 * Returns null for state-scoped roles (isEditable = false).
 * Includes type-ahead search when the state list exceeds 8 items.
 * RTL-safe via logical CSS. Keyboard accessible: arrow keys, Enter/Space,
 * Escape, focus returns to trigger on close.
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getStateLabel } from "@/components/state-label";
import { MapPin, ChevronDown, Check, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocationContext } from "@/contexts/location-context";
import { cn } from "@/lib/utils";

const SEARCH_THRESHOLD = 8;

export function GlobalLocationSelector() {
  const { t, i18n } = useTranslation("common");
  const { selectedStateId, setSelectedStateId, isEditable, authorisedStates } =
    useLocationContext();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = authorisedStates.length > SEARCH_THRESHOLD;

  // Clear search when menu closes
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Auto-focus search input when menu opens (if search is visible)
  useEffect(() => {
    if (!open || !showSearch) return;
    const id = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open, showSearch]);

  if (!isEditable) return null;

  const selectedState = authorisedStates.find(s => s.id === selectedStateId);
  const stateLabel = (state: { name: string; nameAr: string }) =>
    getStateLabel(state, i18n.resolvedLanguage ?? i18n.language);
  const label = selectedState
    ? stateLabel(selectedState)
    : t("locationContext.allLocations");

  const filteredStates = search.trim()
    ? authorisedStates.filter(s =>
        [s.name, s.nameAr].some(name => name.toLowerCase().includes(search.toLowerCase())),
      )
    : authorisedStates;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${t("locationContext.label")}: ${label}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-md",
            "border border-border/60 bg-card px-2.5 shadow-none",
            "text-xs font-medium text-foreground",
            "hover:bg-muted/50 hover:border-border",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            "transition-colors duration-150 max-w-[180px]",
          )}
        >
          <MapPin
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
            aria-hidden="true"
          />
          <span className="truncate max-w-[120px]">{label}</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-56 p-1"
        role="listbox"
        aria-label={t("locationContext.label")}
        onCloseAutoFocus={e => {
          e.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        {/* Type-ahead search — visible when list exceeds threshold */}
        {showSearch && (
          <div className="relative mb-1 px-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("locationContext.searchPlaceholder")}
              className={cn(
                "h-8 w-full rounded-md border border-border/60 bg-background",
                "ps-8 pe-7 text-xs",
                "focus:outline-none focus:ring-2 focus:ring-ring/40",
              )}
              aria-label={t("locationContext.searchPlaceholder")}
              aria-autocomplete="list"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label={t("clearSearch")}
                className="absolute end-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {/* All Locations — always first */}
        <DropdownMenuItem
          role="option"
          aria-selected={selectedStateId === null}
          className="flex items-center gap-2 text-xs"
          onSelect={() => { setSelectedStateId(null); setOpen(false); }}
        >
          <Check
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-primary",
              selectedStateId !== null && "opacity-0",
            )}
            aria-hidden="true"
          />
          {t("locationContext.allLocations")}
        </DropdownMenuItem>

        {authorisedStates.length > 0 && <DropdownMenuSeparator />}

        {/* State list (filtered when search active) */}
        {filteredStates.length === 0 && search.trim() ? (
          <p className="py-3 text-center text-xs text-muted-foreground" role="status">
            {t("locationContext.noLocations")}
          </p>
        ) : (
          filteredStates.map(state => (
            <DropdownMenuItem
              key={state.id}
              role="option"
              aria-selected={selectedStateId === state.id}
              className="flex items-center gap-2 text-xs"
              onSelect={() => { setSelectedStateId(state.id); setOpen(false); }}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-primary",
                  selectedStateId !== state.id && "opacity-0",
                )}
                aria-hidden="true"
              />
              {stateLabel(state)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
