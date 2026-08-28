import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_REPORT_TYPES,
  REPORT_SUBMITTED_STATUSES,
} from "../../lib/reportConstants";
import { ACTIVE_RISK_STATUS_SQL } from "../../lib/riskConstants";

const routeSource = readFileSync(
  fileURLToPath(new URL("../dashboard.ts", import.meta.url)),
  "utf8",
);

describe("Dashboard source-population reconciliation", () => {
  it("uses all canonical Report types and submitted workflow statuses", () => {
    expect(CANONICAL_REPORT_TYPES).toEqual([
      "project",
      "activity",
      "program_state",
      "hq_sector",
    ]);
    expect(REPORT_SUBMITTED_STATUSES).toEqual([
      "submitted",
      "state_reviewed",
      "technically_approved",
      "coordination_approved",
      "approved",
      "rejected",
    ]);
    expect(routeSource).toContain('r.report_type AS "reportType"');
    expect(routeSource).not.toContain('r.kind AS "reportType"');
    expect(routeSource).not.toContain("r.kind = 'project'");
  });

  it("derives returned follow-up from current draft state and approval history", () => {
    const standaloneReturnedFixtures = [
      { reportType: "hq_sector", projectId: null },
      { reportType: "program_state", projectId: null },
    ];

    expect(standaloneReturnedFixtures.map((row) => row.reportType)).toEqual([
      "hq_sector",
      "program_state",
    ]);
    expect(routeSource).toMatch(
      /function activeProjectParentSQL[\s\S]*?projectIdExpression} IS NULL[\s\S]*?OR EXISTS/,
    );
    expect(routeSource).toContain("a.entity_type = 'report' AND a.entity_id = r.id");
    expect(routeSource).toContain("ORDER BY a.timestamp DESC, a.id DESC");
    expect(routeSource).not.toContain("ORDER BY a.created_at DESC");
    expect(routeSource).toContain(") = 'request_revision'");
    expect(routeSource).toContain(")::int AS returned");
    expect(routeSource).toContain("returned: Number(c.returned)");
    expect(routeSource).not.toContain("WHERE r.status = 'returned'");
  });

  it("matches Risk activeOnly and covered-State source populations", () => {
    expect(ACTIVE_RISK_STATUS_SQL).toBe(
      "NOT IN ('closed','mitigated','resolved','cancelled')",
    );
    expect(routeSource).toContain("ACTIVE_RISK_STATUS_SQL");
    expect(routeSource).toContain(
      "SELECT COUNT(DISTINCT ps.state_id)::int AS c",
    );
    expect(routeSource).toContain("JOIN projects p ON p.id = ps.project_id");
    expect(routeSource).toContain(
      "WHERE p.status IN ('approved','coordination_approved','technically_approved','active')",
    );
    expect(routeSource).toContain(
      '${activeProjectParentSQL("rk.project_id")}',
    );
  });

  it("keeps operational Report filters on Dashboard queues", () => {
    expect(routeSource).toContain("r.report_type = ANY(${CANONICAL_TYPES_SQL})");
    expect(routeSource).toContain("AND ${operationalPopulationSQL()}");
    expect(routeSource).toContain(
      "r.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})",
    );
  });

  it("uses the Reports-module type-aware TC scope everywhere Dashboard scopes reports", () => {
    expect(routeSource).toContain("function technicalCoordinatorReportSectorSQL");
    expect(routeSource).toContain("standalone activity reports use");
    expect(routeSource).toContain('LEFT JOIN activities ra ON ra.id = r.activity_id');
    expect(routeSource).toContain('LEFT JOIN activities act ON act.id = r.activity_id');
    expect(routeSource).toContain('LEFT JOIN activities act2 ON act2.id = r2.activity_id');
    expect(routeSource).toContain("const reportEffectiveScope = applyFilterParams(");
    expect(routeSource).toContain("userScope(req)");
    expect(routeSource).toContain("const agendaReportScope = reportScopeWhere(userScope(req)");
    expect(routeSource).toContain('const reportScope = reportScopeWhere(userScope(req), "r", "p", "act", 1)');
    expect(routeSource).not.toContain("COALESCE(NULLIF(r.sector,''), p.sector) = ANY");
  });

  it("uses reached project demographics for explicitly reached Dashboard fields", () => {
    expect(routeSource).toContain(
      'COALESCE(p.beneficiaries_male + p.beneficiaries_female + p.beneficiaries_boys + p.beneficiaries_girls, 0)::int AS "beneficiariesReached"',
    );
    expect(routeSource).not.toContain(
      'COUNT(*)::int FROM beneficiaries b WHERE b.project_id = p.id), 0) AS "beneficiariesReached"',
    );
  });

  it("uses canonical type-aware sectors for sector-snapshot pending approvals", () => {
    const snapshotStart = routeSource.indexOf('router.get("/dashboard/sector-snapshot"');
    const snapshot = routeSource.slice(snapshotStart, routeSource.indexOf('router.get("/dashboard/', snapshotStart + 1));
    expect(snapshot).toContain(
      'technicalCoordinatorReportSectorSQL("r2", "p2", "act2", 1, "single")',
    );
    expect(snapshot).toContain("LEFT JOIN projects p2 ON p2.id = r2.project_id");
    expect(snapshot).toContain("LEFT JOIN activities act2 ON act2.id = r2.activity_id");
    expect(snapshot).not.toContain("WHERE r2.sector = $1");
    expect(routeSource).toContain('parameterKind: "array" | "single" = "array"');
    expect(routeSource).toContain('? `${column} = ANY($${parameterIndex}::text[])`');
    expect(routeSource).toContain(': `${column} = $${parameterIndex}::text`');
    expect(snapshot).toContain("r2.report_type = ANY(${CANONICAL_TYPES_SQL})");
    expect(snapshot).toContain("r2.status = ANY(${AWAITING_APPROVAL_STATUSES_SQL})");
    expect(snapshot).toContain('${operationalPopulationSQL("r2")}');
  });
});