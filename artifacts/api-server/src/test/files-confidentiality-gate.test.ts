/**
 * FILES-CONFIDENTIALITY-GATE — program_resources' `confidentiality` field
 * (public/internal/confidential/restricted) was purely decorative: it was
 * shown as a badge and offered as a filter, but visibility/download was
 * gated only on program_resources.view, which every authenticated role
 * holds. Any user could open a file explicitly tagged "restricted".
 *
 * Rule now enforced: public/internal stay visible to anyone with
 * program_resources.view (unchanged); confidential/restricted are visible
 * only to:
 *   - the file's own uploader,
 *   - an ARCHIVE_MANAGERS role (super_admin, executive_director,
 *     program_manager) — the same administrative-override group this file
 *     already uses to bypass project/plan/report scope checks, or
 *   - a State Program Officer, when the resource carries their own state
 *     (program_resources.state_id, a new nullable column — a resource with
 *     no state stays scoped to uploader + archive managers only).
 * Enforced in both the listing query (baseProjectionSql, via
 * resourceConfidentialitySql) and the single-item lookup used by
 * preview/download (privateItem), which returns null (→ 404) rather than
 * 403 so a restricted file's existence isn't distinguishable from a
 * nonexistent one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Request } from "express";
import { resourceConfidentialitySql } from "../routes/files";

const src = readFileSync(resolve(__dirname, "../routes/files.ts"), "utf8");

function reqWith(role: string, id: number, stateId: number | null = null): Request {
  return { currentUser: { id, role, sector: null, sectors: [], stateId } } as unknown as Request;
}

describe("FILES-CONFIDENTIALITY-GATE: resourceConfidentialitySql", () => {
  it("archive managers (super_admin/executive_director/program_manager) get an unconditional TRUE, no param pushed", () => {
    for (const role of ["super_admin", "executive_director", "program_manager"]) {
      const params: unknown[] = [];
      expect(resourceConfidentialitySql(reqWith(role, 99), params)).toBe("TRUE");
      expect(params).toEqual([]);
    }
  });

  it("a non-manager, non-SPO gets a fragment excluding confidential/restricted unless they are the uploader, with only their id pushed", () => {
    const params: unknown[] = [];
    const sql = resourceConfidentialitySql(reqWith("technical_coordinator", 42), params);
    expect(params).toEqual([42]);
    expect(sql).toContain("NOT IN ('confidential', 'restricted')");
    expect(sql).toContain("pr.uploaded_by_id = $1");
    expect(sql).not.toContain("pr.state_id");
  });

  it("a State Program Officer with a state gets an additional OR pr.state_id = $2 clause, their state pushed second", () => {
    const params: unknown[] = [];
    const sql = resourceConfidentialitySql(reqWith("state_program_officer", 7, 3), params);
    expect(params).toEqual([7, 3]);
    expect(sql).toContain("pr.uploaded_by_id = $1");
    expect(sql).toContain("OR pr.state_id = $2");
  });

  it("a State Program Officer with no assigned state gets no state clause (falls back to uploader-only)", () => {
    const params: unknown[] = [];
    const sql = resourceConfidentialitySql(reqWith("state_program_officer", 7, null), params);
    expect(params).toEqual([7]);
    expect(sql).not.toContain("pr.state_id");
  });

  it("falls back to an unmatchable id (-1) when currentUser is missing, rather than passing undefined to the query", () => {
    const params: unknown[] = [];
    const sql = resourceConfidentialitySql({ currentUser: undefined } as unknown as Request, params);
    expect(params).toEqual([-1]);
    expect(sql).toContain("$1");
  });
});

describe("FILES-CONFIDENTIALITY-GATE: wired into both the listing query and the single-item lookup", () => {
  it("baseProjectionSql's resource branch ANDs the confidentiality gate onto the view-permission check", () => {
    const resourceBranch = src.slice(src.indexOf("FROM program_resources pr"), src.indexOf("UNION ALL"));
    expect(resourceBranch).toContain("resourceConfidentialitySql(req, params)");
  });

  it("privateItem denies (returns null) a confidential/restricted resource to a non-manager, non-uploader, non-scoped-SPO viewer", () => {
    const privateItemFn = src.slice(src.indexOf("async function privateItem"), src.indexOf("async function streamArchiveItem"));
    expect(privateItemFn).toContain('COALESCE(dre.confidentiality, pr.confidentiality, \'internal\') AS confidentiality');
    expect(privateItemFn).toMatch(/confidentiality === "confidential" \|\| row\.confidentiality === "restricted"/);
    expect(privateItemFn).toContain('user.role === "state_program_officer" && user.stateId != null && user.stateId === row.state_id');
    expect(privateItemFn).toContain("!archiveManager(req) && row.uploaded_by_id !== user.id && !isScopedSpo) return null;");
  });

  it("program_resources.state_id is a real, migrated, nullable column referencing states(id)", () => {
    const migrations = readFileSync(resolve(__dirname, "../lib/run-migrations.ts"), "utf8");
    expect(migrations).toContain("062_program_resources_state_id");
    expect(migrations).toContain("ADD COLUMN IF NOT EXISTS state_id INTEGER REFERENCES states(id);");
  });
});

describe("FILES-CONFIDENTIALITY-GATE: stateId accepted at upload and editable afterward", () => {
  const uploadRoute = src.slice(src.indexOf('router.post("/files/upload"'), src.indexOf('router.patch("/files/resource/:id"'));
  const patchRoute = src.slice(src.indexOf('router.patch("/files/resource/:id"'), src.indexOf('router.post("/files/resource/:id/replace"'));

  it("POST /files/upload validates an optional stateId as a real states.id before inserting", () => {
    expect(uploadRoute).toContain("const stateIdRaw = req.body?.stateId;");
    expect(uploadRoute).toContain('if (stateId !== null && (!Number.isInteger(stateId) || stateId <= 0)) { res.status(422).json({ error: "invalid_state_id" }); return; }');
    expect(uploadRoute).toContain("SELECT 1 FROM states WHERE id = $1");
    expect(uploadRoute).toContain("uploaded_by_id, confidentiality, retention_years, state_id)");
  });

  it("PATCH /files/resource/:id supports setting, clearing (null), and leaving stateId untouched", () => {
    expect(patchRoute).toContain("const stateIdTouched = stateId !== undefined;");
    expect(patchRoute).toContain("state_id = CASE WHEN $10::boolean THEN $11::integer ELSE state_id END");
  });
});
