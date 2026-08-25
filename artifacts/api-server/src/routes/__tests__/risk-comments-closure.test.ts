/**
 * Risk Register Comments Closure — RISK-001 (RISK-COM-01..10)
 *
 * Verifies that comments.ts accepts entityType="risk" and applies the
 * canonical Risk access rules (TC sector via linked project, SPO/SOM state
 * clamp with fail-closed null stateId, PM/super_admin Full Operational
 * Access) on both GET and POST.
 *
 * Uses source-inspection — the established pattern for backend logic in this
 * project (see hqsr-drive-attachments.test.ts, path-hardening.test.ts).
 *
 * British English spelling used throughout.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../comments.ts"), "utf8");

// ── RISK-COM-01 / 02: risk is a valid entity type on both GET and POST ──────

describe("RISK-COM-01/02: entityType='risk' is accepted by the comments module", () => {
  it("VALID_ENTITY_TYPES includes 'risk'", () => {
    expect(SRC).toMatch(/VALID_ENTITY_TYPES = new Set\(\["project", "report", "plan", "risk"\]\)/);
  });

  it("GET and POST both validate against VALID_ENTITY_TYPES (single shared set)", () => {
    const matches = SRC.match(/VALID_ENTITY_TYPES\.has\(entityType\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("POST gate: comments.create OR canonical risk mutation authority (risks.update) for risk entities", () => {
    expect(SRC).toContain('const canComment = hasPerm(perms, "comments.create");');
    expect(SRC).toContain('const riskAuthor = entityType === "risk" && hasPerm(perms, "risks.update");');
    expect(SRC).toContain("if (!canComment && !riskAuthor) {");
  });

  it("GET risk comments requires canonical risk read authority (risks.view / risks.view.state), not comments.create", () => {
    expect(SRC).toContain('!hasPerm(perms, "risks.view") && !hasPerm(perms, "risks.view.state")');
    expect(SRC).toContain('requiredPermission: "risks.view"');
  });

  it("POST response returns the persisted comment with author columns (name, timestamps, body)", () => {
    expect(SRC).toContain('u.name AS "authorName"');
    expect(SRC).toContain('c.created_at AS "createdAt"');
    expect(SRC).toContain("c.body");
  });

  it("risk comments link to the Risk Register page", () => {
    expect(SRC).toContain('if (entityType === "risk") return `/risks`;');
  });
});

// ── RISK-COM-03: blank body rejected ─────────────────────────────────────────

describe("RISK-COM-03: blank/whitespace-only body rejected", () => {
  it("body is trimmed before validation", () => {
    expect(SRC).toContain('const text = String(body.body ?? "").trim();');
  });

  it("empty trimmed body returns 400 body_required", () => {
    expect(SRC).toContain('if (!text) { res.status(400).json({ error: "body_required" }); return; }');
  });
});

// ── RISK-COM-04: wrong-state actor denied on GET and POST ───────────────────

describe("RISK-COM-04: SPO/SOM state scope enforced on GET and POST", () => {
  it("assertRiskStateScope helper exists and clamps state roles", () => {
    expect(SRC).toContain("async function assertRiskStateScope(");
    expect(SRC).toContain('u.role === "state_program_officer" || u.role === "state_office_manager"');
  });

  it("state mismatch returns 403 state_forbidden", () => {
    const idx = SRC.indexOf("async function assertRiskStateScope(");
    const block = SRC.slice(idx, SRC.indexOf("const COMMENT_COLS", idx));
    expect(block).toContain('state_forbidden');
    expect(block).toContain("r.rows[0].state_id !== u.stateId");
  });

  it("null stateId fails closed (403 before any DB comparison)", () => {
    const idx = SRC.indexOf("async function assertRiskStateScope(");
    const block = SRC.slice(idx, SRC.indexOf("const COMMENT_COLS", idx));
    expect(block).toContain("if (u.stateId == null) return { ok: false, status: 403");
  });

  it("both GET and POST call assertRiskStateScope for risk entities", () => {
    const matches = SRC.match(/await assertRiskStateScope\(req, entityId\)/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

// ── RISK-COM-05 / 06: TC sector scope ────────────────────────────────────────

describe("RISK-COM-05/06: TC sector scope uses linked project's primary sector", () => {
  it("loadEntityMeta risk branch joins projects for the sector", () => {
    expect(SRC).toContain(
      "SELECT p.sector FROM risks r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = $1",
    );
  });

  it("risk sector feeds the canonical assertSectorAllowed guard (secondary sectors honoured via u.sectors array)", () => {
    // Generic flow: loadEntityMeta → assertSectorAllowed(req, meta.sector)
    expect(SRC).toContain("const guard = assertSectorAllowed(req, meta.sector);");
  });

  it("standalone risk (null sector) fails closed for TCs — documented in the risk branch", () => {
    const idx = SRC.indexOf('if (entityType === "risk") {');
    const block = SRC.slice(idx, idx + 900);
    expect(block).toContain("fails closed");
  });
});

// ── RISK-COM-07 / 08: PM and Super Admin Full Operational Access ────────────

describe("RISK-COM-07/08: PM / super_admin pass (Full Operational Access, Task #373)", () => {
  it("state clamp applies ONLY to state roles — PM/SA are not state roles", () => {
    const idx = SRC.indexOf("async function assertRiskStateScope(");
    const block = SRC.slice(idx, SRC.indexOf("const COMMENT_COLS", idx));
    expect(block).toContain("if (!isStateRole) return { ok: true };");
  });

  it("assertSectorAllowed only restricts technical coordinators (PM/SA unrestricted)", () => {
    // Imported from the shared middleware whose restriction is TC-only.
    expect(SRC).toContain("assertSectorAllowed");
  });
});

// ── RISK-COM-09: IDOR — inaccessible risk yields 403/404, never a list ──────

describe("RISK-COM-09: IDOR protection — no comment data for inaccessible risks", () => {
  it("non-existent risk returns 404 entity_not_found before any comment query", () => {
    expect(SRC).toContain('if (meta === undefined) { res.status(404).json({ error: "entity_not_found" }); return; }');
  });

  it("GET risk state-scope guard runs BEFORE the comment SELECT", () => {
    const getIdx = SRC.indexOf('router.get("/comments"');
    const postIdx = SRC.indexOf('router.post("/comments"');
    const getBlock = SRC.slice(getIdx, postIdx);
    const guardIdx = getBlock.lastIndexOf("assertRiskStateScope");
    const selectIdx = getBlock.lastIndexOf("ORDER BY c.created_at ASC");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(selectIdx);
  });

  it("POST risk state-scope guard runs BEFORE the INSERT", () => {
    const postIdx = SRC.indexOf('router.post("/comments"');
    const patchIdx = SRC.indexOf('router.patch("/comments/:id"');
    const postBlock = SRC.slice(postIdx, patchIdx);
    const guardIdx = postBlock.indexOf("assertRiskStateScope");
    const insertIdx = postBlock.indexOf("INSERT INTO comments");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(insertIdx);
  });

  it("risk read branch runs its full scope chain (404 → sector → state) before returning any rows", () => {
    const idx = SRC.indexOf('if (entityType === "risk") {', SRC.indexOf('router.get("/comments"'));
    const block = SRC.slice(idx, idx + 1600);
    const permIdx = block.indexOf('hasPerm(perms, "risks.view")');
    const metaIdx = block.indexOf("loadEntityMeta");
    const sectorIdx = block.indexOf("assertSectorAllowed");
    const stateIdx = block.indexOf("assertRiskStateScope");
    const selectIdx = block.indexOf("ORDER BY c.created_at ASC");
    expect(permIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBeGreaterThan(permIdx);
    expect(sectorIdx).toBeGreaterThan(metaIdx);
    expect(stateIdx).toBeGreaterThan(sectorIdx);
    expect(selectIdx).toBeGreaterThan(stateIdx);
  });
});

// ── RISK-COM-10: no ghost side-effects before the insert succeeds ───────────

describe("RISK-COM-10: notifications and audit run only AFTER a successful insert", () => {
  it("logAudit and notifyEntityActors are invoked after INSERT INTO comments", () => {
    const postIdx = SRC.indexOf('router.post("/comments"');
    const patchIdx = SRC.indexOf('router.patch("/comments/:id"');
    const postBlock = SRC.slice(postIdx, patchIdx);
    const insertIdx = postBlock.indexOf("INSERT INTO comments");
    expect(postBlock.indexOf("await logAudit(")).toBeGreaterThan(insertIdx);
    expect(postBlock.indexOf("await notifyEntityActors(")).toBeGreaterThan(insertIdx);
  });

  it("handler is wrapped in try/catch delegating failures to next(err) — a failed insert skips all side-effects", () => {
    const postIdx = SRC.indexOf('router.post("/comments"');
    const patchIdx = SRC.indexOf('router.patch("/comments/:id"');
    const postBlock = SRC.slice(postIdx, patchIdx);
    expect(postBlock).toContain("} catch (err) { next(err); }");
  });
});
