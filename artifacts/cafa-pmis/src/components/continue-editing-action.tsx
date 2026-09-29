import * as React from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "@/components/icons";
import { Button } from "@heroui/react";

type ContinueEditingActionProps = {
  /** The record name is included in the accessible name to disambiguate repeated actions. */
  recordTitle: string;
  /** Existing editor route or draft hydration callback. */
  onClick: () => void;
  className?: string;
};

/**
 * The one recognisable entry point for resuming an authorised draft.
 *
 * Record surfaces own the eligibility check. This control only handles the
 * consistent localised presentation and prevents a nested action from opening
 * its surrounding record viewer.
 */
export function ContinueEditingAction({
  recordTitle,
  onClick,
  className,
}: ContinueEditingActionProps) {
  const { t } = useTranslation("common");
  const label = t("continueEditing");
  const accessibleName = t("continueEditingAriaLabel", { title: recordTitle });
  const actionClassName = [
    "h-8 max-w-full shrink-0 gap-1.5 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm",
    className,
  ].filter(Boolean).join(" ");

  // The span keeps the click inside: record rows and cards open their viewer
  // on click, and resuming a draft must not also open the viewer.
  return (
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <Button
        size="sm"
        variant="secondary"
        className={actionClassName}
        onPress={onClick}
        aria-label={accessibleName}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        {label}
      </Button>
    </span>
  );
}
