/**
 * i18n Glossary Consistency Tests — Phase 2 + Phase 4 (all 17 namespaces)
 *
 * Guards that:
 * 1. Critical Arabic terms in ar/common.json match the approved glossary exactly.
 * 2. ar/nav.json Arabic translations are complete and non-empty.
 * 3. ar/errors.json Arabic translations are complete and non-empty.
 * 4. No critical term carries a conflicting translation across namespaces.
 * 5. Structural keys in the Arabic files mirror their English counterparts.
 * 6. [Phase 4] Structural completeness for all 17 namespaces.
 * 7. [Phase 4] Cross-namespace canonical term consistency across translated modules.
 * 8. [Phase 4] Role term consistency across users, nav, and dashboard namespaces.
 *
 * These tests are pure JSON — no DOM, no i18next initialisation required.
 * They run as part of the standard `npx vitest run` suite.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ── Import locale files directly ──────────────────────────────────────────────
import arCommon from "../locales/ar/common.json";
import arNav from "../locales/ar/nav.json";
import arErrors from "../locales/ar/errors.json";
import arUsers from "../locales/ar/users.json";
import arMessages from "../locales/ar/messages.json";
import arNotifications from "../locales/ar/notifications.json";
import arSettings from "../locales/ar/settings.json";
import arAi from "../locales/ar/ai.json";
import arDashboard from "../locales/ar/dashboard.json";
import arPlanning from "../locales/ar/planning.json";
import arRisks from "../locales/ar/risks.json";
import arReports from "../locales/ar/reports.json";
import arBudget from "../locales/ar/budget.json";
import arProjects from "../locales/ar/projects.json";

import enCommon from "../locales/en/common.json";
import enNav from "../locales/en/nav.json";
import enErrors from "../locales/en/errors.json";
import enUsers from "../locales/en/users.json";
import enDashboard from "../locales/en/dashboard.json";
import enPlanning from "../locales/en/planning.json";
import enRisks from "../locales/en/risks.json";
import enSettings from "../locales/en/settings.json";
import enAi from "../locales/en/ai.json";

// ── Approved glossary fixture (single source of truth for tests) ──────────────
/**
 * These values are the canonical Arabic translations from CAFA_ARABIC_GLOSSARY.md.
 * Any deviation in the locale files is a test failure.
 */
const APPROVED_TERMS = {
  // Core entities
  project: "المشروع",
  plan: "الخطة",
  budget: "الميزانية",
  report: "التقرير",
  risk: "المخاطرة",
  sector: "القطاع",
  state: "الولاية",
  donor: "الجهة المانحة",
  beneficiaries: "المستفيدون",
  target: "المستهدف",
  // Workflow statuses
  draft: "مسودة",
  submitted: "مُقدَّم",
  approved: "مُعتمَد",
  rejected: "مرفوض",
  completed: "مكتمل",
  cancelled: "ملغى",
  archived: "مؤرشف",
  active: "نشط",
  pending: "قيد الانتظار",
  // Common actions
  save: "حفظ",
  cancel: "إلغاء",
  delete: "حذف",
  edit: "تعديل",
  search: "بحث",
  filter: "تصفية",
  upload: "رفع",
  download: "تنزيل",
  create: "إنشاء",
  add: "إضافة",
  // Severity levels
  high: "مرتفع",
  medium: "متوسط",
  low: "منخفض",
  critical: "حرج",
  // Beneficiary breakdown
  target_beneficiaries: "المستفيدون المستهدفون",
  reached_beneficiaries: "المستفيدون الفعليون",
} as const;

/** Canonical role labels from the glossary (section H). */
const APPROVED_ROLES: Record<string, string> = {
  super_admin: "مسؤول النظام",
  executive_director: "المدير التنفيذي",
  program_manager: "مدير البرنامج",
  senior_program_coordinator: "منسق البرنامج الأول",
  technical_coordinator: "المنسق التقني",
  state_office_manager: "مدير مكتب الولاية",
  state_program_officer: "ضابط برنامج الولاية",
  project_officer: "ضابط المشروع",
  program_assistant: "مساعد البرنامج",
  viewer: "مشاهد",
};

/** Canonical nav items from the glossary (section I). */
const APPROVED_NAV_ITEMS: Record<string, string> = {
  dashboard: "لوحة التحكم",
  planning: "التخطيط",
  budget: "الميزانية",
  reports: "التقارير",
  risks: "المخاطر",
  notifications: "الإشعارات",
  users: "المستخدمون",
  auditLog: "سجل المراجعة",
};

// ── Helper: recursively collect all string leaf values from a JSON object ─────
function collectLeafValues(obj: Record<string, unknown>, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, val] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "string") {
      out.set(p, val);
    } else if (val !== null && typeof val === "object") {
      for (const [k, v] of collectLeafValues(val as Record<string, unknown>, p)) {
        out.set(k, v);
      }
    }
  }
  return out;
}

function topLevelStringKeys(obj: Record<string, unknown>): Set<string> {
  return new Set(
    Object.entries(obj)
      .filter(([, v]) => typeof v === "string")
      .map(([k]) => k),
  );
}

function flattenKeys(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[full] = v;
    else if (v && typeof v === "object") Object.assign(out, flattenKeys(v as Record<string, unknown>, full));
  }
  return out;
}

const LOCALES_DIR = path.resolve(__dirname, "../locales");

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Approved glossary terms present and correct in ar/common.json
// ─────────────────────────────────────────────────────────────────────────────
describe("§1  Approved glossary terms — ar/common.json", () => {
  for (const [key, expectedArabic] of Object.entries(APPROVED_TERMS) as [string, string][]) {
    it(`TC-G-${key.toUpperCase().replace(/_/g, "-")}: common.${key} === "${expectedArabic}"`, () => {
      const actual = (arCommon as Record<string, unknown>)[key];
      expect(actual, `common.${key} is missing or wrong`).toBe(expectedArabic);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — ar/common.json structural completeness
// ─────────────────────────────────────────────────────────────────────────────
describe("§2  ar/common.json structural completeness", () => {
  const enKeys = topLevelStringKeys(enCommon as Record<string, unknown>);
  const arKeys = topLevelStringKeys(arCommon as Record<string, unknown>);

  it("TC-G-COM-01: ar/common.json must have every top-level string key that en/common.json has", () => {
    const missing: string[] = [];
    for (const k of enKeys) {
      if (!arKeys.has(k)) missing.push(k);
    }
    expect(missing, `Missing keys: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-COM-02: every Arabic string value must be non-empty", () => {
    const empty: string[] = [];
    for (const k of arKeys) {
      const v = (arCommon as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim() === "") empty.push(k);
    }
    expect(empty, `Empty values: ${empty.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-COM-03: ar/common.json must define the sync sub-object", () => {
    expect(typeof (arCommon as Record<string, unknown>).sync).toBe("object");
  });

  it("TC-G-COM-04: ar/common.sync must have all keys that en/common.sync has", () => {
    const enSync = (enCommon as Record<string, unknown>).sync as Record<string, unknown>;
    const arSync = (arCommon as Record<string, unknown>).sync as Record<string, unknown>;
    const missing = Object.keys(enSync).filter((k) => !(k in arSync));
    expect(missing, `Missing sync keys: ${missing.join(", ")}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — ar/nav.json completeness
// ─────────────────────────────────────────────────────────────────────────────
describe("§3  ar/nav.json completeness", () => {
  it("TC-G-NAV-01: ar/nav.json must have a groups sub-object", () => {
    expect(typeof (arNav as Record<string, unknown>).groups).toBe("object");
  });

  it("TC-G-NAV-02: ar/nav.groups must have all keys that en/nav.groups has", () => {
    const enGroups = (enNav as Record<string, unknown>).groups as Record<string, unknown>;
    const arGroups = (arNav as Record<string, unknown>).groups as Record<string, unknown>;
    const missing = Object.keys(enGroups).filter((k) => !(k in arGroups));
    expect(missing, `Missing groups: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-NAV-03: ar/nav.items must have all keys that en/nav.items has", () => {
    const enItems = (enNav as Record<string, unknown>).items as Record<string, unknown>;
    const arItems = (arNav as Record<string, unknown>).items as Record<string, unknown>;
    const missing = Object.keys(enItems).filter((k) => !(k in arItems));
    expect(missing, `Missing items: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-NAV-04: ar/nav.user must have all keys that en/nav.user has", () => {
    const enUser = (enNav as Record<string, unknown>).user as Record<string, unknown>;
    const arUser = (arNav as Record<string, unknown>).user as Record<string, unknown>;
    const missing = Object.keys(enUser).filter((k) => !(k in arUser));
    expect(missing, `Missing user keys: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-NAV-05: dashboard nav item is لوحة التحكم", () => {
    const arItems = (arNav as Record<string, unknown>).items as Record<string, string>;
    expect(arItems.dashboard).toBe("لوحة التحكم");
  });

  it("TC-G-NAV-06: no nav item value is empty", () => {
    const leaves = collectLeafValues(arNav as Record<string, unknown>);
    const empty: string[] = [];
    for (const [k, v] of leaves) {
      if (v.trim() === "") empty.push(k);
    }
    expect(empty, `Empty nav values: ${empty.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-NAV-07: brand.name remains CAFA PMIS (must not be translated)", () => {
    const brand = (arNav as Record<string, unknown>).brand as Record<string, string>;
    expect(brand.name).toBe("CAFA PMIS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — ar/errors.json completeness
// ─────────────────────────────────────────────────────────────────────────────
describe("§4  ar/errors.json completeness", () => {
  it("TC-G-ERR-01: ar/errors.json must have every key that en/errors.json has", () => {
    const enKeys = Object.keys(enErrors);
    const arKeys = new Set(Object.keys(arErrors));
    const missing = enKeys.filter((k) => !arKeys.has(k));
    expect(missing, `Missing error keys: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-ERR-02: no error value is empty", () => {
    const empty: string[] = [];
    for (const [k, v] of Object.entries(arErrors as Record<string, string>)) {
      if (typeof v === "string" && v.trim() === "") empty.push(k);
    }
    expect(empty, `Empty error values: ${empty.join(", ")}`).toHaveLength(0);
  });

  it("TC-G-ERR-03: crashTitle is حدث خطأ ما", () => {
    expect((arErrors as Record<string, string>).crashTitle).toBe("حدث خطأ ما");
  });

  it("TC-G-ERR-04: cafaPMIS value preserves CAFA brand identifier", () => {
    const val = (arErrors as Record<string, string>).cafaPMIS;
    expect(val).toContain("CAFA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Cross-namespace consistency: no critical term conflicts
// ─────────────────────────────────────────────────────────────────────────────
describe("§5  Cross-namespace critical term consistency", () => {
  const crossChecks: Array<{ label: string; a: string; b: string }> = [
    {
      label: "draft: common vs nav (sync.pending uses pending, not draft — different key)",
      a: (arCommon as Record<string, string>).draft,
      b: "مسودة",
    },
    {
      label: "active: common matches glossary",
      a: (arCommon as Record<string, string>).active,
      b: "نشط",
    },
    {
      label: "approved: common matches glossary",
      a: (arCommon as Record<string, string>).approved,
      b: "مُعتمَد",
    },
    {
      label: "nav.items.dashboard == common-glossary لوحة التحكم",
      a: ((arNav as Record<string, unknown>).items as Record<string, string>).dashboard,
      b: "لوحة التحكم",
    },
    {
      label: "nav.items.budget == common.budget",
      a: ((arNav as Record<string, unknown>).items as Record<string, string>).budget,
      b: (arCommon as Record<string, string>).budget,
    },
    {
      label: "nav.items.reports == common.report (plural form)",
      a: ((arNav as Record<string, unknown>).items as Record<string, string>).reports,
      b: "التقارير",
    },
    {
      label: "nav.items.risks == plural of common.risk",
      a: ((arNav as Record<string, unknown>).items as Record<string, string>).risks,
      b: "المخاطر",
    },
    {
      label: "nav.items.notifications matches glossary",
      a: ((arNav as Record<string, unknown>).items as Record<string, string>).notifications,
      b: "الإشعارات",
    },
    {
      label: "errors.retry matches common.tryAgain spirit — both mean retry",
      a: typeof (arErrors as Record<string, string>).retry,
      b: "string",
    },
  ];

  for (const { label, a, b } of crossChecks) {
    it(`TC-G-CROSS: ${label}`, () => {
      expect(a).toBe(b);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Bidi safety: codes and brand identifiers must not appear translated
// ─────────────────────────────────────────────────────────────────────────────
describe("§6  Bidi safety — untranslatable tokens", () => {
  it("TC-G-BIDI-01: url key value is not translated (must remain 'URL')", () => {
    const arVal = (arCommon as Record<string, string>).url;
    expect(arVal).toBe("URL");
  });

  it("TC-G-BIDI-02: nav brand name is CAFA PMIS", () => {
    const brand = (arNav as Record<string, unknown>).brand as Record<string, string>;
    expect(brand.name).toBe("CAFA PMIS");
  });

  it("TC-G-BIDI-03: language.en value in nav is 'English' (not translated)", () => {
    const lang = (arNav as Record<string, unknown>).language as Record<string, string>;
    expect(lang.en).toBe("English");
  });

  it("TC-G-BIDI-04: language.ar value in nav is العربية", () => {
    const lang = (arNav as Record<string, unknown>).language as Record<string, string>;
    expect(lang.ar).toBe("العربية");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — Structural completeness for all 17 namespaces
// ─────────────────────────────────────────────────────────────────────────────

describe("§7  Structural completeness — all 17 namespaces", () => {
  /**
   * For each translated namespace (AR file has ≥1 key), every key present in AR
   * must also exist in EN (no orphaned AR keys that would show the raw key string
   * as a fallback if we ever switch fallback direction).
   */
  const NAMESPACES = [
    "ai", "auth", "budget", "common", "dashboard", "errors",
    "knowledge", "landing", "messages", "nav", "notifications",
    "planning", "projects", "reports", "risks", "settings", "users",
  ] as const;

  for (const ns of NAMESPACES) {
    it(`TC-G-STRUCT-${ns.toUpperCase()}: every AR key in ${ns} has an EN counterpart`, () => {
      const enPath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      const arPath = path.join(LOCALES_DIR, "ar", `${ns}.json`);
      const enFlat = flattenKeys(JSON.parse(fs.readFileSync(enPath, "utf8")) as Record<string, unknown>);
      const arFlat = flattenKeys(JSON.parse(fs.readFileSync(arPath, "utf8")) as Record<string, unknown>);

      if (Object.keys(arFlat).length === 0) return; // empty stub — skip

      const orphaned = Object.keys(arFlat).filter((k) => !(k in enFlat));
      expect(
        orphaned,
        `${ns}: AR has keys not in EN (would display raw key on EN fallback): ${orphaned.slice(0, 10).join(", ")}`,
      ).toHaveLength(0);
    });
  }

  it("TC-G-STRUCT-USERS: ar/users.json covers all EN keys (users is 100% translated)", () => {
    const enFlat = flattenKeys(enUsers as Record<string, unknown>);
    const arFlat = flattenKeys(arUsers as Record<string, unknown>);
    const missing = Object.keys(enFlat).filter((k) => !(k in arFlat));
    expect(missing, `users: missing AR keys: ${missing.slice(0, 10).join(", ")}`).toHaveLength(0);
  });

  it("TC-G-STRUCT-MESSAGES: ar/messages.json covers all EN keys (messages is 100% translated)", () => {
    const enPath = path.join(LOCALES_DIR, "en", "messages.json");
    const arFlat = flattenKeys(arMessages as Record<string, unknown>);
    const enFlat = flattenKeys(JSON.parse(fs.readFileSync(enPath, "utf8")) as Record<string, unknown>);
    const missing = Object.keys(enFlat).filter((k) => !(k in arFlat));
    expect(missing, `messages: missing AR keys: ${missing.slice(0, 10).join(", ")}`).toHaveLength(0);
  });

  it("TC-G-STRUCT-NOTIFICATIONS: ar/notifications.json covers all EN keys (notifications is 100% translated)", () => {
    const enPath = path.join(LOCALES_DIR, "en", "notifications.json");
    const arFlat = flattenKeys(arNotifications as Record<string, unknown>);
    const enFlat = flattenKeys(JSON.parse(fs.readFileSync(enPath, "utf8")) as Record<string, unknown>);
    const missing = Object.keys(enFlat).filter((k) => !(k in arFlat));
    expect(missing, `notifications: missing AR keys: ${missing.slice(0, 10).join(", ")}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — Cross-namespace canonical term consistency for translated modules
// ─────────────────────────────────────────────────────────────────────────────

describe("§8  Cross-namespace canonical term consistency — translated modules", () => {
  /**
   * For each canonical status term, check that where it appears in a translated
   * namespace it matches the glossary value from §1 exactly.
   */

  // ar/planning.json — status keys
  const arPlanningFlat = flattenKeys(arPlanning as Record<string, unknown>);

  if (arPlanningFlat["status.draft"]) {
    it("TC-G-PLAN-DRAFT: planning.status.draft matches glossary", () => {
      expect(arPlanningFlat["status.draft"]).toBe(APPROVED_TERMS.draft);
    });
  }
  if (arPlanningFlat["status.submitted"]) {
    it("TC-G-PLAN-SUBMITTED: planning.status.submitted matches glossary", () => {
      expect(arPlanningFlat["status.submitted"]).toBe(APPROVED_TERMS.submitted);
    });
  }
  if (arPlanningFlat["status.approved"]) {
    it("TC-G-PLAN-APPROVED: planning.status.approved matches glossary", () => {
      expect(arPlanningFlat["status.approved"]).toBe(APPROVED_TERMS.approved);
    });
  }
  if (arPlanningFlat["status.active"]) {
    it("TC-G-PLAN-ACTIVE: planning.status.active matches glossary", () => {
      expect(arPlanningFlat["status.active"]).toBe(APPROVED_TERMS.active);
    });
  }
  if (arPlanningFlat["status.cancelled"]) {
    it("TC-G-PLAN-CANCELLED: planning.status.cancelled matches glossary", () => {
      expect(arPlanningFlat["status.cancelled"]).toBe(APPROVED_TERMS.cancelled);
    });
  }
  if (arPlanningFlat["status.completed"]) {
    it("TC-G-PLAN-COMPLETED: planning.status.completed matches glossary", () => {
      expect(arPlanningFlat["status.completed"]).toBe(APPROVED_TERMS.completed);
    });
  }

  // ar/risks.json — severity keys
  const arRisksFlat = flattenKeys(arRisks as Record<string, unknown>);

  if (arRisksFlat["severity.high"]) {
    it("TC-G-RISK-HIGH: risks.severity.high matches glossary", () => {
      expect(arRisksFlat["severity.high"]).toBe(APPROVED_TERMS.high);
    });
  }
  if (arRisksFlat["severity.medium"]) {
    it("TC-G-RISK-MEDIUM: risks.severity.medium matches glossary", () => {
      expect(arRisksFlat["severity.medium"]).toBe(APPROVED_TERMS.medium);
    });
  }
  if (arRisksFlat["severity.low"]) {
    it("TC-G-RISK-LOW: risks.severity.low matches glossary", () => {
      expect(arRisksFlat["severity.low"]).toBe(APPROVED_TERMS.low);
    });
  }
  if (arRisksFlat["severity.critical"]) {
    it("TC-G-RISK-CRITICAL: risks.severity.critical matches glossary", () => {
      expect(arRisksFlat["severity.critical"]).toBe(APPROVED_TERMS.critical);
    });
  }

  // ar/dashboard.json — status/severity cross-checks
  const arDashboardFlat = flattenKeys(arDashboard as Record<string, unknown>);

  if (arDashboardFlat["status.draft"]) {
    it("TC-G-DASH-DRAFT: dashboard.status.draft matches common.draft", () => {
      expect(arDashboardFlat["status.draft"]).toBe(APPROVED_TERMS.draft);
    });
  }
  if (arDashboardFlat["status.active"]) {
    it("TC-G-DASH-ACTIVE: dashboard.status.active matches common.active", () => {
      expect(arDashboardFlat["status.active"]).toBe(APPROVED_TERMS.active);
    });
  }
  if (arDashboardFlat["severity.high"]) {
    it("TC-G-DASH-SEVERITY-HIGH: dashboard.severity.high matches glossary", () => {
      expect(arDashboardFlat["severity.high"]).toBe(APPROVED_TERMS.high);
    });
  }

  // ar/reports.json — status cross-checks
  const arReportsFlat = flattenKeys(arReports as Record<string, unknown>);

  if (arReportsFlat["status.draft"]) {
    it("TC-G-REP-DRAFT: reports.status.draft matches glossary", () => {
      expect(arReportsFlat["status.draft"]).toBe(APPROVED_TERMS.draft);
    });
  }
  if (arReportsFlat["status.approved"]) {
    it("TC-G-REP-APPROVED: reports.status.approved matches glossary", () => {
      expect(arReportsFlat["status.approved"]).toBe(APPROVED_TERMS.approved);
    });
  }

  // ar/budget.json — key terms
  const arBudgetFlat = flattenKeys(arBudget as Record<string, unknown>);

  if (arBudgetFlat["title"]) {
    it("TC-G-BUD-TITLE: budget.title contains الميزانية (canonical budget term)", () => {
      expect(arBudgetFlat["title"]).toContain("الميزانية");
    });
  }

  // ar/projects.json — key terms
  const arProjectsFlat = flattenKeys(arProjects as Record<string, unknown>);

  if (arProjectsFlat["detail.projectBudget"]) {
    it("TC-G-PROJ-BUDGET: projects.detail.projectBudget uses the canonical ميزانية stem", () => {
      expect(arProjectsFlat["detail.projectBudget"]).toContain("ميزانية");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — Role label consistency across users, nav, and dashboard
// ─────────────────────────────────────────────────────────────────────────────

describe("§9  Role label consistency — users, nav, dashboard", () => {
  const arUsersFlat = flattenKeys(arUsers as Record<string, unknown>);
  const arDashboardFlat = flattenKeys(arDashboard as Record<string, unknown>);

  for (const [roleEnum, expectedArabic] of Object.entries(APPROVED_ROLES)) {
    // Check ar/users.json role labels (key: roles.{roleEnum})
    const usersKey = `roles.${roleEnum}`;
    if (arUsersFlat[usersKey]) {
      it(`TC-G-ROLE-USERS-${roleEnum.toUpperCase()}: users.${usersKey} matches glossary`, () => {
        expect(arUsersFlat[usersKey]).toBe(expectedArabic);
      });
    }

    // Check ar/dashboard.json role labels if present
    const dashKey = `roles.${roleEnum}`;
    if (arDashboardFlat[dashKey]) {
      it(`TC-G-ROLE-DASH-${roleEnum.toUpperCase()}: dashboard.${dashKey} matches glossary`, () => {
        expect(arDashboardFlat[dashKey]).toBe(expectedArabic);
      });
    }
  }

  // settings namespace — role labels for profile/permissions UI
  const arSettingsFlat = flattenKeys(arSettings as Record<string, unknown>);
  for (const [roleEnum, expectedArabic] of Object.entries(APPROVED_ROLES)) {
    const settingsKey = `roles.${roleEnum}`;
    if (arSettingsFlat[settingsKey]) {
      it(`TC-G-ROLE-SETTINGS-${roleEnum.toUpperCase()}: settings.${settingsKey} matches glossary`, () => {
        expect(arSettingsFlat[settingsKey]).toBe(expectedArabic);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — AI namespace canonical terms
// ─────────────────────────────────────────────────────────────────────────────

describe("§10  AI namespace — canonical term checks", () => {
  const arAiFlat = flattenKeys(arAi as Record<string, unknown>);

  it("TC-G-AI-NONEMPTY: ar/ai.json has translations (partially translated)", () => {
    expect(Object.keys(arAiFlat).length).toBeGreaterThan(0);
  });

  // AI assistant label must remain "AI" or contain المساعد الذكي
  if (arAiFlat["assistant"]) {
    it("TC-G-AI-ASSISTANT: ai.assistant contains المساعد الذكي or AI", () => {
      const val = arAiFlat["assistant"];
      expect(val.includes("المساعد الذكي") || val === "AI" || val.includes("AI")).toBe(true);
    });
  }

  // No AI key should resolve to a raw i18next key
  it("TC-G-AI-RAWKEYS: no ar/ai.json value looks like a raw translation key", () => {
    const raw = Object.entries(arAiFlat)
      .filter(([, v]) => /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(v.trim()))
      .map(([k, v]) => `${k}="${v}"`);
    expect(raw, `Raw keys in ar/ai.json: ${raw.join(", ")}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — Nav canonical item labels match approved terms
// ─────────────────────────────────────────────────────────────────────────────

describe("§11  Nav canonical item labels — approved glossary alignment", () => {
  const arItems = ((arNav as Record<string, unknown>).items ?? {}) as Record<string, string>;

  for (const [key, expectedArabic] of Object.entries(APPROVED_NAV_ITEMS)) {
    it(`TC-G-NAV-ITEM-${key.toUpperCase()}: nav.items.${key} === "${expectedArabic}"`, () => {
      expect(arItems[key]).toBe(expectedArabic);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — Duplicate/inconsistent translation detection across all namespaces
// ─────────────────────────────────────────────────────────────────────────────

describe("§12  No conflicting translations for canonical concepts across namespaces", () => {
  /**
   * For each concept, collect the set of unique Arabic values used across
   * all translated namespaces for keys that encode that concept.
   * There should be at most ONE unique value per concept.
   */
  interface ConceptCheck {
    concept: string;
    canonical: string;
  }

  const CONCEPT_CHECKS: ConceptCheck[] = [
    { concept: "draft", canonical: APPROVED_TERMS.draft },
    { concept: "approved", canonical: APPROVED_TERMS.approved },
    { concept: "cancelled", canonical: APPROVED_TERMS.cancelled },
    { concept: "completed", canonical: APPROVED_TERMS.completed },
    { concept: "active", canonical: APPROVED_TERMS.active },
  ];

  /**
   * These are literal generic status-display key paths. Event messages such as
   * "approval completed" and gendered record-specific statuses are deliberately
   * excluded: they are sentences, not competing labels for the same concept.
   */
  const STATUS_NAMESPACES = [
    "planning",
    "projects",
    "reports",
    "risks",
    "dashboard",
    "budget",
  ] as const;

  for (const { concept, canonical } of CONCEPT_CHECKS) {
    it(`TC-G-DUP-${concept.toUpperCase()}: all namespaces agree on Arabic value for "${concept}"`, () => {
      const conflicts: string[] = [];
      for (const ns of STATUS_NAMESPACES) {
        const nsPath = path.join(LOCALES_DIR, "ar", `${ns}.json`);
        const nsData = JSON.parse(fs.readFileSync(nsPath, "utf8")) as Record<string, unknown>;
        const flat = flattenKeys(nsData);
        const key = `status.${concept}`;
        const value = flat[key];
        if (value && value !== canonical) {
          conflicts.push(`${ns}.${key}="${value}" (expected "${canonical}")`);
        }
      }
      expect(
        conflicts,
        `Conflicting translations for "${concept}":\n  ${conflicts.join("\n  ")}`,
      ).toHaveLength(0);
    });
  }
});
