/**
 * Hard-coded String Audit — i18n Regression Guard
 *
 * Scans component and page source files for user-facing English text that is
 * NOT wrapped in a `t(...)` translation call. Reports suspected hard-coded
 * strings as test failures so CI catches regressions.
 *
 * Detection targets:
 *   • JSX bare text nodes containing user-facing English words
 *   • placeholder="..." attributes with raw English text
 *   • aria-label="..." attributes with raw English text
 *   • toast("...") / toast.success("...") / toast.error("...") calls with
 *     raw string literals
 *   • header: "..." column definitions with raw English text (TanStack Table)
 *
 * Intentional exclusions:
 *   • Any string inside t("...") or t('...')
 *   • Technical identifiers: URLs, codes, email addresses, ISO codes
 *   • Single words that are proper nouns / brand names (CAFA, AI, etc.)
 *   • Comment lines (// and /* ... * /)
 *   • Import/export statements
 *   • console.log / console.error calls (dev-only)
 *   • Test fixture files
 *   • className / tailwind utility strings
 *   • Values that are entirely {{interpolation}} tokens
 *
 * Usage:
 *   npx vitest run audit-hardcoded-strings
 *
 * The output is the authoritative hard-coded string report.
 * Pipe to a file to capture: npx vitest run audit-hardcoded-strings 2>&1 | tee audit.txt
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = path.resolve(__dirname, "../");

/**
 * Patterns that identify strings as user-facing English content.
 * Each pattern is paired with a label for reporting.
 */
interface ScanPattern {
  label: string;
  /** Match a line and capture the raw string literal. */
  pattern: RegExp;
  /** Optional: extract just the string value from the match for analysis. */
  extract?: (match: RegExpMatchArray) => string;
}

const SCAN_PATTERNS: ScanPattern[] = [
  // placeholder="raw text" (not t(...))
  {
    label: "placeholder",
    pattern: /placeholder=["']([^"'{}][^"']*)["']/g,
    extract: (m) => m[1],
  },
  // aria-label="raw text"
  {
    label: "aria-label",
    pattern: /aria-label=["']([^"'{}][^"']*)["']/g,
    extract: (m) => m[1],
  },
  // title="raw text" on interactive elements (tooltip/button)
  {
    label: "title-attr",
    pattern: /\btitle=["']([a-zA-Z][^"'{}]*)["']/g,
    extract: (m) => m[1],
  },
  // toast("raw text") / toast.success("raw text") / toast.error("raw text")
  {
    label: "toast-call",
    pattern:
      /toast(?:\.\w+)?\(\s*["']([a-zA-Z][^"']*)["']/g,
    extract: (m) => m[1],
  },
  // header: "raw text" in column definition objects
  {
    label: "column-header",
    pattern: /\bheader:\s*["']([a-zA-Z][^"']*)["']/g,
    extract: (m) => m[1],
  },
  // JSX bare text node — >Raw English Text<
  {
    label: "jsx-text",
    pattern: />([a-zA-Z][a-zA-Z ]*)</g,
    extract: (m) => m[1].trim(),
  },
];

/**
 * Exact technical or data-shaped values that are not translatable UI copy.
 * These rules apply to a matched value only — never to an entire source line.
 */
const SAFE_VALUES: ReadonlySet<string> = new Set([
  "AI", "API", "CAFA", "CAFA PMIS", "CSV", "EUR", "GBP", "HTML", "ID",
  "JSON", "PDF", "PWA", "SAR", "SDG", "SMS", "SOP", "URL", "USD",
]);

const SAFE_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  /^\+\d[\d x()-]+$/,
  /^CAFA-[A-Z0-9-]+$/,
  /^\d{4}-\d{2}-\d{2}$/,
];

/**
 * Filename fragments to exclude entirely (test files, mocks, generated code).
 */
const EXCLUDED_FILE_PATTERNS: ReadonlyArray<string> = [
  ".test.",
  ".spec.",
  ".stories.",
  "__mocks__",
  "generated",
  "setup.ts",
];

/**
 * SHA-256 of JSON.stringify(sorted source-file/category/value fingerprints).
 * The exact snapshot is intentionally immutable: any new, removed, or swapped
 * finding requires a review that refreshes this digest and the audit report.
 */
const BASELINE_FINGERPRINT_COUNT = 7;
const BASELINE_FINGERPRINT_SHA256 = "f72bfea77a56092d4a3ef0680cd954386c6c7ba0757a4d8316df47b557e2202d";
const BASELINE_CATEGORY_COUNTS: Readonly<Record<string, number>> = {
  "aria-label": 0,
  "column-header": 0,
  "jsx-text": 7,
  "placeholder": 0,
  "title-attr": 0,
  "toast-call": 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scan engine
// ─────────────────────────────────────────────────────────────────────────────

interface Hit {
  file: string;
  line: number;
  label: string;
  value: string;
  context: string;
}

function isSafe(line: string, value: string): boolean {
  // Password masks and symbol-only affordances are not language content.
  if (!/[A-Za-z]{3}/.test(value)) return true;
  if (SAFE_VALUES.has(value.trim())) return true;
  return SAFE_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function scanFile(filePath: string): Hit[] {
  const relativePath = path.relative(SRC_ROOT, filePath);

  // Skip excluded files
  if (EXCLUDED_FILE_PATTERNS.some((p) => relativePath.includes(p))) return [];

  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  const hits: Hit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip comment lines and import/export lines
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export ")
    ) {
      continue;
    }

    for (const scanPattern of SCAN_PATTERNS) {
      for (const match of line.matchAll(scanPattern.pattern)) {
        const value = scanPattern.extract ? scanPattern.extract(match) : match[0];
        if (!value || value.trim().length < 2) continue;
        if (isSafe(line, value)) continue;

        hits.push({
          file: relativePath,
          line: i + 1,
          label: scanPattern.label,
          value: value.trim(),
          context: line.trim().slice(0, 120),
        });
      }
    }
  }

  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

// Collect all source files
function collectSourceFiles(): string[] {
  const files: string[] = [];
  const roots = [
    path.join(SRC_ROOT, "pages"),
    path.join(SRC_ROOT, "components"),
  ];

  function walk(directory: string): void {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  for (const root of roots) walk(root);
  return [...new Set(files)].sort();
}

const sourceFiles = collectSourceFiles();
const allHits: Hit[] = [];
const hitsByFile = new Map<string, Hit[]>();

for (const file of sourceFiles) {
  const hits = scanFile(file);
  if (hits.length > 0) {
    hitsByFile.set(path.relative(SRC_ROOT, file), hits);
    allHits.push(...hits);
  }
}

/** Stable reviewed-finding identity: source file + audit category + value. */
function fingerprint(hit: Hit): string {
  return `${hit.file}::${hit.label}::${hit.value}`;
}

const fingerprints = allHits.map(fingerprint).sort();
const fingerprintDigest = createHash("sha256")
  .update(JSON.stringify(fingerprints))
  .digest("hex");

/** Maintainer-only snapshot output for reviewing legitimate baseline changes. */
if (process.env.I18N_AUDIT_SNAPSHOT === "1") {
  console.info(JSON.stringify(fingerprints, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// §HCS-1 — Per-category audits
// ─────────────────────────────────────────────────────────────────────────────

describe("§HCS-1  Hard-coded string audit — by category", () => {
  const categories = ["placeholder", "aria-label", "toast-call", "column-header", "jsx-text", "title-attr"];

  for (const category of categories) {
    const categoryHits = allHits.filter((h) => h.label === category);

    it(`TC-HCS-${category.toUpperCase().replace(/-/g, "_")}: ${category} baseline has not changed unexpectedly`, () => {
      const report = categoryHits
        .map((h) => `  ${h.file}:${h.line} [${h.label}] "${h.value}"`)
        .join("\n");
      expect(
        categoryHits.length,
        `Found ${categoryHits.length} ${category} candidate(s), but the reviewed baseline is ${BASELINE_CATEGORY_COUNTS[category] ?? 0}:\n${report}`,
      ).toBe(BASELINE_CATEGORY_COUNTS[category] ?? 0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §HCS-2 — Per-file summary (informational)
// ─────────────────────────────────────────────────────────────────────────────

describe("§HCS-2  Hard-coded string audit — high-traffic pages", () => {
  /** High-traffic pages that must be fully clean (no hard-coded strings). */
  const CLEAN_FILES = [
    "pages/login.tsx",
    "pages/forgot-password.tsx",
    "components/auth-shell.tsx",
    "components/layout.tsx",
  ];

  for (const relFile of CLEAN_FILES) {
    it(`TC-HCS-FILE-${relFile.replace(/[/. ]/g, "_")}: ${relFile} has no hard-coded strings`, () => {
      const filePath = path.join(SRC_ROOT, relFile);
      if (!fs.existsSync(filePath)) {
        // File removed — skip rather than fail
        return;
      }
      const hits = scanFile(filePath);
      const report = hits.map((h) => `  line ${h.line} [${h.label}]: "${h.value}"`).join("\n");
      expect(hits, `${relFile} has hard-coded strings:\n${report}`).toHaveLength(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §HCS-3 — Summary report
// ─────────────────────────────────────────────────────────────────────────────

describe("§HCS-3  Hard-coded string audit — summary report", () => {
  it("TC-HCS-REPORT: audit report printed to console for CI visibility", () => {
    const totalFiles = sourceFiles.length;
    const affectedFiles = hitsByFile.size;

    const summary = [
      "",
      "══════════════════════════════════════════════════════",
      "  Hard-coded String Audit Summary",
      "══════════════════════════════════════════════════════",
      `  Files scanned:   ${totalFiles}`,
      `  Files with hits: ${affectedFiles}`,
      `  Total hits:      ${allHits.length}`,
      `  Fingerprint hash: ${fingerprintDigest}`,
      "",
    ];

    const byLabel: Record<string, number> = {};
    for (const h of allHits) {
      byLabel[h.label] = (byLabel[h.label] ?? 0) + 1;
    }
    for (const [label, count] of Object.entries(byLabel).sort()) {
      summary.push(`  ${label.padEnd(20)} ${count} hit(s)`);
    }

    summary.push("", "  Top affected files:");
    const sorted = [...hitsByFile.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [file, hits] of sorted.slice(0, 10)) {
      summary.push(`    ${hits.length.toString().padStart(3)}  ${file}`);
    }
    summary.push("══════════════════════════════════════════════════════", "");

    console.info(summary.join("\n"));

    expect(allHits.length, "The reviewed fingerprint count changed. Refresh the audit baseline intentionally.").toBe(
      BASELINE_FINGERPRINT_COUNT,
    );
    expect(
      fingerprintDigest,
      "The reviewed hard-coded string fingerprint snapshot changed. Refresh the audit baseline and report intentionally.",
    ).toBe(BASELINE_FINGERPRINT_SHA256);
  });
});
