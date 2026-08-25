import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import i18n from "@/i18n";

// ── Supported languages ───────────────────────────────────────────────────
export type Language  = "en" | "ar";
export type Direction = "ltr" | "rtl";

const VALID_LANGS: readonly Language[] = ["en", "ar"] as const;

/** Read the persisted preference; default to English if absent or invalid. */
export function getStoredLang(): Language {
  try {
    const v = localStorage.getItem("cafa.lang");
    if ((VALID_LANGS as readonly string[]).includes(v ?? "")) return v as Language;
  } catch {
    // localStorage unavailable (e.g. private-browsing restrictions)
  }
  return "en";
}

/** Derive text-direction from language code. */
export function directionFor(lang: Language): Direction {
  return lang === "ar" ? "rtl" : "ltr";
}

// ── Context ───────────────────────────────────────────────────────────────
interface LanguageContextValue {
  /** Active language code — "en" | "ar" */
  lang: Language;
  /** Derived text direction — "ltr" | "rtl" */
  direction: Direction;
  /** Switch language without page reload. Persists to localStorage. */
  setLang: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  direction: "ltr",
  setLang: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getStoredLang);

  useEffect(() => {
    const dir = directionFor(lang);

    // 1. Update <html lang> and <html dir>
    document.documentElement.lang = lang;
    document.documentElement.dir  = dir;

    // 2. Persist preference
    try {
      localStorage.setItem("cafa.lang", lang);
    } catch {
      // ignore
    }

    // 3. Sync i18next (it may already be initialised before the provider mounts)
    if (i18n.isInitialized && i18n.language !== lang) {
      i18n.changeLanguage(lang).catch(() => {});
    }
  }, [lang]);

  const setLang = (next: Language) => setLangState(next);

  return (
    <LanguageContext.Provider value={{ lang, direction: directionFor(lang), setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
