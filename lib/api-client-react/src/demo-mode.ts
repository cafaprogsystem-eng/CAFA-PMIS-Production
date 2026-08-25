/**
 * The role-switch harness is deliberately unavailable unless a non-production
 * build explicitly enables it. The Vite build replaces this token with a
 * boolean; non-Vite consumers safely default to disabled.
 */
declare const __CAFA_DEMO_MODE_ENABLED__: boolean | undefined;

export function demoRoleHarnessEnabled(): boolean {
  return typeof __CAFA_DEMO_MODE_ENABLED__ !== "undefined"
    && __CAFA_DEMO_MODE_ENABLED__ === true;
}