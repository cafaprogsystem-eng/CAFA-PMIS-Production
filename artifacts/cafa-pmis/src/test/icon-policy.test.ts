/**
 * Icon policy: every icon comes from src/components/icons.tsx, which draws on
 * HeroUI Pro's Gravity UI set. lucide is allowed there for exactly three
 * icons Gravity has no equivalent for. ESLint enforces the same rule; this
 * test keeps it from being loosened quietly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");
const registry = readFileSync(join(SRC, "components/icons.tsx"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Icon policy — Gravity UI through one registry", () => {
  it("allows lucide only for Building2, Handshake and Wheat", () => {
    const lucideImport = registry.match(/import\s*\{([^}]*)\}\s*from "lucide-react"/);
    expect(lucideImport).not.toBeNull();
    const names = lucideImport![1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    expect(names.sort()).toEqual(["Building2", "Handshake", "Wheat"]);
    expect(registry.match(/from "lucide-react"/g)).toHaveLength(1);
  });

  it("draws the lucide exceptions at Gravity's line weight", () => {
    for (const name of ["Building2", "Handshake", "Wheat"]) {
      expect(registry).toContain(`<Lucide${name} strokeWidth={2.25} {...props} />`);
    }
  });

  it("imports Gravity icons one file at a time, never the package root", () => {
    expect(registry).not.toMatch(/from "@gravity-ui\/icons"/);
    expect((registry.match(/from "@gravity-ui\/icons\/[A-Za-z0-9]+"/g) ?? []).length).toBeGreaterThan(150);
  });

  it("keeps every other file on the registry", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => rel !== "components/icons.tsx" && !rel.startsWith("dev/pro-reference/"))
      .filter((rel) => /from ["'](lucide-react|@gravity-ui\/icons[^"']*|@tabler\/icons-react[^"']*)["']/.test(
        readFileSync(join(SRC, rel), "utf8"),
      ));
    expect(offenders).toEqual([]);
  });
});
