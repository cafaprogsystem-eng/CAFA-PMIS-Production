/**
 * Communication Centre fixes made while moving the screen to HeroUI:
 * translated stored placeholders and errors, no native confirm, Gravity file
 * icons, and a localised breadcrumb.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const page = readFileSync(resolve(root, "pages/messages.tsx"), "utf8");
const layout = readFileSync(resolve(root, "components/layout.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(root, "locales/en/messages.json"), "utf8")) as Record<string, unknown>;
const ar = JSON.parse(readFileSync(resolve(root, "locales/ar/messages.json"), "utf8")) as Record<string, unknown>;

describe("MESSAGES-HEROUI-FIXES", () => {
  it("shows voice and attachment-only messages translated instead of their stored English body", () => {
    expect(page).toContain('if (body === "(Voice message)") return t("voiceMessage");');
    expect(page).toContain('displayBody(conv.lastMessageBody, t)');
    expect(page).toContain("displayBody(msg.replyBody, t)");
    expect(ar.voiceMessage).toBe("رسالة صوتية");
  });

  it("names sector conversations through the locale, not an English \"Team\" suffix", () => {
    expect(page).toContain('t("sectorTeam", { sector: conv.sector })');
    expect(page).not.toContain("`${conv.sector} Team`");
    expect(ar.sectorTeam).toBe("فريق {{sector}}");
  });

  it("confirms delete-for-everyone in a ConfirmModal rather than the browser's confirm()", () => {
    expect(page).not.toMatch(/\bconfirm\(t\(/);
    expect(page).toContain("setDeleteEveryoneId(id)");
    expect(page).toContain("<ConfirmModal");
  });

  it("maps server error codes to translated sentences instead of toasting the raw code", () => {
    expect(page).not.toContain("toast.error(e.message)");
    expect(page).toContain('t(`apiErrors.${code}`, { defaultValue: t("apiErrors.default") })');
    const enErrors = en.apiErrors as Record<string, string>;
    const arErrors = ar.apiErrors as Record<string, string>;
    expect(Object.keys(arErrors).sort()).toEqual(Object.keys(enErrors).sort());
    expect(enErrors.forbidden).toEqual(expect.any(String));
  });

  it("uses Gravity file icons and sized, isolated file sizes instead of emoji", () => {
    expect(page).not.toMatch(/["'`](?:📄|📝|📊|📋|🗜️|📃|📎|📷|🎙|🚫|⟳)/u);
    expect(page).toContain("function FileTypeIcon");
    expect(page).toContain("<bdi dir=\"ltr\">{formatFileSize(att.size)}</bdi>");
    expect(page).toContain("return `${(bytes / 1024).toFixed(0)} KB`;");
  });

  it("releases the voice preview's object URL instead of creating one per render", () => {
    expect(page).not.toContain("URL.createObjectURL(voiceBlob)} duration");
    expect(page).toContain("URL.revokeObjectURL(voicePreviewUrl)");
  });

  it("labels the Communication Centre breadcrumb and an open conversation in the active language", () => {
    expect(layout).toContain('"/messages": tNav("items.communicationCentre")');
    expect(layout).toContain('parent === "/messages" ? tCommon("recordDetails.conversationTitle")');
  });

  it("keeps @mentions readable on the sender's own accent bubble", () => {
    expect(page).toContain("renderMentions(msg.body, isOwn)");
    expect(page).toContain('isOwn ? "bg-white/20 text-[var(--accent-foreground)]"');
  });

  it("keeps required markers out of label text", () => {
    for (const key of ["subjectLabel", "selectUserLabel"]) {
      expect(en[key]).not.toMatch(/\*$/);
      expect(ar[key]).not.toMatch(/\*$/);
    }
  });
});
