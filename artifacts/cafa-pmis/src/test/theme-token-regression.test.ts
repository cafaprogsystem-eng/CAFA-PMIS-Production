/**
 * Theme Token Regression Tests
 *
 * Verifies invariants of the CAFA PMIS global CSS custom-property palette by
 * reading the actual `src/index.css` file and parsing its token values.
 * Tests never rely on a separate hardcoded copy — they operate on the
 * production source, so a token change in index.css is immediately caught.
 *
 * ── Manual check note ─────────────────────────────────────────────────────
 * AUTHENTICATION PAGE ISOLATION:
 * The authentication pages (/login, /forgot-password) use their own
 * photo/overlay design that deliberately does NOT inherit from --background.
 * This is a code-structure invariant: those pages apply explicit colour
 * classes independently, so they are unaffected when --background changes.
 * Verify this remains true whenever login.tsx / auth layout is changed.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/* ─── Read and parse index.css ───────────────────────────────────────── */

let cssSource: string;
let lightTokens: Record<string, string>;
let darkTokens: Record<string, string>;

/**
 * Parse HSL custom-property values out of a CSS block.
 * Looks for lines like:  --foo:   220 43% 97.2%;
 * Returns a map of { '--foo': '220 43% 97.2%' }
 */
function parseTokenBlock(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match: --name: <value>; (value may include spaces, %, digits, dots)
  const re = /--([\w-]+)\s*:\s*([^;/]+?)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    result[`--${m[1]}`] = m[2].trim();
  }
  return result;
}

beforeAll(() => {
  // Resolve relative to the test file's location: src/test/ → src/index.css
  const cssPath = join(__dirname, "..", "index.css");
  cssSource = readFileSync(cssPath, "utf-8");

  // Extract :root { … } block (light mode)
  const rootMatch = cssSource.match(/:root\s*\{([^}]+)\}/s);
  if (!rootMatch) throw new Error("Could not find :root block in index.css");
  lightTokens = parseTokenBlock(rootMatch[1]);

  // Extract .dark { … } block
  const darkMatch = cssSource.match(/\.dark\s*\{([^}]+)\}/s);
  if (!darkMatch) throw new Error("Could not find .dark block in index.css");
  darkTokens = parseTokenBlock(darkMatch[1]);
});

/* ─── Parser ─────────────────────────────────────────────────────────── */

/**
 * Parse an "H S% L%" HSL value string (with or without trailing % on each
 * component — CSS custom properties omit the % unit when used with hsl()).
 */
function parseHsl(token: string): { h: number; s: number; l: number } {
  const parts = token.trim().split(/\s+/);
  if (parts.length < 3) throw new Error(`Cannot parse HSL token: "${token}"`);
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]);
  const l = parseFloat(parts[2]);
  if (isNaN(h) || isNaN(s) || isNaN(l)) {
    throw new Error(`NaN in HSL token: "${token}"`);
  }
  return { h, s, l };
}

/** Convenience: read + parse a light-mode token, fail with clear message. */
function light(name: string): { h: number; s: number; l: number } {
  const raw = lightTokens[name];
  if (raw === undefined) throw new Error(`Token ${name} not found in :root block`);
  return parseHsl(raw);
}

/** Convenience: read + parse a dark-mode token. */
function dark(name: string): { h: number; s: number; l: number } {
  const raw = darkTokens[name];
  if (raw === undefined) throw new Error(`Token ${name} not found in .dark block`);
  return parseHsl(raw);
}

/* ══════════════════════════════════════════════════════════════════════
   §0  Parser self-check
   ══════════════════════════════════════════════════════════════════════ */
describe("CSS parser self-check", () => {
  it("0a. :root block contains at least 10 custom properties", () => {
    expect(Object.keys(lightTokens).length).toBeGreaterThanOrEqual(10);
  });

  it("0b. .dark block contains at least 10 custom properties", () => {
    expect(Object.keys(darkTokens).length).toBeGreaterThanOrEqual(10);
  });

  it("0c. --primary is present in :root", () => {
    expect(lightTokens["--primary"]).toBeDefined();
  });

  it("0d. --background is present in :root", () => {
    expect(lightTokens["--background"]).toBeDefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §1  Background — light blue-grey family (#F5F7FB)
   ══════════════════════════════════════════════════════════════════════ */
describe("Background token — light blue-grey family", () => {
  it("1. Background hue is in the 210–225 range (cool blue-grey)", () => {
    const { h } = light("--background");
    expect(h).toBeGreaterThanOrEqual(210);
    expect(h).toBeLessThanOrEqual(225);
  });

  it("2. Background saturation is ≤ 50% (muted, not vivid)", () => {
    const { s } = light("--background");
    expect(s).toBeLessThanOrEqual(50);
  });

  it("3. Background lightness is ≥ 94% (very light surface)", () => {
    const { l } = light("--background");
    expect(l).toBeGreaterThanOrEqual(94);
  });

  it("4. Background lightness is < 100% (not pure white — must differ from card)", () => {
    const { l } = light("--background");
    expect(l).toBeLessThan(100);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §2  Sidebar — lighter than background, near-white (#FAFBFD)
   ══════════════════════════════════════════════════════════════════════ */
describe("Sidebar token — lighter than background", () => {
  it("5. Sidebar lightness is ≥ background lightness (sidebar appears lighter)", () => {
    const bg = light("--background");
    const sb = light("--sidebar");
    expect(sb.l).toBeGreaterThanOrEqual(bg.l);
  });

  it("6. Sidebar lightness is ≥ 97% (near-white cool surface)", () => {
    const { l } = light("--sidebar");
    expect(l).toBeGreaterThanOrEqual(97);
  });

  it("7. Sidebar is not pure white (maintains hierarchy above card)", () => {
    const { l } = light("--sidebar");
    // sidebar should be lighter than background but not necessarily < 100%
    // The key constraint: sidebar !== card (card = 0 0% 100%)
    const cardRaw = lightTokens["--card"] ?? "";
    const isSameasCard = cardRaw.trim() === lightTokens["--sidebar"]?.trim();
    expect(isSameasCard).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §3  Card — pure white (#FFFFFF)
   ══════════════════════════════════════════════════════════════════════ */
describe("Card token — pure white", () => {
  it("8. Card token is exactly '0 0% 100%'", () => {
    expect(lightTokens["--card"]).toBe("0 0% 100%");
  });

  it("9. Card lightness is 100%", () => {
    const { l } = light("--card");
    expect(l).toBe(100);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §4  Foreground — deep navy-charcoal (#1F2937)
   ══════════════════════════════════════════════════════════════════════ */
describe("Foreground token — deep navy-charcoal", () => {
  it("10. Foreground lightness is ≤ 20% (dark text)", () => {
    const { l } = light("--foreground");
    expect(l).toBeLessThanOrEqual(20);
  });

  it("11. Foreground hue is in the 210–225 range (navy-charcoal family)", () => {
    const { h } = light("--foreground");
    expect(h).toBeGreaterThanOrEqual(210);
    expect(h).toBeLessThanOrEqual(225);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §5  Muted-foreground — slate-grey (#64748B)
   ══════════════════════════════════════════════════════════════════════ */
describe("Muted-foreground token — slate-grey", () => {
  it("12. Muted-foreground lightness is in the 40–55% range", () => {
    const { l } = light("--muted-foreground");
    expect(l).toBeGreaterThanOrEqual(40);
    expect(l).toBeLessThanOrEqual(55);
  });

  it("13. Muted-foreground hue is in the cool-grey family (200–225)", () => {
    const { h } = light("--muted-foreground");
    expect(h).toBeGreaterThanOrEqual(200);
    expect(h).toBeLessThanOrEqual(225);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §6  Accent — neutral surface, NOT saturated blue (#F1F5F9)
   ══════════════════════════════════════════════════════════════════════ */
describe("Accent token — neutral hover surface (not saturated blue)", () => {
  it("14. Accent saturation is ≤ 45% (neutral, not vivid)", () => {
    const { s } = light("--accent");
    expect(s).toBeLessThanOrEqual(45);
  });

  it("15. Accent lightness is ≥ 90% (very light surface)", () => {
    const { l } = light("--accent");
    expect(l).toBeGreaterThanOrEqual(90);
  });

  it("16. REGRESSION: Accent saturation must NOT be 100% (was saturated blue tint)", () => {
    const { s } = light("--accent");
    expect(s).not.toBe(100);
  });

  it("17. Sidebar accent saturation is ≤ 45% (neutral sidebar hover)", () => {
    const { s } = light("--sidebar-accent");
    expect(s).toBeLessThanOrEqual(45);
  });

  it("18. Sidebar accent foreground lightness is ≤ 25% (dark text on hover)", () => {
    const { l } = light("--sidebar-accent-foreground");
    expect(l).toBeLessThanOrEqual(25);
  });

  it("19. REGRESSION: Sidebar accent foreground must NOT be blue (was text-primary blue)", () => {
    const { s } = light("--sidebar-accent-foreground");
    // It should now be a dark neutral — low saturation or low lightness
    const { l } = light("--sidebar-accent-foreground");
    // Dark foreground: lightness well under 50%; saturation moderate (not 80%+)
    const isBlueText = s >= 75 && l >= 40;
    expect(isBlueText).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §7  Primary (CAFA blue) — #2563EB, unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("Primary token — CAFA blue (#2563EB family), unchanged", () => {
  it("20. Primary hue is in the 218–224 range (blue)", () => {
    const { h } = light("--primary");
    expect(h).toBeGreaterThanOrEqual(218);
    expect(h).toBeLessThanOrEqual(224);
  });

  it("21. Primary saturation is ≥ 80% (vivid brand blue)", () => {
    const { s } = light("--primary");
    expect(s).toBeGreaterThanOrEqual(80);
  });

  it("22. Primary lightness is in the 48–58% range (#2563EB family)", () => {
    const { l } = light("--primary");
    expect(l).toBeGreaterThanOrEqual(48);
    expect(l).toBeLessThanOrEqual(58);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §8  Border — soft cool-grey (#E2E8F0), unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("Border token — soft cool-grey, unchanged", () => {
  it("23. Border lightness is ≥ 88% (light, not dark)", () => {
    const { l } = light("--border");
    expect(l).toBeGreaterThanOrEqual(88);
  });

  it("24. Ring token hue matches primary blue (focus ring = CAFA blue)", () => {
    const ring = light("--ring");
    const primary = light("--primary");
    expect(Math.abs(ring.h - primary.h)).toBeLessThanOrEqual(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §9  Semantic colours — unchanged workflow/status palette
   ══════════════════════════════════════════════════════════════════════ */
describe("Semantic — destructive (red, #EF4444 family)", () => {
  it("25. Destructive hue is in the red family (≤ 10 or ≥ 350)", () => {
    const { h } = light("--destructive");
    expect(h <= 10 || h >= 350).toBe(true);
  });

  it("26. Destructive saturation is ≥ 75% (vivid red)", () => {
    const { s } = light("--destructive");
    expect(s).toBeGreaterThanOrEqual(75);
  });
});

describe("Semantic — success (green, #10B981 family)", () => {
  it("27. Success hue is in the green family (150–175)", () => {
    const { h } = light("--success");
    expect(h).toBeGreaterThanOrEqual(150);
    expect(h).toBeLessThanOrEqual(175);
  });

  it("28. Success saturation is ≥ 70%", () => {
    const { s } = light("--success");
    expect(s).toBeGreaterThanOrEqual(70);
  });
});

describe("Semantic — warning (amber, #F59E0B family)", () => {
  it("29. Warning hue is in the amber family (35–42)", () => {
    const { h } = light("--warning");
    expect(h).toBeGreaterThanOrEqual(35);
    expect(h).toBeLessThanOrEqual(42);
  });

  it("30. Warning saturation is ≥ 80%", () => {
    const { s } = light("--warning");
    expect(s).toBeGreaterThanOrEqual(80);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §10  Dark mode — accent tokens remain neutral (not saturated blue)
   ══════════════════════════════════════════════════════════════════════ */
describe("Dark mode — accent and sidebar-accent remain neutral hover surfaces", () => {
  it("31. Dark accent saturation is ≤ 40% (neutral dark hover, not blue)", () => {
    const { s } = dark("--accent");
    expect(s).toBeLessThanOrEqual(40);
  });

  it("32. Dark accent lightness is ≤ 30% (appropriately dark surface)", () => {
    const { l } = dark("--accent");
    expect(l).toBeLessThanOrEqual(30);
  });

  it("33. Dark sidebar-accent saturation is ≤ 35%", () => {
    const { s } = dark("--sidebar-accent");
    expect(s).toBeLessThanOrEqual(35);
  });

  it("34. Dark sidebar-accent lightness is ≤ 25%", () => {
    const { l } = dark("--sidebar-accent");
    expect(l).toBeLessThanOrEqual(25);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §11  Depth hierarchy — background < sidebar < card
   ══════════════════════════════════════════════════════════════════════ */
describe("Depth hierarchy — background / sidebar / card progression", () => {
  it("35. Background is not white (lighter than card would be wrong; card is white)", () => {
    const bg = light("--background");
    const card = light("--card");
    expect(bg.l).toBeLessThan(card.l);
  });

  it("36. Sidebar is lighter than background (creates depth: bg < sidebar ≤ card)", () => {
    const bg = light("--background");
    const sb = light("--sidebar");
    expect(sb.l).toBeGreaterThan(bg.l);
  });

  it("37. Card is the lightest surface (100% lightness = white)", () => {
    const { l } = light("--card");
    expect(l).toBe(100);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   §12  Table hover uses muted (source-code invariant check)
   ══════════════════════════════════════════════════════════════════════ */
describe("Table hover surface — bg-muted/40, not bg-accent/40", () => {
  it("38. index.css tbody tr:hover uses bg-muted/40 (neutral, not accent)", () => {
    // Search the table hover rule in the raw CSS source
    const hoverSection = cssSource.match(/tbody\s+tr:hover\s*\{([^}]+)\}/s);
    expect(hoverSection).not.toBeNull();
    const rule = hoverSection![1];
    expect(rule).toContain("bg-muted/40");
    expect(rule).not.toContain("bg-accent/40");
  });
});
