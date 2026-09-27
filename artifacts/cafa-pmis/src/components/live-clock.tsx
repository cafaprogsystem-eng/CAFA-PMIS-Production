/**
 * LiveClock — compact live date & time display for the top header.
 *
 * Updates once per minute, aligned to the real minute boundary.
 * Uses the user's saved timezone (Africa/Khartoum default) with a
 * browser-timezone fallback. Never makes server requests for the time.
 */
import { useState, useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface LiveClockProps {
  /** IANA timezone string from the user's profile, e.g. "Africa/Khartoum". */
  timezone?: string | null;
}

function formatParts(date: Date, tz: string) {
  const opts = { timeZone: tz } as const;

  // British English date — "5 August 2026"
  const dateFull = new Intl.DateTimeFormat("en-GB", {
    ...opts,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);

  // Abbreviated — "5 Aug 2026"
  const dateShort = new Intl.DateTimeFormat("en-GB", {
    ...opts,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

  // "03:24 AM" — 12-hour with leading zero and uppercase meridiem
  const rawTime = new Intl.DateTimeFormat("en-US", {
    ...opts,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  const time = rawTime.replace(/\s?(am|pm)$/i, m => " " + m.trim().toUpperCase());

  // Machine-readable value for <time datetime="…">
  const iso = date.toISOString();

  return { dateFull, dateShort, time, iso };
}

export function LiveClock({ timezone }: LiveClockProps) {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());

    // Align the first tick to the top of the next minute so the display
    // changes at the exact moment the minute rolls over.
    const seed = new Date();
    const msToNextMinute =
      (60 - seed.getSeconds()) * 1000 - seed.getMilliseconds() + 100;

    timeoutRef.current = setTimeout(() => {
      tick();
      intervalRef.current = setInterval(tick, 60_000);
    }, msToNextMinute);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // tz is used only in render; no need to restart the timer on tz change

  const { dateFull, dateShort, time, iso } = formatParts(now, tz);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tooltipLines = [
    `${dateFull} · ${time}`,
    tz !== browserTz ? tz : null,
  ].filter(Boolean);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/*
          aria-label gives screen readers the full date + time + timezone.
          aria-live is intentionally omitted — minute updates should not be
          announced as live regions.
        */}
        <time
          dateTime={iso}
          aria-label={tooltipLines.join(" — ")}
          // Label + value pair from the HeroUI Pro navbar "Dashboard" example.
          className="flex items-center gap-1.5 select-none cursor-default whitespace-nowrap tabular-nums"
        >
          {/* Full month name — large desktop only; abbreviated on md–lg */}
          <span className="hidden lg:inline text-[var(--muted)] text-[11px] font-medium uppercase tracking-wider rtl:tracking-normal">{dateFull}</span>
          <span className="hidden md:inline lg:hidden text-[var(--muted)] text-[11px] font-medium uppercase tracking-wider rtl:tracking-normal">{dateShort}</span>
          {/* Time is always shown when the component is visible */}
          <span className="text-foreground text-sm font-semibold">{time}</span>
        </time>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs space-y-0.5">
        <p className="font-medium">{dateFull} · {time}</p>
        <p className="text-muted-foreground">{tz}</p>
      </TooltipContent>
    </Tooltip>
  );
}
