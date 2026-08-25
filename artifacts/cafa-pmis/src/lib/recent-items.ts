/* ─────────────────────────────────────────────────────────────────────────
 * CAFA PMIS – Recent Items
 * Pure TypeScript utilities for tracking, storing, and retrieving recently
 * visited pages and records.  No React, no JSX — importable from anywhere.
 * ────────────────────────────────────────────────────────────────────────── */

/* ─── Types ──────────────────────────────────────────────────────────────── */
export type RecentItemType =
  | "page"
  | "project"
  | "plan"
  | "report"
  | "risk"
  | "document"
  | "user"
  | "conversation";

export type IconKey =
  | "dashboard" | "projects" | "plans" | "reports" | "risks"
  | "budget" | "notifications" | "messages" | "users" | "states"
  | "audit" | "sops" | "drive" | "manual" | "ai"
  | "conversation" | "sync" | "page";

export interface RecentItem {
  /** Stable unique ID: `${iconKey}:${path}` */
  id: string;
  type: RecentItemType;
  title: string;
  subtitle?: string;
  path: string;
  recordId?: number;
  iconKey: IconKey;
  /** Tailwind bg class, e.g. "bg-blue-500/10" */
  iconBg: string;
  status?: string;
  /** Unix ms timestamp of last visit */
  ts: number;
  /** Number of times this item has been opened (for frequency ranking) */
  openCount?: number;
}

/* ─── Limits ─────────────────────────────────────────────────────────────── */
export const RECENT_GLOBAL_LIMIT = 20;
export const RECENT_TYPE_LIMITS: Partial<Record<RecentItemType, number>> = {
  project: 10,
  plan:    10,
  report:  10,
  risk:    10,
};

/* ─── Storage key ────────────────────────────────────────────────────────── */
/** One key per user; never mix histories across accounts. */
export function getStorageKey(userId: number): string {
  return `cafa:recent:${userId}`;
}

/* ─── Icon background map ────────────────────────────────────────────────── */
export const ICON_BG: Record<IconKey, string> = {
  dashboard:          "bg-primary/10",
  projects:           "bg-blue-500/10",
  plans:              "bg-violet-500/10",
  reports:            "bg-amber-500/10",
  risks:              "bg-red-500/10",
  budget:             "bg-green-500/10",
  notifications:      "bg-sky-500/10",
  messages:           "bg-cyan-500/10",
  users:              "bg-purple-500/10",
  states:             "bg-emerald-500/10",
  audit:              "bg-rose-500/10",
  sops:               "bg-orange-500/10",
  drive:              "bg-teal-500/10",
  manual:             "bg-indigo-500/10",
  ai:                "bg-violet-500/10",
  conversation:       "bg-cyan-500/10",
  sync:               "bg-blue-500/10",
  page:               "bg-muted",
};

/* ─── Path → metadata inference ─────────────────────────────────────────── */
interface InferredMeta {
  type:     RecentItemType;
  iconKey:  IconKey;
  iconBg:   string;
  subtitle?: string;
  recordId?: number;
}

export function inferItemMeta(path: string): InferredMeta {
  const parts   = path.split("/").filter(Boolean);
  const first   = parts[0] ?? "";
  const second  = parts[1];
  const recordId = second && /^\d+$/.test(second) ? parseInt(second, 10) : undefined;

  const resolved = (type: RecentItemType, iconKey: IconKey, subtitle?: string): InferredMeta =>
    ({ type, iconKey, iconBg: ICON_BG[iconKey], subtitle, recordId });

  if (!first)                         return resolved("page", "dashboard", "Overview & analytics");
  if (first === "projects")           return resolved("project", "projects", recordId ? `Project #${recordId}` : "All projects");
  if (first === "plans")              return resolved("plan", "plans",    recordId ? `Plan #${recordId}` : "All plans");
  if (first === "reports")            return resolved("report", "reports", "Programme reports");
  if (first === "risks")              return resolved("risk", "risks",    "Risk register");
  if (first === "budget")             return resolved("page", "budget",   "Budgets");
  if (first === "notifications")      return resolved("page", "notifications", "Your notifications");
  if (first === "messages")           return resolved("conversation", "messages", recordId ? `Conversation #${recordId}` : "Communication Centre");
  if (first === "users")              return resolved("page", "users",   "User management");
  if (first === "states")             return resolved("page", "states",  recordId ? `State #${recordId}` : "State offices");
  if (first === "audit-log")          return resolved("page", "audit",   "Activity history");
  if (first === "document-management") return resolved("page", "drive", "File & Archive");
  if (first === "drive")              return resolved("page", "drive",   "File & Archive");
  if (first === "program-resources")  return resolved("page", "drive",   "File & Archive");
  if (first === "manual")             return resolved("page", "manual",  "System manual");
  if (first === "ai")                return resolved("page", "ai", "AI assistant and administration");
  if (first === "sync-status")        return resolved("page", "sync",   "Offline sync status");
  if (first === "profile")            return resolved("page", "users",  "Your profile");
  return resolved("page", "page");
}

/* ─── Validation ─────────────────────────────────────────────────────────── */
/**
 * Retired destinations must not be retained or revived through saved
 * navigation. Strip a query/hash first so old bookmarks are treated the same
 * way as the exact legacy path.
 */
export function isRetiredNavigationPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname === "/design-system" || pathname.startsWith("/design-system/");
}

function isValidItem(raw: unknown): raw is RecentItem {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string"    &&
    typeof r.title === "string" &&
    typeof r.path === "string"  &&
    typeof r.iconKey === "string" &&
    typeof r.ts === "number"
  );
}

/* ─── Storage operations ─────────────────────────────────────────────────── */

/** Load and validate stored items for a user. Returns [] on any error. */
export function loadItems(userId: number | undefined): RecentItem[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter(isValidItem).filter((item) => !isRetiredNavigationPath(item.path));
  } catch {
    return [];
  }
}

function saveItems(userId: number, items: RecentItem[]): void {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(items));
  } catch { /* noop — storage full or private browsing */ }
}

/**
 * Record a page visit.
 * - Moves existing entry to top (dedup by ID).
 * - Applies per-type and global limits.
 */
export function recordItem(userId: number, data: Omit<RecentItem, "id" | "ts" | "openCount">): void {
  if (isRetiredNavigationPath(data.path)) return;
  const id = `${data.iconKey}:${data.path}`;
  const existing = loadItems(userId).find(i => i.id === id);
  const openCount = (existing?.openCount ?? 0) + 1;
  const newItem: RecentItem = { ...data, id, ts: Date.now(), openCount };

  let items = loadItems(userId);
  // Remove existing entry with same id
  items = items.filter(i => i.id !== id);
  // Prepend
  items = [newItem, ...items];

  // Apply per-type limits (projects, plans, reports, risks)
  const typeCounts: Partial<Record<RecentItemType, number>> = {};
  items = items.filter(item => {
    const limit = RECENT_TYPE_LIMITS[item.type];
    if (!limit) return true;
    const count = (typeCounts[item.type] ?? 0) + 1;
    typeCounts[item.type] = count;
    return count <= limit;
  });

  // Apply global limit
  items = items.slice(0, RECENT_GLOBAL_LIMIT);

  saveItems(userId, items);
}

/** Remove a single item by its stable ID. */
export function removeItem(userId: number, itemId: string): void {
  const items = loadItems(userId).filter(i => i.id !== itemId);
  saveItems(userId, items);
}

/**
 * Clear all recent history for a user.
 * Called on logout and (optionally) on user-switch.
 */
export function clearItems(userId: number): void {
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch { /* noop */ }
}

/* ─── Relative time helper ───────────────────────────────────────────────── */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s  = Math.floor(diff / 1000);
  const m  = Math.floor(s  / 60);
  const h  = Math.floor(m  / 60);
  const d  = Math.floor(h  / 24);
  if (s  < 60)  return "just now";
  if (m  < 60)  return `${m}m ago`;
  if (h  < 24)  return `${h}h ago`;
  if (d  === 1) return "yesterday";
  if (d  < 7)   return `${d} days ago`;
  if (d  < 14)  return "last week";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ISO string for aria-label / title attribute. */
export function isoDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
