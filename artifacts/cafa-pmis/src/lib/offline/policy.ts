/**
 * The single source of truth for what the browser may do without a live API.
 *
 * This is deliberately allow-list based. A new endpoint is online-only until
 * it is reviewed and added here, rather than accidentally becoming queueable.
 */

export type OfflinePolicyDecision =
  | { kind: "allowed-read"; reason: "authorised-read" }
  | { kind: "allowed-draft"; reason: "draft-save" }
  | { kind: "blocked"; reason: string };

const READ_PATHS = [
  /^\/api\/me(?:[/?#]|$)/,
  /^\/api\/states(?:[/?#]|$)/,
  /^\/api\/sectors(?:[/?#]|$)/,
  /^\/api\/manual\/(?:chapters|sections)(?:[/?#]|$)/,
  /^\/api\/projects(?:[/?#]|$)/,
  /^\/api\/plans(?:[/?#]|$)/,
  /^\/api\/risks(?:[/?#]|$)/,
  /^\/api\/reports(?:[/?#]|$)/,
  /^\/api\/activities(?:[/?#]|$)/,
  /^\/api\/indicators(?:[/?#]|$)/,
  /^\/api\/outputs(?:[/?#]|$)/,
  /^\/api\/users\/switcher(?:[/?#]|$)/,
  /^\/api\/dashboard\/(?:summary|agenda)(?:[/?#]|$)/,
] as const;

const DRAFT_ROOTS = [
  /^\/api\/projects(?:\/\d+)?$/,
  /^\/api\/plans(?:\/\d+)?$/,
  /^\/api\/risks(?:\/\d+)?$/,
  /^\/api\/reports(?:\/\d+)?$/,
] as const;

const WORKFLOW_WORDS = [
  "submit",
  "approve",
  "return",
  "reject",
  "transition",
  "request_revision",
  "final_approve",
];

// A form may keep operational notes locally, but no caller can use the shared
// queue to defer finance, attachments, or lifecycle work.
const ONLINE_ONLY_DRAFT_KEYS = new Set([
  "budgettotal", "budgetplanned", "budgetactual", "budgetspent", "budgetallocation",
  "directcost", "indirectcost", "cafacontribution", "currency",
  "stateallocations", "allocation", "allocations",
  "documents", "attachments", "drivefileid", "objectpath",
  "closeregistration", "registrationtoken", "status", "progresspct",
]);

function hasOnlineOnlyDraftField(body: string | null): boolean {
  if (!body) return false;
  try {
    const visit = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(visit);
      if (!value || typeof value !== "object") return false;
      return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
        ONLINE_ONLY_DRAFT_KEYS.has(key.toLowerCase()) || visit(child),
      );
    };
    return visit(JSON.parse(body));
  } catch {
    return true;
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

export function isAuthorisedOfflineRead(url: string): boolean {
  const pathname = pathnameOf(url);
  return READ_PATHS.some((pattern) => pattern.test(pathname));
}

export function isQueueableDraftMutation(
  method: string,
  url: string,
  body: string | null,
): boolean {
  const upperMethod = method.toUpperCase();
  if (!["POST", "PATCH", "PUT"].includes(upperMethod)) return false;
  const pathname = pathnameOf(url);
  if (!DRAFT_ROOTS.some((pattern) => pattern.test(pathname))) return false;
  if (hasOnlineOnlyDraftField(body)) return false;
  const lower = `${pathname} ${body ?? ""}`.toLowerCase();
  return !WORKFLOW_WORDS.some((word) => lower.includes(word));
}

export function explainOfflinePolicy(
  method: string,
  url: string,
  body: string | null,
): OfflinePolicyDecision {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    return isAuthorisedOfflineRead(url)
      ? { kind: "allowed-read", reason: "authorised-read" }
      : { kind: "blocked", reason: "This data requires an internet connection" };
  }
  return isQueueableDraftMutation(method, url, body)
    ? { kind: "allowed-draft", reason: "draft-save" }
    : { kind: "blocked", reason: "This action requires an internet connection" };
}
