/**
 * ATTACHMENT-CONTENT-TYPES — storage.ts and attachments.ts each hand-maintained
 * their own ALLOWED_CONTENT_TYPES set and had already drifted: attachments.ts
 * silently rejected image/svg+xml and every audio MIME type (voice-note-shaped
 * uploads) that storage.ts accepted. Both now import the same
 * ALLOWED_ATTACHMENT_CONTENT_TYPES set from this file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWED_ATTACHMENT_CONTENT_TYPES } from "./attachmentContentTypes";

const storageSrc = readFileSync(resolve(__dirname, "../routes/storage.ts"), "utf8");
const attachmentsSrc = readFileSync(resolve(__dirname, "../routes/attachments.ts"), "utf8");

describe("ATTACHMENT-CONTENT-TYPES: one shared set covers every previously-drifted type", () => {
  it("includes every document/image/archive/audio type from both former lists", () => {
    for (const type of [
      "application/pdf", "application/msword", "text/csv",
      "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
      "application/zip", "application/x-zip-compressed",
      "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav",
    ]) {
      expect(ALLOWED_ATTACHMENT_CONTENT_TYPES.has(type), `missing ${type}`).toBe(true);
    }
  });

  it("storage.ts imports the shared set instead of declaring its own", () => {
    expect(storageSrc).toContain(
      'import { ALLOWED_ATTACHMENT_CONTENT_TYPES as ALLOWED_CONTENT_TYPES } from "../lib/attachmentContentTypes";',
    );
    expect(storageSrc).not.toMatch(/const ALLOWED_CONTENT_TYPES = new Set\(/);
  });

  it("attachments.ts imports the shared set instead of declaring its own", () => {
    expect(attachmentsSrc).toContain(
      'import { ALLOWED_ATTACHMENT_CONTENT_TYPES as ALLOWED_CONTENT_TYPES } from "../lib/attachmentContentTypes";',
    );
    expect(attachmentsSrc).not.toMatch(/const ALLOWED_CONTENT_TYPES = new Set\(/);
  });
});
