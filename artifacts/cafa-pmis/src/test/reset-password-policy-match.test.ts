/**
 * RESET-PASSWORD-POLICY-MATCH — the Reset Password screen required an
 * uppercase letter and a special character, and gated its submit button on
 * all 5 checklist rules passing, while the server's actual policy
 * (api-server/src/lib/password.ts) only requires 10+ characters, one letter,
 * and one digit. A password the server would accept (e.g. "abcdefgh12")
 * could never be submitted — the button just stayed disabled with no
 * explanation. Fixed to check exactly the server's rules, matching the
 * pattern already used by pages/profile.tsx and pages/invite-accept.tsx.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reset-password.tsx"), "utf8");

describe("RESET-PASSWORD-POLICY-MATCH", () => {
  it("validateRules() checks length>=10, one letter, one digit — nothing else", () => {
    expect(src).toContain("length: pw.length >= 10");
    expect(src).toContain("letter: /[A-Za-z]/.test(pw)");
    expect(src).toContain("digit:  /[0-9]/.test(pw)");
    expect(src).not.toMatch(/upper:\s*\/\[A-Z\]\//);
    expect(src).not.toMatch(/lower:\s*\/\[a-z\]\//);
    expect(src).not.toMatch(/special:\s*\/\[\^A-Za-z0-9\]\//);
  });

  it("the visible checklist renders exactly the three server-matching rules", () => {
    const checklistStart = src.indexOf("{/* Rules */}");
    const checklistEnd = src.indexOf("</div>", checklistStart);
    const checklist = src.slice(checklistStart, checklistEnd);
    expect(checklist).toContain('{ ok: rules.length, label: t("rulesLength") }');
    expect(checklist).toContain('{ ok: rules.letter, label: t("rulesLetter") }');
    expect(checklist).toContain('{ ok: rules.digit,  label: t("rulesDigit") }');
    expect(checklist).not.toContain("rules.upper");
    expect(checklist).not.toContain("rules.lower");
    expect(checklist).not.toContain("rules.special");
  });

  it("still gates submission on every rule passing and the confirmation matching", () => {
    expect(src).toContain("disabled={busy || !allPass || password !== confirm}");
  });
});
