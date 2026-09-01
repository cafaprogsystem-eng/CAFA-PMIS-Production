/**
 * REPORT-STATUS-GROUPS-PAGINATION-HAZARD — every STATUS_GROUPS entry
 * (reports.tsx) currently maps to exactly one backend status, so the
 * `bs.length === 1` guard always passes query.status through to GET /reports
 * and the client-side re-filter (the `reports` useMemo) is presently a no-op.
 * A future multi-value group would silently skip the server-side status
 * filter (GET /reports's own filter is single-value equality — no array/CSV
 * support), while the server's LIMIT/OFFSET pagination would already have run
 * on the unfiltered-by-status set: reportsRaw.total/totalPages would then
 * describe a different population than what's rendered, and no client-side
 * fix can recover the rows the server's pagination already discarded. This is
 * documented at both ends (the STATUS_GROUPS definition and the consuming
 * useMemo) rather than silently left for a future maintainer to rediscover —
 * a full fix requires adding real multi-status support to GET /reports first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/reports.tsx"), "utf8");

describe("REPORT-STATUS-GROUPS-PAGINATION-HAZARD: documented at the definition and the consuming site", () => {
  it("STATUS_GROUPS still has every entry as a single-value array (today's actual, safe state)", () => {
    const match = src.match(/const STATUS_GROUPS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/);
    expect(match).not.toBeNull();
    const entries = [...match![1].matchAll(/:\s*\[([^\]]*)\]/g)];
    expect(entries.length).toBeGreaterThan(0);
    for (const [, arrBody] of entries) {
      const values = arrBody.split(",").map((s) => s.trim()).filter(Boolean);
      expect(values.length).toBe(1);
    }
  });

  it("the pagination-mismatch hazard is documented right on STATUS_GROUPS's own definition", () => {
    expect(src).toContain("Do NOT add a multi-value group here without FIRST adding real multi-status");
    expect(src).toContain("reportsRaw.total/totalPages");
  });

  it("the consuming useMemo also points back to the warning", () => {
    expect(src).toContain("Currently a no-op — every STATUS_GROUPS entry maps to exactly one backend");
  });
});
