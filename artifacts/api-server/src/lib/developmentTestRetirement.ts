/**
 * Durable provenance record for the one historical development fixture reviewed
 * by Task 837. This allowlist is intentionally exact: it is not a generic
 * "test-looking project" classifier and must never be expanded implicitly.
 */
export const DEVELOPMENT_TEST_RETIREMENT_TARGET = {
  id: 19,
  code: "CAFA-MPLQLM3M",
  title: "TX Test",
} as const;

export function isExactDevelopmentTestRetirementTarget(project: {
  id: number;
  code: string;
  title: string;
}): boolean {
  return project.id === DEVELOPMENT_TEST_RETIREMENT_TARGET.id
    && project.code === DEVELOPMENT_TEST_RETIREMENT_TARGET.code
    && project.title === DEVELOPMENT_TEST_RETIREMENT_TARGET.title;
}