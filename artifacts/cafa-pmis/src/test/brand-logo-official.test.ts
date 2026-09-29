/**
 * The official CAFA logo (vector, traced from attached_assets/CAFA Logo.pdf)
 * replaces the old raster logo everywhere, in the brand colours only.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OFFICIAL = new Set(["#2B2F90", "#455E86", "#00B0EB", "#FFFFFF"]);
const brand = (f: string) => readFileSync(`src/assets/brand/${f}`, "utf8");

describe("BRAND-LOGO-OFFICIAL", () => {
  it("brand SVGs use only the official colours (no gold)", () => {
    for (const f of readdirSync("src/assets/brand").filter((n) => n.endsWith(".svg"))) {
      const colours = [...brand(f).matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
      expect(colours.length, f).toBeGreaterThan(0);
      for (const c of colours) expect(OFFICIAL.has(c), `${f}: ${c}`).toBe(true);
    }
    expect(brand("cafa-logo.svg")).toContain('fill="#2B2F90"');
    expect(brand("cafa-mark.svg")).toContain('fill="#00B0EB"');
  });

  it("the old raster logo files are gone and nothing imports them", () => {
    expect(existsSync("src/assets/cafa-logo.png")).toBe(false);
    expect(existsSync("src/assets/cafa-icon.png")).toBe(false);
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? (n === "test" ? [] : walk(p)) : /\.tsx?$/.test(n) ? [p] : [];
    });
    const offenders = walk("src").filter((p) => /assets\/cafa-(logo|icon)\.png|brightness\(0\) invert\(1\)/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("favicons, PWA icons and theme colour follow the brand", () => {
    const html = readFileSync("index.html", "utf8");
    const vite = readFileSync("vite.config.ts", "utf8");
    expect(html).toContain('<meta name="theme-color" content="#2B2F90" />');
    expect(vite).toContain('theme_color: "#2B2F90"');
    expect(vite).toContain("icons/icon-maskable-512.png");
    expect(readFileSync("public/favicon.svg", "utf8")).toBe(brand("cafa-mark.svg"));
    for (const f of ["favicon.ico", "favicon-16.png", "favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "brand/cafa-logo.png"]) {
      expect(existsSync(`public/${f}`), f).toBe(true);
    }
  });
});
