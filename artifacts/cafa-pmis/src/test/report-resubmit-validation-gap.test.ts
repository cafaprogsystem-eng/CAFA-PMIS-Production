/**
 * REPORT-RESUBMIT-VALIDATION-GAP — hq-sector-report-form.tsx and
 * program-state-report-form.tsx both skipped ALL client-side required-field
 * validation on resubmission: onSubmitReport's edit-mode branch called
 * patchExistingReport (buildPatchPayload — deliberately validation-free, since
 * it also serves plain content-save PATCHes) and then unconditionally
 * triggered the submit transition, with no validation gate in between. A
 * blank required field or (HQSR) zero support requests would only be caught
 * by the server's 422, discovered after a round-trip instead of immediately.
 *
 * Both forms now extract their full buildPayload validation into a shared
 * validateSubmitReadiness() function, called both by buildPayload (create
 * path) AND by onSubmitReport's resubmit branch before patchExistingReport.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hqsrSrc = readFileSync(resolve(__dirname, "../components/hq-sector-report-form.tsx"), "utf8");
const sprSrc = readFileSync(resolve(__dirname, "../components/program-state-report-form.tsx"), "utf8");

describe("REPORT-RESUBMIT-VALIDATION-GAP: HQSR resubmission is validated before patching", () => {
  it("defines a shared validateSubmitReadiness function containing the full required-field gate", () => {
    // Signature widened by item 8 (error-handling unification) to accept an
    // optional onError callback, matching SPR's fail(msg) shape — same function,
    // same required-field gate.
    expect(hqsrSrc).toContain("function validateSubmitReadiness(values: BasicValues, requireSupport: boolean, onError?: (msg: string) => void): boolean");
    expect(hqsrSrc).toContain("errTitleRequired");
    expect(hqsrSrc).toContain("errSupportRequired");
  });

  it("buildPayload delegates to validateSubmitReadiness instead of re-checking inline", () => {
    expect(hqsrSrc).toContain("if (!validateSubmitReadiness(values, submitMode, onError)) return null;");
  });

  it("onSubmitReport's resubmit branch validates BEFORE calling patchExistingReport", () => {
    const resubmitBranch = hqsrSrc.slice(
      hqsrSrc.indexOf("const onSubmitReport = form.handleSubmit"),
      hqsrSrc.indexOf("const fileInputRef"),
    );
    const validateIdx = resubmitBranch.indexOf("validateSubmitReadiness(values, true, raiseFormError)");
    const patchIdx = resubmitBranch.indexOf("await patchExistingReport(values)");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(patchIdx);
  });
});

describe("REPORT-RESUBMIT-VALIDATION-GAP: SPR resubmission is validated before patching", () => {
  it("defines a shared validateSubmitReadiness function containing the full required-field gate", () => {
    expect(sprSrc).toContain("function validateSubmitReadiness(values: BasicValues, onError?: (msg: string) => void): boolean");
    expect(sprSrc).toContain("validationEnterTitle");
    expect(sprSrc).toContain("validationAddActivity");
  });

  it("buildPayload delegates to validateSubmitReadiness instead of re-checking inline", () => {
    expect(sprSrc).toContain("if (!validateSubmitReadiness(values, onError)) return null;");
  });

  it("onSubmitReport's resubmit branch validates BEFORE calling patchExistingReport", () => {
    const resubmitBranch = sprSrc.slice(
      sprSrc.indexOf("const onSubmitReport = form.handleSubmit"),
    );
    const validateIdx = resubmitBranch.indexOf("validateSubmitReadiness(values, raiseFormError)");
    const patchIdx = resubmitBranch.indexOf("await patchExistingReport(values)");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(patchIdx);
  });
});
