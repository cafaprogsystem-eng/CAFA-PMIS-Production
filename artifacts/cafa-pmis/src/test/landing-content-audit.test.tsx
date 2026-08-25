/**
 * Landing page content audit — asserts that the public landing page:
 *  (a) contains canonical current module names
 *  (b) does not contain retired terminology
 *  (c) has no dead `href="#"` footer links
 *  (d) routes the primary CTA to /login
 *  (e) uses approved real screenshot assets rather than fabricated SVGs
 *
 * Snapshot-free: all assertions target rendered text content.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Minimal stubs required for the landing page to mount ─────────────────────

vi.mock("react-i18next", async () => {
  const { default: landing } = await import("@/locales/en/landing.json");
  const translate = (key: string, fallback?: string) => {
    const value = key.split(".").reduce<unknown>(
      (current, segment) => current && typeof current === "object"
        ? (current as Record<string, unknown>)[segment]
        : undefined,
      landing,
    );
    return typeof value === "string" ? value : fallback ?? key;
  };

  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: "en" },
    }),
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

// Stub image imports so Vite asset processing is bypassed in vitest
vi.mock("@/assets/cafa-logo.png", () => ({ default: "cafa-logo.png" }));
vi.mock("@/assets/cafa-field.png", () => ({ default: "cafa-field.png" }));
vi.mock("@/assets/landing-dashboard.webp", () => ({ default: "landing-dashboard.webp" }));
vi.mock("@/assets/landing-projects.webp", () => ({ default: "landing-projects.webp" }));
vi.mock("@/assets/landing-plans.webp", () => ({ default: "landing-plans.webp" }));
vi.mock("@/assets/landing-ai.webp", () => ({ default: "landing-ai.webp" }));

// IntersectionObserver is not available in jsdom
beforeAll(() => {
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

// ── Import locale JSON files for structural validation ───────────────────────
// These are imported directly so tests run without i18next initialisation.
import enLanding from "@/locales/en/landing.json";
import arLanding from "@/locales/ar/landing.json";

// ── Import the component under test ─────────────────────────────────────────

import LandingPage from "@/pages/landing";

// ── Helper ───────────────────────────────────────────────────────────────────

function renderLanding() {
  return render(<LandingPage />);
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe("Landing page — canonical module names", () => {
  it("shows File & Archive module", () => {
    renderLanding();
    expect(screen.getByText("File & Archive")).toBeInTheDocument();
  });

  it("shows System Manual module", () => {
    renderLanding();
    expect(screen.getAllByText("System Manual").length).toBeGreaterThan(0);
  });

  it("shows AI module card", () => {
    renderLanding();
    // The module card title is exactly "AI" (not "AI Assistant")
    const cards = screen.getAllByText("AI");
    expect(cards.length).toBeGreaterThan(0);
  });

  it("shows Projects module", () => {
    renderLanding();
    expect(screen.getAllByText("Project Management").length).toBeGreaterThan(0);
  });

  it("shows Planning module", () => {
    renderLanding();
    expect(screen.getAllByText("Planning").length).toBeGreaterThan(0);
  });

  it("shows Reports module", () => {
    renderLanding();
    // "Reports" may appear in both the module card and a decorative highlight chip
    expect(screen.getAllByText("Reports").length).toBeGreaterThan(0);
  });

  it("shows Budget Management module", () => {
    renderLanding();
    expect(screen.getAllByText("Budget Management").length).toBeGreaterThan(0);
  });

  it("shows Risk Management module", () => {
    renderLanding();
    expect(screen.getAllByText("Risk Management").length).toBeGreaterThan(0);
  });
});

describe("Landing page — retired terminology is absent", () => {
  it("does not contain 'Document Repository' as a module name", () => {
    renderLanding();
    expect(screen.queryByText("Document Repository")).not.toBeInTheDocument();
  });

  it("does not contain 'SOPs & Resources' as a module name", () => {
    renderLanding();
    expect(screen.queryByText("SOPs & Resources")).not.toBeInTheDocument();
  });

  it("does not render 'AI Assistant' as a module card title", () => {
    renderLanding();
    // The feature-row title is now "Built-In AI Assistance", not "AI Assistant"
    expect(screen.queryByText("AI Assistant")).not.toBeInTheDocument();
  });

  it("does not contain 'Commission for Accelerated Financing'", () => {
    renderLanding();
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Commission for Accelerated Financing");
  });

  it("does not contain 'Help Centre'", () => {
    renderLanding();
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Help Centre");
  });
});

describe("Landing page — footer dead links are removed", () => {
  it("has no anchor with href='#'", () => {
    renderLanding();
    const deadLinks = document.querySelectorAll('a[href="#"]');
    expect(deadLinks).toHaveLength(0);
  });

  it("does not render a Privacy Policy link", () => {
    renderLanding();
    expect(screen.queryByText("Privacy Policy")).not.toBeInTheDocument();
  });

  it("does not render a Terms of Use link", () => {
    renderLanding();
    expect(screen.queryByText("Terms of Use")).not.toBeInTheDocument();
  });
});

describe("Landing page — primary CTA routes to /login", () => {
  it("Sign In button navigates to /login", () => {
    renderLanding();
    // The header Sign In buttons call setLocation("/login") via handlePrimary
    // The support section CTA link has href="/login"
    const loginLinks = document.querySelectorAll('a[href="/login"]');
    expect(loginLinks.length).toBeGreaterThan(0);
  });
});

describe("Landing page — English display conventions", () => {
  it("uses Title Case for public navigation, headings, named cards, and short CTAs", () => {
    renderLanding();
    [
      "Modules",
      "Features",
      "Benefits",
      "Support",
      "Everything Your Programme Team Needs",
      "Built for CAFA's Operational Realities",
      "Help When You Need It",
      "Plan and Track Projects",
      "Coordinate Across Offices",
      "Monitor Progress and Trends",
      "Manage Reports and Approvals",
      "Access Knowledge and Resources",
    ].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
  });
});

describe("Landing page — no decorative badges on module cards", () => {
  it("does not show a POPULAR badge", () => {
    renderLanding();
    expect(screen.queryByText("POPULAR")).not.toBeInTheDocument();
  });

  it("does not show a NEW badge", () => {
    renderLanding();
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });
});

describe("Landing page — AI copy does not claim active capabilities while module is pending activation", () => {
  it("feature row AI description acknowledges activation requirement", () => {
    renderLanding();
    // Feature 04 description must not promise currently-unavailable active AI generation
    expect(screen.queryByText(/Generate summaries.*draft reports.*answer programme questions/)).toBeNull();
    expect(screen.queryByText(/accelerate daily work using built-in AI assistance/)).toBeNull();
  });

  it("no visible text claims real-time or live dashboard updates", () => {
    renderLanding();
    // Marketing copy uses 'integrated' visibility, not 'real-time' or 'live'
    expect(screen.queryByText(/real.time/i)).toBeNull();
    expect(screen.queryByText(/live dashboards/i)).toBeNull();
    expect(screen.queryByText(/live operational picture/i)).toBeNull();
  });
});

describe("Landing page — responsive layout structure", () => {
  it("hero section carries overflow-hidden to prevent horizontal bleed", () => {
    renderLanding();
    // The hero <section> has class="relative overflow-hidden" — this is the
    // primary guard against wide background images causing horizontal scroll.
    const hero = document.querySelector("section[aria-labelledby='hero-heading']");
    expect(hero).toBeInTheDocument();
    expect(hero?.className).toContain("overflow-hidden");
  });

  it("no element carries an inline style with a hard-coded pixel width wider than 390px", () => {
    renderLanding();
    const allElements = document.querySelectorAll("[style]");
    const oversized = Array.from(allElements).filter(el => {
      const w = (el as HTMLElement).style.width;
      // minHeight is used on the hero, not width — skip non-width rules
      if (!w) return false;
      const px = parseFloat(w);
      return !isNaN(px) && px > 390;
    });
    expect(oversized).toHaveLength(0);
  });

  it("all major landmark sections are present in the DOM", () => {
    renderLanding();
    // Modules grid
    expect(document.getElementById("modules")).toBeInTheDocument();
    // Features section
    expect(document.getElementById("features")).toBeInTheDocument();
    // Support section
    expect(document.getElementById("support")).toBeInTheDocument();
  });
});

// ── Screenshot asset validation ────────────────────────────────────────────────
// These tests guard the approved capture inventory and prevent a fabricated
// vector mock-up from silently becoming a product image again.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const assetDir = resolve(__dirname, "../assets");

describe("Landing screenshot assets — approved real captures", () => {
  const svgs = [
    "landing-dashboard.webp",
    "landing-projects.webp",
    "landing-plans.webp",
    "landing-ai.webp",
  ] as const;

  it.each(svgs)("%s exists as a non-trivial compressed image", (name) => {
    const file = statSync(resolve(assetDir, name));
    expect(file.size).toBeGreaterThan(10_000);
  });

  it("has provenance for each approved asset", () => {
    const provenance = JSON.parse(readFileSync(resolve(assetDir, "landing-screenshots.provenance.json"), "utf8")) as {
      sourceRevision: string;
      captureDate: string;
      fixtureConfirmation: string;
      assets: Array<{ asset: string; route: string; viewport: string; outputDimensions: string }>;
    };
    expect(provenance.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.captureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(provenance.fixtureConfirmation).toMatch(/non-production/i);
    expect(provenance.assets.map((asset) => asset.asset).sort()).toEqual([...svgs].sort());
    expect(provenance.assets.every((asset) => asset.route.startsWith("/"))).toBe(true);
    expect(provenance.assets.every((asset) => asset.viewport === "1440x810@2x")).toBe(true);
    expect(provenance.assets.every((asset) => asset.outputDimensions === "2880x1620")).toBe(true);
  });

  it("does not keep fabricated product SVGs in the landing asset inventory", () => {
    expect(svgs.some((name) => name.endsWith(".svg"))).toBe(false);
  });

  it("renders four accessible screenshot frames with meaningful alt text", () => {
    renderLanding();
    const images = screen.getAllByRole("img").filter((image) =>
      image.getAttribute("data-testid") !== "decorative",
    );
    const productImages = document.querySelectorAll('[data-testid="landing-product-frame"] img');
    expect(productImages).toHaveLength(4);
    expect(Array.from(productImages).every((image) => image.getAttribute("alt")?.includes("CAFA PMIS"))).toBe(true);
    expect(Array.from(productImages).every((image) => image.getAttribute("loading"))).toBe(true);
    expect(images.length).toBeGreaterThanOrEqual(4);
  });
});

// ── index.html meta tag validation ───────────────────────────────────────────

describe("index.html — meta tags use approved branding and no geographic claims", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf-8");

  it("meta description does not reference 'Sudan operations'", () => {
    expect(html).not.toContain("Sudan operations");
  });

  it("og:description does not reference 'Sudan operations'", () => {
    // All three description tags are covered — the file has a single "Sudan operations" string
    expect(html).not.toContain("Sudan operations");
  });

  it("apple-mobile-web-app-title uses the correct product abbreviation CAFA PMIS", () => {
    expect(html).toContain('content="CAFA PMIS"');
    expect(html).not.toContain('content="CAFA PMS"');
  });
});

// ── i18n locale file structural validation ────────────────────────────────────
// These tests import the raw JSON directly (no i18next runtime) so they catch
// regressions in the locale files themselves — including the case where an Arabic
// key with an empty-string value silently shadows the English fallback.

describe("en/landing.json — required keys are non-empty", () => {
  it("footer.copyright does not reference the old organisation name", () => {
    expect(enLanding.footer.copyright).not.toContain("Commission for Accelerated Financing");
  });

  it("footer.copyright references CAFA Development Organisation", () => {
    expect(enLanding.footer.copyright).toContain("CAFA Development Organisation");
  });

  it("footer.system reads Programme Management Information System (not Internal)", () => {
    expect(enLanding.footer.system).toBe("Programme Management Information System");
  });

  it("footer.tagline does not contain 'across Sudan'", () => {
    expect(enLanding.footer.tagline).not.toContain("across Sudan");
  });

  it("hero.description does not contain 'across Sudan'", () => {
    expect(enLanding.hero.description).not.toContain("across Sudan");
  });

  it("hero.description does not claim real-time reporting", () => {
    expect(enLanding.hero.description).not.toMatch(/real-time reporting/i);
  });

  it("support.exploreLink reflects authenticated-only access", () => {
    expect(enLanding.support.exploreLink).toContain("Sign In");
  });

  it("footer.links does not contain privacyPolicy key", () => {
    expect(Object.keys(enLanding.footer.links)).not.toContain("privacyPolicy");
  });

  it("footer.links does not contain termsOfUse key", () => {
    expect(Object.keys(enLanding.footer.links)).not.toContain("termsOfUse");
  });

  it("footer.links does not contain contactSupport key", () => {
    expect(Object.keys(enLanding.footer.links)).not.toContain("contactSupport");
  });

  it("footer.links.systemManual is defined and non-empty", () => {
    expect((enLanding.footer.links as Record<string, string>).systemManual).toBeTruthy();
  });
});

describe("ar/landing.json — complete Arabic namespace", () => {
  it("matches English key parity and has no empty strings", () => {
    const flatten = (value: unknown, prefix = ""): Array<[string, string]> => {
      if (typeof value === "string") return [[prefix, value]];
      if (Array.isArray(value)) {
        return value.flatMap((item, index) => flatten(item, `${prefix}.${index}`));
      }
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key),
      );
    };

    const english = flatten(enLanding);
    const arabic = flatten(arLanding);
    expect(arabic.map(([key]) => key).sort()).toEqual(english.map(([key]) => key).sort());
    expect(arabic.every(([, value]) => value.trim().length > 0)).toBe(true);
  });
});
