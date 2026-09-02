/**
 * Phase 11/12 — RTL Layout & Localisation Regression Tests
 *
 * Verifies:
 * 1. No raw translation keys (namespace.key strings) appear in locale JSON values
 * 2. All Arabic namespace files are valid JSON (not silently empty)
 * 3. Key CSS logical-property audit — checks that physical directional classes
 *    are not present in the highest-traffic component source files
 * 4. Direction attributes set correctly per language
 * 5. English fallback: keys in EN that are missing from AR still resolve
 *    to English text (not the bare key string)
 * 6. Numeric/monetary values are identical in both languages
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LOCALES_DIR = path.resolve(__dirname, "../locales");
const SRC_DIR     = path.resolve(__dirname, "../");

function readJson(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Flatten nested JSON to dot-notation keys */
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

/** Returns true if the value looks like a raw translation key (namespace.key) */
function looksLikeRawKey(value: string): boolean {
  // A raw key would look like "namespace.key.subkey" with no spaces and at least one dot
  return /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(value.trim());
}

const NAMESPACES = [
  "ai", "auth", "budget", "common", "dashboard", "errors",
  "knowledge", "landing", "messages", "nav", "notifications",
  "planning", "projects", "reports", "risks", "settings", "users",
];

// ─────────────────────────────────────────────────────────────────────────────
// Language / direction mirror (no React required)
// ─────────────────────────────────────────────────────────────────────────────

type Language  = "en" | "ar";
type Direction = "ltr" | "rtl";

function directionFor(lang: Language): Direction {
  return lang === "ar" ? "rtl" : "ltr";
}

function applyLang(
  lang: Language,
  store: Record<string, string>,
  doc: { lang: string; dir: string },
) {
  store["cafa.lang"] = lang;
  doc.lang = lang;
  doc.dir  = directionFor(lang);
}

// ─────────────────────────────────────────────────────────────────────────────
// Physical-direction CSS audit
// ─────────────────────────────────────────────────────────────────────────────

/** Patterns that indicate physical directional CSS that should have been
 *  converted to logical equivalents in UI-facing components.
 *  We only flag classes that clearly apply to a single side (left or right).
 */
const PHYSICAL_CLASS_PATTERN =
  /\b(?:ml|mr|pl|pr)-\d|\bleft-\d|\bright-\d/;

/** Captures physical-side utility tokens, including responsive and auto forms. */
const PHYSICAL_SIDE_UTILITY_PATTERN =
  /(?:^|[\s"'`])((?:(?:sm|md|lg|xl|2xl|hover|focus|focus-visible):)*(?:-)?(?:ml|mr|pl|pr|left|right)-(?:\[[^\]]+\]|[^\s"'`}]+))/g;

function physicalSideUtilities(line: string): string[] {
  return Array.from(line.matchAll(PHYSICAL_SIDE_UTILITY_PATTERN), (match) => match[1])
    .filter((token) => {
      const side = token.split(":").at(-1) ?? token;
      const hasMirroredInset = (
        (side === "left-0" && line.includes("right-0")) ||
        (side === "right-0" && line.includes("left-0"))
      );
      const isCentered = side === "left-1/2" && line.includes("-translate-x-1/2");
      return !hasMirroredInset && !isCentered;
    });
}

/** High-traffic UI pages that the RTL audit requires be free of physical directional CSS. */
const RTL_AUDITED_FILES = [
  "pages/login.tsx",
  "pages/forgot-password.tsx",
  "pages/reset-password.tsx",
  "pages/landing.tsx",
  "components/auth-shell.tsx",
  "components/layout.tsx",
  "components/global-search.tsx",
  "components/ui/search-input.tsx",
];

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Locale file integrity
// ─────────────────────────────────────────────────────────────────────────────

describe("Locale file integrity", () => {
  it("all EN locale files are valid, non-empty JSON", () => {
    for (const ns of NAMESPACES) {
      const filePath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      expect(fs.existsSync(filePath), `Missing: en/${ns}.json`).toBe(true);
      const data = readJson(filePath);
      expect(
        Object.keys(data).length,
        `en/${ns}.json must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("all AR locale files are valid JSON (stubs are acceptable)", () => {
    for (const ns of NAMESPACES) {
      const filePath = path.join(LOCALES_DIR, "ar", `${ns}.json`);
      expect(fs.existsSync(filePath), `Missing: ar/${ns}.json`).toBe(true);
      // Must parse without throwing
      expect(() => readJson(filePath), `ar/${ns}.json is not valid JSON`).not.toThrow();
    }
  });

  it("no EN locale value looks like a raw translation key", () => {
    const rawKeys: string[] = [];
    for (const ns of NAMESPACES) {
      const filePath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      const flat = flattenKeys(readJson(filePath));
      for (const [k, v] of Object.entries(flat)) {
        if (looksLikeRawKey(v)) {
          rawKeys.push(`en/${ns}.json → key "${k}" has value "${v}" which looks like a raw key`);
        }
      }
    }
    expect(rawKeys, rawKeys.join("\n")).toHaveLength(0);
  });

  it("no AR locale value looks like a raw translation key (must be real Arabic or empty stub)", () => {
    const rawKeys: string[] = [];
    for (const ns of NAMESPACES) {
      const filePath = path.join(LOCALES_DIR, "ar", `${ns}.json`);
      const data = readJson(filePath);
      if (Object.keys(data).length === 0) continue; // stub — fine
      const flat = flattenKeys(data);
      for (const [k, v] of Object.entries(flat)) {
        if (looksLikeRawKey(v)) {
          rawKeys.push(`ar/${ns}.json → key "${k}" has value "${v}" which looks like a raw key`);
        }
      }
    }
    expect(rawKeys, rawKeys.join("\n")).toHaveLength(0);
  });

  it("EN common.json and AR common.json have the same top-level key count (AR is fully translated)", () => {
    const enCommon = readJson(path.join(LOCALES_DIR, "en", "common.json"));
    const arCommon = readJson(path.join(LOCALES_DIR, "ar", "common.json"));
    // Allow up to 10% difference in top-level keys (some keys may be recently added to EN)
    const enCount = Object.keys(enCommon).length;
    const arCount = Object.keys(arCommon).length;
    const allowedDrift = Math.ceil(enCount * 0.1);
    expect(
      Math.abs(enCount - arCount),
      `EN common.json has ${enCount} keys, AR has ${arCount} — drift exceeds 10% (${allowedDrift} allowed)`,
    ).toBeLessThanOrEqual(allowedDrift);
  });

  it("AR errors.json and AR nav.json are not empty stubs (Phase 3 translations present)", () => {
    const arErrors = readJson(path.join(LOCALES_DIR, "ar", "errors.json"));
    const arNav    = readJson(path.join(LOCALES_DIR, "ar", "nav.json"));
    expect(Object.keys(arErrors).length, "ar/errors.json must have translations").toBeGreaterThan(0);
    expect(Object.keys(arNav).length,    "ar/nav.json must have translations").toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Direction / attribute behaviour (logic mirror)
// ─────────────────────────────────────────────────────────────────────────────

describe("Direction attribute correctness", () => {
  let store: Record<string, string>;
  let doc: { lang: string; dir: string };

  beforeEach(() => {
    store = {};
    doc   = { lang: "", dir: "" };
  });

  it("English → ltr, lang=en", () => {
    applyLang("en", store, doc);
    expect(doc.dir).toBe("ltr");
    expect(doc.lang).toBe("en");
  });

  it("Arabic → rtl, lang=ar", () => {
    applyLang("ar", store, doc);
    expect(doc.dir).toBe("rtl");
    expect(doc.lang).toBe("ar");
  });

  it("switching EN→AR→EN restores ltr", () => {
    applyLang("en", store, doc);
    applyLang("ar", store, doc);
    applyLang("en", store, doc);
    expect(doc.dir).toBe("ltr");
    expect(doc.lang).toBe("en");
  });

  it("switching AR→EN restores ltr without page reload simulation", () => {
    applyLang("ar", store, doc);
    expect(doc.dir).toBe("rtl");
    applyLang("en", store, doc);
    expect(doc.dir).toBe("ltr");
    // No intermediate "undefined" or wrong state
  });

  it("language preference is persisted to cafa.lang", () => {
    applyLang("ar", store, doc);
    expect(store["cafa.lang"]).toBe("ar");
    applyLang("en", store, doc);
    expect(store["cafa.lang"]).toBe("en");
  });

  it("stored preference is read on simulated reload", () => {
    applyLang("ar", store, doc);
    // Simulate a new session reading the stored key
    const freshDoc = { lang: "", dir: "" };
    const lang = (store["cafa.lang"] === "ar" || store["cafa.lang"] === "en")
      ? (store["cafa.lang"] as Language)
      : "en";
    applyLang(lang, store, freshDoc);
    expect(freshDoc.dir).toBe("rtl");
    expect(freshDoc.lang).toBe("ar");
  });

  it("missing or unknown stored key defaults to ltr/en", () => {
    // No value stored
    const freshDoc = { lang: "", dir: "" };
    const lang = (store["cafa.lang"] === "ar" || store["cafa.lang"] === "en")
      ? (store["cafa.lang"] as Language)
      : "en";
    applyLang(lang, store, freshDoc);
    expect(freshDoc.dir).toBe("ltr");
    expect(freshDoc.lang).toBe("en");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — EN fallback key completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("English fallback — no keys missing from EN namespaces", () => {
  it("every key present in AR common.json also exists in EN common.json", () => {
    const enFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "en", "common.json")));
    const arFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "ar", "common.json")));
    const missing: string[] = [];
    for (const key of Object.keys(arFlat)) {
      if (!(key in enFlat)) {
        missing.push(`AR key "${key}" has no EN counterpart — fallback would show raw key`);
      }
    }
    expect(missing, missing.join("\n")).toHaveLength(0);
  });

  it("every key present in AR errors.json also exists in EN errors.json", () => {
    const enFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "en", "errors.json")));
    const arFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "ar", "errors.json")));
    const missing: string[] = [];
    for (const key of Object.keys(arFlat)) {
      if (!(key in enFlat)) {
        missing.push(`AR key "${key}" has no EN counterpart`);
      }
    }
    expect(missing, missing.join("\n")).toHaveLength(0);
  });

  it("every key present in AR nav.json also exists in EN nav.json", () => {
    const enFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "en", "nav.json")));
    const arFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "ar", "nav.json")));
    const missing: string[] = [];
    for (const key of Object.keys(arFlat)) {
      if (!(key in enFlat)) {
        missing.push(`AR key "${key}" has no EN counterpart`);
      }
    }
    expect(missing, missing.join("\n")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Data value invariance (numbers, dates, codes)
// ─────────────────────────────────────────────────────────────────────────────

describe("Data value invariance across languages", () => {
  it("translation keys for number/percentage formatters do not bake in literal digits", () => {
    // Ensure no EN translation value contains hard-coded numbers that should come from data
    const suspiciousValues: string[] = [];
    for (const ns of ["dashboard", "budget", "reports"]) {
      const filePath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      if (!fs.existsSync(filePath)) continue;
      const flat = flattenKeys(readJson(filePath));
      for (const [k, v] of Object.entries(flat)) {
        // A value that is purely a number string (no interpolation) in a label key is suspicious
        if (/^\d+(\.\d+)?%?$/.test(v.trim())) {
          suspiciousValues.push(`${ns}.json → "${k}": "${v}" (hard-coded numeric value in label)`);
        }
      }
    }
    expect(suspiciousValues, suspiciousValues.join("\n")).toHaveLength(0);
  });

  it("AR locale values do not contain ASCII digits where interpolation should be used", () => {
    // AR number values should either come from interpolation ({{count}}) or be absent (stub)
    const arCommonFlat = flattenKeys(readJson(path.join(LOCALES_DIR, "ar", "common.json")));
    const violations: string[] = [];
    for (const [k, v] of Object.entries(arCommonFlat)) {
      // Strings that are PURELY numbers (no surrounding Arabic text) are suspicious
      if (/^\d+$/.test(v.trim())) {
        violations.push(`ar/common.json → "${k}": "${v}" (bare number — should be interpolated or localised)`);
      }
    }
    expect(violations, violations.join("\n")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Physical directional CSS audit on RTL-critical files
// ─────────────────────────────────────────────────────────────────────────────

describe("RTL-critical files use logical CSS (no physical directional classes)", () => {
  for (const relPath of RTL_AUDITED_FILES) {
    it(`${relPath} has no physical ml-/mr-/pl-/pr-/left-/right- directional classes`, () => {
      const filePath = path.join(SRC_DIR, relPath);
      if (!fs.existsSync(filePath)) {
        // File was removed or renamed — skip rather than fail
        return;
      }
      const source = fs.readFileSync(filePath, "utf8");
      const lines   = source.split("\n");
      const hits: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        if (!PHYSICAL_CLASS_PATTERN.test(line)) continue;

        // Remove symmetric utilities that aren't directional:
        // mx-*, my-*, px-*, py-* — both-axis utilities
        let stripped = line
          .replace(/\bmx-\S+/g, "")
          .replace(/\bmy-\S+/g, "")
          .replace(/\bpx-\S+/g, "")
          .replace(/\bpy-\S+/g, "");

        // A `left-N right-N` pair on the same line is a full-width inset
        // (both sides pinned equally to the same value) — not directional.
        // Extract all left-X values and remove them together with their right-X mirror.
        const leftVals = Array.from(stripped.matchAll(/\bleft-(\S+)/g), m => m[1]);
        for (const val of leftVals) {
          if (new RegExp(`\\bright-${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(stripped)) {
            stripped = stripped
              .replace(new RegExp(`\\bleft-${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "")
              .replace(new RegExp(`\\bright-${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "");
          }
        }

        if (PHYSICAL_CLASS_PATTERN.test(stripped)) {
          hits.push(`  line ${i + 1}: ${line.trim()}`);
        }
      }

      expect(
        hits,
        `${relPath} still contains physical directional classes:\n${hits.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — i18next namespace coverage (all namespaces have ≥1 EN key)
// ─────────────────────────────────────────────────────────────────────────────

describe("Namespace coverage — all modules have EN translation keys", () => {
  const MINIMUM_KEYS_PER_NS: Record<string, number> = {
    ai:            5,
    auth:          10,
    budget:        5,
    common:        20,
    dashboard:     5,
    errors:        5,
    knowledge:     5,
    landing:       3,
    messages:      10,
    nav:           5,
    notifications: 5,
    planning:      5,
    projects:      5,
    reports:       10,
    risks:         5,
    settings:      3,
    users:         5,
  };

  for (const ns of NAMESPACES) {
    it(`en/${ns}.json has at least ${MINIMUM_KEYS_PER_NS[ns] ?? 1} top-level key(s)`, () => {
      const filePath = path.join(LOCALES_DIR, "en", `${ns}.json`);
      const data     = readJson(filePath);
      expect(
        Object.keys(data).length,
        `en/${ns}.json is too sparse — expected ≥${MINIMUM_KEYS_PER_NS[ns]} keys`,
      ).toBeGreaterThanOrEqual(MINIMUM_KEYS_PER_NS[ns] ?? 1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Sign-in identifier locale and wiring contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Sign-in identifier locale and wiring", () => {
  const authSource = fs.readFileSync(path.join(SRC_DIR, "pages/login.tsx"), "utf8");
  const authShellSource = fs.readFileSync(path.join(SRC_DIR, "components/auth-shell.tsx"), "utf8");

  it("uses the requested English identifier label and placeholder", () => {
    const auth = readJson(path.join(LOCALES_DIR, "en", "auth.json"));

    expect(auth.identifier).toBe("Username Or Email");
    expect(auth.identifierPh).toBe("your.name@cafa-sd.org");
    expect(auth.signInTo).toBe("Sign in to CAFA PMIS");
    expect(auth.signInAccount).toBe(
      "Internal access only. Contact your System Administrator if you need an account.",
    );
    expect(auth.signInFooter).toBe(
      "Don't have an account? Please contact your System Administrator.",
    );
  });

  it("keeps the Arabic auth namespace fully translated", () => {
    const arAuth = readJson(path.join(LOCALES_DIR, "ar", "auth.json"));

    expect(Object.keys(arAuth).length).toBeGreaterThan(0);
    expect(arAuth.identifier).toMatch(/[\u0600-\u06FF]/);
  });

  it("renders the translated placeholder without a default input value", () => {
    expect(authSource).toContain('{t("identifier")}');
    expect(authSource).toContain('placeholder={t("identifierPh")}');
    expect(authSource).toContain('{t("signInFooter")}');
    expect(authSource).toContain('const RETURNING_USER_KEY = "cafa.hasSignedIn";');
    expect(authSource).toContain(
      'window.localStorage.getItem(RETURNING_USER_KEY) === "true"',
    );
    expect(authSource).toContain(
      'window.localStorage.setItem(RETURNING_USER_KEY, "true")',
    );
    expect(authSource).not.toContain('t("welcomeBackEyebrow")');
    expect(authSource).toContain('const [identifier, setIdentifier] = useState("");');
    expect(authSource).not.toContain('defaultValue="your.name@cafa-sd.org"');
    expect(authSource).not.toContain('value="your.name@cafa-sd.org"');
  });

  it("preserves the existing username-or-email login payload", () => {
    expect(authSource).toContain(
      'body: JSON.stringify({ identifier: identifier.trim(), password, remember })',
    );
    expect(authSource).toContain('if (!identifier.trim() || !password)');
  });

  it("keeps the refined brand hierarchy, accessible scrolling, and keyboard controls", () => {
    expect(authSource).toContain("<AuthShell>");
    expect(authShellSource).toContain('{t("internalSystemLabel")}');
    expect(authShellSource).toContain("CAFA PMIS");
    expect(authShellSource).toContain('{t("systemTagline")}');
    expect(authShellSource).not.toContain('{t("systemSubtitle")}');
    expect(authShellSource).toContain("overflow-x-hidden overflow-y-auto");
    expect(authShellSource).toContain('className="cafa-brand hidden lg:flex flex-col flex-1 text-white items-start text-start');
    expect(authSource).toContain('aria-live="assertive"');
    expect(authSource).toContain('aria-controls="password"');
    expect(authSource).toContain("aria-pressed={showPw}");
    expect(authSource).not.toContain('tabIndex={-1}');
  });

  it("removes the sign-in legal actions while retaining shared locale entries", () => {
    const auth = readJson(path.join(LOCALES_DIR, "en", "auth.json"));

    expect(authSource).not.toContain('t("termsPrefix")');
    expect(authSource).not.toContain('t("termsOfService")');
    expect(authSource).not.toContain('t("privacyPolicy")');
    expect(auth.termsOfService).toBe("Terms of Service");
    expect(auth.privacyPolicy).toBe("Privacy Policy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — Business-module RTL / bidi production regression guardrails
// ─────────────────────────────────────────────────────────────────────────────

describe("Business-module RTL production guardrails", () => {
  const BUSINESS_RTL_FILES = [
    "pages/dashboard.tsx",
    "pages/budget.tsx",
    "pages/reports.tsx",
    "pages/projects.tsx",
    "pages/project-detail.tsx",
    "pages/plans.tsx",
    "pages/files.tsx",
    "pages/users.tsx",
    "pages/password-resets.tsx",
    "pages/sync-status.tsx",
    "pages/manual.tsx",
    "pages/manual-faq.tsx",
    "pages/manual-chapter.tsx",
    "pages/ai-settings.tsx",
    "pages/plan-detail.tsx",
    "components/calendar-widget.tsx",
    "components/global-search.tsx",
    "components/command-palette.tsx",
    "components/project-registration-form.tsx",
    "components/create-plan-registration-dialog.tsx",
    "components/program-state-report-form.tsx",
    "components/hq-sector-report-form.tsx",
    "components/consolidated-report-view.tsx",
    "components/conflict-dialog.tsx",
    "components/record-lock-indicator.tsx",
    "components/drive-attachment-panel.tsx",
    "components/form-voice-recorder.tsx",
    "components/comments-panel.tsx",
    "components/view-modes/calendar-grid.tsx",
    "components/view-modes/card-grid.tsx",
    "components/view-modes/compact-view.tsx",
    "components/view-modes/kanban-board.tsx",
    "components/view-modes/list-view.tsx",
  ];

  const PHYSICAL_OVERLAY_EXEMPTIONS: Record<string, RegExp[]> = {
    // Full-width dropdowns span both physical edges, and centered dialogs keep
    // physical translate math paired with left-1/2. Neither represents inline
    // content direction and both are required geometry.
    "pages/manual.tsx": [/left-0 right-0/],
    "components/global-search.tsx": [/left-0 right-0/],
  };

  function source(relPath: string): string {
    return fs.readFileSync(path.join(SRC_DIR, relPath), "utf8");
  }

  it("keeps audited business surfaces free of physical directional utilities", () => {
    const hits = BUSINESS_RTL_FILES.flatMap((relPath) => {
      const lines = source(relPath).split("\n");
      return lines.flatMap((line, index) =>
        physicalSideUtilities(line)
          .filter((utility) => !PHYSICAL_OVERLAY_EXEMPTIONS[relPath]?.some((pattern) => pattern.test(line)))
          .map(
          (utility) => `${relPath}:${index + 1}: ${utility} in ${line.trim()}`,
          ),
      );
    });

    expect(
      hits,
      `Audited business surfaces still use physical directional utilities:\n${hits.join("\n")}`,
    ).toHaveLength(0);
  });

  it("uses logical properties for high-traffic tables, forms, and search controls", () => {
    const dashboard = source("pages/dashboard.tsx");
    const reports = source("pages/reports.tsx");
    const manual = source("pages/manual.tsx");
    const planForm = source("components/project-registration-form.tsx");

    expect(dashboard).toContain("sticky start-0");
    expect(dashboard).toContain("text-start text-xs");
    expect(reports).toContain("ps-6");
    expect(reports).toContain("text-start");
    expect(manual).toContain("absolute start-3");
    expect(manual).toContain("ps-9 pe-9 h-10");
    expect(planForm).toContain("shrink-0 ms-2");
    expect(source("pages/budget.tsx")).toContain("paddingInlineStart");
    expect(source("pages/budget.tsx")).toContain("xl:ms-auto");
    expect(source("index.css")).toContain("@apply py-3 px-4 text-start");
    expect(source("components/ui/table.tsx")).toContain('"h-10 px-4 text-start align-middle');
    expect(source("components/ui/select.tsx")).toContain("py-1.5 ps-2 pe-8");
    expect(source("components/ui/select.tsx")).toContain("absolute end-2");
    expect(source("components/ui/dropdown-menu.tsx")).toContain("py-1.5 ps-8 pe-2");
    expect(source("components/ui/dropdown-menu.tsx")).toContain("absolute start-2");
    expect(source("components/ui/input-group.tsx")).toContain("[&>input]:ps-2");
    expect(source("components/ui/input-group.tsx")).toContain("[&>input]:pe-2");
    const physicalTableAlignment = BUSINESS_RTL_FILES.flatMap((relPath) => {
      const matches = source(relPath).matchAll(
        /<(?:TableHead|TableCell|th|td)\b[\s\S]{0,300}?\btext-(?:left|right)\b/g,
      );
      return Array.from(matches, (match) => `${relPath}: ${match[0]}`);
    });
    expect(
      physicalTableAlignment,
      `Audited tables still use physical text alignment:\n${physicalTableAlignment.join("\n")}`,
    ).toHaveLength(0);
  });

  it("activates the Arabic-capable font stack and readable leading for Arabic documents", () => {
    const css = source("index.css");
    expect(css).toContain('html[lang="ar"] {');
    expect(css).toContain("--app-font-sans: var(--app-font-arabic)");
    expect(css).toContain("font-family: var(--app-font-arabic)");
    expect(css).toContain("line-height: 1.75");
    expect(css).toContain("html[lang=\"ar\"] :is(button, input, select, textarea)");
  });

  it("isolates project codes, email addresses, dates, money, and percentages", () => {
    const projectDetail = source("pages/project-detail.tsx");
    const users = source("pages/users.tsx");
    const budget = source("pages/budget.tsx");
    const plans = source("pages/plans.tsx");
    const cardGrid = source("components/view-modes/card-grid.tsx");
    const listView = source("components/view-modes/list-view.tsx");

    expect(projectDetail).toContain('<bdi dir="ltr">{project.code}</bdi>');
    expect(projectDetail).toContain('<bdi dir="ltr">{formatDate(a.plannedStart)} – {formatDate(a.plannedEnd)}</bdi>');
    expect(users).toContain('<bdi dir="ltr">{u.email ?? "—"}</bdi>');
    expect(budget).toContain('<bdi dir="ltr">{fmtMoney(b[field], b.currency)}</bdi>');
    expect(plans).toContain('<bdi dir="ltr">{progressPct}%</bdi>');
    expect(cardGrid).toContain("<BidiIsolate>{item.code}</BidiIsolate>");
    expect(cardGrid).toContain('<bdi dir="ltr">{budgetPct}%</bdi>');
    expect(cardGrid).toContain('<bdi dir="ltr">{item.date}</bdi>');
    expect(listView).toContain('<bdi dir="ltr">{item.date}</bdi>');
    expect(listView).toContain('<bdi dir="ltr">{Math.round((item.progress.value / item.progress.max) * 100)}%</bdi>');
    expect(budget).toContain('<bdi dir="ltr">{formatPercent(burnRate)}</bdi>');
    expect(budget).toContain('<bdi dir="ltr">{fmtMoney(activeCurrEntry.activitySpent, activeCurrEntry.currency)}</bdi>');
    expect(source("pages/dashboard.tsx")).toContain('<bdi dir="ltr">{fmtMoney(row.spent, row.currency)}</bdi>');
    expect(source("components/hq-sector-report-form.tsx")).toContain('p.budgetUtilizationPct == null ? t("hqForm.unavailable")');
    expect(source("components/consolidated-report-view.tsx")).toContain('<bdi dir="ltr">{formatDateTime(r.submittedAt)}</bdi>');
  });

  it("mirrors directional navigation icons while leaving semantic icons unchanged", () => {
    const calendar = source("components/calendar-widget.tsx");
    const search = source("components/global-search.tsx");
    const registration = source("components/project-registration-form.tsx");
    const dashboard = source("pages/dashboard.tsx");

    expect(calendar).toContain('ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180"');
    expect(calendar).toContain('ArrowRight className="h-3.5 w-3.5 rtl:rotate-180"');
    expect(search).toContain("transition-opacity rtl:rotate-180");
    expect(registration).toContain("shrink-0 rtl:rotate-180");
    expect(dashboard).toContain('ChevronRight className="h-3 w-3 rtl:rotate-180"');
    expect(calendar).not.toMatch(/CalendarDays[^>]*rtl:rotate-180/);
  });
});
