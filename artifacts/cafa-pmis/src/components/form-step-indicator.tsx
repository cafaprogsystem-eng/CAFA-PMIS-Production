import { Stepper } from "@heroui-pro/react/stepper";
import { AlertCircle } from "@/components/icons";

/**
 * Stepper.Indicator for multi-step forms. A step with validation errors shows
 * a danger "!" instead of the Pro Stepper's default number / checkmark, so a
 * step the user has already passed never looks "done" while it still needs
 * fixing. The error wording itself stays in Stepper.Description.
 */
export function FormStepIndicator({ hasError }: { hasError?: boolean }) {
  if (!hasError) return <Stepper.Indicator />;
  return (
    <Stepper.Indicator
      data-invalid="true"
      className="!border-[var(--danger)] !bg-[var(--danger)] !text-[var(--danger-foreground)]"
    >
      <Stepper.Icon>
        <AlertCircle className="size-4" aria-hidden="true" />
      </Stepper.Icon>
    </Stepper.Indicator>
  );
}
