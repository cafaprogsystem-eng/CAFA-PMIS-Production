/**
 * Ported verbatim from artifacts/api-server/src/lib/contentDisposition.ts —
 * single source of truth for a `Content-Disposition` header for a
 * downloaded/previewed file with a user-supplied name (correct RFC 5987 form:
 * an ASCII-mangled `filename="..."` fallback plus a percent-encoded
 * `filename*=UTF-8''...` extension so a non-ASCII name still renders
 * correctly in a modern browser).
 */
export function contentDispositionHeader(name: string | null | undefined, disposition: "inline" | "attachment"): string {
  const safe = String(name ?? "download").replace(/["\\/\x00-\x1f\x7f]/g, "_").trim() || "download";
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
