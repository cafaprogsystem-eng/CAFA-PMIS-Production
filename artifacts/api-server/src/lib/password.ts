// Password strength rules for invite acceptance + admin set-password.
// Min 10 chars, at least one letter and one digit, not in a small block-list.
const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "1234567890",
  "qwerty1234",
  "letmein123",
  "welcome123",
  "cafa2026",
  "cafa20261",
  "passw0rd!",
  "admin1234",
]);

export function validatePassword(pw: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof pw !== "string") return { ok: false, error: "password_required" };
  if (pw.length < 10) return { ok: false, error: "password_too_short" };
  if (pw.length > 200) return { ok: false, error: "password_too_long" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, error: "password_missing_letter" };
  if (!/\d/.test(pw)) return { ok: false, error: "password_missing_digit" };
  if (COMMON.has(pw.toLowerCase())) return { ok: false, error: "password_too_common" };
  return { ok: true };
}
