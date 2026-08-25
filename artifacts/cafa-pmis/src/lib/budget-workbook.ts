export type WorkbookCell = string | number;

export interface BudgetWorkbookSheet {
  sheet: string;
  columns: Array<{ width: number }>;
  data: WorkbookCell[][];
}

export interface ProjectBudgetWorkbookInput {
  projectCode: string;
  projectTitle: string;
  donor?: string;
  sector?: string;
  currency: string | null;
  total: number;
  spent: number;
  remaining: number;
  burnRatePct: number;
  lines: Array<{
    label: string;
    planned: number;
    spent: number;
    remaining: number;
    burnRatePct: number;
    children?: Array<{
      label: string;
      planned: number;
      spent: number;
      remaining: number;
      burnRatePct: number;
    }>;
  }>;
  alerts: Array<{ level: string; message: string }>;
}

export interface SectorBudgetWorkbookInput {
  sector: string;
  projectCount: number;
  totalActivityCount?: number | null;
  incompleteActivityCount?: number | null;
  budgetByCurrency: Array<{
    currency: string;
    projectCount: number;
    budgetTotal?: number | null;
    activityPlanned?: number | null;
    activitySpent?: number | null;
    remaining?: number | null;
    unallocated?: number | null;
    utilisationPct?: number | null;
    overallocatedProjectCount: number;
    overallocatedAmount?: number | null;
    overspentProjectCount: number;
    overspentAmount?: number | null;
  }>;
  projects: Array<{
    code?: string;
    title: string;
    donor?: string;
    status?: string;
    budgetTotal?: number;
  }>;
}

function decimal(value: number): number {
  return Number(value.toFixed(2));
}

function projectBurnRate(planned: number, reportedRate: number): number | null {
  return planned > 0 ? reportedRate : null;
}

/**
 * Builds the workbook payload independently from browser download mechanics so
 * its sheet names, values and columns can be regression-tested in Node.
 */
export function buildProjectBudgetWorkbook(input: ProjectBudgetWorkbookInput): BudgetWorkbookSheet[] {
  const fmt = (value: number): WorkbookCell => input.currency ? decimal(value) : "—";
  const rate = (planned: number, reportedRate: number): WorkbookCell =>
    projectBurnRate(planned, reportedRate) ?? "—";
  const currencyLabel = input.currency ? ` (${input.currency})` : " (currency unavailable)";
  const budgetRate = rate(input.total, input.burnRatePct);

  const summary: WorkbookCell[][] = [
    ["CAFA PMIS — Budget Report", "", "", ""],
    ["Generated", new Date().toLocaleDateString("en-GB"), "", ""],
    ["", "", "", ""],
    ["Project Code", input.projectCode],
    ["Project Title", input.projectTitle],
    ["Donor", input.donor ?? ""],
    ["Sector", input.sector ?? ""],
    ["", "", "", ""],
    ["METRIC", "VALUE", "", ""],
    [`Total Budget${currencyLabel}`, fmt(input.total)],
    [`Total Spent${currencyLabel}`, fmt(input.spent)],
    [`Remaining${currencyLabel}`, fmt(input.remaining)],
    ["Budget Utilisation (%)", budgetRate],
    ["", "", "", ""],
    ["ALERTS", "", "", ""],
    ...input.alerts.map((alert) => [alert.level.toUpperCase(), alert.message]),
  ];

  const allocationRows: WorkbookCell[][] = [
    ["State", `Budget Allocation${currencyLabel}`, "Beneficiary Target", "Notes"],
    ["No state allocations recorded yet", "", "", ""],
  ];

  const activityHeaders: WorkbookCell[] = [
    "Output", "Activity", "Level", `Planned${currencyLabel}`, `Spent${currencyLabel}`,
    `Remaining${currencyLabel}`, "Budget Utilisation (%)",
  ];
  const activityRows: WorkbookCell[][] = [];
  for (const line of input.lines) {
    activityRows.push([
      line.label, "", "Output", fmt(line.planned), fmt(line.spent), fmt(line.remaining),
      rate(line.planned, line.burnRatePct),
    ]);
    for (const activity of line.children ?? []) {
      activityRows.push([
        line.label, activity.label, "Activity", fmt(activity.planned), fmt(activity.spent),
        fmt(activity.remaining), rate(activity.planned, activity.burnRatePct),
      ]);
    }
  }
  activityRows.push([
    "TOTAL", "", "", fmt(input.lines.reduce((sum, line) => sum + line.planned, 0)),
    fmt(input.spent), fmt(input.remaining), budgetRate,
  ]);

  const varianceHeaders: WorkbookCell[] = [
    "Line Item", "Level", `Planned${currencyLabel}`, `Spent${currencyLabel}`,
    `Variance${currencyLabel}`, "Variance (%)", "Status",
  ];
  const varianceRows: WorkbookCell[][] = [];
  for (const line of input.lines) {
    const variance = line.planned - line.spent;
    const variancePct: WorkbookCell = line.planned > 0 ? Math.round((variance / line.planned) * 100) : "—";
    const lineBurnRate = projectBurnRate(line.planned, line.burnRatePct);
    varianceRows.push([
      line.label, "Output", fmt(line.planned), fmt(line.spent), fmt(variance), variancePct,
      lineBurnRate != null && lineBurnRate > 100 ? "Overspent" : "",
    ]);
    for (const activity of line.children ?? []) {
      const activityVariance = activity.planned - activity.spent;
      const activityVariancePct: WorkbookCell =
        activity.planned > 0 ? Math.round((activityVariance / activity.planned) * 100) : "—";
      const activityBurnRate = projectBurnRate(activity.planned, activity.burnRatePct);
      varianceRows.push([
        activity.label, "Activity", fmt(activity.planned), fmt(activity.spent), fmt(activityVariance),
        activityVariancePct, activityBurnRate != null && activityBurnRate > 100 ? "Overspent" : "",
      ]);
    }
  }

  return [
    { sheet: "Summary", data: summary, columns: [{ width: 25 }, { width: 20 }, { width: 20 }, { width: 20 }] },
    {
      sheet: "State Allocations",
      data: allocationRows,
      columns: [{ width: 28 }, { width: 22 }, { width: 20 }, { width: 30 }],
    },
    {
      sheet: "Activities",
      data: [activityHeaders, ...activityRows],
      columns: [{ width: 35 }, { width: 40 }, { width: 12 }, { width: 18 }, { width: 15 }, { width: 18 }, { width: 14 }],
    },
    {
      sheet: "Budget Variance",
      data: [varianceHeaders, ...varianceRows],
      columns: [{ width: 40 }, { width: 12 }, { width: 18 }, { width: 15 }, { width: 18 }, { width: 15 }, { width: 14 }],
    },
  ];
}

export function buildSectorBudgetWorkbook(input: SectorBudgetWorkbookInput): BudgetWorkbookSheet[] {
  const fmt = (value: number | null | undefined): WorkbookCell => value == null ? "" : decimal(value);
  const fmtPct = (value: number | null | undefined): WorkbookCell => value == null ? "" : Number(value.toFixed(4));
  const incompleteLabel = input.totalActivityCount === null ? "No activities" : `${input.incompleteActivityCount ?? 0}`;
  const currencyHeaders: WorkbookCell[] = [
    "Currency", "Projects", "Total Budget", "Activity Planned", "Spent", "Remaining Budget",
    "Unallocated Budget", "Utilisation (%)", "Overallocated Projects", "Overallocated Amount",
    "Overspent Projects", "Overspent Amount",
  ];
  const currencyRows: WorkbookCell[][] = input.budgetByCurrency.map((currency) => [
    currency.currency,
    currency.projectCount,
    fmt(currency.budgetTotal),
    fmt(currency.activityPlanned),
    fmt(currency.activitySpent),
    fmt(currency.remaining),
    fmt(currency.unallocated),
    fmtPct(currency.utilisationPct),
    currency.overallocatedProjectCount,
    fmt(currency.overallocatedAmount),
    currency.overspentProjectCount,
    fmt(currency.overspentAmount),
  ]);
  const summaryHeader: WorkbookCell[][] = [
    ["CAFA PMIS — Sector Budget Report"],
    ["Generated", new Date().toLocaleDateString("en-GB")],
    [],
    ["Sector", input.sector],
    ["Projects", input.projectCount],
    ["Incomplete Activities", incompleteLabel],
    ["Attribution", "Primary Sector only — additional sectors receive no automatic allocation"],
    [],
  ];
  const projectHeaders: WorkbookCell[] = ["Project Code", "Project Title", "Donor", "Status", "Budget"];
  const projectRows: WorkbookCell[][] = input.projects.map((project) => [
    project.code ?? "",
    project.title,
    project.donor ?? "",
    (project.status ?? "").replace(/_/g, " "),
    project.budgetTotal != null ? decimal(project.budgetTotal) : "",
  ]);

  return [
    {
      sheet: "Sector Summary",
      data: [...summaryHeader, currencyHeaders, ...currencyRows],
      columns: Array.from({ length: 12 }, () => ({ width: 18 })),
    },
    {
      sheet: "Projects",
      data: [projectHeaders, ...projectRows],
      columns: [{ width: 18 }, { width: 40 }, { width: 25 }, { width: 20 }, { width: 18 }],
    },
  ];
}