/**
 * RISK-CONTRACT-01 through RISK-CONTRACT-09 (server-side)
 * Verifies scoring documentation is correct and OpenAPI enum contract matches the runtime allow-lists.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Load source files ────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(__dirname, "../../../../..");

const manualSrc = fs.readFileSync(
  path.join(WORKSPACE_ROOT, "artifacts/api-server/src/routes/manual.ts"),
  "utf-8"
);

const openApiSrc = fs.readFileSync(
  path.join(WORKSPACE_ROOT, "lib/api-spec/openapi.yaml"),
  "utf-8"
);

// ── Runtime allow-lists (mirrors risks.ts) ──────────────────────────────────

const SERVER_LIKELIHOODS = ["low", "medium", "high", "unlikely", "possible", "likely", "almost_certain"];
const SERVER_IMPACTS = ["low", "medium", "high", "critical"];
const SERVER_SEVERITIES = ["low", "medium", "high", "critical"];
const SERVER_STATUSES = [
  "open", "under_mitigation", "closed", "identified",
  "assigned", "mitigation_plan", "follow_up", "escalation", "mitigated",
];

// ── Helper: extract enum values after a field name in YAML ──────────────────
// Finds the first occurrence of `  fieldName:` followed by enum list items.
// Handles both inline `enum: [a, b]` and block `enum:\n  - a\n  - b` forms.
function extractEnumValues(yamlSrc: string, fieldName: string, afterMarker?: string): string[] {
  const src = afterMarker ? yamlSrc.slice(yamlSrc.indexOf(afterMarker)) : yamlSrc;
  // Find the field declaration
  const fieldIdx = src.search(new RegExp(`\\b${fieldName}\\s*:`));
  if (fieldIdx < 0) return [];
  const fromField = src.slice(fieldIdx);
  // Find enum keyword within next ~500 chars of that field
  const nearby = fromField.slice(0, 500);
  const enumIdx = nearby.indexOf("enum:");
  if (enumIdx < 0) return [];
  const fromEnum = nearby.slice(enumIdx + 5);
  // Try inline: enum: [a, b, c]
  const inlineMatch = fromEnum.match(/^\s*\[([^\]]+)\]/);
  if (inlineMatch) {
    return inlineMatch[1].split(",").map(v => v.trim());
  }
  // Block form: each value on a line starting with `- `
  const lines = fromEnum.split("\n");
  const vals: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s+-\s+(\S+)/);
    if (m) vals.push(m[1]);
    else if (vals.length > 0 && line.trim() !== "") break; // non-item line ends block
  }
  return vals;
}

// ── RISK-CONTRACT-01: manual.ts FULL FILE has no stale 5×5 / 1–25 / 16–25 claims

// Strip comment-only lines before scanning so historical annotations don't trigger
function liveLines(src: string): string {
  return src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
}

const manualLive = liveLines(manualSrc);

describe("RISK-CONTRACT-01 — manual.ts (full file) uses canonical 3×3 / 1–9 model", () => {
  it('contains "3×3"', () => {
    expect(manualLive).toContain("3×3");
  });
  it('contains "1–9"', () => {
    expect(manualLive).toContain("1–9");
  });
  it('does NOT contain "1–25"', () => {
    expect(manualLive).not.toContain("1–25");
  });
  it('does NOT contain "5×5"', () => {
    expect(manualLive).not.toContain("5×5");
  });
  it('does NOT contain "16–25"', () => {
    expect(manualLive).not.toContain("16–25");
  });
  it('does NOT contain "1-5" numeric severity/likelihood scale', () => {
    // Match "1–5" or "1-5" scoring references
    expect(manualLive).not.toMatch(/\(1[–-]5\)/);
  });
  it('does NOT contain "1=negligible" or "5=catastrophic" legacy scoring labels', () => {
    expect(manualLive).not.toContain("1=negligible");
    expect(manualLive).not.toContain("5=catastrophic");
  });
});

// ── RISK-CONTRACT-02: manual.ts FAQ does NOT contain stale claims ────────────

describe("RISK-CONTRACT-02 — manual.ts FAQ does not contain stale scoring claims", () => {
  const faqStart = manualSrc.indexOf('{ category: "Risks"');
  const faqSection = faqStart >= 0 ? manualSrc.slice(faqStart, faqStart + 2000) : manualSrc;

  it('FAQ does NOT contain "1–25"', () => {
    expect(faqSection).not.toContain("1–25");
  });
  it('FAQ does NOT contain "5×5"', () => {
    expect(faqSection).not.toContain("5×5");
  });
  it('FAQ does NOT contain "16–25"', () => {
    expect(faqSection).not.toContain("16–25");
  });
  it("FAQ uses canonical 3×3 explanation", () => {
    expect(faqSection).toContain("3×3");
  });
  it("FAQ category list does not include Reputational (canonical = 5 categories)", () => {
    expect(faqSection).not.toContain("Reputational");
  });
});

// ── RISK-CONTRACT-03: OpenAPI likelihood enum matches server ─────────────────

describe("RISK-CONTRACT-03 — OpenAPI likelihood enum matches server allow-list (7 values)", () => {
  // Use the Risk schema section as anchor
  const vals = extractEnumValues(openApiSrc, "likelihood", "    Risk:");

  for (const v of SERVER_LIKELIHOODS) {
    it(`likelihood enum includes "${v}"`, () => {
      expect(vals).toContain(v);
    });
  }

  it("likelihood enum has exactly 7 values", () => {
    expect(vals.length).toBe(SERVER_LIKELIHOODS.length);
  });
});

// ── RISK-CONTRACT-04: OpenAPI impact enum matches server ─────────────────────

describe("RISK-CONTRACT-04 — OpenAPI impact enum matches server allow-list (4 values)", () => {
  const vals = extractEnumValues(openApiSrc, "impact", "    RiskInput:");

  for (const v of SERVER_IMPACTS) {
    it(`impact enum includes "${v}"`, () => {
      expect(vals).toContain(v);
    });
  }
});

// ── RISK-CONTRACT-05: OpenAPI severity enum matches server ───────────────────

describe("RISK-CONTRACT-05 — OpenAPI severity enum matches server allow-list (4 values)", () => {
  const vals = extractEnumValues(openApiSrc, "severity", "    Risk:");

  for (const v of SERVER_SEVERITIES) {
    it(`severity enum includes "${v}"`, () => {
      expect(vals).toContain(v);
    });
  }

  it("severity enum has exactly 4 values", () => {
    expect(vals.length).toBe(SERVER_SEVERITIES.length);
  });
});

// ── RISK-CONTRACT-06: OpenAPI status enum matches server ─────────────────────

describe("RISK-CONTRACT-06 — OpenAPI status enum matches server allow-list (9 values)", () => {
  const vals = extractEnumValues(openApiSrc, "status", "    Risk:");

  for (const v of SERVER_STATUSES) {
    it(`status enum includes "${v}"`, () => {
      expect(vals).toContain(v);
    });
  }

  it("status enum has exactly 9 values", () => {
    expect(vals.length).toBe(SERVER_STATUSES.length);
  });
});

// ── RISK-CONTRACT-08: legacy aliases present in OpenAPI likelihood enum ───────

describe("RISK-CONTRACT-08 — legacy aliases included in OpenAPI likelihood enum", () => {
  const legacyAliases = ["unlikely", "possible", "likely", "almost_certain"];
  const vals = extractEnumValues(openApiSrc, "likelihood", "    Risk:");

  for (const alias of legacyAliases) {
    it(`legacy alias "${alias}" is present in OpenAPI likelihood enum`, () => {
      expect(vals).toContain(alias);
    });
  }
});

// ── RISK-CONTRACT-09: invalid enum values are not in the allow-list ──────────

describe("RISK-CONTRACT-09 — invalid enum values are not in OpenAPI likelihood enum", () => {
  const vals = extractEnumValues(openApiSrc, "likelihood", "    Risk:");

  it('"extreme" is not a valid likelihood', () => {
    expect(vals).not.toContain("extreme");
  });

  it('"1" is not a valid likelihood', () => {
    expect(vals).not.toContain("1");
  });
});
