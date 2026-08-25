/**
 * i18n Parity Tests — Arabic Key Completeness Gate
 *
 * For every English production key, asserts:
 *   1. The corresponding Arabic key exists.
 *   2. The Arabic value is non-empty / non-whitespace-only.
 *
 * A legitimate ALLOWLIST covers values that must remain Latin-only by design
 * (brand identifiers, ISO currency codes, email examples, technical acronyms).
 *
 * Production requires exact English/Arabic structural parity. A zero-gap
 * fingerprint makes any missing Arabic key fail immediately instead of allowing
 * migration-era exceptions to become permanent.
 *
 * Run: npx vitest run i18n-parity
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const LOCALES_DIR = path.resolve(__dirname, "../locales");
const SRC_DIR = path.resolve(__dirname, "..");

/** All 17 production namespaces. */
const NAMESPACES = [
  "ai",
  "auth",
  "budget",
  "common",
  "dashboard",
  "errors",
  "knowledge",
  "landing",
  "messages",
  "nav",
  "notifications",
  "planning",
  "projects",
  "reports",
  "risks",
  "settings",
  "users",
] as const;

type Namespace = (typeof NAMESPACES)[number];

interface GapBaseline {
  missingCount: number;
  missingSha256: string;
  untranslated: readonly string[];
}

/**
 * Every production namespace must have no missing Arabic keys.
 */
const GAP_BASELINE: Readonly<Record<Namespace, GapBaseline>> = {
  ai: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  auth: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  budget: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  common: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  dashboard: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  errors: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  knowledge: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  landing: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  messages: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  nav: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  notifications: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  planning: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  projects: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  reports: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  risks: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  settings: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
  users: { missingCount: 0, missingSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", untranslated: [] },
};

/**
 * Allowlist of complete Arabic values (or value patterns) that legitimately
 * contain only Latin characters. These are technical identifiers, brand names,
 * currency codes, or email-address examples that must never be translated.
 *
 * A key-level allowlist entry matches when arValue === allowlisted string.
 * A pattern-level entry (RegExp) matches when arValue matches the pattern.
 *
 * Add new entries here only after a code-review decision that the value is a
 * justified exception. Do not use the allowlist to suppress translation gaps.
 */
const LATIN_ONLY_VALUE_ALLOWLIST: ReadonlySet<string> = new Set([
  // Brand / product name
  "CAFA PMIS",
  "CAFA",
  // AI / technology acronyms
  "AI",
  "URL",
  "SMS",
  "ID",
  "SOP",
  "API",
  "PDF",
  "CSV",
  "JSON",
  "HTML",
  "PWA",
  "UTC",
  // Language self-labelling
  "English",
  "العربية", // Arabic label — NOT Latin, but safe to include for completeness
  // ISO currency codes (never translated per policy)
  "USD",
  "EUR",
  "SDG",
  "GBP",
  "SAR",
  // Keyboard shortcut notation
  "⌘K",
  // Email address placeholder example
  "your.name@cafa-sd.org",
  // Required-field marker (visual, not language content)
  "*",
]);

/** Pattern matching values that are legitimately Latin-only (e.g. email addresses, codes). */
const LATIN_ONLY_PATTERNS: ReadonlyArray<RegExp> = [
  // Email addresses
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  // Telephone number placeholder example
  /^\+\d[\d x()-]+$/,
  // CAFA project/plan codes
  /^CAFA-[A-Z]+-[A-Z0-9-]+$/,
  // i18next interpolation-only values (contain only {{placeholders}} and spaces)
  /^\{\{[^}]+\}\}( \{\{[^}]+\}\})*$/,
  // Numeric count token, displayed as a compact UI badge rather than prose
  /^\+\{\{[^}]+\}\}$/,
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Flatten nested JSON to dot-notation key→value map (string leaves only). */
function flattenKeys(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[full] = v;
    } else if (typeof v === "object" && v !== null) {
      Object.assign(out, flattenKeys(v as Record<string, unknown>, full));
    }
  }
  return out;
}

/** True when a value is legitimately allowed to remain Latin-only. */
function isAllowlistedLatinValue(value: string): boolean {
  if (LATIN_ONLY_VALUE_ALLOWLIST.has(value)) return true;
  for (const pattern of LATIN_ONLY_PATTERNS) {
    if (pattern.test(value.trim())) return true;
  }
  return false;
}

/** True when a string contains at least one Arabic character. */
function containsArabic(value: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(value);
}

/** Interpolation-only fragments and punctuation are not display copy. */
function isInterpolationOrPunctuation(value: string): boolean {
  return /^(?:\s|[.,…:;!?()"'“”‘’\-–—/]|{{[A-Za-z0-9_]+}})+$/.test(value);
}
/** True when a value looks like a raw i18next key (e.g. "namespace.key.sub"). */
function looksLikeRawKey(value: string): boolean {
  return /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(value.trim());
}

function sha256(items: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Source/resource contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Literal translation calls are easy to leave behind when a component is
 * moved between namespaces. Keep this small production-surface audit next to
 * the parity suite so a missing key fails before it can become a raw label.
 */
const SOURCE_TRANSLATION_CONTRACTS = [
  {
    file: path.resolve(SRC_DIR, "components/calendar-widget.tsx"),
    namespace: "common",
    dynamicKeys: [
      ...Array.from({ length: 12 }, (_, i) => `calendarWidget.months.${i}`),
      ...Array.from({ length: 7 }, (_, i) => `calendarWidget.days.${i}`),
      ...["project", "plan", "plan_activity", "report", "risk"].map((key) => `calendarWidget.types.${key}`),
      ...["overdue", "today", "upcoming"].map((key) => `calendarWidget.due.${key}`),
    ],
  },
  {
    file: path.resolve(SRC_DIR, "components/pmr-completeness-panel.tsx"),
    namespace: "common",
    dynamicKeys: Array.from({ length: 12 }, (_, i) => `calendarWidget.months.${i}`),
  },
] as const;

function sourceLiteralTranslationKeys(source: string): string[] {
  return [...source.matchAll(/\bt\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((key) => key.startsWith("calendarWidget.") || key.startsWith("common:calendarWidget."));
}

function resourceContainsKey(flat: Record<string, string>, key: string): boolean {
  return key in flat || `${key}_one` in flat || `${key}_other` in flat;
}

describe("Production translation source contract", () => {
  for (const contract of SOURCE_TRANSLATION_CONTRACTS) {
    it(`${path.relative(SRC_DIR, contract.file)} only calls resolvable ${contract.namespace} keys`, () => {
      const source = fs.readFileSync(contract.file, "utf8");
      const resource = flattenKeys(readJson(path.join(LOCALES_DIR, "en", `${contract.namespace}.json`)));
      const missing = [
        ...sourceLiteralTranslationKeys(source)
          .map((key) => key.replace(/^common:/, ""))
          .filter((key) => !resourceContainsKey(resource, key)),
        ...contract.dynamicKeys.filter((key) => !resourceContainsKey(resource, key)),
      ];

      expect([...new Set(missing)].sort(), "Translation calls without production resources").toEqual([]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-namespace parity suites
// ─────────────────────────────────────────────────────────────────────────────

for (const ns of NAMESPACES) {
  describe(`Parity — ${ns}`, () => {
      const enPath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      const arPath = path.join(LOCALES_DIR, "ar", `${ns}.json`);

      const enFlat = flattenKeys(readJson(enPath));
      const arFlat = flattenKeys(readJson(arPath));
    const arKeys = new Set(Object.keys(arFlat));

    const enKeyList = Object.keys(enFlat);

    // ── TC-PAR-{NS}-MISSING: production resources require exact parity ───────
    it(`TC-PAR-${ns.toUpperCase()}-MISSING: Arabic resources have no missing or orphan keys`, () => {
      const missing = enKeyList.filter((k) => !arKeys.has(k)).sort();
      const baseline = GAP_BASELINE[ns];

      const extra = [...arKeys].filter((key) => !Object.hasOwn(enFlat, key)).sort();
      const empty = Object.entries(arFlat)
        .filter(([, v]) => typeof v === "string" && v.trim() === "")
        .map(([k]) => k);
      expect(
        empty,
        `${ns}: ${empty.length} empty AR value(s): ${empty.join(", ")}`,
      ).toHaveLength(0);
      expect(
        missing,
        `${ns}: ${missing.length} English key(s) missing from Arabic: ${missing.join(", ")}`,
      ).toHaveLength(baseline.missingCount);
      expect(
        sha256(missing),
        `${ns}: missing-key fingerprint changed`,
      ).toBe(baseline.missingSha256);
      expect(
        extra,
        `${ns}: ${extra.length} Arabic-only orphan key(s): ${extra.join(", ")}`,
      ).toHaveLength(0);
    });

    // ── TC-PAR-{NS}-RAWKEY: no AR value is a raw i18next key ────────────────
    it(`TC-PAR-${ns.toUpperCase()}-RAWKEY: no Arabic value looks like a raw translation key`, () => {
      const rawKeys = Object.entries(arFlat)
        .filter(([, v]) => looksLikeRawKey(v))
        .map(([k, v]) => `${k}="${v}"`);
      expect(
        rawKeys,
        `${ns}: values that look like raw keys: ${rawKeys.join(", ")}`,
      ).toHaveLength(0);
    });

    // ── TC-PAR-{NS}-UNTRANSLATED: reviewed present-value exceptions only ─────
    it(`TC-PAR-${ns.toUpperCase()}-UNTRANSLATED: present values without Arabic have not changed`, () => {
      const untranslated = Object.entries(arFlat)
        .filter(([, v]) => {
          if (typeof v !== "string") return false;
          if (v.trim() === "") return false; // caught by EMPTY test
          if (isInterpolationOrPunctuation(v)) return false;
          if (containsArabic(v)) return false;
          if (isAllowlistedLatinValue(v)) return false;
          return true;
        })
        .map(([k, v]) => `${k}="${v}"`)
        .sort();
      expect(
        untranslated,
        `${ns}: present non-Arabic values changed. Add a narrow allowlist entry for technical values or translate the value.`,
      ).toEqual(GAP_BASELINE[ns].untranslated);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-namespace summary
// ─────────────────────────────────────────────────────────────────────────────

describe("Parity — summary", () => {
  it("TC-PAR-TOTAL: total AR key count is non-zero (translation work has started)", () => {
    let total = 0;
    for (const ns of NAMESPACES) {
      const arPath = path.join(LOCALES_DIR, "ar", `${ns}.json`);
      const arFlat = flattenKeys(readJson(arPath));
      total += Object.keys(arFlat).length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it("TC-PAR-FULL-NS: at least 5 namespaces are fully translated (≥95% key coverage)", () => {
    const fullyTranslated: string[] = [];
    for (const ns of NAMESPACES) {
      const enPath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      const arPath = path.join(LOCALES_DIR, "ar", `${ns}.json`);
      const enFlat = flattenKeys(readJson(enPath));
      const arFlat = flattenKeys(readJson(arPath));
      const enCount = Object.keys(enFlat).length;
      const arCount = Object.keys(arFlat).length;
      if (enCount > 0 && arCount / enCount >= 0.95) {
        fullyTranslated.push(ns);
      }
    }
    expect(
      fullyTranslated.length,
      `Fully translated namespaces (≥95%): ${fullyTranslated.join(", ")}`,
    ).toBeGreaterThanOrEqual(5);
  });
});
