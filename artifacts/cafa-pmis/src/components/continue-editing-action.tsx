import * as React from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

type ContinueEditingActionProps = {
  /** The record name is included in the accessible name to disambiguate repeated actions. */
  recordTitle: string;
  /** Existing editor route or draft hydration callback. */
  onClick: React.MouseEventHandler<HTMLButtonElement>;
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
    "border-primary/20 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/15 hover:text-primary",
    className,
  ].filter(Boolean).join(" ");
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    onClick(event);
  };
  const contents = (
    <>
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </>
  );

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={actionClassName}
      onClick={handleClick}
      aria-label={accessibleName}
    >
      {contents}
    </Button>
  );
}