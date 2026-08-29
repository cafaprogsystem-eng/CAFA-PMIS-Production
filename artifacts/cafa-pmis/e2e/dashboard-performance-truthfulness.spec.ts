import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const enabled = Boolean(baseURL && process.env.E2E_DASHBOARD_TRUTHFULNESS_MOCKED === "true");

test.skip(
  !enabled,
  "Set E2E_BASE_URL and E2E_DASHBOARD_TRUTHFULNESS_MOCKED=true to run the isolated Dashboard truthfulness regression.",
);

type AuthState = {
  user: {
    id: number;
    name: string;
    role: string;
    stateId: number | null;
    sector: string | null;
    status: string;
  };
  permissions: string[];
};

const managerAuth: AuthState = {
  user: {
    id: 87801,
    name: "Dashboard Truthfulness Manager",
    role: "program_manager",
    stateId: null,
    sector: null,
    status: "active",
  },
  permissions: ["reports.view"],
};

const stateManagerAuth: AuthState = {
  user: {
    id: 87802,
    name: "Dashboard Truthfulness State Manager",
    role: "state_office_manager",
    stateId: 7,
    sector: null,
    status: "active",
  },
  permissions: ["reports.view"],
};

const summary = {
  totalProjects: 3,
  activeProjects: 2,
  statesCount: 2,
  totalBeneficiaries: 1250,
  highRiskStates: 0,
  openRisks: 1,
  criticalRisks: 0,
  reportsSubmitted: 2,
  reportsPending: 1,
  activitiesPlanned: 2,
  activitiesCompleted: 1,
  pendingApprovalsCount: 0,
  delayedActivities: 0,
  byStatus: [{ status: "active", count: 2 }, { status: "draft", count: 1 }],
  monthlyAchievement: [],
};

const managerStates = [
  {
    stateId: 1,
    stateName: "Alpha State",
    stateNameAr: null,
    totalProjects: 3,
    activeProjects: 2,
    beneficiaries: 1250,
    progressPct: 75,
    budgetUtilizationPct: null,
    activityCompletionPct: null,
    reportingCompliancePct: 125,
    riskLevel: "low",
    openRisks: 1,
    criticalRisks: 0,
    critOnlyRisks: 0,
    highOnlyRisks: 0,
    reportsSubmitted: 2,
    reportsPending: 1,
  },
  {
    stateId: 2,
    stateName: "Beta State",
    stateNameAr: null,
    totalProjects: 0,
    activeProjects: 0,
    beneficiaries: 0,
    progressPct: 0,
    budgetUtilizationPct: null,
    activityCompletionPct: null,
    reportingCompliancePct: null,
    riskLevel: "low",
    openRisks: 0,
    criticalRisks: 0,
    critOnlyRisks: 0,
    highOnlyRisks: 0,
    reportsSubmitted: 0,
    reportsPending: 0,
  },
];

const stateManagerStates = [{
  ...managerStates[0],
  stateId: 7,
  stateName: "Delta State",
  totalProjects: 1,
  activeProjects: 1,
  reportingCompliancePct: null,
}];

const hierarchy = {
  averageSectorAchievementRate: 150,
  validSectorCount: 1,
  validProjectCount: 1,
  sectors: [
    {
      sector: "Health",
      projectCount: 1,
      validProjectCount: 1,
      insufficientProjectCount: 0,
      sectorAchievementRate: 150,
      projects: [{
        projectId: 101,
        projectCode: "CAFA-OVER-150",
        projectTitle: "Overachievement Evidence Project",
        sector: "Health",
        stateNames: ["Alpha State"],
        validIndicatorCount: 2,
        missingIndicatorCount: 0,
        projectAchievementRate: 150,
      }],
    },
    {
      sector: "WASH",
      projectCount: 1,
      validProjectCount: 0,
      insufficientProjectCount: 1,
      sectorAchievementRate: null,
      projects: [{
        projectId: 102,
        projectCode: "CAFA-NO-EVIDENCE",
        projectTitle: "Unavailable Evidence Project",
        sector: "WASH",
        stateNames: ["Beta State"],
        validIndicatorCount: 0,
        missingIndicatorCount: 1,
        projectAchievementRate: null,
      }],
    },
  ],
};

const reportsSummary = {
  total: 2,
  draft: 0,
  returned: 0,
  awaitingApproval: 1,
  approved: 1,
  awaitingApprovalOver14Days: 0,
  unresolvedLegacyCount: 0,
  byState: [],
  bySector: [],
  byType: [],
};

const beneficiaries = {
  summary: { total: 1250, male: 300, female: 450, boys: 200, girls: 300 },
  byState: [],
  bySector: [],
  byProject: [],
};

const retiredPhrases = [
  "Programme performance score",
  "Organisation-wide score",
  "Overall Score",
  "Weighted across 6 operational dimensions",
  "Excellent ≥80",
  "Good ≥60",
  "Needs Follow-up ≥40",
  "Critical <40",
];

async function installDashboardFixture(page: Page, auth: { current: AuthState }): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(auth.current) });
      return;
    }

    const stateRows = auth.current.user.role === "state_office_manager"
      ? stateManagerStates
      : managerStates;
    const payloads: Record<string, unknown> = {
      "/api/dashboard/summary": summary,
      "/api/dashboard/state-performance": stateRows,
      "/api/dashboard/notifications-summary": { totalUnread: 0, byModule: [], recent: [] },
      "/api/dashboard/sector-performance": [],
      "/api/dashboard/pending-approvals": { projects: [], reports: [] },
      "/api/dashboard/recent-activity": [],
      "/api/dashboard/sector-budget": { sectors: [], totals: [] },
      "/api/dashboard/donor-portfolio": [],
      "/api/dashboard/project-budget-performance": [],
      "/api/dashboard/beneficiaries": beneficiaries,
      "/api/dashboard/agenda": { items: [] },
      "/api/dashboard/reports-summary": reportsSummary,
      "/api/dashboard/attention-projects": [],
      "/api/dashboard/hierarchical-performance": hierarchy,
      "/api/dashboard/late-reports": [],
      "/api/projects": [],
      "/api/states": [],
      "/api/risks": [],
    };
    const body = path in payloads ? payloads[path] : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function expectRetiredScoresAbsent(page: Page): Promise<void> {
  const body = page.locator("body");
  for (const phrase of retiredPhrases) {
    await expect(body).not.toContainText(phrase);
  }
}

test("keeps retired scores absent while factual State and hierarchy data survive navigation and auth changes", async ({ page }) => {
  const auth = { current: managerAuth };
  await installDashboardFixture(page, auth);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expectRetiredScoresAbsent(page);

  await page.getByRole("tab", { name: "Projects & States" }).click();
  const alphaRow = page.locator("tr").filter({ hasText: "Alpha State" });
  await expect(alphaRow).toContainText("125%");
  await expect(alphaRow).toContainText("—");
  await page.getByRole("button", { name: "All Authorised States" }).click();
  await expect(page.locator("tr").filter({ hasText: "Beta State" })).toBeVisible();

  await page.getByRole("tab", { name: "Programme Performance" }).click();
  const healthSector = page.getByRole("button", {
    name: "Expand Health, achievement 150%",
  });
  await expect(healthSector).toBeVisible();
  await healthSector.click();
  await expect(page.getByText("Overachievement Evidence Project").first()).toBeVisible();
  await expect(page.getByText("150%", { exact: true }).first()).toBeVisible();

  const unavailableSector = page.getByRole("button", {
    name: "Expand WASH, achievement Insufficient Data",
  });
  await unavailableSector.click();
  await expect(page.getByText("Unavailable Evidence Project").first()).toBeVisible();
  await expectRetiredScoresAbsent(page);

  await page.goto("/projects");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expectRetiredScoresAbsent(page);

  auth.current = stateManagerAuth;
  const identityRefresh = page.waitForResponse(
    (response) => response.url().includes("/api/me") && response.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("cafa:authorization-changed")));
  await identityRefresh;

  await page.getByRole("tab", { name: "Projects & States" }).click();
  await expect(page.locator("tr").filter({ hasText: "Alpha State" })).toHaveCount(0);
  await expect(page.locator("tr").filter({ hasText: "Delta State" })).toBeVisible();
  await expectRetiredScoresAbsent(page);
});