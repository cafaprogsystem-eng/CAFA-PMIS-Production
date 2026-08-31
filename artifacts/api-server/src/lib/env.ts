const RECOGNIZED_NODE_ENVS = new Set(["production", "development", "test"]);

/**
 * A single validated read of NODE_ENV, used everywhere a security control —
 * CORS credentials, rate limiting, the session cookie's `secure` flag,
 * required-config checks — decides whether the app is running in production.
 *
 * Every one of those call sites used to compare `process.env.NODE_ENV`
 * against the literal string "production" independently. A typo, an unset
 * variable, or a deploy platform's own environment name (e.g. "staging")
 * would silently fail every comparison at once and simultaneously disable
 * several protections. Routing all of them through this function means a
 * mis-set NODE_ENV throws immediately, the first time any of them runs,
 * instead of degrading security in a way nothing detects.
 *
 * Reads `process.env.NODE_ENV` fresh on every call (not cached at import
 * time) so tests that flip it between cases continue to work unchanged.
 */
export function isProductionEnv(raw: string | undefined = process.env.NODE_ENV): boolean {
  if (raw !== undefined && !RECOGNIZED_NODE_ENVS.has(raw)) {
    throw new Error(
      `NODE_ENV is set to an unrecognized value ("${raw}"). Expected one of: ` +
        `${[...RECOGNIZED_NODE_ENVS].join(", ")}. Refusing to guess whether this is ` +
        "production, since that silently controls CORS, rate limiting, and cookie security.",
    );
  }
  return raw === "production";
}
