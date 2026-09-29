import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Tooltip } from "@heroui/react";
import { Focusable } from "react-aria-components";

type Placement = "top" | "bottom" | "start" | "end";

/**
 * HeroUI tooltip on an existing element. `Focusable` passes the hover/focus
 * wiring straight to the child (which must forward its ref and be focusable),
 * so a real <button> or link stays one element and one tab stop — unlike
 * Tooltip.Trigger, which would wrap it in a second role="button".
 */
export function HintTooltip({
  content,
  children,
  placement = "top",
  className = "max-w-60",
  delay = 300,
}: {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  className?: string;
  delay?: number;
}) {
  return (
    <Tooltip delay={delay} closeDelay={0}>
      <Focusable>{children as ComponentProps<typeof Focusable>["children"]}</Focusable>
      <Tooltip.Content placement={placement} className={`text-xs leading-snug ${className}`}>
        {content}
      </Tooltip.Content>
    </Tooltip>
  );
}
