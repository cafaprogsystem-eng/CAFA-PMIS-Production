/* ─────────────────────────────────────────────────────────────────────────
 * CAFA PMIS – Favorites
 * Pure TypeScript utilities for pinning/unpinning pages and records.
 * No React, no JSX — importable from anywhere.
 * ────────────────────────────────────────────────────────────────────────── */

import { isRetiredNavigationPath, type RecentItemType, type IconKey } from "./recent-items";

export type { RecentItemType, IconKey };

/* ─── Type ───────────────────────────────────────────────────────────────── */
export interface FavoriteItem {
  /** Stable unique ID: `${iconKey}:${path}` */
  id: string;
  type: RecentItemType;
  title: string;
  subtitle?: string;
  path: string;
  recordId?: number;
  iconKey: IconKey;
  iconBg: string;
  status?: string;
  /** Unix ms timestamp when pinned */
  pinnedAt: number;
}

/* ─── Cross-instance sync event ──────────────────────────────────────────── */
export const FAV_SYNC_EVENT = "cafa:favorites-updated";

/* ─── Storage key ────────────────────────────────────────────────────────── */
export function getFavStorageKey(userId: number): string {
  return `cafa:favorites:${userId}`;
}

/* ─── Validation ─────────────────────────────────────────────────────────── */
function isValidFavorite(raw: unknown): raw is FavoriteItem {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id       === "string" &&
    typeof r.title    === "string" &&
    typeof r.path     === "string" &&
    typeof r.iconKey  === "string" &&
    typeof r.pinnedAt === "number"
  );
}

/* ─── Storage operations ─────────────────────────────────────────────────── */

/** Load and validate stored favorites for a user. */
export function loadFavorites(userId: number | undefined): FavoriteItem[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getFavStorageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter(isValidFavorite).filter((item) => !isRetiredNavigationPath(item.path));
  } catch {
    return [];
  }
}

function saveFavorites(userId: number, items: FavoriteItem[]): void {
  try {
    localStorage.setItem(getFavStorageKey(userId), JSON.stringify(items));
  } catch { /* noop — storage full or private browsing */ }
}

/**
 * Pin an item. Deduplicates: if the same path is already pinned,
 * it updates metadata (title may have changed) and refreshes `pinnedAt`.
 */
export function addFavorite(userId: number, data: Omit<FavoriteItem, "id" | "pinnedAt">): void {
  if (isRetiredNavigationPath(data.path)) return;
  const id   = `${data.iconKey}:${data.path}`;
  const item: FavoriteItem = { ...data, id, pinnedAt: Date.now() };
  const rest = loadFavorites(userId).filter(f => f.id !== id);
  saveFavorites(userId, [item, ...rest]);
}

/** Remove a pinned item by its stable ID. No confirmation required. */
export function removeFavorite(userId: number, itemId: string): void {
  saveFavorites(userId, loadFavorites(userId).filter(f => f.id !== itemId));
}

/** Clear all favorites for a user (called on logout). */
export function clearFavorites(userId: number): void {
  try {
    localStorage.removeItem(getFavStorageKey(userId));
  } catch { /* noop */ }
}

/* ─── Ranking helpers ────────────────────────────────────────────────────── */

/**
 * Compute a rank score for a given path.
 * Higher score = should appear earlier in results.
 * Used to boost API search results that are pinned or frequently visited.
 */
export function rankScore(
  path: string,
  favorites: FavoriteItem[],
  recentMap: Map<string, number>,  // path → openCount
): number {
  let score = 0;
  if (favorites.some(f => f.path === path)) score += 100;
  score += (recentMap.get(path) ?? 0) * 5;
  return score;
}

/**
 * Build a quick-lookup map of path → openCount from recent items.
 * Accepts any array of objects that have `path` and optional `openCount`.
 */
export function buildRecentMap(
  recentItems: Array<{ path: string; openCount?: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of recentItems) {
    map.set(item.path, item.openCount ?? 1);
  }
  return map;
}
