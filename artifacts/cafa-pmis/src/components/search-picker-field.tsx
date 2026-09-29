import type { ReactNode } from "react";
import { ComboBox, Description, Input, Label, ListBox } from "@heroui/react";

export type SearchPickerItem = {
  id: string;
  /** Primary line; also what the typed text is matched against unless textValue is set. */
  title: string;
  /** Secondary detail lines under the title (code, donor, state, dates…). */
  details?: ReactNode;
  textValue?: string;
};

type SearchPickerFieldProps = {
  label: ReactNode;
  items: readonly SearchPickerItem[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  placeholder?: string;
  /** Shown in the open list when nothing matches (or while loading / on error). */
  emptyState?: ReactNode;
  isRequired?: boolean;
  isInvalid?: boolean;
  isDisabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  className?: string;
};

/**
 * Searchable single-choice picker (HeroUI ComboBox) for long reference lists
 * whose rows need a second line of detail, such as projects and activities.
 * Typing filters by the item text; the list opens on focus.
 */
export function SearchPickerField({
  label, items, selectedKey, onSelect, placeholder, emptyState, isRequired, isInvalid, isDisabled, id, className,
  ...aria
}: SearchPickerFieldProps) {
  return (
    <ComboBox
      id={id}
      fullWidth
      allowsEmptyCollection
      selectedKey={selectedKey}
      onSelectionChange={(key) => onSelect(key == null ? null : String(key))}
      isRequired={isRequired}
      isInvalid={isInvalid}
      isDisabled={isDisabled}
      validationBehavior="aria"
      aria-describedby={aria["aria-describedby"]}
      className={className}
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        {/* Typed text keeps its own direction but lines up with the page, clear of the chevron. */}
        <Input placeholder={placeholder} dir="auto" className="text-page-start" />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="max-w-[min(520px,90vw)]">
        <ListBox renderEmptyState={() => <div className="px-3 py-4 text-center text-sm text-[var(--muted)]">{emptyState}</div>}>
          {items.map((item) => (
            <ListBox.Item key={item.id} id={item.id} textValue={item.textValue ?? item.title}>
              <div className="flex min-w-0 flex-col">
                <Label className="whitespace-normal" dir="auto">{item.title}</Label>
                {item.details && <Description className="whitespace-normal">{item.details}</Description>}
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
