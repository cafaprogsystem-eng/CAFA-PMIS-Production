/**
 * FILES-SECTOR-SCOPE-GATE — program_resources' `sector` field was purely a
 * display/filter tag: a Technical Coordinator scoped to one sector could see
 * and download a resource tagged with any other sector, unlike every other
 * record type in files.ts (projectScopeSql/planScopeSql/reportScopeSql all
 * restrict a TC to their own assigned sector(s)). Business decision (this
 * session): enforce sector as a real access boundary for TCs here too, same
 * as everywhere else — only technical_coordinator is sector-restricted (no
 * other role is), and "General / Cross-Cutting" (not one of the 7 sectors a
 * TC can ever be assigned to) stays visible to every TC rather than becoming
 * permanently invisible to all of them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Request } from "express";
import { resourceSectorScopeSql } from "../routes/files";

const src = readFileSync(resolve(__dirname, "../routes/files.ts"), "utf8");

function reqWith(role: string, sectors: string[] | null = null): Request {
  return { currentUser: { id: 1, role, sector: null, sectors, stateId: null } } as unknown as Request;
}

describe("FILES-SECTOR-SCOPE-GATE: resourceSectorScopeSql", () => {
  it("archive managers get an unconditional TRUE, no param pushed", () => {
    for (const role of ["super_admin", "executive_director", "program_manager"]) {
      const params: unknown[] = [];
      expect(resourceSectorScopeSql(reqWith(role), params)).toBe("TRUE");
      expect(params).toEqual([]);
    }
  });

  it("every non-TC role is unrestricted by sector", () => {
    for (const role of ["state_program_officer", "state_office_manager", "senior_program_coordinator", "viewer"]) {
      const params: unknown[] = [];
      expect(resourceSectorScopeSql(reqWith(role), params)).toBe("TRUE");
      expect(params).toEqual([]);
    }
  });

  it("a TC with assigned sectors gets a fragment matching their own sectors, or General / Cross-Cutting", () => {
    const params: unknown[] = [];
    const sql = resourceSectorScopeSql(reqWith("technical_coordinator", ["Health", "WASH"]), params);
    expect(params).toEqual([["Health", "WASH"]]);
    expect(sql).toContain("pr.sector = ANY($1::text[])");
    expect(sql).toContain("OR pr.sector = 'General / Cross-Cutting'");
  });

  it("a TC with no assigned sectors is denied outright (fail-closed, matching projectScopeSql's own convention)", () => {
    const params: unknown[] = [];
    expect(resourceSectorScopeSql(reqWith("technical_coordinator", []), params)).toBe("FALSE");
    expect(params).toEqual([]);
  });
});

describe("FILES-SECTOR-SCOPE-GATE: wired into both the listing query and the single-item lookup", () => {
  it("baseProjectionSql's resource branch ANDs the sector gate alongside the confidentiality gate", () => {
    const resourceBranch = src.slice(src.indexOf("FROM program_resources pr"), src.indexOf("UNION ALL"));
    expect(resourceBranch).toContain("resourceConfidentialitySql(req, params)");
    expect(resourceBranch).toContain("resourceSectorScopeSql(req, params)");
  });

  it("privateItem denies a resource outside a TC's own sector(s), except General / Cross-Cutting", () => {
    const privateItemFn = src.slice(src.indexOf("async function privateItem"), src.indexOf("async function streamArchiveItem"));
    expect(privateItemFn).toContain("pr.sector");
    expect(privateItemFn).toContain('row.sector !== "General / Cross-Cutting"');
    expect(privateItemFn).toContain('user.role === "technical_coordinator" && !archiveManager(req)');
  });
});
