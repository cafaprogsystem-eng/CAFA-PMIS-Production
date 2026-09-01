import { useState, useEffect, useMemo } from "react";
import { useLocationContext } from "@/contexts/location-context";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyTitle, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  AlertTriangle, DollarSign, TrendingUp, PiggyBank, Lock,
  AlertCircle, Download, Filter, X, Info,
  Activity, FolderOpen, ChevronRight, FileText, FileSpreadsheet,
} from "lucide-react";
import { MAIN_SECTORS, getSectorMeta } from "@/lib/sectors";
import type { SectorBudgetCurrencyEntry } from "@workspace/api-client-react";
import { formatCurrency, formatPercent, hasPerm } from "@/lib/format";
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
import { ProgressBar } from "./projects";
import { Button } from "@/components/ui/button";
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

function alertColor(level: string) {
  if (level === "critical" || level === "high") return "border-destructive bg-destructive/10 text-destructive";
  if (level === "medium" || level === "warning") return "border-warning bg-warning/10 text-warning";
  return "border-success bg-success/10 text-success";
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

function BudgetLineRow({ line, depth = 0, currency }: { line: BudgetLine; depth?: number; currency?: string }) {
  const children = (line.children as typeof line[] | undefined) || [];
  const burnRate = projectBurnRate(line.planned, line.burnRatePct);
  return (
    <>
      <TableRow>
        <TableCell style={{ paddingInlineStart: `${depth * 24 + 16}px` }} className="font-medium">
          <span className="text-xs text-muted-foreground me-2">{formatBudgetLineLevel(line.level)}</span>
          {line.label}
        </TableCell>
        <TableCell className="text-end tabular-nums"><bdi dir="ltr">{formatProjectBudgetMoney(line.planned, currency)}</bdi></TableCell>
        <TableCell className="text-end tabular-nums"><bdi dir="ltr">{formatProjectBudgetMoney(line.spent, currency)}</bdi></TableCell>
        <TableCell className="text-end tabular-nums"><bdi dir="ltr">{formatProjectBudgetMoney(line.remaining, currency)}</bdi></TableCell>
        <TableCell className="w-[140px]">
          <div className="flex items-center gap-2">
            {burnRate == null ? <span className="text-xs w-10 text-end text-muted-foreground">—</span> : <>
              <ProgressBar value={burnRate} max={100} color={burnRate > 90 ? "bg-destructive" : "bg-primary"} />
              <span className={burnRate > 90 ? "text-xs w-10 text-end text-destructive font-medium" : "text-xs w-10 text-end"}><bdi dir="ltr">{formatPercent(burnRate)}</bdi></span>
            </>}
          </div>
        </TableCell>
      </TableRow>
      {children.map((c) => <BudgetLineRow key={c.id} line={c} depth={depth + 1} currency={currency} />)}
    </>
  );
}

interface ProjectInfo { code: string; title: string; donor?: string; sector?: string; currency?: string }

function ProjectBudgetView({ projectId, projectInfo }: { projectId: number; projectInfo?: ProjectInfo }) {
  const { t } = useTranslation("budget");
  const { data, isLoading } = useGetProjectBudget(projectId);
  const { data: stateAllocations } = useListProjectStateAllocations(projectId);

  if (isLoading || !data) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
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

  return (
    <div className="space-y-6">
      {/* Export toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground tracking-tight">
          {projectInfo?.code ?? t("project.fallbackName", { id: projectId })}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportProjectCsv(pdfData)}>
            <Download className="h-3.5 w-3.5" /> {t("export.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportBudgetExcel({
            projectCode: pdfData.projectCode, projectTitle: pdfData.projectTitle,
            donor: pdfData.donor, sector: pdfData.sector, currency: pdfData.currency, data: pdfData,
            stateAllocations,
          })}>
            <FileSpreadsheet className="h-3.5 w-3.5 text-success" /> {t("export.exportExcel")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printBudgetPdf(pdfData)}>
            <FileText className="h-3.5 w-3.5 text-destructive" /> {t("export.exportPdf")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* BUD-006: always format in the project's ISO currency — no USD fallback */}
        <StatCard icon={DollarSign} iconBg="bg-slate-500" label={t("stats.total")} value={fmtMoney(data.total, projectInfo?.currency)} />
        <StatCard icon={TrendingUp} iconBg="bg-blue-500" label={t("stats.spent")} value={fmtMoney(data.spent, projectInfo?.currency)} />
        <StatCard icon={PiggyBank} iconBg="bg-emerald-500" label={t("stats.remaining")} value={fmtMoney(data.remaining, projectInfo?.currency)} />
        <StatCard
          icon={Activity}
          iconBg={burnRate != null && burnRate > 90 ? "bg-destructive" : "bg-slate-500"}
          label={t("stats.burnRate")}
          value={<bdi dir="ltr">{formatPercent(burnRate)}</bdi>}
          sub={burnRate != null
            ? <ProgressBar value={burnRate} max={100} color={burnRate > 90 ? "bg-destructive" : "bg-secondary"} />
            : undefined}
          alert={burnRate != null && burnRate > 90}
        />
      </div>

      {data.alerts.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("project.alerts")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-2 border-l-4 rounded p-3 ${alertColor(a.level)}`}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium uppercase text-xs">{a.level}</div>
                  <div>{a.message}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("project.monthlyChart")}</CardTitle>
          <CardDescription>{t("project.monthlyChartDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              {/* BUD-006: currency-aware axis/tooltip — no hardcoded "$" */}
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(v) => displayCurrency ? `${displayCurrency} ${(v / 1000).toFixed(0)}k` : "—"}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                formatter={(v: number) => fmtMoney(v, projectInfo?.currency)}
              />
              <Legend />
              <Line type="monotone" dataKey="planned" stroke="hsl(var(--primary))" strokeWidth={2} />
              <Line type="monotone" dataKey="actual" stroke="hsl(var(--secondary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("project.budgetBreakdown")}</CardTitle><CardDescription>{t("project.budgetBreakdownDesc")}</CardDescription></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto" role="region" aria-label={t("project.lineItemsRegion")}>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("project.lineItem")}</TableHead>
                <TableHead className="text-end">{t("project.planned")}</TableHead>
                <TableHead className="text-end">{t("project.spent")}</TableHead>
                <TableHead className="text-end">{t("project.remaining")}</TableHead>
                <TableHead>{t("project.burnRate")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data.lines.map(l => <BudgetLineRow key={l.id} line={l} currency={projectInfo?.currency} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
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
        <Badge variant="rejected" className="gap-1 text-xs">
          <AlertCircle className="h-3 w-3" />
          {entry.overspentProjectCount === 1 ? t("sector.overspentCountOne") : t("sector.overspentCountN", { count: entry.overspentProjectCount })}
        </Badge>
      )}
      {entry.overallocatedProjectCount > 0 && (
        <Badge variant="returned" className="gap-1 text-xs">
          <AlertTriangle className="h-3 w-3" />
          {entry.overallocatedProjectCount === 1 ? t("sector.overallocatedCountOne") : t("sector.overallocatedCountN", { count: entry.overallocatedProjectCount })}
        </Badge>
      )}
    </div>
  );
}

function BudgetProgressBar({ value, isOver }: { value: number; isOver: boolean }) {
  const capped = Math.min(value, 100);
  const color = isOver ? "bg-destructive" : value >= 75 ? "bg-warning" : "bg-success";
  return (
    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${capped}%` }} />
    </div>
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
  const { t } = useTranslation("budget");
  const { data: states } = useListStates();
  const donors = useMemo(() => {
    const s = new Set<string>();
    projects?.forEach(p => { if (p.donor) s.add(p.donor); });
    return Array.from(s).sort();
  }, [projects]);

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/60 bg-muted/30 p-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center">
      <div className="hidden items-center gap-2 xl:flex">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <Separator orientation="vertical" className="h-4 mx-0.5" />
      </div>

      <Select value={filters.donor || "all"} onValueChange={v => onChange({ ...filters, donor: v === "all" ? "" : v })}>
        <SelectTrigger className="h-8 w-full min-w-0 text-xs sm:min-w-[9rem] xl:w-auto" aria-label={t("filters.donor")}>
          <SelectValue placeholder={t("filters.allDonors")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allDonors")}</SelectItem>
          {donors.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.stateId || "all"} onValueChange={v => onChange({ ...filters, stateId: v === "all" ? "" : v })}>
        <SelectTrigger className="h-8 w-full min-w-0 text-xs sm:min-w-[9rem] xl:w-auto" aria-label={t("filters.state")}>
          <SelectValue placeholder={t("filters.allStates")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allStates")}</SelectItem>
          {states?.map(s => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.sector || "all"} onValueChange={v => onChange({ ...filters, sector: v === "all" ? "" : v })}>
        <SelectTrigger className="h-8 w-full min-w-0 text-xs sm:min-w-[9rem] xl:w-auto" aria-label={t("filters.sector")}>
          <SelectValue placeholder={t("filters.allSectors")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allSectors")}</SelectItem>
          {MAIN_SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.status || "all"} onValueChange={v => onChange({ ...filters, status: v === "all" ? "" : v })}>
        <SelectTrigger className="h-8 w-full min-w-0 text-xs sm:min-w-[10rem] xl:w-auto" aria-label={t("filters.projectStatus")}>
          <SelectValue placeholder={t("filters.allStatuses")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
          {PROJECT_STATUSES.map(s => <SelectItem key={s} value={s}>{t(`statusLabels.${s}`)}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Project Period — labelled group kept as a single visual unit */}
      <div
        className="grid h-8 grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-md border border-border/60 bg-background px-2 sm:col-span-2 xl:min-w-[18rem]"
        title={t("filters.periodHelp")}
      >
        <span className="text-xs text-muted-foreground whitespace-nowrap">{t("filters.period")}</span>
        <Input
          type="date" className="h-6 min-w-0 w-full border-0 p-0 text-xs shadow-none focus-visible:ring-0"
          value={filters.dateFrom}
          onChange={e => onChange({ ...filters, dateFrom: e.target.value })}
          aria-label={t("filters.from")}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="date" className="h-6 min-w-0 w-full border-0 p-0 text-xs shadow-none focus-visible:ring-0"
          value={filters.dateTo}
          onChange={e => onChange({ ...filters, dateTo: e.target.value })}
          aria-label={t("filters.to")}
        />
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 w-full px-2 text-xs text-muted-foreground hover:text-foreground sm:w-auto xl:ms-auto" onClick={() => onChange(EMPTY_FILTERS)} aria-label={t("filters.clear")}>
          <X className="h-3 w-3" aria-hidden="true" /> {t("filters.clear")}
        </Button>
      )}
    </div>
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
  projects?: Array<{ id: number; code?: string; title: string; sector?: string; budgetTotal?: number; donor?: string; status?: string }>;
}) {
  const { t } = useTranslation("budget");
  const activeCurrEntry = useMemo<SectorBudgetCurrencyEntry | null>(() => {
    if (!entry || !entry.budgetByCurrency.length) return null;
    if (selectedCurrency === "all" || !entry.currencyMixed) return null;
    return entry.budgetByCurrency.find(c => c.currency === selectedCurrency) ?? null;
  }, [entry, selectedCurrency]);
  if (!entry) return null;
  const meta = getSectorMeta(entry.sector);
  const Icon = meta.icon;
  const sectorProjects = projects?.filter(p => p.sector === entry.sector) ?? [];
  const showMulti = entry.currencyMixed && selectedCurrency === "all";

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

  const renderCurrencyCard = (c: SectorBudgetCurrencyEntry) => (
    <div key={c.currency} className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium text-sm">{c.currency}</span>
        <BudgetFactualFlags entry={c} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm mb-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("sector.totalBudget")}</p>
          <p className="font-bold">{fmtMoney(c.budgetTotal, c.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("sector.activityPlanned")}</p>
          <p className="font-medium">{fmtMoney(c.activityPlanned, c.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("sector.unallocatedBudget")}</p>
          <p className="font-medium">{fmtMoney(c.unallocated, c.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("sector.spent")}</p>
          <p className="font-medium">{fmtMoney(c.activitySpent, c.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("sector.remainingBudget")}</p>
          <p className={`font-medium ${(c.remaining ?? 0) < 0 ? "text-destructive" : ""}`}>{fmtMoney(c.remaining, c.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("sector.utilisation")}</p>
          <p className="font-medium">{c.utilisationPct == null ? "—" : <bdi dir="ltr">{formatPercent(c.utilisationPct)}</bdi>}</p>
        </div>
      </div>
      {c.utilisationPct != null && (
        <BudgetProgressBar value={c.utilisationPct} isOver={c.utilisationPct > 100} />
      )}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className={`p-2.5 rounded-lg ${meta.bg} ${meta.border} border`}>
              <Icon className={`h-5 w-5 ${meta.color}`} />
            </div>
            <div>
              <SheetTitle className="text-xl">{entry.sector}</SheetTitle>
              <SheetDescription>{t("sector.detailDesc")}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">{t("sector.projects")}</p>
                <p className="text-lg font-bold">{entry.projectCount}</p>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
              <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">{t("sector.incompleteActivities")}</p>
                <p className="text-lg font-bold">
                  {entry.totalActivityCount === null ? "—" : (entry.incompleteActivityCount ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">{activityLabel}</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">{t("sector.financialSummary")}</h3>
            <div className="space-y-3">
              {showMulti || !activeCurrEntry
                ? entry.budgetByCurrency.map(renderCurrencyCard)
                : renderCurrencyCard(activeCurrEntry)}
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5 rounded-lg bg-muted/30 border px-3 py-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
            {t("sector.sectorAttribution")}
          </p>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{t("sector.projectsInSector")}</h3>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={exportCsv}>
                  <Download className="h-3 w-3" /> {t("export.exportCsv")}
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => exportSectorExcel(entry, sectorProjects)}>
                  <FileSpreadsheet className="h-3 w-3 text-success" /> {t("export.exportExcel")}
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => printSectorPdf(entry, sectorProjects)}>
                  <FileText className="h-3 w-3 text-destructive" /> {t("export.exportPdf")}
                </Button>
              </div>
            </div>
            {sectorProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("sector.noProjectData")}</p>
            ) : (
              <div className="rounded-lg border overflow-hidden overflow-x-auto" role="region" aria-label={t("sector.projectsRegion")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("sector.tableProject")}</TableHead>
                      <TableHead>{t("sector.tableDonor")}</TableHead>
                      <TableHead>{t("sector.tableStatus")}</TableHead>
                      <TableHead className="text-end">{t("sector.tableBudget")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sectorProjects.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{p.title}</div>
                          {p.code && <div className="text-xs text-muted-foreground"><bdi dir="ltr">{p.code}</bdi></div>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.donor ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">{p.status?.replace(/_/g, " ") ?? "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-end font-medium text-sm">
                          <bdi dir="ltr">{p.budgetTotal != null ? p.budgetTotal.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</bdi>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
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
    ? "border-destructive/30"
    : hasOverallocated
    ? "border-amber-300/50"
    : "border-border";

  return (
    <button
      type="button"
      onClick={() => onClick(entry)}
      className={`group text-start w-full h-full flex flex-col rounded-xl border bg-card px-4 py-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary/20 ${borderClass}`}
    >
      {/* ── Icon + badges row ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${meta.bg} ${meta.border} border shrink-0`}>
          <Icon className={`h-4 w-4 ${meta.color}`} />
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {hasOverspent && (
            <Badge variant="rejected" className="gap-0.5 text-[10px] px-1.5 py-0">
              <AlertCircle className="h-2.5 w-2.5" /> {t("sector.overspent")}
            </Badge>
          )}
          {hasOverallocated && (
            <Badge variant="returned" className="gap-0.5 text-[10px] px-1.5 py-0">
              <AlertTriangle className="h-2.5 w-2.5" /> {t("sector.overallocated")}
            </Badge>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity rtl:rotate-180" />
        </div>
      </div>

      {/* ── Stable title + metadata block — min-height keeps financial metrics aligned ── */}
      <div className="min-h-[3.5rem] mb-3">
        <h3 className="font-semibold text-sm text-foreground leading-snug mb-1">{entry.sector}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-0.5 tabular-nums">
            <FolderOpen className="h-3 w-3 shrink-0" />{entry.projectCount} {entry.projectCount === 1 ? t("sector.oneProject") : t("sector.nProjects")}
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <Activity className="h-3 w-3 shrink-0" />{activityLabel}
          </span>
        </div>
      </div>

      {/* ── Financial content — grows to fill remaining card height ───── */}
      <div className="flex-1 flex flex-col">
        {showMulti ? (
          <div className="space-y-1.5 pt-2 border-t border-dashed flex-1">
            <p className="text-xs text-muted-foreground mb-1">{t("sector.totalBudgetByCurrency")}</p>
            {entry.budgetByCurrency.map(c => (
              <div key={c.currency} className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{c.currency}</span>
                <span className="text-sm font-medium tabular-nums">{fmtMoney(c.budgetTotal, c.currency)}</span>
              </div>
            ))}
          </div>
        ) : activeCurrEntry ? (
          <div className="flex flex-col gap-3 flex-1">
            {/* Total Budget — primary hierarchy */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">{t("sector.totalBudget")}</span>
                <span className="text-sm font-semibold tabular-nums">{fmtMoney(activeCurrEntry.budgetTotal, activeCurrEntry.currency)}</span>
              </div>
              {/* Progress track */}
              <BudgetProgressBar
                value={activeCurrEntry.utilisationPct ?? 0}
                isOver={(activeCurrEntry.utilisationPct ?? 0) > 100}
              />
              {/* Spent + utilisation */}
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("sector.spent")}: <span className="text-foreground/80 font-medium"><bdi dir="ltr">{fmtMoney(activeCurrEntry.activitySpent, activeCurrEntry.currency)}</bdi></span>
                </span>
                <span className={`text-xs font-medium tabular-nums ${(activeCurrEntry.utilisationPct ?? 0) > 100 ? "text-destructive" : "text-muted-foreground"}`}>
                  {activeCurrEntry.utilisationPct == null ? "—" : <bdi dir="ltr">{formatPercent(activeCurrEntry.utilisationPct)}</bdi>}
                </span>
              </div>
            </div>

            {/* Secondary financial metrics — one coherent section */}
            <div className="pt-2 border-t border-dashed mt-auto">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{t("sector.activityPlanned")}</p>
                  <p className="text-xs font-medium tabular-nums">{fmtMoney(activeCurrEntry.activityPlanned, activeCurrEntry.currency)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{t("sector.remaining")}</p>
                  <p className={`text-xs font-medium tabular-nums ${(activeCurrEntry.remaining ?? 0) < 0 ? "text-destructive" : ""}`}>
                    {fmtMoney(activeCurrEntry.remaining, activeCurrEntry.currency)}
                  </p>
                </div>
              </div>
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{t("sector.unallocated")}</p>
                <p className={`text-xs font-medium tabular-nums ${(activeCurrEntry.unallocated ?? 0) < 0 ? "text-destructive" : ""}`}>
                  {fmtMoney(activeCurrEntry.unallocated, activeCurrEntry.currency)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground pt-2 border-t border-dashed">{t("sector.noFinancialData")}</p>
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
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground/80">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
        <span>
          {t("sector.spo.attribution")}
          {isSpoRole && (
            <> &nbsp;·&nbsp; {t("sector.spo.scopeNote")}</>
          )}
        </span>
      </div>

      {unresolvedSectorProjects > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-medium">
              {unresolvedSectorProjects === 1
                ? t("sector.unresolvedOne")
                : t("sector.unresolvedN", { count: unresolvedSectorProjects })}
            </span>
            {" — "}
            <span>
              {Object.entries(unresolvedBudgetByCurrency)
                .map(([cur, amt]) => `${cur} ${amt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)
                .join(", ")}{" "}
              {t("sector.unresolvedBudget")}.
            </span>
          </div>
        </div>
      )}

      {/* Currency selector — only shown when data is available */}
      {availableCurrencies.length > 1 && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span className="text-xs text-muted-foreground">{t("filters.currency")}</span>
          <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
            <SelectTrigger className="h-8 min-w-[10rem] flex-1 text-sm sm:w-auto sm:flex-none" aria-label={t("filters.currency")}>
              <SelectValue placeholder={t("filters.allCurrencies")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allCurrencies")}</SelectItem>
              {availableCurrencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("sector.loadError")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("sector.loadErrorDesc")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void refetch(); }}>{t("overview.tryAgain")}</Button>
        </div>
      ) : !visibleSectors?.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Filter className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium text-muted-foreground">{t("sector.noDataForSector")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("sector.noDataDesc")}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {visibleSectors.length !== 1 ? t("sector.sectorsWithDataPlural", { count: visibleSectors.length }) : t("sector.sectorsWithData", { count: visibleSectors.length })}
            </p>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={exportAllCsv}>
              <Download className="h-3.5 w-3.5" /> {t("export.exportAll")}
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
    <div className="space-y-0.5">
      {budgetByCurrency.map(b => (
        <div key={b.currency} className="text-sm font-semibold leading-snug">
          <bdi dir="ltr">{fmtMoney(b[field], b.currency)}</bdi>
        </div>
      ))}
    </div>
  );

  const multiUtil = () => (
    <div className="space-y-0.5">
      {budgetByCurrency.map(b => (
        <div key={b.currency} className="text-sm font-semibold leading-snug">
          <span className="text-xs text-muted-foreground me-1"><bdi dir="ltr">{b.currency}</bdi></span>
          <bdi dir="ltr">{formatPercent(b.utilisationRate)}</bdi>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Scope is contextual; the Donor Portfolio registry owns the shared currency control. */}
      <div className="flex flex-wrap items-center gap-2">
        {scopeLabel && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("overview.scope")}:</span>
            <span className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 font-medium text-foreground">
              {scopeLabel}
            </span>
          </div>
        )}
      </div>

      {/* Mixed-currency notice */}
      {showMultiCurrency && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-info" />
          {t("overview.mixedCurrencyNotice")}
        </div>
      )}

      {sError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground" role="alert">
          <span>{t("overview.summaryLoadError")}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { void refetchSummary(); }}>{t("overview.tryAgain")}</Button>
        </div>
      )}

      {/* KPI cards — compact enterprise density */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={DollarSign} iconBg="bg-slate-500" label={t("totalBudget")}
          className="p-4 min-h-[100px]"
          value={sLoading ? <Skeleton className="h-5 w-28" />
            : sError ? "—"
            : showMultiCurrency ? multiValue("totalBudget")
            : fmtMoney(kpiData?.totalBudget, kpiData?.currency)} />
        <StatCard icon={TrendingUp} iconBg="bg-blue-500" label={t("totalSpent")}
          className="p-4 min-h-[100px]"
          value={sLoading ? <Skeleton className="h-5 w-28" />
            : sError ? "—"
            : showMultiCurrency ? multiValue("totalSpent")
            : fmtMoney(kpiData?.totalSpent, kpiData?.currency)} />
        <StatCard icon={PiggyBank} iconBg="bg-emerald-500" label={t("remaining")}
          className="p-4 min-h-[100px]"
          value={sLoading ? <Skeleton className="h-5 w-28" />
            : sError ? "—"
            : showMultiCurrency ? multiValue("budgetRemaining")
            : fmtMoney(kpiData?.budgetRemaining, kpiData?.currency)} />
        <StatCard
          icon={Activity}
          iconBg="bg-slate-500"
          label={t("sector.budgetUtilisation")}
          className="p-4 min-h-[100px]"
          value={sLoading ? <Skeleton className="h-5 w-16" />
            : sError ? "—"
            : showMultiCurrency ? multiUtil()
            : <bdi dir="ltr">{formatPercent(kpiData?.utilisationRate)}</bdi>}
          sub={!sLoading && !showMultiCurrency && kpiData?.utilisationRate != null
            ? (
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-border overflow-hidden">
                <div
                  className={`h-1.5 rounded-full ${(kpiData.utilisationRate ?? 0) > 90 ? "bg-destructive" : "bg-secondary"}`}
                  style={{ width: `${Math.min(100, kpiData.utilisationRate ?? 0)}%` }}
                />
              </div>
            ) : undefined}
        />
      </div>

      {/* Donor Portfolio */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t("donor.portfolio")}</CardTitle>
          <CardDescription>{t("donor.portfolioDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DonorPortfolioTable
            data={allDonors}
            isLoading={dLoading}
            isError={dError}
            onRetry={() => { void refetchDonors(); }}
            activeCurrency={selectedCurrency}
            onActiveCurrencyChange={setSelectedCurrency}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t("dashboard:budgetWorkspace.projectPerformanceTitle")}</CardTitle>
          <CardDescription>{t("dashboard:budgetWorkspace.projectPerformanceDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ProjectBudgetPerformanceTable
            data={projectBudgetPerformance}
            isLoading={pLoading}
            isError={pError}
            onRetry={() => { void refetchProjectBudgetPerformance(); }}
            role={role ?? ""}
            spoStateId={(me?.user as unknown as Record<string, unknown>)?.stateId}
          />
        </CardContent>
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
      <Empty>
        <EmptyHeader>
          <Lock className="h-10 w-10 text-muted-foreground" />
          <EmptyTitle>{t("page.accessRestricted")}</EmptyTitle>
          <EmptyDescription>{t("page.accessRestrictedDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">{t("page.heading")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("page.description")}</p>
        </div>
        {/* All Projects selector — hidden when Sector Budgets tab is active (inert on that tab) */}
        {overviewTab !== "sector" && (
          <div className="w-full sm:w-72">
            <Select value={selectedProject || "all"} onValueChange={(v) => setSelectedProject(v === "all" ? "" : v)}>
              <SelectTrigger aria-label={t("page.selectProject")}><SelectValue placeholder={t("page.selectProject")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("page.allProjects")}</SelectItem>
                {projects?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isViewOnly && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{t("page.viewOnly")}</strong> — {t("page.viewOnlyDesc")}
          </span>
        </div>
      )}
      {isSectorRestricted && (
        <div className="flex items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-info" />
          <span>
            <strong>{t("page.sectorRestricted")}</strong> — {t("page.sectorRestrictedDesc")}
            {userSectors && userSectors.length > 0 && (
              <> ({userSectors.map(s => <Badge key={s} variant="secondary" className="ms-1 text-xs">{s}</Badge>)})</>
            )} {t("page.sectorRestrictedOnly")}
          </span>
        </div>
      )}

      {projectIdNum ? (
        <ProjectBudgetView
          projectId={projectIdNum}
          projectInfo={projects?.find(p => p.id === projectIdNum) as ProjectInfo | undefined}
        />
      ) : (
        <div className="space-y-4">
          <Tabs value={overviewTab} onValueChange={v => setOverviewTab(v as typeof overviewTab)}>
            <TabsList>
              <TabsTrigger value="overview">{t("page.tabOverview")}</TabsTrigger>
              <TabsTrigger value="sector">{t("page.tabSector")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {overviewTab === "overview" ? (
            <OverviewView />
          ) : (
            <SectorBudgetView userRole={userRole} userSectors={userSectors} />
          )}
        </div>
      )}
    </div>
  );
}
