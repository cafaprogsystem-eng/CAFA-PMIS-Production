/**
 * Arabic has six plural forms. A key that only defines _one/_other must not
 * fall back to the English sentence for counts like 2, 5 or 12 — the
 * "sync issues need attention" banner showed English in the Arabic UI.
 */
import { describe, it, expect, beforeAll } from "vitest";
import i18n, { completeArabicPlurals } from "@/i18n";

describe("Arabic plurals never fall back to English", () => {
  beforeAll(async () => { await i18n.changeLanguage("ar"); });

  it("uses the full Arabic forms of the sync banner for every count", () => {
    const t = (count: number) => i18n.t("sync.syncIssues", { count, ns: "common" });
    expect(t(1)).toBe("مشكلة مزامنة واحدة تحتاج إلى انتباه — اضغط للمراجعة");
    expect(t(2)).toBe("مشكلتا مزامنة تحتاجان إلى انتباه — اضغط للمراجعة");
    expect(t(5)).toBe("5 مشكلات مزامنة تحتاج إلى انتباه — اضغط للمراجعة");
    expect(t(12)).toBe("12 مشكلة مزامنة تحتاج إلى انتباه — اضغط للمراجعة");
    expect(i18n.t("sync.changesPendingSync", { count: 2, ns: "common" })).toBe("تغييران في انتظار المزامنة — اضغط للمراجعة");
  });

  it("fills missing Arabic plural forms from _other instead of English", () => {
    const done = completeArabicPlurals({ a: { item_one: "عنصر واحد", item_other: "{{count}} عنصر", arr: ["x"] } });
    expect(done.a).toMatchObject({ item_zero: "{{count}} عنصر", item_two: "{{count}} عنصر", item_few: "{{count}} عنصر", item_many: "{{count}} عنصر" });
    expect(done.a.arr).toEqual(["x"]);
  });

  it("keeps every plural key Arabic for counts 0–120", () => {
    const store = i18n.getResourceBundle("ar", "common") as Record<string, unknown>;
    const bases: string[] = [];
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === "object" && !Array.isArray(value)) walk(value as Record<string, unknown>, `${prefix}${key}.`);
        else if (key.endsWith("_other")) bases.push(prefix + key.slice(0, -6));
      }
    };
    walk(store, "");
    expect(bases.length).toBeGreaterThan(0);
    const english = i18n.getFixedT("en", "common");
    for (const base of bases) {
      for (const count of [0, 1, 2, 3, 11, 120]) {
        const ar = i18n.t(base, { count, ns: "common" });
        expect(ar, `${base} (${count})`).not.toBe(english(base, { count }));
      }
    }
  });
});
