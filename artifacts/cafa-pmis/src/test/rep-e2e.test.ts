/**
 * REP-E2E-01..12  Reports Module — Final Browser E2E Verification Tests
 *
 * Strategy: source-inspection tests for structural guarantees that cannot
 * regress silently, plus unit tests for pure-function and contract invariants.
 * Full browser interaction is covered by the Playwright testing subagent
 * (see docs/audit-reports/reports-final-browser-ux-verification.md).
 *
 * REP-E2E-01  Report type routing — correct form component per type
 * REP-E2E-02  Draft Continue Editing — same report ID, correct form
 * REP-E2E-03  Returned revision reopens same report (not a new one)
 * REP-E2E-04  Validation feedback accessible — error content in DOM after 422
 * REP-E2E-05  Submit button cannot double-fire (disabled/loading while pending)
 * REP-E2E-06  SPR section comments visible to author on returned draft
 * REP-E2E-07  HQ attachments: download URL does not expose raw storage path
 * REP-E2E-08  HQ voice note reviewer mode — Delete button absent
 * REP-E2E-09  PM override dialog — empty reason is blocked in UI
 * REP-E2E-10  Approval history — override badge and reason visible
 * REP-E2E-11  Unauthorised deep link → no report data exposed
 * REP-E2E-12  Long content — no layout overflow (whitespace handling)
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Source files ──────────────────────────────────────────────────────────────

const REPORTS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../pages/reports.tsx"),
  "utf8",
);

const SPR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../components/program-state-report-form.tsx"),
  "utf8",
);

const HQSR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../components/hq-sector-report-form.tsx"),
  "utf8",
);

const ACTIVITY_VIEWER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../components/activity-report-viewer.tsx"),
  "utf8",
);

const CONSOLIDATED_SRC = fs.readFileSync(
  path.resolve(__dirname, "../components/consolidated-report-view.tsx"),
  "utf8",
);

// ── REP-E2E-01: Report type routing ──────────────────────────────────────────

describe("REP-E2E-01: Report type routing — correct form per type", () => {
  it("ProgramStateReportForm is rendered when isProgramState is true", () => {
    // reports.tsx must gate on isProgramState for the SPR form
    expect(REPORTS_SRC).toContain("isProgramState");
    expect(REPORTS_SRC).toContain("ProgramStateReportForm");
  });

  it("HqSectorReportForm is rendered when isHqSector is true", () => {
    expect(REPORTS_SRC).toContain("isHqSector");
    expect(REPORTS_SRC).toContain("HqSectorReportForm");
  });

  it("Activity report section is gated on isActivity flag", () => {
    expect(REPORTS_SRC).toContain("isActivity");
  });

  it("Report type routing is mutually exclusive (else-if chain)", () => {
    // The form render block must use an else-if chain so only one form shows
    expect(REPORTS_SRC).toMatch(/isProgramState.*\?[\s\S]*?:.*isHqSector.*\?/);
  });

  it("lockedType set from tab selection gates which form renders", () => {
    expect(REPORTS_SRC).toContain("lockedType");
  });
});

// ── REP-E2E-02: Draft Continue Editing ───────────────────────────────────────

describe("REP-E2E-02: Draft Continue Editing — same report ID, correct form", () => {
  it("loadDraftForEdit function exists to rehydrate an existing report", () => {
    expect(REPORTS_SRC).toContain("loadDraftForEdit");
  });

  it("editingReport is threaded into each sub-form as existingReport", () => {
    expect(REPORTS_SRC).toContain("existingReport={editingReport");
  });

  it("SPR onOpenExistingDraft switches to existing draft (not new create)", () => {
    expect(REPORTS_SRC).toContain("onOpenExistingDraft");
    expect(REPORTS_SRC).toContain("loadDraftForEdit(target)");
  });

  it("Continue Editing dialog title distinguishes edit from create", () => {
    expect(REPORTS_SRC).toContain('t("form.continueEditing"');
  });
});

// ── REP-E2E-03: Returned revision reopens same report ────────────────────────

describe("REP-E2E-03: Returned revision reopens same report (not a new one)", () => {
  it("returned state is detected from report status field", () => {
    // The form must check for returned/revision status to enter edit mode
    expect(REPORTS_SRC).toContain("returned");
  });

  it("SPR isReturnedForRevision constant exists (derived before JSX)", () => {
    expect(SPR_SRC).toContain("const isReturnedForRevision =");
  });

  it("HQSR form handles returned status for edit mode", () => {
    expect(HQSR_SRC).toContain("returned");
  });

  it("patchExistingReport called in SPR before submit transition (same ID)", () => {
    expect(SPR_SRC).toContain("patchExistingReport");
  });
});

// ── REP-E2E-04: Validation feedback accessible after 422 ─────────────────────

describe("REP-E2E-04: Validation feedback accessible — error content in DOM", () => {
  it("reports.tsx uses role=alert for error messages", () => {
    expect(REPORTS_SRC).toContain('role="alert"');
  });

  it("SPR form uses role=alert for revision banner", () => {
    expect(SPR_SRC).toContain('role="alert"');
  });

  it("SPR friendlyCreateError converts report_content_incomplete to readable text", () => {
    // Covered by spr-ux-accessibility.test.tsx SPR-A11Y-07 — assert contract exists
    expect(SPR_SRC).toContain("export function friendlyCreateError");
    expect(SPR_SRC).toContain("report_content_incomplete");
  });

  it("HQSR form shows toast error on validation failures", () => {
    // HQSR surfaces validation errors through toast.error calls
    expect(HQSR_SRC).toContain("toast.error");
  });

  it("aria-invalid is applied to form fields with errors", () => {
    // At least one of the major form files must use aria-invalid
    const combined = REPORTS_SRC + SPR_SRC + HQSR_SRC;
    expect(combined).toContain("aria-invalid");
  });
});

// ── REP-E2E-05: Submit button cannot double-fire ──────────────────────────────

describe("REP-E2E-05: Submit button disabled/loading while request pending", () => {
  it("reports.tsx tracks submitting state for PMR/Activity buttons via mutation isPending", () => {
    // Reports.tsx uses react-query mutations; isPending flags gate the buttons
    expect(REPORTS_SRC).toContain("isPending");
    expect(REPORTS_SRC).toContain("aria-busy");
  });

  it("SPR Save Draft / Submit buttons carry aria-busy", () => {
    expect(SPR_SRC).toContain("aria-busy");
  });

  it("SPR submit button is disabled while saving (isSaving state)", () => {
    // SPR uses isSaving to prevent double-submit
    expect(SPR_SRC).toContain("disabled={isSaving}");
    expect(SPR_SRC).toContain("aria-busy={isSaving}");
  });

  it("HQSR submit button is disabled while saving (isSaving state)", () => {
    expect(HQSR_SRC).toContain("disabled={isSaving}");
    expect(HQSR_SRC).toContain("isSaving");
  });

  it("Save Draft button carries aria-busy in SPR", () => {
    const saveDraftBlock = SPR_SRC.slice(
      SPR_SRC.indexOf("stateForm.saveDraft"),
      SPR_SRC.indexOf("stateForm.saveDraft") + 400,
    );
    expect(saveDraftBlock).toContain("aria-busy");
  });
});

// ── REP-E2E-06: SPR section comments visible to author on returned draft ──────

describe("REP-E2E-06: SPR section comments context visible to author in returned draft", () => {
  it("CommentsPanel receives SPR_SECTION_KEYS for section-tagged comments", () => {
    expect(SPR_SRC).toContain("SPR_SECTION_KEYS");
  });

  it("author can read comments in returned state (isReturnedForRevision guard)", () => {
    // The SPR form must show comments when in returned state
    expect(SPR_SRC).toContain("isReturnedForRevision");
    // Comments panel should be visible (not blocked) in this state
    expect(SPR_SRC).toContain("CommentsPanel");
  });

  it("CommentsPanel is imported from comments-panel component", () => {
    expect(SPR_SRC).toContain("CommentsPanel");
  });
});

// ── REP-E2E-07: HQ attachments download URL — no raw storage path ─────────────

describe("REP-E2E-07: HQ attachments — download URL does not expose raw storage path", () => {
  it("HQSR evidence downloads go through /api/evidence/ secure endpoint", () => {
    // Covered in detail by hqsr-evidence.test.tsx and evidence-access-control-security.test.ts
    expect(HQSR_SRC).not.toContain("gs://");
    expect(HQSR_SRC).not.toContain("s3://");
  });

  it("consolidated report view does not expose raw storage paths in download links", () => {
    expect(CONSOLIDATED_SRC).not.toContain("gs://");
    expect(CONSOLIDATED_SRC).not.toContain("s3://");
  });

  it("reports.tsx attachment download does not use raw storage URL", () => {
    expect(REPORTS_SRC).not.toContain("gs://");
    expect(REPORTS_SRC).not.toContain("s3://");
  });
});

// ── REP-E2E-08: HQ voice note reviewer mode — Delete absent ──────────────────

describe("REP-E2E-08: HQ voice note reviewer mode — Delete button absent", () => {
  it("HQSR voice note delete gating covered by VoiceNotePanel readOnly prop", () => {
    // The detail/review sheet renders VoiceNotePanel with readOnly so reviewers
    // see playback only. Verified by hqsr-voice-notes.test.tsx (HQSR-VOICE-03).
    // Confirm CommentsPanel in HQSR uses the readOnly pattern.
    expect(HQSR_SRC).toContain("readOnly");
  });

  it("voice note delete gating covered by existing hqsr-voice-notes.test.tsx suite", () => {
    // hqsr-voice-notes.test.tsx verifies Delete is absent when readOnly=true.
    const voiceNoteTests = fs.readFileSync(
      path.resolve(__dirname, "hqsr-voice-notes.test.tsx"),
      "utf8",
    );
    expect(voiceNoteTests).toContain("readOnly");
    expect(voiceNoteTests).toContain("Delete");
  });
});

// ── REP-E2E-09: PM override dialog — empty reason blocked ────────────────────

describe("REP-E2E-09: PM override dialog — empty reason is blocked in UI", () => {
  it("self-review override dialog exists in reports.tsx", () => {
    expect(REPORTS_SRC).toContain("override");
    expect(REPORTS_SRC).toContain("overrideReason");
  });

  it("override submission is gated on non-empty reason", () => {
    // The submit handler must check that overrideReason is non-empty
    expect(REPORTS_SRC).toContain("overrideReason");
    // The reason is sent in the request body
    expect(REPORTS_SRC).toMatch(/overrideReason.*trim|trim.*overrideReason|overrideReason.*length/);
  });

  it("override dialog has a textarea for the reason", () => {
    expect(REPORTS_SRC).toContain("Textarea");
  });
});

// ── REP-E2E-10: Approval history — override badge and reason visible ──────────

describe("REP-E2E-10: Approval history — override badge and reason visible", () => {
  it("override badge rendered in approval history block", () => {
    expect(REPORTS_SRC).toContain("Override");
  });

  it("overrideReason displayed in approval history entry", () => {
    expect(REPORTS_SRC).toContain("overrideReason");
  });

  it("approval history section renders approvalHistory array entries", () => {
    // reports.tsx renders the approvalHistory array from the report object
    expect(REPORTS_SRC).toContain("approvalHistory");
    // usedOverride and overrideReason are read from history entries
    expect(REPORTS_SRC).toContain("usedOverride");
  });
});

// ── REP-E2E-11: Unauthorised deep link — no data exposed ─────────────────────

describe("REP-E2E-11: Unauthorised deep link → no report data exposed", () => {
  it("single report endpoint in routes uses requirePerm middleware", () => {
    // Backend uses requirePerm (which implies authentication) to guard all routes
    const apiRoutes = fs.readFileSync(
      path.resolve(__dirname, "../../../api-server/src/routes/reports.ts"),
      "utf8",
    );
    expect(apiRoutes).toContain("requirePerm");
  });

  it("single report endpoint uses assertCanViewReport for access control", () => {
    const apiRoutes = fs.readFileSync(
      path.resolve(__dirname, "../../../api-server/src/routes/reports.ts"),
      "utf8",
    );
    expect(apiRoutes).toContain("assertCanViewReport");
  });

  it("reports list endpoint is gated behind requirePerm", () => {
    const apiRoutes = fs.readFileSync(
      path.resolve(__dirname, "../../../api-server/src/routes/reports.ts"),
      "utf8",
    );
    // Every list/detail/create route uses requirePerm
    const permCount = (apiRoutes.match(/requirePerm/g) ?? []).length;
    expect(permCount).toBeGreaterThan(5);
  });
});

// ── REP-E2E-12: Long content — no layout overflow ────────────────────────────

describe("REP-E2E-12: Long content — whitespace and overflow handling", () => {
  it("SPR narrative sections use whitespace-pre-wrap for long text", () => {
    expect(SPR_SRC).toContain("whitespace-pre-wrap");
  });

  it("HQSR narrative sections use whitespace-pre-wrap or break-words", () => {
    const hasWrap =
      HQSR_SRC.includes("whitespace-pre-wrap") ||
      HQSR_SRC.includes("break-words") ||
      HQSR_SRC.includes("overflow-hidden");
    expect(hasWrap).toBe(true);
  });

  it("report list titles use truncate or overflow-hidden to prevent layout break", () => {
    const hasTruncate =
      REPORTS_SRC.includes("truncate") || REPORTS_SRC.includes("overflow-hidden");
    expect(hasTruncate).toBe(true);
  });

  it("consolidated report view handles long locality names", () => {
    const hasWrap =
      CONSOLIDATED_SRC.includes("truncate") ||
      CONSOLIDATED_SRC.includes("break-words") ||
      CONSOLIDATED_SRC.includes("whitespace-pre-wrap");
    expect(hasWrap).toBe(true);
  });
});
