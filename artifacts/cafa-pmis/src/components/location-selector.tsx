/**
 * LocationSelector — the single shared component for choosing between HQ and Sudan States.
 *
 * Renders two groups:
 *   Organisation
 *     HQ — Headquarters
 *   States
 *     Blue Nile
 *     Gezira  …
 *
 * State-scoped users (SPO, SOM) see only their locked state (no HQ option).
 * Organisation-wide users see HQ + all authorised states.
 *
 * ARCHITECTURE NOTE: This is the only place HQ/State selector branching is allowed.
 * Use formatLocation() from lib/format.ts for display-only needs.
 */

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";

/** Sentinel value used in string-based form fields to represent "HQ". */
export const HQ_SENTINEL = "__HQ__";

export interface LocationValue {
  /** "hq" | "state" | null — null means nothing selected yet */
  locationType: "hq" | "state" | null;
  /** The Sudan State ID, or null for HQ / nothing selected */
  stateId: number | null;
}

interface State {
  id: number;
  name: string;
  nameAr?: string;
}

interface LocationSelectorProps {
  /** Current location value */
  value: LocationValue;
  /** Called when the user selects a new location */
  onChange: (value: LocationValue) => void;
  /** All authorised states to display */
  states?: State[];
  /** When true, only the locked state is shown — for single-state users */
  isStateLocked?: boolean;
  /** When isStateLocked=true, the locked state's ID */
  lockedStateId?: number | null;
  /** When isStateLocked=true, the locked state's name */
  lockedStateName?: string | null;
  /** Placeholder when nothing is selected */
  placeholder?: string;
  /** Marks the trigger border destructive for form validation */
  invalid?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-required"?: boolean;
  "aria-describedby"?: string;
}

function toSelectValue(loc: LocationValue): string {
  if (loc.locationType === "hq") return HQ_SENTINEL;
  if (loc.stateId != null) return String(loc.stateId);
  return "";
}

/**
 * Converts the raw select string value back to a typed LocationValue.
 */
export function parseLocationSelectValue(raw: string): LocationValue {
  if (raw === HQ_SENTINEL) return { locationType: "hq", stateId: null };
  if (raw && raw !== "") {
    const n = Number(raw);
    return { locationType: "state", stateId: Number.isFinite(n) ? n : null };
  }
  return { locationType: null, stateId: null };
}

export function LocationSelector({
  value,
  onChange,
  states,
  isStateLocked = false,
  lockedStateId,
  lockedStateName,
  placeholder = "Select location",
  invalid,
  className,
  disabled,
  id,
  "aria-required": ariaRequired,
  "aria-describedby": ariaDescribedby,
}: LocationSelectorProps) {
  const { t } = useTranslation("common");
  const selectValue = toSelectValue(value);
  const selectPlaceholder = placeholder ?? t("locationContext.selectLocation");
  const assignedState = t("locationContext.assignedState");
  const lockedState = states?.find((state) => state.id === lockedStateId);
  const lockedStateLabel = lockedState
    ? <StateLabel state={lockedState} />
    : lockedStateName ?? assignedState;

  function handleChange(raw: string) {
    onChange(parseLocationSelectValue(raw));
  }

  if (isStateLocked) {
    return (
      <Select value={lockedStateId ? String(lockedStateId) : ""} disabled>
        <SelectTrigger
          id={id}
          className={cn("bg-muted cursor-not-allowed", className)}
          aria-required={ariaRequired}
          aria-describedby={ariaDescribedby}
        >
          <SelectValue>{lockedStateLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {lockedStateId && (
            <SelectItem value={String(lockedStateId)}>
              {lockedStateLabel}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={selectValue} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        className={cn(invalid && "border-destructive", className)}
        aria-required={ariaRequired}
        aria-describedby={ariaDescribedby}
        aria-invalid={invalid || undefined}
      >
        <SelectValue placeholder={selectPlaceholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("locationContext.organisation")}</SelectLabel>
          <SelectItem value={HQ_SENTINEL}>{t("locationContext.headquarters")}</SelectItem>
        </SelectGroup>
        {states && states.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("locationContext.states")}</SelectLabel>
            {states.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                <StateLabel state={s} />
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
