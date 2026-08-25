/**
 * Reports Module — Final Visual Closure Test Suite
 *
 * REP-FINAL-VIS-01 through REP-FINAL-VIS-10
 *
 * Uses source-analysis assertions (read file content, assert patterns),
 * following the established pattern from reports-visual.test.tsx and
 * reports-final-ux.test.tsx.
 *
 * British English spelling throughout.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const reportsSrc = read("../pages/reports.tsx");
const sprSrc = read("../components/program-state-report-form.tsx");
const hqsrSrc = read("../components/hq-sector-report-form.tsx");
const viewerSrc = read("../components/activity-report-viewer.tsx");
const detailSrc = read("../components/activity-report-detail.tsx");

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-01: Human-readable type/status labels — no raw enum user-visible
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-01: All four Report types show human-readable labels", () => {
  it("TYPE_META provides human-readable labels for all four report types", () => {
    expect(reportsSrc).toContain("Project Reports");
    expect(reportsSrc).toContain("Activity Reports");
    expect(reportsSrc).toContain("State Programme Reports");
    expect(reportsSrc).toContain("HQ Sector Reports");
  });

  it("project picker meta line routes project status through formatStatusLabel (no raw p.status)", () => {
    expect(reportsSrc).not.toContain("{p.code} · {donor} · {p.status}");
    expect(reportsSrc).toContain("formatStatusLabel(p.status)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-02: Statuses routed through displayStatus — no snake_case rendered
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-02: Status/workflow values routed through displayStatus", () => {
  it("displayStatus function exists and maps technical statuses", () => {
    expect(reportsSrc).toMatch(/function displayStatus\(backend: string, translate\?:/);
    expect(reportsSrc).toContain("Technically Approved");
    expect(reportsSrc).toContain("Coordination Approved");
  });

  it("table status badge uses displayStatus(r.status)", () => {
    const tableSection = reportsSrc.slice(reportsSrc.indexOf("TableBody"));
    expect(tableSection).toMatch(/displayStatus\(r\.status,\s*t\)/);
  });

  it("workflow_path is never rendered as raw user-visible text", () => {
    // Any workflow_path usage is in logic/payloads, not inside JSX text nodes
    expect(reportsSrc).not.toMatch(/>\s*\{[^}]*workflow_path[^}]*\}\s*</);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-03: Form mode titles (Create/Edit/Revise)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-03: Forms show correct Create/Edit/Revise mode title", () => {
  it("SPR form branches its title on mode", () => {
    expect(sprSrc).toContain('t("stateForm.titleRevise")');
    expect(sprSrc).toContain('t("stateForm.titleEdit")');
  });

  it("HQSR form uses the hqForm.titleRevise i18n key family", () => {
    expect(hqsrSrc).toMatch(/titleRevise/);
  });

  it("hqForm.titleRevise i18n key present in EN and AR locale files", () => {
    const en = read("../locales/en/reports.json");
    const ar = read("../locales/ar/reports.json");
    expect(en).toContain("titleRevise");
    expect(ar).toContain("titleRevise");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-04: Author/reviewer action availability unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-04: Author and reviewer action availability unchanged", () => {
  it("hasPerm continues to gate report actions", () => {
    expect(reportsSrc).toContain("hasPerm(perms,");
    expect(reportsSrc).toContain('hasPerm(perms, "reports.program_state.create")');
  });

  it("Continue Editing remains draft-gated", () => {
    expect(reportsSrc).toContain("canResumeReportDraft");
    expect(reportsSrc).toContain('report.status !== "draft"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-05: Returned-for-revision banner
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-05: Returned-for-revision banner is alert-styled with amber styling", () => {
  it("reports surfaces a role=alert revision banner with amber styling", () => {
    const combined = reportsSrc + sprSrc + hqsrSrc;
    expect(combined).toContain('role="alert"');
    expect(combined).toMatch(/amber/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-06: Financial values through formatCurrency
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-06: Financial values use formatCurrency; null/zero semantics preserved", () => {
  it("formatCurrency is imported and used in reports.tsx", () => {
    expect(reportsSrc).toMatch(/import .*formatCurrency.* from "@\/lib\/format"/);
    expect(reportsSrc).toContain("formatCurrency(");
  });

  it("no hardcoded dollar-prefixed template rendering of amounts", () => {
    expect(reportsSrc).not.toMatch(/>\s*\$\{?\d/);
    expect(reportsSrc).not.toMatch(/`\$\$\{[a-z]+\.(amount|budget|spent)/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-07: No storage-internal paths rendered
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-07: Attachment actions present; no storage-internal identifiers rendered", () => {
  it("no objectPath or driveFileId rendered as user-visible text", () => {
    for (const src of [reportsSrc, sprSrc, hqsrSrc, viewerSrc, detailSrc]) {
      expect(src).not.toMatch(/>\{[^}\n]*objectPath[^}\n]*\}</);
      expect(src).not.toMatch(/>\{[^}\n]*driveFileId[^}\n]*\}</);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-08: Busy state disables submit/draft controls
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-08: Authoring submit/draft controls disabled during mutation", () => {
  it("SPR and HQSR forms disable controls on pending mutation", () => {
    expect(sprSrc).toMatch(/disabled=\{[^}]*(isPending|isSubmitting|saving|busy)/i);
    expect(hqsrSrc).toMatch(/disabled=\{[^}]*(isPending|isSubmitting|saving|busy)/i);
  });

  it("reports.tsx PMR form disables controls on pending mutation", () => {
    expect(reportsSrc).toMatch(/disabled=\{[^}]*(isPending|isSubmitting|saving|busy)/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-09: Bounded cells with safe truncation
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-09: Report detail lists render in bounded cells with safe truncation", () => {
  it("table cells retain max-w + truncate", () => {
    expect(reportsSrc).toContain("max-w-[160px] truncate");
    expect(reportsSrc).toMatch(/max-w-\[\d+px\] truncate/);
  });

  it("break-words or truncation used in detail content", () => {
    expect(reportsSrc).toMatch(/break-words|truncate|line-clamp/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-FINAL-VIS-10: Final closure typography contract + no functional changes
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-FINAL-VIS-10: Final visual closure contract", () => {
  it("PMR form section headings no longer use uppercase tracking-wider", () => {
    expect(reportsSrc).not.toMatch(/uppercase tracking-wider/);
  });

  it("detail 'Saved' and documents heading no longer use uppercase tracking-wide", () => {
    expect(reportsSrc).not.toMatch(
      /text-xs font-medium text-muted-foreground uppercase tracking-wide/,
    );
  });

  it("only the documented intentional uppercase workflow-tag/banner labels remain", () => {
    const remaining = reportsSrc.match(/uppercase tracking/g) ?? [];
    // Lines 203, 218, 838, 3309, 3388 — documented NOT A DEFECT in
    // docs/audit-reports/reports-visual-refinement-final-closure.md
    expect(remaining.length).toBe(5);
  });

  it("SPR/HQSR/activity viewer/detail files remain free of uppercase tracking", () => {
    for (const src of [sprSrc, hqsrSrc, viewerSrc, detailSrc]) {
      expect(src).not.toMatch(/uppercase tracking/);
    }
  });

  it("no backend imports or fetch mutations added to the audit-only components", () => {
    // Viewer/detail components remain presentational (no direct fetch calls)
    expect(viewerSrc).not.toContain("fetch(");
  });
});
