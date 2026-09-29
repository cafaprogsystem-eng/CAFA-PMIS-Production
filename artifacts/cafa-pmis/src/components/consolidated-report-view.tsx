import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useGetConsolidatedProjectReport } from "@workspace/api-client-react";
import type {
  GetConsolidatedProjectReportParams,
  ConsolidatedReportLocation,
} from "@workspace/api-client-react";
import { ChevronRight, ArrowLeft } from "@/components/icons";
import { Button, Chip, Skeleton } from "@heroui/react";
import { projectActivityStatusText } from "@/lib/report-form-options";
import { formatDateTime } from "@/lib/format";
import { locationStatusBadge } from "@/lib/pmr-status";

interface ConsolidatedReportViewProps {
  projectId: number;
  kind: "monthly" | "quarterly" | "annual" | "on_demand";
  reportingYear: number;
  reportingMonth?: number;
  quarter?: number;
  onClose?: () => void;
}

type LocationEntry = ConsolidatedReportLocation;

function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("en-GB")}${currency ? ` ${currency}` : ""}`;
}

/** Minimal per-location activities rendering (JSONB passthrough). */
function ActivityList({ activities }: { activities: unknown }) {
  const { t } = useTranslation("reports");
  if (!Array.isArray(activities) || activities.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium mb-2">{t("consolidated.activitiesImplemented")}</h4>
      <div className="space-y-2">
        {(activities as Array<Record<string, unknown>>).map((a, i) => (
          <details key={i} className="group rounded-lg border border-[var(--border)] text-xs">
            <summary className="flex cursor-pointer list-none select-none items-center justify-between p-2">
              <div className="flex min-w-0 items-center gap-2">
                <ChevronRight className="size-3 flex-shrink-0 transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:rotate-90" aria-hidden />
                <p className="line-clamp-2 font-medium" dir="auto">{String(a.name ?? "—")}</p>
                {!!a.isUnplanned && (
                  <Chip size="sm" variant="soft" className="flex-shrink-0">{t("consolidated.unplanned")}</Chip>
                )}
              </div>
              <Chip size="sm" variant="tertiary" className="ms-2 flex-shrink-0">
                {a.status ? projectActivityStatusText(t, String(a.status)) : "—"} · <bdi dir="ltr">{String(a.percent ?? 0)}%</bdi>
              </Chip>
            </summary>
            <div className="space-y-1 border-t border-[var(--border)] px-3 pb-3 pt-1 text-[var(--muted)]">
              <p>
                {t("consolidated.output", { output: String(a.output ?? "—"), milestone: String(a.milestone ?? "—") })}
              </p>
              {(a.beneficiariesMen != null || a.beneficiariesWomen != null ||
                a.beneficiariesBoys != null || a.beneficiariesGirls != null) && (
                <p>
                  {t("consolidated.beneficiariesLine", {
                    men: Number(a.beneficiariesMen ?? 0).toLocaleString("en-GB"),
                    women: Number(a.beneficiariesWomen ?? 0).toLocaleString("en-GB"),
                    boys: Number(a.beneficiariesBoys ?? 0).toLocaleString("en-GB"),
                    girls: Number(a.beneficiariesGirls ?? 0).toLocaleString("en-GB"),
                  })}
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/** Per-location indicator progress (project-level targets are reference-only). */
function IndicatorList({ indicatorProgress }: { indicatorProgress: unknown }) {
  const { t } = useTranslation("reports");
  if (!Array.isArray(indicatorProgress) || indicatorProgress.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium mb-2">{t("consolidated.indicatorProgress")}</h4>
      <div className="overflow-x-auto">
        <table className="w-full rounded-lg border border-[var(--border)] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--default)] text-start">
              <th scope="col" className="p-2 font-medium">{t("consolidated.indicator")}</th>
              <th scope="col" className="p-2 font-medium">{t("consolidated.targetReference")}</th>
              <th scope="col" className="p-2 font-medium">{t("consolidated.achievedLocation")}</th>
            </tr>
          </thead>
          <tbody>
            {(indicatorProgress as Array<Record<string, unknown>>).map((ind, i) => (
              <tr key={i} className="border-b border-[var(--border)] last:border-0">
                <td className="p-2" dir="auto">{String(ind.name ?? ind.indicator ?? "—")}</td>
                <td className="p-2"><bdi dir="ltr">{ind.target != null ? Number(ind.target).toLocaleString("en-GB") : "—"}</bdi></td>
                <td className="p-2"><bdi dir="ltr">{ind.achieved != null ? Number(ind.achieved).toLocaleString("en-GB") : ind.value != null ? Number(ind.value).toLocaleString("en-GB") : "—"}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocationSection({ loc }: { loc: LocationEntry }) {
  const { t } = useTranslation("reports");
  const [open, setOpen] = useState(false);
  const contentId = `cons-loc-content-${loc.locationType}-${loc.stateId ?? "hq"}`;
  const badge = locationStatusBadge(loc.report?.status ?? null);
  if (!loc.report) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3">
        <h3 className="text-sm font-medium">{loc.locationName}</h3>
        <div className="flex items-center gap-3">
          <Chip size="sm" variant="soft" color={badge.color}>{t(badge.key, { defaultValue: badge.fallback })}</Chip>
          <span className="text-xs text-[var(--muted)]">
            {t("consolidated.noPmrSubmitted")}
          </span>
        </div>
      </div>
    );
  }
  const r = loc.report;
  return (
    <div className="rounded-xl border border-[var(--border)]" data-testid={`cons-loc-${loc.locationType}-${loc.stateId ?? "hq"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <button
          type="button"
          className="flex items-center gap-2 min-w-0 text-start"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight
            className={`size-4 flex-shrink-0 transition-transform ${open ? "rotate-90 rtl:rotate-90" : "rtl:scale-x-[-1]"}`}
            aria-hidden
          />
          <h3 className="text-sm font-medium truncate">{loc.locationName}</h3>
        </button>
        <span className="flex items-center gap-3">
          <Chip size="sm" variant="soft" color={badge.color}>{t(badge.key, { defaultValue: badge.fallback })}</Chip>
          {r.submittedAt && (
            <span className="text-xs text-[var(--muted)]"><bdi dir="ltr">{formatDateTime(r.submittedAt)}</bdi></span>
          )}
          <Link
            href={`/reports/project?open=${r.reportId}`}
            className="text-sm text-[var(--accent)] underline underline-offset-2"
          >
            {t("consolidated.viewArrow")}
          </Link>
        </span>
      </div>
      {open && (
      <div className="space-y-4 border-t border-[var(--border)] p-3" id={contentId}>
        {(r.executiveSummary || r.narrative || r.challenges || r.recommendations) && (
          <div className="space-y-3 text-sm">
            {r.executiveSummary && (
              <div>
                <h4 className="font-medium">{t("consolidated.executiveSummary")}</h4>
                <p className="text-[var(--muted)] whitespace-pre-wrap">{r.executiveSummary}</p>
              </div>
            )}
            {r.narrative && (
              <div>
                <h4 className="font-medium">{t("consolidated.keyAchievements")}</h4>
                <p className="text-[var(--muted)] whitespace-pre-wrap">{r.narrative}</p>
              </div>
            )}
            {r.challenges && (
              <div>
                <h4 className="font-medium">{t("consolidated.challenges")}</h4>
                <p className="text-[var(--muted)] whitespace-pre-wrap">{r.challenges}</p>
              </div>
            )}
            {r.recommendations && (
              <div>
                <h4 className="font-medium">{t("consolidated.recommendations")}</h4>
                <p className="text-[var(--muted)] whitespace-pre-wrap">{r.recommendations}</p>
              </div>
            )}
          </div>
        )}

        {/* Period Reach — per-location only, never summed across locations */}
        <div>
          <h4 className="text-sm font-medium mb-2">{t("consolidated.periodReach", { location: loc.locationName })}</h4>
          <div className="overflow-x-auto">
            <table className="text-xs w-full max-w-md rounded-lg border border-[var(--border)]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--default)] text-start">
                  <th scope="col" className="p-2 font-medium">{t("consolidated.men")}</th>
                  <th scope="col" className="p-2 font-medium">{t("consolidated.women")}</th>
                  <th scope="col" className="p-2 font-medium">{t("consolidated.boys")}</th>
                  <th scope="col" className="p-2 font-medium">{t("consolidated.girls")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2"><bdi dir="ltr">{r.beneficiariesMale != null ? r.beneficiariesMale.toLocaleString("en-GB") : "—"}</bdi></td>
                  <td className="p-2"><bdi dir="ltr">{r.beneficiariesFemale != null ? r.beneficiariesFemale.toLocaleString("en-GB") : "—"}</bdi></td>
                  <td className="p-2"><bdi dir="ltr">{r.beneficiariesBoys != null ? r.beneficiariesBoys.toLocaleString("en-GB") : "—"}</bdi></td>
                  <td className="p-2"><bdi dir="ltr">{r.beneficiariesGirls != null ? r.beneficiariesGirls.toLocaleString("en-GB") : "—"}</bdi></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <ActivityList activities={r.activities} />
        <IndicatorList indicatorProgress={r.indicatorProgress} />

        {(r.plannedBudget !== null || r.actualExpenditure !== null) && (
          <div>
            <h4 className="text-sm font-medium mb-1">
              {t("consolidated.reportedExpenditure")}{" "}
              <span className="font-normal text-[var(--muted)]">
                {t("consolidated.selfReportedNote")}
              </span>
            </h4>
            <p className="text-sm text-[var(--muted)]">
              {t("consolidated.plannedActual", {
                planned: formatMoney(r.plannedBudget ?? null, r.currency ?? null),
                actual: formatMoney(r.actualExpenditure ?? null, r.currency ?? null),
              })}
            </p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * Consolidated Project View (BD-5 Option B) — read-only grouping of all
 * Reporting Locations' PMRs for one project + frequency + period.
 * No merged identity, no cross-location totals, no bulk actions.
 */
export function ConsolidatedReportView({
  projectId,
  kind,
  reportingYear,
  reportingMonth,
  quarter,
  onClose,
}: ConsolidatedReportViewProps) {
  const { t } = useTranslation("reports");
  const params: GetConsolidatedProjectReportParams = { projectId, kind, reportingYear };
  if (kind === "monthly" && reportingMonth !== undefined) params.reportingMonth = reportingMonth;
  if (kind === "quarterly" && quarter !== undefined) params.quarter = quarter;

  const { data, isLoading, isError } = useGetConsolidatedProjectReport(params);

  if (isLoading) {
    return (
      <div className="space-y-2 p-4" data-testid="cons-view-loading">
        <Skeleton className="h-6 w-72 rounded" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="p-4 text-sm text-[var(--danger)]" data-testid="cons-view-error">
        {t("consolidated.loadError")}
      </p>
    );
  }

  const c = data.completeness;
  // Mixed currency: show each PMR's currency inline (formatMoney already does);
  // when uniform, the single shared currency is still shown per figure for clarity.

  return (
    <section className="space-y-4" aria-label={t("consolidated.ariaReport")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {onClose && (
            <Button variant="ghost" size="sm" onPress={onClose} aria-label={t("consolidated.backToOverview")}>
              {/* "Back" points to the reading start: left in English, right in Arabic */}
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              {t("consolidated.back")}
            </Button>
          )}
          <h2 className="text-base font-medium truncate">
            {data.project.title} · {t(`consolidated.kind.${data.period.kind}`, { defaultValue: data.period.kind })} · {data.period.label}
          </h2>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="cons-view-summary">
        <span>{t("consolidated.expected")}: <span className="font-medium">{c.expectedLocations}</span></span>
        <span>{t("consolidated.submitted")}: <span className="font-medium">{c.reportsSubmitted}</span></span>
        <span>{t("consolidated.approved")}: <span className="font-medium">{c.reportsApproved}</span></span>
        <span>{t("consolidated.missing")}: <span className="font-medium">{c.missingLocations}</span></span>
        {c.completenessPercent !== null && (
          <span className="text-[var(--muted)]">{t("consolidated.percentComplete", { percent: c.completenessPercent })}</span>
        )}
      </div>

      {c.expectedLocations === 0 ? (
        <p className="text-sm text-[var(--muted)]" data-testid="cons-view-empty">
          {t("consolidated.noExpectedLocations")}
        </p>
      ) : data.locations.length === 0 ? (
        <p className="text-sm text-[var(--danger)]">
          {t("consolidated.locationsUnresolved")}
        </p>
      ) : (
        <div className="space-y-2">
          {data.locations.map((loc) => (
            <LocationSection key={`${loc.locationType}-${loc.stateId ?? "hq"}`} loc={loc} />
          ))}
        </div>
      )}
    </section>
  );
}
