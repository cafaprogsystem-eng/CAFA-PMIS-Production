/**
 * Risk Register Attachment Access Security — RISK-004 (RISK-EVID-01..10)
 *
 * Verifies that drive.ts enforces parent-Risk access on every route touching
 * module='risks' rows (list, upload, download, patch/delete, replace,
 * versions), derives risk attachment metadata server-side, and restricts the
 * risks DTO to user-facing fields.
 *
 * Uses source-inspection — the established pattern for backend logic in this
 * project (see hqsr-drive-attachments.test.ts, path-hardening.test.ts).
 *
 * British English spelling used throughout.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../drive.ts"), "utf8");

function routeBlock(startMarker: string, endMarker: string): string {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, end > start ? end : SRC.length);
}

// ── The canonical guard helper ───────────────────────────────────────────────

describe("assertRiskAccessForDriveOperation — canonical parent-risk guard", () => {
  it("helper exists and loads the risk with its linked project's sector", () => {
    expect(SRC).toContain("async function assertRiskAccessForDriveOperation(");
    expect(SRC).toContain(
      `SELECT r.state_id AS "stateId", r.project_id AS "projectId", p.sector`,
    );
    expect(SRC).toContain("FROM risks r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1");
  });

  it("applies the shared TC sector guard (assertSectorAllowed) on the risk's project sector", () => {
    const idx = SRC.indexOf("async function assertRiskAccessForDriveOperation(");
    const block = SRC.slice(idx, SRC.indexOf("function hasRiskMutationPerm", idx));
    expect(block).toContain("assertSectorAllowed(req, risk.sector)");
  });

  it("clamps SPO/SOM to their own state with fail-closed null stateId", () => {
    const idx = SRC.indexOf("async function assertRiskAccessForDriveOperation(");
    const block = SRC.slice(idx, SRC.indexOf("function hasRiskMutationPerm", idx));
    expect(block).toContain('u.role === "state_program_officer" || u.role === "state_office_manager"');
    expect(block).toContain("u.stateId == null || risk.stateId !== u.stateId");
    expect(block).toContain("state_forbidden");
  });

  it("mutation authority helper requires risks.update (PM via Full Operational Access grants, SA via wildcard)", () => {
    expect(SRC).toContain("function hasRiskMutationPerm(");
    expect(SRC).toContain('hasPerm(permissionsFor(req.currentUser!), "risks.update")');
  });
});

// ── RISK-EVID-01: list requires parent-risk access ───────────────────────────

describe("RISK-EVID-01: GET /drive/files enforces parent-risk access for module='risks'", () => {
  it("list handler calls the guard before building the query", () => {
    const block = routeBlock('router.get("/drive/files", requireAuth', "const params: unknown[] = [];");
    expect(block).toContain('if (module === "risks") {');
    expect(block).toContain("await assertRiskAccessForDriveOperation(req, recordId)");
  });
});

// ── RISK-EVID-02: upload gated + server-derived metadata ─────────────────────

describe("RISK-EVID-02: POST /drive/upload enforces risk access + mutation authority", () => {
  const block = routeBlock('router.post("/drive/upload"', 'router.get("/drive/files"');

  it("upload guard runs before the S3 upload", () => {
    const guardIdx = block.indexOf("assertRiskAccessForDriveOperation(req, recordId)");
    const uploadIdx = block.indexOf("await uploadFile({");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(uploadIdx);
  });

  it("upload requires risk mutation permission", () => {
    expect(block).toContain("if (!hasRiskMutationPerm(req)) {");
    expect(block).toContain('requiredPermission: "risks.update"');
  });

  it("server derives stateId, sector and projectId from the loaded risk (caller values ignored)", () => {
    expect(block).toContain("riskParent ? riskParent.projectId :");
    expect(block).toContain("riskParent ? riskParent.stateId :");
    expect(block).toContain("riskParent ? riskParent.sector :");
  });

  it("upload response for risks is the allow-list DTO with driveLink nulled (raw S3 key never leaks)", () => {
    expect(block).toContain('module === "risks" ? { ...riskAttachmentDto(rows[0]), driveLink: null } : rows[0]');
  });
});

// ── RISK-EVID-03: download gated + sanitised filename ────────────────────────

describe("RISK-EVID-03: download enforces parent-risk access and sanitises the filename", () => {
  const block = routeBlock('router.get("/drive/files/:id/download"', 'router.get("/drive/admin/status"');

  it("download loads the file's module and record_id", () => {
    expect(block).toContain('record_id AS "recordId"');
  });

  it("risks branch uses the parent-risk guard, not the file's own metadata", () => {
    expect(block).toContain('if (file.module === "risks") {');
    expect(block).toContain("assertRiskAccessForDriveOperation(req, file.recordId)");
  });

  it("legacy metadata filters remain for non-risk modules only (else branch)", () => {
    const riskIdx = block.indexOf('if (file.module === "risks") {');
    const elseIdx = block.indexOf("} else {", riskIdx);
    expect(elseIdx).toBeGreaterThan(riskIdx);
  });

  it("Content-Disposition filename passes through sanitiseFilename", () => {
    expect(block).toContain("sanitiseFilename(String(file.name");
  });

  it("sanitiseFilename strips path separators and control characters", () => {
    expect(SRC).toContain("function sanitiseFilename(");
    expect(SRC).toContain("\\u0000-\\u001f\\u007f");
  });
});

// ── RISK-EVID-04: delete/status change gated ─────────────────────────────────

describe("RISK-EVID-04: PATCH /drive/files/:id enforces risk access + mutation authority", () => {
  const block = routeBlock('router.patch("/drive/files/:id"', 'router.post("/drive/files/:id/replace"');

  it("file is loaded and guarded BEFORE the UPDATE statement", () => {
    const guardIdx = block.indexOf("assertRiskAccessForDriveOperation(req, existing.rows[0].record_id)");
    const updateIdx = block.indexOf("UPDATE drive_files SET status");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(updateIdx);
  });

  it("mutation requires risks.update", () => {
    expect(block).toContain("if (!hasRiskMutationPerm(req)) {");
  });
});

// ── RISK-EVID-05: IDOR — every risk-file route resolves access from the parent risk ──

describe("RISK-EVID-05: IDOR — all risk-file routes route through the parent-risk guard", () => {
  it("guard is invoked in list, upload, download, patch, replace and versions handlers", () => {
    const calls = SRC.match(/assertRiskAccessForDriveOperation\(req,/g) ?? [];
    // 6 call sites (helper definition uses a different signature line)
    expect(calls.length).toBeGreaterThanOrEqual(6);
  });

  it("replace route guards risk attachments too and never returns the raw key", () => {
    const block = routeBlock('router.post("/drive/files/:id/replace"', 'router.get("/drive/files/:id/versions"');
    expect(block).toContain('if (prev.module === "risks") {');
    expect(block).toContain("assertRiskAccessForDriveOperation(req, prev.record_id)");
    expect(block).toContain('prev.module === "risks" ? { ...riskAttachmentDto(rows[0]), driveLink: null } : rows[0]');
  });

  it("versions route guards risk attachments too", () => {
    const block = routeBlock('router.get("/drive/files/:id/versions"', 'router.get("/drive/files/:id/download"');
    expect(block).toContain('module === "risks"');
    expect(block).toContain("assertRiskAccessForDriveOperation(req, root.rows[0]!.record_id)");
  });

  it("versions rows for risk files replace the raw S3 key in driveLink with a presigned URL or null", () => {
    const block = routeBlock('router.get("/drive/files/:id/versions"', 'router.get("/drive/files/:id/download"');
    expect(block).toContain("if (isRiskFile) {");
    expect(block).toContain('presigned.get(r.driveLink)) || null');
  });

  it("log-access route 404s missing files and applies the parent-risk guard (no forged audit events)", () => {
    const block = routeBlock('router.post("/drive/files/:id/log-access"', 'router.patch("/drive/files/:id"');
    const notFoundIdx = block.indexOf('res.status(404).json({ error: "not_found" })');
    const guardIdx = block.indexOf("assertRiskAccessForDriveOperation(req, file.rows[0].record_id)");
    const auditIdx = block.indexOf("await logAudit(");
    expect(notFoundIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(auditIdx);
  });
});

// ── RISK-EVID-06 / 07 / 08: role scoping inside the guard ────────────────────

describe("RISK-EVID-06/07/08: state, sector and Full Operational Access scoping", () => {
  const idx = SRC.indexOf("async function assertRiskAccessForDriveOperation(");
  const guard = SRC.slice(idx, SRC.indexOf("function hasRiskMutationPerm", idx));

  it("wrong-state SPO/SOM denied with 403", () => {
    expect(guard).toContain("risk.stateId !== u.stateId");
    expect(guard).toContain("status: 403");
  });

  it("TC sector scope enforced via assertSectorAllowed (wrong sector → 403 sector_forbidden)", () => {
    expect(guard).toContain("assertSectorAllowed(req, risk.sector)");
  });

  it("PM / super_admin pass: they are neither state roles nor TCs, so no clamp applies", () => {
    // The ONLY denial paths are the 404 (missing risk), the TC sector guard and
    // the state-role clamp — org-wide roles fall through to { ok: true }.
    expect(guard).toContain("return { ok: true, risk };");
  });
});

// ── RISK-EVID-09: DTO excludes internal fields ───────────────────────────────

describe("RISK-EVID-09: risks DTO allow-list excludes internal/structural fields", () => {
  it("riskAttachmentDto exists and returns only user-facing fields", () => {
    const idx = SRC.indexOf("function riskAttachmentDto(");
    const block = SRC.slice(idx, SRC.indexOf("function sanitiseFilename", idx));
    for (const f of ["id:", "name:", "mimeType:", "size:", "status:", "createdAt:", "uploaderName:", "uploaderRole:", "driveLink:", "versionNumber:"]) {
      expect(block).toContain(f);
    }
    for (const banned of ["driveFileId", "recordId", "projectId", "sector", "visibilityLevel", "permissionLevel", "parentFileId", "uploadedByUserId"]) {
      expect(block).not.toContain(`${banned}:`);
    }
  });

  it("list handler applies the DTO for module='risks'", () => {
    const block = routeBlock('router.get("/drive/files", requireAuth', 'router.post("/drive/files/:id/log-access"');
    expect(block).toContain('files = files.map((r) => (r.module === "risks" ? riskAttachmentDto(r) : r));');
    // Generic listings apply parent-risk authorisation at SQL level — the
    // scoped predicate is part of the shared WHERE, so BOTH the page rows and
    // the COUNT total are computed over the accessible set only.
    expect(block).toContain('if (module !== "risks") {');
    expect(block).toContain("EXISTS (SELECT 1 FROM risks r WHERE r.id = df.record_id AND r.state_id =");
    expect(block).toContain("EXISTS (SELECT 1 FROM risks r JOIN projects p ON p.id = r.project_id WHERE r.id = df.record_id AND p.sector = ANY(");
    // Null-state/sectorless scoped roles fail closed: no risk rows at all
    expect(block).toContain("df.module <> 'risks'");
    // Presign fallback for risk rows is null-only — never the raw drive_link
    expect(block).toContain('(r.module === "risks" ? null : r.driveLink)');
  });
});

// ── RISK-EVID-10: malformed / missing recordId → 404 not 500 ─────────────────

describe("RISK-EVID-10: malformed or missing recordId returns 404, never 500", () => {
  it("guard validates recordId is a positive integer before querying", () => {
    const idx = SRC.indexOf("async function assertRiskAccessForDriveOperation(");
    const guard = SRC.slice(idx, SRC.indexOf("function hasRiskMutationPerm", idx));
    expect(guard).toContain("!Number.isInteger(riskId) || riskId <= 0");
    expect(guard).toContain('status: 404, body: { error: "risk_not_found" }');
  });

  it("non-existent risk returns 404 risk_not_found", () => {
    const idx = SRC.indexOf("async function assertRiskAccessForDriveOperation(");
    const guard = SRC.slice(idx, SRC.indexOf("function hasRiskMutationPerm", idx));
    expect(guard).toContain("if (!risk) return { ok: false, status: 404");
  });
});
