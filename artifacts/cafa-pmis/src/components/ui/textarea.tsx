import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground shadow-sm transition-all duration-150",
        "placeholder:text-muted-foreground/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:border-primary/50",
        "hover:border-border/80",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/30",
        "resize-y",
        "md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
