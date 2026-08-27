#!/usr/bin/env node

const rawBaseUrl = process.env.CAFA_STAGING_BASE_URL?.trim() ?? "";
const identifier = process.env.CAFA_STAGING_LOGIN_IDENTIFIER?.trim() ?? "";
const password = process.env.CAFA_STAGING_LOGIN_PASSWORD ?? "";

function blocked(message) {
  throw new Error(message);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

let origin;
try {
  origin = new URL(rawBaseUrl);
} catch {
  console.error("AWS staging core runtime certification blocked: invalid CAFA_STAGING_BASE_URL.");
  process.exit(1);
}

if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
) {
  console.error(
    "AWS staging core runtime certification blocked: CAFA_STAGING_BASE_URL must be an exact HTTPS origin.",
  );
  process.exit(1);
}

if (!identifier || !password) {
  console.error(
    "AWS staging core runtime certification blocked: staging login credentials are required.",
  );
  process.exit(1);
}

const baseUrl = origin.toString().replace(/\/$/, "");

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(path, sessionCookie, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "error",
    ...options,
    headers: {
      Accept: "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...(options.headers ?? {}),
    },
  });
}

function cookieHeaderFrom(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

  return values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function requireJson200(path, sessionCookie) {
  const response = await request(path, sessionCookie);

  if (response.status !== 200) {
    blocked(`${path} returned ${response.status}; expected 200.`);
  }

  const body = await jsonOrNull(response);
  if (body === null) {
    blocked(`${path} did not return valid JSON.`);
  }

  return body;
}

let sessionCookie = null;
let primaryError = null;

try {
  const login = await request("/api/auth/login", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      password,
      remember: false,
    }),
  });

  const loginBody = await jsonOrNull(login);

  if (login.status !== 200 || !loginBody?.user?.id) {
    blocked(`/api/auth/login returned ${login.status}; expected authenticated 200.`);
  }

  sessionCookie = cookieHeaderFrom(login);
  if (!sessionCookie) {
    blocked("Login did not issue a usable session cookie.");
  }

  pass("Authenticated staging session established.");

  // Projects ---------------------------------------------------------------
  const projects = await requireJson200("/api/projects", sessionCookie);

  if (!Array.isArray(projects)) {
    blocked("/api/projects did not return the expected array contract.");
  }

  pass(`Projects runtime healthy (${projects.length} visible records).`);

  // Reports ----------------------------------------------------------------
  const reports = await requireJson200(
    "/api/reports?page=1&pageSize=1",
    sessionCookie,
  );

  if (
    !Array.isArray(reports?.items) ||
    !Number.isFinite(Number(reports?.total)) ||
    Number(reports?.page) !== 1 ||
    Number(reports?.pageSize) !== 1 ||
    !Number.isFinite(Number(reports?.totalPages))
  ) {
    blocked("/api/reports did not return the expected paginated contract.");
  }

  pass(`Reports runtime healthy (${Number(reports.total)} scoped records).`);

  // Plans ------------------------------------------------------------------
  const plans = await requireJson200("/api/plans", sessionCookie);

  if (!Array.isArray(plans)) {
    blocked("/api/plans did not return the expected array contract.");
  }

  pass(`Plans runtime healthy (${plans.length} visible records).`);

  // Risks ------------------------------------------------------------------
  const risks = await requireJson200(
    "/api/risks?page=1&limit=1",
    sessionCookie,
  );

  if (
    !Array.isArray(risks?.items) ||
    !Number.isFinite(Number(risks?.total)) ||
    Number(risks?.page) !== 1 ||
    Number(risks?.limit) !== 1 ||
    !Number.isFinite(Number(risks?.totalPages)) ||
    !risks?.summary ||
    typeof risks.summary !== "object"
  ) {
    blocked("/api/risks did not return the expected paginated summary contract.");
  }

  pass(`Risks runtime healthy (${Number(risks.total)} scoped records).`);

  // Dashboard --------------------------------------------------------------
  const dashboard = await requireJson200(
    "/api/dashboard/summary",
    sessionCookie,
  );

  const requiredDashboardFields = [
    "activeProjects",
    "totalProjects",
    "completedProjects",
    "statesCount",
    "totalBeneficiaries",
    "beneficiariesTarget",
    "openRisks",
    "criticalRisks",
    "reportsSubmitted",
    "reportsPending",
    "activitiesPlanned",
    "activitiesCompleted",
    "pendingApprovalsCount",
    "delayedActivities",
    "byStatus",
    "monthlyAchievement",
  ];

  for (const field of requiredDashboardFields) {
    if (!(field in dashboard)) {
      blocked(`/api/dashboard/summary is missing required field: ${field}.`);
    }
  }

  if (!Array.isArray(dashboard.byStatus) || !Array.isArray(dashboard.monthlyAchievement)) {
    blocked("/api/dashboard/summary returned invalid aggregate array fields.");
  }

  pass("Dashboard summary runtime healthy.");

  // Budgets & Donors -------------------------------------------------------
  const donorPortfolio = await requireJson200(
    "/api/dashboard/donor-portfolio",
    sessionCookie,
  );

  if (!Array.isArray(donorPortfolio)) {
    blocked("/api/dashboard/donor-portfolio did not return the expected array contract.");
  }

  pass(`Budget donor portfolio runtime healthy (${donorPortfolio.length} donor entries).`);

  const projectBudgetPerformance = await requireJson200(
    "/api/dashboard/project-budget-performance",
    sessionCookie,
  );

  if (!Array.isArray(projectBudgetPerformance)) {
    blocked(
      "/api/dashboard/project-budget-performance did not return the expected array contract.",
    );
  }

  pass(
    `Project budget performance runtime healthy (${projectBudgetPerformance.length} project entries).`,
  );

  console.log("");
  console.log(`AWS staging core runtime certification passed for ${baseUrl}.`);
  console.log(
    "Verified authenticated read-only runtime contracts for Projects, Reports, Plans, Risks, Dashboard, and Budgets.",
  );
} catch (error) {
  primaryError = error;
} finally {
  if (sessionCookie) {
    try {
      await request("/api/auth/logout", sessionCookie, {
        method: "POST",
      });
    } catch {
      // Auth certification separately verifies logout and server-side revocation.
    }
  }
}

if (primaryError) {
  console.error(
    `AWS staging core runtime certification blocked: ${
      primaryError instanceof Error ? primaryError.message : String(primaryError)
    }`,
  );
  process.exit(1);
}
