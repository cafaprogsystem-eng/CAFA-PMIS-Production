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

// Captured once, at module load — before LanguageProvider's own effect ever
// writes a default back to localStorage — so callers can still tell "this
// device already had an explicit language choice" apart from "this is a
// fresh device with nothing stored yet", even after that first write
// happens. Used to sync a signed-in user's saved account-level
// languagePreference on a fresh device without ever overwriting a choice
// already made on this device (from a previous sync, or the quick
// per-device switcher in the top nav, which is deliberately local-only and
// must not be fought by that sync).
const hadExplicitPreferenceAtLoad = (() => {
  try {
    return localStorage.getItem("cafa.lang") !== null;
  } catch {
    return false;
  }
})();

export function hadStoredLangPreference(): boolean {
  return hadExplicitPreferenceAtLoad;
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
