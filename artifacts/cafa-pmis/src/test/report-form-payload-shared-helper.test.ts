/**
 * REPORT-FORM-PAYLOAD-SHARED-HELPER — HQSR's buildPayload/buildPatchPayload
 * and SPR's buildPayload/buildPatchPayload each hand-rolled the same
 * attachment-sanitisation filter/map and reporting-period string formula
 * across four call sites total. Both now call the shared
 * lib/report-form-payload-shared.ts helpers (sanitizeReportAttachments,
 * buildReportPeriodLabel) instead. The one genuine behavioural difference
 * between the two forms — HQSR's on-demand period is a "start to end" range
 * (it has no top-level periodStart/periodEnd fields per HQSR-004), SPR's is
 * just the start date (it sends periodStart/periodEnd as their own top-level
 * fields) — is preserved via the explicit onDemandFormat parameter, not
 * silently unified away.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeReportAttachments, buildReportPeriodLabel } from "@/lib/report-form-payload-shared";

const hqsrSrc = readFileSync(resolve(__dirname, "../components/hq-sector-report-form.tsx"), "utf8");
const sprSrc = readFileSync(resolve(__dirname, "../components/program-state-report-form.tsx"), "utf8");

describe("REPORT-FORM-PAYLOAD-SHARED-HELPER: behaviour of the extracted pure helpers", () => {
  it("sanitizeReportAttachments drops attachments with neither attachmentId nor objectPath, and strips local-only fields", () => {
    const result = sanitizeReportAttachments([
      { tempId: "a", fileName: "a.pdf", contentType: "application/pdf", size: 1, objectPath: "", attachmentType: "Other", uploading: true },
      { tempId: "b", attachmentId: 5, fileName: "b.pdf", contentType: "application/pdf", size: 2, objectPath: "", attachmentType: "Other" },
      { tempId: "c", fileName: "c.pdf", contentType: "application/pdf", size: 3, objectPath: "obj/c", attachmentType: "Report" },
    ]);
    expect(result).toEqual([
      { attachmentId: 5, fileName: "b.pdf", contentType: "application/pdf", size: 2, objectPath: "", attachmentType: "Other" },
      { fileName: "c.pdf", contentType: "application/pdf", size: 3, objectPath: "obj/c", attachmentType: "Report" },
    ]);
    for (const item of result) {
      expect(item).not.toHaveProperty("tempId");
      expect(item).not.toHaveProperty("uploading");
      expect(item).not.toHaveProperty("file");
    }
  });

  it("buildReportPeriodLabel matches HQSR's original formula (range) for quarterly/annual/monthly/on_demand", () => {
    const base = { reportingYear: 2026, quarter: 2, reportingMonth: 4, periodStart: "2026-01-01", periodEnd: "2026-01-15" };
    expect(buildReportPeriodLabel({ frequency: "quarterly", ...base }, "range")).toBe("2026-Q2");
    expect(buildReportPeriodLabel({ frequency: "annual", ...base }, "range")).toBe("2026");
    expect(buildReportPeriodLabel({ frequency: "monthly", ...base }, "range")).toBe("2026-04");
    expect(buildReportPeriodLabel({ frequency: "on_demand", ...base }, "range")).toBe("2026-01-01 to 2026-01-15");
  });

  it("buildReportPeriodLabel matches SPR's original formula (start-only) for on_demand", () => {
    const base = { reportingYear: 2026, quarter: 2, reportingMonth: 4, periodStart: "2026-01-01", periodEnd: "2026-01-15" };
    expect(buildReportPeriodLabel({ frequency: "on_demand", ...base }, "start-only")).toBe("2026-01-01");
    // Non-on_demand branches are identical regardless of onDemandFormat.
    expect(buildReportPeriodLabel({ frequency: "quarterly", ...base }, "start-only")).toBe("2026-Q2");
  });
});

describe("REPORT-FORM-PAYLOAD-SHARED-HELPER: both forms call the shared helpers, not their own inline copies", () => {
  it("HQSR imports and uses both shared helpers", () => {
    expect(hqsrSrc).toContain('import { sanitizeReportAttachments, buildReportPeriodLabel } from "@/lib/report-form-payload-shared";');
    const attachmentCalls = [...hqsrSrc.matchAll(/sanitizeReportAttachments\(attachments\)/g)];
    expect(attachmentCalls.length).toBe(2);
    const periodCalls = [...hqsrSrc.matchAll(/buildReportPeriodLabel\(/g)];
    expect(periodCalls.length).toBe(2);
    expect(hqsrSrc).toContain('"range",');
    expect(hqsrSrc).not.toMatch(/attachments\.filter\(\(d\) => d\.attachmentId \|\| d\.objectPath\)/);
  });

  it("SPR imports and uses both shared helpers", () => {
    expect(sprSrc).toContain('import { sanitizeReportAttachments, buildReportPeriodLabel } from "@/lib/report-form-payload-shared";');
    const attachmentCalls = [...sprSrc.matchAll(/sanitizeReportAttachments\(attachments\)/g)];
    expect(attachmentCalls.length).toBe(2);
    const periodCalls = [...sprSrc.matchAll(/buildReportPeriodLabel\(/g)];
    expect(periodCalls.length).toBe(1);
    expect(sprSrc).toContain('"start-only",');
    expect(sprSrc).not.toMatch(/attachments\.filter\(\(d\) => d\.attachmentId \|\| d\.objectPath\)/);
    expect(sprSrc).not.toMatch(/attachments\s*\n\s*\.filter\(\(d\) => d\.attachmentId \|\| d\.objectPath\)/);
  });
});
