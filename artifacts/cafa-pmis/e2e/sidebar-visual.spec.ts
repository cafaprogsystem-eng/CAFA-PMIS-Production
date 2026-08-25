import { expect, test, type Locator, type Page } from "@playwright/test";

const username = process.env.E2E_USERNAME!;
const password = process.env.E2E_PASSWORD!;

const ENGLISH = {
  lang: "en",
  direction: "ltr",
  signOut: "Log out",
  reports: "Reports",
  projectReports: "Project Reports",
  expandReports: "Expand Reports submenu",
  collapseReports: "Collapse Reports submenu",
  expandSidebar: "Expand sidebar",
  collapseSidebar: "Collapse sidebar",
  closeMenu: "Close navigation menu",
};

const ARABIC = {
  lang: "ar",
  direction: "rtl",
  signOut: "تسجيل الخروج",
  reports: "التقارير",
  projectReports: "تقارير المشاريع",
  expandReports: "توسيع قائمة التقارير",
  collapseReports: "طي قائمة التقارير",
  expandSidebar: "توسيع الشريط الجانبي",
  collapseSidebar: "طي الشريط الجانبي",
  closeMenu: "إغلاق قائمة التنقل",
};

type SidebarCopy = typeof ENGLISH;

async function setLanguage(page: Page, language: SidebarCopy): Promise<void> {
  await page.addInitScript((lang) => {
    if (sessionStorage.getItem("cafa.e2e.sidebar.initialized") === "true") return;
    sessionStorage.setItem("cafa.e2e.sidebar.initialized", "true");
    localStorage.setItem("cafa.lang", lang);
    localStorage.removeItem("cafa.sidebarCollapsed");
    localStorage.removeItem("cafa.desktopView");
  }, language.lang);
}

async function signIn(page: Page, language: SidebarCopy): Promise<void> {
  await setLanguage(page, language);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#identifier").fill(username);
  await page.locator("#password").fill(password);
  await page.locator('form[aria-label] button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard)?(?:\?.*)?$/);
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("aside nav")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language.lang);
  await expect(page.locator("html")).toHaveAttribute("dir", language.direction);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

function sidebar(page: Page): Locator {
  return page.locator("aside");
}

function nav(page: Page): Locator {
  return sidebar(page).locator("nav");
}

function navLink(page: Page, href: string): Locator {
  return sidebar(page).locator(`a[href="${href}"]`);
}

function logoutButton(page: Page): Locator {
  return sidebar(page).getByRole("button", { name: /log out|تسجيل الخروج/i }).last();
}

function mobileMenuButton(page: Page): Locator {
  // The product hamburger intentionally has no visible text. It is the first
  // header button and remains stable while the desktop-only header actions vary
  // by role and viewport.
  return page.locator("header button").first();
}

async function tabUntil(page: Page, target: Locator, maxTabs = 64): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) {
      await expect(target).toBeFocused();
      return;
    }
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("aria-label") ?? "target"}.`);
}

function getReportsToggle(page: Page, copy: SidebarCopy): Locator {
  return sidebar(page).getByRole("button", {
    name: new RegExp(`${copy.expandReports}|${copy.collapseReports}`),
  });
}

async function openReports(page: Page, copy: SidebarCopy): Promise<void> {
  const reportsToggle = getReportsToggle(page, copy);
  if ((await reportsToggle.getAttribute("aria-expanded")) !== "true") {
    await reportsToggle.click();
  }
  await expect(reportsToggle).toHaveAttribute("aria-expanded", "true");
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function screenshotSidebar(page: Page, name: string): Promise<void> {
  await settle(page);
  const sideBox = await sidebar(page).boundingBox();
  const frame = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    direction: document.dir,
  }));
  if (!sideBox) throw new Error("Sidebar geometry is required for visual capture.");
  const shellPadding = 72;
  const isRtl = frame.direction === "rtl";
  const clipX = isRtl
    ? Math.max(0, sideBox.x - shellPadding)
    : Math.max(0, sideBox.x);
  const clipWidth = Math.min(frame.width - clipX, sideBox.width + shellPadding);
  const screenshot = await page.screenshot({
    clip: { x: clipX, y: 0, width: clipWidth, height: frame.height },
    animations: "disabled",
    caret: "hide",
  });
  await expect(screenshot).toMatchSnapshot(name, {
    threshold: 0.2,
    maxDiffPixelRatio: 0.005,
  });
}

test.describe("CAFA PMIS sidebar visual regression", () => {
  test("desktop expanded — English/LTR", async ({ page }) => {
    await signIn(page, ENGLISH);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(sidebar(page)).toHaveCSS("width", "212px");
    await expect(sidebar(page).getByTestId("sidebar-brand-title")).toHaveText("CAFA PMIS");
    await expect(logoutButton(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-desktop-expanded-en.png");
  });

  test("desktop collapsed — English/LTR", async ({ page }) => {
    await signIn(page, ENGLISH);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await sidebar(page).getByRole("button", { name: ENGLISH.collapseSidebar }).click();
    await expect(sidebar(page)).toHaveCSS("width", "60px");
    await expect(sidebar(page).getByRole("button", { name: ENGLISH.expandSidebar })).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();
    await expect(navLink(page, "/dashboard")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-desktop-collapsed-en.png");
  });

  test("Reports expanded with active child — English/LTR", async ({ page }) => {
    await signIn(page, ENGLISH);
    await page.goto("/reports/project", { waitUntil: "domcontentloaded" });
    await openReports(page, ENGLISH);
    await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toHaveClass(/bg-sidebar-primary\/10/);
    await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toHaveAttribute("aria-current", "page");
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-reports-expanded-en.png");
  });

  test("mobile drawer — English/LTR", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, ENGLISH);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    // This is intentionally a persisted desktop rail preference. Mobile must
    // still render the full drawer, not the 60px icon rail.
    await page.evaluate(() => localStorage.setItem("cafa.sidebarCollapsed", "true"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await mobileMenuButton(page).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page)).toHaveCSS("width", "212px");
    await expect(navLink(page, "/dashboard")).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: ENGLISH.closeMenu })).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-mobile-drawer-en.png");
  });

  test("desktop expanded — Arabic/RTL", async ({ page }) => {
    await signIn(page, ARABIC);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(sidebar(page)).toHaveCSS("width", "212px");
    await expect(sidebar(page).getByTestId("sidebar-brand-title")).toHaveText("CAFA PMIS");
    await expect(logoutButton(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-desktop-expanded-ar.png");
  });

  test("desktop collapsed — Arabic/RTL", async ({ page }) => {
    await signIn(page, ARABIC);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await sidebar(page).getByRole("button", { name: ARABIC.collapseSidebar }).click();
    await expect(sidebar(page)).toHaveCSS("width", "60px");
    await expect(sidebar(page).getByRole("button", { name: ARABIC.expandSidebar })).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-desktop-collapsed-ar.png");
  });

  test("Reports expanded with active child — Arabic/RTL", async ({ page }) => {
    await signIn(page, ARABIC);
    await page.goto("/reports/project", { waitUntil: "domcontentloaded" });
    await openReports(page, ARABIC);
    await expect(sidebar(page).getByRole("link", { name: ARABIC.projectReports, exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: ARABIC.projectReports, exact: true })).toHaveClass(/bg-sidebar-primary\/10/);
    await expect(sidebar(page).getByRole("link", { name: ARABIC.projectReports, exact: true })).toHaveAttribute("aria-current", "page");
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-reports-expanded-ar.png");
  });

  test("mobile drawer — Arabic/RTL", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, ARABIC);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("cafa.sidebarCollapsed", "true"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await mobileMenuButton(page).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(sidebar(page)).toHaveCSS("width", "212px");
    await expect(sidebar(page).getByRole("link", { name: "لوحة التحكم" })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: ARABIC.closeMenu })).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await screenshotSidebar(page, "sidebar-mobile-drawer-ar.png");
  });

  test.describe("behavioural and accessibility guards", () => {
    test("keeps a collapsed desktop rail after reload, but opens a full mobile drawer", async ({ page }) => {
      await signIn(page, ENGLISH);
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await sidebar(page).getByRole("button", { name: ENGLISH.collapseSidebar }).click();
      await expect(sidebar(page)).toHaveCSS("width", "60px");
      await expect.poll(() => page.evaluate(() => localStorage.getItem("cafa.sidebarCollapsed"))).toBe("true");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(sidebar(page)).toHaveCSS("width", "60px");

      await page.setViewportSize({ width: 390, height: 844 });
      await mobileMenuButton(page).click();
      await expect(sidebar(page)).toHaveCSS("width", "212px");
      await expect(navLink(page, "/dashboard")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });

    test("keeps an active report child expanded and allows Reports to collapse from its parent route", async ({ page }) => {
      await signIn(page, ENGLISH);
      await page.goto("/reports/project", { waitUntil: "domcontentloaded" });
      const activeChildReportsToggle = getReportsToggle(page, ENGLISH);
      await expect(activeChildReportsToggle).toHaveAttribute("aria-expanded", "true");
      await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toHaveClass(/bg-sidebar-primary\/10/);
      await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toHaveAttribute("aria-current", "page");
      await sidebar(page).getByRole("button", { name: ENGLISH.collapseSidebar }).click();
      await expect(navLink(page, "/reports")).toHaveAttribute("aria-current", "location");
      await sidebar(page).getByRole("button", { name: ENGLISH.expandSidebar }).click();
      await page.goto("/reports", { waitUntil: "domcontentloaded" });
      const parentReportsToggle = getReportsToggle(page, ENGLISH);
      await expect(parentReportsToggle).toHaveAttribute("aria-expanded", "false");
      await parentReportsToggle.click();
      await expect(parentReportsToggle).toHaveAttribute("aria-expanded", "true");
      await parentReportsToggle.click();
      await expect(parentReportsToggle).toHaveAttribute("aria-expanded", "false");
      await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toBeHidden();
      await parentReportsToggle.click();
      await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toBeVisible();
    });

    test("follows dashboard → projects → Reports child route state", async ({ page }) => {
      await signIn(page, ENGLISH);
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await sidebar(page).getByRole("link", { name: "Projects", exact: true }).click();
      await expect(page).toHaveURL(/\/projects$/);
      await expect(sidebar(page).getByRole("link", { name: "Projects", exact: true })).toHaveClass(/bg-sidebar-primary\/10/);
      await sidebar(page).getByRole("link", { name: ENGLISH.reports, exact: true }).click();
      await expect(page).toHaveURL(/\/reports$/);
      await openReports(page, ENGLISH);
      await sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true }).click();
      await expect(page).toHaveURL(/\/reports\/project$/);
      await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toHaveClass(/bg-sidebar-primary\/10/);
      await expect(sidebar(page).getByRole("link", { name: ENGLISH.projectReports, exact: true })).toHaveAttribute("aria-current", "page");
    });

    test("keeps logout keyboard-accessible in expanded, collapsed, and mobile modes", async ({ page }) => {
      await signIn(page, ENGLISH);
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await expect(logoutButton(page)).toBeVisible();
      await sidebar(page).getByRole("button", { name: ENGLISH.collapseSidebar }).focus();
      await tabUntil(page, logoutButton(page));

      await sidebar(page).getByRole("button", { name: ENGLISH.collapseSidebar }).click();
      await expect(logoutButton(page)).toBeVisible();
      await sidebar(page).getByRole("button", { name: ENGLISH.expandSidebar }).focus();
      await tabUntil(page, logoutButton(page));

      await page.setViewportSize({ width: 390, height: 844 });
      await mobileMenuButton(page).click();
      await expect(logoutButton(page)).toBeVisible();
      await sidebar(page).getByRole("button", { name: ENGLISH.closeMenu }).focus();
      await tabUntil(page, logoutButton(page));
    });

    test("keeps the navigation reachable at low height and prevents horizontal overflow", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 420 });
      await signIn(page, ENGLISH);
      await page.goto("/reports/project", { waitUntil: "domcontentloaded" });
      await openReports(page, ENGLISH);
      await expect(nav(page)).toHaveCSS("overflow-y", "auto");
      await logoutButton(page).scrollIntoViewIfNeeded();
      await expect(logoutButton(page)).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });

    test("places the collapsed RTL tooltip inward and preserves long Arabic labels", async ({ page }) => {
      await signIn(page, ARABIC);
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await expect(nav(page)).toContainText("الملفات والأرشيف");
      await sidebar(page).getByRole("button", { name: ARABIC.collapseSidebar }).click();
      const dashboard = navLink(page, "/dashboard");
      await dashboard.hover();
      const tooltip = page.getByRole("tooltip").last();
      await expect(tooltip).toBeVisible();
      const [sideBox, tooltipBox] = await Promise.all([sidebar(page).boundingBox(), tooltip.boundingBox()]);
      expect(sideBox).not.toBeNull();
      expect(tooltipBox).not.toBeNull();
      // Radix's anti-aliased shadow may overhang a few pixels, but the tooltip
      // must remain on the logical inward (content) side of an RTL rail.
      expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(sideBox!.x + 6);
      await assertNoHorizontalOverflow(page);
      await sidebar(page).getByRole("button", { name: ARABIC.expandSidebar }).focus();
      await expect(sidebar(page).getByRole("button", { name: ARABIC.expandSidebar })).toBeFocused();
    });
  });
});