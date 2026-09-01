/**
 * COMMUNICATION-FILE-ARCHIVE-I18N-HARDCODED-TEXT — the "File Unavailable"
 * state (and its longer File & Archive description) was hardcoded English in
 * both pages/files.tsx (1 occurrence) and pages/messages.tsx (3 occurrences:
 * image, voice, and generic file attachments), never routed through t().
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const filesSrc = readFileSync(resolve(__dirname, "../pages/files.tsx"), "utf8");
const messagesSrc = readFileSync(resolve(__dirname, "../pages/messages.tsx"), "utf8");

describe("COMMUNICATION-FILE-ARCHIVE-I18N-HARDCODED-TEXT", () => {
  it("files.tsx's DetailDialog unavailable state is translated", () => {
    expect(filesSrc).toContain('{t("fileArchive.fileUnavailable")}');
    expect(filesSrc).toContain('{t("fileArchive.fileUnavailableDesc")}');
    expect(filesSrc).not.toMatch(/>File Unavailable</);
  });

  it("messages.tsx's three attachment-unavailable states (image/voice/file) are all translated", () => {
    const occurrences = [...messagesSrc.matchAll(/\{t\("fileUnavailable"\)\}/g)];
    expect(occurrences.length).toBe(3);
    expect(messagesSrc).not.toMatch(/>File Unavailable</);
  });
});
