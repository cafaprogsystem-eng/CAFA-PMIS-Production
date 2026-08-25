/**
 * HQSR Evidence & Access-Control Security Tests
 *
 * Frontend structural tests (HQSR-EVID-01..08):
 *  - Verify the secure Supporting Attachments block is enabled for hq_sector
 *  - Verify download routes through authenticated endpoint only
 *  - Verify objectPath / storage keys never rendered
 *  - Verify no duplicate legacy attachment list
 *
 * Backend security mirror tests (HQSR-EVID-SEC-01..05):
 *  - Unauthorised actor cannot download HQ attachment
 *  - Wrong-sector TC blocked from HQSR evidence
 *  - Unauthorised actor cannot play voice note
 *  - PM Full Operational Access preserved
 *  - Super Admin Full Operational Access preserved
 *
 * Uses pure helper mirrors of server-side logic (no HTTP/database).
 * British English spelling throughout.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Source file references ────────────────────────────────────────────────────

const reportsSrc = fs.readFileSync(
  path.resolve(__dirname, "../pages/reports.tsx"),
  "utf8",
);

const hqFormSrc = fs.readFileSync(
  path.resolve(__dirname, "../components/hq-sector-report-form.tsx"),
  "utf8",
);

// ── HQSR-EVID-01: Supporting Attachments section enabled for hq_sector ────────

describe("HQSR-EVID-01: Supporting Attachments enabled for hq_sector", () => {
  it("attachment block no longer excludes hq_sector", () => {
    // The old guard was: `selected.reportType !== "hq_sector" &&` before the attachment block.
    // That guard must be absent — the block now renders unconditionally for all non-activity types.
    // The loading effect already includes hq_sector (only activity is excluded).
    expect(reportsSrc).not.toMatch(
      /reportType\s*!==\s*["']hq_sector["']\s*&&\s*[\s\S]{0,200}Supporting Attachments/,
    );
  });

  it("attachment loading effect includes hq_sector (excludes only activity)", () => {
    // The effect guard should be `reportType === "activity"` not a list that includes hq_sector
    expect(reportsSrc).toMatch(/reportType.*===.*["']activity["']/);
    // Must not gate on hq_sector in the loading effect
    const effectBlock = reportsSrc.match(/Fetch attachments[\s\S]{0,600}selected\?\.reportType/)?.[0] ?? "";
    expect(effectBlock).not.toMatch(/hq_sector/);
  });
});

// ── HQSR-EVID-02: Loading state renders ──────────────────────────────────────

describe("HQSR-EVID-02: Loading state renders", () => {
  it("detailAttachmentsLoading renders a loading message", () => {
    expect(reportsSrc).toMatch(/detailAttachmentsLoading.*Loading/s);
  });
});

// ── HQSR-EVID-03: Error state renders ────────────────────────────────────────

describe("HQSR-EVID-03: Error state renders", () => {
  it("detailAttachmentsError renders an error message", () => {
    expect(reportsSrc).toMatch(/detailAttachmentsError.*t\(/s);
  });
});

// ── HQSR-EVID-04: Empty state renders ────────────────────────────────────────

describe("HQSR-EVID-04: Empty state renders", () => {
  it("empty detailAttachments renders 'No supporting attachments'", () => {
    expect(reportsSrc).toMatch(/detailAttachments\.length\s*===\s*0/);
    expect(reportsSrc).toContain('t("form.noAttachments")');
  });
});

// ── HQSR-EVID-05: Populated evidence renders filenames/metadata ───────────────

describe("HQSR-EVID-05: Populated evidence renders filenames/metadata", () => {
  it("attachment file name rendered via att.fileName", () => {
    expect(reportsSrc).toMatch(/att\.fileName/);
  });

  it("each attachment has a Download link with accessible aria-label", () => {
    expect(reportsSrc).toMatch(/aria-label.*Download.*att\.fileName/s);
  });
});

// ── HQSR-EVID-06: Download uses secured report attachment endpoint ─────────────

describe("HQSR-EVID-06: Download uses secured report attachment endpoint", () => {
  it("attachmentDownloadUrl builds /api/reports/:id/attachments/:attId/download", () => {
    expect(reportsSrc).toMatch(/\/api\/reports.*attachments.*download/);
  });

  it("download anchor uses attachmentDownloadUrl helper (not raw objectPath)", () => {
    expect(reportsSrc).toMatch(/href={attachmentDownloadUrl\(selected\.id, att\.id\)}/);
  });
});

// ── HQSR-EVID-07: objectPath / storage key never rendered ────────────────────

describe("HQSR-EVID-07: objectPath / storage key never rendered in attachment block", () => {
  it("objectPath is not rendered in the attachment anchor href in reports.tsx", () => {
    // The href must only reference the download URL helper, never objectPath
    const anchorBlock = reportsSrc.match(/attachmentDownloadUrl[\s\S]{0,300}aria-label/)?.[0] ?? "";
    expect(anchorBlock).not.toMatch(/objectPath/);
  });

  it("HqSectorSectionsView does not render objectPath in viewer output", () => {
    // Extract just the HqSectorSectionsView function body to avoid matching upload-form code
    const viewerStart = hqFormSrc.indexOf("export function HqSectorSectionsView");
    const viewerBody = viewerStart >= 0 ? hqFormSrc.slice(viewerStart) : "";
    // The viewer must not expose objectPath as rendered content (it has no download links)
    // objectPath may appear as a type/field name in non-rendering code — test rendered JSX only
    expect(viewerBody).not.toMatch(/\{.*objectPath.*\}/); // no JSX expression rendering objectPath
  });
});

// ── HQSR-EVID-08: No duplicate legacy attachment list ────────────────────────

describe("HQSR-EVID-08: No duplicate legacy attachment list", () => {
  it("HqSectorSectionsView no longer renders a standalone Attachments section", () => {
    // The old code had a {/* Attachments */} block rendering attachmentsArr.
    // That block must be absent — only the secure block in reports.tsx handles downloads.
    expect(hqFormSrc).not.toMatch(/attachmentsArr\.map/);
    expect(hqFormSrc).not.toMatch(/attachmentsArr\.length/);
  });

  it("single secure Supporting Attachments block exists and is not gated by report type", () => {
    // The attachment comment exists
    const commentIdx = reportsSrc.indexOf("{/* Supporting Attachments */}");
    expect(commentIdx).toBeGreaterThan(-1);
    // The block is not gated by hq_sector or program_state exclusion
    const gate = reportsSrc.slice(commentIdx, commentIdx + 300);
    expect(gate).not.toContain('!== "hq_sector"');
    expect(gate).not.toContain('!== "program_state"');
    // Exactly one download-url call exists (one attachment block)
    const downloadMatches = reportsSrc.match(/attachmentDownloadUrl\(selected\.id/g) ?? [];
    expect(downloadMatches.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Backend security mirror tests — HQSR-EVID-SEC-01..05
// Mirrors canonical access-control logic from:
//   artifacts/api-server/src/lib/reportAuth.ts  (assertCanViewReport)
//   artifacts/api-server/src/routes/reports.ts  (attachment download)
//   artifacts/api-server/src/routes/voice-notes.ts  (stream)
// ═══════════════════════════════════════════════════════════════════════════════

type Role =
  | "super_admin"
  | "executive_director"
  | "programme_manager"
  | "senior_programme_coordinator"
  | "state_program_officer"
  | "state_office_manager"
  | "technical_coordinator"
  | "viewer";

interface MockUser {
  id: number;
  role: Role;
  stateId: number | null;
  /** Assigned sectors for TC — null means no restriction (org-wide roles) */
  sectors: string[] | null;
}

interface MockReport {
  id: number;
  sector: string | null;
  stateId: number | null;
  reportType: "project" | "activity" | "hq_sector" | "program_state";
}

// ── Helper: hasFullOperationalAccess (#373 canonical) ────────────────────────

function hasFullOperationalAccess(user: MockUser): boolean {
  return user.role === "super_admin" || user.role === "programme_manager";
}

// ── Helper: tcSectorRestriction ──────────────────────────────────────────────

function tcSectorRestriction(user: MockUser): string[] | null {
  if (user.role !== "technical_coordinator") return null;
  return user.sectors ?? [];
}

// ── Helper: assertSectorAllowed (mirrors reportAuth) ─────────────────────────

function assertSectorAllowed(
  user: MockUser,
  reportSector: string | null,
): { ok: true } | { ok: false; status: number; body: string } {
  if (hasFullOperationalAccess(user)) return { ok: true };
  const tc = tcSectorRestriction(user);
  if (tc !== null) {
    if (!reportSector) return { ok: false, status: 404, body: "not found" };
    if (!tc.includes(reportSector)) return { ok: false, status: 403, body: "sector scope" };
  }
  return { ok: true };
}

// ── Helper: assertCanViewReport (mirrors reportAuth for hq_sector) ───────────

function assertCanViewReport(
  user: MockUser,
  report: MockReport,
): { ok: true } | { ok: false; status: number; body: string } {
  // HQSR has null stateId — state-scoped roles (SPO/SOM) fail closed
  if (
    (user.role === "state_program_officer" || user.role === "state_office_manager") &&
    report.reportType === "hq_sector"
  ) {
    return { ok: false, status: 403, body: "hqsr not accessible to state roles" };
  }
  // Viewer cannot access report contents
  if (user.role === "viewer") {
    return { ok: false, status: 403, body: "insufficient permissions" };
  }
  return assertSectorAllowed(user, report.sector);
}

// ── Helper: canDownloadAttachment (mirrors attachment download route) ─────────

function canDownloadAttachment(
  user: MockUser,
  report: MockReport,
): { ok: true } | { ok: false; status: number; body: string } {
  return assertCanViewReport(user, report);
}

// ── Helper: canStreamVoiceNote (mirrors voice-note stream route) ─────────────

function canStreamVoiceNote(
  user: MockUser,
  report: MockReport,
): { ok: true } | { ok: false; status: number; body: string } {
  return assertCanViewReport(user, report);
}

// ── HQSR report fixture ───────────────────────────────────────────────────────

const HQSR_WASH: MockReport = {
  id: 42,
  sector: "WASH",
  stateId: null,
  reportType: "hq_sector",
};

// ── HQSR-EVID-SEC-01: Unauthorised actor cannot download HQ attachment ────────

describe("HQSR-EVID-SEC-01: Unauthorised actor cannot download HQ attachment directly", () => {
  it("viewer is blocked from HQSR attachment download", () => {
    const viewer: MockUser = { id: 99, role: "viewer", stateId: null, sectors: null };
    const result = canDownloadAttachment(viewer, HQSR_WASH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBeGreaterThanOrEqual(403);
  });

  it("state_program_officer is blocked from HQSR attachment download", () => {
    const spo: MockUser = { id: 5, role: "state_program_officer", stateId: 1, sectors: null };
    const result = canDownloadAttachment(spo, HQSR_WASH);
    expect(result.ok).toBe(false);
  });

  it("state_office_manager is blocked from HQSR attachment download", () => {
    const som: MockUser = { id: 6, role: "state_office_manager", stateId: 2, sectors: null };
    const result = canDownloadAttachment(som, HQSR_WASH);
    expect(result.ok).toBe(false);
  });
});

// ── HQSR-EVID-SEC-02: Wrong-sector TC cannot access HQSR evidence ─────────────

describe("HQSR-EVID-SEC-02: Wrong-sector TC cannot access HQSR evidence", () => {
  it("TC assigned only to Health is blocked from WASH HQSR", () => {
    const tc: MockUser = { id: 10, role: "technical_coordinator", stateId: null, sectors: ["Health"] };
    const result = canDownloadAttachment(tc, HQSR_WASH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("TC assigned to WASH can access WASH HQSR", () => {
    const tc: MockUser = { id: 11, role: "technical_coordinator", stateId: null, sectors: ["WASH"] };
    const result = canDownloadAttachment(tc, HQSR_WASH);
    expect(result.ok).toBe(true);
  });

  it("TC with no sectors fails closed", () => {
    const tc: MockUser = { id: 12, role: "technical_coordinator", stateId: null, sectors: [] };
    const result = canDownloadAttachment(tc, HQSR_WASH);
    expect(result.ok).toBe(false);
  });
});

// ── HQSR-EVID-SEC-03: Unauthorised actor cannot fetch/play voice note ─────────

describe("HQSR-EVID-SEC-03: Unauthorised actor cannot fetch/play voice note", () => {
  it("viewer blocked from HQSR voice-note stream", () => {
    const viewer: MockUser = { id: 99, role: "viewer", stateId: null, sectors: null };
    const result = canStreamVoiceNote(viewer, HQSR_WASH);
    expect(result.ok).toBe(false);
  });

  it("SPO blocked from HQSR voice-note stream", () => {
    const spo: MockUser = { id: 5, role: "state_program_officer", stateId: 1, sectors: null };
    const result = canStreamVoiceNote(spo, HQSR_WASH);
    expect(result.ok).toBe(false);
  });

  it("wrong-sector TC blocked from HQSR voice-note stream", () => {
    const tc: MockUser = { id: 13, role: "technical_coordinator", stateId: null, sectors: ["Nutrition"] };
    const result = canStreamVoiceNote(tc, HQSR_WASH);
    expect(result.ok).toBe(false);
  });
});

// ── HQSR-EVID-SEC-04: PM Full Operational Access preserved ───────────────────

describe("HQSR-EVID-SEC-04: PM Full Operational Access preserved (#373)", () => {
  const pm: MockUser = { id: 1, role: "programme_manager", stateId: null, sectors: null };

  it("PM can download HQSR attachment", () => {
    expect(canDownloadAttachment(pm, HQSR_WASH).ok).toBe(true);
  });

  it("PM can stream HQSR voice note", () => {
    expect(canStreamVoiceNote(pm, HQSR_WASH).ok).toBe(true);
  });

  it("PM access is granted via hasFullOperationalAccess", () => {
    expect(hasFullOperationalAccess(pm)).toBe(true);
  });
});

// ── HQSR-EVID-SEC-05: Super Admin Full Operational Access preserved ───────────

describe("HQSR-EVID-SEC-05: Super Admin Full Operational Access preserved (#373)", () => {
  const admin: MockUser = { id: 2, role: "super_admin", stateId: null, sectors: null };

  it("super_admin can download HQSR attachment", () => {
    expect(canDownloadAttachment(admin, HQSR_WASH).ok).toBe(true);
  });

  it("super_admin can stream HQSR voice note", () => {
    expect(canStreamVoiceNote(admin, HQSR_WASH).ok).toBe(true);
  });

  it("super_admin access is granted via hasFullOperationalAccess", () => {
    expect(hasFullOperationalAccess(admin)).toBe(true);
  });
});
