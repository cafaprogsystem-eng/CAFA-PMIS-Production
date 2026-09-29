import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useGetPmrReportingCompleteness } from "@workspace/api-client-react";
import { Button, Card, Chip, Skeleton } from "@heroui/react";
import { SelectField } from "@/components/select-field";
import { formatDateTime } from "@/lib/format";
import { locationStatusBadge } from "@/lib/pmr-status";
import { ConsolidatedReportView } from "@/components/consolidated-report-view";

/**
 * PMR Reporting Completeness panel (Phase 1 — PMR-015 Option C).
 * Shows, for a chosen reporting period, which of the project's expected
 * operational locations have submitted their PMR and which are missing.
 */
interface PmrCompletenessPanelProps {
  projectId: number;
  /** The project's scheduled reporting frequency — sets the panel's initial kind.
   *  Null/undefined (historical projects) falls back to "monthly". */
  projectReportingFrequency?: "monthly" | "quarterly" | "annual" | null;
}

export function PmrCompletenessPanel({ projectId, projectReportingFrequency }: PmrCompletenessPanelProps) {
  const { t } = useTranslation(["reports", "common"]);
  const now = new Date();
  // Default to the previous month — the most recently completed reporting period.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [kind, setKind] = useState<"monthly" | "quarterly" | "annual" | "on_demand">(
    projectReportingFrequency ?? "monthly",
  );
  const [year, setYear] = useState(prev.getFullYear());
  const [month, setMonth] = useState(prev.getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.floor(prev.getMonth() / 3) + 1);
  const [showConsolidated, setShowConsolidated] = useState(false);

  // Scheduled-completeness rule (Task #321): on-demand PMRs cannot satisfy a
  // scheduled period, so the completeness query only runs for scheduled kinds.
  // On-demand consolidation is still available via the consolidated view.
  const isOnDemand = kind === "on_demand";
  const params: Record<string, number | string> = { projectId, kind, reportingYear: year };
  if (kind === "monthly") params.reportingMonth = month;
  if (kind === "quarterly") params.quarter = quarter;

  const { data, isLoading, isError } = useGetPmrReportingCompleteness(
    params as unknown as Parameters<typeof useGetPmrReportingCompleteness>[0],
    { query: { enabled: !isOnDemand } } as never,
  );

  const project = data?.projects?.[0];
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <Card>
      <Card.Header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Card.Title className="text-base font-medium">{t("completeness.title")}</Card.Title>
            <Card.Description>{t("completeness.description")}</Card.Description>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              aria-label={t("completeness.reportFrequency")}
              triggerClassName="w-32"
              value={kind}
              onChange={(v) => setKind(v as typeof kind)}
              options={[
                { value: "monthly", label: t("completeness.monthly") },
                { value: "quarterly", label: t("completeness.quarterly") },
                { value: "annual", label: t("completeness.annual") },
                { value: "on_demand", label: t("completeness.onDemand") },
              ]}
            />
            {kind === "monthly" && (
              <SelectField
                aria-label={t("completeness.reportingMonth")}
                triggerClassName="w-36"
                value={String(month)}
                onChange={(v) => setMonth(Number(v))}
                options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: t(`common:calendarWidget.months.${i}`) }))}
              />
            )}
            {kind === "quarterly" && (
              <SelectField
                aria-label={t("completeness.quarter")}
                triggerClassName="w-28"
                value={String(quarter)}
                onChange={(v) => setQuarter(Number(v))}
                options={[1, 2, 3, 4].map((qn) => ({ value: String(qn), label: t("formUi.quarterN", { number: qn }) }))}
              />
            )}
            <SelectField
              aria-label={t("completeness.reportingYear")}
              triggerClassName="w-28"
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
            />
            <Button
              variant="tertiary"
              size="sm"
              isDisabled={!isOnDemand && (!project || project.expectedLocations === 0)}
              aria-expanded={showConsolidated}
              onPress={() => setShowConsolidated((s) => !s)}
              data-testid="pmr-comp-view-consolidated"
            >
              {showConsolidated ? t("completeness.hideConsolidated") : t("completeness.viewConsolidated")}
            </Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content className="p-0">
        {isOnDemand && (
          <p className="p-4 text-sm text-[var(--muted)]" data-testid="pmr-comp-ondemand-note">
            {t("completeness.onDemandNote")}
          </p>
        )}
        {!isOnDemand && isLoading && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-64 rounded" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        )}
        {isError && (
          <p className="p-4 text-sm text-[var(--muted)]">{t("completeness.loadError")}</p>
        )}
        {!isOnDemand && !isLoading && !isError && (!project || project.expectedLocations === 0) && (
          <p className="p-4 text-sm text-[var(--muted)]" data-testid="pmr-comp-empty">
            {t("completeness.noExpectedLocations")}
          </p>
        )}
        {!isOnDemand && !isLoading && !isError && project && project.expectedLocations > 0 && (
          <>
            <div className="px-4 pb-3 text-sm" data-testid="pmr-comp-summary">
              <span className="font-medium">
                {t("completeness.summary", { submitted: project.reportsSubmitted, expected: project.expectedLocations })}
              </span>
              <span className="text-[var(--muted)]">
                {t("completeness.summaryDetail", { approved: project.reportsApproved, missing: project.missingLocations })}
                {project.completenessPercent !== null && (
                  <>{t("completeness.summaryPercent", { percent: project.completenessPercent })}</>
                )}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--default)]">
                  <tr>
                    {[t("completeness.reportingLocation"), t("completeness.status"), t("completeness.submittedCol"), t("completeness.viewCol")].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 text-start text-xs font-medium text-[var(--muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {project.locations.map((loc) => {
                    const badge = locationStatusBadge(loc.reportStatus ?? null);
                    return (
                      <tr key={`${loc.locationType}-${loc.stateId ?? "hq"}`}>
                        <td className="px-4 py-2.5 font-medium">{loc.locationName}</td>
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="soft" color={badge.color}>{t(badge.key, { defaultValue: badge.fallback })}</Chip>
                        </td>
                        <td className="px-4 py-2.5 text-sm">
                          {loc.submittedAt ? <bdi dir="ltr">{formatDateTime(loc.submittedAt)}</bdi> : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {loc.reportId !== null ? (
                            <Link
                              href={`/reports/project?open=${loc.reportId}`}
                              className="text-sm text-[var(--accent)] underline underline-offset-2"
                            >
                              {t("completeness.viewReport")}
                            </Link>
                          ) : (
                            <span className="text-sm text-[var(--muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {showConsolidated && (isOnDemand || (project && project.expectedLocations > 0)) && (
          <div className="border-t border-[var(--border)] p-4">
            <ConsolidatedReportView
              projectId={projectId}
              kind={kind}
              reportingYear={year}
              reportingMonth={kind === "monthly" ? month : undefined}
              quarter={kind === "quarterly" ? quarter : undefined}
              onClose={() => setShowConsolidated(false)}
            />
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
