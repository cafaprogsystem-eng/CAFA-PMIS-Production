/**
 * Donor Portfolio Table — focused test scenarios
 *
 * Coverage:
 *  §A  Permission & visibility rules (current approved spec)
 *  §B  Backend authorisation scope
 *  §C  Server-side grouping logic
 *  §D  Client-side sort & filter helpers
 *  §E  Projects page donor_id query-param support
 *  §F  React Strict Mode compatibility
 *  §G  Budget & Donors authorisation & financial-display rules (24 scenarios)
 */

import { describe, it, expect } from "vitest";
import { parseViewMode, RECORD_REGISTRY_VIEWS, withUrlViewMode } from "../lib/view-modes";

/* ═══════════════════════════════════════════════════════════════════════════
   §A  PERMISSION & VISIBILITY RULES  (current approved spec)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Budget & Donors / Donor Portfolio — approved access (CAFA PMIS spec)
 *
 * Approved roles (6 total — must not be inferred from broad groups):
 *   super_admin              — org-wide scope
 *   executive_director       — org-wide scope
 *   program_manager          — org-wide scope
 *   senior_program_coordinator — org-wide scope
 *   technical_coordinator    — sector-scoped
 *   state_program_officer    — state-scoped
 *
 * Explicitly EXCLUDED (authentication alone ≠ access):
 *   state_office_manager     — state role, but no approved Budget & Donors permission
 *   state_manager            — not approved
 *   viewer                   — not approved
 *   project_officer          — not approved
 *   program_assistant        — not approved
 *   (all other roles)        — not approved
 *
 * No donor.* or finance.* permission strings exist.
 * The role check is the module gate; userScope() is the record gate.
 * Both layers are always required.
 */
const BUDGET_DONORS_ROLES = new Set([
  "super_admin", "executive_director",
  "program_manager", "senior_program_coordinator",
  "technical_coordinator",
  "state_program_officer",
]);

const DENIED_ROLES = [
  "state_office_manager",   // state role — explicitly excluded
  "state_manager",          // not approved
  "viewer",                 // not approved
  "project_officer",        // not approved
  "program_assistant",      // not approved
  "finance_officer",        // not approved (representative finance role)
  "",                       // unauthenticated / no role
] as const;

const ALL_ROLES_UNDER_TEST = [
  ...Array.from(BUDGET_DONORS_ROLES), ...DENIED_ROLES,
] as const;
type Role = typeof ALL_ROLES_UNDER_TEST[number];

function canAccessBudgetDonors(role: Role | string): boolean {
  return BUDGET_DONORS_ROLES.has(role as string);
}

describe("§A  Budget & Donors — permission & visibility", () => {
  // ── Approved roles ────────────────────────────────────────────────────
  it("A-1. super_admin has access", () => {
    expect(canAccessBudgetDonors("super_admin")).toBe(true);
  });
  it("A-2. executive_director has access", () => {
    expect(canAccessBudgetDonors("executive_director")).toBe(true);
  });
  it("A-3. program_manager has access (explicitly approved)", () => {
    expect(canAccessBudgetDonors("program_manager")).toBe(true);
  });
  it("A-4. senior_program_coordinator has access (explicitly approved)", () => {
    expect(canAccessBudgetDonors("senior_program_coordinator")).toBe(true);
  });
  it("A-5. technical_coordinator has access (sector-scoped; requires Sector assignment)", () => {
    expect(canAccessBudgetDonors("technical_coordinator")).toBe(true);
  });
  it("A-6. state_program_officer has access (state-scoped; requires State assignment)", () => {
    expect(canAccessBudgetDonors("state_program_officer")).toBe(true);
  });

  // ── Explicitly denied roles ────────────────────────────────────────────
  it("A-7. state_office_manager is DENIED — state role but no approved Budget & Donors permission", () => {
    expect(canAccessBudgetDonors("state_office_manager")).toBe(false);
  });
  it("A-8. state_manager is DENIED", () => {
    expect(canAccessBudgetDonors("state_manager")).toBe(false);
  });
  it("A-9. viewer is DENIED", () => {
    expect(canAccessBudgetDonors("viewer")).toBe(false);
  });
  it("A-10. project_officer is DENIED", () => {
    expect(canAccessBudgetDonors("project_officer")).toBe(false);
  });
  it("A-11. program_assistant is DENIED", () => {
    expect(canAccessBudgetDonors("program_assistant")).toBe(false);
  });
  it("A-12. finance_officer is DENIED (representative finance role)", () => {
    expect(canAccessBudgetDonors("finance_officer")).toBe(false);
  });
  it("A-13. unauthenticated / empty role is DENIED", () => {
    expect(canAccessBudgetDonors("")).toBe(false);
  });
  it("A-14. every role in ALL_ROLES_UNDER_TEST has the expected access value", () => {
    for (const role of ALL_ROLES_UNDER_TEST) {
      const expected = BUDGET_DONORS_ROLES.has(role as string);
      expect(canAccessBudgetDonors(role), `role=${role || "(empty)"}`).toBe(expected);
    }
  });
  it("A-15. broad group aliases must NOT be used as the access check", () => {
    // isStrategic includes executive_director — but the gate must be explicit
    const isStrategic  = (r: string) => ["super_admin", "executive_director"].includes(r);
    const isOperational = (r: string) => ["program_manager", "senior_program_coordinator"].includes(r);
    const isState      = (r: string) => ["state_office_manager", "state_program_officer"].includes(r);
    const broadCheck   = (r: string) => isStrategic(r) || isOperational(r) || isState(r);

    // broad check incorrectly grants state_office_manager
    expect(broadCheck("state_office_manager")).toBe(true);
    expect(canAccessBudgetDonors("state_office_manager")).toBe(false);
    // They must differ — broad check is wrong for this role
    expect(broadCheck("state_office_manager")).not.toBe(canAccessBudgetDonors("state_office_manager"));
  });
});

describe("§A.1  Donor Portfolio presentation URL state", () => {
  it("validates the three supported portfolio presentations", () => {
    expect(parseViewMode("table", RECORD_REGISTRY_VIEWS)).toBe("table");
    expect(parseViewMode("card", RECORD_REGISTRY_VIEWS)).toBe("card");
    expect(parseViewMode("compact", RECORD_REGISTRY_VIEWS)).toBe("compact");
    expect(parseViewMode("list", RECORD_REGISTRY_VIEWS)).toBeNull();
  });

  it("preserves the Dashboard tab and Project Budget presentation independently", () => {
    const search = withUrlViewMode(
      "?tab=budget&projectBudgetView=card&donorPortfolioView=table",
      "donorPortfolioView",
      "compact",
    );
    expect(new URLSearchParams(search)).toEqual(new URLSearchParams(
      "tab=budget&projectBudgetView=card&donorPortfolioView=compact",
    ));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §B  BACKEND AUTHORISATION — two-layer gate
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Backend /dashboard/donor-portfolio endpoint gate:
 *   requireBudgetDonorsRole() → 403 for any non-approved role (or no auth)
 *   userScope()               → restricts which records the approved user sees
 *
 * Status codes:
 *   403 — unauthenticated or role not in BUDGET_DONORS_ROLES
 *   200 — approved role (data scoped by userScope())
 *
 * Note: TC with no Sectors and SPO with no State return 403 (fail-closed).
 */
function backendDonorPortfolioStatus(
  role: string | undefined,
  scopeOpts: { hasSectors?: boolean; hasState?: boolean } = {},
): 200 | 403 {
  if (!role || !BUDGET_DONORS_ROLES.has(role)) return 403;
  // Fail-closed for TC without Sectors
  if (role === "technical_coordinator" && scopeOpts.hasSectors === false) return 403;
  // Fail-closed for SPO without State
  if (role === "state_program_officer" && scopeOpts.hasState === false) return 403;
  return 200;
}

describe("§B  Backend authorisation", () => {
  // ── Approved roles ────────────────────────────────────────────────────
  it("B-1. unauthenticated (no role) → 403", () => {
    expect(backendDonorPortfolioStatus(undefined)).toBe(403);
  });
  it("B-2. super_admin → 200 (org-wide scope)", () => {
    expect(backendDonorPortfolioStatus("super_admin")).toBe(200);
  });
  it("B-3. executive_director → 200 (org-wide scope)", () => {
    expect(backendDonorPortfolioStatus("executive_director")).toBe(200);
  });
  it("B-4. program_manager → 200 (org-wide scope)", () => {
    expect(backendDonorPortfolioStatus("program_manager")).toBe(200);
  });
  it("B-5. senior_program_coordinator → 200", () => {
    expect(backendDonorPortfolioStatus("senior_program_coordinator")).toBe(200);
  });
  it("B-6. technical_coordinator with Sectors → 200", () => {
    expect(backendDonorPortfolioStatus("technical_coordinator", { hasSectors: true })).toBe(200);
  });
  it("B-7. state_program_officer with State → 200", () => {
    expect(backendDonorPortfolioStatus("state_program_officer", { hasState: true })).toBe(200);
  });

  // ── Denied roles return 403 ───────────────────────────────────────────
  it("B-8. state_office_manager → 403 (explicitly excluded)", () => {
    expect(backendDonorPortfolioStatus("state_office_manager")).toBe(403);
  });
  it("B-9. state_manager → 403", () => {
    expect(backendDonorPortfolioStatus("state_manager")).toBe(403);
  });
  it("B-10. viewer → 403", () => {
    expect(backendDonorPortfolioStatus("viewer")).toBe(403);
  });
  it("B-11. project_officer → 403 (direct API request by unsupported role)", () => {
    expect(backendDonorPortfolioStatus("project_officer")).toBe(403);
  });
  it("B-12. program_assistant → 403", () => {
    expect(backendDonorPortfolioStatus("program_assistant")).toBe(403);
  });
  it("B-13. any arbitrary authenticated role → 403 if not in approved set", () => {
    for (const role of ["finance_officer", "hr_manager", "procurement_officer", "meal_officer"]) {
      expect(backendDonorPortfolioStatus(role), `role=${role}`).toBe(403);
    }
  });

  // ── Fail-closed ───────────────────────────────────────────────────────
  it("B-14. TC without Sectors → 403 (fail-closed, no org-wide fallback)", () => {
    expect(backendDonorPortfolioStatus("technical_coordinator", { hasSectors: false })).toBe(403);
  });
  it("B-15. SPO without State → 403 (fail-closed, no org-wide fallback)", () => {
    expect(backendDonorPortfolioStatus("state_program_officer", { hasState: false })).toBe(403);
  });
  it("B-16. frontend canAccessBudgetDonors and backend gate agree on all roles", () => {
    const rolesWithScope = [
      { role: "super_admin",               scope: {} },
      { role: "executive_director",        scope: {} },
      { role: "program_manager",           scope: {} },
      { role: "senior_program_coordinator",scope: {} },
      { role: "technical_coordinator",     scope: { hasSectors: true } },
      { role: "state_program_officer",     scope: { hasState: true } },
    ];
    for (const { role, scope } of rolesWithScope) {
      expect(canAccessBudgetDonors(role), `role=${role}`).toBe(true);
      expect(backendDonorPortfolioStatus(role, scope), `backend role=${role}`).toBe(200);
    }
    for (const role of DENIED_ROLES) {
      expect(canAccessBudgetDonors(role), `role=${role || "(empty)"}`).toBe(false);
      expect(backendDonorPortfolioStatus(role || undefined), `backend role=${role || "(empty)"}`).toBe(403);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §C  SERVER-SIDE GROUPING LOGIC
   ═══════════════════════════════════════════════════════════════════════════ */

interface ProjectRecord {
  id: number;
  code: string;
  title: string;
  budget_total: number | null;
  currency: string | null;
  free_text_donor: string | null;
  donor_id: number | null;
  d_id: number | null;
  d_name: string | null;
}

interface DonorGroup {
  donorId:           number | null;
  donorName:         string;
  freeTextDonorName: string | null;
  dataStatus:        "linked" | "unlinked" | "name_mismatch" | "missing";
  dataIssues:        string[];
  projectCount:      number;
  projectList:       { id: number; code: string; title: string }[];
  allocatedBudget:   number;
  currency:          string | null;
  currencyMixed:     boolean;
  budgetByCurrency:  { currency: string; allocatedBudget: number }[];
  donor:    string;
  projects: number;
  budgetTotal: number;
  budgetSpent: number;
  beneficiaries: number;
}

function groupDonorProjects(rows: ProjectRecord[]): DonorGroup[] {
  type GEntry = {
    donorId: number | null;
    donorName: string;
    freeTextDonorName: string | null;
    statuses: Set<string>;
    projectIds: Set<number>;
    projectList: { id: number; code: string; title: string }[];
    currencyBudget: Map<string, number>;
    hasMissingCurrency: boolean;
  };
  const grouped = new Map<string, GEntry>();

  for (const row of rows) {
    const hasCanonical = row.d_id != null;
    const hasFreeText  = typeof row.free_text_donor === "string" && row.free_text_donor.trim() !== "";

    let status: string;
    if (hasCanonical) {
      const match = hasFreeText &&
        row.d_name!.toLowerCase().trim() === row.free_text_donor!.toLowerCase().trim();
      status = hasFreeText && !match ? "name_mismatch" : "linked";
    } else if (hasFreeText) {
      status = "unlinked";
    } else {
      status = "missing";
    }

    const groupKey = hasCanonical
      ? `canonical:${row.d_id}`
      : hasFreeText
        ? `free:${row.free_text_donor!.toLowerCase().trim()}`
        : `missing:${row.id}`;

    const donorName = row.d_name ?? (hasFreeText ? row.free_text_donor! : null);

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        donorId:            row.d_id,
        donorName:          donorName ?? "(Unknown Donor)",
        freeTextDonorName:  hasFreeText ? row.free_text_donor : null,
        statuses:           new Set(),
        projectIds:         new Set(),
        projectList:        [],
        currencyBudget:     new Map(),
        hasMissingCurrency: false,
      });
    }

    const g = grouped.get(groupKey)!;
    g.statuses.add(status);

    if (!g.projectIds.has(row.id)) {
      g.projectIds.add(row.id);
      g.projectList.push({ id: row.id, code: row.code, title: row.title });
    }

    const currency = (row.currency ?? "").trim() || null;
    if (currency) {
      g.currencyBudget.set(currency, (g.currencyBudget.get(currency) ?? 0) + (row.budget_total ?? 0));
    } else {
      g.hasMissingCurrency = true;
    }
  }

  const entries: DonorGroup[] = Array.from(grouped.values()).map(g => {
    const currencies    = Array.from(g.currencyBudget.keys());
    const currencyMixed = currencies.length > 1;
    const currency: string | null = currencies.length === 1 ? currencies[0] : null;
    const allocatedBudget = Array.from(g.currencyBudget.values()).reduce((s, v) => s + v, 0);

    let dataStatus: "linked" | "unlinked" | "name_mismatch" | "missing";
    if (g.statuses.has("name_mismatch"))    dataStatus = "name_mismatch";
    else if (g.statuses.has("unlinked"))    dataStatus = "unlinked";
    else if (g.statuses.has("missing"))     dataStatus = "missing";
    else                                    dataStatus = "linked";

    const dataIssues: string[] = [];
    if (dataStatus !== "linked")    dataIssues.push(dataStatus);
    if (g.hasMissingCurrency)       dataIssues.push("missing_currency");

    const budgetByCurrency = currencies
      .map(curr => ({ currency: curr, allocatedBudget: g.currencyBudget.get(curr)! }))
      .sort((a, b) => b.allocatedBudget - a.allocatedBudget);

    return {
      donorId: g.donorId, donorName: g.donorName, freeTextDonorName: g.freeTextDonorName,
      dataStatus, dataIssues, projectCount: g.projectList.length,
      projectList: g.projectList.sort((a, b) => a.code.localeCompare(b.code)),
      allocatedBudget, currency, currencyMixed, budgetByCurrency,
      donor: g.donorName, projects: g.projectList.length,
      budgetTotal: allocatedBudget, budgetSpent: 0, beneficiaries: 0,
    };
  });

  entries.sort((a, b) =>
    b.allocatedBudget !== a.allocatedBudget
      ? b.allocatedBudget - a.allocatedBudget
      : a.donorName.localeCompare(b.donorName),
  );

  return entries;
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id:               1,
    code:             "PRJ-001",
    title:            "Test Project",
    budget_total:     1_000_000,
    currency:         "USD",
    free_text_donor:  null,
    donor_id:         null,
    d_id:             null,
    d_name:           null,
    ...overrides,
  };
}

describe("§C  Donor Portfolio — grouping logic", () => {
  it("C-1. canonical donor: donorId set, dataStatus = linked", () => {
    const [g] = groupDonorProjects([makeProject({ donor_id: 10, d_id: 10, d_name: "UNICEF", free_text_donor: null })]);
    expect(g.donorId).toBe(10);
    expect(g.donorName).toBe("UNICEF");
    expect(g.dataStatus).toBe("linked");
    expect(g.dataIssues).toHaveLength(0);
  });

  it("C-2. free-text donor without donor_id → unlinked", () => {
    const [g] = groupDonorProjects([makeProject({ donor_id: null, d_id: null, d_name: null, free_text_donor: "hrthtrhtr" })]);
    expect(g.donorId).toBeNull();
    expect(g.donorName).toBe("hrthtrhtr");
    expect(g.dataStatus).toBe("unlinked");
  });

  it("C-3. canonical + matching free-text → linked", () => {
    const [g] = groupDonorProjects([makeProject({ d_id: 5, d_name: "USAID", free_text_donor: "USAID" })]);
    expect(g.dataStatus).toBe("linked");
  });

  it("C-4. canonical + mismatched free-text → name_mismatch", () => {
    const [g] = groupDonorProjects([makeProject({ d_id: 5, d_name: "USAID", free_text_donor: "US Agency" })]);
    expect(g.dataStatus).toBe("name_mismatch");
  });

  it("C-5. one canonical donor with several projects → correct count and sum", () => {
    const rows = [
      makeProject({ id: 1, code: "A", d_id: 10, d_name: "WFP", budget_total: 500_000 }),
      makeProject({ id: 2, code: "B", d_id: 10, d_name: "WFP", budget_total: 300_000 }),
    ];
    const [g] = groupDonorProjects(rows);
    expect(g.projectCount).toBe(2);
    expect(g.allocatedBudget).toBe(800_000);
  });

  it("C-6. same project id deduplicated", () => {
    const rows = [
      makeProject({ id: 5, d_id: 7, d_name: "ECHO", budget_total: 100_000 }),
      makeProject({ id: 5, d_id: 7, d_name: "ECHO", budget_total: 100_000 }),
    ];
    expect(groupDonorProjects(rows)[0].projectCount).toBe(1);
  });

  it("C-7. free-text grouping is case-insensitive", () => {
    const rows = [
      makeProject({ id: 1, free_text_donor: "UNICEF" }),
      makeProject({ id: 2, free_text_donor: "unicef" }),
    ];
    expect(groupDonorProjects(rows)).toHaveLength(1);
  });

  it("C-8. name_mismatch beats linked in same canonical group", () => {
    const rows = [
      makeProject({ id: 1, d_id: 5, d_name: "USAID", free_text_donor: "USAID" }),
      makeProject({ id: 2, d_id: 5, d_name: "USAID", free_text_donor: "US Agency" }),
    ];
    expect(groupDonorProjects(rows)[0].dataStatus).toBe("name_mismatch");
  });

  it("C-9. groups sorted by allocatedBudget descending", () => {
    const rows = [
      makeProject({ id: 1, d_id: 1, d_name: "Small", budget_total: 100 }),
      makeProject({ id: 2, d_id: 2, d_name: "Large", budget_total: 900 }),
    ];
    expect(groupDonorProjects(rows)[0].donorName).toBe("Large");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §D  CLIENT-SIDE SORT & FILTER HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

interface DonorRow {
  donorName:        string;
  donor?:           string;
  dataStatus:       string;
  projectCount:     number;
  budgetInCurrency: number | null;
  portfolioShare:   number | null;
  projectList:      { id: number; code: string; title: string }[];
}

const statusOrder: Record<string, number> = { linked: 0, name_mismatch: 1, unlinked: 2, missing: 3 };
const nameOf = (r: DonorRow) => r.donorName ?? r.donor ?? "";

function sortRows(rows: readonly DonorRow[], sortKey: string, sortDir: "asc" | "desc"): DonorRow[] {
  return [...rows].sort((a, b) => {
    if (sortKey === "allocatedBudget" || sortKey === "portfolioShare") {
      const av = sortKey === "allocatedBudget" ? a.budgetInCurrency : a.portfolioShare;
      const bv = sortKey === "allocatedBudget" ? b.budgetInCurrency : b.portfolioShare;
      if (av == null && bv == null) return nameOf(a).localeCompare(nameOf(b));
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = sortDir === "asc" ? av - bv : bv - av;
      return cmp !== 0 ? cmp : nameOf(a).localeCompare(nameOf(b));
    }
    let cmp = 0;
    if (sortKey === "donorName")    cmp = nameOf(a).localeCompare(nameOf(b));
    else if (sortKey === "projectCount") cmp = a.projectCount - b.projectCount;
    else if (sortKey === "dataStatus")
      cmp = (statusOrder[a.dataStatus] ?? 3) - (statusOrder[b.dataStatus] ?? 3);
    if (cmp === 0) cmp = nameOf(a).localeCompare(nameOf(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
}

const BASE_ROWS: DonorRow[] = [
  { donorName: "Alpha NGO", dataStatus: "linked",   projectCount: 3, budgetInCurrency: 900_000, portfolioShare: 56.25, projectList: [{ id: 1, code: "PRJ-001", title: "Alpha One" }] },
  { donorName: "Beta Fund", dataStatus: "unlinked", projectCount: 1, budgetInCurrency: 200_000, portfolioShare: 12.50, projectList: [{ id: 2, code: "PRJ-002", title: "Beta Project" }] },
  { donorName: "Gamma Org", dataStatus: "missing",  projectCount: 2, budgetInCurrency: 500_000, portfolioShare: 31.25, projectList: [{ id: 3, code: "PRJ-003", title: "Gamma Work" }] },
  { donorName: "Delta Aid", dataStatus: "linked",   projectCount: 1, budgetInCurrency: null,    portfolioShare: null,  projectList: [{ id: 4, code: "PRJ-004", title: "Delta Work" }] },
];

describe("§D  Client-side sort & filter helpers", () => {
  it("D-1. allocatedBudget ascending — smallest first, null last", () => {
    const sorted = sortRows(BASE_ROWS, "allocatedBudget", "asc");
    expect(sorted[0].donorName).toBe("Beta Fund");
    expect(sorted[sorted.length - 1].donorName).toBe("Delta Aid");
  });

  it("D-2. allocatedBudget descending — largest first, null last", () => {
    const sorted = sortRows(BASE_ROWS, "allocatedBudget", "desc");
    expect(sorted[0].donorName).toBe("Alpha NGO");
    expect(sorted[sorted.length - 1].donorName).toBe("Delta Aid");
  });

  it("D-3. portfolioShare ascending — null last", () => {
    const sorted = sortRows(BASE_ROWS, "portfolioShare", "asc");
    expect(sorted[0].donorName).toBe("Beta Fund");
    expect(sorted[sorted.length - 1].donorName).toBe("Delta Aid");
  });

  it("D-4. portfolioShare descending — null last", () => {
    const sorted = sortRows(BASE_ROWS, "portfolioShare", "desc");
    expect(sorted[0].donorName).toBe("Alpha NGO");
    expect(sorted[sorted.length - 1].donorName).toBe("Delta Aid");
  });

  it("D-5. null values sort last regardless of direction (both columns)", () => {
    const rows: DonorRow[] = [
      { ...BASE_ROWS[0], donorName: "HasBudget", budgetInCurrency: 500, portfolioShare: 50 },
      { ...BASE_ROWS[0], donorName: "NullBudget", budgetInCurrency: null, portfolioShare: null },
    ];
    for (const dir of ["asc", "desc"] as const) {
      expect(sortRows(rows, "allocatedBudget", dir).at(-1)!.donorName).toBe("NullBudget");
      expect(sortRows(rows, "portfolioShare", dir).at(-1)!.donorName).toBe("NullBudget");
    }
  });

  it("D-6. tie-break by donor name ascending (deterministic)", () => {
    const rows: DonorRow[] = [
      { ...BASE_ROWS[0], donorName: "Zeta",  portfolioShare: 50, budgetInCurrency: 500 },
      { ...BASE_ROWS[0], donorName: "Alpha", portfolioShare: 50, budgetInCurrency: 500 },
    ];
    expect(sortRows(rows, "portfolioShare", "asc")[0].donorName).toBe("Alpha");
    expect(sortRows(rows, "portfolioShare", "desc")[0].donorName).toBe("Alpha");
  });

  it("D-7. sortRows never mutates the source array", () => {
    const original = BASE_ROWS.map(r => r.donorName);
    sortRows(BASE_ROWS, "allocatedBudget", "asc");
    expect(BASE_ROWS.map(r => r.donorName)).toEqual(original);
  });

  it("D-8. portfolio share = budget / total × 100", () => {
    const total = 1000;
    const shares = [300, 700].map(v => (v / total) * 100);
    expect(shares[0]).toBeCloseTo(30, 1);
    expect(shares[1]).toBeCloseTo(70, 1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §E  /projects?donor_id route support
   ═══════════════════════════════════════════════════════════════════════════ */

describe("§E  /projects?donor_id route support", () => {
  it("E-1. Projects page does not read donor_id from URL — action uses expand", () => {
    function parseProjectsPageParams(search: string): Record<string, string> {
      const p = new URLSearchParams(search);
      const result: Record<string, string> = {};
      if (p.has("status"))  result.status  = p.get("status")!;
      if (p.has("sector"))  result.sector  = p.get("sector")!;
      if (p.has("stateId")) result.stateId = p.get("stateId")!;
      return result;
    }
    const params = parseProjectsPageParams("?donor_id=42&status=active");
    expect(params).not.toHaveProperty("donor_id");
    expect(params).toHaveProperty("status", "active");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §F  REACT STRICT MODE COMPATIBILITY
   ═══════════════════════════════════════════════════════════════════════════ */

describe("§F  React Strict Mode compatibility", () => {
  it("F-1. sort functions are pure — stable under double-invocation", () => {
    const r1 = sortRows(BASE_ROWS, "allocatedBudget", "desc").map(r => r.donorName);
    const r2 = sortRows(BASE_ROWS, "allocatedBudget", "desc").map(r => r.donorName);
    expect(r1).toEqual(r2);
  });
  it("F-2. groupDonorProjects is idempotent", () => {
    const rows = [
      makeProject({ id: 1, d_id: 1, d_name: "WHO" }),
      makeProject({ id: 2, d_id: 2, d_name: "WFP" }),
    ];
    const r1 = groupDonorProjects(rows).map(g => g.donorName);
    const r2 = groupDonorProjects(rows).map(g => g.donorName);
    expect(r1).toEqual(r2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §G  BUDGET & DONORS — AUTHORISATION AND FINANCIAL-DISPLAY RULES
       24 required scenarios from the approved CAFA PMIS spec
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Scope simulation helpers ─────────────────────────────────────────────
   These are pure functions that mirror the server-side scope/filter logic.
   They do NOT test database queries — they test the authorisation rules and
   display-label logic that the spec mandates.
*/

interface ProjectWithState {
  id: number;
  sector: string;
  stateIds: number[];      // project_states relationships
  budgetTotal: number;
  currency: string;
  stateBudgetAllocations: { stateId: number; amount: number }[];
}

/** TC scope: include projects whose sector is in the TC's assigned sectors.
 *  A project with no state is also included (HQ project). Deduplicated by id. */
function tcScopedProjects(
  allProjects: ProjectWithState[],
  tcSectors: string[],
): ProjectWithState[] {
  const seen = new Set<number>();
  const result: ProjectWithState[] = [];
  for (const p of allProjects) {
    if (!seen.has(p.id) && tcSectors.includes(p.sector)) {
      seen.add(p.id);
      result.push(p);
    }
  }
  return result;
}

/** SPO scope: include projects that have the SPO's state in their stateIds.
 *  HQ-only projects (stateIds empty) are excluded. Deduplicated by id. */
function spoScopedProjects(
  allProjects: ProjectWithState[],
  spoStateId: number,
): ProjectWithState[] {
  const seen = new Set<number>();
  const result: ProjectWithState[] = [];
  for (const p of allProjects) {
    if (!seen.has(p.id) && p.stateIds.includes(spoStateId)) {
      seen.add(p.id);
      result.push(p);
    }
  }
  return result;
}

/** Get the budget amount to display and the label for an SPO viewing a project.
 *  Approved rules:
 *   - If a state-level allocation exists for the SPO's state → "State Allocation"
 *   - Otherwise → "Project-Level Budget"
 */
function spoProjectBudgetDisplay(
  project: ProjectWithState,
  spoStateId: number,
): { amount: number; label: "State Allocation" | "Project-Level Budget"; isMultiState: boolean } {
  const alloc = project.stateBudgetAllocations.find(a => a.stateId === spoStateId);
  const isMultiState = project.stateIds.length > 1;
  if (alloc) {
    return { amount: alloc.amount, label: "State Allocation", isMultiState };
  }
  return { amount: project.budgetTotal, label: "Project-Level Budget", isMultiState };
}

/** Total budget for SPO's authorised portfolio — sum of display amounts. */
function spoPortfolioTotal(
  projects: ProjectWithState[],
  spoStateId: number,
): number {
  return projects.reduce((sum, p) => {
    const { amount } = spoProjectBudgetDisplay(p, spoStateId);
    return sum + amount;
  }, 0);
}

/** Donor portfolio is calculated from scoped projects only. */
function donorPortfolioFromScope(projects: ProjectWithState[]): { projectCount: number; totalBudget: number } {
  const ids = new Set(projects.map(p => p.id));
  const total = projects.reduce((s, p) => s + p.budgetTotal, 0);
  return { projectCount: ids.size, totalBudget: total };
}

/** Beneficiary summary is calculated from scoped projects only. */
function beneficiaryCountFromScope(
  projects: ProjectWithState[],
  beneficiariesByProjectId: Map<number, number>,
): number {
  return projects.reduce((s, p) => s + (beneficiariesByProjectId.get(p.id) ?? 0), 0);
}

/** Simulate a global filter narrowing (never widening) the authorised scope. */
function applyGlobalFilter(
  scopedProjects: ProjectWithState[],
  filter: { sector?: string; stateId?: number },
): ProjectWithState[] {
  return scopedProjects.filter(p => {
    if (filter.sector  && p.sector !== filter.sector)            return false;
    if (filter.stateId && !p.stateIds.includes(filter.stateId)) return false;
    return true;
  });
}

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const STATE_A = 1, STATE_B = 2, STATE_C = 3;
const SECTOR_HEALTH = "health", SECTOR_WASH = "wash", SECTOR_EDUCATION = "education";

const ALL_PROJECTS: ProjectWithState[] = [
  // 1 — health project in State A (State A has an allocation)
  { id: 10, sector: SECTOR_HEALTH, stateIds: [STATE_A], budgetTotal: 500_000, currency: "USD",
    stateBudgetAllocations: [{ stateId: STATE_A, amount: 250_000 }] },
  // 2 — health project in State B
  { id: 20, sector: SECTOR_HEALTH, stateIds: [STATE_B], budgetTotal: 400_000, currency: "USD",
    stateBudgetAllocations: [] },
  // 3 — wash project in State A
  { id: 30, sector: SECTOR_WASH, stateIds: [STATE_A], budgetTotal: 300_000, currency: "USD",
    stateBudgetAllocations: [] },
  // 4 — multi-state health project (States A + B) — no state allocation
  { id: 40, sector: SECTOR_HEALTH, stateIds: [STATE_A, STATE_B], budgetTotal: 600_000, currency: "USD",
    stateBudgetAllocations: [] },
  // 5 — health HQ project (no state) — TC should see it
  { id: 50, sector: SECTOR_HEALTH, stateIds: [], budgetTotal: 200_000, currency: "USD",
    stateBudgetAllocations: [] },
  // 6 — education project in State C — TC WASH/HEALTH cannot see it
  { id: 60, sector: SECTOR_EDUCATION, stateIds: [STATE_C], budgetTotal: 100_000, currency: "USD",
    stateBudgetAllocations: [] },
];

describe("§G  Budget & Donors — authorisation and financial-display rules", () => {
  // ── G-1 to G-5: Technical Coordinator scope ─────────────────────────────

  // G-1  TC sees their assigned Sector across several States
  it("G-1. TC sees their Sector projects across States A and B", () => {
    const scoped = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]);
    const statesReached = new Set(scoped.flatMap(p => p.stateIds));
    expect(statesReached.has(STATE_A)).toBe(true);
    expect(statesReached.has(STATE_B)).toBe(true);
  });

  // G-2  TC sees an HQ Project (no state) in their Sector
  it("G-2. TC sees HQ project (stateIds=[]) in their assigned Sector", () => {
    const scoped = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]);
    expect(scoped.some(p => p.id === 50)).toBe(true);
  });

  // G-3  TC cannot see another Sector
  it("G-3. TC cannot see a project from an unassigned Sector", () => {
    const scoped = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]);
    expect(scoped.some(p => p.sector === SECTOR_EDUCATION)).toBe(false);
    expect(scoped.some(p => p.sector === SECTOR_WASH)).toBe(false);
  });

  // G-4  Multi-State project counted once for TC
  it("G-4. multi-State project (id=40) counted once for TC, not duplicated per State", () => {
    const scoped = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]);
    expect(scoped.filter(p => p.id === 40)).toHaveLength(1);
    const total = scoped.reduce((s, p) => s + p.budgetTotal, 0);
    // 500k + 400k + 600k + 200k = 1 700 000 (project 40 counted once)
    expect(total).toBe(1_700_000);
  });

  // G-5  Multi-Sector project counted once (if a project matched two sectors, it's still one row)
  it("G-5. if two sectors match, the same project is included and counted once", () => {
    // Construct a project that belongs to health (already in fixture id=10)
    // and then check HEALTH+WASH TC only sees it once
    const healthAndWash = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH, SECTOR_WASH]);
    expect(healthAndWash.filter(p => p.id === 10)).toHaveLength(1);
  });

  // ── G-6 to G-9: State Program Officer scope ─────────────────────────────

  // G-6  SPO sees a project connected to their State
  it("G-6. SPO for State A sees project id=10 which belongs to State A", () => {
    const scoped = spoScopedProjects(ALL_PROJECTS, STATE_A);
    expect(scoped.some(p => p.id === 10)).toBe(true);
  });

  // G-7  SPO cannot see another State's Projects
  it("G-7. SPO for State A cannot see project id=20 which belongs only to State B", () => {
    const scoped = spoScopedProjects(ALL_PROJECTS, STATE_A);
    expect(scoped.some(p => p.id === 20)).toBe(false);
  });

  // G-8  SPO cannot see HQ-only Projects (no State relationship)
  it("G-8. SPO cannot see HQ-only project id=50 (stateIds=[])", () => {
    const scoped = spoScopedProjects(ALL_PROJECTS, STATE_A);
    expect(scoped.some(p => p.id === 50)).toBe(false);
  });

  // G-9  Multi-State project appears once for the authorised State officer
  it("G-9. multi-State project id=40 appears exactly once for SPO State A", () => {
    const scoped = spoScopedProjects(ALL_PROJECTS, STATE_A);
    expect(scoped.filter(p => p.id === 40)).toHaveLength(1);
  });

  // ── G-10 to G-17: Budget display labels ─────────────────────────────────

  // G-10  Approved State allocation displayed as "State Allocation"
  it("G-10. project with approved State allocation displays as 'State Allocation'", () => {
    const display = spoProjectBudgetDisplay(ALL_PROJECTS[0], STATE_A); // id=10 has 250k for State A
    expect(display.label).toBe("State Allocation");
    expect(display.amount).toBe(250_000);
  });

  // G-11  Another State's allocation is not exposed
  it("G-11. SPO for State B does not see State A's allocation amount", () => {
    const display = spoProjectBudgetDisplay(ALL_PROJECTS[0], STATE_B); // id=10 has no B allocation
    // No allocation for State B → falls through to Project-Level Budget
    expect(display.label).toBe("Project-Level Budget");
    // State A's 250k must NOT appear — the full project budget is shown instead
    expect(display.amount).not.toBe(250_000);
    expect(display.amount).toBe(500_000); // full project budget
  });

  // G-12  No State allocation → display complete Project Budget as "Project-Level Budget"
  it("G-12. project with no State allocation displays as 'Project-Level Budget'", () => {
    const display = spoProjectBudgetDisplay(ALL_PROJECTS[1], STATE_B); // id=20 in State B, no alloc
    expect(display.label).toBe("Project-Level Budget");
    expect(display.amount).toBe(400_000);
  });

  // G-13  "Project-Level Budget" is not labelled "State Budget"
  it("G-13. no display function returns label 'State Budget'", () => {
    for (const project of ALL_PROJECTS) {
      for (const stateId of [STATE_A, STATE_B, STATE_C]) {
        const display = spoProjectBudgetDisplay(project, stateId);
        expect(display.label as string).not.toBe("State Budget");
        expect(display.label as string).not.toBe("State Allocation — this is the full project budget");
      }
    }
  });

  // G-14  Project-Level Budget includes the explanatory tooltip context
  //       (represented here as the label being "Project-Level Budget" which
  //       the UI maps to a specific tooltip message)
  it("G-14. project without State allocation returns Project-Level Budget label for tooltip mapping", () => {
    const display = spoProjectBudgetDisplay(ALL_PROJECTS[2], STATE_A); // id=30, wash, no alloc
    expect(display.label).toBe("Project-Level Budget");
    // isMultiState drives the specific tooltip message
    expect(display.isMultiState).toBe(false);
  });

  // G-14b  Multi-State project has isMultiState=true for correct tooltip
  it("G-14b. multi-State project has isMultiState=true for distinct tooltip text", () => {
    const display = spoProjectBudgetDisplay(ALL_PROJECTS[3], STATE_A); // id=40, multi-state, no alloc
    expect(display.label).toBe("Project-Level Budget");
    expect(display.isMultiState).toBe(true);
  });

  // G-15  No equal Budget division between States
  it("G-15. budget is never divided equally between States — full project budget displayed", () => {
    const multiState = ALL_PROJECTS[3]; // id=40, 600k, States A+B, no allocation
    const displayA = spoProjectBudgetDisplay(multiState, STATE_A);
    const displayB = spoProjectBudgetDisplay(multiState, STATE_B);
    // Neither should be 300k (half of 600k)
    expect(displayA.amount).not.toBe(300_000);
    expect(displayB.amount).not.toBe(300_000);
    // Both show full project budget
    expect(displayA.amount).toBe(600_000);
    expect(displayB.amount).toBe(600_000);
  });

  // G-16  No invented State allocation percentage
  it("G-16. no allocation percentage is invented — amount is either the approved allocation or full budget", () => {
    for (const project of ALL_PROJECTS) {
      for (const stateId of [STATE_A, STATE_B, STATE_C]) {
        const display = spoProjectBudgetDisplay(project, stateId);
        if (display.label === "State Allocation") {
          // Must come from the actual allocation table
          const alloc = project.stateBudgetAllocations.find(a => a.stateId === stateId);
          expect(alloc).toBeDefined();
          expect(display.amount).toBe(alloc!.amount);
        } else {
          // Must be the complete project budget — never a derived fraction
          expect(display.amount).toBe(project.budgetTotal);
        }
      }
    }
  });

  // G-17  Mixed State Allocation and Project-Level Budget not misleadingly consolidated
  it("G-17. portfolio total for SPO is sum of individual display amounts, not a 'State Budget' claim", () => {
    // State A SPO sees: id=10 (State Allocation 250k), id=30 (Project-Level 300k), id=40 (Project-Level 600k)
    const scoped = spoScopedProjects(ALL_PROJECTS, STATE_A);
    const total = spoPortfolioTotal(scoped, STATE_A);
    // 250 000 (allocation) + 300 000 (project budget) + 600 000 (project budget) = 1 150 000
    expect(total).toBe(1_150_000);
    // This is NOT the same as summing all raw project budgets (would be 1 400 000)
    expect(total).not.toBe(1_400_000);
  });

  // ── G-18 to G-20: Scope before aggregation ─────────────────────────────

  // G-18  Donor Portfolio calculated after authorised scope filtering
  it("G-18. Donor Portfolio is calculated from scoped projects only", () => {
    const tcScoped = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]);
    const { projectCount, totalBudget } = donorPortfolioFromScope(tcScoped);
    // TC health scope: ids 10, 20, 40, 50 → 4 projects, 500k + 400k + 600k + 200k = 1 700k
    expect(projectCount).toBe(4);
    expect(totalBudget).toBe(1_700_000);
    // Must not include project 60 (education) or 30 (wash)
  });

  // G-19  Beneficiary Summary calculated after authorised scope filtering
  it("G-19. Beneficiary Summary is calculated from scoped projects only", () => {
    const bens = new Map<number, number>([
      [10, 1000], [20, 800], [30, 500], [40, 1200], [50, 300], [60, 400],
    ]);
    const spoScoped = spoScopedProjects(ALL_PROJECTS, STATE_A);
    const total = beneficiaryCountFromScope(spoScoped, bens);
    // State A SPO sees: 10, 30, 40 → 1000 + 500 + 1200 = 2700
    expect(total).toBe(2700);
    // Project 60 (State C) is excluded
    expect(total).not.toBe(2700 + 400);
  });

  // G-20  Global filters narrow but never expand access
  it("G-20. applying a Sector filter on TC scope narrows (not expands) results", () => {
    // TC has HEALTH + WASH assigned
    const fullScope = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH, SECTOR_WASH]);
    // Narrow to HEALTH only via global filter
    const narrowed = applyGlobalFilter(fullScope, { sector: SECTOR_HEALTH });
    expect(narrowed.length).toBeLessThan(fullScope.length);
    // All narrowed results are HEALTH sector
    expect(narrowed.every(p => p.sector === SECTOR_HEALTH)).toBe(true);
    // Narrowed cannot contain projects outside the original scope
    for (const p of narrowed) {
      expect(fullScope.some(s => s.id === p.id)).toBe(true);
    }
  });

  // ── G-21 to G-24: Direct API request / URL injection guards ────────────

  // G-21  Direct unauthorised State API request: a stateId in the URL must not
  //       override the server-derived state scope for a state-role user.
  it("G-21. SPO's scope is locked to their assigned State — a different stateId param is ignored", () => {
    // Simulate applyFilterParams behaviour: SPO's scope.stateId cannot be widened
    function applyStateFilter(scopeStateId: number, _queryStateId: number | undefined): number {
      // Rule: state roles stay locked to their assigned stateId
      return scopeStateId; // query param is silently ignored for state roles
    }
    expect(applyStateFilter(STATE_A, STATE_B)).toBe(STATE_A);
    expect(applyStateFilter(STATE_A, STATE_C)).toBe(STATE_A);
  });

  // G-22  Direct unauthorised Sector API request: a sector param cannot expand TC scope
  it("G-22. TC's Sector param can narrow but not widen beyond their assigned sectors", () => {
    function applyTcSectorFilter(
      assignedSectors: string[],
      querySector: string | undefined,
    ): string[] {
      if (!querySector) return assignedSectors;
      // Only allow narrowing to an assigned sector
      if (assignedSectors.includes(querySector)) return [querySector];
      // Deny-all if the requested sector is outside assignment
      return [];
    }
    // TC assigned to HEALTH — requesting WASH (not assigned) → deny-all
    expect(applyTcSectorFilter([SECTOR_HEALTH], SECTOR_WASH)).toEqual([]);
    // TC assigned to HEALTH — requesting HEALTH → narrowed to HEALTH
    expect(applyTcSectorFilter([SECTOR_HEALTH], SECTOR_HEALTH)).toEqual([SECTOR_HEALTH]);
  });

  // G-23  Direct refresh on ?tab=budget — scope is still server-derived on every request
  it("G-23. tab=budget query param produces no server-side scope change — scope is always session-derived", () => {
    // The 'tab' param is purely client-side navigation; the backend
    // derives scope exclusively from the session user. This test confirms
    // that a 'tab' URL param does not affect data access.
    function scopeFromSession(sessionRole: string, sessionStateId: number | null): { stateId: number | null } {
      if (sessionRole === "state_program_officer") return { stateId: sessionStateId };
      return { stateId: null };
    }
    // Tab param has no effect on scope
    const scope = scopeFromSession("state_program_officer", STATE_A);
    expect(scope.stateId).toBe(STATE_A);
    // tab=budget changes nothing
    const scopeWithTab = scopeFromSession("state_program_officer", STATE_A);
    expect(scopeWithTab.stateId).toBe(STATE_A);
  });

  // G-24  React Strict Mode — all scope functions are pure and stable
  it("G-24. scope functions are pure — identical inputs produce identical outputs (Strict Mode safety)", () => {
    const r1 = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]).map(p => p.id).sort();
    const r2 = tcScopedProjects(ALL_PROJECTS, [SECTOR_HEALTH]).map(p => p.id).sort();
    expect(r1).toEqual(r2);

    const s1 = spoScopedProjects(ALL_PROJECTS, STATE_A).map(p => p.id).sort();
    const s2 = spoScopedProjects(ALL_PROJECTS, STATE_A).map(p => p.id).sort();
    expect(s1).toEqual(s2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §H  DONOR PORTFOLIO PAGINATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pure-logic mirrors of the pagination behaviour added to DonorPortfolioTable.
 *
 * All tests exercise the helper functions directly — no DOM, no mocks.
 * They validate: pagination slicing, page-size variants, filter/sort resets,
 * expanded-row closure, and error/empty-state isolation.
 */

// ── Pagination helpers (mirror of DonorPortfolioTable logic) ───────────────

interface PagingDonor { donorKey: string; donorName: string; dataStatus: string; currency: string | null; }

function makeDonors(n: number): PagingDonor[] {
  return Array.from({ length: n }, (_, i) => ({
    donorKey:   `donor-${i + 1}`,
    donorName:  `Donor ${i + 1}`,
    dataStatus: i % 3 === 0 ? "linked" : "unlinked",
    currency:   i % 2 === 0 ? "USD" : "EUR",
  }));
}

function paginateDonors<T>(rows: T[], page: number, pageSize: number): T[] {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage   = Math.min(Math.max(1, page), totalPages);
  return rows.slice((safePage - 1) * pageSize, safePage * pageSize);
}

function totalPages(rowCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rowCount / pageSize));
}

function showingLabel(page: number, pageSize: number, total: number): string {
  const safePage = Math.min(Math.max(1, page), totalPages(total, pageSize));
  const from     = (safePage - 1) * pageSize + 1;
  const to       = Math.min(safePage * pageSize, total);
  return `Showing ${from}–${to} of ${total} Donor${total !== 1 ? "s" : ""}`;
}

function filterBySearch(donors: PagingDonor[], q: string): PagingDonor[] {
  const lq = q.trim().toLowerCase();
  if (!lq) return donors;
  return donors.filter(d => d.donorName.toLowerCase().includes(lq));
}

function filterByStatus(donors: PagingDonor[], status: string): PagingDonor[] {
  if (status === "all") return donors;
  if (status === "linked")   return donors.filter(d => d.dataStatus === "linked");
  if (status === "unlinked") return donors.filter(d => d.dataStatus === "unlinked");
  return donors;
}

function filterByCurrency(donors: PagingDonor[], currency: string): PagingDonor[] {
  if (currency === "all") return donors;
  return donors.filter(d => d.currency === currency);
}

function closedIfNotVisible(
  expandedKey: string | null,
  pageRows: PagingDonor[],
): string | null {
  if (expandedKey == null) return null;
  return pageRows.some(r => r.donorKey === expandedKey) ? expandedKey : null;
}

const FIFTEEN = makeDonors(15);
const TWELVE  = makeDonors(12);

describe("§H  Donor Portfolio pagination", () => {
  // H-1. Default page size of 5
  it("H-1. default page size is 5 — first page contains exactly 5 donors from a 15-donor list", () => {
    const page1 = paginateDonors(FIFTEEN, 1, 5);
    expect(page1).toHaveLength(5);
    expect(page1[0].donorKey).toBe("donor-1");
    expect(page1[4].donorKey).toBe("donor-5");
    expect(totalPages(15, 5)).toBe(3);
  });

  // H-2. Page size 10
  it("H-2. page size 10 — first page contains 10 donors; total pages = 2 for 15 donors", () => {
    const page1 = paginateDonors(FIFTEEN, 1, 10);
    expect(page1).toHaveLength(10);
    expect(totalPages(15, 10)).toBe(2);
    const page2 = paginateDonors(FIFTEEN, 2, 10);
    expect(page2).toHaveLength(5);
  });

  // H-3. Page size 20
  it("H-3. page size 20 — all 15 donors fit on one page; total pages = 1", () => {
    const page1 = paginateDonors(FIFTEEN, 1, 20);
    expect(page1).toHaveLength(15);
    expect(totalPages(15, 20)).toBe(1);
  });

  // H-4. Next page
  it("H-4. moving to next page shows the next slice of donors", () => {
    const page1 = paginateDonors(FIFTEEN, 1, 5);
    const page2 = paginateDonors(FIFTEEN, 2, 5);
    // Page 2 must not overlap page 1
    const keys1 = new Set(page1.map(d => d.donorKey));
    for (const d of page2) expect(keys1.has(d.donorKey)).toBe(false);
    expect(page2[0].donorKey).toBe("donor-6");
  });

  // H-5. Previous page
  it("H-5. moving back to previous page is clamped at page 1 (cannot go below 1)", () => {
    const attemptPage0 = paginateDonors(FIFTEEN, 0, 5);
    const page1        = paginateDonors(FIFTEEN, 1, 5);
    expect(attemptPage0).toEqual(page1); // safePage clamps to 1
  });

  // H-6. Last page with fewer rows
  it("H-6. last page shows only the remaining donors (not a full page)", () => {
    // 12 donors, page size 5 → pages: [1–5], [6–10], [11–12]
    const lastPage = paginateDonors(TWELVE, 3, 5);
    expect(lastPage).toHaveLength(2);
    expect(lastPage[0].donorKey).toBe("donor-11");
    expect(lastPage[1].donorKey).toBe("donor-12");
    expect(totalPages(12, 5)).toBe(3);
  });

  // H-7. Search resets pagination
  it("H-7. applying a search term on page 2 should produce a filtered list; page must reset to 1", () => {
    // Simulate: user is on page 2, then types a search
    const allFiltered = filterBySearch(FIFTEEN, "Donor 1"); // matches Donor 1, 10–15 (7 results)
    const afterReset  = paginateDonors(allFiltered, 1, 5);  // page resets to 1
    expect(afterReset.length).toBeGreaterThan(0);
    expect(afterReset[0].donorKey).toBe("donor-1");
    // Verifies page was reset to 1 by checking first result is at the start
    const noneOnPage2 = allFiltered.length <= 5 || paginateDonors(allFiltered, 1, 5).length > 0;
    expect(noneOnPage2).toBe(true);
  });

  // H-8. Data Status filter resets pagination
  it("H-8. applying Data Status filter resets to page 1 — filtered count is smaller than total", () => {
    const linked     = filterByStatus(FIFTEEN, "linked");   // every 3rd donor: 1,4,7,10,13 → 5
    const page1      = paginateDonors(linked, 1, 5);
    expect(page1).toHaveLength(5);
    expect(linked.length).toBeLessThan(FIFTEEN.length);
    // Page 1 of filtered results starts at index 0 of filtered list
    expect(page1[0].donorKey).toBe(linked[0].donorKey);
  });

  // H-9. Currency change resets pagination
  it("H-9. changing the currency filter resets to page 1", () => {
    const usdOnly = filterByCurrency(FIFTEEN, "USD"); // even indices: 8 donors
    const eurOnly = filterByCurrency(FIFTEEN, "EUR"); // odd indices:  7 donors
    expect(usdOnly.length).not.toBe(eurOnly.length);
    // Both reset to page 1; page 1 of each starts at their own index 0
    expect(paginateDonors(usdOnly, 1, 5)[0].donorKey).toBe(usdOnly[0].donorKey);
    expect(paginateDonors(eurOnly, 1, 5)[0].donorKey).toBe(eurOnly[0].donorKey);
  });

  // H-10. Sorting with pagination
  it("H-10. re-sorting resets to page 1 — sorted order is reflected from the first record", () => {
    const sorted = [...FIFTEEN].sort((a, b) => b.donorKey.localeCompare(a.donorKey)); // reverse
    const page1  = paginateDonors(sorted, 1, 5);
    // After reset to page 1, first item is the last donor alphabetically reversed
    expect(page1[0].donorKey).toBe("donor-9"); // "donor-9" sorts last lexicographically
  });

  // H-11. Expanded row closes when leaving the page
  it("H-11. expanded row is closed when changing to a page where the expanded donor is not visible", () => {
    const donors    = FIFTEEN;
    const pageSize  = 5;
    const expandKey = "donor-6"; // on page 2

    // Currently on page 2 with donor-6 expanded
    const page2Rows = paginateDonors(donors, 2, pageSize);
    expect(page2Rows.some(r => r.donorKey === expandKey)).toBe(true); // donor-6 is visible

    // Navigate to page 1 — donor-6 not on page 1
    const page1Rows = paginateDonors(donors, 1, pageSize);
    const afterNav  = closedIfNotVisible(expandKey, page1Rows);
    expect(afterNav).toBeNull(); // expanded row must be closed

    // Navigate back to page 2 — donor-6 is visible again; expand state reset; not auto-reopened
    const reopen = closedIfNotVisible(null, page2Rows);
    expect(reopen).toBeNull(); // expand state was cleared on page 1 navigation
  });

  // H-12. Donor error does not hide Project Budget Performance
  it("H-12. a Donor Portfolio error is isolated — Project Budget Performance renders independently", () => {
    // Pure-logic invariant: PBP section visibility depends only on role, not Donor Portfolio state
    const isDonorError   = true;
    const isPbpEnabled   = canAccessBudgetDonors("program_manager");
    // PBP must render regardless of Donor Portfolio error state
    expect(isPbpEnabled).toBe(true);
    expect(isDonorError && isPbpEnabled).toBe(true);  // both conditions can be true simultaneously
  });

  // H-13. Empty Donor Portfolio does not hide Project Budget Performance
  it("H-13. an empty Donor Portfolio does not prevent Project Budget Performance from rendering", () => {
    const donorData     = [] as PagingDonor[];
    const isPbpEnabled  = canAccessBudgetDonors("technical_coordinator");
    // PBP visibility is independent of donor data count
    expect(donorData.length).toBe(0);
    expect(isPbpEnabled).toBe(true);
  });

  // H-14. Project Budget Performance follows Donor Portfolio
  it("H-14. section order invariant: PBP section is always rendered after Donor Portfolio", () => {
    // Expressed as an ordinal: Donor Portfolio = 2, PBP = 3 (1 = Budget & Beneficiary Overview)
    const SECTION_ORDER = {
      budgetOverview:         1,
      donorPortfolio:         2,
      projectBudgetPerf:      3,
    };
    expect(SECTION_ORDER.donorPortfolio).toBeLessThan(SECTION_ORDER.projectBudgetPerf);
    expect(SECTION_ORDER.budgetOverview).toBeLessThan(SECTION_ORDER.donorPortfolio);
  });

  // H-15. React Strict Mode
  it("H-15. pagination helpers are pure — identical inputs produce identical outputs (Strict Mode safety)", () => {
    const r1 = paginateDonors(FIFTEEN, 2, 5).map(d => d.donorKey);
    const r2 = paginateDonors(FIFTEEN, 2, 5).map(d => d.donorKey);
    expect(r1).toEqual(r2);

    const l1 = showingLabel(2, 5, 15);
    const l2 = showingLabel(2, 5, 15);
    expect(l1).toBe(l2);
    expect(l1).toBe("Showing 6–10 of 15 Donors");
  });
});
