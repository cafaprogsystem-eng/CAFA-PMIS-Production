import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Labelled action contract: inline content, no wrapping, token radius, and
  // stable focus/cursor states. Size variants below document the 36/40/44px
  // small/default/large heights used throughout the authenticated product.
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /* ── Primary action ──────────────────────────────────────── */
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98] active:shadow-none",
        /* ── Destructive / danger ────────────────────────────────── */
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]",
        /* ── Outlined border ─────────────────────────────────────── */
        outline:
          "border border-border bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
        /* ── Secondary slate ─────────────────────────────────────── */
        secondary:
          "bg-secondary/10 text-secondary border border-secondary/25 hover:bg-secondary/20 active:scale-[0.98]",
        /* ── Ghost ───────────────────────────────────────────────── */
        ghost:
          "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
        /* ── Link ────────────────────────────────────────────────── */
        link:
          "text-primary underline-offset-4 hover:underline",
        /* ── Success ─────────────────────────────────────────────── */
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success/90 active:scale-[0.98]",
        /* ── Warning ─────────────────────────────────────────────── */
        warning:
          "bg-warning text-warning-foreground shadow-sm hover:bg-warning/90 active:scale-[0.98]",
        /* ── Info ────────────────────────────────────────────────── */
        info:
          "bg-info text-info-foreground shadow-sm hover:bg-info/90 active:scale-[0.98]",
      },
      size: {
        default: "h-10 px-4",
        sm:      "h-9 px-3 text-xs",
        lg:      "h-11 px-6 text-sm",
        xl:      "h-12 px-8 text-base font-medium",
        icon:    "h-10 w-10",
        "icon-sm": "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner and disables the button while true */
  isLoading?: boolean
  /** Accessible label for the spinner (screen-readers) */
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      loadingText = "Loading…",
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        {...props}
      >
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
        )}
        {isLoading ? (
          <span className="sr-only">{loadingText}</span>
        ) : null}
        {/* Always render children so loading never changes the button's size.
            The inner inline-flex owns icon/label alignment for every caller. */}
        <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", isLoading && "opacity-70")}>
          {children}
        </span>
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
