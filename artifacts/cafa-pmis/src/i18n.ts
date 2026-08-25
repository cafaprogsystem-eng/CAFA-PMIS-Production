import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// ── English translations ──────────────────────────────────────────────────
import enCommon        from "@/locales/en/common.json";
import enAuth          from "@/locales/en/auth.json";
import enNav           from "@/locales/en/nav.json";
import enDashboard     from "@/locales/en/dashboard.json";
import enProjects      from "@/locales/en/projects.json";
import enPlanning      from "@/locales/en/planning.json";
import enBudget        from "@/locales/en/budget.json";
import enReports       from "@/locales/en/reports.json";
import enRisks         from "@/locales/en/risks.json";
import enUsers         from "@/locales/en/users.json";
import enNotifications from "@/locales/en/notifications.json";
import enMessages      from "@/locales/en/messages.json";
import enAi            from "@/locales/en/ai.json";
import enKnowledge     from "@/locales/en/knowledge.json";
import enSettings      from "@/locales/en/settings.json";
import enLanding       from "@/locales/en/landing.json";
import enErrors        from "@/locales/en/errors.json";

// ── Arabic translations (production resources; parity is verified in CI) ────
import arCommon        from "@/locales/ar/common.json";
import arAuth          from "@/locales/ar/auth.json";
import arNav           from "@/locales/ar/nav.json";
import arDashboard     from "@/locales/ar/dashboard.json";
import arProjects      from "@/locales/ar/projects.json";
import arPlanning      from "@/locales/ar/planning.json";
import arBudget        from "@/locales/ar/budget.json";
import arReports       from "@/locales/ar/reports.json";
import arRisks         from "@/locales/ar/risks.json";
import arUsers         from "@/locales/ar/users.json";
import arNotifications from "@/locales/ar/notifications.json";
import arMessages      from "@/locales/ar/messages.json";
import arAi            from "@/locales/ar/ai.json";
import arKnowledge     from "@/locales/ar/knowledge.json";
import arSettings      from "@/locales/ar/settings.json";
import arLanding       from "@/locales/ar/landing.json";
import arErrors        from "@/locales/ar/errors.json";

// ── Initial language: read from localStorage before React renders ─────────
function getInitialLang(): string {
  try {
    const v = localStorage.getItem("cafa.lang");
    if (v === "en" || v === "ar") return v;
  } catch {
    // ignore — localStorage may be unavailable
  }
  return "en";
}

// ── Development missing-key detection ────────────────────────────────────
// Warns when Arabic translation keys are missing so they can be tracked
// without masking the English fallback in production.
// Note: this detects missing i18n resources only.
// Component-source audits provide a separate diagnostic for remaining raw copy.
const devMissingKeyOptions = import.meta.env.DEV
  ? {
      saveMissing: true as const,
      missingKeyHandler: (
        lngs: readonly string[],
        ns: string,
        key: string,
      ) => {
        // Only warn for Arabic — English missing keys indicate a build error
        if (lngs.includes("ar")) {
          console.warn(`[i18n] Missing Arabic translation — ns: "${ns}", key: "${key}"`);
        }
      },
    }
  : {};

// ── Initialise ────────────────────────────────────────────────────────────
const NAMESPACES = [
  "common", "auth", "nav", "dashboard", "projects", "planning",
  "budget", "reports", "risks", "users", "notifications", "messages",
  "ai", "knowledge", "settings", "landing", "errors",
] as const;

i18n
  .use(initReactI18next)
  .init({
    lng: getInitialLang(),
    fallbackLng: "en",       // Missing Arabic key → English source (never raw key)
    defaultNS: "common",
    ns: [...NAMESPACES],
    resources: {
      en: {
        common:        enCommon,
        auth:          enAuth,
        nav:           enNav,
        dashboard:     enDashboard,
        projects:      enProjects,
        planning:      enPlanning,
        budget:        enBudget,
        reports:       enReports,
        risks:         enRisks,
        users:         enUsers,
        notifications: enNotifications,
        messages:      enMessages,
        ai:            enAi,
        knowledge:     enKnowledge,
        settings:      enSettings,
        landing:       enLanding,
        errors:        enErrors,
      },
      ar: {
        common:        arCommon,
        auth:          arAuth,
        nav:           arNav,
        dashboard:     arDashboard,
        projects:      arProjects,
        planning:      arPlanning,
        budget:        arBudget,
        reports:       arReports,
        risks:         arRisks,
        users:         arUsers,
        notifications: arNotifications,
        messages:      arMessages,
        ai:            arAi,
        knowledge:     arKnowledge,
        settings:      arSettings,
        landing:       arLanding,
        errors:        arErrors,
      },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    ...devMissingKeyOptions,
  });

function syncDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language === "ar" ? "ar" : "en";
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}

syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export { NAMESPACES };
export default i18n;
