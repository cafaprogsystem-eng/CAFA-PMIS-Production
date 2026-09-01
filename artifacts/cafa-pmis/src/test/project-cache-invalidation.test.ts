/**
 * PROJ-CACHE — cache invalidation after create/delete/merge/risk-create must
 * target keys that actually match TanStack Query's cache.
 *
 * The generated hooks key their cache entries on the literal request URL
 * (e.g. ["/api/projects", params?], ["/api/projects/123"]) — never on a
 * hand-picked name like ["projects"], ["dashboard"], ["listProjects"], or
 * ["getProject", id]. Invalidating with one of those never matched anything,
 * so the projects list / dashboard / project detail silently kept showing
 * stale data (a just-created or just-deleted project, a newly added risk)
 * until a manual page reload.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const deleteDialogSrc = readFileSync(
  resolve(__dirname, "../components/delete-project-dialog.tsx"),
  "utf8",
);
const registrationFormSrc = readFileSync(
  resolve(__dirname, "../components/project-registration-form.tsx"),
  "utf8",
);
const projectDetailSrc = readFileSync(resolve(__dirname, "../pages/project-detail.tsx"), "utf8");

const NEVER_MATCHING_KEYS = [
  'queryKey: ["projects"]',
  'queryKey: ["dashboard"]',
  'queryKey: ["listProjects"]',
  'queryKey: ["getProject"',
];

describe("PROJ-CACHE-01 — delete-project-dialog invalidates the real cache", () => {
  it("does not use a hand-picked key that never matches the generated hooks", () => {
    for (const key of NEVER_MATCHING_KEYS) {
      expect(deleteDialogSrc).not.toContain(key);
    }
  });

  it("invalidates the whole cache after a successful delete", () => {
    const onSuccessIdx = deleteDialogSrc.indexOf("onSuccess: (data)");
    expect(onSuccessIdx).toBeGreaterThan(-1);
    const onSuccessBody = deleteDialogSrc.slice(onSuccessIdx, onSuccessIdx + 800);
    expect(onSuccessBody).toContain("qc.invalidateQueries();");
  });
});

describe("PROJ-CACHE-02 — project-registration-form invalidates the real cache", () => {
  it("does not use a hand-picked key that never matches the generated hooks", () => {
    for (const key of NEVER_MATCHING_KEYS) {
      expect(registrationFormSrc).not.toContain(key);
    }
  });
});

describe("PROJ-CACHE-03 — project-detail risk creation invalidates the real project-detail key", () => {
  it("does not invalidate under the never-matching [\"getProject\", id] key", () => {
    expect(projectDetailSrc).not.toContain('queryKey: ["getProject", projectId]');
  });

  it("invalidates the real /api/projects/:id key used by useGetProject", () => {
    expect(projectDetailSrc).toContain("qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] })");
  });
});
