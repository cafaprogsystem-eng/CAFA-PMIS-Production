import * as React from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────
   StatCard
   A reusable KPI / metric card for dashboards and summary views.

   Design: Modern enterprise SaaS (Linear / Notion / Asana style).
   - p-6 (24px) padding on all sides
   - 13px semibold label at top-left; 32px icon container at top-right
   - 20-22-24px bold value with 12px gap below the label
   - 12px supporting text with 10px gap below the value, pinned to bottom
   - Soft border (border/60) + minimal box-shadow
   - Subtle lift + border on hover when interactive

   Usage:
     <StatCard
       icon={FolderKanban}
       iconBg="bg-blue-500"
       label="Active Projects"
       value={42}
       sub="Out of 68 total"
       href="/projects"
     />
─────────────────────────────────────────────────────────────────────── */
export interface StatCardProps {
  /** Lucide icon component */
  icon: React.ElementType;
  /** Tailwind bg class for the icon tile — e.g. "bg-blue-500" */
  iconBg?: string;
  /** Short label shown above the value */
  label: string;
  /** The big metric value */
  value: React.ReactNode;
  /** Supportive sub-text below the value */
  sub?: React.ReactNode;
  /** Optional icon rendered before sub-text */
  subIcon?: React.ElementType;
  /** Navigates on click when provided */
  href?: string;
  /** Called on click when href is not provided */
  onClick?: () => void;
  /** Exposes selected/toggled state for interactive summary cards. */
  pressed?: boolean;
  /** Renders the card in a "danger" accent style */
  alert?: boolean;
  /** Renders the card in a muted / secondary style */
  secondary?: boolean;
  className?: string;
}

function StatCard({
  icon: Icon,
  iconBg = "bg-primary",
  label,
  value,
  sub,
  subIcon: SubIcon,
  href,
  onClick,
  pressed,
  alert = false,
  secondary = false,
  className,
}: StatCardProps) {
  const isInteractive = !!(href || onClick);

  const inner = (
    <div
      className={cn(
        // Base layout
        "group relative flex flex-col bg-card rounded-xl border p-6",
        "min-h-[128px] h-full",
        // Minimal shadow — visible enough to lift without dominating
        "shadow-[0_1px_3px_0_rgb(0,0,0,0.04),0_1px_2px_0_rgb(0,0,0,0.02)]",
        "transition-all duration-150",
        // Border color variants
        alert
          ? "border-destructive/25"
          : secondary
          ? "border-border/40"
          : "border-border/60",
        // Interactive hover states
        isInteractive && "cursor-pointer",
        isInteractive &&
          !alert &&
          !secondary &&
          "hover:-translate-y-px hover:border-border hover:shadow-[0_4px_12px_0_rgb(0,0,0,0.07),0_2px_4px_-1px_rgb(0,0,0,0.04)]",
        isInteractive &&
          alert &&
          "hover:border-destructive/40 hover:shadow-[0_4px_12px_0_rgb(0,0,0,0.07),0_2px_4px_-1px_rgb(0,0,0,0.04)]",
        isInteractive &&
          secondary &&
          "hover:border-border/60 hover:shadow-[0_4px_12px_0_rgb(0,0,0,0.07),0_2px_4px_-1px_rgb(0,0,0,0.04)]",
        isInteractive && pressed && "ring-2 ring-ring ring-offset-1",
        className
      )}
    >
      {/* ── Row 1: Label (left) + Icon (right) ────────────────────── */}
      {/*   Icon stays in the top-right so it never competes with     */}
      {/*   the value text below it.                                  */}
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            // 13px medium label — muted so value stays dominant
            "text-sm font-medium leading-[1.25] tracking-[0.01em]",
            // Logical end padding gives breathing room before the icon column.
            "pe-2",
            alert ? "text-destructive/75" : "text-muted-foreground"
          )}
        >
          {label}
        </p>

        {/* 32px icon tile with 16px glyph */}
        <div
          className={cn(
            "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full",
            iconBg
          )}
        >
          <Icon
            className={cn(
              "h-4 w-4",
              alert ? "text-destructive" : "text-white"
            )}
          />
        </div>
      </div>

      {/* ── Row 2: Value ──────────────────────────────────────────── */}
      {/*   mt-3 = 12px gap between label and value (per spec).       */}
      {/*   whitespace-nowrap prevents currency strings from breaking */}
      {/*   mid-digit (e.g. "1,234,\n567").                          */}
      <p
        className={cn(
          "mt-4 font-semibold tabular-nums leading-[1.1] whitespace-nowrap",
          "text-[20px] sm:text-[21px] lg:text-[22px]",
          alert ? "text-destructive" : "text-foreground"
        )}
      >
        {value ?? "—"}
      </p>

      {/* ── Row 3: Supporting text ────────────────────────────────── */}
      {/*   mt-auto pins this row to the card bottom so all cards in  */}
      {/*   a grid row align their sub-text, regardless of value      */}
      {/*   length. pt-2.5 = 10px gap between value and sub (spec).   */}
      {sub !== undefined && (
        <p
          className={cn(
            "mt-auto pt-3.5",
            "flex min-w-0 items-center gap-1.5",
            "text-xs leading-[1.4]",
            alert ? "text-destructive/65" : "text-muted-foreground"
          )}
        >
          {SubIcon && <SubIcon className="h-3 w-3 shrink-0" />}
          {/* truncate keeps sub to a single line — no awkward wrapping */}
          <span className="truncate">{sub}</span>
          {isInteractive && (
            <ArrowRight className="h-3 w-3 ms-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-50 rtl:scale-x-[-1]" />
          )}
        </p>
      )}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block h-full cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={label}
      >
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        className="h-full w-full cursor-pointer rounded-xl text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={label}
        aria-pressed={pressed}
      >
        {inner}
      </div>
    );
  }

  // Static (non-interactive) — display only
  return <div className="rounded-xl h-full">{inner}</div>;
}

/* ─────────────────────────────────────────────────────────────────────
   StatPill
   Compact inline stat used inside summary strips.

   Usage:
     <StatPill label="Allocated" value="$1.2M" color="text-success" />
─────────────────────────────────────────────────────────────────────── */
export interface StatPillProps {
  label: string;
  value: React.ReactNode;
  color?: string;
}

function StatPill({ label, value, color = "text-foreground" }: StatPillProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border/60 bg-card px-5 py-3.5 min-w-[88px] gap-1">
      <span className={cn("text-[20px] font-semibold tabular-nums leading-none", color)}>{value}</span>
      <span className="text-xs text-muted-foreground font-medium text-center leading-tight mt-0.5">
        {label}
      </span>
    </div>
  );
}

export { StatCard, StatPill };
