import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const enabled = Boolean(baseURL && username && password);
const productionCertification = process.env.E2E_CERTIFY_PRODUCTION === "true";

/**
 * This suite is intentionally environment-gated: it must be run against a
 * routed PWA environment with an isolated staff test account. It never uses
 * production-like credentials from source code and does not create or submit
 * business records.
 */
test.skip(!enabled, "Set E2E_BASE_URL, E2E_USERNAME, and E2E_PASSWORD to run the authenticated offline suite.");

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#identifier").fill(username!);
  await page.locator("#password").fill(password!);
  await page.locator('form[aria-label] button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard)?(?:\?.*)?$/);
  await expect(page.locator("#root")).not.toBeEmpty();
}

async function warmAuthorisedReads(page: Page): Promise<void> {
  for (const path of ["/dashboard", "/projects", "/plans", "/risks", "/reports", "/manual", "/sync-status"]) {
    await page.goto(path);
    await expect(page.locator("#root")).not.toBeEmpty();
  }
  await expect.poll(() => page.evaluate(async () => {
    const names = await caches.keys();
    const registrations = await navigator.serviceWorker.getRegistrations();
    return names.length > 0 && registrations.some((registration) => registration.active);
  })).toBe(true);
}

async function warmProjectCache(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const response = await fetch("/api/projects", { credentials: "include" });
    if (!response.ok) throw new Error(`Unable to warm projects cache: ${response.status}`);
    await response.text();
  });
  await expect.poll(() => page.evaluate(async () => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("cafa-pmis-v2");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("apiCache", "readonly");
      const records = transaction.objectStore("apiCache").getAll();
      records.onerror = () => reject(records.error);
      records.onsuccess = () => resolve(
        (records.result as Array<{ url?: unknown }>).some((record) =>
          typeof record.url === "string" && /\/api\/projects(?:\?|$)/.test(record.url),
        ),
      );
    };
  }))).toBe(true);
}

async function blockApiConnectivity(page: Page): Promise<void> {
  await page.route("**/api/healthz", (route) => route.abort("internetdisconnected"));
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText(/You are offline|أنت غير متصل/)).toBeVisible();
}

test.describe("controlled offline readiness", () => {
  test("establishes an authenticated Online baseline with no Offline banner", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard");

    const currentUser = await page.evaluate(async () => {
      const response = await fetch("/api/me", { credentials: "include" });
      return { status: response.status, body: await response.json() };
    });

    expect(currentUser.status).toBe(200);
    expect(currentUser.body.user).toBeTruthy();
    await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
  });

  test("keeps normal authenticated navigation free of global connectivity warnings", async ({ page }) => {
    await signIn(page);
    for (const path of ["/dashboard", "/projects", "/plans", "/reports", "/users"]) {
      await page.goto(path);
      await expect(page.locator("#root")).not.toBeEmpty();
      await expect(page.getByText(
        /Checking the CAFA connection|جارٍ التحقق من اتصال CAFA|You are offline|أنت غير متصل|service is temporarily unavailable|خدمة CAFA غير متاحة/,
      )).toHaveCount(0);
    }
  });

  test("renders global search in Arabic without i18n key leakage", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Header search is desktop-only.");
    await page.addInitScript(() => localStorage.setItem("cafa.lang", "ar"));
    await signIn(page);
    await page.goto("/dashboard");
    await expect(page.getByPlaceholder("ابحث في المشاريع والخطط والتقارير والمخاطر والمستندات والمستخدمين…")).toBeVisible();
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "لوحة الأوامر" })).toBeVisible();
    await expect(page.getByText("common:keys.tab")).toHaveCount(0);
  });

  test("records a production worker, built shell cache, and user-scoped browser stores", async ({ page }) => {
    test.skip(
      !productionCertification,
      "Set E2E_CERTIFY_PRODUCTION=true only for a production PWA deployment.",
    );
    await signIn(page);
    await warmAuthorisedReads(page);

    const state = await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const databases = "databases" in indexedDB ? await indexedDB.databases() : [];
      const cacheNames = await caches.keys();
      const cachedUrls = (await Promise.all(cacheNames.map(async (name) => {
        const cache = await caches.open(name);
        return (await cache.keys()).map((request) => request.url);
      }))).flat();
      return {
        controlled: Boolean(navigator.serviceWorker.controller),
        activeScopes: registrations.filter((registration) => registration.active).map((registration) => registration.scope),
        caches: cacheNames,
        hasBuiltShellAsset: cachedUrls.some((url) => /\/assets\/[^/]+\.js(?:\?|$)/.test(url)),
        databases: databases.map((database) => database.name),
      };
    });

    expect(state.controlled).toBe(true);
    expect(state.activeScopes).not.toHaveLength(0);
    expect(state.caches.length).toBeGreaterThan(0);
    expect(state.hasBuiltShellAsset).toBe(true);
    expect(state.databases).toContain("cafa-pmis-v2");
  });

  test("uses an authorised cached read and blocks a sensitive read after connectivity drops", async ({ page }) => {
    await signIn(page);
    await page.goto("/projects");
    await expect(page.locator("#root")).not.toBeEmpty();
    await warmProjectCache(page);
    await blockApiConnectivity(page);

    const cachedRead = await page.evaluate(async () => {
      const response = await fetch("/api/projects", { credentials: "include" });
      return {
        status: response.status,
        offlineCache: response.headers.get("x-from-offline-cache"),
      };
    });
    expect(cachedRead.status).toBe(200);
    expect(cachedRead.offlineCache).toBe("true");

    const sensitiveRead = await page.evaluate(async () => {
      try {
        await fetch("/api/audit-log", { credentials: "include" });
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(sensitiveRead).toMatch(/requires an internet connection/i);
  });

  test("does not label isolated HTTP and cancelled requests as Offline", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard");

    for (const status of [422, 500, 503]) {
      await page.route("**/api/projects", (route) => route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: status >= 500 ? "temporary_server_failure" : "validation_error" }),
      }));
      await page.evaluate(async () => {
        await fetch("/api/projects", { credentials: "include" });
      });
      if (status >= 500) {
        await expect(page.getByText(/temporarily unavailable|غير متاحة مؤقتاً/)).toBeVisible();
      }
      await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
      await page.unroute("**/api/projects");
    }

    for (const status of [401, 403]) {
      await page.route("**/api/risks", (route) => route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: status === 401 ? "unauthenticated" : "forbidden" }),
      }));
      await page.evaluate(async () => {
        await fetch("/api/risks", { credentials: "include" });
      });
      await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
      await page.unroute("**/api/risks");
    }

    await page.route("**/api/risks", (route) => route.abort("timedout"));
    await page.evaluate(async () => {
      await fetch("/api/risks").catch(() => undefined);
    });
    await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
    await page.unroute("**/api/risks");

    await page.evaluate(async () => {
      const controller = new AbortController();
      controller.abort();
      await fetch("/api/risks", { signal: controller.signal }).catch(() => undefined);
    });
    await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
  });

  test("does not confirm Offline when probe failures fall outside the confirmation window", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard");

    let probeCount = 0;
    await page.route("**/api/healthz", async (route) => {
      probeCount += 1;
      await route.abort("internetdisconnected");
    });
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __cafaOriginalSetTimeout?: typeof window.setTimeout;
      };
      testWindow.__cafaOriginalSetTimeout = window.setTimeout;
      window.setTimeout = ((handler, timeout, ...args) => testWindow.__cafaOriginalSetTimeout!(
        handler,
        timeout === 400 ? 5_200 : timeout,
        ...args,
      )) as typeof window.setTimeout;
      window.dispatchEvent(new Event("offline"));
    });
    try {
      // The first probe fails immediately. Only the confirmation delay is
      // extended, so the second recorded failure occurs more than five seconds
      // later while each individual probe retains its normal 2.5-second limit.
      await expect.poll(() => probeCount).toBeGreaterThanOrEqual(2);
      await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
    } finally {
      await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __cafaOriginalSetTimeout?: typeof window.setTimeout;
        };
        if (testWindow.__cafaOriginalSetTimeout) {
          window.setTimeout = testWindow.__cafaOriginalSetTimeout;
          delete testWindow.__cafaOriginalSetTimeout;
        }
      });
      await page.unroute("**/api/healthz");
    }
  });

  test("recovers from verified Offline only after a CAFA probe succeeds", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard");
    await blockApiConnectivity(page);
    await page.unroute("**/api/healthz");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect(page.getByText(/You are offline|أنت غير متصل/)).toHaveCount(0);
    await expect(page.getByText(/Checking the CAFA connection|جارٍ التحقق من اتصال CAFA/)).toHaveCount(0);
  });

  test("makes an offline reload a release gate, never a registration-only claim", async ({ page, context }) => {
    test.skip(
      !productionCertification,
      "Set E2E_CERTIFY_PRODUCTION=true only for a production PWA deployment.",
    );
    await signIn(page);
    await warmAuthorisedReads(page);

    await context.setOffline(true);
    try {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/chrome-error:\/\//);
      await expect(page.locator("#root")).not.toBeEmpty();
      await expect(page.locator('[role="status"]')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("keeps the mobile Arabic offline status readable and RTL", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only presentation check.");
    await page.addInitScript(() => localStorage.setItem("cafa.lang", "ar"));
    await signIn(page);
    await page.goto("/sync-status");
    await blockApiConnectivity(page);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator('[role="status"]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});