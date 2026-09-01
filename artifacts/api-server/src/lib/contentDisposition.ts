/**
 * Single source of truth for building a `Content-Disposition` header for a
 * downloaded/previewed file with a user-supplied name.
 *
 * Previously hand-duplicated with three different levels of correctness:
 *   - routes/files.ts and routes/conversations.ts each independently wrote
 *     the correct RFC 5987 form (an ASCII-mangled `filename="..."` fallback
 *     plus a `filename*=UTF-8''...` percent-encoded extension so a modern
 *     browser renders the real, non-ASCII name).
 *   - routes/attachments.ts only ever emitted the ASCII-mangled fallback —
 *     a non-ASCII (e.g. Arabic) attachment filename downloaded as a mangled
 *     "____.pdf" everywhere the other two surfaces would show it correctly.
 *   - routes/projects.ts and routes/reports.ts put a raw
 *     `encodeURIComponent(name)` string directly into the basic
 *     `filename="..."` parameter — which is invalid there (that parameter
 *     is not percent-decoded), so a non-ASCII name downloaded as the
 *     literal percent-escape sequence (e.g. "%D8%AA%D9%82...pdf") in any
 *     browser that only reads `filename=`.
 */
export function contentDispositionHeader(name: string | null | undefined, disposition: "inline" | "attachment"): string {
  const safe = String(name ?? "download").replace(/["\\\/\x00-\x1f\x7f]/g, "_").trim() || "download";
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
