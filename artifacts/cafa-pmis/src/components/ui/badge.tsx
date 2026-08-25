import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
  {
    variants: {
      variant: {
        /* ── Base shadcn variants (preserved for compat) ─────────── */
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary/15 text-secondary",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline:
          "text-foreground border-border",

        /* ── Semantic status variants ────────────────────────────── */
        draft:
          "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
        submitted:
          "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
        approved:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        active:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        returned:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
        rejected:
          "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
        completed:
          "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
        on_hold:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
        cancelled:
          "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
        inactive:
          "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500",
        pending:
          "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
        closed:
          "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
        open:
          "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
        warning:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
        info:
          "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
        success:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        invited:
          "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
        suspended:
          "border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400",
        /* ── Risk severity ───────────────────────────────────────── */
        critical:
          "border-red-300 bg-red-100 text-red-800 font-bold dark:border-red-700 dark:bg-red-950 dark:text-red-300",
        high:
          "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
        medium:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
        low:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        /* ── Performance tiers ───────────────────────────────────── */
        excellent:
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        good:
          "border-blue-200 bg-blue-50 text-blue-700",
        "needs-follow-up":
          "border-amber-200 bg-amber-50 text-amber-700",
        insufficient:
          "border-slate-200 bg-slate-50 text-slate-500 italic",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
