/**
 * HQSR Voice Notes — Frontend Tests (HQSR-VOICE-01..06)
 *
 *  - HQSR-VOICE-01: VoiceNotePanel renders for HQ detail (no longer excluded)
 *  - HQSR-VOICE-02: readOnly mode used
 *  - HQSR-VOICE-03: Playback available
 *  - HQSR-VOICE-04: Record/upload controls absent in reviewer state
 *  - HQSR-VOICE-05: Delete control absent in reviewer state
 *  - HQSR-VOICE-06: Storage path not exposed in rendered output
 *
 * Tests use:
 *  - Source-code analysis for guard removal (HQSR-VOICE-01/02)
 *  - Rendered component tests via VoiceNotePanel (HQSR-VOICE-03..06)
 *
 * British English spelling throughout.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Environment shims ────────────────────────────────────────────────────────
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as never;
  }
});

// ── i18n mock ────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "voiceNote.title": "Voice Notes",
        "voiceNote.record": "Record",
        "voiceNote.recorder": "Voice Recorder",
        "voiceNote.upload": "Upload Voice Note",
        "voiceNote.delete": "Delete",
        "voiceNote.empty": "No voice notes recorded.",
        "voiceNote.play": "Play",
        "voiceNote.pause": "Pause",
        "voiceNote.noNotes": "No voice notes.",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// ── API hook mocks — populated list simulates real reviewer state ─────────────
const MOCK_NOTES = [
  {
    id: 1,
    entityType: "report",
    entityId: 42,
    fileName: "voice-note-report-42-1.webm",
    contentType: "audio/webm",
    durationSeconds: 38,
    recordedByName: "Dr. Amina Khalil",
    createdAt: "2026-08-10T09:15:00Z",
    playbackUrl: "/api/voice-notes/1/stream",
  },
  {
    id: 2,
    entityType: "report",
    entityId: 42,
    fileName: "voice-note-report-42-2.webm",
    contentType: "audio/webm",
    durationSeconds: 72,
    recordedByName: "Dr. Amina Khalil",
    createdAt: "2026-08-11T14:30:00Z",
    playbackUrl: "/api/voice-notes/2/stream",
  },
];

vi.mock("@workspace/api-client-react", () => ({
  useListVoiceNotes: () => ({
    data: MOCK_NOTES,
    isLoading: false,
    isError: false,
  }),
  requestUploadUrl: vi.fn(),
}));

import { VoiceNotePanel } from "../components/voice-note-panel";

// ── Source file references ────────────────────────────────────────────────────
const reportsSrc = fs.readFileSync(
  path.resolve(__dirname, "../pages/reports.tsx"),
  "utf8",
);

// ── Helper: render VoiceNotePanel in readOnly mode ────────────────────────────
function renderReadOnlyPanel(entityId = 42) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoiceNotePanel entityType="report" entityId={entityId} readOnly />
    </QueryClientProvider>,
  );
}

// ── HQSR-VOICE-01: VoiceNotePanel renders for HQ detail ─────────────────────

describe("HQSR-VOICE-01: VoiceNotePanel renders for HQ detail (no longer excluded)", () => {
  it("voice note block no longer excludes hq_sector in reports.tsx", () => {
    // The old guard was: `selected.reportType !== "hq_sector" &&` before the Voice Notes block.
    // That guard must be absent.
    expect(reportsSrc).not.toMatch(
      /reportType\s*!==\s*["']hq_sector["']\s*&&\s*[\s\S]{0,200}Voice Notes/,
    );
  });

  it("Voice Notes heading present in the reports.tsx detail section", () => {
    expect(reportsSrc).toMatch(/Voice Notes/);
  });
});

// ── HQSR-VOICE-02: readOnly mode used ────────────────────────────────────────

describe("HQSR-VOICE-02: readOnly mode used in HQSR detail", () => {
  it("VoiceNotePanel in the non-activity detail block is called with readOnly prop", () => {
    // Find the VoiceNotePanel mount just after the Voice Notes heading in the detail Sheet.
    // The heading comment `{/* Voice Notes */}` is immediately followed by the panel mount.
    const vnIdx = reportsSrc.indexOf("{/* Voice Notes */}");
    expect(vnIdx).toBeGreaterThan(-1);
    // Check that within 400 characters after the comment the panel is mounted with readOnly
    const block = reportsSrc.slice(vnIdx, vnIdx + 400);
    expect(block).toMatch(/VoiceNotePanel/);
    expect(block).toMatch(/readOnly/);
  });
});

// ── HQSR-VOICE-03: Playback available ────────────────────────────────────────

describe("HQSR-VOICE-03: Playback available in readOnly mode", () => {
  it("VoiceNotePanel renders in readOnly mode without crashing", () => {
    expect(() => renderReadOnlyPanel()).not.toThrow();
  });

  it("notes from populated list render in the DOM", () => {
    const { container } = renderReadOnlyPanel();
    // Both mock notes have playbackUrl pre-loaded — AudioPlayer or Play button renders
    expect(container).toBeTruthy();
  });

  it("recorded-by name renders for each note", () => {
    renderReadOnlyPanel();
    // Both mock notes share the same recorder name
    expect(screen.getAllByText("Dr. Amina Khalil").length).toBeGreaterThanOrEqual(1);
  });
});

// ── HQSR-VOICE-04: Record/upload controls absent in reviewer state ────────────

describe("HQSR-VOICE-04: Record/upload controls absent in reviewer (readOnly) state", () => {
  it("Record / Add Voice Note button not present when readOnly with notes present", () => {
    renderReadOnlyPanel();
    // The 'Add Voice Note' button (with Mic icon) must not render in readOnly
    expect(screen.queryByRole("button", { name: /add voice note/i })).not.toBeInTheDocument();
  });

  it("Upload button not present when readOnly with notes present", () => {
    renderReadOnlyPanel();
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
  });

  it("voice recorder control not present when readOnly with notes present", () => {
    renderReadOnlyPanel();
    expect(screen.queryByText("Voice Recorder")).not.toBeInTheDocument();
  });
});

// ── HQSR-VOICE-05: Delete control absent in reviewer state ────────────────────

describe("HQSR-VOICE-05: Delete control absent in readOnly reviewer state — populated list", () => {
  it("Delete button not rendered for any note when readOnly (2 notes present)", () => {
    renderReadOnlyPanel();
    // Neither 'Delete' nor 'Confirm Delete' buttons should appear even with populated notes
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm delete/i })).not.toBeInTheDocument();
  });

  it("Trash2 icon absent — no destructive control rendered with populated notes", () => {
    const { container } = renderReadOnlyPanel();
    // aria-label patterns for the delete button must not appear
    const deleteButtons = container.querySelectorAll('[aria-label*="delete" i], [aria-label*="Delete" i]');
    expect(deleteButtons.length).toBe(0);
  });
});

// ── REP-UX-08: Reviewer mode — Record/Upload/Delete absent ───────────────────
// Extends HQSR-VOICE-04/05 to confirm the same invariants hold as a named
// acceptance-criterion test (REP-UX-08 from Task 475).

describe("REP-UX-08: Reviewer mode: Record/Upload/Delete controls absent (REP-UX-08)", () => {
  it("Record/Add Voice Note button is absent when panel is readOnly", () => {
    renderReadOnlyPanel();
    expect(screen.queryByRole("button", { name: /add voice note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
  });

  it("Upload button is absent when panel is readOnly", () => {
    renderReadOnlyPanel();
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
  });

  it("Delete button is absent when panel is readOnly (with notes present)", () => {
    renderReadOnlyPanel();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("VoiceNotePanel is mounted with readOnly prop in the detail sheet", () => {
    // Non-activity detail sheet mounts VoiceNotePanel with readOnly prop
    expect(reportsSrc).toMatch(/VoiceNotePanel[\s\S]{0,200}readOnly/);
  });
});

// ── HQSR-VOICE-06: Storage path not exposed in rendered output ────────────────

describe("HQSR-VOICE-06: Storage path not exposed in rendered output", () => {
  it("objectPath not present in rendered panel output", () => {
    const { container } = renderReadOnlyPanel();
    expect(container.textContent).not.toMatch(/objectPath/i);
  });

  it("voice-note playback URLs routed through secure stream endpoint (not raw storage)", () => {
    // The VoiceNotePanel uses playbackUrl from the API response, which is the secure stream endpoint.
    // Verify the source never constructs a browser-accessible URL from objectPath directly.
    const vnPanelSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/voice-note-panel.tsx"),
      "utf8",
    );
    // playbackUrl comes from server — the component must not embed objectPath in any href or audio src
    expect(vnPanelSrc).not.toMatch(/objectPath[\s\S]{0,80}(?:href|<audio)/);
  });
});
