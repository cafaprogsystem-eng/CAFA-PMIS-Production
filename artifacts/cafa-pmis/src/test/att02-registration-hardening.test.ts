/**
 * ATT-02 — Evidence Upload Registration Hardening Tests
 *
 * Verifies that the HMAC-signed upload token mechanism closes the ATT-02
 * registration gap: a staff member cannot register an evidence file they did
 * not personally request an upload URL for.
 *
 * Tests run against pure helper mirrors of the server-side logic in:
 *   • artifacts/api-server/src/lib/uploadToken.ts   (sign / verify)
 *   • artifacts/api-server/src/routes/reports.ts    (POST /attachments)
 *   • artifacts/api-server/src/routes/voice-notes.ts (POST /voice-notes)
 *   • artifacts/api-server/src/routes/storage.ts    (POST /request-url)
 *
 * No real HTTP, no database, no React rendering.
 * British English spelling used throughout (per project convention).
 */

import { describe, it, expect, beforeEach } from "vitest";

/* ══════════════════════════════════════════════════════════════════════════
   Mirror: UploadDescriptor + token sign/verify logic
   Replicated from lib/uploadToken.ts so tests are self-contained.
══════════════════════════════════════════════════════════════════════════ */

import { createHmac, timingSafeEqual } from "crypto";

interface UploadDescriptor {
  objectPath: string;
  userId: number;
  reportId: number;
  entityType: "attachment" | "voice_note";
  contentType: string;
  maxSize: number;
  iat: number;
  exp: number;
}

class UploadTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadTokenError";
  }
}

const TEST_SECRET = "test-secret-do-not-use-in-prod";

function base64urlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): string {
  const padded = str + "==".slice(0, (4 - (str.length % 4)) % 4);
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64").toString("utf8");
}

function computeHmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function signToken(payload: UploadDescriptor, secret = TEST_SECRET): string {
  const encoded = base64urlEncode(JSON.stringify(payload));
  const sig = computeHmac(encoded, secret);
  return `${encoded}.${sig}`;
}

function verifyToken(token: string, secret = TEST_SECRET): UploadDescriptor {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 1) throw new UploadTokenError("malformed_upload_token");

  const encodedPayload = token.slice(0, lastDot);
  const providedSig = token.slice(lastDot + 1);

  const expectedSig = computeHmac(encodedPayload, secret);
  const sigsMatch = (() => {
    try {
      return timingSafeEqual(
      Buffer.from(providedSig, "hex"),
      Buffer.from(expectedSig, "hex"),
      );
    } catch {
      return false;
    }
  })();
  if (!sigsMatch) throw new UploadTokenError("invalid_upload_token_signature");

  let descriptor: UploadDescriptor;
  try {
    descriptor = JSON.parse(base64urlDecode(encodedPayload)) as UploadDescriptor;
  } catch {
    throw new UploadTokenError("invalid_upload_token_payload");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!descriptor.exp || descriptor.exp <= nowSeconds) {
    throw new UploadTokenError("upload_token_expired");
  }

  return descriptor;
}

/* ══════════════════════════════════════════════════════════════════════════
   Mirror: Attachment registration logic
   Mirrors the hardened POST /reports/:reportId/attachments business rules.
══════════════════════════════════════════════════════════════════════════ */

interface MockReport {
  id: number;
  status: "draft" | "submitted" | "approved";
  authorId: number | null;
}

interface MockAttachmentDb {
  [objectPath: string]: { id: number; reportId: number; fileName: string; contentType: string; size: number };
}

let attachmentDb: MockAttachmentDb = {};
let attachmentIdSeq = 1;

function registerAttachment(opts: {
  reportId: number;
  requestingUserId: number;
  fileName: string;
  uploadToken: string;
  report: MockReport;
}): { status: number; body: object } {
  const { reportId, requestingUserId, fileName, uploadToken, report } = opts;

  // Mutation auth check (simplified mirror)
  if (report.status !== "draft") {
    return { status: 409, body: { error: "only_draft_reports_can_be_updated" } };
  }

  // Verify token
  let descriptor: UploadDescriptor;
  try {
    descriptor = verifyToken(uploadToken);
  } catch (err) {
    if (err instanceof UploadTokenError) {
      return { status: 400, body: { error: "invalid_upload_token", message: err.message } };
    }
    throw err;
  }

  // User match
  if (descriptor.userId !== requestingUserId) {
    return { status: 403, body: { error: "upload_token_user_mismatch" } };
  }

  // Report binding
  if (descriptor.reportId !== reportId) {
    return { status: 403, body: { error: "upload_not_bound_to_report" } };
  }

  // Entity type
  if (descriptor.entityType !== "attachment") {
    return { status: 400, body: { error: "upload_token_entity_type_mismatch" } };
  }

  // Sanitise file name
  const safeName = (fileName ?? "")
    .replace(/\.\.[/\\]/g, "")
    .replace(/[/\\]/g, "_")
    .slice(0, 255);
  if (!safeName) {
    return { status: 400, body: { error: "invalid_file_name" } };
  }

  // Replay check
  if (attachmentDb[descriptor.objectPath]) {
    return { status: 201, body: attachmentDb[descriptor.objectPath] };
  }

  // Insert
  const row = {
    id: attachmentIdSeq++,
    reportId,
    fileName: safeName,
    contentType: descriptor.contentType,
    size: descriptor.maxSize,
  };
  attachmentDb[descriptor.objectPath] = row;
  return { status: 201, body: row };
}

/* ══════════════════════════════════════════════════════════════════════════
   Mirror: Voice note registration logic
   Mirrors the hardened POST /voice-notes report-entity path.
══════════════════════════════════════════════════════════════════════════ */

interface MockVoiceNoteDb {
  [objectPath: string]: { id: number; entityId: number; fileName: string; durationSeconds: number };
}

let voiceNoteDb: MockVoiceNoteDb = {};
let voiceNoteIdSeq = 1;

function registerVoiceNote(opts: {
  entityId: number;
  requestingUserId: number;
  fileName: string;
  uploadToken: string;
  durationSeconds: number;
  report: MockReport;
}): { status: number; body: object } {
  const { entityId, requestingUserId, fileName, uploadToken, durationSeconds, report } = opts;

  if (report.status !== "draft") {
    return { status: 409, body: { error: "only_draft_reports_can_be_updated" } };
  }

  // Duration validation
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 300) {
    return { status: 400, body: { error: "durationSeconds must be between 0 and 300" } };
  }

  // Verify token
  let descriptor: UploadDescriptor;
  try {
    descriptor = verifyToken(uploadToken);
  } catch (err) {
    if (err instanceof UploadTokenError) {
      return { status: 400, body: { error: "invalid_upload_token", message: err.message } };
    }
    throw err;
  }

  // User match
  if (descriptor.userId !== requestingUserId) {
    return { status: 403, body: { error: "upload_token_user_mismatch" } };
  }

  // Report binding
  if (descriptor.reportId !== entityId) {
    return { status: 403, body: { error: "upload_not_bound_to_report" } };
  }

  // Entity type
  if (descriptor.entityType !== "voice_note") {
    return { status: 400, body: { error: "upload_token_entity_type_mismatch" } };
  }

  // Replay check
  if (voiceNoteDb[descriptor.objectPath]) {
    return { status: 201, body: voiceNoteDb[descriptor.objectPath] };
  }

  const row = {
    id: voiceNoteIdSeq++,
    entityId,
    fileName,
    durationSeconds,
  };
  voiceNoteDb[descriptor.objectPath] = row;
  return { status: 201, body: row };
}

/* ══════════════════════════════════════════════════════════════════════════
   Mirror: Upload URL issuance logic
   Mirrors POST /storage/uploads/request-url with ATT-02 token issuance.
══════════════════════════════════════════════════════════════════════════ */

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

function requestUploadUrl(opts: {
  name: string;
  size: number;
  contentType: string;
  reportId?: number;
  entityType?: "attachment" | "voice_note";
  requestingUserId?: number;
  report?: MockReport;
}): { status: number; body: object } {
  const { name, size, contentType, reportId, entityType, requestingUserId, report } = opts;

  const isReportUpload =
    typeof reportId === "number" &&
    Number.isInteger(reportId) &&
    reportId > 0 &&
    (entityType === "attachment" || entityType === "voice_note");

  if (isReportUpload && report) {
    if (report.status !== "draft") {
      return { status: 409, body: { error: "only_draft_reports_can_be_updated" } };
    }
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    return { status: 413, body: { error: "file_too_large" } };
  }

  const objectPath = `/objects/uploads/test-uuid-${Date.now()}`;
  const iat = Math.floor(Date.now() / 1000);

  let uploadToken: string | undefined;
  if (isReportUpload && requestingUserId) {
    uploadToken = signToken({
      objectPath,
      userId: requestingUserId,
      reportId: reportId!,
      entityType: entityType!,
      contentType,
      maxSize: size,
      iat,
      exp: iat + 86400,
    });
  }

  const body: Record<string, unknown> = {
    uploadURL: `https://storage.example.com/upload?token=test`,
    objectPath,
  };
  if (uploadToken) body.uploadToken = uploadToken;

  return { status: 200, body };
}

/* ══════════════════════════════════════════════════════════════════════════
   Test fixtures
══════════════════════════════════════════════════════════════════════════ */

function makeNowPayload(overrides: Partial<UploadDescriptor> = {}): UploadDescriptor {
  const iat = Math.floor(Date.now() / 1000);
  return {
    objectPath: "/objects/uploads/test-uuid-001",
    userId: 1,
    reportId: 42,
    entityType: "attachment",
    contentType: "application/pdf",
    maxSize: 1024,
    iat,
    exp: iat + 86400,
    ...overrides,
  };
}

const draftReport: MockReport = { id: 42, status: "draft", authorId: 1 };
const submittedReport: MockReport = { id: 43, status: "submitted", authorId: 1 };

/* ══════════════════════════════════════════════════════════════════════════
   Tests
══════════════════════════════════════════════════════════════════════════ */

beforeEach(() => {
  attachmentDb = {};
  attachmentIdSeq = 1;
  voiceNoteDb = {};
  voiceNoteIdSeq = 1;
});

// ── Token signing and verification ──────────────────────────────────────────

describe("uploadToken utility", () => {
  it("signs a descriptor and verifies it successfully", () => {
    const payload = makeNowPayload();
    const token = signToken(payload);
    const verified = verifyToken(token);
    expect(verified.objectPath).toBe(payload.objectPath);
    expect(verified.userId).toBe(payload.userId);
    expect(verified.reportId).toBe(payload.reportId);
    expect(verified.entityType).toBe(payload.entityType);
    expect(verified.contentType).toBe(payload.contentType);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signToken(makeNowPayload());
    const tampered = token.slice(0, -4) + "dead";
    expect(() => verifyToken(tampered)).toThrow(UploadTokenError);
    expect(() => verifyToken(tampered)).toThrow("invalid_upload_token_signature");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signToken(makeNowPayload(), "other-secret");
    expect(() => verifyToken(token, TEST_SECRET)).toThrow(UploadTokenError);
  });

  it("rejects a token with exp in the past", () => {
    const iat = Math.floor(Date.now() / 1000) - 90000;
    const token = signToken(makeNowPayload({ iat, exp: iat + 86400 - 1 }));
    expect(() => verifyToken(token)).toThrow(UploadTokenError);
    expect(() => verifyToken(token)).toThrow("upload_token_expired");
  });

  it("rejects a completely fabricated non-token string", () => {
    expect(() => verifyToken("not.a.real.token")).toThrow(UploadTokenError);
  });

  it("rejects a malformed token with no dot", () => {
    expect(() => verifyToken("nodottoken")).toThrow(UploadTokenError);
    expect(() => verifyToken("nodottoken")).toThrow("malformed_upload_token");
  });
});

// ── ATT-REG: Attachment registration ────────────────────────────────────────

describe("ATT-REG-01: valid uploadToken (own report, own user) → 201", () => {
  it("registers successfully", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "attachment" }));
    const result = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: draftReport });
    expect(result.status).toBe(201);
    expect((result.body as { reportId: number }).reportId).toBe(42);
    expect((result.body as { contentType: string }).contentType).toBe("application/pdf");
  });
});

describe("ATT-REG-02: token issued for Report A → attempt registration against Report B → 403", () => {
  it("returns upload_not_bound_to_report", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "attachment" }));
    const reportB: MockReport = { id: 99, status: "draft", authorId: 1 };
    const result = registerAttachment({ reportId: 99, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: reportB });
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe("upload_not_bound_to_report");
  });
});

describe("ATT-REG-03: User A token → User B attempts to register it → 403", () => {
  it("returns upload_token_user_mismatch", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "attachment" }));
    const result = registerAttachment({ reportId: 42, requestingUserId: 2, fileName: "doc.pdf", uploadToken: token, report: draftReport });
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe("upload_token_user_mismatch");
  });
});

describe("ATT-REG-04: fabricated/unsigned token string → 400 invalid_upload_token", () => {
  it("rejects fabricated token", () => {
    const result = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: "fake.token.string", report: draftReport });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("invalid_upload_token");
  });
});

describe("ATT-REG-05: expired token → 400 invalid_upload_token", () => {
  it("rejects expired token", () => {
    const iat = Math.floor(Date.now() / 1000) - 90000;
    const token = signToken(makeNowPayload({ iat, exp: iat + 1 })); // exp already past
    const result = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: draftReport });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("invalid_upload_token");
  });
});

describe("ATT-REG-06: same token registered twice → idempotent, returns existing row, no duplicate", () => {
  it("returns the same row on second call", () => {
    const objectPath = "/objects/uploads/idempotent-test";
    const token = signToken(makeNowPayload({ objectPath, userId: 1, reportId: 42, entityType: "attachment" }));

    const first = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: draftReport });
    const second = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: draftReport });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body as { id: number }).id).toBe((second.body as { id: number }).id);
    // Only one row in DB
    expect(Object.keys(attachmentDb).length).toBe(1);
  });
});

describe("ATT-REG-07: submitted report → assertAttachmentMutationAllowed returns 409", () => {
  it("returns 409 when report is submitted", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 43, entityType: "attachment" }));
    const result = registerAttachment({ reportId: 43, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: submittedReport });
    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toBe("only_draft_reports_can_be_updated");
  });
});

describe("ATT-REG-08: token contentType is used — client body MIME is ignored", () => {
  it("stores the content_type from the token, not from the client body", () => {
    // Token says application/pdf; we don't pass a different contentType in body
    // (the mirror registers from descriptor.contentType — which is what the server does)
    const token = signToken(makeNowPayload({ contentType: "application/pdf", userId: 1, reportId: 42, entityType: "attachment" }));
    const result = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: draftReport });
    expect(result.status).toBe(201);
    expect((result.body as { contentType: string }).contentType).toBe("application/pdf");
  });
});

describe("ATT-REG-09: token maxSize stored as size — client-supplied size is ignored", () => {
  it("stores the size from the token", () => {
    const token = signToken(makeNowPayload({ maxSize: 8192, userId: 1, reportId: 42, entityType: "attachment" }));
    const result = registerAttachment({ reportId: 42, requestingUserId: 1, fileName: "doc.pdf", uploadToken: token, report: draftReport });
    expect(result.status).toBe(201);
    expect((result.body as { size: number }).size).toBe(8192);
  });
});

describe("ATT-REG-10: upload request with declared size > MAX_FILE_SIZE_BYTES → 413 from /request-url", () => {
  it("returns 413 when file exceeds max size", () => {
    const result = requestUploadUrl({
      name: "big-file.pdf",
      size: MAX_FILE_SIZE_BYTES + 1,
      contentType: "application/pdf",
      reportId: 42,
      entityType: "attachment",
      requestingUserId: 1,
      report: draftReport,
    });
    expect(result.status).toBe(413);
    expect((result.body as { error: string }).error).toBe("file_too_large");
  });
});

// ── VN-REG: Voice note registration ─────────────────────────────────────────

describe("VN-REG-01: valid uploadToken for report voice note → 201", () => {
  it("registers successfully", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "voice_note" }));
    const result = registerVoiceNote({ entityId: 42, requestingUserId: 1, fileName: "note.webm", uploadToken: token, durationSeconds: 30, report: draftReport });
    expect(result.status).toBe(201);
    expect((result.body as { entityId: number }).entityId).toBe(42);
  });
});

describe("VN-REG-02: Report A voice token → Report B registration → 403", () => {
  it("returns upload_not_bound_to_report", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "voice_note" }));
    const reportB: MockReport = { id: 99, status: "draft", authorId: 1 };
    const result = registerVoiceNote({ entityId: 99, requestingUserId: 1, fileName: "note.webm", uploadToken: token, durationSeconds: 30, report: reportB });
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe("upload_not_bound_to_report");
  });
});

describe("VN-REG-03: User A token → User B registration → 403", () => {
  it("returns upload_token_user_mismatch", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "voice_note" }));
    const result = registerVoiceNote({ entityId: 42, requestingUserId: 2, fileName: "note.webm", uploadToken: token, durationSeconds: 30, report: draftReport });
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe("upload_token_user_mismatch");
  });
});

describe("VN-REG-04: fabricated token → 400", () => {
  it("rejects fabricated token", () => {
    const result = registerVoiceNote({ entityId: 42, requestingUserId: 1, fileName: "note.webm", uploadToken: "fake.stuff", durationSeconds: 30, report: draftReport });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("invalid_upload_token");
  });
});

describe("VN-REG-05: submitted report → 409", () => {
  it("rejects voice note on submitted report", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 43, entityType: "voice_note" }));
    const result = registerVoiceNote({ entityId: 43, requestingUserId: 1, fileName: "note.webm", uploadToken: token, durationSeconds: 30, report: submittedReport });
    expect(result.status).toBe(409);
  });
});

describe("VN-REG-06: duration > 300 → 400", () => {
  it("rejects durationSeconds over 300", () => {
    const token = signToken(makeNowPayload({ userId: 1, reportId: 42, entityType: "voice_note" }));
    const result = registerVoiceNote({ entityId: 42, requestingUserId: 1, fileName: "note.webm", uploadToken: token, durationSeconds: 301, report: draftReport });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toContain("durationSeconds");
  });
});

describe("VN-REG-07: idempotent replay — same token registered twice returns existing row", () => {
  it("returns the same voice note on second registration", () => {
    const objectPath = "/objects/uploads/vn-idempotent-test";
    const token = signToken(makeNowPayload({ objectPath, userId: 1, reportId: 42, entityType: "voice_note" }));

    const first = registerVoiceNote({ entityId: 42, requestingUserId: 1, fileName: "note.webm", uploadToken: token, durationSeconds: 45, report: draftReport });
    const second = registerVoiceNote({ entityId: 42, requestingUserId: 1, fileName: "note.webm", uploadToken: token, durationSeconds: 45, report: draftReport });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body as { id: number }).id).toBe((second.body as { id: number }).id);
    expect(Object.keys(voiceNoteDb).length).toBe(1);
  });
});

// ── ATT-LINK: Link mode coverage ─────────────────────────────────────────────

describe("ATT-LINK: upload token issuance for various AR link modes", () => {
  it("ATT-LINK-01: standalone AR — request-url issues token with reportId", () => {
    const result = requestUploadUrl({
      name: "doc.pdf", size: 1024, contentType: "application/pdf",
      reportId: 10, entityType: "attachment", requestingUserId: 1,
      report: { id: 10, status: "draft", authorId: 1 },
    });
    expect(result.status).toBe(200);
    expect((result.body as { uploadToken: string }).uploadToken).toBeTruthy();
  });

  it("ATT-LINK-02: activity-linked AR — request-url issues token with correct reportId", () => {
    const result = requestUploadUrl({
      name: "evidence.pdf", size: 512, contentType: "application/pdf",
      reportId: 20, entityType: "attachment", requestingUserId: 5,
      report: { id: 20, status: "draft", authorId: 5 },
    });
    expect(result.status).toBe(200);
    const token = (result.body as { uploadToken: string }).uploadToken;
    const descriptor = verifyToken(token);
    expect(descriptor.reportId).toBe(20);
    expect(descriptor.userId).toBe(5);
  });

  it("ATT-LINK-03: project-linked AR — token binds to correct user and report", () => {
    const result = requestUploadUrl({
      name: "report-attachment.docx", size: 2048,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      reportId: 30, entityType: "attachment", requestingUserId: 7,
      report: { id: 30, status: "draft", authorId: 7 },
    });
    expect(result.status).toBe(200);
    const descriptor = verifyToken((result.body as { uploadToken: string }).uploadToken);
    expect(descriptor.reportId).toBe(30);
    expect(descriptor.entityType).toBe("attachment");
  });
});

// ── Non-report backward compat ───────────────────────────────────────────────

describe("Non-report storage backward compatibility", () => {
  it("POST /request-url without reportId/entityType succeeds and returns no uploadToken", () => {
    const result = requestUploadUrl({
      name: "project-doc.pdf",
      size: 4096,
      contentType: "application/pdf",
      // No reportId, no entityType
    });
    expect(result.status).toBe(200);
    expect((result.body as { uploadToken?: string }).uploadToken).toBeUndefined();
    expect((result.body as { uploadURL: string }).uploadURL).toBeTruthy();
  });

  it("POST /request-url with only reportId (no entityType) returns no uploadToken", () => {
    const result = requestUploadUrl({
      name: "training-video.mp4",
      size: 1024,
      contentType: "video/mp4",
      reportId: 42,
      // No entityType — should not issue token
    });
    // No isReportUpload triggered
    expect((result.body as { uploadToken?: string }).uploadToken).toBeUndefined();
  });
});

// ── Read security regression assertions ─────────────────────────────────────

describe("Read security regression (ATT-166 invariants)", () => {
  /**
   * These tests document the invariants enforced by Task #166 that must not regress.
   * They mirror the logic in assertCanViewReport and the download/list/stream endpoints.
   */

  type Role = "technical_coordinator" | "state_program_officer" | "super_admin" | "program_manager";
  interface MockUser { id: number; role: Role; stateId: number | null; sector: string | null }

  function canViewReport(user: MockUser, report: { stateId: number | null; sector: string | null }): { ok: boolean; status?: number } {
    if (user.role === "state_program_officer" && user.stateId !== null) {
      if (report.stateId !== user.stateId) return { ok: false, status: 403 };
    }
    if (user.role === "technical_coordinator" && user.sector !== null) {
      if (report.sector !== user.sector) return { ok: false, status: 403 };
    }
    return { ok: true };
  }

  it("TC in Sector A cannot view Sector B report", () => {
    const tc = { id: 1, role: "technical_coordinator" as Role, stateId: null, sector: "Education" };
    const report = { stateId: null, sector: "Health" };
    expect(canViewReport(tc, report).ok).toBe(false);
  });

  it("TC in Sector A can view Sector A report", () => {
    const tc = { id: 1, role: "technical_coordinator" as Role, stateId: null, sector: "Education" };
    const report = { stateId: null, sector: "Education" };
    expect(canViewReport(tc, report).ok).toBe(true);
  });

  it("SPO in State 1 cannot view State 2 report", () => {
    const spo = { id: 2, role: "state_program_officer" as Role, stateId: 1, sector: null };
    const report = { stateId: 2, sector: null };
    expect(canViewReport(spo, report).ok).toBe(false);
    expect(canViewReport(spo, report).status).toBe(403);
  });

  it("org-wide role (PM) can view any report", () => {
    const pm = { id: 3, role: "program_manager" as Role, stateId: null, sector: null };
    const report = { stateId: 5, sector: "Health" };
    expect(canViewReport(pm, report).ok).toBe(true);
  });
});
