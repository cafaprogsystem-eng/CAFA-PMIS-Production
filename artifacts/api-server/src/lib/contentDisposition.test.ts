/**
 * FILES-CONTENT-DISPOSITION-UNIFIED — Content-Disposition header construction
 * was hand-duplicated three ways with three different levels of correctness:
 *   - files.ts and conversations.ts each independently wrote the correct
 *     RFC 5987 form (ASCII-mangled fallback + filename*=UTF-8'' extension).
 *   - attachments.ts only emitted the ASCII-mangled fallback — a non-ASCII
 *     (e.g. Arabic) filename downloaded as a mangled "____.pdf" there while
 *     the other two surfaces would show it correctly.
 *   - projects.ts and reports.ts put a raw encodeURIComponent(name) string
 *     directly into the basic filename="..." parameter, which a browser
 *     that only reads that parameter shows as the literal percent-escape
 *     sequence, not the real name.
 * All five now share one function.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentDispositionHeader } from "./contentDisposition";

describe("FILES-CONTENT-DISPOSITION-UNIFIED: contentDispositionHeader", () => {
  it("provides an RFC 5987 filename*= extension alongside the ASCII fallback for a non-ASCII name", () => {
    const header = contentDispositionHeader("تقرير.pdf", "attachment");
    expect(header).toContain('attachment; filename="');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("تقرير.pdf"));
    // The ASCII fallback must not contain the raw non-ASCII bytes.
    const asciiPart = header.match(/filename="([^"]*)"/)![1];
    expect(asciiPart).not.toBe("تقرير.pdf");
    expect(/^[\x20-\x7e]*$/.test(asciiPart)).toBe(true);
  });

  it("strips quotes, slashes, backslashes, and control characters (CRLF header-injection defence)", () => {
    const header = contentDispositionHeader('evil"\r\nX-Injected: 1.pdf', "attachment");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).not.toContain('""');
  });

  it("falls back to 'download' for a null/empty/whitespace-only name", () => {
    for (const bad of [null, undefined, "", "   "]) {
      const header = contentDispositionHeader(bad as string | null, "attachment");
      expect(header).toContain('filename="download"');
    }
  });

  it("respects the inline/attachment disposition parameter", () => {
    expect(contentDispositionHeader("a.pdf", "inline")).toMatch(/^inline;/);
    expect(contentDispositionHeader("a.pdf", "attachment")).toMatch(/^attachment;/);
  });
});

describe("FILES-CONTENT-DISPOSITION-UNIFIED: every former call site now shares this one function", () => {
  const files = ["files", "conversations", "attachments", "projects", "reports"] as const;
  for (const name of files) {
    it(`routes/${name}.ts imports and uses contentDispositionHeader`, () => {
      const src = readFileSync(resolve(__dirname, `../routes/${name}.ts`), "utf8");
      expect(src).toContain('import { contentDispositionHeader } from "../lib/contentDisposition";');
      expect(src).toContain("contentDispositionHeader(");
    });
  }

  it("no route file still hand-builds its own Content-Disposition value", () => {
    for (const name of files) {
      const src = readFileSync(resolve(__dirname, `../routes/${name}.ts`), "utf8");
      expect(src).not.toMatch(/`(?:attachment|inline); filename=/);
    }
  });
});
