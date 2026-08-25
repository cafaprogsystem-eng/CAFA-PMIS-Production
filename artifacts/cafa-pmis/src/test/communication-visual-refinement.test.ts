import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function messagesSource() {
  return readFile(resolve(process.cwd(), "src/pages/messages.tsx"), "utf8");
}

async function dropdownSource() {
  return readFile(resolve(process.cwd(), "src/components/messages-dropdown.tsx"), "utf8");
}

async function layoutSource() {
  return readFile(resolve(process.cwd(), "src/components/layout.tsx"), "utf8");
}

describe("Communication Centre visual refinement — Phase 1", () => {
  it("COMM-VIS-01 keeps a compact, cohesive, viewport-aware workspace shell", async () => {
    const source = await messagesSource();

    expect(source).toContain('h-[calc(100dvh-4rem)] min-h-[32rem] flex overflow-hidden bg-card');
    expect(source).toContain("border-y border-border/70 md:border md:rounded-xl");
  });

  it("COMM-VIS-02 preserves the responsive sidebar and focused mobile conversation flow", async () => {
    const source = await messagesSource();

    expect(source).toContain('md:w-[clamp(18rem,24vw,22rem)] shrink-0');
    expect(source).toContain('selectedId ? "hidden md:flex" : "flex"');
    expect(source).toContain('className="hidden md:flex flex-1 items-center justify-center bg-muted/20"');
    expect(source).toContain('className="md:hidden shrink-0 -ms-1 h-9 w-9"');
  });

  it("COMM-VIS-03 uses compact, scannable conversation rows", async () => {
    const source = await messagesSource();

    expect(source).toContain('px-3.5 py-2.5 text-start transition-colors');
    expect(source).toContain('shrink-0 h-9 w-9 rounded-full');
    expect(source).toContain('text-[11px] text-muted-foreground shrink-0 ms-1 tabular-nums');
  });

  it("COMM-VIS-04 keeps long conversation names visually truncated with full-value access", async () => {
    const source = await messagesSource();

    expect(source).toContain('title={name} aria-current={selected ? "page" : undefined}');
    expect(source).toContain('text-sm font-medium truncate');
    expect(source).toContain('title={convName(convDetail, t)}');
  });

  it("COMM-VIS-05 never turns null unread state into a rendered zero", async () => {
    const source = await messagesSource();

    expect(source).toContain('const hasUnread = typeof conv.unreadCount === "number" && conv.unreadCount > 0;');
    expect(source).not.toContain("const unreadCount = conv.unreadCount ?? 0;");
    expect(source).toContain('{hasUnread && (');
  });

  it("COMM-VIS-06 keeps selected and keyboard conversation state explicit", async () => {
    const source = await messagesSource();

    expect(source).toContain('aria-current={selected ? "page" : undefined}');
    expect(source).toContain("focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary");
    expect(source).toContain('selected && "bg-primary/5 hover:bg-primary/5 border-primary"');
  });

  it("COMM-VIS-07 uses a compact, truncation-safe active conversation header", async () => {
    const source = await messagesSource();

    expect(source).toContain("min-h-16 bg-card/95 border-b border-border/80 shrink-0");
    expect(source).toContain('className="font-medium text-sm text-foreground truncate"');
    expect(source).toContain('className="shrink-0 capitalize text-[11px] hidden sm:inline-flex"');
  });

  it("COMM-VIS-08 wraps long message content safely within a readable maximum width", async () => {
    const source = await messagesSource();

    expect(source).toContain('w-fit max-w-[min(78%,42rem)] flex flex-col');
    expect(source).toContain('break-words [overflow-wrap:anywhere]');
    expect(source).toContain('className="whitespace-pre-wrap"');
  });

  it("COMM-VIS-09 keeps reply context visually subordinate to the message body", async () => {
    const source = await messagesSource();

    expect(source).toContain('rounded-t-lg border-s-2 border-primary mb-0.5 max-w-full');
    expect(source).toContain('? "bg-primary/10 text-primary hover:bg-primary/15"');
    expect(source).toContain(': "bg-muted/70 text-foreground/70 hover:bg-muted"');
  });

  it("COMM-VIS-10 retains focus-accessible and mobile-reachable message actions", async () => {
    const source = await messagesSource();

    expect(source).toContain("opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100");
    expect(source).toContain('aria-label={t("addReaction")}');
    expect(source).toContain('aria-label={t("messageOptions")}');
  });

  it("COMM-VIS-11 distinguishes initial history skeletons from incremental loading", async () => {
    const source = await messagesSource();

    expect(source).toContain("{msgsLoading ? (");
    expect(source).toContain("Alternating skeleton bubbles to simulate a real conversation");
    expect(source).toContain("{hasOlderMessages && (");
    expect(source).toContain("{isFetchingOlderMessages ? t(\"loadingOlderMessages\") : t(\"loadOlderMessages\")}");
  });

  it("COMM-VIS-12 keeps no-selection and selected-conversation no-message states distinct", async () => {
    const source = await messagesSource();

    expect(source).toContain("{!selectedId ? (");
    expect(source).toContain(") : grouped.length === 0 ? (");
    expect(source).toContain('{t("selectConversation")}');
    expect(source).toContain('{t("noMessages")}');
  });

  it("preserves receipt truthfulness, attachment privacy, RTL hooks, and pagination controls", async () => {
    const source = await messagesSource();

    expect(source).not.toContain("CheckCheck");
    expect(source).not.toMatch(/interface Attachment\s*\{[^}]*\bobjectPath\b/s);
    expect(source).toContain("rtl:rotate-180");
    expect(source).not.toMatch(/\b(?:text-left|text-right|border-l|border-r)\b/);
    expect(source).toContain("hasMoreConversations");
    expect(source).toContain("hasOlderMessages");
  });
});

describe("Communication Centre interaction refinement — Phase 2", () => {
  it("COMM-FORM-VIS-01 keeps the composer compact, token-backed, and send-primary", async () => {
    const source = await messagesSource();

    expect(source).toContain('px-3 sm:px-4 py-2.5 bg-card border-t border-border shrink-0 relative');
    expect(source).toContain('min-h-[40px] max-h-32');
    expect(source).toContain('aria-label={t("sendMessage")}');
    expect(source).toContain('disabled={(!inputText.trim() && pendingFiles.length === 0) || (pendingFiles.length > 0 && !isOnline) || sendMut.isPending || uploadBusy}');
  });

  it("COMM-FORM-VIS-02 keeps pending attachments compact, private, and removable", async () => {
    const source = await messagesSource();

    expect(source).toContain('aria-label={t("pendingAttachments")}');
    expect(source).toContain('title={f.name}');
    expect(source).toContain('formatFileSize(f.size)');
    expect(source).toContain('aria-label={t("removeAttachment", { name: f.name })}');
    expect(source).not.toMatch(/pendingFiles[^]*objectPath/);
  });

  it("COMM-FORM-VIS-03 presents real recording controls and duration accessibly", async () => {
    const source = await messagesSource();

    expect(source).toContain('voiceState === "recording"');
    expect(source).toContain('formatDuration(recordingSeconds)');
    expect(source).toContain('aria-label={t("stopRecording")}');
    expect(source).toContain('aria-label={t("cancelRecording")}');
    expect(source).toContain("recordingSecondsRef.current >= 600");
  });

  it("COMM-FORM-VIS-04 keeps the recorded-voice preview compact and actionable", async () => {
    const source = await messagesSource();

    expect(source).toContain('voiceState === "preview" && voiceBlob');
    expect(source).toContain('aria-label={t("sendVoiceMessage")}');
    expect(source).toContain('aria-label={t("discardVoiceMessage")}');
    expect(source).toContain('min-w-0 bg-accent/20 border border-border rounded-xl');
  });

  it("COMM-FORM-VIS-05 bounds and labels the keyboard mention picker", async () => {
    const source = await messagesSource();

    expect(source).toContain('role="listbox" aria-label={t("mentionSuggestions")}');
    expect(source).toContain('max-h-56 overflow-y-auto');
    expect(source).toContain('aria-activedescendant=');
    expect(source).toContain('role="option" aria-selected={index === mentionActiveIndex}');
  });

  it("COMM-FORM-VIS-06 retains only the canonical reaction set in an operable picker", async () => {
    const source = await messagesSource();

    expect(source).toContain('const EMOJI_REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "🙏"];');
    expect(source).toContain('aria-label={t("reactWith", { emoji: e })}');
    expect(source).toContain('aria-label={t("toggleReaction", { emoji, count: info.count })}');
  });

  it("COMM-FORM-VIS-07 gives the creation flow a responsive, scrolling body and fixed action footer", async () => {
    const source = await messagesSource();

    expect(source).toContain('w-[calc(100%-1.5rem)] sm:max-w-md max-h-[min(90vh,42rem)] flex flex-col gap-0 p-0 overflow-hidden');
    expect(source).toContain('px-5 py-2 overflow-y-auto flex-1 min-h-0');
    expect(source).toContain('DialogFooter className="px-5 py-4 border-t border-border/70 shrink-0"');
  });

  it("COMM-FORM-VIS-08 keeps creation controls type-specific and avoids raw role identifiers", async () => {
    const source = await messagesSource();

    expect(source).toContain('const availableTypes: string[] = ["direct", "group", "project", "state", "sector"];');
    expect(source).toContain('if (canAnnounce) availableTypes.push("announcement");');
    expect(source).toContain('t(`role_${announcementRole}`)');
    expect(source).not.toContain('`${t("roleLabel")}: ${announcementRole}`');
  });

  it("COMM-FORM-VIS-09 uses searchable member results and full-name removable chips", async () => {
    const source = await messagesSource();

    expect(source).toContain('aria-label={t("selectedMembers")}');
    expect(source).toContain('title={u.name}');
    expect(source).toContain('aria-label={t("removeMember", { name: u.name })}');
    expect(source).toContain('role="listbox" aria-label={t("memberResults")}');
    expect(source).toContain('role="option"');
  });

  it("COMM-FORM-VIS-10 makes the pinned surface a compact, keyboard-operable overlay", async () => {
    const source = await messagesSource();

    expect(source).toContain('aria-controls="pinned-messages-panel"');
    expect(source).toContain('id="pinned-messages-panel"');
    expect(source).toContain('w-full max-w-sm bg-card border-s border-border flex flex-col shadow-xl');
    expect(source).toContain('break-words [overflow-wrap:anywhere]');
  });

  it("COMM-FORM-VIS-11 makes the media panel responsive with loading, empty, and error treatments", async () => {
    const source = await messagesSource();

    expect(source).toContain('absolute inset-y-0 end-0 z-30 w-full max-w-sm bg-card border-s border-border shadow-xl flex flex-col');
    expect(source).toContain('role="tablist" aria-label={t("mediaGallery")}');
    expect(source).toContain('role="status">{t("loading")}</div>');
    expect(source).toContain('t("errLoadMedia")');
    expect(source).toContain('void refetch()');
  });

  it("COMM-FORM-VIS-12 preserves translated logical, mixed-direction-safe interaction hooks", async () => {
    const source = await messagesSource();

    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain('end-0');
    expect(source).toContain('border-s');
    expect(source).not.toMatch(/\b(?:text-left|text-right|border-l|border-r)\b/);
  });
});

describe("Communication Centre final visual closure", () => {
  it("COMM-FINAL-VIS-01 retains one cohesive, token-backed Communication workspace", async () => {
    const source = await messagesSource();

    expect(source).toContain('h-[calc(100dvh-4rem)] min-h-[32rem] flex overflow-hidden bg-card');
    expect(source).toContain("border-y border-border/70 md:border md:rounded-xl");
    expect(source).toContain('className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-3.5 space-y-0.5 bg-muted/20"');
  });

  it("COMM-FINAL-VIS-02 preserves compact, scannable density across lists and header entry", async () => {
    const [source, dropdown] = await Promise.all([messagesSource(), dropdownSource()]);

    expect(source).toContain('px-3.5 py-2.5 text-start transition-colors');
    expect(dropdown).toContain("px-3 py-2.5");
    expect(dropdown).toContain('className="text-xs text-muted-foreground shrink-0 tabular-nums"');
  });

  it("COMM-FINAL-VIS-03 protects long labels and narrow viewports from overflow", async () => {
    const [source, dropdown] = await Promise.all([messagesSource(), dropdownSource()]);

    expect(source).toContain('w-fit max-w-[min(78%,42rem)] flex flex-col');
    expect(source).toContain("break-words [overflow-wrap:anywhere]");
    expect(dropdown).toContain('w-[min(24rem,calc(100vw-1rem))] max-h-[min(32rem,calc(100dvh-1rem))]');
    expect(dropdown).toContain("title={label}");
    expect(dropdown).toContain("font-medium truncate");
  });

  it("COMM-FINAL-VIS-04 keeps loading, empty, and error states truthful in both entry surfaces", async () => {
    const [source, dropdown] = await Promise.all([messagesSource(), dropdownSource()]);

    expect(source).toContain("{msgsLoading ? (");
    expect(source).toContain(") : msgsError ? (");
    expect(source).toContain(") : grouped.length === 0 ? (");
    expect(dropdown).toContain('if (!r.ok) throw new Error(`HTTP ${r.status}`);');
    expect(dropdown).toContain('role="status"');
    expect(dropdown).toContain(") : isError ? (");
    expect(dropdown).toContain('onClick={() => void refetch()}');
    expect(dropdown).toContain('t("messages:headerNoConversations")');
  });

  it("COMM-FINAL-VIS-05 retains responsive list/detail and overlay geometry", async () => {
    const source = await messagesSource();

    expect(source).toContain('selectedId ? "hidden md:flex" : "flex"');
    expect(source).toContain('className="md:hidden shrink-0 -ms-1 h-9 w-9"');
    expect(source).toContain('absolute inset-y-0 end-0 z-30 w-full max-w-sm bg-card');
    expect(source).toContain('w-[calc(100%-1.5rem)] sm:max-w-md max-h-[min(90vh,42rem)]');
  });

  it("COMM-FINAL-VIS-06 keeps Arabic dictionaries complete and direction-sensitive chrome logical", async () => {
    const root = process.cwd();
    const [english, arabic, source, dropdown] = await Promise.all([
      readFile(resolve(root, "src/locales/en/messages.json"), "utf8"),
      readFile(resolve(root, "src/locales/ar/messages.json"), "utf8"),
      messagesSource(),
      dropdownSource(),
    ]);

    expect(Object.keys(JSON.parse(arabic)).sort()).toEqual(Object.keys(JSON.parse(english)).sort());
    expect(source).toContain("rtl:rotate-180");
    expect(source).not.toMatch(/\b(?:text-left|text-right|border-l|border-r)\b/);
    expect(dropdown).not.toMatch(/\b(?:text-left|text-right|border-l|border-r)\b/);
  });

  it("COMM-FINAL-VIS-07 keeps hover-discovered controls keyboard-visible and translated", async () => {
    const [source, dropdown] = await Promise.all([messagesSource(), dropdownSource()]);

    expect(source).toContain("opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100");
    expect(source).toContain('aria-label={t("addReaction")}');
    expect(source).toContain('aria-label={t("messageOptions")}');
    expect(dropdown).toContain("focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary");
    expect(dropdown).toContain('t("messages:viewAllConversations")');
  });

  it("COMM-FINAL-VIS-08 never presents unsupported message receipt claims", async () => {
    const [source, dropdown] = await Promise.all([messagesSource(), dropdownSource()]);

    expect(source).not.toContain("CheckCheck");
    expect(source).not.toMatch(/\b(?:seen|delivered)\b/i);
    expect(dropdown).not.toMatch(/\b(?:seen|delivered)\b/i);
  });

  it("COMM-FINAL-VIS-09 keeps public attachment presentation free of storage internals", async () => {
    const source = await messagesSource();

    expect(source).not.toMatch(/interface Attachment\s*\{[^}]*\bobjectPath\b/s);
    expect(source).toContain("interface Attachment { type: string; url: string; name: string;");
    expect(source).toContain('href={att.url}');
  });

  it("COMM-FINAL-VIS-10 translates supported presentation enums instead of exposing raw values", async () => {
    const [source, dropdown] = await Promise.all([messagesSource(), dropdownSource()]);

    expect(source).toContain('t(`type_${convDetail.type}`)');
    expect(dropdown).toContain('case "announcement": return t("messages:announcement");');
    expect(dropdown).toContain('default: return t("messages:convNameGroup");');
    expect(dropdown).not.toContain("{conv.type}");
  });

  it("COMM-FINAL-VIS-11 preserves the closed privacy, upload, and functional boundaries", async () => {
    const source = await messagesSource();

    expect(source).toContain("canUploadMessageAttachments");
    expect(source).toContain("uploadMessageAttachment");
    expect(source).toContain('onClick={() => onLightbox(att.url)}');
    expect(source).not.toContain("objectPath is rendered");
    expect(source).not.toContain("navigator.onLine");
  });

  it("COMM-FINAL-VIS-12 accounts for every current Communication-owned user surface", async () => {
    const [source, dropdown, layout] = await Promise.all([
      messagesSource(),
      dropdownSource(),
      layoutSource(),
    ]);

    for (const surface of [
      "ImageLightbox", "VoicePlayer", "EmojiReactionPicker", "MessageBubble",
      "MediaGalleryPanel", "NewConversationModal", "ForwardDialog",
    ]) {
      expect(source).toContain(surface);
    }
    expect(dropdown).toContain("export function MessagesDropdown()");
    expect(layout).toContain("<MessagesDropdown />");
  });
});