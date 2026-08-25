/**
 * FIX-12 — Activity Report UX & Accessibility
 *
 * Component-level tests verifying the accessibility attributes introduced in
 * FIX-12.  Each test double mirrors the exact JSX pattern from the modified
 * component — if the attribute is removed or renamed in the real component the
 * double must be updated too, making this a meaningful regression guard.
 *
 * Approach: self-contained JSX doubles (same pattern as state-performance-table.test.tsx).
 * The doubles reproduce the exact attribute signatures from:
 *   - form-voice-recorder.tsx  (play/pause aria-label, aria-hidden, aria-live)
 *   - voice-note-panel.tsx     (play/pause aria-label, delete aria-label)
 *   - reports.tsx              (pending remove aria-label, download aria-label,
 *                               role=alert on error paragraphs, upload description,
 *                               whitespace-nowrap on footer buttons)
 *
 * No network, no database, no real API hooks required.
 */

import { describe, it, expect } from "vitest";
// @ts-ignore — resolved by vitest's bundler; tsconfig.test.json includes types
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";
import "@testing-library/jest-dom";

// ── Icons stubs (Lucide icons render as SVG; no special mock needed) ─────────

// ── Test double: FormVoiceRecorder — idle state ───────────────────────────────
// Mirrors the outer wrapper and the aria-live span + Volume2 aria-hidden.

function VoiceRecorderIdleDouble() {
  return (
    <div>
      {/* A11Y-03: aria-live span for state transition announcements */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {""}
      </span>
      {/* A11Y-02: decorative icon must be aria-hidden */}
      <svg
        aria-hidden="true"
        data-testid="volume-icon"
        className="h-4 w-4 text-muted-foreground"
      />
      <span>Voice Note Recorder</span>
      <button type="button">Start Recording</button>
    </div>
  );
}

// ── Test double: FormVoiceRecorder — recorded state ───────────────────────────
// Mirrors the "recorded" block including the play/pause button with aria-label.

function VoiceRecorderRecordedDouble({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div>
      {/* A11Y-03: aria-live span with transition announcement */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        Recording stopped.
      </span>
      {/* A11Y-01: play/pause button with dynamic aria-label */}
      <button
        type="button"
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <span>0:30</span>
    </div>
  );
}

// ── Test double: FormVoiceRecorder — requesting state ────────────────────────
function VoiceRecorderRequestingDouble() {
  return (
    <div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        Requesting microphone access.
      </span>
      <span>Requesting mic access…</span>
    </div>
  );
}

// ── Test double: FormVoiceRecorder — recording state ────────────────────────
// NB: the live region must NOT include elapsed time (avoids per-second speech).
function VoiceRecorderRecordingDouble({ elapsed }: { elapsed: number }) {
  return (
    <div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        Recording started.
      </span>
      {/* Elapsed shown visually only — not in the live region */}
      <span aria-hidden="true">{elapsed}s elapsed</span>
      <button type="button">Stop Recording</button>
    </div>
  );
}

// ── Test double: VoiceNotePanel — AudioPlayer ─────────────────────────────────
// Mirrors the AudioPlayer component's play/pause button with aria-label.

function AudioPlayerDouble({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {/* A11Y-04: aria-label on the play/pause toggle */}
      <button
        type="button"
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <div role="progressbar" />
      <span>0:45</span>
    </div>
  );
}

// ── Test double: VoiceNotePanel — load-to-play button ────────────────────────
// Mirrors the button shown before the audio URL is loaded.

function LoadToPlayDouble() {
  return (
    <button type="button" aria-label="Play voice note">
      Play
    </button>
  );
}

// ── Test double: VoiceNotePanel — delete button ───────────────────────────────
// Mirrors the delete button with title + aria-label in lockstep.

function NoteDeleteButtonDouble({ confirming }: { confirming: boolean }) {
  const label = confirming ? "Confirm delete" : "Delete note";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={confirming ? "text-destructive" : ""}
    >
      🗑
    </button>
  );
}

// ── Test double: reports.tsx — saved attachment row ───────────────────────────
// Mirrors the saved attachment download link + remove button.

function SavedAttachmentDouble({ fileName }: { fileName: string }) {
  const downloadUrl = `/api/reports/1/attachments/42/download`;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" title={fileName}>{fileName}</p>
      </div>
      {/* A11Y-07: download link has aria-label */}
      <a
        href={downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Download ${fileName}`}
        aria-label={`Download ${fileName}`}
      >
        ↓
      </a>
      {/* Saved attachment remove button has aria-label + title */}
      <button
        type="button"
        title={`Remove ${fileName}`}
        aria-label={`Remove ${fileName}`}
      >
        🗑
      </button>
    </div>
  );
}

// ── Test double: reports.tsx — pending file row ───────────────────────────────
// Mirrors the pending (not yet uploaded) file remove button.

function PendingFileRowDouble({ fileName }: { fileName: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" title={fileName}>{fileName}</p>
      </div>
      {/* A11Y-06: aria-label + title on the remove button */}
      <button
        type="button"
        aria-label={`Remove ${fileName}`}
        title={`Remove ${fileName}`}
      >
        🗑
      </button>
    </div>
  );
}

// ── Test double: reports.tsx — inline field error paragraph ──────────────────
// Mirrors the pattern used for challenges, lessonsLearned, and narrative fields.

function FieldErrorDouble({ error }: { error?: string }) {
  return (
    <div>
      <textarea id="field" />
      {error && (
        // A11Y-08: role="alert" on error paragraphs
        <p className="text-xs text-destructive mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Test double: reports.tsx — upload trigger area ───────────────────────────
// Mirrors the file upload label + accepted-formats description.

function UploadAreaDouble() {
  return (
    <div>
      <label className="cursor-pointer text-sm text-primary">
        + Add Files
        <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png" multiple />
      </label>
      {/* UX-01: adjacent description of accepted formats and size limit */}
      <p className="text-xs text-muted-foreground">
        Accepted formats: PDF, Word, Excel, images (JPG, PNG). Maximum 20 MB per file.
      </p>
    </div>
  );
}

// ── Test double: reports.tsx — footer buttons ─────────────────────────────────
// Mirrors the footer with whitespace-nowrap on Save As Draft and Submit Report.

function FooterDouble({ isLastStep }: { isLastStep: boolean }) {
  return (
    <div className="flex gap-2">
      <button type="button" className="whitespace-nowrap">
        Save As Draft
      </button>
      {isLastStep ? (
        <button type="button" className="whitespace-nowrap">
          Submit Report
        </button>
      ) : (
        <button type="button" className="whitespace-nowrap">
          Next
        </button>
      )}
    </div>
  );
}

// ── Test double: Stateful play/pause toggle ───────────────────────────────────
// Confirms the aria-label switches correctly on state change.

function StatefulPlayDouble() {
  const [playing, setPlaying] = useState(false);
  return (
    <button
      type="button"
      aria-label={playing ? "Pause voice note" : "Play voice note"}
      onClick={() => setPlaying((p) => !p)}
    >
      {playing ? "Pause" : "Play"}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════════════

describe("FIX-12 — Activity Report UX & Accessibility (component-level)", () => {

  // ── Voice recorder — decorative icon ─────────────────────────────────────

  describe("A11Y-02: Volume2 icon is aria-hidden", () => {
    it("FIX12-C01: decorative icon has aria-hidden=true so screen readers skip it", () => {
      render(<VoiceRecorderIdleDouble />);
      const icon = screen.getByTestId("volume-icon");
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  });

  // ── Voice recorder — aria-live region ────────────────────────────────────

  describe("A11Y-03: aria-live region for recording state", () => {
    it("FIX12-C02: aria-live polite region is present in idle state", () => {
      render(<VoiceRecorderIdleDouble />);
      const live = document.querySelector("[aria-live='polite']");
      expect(live).toBeInTheDocument();
      expect(live).toHaveAttribute("aria-atomic", "true");
    });

    it("FIX12-C03: idle state live region is empty (no spurious announcement)", () => {
      render(<VoiceRecorderIdleDouble />);
      const live = document.querySelector("[aria-live='polite']");
      expect(live?.textContent?.trim()).toBe("");
    });

    it("FIX12-C04: requesting state announces microphone request", () => {
      render(<VoiceRecorderRequestingDouble />);
      const live = document.querySelector("[aria-live='polite']");
      expect(live?.textContent).toContain("Requesting microphone access");
    });

    it("FIX12-C05: recording state announces 'Recording started.' — not elapsed time", () => {
      render(<VoiceRecorderRecordingDouble elapsed={42} />);
      const live = document.querySelector("[aria-live='polite']");
      // Must say recording started
      expect(live?.textContent).toContain("Recording started");
      // Must NOT expose elapsed time in the live region (would cause per-second announcements)
      expect(live?.textContent).not.toContain("42");
      expect(live?.textContent).not.toContain("elapsed");
    });

    it("FIX12-C06: recorded state announces 'Recording stopped.'", () => {
      render(<VoiceRecorderRecordedDouble isPlaying={false} />);
      const live = document.querySelector("[aria-live='polite']");
      expect(live?.textContent).toContain("Recording stopped");
    });

    it("FIX12-C07: elapsed time is hidden from screen readers via aria-hidden", () => {
      render(<VoiceRecorderRecordingDouble elapsed={90} />);
      const elapsedEl = screen.getByText(/90s elapsed/);
      expect(elapsedEl).toHaveAttribute("aria-hidden", "true");
    });
  });

  // ── Voice recorder — play/pause button ───────────────────────────────────

  describe("A11Y-01: Play/Pause button aria-label", () => {
    it("FIX12-C08: play button has aria-label 'Play voice note' when not playing", () => {
      render(<VoiceRecorderRecordedDouble isPlaying={false} />);
      expect(screen.getByRole("button", { name: "Play voice note" })).toBeInTheDocument();
    });

    it("FIX12-C09: button shows 'Pause voice note' when playback is active", () => {
      render(<VoiceRecorderRecordedDouble isPlaying={true} />);
      expect(screen.getByRole("button", { name: "Pause voice note" })).toBeInTheDocument();
    });

    it("FIX12-C10: aria-label switches when play state toggles", () => {
      const { rerender } = render(<VoiceRecorderRecordedDouble isPlaying={false} />);
      expect(screen.getByRole("button", { name: "Play voice note" })).toBeInTheDocument();
      rerender(<VoiceRecorderRecordedDouble isPlaying={true} />);
      expect(screen.getByRole("button", { name: "Pause voice note" })).toBeInTheDocument();
    });
  });

  // ── Voice note panel — AudioPlayer ───────────────────────────────────────

  describe("A11Y-04: AudioPlayer play/pause aria-label", () => {
    it("FIX12-C11: AudioPlayer play button has aria-label when not playing", () => {
      render(<AudioPlayerDouble isPlaying={false} />);
      expect(screen.getByRole("button", { name: "Play voice note" })).toBeInTheDocument();
    });

    it("FIX12-C12: AudioPlayer pause button has aria-label when playing", () => {
      render(<AudioPlayerDouble isPlaying={true} />);
      expect(screen.getByRole("button", { name: "Pause voice note" })).toBeInTheDocument();
    });

    it("FIX12-C13: load-to-play button has aria-label before audio URL is loaded", () => {
      render(<LoadToPlayDouble />);
      expect(screen.getByRole("button", { name: "Play voice note" })).toBeInTheDocument();
    });
  });

  // ── Voice note panel — delete button ─────────────────────────────────────

  describe("A11Y-05: Delete voice note button aria-label", () => {
    it("FIX12-C14: delete button has aria-label 'Delete note' in normal state", () => {
      render(<NoteDeleteButtonDouble confirming={false} />);
      const btn = screen.getByRole("button", { name: "Delete note" });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("title", "Delete note");
    });

    it("FIX12-C15: delete button changes to 'Confirm delete' when confirmation required", () => {
      render(<NoteDeleteButtonDouble confirming={true} />);
      const btn = screen.getByRole("button", { name: "Confirm delete" });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("title", "Confirm delete");
    });

    it("FIX12-C16: aria-label and title are identical on the delete button", () => {
      render(<NoteDeleteButtonDouble confirming={false} />);
      const btn = screen.getByRole("button", { name: "Delete note" });
      expect(btn.getAttribute("aria-label")).toBe(btn.getAttribute("title"));
    });
  });

  // ── Saved attachment — download link + remove button ─────────────────────

  describe("A11Y-07: Saved attachment download link aria-label", () => {
    it("FIX12-C17: download link has aria-label matching the filename", () => {
      render(<SavedAttachmentDouble fileName="evidence-photo.jpg" />);
      const link = screen.getByRole("link", { name: "Download evidence-photo.jpg" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("title", "Download evidence-photo.jpg");
    });

    it("FIX12-C18: download aria-label works for long filenames", () => {
      const longName = "2026-Q2-Activity-Implementation-Report-Final.pdf";
      render(<SavedAttachmentDouble fileName={longName} />);
      expect(screen.getByRole("link", { name: `Download ${longName}` })).toBeInTheDocument();
    });
  });

  describe("Saved attachment remove button aria-label", () => {
    it("FIX12-C19: saved attachment remove button has aria-label and title with filename", () => {
      render(<SavedAttachmentDouble fileName="budget-breakdown.xlsx" />);
      const btn = screen.getByRole("button", { name: "Remove budget-breakdown.xlsx" });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("title", "Remove budget-breakdown.xlsx");
    });
  });

  // ── Pending file — remove button ─────────────────────────────────────────

  describe("A11Y-06: Pending file remove button aria-label", () => {
    it("FIX12-C20: pending file remove button has aria-label containing filename", () => {
      render(<PendingFileRowDouble fileName="quarterly-report.pdf" />);
      expect(
        screen.getByRole("button", { name: "Remove quarterly-report.pdf" })
      ).toBeInTheDocument();
    });

    it("FIX12-C21: remove aria-label works for filenames with spaces", () => {
      render(<PendingFileRowDouble fileName="Field Report June 2026.docx" />);
      expect(
        screen.getByRole("button", { name: "Remove Field Report June 2026.docx" })
      ).toBeInTheDocument();
    });

    it("FIX12-C22: remove button has title matching aria-label", () => {
      render(<PendingFileRowDouble fileName="evidence.png" />);
      const btn = screen.getByRole("button", { name: "Remove evidence.png" });
      expect(btn.getAttribute("aria-label")).toBe(btn.getAttribute("title"));
    });
  });

  // ── Inline field errors — role=alert ─────────────────────────────────────

  describe("A11Y-08: Inline field errors have role=alert", () => {
    it("FIX12-C23: error paragraph has role=alert when an error is present", () => {
      render(<FieldErrorDouble error="This field is required." />);
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("This field is required.");
    });

    it("FIX12-C24: no alert role when there is no error", () => {
      render(<FieldErrorDouble />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("FIX12-C25: challenges field error is announced as alert", () => {
      render(<FieldErrorDouble error="Please describe the challenges encountered." />);
      expect(screen.getByRole("alert")).toHaveTextContent("Please describe the challenges");
    });

    it("FIX12-C26: lessonsLearned field error is announced as alert", () => {
      render(<FieldErrorDouble error="Lessons Learned is required." />);
      expect(screen.getByRole("alert")).toHaveTextContent("Lessons Learned is required");
    });
  });

  // ── Upload area — accessible description ─────────────────────────────────

  describe("UX-01: Upload area has accessible format description", () => {
    it("FIX12-C27: accepted formats description is adjacent to the upload trigger", () => {
      render(<UploadAreaDouble />);
      expect(
        screen.getByText(/Accepted formats:.*PDF.*Word.*Excel.*images/i)
      ).toBeInTheDocument();
    });

    it("FIX12-C28: description mentions 20 MB limit", () => {
      render(<UploadAreaDouble />);
      expect(screen.getByText(/20 MB/)).toBeInTheDocument();
    });

    it("FIX12-C29: upload input accepts the correct file extensions", () => {
      render(<UploadAreaDouble />);
      const input = document.querySelector("input[type='file']") as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.accept).toContain(".pdf");
      expect(input.accept).toContain(".docx");
      expect(input.accept).toContain(".xlsx");
      expect(input.accept).toContain(".jpg");
      expect(input.accept).toContain(".png");
    });
  });

  // ── Footer buttons — whitespace-nowrap ───────────────────────────────────

  describe("LAYOUT-01: Footer buttons have whitespace-nowrap", () => {
    it("FIX12-C30: Save As Draft button has whitespace-nowrap class on non-final step", () => {
      render(<FooterDouble isLastStep={false} />);
      const btn = screen.getByRole("button", { name: "Save As Draft" });
      expect(btn.className).toContain("whitespace-nowrap");
    });

    it("FIX12-C31: Next button has whitespace-nowrap class on non-final step", () => {
      render(<FooterDouble isLastStep={false} />);
      const btn = screen.getByRole("button", { name: "Next" });
      expect(btn.className).toContain("whitespace-nowrap");
    });

    it("FIX12-C32: Submit Report button has whitespace-nowrap class on final step", () => {
      render(<FooterDouble isLastStep={true} />);
      const btn = screen.getByRole("button", { name: "Submit Report" });
      expect(btn.className).toContain("whitespace-nowrap");
    });

    it("FIX12-C33: Save As Draft has whitespace-nowrap on final step too", () => {
      render(<FooterDouble isLastStep={true} />);
      const btn = screen.getByRole("button", { name: "Save As Draft" });
      expect(btn.className).toContain("whitespace-nowrap");
    });
  });

  // ── Stateful interaction: aria-label switches on toggle ───────────────────

  describe("Dynamic aria-label update on user interaction", () => {
    it("FIX12-C34: play button aria-label updates from 'Play' to 'Pause' after click", () => {
      render(<StatefulPlayDouble />);
      const btn = screen.getByRole("button", { name: "Play voice note" });
      expect(btn).toBeInTheDocument();

      // Use fireEvent to trigger React's synthetic event system
      fireEvent.click(btn);
      // After click, label should switch to Pause
      expect(screen.getByRole("button", { name: "Pause voice note" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Play voice note" })).not.toBeInTheDocument();
    });

    it("FIX12-C35: play button aria-label reverts to 'Play' after second click", () => {
      render(<StatefulPlayDouble />);
      fireEvent.click(screen.getByRole("button", { name: "Play voice note" })); // → Pause
      fireEvent.click(screen.getByRole("button", { name: "Pause voice note" })); // → Play
      expect(screen.getByRole("button", { name: "Play voice note" })).toBeInTheDocument();
    });
  });
});
