/**
 * LANDING-DEAD-PROP-REMOVED — LandingPage accepted an isAuthenticated prop
 * that branched its CTA label/target between "/dashboard" and "/login", but
 * its one call site in App.tsx never passed it (both renders are
 * <LandingPage /> with no props, reached only from AuthGate's unauthenticated
 * branch) — the isAuthenticated=true code path was 100% dead. Removed the
 * prop and always route the primary CTA to /login.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const landingSrc = readFileSync(resolve(__dirname, "../pages/landing.tsx"), "utf8");
const appSrc = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");

describe("LANDING-DEAD-PROP-REMOVED", () => {
  it("LandingPage no longer accepts or branches on isAuthenticated", () => {
    expect(landingSrc).not.toContain("isAuthenticated");
    expect(landingSrc).not.toContain("LandingPageProps");
    expect(landingSrc).toContain("export default function LandingPage() {");
  });

  it("the primary CTA always routes to /login", () => {
    expect(landingSrc).toContain('const handlePrimary = () => setLocation("/login");');
    expect(landingSrc).toContain('const ctaLabel = t("hero.ctaPrimary");');
  });

  it("App.tsx's call sites pass no props (confirms the removal matches actual usage)", () => {
    const calls = [...appSrc.matchAll(/<LandingPage\s*\/>/g)];
    expect(calls.length).toBeGreaterThan(0);
    expect(appSrc).not.toContain("<LandingPage isAuthenticated");
  });
});
