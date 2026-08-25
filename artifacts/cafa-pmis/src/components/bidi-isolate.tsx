/**
 * BidiIsolate — Lightweight bidi isolation utility.
 *
 * Wraps technical identifiers (project codes, plan codes, emails, URLs, IDs)
 * in a `<bdi>` element with an explicit `dir="ltr"` attribute so that they
 * render correctly in both LTR and RTL contexts.
 *
 * Use this for any value that must remain visually left-to-right even when
 * the surrounding UI is in Arabic/RTL mode, per the CAFA Bidi/LTR-Token Policy
 * (CAFA_ARABIC_GLOSSARY.md §Bidi / LTR-Token Policy).
 *
 * Examples of values that must be wrapped:
 *   - Project codes: CAFA-PROJ-2026-004
 *   - Plan codes:    CAFA-PLAN-KRT-013
 *   - Email addresses
 *   - URLs
 *   - Phone numbers
 *   - Database IDs
 *   - Currency codes
 *
 * Usage:
 *   <BidiIsolate>{project.code}</BidiIsolate>
 *   <BidiIsolate className="font-mono text-xs">{plan.code}</BidiIsolate>
 */

import type { ReactNode, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BidiIsolateProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Override direction. Defaults to "ltr" (the common case for codes/emails). */
  direction?: "ltr" | "rtl" | "auto";
  /** Use inline <span> instead of <bdi> when nesting inside text with mixed inline content. */
  as?: "bdi" | "span";
}

export function BidiIsolate({
  children,
  direction = "ltr",
  as: Tag = "bdi",
  className,
  ...props
}: BidiIsolateProps) {
  return (
    <Tag
      dir={direction}
      className={cn("inline", className)}
      {...props}
    >
      {children}
    </Tag>
  );
}
