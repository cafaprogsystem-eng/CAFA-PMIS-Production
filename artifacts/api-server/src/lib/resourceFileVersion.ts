/**
 * Direct archive resources have a single current metadata row, unlike Drive
 * files which retain a row per version. Keep their displayed version monotonic
 * whenever the current binary is replaced.
 */
export function nextResourceFileVersion(current: string | null | undefined): string {
  const normalized = current?.trim() ?? "";
  const match = normalized.match(/^(v?)(\d+)$/i);
  if (!match) return "2";
  return `${match[1]}${BigInt(match[2]) + 1n}`;
}