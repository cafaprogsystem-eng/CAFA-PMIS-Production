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
  requirePermission,
  requireStagingConfig,
} from "./aws-staging-certification-http.mjs";

const config = (() => {
  try {
    return requireStagingConfig();
  } catch (error) {
    console.error(`AWS staging Report certification blocked: ${error.message}`);
    process.exit(1);
  }
})();

const uuid = fixtureId();
const title = `Staging Report Certification ${uuid}`;
const period = `staging-certification-${uuid}`;
let sessionCookie = null;
let reportId = null;
let reportDeleted = false;
let primaryError = null;
let cleanupError = null;

function assertReportContract(report) {
  assert(report && typeof report === "object", "The Report response was not an object.");
  assertEqual(report.title, title, "Report title");
  assertEqual(report.kind, "on_demand", "Report kind");
  assertEqual(report.reportType, "hq_sector", "Report type");
  assertEqual(report.status, "draft", "Report status");
  assertEqual(report.sector, "Health", "Report sector");
  assertEqual(report.effectiveSector, "Health", "Report effective sector");
  assertEqual(report.period, period, "Report period");
  assert(report.stateId == null, "The HQ Sector Report unexpectedly carried a State.");
  assert(report.projectId == null, "The HQ Sector Report unexpectedly carried a Project.");
  assert(report.workflowPath == null, "The deterministic HQ Sector Report workflow path was not null.");
  assert(Array.isArray(report.approvalHistory), "Report approvalHistory was not an array.");
}

async function deleteReport() {
  const { data } = await expectJson(
    config.baseUrl,
    `/api/reports/${reportId}`,
    200,
    authenticatedOptions(sessionCookie, { method: "DELETE" }),
  );
  assert(data?.ok === true, "The Report delete response was not acknowledged.");
  reportDeleted = true;
}

try {
  const auth = await login(config);
  sessionCookie = auth.cookie;

  assert(
    auth.user?.role === "super_admin" || auth.user?.role === "program_manager",
    "The staging actor must be super_admin or program_manager for deterministic HQ Sector authoring.",
  );
  requirePermission(auth.permissions, "reports.create", "Report create");
  requirePermission(auth.permissions, "reports.view", "Report view");
  requirePermission(auth.permissions, "reports.delete", "Report delete");

  const { data: created } = await expectJson(
    config.baseUrl,
    "/api/reports",
    201,
    authenticatedOptions(sessionCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        kind: "on_demand",
        reportType: "hq_sector",
        sector: "Health",
        period,
      }),
    }),
  );
  reportId = created?.id;
  assertNumericId(reportId, "Created Report");
  assertReportContract(created);

  const { data: detail } = await expectJson(
    config.baseUrl,
    `/api/reports/${reportId}`,
    200,
    authenticatedOptions(sessionCookie),
  );
  assertReportContract(detail);

  await deleteReport();
  const { data: absent } = await expectJson(
    config.baseUrl,
    `/api/reports/${reportId}`,
    404,
    authenticatedOptions(sessionCookie),
  );
  assertEqual(absent?.error, "report not found", "Post-delete Report error");
} catch (error) {
  primaryError = error instanceof Error ? error : new Error("Report certification failed.");
} finally {
  if (reportId !== null && !reportDeleted) {
    try {
      await deleteReport();
    } catch (error) {
      cleanupError = collectFailure(
        cleanupError,
        error instanceof Error ? error : new Error("Report cleanup failed."),
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
  printFailure("AWS staging Report certification primary failure", primaryError);
  printFailure("AWS staging Report certification cleanup failure", cleanupError);
  process.exitCode = 1;
} else {
  console.log(`AWS staging Report certification passed for on-demand HQ Sector draft ${reportId}.`);
  console.log("Verified scoped detail read, production draft delete, and post-delete absence.");
}