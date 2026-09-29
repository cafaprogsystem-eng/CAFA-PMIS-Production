/**
 * GlobalLocationSelector — compact header control for HQ-level location scoping.
 *
 * Renders a bordered 36-px trigger (pin icon + label + chevron) that opens
 * a HeroUI popover with a single-selection ListBox.
 * Returns null for state-scoped roles (isEditable = false).
 * Includes type-ahead search when the state list exceeds 8 items.
 * RTL-safe via logical CSS. Keyboard accessible (React Aria): arrow keys,
 * Enter/Space, Escape, focus returns to the trigger on close.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Input, ListBox, Popover, type Key, type Selection } from "@heroui/react";
import { Button as AriaButton } from "react-aria-components";
import { getStateLabel } from "@/components/state-label";
import { MapPin, ChevronDown, Search } from "@/components/icons";
import { useLocationContext } from "@/contexts/location-context";

const SEARCH_THRESHOLD = 8;
const ALL = "all";

export function GlobalLocationSelector() {
  const { t, i18n } = useTranslation("common");
  const { selectedStateId, setSelectedStateId, isEditable, authorisedStates } =
    useLocationContext();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const showSearch = authorisedStates.length > SEARCH_THRESHOLD;

  // Clear search when the list closes
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

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

  const choose = (keys: Selection) => {
    if (keys === "all") return;
    const [key] = [...keys] as Key[];
    if (key === undefined) return;
    setSelectedStateId(key === ALL ? null : Number(key));
    setOpen(false);
  };

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      {/* HeroUI Pro InlineSelect trigger styling, as in the Pro navbar
          "Dashboard" example. Focus returns here when the list closes. */}
      <AriaButton
        aria-label={`${t("locationContext.label")}: ${label}`}
        className="inline-select inline-select__trigger flex gap-2 focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
      >
        <MapPin className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <span className="inline-select__value text-sm font-medium text-[var(--foreground)]">{label}</span>
        <ChevronDown className="inline-select__indicator" aria-hidden="true" />
      </AriaButton>

      <Popover.Content placement="bottom start" className="w-60 p-0">
        <Popover.Dialog className="p-1" aria-label={t("locationContext.label")}>
          {/* Type-ahead search — shown when the list exceeds the threshold */}
          {showSearch && (
            <div className="relative mb-1 p-1">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
              <Input
                type="search"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t("locationContext.searchPlaceholder")}
                aria-label={t("locationContext.searchPlaceholder")}
                className="h-8 w-full ps-8 text-xs"
              />
            </div>
          )}

          {filteredStates.length === 0 && search.trim() ? (
            <p className="py-3 text-center text-xs text-[var(--muted)]" role="status">
              {t("locationContext.noLocations")}
            </p>
          ) : (
            <ListBox
              aria-label={t("locationContext.label")}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[selectedStateId === null ? ALL : String(selectedStateId)]}
              onSelectionChange={choose}
              className="max-h-[min(22rem,calc(100dvh-8rem))] overflow-y-auto"
            >
              {/* All Locations — always first */}
              {!search.trim() && (
                <ListBox.Item id={ALL} textValue={t("locationContext.allLocations")} className="text-xs">
                  {t("locationContext.allLocations")}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              )}
              {filteredStates.map(state => (
                <ListBox.Item key={state.id} id={String(state.id)} textValue={stateLabel(state)} className="text-xs">
                  {stateLabel(state)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
