/**
 * RISK-SEVERITY-IMPACT-SYNC — the create form force-writes severity to match
 * impact whenever impact changes (createForm.setValue("impact", v);
 * createForm.setValue("severity", v)), keeping the two columns identical for
 * every new risk. The edit form (RiskDetailModal) only called
 * form.setValue("impact", v) — severity was never touched again after the
 * first edit, so the two columns silently diverged in storage (a future edit
 * to impact=high left severity stuck at whatever it was on creation). Both
 * forms now keep the columns in sync identically.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/risks.tsx"), "utf8");

describe("RISK-SEVERITY-IMPACT-SYNC: the edit form syncs severity whenever impact changes, same as create", () => {
  it("the create form's impact Select still syncs both fields (unchanged reference behaviour)", () => {
    expect(src).toContain('onValueChange={(v) => { createForm.setValue("impact", v); createForm.setValue("severity", v); }}');
  });

  it("the edit form's impact Select now ALSO syncs severity, not just impact", () => {
    expect(src).toContain('onValueChange={(v) => { form.setValue("impact", v); form.setValue("severity", v); }}');
    expect(src).not.toContain('onValueChange={(v) => form.setValue("impact", v)}');
  });
});
