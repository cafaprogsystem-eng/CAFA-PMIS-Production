import { isProductionEnv } from "./env";

const ALLOWED_ORIGIN_PROTOCOLS = new Set(["http:", "https:"]);

export type PublicAppOriginOptions = {
  required?: boolean;
};

export function isAllowedPublicOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  return !origin || allowedOrigins.includes(origin);
}

export function isAllowedCredentialedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  allowAllWhenEmpty = false,
): boolean {
  return (
    (allowAllWhenEmpty && allowedOrigins.length === 0) ||
    isAllowedPublicOrigin(origin, allowedOrigins)
  );
}

export function createCredentialedCorsOriginHandler(
  allowedOrigins: readonly string[],
  allowAllWhenEmpty = false,
) {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    if (isAllowedCredentialedOrigin(origin, allowedOrigins, allowAllWhenEmpty)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin rejected"));
  };
}

/**
 * Parse the credentialed CORS allowlist.
 *
 * PUBLIC_APP_URL is intentionally an origin list rather than an arbitrary URL:
 * paths, credentials, query strings, and wildcards cannot safely describe the
 * browser origin that is allowed to receive credentialed responses.
 */
export function parsePublicAppOrigins(
  value: string | undefined,
  options: PublicAppOriginOptions = {},
): string[] {
  const required = options.required ?? false;
  if (!value?.trim()) {
    if (required) {
      throw new Error("PUBLIC_APP_URL is required in production");
    }
    return [];
  }

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !entry)) {
    throw new Error("PUBLIC_APP_URL must contain only valid http(s) origins");
  }

  return [...new Set(entries.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error("PUBLIC_APP_URL must contain only valid http(s) origins");
    }

    const hasOnlyOrigin =
      (url.pathname === "" || url.pathname === "/") &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;

    if (!ALLOWED_ORIGIN_PROTOCOLS.has(url.protocol) || !hasOnlyOrigin) {
      throw new Error("PUBLIC_APP_URL must contain only valid http(s) origins");
    }

    return url.origin;
  }))];
}

/**
 * Return the validated public origins for the current runtime.
 *
 * Both HTTP and realtime credentialed CORS must use this same boot-time
 * policy. Production deliberately fails before either server can accept
 * traffic when the public origin is absent or malformed.
 */
export function getConfiguredPublicAppOrigins(): string[] {
  return parsePublicAppOrigins(process.env.PUBLIC_APP_URL, {
    required: isProductionEnv(),
  });
}
