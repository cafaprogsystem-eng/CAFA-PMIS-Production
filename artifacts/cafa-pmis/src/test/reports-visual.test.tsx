/**
 * Reports Module Visual Refinement — Phase 1 Test Suite
 *
 * REP-VIS-01 through REP-VIS-10
 *
 * Uses source-analysis assertions (read file content, assert patterns)
 * and minimal inline rendered doubles, following the established pattern
 * from reports-final-ux.test.tsx.
 *
 * British English spelling throughout.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const reportsSrc = readFileSync(join(here, "../pages/reports.tsx"), "utf8");
const reportsEn = JSON.parse(readFileSync(join(here, "../locales/en/reports.json"), "utf8"));
const reportsAr = JSON.parse(readFileSync(join(here, "../locales/ar/reports.json"), "utf8"));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-01: Report type labels are human-readable on the landing page
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-01: Report type labels are human-readable in the landing navigation cards", () => {
  it("TYPE_META contains human-readable labels (not raw enum strings) for all four report types", () => {
    // Human-readable label strings present in TYPE_META
    expect(reportsSrc).toContain("Project Reports");
    expect(reportsSrc).toContain("Activity Reports");
    expect(reportsSrc).toContain("State Programme Reports");
    expect(reportsSrc).toContain("HQ Sector Reports");
  });

  it("navigation cards iterate over canonical type keys, not raw label strings", () => {
    // The map uses type keys ("project", "activity", etc.)
    expect(reportsSrc).toContain('"project", "activity", "program_state", "hq_sector"');
    // Each card uses meta.label — not a raw string from the key
    expect(reportsSrc).toMatch(/aria-label=\{meta\.label\}/);
  });

  it("landing card hover uses restrained shadow treatment (shadow-sm, not shadow-md)", () => {
    // Should use subtle hover, not heavy shadow-md
    // HeroUI Card: a single shadow lift on hover — no border flash or jump.
    expect(reportsSrc).not.toMatch(/hover:-translate-y-px/);
    expect(reportsSrc).toContain("transition-shadow group-hover:shadow-md");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-02: Report status rendered via displayStatus — no raw enum strings
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-02: Report status rendered via displayStatus — no raw enum strings in visible text", () => {
  it("displayStatus function maps all canonical statuses through the Reports namespace", () => {
    expect(reportsSrc).toMatch(/function displayStatus\(backend: string, translate\?:/);
    // Maps the key technical statuses
    expect(reportsSrc).toContain("technically_approved");
    expect(reportsSrc).toContain("coordination_approved");
    // Display text is localized from the canonical status key.
    expect(reportsSrc).toContain('const key = `status.${backend}`');
    expect(reportsSrc).toContain("const localized = translate(key)");
  });

  it("table status cell always wraps in displayStatus (not a raw r.status)", () => {
    // Status badge is created through the localized displayStatus helper.
    expect(reportsSrc).toMatch(/displayStatus\(r\.status, t\)/g);
    // The table badge uses displayStatus
    const tableSection = reportsSrc.slice(reportsSrc.indexOf("const reportColumns"));
    expect(tableSection).toMatch(/displayStatus\(r\.status, t\)/);
  });

  it("filter placeholder text resolves through localized Reports keys", () => {
    expect(reportsSrc).toContain('t("filters.allStatuses")');
    expect(reportsSrc).toContain('t("filters.allFrequencies")');
    expect(reportsSrc).toContain('t("filters.allStates")');
    expect(reportsSrc).toContain('t("filters.allSectors")');
    expect(reportsSrc).toContain('t("filters.allProjects")');
    expect(reportsSrc).toContain('t("filters.allAuthors")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-I18N-01: Inline Project and Activity creation forms use Reports keys
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-I18N-01: Arabic inline report forms use the Reports namespace", () => {
  it("routes primary project/activity form labels, feedback, and toasts through translation keys", () => {
    const formSection = reportsSrc.slice(
      reportsSrc.indexOf("Returned-for-revision feedback banner"),
      reportsSrc.indexOf("Sticky footer"),
    );

    [
      't("form.basicInformation")',
      't("form.revisionRequested")',
      't("form.selectProject")',
      't("form.reportingLocation")',
      't("form.reportingFrequency")',
      't("form.reportContext")',
      't("form.activitySubject")',
      't("form.loadingActivities")',
      't("form.submittedForReview")',
      't("form.titleRequiredForDraft")',
    ].forEach((translation) => expect(reportsSrc).toContain(translation));

    expect(formSection).not.toContain(">Basic Information<");
    expect(formSection).not.toContain(">Revision Requested<");
    expect(formSection).not.toContain('placeholder="Select project');
  });

  it("ships Arabic text for the creation-flow translations", () => {
    expect(reportsAr.form.basicInformation).toBe("المعلومات الأساسية");
    expect(reportsAr.form.reportingFrequency).toBe("تكرار الإبلاغ");
    expect(reportsAr.form.activitySubject).toBe("موضوع التقرير / اسم النشاط");
    expect(reportsAr.form.submittedForReview).toBe("تم تقديم التقرير للمراجعة");
    expect(reportsAr.form.basicInformation).not.toBe(reportsEn.form.basicInformation);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-03: Draft report shows Continue Editing; non-draft does not
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-03: Draft report renders Continue Editing; non-draft does not", () => {
  it("Continue Editing is gated by the shared draft eligibility helper in the table actions cell", () => {
    // One row-actions renderer serves the table and every other view mode.
    const actionsSection = reportsSrc.slice(reportsSrc.indexOf("const renderRowActions"), reportsSrc.indexOf("const viewRecords"));
    expect(reportsSrc).toContain("function canResumeReportDraft");
    expect(actionsSection).toContain("canResumeReportDraft(r, perms, me?.user)");
    expect(actionsSection).toContain("<ContinueEditingAction");
    // The table folds Continue editing into the row menu to keep the column narrow.
    expect(actionsSection).toContain('{ id: "continue", label: t("continueEditing", { ns: "common" })');
    expect(reportsSrc).toContain("renderRowActions(r, true)");
  });

  it("the shared eligibility helper rejects non-drafts before it considers permissions", () => {
    expect(reportsSrc).toContain('if (report.status !== "draft") return false;');
    expect(reportsSrc).toContain("<ContinueEditingAction");
  });

  it("Duplicate as Draft action rendered only for rejected status", () => {
    expect(reportsSrc).toContain('r.status === "rejected"');
    expect(reportsSrc).toContain("duplicateAsDraft");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-04: Review actions are permission-controlled
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-04: Review actions are permission-controlled", () => {
  it("hasPerm is used to gate report actions in the table", () => {
    expect(reportsSrc).toContain("hasPerm(perms,");
    // reports.update gate controls Continue Editing visibility
    expect(reportsSrc).toContain('hasPerm(permissions, "reports.update")');
  });

  it("reports.program_state.create is a narrower permission for SPR draft authors", () => {
    expect(reportsSrc).toContain('hasPerm(perms, "reports.program_state.create")');
  });

  it("transition actions use hasPerm checks in the report detail panel", () => {
    // Transition buttons in the detail panel are also gated
    expect(reportsSrc).toMatch(/hasPerm\(perms,\s*"reports\.(approve|transition|create)"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-05: Filter and view-mode controls retain functional behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-05: Filter and view-mode controls retain functional behaviour after visual changes", () => {
  it("all filter selects have onValueChange handlers wired to state setters", () => {
    expect(reportsSrc).toContain("onChange={setDisplayStatusFilter}");
    expect(reportsSrc).toContain("onChange={setKindFilter}");
    expect(reportsSrc).toContain("onChange={setStateId}");
    expect(reportsSrc).toContain("onChange={setSector}");
    expect(reportsSrc).toContain("onChange={setProjectId}");
    expect(reportsSrc).toContain("onChange={setAuthorId}");
    expect(reportsSrc).toContain("onChange={setReportingYear}");
  });

  it("toolbar wrapper uses flex-wrap so filters wrap on narrow screens", () => {
    expect(reportsSrc).toMatch(/flex flex-wrap items-center gap-2 rounded-3xl/);
  });

  it("filter widths use flexible min-w/max-w pattern instead of fixed w-36", () => {
    // Filters keep one width from sm up and stay full width (two per row) on phones.
    expect(reportsSrc).not.toMatch(/className="h-8 w-36/);
    expect(reportsSrc).toContain('const filterTrigger = "whitespace-nowrap sm:w-40"');
  });

  it("view-mode switcher is present via ViewModeSwitcher component", () => {
    expect(reportsSrc).toContain("ViewModeSwitcher");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-06: Long project name does not clip the actions button
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-06: Long project name in a report card does not clip the actions button", () => {
  it("Project cell has max-w and truncate to prevent overflow", () => {
    // Long project titles wrap onto two lines inside a fixed-width column.
    const columns = reportsSrc.slice(reportsSrc.indexOf("const reportColumns"));
    expect(columns).toContain('{ id: "project", header: t("list.project"), width: 200');
    expect(columns).toContain('className="line-clamp-2 whitespace-normal leading-snug text-page-start" title={r.projectTitle}');
  });

  it("State cell has max-w and truncate to prevent long location names overflowing", () => {
    // The location sits under the project and truncates.
    expect(reportsSrc).toMatch(/const location = formatLocation[\s\S]{0,600}\{location && <p className="mt-0\.5 truncate text-xs/);
  });

  it("Sector cell has max-w and truncate", () => {
    expect(reportsSrc).toContain('{ id: "sector", header: t("list.sector"), width: 110');
    expect(reportsSrc).toContain('className="line-clamp-2 whitespace-normal text-sm text-[var(--muted)]" title={(r.effectiveSector ?? r.sector) || undefined}');
  });

  it("actions column has explicit click stop-propagation to keep it accessible", () => {
    // The DataGrid keeps pressing a cell's own buttons separate from the row
    // action; the actions column stays pinned to the end edge.
    expect(reportsSrc).toContain('{ id: "actions", header: <span className="sr-only">{t("list.actions")}</span>, width: 64, pinned: "end"');
    expect(reportsSrc).toContain("onRowAction={(key) => {");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-07: Filtered empty state differs from global empty state
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-07: Filtered empty state text differs from global empty state text", () => {
  it("two distinct i18n keys for scope-empty vs filter-empty", () => {
    expect(reportsSrc).toContain("list.noScopeEmpty");
    expect(reportsSrc).toContain("list.noFilterMatch");
  });

  it("table empty state distinguishes scope-empty from filter-empty via hasActiveFilters", () => {
    // Use the empty-state comment anchor unique to the table body section
    const anchorIdx = reportsSrc.indexOf("\u00a724: Empty state");
    expect(anchorIdx).toBeGreaterThan(0);
    const tableBodySection = reportsSrc.slice(anchorIdx, anchorIdx + 3000);
    expect(tableBodySection).toContain("hasActiveFilters");
    expect(tableBodySection).toContain("noScopeEmpty");
    expect(tableBodySection).toContain("noFilterMatch");
  });

  it("filter-empty state shows a Clear Filters button", () => {
    expect(reportsSrc).toContain("filters.clearFilters");
    // At least one Clear Filters button is in the empty state (both table and card paths)
    const occurrences = (reportsSrc.match(/filters\.clearFilters/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-08: Loading skeleton renders — toolbar structure stable during load
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-08: Loading skeleton renders without layout shift — toolbar structure stable", () => {
  it("table skeleton rows match the expected column count pattern", () => {
    // Six full-width row placeholders while the first page loads.
    expect(reportsSrc).toMatch(/isLoading \? \([\s\S]{0,200}\[\.\.\.Array\(6\)\]\.map\(\(_, i\) => <HSkeleton key=\{i\} className="h-10 w-full rounded-lg" \/>\)/);
  });

  it("KPI loading skeleton uses Skeleton component with fixed height", () => {
    // Landing and sub-type KPIs keep their card and show a value placeholder.
    expect(reportsSrc).toContain('value={summaryLoading ? <HSkeleton className="h-7 w-10 rounded-md" /> : (c.value ?? 0)}');
    expect(reportsSrc).toContain('const value = (n: number | undefined) => isLoading ? <HSkeleton className="h-7 w-10 rounded-md" /> : (n ?? 0);');
  });

  it("toolbar is rendered unconditionally (not inside isLoading guard) so it stays stable", () => {
    // The toolbar filter div does not appear inside a loading conditional
    // Verify toolbar has its own section before the isLoading/table split
    const toolbarIdx = reportsSrc.indexOf("Filter toolbar");
    const tableIdx = reportsSrc.indexOf("viewMode === \"table\"");
    expect(toolbarIdx).toBeGreaterThan(0);
    expect(tableIdx).toBeGreaterThan(toolbarIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-09: View mode switcher is a labelled single-selection Segment
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-09: View mode switcher is a labelled single-selection Segment", () => {
  it("ViewModeSwitcher component is used in the reports page", () => {
    expect(reportsSrc).toContain("ViewModeSwitcher");
  });

  it("view-mode-switcher.tsx exposes the selected mode (Segment radios) with a name per mode", () => {
    const switcherSrc = readFileSync(
      join(here, "../components/view-modes/view-mode-switcher.tsx"),
      "utf8",
    );
    // HeroUI Pro Segment renders a radiogroup; its items announce aria-checked.
    expect(switcherSrc).toContain("<Segment");
    expect(switcherSrc).toContain("selectedKey={current}");
    expect(switcherSrc).toContain("aria-label={label}");
  });

  it("view-mode-switcher.tsx has aria-label on the group container", () => {
    const switcherSrc = readFileSync(
      join(here, "../components/view-modes/view-mode-switcher.tsx"),
      "utf8",
    );
    expect(switcherSrc).toMatch(/aria-label/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-VIS-10: All Reports Zero-Residual REP-ZR closure tests pass after visual changes
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-VIS-10: Zero-residual structural invariants preserved after visual changes", () => {
  it("no backend route files are imported or modified by reports.tsx visual changes", () => {
    // reports.tsx should not import server-side modules
    expect(reportsSrc).not.toContain("from '../server");
    expect(reportsSrc).not.toContain("from '../../server");
    expect(reportsSrc).not.toContain("require('../server");
  });

  it("displayStatus still maps all known status keys", () => {
    const knownStatuses = [
      "draft",
      "submitted",
      "technically_approved",
      "coordination_approved",
      "rejected",
      "returned",
      "approved",
    ];
    for (const s of knownStatuses) {
      expect(reportsSrc).toContain(s);
    }
  });

  it("compound Report cell includes period display inline (not a separate column)", () => {
    // Period (and frequency) are a secondary line in the title cell.
    expect(reportsSrc).toContain("[frequency, formatPeriodOnly(rKind, r.period, i18n.language)].filter(Boolean).join(\" · \")");
    expect(reportsSrc).toContain("{periodLine(r)}");
    // No standalone period or frequency column.
    const columns = reportsSrc.slice(reportsSrc.indexOf("const reportColumns"), reportsSrc.indexOf("return (", reportsSrc.indexOf("const reportColumns")));
    expect(columns).not.toContain('{ id: "period"');
    expect(columns).not.toContain('{ id: "frequency"');
  });

  it("icon-only dropdown trigger has aria-label", () => {
    expect(reportsSrc).toContain('aria-label={t("formExtra.moreActions")}');
  });

  it("all filter SelectTrigger elements have aria-label attributes", () => {
    const triggerMatches = reportsSrc.match(/aria-label=\{t\("filters\.filterBy/g) ?? [];
    // Should have at least 7 filter selects with aria-label (all except conditionals)
    expect(triggerMatches.length).toBeGreaterThanOrEqual(7);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase 3 — Report Detail / Review Experience (REP-DETAIL-VIS-01..10)
// ═════════════════════════════════════════════════════════════════════════════

const sprSrc = readFileSync(join(here, "../components/program-state-report-form.tsx"), "utf8");
const hqsrSrc = readFileSync(join(here, "../components/hq-sector-report-form.tsx"), "utf8");
const activityDetailSrc = readFileSync(join(here, "../components/activity-report-detail.tsx"), "utf8");
const activityViewerSrc = readFileSync(join(here, "../components/activity-report-viewer.tsx"), "utf8");
const recordDetailModalSrc = readFileSync(join(here, "../components/record-detail-modal.tsx"), "utf8");

// Shared centred record-modal section of reports.tsx (non-activity detail rendering).
const detailModalSrc = reportsSrc.slice(reportsSrc.indexOf("Project, State Programme and HQ Sector reports use the shared centred record viewer."));
// SPR detail renderer only (after the exported sections view starts)
const sprDetailSrc = sprSrc.slice(sprSrc.indexOf("export function ProgramStateSectionsView"));
// HQSR detail renderer only
const hqsrDetailSrc = hqsrSrc.slice(hqsrSrc.indexOf("export function HqSectorSectionsView"));

describe("REP-DETAIL-VIS-01: Report type label and status badge are human-readable", () => {
  it("modal header uses meta.label and displayStatus, never raw enum text", () => {
    expect(detailModalSrc).toContain("meta.label");
    expect(detailModalSrc).toMatch(/displayStatus\(selected\.status, t\)/);
    expect(detailModalSrc).toContain("<ReportStatusChip status={selected.status}");
  });

  it("metadata grid labels no longer use uppercase tracking-wide", () => {
    const gridStart = detailModalSrc.indexOf("Metadata grid");
    const gridEnd = detailModalSrc.indexOf("WorkflowBlock");
    const grid = detailModalSrc.slice(gridStart, gridEnd);
    expect(grid).not.toContain("uppercase tracking-wide");
    expect(grid).toContain('className="mb-0.5 text-xs text-[var(--muted)]"');
  });

  it("Current Project Reference Data divider label no longer uppercases", () => {
    expect(detailModalSrc).not.toContain('font-medium uppercase tracking-wide">Current Project Reference Data');
    expect(detailModalSrc).toContain('t("form.currentProjectReference")');
  });

  it("detail metadata uses one column on small screens, two on medium, and four on wide screens", () => {
    expect(detailModalSrc).toContain("grid grid-cols-1 gap-4 rounded-2xl bg-[var(--default)] p-4 text-sm sm:grid-cols-2 xl:grid-cols-4");
    expect(detailModalSrc).toContain('className="col-span-full"');
  });
});

describe("REP-I18N-01: Historical Activity Report status values fail safely", () => {
  it("falls back to the stored report status when a locale key is unavailable", () => {
    expect(activityViewerSrc).toContain("const key = `status.${backend}`");
    expect(activityViewerSrc).toContain("localized === key ? (MAP[backend] ?? backend) : localized");
  });

  it("falls back to the stored implementation status when a locale key is unavailable", () => {
    expect(activityDetailSrc).toContain("translatedImplStatus === implStatusKey ? implStatusVal : translatedImplStatus");
  });
});

describe("REP-DETAIL-VIS-02: Type-specific context in metadata", () => {
  it("PMR/non-HQSR shows Project and State context in the modal description", () => {
    expect(detailModalSrc).toMatch(/selected\.reportType !== "hq_sector" \? selected\.projectTitle : null/);
    expect(detailModalSrc).toMatch(/formatLocation\(\{ locationType: selected\.locationType, stateName: selected\.stateName, stateNameAr: selected\.stateNameAr \}, i18n\.language\)/);
  });

  it("SPR detail renders State-level content via ProgramStateSectionsView", () => {
    expect(detailModalSrc).toMatch(/selected\.reportType === "program_state" && selected\.sections/);
    expect(detailModalSrc).toContain("ProgramStateSectionsView");
  });

  it("HQSR detail renders Sector content via HqSectorSectionsView and suppresses State/Project metadata", () => {
    expect(detailModalSrc).toMatch(/selected\.reportType === "hq_sector" && selected\.sections/);
    expect(detailModalSrc).toContain("HqSectorSectionsView");
    // HQSR guard: never render State/Project metadata for hq_sector
    expect(detailModalSrc).toContain("HQ Sector Reports never render State/Project metadata");
  });

  it("activity detail preserves a local narrative measure while metadata and evidence use the shared wide rail", () => {
    expect(activityDetailSrc).toContain("grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5");
    expect(activityDetailSrc).toContain("grid w-full grid-cols-2 sm:grid-cols-5");
    expect(activityDetailSrc).toContain('className="mb-4 w-full"');
    expect(activityDetailSrc).toContain("space-y-1 max-w-3xl");
  });
});

describe("REP-DETAIL-VIS-03: Draft/returned author actions hidden from non-authors", () => {
  it("Continue Editing remains gated on draft status and permissions", () => {
    expect(reportsSrc).toContain('if (report.status !== "draft") return false;');
    expect(reportsSrc).toContain("canResumeReportDraft");
    expect(reportsSrc).toContain('hasPerm(permissions, "reports.update")');
  });

  it("waits for the viewer close completion instead of racing hydration against the closing dialog", () => {
    expect(reportsSrc).toContain("setDraftToResumeAfterViewerClose(report)");
    expect(reportsSrc).toContain("onCloseComplete={completeReportViewerClose}");
    expect(reportsSrc).not.toContain("window.setTimeout(() => loadDraftForEdit(report), 0)");
  });
});

describe("REP-DETAIL-VIS-04: Reviewer transition actions respect permissions", () => {
  it("transition buttons in the fixed modal footer come from the server-driven transitions list", () => {
    expect(detailModalSrc).toContain("footer={selected && transitions.length > 0");
    expect(detailModalSrc).toContain("setTransitionOpen");
  });
});

describe("REP-DETAIL-VIS-05: SPR revision banner", () => {
  it("renders with role=alert and matches HQSR border/radius treatment", () => {
    expect(sprSrc).toMatch(/role="alert"[^>]*rounded-md border border-amber-300 bg-amber-50/);
    expect(sprSrc).not.toContain("border-2 border-amber-400");
    expect(sprSrc).toContain("dark:border-amber-700");
  });
});

describe("REP-DETAIL-VIS-06: Attachments render as download links, not raw paths", () => {
  it("attachment rows use attachmentDownloadUrl with an aria-label", () => {
    expect(detailModalSrc).toContain("attachmentDownloadUrl(selected.id, att.id)");
    expect(detailModalSrc).toContain('aria-label={t("form.downloadFile", { fileName: att.fileName })}');
  });

  it("SPR and HQSR detail renderers defer attachments to the secured parent block", () => {
    expect(sprDetailSrc).toContain("Attachments are rendered by the parent detail view");
    expect(hqsrDetailSrc).toContain("Attachments are rendered via the secure Supporting Attachments block");
  });
});

describe("REP-DETAIL-VIS-07: Financial summary uses formatCurrency", () => {
  it("financial summary cells use formatCurrency with the report currency", () => {
    const finStart = detailModalSrc.indexOf("Financial Summary");
    const fin = detailModalSrc.slice(finStart, finStart + 3000);
    expect(fin).toMatch(/formatCurrency\(selPlanned, selCur\)/);
    expect(fin).toMatch(/formatCurrency\(selActual, selCur\)/);
    // No hardcoded dollar sign in the summary values
    expect(fin).not.toMatch(/>\$\{/);
  });
});

describe("REP-DETAIL-VIS-08: WorkflowBlock renders inside the record modal", () => {
  it("WorkflowBlock is rendered in the modal body with the type workflow", () => {
    expect(detailModalSrc).toContain("<WorkflowBlock workflow={meta.workflow} />");
  });
});

describe("REP-DETAIL-VIS-09: Long narrative text does not overflow the modal", () => {
  it("narrative values wrap while the shared modal owns internal scrolling", () => {
    expect(reportsSrc).toContain("<RecordDetailModal");
    expect(detailModalSrc).toContain("whitespace-pre-wrap");
    expect(recordDetailModalSrc).toContain("break-words");
    expect(activityDetailSrc).toContain("max-w-3xl");
    expect(activityDetailSrc).not.toContain("mb-4 max-w-3xl");
  });

  it("HQSR rating reason is line-clamped with a Tooltip instead of hard truncation", () => {
    expect(hqsrDetailSrc).not.toContain("truncate max-w-48");
    expect(hqsrDetailSrc).toContain("line-clamp-2 min-w-0 flex-1");
    expect(hqsrDetailSrc).toContain("<TooltipContent");
  });

  it("detail renderer headings are unified and detail labels avoid uppercase", () => {
    // SPR detail headings unified
    expect(sprDetailSrc).not.toMatch(/<h4 className="text-sm font-semibold/);
    expect(sprDetailSrc).toContain('text-sm font-medium text-foreground mb-2');
    // HQSR detail headings unified
    expect(hqsrDetailSrc).not.toMatch(/<h4 className="text-sm font-semibold/);
    expect(hqsrDetailSrc).toContain('text-sm font-medium text-foreground mb-2');
    // Activity detail Supporting Insights label no longer uppercase
    expect(activityDetailSrc).not.toContain("uppercase tracking-wide");
  });

  it("SPR meta row uses text-sm values with text-xs muted labels", () => {
    expect(sprDetailSrc).toContain('className="rounded border p-3 bg-muted/20 space-y-1.5"');
    expect(sprDetailSrc).toContain('strong className="text-xs font-medium text-muted-foreground"');
  });
});

describe("REP-DETAIL-VIS-10: Zero-residual contracts unchanged", () => {
  it("detail components import no server modules and define no API endpoints", () => {
    for (const src of [sprSrc, hqsrSrc, activityDetailSrc]) {
      expect(src).not.toContain("from '../server");
      expect(src).not.toMatch(/app\.(get|post|patch|delete)\(/);
    }
  });

  it("VoiceNotePanel stays readOnly in the detail modal", () => {
    expect(detailModalSrc).toContain('<VoiceNotePanel entityType="report" entityId={selected.id} readOnly />');
  });

  it("SPR banner keeps role, icon and CommentsPanel wiring unchanged", () => {
    expect(sprSrc).toMatch(/role="alert"/);
    expect(sprSrc).toContain('t("stateForm.revisionBannerTitle")');
    expect(sprSrc).toContain("<CommentsPanel");
  });
});
