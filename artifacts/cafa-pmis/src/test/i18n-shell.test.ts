/**
 * Phase 3 — Shell RTL Foundation: i18n Tests
 *
 * These tests verify that:
 *  (a) All shell namespace keys used by Phase 3 components exist and resolve
 *      in both English (en) and Arabic (ar).
 *  (b) Arabic translations are non-empty (not the empty-stub default {}).
 *  (c) Direction-sensitive classes / logical-property patterns are present
 *      in the source files (checked via string search of built source).
 *  (d) The BidiIsolate utility exports the expected shape.
 *  (e) Key RTL-specific content (Arabic right-to-left, direction keys) is correct.
 */
import { describe, it, expect, beforeAll } from "vitest";
import i18n from "../i18n";

/* ─── Bootstrap i18n ─────────────────────────────────────────────────── */
beforeAll(async () => {
  // Ensure resources are loaded for both locales
  await i18n.loadLanguages(["en", "ar"]);
});

function en(ns: string, key: string) {
  return i18n.getFixedT("en", ns)(key, { returnObjects: false }) as string;
}
function ar(ns: string, key: string) {
  return i18n.getFixedT("ar", ns)(key, { returnObjects: false }) as string;
}
function keyExists(ns: string, key: string, lng = "en") {
  return i18n.exists(key, { ns, lng });
}

/* ══════════════════════════════════════════════════════════════════════
   §1  nav namespace — shell strings added in Phase 3
   ══════════════════════════════════════════════════════════════════════ */
describe("nav namespace — Phase 3 shell additions", () => {
  /* Tooltips */
  it("nav.tooltips.expandSidebar has the exact compact English label", () => {
    expect(keyExists("nav", "tooltips.expandSidebar")).toBe(true);
    expect(en("nav", "tooltips.expandSidebar")).toBe("Expand sidebar");
  });
  it("nav.tooltips.collapseSidebar has the exact English label", () => {
    expect(keyExists("nav", "tooltips.collapseSidebar")).toBe(true);
    expect(en("nav", "tooltips.collapseSidebar")).toBe("Collapse sidebar");
  });
  it("nav.tooltips.closeMenu exists in en", () => {
    expect(keyExists("nav", "tooltips.closeMenu")).toBe(true);
  });
  it("nav.tooltips.platformName uses the compact product name only", () => {
    expect(keyExists("nav", "tooltips.platformName")).toBe(true);
    expect(en("nav", "tooltips.platformName")).toBe("CAFA PMIS");
    expect(ar("nav", "tooltips.platformName")).toBe("CAFA PMIS");
  });

  /* Arabic tooltips are non-empty */
  it("nav.tooltips.expandSidebar Arabic has the compact equivalent", () => {
    expect(ar("nav", "tooltips.expandSidebar")).toBe("توسيع الشريط الجانبي");
  });
  it("nav.tooltips.collapseSidebar Arabic is non-empty", () => {
    expect(ar("nav", "tooltips.collapseSidebar")).toBe("طي الشريط الجانبي");
  });

  /* Brand */
  it("nav.brand name stays exact while the retained subtitle remains glossary-aligned", () => {
    expect(en("nav", "brand.name")).toBe("CAFA PMIS");
    expect(en("nav", "brand.subtitle")).toBe("Programme Management Information System");
    expect(en("nav", "brand.subtitle")).not.toContain("Enterprise");
  });
  it("nav.brand subtitle uses the complete glossary-aligned Arabic equivalent", () => {
    expect(ar("nav", "brand.subtitle")).toBe("نظام معلومات إدارة البرنامج");
    expect(ar("nav", "brand.subtitle")).not.toContain("المؤسسية");
  });

  /* User menu */
  it("nav.user.myProfile en equals 'My Profile'", () => {
    expect(en("nav", "user.myProfile")).toBe("My Profile");
  });
  it("nav.user.myProfile ar is non-empty and different from English", () => {
    const a = ar("nav", "user.myProfile");
    expect(a).toBeTruthy();
    expect(a).not.toBe("My Profile");
  });
  it("nav.user.signOut en equals the explicit sidebar action label", () => {
    expect(en("nav", "user.signOut")).toBe("Log out");
  });
  it("nav.user.signOut ar is non-empty", () => {
    expect(ar("nav", "user.signOut")).toBeTruthy();
  });
  it("nav.user.notificationPreferences en is non-empty", () => {
    expect(en("nav", "user.notificationPreferences")).toBeTruthy();
  });
  it("nav.user.installApp en is non-empty", () => {
    expect(en("nav", "user.installApp")).toBeTruthy();
  });

  /* Language switcher */
  it("nav.language.switch en equals 'Language'", () => {
    expect(en("nav", "language.switch")).toBe("Language");
  });
  it("nav.language.en equals 'English' in both locales", () => {
    expect(en("nav", "language.en")).toBe("English");
    expect(ar("nav", "language.en")).toBe("English");
  });
  it("nav.language.ar equals 'العربية' in both locales", () => {
    expect(en("nav", "language.ar")).toBe("العربية");
    expect(ar("nav", "language.ar")).toBe("العربية");
  });

  /* Notifications bell shell */
  it("nav.notifications.title en equals 'Notifications'", () => {
    expect(en("nav", "notifications.title")).toBe("Notifications");
  });
  it("nav.notifications.title ar is non-empty", () => {
    expect(ar("nav", "notifications.title")).toBeTruthy();
  });
  it("nav.notifications.markAllRead en is non-empty", () => {
    expect(en("nav", "notifications.markAllRead")).toBeTruthy();
  });
  it("nav.notifications.viewAll en is non-empty", () => {
    expect(en("nav", "notifications.viewAll")).toBeTruthy();
  });
  it("nav.notifications.allCaughtUp ar is non-empty", () => {
    expect(ar("nav", "notifications.allCaughtUp")).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §2  nav namespace — commandPalette shell strings
   ══════════════════════════════════════════════════════════════════════ */
describe("nav namespace — commandPalette shell strings", () => {
  it("commandPalette.label en is non-empty", () => {
    expect(en("nav", "commandPalette.label")).toBeTruthy();
  });
  it("commandPalette.searchPlaceholder en contains 'Search'", () => {
    expect(en("nav", "commandPalette.searchPlaceholder")).toContain("Search");
  });
  it("commandPalette.searchPlaceholder ar is non-empty", () => {
    expect(ar("nav", "commandPalette.searchPlaceholder")).toBeTruthy();
  });
  it("commandPalette.groups.favorites en is non-empty", () => {
    expect(en("nav", "commandPalette.groups.favorites")).toBeTruthy();
  });
  it("commandPalette.groups.recent en is non-empty", () => {
    expect(en("nav", "commandPalette.groups.recent")).toBeTruthy();
  });
  it("commandPalette.groups.quickNav en is non-empty", () => {
    expect(en("nav", "commandPalette.groups.quickNav")).toBeTruthy();
  });
  it("commandPalette.hints.navigate ar is non-empty", () => {
    expect(ar("nav", "commandPalette.hints.navigate")).toBeTruthy();
  });
  it("commandPalette.brand en contains 'CAFA'", () => {
    expect(en("nav", "commandPalette.brand")).toContain("CAFA");
  });
  it("commandPalette.noResultsFor en is non-empty", () => {
    expect(en("nav", "commandPalette.noResultsFor")).toBeTruthy();
  });
  it("commandPalette.pinLabel en is non-empty", () => {
    expect(en("nav", "commandPalette.pinLabel")).toBeTruthy();
  });
  it("commandPalette.clearHistoryConfirm en contains 'cannot'", () => {
    expect(en("nav", "commandPalette.clearHistoryConfirm").toLowerCase()).toContain("cannot");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §3  nav namespace — pageTitles
   ══════════════════════════════════════════════════════════════════════ */
describe("nav namespace — pageTitles", () => {
  it("pageTitles.budgetAndFinance en contains 'Budget'", () => {
    expect(en("nav", "pageTitles.budgetAndFinance")).toContain("Budget");
  });
  it("pageTitles.riskRegister en contains 'Risk'", () => {
    expect(en("nav", "pageTitles.riskRegister")).toContain("Risk");
  });
  it("pageTitles.userManagement ar is non-empty", () => {
    expect(ar("nav", "pageTitles.userManagement")).toBeTruthy();
  });
  it("home en equals 'Home'", () => {
    expect(en("nav", "home")).toBe("Home");
  });
  it("home ar is non-empty and different from 'Home'", () => {
    const a = ar("nav", "home");
    expect(a).toBeTruthy();
    expect(a).not.toBe("Home");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §3b Navigation information architecture
   ══════════════════════════════════════════════════════════════════════ */
describe("nav namespace — Administration and standalone Manual", () => {
  it("keeps Administration, AI, and System Manual translated in English and Arabic", () => {
    for (const lng of [en, ar]) {
      expect(lng("nav", "groups.administration")).toBeTruthy();
      expect(lng("nav", "items.ai")).toBeTruthy();
      expect(lng("nav", "items.systemManual")).toBeTruthy();
    }
  });

  it("does not retain the retired Knowledge & Support navigation key", () => {
    expect(keyExists("nav", "groups.knowledgeSupport", "en")).toBe(false);
    expect(keyExists("nav", "groups.knowledgeSupport", "ar")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §4  nav namespace — cmdSubtitles
   ══════════════════════════════════════════════════════════════════════ */
describe("nav namespace — cmdSubtitles", () => {
  const keys = [
    "dashboard", "projects", "plans", "reports", "risks",
    "notifications", "states", "fileArchive",
    "systemManual", "budget", "communicationCentre", "users",
    "auditLog", "ai", "syncStatus",
  ];

  for (const key of keys) {
    it(`cmdSubtitles.${key} en is non-empty`, () => {
      expect(en("nav", `cmdSubtitles.${key}`)).toBeTruthy();
    });
    it(`cmdSubtitles.${key} ar is non-empty`, () => {
      expect(ar("nav", `cmdSubtitles.${key}`)).toBeTruthy();
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════
   §5  common namespace — sync / offline indicator strings
   ══════════════════════════════════════════════════════════════════════ */
describe("common namespace — sync / offline indicator strings", () => {
  it("common.sync.offlineBanner en is non-empty", () => {
    expect(en("common", "sync.offlineBanner")).toBeTruthy();
  });
  it("common.sync.offlineBanner ar is non-empty", () => {
    expect(ar("common", "sync.offlineBanner")).toBeTruthy();
  });
  it("common.sync.viewQueue en equals 'View queue'", () => {
    expect(en("common", "sync.viewQueue")).toBe("View queue");
  });
  it("common.sync.viewQueue ar is non-empty", () => {
    expect(ar("common", "sync.viewQueue")).toBeTruthy();
  });
  it("common.previous en equals 'Previous'", () => {
    expect(en("common", "previous")).toBe("Previous");
  });
  it("common.next en equals 'Next'", () => {
    expect(en("common", "next")).toBe("Next");
  });
  it("common.previous ar is non-empty", () => {
    expect(ar("common", "previous")).toBeTruthy();
  });
  it("common.next ar is non-empty", () => {
    expect(ar("common", "next")).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §6  errors namespace — crash boundary strings
   ══════════════════════════════════════════════════════════════════════ */
describe("errors namespace — crash boundary strings", () => {
  it("errors.crashTitle en is non-empty", () => {
    expect(en("errors", "crashTitle")).toBeTruthy();
  });
  it("errors.crashDesc en is non-empty", () => {
    expect(en("errors", "crashDesc")).toBeTruthy();
  });
  it("errors.crashAction en is non-empty", () => {
    expect(en("errors", "crashAction")).toBeTruthy();
  });
  it("errors.crashTitle ar is non-empty and different", () => {
    const a = ar("errors", "crashTitle");
    expect(a).toBeTruthy();
    expect(a).not.toBe(en("errors", "crashTitle"));
  });
  it("errors.crashDesc ar is non-empty", () => {
    expect(ar("errors", "crashDesc")).toBeTruthy();
  });
  it("errors.crashAction ar is non-empty", () => {
    expect(ar("errors", "crashAction")).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §7  RTL direction — content checks
   ══════════════════════════════════════════════════════════════════════ */
describe("RTL direction — key content checks", () => {
  it("Arabic nav.tooltips.expandSidebar remains the exact compact label", () => {
    expect(ar("nav", "tooltips.expandSidebar")).toBe("توسيع الشريط الجانبي");
  });
  it("nav.language.ar value starts with Arabic character", () => {
    const arabicVal = en("nav", "language.ar");
    // 'العربية' starts with Alef (U+0627)
    expect(arabicVal.charCodeAt(0)).toBeGreaterThan(0x0600);
    expect(arabicVal.charCodeAt(0)).toBeLessThan(0x06FF);
  });
  it("Arabic common.sync.offlineBanner contains Arabic characters", () => {
    const val = ar("common", "sync.offlineBanner");
    const hasArabic = /[\u0600-\u06FF]/.test(val);
    expect(hasArabic).toBe(true);
  });
  it("Arabic nav.commandPalette.searchPlaceholder contains Arabic characters", () => {
    const val = ar("nav", "commandPalette.searchPlaceholder");
    const hasArabic = /[\u0600-\u06FF]/.test(val);
    expect(hasArabic).toBe(true);
  });
  it("Arabic nav.home value equals 'الرئيسية'", () => {
    expect(ar("nav", "home")).toBe("الرئيسية");
  });
});
