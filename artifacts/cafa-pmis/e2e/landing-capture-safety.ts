const PRODUCTION_HOST_SUFFIX = ".replit.app";

function configuredHosts(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Capture targets fail closed. Localhost is the only implicit safe target;
 * every routed host must be explicitly named by the authorised operator.
 */
export function assertSafeLandingCaptureHost(
  baseURL: string,
  allowedHostsValue: string | undefined,
): void {
  const url = new URL(baseURL);
  const hostname = url.hostname.toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("E2E_BASE_URL must use HTTPS unless it is localhost.");
  }
  if (hostname.endsWith(PRODUCTION_HOST_SUFFIX)) {
    throw new Error("Replit deployment hosts are never valid capture targets.");
  }
  if (/prod|production|app\.cafa-pmis\.org/i.test(hostname)) {
    throw new Error("production hosts are never valid capture targets.");
  }
  if (isLocal) return;

  const allowedHosts = configuredHosts(allowedHostsValue);
  if (allowedHosts.size === 0) {
    throw new Error("E2E_LANDING_ALLOWED_HOSTS must name the authorised non-production host.");
  }
  if (!allowedHosts.has(hostname)) {
    throw new Error("E2E_BASE_URL is not in E2E_LANDING_ALLOWED_HOSTS.");
  }
}