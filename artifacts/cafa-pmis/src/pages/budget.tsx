import { useState, useEffect, useMemo } from "react";
import { useLocationContext } from "@/contexts/location-context";
import { useTranslation } from "react-i18next";
import { StateLabel, getStateLabel } from "@/components/state-label";
import i18n from "@/i18n";
import writeExcelFile from "write-excel-file/browser";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  getGetDonorPortfolioQueryKey,
  getGetProjectBudgetPerformanceQueryKey,
  useListProjects,
  useGetProjectBudget,
  useListProjectStateAllocations,
  useGetMe,
  useGetSectorBudget,
  useListStates,
  customFetch,
  type SectorBudgetEntry,
  type DonorPortfolioEntry,
  type ProjectBudgetPerformanceEntry,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Button, Card, Chip, Drawer, ProgressBar, Separator, Skeleton, Tabs,
} from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { LineChart as ProLineChart } from "@heroui-pro/react/line-chart";
import { ChartTooltip } from "@heroui-pro/react/chart-tooltip";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { SelectField } from "@/components/select-field";
import { DateRangeInput } from "@/components/form-controls";
import { FilterKpi } from "@/components/filter-kpi";
import { statusTone } from "@/components/view-modes/shared";
import {
  AlertTriangle, DollarSign, TrendingUp, PiggyBank, Lock,
  AlertCircle, Download, Filter, X, Info,
  Activity, FolderOpen, ChevronRight, FileText, FileSpreadsheet,
} from "@/components/icons";
import { MAIN_SECTORS, getSectorMeta } from "@/lib/sectors";
import type { SectorBudgetCurrencyEntry } from "@workspace/api-client-react";
import { formatCurrency, formatMonthLabel, formatPercent, hasPerm } from "@/lib/format";
import {
  formatBudgetLineLevel,
  formatProjectBudgetMoney,
  projectBurnRate,
  resolveProjectCurrency,
} from "@/lib/budget-presentation";
import {
  buildProjectBudgetWorkbook,
  buildSectorBudgetWorkbook,
  type BudgetWorkbookSheet,
} from "@/lib/budget-workbook";
import { DonorPortfolioTable, ProjectBudgetPerformanceTable } from "./dashboard";

// ── PDF export ────────────────────────────────────────────────────────────────

interface BudgetPdfData {
  projectCode: string;
  projectTitle: string;
  donor?: string;
  sector?: string;
  currency?: string;   // ISO 4217 code for the project's currency
  total: number;
  spent: number;
  remaining: number;
  burnRatePct: number;
  lines: Array<{
    label: string; level: string; planned: number; spent: number;
    remaining: number; burnRatePct: number;
    children?: Array<{ label: string; level: string; planned: number; spent: number; remaining: number; burnRatePct: number }>;
  }>;
  alerts: Array<{ level: string; message: string }>;
}

function printBudgetPdf(data: BudgetPdfData) {
  const t = i18n.getFixedT("en", "budget");
  const curr = resolveProjectCurrency(data.currency);
  const fmt = (n: number) => formatProjectBudgetMoney(n, curr);
  const burnRate = projectBurnRate(data.total, data.burnRatePct);
  const burnText = formatPercent(burnRate);
  const lineBurnText = (planned: number, rate: number) => formatPercent(projectBurnRate(planned, rate));
  const lineBurnColour = (planned: number, rate: number) =>
    projectBurnRate(planned, rate) != null && rate > 90 ? "#dc2626" : "#1a3c5e";
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const burnColor = burnRate != null && burnRate > 90 ? "#dc2626" : burnRate != null && burnRate > 70 ? "#d97706" : "#16a34a";

  const lineRows = data.lines.flatMap(l => [
    `<tr style="background:#f1f5f9"><td style="padding:6px 8px;font-weight:600">${l.label}</td><td style="padding:6px 8px;text-align:right">${fmt(l.planned)}</td><td style="padding:6px 8px;text-align:right">${fmt(l.spent)}</td><td style="padding:6px 8px;text-align:right">${fmt(l.remaining)}</td><td style="padding:6px 8px;text-align:right;font-weight:600;color:${lineBurnColour(l.planned, l.burnRatePct)}">${lineBurnText(l.planned, l.burnRatePct)}</td></tr>`,
    ...(l.children ?? []).map(a => `<tr><td style="padding:5px 8px 5px 28px;color:#475569">${a.label}</td><td style="padding:5px 8px;text-align:right;color:#475569">${fmt(a.planned)}</td><td style="padding:5px 8px;text-align:right;color:#475569">${fmt(a.spent)}</td><td style="padding:5px 8px;text-align:right;color:#475569">${fmt(a.remaining)}</td><td style="padding:5px 8px;text-align:right;color:${lineBurnColour(a.planned, a.burnRatePct)}">${lineBurnText(a.planned, a.burnRatePct)}</td></tr>`),
  ]).join("");

  const alertRows = data.alerts.map(a => `<div style="margin-bottom:6px;padding:8px 12px;border-left:4px solid ${a.level === "high" || a.level === "critical" ? "#dc2626" : "#d97706"};background:${a.level === "high" || a.level === "critical" ? "#fef2f2" : "#fffbeb"}"><strong style="text-transform:uppercase;font-size:10px">${a.level}:</strong> ${a.message}</div>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Budget Report — ${data.projectCode}</title>
  <style>body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1e293b;font-size:13px}
  @page{size:A4 landscape;margin:20mm}
  .header{background:#1a3c5e;color:#fff;padding:20px 24px;border-radius:8px;margin-bottom:24px}
  .header h1{margin:0 0 4px;font-size:20px;font-weight:700}
  .header .sub{opacity:.75;font-size:12px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  .kpi{border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px}
  .kpi .label{font-size:11px;color:#64748b;margin-bottom:4px}
  .kpi .value{font-size:20px;font-weight:700}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{background:#1a3c5e;color:#fff;padding:8px;text-align:left;font-size:11px}
  th:not(:first-child){text-align:right}
  td{border-bottom:1px solid #e2e8f0;font-size:12px}
  .footer{margin-top:24px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
  </style></head><body>
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:.65;margin-bottom:8px">${t("report.eyebrowProjectReport")}</div>
        <h1>${data.projectCode} — ${data.projectTitle}</h1>
        <div class="sub">${[data.donor, data.sector].filter(Boolean).join(" · ")} · ${t("report.generatedLabel")}: ${now}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;opacity:.65">${t("report.burnRate")}</div>
        <div style="font-size:32px;font-weight:700;color:${burnColor}">${burnText}</div>
      </div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="label">${t("report.totalBudget")}</div><div class="value">${fmt(data.total)}</div></div>
    <div class="kpi"><div class="label">${t("report.totalSpent")}</div><div class="value" style="color:#1a3c5e">${fmt(data.spent)}</div></div>
    <div class="kpi"><div class="label">${t("report.remaining")}</div><div class="value" style="color:#16a34a">${fmt(data.remaining)}</div></div>
    <div class="kpi"><div class="label">${t("report.utilisation")}</div><div class="value" style="color:${burnColor}">${burnText}</div></div>
  </div>

  ${data.alerts.length > 0 ? `<h3 style="margin-bottom:8px">⚠ ${t("report.budgetAlertsHeading")}</h3>${alertRows}` : ""}

  <h3 style="margin:20px 0 0">${t("report.budgetBreakdownHeading")}</h3>
  <table>
    <thead><tr><th>${t("report.lineItem")}</th><th style="text-align:right">${t("report.planned")}</th><th style="text-align:right">${t("report.spent")}</th><th style="text-align:right">${t("report.remaining")}</th><th style="text-align:right">${t("report.burnRate")}</th></tr></thead>
    <tbody>${lineRows}</tbody>
    <tfoot><tr style="background:#f8fafc;font-weight:700"><td style="padding:8px">${t("report.total")}</td><td style="padding:8px;text-align:right">${fmt(data.lines.reduce((s, l) => s + l.planned, 0))}</td><td style="padding:8px;text-align:right">${fmt(data.spent)}</td><td style="padding:8px;text-align:right">${fmt(data.remaining)}</td><td style="padding:8px;text-align:right;color:${burnColor}">${burnText}</td></tr></tfoot>
  </table>

  <div class="footer">CAFA Development Organisation · منظمة كافا للتنمية · Budget Report · ${now} · CONFIDENTIAL</div>
  <script>window.onload = () => { window.print(); }</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Excel export ──────────────────────────────────────────────────────────────

interface ExcelExportData {
  projectCode: string;
  projectTitle: string;
  donor?: string;
  sector?: string;
  currency?: string;   // ISO 4217 code
  data: BudgetPdfData;
  sectorEntries?: SectorBudgetEntry[];
  stateAllocations?: Array<{
    stateName: string;
    budgetAllocation: number;
    beneficiaryTarget: number;
    notes?: string | null;
  }>;
}

async function downloadWorkbook(sheets: BudgetWorkbookSheet[], filename: string) {
  await writeExcelFile(sheets).toFile(filename);
}

async function exportBudgetExcel(opts: ExcelExportData) {
  await downloadWorkbook(
    buildProjectBudgetWorkbook({
      ...opts.data,
      projectCode: opts.projectCode,
      projectTitle: opts.projectTitle,
      donor: opts.donor,
      sector: opts.sector,
      currency: resolveProjectCurrency(opts.currency),
      stateAllocations: opts.stateAllocations,
    }),
    `budget-${opts.projectCode.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

// ── Project CSV export ─────────────────────────────────────────────────────────

function exportProjectCsv(data: BudgetPdfData) {
  const currency = resolveProjectCurrency(data.currency);
  const currencyLabel = currency ? ` (${currency})` : " (currency unavailable)";
  const amount = (value: number) => currency ? String(value) : "—";
  const rate = (planned: number, reportedRate: number) => String(projectBurnRate(planned, reportedRate) ?? "—");
  const budgetRate = rate(data.total, data.burnRatePct);
  const rows: string[][] = [
    ["CAFA PMIS — Budget Report"],
    ["Project Code", data.projectCode],
    ["Project Title", data.projectTitle],
    ["Donor", data.donor ?? ""],
    ["Sector", data.sector ?? ""],
    ["Generated", new Date().toLocaleDateString("en-GB")],
    [],
    ["Line Item", "Level", `Planned${currencyLabel}`, `Spent${currencyLabel}`, `Remaining${currencyLabel}`, "Budget Utilisation (%)"],
  ];
  for (const l of data.lines) {
    rows.push([l.label, "Output", amount(l.planned), amount(l.spent), amount(l.remaining), rate(l.planned, l.burnRatePct)]);
    for (const a of (l.children ?? [])) {
      rows.push([a.label, "Activity", amount(a.planned), amount(a.spent), amount(a.remaining), rate(a.planned, a.burnRatePct)]);
    }
  }
  rows.push(["TOTAL", "", amount(data.lines.reduce((s, l) => s + l.planned, 0)), amount(data.spent), amount(data.remaining), budgetRate]);
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `budget-${data.projectCode.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ── Sector PDF export ──────────────────────────────────────────────────────────

function printSectorPdf(entry: SectorBudgetEntry, sectorProjects: Array<{ id: number; code?: string; title: string; donor?: string; status?: string; budgetTotal?: number }>) {
  const t = i18n.getFixedT("en", "budget");
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const fmtAmt = (n: number | null | undefined, curr: string) => n == null ? "—" : `${curr} ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const fmtPct = (n: number | null | undefined) => n == null ? "—" : `${parseFloat(n.toFixed(2))}%`;

  const currencyRows = entry.budgetByCurrency.map(c =>
    `<tr>
      <td style="padding:6px 8px;font-weight:600">${c.currency}</td>
      <td style="padding:6px 8px;text-align:right">${c.projectCount}</td>
      <td style="padding:6px 8px;text-align:right">${fmtAmt(c.budgetTotal, c.currency)}</td>
      <td style="padding:6px 8px;text-align:right">${fmtAmt(c.activityPlanned, c.currency)}</td>
      <td style="padding:6px 8px;text-align:right">${fmtAmt(c.activitySpent, c.currency)}</td>
      <td style="padding:6px 8px;text-align:right">${fmtAmt(c.remaining, c.currency)}</td>
      <td style="padding:6px 8px;text-align:right">${fmtPct(c.utilisationPct)}</td>
      <td style="padding:6px 8px;text-align:center">${c.overallocatedProjectCount > 0 ? `<span style="color:#dc2626">${t("report.overallocatedBadge", { count: c.overallocatedProjectCount })}</span>` : "—"}</td>
    </tr>`
  ).join("");

  const projectRows = sectorProjects.map(p =>
    `<tr><td style="padding:6px 8px;font-weight:500">${p.title}</td><td style="padding:6px 8px;color:#64748b">${p.code ?? "—"}</td><td style="padding:6px 8px;color:#64748b">${p.donor ?? "—"}</td><td style="padding:6px 8px;text-align:center"><span style="padding:2px 8px;border-radius:12px;font-size:11px;background:#e2e8f0">${(p.status ?? "").replace(/_/g, " ")}</span></td><td style="padding:6px 8px;text-align:right;font-weight:600">${p.budgetTotal != null ? p.budgetTotal.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</td></tr>`
  ).join("") || `<tr><td colspan="5" style="padding:12px 8px;text-align:center;color:#94a3b8">${t("report.noProjectsInSector")}</td></tr>`;

  const incompleteLabel = entry.totalActivityCount === null ? t("report.noActivitiesShort") :
    t("report.incompleteActivitiesCount", { count: entry.incompleteActivityCount ?? 0 });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sector Budget — ${entry.sector}</title>
  <style>body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1e293b;font-size:13px}
  @page{size:A4 landscape;margin:20mm}
  .header{background:#1a3c5e;color:#fff;padding:20px 24px;border-radius:8px;margin-bottom:24px}
  .header h1{margin:0 0 4px;font-size:20px;font-weight:700}
  .sub{opacity:.75;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:16px;margin-bottom:20px}
  th{background:#1a3c5e;color:#fff;padding:8px;text-align:left;font-size:11px}
  th:not(:first-child){text-align:right}
  td{border-bottom:1px solid #e2e8f0;font-size:12px}
  .note{font-size:11px;color:#64748b;margin-top:6px}
  .footer{margin-top:24px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
  </style></head><body>
  <div class="header">
    <div>
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:.65;margin-bottom:8px">${t("report.eyebrowSectorReport")}</div>
      <h1>${entry.sector}</h1>
      <div class="sub">${t("report.projectCount", { count: entry.projectCount })} · ${incompleteLabel} · ${t("report.generatedLabel")}: ${now}</div>
    </div>
  </div>
  <p class="note">${t("report.sectorBudgetDisclaimer")}</p>
  <h3 style="margin:0 0 4px">${t("report.financialSummaryByCurrency")}</h3>
  <table>
    <thead><tr><th>${t("report.currency")}</th><th>${t("report.projects")}</th><th>${t("report.totalBudget")}</th><th>${t("report.activityPlanned")}</th><th>${t("report.spent")}</th><th>${t("report.remainingBudget")}</th><th>${t("report.utilisation")}</th><th>${t("report.exceptions")}</th></tr></thead>
    <tbody>${currencyRows}</tbody>
  </table>
  <h3 style="margin:20px 0 8px">${t("report.projectsInSectorHeading", { count: entry.projectCount })}</h3>
  <table>
    <thead><tr><th>${t("report.projectTitle")}</th><th>${t("report.code")}</th><th>${t("report.donor")}</th><th>${t("report.status")}</th><th style="text-align:right">${t("report.budget")}</th></tr></thead>
    <tbody>${projectRows}</tbody>
  </table>
  <div class="footer">CAFA Development Organisation · منظمة كافا للتنمية · Sector Budget Report · ${now} · CONFIDENTIAL</div>
  <script>window.onload = () => { window.print(); }</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Sector Excel export ────────────────────────────────────────────────────────

async function exportSectorExcel(entry: SectorBudgetEntry, sectorProjects: Array<{ id: number; code?: string; title: string; donor?: string; status?: string; budgetTotal?: number }>) {
  await downloadWorkbook(
    buildSectorBudgetWorkbook({ ...entry, projects: sectorProjects }),
    `sector-budget-${entry.sector.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function useQueryParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const sp = new URLSearchParams(window.location.search);
  return sp.get(name) || undefined;
}


/** Alert tone for a budget alert level. */
function alertStatus(level: string): "danger" | "warning" | "success" {
  if (level === "critical" || level === "high") return "danger";
  if (level === "medium" || level === "warning") return "warning";
  return "success";
}

/** Money in an LTR isolate so "USD -60,000" keeps its sign next to the number in Arabic. */
function Money({ value, currency, className }: { value: number | null | undefined; currency: string | null | undefined; className?: string }) {
  return <bdi dir="ltr" className={className}>{fmtMoney(value, currency)}</bdi>;
}

type BudgetLine = {
  id: number;
  label: string;
  level: string;
  planned: number;
  spent: number;
  remaining: number;
  burnRatePct: number;
  children?: BudgetLine[];
};

/** Output → activity lines flattened for the grid, keeping each line's depth for indentation. */
type FlatBudgetLine = BudgetLine & { depth: number; key: string };
function flattenLines(lines: BudgetLine[], depth = 0): FlatBudgetLine[] {
  return lines.flatMap((l) => [
    { ...l, depth, key: `${depth}-${l.id}` },
    ...flattenLines((l.children as BudgetLine[] | undefined) ?? [], depth + 1),
  ]);
}

/** Burn-rate bar: red above 90% of plan. */
function BurnRate({ planned, rate, label }: { planned: number; rate: number; label: string }) {
  const burnRate = projectBurnRate(planned, rate);
  if (burnRate == null) return <span className="text-xs text-[var(--muted)]">—</span>;
  const over = burnRate > 90;
  return (
    <ProgressBar aria-label={label} value={Math.min(burnRate, 100)} color={over ? "danger" : "accent"} size="sm" className="w-full gap-1">
      <div className="flex justify-end text-xs">
        <span className={over ? "font-medium text-[var(--danger)]" : ""}><bdi dir="ltr">{formatPercent(burnRate)}</bdi></span>
      </div>
      <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
    </ProgressBar>
  );
}

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span className="text-xs text-[var(--muted)]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

interface ProjectInfo { code: string; title: string; donor?: string; sector?: string; currency?: string }

function ProjectBudgetView({ projectId, projectInfo }: { projectId: number; projectInfo?: ProjectInfo }) {
  const { t, i18n } = useTranslation("budget");
  const { data, isLoading } = useGetProjectBudget(projectId);
  const { data: stateAllocations } = useListProjectStateAllocations(projectId);

  const flatLines = useMemo(() => flattenLines((data?.lines ?? []) as BudgetLine[]), [data?.lines]);
  const lineColumns = useMemo<DataGridColumn<FlatBudgetLine>[]>(() => [
    { id: "label", header: t("project.lineItem"), isRowHeader: true, width: 320, headerClassName: "w-[320px]",
      cell: (line) => (
        <div style={{ paddingInlineStart: `${line.depth * 24}px` }} className={line.depth === 0 ? "font-medium" : "text-[var(--muted)]"}>
          <span className="me-2 text-xs text-[var(--muted)]">{formatBudgetLineLevel(line.level)}</span>
          <span dir="auto">{line.label}</span>
        </div>
      ) },
    { id: "planned", header: t("project.planned"), align: "end", width: 140,
      cell: (line) => <Money value={line.planned} currency={projectInfo?.currency} className="tabular-nums" /> },
    { id: "spent", header: t("project.spent"), align: "end", width: 140,
      cell: (line) => <Money value={line.spent} currency={projectInfo?.currency} className="tabular-nums" /> },
    { id: "remaining", header: t("project.remaining"), align: "end", width: 140,
      cell: (line) => <Money value={line.remaining} currency={projectInfo?.currency} className={`tabular-nums ${line.remaining < 0 ? "text-[var(--danger)]" : ""}`} /> },
    { id: "burn", header: t("project.burnRate"), width: 160,
      cell: (line) => <BurnRate planned={line.planned} rate={line.burnRatePct} label={`${t("project.burnRate")}: ${line.label}`} /> },
  ], [t, projectInfo?.currency]);

  if (isLoading || !data) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  }

  const pdfData: BudgetPdfData = {
    projectCode: projectInfo?.code ?? t("project.fallbackName", { id: projectId }),
    projectTitle: projectInfo?.title ?? "",
    donor: projectInfo?.donor,
    sector: projectInfo?.sector,
    currency: projectInfo?.currency,
    ...data,
  };
  const burnRate = projectBurnRate(data.total, data.burnRatePct);
  const displayCurrency = resolveProjectCurrency(projectInfo?.currency);
  const plannedLabel = t("project.planned");
  const actualLabel = t("sector.actual");

  return (
    <div className="space-y-6">
      {/* Export toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            <bdi dir="ltr">{projectInfo?.code ?? t("project.fallbackName", { id: projectId })}</bdi>
          </h2>
          {projectInfo?.title && <p dir="auto" className="text-sm text-[var(--muted)] text-page-start">{projectInfo.title}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onPress={() => exportProjectCsv(pdfData)}>
            <Download className="size-3.5" aria-hidden="true" /> {t("export.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" onPress={() => exportBudgetExcel({
            projectCode: pdfData.projectCode, projectTitle: pdfData.projectTitle,
            donor: pdfData.donor, sector: pdfData.sector, currency: pdfData.currency, data: pdfData,
            stateAllocations,
          })}>
            <FileSpreadsheet className="size-3.5 text-[var(--success)]" aria-hidden="true" /> {t("export.exportExcel")}
          </Button>
          <Button variant="outline" size="sm" onPress={() => printBudgetPdf(pdfData)}>
            <FileText className="size-3.5 text-[var(--danger)]" aria-hidden="true" /> {t("export.exportPdf")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* BUD-006: always format in the project's ISO currency — no USD fallback */}
        <FilterKpi icon={DollarSign} label={t("stats.total")} value={<Money value={data.total} currency={projectInfo?.currency} />} />
        <FilterKpi icon={TrendingUp} label={t("stats.spent")} value={<Money value={data.spent} currency={projectInfo?.currency} />} />
        <FilterKpi icon={PiggyBank} status="success" label={t("stats.remaining")} value={<Money value={data.remaining} currency={projectInfo?.currency} />} />
        <FilterKpi
          icon={Activity}
          status={burnRate != null && burnRate > 90 ? "danger" : undefined}
          label={t("stats.burnRate")}
          value={<bdi dir="ltr" className={burnRate != null && burnRate > 90 ? "text-[var(--danger)]" : ""}>{formatPercent(burnRate)}</bdi>}
          footer={burnRate != null ? (
            <ProgressBar aria-label={t("stats.burnRate")} value={Math.min(burnRate, 100)} color={burnRate > 90 ? "danger" : "accent"} size="sm" className="w-full">
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
          ) : undefined}
        />
      </div>

      {data.alerts.length > 0 && (
        <Card>
          <Card.Header><Card.Title className="text-base">{t("project.alerts")}</Card.Title></Card.Header>
          <Card.Content className="space-y-2">
            {data.alerts.map((a, i) => (
              <Alert key={i} status={alertStatus(a.level)}>
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title className="text-xs">{t(`alertLevels.${a.level}`, { defaultValue: a.level })}</Alert.Title>
                  <Alert.Description dir="auto" className="text-page-start">{a.message}</Alert.Description>
                </Alert.Content>
              </Alert>
            ))}
          </Card.Content>
        </Card>
      )}

      <Card>
        <Card.Header className="flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <Card.Title>{t("project.monthlyChart")}</Card.Title>
            <Card.Description>{t("project.monthlyChartDesc")}</Card.Description>
          </div>
          <ChartLegend items={[{ label: plannedLabel, color: "var(--chart-1)" }, { label: actualLabel, color: "var(--chart-3)" }]} />
        </Card.Header>
        <Card.Content>
          {/* Time runs forward along the axis in both languages (dir="ltr"), as on the dashboard. */}
          <div dir="ltr">
            <ProLineChart data={data.monthly} height={300}>
              <ProLineChart.Grid vertical={false} />
              <ProLineChart.XAxis dataKey="month" tickMargin={8} tickFormatter={(value: string) => formatMonthLabel(value, i18n.language)} />
              {/* BUD-006: currency-aware axis/tooltip — no hardcoded "$" */}
              <ProLineChart.YAxis
                width={84}
                tickFormatter={(v: number) => displayCurrency ? `${displayCurrency} ${(v / 1000).toFixed(0)}k` : "—"}
              />
              <ProLineChart.Line dataKey="planned" name={plannedLabel} type="monotone" stroke="var(--chart-1)" strokeWidth={2} dot={false} strokeDasharray="5 3" />
              <ProLineChart.Line dataKey="actual" name={actualLabel} type="monotone" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
              <ProLineChart.Tooltip
                content={({ active, label, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <ChartTooltip>
                      <ChartTooltip.Header>{formatMonthLabel(String(label), i18n.language)}</ChartTooltip.Header>
                      {payload.map((entry) => (
                        <ChartTooltip.Item key={String(entry.dataKey)}>
                          <ChartTooltip.Indicator color={entry.color ?? entry.stroke} />
                          <ChartTooltip.Label>{String(entry.name ?? "")}</ChartTooltip.Label>
                          <ChartTooltip.Value>{fmtMoney(Number(entry.value), projectInfo?.currency)}</ChartTooltip.Value>
                        </ChartTooltip.Item>
                      ))}
                    </ChartTooltip>
                  );
                }}
              />
            </ProLineChart>
          </div>
        </Card.Content>
      </Card>

      <Card className="gap-0 overflow-hidden p-0">
        <Card.Header className="px-5 pt-5 pb-3">
          <Card.Title>{t("project.budgetBreakdown")}</Card.Title>
          <Card.Description>{t("project.budgetBreakdownDesc")}</Card.Description>
        </Card.Header>
        <div role="region" aria-label={t("project.lineItemsRegion")}>
          <DataGrid
            aria-label={t("project.lineItemsRegion")}
            data={flatLines}
            columns={lineColumns}
            getRowId={(line) => line.key}
            contentClassName="min-w-[900px] table-fixed"
            verticalAlign="middle"
          />
        </div>
      </Card>
    </div>
  );
}


// ── Null-aware currency formatter ─────────────────────────────────────────────
// Always requires a currency code — never falls back to USD.
// Accepts undefined so it works with Orval-generated optional nullable fields.
function fmtMoney(val: number | null | undefined, currency: string | null | undefined): string {
  return formatProjectBudgetMoney(val, currency);
}

// ── Factual financial exception badges (no invented performance tiers) ────────
function BudgetFactualFlags({ entry }: { entry: SectorBudgetCurrencyEntry | null }) {
  const { t } = useTranslation("budget");
  if (!entry) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {entry.overspentProjectCount > 0 && (
        <Chip size="sm" variant="soft" color="danger">
          <AlertCircle className="size-3" aria-hidden="true" />
          {entry.overspentProjectCount === 1 ? t("sector.overspentCountOne") : t("sector.overspentCountN", { count: entry.overspentProjectCount })}
        </Chip>
      )}
      {entry.overallocatedProjectCount > 0 && (
        <Chip size="sm" variant="soft" color="warning">
          <AlertTriangle className="size-3" aria-hidden="true" />
          {entry.overallocatedProjectCount === 1 ? t("sector.overallocatedCountOne") : t("sector.overallocatedCountN", { count: entry.overallocatedProjectCount })}
        </Chip>
      )}
    </div>
  );
}

/** Utilisation bar: red over 100%, amber from 75%. */
function BudgetProgressBar({ value, isOver, label }: { value: number; isOver: boolean; label: string }) {
  const color = isOver ? "danger" : value >= 75 ? "warning" : "success";
  return (
    <ProgressBar aria-label={label} value={Math.min(value, 100)} color={color} size="sm" className="w-full">
      <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
    </ProgressBar>
  );
}

interface BudgetFiltersState {
  donor: string;
  stateId: string;
  sector: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: BudgetFiltersState = { donor: "", stateId: "", sector: "", status: "", dateFrom: "", dateTo: "" };
const PROJECT_STATUSES = ["draft", "submitted", "technically_approved", "coordination_approved", "approved", "active", "closed"];

function BudgetFilters({
  filters, onChange, projects,
}: {
  filters: BudgetFiltersState;
  onChange: (f: BudgetFiltersState) => void;
  projects?: Array<{ donor?: string }>;
}) {
  const { t, i18n } = useTranslation("budget");
  const { data: states } = useListStates();
  const donors = useMemo(() => {
    const s = new Set<string>();
    projects?.forEach(p => { if (p.donor) s.add(p.donor); });
    return Array.from(s).sort();
  }, [projects]);

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <Card className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 xl:flex xl:flex-row xl:flex-wrap xl:items-center" role="group" aria-label={t("filters.toolbar", { defaultValue: "Budget filters" })}>
      <div className="hidden items-center gap-2 px-1 xl:flex">
        <Filter className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <Separator orientation="vertical" className="mx-0.5 h-4" />
      </div>

      <SelectField
        aria-label={t("filters.donor")}
        value={filters.donor || "all"}
        onChange={v => onChange({ ...filters, donor: v === "all" ? "" : v })}
        className="w-full xl:w-auto"
        triggerClassName="sm:min-w-[9rem]"
        options={[{ value: "all", label: t("filters.allDonors") }, ...donors.map(d => ({ value: d, label: d }))]}
      />
      <SelectField
        aria-label={t("filters.state")}
        value={filters.stateId || "all"}
        onChange={v => onChange({ ...filters, stateId: v === "all" ? "" : v })}
        className="w-full xl:w-auto"
        triggerClassName="sm:min-w-[9rem]"
        options={[
          { value: "all", label: t("filters.allStates") },
          ...(states ?? []).map(s => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: getStateLabel(s, i18n.language) })),
        ]}
      />
      <SelectField
        aria-label={t("filters.sector")}
        value={filters.sector || "all"}
        onChange={v => onChange({ ...filters, sector: v === "all" ? "" : v })}
        className="w-full xl:w-auto"
        triggerClassName="sm:min-w-[9rem]"
        options={[{ value: "all", label: t("filters.allSectors") }, ...MAIN_SECTORS.map(s => ({ value: s, label: s }))]}
      />
      <SelectField
        aria-label={t("filters.projectStatus")}
        value={filters.status || "all"}
        onChange={v => onChange({ ...filters, status: v === "all" ? "" : v })}
        className="w-full xl:w-auto"
        triggerClassName="sm:min-w-[10rem]"
        options={[{ value: "all", label: t("filters.allStatuses") }, ...PROJECT_STATUSES.map(s => ({ value: s, label: t(`statusLabels.${s}`) }))]}
      />

      {/* Project Period — one range picker; projects whose period overlaps it are kept */}
      <div className="flex min-w-0 items-center gap-2 sm:col-span-2 xl:min-w-[20rem]" title={t("filters.periodHelp")}>
        <span className="shrink-0 text-xs text-[var(--muted)]">{t("filters.period")}</span>
        <DateRangeInput
          aria-label={`${t("filters.period")}: ${t("filters.from")} – ${t("filters.to")}`}
          start={filters.dateFrom}
          end={filters.dateTo}
          onChange={(dateFrom, dateTo) => onChange({ ...filters, dateFrom, dateTo })}
          className="min-w-0 flex-1"
        />
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" className="w-full text-[var(--muted)] sm:w-auto xl:ms-auto" onPress={() => onChange(EMPTY_FILTERS)} aria-label={t("filters.clear")}>
          <X className="size-3" aria-hidden="true" /> {t("filters.clear")}
        </Button>
      )}
    </Card>
  );
}

function SectorBudgetDetail({
  entry,
  open,
  onClose,
  selectedCurrency,
  projects,
}: {
  entry: SectorBudgetEntry | null;
  open: boolean;
  onClose: () => void;
  selectedCurrency: string;
  projects?: Array<{ id: number; code?: string; title: string; sector?: string; budgetTotal?: number; donor?: string; status?: string; currency?: string }>;
}) {
  const { t, i18n } = useTranslation("budget");
  const activeCurrEntry = useMemo<SectorBudgetCurrencyEntry | null>(() => {
    if (!entry || !entry.budgetByCurrency.length) return null;
    if (selectedCurrency === "all" || !entry.currencyMixed) return null;
    return entry.budgetByCurrency.find(c => c.currency === selectedCurrency) ?? null;
  }, [entry, selectedCurrency]);
  type SectorProject = NonNullable<typeof projects>[number];
  const projectColumns = useMemo<DataGridColumn<SectorProject>[]>(() => [
    { id: "project", header: t("sector.tableProject"), isRowHeader: true,
      cell: (p) => (
        <div className="min-w-0">
          <div dir="auto" className="whitespace-normal text-sm font-medium text-page-start">{p.title}</div>
          {p.code && <div className="text-xs text-[var(--muted)]"><bdi dir="ltr">{p.code}</bdi></div>}
        </div>
      ) },
    { id: "donor", header: t("sector.tableDonor"), cell: (p) => <span dir="auto" className="text-sm text-[var(--muted)]">{p.donor ?? "—"}</span> },
    { id: "status", header: t("sector.tableStatus"),
      cell: (p) => p.status
        ? <Chip size="sm" variant="soft" color={statusTone(p.status)}>{t(`status.${p.status}`, { ns: "projects", defaultValue: p.status.replace(/_/g, " ") })}</Chip>
        : <span className="text-[var(--muted)]">—</span> },
    { id: "budget", header: t("sector.tableBudget"), align: "end",
      cell: (p) => <span className="text-sm font-medium tabular-nums">
        {p.budgetTotal != null
          ? (p.currency ? <Money value={p.budgetTotal} currency={p.currency} /> : <bdi dir="ltr">{p.budgetTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</bdi>)
          : "—"}
      </span> },
  ], [t]);
  if (!entry) return null;
  const meta = getSectorMeta(entry.sector);
  const Icon = meta.icon;
  const sectorProjects = projects?.filter(p => p.sector === entry.sector) ?? [];
  const showMulti = entry.currencyMixed && selectedCurrency === "all";
  const isRtl = i18n.dir?.() === "rtl";

  const activityLabel = entry.totalActivityCount === null
    ? t("sector.noActivitiesRecorded")
    : entry.incompleteActivityCount === 0
    ? t("sector.allActivitiesComplete")
    : t("sector.nOfMIncomplete", { n: entry.incompleteActivityCount, m: entry.totalActivityCount });

  const exportCsv = () => {
    const header = ["Sector", "Currency", "Projects", "Total Budget", "Activity Planned", "Spent", "Remaining Budget", "Unallocated Budget", "Utilisation %", "Incomplete Activities", "Overallocated Projects", "Overspent Projects"];
    const dataRows = entry.budgetByCurrency.map(c => [
      entry.sector, c.currency, c.projectCount,
      c.budgetTotal ?? "", c.activityPlanned ?? "", c.activitySpent ?? "",
      c.remaining ?? "", c.unallocated ?? "",
      c.utilisationPct != null ? parseFloat(c.utilisationPct.toFixed(4)) : "",
      entry.incompleteActivityCount ?? "",
      c.overallocatedProjectCount, c.overspentProjectCount,
    ]);
    const csv = [header, ...dataRows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `sector-budget-${entry.sector.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
  };

  const figure = (label: string, value: React.ReactNode, strong = false, negative = false) => (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`${strong ? "font-bold" : "font-medium"} ${negative ? "text-[var(--danger)]" : ""}`}>{value}</p>
    </div>
  );
  const renderCurrencyCard = (c: SectorBudgetCurrencyEntry) => (
    <Card key={c.currency} variant="secondary" className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium"><bdi dir="ltr">{c.currency}</bdi></span>
        <BudgetFactualFlags entry={c} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        {figure(t("sector.totalBudget"), <Money value={c.budgetTotal} currency={c.currency} />, true)}
        {figure(t("sector.activityPlanned"), <Money value={c.activityPlanned} currency={c.currency} />)}
        {figure(t("sector.unallocatedBudget"), <Money value={c.unallocated} currency={c.currency} />, false, (c.unallocated ?? 0) < 0)}
        {figure(t("sector.spent"), <Money value={c.activitySpent} currency={c.currency} />)}
        {figure(t("sector.remainingBudget"), <Money value={c.remaining} currency={c.currency} />, false, (c.remaining ?? 0) < 0)}
        {figure(t("sector.utilisation"), c.utilisationPct == null ? "—" : <bdi dir="ltr">{formatPercent(c.utilisationPct)}</bdi>)}
      </div>
      {c.utilisationPct != null && (
        <BudgetProgressBar value={c.utilisationPct} isOver={c.utilisationPct > 100} label={`${t("sector.utilisation")} ${c.currency}`} />
      )}
    </Card>
  );

  return (
    <Drawer>
      <Drawer.Backdrop isOpen={open} onOpenChange={v => { if (!v) onClose(); }}>
        {/* Slides in from the reading-end edge: right in English, left in Arabic. */}
        <Drawer.Content placement={isRtl ? "left" : "right"}>
          <Drawer.Dialog className="h-full w-screen max-w-full sm:w-[44rem]">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <div className="flex items-center gap-3">
                <div className={`rounded-xl border p-2.5 ${meta.bg} ${meta.border}`}>
                  <Icon className={`size-5 ${meta.color}`} aria-hidden="true" />
                </div>
                <div>
                  <Drawer.Heading className="text-xl">{entry.sector}</Drawer.Heading>
                  <p className="text-sm text-[var(--muted)]">{t("sector.detailDesc")}</p>
                </div>
              </div>
            </Drawer.Header>

            <Drawer.Body className="space-y-6">
              <div className="grid grid-cols-2 gap-3">
                <Card variant="secondary" className="flex-row items-center gap-3 p-3">
                  <FolderOpen className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[var(--muted)]">{t("sector.projects")}</p>
                    <p className="text-lg font-bold tabular-nums">{entry.projectCount}</p>
                  </div>
                </Card>
                <Card variant="secondary" className="flex-row items-center gap-3 p-3">
                  <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[var(--muted)]">{t("sector.incompleteActivities")}</p>
                    <p className="text-lg font-bold tabular-nums">
                      {entry.totalActivityCount === null ? "—" : (entry.incompleteActivityCount ?? 0)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">{activityLabel}</p>
                  </div>
                </Card>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold">{t("sector.financialSummary")}</h3>
                <div className="space-y-3">
                  {showMulti || !activeCurrEntry
                    ? entry.budgetByCurrency.map(renderCurrencyCard)
                    : renderCurrencyCard(activeCurrEntry)}
                </div>
              </div>

              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content><Alert.Description className="text-xs">{t("sector.sectorAttribution")}</Alert.Description></Alert.Content>
              </Alert>

              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t("sector.projectsInSector")}</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" onPress={exportCsv}>
                      <Download className="size-3" aria-hidden="true" /> {t("export.exportCsv")}
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => exportSectorExcel(entry, sectorProjects)}>
                      <FileSpreadsheet className="size-3 text-[var(--success)]" aria-hidden="true" /> {t("export.exportExcel")}
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => printSectorPdf(entry, sectorProjects)}>
                      <FileText className="size-3 text-[var(--danger)]" aria-hidden="true" /> {t("export.exportPdf")}
                    </Button>
                  </div>
                </div>
                {sectorProjects.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--muted)]">{t("sector.noProjectData")}</p>
                ) : (
                  <div role="region" aria-label={t("sector.projectsRegion")}>
                    <DataGrid
                      aria-label={t("sector.projectsRegion")}
                      data={sectorProjects}
                      columns={projectColumns}
                      getRowId={(p) => p.id}
                      contentClassName="min-w-[520px]"
                      verticalAlign="middle"
                    />
                  </div>
                )}
              </div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

function SectorBudgetCard({
  entry,
  selectedCurrency,
  onClick,
}: {
  entry: SectorBudgetEntry;
  selectedCurrency: string;
  onClick: (e: SectorBudgetEntry) => void;
}) {
  const { t } = useTranslation("budget");
  const meta = getSectorMeta(entry.sector);
  const Icon = meta.icon;

  // Resolve active currency entry for display
  const activeCurrEntry = useMemo<SectorBudgetCurrencyEntry | null>(() => {
    if (!entry.budgetByCurrency.length) return null;
    if (selectedCurrency !== "all" && entry.currencyMixed) {
      return entry.budgetByCurrency.find(c => c.currency === selectedCurrency) ?? null;
    }
    return entry.budgetByCurrency[0] ?? null;
  }, [entry.budgetByCurrency, entry.currencyMixed, selectedCurrency]);

  const showMulti = entry.currencyMixed && selectedCurrency === "all";
  const hasOverspent = entry.budgetByCurrency.some(c => c.overspentProjectCount > 0);
  const hasOverallocated = entry.budgetByCurrency.some(c => c.overallocatedProjectCount > 0);

  const activityLabel =
    entry.totalActivityCount === null ? t("sector.noActivities")
    : entry.incompleteActivityCount === 0 ? t("sector.zeroIncomplete")
    : entry.incompleteActivityCount === 1 ? t("sector.oneIncomplete")
    : t("sector.nIncomplete", { n: entry.incompleteActivityCount });

  const borderClass = hasOverspent
    ? "border-[color-mix(in_oklab,var(--danger)_35%,transparent)]"
    : hasOverallocated
    ? "border-[color-mix(in_oklab,var(--warning)_45%,transparent)]"
    : "border-transparent";

  return (
    <button
      type="button"
      onClick={() => onClick(entry)}
      className={`group flex h-full w-full flex-col rounded-[calc(var(--radius)*2.5)] border bg-[var(--surface)] px-4 py-4 text-start shadow-[var(--surface-shadow)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${borderClass}`}
    >
      {/* ── Icon + badges row ─────────────────────────────────────────── */}
      <div className="mb-3 flex items-start justify-between">
        <div className={`shrink-0 rounded-lg border p-2 ${meta.bg} ${meta.border}`}>
          <Icon className={`size-4 ${meta.color}`} aria-hidden="true" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {hasOverspent && (
            <Chip size="sm" variant="soft" color="danger">
              <AlertCircle className="size-3" aria-hidden="true" /> {t("sector.overspent")}
            </Chip>
          )}
          {hasOverallocated && (
            <Chip size="sm" variant="soft" color="warning">
              <AlertTriangle className="size-3" aria-hidden="true" /> {t("sector.overallocated")}
            </Chip>
          )}
          <ChevronRight className="size-3.5 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" aria-hidden="true" />
        </div>
      </div>

      {/* ── Stable title + metadata block — min-height keeps financial metrics aligned ── */}
      <div className="mb-3 min-h-[3.5rem]">
        <h3 className="mb-1 text-sm font-semibold leading-snug">{entry.sector}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-1 text-xs text-[var(--muted)] tabular-nums">
            <FolderOpen className="size-3 shrink-0" aria-hidden="true" />{entry.projectCount} {entry.projectCount === 1 ? t("sector.oneProject") : t("sector.nProjects")}
          </span>
          <span className="flex items-center gap-1 text-xs text-[var(--muted)]">
            <Activity className="size-3 shrink-0" aria-hidden="true" />{activityLabel}
          </span>
        </div>
      </div>

      {/* ── Financial content — grows to fill remaining card height ───── */}
      <div className="flex flex-1 flex-col">
        {showMulti ? (
          <div className="flex-1 space-y-1.5 border-t border-dashed border-[var(--border)] pt-2">
            <p className="mb-1 text-xs text-[var(--muted)]">{t("sector.totalBudgetByCurrency")}</p>
            {entry.budgetByCurrency.map(c => (
              <div key={c.currency} className="flex items-baseline justify-between">
                <span className="text-xs text-[var(--muted)]"><bdi dir="ltr">{c.currency}</bdi></span>
                <Money value={c.budgetTotal} currency={c.currency} className="text-sm font-medium tabular-nums" />
              </div>
            ))}
          </div>
        ) : activeCurrEntry ? (
          <div className="flex flex-1 flex-col gap-3">
            {/* Total Budget — primary hierarchy */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xs text-[var(--muted)]">{t("sector.totalBudget")}</span>
                <Money value={activeCurrEntry.budgetTotal} currency={activeCurrEntry.currency} className="text-sm font-semibold tabular-nums" />
              </div>
              <BudgetProgressBar
                value={activeCurrEntry.utilisationPct ?? 0}
                isOver={(activeCurrEntry.utilisationPct ?? 0) > 100}
                label={`${t("sector.utilisation")}: ${entry.sector}`}
              />
              {/* Spent + utilisation */}
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs text-[var(--muted)] tabular-nums">
                  {t("sector.spent")}: <span className="font-medium text-[var(--foreground)]"><Money value={activeCurrEntry.activitySpent} currency={activeCurrEntry.currency} /></span>
                </span>
                <span className={`text-xs font-medium tabular-nums ${(activeCurrEntry.utilisationPct ?? 0) > 100 ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
                  {activeCurrEntry.utilisationPct == null ? "—" : <bdi dir="ltr">{formatPercent(activeCurrEntry.utilisationPct)}</bdi>}
                </span>
              </div>
            </div>

            {/* Secondary financial metrics — one coherent section */}
            <div className="mt-auto border-t border-dashed border-[var(--border)] pt-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <p className="mb-0.5 text-[11px] text-[var(--muted)]">{t("sector.activityPlanned")}</p>
                  <Money value={activeCurrEntry.activityPlanned} currency={activeCurrEntry.currency} className="text-xs font-medium tabular-nums" />
                </div>
                <div>
                  <p className="mb-0.5 text-[11px] text-[var(--muted)]">{t("sector.remaining")}</p>
                  <Money value={activeCurrEntry.remaining} currency={activeCurrEntry.currency} className={`text-xs font-medium tabular-nums ${(activeCurrEntry.remaining ?? 0) < 0 ? "text-[var(--danger)]" : ""}`} />
                </div>
              </div>
              <div className="mt-2">
                <p className="mb-0.5 text-[11px] text-[var(--muted)]">{t("sector.unallocated")}</p>
                <Money value={activeCurrEntry.unallocated} currency={activeCurrEntry.currency} className={`text-xs font-medium tabular-nums ${(activeCurrEntry.unallocated ?? 0) < 0 ? "text-[var(--danger)]" : ""}`} />
              </div>
            </div>
          </div>
        ) : (
          <p className="border-t border-dashed border-[var(--border)] pt-2 text-xs text-[var(--muted)]">{t("sector.noFinancialData")}</p>
        )}
      </div>
    </button>
  );
}

function SectorBudgetView({ userRole, userSectors }: { userRole?: string; userSectors?: string[] }) {
  const { t } = useTranslation("budget");
  const [filters, setFilters] = useState<BudgetFiltersState>(EMPTY_FILTERS);

  // Sync with global location context — updates the local stateId filter when the header selector changes
  const { selectedStateId: ctxStateId } = useLocationContext();
  useEffect(() => {
    setFilters(f => ({ ...f, stateId: ctxStateId != null ? String(ctxStateId) : "" }));
  }, [ctxStateId]);

  const [selected, setSelected] = useState<SectorBudgetEntry | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>("all");
  const { data: projects } = useListProjects();
  const autoSector = useQueryParam("sectorOpen");

  const apiParams = useMemo(() => ({
    ...(filters.donor ? { donor: filters.donor } : {}),
    ...(filters.stateId ? { stateId: Number(filters.stateId) } : {}),
    ...(filters.sector ? { sector: filters.sector } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  }), [filters]);

  const { data: sectorData, isLoading, isError, refetch } = useGetSectorBudget(apiParams);
  const sectors = useMemo(() => sectorData?.sectors ?? [], [sectorData]);
  const unresolvedSectorProjects = sectorData?.unresolvedSectorProjects ?? 0;
  const unresolvedBudgetByCurrency = useMemo(() => sectorData?.unresolvedBudgetByCurrency ?? {}, [sectorData]);

  // Derive available currencies across all visible sectors
  const availableCurrencies = useMemo(() => {
    const s = new Set<string>();
    sectors.forEach(e => e.budgetByCurrency.forEach(c => s.add(c.currency)));
    return Array.from(s).sort();
  }, [sectors]);

  useEffect(() => {
    if (autoSector && sectors.length && !selected) {
      const match = sectors.find(s => s.sector.toLowerCase() === autoSector.toLowerCase());
      if (match) setSelected(match);
    }
  }, [autoSector, sectors, selected]);

  const visibleSectors = useMemo(() => {
    if (!sectors.length && !sectorData) return [];
    if (userRole === "technical_coordinator" && userSectors?.length) {
      return sectors.filter(s => userSectors.includes(s.sector));
    }
    return sectors;
  }, [sectors, sectorData, userRole, userSectors]);

  // SPO scope note — shown for state-scoped roles
  const isSpoRole = userRole === "state_program_officer" || userRole === "state_officer";

  const exportAllCsv = () => {
    if (!visibleSectors.length) return;
    const header = [
      "Sector", "Currency", "Projects", "Total Budget", "Activity Planned",
      "Spent", "Remaining Budget", "Unallocated Budget", "Utilisation %",
      "Incomplete Activities", "Overallocated Projects", "Overallocated Amount",
      "Overspent Projects", "Overspent Amount",
    ];
    const dataRows: (string | number)[][] = [];
    for (const e of visibleSectors) {
      for (const c of e.budgetByCurrency) {
        dataRows.push([
          e.sector, c.currency, c.projectCount,
          c.budgetTotal ?? "", c.activityPlanned ?? "", c.activitySpent ?? "",
          c.remaining ?? "", c.unallocated ?? "",
          c.utilisationPct != null ? parseFloat(c.utilisationPct.toFixed(4)) : "",
          e.incompleteActivityCount ?? "",
          c.overallocatedProjectCount, c.overallocatedAmount,
          c.overspentProjectCount, c.overspentAmount,
        ]);
      }
    }
    // Append unresolved review rows
    if (unresolvedSectorProjects > 0) {
      for (const [cur, amt] of Object.entries(unresolvedBudgetByCurrency)) {
        dataRows.push([
          "Sector Review Required", cur, "", amt, "", "", "", "", "", "", "", "", "", "",
        ]);
      }
    }
    const csv = [header, ...dataRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "sector-budget-summary.csv";
    a.click();
  };

  return (
    <div className="space-y-4">
      <BudgetFilters filters={filters} onChange={setFilters} projects={projects} />

      {/* Attribution methodology note — neutral informational, not a warning */}
      <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {t("sector.spo.attribution")}
          {isSpoRole && (
            <> &nbsp;·&nbsp; {t("sector.spo.scopeNote")}</>
          )}
        </span>
      </p>

      {unresolvedSectorProjects > 0 && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              <span className="font-medium">
                {unresolvedSectorProjects === 1
                  ? t("sector.unresolvedOne")
                  : t("sector.unresolvedN", { count: unresolvedSectorProjects })}
              </span>
              {" — "}
              {Object.entries(unresolvedBudgetByCurrency).map(([cur, amt], i) => (
                <span key={cur}>{i > 0 ? ", " : ""}<bdi dir="ltr">{`${cur} ${amt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}</bdi></span>
              ))}{" "}
              {t("sector.unresolvedBudget")}.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* Currency selector — only shown when data is available */}
      {availableCurrencies.length > 1 && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span className="text-xs text-[var(--muted)]">{t("filters.currency")}</span>
          <SelectField
            aria-label={t("filters.currency")}
            value={selectedCurrency}
            onChange={setSelectedCurrency}
            className="flex-1 sm:flex-none"
            triggerClassName="min-w-[10rem]"
            options={[{ value: "all", label: t("filters.allCurrencies") }, ...availableCurrencies.map(c => ({ value: c, label: c }))]}
          />
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <Card className="items-center gap-3 border border-dashed border-[var(--border)] py-16 text-center">
          <AlertCircle className="size-8 text-[var(--danger)]" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">{t("sector.loadError")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("sector.loadErrorDesc")}</p>
          </div>
          <Button variant="outline" size="sm" onPress={() => { void refetch(); }}>{t("overview.tryAgain")}</Button>
        </Card>
      ) : !visibleSectors?.length ? (
        <Card className="items-center border border-dashed border-[var(--border)] py-16 text-center">
          <Filter className="mx-auto mb-3 size-10 text-[var(--muted)] opacity-40" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--muted)]">{t("sector.noDataForSector")}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("sector.noDataDesc")}</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">
              {visibleSectors.length !== 1 ? t("sector.sectorsWithDataPlural", { count: visibleSectors.length }) : t("sector.sectorsWithData", { count: visibleSectors.length })}
            </p>
            <Button size="sm" variant="outline" onPress={exportAllCsv}>
              <Download className="size-3.5" aria-hidden="true" /> {t("export.exportAll")}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleSectors.map(entry => (
              <SectorBudgetCard
                key={entry.sector}
                entry={entry}
                selectedCurrency={selectedCurrency}
                onClick={setSelected}
              />
            ))}
          </div>
        </>
      )}

      <SectorBudgetDetail
        entry={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        selectedCurrency={selectedCurrency}
        projects={projects}
      />
    </div>
  );
}

function OverviewView() {
  const { t } = useTranslation("budget");

  // Include selectedStateId in all query keys so switching the location
  // context triggers genuine refetches rather than reusing stale org-wide data.
  const { selectedStateId } = useLocationContext();

  const summaryParams = useMemo(() => ({
    ...(selectedStateId != null ? { stateId: selectedStateId } : {}),
  }), [selectedStateId]);

  const { data: summary, isLoading: sLoading, isError: sError, refetch: refetchSummary } = useGetDashboardSummary(
    summaryParams,
    { query: { queryKey: getGetDashboardSummaryQueryKey(summaryParams) } },
  );
  // Custom query hooks that pass selectedStateId as a real ?stateId query param
  // so the backend actually filters projects to the selected location.
  const donorPortfolioUrl = useMemo(() => {
    const base = "/api/dashboard/donor-portfolio";
    return selectedStateId != null ? `${base}?stateId=${selectedStateId}` : base;
  }, [selectedStateId]);
  const { data: allDonors, isLoading: dLoading, isError: dError, refetch: refetchDonors } = useQuery({
    queryKey: [...getGetDonorPortfolioQueryKey(), selectedStateId],
    queryFn: ({ signal }) => customFetch<DonorPortfolioEntry[]>(donorPortfolioUrl, { signal }),
  });

  const projectBudgetPerfUrl = useMemo(() => {
    const base = "/api/dashboard/project-budget-performance";
    return selectedStateId != null ? `${base}?stateId=${selectedStateId}` : base;
  }, [selectedStateId]);
  const { data: projectBudgetPerformance, isLoading: pLoading, isError: pError, refetch: refetchProjectBudgetPerformance } = useQuery({
    queryKey: [...getGetProjectBudgetPerformanceQueryKey(), selectedStateId],
    queryFn: ({ signal }) => customFetch<ProjectBudgetPerformanceEntry[]>(projectBudgetPerfUrl, { signal }),
  });
  const { data: me } = useGetMe();
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>("all");

  const role = me?.user?.role;
  const userSectors = useMemo(() => {
    const s = me?.user?.sector;
    return s ? String(s).split(",").map((x: string) => x.trim()).filter(Boolean) : undefined;
  }, [me?.user?.sector]);

  const currencyMixed = summary?.currencyMixed ?? false;
  const budgetByCurrency = useMemo(() => summary?.budgetByCurrency ?? [], [summary?.budgetByCurrency]);
  // Unified KPI row for the selected currency (or null in per-currency breakdown mode)
  type KpiRow = {
    currency: string | null | undefined;
    totalBudget: number | null;
    totalSpent: number | null;
    budgetRemaining: number | null;
    utilisationRate: number | null | undefined;
  };
  const kpiData = useMemo<KpiRow | null>(() => {
    if (!summary) return null;
    if (currencyMixed && selectedCurrency && selectedCurrency !== "all") {
      const row = budgetByCurrency.find(b => b.currency === selectedCurrency);
      return row
        ? { currency: row.currency, totalBudget: row.totalBudget, totalSpent: row.totalSpent, budgetRemaining: row.budgetRemaining, utilisationRate: row.utilisationRate }
        : null;
    }
    if (!currencyMixed) {
      // Prefer per-currency data (always populated after backend fix); fallback to summary top-level
      if (budgetByCurrency.length > 0) {
        const row = budgetByCurrency[0];
        return { currency: row.currency, totalBudget: row.totalBudget, totalSpent: row.totalSpent, budgetRemaining: row.budgetRemaining, utilisationRate: row.utilisationRate };
      }
      return {
        currency: summary.currency ?? null,
        totalBudget: summary.totalBudget ?? null,
        totalSpent: summary.totalSpent ?? null,
        budgetRemaining: summary.budgetRemaining ?? null,
        utilisationRate: summary.burnRatePct,
      };
    }
    return null; // mixed currency before the registry reports its active currency
  }, [summary, selectedCurrency, currencyMixed, budgetByCurrency]);

  const showMultiCurrency = currencyMixed && (selectedCurrency === "all" || !selectedCurrency);

  // Read-only RBAC scope label
  const scopeLabel = useMemo(() => {
    if (!role) return null;
    if (role === "technical_coordinator")
      return userSectors?.length ? t("scope.sectors", { sectors: userSectors.join(", ") }) : t("scope.assignedSectors");
    if (role === "state_program_officer" || role === "state_office_manager")
      return t("scope.assignedState");
    return t("scope.organisationWide");
  }, [role, userSectors, t]);

  // A numerical amount without an ISO currency code is not safely interpretable.
  // Keep genuine zero when the code is known; otherwise use the neutral unavailable marker.
  const fmtMoney = (val: number | null | undefined, curr: string | null | undefined) => {
    if (val == null) return "—";
    if (!curr) return "—";
    return formatCurrency(val, curr);
  };

  // Multi-currency renderers for KPI card values
  const multiValue = (field: "totalBudget" | "totalSpent" | "budgetRemaining") => (
    <span className="flex flex-col gap-0.5">
      {budgetByCurrency.map(b => (
        <span key={b.currency} className="text-base font-semibold leading-snug">
          <bdi dir="ltr">{fmtMoney(b[field], b.currency)}</bdi>
        </span>
      ))}
    </span>
  );

  const multiUtil = () => (
    <span className="flex flex-col gap-0.5">
      {budgetByCurrency.map(b => (
        <span key={b.currency} className="text-base font-semibold leading-snug">
          <span className="me-1 text-xs text-[var(--muted)]"><bdi dir="ltr">{b.currency}</bdi></span>
          <bdi dir="ltr">{formatPercent(b.utilisationRate)}</bdi>
        </span>
      ))}
    </span>
  );
  const loadingValue = <Skeleton className="h-6 w-28 rounded-md" />;
  const single = (v: number | null | undefined) => <bdi dir="ltr">{fmtMoney(v, kpiData?.currency)}</bdi>;

  return (
    <div className="space-y-4">
      {/* Scope is contextual; the Donor Portfolio registry owns the shared currency control. */}
      {scopeLabel && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <span>{t("overview.scope")}:</span>
          <Chip size="sm" variant="secondary">{scopeLabel}</Chip>
        </div>
      )}

      {/* Mixed-currency notice */}
      {showMultiCurrency && (
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content><Alert.Description className="text-xs">{t("overview.mixedCurrencyNotice")}</Alert.Description></Alert.Content>
        </Alert>
      )}

      {sError && (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content><Alert.Description className="text-xs">{t("overview.summaryLoadError")}</Alert.Description></Alert.Content>
          <Button variant="outline" size="sm" onPress={() => { void refetchSummary(); }}>{t("overview.tryAgain")}</Button>
        </Alert>
      )}

      {/* KPI cards — compact enterprise density */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FilterKpi icon={DollarSign} label={t("totalBudget")}
          value={sLoading ? loadingValue : sError ? "—" : showMultiCurrency ? multiValue("totalBudget") : single(kpiData?.totalBudget)} />
        <FilterKpi icon={TrendingUp} label={t("totalSpent")}
          value={sLoading ? loadingValue : sError ? "—" : showMultiCurrency ? multiValue("totalSpent") : single(kpiData?.totalSpent)} />
        <FilterKpi icon={PiggyBank} status="success" label={t("remaining")}
          value={sLoading ? loadingValue : sError ? "—" : showMultiCurrency ? multiValue("budgetRemaining") : single(kpiData?.budgetRemaining)} />
        <FilterKpi
          icon={Activity}
          status={(kpiData?.utilisationRate ?? 0) > 90 ? "danger" : undefined}
          label={t("sector.budgetUtilisation")}
          value={sLoading ? loadingValue
            : sError ? "—"
            : showMultiCurrency ? multiUtil()
            : <bdi dir="ltr">{formatPercent(kpiData?.utilisationRate)}</bdi>}
          footer={!sLoading && !showMultiCurrency && kpiData?.utilisationRate != null
            ? (
              <ProgressBar aria-label={t("sector.budgetUtilisation")} value={Math.min(100, kpiData.utilisationRate ?? 0)} color={(kpiData.utilisationRate ?? 0) > 90 ? "danger" : "accent"} size="sm" className="w-full">
                <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
              </ProgressBar>
            ) : undefined}
        />
      </div>

      {/* Donor Portfolio */}
      <Card className="gap-0 p-0">
        <Card.Header className="px-5 pt-5 pb-3">
          <Card.Title>{t("donor.portfolio")}</Card.Title>
          <Card.Description>{t("donor.portfolioDesc")}</Card.Description>
        </Card.Header>
        <DonorPortfolioTable
          data={allDonors}
          isLoading={dLoading}
          isError={dError}
          onRetry={() => { void refetchDonors(); }}
          activeCurrency={selectedCurrency}
          onActiveCurrencyChange={setSelectedCurrency}
        />
      </Card>
      <Card className="gap-0 p-0">
        <Card.Header className="px-5 pt-5 pb-3">
          <Card.Title>{t("dashboard:budgetWorkspace.projectPerformanceTitle")}</Card.Title>
          <Card.Description>{t("dashboard:budgetWorkspace.projectPerformanceDescription")}</Card.Description>
        </Card.Header>
        <ProjectBudgetPerformanceTable
          data={projectBudgetPerformance}
          isLoading={pLoading}
          isError={pError}
          onRetry={() => { void refetchProjectBudgetPerformance(); }}
          role={role ?? ""}
          spoStateId={(me?.user as unknown as Record<string, unknown>)?.stateId}
        />
      </Card>
    </div>
  );
}

export default function BudgetPage() {
  const { t } = useTranslation("budget");
  const queryProjectId = useQueryParam("projectId");
  const [selectedProject, setSelectedProject] = useState<string>(queryProjectId || "");
  const queryTab = useQueryParam("tab");
  const [overviewTab, setOverviewTab] = useState<"overview" | "sector">(queryTab === "sector" ? "sector" : "overview");
  const { data: projects } = useListProjects();
  const { data: me } = useGetMe();
  const perms = me?.permissions ?? [];
  const canView = hasPerm(perms, "budget.view") || hasPerm(perms, "budget.view.all") || hasPerm(perms, "budget.view.state") || hasPerm(perms, "budget.view.sector");
  const canEdit = hasPerm(perms, "*") || hasPerm(perms, "budget.edit");
  const userRole = me?.user?.role;

  // Role-tier helpers for UI banners
  const isViewOnly = !canEdit && canView; // ED, state_office_manager, state_program_officer
  const isSectorRestricted = userRole === "technical_coordinator";

  const userSectors = useMemo(() => {
    const s = me?.user?.sector;
    return s ? s.split(",").map((x: string) => x.trim()).filter(Boolean) : undefined;
  }, [me?.user?.sector]);

  useEffect(() => {
    if (queryProjectId) setSelectedProject(queryProjectId);
  }, [queryProjectId]);

  const projectIdNum = useMemo(() => selectedProject ? Number(selectedProject) : null, [selectedProject]);

  if (!canView) {
    return (
      <EmptyState className="py-16">
        <EmptyState.Header>
          <EmptyState.Media variant="icon"><Lock aria-hidden="true" /></EmptyState.Media>
          <EmptyState.Title>{t("page.accessRestricted")}</EmptyState.Title>
          <EmptyState.Description>{t("page.accessRestrictedDesc")}</EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-xl font-semibold">{t("page.heading")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("page.description")}</p>
        </div>
        {/* All Projects selector — hidden when Sector Budgets tab is active (inert on that tab) */}
        {overviewTab !== "sector" && (
          <SelectField
            aria-label={t("page.selectProject")}
            value={selectedProject || "all"}
            onChange={(v) => setSelectedProject(v === "all" ? "" : v)}
            className="w-full sm:w-80"
            options={[
              { value: "all", label: t("page.allProjects") },
              ...(projects ?? []).map(p => ({
                value: String(p.id),
                label: <span className="flex min-w-0 items-baseline gap-1.5"><bdi dir="ltr" className="shrink-0 font-mono text-xs text-[var(--muted)]">{p.code}</bdi><span dir="auto" className="truncate">{p.title}</span></span>,
                textValue: `${p.code} ${p.title}`,
              })),
            ]}
          />
        )}
      </div>

      {isViewOnly && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description><strong>{t("page.viewOnly")}</strong> — {t("page.viewOnlyDesc")}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {isSectorRestricted && (
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              <strong>{t("page.sectorRestricted")}</strong> — {t("page.sectorRestrictedDesc")}
              {userSectors && userSectors.length > 0 && (
                <> {userSectors.map(s => <Chip key={s} size="sm" variant="secondary" className="ms-1">{s}</Chip>)}</>
              )} {t("page.sectorRestrictedOnly")}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {projectIdNum ? (
        <ProjectBudgetView
          projectId={projectIdNum}
          projectInfo={projects?.find(p => p.id === projectIdNum) as ProjectInfo | undefined}
        />
      ) : (
        <Tabs
          selectedKey={overviewTab}
          onSelectionChange={(k) => setOverviewTab(k === "sector" ? "sector" : "overview")}
          aria-label={t("page.heading")}
        >
          <Tabs.ListContainer className="w-fit max-w-full">
            <Tabs.List aria-label={t("page.heading")}>
              <Tabs.Tab id="overview" className="whitespace-nowrap">{t("page.tabOverview")}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="sector" className="whitespace-nowrap">{t("page.tabSector")}<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="overview" className="pt-4"><OverviewView /></Tabs.Panel>
          <Tabs.Panel id="sector" className="pt-4"><SectorBudgetView userRole={userRole} userSectors={userSectors} /></Tabs.Panel>
        </Tabs>
      )}
    </div>
  );
}
