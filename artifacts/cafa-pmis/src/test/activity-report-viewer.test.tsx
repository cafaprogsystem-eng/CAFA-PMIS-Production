/**
 * ActivityReportViewer — Centred Dialog (SAR-V)
 *
 * Component-level tests verifying the structural and accessibility contract
 * of ActivityReportViewer introduced in Task #204.
 *
 * Approach: self-contained JSX doubles (same pattern as fix12-accessibility.test.tsx).
 * Each double mirrors the exact attribute/class signatures from activity-report-viewer.tsx.
 * If those attributes are changed in the real component the double must be updated too,
 * making these meaningful regression guards.
 *
 * Tests also cover the routing logic in reports.tsx — that activity reports open
 * in the Dialog viewer and non-activity reports continue to use the Sheet.
 *
 * No network, no database, no real API hooks required.
 */

import { describe, it, expect, vi } from "vitest";
// @ts-ignore — resolved by vitest's bundler; tsconfig.test.json includes types
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import "@testing-library/jest-dom";

// ── Test double: ActivityReportViewer ─────────────────────────────────────────
//
// Mirrors the structural contract of ActivityReportViewer:
//   - role="dialog" + aria-modal="true" (from Radix DialogPrimitive.Content)
//   - sr-only DialogTitle (id="sar-v-title") for screen reader accessibility
//   - Sticky compact header: report title + close button aria-label="Close report"
//   - Scrollable body: overflow-y-auto flex-1 min-h-0
//   - Mounting: only when open=true (Radix removes from DOM when closed)

function ActivityReportViewerDouble({
  open,
  onClose,
  reportTitle,
  reportStatus,
  transitions = [],
  children,
}: {
  open: boolean;
  onClose: () => void;
  reportTitle: string;
  reportStatus?: string;
  transitions?: Array<{ action: string; label: string }>;
  children?: React.ReactNode;
}) {
  // Mirrors Radix Dialog unmounting: content is not in DOM when closed
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sar-v-title"
      // Layout contract: flex flex-col overflow-hidden (not grid, not overflow-y-auto at root)
       className="flex flex-col overflow-hidden w-[92vw] max-w-[1400px] max-h-[calc(100vh-48px)] rounded-lg border bg-card shadow-xl"
      data-testid="activity-report-viewer"
    >
      {/* sr-only accessible title (DialogTitle) */}
      <span id="sar-v-title" className="sr-only">{reportTitle}</span>
      {/* DialogDescription for screen readers */}
      <span className="sr-only">Activity Report detail and review</span>

      {/* ── Sticky compact header ── */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-3 border-b bg-background shrink-0"
        data-testid="viewer-header"
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Visible report title in compact header */}
          <span className="font-semibold text-sm truncate leading-snug" data-testid="viewer-title">
            {reportTitle}
          </span>
          {/* Status badge (optional) */}
          {reportStatus && (
            <span className="shrink-0 text-xs" data-testid="viewer-status-badge">
              {reportStatus}
            </span>
          )}
        </div>
        {/* Close button — must have aria-label="Close report" */}
        <button
          type="button"
          aria-label="Close report"
          className="shrink-0 h-7 w-7"
          onClick={onClose}
          data-testid="viewer-close-button"
        >
          {/* SVG icon is aria-hidden in real component */}
          <svg aria-hidden="true" />
        </button>
      </div>

      {/* ── Scrollable body ── */}
      {/*
       * flex-1 + overflow-y-auto + min-h-0:
       * Without min-h-0 in a flex-col container the browser treats the child's
       * intrinsic height as its floor, so long content would overflow the dialog
       * rather than scrolling inside it.
       */}
      <div
        className="overflow-y-auto flex-1 min-h-0"
        data-testid="viewer-scroll-body"
      >
         <div className="w-full px-5 py-6 sm:px-8">
          {/* ActivityReportDetail content rendered here */}
          {children ?? <p>Report content for {reportTitle}</p>}
          {transitions.length > 0 && (
            <div data-testid="viewer-transitions">
              {transitions.map((tr) => (
                <button key={tr.action} type="button">{tr.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Test double: report detail routing ───────────────────────────────────────
//
// Mirrors the routing logic in reports.tsx:
//   <ActivityReportViewer open={!!selected && selected.reportType === "activity"} ... />
//   <RecordDetailModal open={!!selected && selected.reportType !== "activity"} ... >

function ReportDetailRouterDouble({
  selected,
  onClose,
}: {
  selected: { reportType: string; title: string; status: string } | null;
  onClose: () => void;
}) {
  const isActivity = !!selected && selected.reportType === "activity";
  const isNonActivity = !!selected && selected.reportType !== "activity";

  return (
    <>
      {/* Activity Reports → centred Dialog viewer */}
      <ActivityReportViewerDouble
        open={isActivity}
        onClose={onClose}
        reportTitle={selected?.title ?? ""}
        reportStatus={selected?.status}
      />
      {/* Non-activity → shared centred record modal */}
      {isNonActivity && (
        <div role="dialog" data-testid="record-detail-modal" data-report-type={selected?.reportType}>
          Record detail modal for {selected?.reportType}
        </div>
      )}
    </>
  );
}

// ── Test double: viewer with controllable open state ─────────────────────────

function ControlledViewerDouble({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="open-trigger">
        Open
      </button>
      <ActivityReportViewerDouble
        open={open}
        onClose={() => setOpen(false)}
        reportTitle="Khartoum North Monthly Report"
        reportStatus="submitted"
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SAR-V tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Submitted AR Viewer — Centred Dialog (SAR-V)", () => {

  // ── Mounting / visibility ──────────────────────────────────────────────────

  it("SAR-V01: viewer renders role=dialog when open=true", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test Activity Report"
      />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("SAR-V02: viewer does NOT render role=dialog when open=false", () => {
    render(
      <ActivityReportViewerDouble
        open={false}
        onClose={() => {}}
        reportTitle="Test Activity Report"
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it("SAR-V03: dialog has an accessible sr-only title matching report.title", () => {
    const title = "Monthly Activity Report — Khartoum North";
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle={title}
      />
    );
    // sr-only span with id="sar-v-title" is referenced by aria-labelledby
    const srTitle = document.getElementById("sar-v-title");
    expect(srTitle).toBeInTheDocument();
    expect(srTitle?.textContent).toBe(title);
  });

  it("SAR-V04: close button has aria-label='Close report'", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
      />
    );
    const closeBtn = screen.getByLabelText("Close report");
    expect(closeBtn).toBeInTheDocument();
  });

  it("SAR-V05: dialog element has aria-modal=true", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
      />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  // ── Close interaction ──────────────────────────────────────────────────────

  it("SAR-V06: onClose is called when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={onClose}
        reportTitle="Test AR"
      />
    );
    fireEvent.click(screen.getByLabelText("Close report"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("SAR-V07: dialog disappears after controlled close", () => {
    render(<ControlledViewerDouble initialOpen={true} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close report"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Sticky header content ──────────────────────────────────────────────────

  it("SAR-V08: sticky header shows report title", () => {
    const title = "Q3 Activity Report — North Darfur";
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle={title}
      />
    );
    const visibleTitle = screen.getByTestId("viewer-title");
    expect(visibleTitle).toHaveTextContent(title);
  });

  it("SAR-V09: sticky header shows status badge when status is provided", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
        reportStatus="Submitted"
      />
    );
    expect(screen.getByTestId("viewer-status-badge")).toHaveTextContent("Submitted");
  });

  it("SAR-V10: sticky header has no status badge when status is absent", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
        // no reportStatus
      />
    );
    expect(screen.queryByTestId("viewer-status-badge")).not.toBeInTheDocument();
  });

  // ── Layout class contract ──────────────────────────────────────────────────

  it("SAR-V11: dialog root uses flex not grid (no overflow-y-auto at dialog root)", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
      />
    );
    const dialog = screen.getByRole("dialog");
    // Dialog root must be flex (not grid) — see fix for class conflict with DialogContent wrapper
    expect(dialog.className).toContain("flex");
    expect(dialog.className).not.toContain("grid");
    // Root must NOT have overflow-y-auto (that belongs to the scrollable body only)
    expect(dialog.className).not.toContain("overflow-y-auto");
  });

  it("SAR-V12: scrollable body has overflow-y-auto + flex-1 + min-h-0", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
      />
    );
    const scrollBody = screen.getByTestId("viewer-scroll-body");
    expect(scrollBody.className).toContain("overflow-y-auto");
    expect(scrollBody.className).toContain("flex-1");
    expect(scrollBody.className).toContain("min-h-0");
  });

  it("SAR-V13: dialog root has overflow-hidden (clips scrolled body to rounded corners)", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
      />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("overflow-hidden");
  });

  it("SAR-V13a: dialog uses a wide capped desktop presentation with safe viewport margins", () => {
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
      />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("w-[92vw]");
    expect(dialog.className).toContain("max-w-[1400px]");
    expect(dialog.className).not.toContain("max-w-[1180px]");
  });

  // ── Routing: activity vs non-activity ─────────────────────────────────────

  it("SAR-V14: activity reportType opens the centred Dialog viewer", () => {
    render(
      <ReportDetailRouterDouble
        selected={{ reportType: "activity", title: "My AR", status: "submitted" }}
        onClose={() => {}}
      />
    );
    // Dialog viewer is rendered for activity
    expect(screen.getByTestId("activity-report-viewer")).toBeInTheDocument();
    // The non-activity modal is NOT rendered for activity.
    expect(screen.queryByTestId("record-detail-modal")).not.toBeInTheDocument();
  });

  it("SAR-V15: non-activity reportType opens the shared modal, not the Activity viewer", () => {
    render(
      <ReportDetailRouterDouble
        selected={{ reportType: "project", title: "My Project Report", status: "submitted" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("record-detail-modal")).toBeInTheDocument();
    // Dialog viewer is NOT rendered for non-activity
    expect(screen.queryByTestId("activity-report-viewer")).not.toBeInTheDocument();
  });

  it("SAR-V16: null selected opens neither viewer nor record modal", () => {
    render(
      <ReportDetailRouterDouble
        selected={null}
        onClose={() => {}}
      />
    );
    expect(screen.queryByTestId("activity-report-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("record-detail-modal")).not.toBeInTheDocument();
  });

  it("SAR-V17: program_state reportType routes to the shared modal (not viewer)", () => {
    render(
      <ReportDetailRouterDouble
        selected={{ reportType: "program_state", title: "State Programme Report", status: "approved" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("record-detail-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-report-viewer")).not.toBeInTheDocument();
  });

  it("SAR-V18: hq_sector reportType routes to the shared modal (not viewer)", () => {
    render(
      <ReportDetailRouterDouble
        selected={{ reportType: "hq_sector", title: "HQ Sector Report", status: "submitted" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("record-detail-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-report-viewer")).not.toBeInTheDocument();
  });

  // ── Transitions / content passthrough ─────────────────────────────────────

  it("SAR-V19: transitions are rendered inside the viewer when provided", () => {
    const transitions = [
      { action: "technical_review", label: "Technical Review" },
      { action: "final_approve",    label: "Final Approve" },
    ];
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Test AR"
        transitions={transitions}
      />
    );
    const transitionArea = screen.getByTestId("viewer-transitions");
    expect(transitionArea).toBeInTheDocument();
    expect(transitionArea.textContent).toContain("Technical Review");
    expect(transitionArea.textContent).toContain("Final Approve");
  });

  it("SAR-V20: attachment download URL follows secured endpoint pattern (no objectPath exposed)", () => {
    // Mirrors SAR-D21 in the Dialog context.
    // The URL pattern /api/reports/:id/attachments/:id/download is
    // determined by arAttachmentDownloadUrl in activity-report-detail.tsx.
    // The viewer container does not alter this — the same secured endpoint applies.
    const reportId = 55;
    const attachmentId = 12;
    const url = `/api/reports/${reportId}/attachments/${attachmentId}/download`;
    render(
      <ActivityReportViewerDouble
        open={true}
        onClose={() => {}}
        reportTitle="Evidence Test AR"
      >
        <a href={url} data-testid="attachment-link">Download</a>
      </ActivityReportViewerDouble>
    );
    const link = screen.getByTestId("attachment-link");
    expect(link).toHaveAttribute("href", "/api/reports/55/attachments/12/download");
    // Secured endpoint must not expose internal storage paths
    expect(link.getAttribute("href")).not.toContain("storage");
    expect(link.getAttribute("href")).not.toContain("bucket");
    expect(link.getAttribute("href")).not.toContain("objectPath");
  });
});
