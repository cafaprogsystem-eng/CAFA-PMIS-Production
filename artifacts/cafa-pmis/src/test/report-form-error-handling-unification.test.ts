/**
 * REPORT-FORM-ERROR-HANDLING-UNIFICATION — hq-sector-report-form.tsx and
 * program-state-report-form.tsx used two different error-reporting styles for
 * the same class of validation failure: HQSR only toasted; SPR toasted AND
 * surfaced an accessible, focus-managed error-summary region (better a11y
 * practice, since a transient toast is not reliably announced for
 * screen-reader users). HQSR now matches SPR's fail(msg) shape and has the
 * same accessible error-summary region. SPR already warns before submitting
 * with zero attachments; HQSR now has the identical warning.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hqsrSrc = readFileSync(resolve(__dirname, "../components/hq-sector-report-form.tsx"), "utf8");
const sprSrc = readFileSync(resolve(__dirname, "../components/program-state-report-form.tsx"), "utf8");
const enReports = JSON.parse(readFileSync(resolve(__dirname, "../locales/en/reports.json"), "utf8"));
const arReports = JSON.parse(readFileSync(resolve(__dirname, "../locales/ar/reports.json"), "utf8"));

describe("REPORT-FORM-ERROR-HANDLING-UNIFICATION: HQSR now matches SPR's error-reporting shape", () => {
  it("HQSR's validateSubmitReadiness uses the same fail(msg) helper shape as SPR's", () => {
    expect(hqsrSrc).toContain("function fail(msg: string) { toast.error(msg); onError?.(msg); return false; }");
    expect(sprSrc).toContain("function fail(msg: string) { toast.error(msg); onError?.(msg); return false; }");
  });

  it("HQSR has the same accessible, focus-managed error-summary mechanism as SPR", () => {
    for (const src of [hqsrSrc, sprSrc]) {
      expect(src).toContain("function raiseFormError(msg: string) {");
      expect(src).toContain("setTimeout(() => errorSummaryRef.current?.focus(), 0);");
      expect(src).toMatch(/role="alert"\s*\n\s*aria-live="assertive"/);
    }
  });

  it("HQSR's buildPayload/onSubmitReport pass raiseFormError through, matching SPR", () => {
    expect(hqsrSrc).toMatch(/buildPayload\(values, false, raiseFormError\)/);
    expect(hqsrSrc).toMatch(/buildPayload\(values, true, raiseFormError\)/);
    expect(hqsrSrc).toContain("validateSubmitReadiness(values, true, raiseFormError)");
  });

  it("HQSR now has the same no-attachments submit warning as SPR", () => {
    expect(hqsrSrc).toContain("hasNoAttachments");
    expect(hqsrSrc).toContain('if (!window.confirm(t("hqForm.noAttachmentsConfirm"))) return;');
    expect(enReports.hqForm.noAttachmentsConfirm).toBeTruthy();
    expect(arReports.hqForm.noAttachmentsConfirm).toBeTruthy();
  });

  it("the correctErrorsBeforeContinuing key exists for hqForm in both locales", () => {
    expect(enReports.hqForm.correctErrorsBeforeContinuing).toBeTruthy();
    expect(arReports.hqForm.correctErrorsBeforeContinuing).toBeTruthy();
  });
});
