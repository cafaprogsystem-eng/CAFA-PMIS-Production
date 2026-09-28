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

import { Header, ListBox, Select } from "@heroui/react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { StateLabel, getStateLabel } from "@/components/state-label";

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
  const { t, i18n } = useTranslation("common");
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
      <Select
        id={id}
        isDisabled
        value={lockedStateId ? String(lockedStateId) : null}
        aria-describedby={ariaDescribedby}
        aria-label={typeof lockedStateName === "string" ? lockedStateName : assignedState}
        className={cn("w-full", className)}
      >
        <Select.Trigger>
          <Select.Value>{() => lockedStateLabel}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {lockedStateId ? (
              <ListBox.Item id={String(lockedStateId)} textValue={lockedState?.name ?? assignedState}>
                {lockedStateLabel}
              </ListBox.Item>
            ) : null}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  return (
    <Select
      id={id}
      value={selectValue === "" ? null : selectValue}
      onChange={(key) => { if (key != null) handleChange(String(key)); }}
      isDisabled={disabled}
      isRequired={ariaRequired}
      isInvalid={invalid}
      validationBehavior="aria"
      placeholder={selectPlaceholder}
      aria-describedby={ariaDescribedby}
      className={cn("w-full", className)}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Section>
            <Header>{t("locationContext.organisation")}</Header>
            <ListBox.Item id={HQ_SENTINEL} textValue={t("locationContext.headquarters")}>
              {t("locationContext.headquarters")}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox.Section>
          {states && states.length > 0 ? (
            <ListBox.Section>
              <Header>{t("locationContext.states")}</Header>
              {states.map((s) => (
                <ListBox.Item key={s.id} id={String(s.id)} textValue={getStateLabel(s, i18n?.language)}>
                  <StateLabel state={s} />
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox.Section>
          ) : null}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
