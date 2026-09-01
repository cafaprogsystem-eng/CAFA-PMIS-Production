/**
 * PROJ-DUPLICATE — "Duplicate" now prefills the full registration form
 * instead of POSTing an incomplete 5-field payload straight to the create
 * endpoint (which was missing agreementNumber, reportingFrequency, an
 * Operational Location, and at least one output — fields the create
 * endpoint requires — so the duplicate always failed validation).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const formSrc = readFileSync(resolve(__dirname, "../components/project-registration-form.tsx"), "utf8");
const pageSrc = readFileSync(resolve(__dirname, "../pages/projects.tsx"), "utf8");

describe("PROJ-DUPLICATE — form supports prefilling from a source project without entering edit mode", () => {
  it("accepts duplicateFromProjectId and keeps editProjectId unset so submit still creates (not patches)", () => {
    expect(formSrc).toContain("duplicateFromProjectId?: number");
    expect(formSrc).toContain("const sourceProjectId = editProjectId ?? duplicateFromProjectId;");
  });

  it("prefixes the title, clears documents, and strips the source's activity ids/spend when duplicating", () => {
    expect(formSrc).toContain('mapped.title = `Copy of ${mapped.title}`;');
    expect(formSrc).toContain("mapped.documents = [];");
    expect(formSrc).toMatch(/id: _sourceActivityId, budgetSpent: _sourceBudgetSpent/);
  });

  it("does not force a state-scoped author's own state onto a duplicated project's location", () => {
    expect(formSrc).toMatch(/if \(!isStateScopedAuthor \|\| editProjectId \|\| duplicateFromProjectId\) return;/);
  });
});

describe("PROJ-DUPLICATE — projects.tsx opens the form instead of calling createProject directly", () => {
  it("no longer builds a partial 5-field payload for duplicate", () => {
    expect(pageSrc).not.toContain("await createMutation.mutateAsync({ data: payload as never });");
  });

  it("opens ProjectRegistrationForm with duplicateFromProjectId set to the source project", () => {
    expect(pageSrc).toContain("setDuplicateSourceId(project.id)");
    expect(pageSrc).toContain("duplicateFromProjectId={duplicateSourceId}");
  });
});
