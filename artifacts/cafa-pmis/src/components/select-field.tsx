import type { ReactNode } from "react";
import { Label, ListBox, Select } from "@heroui/react";

export type SelectOption = { value: string; label: ReactNode; textValue?: string };

type SelectFieldProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Visible label; omit it and pass aria-label for a label-less filter. */
  label?: ReactNode;
  "aria-label"?: string;
  placeholder?: string;
  isDisabled?: boolean;
  className?: string;
  /** Classes for the trigger button itself (sizing is usually set here). */
  triggerClassName?: string;
  /** Decorative icon shown before the value inside the trigger. */
  icon?: ReactNode;
  /** Field wiring for forms: id, required/invalid state and error text. */
  id?: string;
  isRequired?: boolean;
  isInvalid?: boolean;
  "aria-describedby"?: string;
};

/**
 * Single-value HeroUI Select for the common "value + flat option list" case,
 * so screens don't repeat the Trigger/Popover/ListBox composition. Values are
 * strings, like the Radix Select it replaces; "" means nothing selected and
 * shows the placeholder.
 */
export function SelectField({
  value, onChange, options, label, placeholder, isDisabled, className, triggerClassName, icon,
  id, isRequired, isInvalid, ...aria
}: SelectFieldProps) {
  return (
    <Select
      id={id}
      value={value === "" ? null : value}
      onChange={(key) => { if (key !== null) onChange(String(key)); }}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={isInvalid}
      validationBehavior="aria"
      placeholder={placeholder}
      aria-label={aria["aria-label"]}
      aria-describedby={aria["aria-describedby"]}
      className={className}
    >
      {label && <Label>{label}</Label>}
      <Select.Trigger className={triggerClassName}>
        {icon}
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.textValue ?? (typeof option.label === "string" ? option.label : option.value)}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
