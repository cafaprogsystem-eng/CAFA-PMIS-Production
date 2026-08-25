import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/node";
import {
  buildProjectBudgetWorkbook,
  buildSectorBudgetWorkbook,
} from "./budget-workbook";

const execFile = promisify(execFileCallback);

async function renderWorkbookXml(sheets: ReturnType<typeof buildProjectBudgetWorkbook>): Promise<string> {
  const output = await writeExcelFile(sheets).toBuffer();
  expect(output.subarray(0, 2).toString()).toBe("PK");

  const directory = await mkdtemp(join(tmpdir(), "cafa-budget-workbook-"));
  const workbookPath = join(directory, "budget.xlsx");
  try {
    await writeFile(workbookPath, output);
    const [{ stdout: workbookXml }, { stdout: sharedStringsXml }] = await Promise.all([
      execFile("unzip", ["-p", workbookPath, "xl/workbook.xml"]),
      execFile("unzip", ["-p", workbookPath, "xl/sharedStrings.xml"]),
    ]);
    return `${workbookXml}\n${sharedStringsXml}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Budget workbook exports", () => {
  it("writes a valid project workbook with the existing sheets, report data, and column widths", async () => {
    const sheets = buildProjectBudgetWorkbook({
      projectCode: "CAFA/PRJ 01",
      projectTitle: "Safe water access",
      donor: "Example Donor",
      sector: "WASH",
      currency: "USD",
      total: 1200,
      spent: 450.25,
      remaining: 749.75,
      burnRatePct: 37.52,
      alerts: [{ level: "warning", message: "Spend review due" }],
      lines: [{
        label: "Water systems",
        planned: 1200,
        spent: 450.25,
        remaining: 749.75,
        burnRatePct: 37.52,
        children: [{
          label: "Pump installation",
          planned: 600,
          spent: 300,
          remaining: 300,
          burnRatePct: 50,
        }],
      }],
    });

    expect(sheets.map((sheet) => sheet.sheet)).toEqual([
      "Summary", "State Allocations", "Activities", "Budget Variance",
    ]);
    expect(sheets.map((sheet) => sheet.columns.map((column) => column.width))).toEqual([
      [25, 20, 20, 20],
      [28, 22, 20, 30],
      [35, 40, 12, 18, 15, 18, 14],
      [40, 12, 18, 15, 18, 15, 14],
    ]);
    expect(sheets[0].data).toContainEqual(["Project Code", "CAFA/PRJ 01"]);
    expect(sheets[2].data).toContainEqual([
      "Water systems", "Pump installation", "Activity", 600, 300, 300, 50,
    ]);

    const xml = await renderWorkbookXml(sheets);
    for (const value of [
      "Summary", "State Allocations", "Activities", "Budget Variance",
      "CAFA/PRJ 01", "Safe water access", "Pump installation", "Spend review due",
    ]) {
      expect(xml).toContain(value);
    }
  });

  it("writes a valid sector workbook with the existing full summary and project report structure", async () => {
    const sheets = buildSectorBudgetWorkbook({
      sector: "Health",
      projectCount: 2,
      totalActivityCount: 5,
      incompleteActivityCount: 1,
      budgetByCurrency: [{
        currency: "SDG",
        projectCount: 2,
        budgetTotal: 999.5,
        activityPlanned: 700,
        activitySpent: 275.25,
        remaining: 724.25,
        unallocated: 299.5,
        utilisationPct: 27.538,
        overallocatedProjectCount: 1,
        overallocatedAmount: 12.5,
        overspentProjectCount: 1,
        overspentAmount: 3.75,
      }],
      projects: [{
        code: "H-001",
        title: "Primary health",
        donor: "Example Donor",
        status: "active_project",
        budgetTotal: 999.5,
      }],
    });

    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Sector Summary", "Projects"]);
    expect(sheets[0].columns).toHaveLength(12);
    expect(sheets[0].columns.every((column) => column.width === 18)).toBe(true);
    expect(sheets[0].data).toContainEqual([
      "SDG", 2, 999.5, 700, 275.25, 724.25, 299.5, 27.538, 1, 12.5, 1, 3.75,
    ]);
    expect(sheets[1].data).toContainEqual([
      "H-001", "Primary health", "Example Donor", "active project", 999.5,
    ]);

    const xml = await renderWorkbookXml(sheets);
    for (const value of [
      "Sector Summary", "Projects", "Primary Sector only", "Overallocated Amount",
      "Primary health", "active project",
    ]) {
      expect(xml).toContain(value);
    }
  });
});