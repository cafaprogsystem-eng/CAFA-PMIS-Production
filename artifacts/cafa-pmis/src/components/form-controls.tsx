import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import {
  Calendar, Checkbox, DateField, DatePicker, Input, Label, ListBox, Select, Tag, TagGroup, TextArea,
} from "@heroui/react";
import { useFormField } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/*
 * HeroUI controls for react-hook-form fields rendered through the shared
 * Form / FormField / FormItem / FormMessage wrappers. Each control picks up
 * the surrounding FormItem's id, description and error so labels, messages
 * and the invalid state stay wired exactly as with the old shadcn controls.
 */

function useFieldA11y() {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return {
    id: formItemId,
    describedBy: error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId,
    isInvalid: !!error,
  };
}

/** HeroUI Input bound to the enclosing FormItem (use with FormLabel). */
export const FormInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(
  function FormInput(props, ref) {
    const a = useFieldA11y();
    return <Input ref={ref} id={a.id} aria-describedby={a.describedBy} aria-invalid={a.isInvalid} fullWidth {...props} />;
  },
);

/** HeroUI TextArea bound to the enclosing FormItem (use with FormLabel). */
export const FormTextArea = forwardRef<HTMLTextAreaElement, ComponentProps<typeof TextArea>>(
  function FormTextArea(props, ref) {
    const a = useFieldA11y();
    return <TextArea ref={ref} id={a.id} aria-describedby={a.describedBy} aria-invalid={a.isInvalid} fullWidth {...props} />;
  },
);

export type FormSelectOption = { value: string; label: ReactNode; textValue?: string };

/**
 * HeroUI Select for a FormItem. It renders its own Label (so the trigger is
 * labelled the React Aria way) — don't add a FormLabel next to it. An empty
 * string means "nothing selected" and shows the placeholder.
 */
export function FormSelect({
  label, value, onChange, options, placeholder, isDisabled, isRequired, className, triggerClassName, "data-testid": testId,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly FormSelectOption[];
  placeholder?: string;
  isDisabled?: boolean;
  isRequired?: boolean;
  className?: string;
  triggerClassName?: string;
  "data-testid"?: string;
}) {
  const a = useFieldA11y();
  return (
    <Select
      id={a.id}
      aria-describedby={a.describedBy}
      isInvalid={a.isInvalid}
      isRequired={isRequired}
      validationBehavior="aria"
      isDisabled={isDisabled}
      placeholder={placeholder}
      value={value === "" ? null : value}
      onChange={(key) => onChange(key == null ? "" : String(key))}
      className={cn("w-full", className)}
    >
      <Label>{label}</Label>
      <Select.Trigger className={triggerClassName} data-testid={testId}>
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

function toCalendarDate(value?: string | null): CalendarDate | null {
  if (!value) return null;
  try { return parseDate(value.slice(0, 10)); } catch { return null; }
}

type DateFieldProps = {
  label: ReactNode;
  value?: string | null;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  className?: string;
};

/**
 * HeroUI DatePicker reading and writing "YYYY-MM-DD" strings, with its own
 * Label. Use FormDate inside react-hook-form fields, DateInput elsewhere.
 */
export function DateInput({
  label, value, onChange, min, max, isRequired, isDisabled, className,
  id, isInvalid, describedBy,
}: DateFieldProps & { id?: string; isInvalid?: boolean; describedBy?: string }) {
  return (
    <DatePicker
      id={id}
      aria-describedby={describedBy}
      isInvalid={isInvalid}
      isRequired={isRequired}
      validationBehavior="aria"
      isDisabled={isDisabled}
      value={toCalendarDate(value)}
      minValue={toCalendarDate(min) ?? undefined}
      maxValue={toCalendarDate(max) ?? undefined}
      onChange={(d) => onChange(d ? d.toString() : "")}
      className={cn("w-full", className)}
    >
      <Label>{label}</Label>
      <DateField.Group fullWidth>
        <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
        <DateField.Suffix>
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover className="w-[22rem] max-w-[calc(100vw-2rem)]">
        <Calendar className="w-full">
          <Calendar.Header>
            <Calendar.YearPickerTrigger>
              <Calendar.YearPickerTriggerHeading />
              <Calendar.YearPickerTriggerIndicator />
            </Calendar.YearPickerTrigger>
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
            <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
          </Calendar.Grid>
          <Calendar.YearPickerGrid>
            <Calendar.YearPickerGridBody>
              {({ year }) => <Calendar.YearPickerCell year={year} />}
            </Calendar.YearPickerGridBody>
          </Calendar.YearPickerGrid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  );
}

/** HeroUI DatePicker for a react-hook-form FormItem ("YYYY-MM-DD" strings). */
export function FormDate(props: DateFieldProps) {
  const a = useFieldA11y();
  return <DateInput {...props} id={a.id} isInvalid={a.isInvalid} describedBy={a.describedBy} />;
}

/** One labelled HeroUI checkbox (the label text is the clickable content). */
export function CheckItem({
  isSelected, onChange, children, className,
}: {
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Checkbox isSelected={isSelected} onChange={onChange} className={className}>
      <Checkbox.Content className="text-sm">
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {children}
      </Checkbox.Content>
    </Checkbox>
  );
}

/** Selected values shown as removable HeroUI tags. */
export function RemovableTags({
  items, onRemove, "aria-label": ariaLabel, renderLabel, className,
}: {
  items: readonly string[];
  onRemove: (item: string) => void;
  "aria-label": string;
  renderLabel?: (item: string) => ReactNode;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <TagGroup aria-label={ariaLabel} size="sm" onRemove={(keys) => keys.forEach((k) => onRemove(String(k)))} className={className}>
      <TagGroup.List className="flex-wrap">
        {items.map((item) => (
          <Tag key={item} id={item} textValue={item}>
            {renderLabel ? renderLabel(item) : item}
          </Tag>
        ))}
      </TagGroup.List>
    </TagGroup>
  );
}
