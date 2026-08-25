import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getStorageKey,
  isRetiredNavigationPath,
  loadItems,
  recordItem,
} from "../lib/recent-items";
import {
  addFavorite,
  getFavStorageKey,
  loadFavorites,
} from "../lib/favorites";

const root = join(process.cwd(), "src");
const app = readFileSync(join(root, "App.tsx"), "utf8");
const layout = readFileSync(join(root, "components/layout.tsx"), "utf8");
const palette = readFileSync(join(root, "components/command-palette.tsx"), "utf8");
const globalSearch = readFileSync(join(root, "components/global-search.tsx"), "utf8");
const enNav = JSON.parse(readFileSync(join(root, "locales/en/nav.json"), "utf8"));
const arNav = JSON.parse(readFileSync(join(root, "locales/ar/nav.json"), "utf8"));
const enCommon = JSON.parse(readFileSync(join(root, "locales/en/common.json"), "utf8"));
const arCommon = JSON.parse(readFileSync(join(root, "locales/ar/common.json"), "utf8"));

describe("DESIGN-SYSTEM-RETIRE — user-facing showcase removal", () => {
  beforeEach(() => localStorage.clear());

  it("DS-01/02 — removes the showcase route and all shell navigation destinations", () => {
    expect(app).not.toContain('path="/design-system"');
    expect(app).not.toContain("pages/design-system");
    expect(app).toContain("<Route component={NotFound} />");
    expect(existsSync(join(root, "pages/design-system.tsx"))).toBe(false);
    expect(layout).not.toContain('"/design-system"');
    expect(layout).not.toContain("items.designSystem");
    expect(palette).not.toContain('href: "/design-system"');
    expect(palette).not.toContain("items.designSystem");
  });

  it("DS-03/04 — removes page-only translations while keeping search surfaces on the shared saved-navigation hooks", () => {
    expect(enNav.items.designSystem).toBeUndefined();
    expect(arNav.items.designSystem).toBeUndefined();
    expect(enNav.cmdSubtitles.designSystem).toBeUndefined();
    expect(arNav.cmdSubtitles.designSystem).toBeUndefined();
    expect(enCommon.designSystem).toBeUndefined();
    expect(arCommon.designSystem).toBeUndefined();
    expect(globalSearch).toContain("useRecentItems()");
    expect(globalSearch).toContain("useFavorites()");
  });

  it("DS-05/06 — ignores historic saved links and prevents the retired route returning through storage", () => {
    expect(isRetiredNavigationPath("/design-system")).toBe(true);
    expect(isRetiredNavigationPath("/design-system?tab=tokens")).toBe(true);
    expect(isRetiredNavigationPath("/projects")).toBe(false);

    localStorage.setItem(getStorageKey(7), JSON.stringify([
      { id: "design-system:/design-system", type: "page", title: "Design System", path: "/design-system", iconKey: "page", iconBg: "bg-muted", ts: 1 },
      { id: "dashboard:/dashboard", type: "page", title: "Dashboard", path: "/dashboard", iconKey: "dashboard", iconBg: "bg-primary/10", ts: 2 },
    ]));
    localStorage.setItem(getFavStorageKey(7), JSON.stringify([
      { id: "design-system:/design-system", type: "page", title: "Design System", path: "/design-system", iconKey: "page", iconBg: "bg-muted", pinnedAt: 1 },
    ]));

    recordItem(7, { type: "page", title: "Design System", path: "/design-system", iconKey: "page", iconBg: "bg-muted" });
    addFavorite(7, { type: "page", title: "Design System", path: "/design-system", iconKey: "page", iconBg: "bg-muted" });

    expect(loadItems(7).map((item) => item.path)).toEqual(["/dashboard"]);
    expect(loadFavorites(7)).toEqual([]);
  });
});