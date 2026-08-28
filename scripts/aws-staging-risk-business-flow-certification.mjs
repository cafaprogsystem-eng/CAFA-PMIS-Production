#!/usr/bin/env node

import {
  assert,
  assertEqual,
  assertNumericId,
  authenticatedOptions,
  collectFailure,
  expectJson,
  fixtureId,
  login,
  logout,
  printFailure,
  requireAnyPermission,
  requirePermission,
  requireStagingConfig,
} from "./aws-staging-certification-http.mjs";

const config = (() => {
  try {
    return requireStagingConfig();
  } catch (error) {
    console.error(`AWS staging Risk certification blocked: ${error.message}`);
    process.exit(1);
  }
})();

const uuid = fixtureId();
const projectTitle = `Staging Risk Project Certification ${uuid}`;
const riskTitle = `Staging Risk Certification ${uuid}`;
let sessionCookie = null;
let projectId = null;
let projectDeleted = false;
let riskId = null;
let primaryError = null;
let cleanupError = null;

function assertProjectContract(project) {
  assert(project && typeof project === "object", "The Project response was not an object.");
  assertNumericId(project.id, "Created Project");
  assert(/^CAFA-PROJ-\d{4}-\d+$/.test(String(project.code)), "The Project code was not canonical.");
  assertEqual(project.title, projectTitle, "Project title");
  assertEqual(project.status, "draft", "Project status");
  assertEqual(project.reportingFrequency, "monthly", "Project reporting frequency");
}

function assertRiskContract(risk) {
  assert(risk && typeof risk === "object", "The Risk response was not an object.");
  assertNumericId(risk.id, "Created Risk");
  assertEqual(risk.title, riskTitle, "Risk title");
  assertEqual(risk.category, "Operational", "Risk category");
  assertEqual(risk.severity, "low", "Risk severity");
  assertEqual(risk.likelihood, "low", "Risk likelihood");
  assertEqual(risk.impact, "low", "Risk impact");
  assertEqual(risk.status, "open", "Risk status");
  assertEqual(risk.locationType, "hq", "Risk location type");
  assert(risk.stateId == null, "The HQ Risk unexpectedly carried a State.");
  assertEqual(risk.projectId, projectId, "Risk project");
  assertEqual(risk.projectTitle, projectTitle, "Risk project title");
  assertEqual(risk.riskLevel, "low", "Risk level");
}

async function deleteProject() {
  const { data } = await expectJson(
    config.baseUrl,
    `/api/projects/${projectId}`,
    200,
    authenticatedOptions(sessionCookie, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Automated staging risk certification cleanup.",
      }),
    }),
  );
  assertEqual(data?.projectId, projectId, "Deleted Project ID");
  assertEqual(data?.deletionMode, "permanent", "Project deletion mode");
  projectDeleted = true;
}

try {
  const auth = await login(config);
  sessionCookie = auth.cookie;

  assert(
    auth.user?.role === "super_admin" || auth.user?.role === "program_manager",
    "The staging actor must be super_admin or program_manager for deterministic HQ Project deletion.",
  );
  requirePermission(auth.permissions, "projects.create", "Project create");
  requirePermission(auth.permissions, "projects.delete", "Project delete");
  requirePermission(auth.permissions, "risks.create", "Risk create");
  requireAnyPermission(auth.permissions, ["risks.view", "risks.view.state"], "Risk list/read");

  const { data: project } = await expectJson(
    config.baseUrl,
    "/api/projects",
    201,
    authenticatedOptions(sessionCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: projectTitle,
        description: `Temporary CAFA PMIS staging project certification fixture ${uuid}.`,
        agreementNumber: `STAGING-RISK-${uuid}`,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        sectors: ["Health"],
        donor: "UNFPA",
        reportingFrequency: "monthly",
        hasHqOperations: true,
        stateIds: [],
      }),
    }),
  );
  projectId = project?.id;
  assertNumericId(projectId, "Created Project");
  assertProjectContract(project);

  const { data: risk } = await expectJson(
    config.baseUrl,
    "/api/risks",
    201,
    authenticatedOptions(sessionCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: riskTitle,
        description: `Temporary CAFA PMIS staging risk certification fixture ${uuid}.`,
        category: "Operational",
        severity: "low",
        likelihood: "low",
        impact: "low",
        locationType: "hq",
        projectId,
      }),
    }),
  );
  riskId = risk?.id;
  assertNumericId(riskId, "Created Risk");
  assertRiskContract(risk);

  const { data: listed } = await expectJson(
    config.baseUrl,
    `/api/risks?projectId=${projectId}&page=1&limit=50`,
    200,
    authenticatedOptions(sessionCookie),
  );
  assert(Array.isArray(listed?.items), "The Risk list did not return an items array.");
  assertEqual(listed.total, 1, "Scoped Risk list total");
  assertEqual(
    listed.items.filter((item) => item?.id === riskId).length,
    1,
    "Scoped Risk list matching item count",
  );
  assertRiskContract(listed.items.find((item) => item?.id === riskId));

  // PATCH is intentionally omitted. The current production route notifies
  // Project actors for every Project-linked update, including harmless changes.
  // This certification avoids creating persistent notification side effects and
  // covers create, scoped read, parent-owned cleanup, and post-cleanup absence.
  await deleteProject();

  const { data: projectAbsent } = await expectJson(
    config.baseUrl,
    `/api/projects/${projectId}`,
    404,
    authenticatedOptions(sessionCookie),
  );
  assertEqual(projectAbsent?.error, "project not found", "Post-delete Project error");

  const { data: risksAbsent } = await expectJson(
    config.baseUrl,
    `/api/risks?projectId=${projectId}&page=1&limit=50`,
    200,
    authenticatedOptions(sessionCookie),
  );
  assert(Array.isArray(risksAbsent?.items), "The post-cleanup Risk list did not return an items array.");
  assertEqual(risksAbsent.items.length, 0, "Post-cleanup Risk list length");
  assertEqual(risksAbsent.total, 0, "Post-cleanup Risk list total");

  const { data: exactRiskAbsent } = await expectJson(
    config.baseUrl,
    `/api/risks?search=${encodeURIComponent(uuid)}&page=1&limit=50`,
    200,
    authenticatedOptions(sessionCookie),
  );
  assert(
    Array.isArray(exactRiskAbsent?.items),
    "The exact-Risk post-cleanup search did not return an items array.",
  );
  assert(
    !exactRiskAbsent.items.some((item) => item?.id === riskId),
    "The exact captured Risk still exists after Project deletion.",
  );
} catch (error) {
  primaryError = error instanceof Error ? error : new Error("Risk certification failed.");
} finally {
  if (projectId !== null && !projectDeleted) {
    try {
      await deleteProject();
    } catch (error) {
      cleanupError = collectFailure(
        cleanupError,
        error instanceof Error ? error : new Error("Project cleanup failed."),
      );
    }
  }
  try {
    await logout(config.baseUrl, sessionCookie);
  } catch (error) {
    cleanupError = collectFailure(
      cleanupError,
      error instanceof Error ? error : new Error("Staging logout failed."),
    );
  }
}

if (primaryError || cleanupError) {
  printFailure("AWS staging Risk certification primary failure", primaryError);
  printFailure("AWS staging Risk certification cleanup failure", cleanupError);
  process.exitCode = 1;
} else {
  console.log(`AWS staging Risk certification passed for temporary HQ Project ${projectId}.`);
  console.log("Verified linked low-risk creation, scoped read, permanent Project deletion, linked Risk cleanup, and post-cleanup absence.");
}