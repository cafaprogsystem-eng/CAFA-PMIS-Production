import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const enabled = Boolean(baseURL && process.env.E2E_HQ_SNAPSHOT_MOCKED === "true");

test.skip(
  !enabled,
  "Set E2E_BASE_URL and E2E_HQ_SNAPSHOT_MOCKED=true to run the isolated HQ snapshot browser regression.",
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

const protectedMarker = 424242;
const authorisedSnapshot = {
  snapshot: {
    activeProjects: protectedMarker,
    activeStates: 2,
    activeLocalities: 4,
    activitiesImplemented: 8,
    beneficiariesReached: 1234,
    indicatorProgressPct: 76,
    delayedActivities: 1,
    openRisks: 2,
    pendingApprovals: 0,
  },
  stateSummaries: [],
  projectSummaries: [],
  beneficiaryBreakdown: { men: 0, women: 0, boys: 0, girls: 0, total: 0 },
  beneficiariesByState: [],
  beneficiariesByProject: [],
  beneficiariesByDonor: [],
  indicators: [],
};

function tcAuth(sector: string): AuthState {
  return {
    user: {
      id: 87001,
      name: "Isolated HQ Snapshot TC",
      role: "technical_coordinator",
      stateId: null,
      sector,
      status: "active",
    },
    permissions: ["reports.create", "reports.view"],
  };
}

async function installApiFixture(page: Page, auth: { current: AuthState }): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(auth.current) });
      return;
    }
    if (url.pathname === "/api/dashboard/sector-snapshot") {
      const sector = url.searchParams.get("sector");
      const authorised =
        auth.current.user.role !== "state_program_officer" &&
        auth.current.user.role !== "state_office_manager" &&
        (auth.current.user.role !== "technical_coordinator" || sector === auth.current.user.sector);
      if (!authorised) {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "sector_forbidden" }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authorisedSnapshot) });
      return;
    }
    if (url.pathname === "/api/reports") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }),
      });
      return;
    }
    if (url.pathname === "/api/states") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (url.pathname === "/api/projects" || url.pathname === "/api/risks") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (url.pathname === "/api/reports/authors") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authors: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openAuthorisedHqForm(page: Page): Promise<void> {
  await page.goto("/reports/hq-sector");
  const createButton = page.getByRole("button", { name: /New Report/i }).first();
  await expect(createButton).toBeVisible();
  await createButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Health", exact: true }).click();
  await page.getByRole("tab", { name: /^Progress$/i }).click();
  await expect(page.getByText(String(protectedMarker))).toBeVisible();
}

test.describe("HQ snapshot browser authorization boundary", () => {
  test("removes a former authorized snapshot after realtime scope refresh", async ({ page }) => {
    const auth = { current: tcAuth("Health") };
    await installApiFixture(page, auth);
    const snapshotRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/dashboard/sector-snapshot")) snapshotRequests.push(request.url());
    });

    await openAuthorisedHqForm(page);
    expect(snapshotRequests).toHaveLength(1);

    auth.current = tcAuth("WASH");
    const identityRefresh = page.waitForResponse(
      (response) => response.url().includes("/api/me") && response.status() === 200,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("cafa:authorization-changed")));
    await identityRefresh;

    await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
    // The scope guard prevents a stale query read and prevents a new
    // out-of-scope snapshot request. The original payload is gone from DOM.
    expect(snapshotRequests).toHaveLength(1);
  });

  test("fails closed immediately when identity refresh is unavailable", async ({ page }) => {
    const auth = { current: tcAuth("Health") };
    await installApiFixture(page, auth);
    await openAuthorisedHqForm(page);

    await page.route("**/api/me", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "temporarily_unavailable" }),
    }));
    const unavailable = page.waitForResponse(
      (response) => response.url().includes("/api/me") && response.status() === 503,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("cafa:authorization-changed")));
    await unavailable;

    await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Refreshing access");
  });

  test("denies direct, copied, tampered, refresh, and history paths without payload", async ({ page }) => {
    const auth = { current: tcAuth("WASH") };
    await installApiFixture(page, auth);
    await page.goto("/reports/hq-sector?sector=Health");

    const denied = await page.evaluate(async () => {
      const response = await fetch("/api/dashboard/sector-snapshot?sector=Health", { credentials: "include" });
      return { status: response.status, body: await response.text() };
    });
    expect(denied.status).toBe(403);
    expect(denied.body).not.toContain(String(protectedMarker));

    for (const path of [
      "/reports/hq-sector?sector=Health&stateId=999",
      "/reports/hq-sector",
    ]) {
      await page.goto(path);
      await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
    }

    await page.goto("/dashboard");
    await page.goBack();
    await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
    await page.goForward();
    await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
  });

  for (const role of ["state_program_officer", "state_office_manager"]) {
    test(`${role} remains denied even when a copied URL names a sector`, async ({ page }) => {
      const auth = { current: { ...tcAuth("Health"), user: { ...tcAuth("Health").user, role } } };
      await installApiFixture(page, auth);
      await page.goto("/reports/hq-sector?sector=Health");
      const denied = await page.evaluate(async () => {
        const response = await fetch("/api/dashboard/sector-snapshot?sector=Health", { credentials: "include" });
        return { status: response.status, body: await response.text() };
      });
      expect(denied.status).toBe(403);
      expect(denied.body).not.toContain(String(protectedMarker));
      await expect(page.getByText(String(protectedMarker))).toHaveCount(0);
    });
  }

  for (const role of ["viewer", "program_manager", "super_admin"]) {
    test(`${role} retains organization-wide snapshot access`, async ({ page }) => {
      const auth = {
        current: {
          ...tcAuth("Health"),
          user: { ...tcAuth("Health").user, role, sector: null },
          permissions: role === "super_admin" ? ["*"] : ["reports.view"],
        },
      };
      await installApiFixture(page, auth);
      await page.goto("/reports/hq-sector");
      const allowed = await page.evaluate(async () => {
        const response = await fetch("/api/dashboard/sector-snapshot?sector=Health", { credentials: "include" });
        return { status: response.status, body: await response.text() };
      });
      expect(allowed.status).toBe(200);
      expect(allowed.body).toContain(String(protectedMarker));
    });
  }
});