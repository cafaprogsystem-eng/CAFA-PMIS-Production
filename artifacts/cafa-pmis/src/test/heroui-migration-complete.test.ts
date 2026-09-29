/**
 * The HeroUI migration is complete: live screens and shared components no
 * longer import the old shadcn/Radix visual components. What remains in
 * components/ui is either built on HeroUI (error-state), non-visual wiring
 * (form = react-hook-form context, sonner = the one toaster), or a type.
 * Two files are unused leftovers kept until their removal is approved.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const src = resolve(__dirname, "..");
const ALLOWED_UI = new Set(["error-state", "form", "sonner"]);
const UNUSED_LEFTOVERS = new Set(["components/conflict-dialog.tsx", "pages/password-resets.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ["test", "ui", "dev"].includes(name) ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("HEROUI-MIGRATION-COMPLETE", () => {
  it("no live file imports a visual shadcn/Radix component", () => {
    const offenders: string[] = [];
    for (const path of files(src)) {
      const rel = relative(src, path);
      if (UNUSED_LEFTOVERS.has(rel)) continue;
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/from "@\/components\/ui\/([a-z-]+)"/g)) {
        const isTypeOnly = new RegExp(`import type [^;]+ from "@/components/ui/${m[1]}"`).test(text);
        if (!ALLOWED_UI.has(m[1]) && !isTypeOnly) offenders.push(`${rel} → ui/${m[1]}`);
      }
      if (/from "@\/hooks\/use-toast"/.test(text) && !/sonner/.test(readFileSync(join(src, "hooks/use-toast.ts"), "utf8"))) {
        offenders.push(`${rel} → Radix toast`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the unused leftovers are still unused (safe to delete once approved)", () => {
    const all = files(src).map((p) => readFileSync(p, "utf8")).join("\n");
    expect(all).not.toMatch(/from "@\/components\/conflict-dialog"/);
    expect(all).not.toMatch(/from "@\/pages\/password-resets"|import\("@\/pages\/password-resets"\)|pages\/password-resets"/);
  });
});
