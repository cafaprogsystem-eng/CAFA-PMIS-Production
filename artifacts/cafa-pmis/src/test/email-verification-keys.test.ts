/**
 * The email-verification pages showed the raw key "programmeManagementSystem"
 * (common:programmeManagementSystem never existed). Every key they use must
 * exist in both languages.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const load = (lang: string, ns: string) => JSON.parse(readFileSync(`src/locales/${lang}/${ns}.json`, "utf8"));
const lookup = (obj: unknown, path: string) =>
  path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

describe("EMAIL-VERIFICATION-KEYS", () => {
  for (const page of ["email-verification-sent", "verify-email"]) {
    it(`${page}: every translation key exists in English and Arabic`, () => {
      const src = readFileSync(`src/pages/${page}.tsx`, "utf8");
      const keys = [...src.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const lang of ["en", "ar"]) {
        for (const key of keys) {
          const [ns, path] = key.includes(":") ? key.split(":") : ["auth", key];
          const value = lookup(load(lang, ns), path);
          const plural = lookup(load(lang, ns), `${path}_other`);
          expect(typeof value === "string" || typeof plural === "string", `${lang} ${ns}:${path}`).toBe(true);
        }
      }
    });
  }

  it("both pages show the same system label under the name", () => {
    for (const page of ["email-verification-sent", "verify-email"]) {
      expect(readFileSync(`src/pages/${page}.tsx`, "utf8")).toContain('{t("internalSystemLabel")}');
    }
  });
});
