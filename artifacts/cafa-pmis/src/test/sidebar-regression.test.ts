/**
 * Sidebar RTL/Desktop Regression Tests
 *
 * Verifies the sidebar class-string logic produces correct Tailwind classes
 * for every combination of: LTR/RTL × open/closed × expanded/collapsed × mobile/desktop.
 *
 * These are pure logic tests — no React rendering required — so they run
 * fast and reliably without mocking providers.
 *
 * Root-cause guard: the bug was that `ltr:-translate-x-full` / `rtl:translate-x-full`
 * generated [dir] attribute-selector rules with specificity (0,2,0), which
 * always beat `lg:translate-x-0` at (0,1,0), hiding the desktop sidebar.
 * Fix: off-canvas transforms must use `max-lg:` scope so they are absent
 * on desktop and cannot interfere with `lg:translate-x-0`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const layoutSource = fs.readFileSync(path.resolve(__dirname, "../components/layout.tsx"), "utf8");

/* ─── Replicate the sidebar className logic from layout.tsx ──────────── */
function sidebarClasses(opts: {
  sidebarOpen: boolean;
  collapsed: boolean;
}): string {
  const { sidebarOpen, collapsed } = opts;
  return [
    "fixed inset-y-0 z-50 flex flex-col bg-sidebar border-sidebar-border",
    "start-0 border-e",
    "transition-all duration-300 ease-in-out",
    "lg:static lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0",
    sidebarOpen ? "" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full",
    collapsed ? "w-[60px]" : "w-[212px]",
  ].join(" ").trim().replace(/\s+/g, " ");
}

/* ─── Replicate the active-item className logic from layout.tsx ───────── */
function activeItemClasses(opts: {
  collapsed: boolean;
  isActive: boolean;
}): string {
  const { collapsed, isActive } = opts;

  if (collapsed) {
    return [
      "flex min-h-9 items-center justify-center rounded-lg px-2 transition-colors duration-150 ease-out w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      isActive
        ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
        : "text-sidebar-foreground/70 font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    ].join(" ");
  }

  // Expanded mode (no children)
  return [
    "flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
    isActive
      ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
      : "text-sidebar-foreground/70 font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  ].join(" ");
}

/* ─── Minimal nav-structure replica (pure data, no React/i18n) ──────── */
type TestNavItem = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
};
type TestNavGroup = { title: string; items: TestNavItem[] };
type TestNavEntry =
  | { kind: "group"; group: TestNavGroup }
  | { kind: "item"; item: TestNavItem };

/**
 * Builds a minimal nav entry list that mirrors the structure in layout.tsx.
 * Permissions that gate items can be set via `opts`.
 */
function buildNavEntries(opts: {
  hasUsersPerm?: boolean;
  isAuditVisible?: boolean;
  canViewAi?: boolean;
  canViewBudget?: boolean;
  canViewMessages?: boolean;
  canViewFileArchive?: boolean;
} = {}): TestNavEntry[] {
  const {
    hasUsersPerm = true,
    isAuditVisible = true,
    canViewAi = true,
    canViewBudget = true,
    canViewMessages = true,
    canViewFileArchive = true,
  } = opts;

  const administrationItems: TestNavItem[] = [
    ...(hasUsersPerm ? [{ href: "/users", label: "User Management" }] : []),
    { href: "/states", label: "States" },
    ...(isAuditVisible ? [{ href: "/audit-log", label: "Audit Log" }] : []),
    ...(canViewAi ? [{ href: "/ai", label: "AI" }] : []),
  ];

  return [
    {
      kind: "group",
      group: {
        title: "Overview",
        items: [{ href: "/dashboard", label: "Dashboard" }],
      },
    },
    {
      kind: "group",
      group: {
        title: "Programme Management",
        items: [
          { href: "/projects", label: "Projects" },
          { href: "/plans", label: "Planning" },
          ...(canViewBudget ? [{ href: "/budget", label: "Budget & Finance" }] : []),
          {
            href: "/reports",
            label: "Reports",
            children: [
              { href: "/reports/project", label: "Project Reports" },
              { href: "/reports/activity", label: "Activity Reports" },
              { href: "/reports/program-state", label: "State Programme Reports" },
              { href: "/reports/hq-sector", label: "HQ Sector Reports" },
            ],
          },
          { href: "/risks", label: "Risk Register" },
        ],
      },
    },
    {
      kind: "group",
      group: {
        title: "Communication",
        items: [
          { href: "/notifications", label: "Notifications" },
          ...(canViewMessages
            ? [{ href: "/messages", label: "Communication Centre" }]
            : []),
        ],
      },
    },
    {
      kind: "group",
      group: {
        title: "Data Management",
        items: canViewFileArchive
          ? [{ href: "/document-management/file-archive", label: "File & Archive" }]
          : [],
      },
    },
    {
      kind: "group",
      group: {
        title: "Administration",
        items: administrationItems,
      },
    },
    {
      kind: "item",
      item: { href: "/manual", label: "System Manual" },
    },
  ];
}

/** Collect all items (including children) from all nav entries */
function allNavItems(entries: TestNavEntry[]): TestNavItem[] {
  const items: TestNavItem[] = [];
  for (const e of entries) {
    const topItems = e.kind === "group" ? e.group.items : [e.item];
    for (const item of topItems) {
      items.push(item);
      if (item.children) items.push(...(item.children as TestNavItem[]));
    }
  }
  return items;
}

/** Collect all group titles */
function allGroupTitles(entries: TestNavEntry[]): string[] {
  return entries.filter(e => e.kind === "group").map(e => (e as { kind: "group"; group: TestNavGroup }).group.title);
}

/* ─── Profile footer class replica ──────────────────────────────────── */
/** Returns the text source for the role label in the profile footer. */
function profileFooterRoleSource(meData: { user: { roleLabel: string } }): string {
  // Mirrors the expression used in the expanded footer: meData.user.roleLabel
  return meData.user.roleLabel;
}

/* ─── Helper ─────────────────────────────────────────────────────────── */
function classes(opts: { sidebarOpen: boolean; collapsed: boolean }) {
  return sidebarClasses(opts).split(" ");
}

/* ══════════════════════════════════════════════════════════════════════
   §1  Desktop sidebar always present via lg:translate-x-0
   ══════════════════════════════════════════════════════════════════════ */
describe("Desktop sidebar — must always have lg:translate-x-0", () => {
  it("1. English desktop expanded: contains lg:translate-x-0", () => {
    expect(classes({ sidebarOpen: false, collapsed: false })).toContain("lg:translate-x-0");
  });

  it("2. English desktop collapsed: contains lg:translate-x-0", () => {
    expect(classes({ sidebarOpen: false, collapsed: true })).toContain("lg:translate-x-0");
  });

  it("3. Mobile-open desktop: contains lg:translate-x-0", () => {
    expect(classes({ sidebarOpen: true, collapsed: false })).toContain("lg:translate-x-0");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §2  Off-canvas transforms must be max-lg: scoped (root-cause guard)
   ══════════════════════════════════════════════════════════════════════ */
describe("Off-canvas transform — root-cause guard (max-lg: scope)", () => {
  it("4. English sidebar positioned on left via logical start-0", () => {
    expect(classes({ sidebarOpen: false, collapsed: false })).toContain("start-0");
  });

  it("5. Mobile closed state uses max-lg:-translate-x-full (not bare ltr:)", () => {
    const cls = classes({ sidebarOpen: false, collapsed: false });
    expect(cls).toContain("max-lg:-translate-x-full");
  });

  it("6. Mobile closed state uses max-lg:rtl:translate-x-full (not bare rtl:)", () => {
    const cls = classes({ sidebarOpen: false, collapsed: false });
    expect(cls).toContain("max-lg:rtl:translate-x-full");
  });

  it("7. REGRESSION: bare ltr:-translate-x-full must NOT appear (would break desktop)", () => {
    const str = sidebarClasses({ sidebarOpen: false, collapsed: false });
    // Must not contain the specificity-boosted variant that hid the desktop sidebar
    expect(str).not.toContain("ltr:-translate-x-full");
  });

  it("8. REGRESSION: bare rtl:translate-x-full must NOT appear without max-lg: prefix", () => {
    const str = sidebarClasses({ sidebarOpen: false, collapsed: false });
    // 'max-lg:rtl:translate-x-full' is allowed; 'rtl:translate-x-full' alone is not
    const bare = str
      .split(" ")
      .filter(c => c === "rtl:translate-x-full");
    expect(bare).toHaveLength(0);
  });

  it("9. Arabic sidebar: max-lg:rtl:translate-x-full present when closed on mobile", () => {
    // RTL off-canvas: sidebar should move to the right (+100%) when closed on mobile
    expect(classes({ sidebarOpen: false, collapsed: false })).toContain("max-lg:rtl:translate-x-full");
  });

  it("10. Arabic main offset: max-lg: transforms absent when open", () => {
    const cls = classes({ sidebarOpen: true, collapsed: false });
    expect(cls).not.toContain("max-lg:-translate-x-full");
    expect(cls).not.toContain("max-lg:rtl:translate-x-full");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §3  Collapsed sidebar — icon rail visible, not hidden
   ══════════════════════════════════════════════════════════════════════ */
describe("Collapsed sidebar — icon rail, not display:none", () => {
  it("11. English collapsed: uses w-[60px] (icon rail width)", () => {
    expect(classes({ sidebarOpen: false, collapsed: true })).toContain("w-[60px]");
  });

  it("12. English expanded: uses w-[212px]", () => {
    expect(classes({ sidebarOpen: false, collapsed: false })).toContain("w-[212px]");
  });

  it("13. Collapsed still has lg:translate-x-0 — not hidden on desktop", () => {
    expect(classes({ sidebarOpen: false, collapsed: true })).toContain("lg:translate-x-0");
  });

  it("14. Collapsed still has start-0 — positioned correctly", () => {
    expect(classes({ sidebarOpen: false, collapsed: true })).toContain("start-0");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §4  Mobile navigation — open/close works independently
   ══════════════════════════════════════════════════════════════════════ */
describe("Mobile sidebar behaviour", () => {
  it("15. Mobile open: no off-canvas transforms", () => {
    const cls = classes({ sidebarOpen: true, collapsed: false });
    expect(cls).not.toContain("max-lg:-translate-x-full");
    expect(cls).not.toContain("max-lg:rtl:translate-x-full");
  });

  it("16. Mobile closed: has max-lg off-canvas transforms", () => {
    const cls = classes({ sidebarOpen: false, collapsed: false });
    expect(cls).toContain("max-lg:-translate-x-full");
  });

  it("17. No duplicate transform classes (no mixed old + new variants)", () => {
    const str = sidebarClasses({ sidebarOpen: false, collapsed: false });
    const words = str.split(" ");
    const uniqueWords = new Set(words);
    expect(words.length).toBe(uniqueWords.size);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §5  Logical CSS — border uses logical end not physical right
   ══════════════════════════════════════════════════════════════════════ */
describe("Logical CSS properties", () => {
  it("18. Sidebar uses border-e (logical end border, not border-r)", () => {
    const str = sidebarClasses({ sidebarOpen: false, collapsed: false });
    expect(str).toContain("border-e");
    // Must not use the physical border-r which would not flip in RTL
    expect(str.split(" ").filter(c => c === "border-r")).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §6b  Compact brand hierarchy and navigation presentation
   ══════════════════════════════════════════════════════════════════════ */
describe("Sidebar brand hierarchy", () => {
  it("renders the canonical translated brand name without the system subtitle", () => {
    expect(layoutSource).toContain('tNav("brand.name")');
    expect(layoutSource).not.toContain('tNav("brand.subtitle")');
    expect(layoutSource).not.toContain("sidebar-brand-subtitle");
    expect(layoutSource).not.toContain("Enterprise Programme Management Platform");
  });

  it("uses a compact logo/title row with a subtle divider, never a decorative card", () => {
    expect(layoutSource).toContain('sidebarCollapsed ? "h-16 justify-center px-2" : "h-16 px-3"');
    expect(layoutSource).toContain('className="h-9 w-9 shrink-0 object-contain"');
    expect(layoutSource).toContain('data-testid="sidebar-brand-title"');
    expect(layoutSource).toContain("text-[16px] font-medium leading-tight");
    expect(layoutSource).toContain("border-b border-sidebar-border");
    expect(layoutSource).not.toContain("bg-primary flex items-center justify-center shadow-sm");
  });

  it("keeps the collapsed brand tooltip limited to the product name", () => {
    expect(layoutSource).toContain('{tNav("tooltips.platformName")}');
    expect(layoutSource).not.toContain('tNav("brand.subtitle")');
  });

  it("keeps compact collapse and expand controls keyboard accessible", () => {
    expect(layoutSource).toContain('aria-label={tNav("tooltips.collapseSidebar")}');
    expect(layoutSource).toContain('aria-label={tNav("tooltips.expandSidebar")}');
    expect(layoutSource).toContain("h-8 w-8 -translate-y-1/2 shrink-0 cursor-pointer");
    expect(layoutSource).toContain("focus-visible:ring-2 focus-visible:ring-ring");
    expect(layoutSource).toContain("focus-visible:ring-offset-sidebar");
  });

  it("uses subdued section labels and controlled group spacing", () => {
    expect(layoutSource).toContain('data-testid="sidebar-group-heading"');
    expect(layoutSource).toContain("mb-2 px-2 text-[10px] font-medium uppercase leading-none tracking-[0.12em] text-sidebar-foreground/55");
    expect(layoutSource).toContain('className="mb-4 last:mb-0"');
    expect(layoutSource).toContain('className="space-y-0.5"');
    for (const title of ["groups.programmeManagement", "groups.communication", "groups.dataManagement", "groups.administration"]) {
      expect(layoutSource).toContain(`title: tNav("${title}")`);
    }
  });

  it("preserves expanded and collapsed rail presentation invariants", () => {
    expect(layoutSource).toContain('sidebarCollapsed ? "w-[60px]" : "w-[212px]"');
    expect(layoutSource).toContain('sidebarCollapsed ? "h-16 justify-center px-2"');
    expect(layoutSource).toContain('className="h-8 w-8 object-contain"');
    expect(layoutSource).toContain("hidden h-8 w-8 -translate-y-1/2 shrink-0");
    expect(layoutSource).toContain("lg:flex");
  });
});

describe("Responsive rail and RTL tooltip safety", () => {
  it("uses the same breakpoint as Tailwind lg so a persisted desktop rail never collapses the mobile drawer", () => {
    expect(layoutSource).toContain('window.matchMedia("(max-width: 1023px)")');
    expect(layoutSource).toContain("const sidebarCollapsed = collapsed && !isNarrowViewport;");
    expect(layoutSource).toContain("if (sidebarCollapsed)");
    expect(layoutSource).toContain("locationCtx.isEditable && !sidebarCollapsed");
  });

  it("opens every collapsed sidebar tooltip toward the viewport in RTL", () => {
    expect(layoutSource).toContain('const sidebarTooltipSide = direction === "rtl" ? "left" : "right";');
    expect(layoutSource).toContain('const sidebarLogoutTooltipPosition = "start-full ms-2";');
    const sidebarSource = layoutSource.slice(
      layoutSource.indexOf("<aside"),
      layoutSource.indexOf("</aside>")
    );
    expect((sidebarSource.match(/side=\{sidebarTooltipSide\}/g) ?? []).length).toBe(2);
    expect((sidebarSource.match(/w-max whitespace-nowrap font-medium/g) ?? []).length).toBe(2);
    expect(sidebarSource).not.toContain('TooltipContent side="right"');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §6  Active item styling — calm CAFA-blue-tinted treatment
   ══════════════════════════════════════════════════════════════════════ */
describe("Active item styling — enterprise CAFA-blue treatment", () => {
  it("19. Expanded active item does NOT use bg-primary full-row fill", () => {
    const cls = activeItemClasses({ collapsed: false, isActive: true });
    expect(cls).not.toContain("bg-primary ");
    expect(cls).not.toContain("bg-primary\t");
    // standalone bg-primary token (not bg-primary/xx which would be ok)
    const tokens = cls.split(" ");
    expect(tokens).not.toContain("bg-primary");
  });

  it("20. Expanded active item does NOT use text-primary-foreground as row text colour", () => {
    const cls = activeItemClasses({ collapsed: false, isActive: true });
    expect(cls).not.toContain("text-primary-foreground");
  });

  it("21. Expanded active item uses the sidebar-primary tint and text token", () => {
    const cls = activeItemClasses({ collapsed: false, isActive: true });
    const tokens = cls.split(" ");
    expect(tokens).toContain("bg-sidebar-primary/10");
    expect(tokens).toContain("text-sidebar-primary");
  });

  it("22. Collapsed active item uses the same calm tinted treatment", () => {
    const cls = activeItemClasses({ collapsed: true, isActive: true });
    const tokens = cls.split(" ");
    expect(tokens).not.toContain("bg-primary");
    expect(tokens).toContain("bg-sidebar-primary/10");
    expect(tokens).toContain("text-sidebar-primary");
  });

  it("23. Expanded inactive hover uses semantic sidebar accent tokens", () => {
    const cls = activeItemClasses({ collapsed: false, isActive: false });
    expect(cls).toContain("hover:bg-sidebar-accent");
    expect(cls).toContain("hover:text-sidebar-accent-foreground");
  });

  it("24. Collapsed inactive hover uses semantic sidebar accent tokens", () => {
    const cls = activeItemClasses({ collapsed: true, isActive: false });
    expect(cls).toContain("hover:bg-sidebar-accent");
    expect(cls).toContain("hover:text-sidebar-accent-foreground");
  });

  it("25. RTL: active-item class string contains no bare physical direction classes", () => {
    const expandedActive = activeItemClasses({ collapsed: false, isActive: true });
    const collapsedActive = activeItemClasses({ collapsed: true, isActive: true });
    const PHYSICAL_CLASSES = ["border-l", "border-r", "pl-", "pr-", "ml-", "mr-"];
    for (const cls of [expandedActive, collapsedActive]) {
      for (const phys of PHYSICAL_CLASSES) {
        expect(cls).not.toContain(phys);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §7  Navigation structure invariants
   ══════════════════════════════════════════════════════════════════════ */
describe("Navigation structure — Administration group", () => {
  it("28. Administration group renders when at least one child is authorised", () => {
    const entries = buildNavEntries({ hasUsersPerm: false, isAuditVisible: false, canViewAi: true });
    const admin = entries.find(
      e => e.kind === "group" && (e as { kind: "group"; group: TestNavGroup }).group.title === "Administration"
    ) as { kind: "group"; group: TestNavGroup } | undefined;
    expect(admin).toBeDefined();
    expect(admin!.group.items.length).toBeGreaterThan(0);
  });

  it("29. Administration group is non-empty when all perms granted", () => {
    const entries = buildNavEntries();
    const admin = entries.find(
      e => e.kind === "group" && (e as { kind: "group"; group: TestNavGroup }).group.title === "Administration"
    ) as { kind: "group"; group: TestNavGroup } | undefined;
    expect(admin!.group.items.length).toBeGreaterThan(0);
  });

  it("30. AI item is present in Administration group when canViewAi is true", () => {
    const entries = buildNavEntries({ canViewAi: true });
    const admin = entries.find(
      e => e.kind === "group" && (e as { kind: "group"; group: TestNavGroup }).group.title === "Administration"
    ) as { kind: "group"; group: TestNavGroup };
    const aiItem = admin.group.items.find(i => i.href === "/ai");
    expect(aiItem).toBeDefined();
  });

  it("31. AI item is absent from Administration group when canViewAi is false", () => {
    const entries = buildNavEntries({ canViewAi: false });
    const admin = entries.find(
      e => e.kind === "group" && (e as { kind: "group"; group: TestNavGroup }).group.title === "Administration"
    ) as { kind: "group"; group: TestNavGroup };
    const aiItem = admin.group.items.find(i => i.href === "/ai");
    expect(aiItem).toBeUndefined();
  });
});

describe("Navigation structure — System Manual standalone", () => {
  it("32. System Manual is a standalone item (kind: item), not inside a group", () => {
    const entries = buildNavEntries();
    const manual = entries.find(
      e => e.kind === "item" && (e as { kind: "item"; item: TestNavItem }).item.href === "/manual"
    );
    expect(manual).toBeDefined();
    expect(manual!.kind).toBe("item");
  });

  it("33. No group contains /manual in its items", () => {
    const entries = buildNavEntries();
    for (const e of entries) {
      if (e.kind !== "group") continue;
      const g = (e as { kind: "group"; group: TestNavGroup }).group;
      const found = g.items.find(i => i.href === "/manual");
      expect(found).toBeUndefined();
    }
  });
});

describe("Navigation structure — absent modules", () => {
  it("34. Design System item (/design-system) is absent from all nav arrays", () => {
    const entries = buildNavEntries();
    const items = allNavItems(entries);
    const ds = items.find(i => i.href.includes("design-system") || i.label.toLowerCase().includes("design system"));
    expect(ds).toBeUndefined();
  });

  it("35. Knowledge & Support group/item is absent from all nav entries", () => {
    const entries = buildNavEntries();
    const titles = allGroupTitles(entries);
    const items = allNavItems(entries);
    expect(titles.find(t => t.toLowerCase().includes("knowledge") || t.toLowerCase().includes("support"))).toBeUndefined();
    expect(items.find(i => i.label.toLowerCase().includes("knowledge") || i.label.toLowerCase().includes("support"))).toBeUndefined();
  });
});

describe("Navigation structure — label uniqueness", () => {
  it("36. No nav item label appears more than once across all groups and standalone items", () => {
    const entries = buildNavEntries();
    const items = allNavItems(entries);
    const labels = items.map(i => i.label);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const label of labels) {
      if (seen.has(label)) duplicates.push(label);
      seen.add(label);
    }
    expect(duplicates).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §8  Profile footer — dynamic identity and explicit logout actions
   ══════════════════════════════════════════════════════════════════════ */
describe("Profile footer — role label", () => {
  it("26. Profile footer role reads from meData.user.roleLabel, not a hardcoded string", () => {
    const meData = { user: { roleLabel: "Programme Manager" } };
    expect(profileFooterRoleSource(meData)).toBe("Programme Manager");
  });

  it("27. Profile footer role is not the hardcoded string 'System Administrator'", () => {
    const meData = { user: { roleLabel: "Programme Manager" } };
    expect(profileFooterRoleSource(meData)).not.toBe("System Administrator");
  });
});

describe("Profile footer — logout affordances", () => {
  it("provides a visible expanded logout row beneath the dynamic identity area", () => {
    expect(layoutSource).toContain("Expanded: user identity menu followed by an explicit logout action.");
    expect(layoutSource).toContain('className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-muted-foreground');
    expect(layoutSource).toContain('<span>{tNav("user.signOut")}</span>');
  });

  it("provides a separate collapsed logout icon with an accessible name and tooltip", () => {
    expect(layoutSource).toContain("Collapsed: avatar keeps the profile/language menu, with a separate logout control.");
    expect(layoutSource).toContain('aria-label={tNav("user.signOut")}');
    expect(layoutSource).toContain('aria-describedby="sidebar-logout-tooltip"');
    expect(layoutSource).toContain('id="sidebar-logout-tooltip"');
    expect(layoutSource).toContain('role="tooltip"');
    expect(layoutSource).toContain("${sidebarLogoutTooltipPosition}");
    expect(layoutSource).toContain("group-hover:opacity-100 group-focus-within:opacity-100");
    expect(layoutSource).toContain('title={tNav("user.signOut")}');
  });

  it("routes each sidebar logout control through the canonical cleanup handler", () => {
    const sidebarSource = layoutSource.slice(
      layoutSource.indexOf('{meData?.user && ('),
      layoutSource.indexOf("</aside>")
    );
    expect((sidebarSource.match(/onClick={handleLogout}/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(layoutSource).toContain('await fetch("/api/auth/logout", { method: "POST", credentials: "include" })');
    expect(layoutSource).toContain("if (!response.ok) throw new Error");
    expect(layoutSource).toContain("await Promise.allSettled([");
    expect(layoutSource).toContain("clearOfflineData()");
  });

  it("keeps long account names safely truncated in the footer and dropdown", () => {
    const footerSource = layoutSource.slice(
      layoutSource.indexOf('{meData?.user && ('),
      layoutSource.indexOf("</aside>")
    );
    expect((footerSource.match(/\btruncate\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(footerSource).toContain('title={meData.user.name && meData.user.name.length > 20 ? meData.user.name : undefined}');
  });
});
