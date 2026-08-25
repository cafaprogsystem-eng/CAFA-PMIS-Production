import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useGetPmrReportingCompleteness } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium">{t("completeness.title")}</CardTitle>
            <CardDescription>
              {t("completeness.description")}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="h-8 w-[120px]" aria-label={t("completeness.reportFrequency")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t("completeness.monthly")}</SelectItem>
                <SelectItem value="quarterly">{t("completeness.quarterly")}</SelectItem>
                <SelectItem value="annual">{t("completeness.annual")}</SelectItem>
                <SelectItem value="on_demand">{t("completeness.onDemand")}</SelectItem>
              </SelectContent>
            </Select>
            {kind === "monthly" && (
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="h-8 w-[130px]" aria-label={t("completeness.reportingMonth")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i).map((i) => (
                    <SelectItem key={i} value={String(i + 1)}>{t(`common:calendarWidget.months.${i}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {kind === "quarterly" && (
              <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))}>
                <SelectTrigger className="h-8 w-[90px]" aria-label={t("completeness.quarter")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((qn) => (
                    <SelectItem key={qn} value={String(qn)}>Q{qn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-8 w-[90px]" aria-label={t("completeness.reportingYear")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!isOnDemand && (!project || project.expectedLocations === 0)}
              aria-expanded={showConsolidated}
              onClick={() => setShowConsolidated((s) => !s)}
              data-testid="pmr-comp-view-consolidated"
            >
              {showConsolidated ? t("completeness.hideConsolidated") : t("completeness.viewConsolidated")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isOnDemand && (
          <p className="p-4 text-sm text-muted-foreground" data-testid="pmr-comp-ondemand-note">
            {t("completeness.onDemandNote")}
          </p>
        )}
        {!isOnDemand && isLoading && (
          <div className="p-4 space-y-2">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {isError && (
          <p className="p-4 text-sm text-muted-foreground">
            {t("completeness.loadError")}
          </p>
        )}
        {!isOnDemand && !isLoading && !isError && (!project || project.expectedLocations === 0) && (
          <p className="p-4 text-sm text-muted-foreground" data-testid="pmr-comp-empty">
            {t("completeness.noExpectedLocations")}
          </p>
        )}
        {!isOnDemand && !isLoading && !isError && project && project.expectedLocations > 0 && (
          <>
            <div className="px-4 pb-3 text-sm" data-testid="pmr-comp-summary">
              <span className="font-medium">
                {t("completeness.summary", { submitted: project.reportsSubmitted, expected: project.expectedLocations })}
              </span>
              <span className="text-muted-foreground">
                {t("completeness.summaryDetail", { approved: project.reportsApproved, missing: project.missingLocations })}
                {project.completenessPercent !== null && (
                  <>{t("completeness.summaryPercent", { percent: project.completenessPercent })}</>
                )}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("completeness.reportingLocation")}</TableHead>
                  <TableHead>{t("completeness.status")}</TableHead>
                  <TableHead>{t("completeness.submittedCol")}</TableHead>
                  <TableHead>{t("completeness.viewCol")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.locations.map((loc) => {
                  const badge = locationStatusBadge(loc.reportStatus ?? null);
                  return (
                    <TableRow key={`${loc.locationType}-${loc.stateId ?? "hq"}`}>
                      <TableCell className="font-medium">{loc.locationName}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {loc.submittedAt ? formatDateTime(loc.submittedAt) : "—"}
                      </TableCell>
                      <TableCell>
                        {loc.reportId !== null ? (
                          <Link
                            href={`/reports/project?open=${loc.reportId}`}
                            className="text-sm text-primary underline underline-offset-2"
                          >
                            {t("completeness.viewReport")}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
        {showConsolidated && (isOnDemand || (project && project.expectedLocations > 0)) && (
          <div className="border-t p-4">
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
      </CardContent>
    </Card>
  );
}
