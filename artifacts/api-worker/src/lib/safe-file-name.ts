/**
 * Rejects path separators, C0 control characters, and DEL in a
 * user-supplied filename -- object keys are server-generated, but the
 * filename is later used in Content-Disposition, so an unsafe name is
 * rejected outright rather than silently transformed.
 *
 * Implemented via character-code comparison rather than a regex literal
 * embedding raw control-character escapes, after depicting that exact
 * character range as escape-sequence text caused this model to emit actual
 * raw control bytes into a file once already this session -- see
 * routes/files.ts for the same fix applied there first.
 */
export function hasUnsafeFileNameChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code === 47 /* / */ || code === 92 /* backslash */ || code <= 31 || code === 127) return true;
  }
  return false;
}
