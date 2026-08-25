import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const username = process.env.E2E_LIMITED_SCOPE_USERNAME ?? "e2e.tc.attachment.boundary";
const password = process.env.E2E_LIMITED_SCOPE_PASSWORD;
const fixtureDescriptorPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".limited-scope-attachment-fixture.json",
);
const enabled = Boolean(process.env.E2E_BASE_URL && password);

type FixtureDescriptor = {
  version: 1;
  fixture: { username: string; email: string; role: string; sector: string; stateCode: string };
  parent: {
    projectId: number;
    projectCode: string;
    sector: string;
    stateCode: string;
    documentId: number;
    documentName: string;
  };
};

test.skip(
  !enabled,
  "Set E2E_BASE_URL and E2E_LIMITED_SCOPE_PASSWORD, then run the non-production fixture provisioner.",
);

async function readFixtureDescriptor(): Promise<FixtureDescriptor> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(fixtureDescriptorPath, "utf8"));
  } catch {
    throw new Error(
      "Limited-scope fixture descriptor is missing or invalid. Run provision:limited-scope-attachment-fixture first.",
    );
  }
  const descriptor = parsed as Partial<FixtureDescriptor>;
  if (
    descriptor.version !== 1
    || descriptor.fixture?.username !== username
    || descriptor.fixture.email !== "e2e.tc.attachment.boundary@example.invalid"
    || descriptor.fixture.role !== "technical_coordinator"
    || descriptor.fixture.sector !== "WASH"
    || descriptor.fixture.stateCode !== "KRT"
    || descriptor.parent?.projectCode !== "CAFA-E2E-ATTACHMENT-BOUNDARY"
    || descriptor.parent.sector !== "Nutrition"
    || descriptor.parent.stateCode !== "KSL"
    || descriptor.parent.documentName !== "e2e-out-of-scope-attachment.txt"
    || !Number.isSafeInteger(descriptor.parent.projectId)
    || !Number.isSafeInteger(descriptor.parent.documentId)
  ) {
    throw new Error("Limited-scope fixture descriptor does not match the controlled attachment boundary.");
  }
  return descriptor as FixtureDescriptor;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#identifier").fill(username);
  await page.locator("#password").fill(password!);
  await page.locator('form[aria-label] button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard)?(?:\?.*)?$/);
  await expect(page.locator("#root")).not.toBeEmpty();
}

test.describe("limited-scope project attachment boundary", () => {
  test("an authenticated out-of-scope coordinator receives only a minimal proxy denial", async ({ page }) => {
    // This descriptor is atomically written by the guarded provisioner after
    // its database lookup/transaction commits the exact parent and document
    // markers. Rejecting a missing or mismatched descriptor prevents an
    // arbitrary environment-provided ID from becoming test evidence.
    const fixture = await readFixtureDescriptor();
    await signIn(page);

    const currentUser = await page.evaluate(async () => {
      const result = await fetch("/api/me", { credentials: "include" });
      return { status: result.status, body: await result.json() };
    });
    expect(currentUser.status).toBe(200);
    expect(currentUser.body.user).toMatchObject({
      email: fixture.fixture.email,
      role: fixture.fixture.role,
      sector: fixture.fixture.sector,
    });

    const response = await page.evaluate(async ({ targetProjectId, targetDocumentId }) => {
      const result = await fetch(
        `/api/projects/${targetProjectId}/documents/${targetDocumentId}/download`,
        { credentials: "include", redirect: "manual" },
      );
      return {
        status: result.status,
        body: await result.json(),
        location: result.headers.get("location"),
        contentDisposition: result.headers.get("content-disposition"),
        contentType: result.headers.get("content-type"),
        storageAuthority: result.headers.get("x-amz-signedheaders")
          ?? result.headers.get("x-goog-signedheaders"),
      };
    }, {
      targetProjectId: fixture.parent.projectId,
      targetDocumentId: fixture.parent.documentId,
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "sector_forbidden" });
    expect(response.location).toBeNull();
    expect(response.contentDisposition).toBeNull();
    expect(response.storageAuthority).toBeNull();
    expect(response.contentType).toContain("application/json");
  });
});