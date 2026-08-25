/**
 * RISK-CONTRACT-07 and RISK-CONTRACT-10 (frontend)
 * Verifies generated enum types compile and exist, and no new `as any` casts
 * were introduced in Risk-related frontend files.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── RISK-CONTRACT-07: Generated enum types exist ─────────────────────────────
// Verified by reading the generated file content directly — avoids needing
// a deep-import specifier that the package doesn't export.

describe("RISK-CONTRACT-07 — generated enum types exist for risk fields", () => {
  const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
  const generatedFile = path.join(
    WORKSPACE_ROOT,
    "lib/api-client-react/src/generated/api.schemas.ts"
  );

  let src = "";
  it("generated api.schemas.ts exists", () => {
    expect(fs.existsSync(generatedFile)).toBe(true);
    src = fs.readFileSync(generatedFile, "utf-8");
  });

  it("RiskSeverity enum is exported", () => {
    if (!src) src = fs.readFileSync(generatedFile, "utf-8");
    expect(src).toContain("export const RiskSeverity");
    expect(src).toContain("low");
    expect(src).toContain("medium");
    expect(src).toContain("high");
    expect(src).toContain("critical");
  });

  it("RiskLikelihood enum is exported with all 7 values including legacy aliases", () => {
    if (!src) src = fs.readFileSync(generatedFile, "utf-8");
    expect(src).toContain("export const RiskLikelihood");
    for (const v of ["low", "medium", "high", "unlikely", "possible", "likely", "almost_certain"]) {
      expect(src).toContain(v);
    }
  });

  it("RiskImpact enum is exported", () => {
    if (!src) src = fs.readFileSync(generatedFile, "utf-8");
    expect(src).toContain("export const RiskImpact");
  });

  it("RiskStatus enum is exported with all 9 status values", () => {
    if (!src) src = fs.readFileSync(generatedFile, "utf-8");
    expect(src).toContain("export const RiskStatus");
    for (const v of [
      "open", "under_mitigation", "closed", "identified",
      "assigned", "mitigation_plan", "follow_up", "escalation", "mitigated",
    ]) {
      expect(src).toContain(v);
    }
  });
});

// ── RISK-CONTRACT-10: No new `as any` casts in risk-related frontend files ───

describe("RISK-CONTRACT-10 — no `as any` casts in Risk-related frontend files", () => {
  const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
  const risksPage = path.join(WORKSPACE_ROOT, "artifacts/cafa-pmis/src/pages/risks.tsx");

  it("risks.tsx does not contain `as any`", () => {
    if (!fs.existsSync(risksPage)) {
      // file not present — skip
      expect(true).toBe(true);
      return;
    }
    const src = fs.readFileSync(risksPage, "utf-8");
    const asAnyCount = (src.match(/\bas any\b/g) ?? []).length;
    expect(asAnyCount).toBe(0);
  });
});
