/**
 * REPORT-RISK-STATUS-SYNC — the inline "sync risk status back to the Risk
 * Register" button (reports.tsx) fired a PATCH to /api/risks/:id with no
 * res.ok check, unlike every other PATCH in this same file. On any failure
 * (403, 422, network error) it still invalidated queries, cleared the pending
 * edit, and showed a success toast — a false positive telling the user the
 * status changed when it hadn't. It now checks res.ok and shows an error toast
 * on failure, matching the file's own established pattern.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");

describe("REPORT-RISK-STATUS-SYNC: the risk-status Save button checks res.ok before reporting success", () => {
  it("checks res.ok and throws before invalidating queries or toasting success", () => {
    const btnStart = src.indexOf('t("formExtra.riskStatusUpdateFailed")');
    expect(btnStart).toBeGreaterThan(-1);
    const block = src.slice(
      src.lastIndexOf("onClick={async () => {", btnStart),
      src.indexOf("}}", btnStart) + 2,
    );
    expect(block).toContain("if (!res.ok)");
    const okCheckIdx = block.indexOf("if (!res.ok)");
    const invalidateIdx = block.indexOf("qc.invalidateQueries");
    const toastSuccessIdx = block.indexOf("toast.success");
    expect(okCheckIdx).toBeLessThan(invalidateIdx);
    expect(okCheckIdx).toBeLessThan(toastSuccessIdx);
  });

  it("shows an error toast on failure instead of silently swallowing it", () => {
    const btnStart = src.indexOf('t("formExtra.riskStatusUpdateFailed")');
    const block = src.slice(
      src.lastIndexOf("onClick={async () => {", btnStart),
      src.indexOf("}}", btnStart) + 2,
    );
    expect(block).toContain("} catch (e: unknown) {");
    expect(block).toContain("toast.error(");
  });
});
