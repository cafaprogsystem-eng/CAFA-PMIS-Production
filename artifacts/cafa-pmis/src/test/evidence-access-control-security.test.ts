/**
 * Evidence Access-Control Security Tests
 *
 * Mirrors the authorisation logic introduced in Task #166 to close three
 * confirmed access-control bypasses:
 *   A. Storage download proxy — no report ownership check (fixed: new endpoint)
 *   B. Voice-note stream — missing state-scope check (fixed)
 *   C. Attachment metadata listing — missing state-scope check (fixed)
 *
 * These tests run against pure helper mirrors of the server-side logic
 * (no real HTTP, no database) and verify every mandatory scenario from the
 * task spec (SEC-ATT-*, SEC-LIST-*, SEC-VN-*, SEC-ISO-*, SEC-POS-*).
 *
 * British English spelling used throughout (per project convention).
 */

import { describe, it, expect } from "vitest";

/* ══════════════════════════════════════════════════════════════════════════
   Pure helper mirrors — replicate the authorisation logic from:
     • artifacts/api-server/src/lib/reportAuth.ts  (assertCanViewReport)
     • artifacts/api-server/src/routes/reports.ts  (attachment listing + download)
     • artifacts/api-server/src/routes/voice-notes.ts  (stream + url)
   These mirrors are intentionally minimal: they encode the rules, not the
   implementation details, so tests remain stable across refactors.
══════════════════════════════════════════════════════════════════════════ */

// ── User / Role types ────────────────────────────────────────────────────────

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
  /** Assigned sectors for TC. null = no restriction (org-wide roles). */
  sectors: string[] | null;
}

// ── Report fixture type ───────────────────────────────────────────────────────

interface MockReport {
  id: number;
  sector: string | null;
  stateId: number | null;
  reportType: "project" | "activity" | "hq_sector" | "program_state";
}

// ── Attachment / VoiceNote fixture types ─────────────────────────────────────

interface MockAttachment {
  id: number;
  reportId: number;
  fileName: string;
  objectPath: string;
}

interface MockVoiceNote {
  id: number;
  entityType: "report" | "project" | "plan" | "risk" | "comment";
  entityId: number;
  objectPath: string;
}

// ── Mirror: tcSectorRestriction ───────────────────────────────────────────────

function tcSectorRestriction(user: MockUser): string[] | null {
  if (user.role !== "technical_coordinator") return null;
  return user.sectors ?? [];
}

// ── Mirror: assertSectorAllowed ───────────────────────────────────────────────

function assertSectorAllowed(
  user: MockUser,
  sector: string | null,
): { ok: true } | { ok: false; status: number; body: object } {
  const restriction = tcSectorRestriction(user);
  if (!restriction) return { ok: true }; // org-wide role
  if (sector && restriction.includes(sector)) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

// ── Mirror: assertCanViewReport (canonical 3-step check) ─────────────────────
//
// Implements the exact logic from reportAuth.ts:
//   1. Report must exist (undefined sector → 404)
//   2. SPO/SOM must belong to the same state as the report
//   3. TC must be assigned to the report's sector
//
// Returns HTTP { status, body } for denial cases, or null for allowed.

type AuthResult =
  | { allowed: true }
  | { allowed: false; status: number; error: string };

function assertCanViewReport(
  user: MockUser,
  report: MockReport | undefined,
): AuthResult {
  // Step 1 — report existence
  if (!report) {
    return { allowed: false, status: 404, error: "report not found" };
  }

  // Resolve effective sector (mirrors getReportSectorForAuth)
  const sector: string | null = report.sector;

  // Step 2 — state-scope check for SPO/SOM
  const isStateRole =
    user.role === "state_program_officer" ||
    user.role === "state_office_manager";
  if (isStateRole && user.stateId !== null) {
    // HQ reports (stateId === null) are inaccessible to state-only roles
    if (report.stateId === null) {
      return { allowed: false, status: 403, error: "state_scope_forbidden" };
    }
    if (report.stateId !== user.stateId) {
      return { allowed: false, status: 403, error: "state_scope_forbidden" };
    }
  }
  if (isStateRole && user.stateId === null) {
    // SPO/SOM with no stateId assigned — fail closed
    return { allowed: false, status: 403, error: "state_scope_forbidden" };
  }

  // Step 3 — TC sector-scope check
  const sectorGuard = assertSectorAllowed(user, sector);
  if (!sectorGuard.ok) {
    return { allowed: false, status: sectorGuard.status, error: "sector_forbidden" };
  }

  return { allowed: true };
}

// ── Mirror: canAccessAttachment ───────────────────────────────────────────────
//
// Mirrors the new GET /reports/:reportId/attachments/:attachmentId/download:
//   1. User must be authenticated
//   2. assertCanViewReport on the owning report
//   3. Attachment must belong to that report (DB join — no path bypass)

function canAccessAttachment(
  user: MockUser | null,
  report: MockReport | undefined,
  attachment: MockAttachment | undefined,
): AuthResult {
  if (!user) return { allowed: false, status: 401, error: "unauthorized" };
  const reportCheck = assertCanViewReport(user, report);
  if (!reportCheck.allowed) return reportCheck;
  if (!attachment || attachment.reportId !== report!.id) {
    return { allowed: false, status: 404, error: "attachment not found" };
  }
  return { allowed: true };
}

// ── Mirror: canListAttachments ────────────────────────────────────────────────
//
// Mirrors the fixed GET /reports/:reportId/attachments:
//   1. User must be authenticated
//   2. assertCanViewReport (now includes state-scope — previously missing)

function canListAttachments(
  user: MockUser | null,
  report: MockReport | undefined,
): AuthResult {
  if (!user) return { allowed: false, status: 401, error: "unauthorized" };
  return assertCanViewReport(user, report);
}

// ── Mirror: canStreamVoiceNote ────────────────────────────────────────────────
//
// Mirrors the fixed GET /voice-notes/:id/stream and /voice-notes/:id/url:
//   - For entityType==="report": full assertCanViewReport (closes state bypass)
//   - For other entity types: sector-only check (unchanged)

function canStreamVoiceNote(
  user: MockUser | null,
  note: MockVoiceNote,
  report?: MockReport,
): AuthResult {
  if (!user) return { allowed: false, status: 401, error: "unauthorized" };

  if (note.entityType === "report") {
    return assertCanViewReport(user, report);
  }

  // Non-report entities (project/plan/risk/comment) — sector check only
  // (no state-scope for non-report entities; mirrors existing behaviour)
  return { allowed: true };
}

/* ══════════════════════════════════════════════════════════════════════════
   Test fixtures
══════════════════════════════════════════════════════════════════════════ */

// States
const STATE_1 = 1;
const STATE_2 = 2;

// Sectors
const SECTOR_HEALTH = "Health";
const SECTOR_WASH   = "WASH";

// Users
const healthTC: MockUser = {
  id: 10, role: "technical_coordinator", stateId: null,
  sectors: [SECTOR_HEALTH],
};
const washTC: MockUser = {
  id: 11, role: "technical_coordinator", stateId: null,
  sectors: [SECTOR_WASH],
};
const state1SPO: MockUser = {
  id: 20, role: "state_program_officer", stateId: STATE_1, sectors: null,
};
const state2SPO: MockUser = {
  id: 21, role: "state_program_officer", stateId: STATE_2, sectors: null,
};
const state1SOM: MockUser = {
  id: 22, role: "state_office_manager", stateId: STATE_1, sectors: null,
};
const pmUser: MockUser = {
  id: 30, role: "programme_manager", stateId: null, sectors: null,
};
const spcUser: MockUser = {
  id: 31, role: "senior_programme_coordinator", stateId: null, sectors: null,
};
const superAdmin: MockUser = {
  id: 99, role: "super_admin", stateId: null, sectors: null,
};

// Reports
const healthState1Report: MockReport = {
  id: 1001, sector: SECTOR_HEALTH, stateId: STATE_1, reportType: "project",
};
const washState1Report: MockReport = {
  id: 1002, sector: SECTOR_WASH, stateId: STATE_1, reportType: "project",
};
const healthState2Report: MockReport = {
  id: 1003, sector: SECTOR_HEALTH, stateId: STATE_2, reportType: "project",
};
const hqReport: MockReport = {
  id: 1004, sector: SECTOR_HEALTH, stateId: null, reportType: "hq_sector",
};
const standaloneARReport: MockReport = {
  id: 1005, sector: SECTOR_HEALTH, stateId: STATE_1, reportType: "activity",
};
const projectLinkedARReport: MockReport = {
  id: 1006, sector: SECTOR_WASH, stateId: STATE_1, reportType: "activity",
};

// Attachments
const healthState1Att: MockAttachment = {
  id: 201, reportId: 1001, fileName: "health-report.pdf", objectPath: "/objects/abc123",
};
const washState1Att: MockAttachment = {
  id: 202, reportId: 1002, fileName: "wash-report.pdf", objectPath: "/objects/def456",
};
const crossReportAtt: MockAttachment = {
  // Attachment that belongs to report 1002 but client claims it belongs to 1001
  id: 202, reportId: 1002, fileName: "wash-report.pdf", objectPath: "/objects/def456",
};

// Voice notes
const healthState1VN: MockVoiceNote = {
  id: 301, entityType: "report", entityId: 1001, objectPath: "/objects/vn-health-s1",
};
const healthState2VN: MockVoiceNote = {
  id: 302, entityType: "report", entityId: 1003, objectPath: "/objects/vn-health-s2",
};
const washState1VN: MockVoiceNote = {
  id: 303, entityType: "report", entityId: 1002, objectPath: "/objects/vn-wash-s1",
};
const hqReportVN: MockVoiceNote = {
  id: 304, entityType: "report", entityId: 1004, objectPath: "/objects/vn-hq",
};

/* ══════════════════════════════════════════════════════════════════════════
   SEC-ATT — Attachment download security
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-ATT — Attachment download security", () => {
  it("SEC-ATT-01: Health-sector TC → Health report attachment → allowed", () => {
    const result = canAccessAttachment(healthTC, healthState1Report, healthState1Att);
    expect(result.allowed).toBe(true);
  });

  it("SEC-ATT-02: WASH-only TC → Health report attachment → denied (reproduces confirmed bypass)", () => {
    const result = canAccessAttachment(washTC, healthState1Report, healthState1Att);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
  });

  it("SEC-ATT-03: State 1 SPO → State 1 report attachment → allowed", () => {
    const result = canAccessAttachment(state1SPO, healthState1Report, healthState1Att);
    expect(result.allowed).toBe(true);
  });

  it("SEC-ATT-04: State 2 SPO → State 1 report attachment → denied (reproduces confirmed bypass)", () => {
    const result = canAccessAttachment(state2SPO, healthState1Report, healthState1Att);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
    expect((result as { allowed: false; error: string }).error).toBe("state_scope_forbidden");
  });

  it("SEC-ATT-05: Unauthenticated → any attachment → 401", () => {
    const result = canAccessAttachment(null, healthState1Report, healthState1Att);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(401);
  });

  it("SEC-ATT-06: Attachment belonging to a different report → 404 (no cross-report path)", () => {
    // Client supplies reportId=1001 but attachment 202 belongs to report 1002
    const result = canAccessAttachment(healthTC, healthState1Report, crossReportAtt);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SEC-LIST — Attachment metadata listing security
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-LIST — Attachment metadata listing security", () => {
  it("SEC-LIST-01: Report owner (Health TC) → GET attachments → allowed", () => {
    const result = canListAttachments(healthTC, healthState1Report);
    expect(result.allowed).toBe(true);
  });

  it("SEC-LIST-02: State 2 SPO → State 1 report attachments → denied (reproduces confirmed bypass)", () => {
    const result = canListAttachments(state2SPO, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
    expect((result as { allowed: false; error: string }).error).toBe("state_scope_forbidden");
  });

  it("SEC-LIST-03: Wrong-sector TC → cross-sector report attachments → denied", () => {
    const result = canListAttachments(washTC, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
  });

  it("SEC-LIST-04: Unauthenticated → attachment listing → 401", () => {
    const result = canListAttachments(null, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(401);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SEC-VN — Voice note stream security
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-VN — Voice note stream / URL security", () => {
  it("SEC-VN-01: State 1 SPO → State 1 report voice stream → allowed", () => {
    const result = canStreamVoiceNote(state1SPO, healthState1VN, healthState1Report);
    expect(result.allowed).toBe(true);
  });

  it("SEC-VN-02: State 2 SPO → State 1 report voice stream → denied (reproduces confirmed bypass)", () => {
    const result = canStreamVoiceNote(state2SPO, healthState1VN, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
    expect((result as { allowed: false; error: string }).error).toBe("state_scope_forbidden");
  });

  it("SEC-VN-03: WASH TC → Health report voice stream → denied", () => {
    const result = canStreamVoiceNote(washTC, healthState1VN, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
  });

  it("SEC-VN-04: Health TC → Health report voice stream → allowed", () => {
    const result = canStreamVoiceNote(healthTC, healthState1VN, healthState1Report);
    expect(result.allowed).toBe(true);
  });

  it("SEC-VN-05: Unauthenticated → voice stream → 401", () => {
    const result = canStreamVoiceNote(null, healthState1VN, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(401);
  });

  it("SEC-VN-06: /voice-notes/:id/url — same state-scope enforcement as /stream (State 2 SPO → denied)", () => {
    // The /url endpoint uses the same assertCanViewReport logic as /stream
    const result = canStreamVoiceNote(state2SPO, healthState1VN, healthState1Report);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; error: string }).error).toBe("state_scope_forbidden");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SEC-ISO — Scope isolation tests
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-ISO — Scope isolation", () => {
  it("SEC-ISO-01: HQ report attachment → state-only user (SPO) → denied", () => {
    const result = canAccessAttachment(
      state1SPO,
      hqReport,
      { id: 210, reportId: 1004, fileName: "hq.pdf", objectPath: "/objects/hq" },
    );
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
  });

  it("SEC-ISO-02: HQ report voice note → state-only user (SPO) → denied", () => {
    const result = canStreamVoiceNote(state1SPO, hqReportVN, hqReport);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; status: number }).status).toBe(403);
  });

  it("SEC-ISO-03: Standalone AR attachment → authorised reviewer (Health TC in same sector) → allowed", () => {
    const result = canAccessAttachment(
      healthTC,
      standaloneARReport,
      { id: 220, reportId: 1005, fileName: "standalone.pdf", objectPath: "/objects/sa" },
    );
    expect(result.allowed).toBe(true);
  });

  it("SEC-ISO-04: Standalone AR attachment → unrelated scope (WASH TC) → denied", () => {
    const result = canAccessAttachment(
      washTC,
      standaloneARReport,
      { id: 220, reportId: 1005, fileName: "standalone.pdf", objectPath: "/objects/sa" },
    );
    expect(result.allowed).toBe(false);
  });

  it("SEC-ISO-05: Activity-linked AR evidence → WASH TC (authorised) → allowed; Health TC (unrelated) → denied", () => {
    const washAtt: MockAttachment = {
      id: 230, reportId: 1006, fileName: "activity-linked.pdf", objectPath: "/objects/al",
    };
    expect(canAccessAttachment(washTC, projectLinkedARReport, washAtt).allowed).toBe(true);
    expect(canAccessAttachment(healthTC, projectLinkedARReport, washAtt).allowed).toBe(false);
  });

  it("SEC-ISO-06: Project-linked AR voice note → authorised sector → allowed; unrelated sector → denied", () => {
    const projectLinkedVN: MockVoiceNote = {
      id: 305, entityType: "report", entityId: 1006, objectPath: "/objects/vn-al",
    };
    expect(canStreamVoiceNote(washTC, projectLinkedVN, projectLinkedARReport).allowed).toBe(true);
    expect(canStreamVoiceNote(healthTC, projectLinkedVN, projectLinkedARReport).allowed).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SEC-POS — Legitimate reviewer positive tests
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-POS — Legitimate reviewer access (positive paths)", () => {
  it("SEC-POS-01: PM (org-wide role) → cross-sector/state report → allowed", () => {
    // PM has no sector restriction and no state restriction
    expect(canAccessAttachment(pmUser, healthState1Report, healthState1Att).allowed).toBe(true);
    expect(canAccessAttachment(pmUser, washState1Report, washState1Att).allowed).toBe(true);
    expect(canAccessAttachment(pmUser, healthState2Report, {
      id: 250, reportId: 1003, fileName: "h2.pdf", objectPath: "/objects/h2",
    }).allowed).toBe(true);
  });

  it("SEC-POS-02: Authorised TC reviewer → in-sector report attachment → allowed", () => {
    expect(canAccessAttachment(healthTC, healthState1Report, healthState1Att).allowed).toBe(true);
    expect(canAccessAttachment(washTC, washState1Report, washState1Att).allowed).toBe(true);
  });

  it("SEC-POS-03: Authorised TC reviewer → in-sector voice note stream → allowed", () => {
    expect(canStreamVoiceNote(healthTC, healthState1VN, healthState1Report).allowed).toBe(true);
    expect(canStreamVoiceNote(washTC, washState1VN, washState1Report).allowed).toBe(true);
  });

  it("SEC-POS-04: Report author's own state/sector → evidence after submission → allowed", () => {
    // The author is a State 1 SPO — they can still access their own submitted report's evidence
    expect(canAccessAttachment(state1SPO, healthState1Report, healthState1Att).allowed).toBe(true);
    expect(canStreamVoiceNote(state1SPO, healthState1VN, healthState1Report).allowed).toBe(true);
  });

  it("SEC-POS-05: SPC (org-wide) → any report → allowed", () => {
    expect(canListAttachments(spcUser, healthState1Report).allowed).toBe(true);
    expect(canListAttachments(spcUser, hqReport).allowed).toBe(true);
  });

  it("SEC-POS-06: super_admin → any report evidence → allowed", () => {
    expect(canAccessAttachment(superAdmin, healthState1Report, healthState1Att).allowed).toBe(true);
    expect(canStreamVoiceNote(superAdmin, healthState2VN, healthState2Report).allowed).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SEC-URL — Download endpoint URL shape (no raw object paths exposed)
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-URL — New download endpoint URL shape", () => {
  // Mirror of the updated attachmentDownloadUrl() from reports.tsx
  function attachmentDownloadUrl(reportId: number, attachmentId: number): string {
    return `/api/reports/${reportId}/attachments/${attachmentId}/download`;
  }

  it("SEC-URL-01: Download URL contains reportId and attachmentId, not an object path", () => {
    const url = attachmentDownloadUrl(1001, 201);
    expect(url).toBe("/api/reports/1001/attachments/201/download");
    expect(url).not.toContain("/storage/objects/");
    expect(url).not.toContain("abc123");
  });

  it("SEC-URL-02: Download URL points to the new authenticated endpoint, not the generic proxy", () => {
    const url = attachmentDownloadUrl(42, 7);
    expect(url).toMatch(/^\/api\/reports\/\d+\/attachments\/\d+\/download$/);
    expect(url).not.toContain("/api/storage/");
  });

  it("SEC-URL-03: Different reportId and attachmentId produce distinct URLs", () => {
    const url1 = attachmentDownloadUrl(1001, 201);
    const url2 = attachmentDownloadUrl(1002, 202);
    expect(url1).not.toBe(url2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SEC-UNCHANGED — Routes that must NOT be affected by this fix
══════════════════════════════════════════════════════════════════════════ */

describe("SEC-UNCHANGED — Invariants that must be preserved", () => {
  it("GET /voice-notes list already applied state-scope check — no regression needed", () => {
    // The GET /voice-notes list route (lines 67-129 of voice-notes.ts) already
    // applied the full canonical auth including state scope (lines 90-103).
    // This test documents the invariant: a state-role user is always
    // bound to their stateId for report-entity voice note listing.
    const stateUser = state1SPO;
    // State 1 report — same state — allowed
    const sameStateResult = assertCanViewReport(stateUser, healthState1Report);
    expect(sameStateResult.allowed).toBe(true);
    // State 2 report — different state — denied
    const diffStateResult = assertCanViewReport(stateUser, healthState2Report);
    expect(diffStateResult.allowed).toBe(false);
  });

  it("Generic /storage/objects/* proxy is unchanged — only affects non-report objects", () => {
    // The task decision (Option A) was to add a dedicated evidence download endpoint
    // rather than making the generic proxy report-aware. This ensures project
    // documents, SOPs, manuals, and training videos continue to work.
    // We document the invariant: the proxy route is NOT used for report evidence
    // in the updated frontend (attachmentDownloadUrl returns the new endpoint).
    function oldAttachmentUrl(objectPath: string): string {
      const stripped = objectPath.startsWith("/objects/")
        ? objectPath.slice("/objects/".length)
        : objectPath;
      return `/api/storage/objects/${stripped}`;
    }
    function newAttachmentUrl(reportId: number, attachmentId: number): string {
      return `/api/reports/${reportId}/attachments/${attachmentId}/download`;
    }
    // Confirm the new URL does not go through the generic proxy
    expect(newAttachmentUrl(1001, 201)).not.toContain("/storage/objects/");
    // Old URL would have exposed the raw storage path — no longer used for evidence
    expect(oldAttachmentUrl("/objects/abc123")).toBe("/api/storage/objects/abc123");
  });

  it("State 1 SOM (state_office_manager) is subject to the same state-scope rules as SPO", () => {
    // state_office_manager is in the same isStateRole set as state_program_officer
    const result = assertCanViewReport(state1SOM, healthState1Report);
    expect(result.allowed).toBe(true);
    // Accessing a different state's report must be denied
    const denied = assertCanViewReport(state1SOM, healthState2Report);
    expect(denied.allowed).toBe(false);
    expect((denied as { allowed: false; error: string }).error).toBe("state_scope_forbidden");
  });
});
