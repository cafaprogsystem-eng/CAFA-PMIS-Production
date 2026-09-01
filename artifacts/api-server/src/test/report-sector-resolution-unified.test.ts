/**
 * REPORT-SECTOR-RESOLUTION-UNIFIED — the report-sector-resolution rule
 * (Project Reports use the linked Project's sector exclusively; Activity
 * Reports are source-aware; other types fall back to
 * COALESCE(NULLIF(r.sector,''), p.sector)) used to be hand-duplicated three
 * times byte-for-byte: routes/reports.ts's getReportSector,
 * lib/reportAuth.ts's getReportSectorForAuth, and lib/reportAuth.ts's own
 * second copy getReportSectorForMutation. A fix to the rule in one copy
 * could silently miss the other two. All call sites now use the single
 * exported getReportSectorForAuth; the other two implementations were
 * deleted entirely.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reportsSrc = readFileSync(resolve(__dirname, "../routes/reports.ts"), "utf8");
const reportAuthSrc = readFileSync(resolve(__dirname, "../lib/reportAuth.ts"), "utf8");

describe("REPORT-SECTOR-RESOLUTION-UNIFIED: only one implementation remains", () => {
  it("routes/reports.ts no longer declares its own getReportSector", () => {
    expect(reportsSrc).not.toMatch(/async function getReportSector\(/);
  });

  it("lib/reportAuth.ts no longer declares getReportSectorForMutation", () => {
    expect(reportAuthSrc).not.toMatch(/async function getReportSectorForMutation\(/);
  });

  it("lib/reportAuth.ts still exports exactly one canonical getReportSectorForAuth", () => {
    const matches = reportAuthSrc.match(/export async function getReportSectorForAuth\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("routes/reports.ts imports the shared helper and every call site uses it", () => {
    expect(reportsSrc).toContain(
      'import { assertCanViewReport, assertAttachmentMutationAllowed, hasActiveTcForSector, hasActiveSpoForState, getReportSectorForAuth } from "../lib/reportAuth";',
    );
    const callSites = [...reportsSrc.matchAll(/await getReportSectorForAuth\(reportId\)/g)];
    expect(callSites.length).toBe(4);
    expect(reportsSrc).not.toMatch(/await getReportSector\(reportId\)/);
  });

  it("assertAttachmentMutationAllowed's mutation-scope check now calls the shared helper too", () => {
    expect(reportAuthSrc).toContain("const sector = await getReportSectorForAuth(reportId);");
    expect(reportAuthSrc).not.toContain("const sector = await getReportSectorForMutation(reportId);");
  });
});
