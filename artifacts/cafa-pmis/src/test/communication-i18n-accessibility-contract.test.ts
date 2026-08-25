import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("Communication i18n and accessibility contract", () => {
  it("keeps Arabic Messages translations structurally complete and non-empty", async () => {
    const root = process.cwd();
    const [englishSource, arabicSource] = await Promise.all([
      readFile(resolve(root, "src/locales/en/messages.json"), "utf8"),
      readFile(resolve(root, "src/locales/ar/messages.json"), "utf8"),
    ]);
    const english = JSON.parse(englishSource) as Record<string, unknown>;
    const arabic = JSON.parse(arabicSource) as Record<string, unknown>;

    expect(leafKeys(arabic).sort()).toEqual(leafKeys(english).sort());
    expect(Object.values(arabic).join("")).not.toEqual("");
  });

  it("uses translated, logical and keyboard-accessible Communication controls", async () => {
    const source = await readFile(resolve(process.cwd(), "src/pages/messages.tsx"), "utf8");

    expect(source).toContain('aria-label={t("attachFile")}');
    expect(source).toContain('aria-label={t("recordVoice")}');
    expect(source).toContain('aria-label={t("insertEmoji")}');
    expect(source).toContain('aria-label={t("removeAttachment", { name: f.name })}');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('aria-activedescendant=');
    expect(source).toContain("group-focus-within:opacity-100");
    expect(source).toContain('aria-label={t("openImage", { name: att.name })}');
    expect(source).not.toMatch(/toLocale(?:Date|Time)\w*\("en/);
    expect(source).not.toMatch(/\b(?:text-left|text-right|border-l|border-r)\b/);
  });

  it("applies presence updates only from the authorised open-conversation event", async () => {
    const source = await readFile(resolve(process.cwd(), "src/pages/messages.tsx"), "utf8");

    expect(source).toContain('socket.on("conversation:presence", onConversationPresence)');
    expect(source).toContain('socket.off("conversation:presence", onConversationPresence)');
    expect(source).not.toContain('socket.on("presence:update", onPresenceUpdate)');
  });
});