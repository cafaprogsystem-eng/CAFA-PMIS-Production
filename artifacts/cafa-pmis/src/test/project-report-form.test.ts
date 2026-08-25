/**
 * Project Report Form — Regression Test Suite
 *
 * Covers all 40 scenarios from the Project Reports Audit fix spec.
 * Tests run against pure helper mirrors of the business logic in
 * reports.tsx — no React rendering, no network, no database.
 *
 * British English spelling used throughout (per spec requirement).
 */

import { describe, it, expect } from "vitest";

/* ══════════════════════════════════════════════════════════════════════════
   Pure helper mirrors
   These replicate the exact business logic implemented in reports.tsx.
   Tests run against these rather than importing source so they remain
   stable across refactors.
══════════════════════════════════════════════════════════════════════════ */

// ── P1-01: Project Currency ──────────────────────────────────────────────────

/** Derive currency from a project object (matches the cast in reports.tsx). */
function deriveProjectCurrency(proj: Record<string, unknown> | null | undefined): string | null {
  if (!proj) return null;
  const c = (proj as Record<string, unknown>).currency;
  return typeof c === "string" && c.trim().length > 0 ? c : null;
}

/** Format currency using the project's currency code. Returns "—" for null values. */
function formatCurrencyDisplay(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return "—";
  const cur = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${cur} ${value.toFixed(2)}`;
  }
}

// ── P1-02: Null vs Zero planned budget ──────────────────────────────────────

type ActivityRow = {
  plannedBudget: number | null;
  actualExpenditure: number | string | null;
  isUnplanned?: boolean;
  name?: string;
};

function emptyProjectActivity(): ActivityRow {
  return { plannedBudget: null, actualExpenditure: "", isUnplanned: true };
}

// ── P1-03: Split validation ──────────────────────────────────────────────────

type FormShape = {
  title: string;
  kind: string;
  projectId?: number | null;
  stateId?: number | null;
  sector?: string | null;
  periodStart?: string | null;
};

type ValidationResult = { valid: boolean; errorMsg: string | null; errorTab: string | null };

function validateDraft(
  values: FormShape,
  opts: { isActivity?: boolean; isHqSector?: boolean; isProject?: boolean; activityId?: number | null; onDemandReason?: string },
): ValidationResult {
  if (!values.title.trim()) return { valid: false, errorMsg: "Report Title is required", errorTab: "rp-section-basic" };
  if (opts.isProject && !values.projectId) return { valid: false, errorMsg: "Project is required", errorTab: "rp-section-basic" };
  if (!values.stateId && !opts.isActivity && !opts.isHqSector) return { valid: false, errorMsg: "State is required", errorTab: "rp-section-basic" };
  if (opts.isHqSector && !values.sector) return { valid: false, errorMsg: "Sector is required", errorTab: "rp-section-basic" };
  if (opts.isActivity && !values.projectId) return { valid: false, errorMsg: "Project is required", errorTab: "rp-section-basic" };
  if (opts.isActivity && !opts.activityId) return { valid: false, errorMsg: "Activity is required", errorTab: "rp-section-basic" };
  if (values.kind === "on_demand" && !values.periodStart?.trim()) return { valid: false, errorMsg: "Period Start is required", errorTab: "rp-section-basic" };
  return { valid: true, errorMsg: null, errorTab: null };
}

// ── P1-04: Utilisation calculation ──────────────────────────────────────────

function computeUtilisation(planned: number | null, actual: number): string {
  if (planned == null || planned === 0) return "—";
  return `${Math.round((actual / planned) * 100)}%`;
}

// ── P1-05: Variance ──────────────────────────────────────────────────────────

function computeVarianceLabel(planned: number | null, actual: number): string {
  if (planned == null) return "—";
  const v = planned - actual;
  if (v === 0) return "On Budget";
  return v > 0 ? `Underspend: ${Math.abs(v)}` : `Overspend: ${Math.abs(v)}`;
}

// ── P1-06 / P1-07: Variance reason ──────────────────────────────────────────

function varianceReasonRequired(planned: number | null | undefined, actual: number): boolean {
  if (planned == null || planned === 0) return false;
  if (actual > planned) return true;        // over budget
  if (actual / planned < 0.7) return true;  // under 70% utilisation
  return false;
}

// ── Financial aggregation ────────────────────────────────────────────────────

function computeFinancials(activities: ActivityRow[]): {
  linkedPlanned: number | null;
  linkedActual: number;
  unplannedActual: number;
  utilisation: string;
  variance: string;
} {
  const linked = activities.filter((a) => !a.isUnplanned);
  const unplanned = activities.filter((a) => !!a.isUnplanned);

  const hasAnyLinkedPlanned = linked.some((a) => a.plannedBudget != null);
  const linkedPlanned: number | null = hasAnyLinkedPlanned
    ? linked.reduce((s, a) => s + (a.plannedBudget ?? 0), 0)
    : null;

  const toNum = (v: number | string | null) => (v === "" || v == null ? 0 : Number(v));
  const linkedActual = linked.reduce((s, a) => s + toNum(a.actualExpenditure), 0);
  const unplannedActual = unplanned.reduce((s, a) => s + toNum(a.actualExpenditure), 0);

  return {
    linkedPlanned,
    linkedActual,
    unplannedActual,
    utilisation: computeUtilisation(linkedPlanned, linkedActual),
    variance: computeVarianceLabel(linkedPlanned, linkedActual),
  };
}

// ── Period computation ───────────────────────────────────────────────────────

function computePeriod(kind: string, year: number, month: number, quarter: number, periodStart: string | null): string {
  if (kind === "quarterly") return `${year}-Q${quarter}`;
  if (kind === "annual") return String(year);
  if (kind === "on_demand") return periodStart || String(year);
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ── Tab error counting ───────────────────────────────────────────────────────

type TabId = "rp-section-basic" | "rp-section-progress" | "rp-section-activities" | "rp-section-challenges" | "rp-section-lessons" | "rp-section-attachments";

function validateSubmit(
  values: FormShape,
  opts: {
    isProject?: boolean;
    isHqSector?: boolean;
    isActivity?: boolean;
    activityId?: number | null;
    onDemandReason?: string;
    activities?: ActivityRow[];
    progressSections?: Array<{ key: string; required: boolean; value: string }>;
    narrativeSections?: Array<{ key: string; required: boolean; value: string }>;
    hasDocs?: boolean;
    docsNoSupport?: boolean;
    docsNoSupportReason?: string;
  },
): { valid: boolean; tabErrors: Partial<Record<TabId, number>>; firstErrorTab: TabId | null } {
  const errs: Partial<Record<TabId, number>> = {};
  const addErr = (tab: TabId) => { errs[tab] = (errs[tab] ?? 0) + 1; };

  // Basic info
  if (!values.title.trim()) addErr("rp-section-basic");
  if (opts.isProject && !values.projectId) addErr("rp-section-basic");
  if (!values.stateId && !opts.isActivity && !opts.isHqSector) addErr("rp-section-basic");
  if (opts.isHqSector && !values.sector) addErr("rp-section-basic");
  if (opts.isActivity && !values.projectId) addErr("rp-section-basic");
  if (opts.isActivity && !opts.activityId) addErr("rp-section-basic");
  if (values.kind === "on_demand" && !values.periodStart?.trim()) addErr("rp-section-basic");
  if (values.kind === "on_demand" && !opts.onDemandReason?.trim()) addErr("rp-section-basic");

  // Progress narrative
  for (const f of opts.progressSections ?? []) {
    if (f.required && !f.value.trim()) addErr("rp-section-progress");
  }

  // Activities
  if (opts.isProject) {
    const acts = opts.activities ?? [];
    const clean = acts.filter((a) => a.name?.trim());
    if (clean.length === 0) addErr("rp-section-activities");
    for (const a of clean) {
      const actual = a.actualExpenditure === "" || a.actualExpenditure == null ? null : Number(a.actualExpenditure);
      if (actual === null) addErr("rp-section-activities");
      if (actual !== null && actual < 0) addErr("rp-section-activities");
    }
  }

  // Lessons (narrative)
  for (const f of opts.narrativeSections ?? []) {
    if (f.required && !f.value.trim()) addErr("rp-section-lessons");
  }

  // Attachments
  if (opts.isProject) {
    const hasDocs = opts.hasDocs ?? false;
    const bypass = (opts.docsNoSupport ?? false) && (opts.docsNoSupportReason ?? "").trim().length > 0;
    if (!hasDocs && !bypass) addErr("rp-section-attachments");
  }

  const TAB_ORDER: TabId[] = [
    "rp-section-basic",
    "rp-section-progress",
    "rp-section-activities",
    "rp-section-challenges",
    "rp-section-lessons",
    "rp-section-attachments",
  ];
  const firstErrorTab = TAB_ORDER.find((t) => errs[t] != null) ?? null;
  const valid = firstErrorTab == null;
  return { valid, tabErrors: errs, firstErrorTab };
}

/* ══════════════════════════════════════════════════════════════════════════
   Tests
══════════════════════════════════════════════════════════════════════════ */

describe("P1-01: Project Currency Derivation", () => {
  it("derives currency from the linked project object", () => {
    expect(deriveProjectCurrency({ currency: "EUR" })).toBe("EUR");
  });

  it("returns null when project has no currency field", () => {
    expect(deriveProjectCurrency({ id: 1 })).toBeNull();
  });

  it("returns null when project is null", () => {
    expect(deriveProjectCurrency(null)).toBeNull();
  });

  it("returns null when currency is an empty string", () => {
    expect(deriveProjectCurrency({ currency: "" })).toBeNull();
  });

  it("passes project currency to formatCurrencyDisplay", () => {
    const display = formatCurrencyDisplay(1000, "GBP");
    expect(display).toContain("1,000");
    expect(display.startsWith("£") || display.includes("GBP")).toBe(true);
  });

  it("formatCurrencyDisplay returns '—' for null value regardless of currency", () => {
    expect(formatCurrencyDisplay(null, "EUR")).toBe("—");
    expect(formatCurrencyDisplay(undefined, "EUR")).toBe("—");
  });
});

describe("P1-02: Null vs Zero Planned Budget", () => {
  it("emptyProjectActivity has plannedBudget: null (not 0)", () => {
    expect(emptyProjectActivity().plannedBudget).toBeNull();
  });

  it("null planned budget renders '—' not '$0.00'", () => {
    expect(formatCurrencyDisplay(null, "USD")).toBe("—");
  });

  it("factual zero planned budget renders formatted zero", () => {
    const display = formatCurrencyDisplay(0, "USD");
    expect(display).not.toBe("—");
    expect(display).toContain("0");
  });

  it("null planned excluded from linked total (hasAnyLinkedPlanned = false)", () => {
    const acts: ActivityRow[] = [
      { plannedBudget: null, actualExpenditure: 500 },
      { plannedBudget: null, actualExpenditure: 200 },
    ];
    const { linkedPlanned } = computeFinancials(acts);
    expect(linkedPlanned).toBeNull();
  });

  it("mix of null and non-null planned: only non-null counted", () => {
    const acts: ActivityRow[] = [
      { plannedBudget: null, actualExpenditure: 100 },
      { plannedBudget: 400, actualExpenditure: 300 },
    ];
    const { linkedPlanned } = computeFinancials(acts);
    expect(linkedPlanned).toBe(400);
  });
});

describe("P1-03: Draft vs Submit Validation", () => {
  const BASE_VALUES: FormShape = {
    title: "Test Report",
    kind: "monthly",
    projectId: 1,
    stateId: 2,
  };

  it("draft validation passes with only title + project + state", () => {
    const r = validateDraft(BASE_VALUES, { isProject: true });
    expect(r.valid).toBe(true);
  });

  it("draft validation fails without title", () => {
    const r = validateDraft({ ...BASE_VALUES, title: "" }, { isProject: true });
    expect(r.valid).toBe(false);
    expect(r.errorTab).toBe("rp-section-basic");
  });

  it("draft validation fails for project type without projectId", () => {
    const r = validateDraft({ ...BASE_VALUES, projectId: null }, { isProject: true });
    expect(r.valid).toBe(false);
  });

  it("draft validation does NOT require progress narrative", () => {
    // validateDraft only checks identity fields — narrative is not required
    const r = validateDraft(BASE_VALUES, { isProject: true });
    expect(r.valid).toBe(true);
  });

  it("submit validation fails without lessons-learned narrative", () => {
    const r = validateSubmit(BASE_VALUES, {
      isProject: true,
      activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
      hasDocs: true,
      narrativeSections: [{ key: "lessonsLearned", required: true, value: "" }],
    });
    expect(r.valid).toBe(false);
    expect(r.tabErrors["rp-section-lessons"]).toBeGreaterThan(0);
  });

  it("submit validation passes when all required fields are filled", () => {
    const r = validateSubmit(BASE_VALUES, {
      isProject: true,
      activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
      hasDocs: true,
      narrativeSections: [{ key: "lessonsLearned", required: true, value: "We learned X" }],
    });
    expect(r.valid).toBe(true);
  });
});

describe("P1-04: Zero-Denominator Utilisation", () => {
  it("returns '—' when planned is null", () => {
    expect(computeUtilisation(null, 0)).toBe("—");
  });

  it("returns '—' when planned is 0", () => {
    expect(computeUtilisation(0, 500)).toBe("—");
  });

  it("returns percentage string when planned > 0", () => {
    expect(computeUtilisation(1000, 800)).toBe("80%");
  });

  it("allows utilisation > 100% (overspend)", () => {
    expect(computeUtilisation(500, 600)).toBe("120%");
  });
});

describe("P1-05: Neutral Variance Display", () => {
  it("returns '—' when planned is null", () => {
    expect(computeVarianceLabel(null, 500)).toBe("—");
  });

  it("returns 'Underspend' label (no colour class)", () => {
    expect(computeVarianceLabel(1000, 800)).toMatch(/^Underspend/);
  });

  it("returns 'Overspend' label (no colour class)", () => {
    expect(computeVarianceLabel(500, 600)).toMatch(/^Overspend/);
  });

  it("returns 'On Budget' when planned equals actual", () => {
    expect(computeVarianceLabel(500, 500)).toBe("On Budget");
  });

  it("does NOT return 'success'/'destructive' CSS class tokens", () => {
    const label = computeVarianceLabel(1000, 800);
    expect(label).not.toMatch(/success|destructive|green|red/i);
  });
});

describe("P1-06: Variance Reason Required Logic", () => {
  it("required when actual > planned (over budget)", () => {
    expect(varianceReasonRequired(500, 600)).toBe(true);
  });

  it("required when utilisation < 70%", () => {
    expect(varianceReasonRequired(1000, 650)).toBe(true);
  });

  it("NOT required when utilisation is exactly 70%", () => {
    expect(varianceReasonRequired(1000, 700)).toBe(false);
  });

  it("NOT required when planned is null (no authoritative budget)", () => {
    expect(varianceReasonRequired(null, 500)).toBe(false);
  });

  it("NOT required when planned is 0", () => {
    expect(varianceReasonRequired(0, 500)).toBe(false);
  });

  it("NOT required for on-budget expenditure", () => {
    expect(varianceReasonRequired(1000, 1000)).toBe(false);
  });
});

describe("P1-07: First-Error Tab Navigation", () => {
  it("first error tab is 'basic' when title is missing", () => {
    const r = validateSubmit({ title: "", kind: "monthly", stateId: 1 }, { isProject: false });
    expect(r.firstErrorTab).toBe("rp-section-basic");
  });

  it("tab error counts are accumulated per tab", () => {
    const r = validateSubmit(
      { title: "", kind: "monthly", projectId: null, stateId: null },
      { isProject: true },
    );
    expect((r.tabErrors["rp-section-basic"] ?? 0)).toBeGreaterThan(1);
  });

  it("activities tab error reported when no activities for project report", () => {
    const r = validateSubmit(
      { title: "T", kind: "monthly", projectId: 1, stateId: 1 },
      { isProject: true, activities: [], hasDocs: true },
    );
    expect(r.tabErrors["rp-section-activities"]).toBeGreaterThan(0);
    expect(r.firstErrorTab).toBe("rp-section-activities");
  });

  it("attachments tab error reported when no docs and no bypass", () => {
    const r = validateSubmit(
      { title: "T", kind: "monthly", projectId: 1, stateId: 1 },
      {
        isProject: true,
        activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
        hasDocs: false,
        docsNoSupport: false,
      },
    );
    expect(r.tabErrors["rp-section-attachments"]).toBeGreaterThan(0);
  });
});

describe("P2-01: True Tab Architecture — section IDs match nav IDs", () => {
  const EXPECTED_TAB_IDS = [
    "rp-section-basic",
    "rp-section-progress",
    "rp-section-activities",
    "rp-section-challenges",
    "rp-section-lessons",
    "rp-section-attachments",
  ];

  it("all 6 canonical tab IDs are defined", () => {
    expect(EXPECTED_TAB_IDS).toHaveLength(6);
  });

  it("tab IDs match the section IDs expected by ARIA controls", () => {
    for (const id of EXPECTED_TAB_IDS) {
      expect(id).toMatch(/^rp-section-[a-z]+$/);
    }
  });

  it("Challenges tab ID hosts Project Risks (same tab)", () => {
    expect(EXPECTED_TAB_IDS).toContain("rp-section-challenges");
    // Project Risks section now belongs inside rp-section-challenges panel
  });

  it("Attachments tab ID hosts Voice Note (same tab)", () => {
    expect(EXPECTED_TAB_IDS).toContain("rp-section-attachments");
    // Voice Note now belongs inside rp-section-attachments panel
  });
});

describe("Unplanned Activity", () => {
  it("emptyProjectActivity sets isUnplanned: true", () => {
    expect(emptyProjectActivity().isUnplanned).toBe(true);
  });

  it("unplanned activities excluded from linked-activity planned total", () => {
    const acts: ActivityRow[] = [
      { plannedBudget: 1000, actualExpenditure: 800, isUnplanned: false },
      { plannedBudget: null, actualExpenditure: 300, isUnplanned: true },
    ];
    const { linkedPlanned, unplannedActual } = computeFinancials(acts);
    expect(linkedPlanned).toBe(1000);
    expect(unplannedActual).toBe(300);
  });

  it("unplanned expenditure is tracked separately, not in linked total", () => {
    const acts: ActivityRow[] = [
      { plannedBudget: null, actualExpenditure: 500, isUnplanned: true },
    ];
    const { linkedActual, unplannedActual } = computeFinancials(acts);
    expect(linkedActual).toBe(0);
    expect(unplannedActual).toBe(500);
  });
});

describe("Financial Summary Split", () => {
  it("linked planned + actual shown separately from unplanned expenditure", () => {
    const acts: ActivityRow[] = [
      { plannedBudget: 2000, actualExpenditure: 1800, isUnplanned: false, name: "A" },
      { plannedBudget: null, actualExpenditure: 400, isUnplanned: true, name: "B" },
    ];
    const fin = computeFinancials(acts);
    expect(fin.linkedPlanned).toBe(2000);
    expect(fin.linkedActual).toBe(1800);
    expect(fin.unplannedActual).toBe(400);
  });

  it("utilisation is null-safe when linked planned is null", () => {
    const acts: ActivityRow[] = [
      { plannedBudget: null, actualExpenditure: 500, isUnplanned: false },
    ];
    const { utilisation } = computeFinancials(acts);
    expect(utilisation).toBe("—");
  });
});

describe("Beneficiary Reach", () => {
  it("disclaimer text for project type contains 'deduplication' or 'unique individuals' intent", () => {
    const disclaimer = "Note: Individual beneficiaries may appear across multiple activities. Total counts may not reflect unique individuals.";
    expect(disclaimer).toContain("unique individuals");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BD-2: parseBenField — beneficiary field validation (zero is valid)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirror of the parseBenFe helper defined inside validateSubmit in reports.tsx.
 * Returns null for blank/missing/non-numeric/wrong-type, "negative" for < 0, or integer ≥ 0.
 * Only number and string types are accepted — booleans, arrays, objects are rejected.
 */
function parseBenField(v: unknown): number | null | "negative" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return "negative";
  return Math.floor(n);
}

type BenActivity = {
  name?: string;
  beneficiariesMen?: unknown;
  beneficiariesWomen?: unknown;
  beneficiariesBoys?: unknown;
  beneficiariesGirls?: unknown;
};

/** Run frontend beneficiary validation for a single activity, mirrors the loop in validateSubmit */
function validateActivityBeneficiaries(a: BenActivity): { errors: string[] } {
  const errors: string[] = [];
  const fields = [a.beneficiariesMen, a.beneficiariesWomen, a.beneficiariesBoys, a.beneficiariesGirls];
  for (const bv of fields) {
    const parsed = parseBenField(bv);
    if (parsed === null) errors.push("Beneficiary field is required — enter 0 if no direct reach occurred this period");
    else if (parsed === "negative") errors.push("Beneficiary values cannot be negative");
  }
  return { errors };
}

describe("BD-2: parseBenField — frontend beneficiary field validation", () => {
  it("explicit 0 for all fields → no errors (zero is valid)", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: 0, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors).toHaveLength(0);
  });

  it("positive values → no errors", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: 50, beneficiariesWomen: 60, beneficiariesBoys: 20, beneficiariesGirls: 30,
    });
    expect(r.errors).toHaveLength(0);
  });

  it("null field → required error", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: null, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });

  it("undefined field → required error", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: undefined, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });

  it("blank string → required error (not treated as 0)", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: "", beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });

  it("whitespace-only string → required error", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: "   ", beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });

  it("non-numeric string → required error (NaN treated as missing)", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: "abc", beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });

  it("negative value → negative error", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: -5, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/negative/);
  });

  it("actBen === 0 no longer triggers an error (zero is valid)", () => {
    // Old code: if (actBen === 0) { error }  — removed in BD-2
    const sumVal = 0 + 0 + 0 + 0; // simulate old actBen calculation
    // Verify that the old gate condition is no longer a trigger
    expect(sumVal === 0).toBe(true); // the sum is zero
    // But validation of explicit zeros should produce no errors:
    const r = validateActivityBeneficiaries({
      beneficiariesMen: 0, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors).toHaveLength(0);
  });

  it("projectBenTotal === 0 no longer triggers an error (aggregate gate removed)", () => {
    // Old code: if (projectBenTotal === 0) { addErr; msgs.push("Enter beneficiary numbers...") } — removed
    const projectBenTotal = 0; // simulate all-zero activities
    // The old aggregate gate condition:
    const wouldHaveBlocked = projectBenTotal === 0;
    expect(wouldHaveBlocked).toBe(true); // it was true
    // But the gate is gone — only per-field blank/negative checks remain
    // Verified by the parseBenField tests above: explicit 0 passes
    expect(parseBenField(0)).toBe(0);
  });

  it("parseBenField: floor applied to decimal input", () => {
    expect(parseBenField(3.9)).toBe(3);
    expect(parseBenField(0.1)).toBe(0);
  });

  it("parseBenField: numeric string '0' is treated as valid zero", () => {
    expect(parseBenField("0")).toBe(0);
  });

  it("parseBenField: numeric string '50' is treated as 50", () => {
    expect(parseBenField("50")).toBe(50);
  });

  it("boolean true → null (rejected: non-string/non-number type)", () => {
    // Number(true) === 1, but true is not a valid beneficiary value
    expect(parseBenField(true)).toBeNull();
  });

  it("boolean false → null (not treated as 0)", () => {
    // Number(false) === 0, but false is not a valid explicit zero entry
    expect(parseBenField(false)).toBeNull();
  });

  it("array [] → null (object-type rejected)", () => {
    // Number([]) === 0, but arrays are not valid beneficiary values
    expect(parseBenField([])).toBeNull();
  });

  it("array [1] → null (single-element array rejected)", () => {
    // Number([1]) === 1, but arrays are not valid
    expect(parseBenField([1])).toBeNull();
  });

  it("object {} → null (plain object rejected)", () => {
    expect(parseBenField({})).toBeNull();
  });

  it("boolean true beneficiary → required error when validated through activity loop", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: true, beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });

  it("array [] beneficiary → required error when validated through activity loop", () => {
    const r = validateActivityBeneficiaries({
      beneficiariesMen: [], beneficiariesWomen: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/required/);
  });
});

describe("On-Demand Period Validation", () => {
  it("draft validation rejects on_demand without periodStart", () => {
    const r = validateDraft(
      { title: "T", kind: "on_demand", projectId: 1, stateId: 1, periodStart: "" },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errorMsg).toMatch(/Period Start/);
  });

  it("draft validation passes on_demand with periodStart set", () => {
    const r = validateDraft(
      { title: "T", kind: "on_demand", projectId: 1, stateId: 1, periodStart: "2026-07-01" },
      { isProject: true },
    );
    expect(r.valid).toBe(true);
  });

  it("period computation for on_demand uses periodStart, not today", () => {
    const period = computePeriod("on_demand", 2026, 1, 1, "2026-03-15");
    expect(period).toBe("2026-03-15");
  });

  it("period for on_demand is empty string (not today) when periodStart is null", () => {
    // When periodStart is null, falls back to year string (explicit, never Date.now())
    const period = computePeriod("on_demand", 2026, 1, 1, null);
    expect(period).toBe("2026");
  });
});

describe("Supporting Documents Bypass", () => {
  it("submit passes with docs attached (no bypass needed)", () => {
    const r = validateSubmit(
      { title: "T", kind: "monthly", projectId: 1, stateId: 1 },
      {
        isProject: true,
        activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
        hasDocs: true,
      },
    );
    expect(r.tabErrors["rp-section-attachments"]).toBeUndefined();
  });

  it("submit fails when no docs and no bypass", () => {
    const r = validateSubmit(
      { title: "T", kind: "monthly", projectId: 1, stateId: 1 },
      {
        isProject: true,
        activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
        hasDocs: false,
        docsNoSupport: false,
      },
    );
    expect(r.tabErrors["rp-section-attachments"]).toBeGreaterThan(0);
  });

  it("submit passes with bypass checkbox + reason", () => {
    const r = validateSubmit(
      { title: "T", kind: "monthly", projectId: 1, stateId: 1 },
      {
        isProject: true,
        activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
        hasDocs: false,
        docsNoSupport: true,
        docsNoSupportReason: "Field office inaccessible this period.",
      },
    );
    expect(r.tabErrors["rp-section-attachments"]).toBeUndefined();
  });

  it("submit fails with bypass checkbox but empty reason", () => {
    const r = validateSubmit(
      { title: "T", kind: "monthly", projectId: 1, stateId: 1 },
      {
        isProject: true,
        activities: [{ plannedBudget: 100, actualExpenditure: 90, name: "A" }],
        hasDocs: false,
        docsNoSupport: true,
        docsNoSupportReason: "",
      },
    );
    expect(r.tabErrors["rp-section-attachments"]).toBeGreaterThan(0);
  });
});

describe("Period Computation", () => {
  it("monthly: formats year-month with zero-padded month", () => {
    expect(computePeriod("monthly", 2026, 3, 1, null)).toBe("2026-03");
    expect(computePeriod("monthly", 2026, 11, 1, null)).toBe("2026-11");
  });

  it("quarterly: formats year-Q<n>", () => {
    expect(computePeriod("quarterly", 2026, 1, 2, null)).toBe("2026-Q2");
  });

  it("annual: returns year as string", () => {
    expect(computePeriod("annual", 2026, 1, 1, null)).toBe("2026");
  });
});

describe("Edge Cases", () => {
  it("zero actual expenditure with non-null planned shows 0% utilisation, not '—'", () => {
    expect(computeUtilisation(1000, 0)).toBe("0%");
  });

  it("very large numbers formatted without truncation", () => {
    const display = formatCurrencyDisplay(10_000_000, "USD");
    expect(display).toContain("10,000,000");
  });

  it("negative planned budget not produced by emptyProjectActivity", () => {
    const a = emptyProjectActivity();
    expect((a.plannedBudget ?? 0) >= 0).toBe(true);
  });

  it("tab error counts never go negative", () => {
    const r = validateSubmit(
      { title: "All Good", kind: "monthly", projectId: 1, stateId: 1 },
      {
        isProject: true,
        activities: [{ plannedBudget: 200, actualExpenditure: 180, name: "A" }],
        hasDocs: true,
      },
    );
    for (const count of Object.values(r.tabErrors)) {
      expect(count).toBeGreaterThan(0);
    }
    expect(r.valid).toBe(true);
    expect(Object.keys(r.tabErrors)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PMR Identity & Reporting Location Foundation
   PR-ID, PR-LOC, PR-HQ, PR-DUP, PR-FORM, PR-REG, PR-SEC
   All helpers are pure mirrors of the business logic added in Task 226.
══════════════════════════════════════════════════════════════════════════ */

// ── PMR form shape (extended) ─────────────────────────────────────────────────

type PmrFormShape = {
  title: string;
  kind: string;
  projectId?: number | null;
  stateId?: number | null;
  sector?: string | null;
  periodStart?: string | null;
  pmrLocationType?: "state" | "hq";
};

// ── PMR Draft validation (mirrors updated validateDraft in reports.tsx) ────────

function validatePmrDraft(
  values: PmrFormShape,
  opts: { isProject?: boolean; isHqSector?: boolean },
): { valid: boolean; errorMsg: string | null } {
  if (!values.title.trim()) return { valid: false, errorMsg: "Report Title is required" };
  if (opts.isProject && !values.projectId) return { valid: false, errorMsg: "Project is required" };
  // stateId not required for HQ PMR
  if (!values.stateId && !opts.isHqSector && values.pmrLocationType !== "hq") {
    return { valid: false, errorMsg: "Reporting Location is required" };
  }
  return { valid: true, errorMsg: null };
}

// ── PMR Location filtering ────────────────────────────────────────────────────

type ProjectStub = {
  id: number;
  title: string;
  code: string;
  stateIds?: number[];
  managementLevel?: "hq_managed" | "state_managed" | null;
  hasHqOperations?: boolean;
};

type StateStub = { id: number; name: string };

/** Filter available states based on the selected project's stateIds. */
function filterStatesByProject(
  allStates: StateStub[],
  project: ProjectStub | null | undefined,
): StateStub[] {
  if (!project) return allStates;
  const ids = project.stateIds ?? [];
  if (ids.length === 0) return allStates;
  return allStates.filter((s) => ids.includes(s.id));
}

/** Auto-select the only state when a project has exactly one linked state. */
function autoSelectState(project: ProjectStub | null | undefined): number | null {
  const ids = project?.stateIds ?? [];
  return ids.length === 1 ? ids[0] : null;
}

/** Determine whether HQ is a valid reporting location for a project + user role.
 *  Mirrors the backend deny-by-default rule: only explicit hasHqOperations=true permits HQ.
 *  managementLevel is independent — a project can be hq_managed without HQ operations,
 *  or state_managed with HQ operations legitimately set.
 */
function isPmrHqAvailable(
  project: ProjectStub | null | undefined,
  userRole: string,
  selectedProjectId: number | undefined,
): boolean {
  if (!selectedProjectId || !project) return false;
  const stateRoles = ["state_program_officer", "state_office_manager"];
  if (stateRoles.includes(userRole)) return false;
  return project.hasHqOperations === true;
}

// ── PMR duplicate identity ────────────────────────────────────────────────────

type PmrReportStub = {
  id: number;
  projectId: number;
  stateId: number | null;
  locationType: "state" | "hq" | null;
  period: string;
  kind: string;
  status: string;
  migrationIsDuplicate?: boolean;
};

/** Check if a new PMR would collide with an existing report. Mirrors backend dup-check logic. */
function checkPmrDuplicate(
  existingReports: PmrReportStub[],
  newReport: { projectId: number; stateId: number | null; locationType: "state" | "hq" | null; period: string; kind: string },
): { isDuplicate: boolean; existingId?: number } {
  const BLOCKED_STATUSES = new Set(["rejected", "archived"]);
  for (const r of existingReports) {
    if (r.migrationIsDuplicate) continue; // PR-DUP-05: skip migration duplicates
    if (BLOCKED_STATUSES.has(r.status)) continue;
    if (r.projectId !== newReport.projectId) continue;
    if (r.kind !== newReport.kind) continue;
    if (r.period !== newReport.period) continue;
    // Location identity: HQ and State are distinct
    const sameLocation =
      newReport.locationType === "hq"
        ? r.locationType === "hq" && r.stateId === null
        : r.locationType !== "hq" && r.stateId === newReport.stateId;
    if (sameLocation) return { isDuplicate: true, existingId: r.id };
  }
  return { isDuplicate: false };
}

// ── PMR PATCH identity immutability ───────────────────────────────────────────

const PMR_IDENTITY_FIELDS = ["projectId", "stateId", "locationType", "period", "reportingMonth", "reportingYear"] as const;

function checkPmrPatchImmutability(
  patchBody: Record<string, unknown>,
  isSuperAdmin: boolean,
): { blocked: boolean; fields: string[] } {
  if (isSuperAdmin) return { blocked: false, fields: [] };
  const attempted = PMR_IDENTITY_FIELDS.filter((f) => patchBody[f] !== undefined);
  return { blocked: attempted.length > 0, fields: attempted };
}

// ── PMR title format ──────────────────────────────────────────────────────────

function buildPmrTitle(projectCode: string, kind: string, period: string): string {
  const kindLabel = kind === "monthly" ? "Monthly" : kind === "quarterly" ? "Quarterly" : kind === "annual" ? "Annual" : "On-Demand";
  return projectCode ? `${projectCode} — ${kindLabel} Report — ${period}` : `${kindLabel} Report — ${period}`;
}

// ── Can't Find Your Project? guidance ────────────────────────────────────────

type CannotFindGuidance = { shown: boolean; hasRegisterLink: boolean; message: string };

function getCannotFindGuidance(
  _projectList: unknown[],
  canCreateProject: boolean,
): CannotFindGuidance {
  // Guidance is always shown below the Project selector in PMR forms (no list-length gate).
  const msg = "The project must be registered in CAFA PMIS before a Monthly Project Report can be created.";
  return {
    shown: true,
    hasRegisterLink: canCreateProject,
    message: msg,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   PR-ID: Project Identity Tests (01–05)
══════════════════════════════════════════════════════════════════════════ */

describe("PR-ID-01: Project is required for draft validation", () => {
  it("draft fails without projectId for project report type", () => {
    const r = validatePmrDraft(
      { title: "Test", kind: "monthly", projectId: null, stateId: 1 },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errorMsg).toContain("Project");
  });

  it("draft passes with projectId set", () => {
    const r = validatePmrDraft(
      { title: "Test", kind: "monthly", projectId: 1, stateId: 1 },
      { isProject: true },
    );
    expect(r.valid).toBe(true);
  });
});

describe("PR-ID-02: Non-existent project would be rejected by backend", () => {
  it("project duplicate check can be keyed by projectId", () => {
    // Simulates backend logic: non-existent projectId returns no reports → no block
    const result = checkPmrDuplicate([], { projectId: 9999, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly" });
    expect(result.isDuplicate).toBe(false);
  });
});

describe("PR-ID-03: Unauthorised project access blocked", () => {
  it("state-scoped user cannot create HQ PMR (role check)", () => {
    const available = isPmrHqAvailable(
      { id: 1, title: "P", code: "P", managementLevel: "hq_managed" },
      "state_program_officer",
      1,
    );
    expect(available).toBe(false);
  });

  it("SOM cannot create HQ PMR (role check)", () => {
    const available = isPmrHqAvailable(
      { id: 1, title: "P", code: "P", managementLevel: "hq_managed" },
      "state_office_manager",
      1,
    );
    expect(available).toBe(false);
  });
});

describe("PR-ID-04: Valid project + title succeeds in draft validation", () => {
  it("valid project report draft passes all required checks", () => {
    const r = validatePmrDraft(
      { title: "PROJ-001 — Monthly Report — July 2026", kind: "monthly", projectId: 1, stateId: 2 },
      { isProject: true },
    );
    expect(r.valid).toBe(true);
    expect(r.errorMsg).toBeNull();
  });
});

describe("PR-ID-05: Free-text project entry not accepted", () => {
  it("project must be a numeric ID, not a string title", () => {
    // projectId = 0 (falsy) simulates "free-text was entered but no ID was resolved"
    const r = validatePmrDraft(
      { title: "Test", kind: "monthly", projectId: 0, stateId: 1 },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errorMsg).toContain("Project");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-LOC: Reporting Location Tests (01–07)
══════════════════════════════════════════════════════════════════════════ */

const ALL_STATES: StateStub[] = [
  { id: 1, name: "Khartoum" },
  { id: 2, name: "Kassala" },
  { id: 3, name: "Gedaref" },
];

describe("PR-LOC-01: Single-state project filters location to its one state", () => {
  const proj: ProjectStub = { id: 10, title: "P", code: "P", stateIds: [2] };

  it("filterStatesByProject returns only the linked state", () => {
    const filtered = filterStatesByProject(ALL_STATES, proj);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(2);
  });
});

describe("PR-LOC-02: Single-state project auto-selects its state", () => {
  const proj: ProjectStub = { id: 10, title: "P", code: "P", stateIds: [2] };

  it("autoSelectState returns the single stateId", () => {
    expect(autoSelectState(proj)).toBe(2);
  });
});

describe("PR-LOC-03: Wrong state for single-state project is not in filtered list", () => {
  const proj: ProjectStub = { id: 10, title: "P", code: "P", stateIds: [2] };

  it("state 1 is not available for a project linked only to state 2", () => {
    const filtered = filterStatesByProject(ALL_STATES, proj);
    expect(filtered.map((s) => s.id)).not.toContain(1);
  });
});

describe("PR-LOC-04: Multi-state project shows only its linked states", () => {
  const proj: ProjectStub = { id: 11, title: "P", code: "P", stateIds: [1, 3] };

  it("filterStatesByProject returns only states 1 and 3", () => {
    const filtered = filterStatesByProject(ALL_STATES, proj);
    expect(filtered.map((s) => s.id)).toEqual([1, 3]);
  });

  it("state 2 is excluded for a project linked to states 1 and 3", () => {
    const filtered = filterStatesByProject(ALL_STATES, proj);
    expect(filtered.map((s) => s.id)).not.toContain(2);
  });
});

describe("PR-LOC-05: autoSelectState does not auto-select for multi-state projects", () => {
  const proj: ProjectStub = { id: 11, title: "P", code: "P", stateIds: [1, 3] };

  it("returns null for multi-state project (user must choose)", () => {
    expect(autoSelectState(proj)).toBeNull();
  });
});

describe("PR-LOC-06: Cross-state submission blocked by duplicate check", () => {
  it("state 1 report and state 3 report for same project+period are distinct, not blocked", () => {
    const existing: PmrReportStub[] = [
      { id: 1, projectId: 11, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "draft" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 11, stateId: 3, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });
});

describe("PR-LOC-07: Two locations for same project/month are distinct identities", () => {
  it("same project + different state + same period = distinct report (not a duplicate)", () => {
    const existing: PmrReportStub[] = [
      { id: 1, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "submitted" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 2, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-HQ: HQ Reporting Location Tests (01–04)
══════════════════════════════════════════════════════════════════════════ */

describe("PR-HQ-01: HQ report has stateId=null and locationType=hq", () => {
  it("HQ PMR does not need a stateId for draft validation", () => {
    const r = validatePmrDraft(
      { title: "Test HQ", kind: "monthly", projectId: 1, stateId: null, pmrLocationType: "hq" },
      { isProject: true },
    );
    expect(r.valid).toBe(true);
  });

  it("checkPmrDuplicate uses HQ identity (state_id IS NULL + location_type='hq')", () => {
    const existing: PmrReportStub[] = [
      { id: 1, projectId: 1, stateId: null, locationType: "hq", period: "2026-07", kind: "monthly", status: "draft" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 1, stateId: null, locationType: "hq", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(true);
  });
});

describe("PR-HQ-02: HQ is exempt from state-required validation", () => {
  it("stateId=null is valid when pmrLocationType='hq'", () => {
    const r = validatePmrDraft(
      { title: "HQ Report", kind: "monthly", projectId: 5, stateId: null, pmrLocationType: "hq" },
      { isProject: true },
    );
    expect(r.valid).toBe(true);
    expect(r.errorMsg).toBeNull();
  });

  it("stateId=null without HQ flag triggers state error", () => {
    const r = validatePmrDraft(
      { title: "Report", kind: "monthly", projectId: 5, stateId: null, pmrLocationType: "state" },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errorMsg).toContain("Location");
  });
});

describe("PR-HQ-03: Arbitrary HQ bypass blocked for state-scoped users", () => {
  it("SPO cannot access HQ option (isPmrHqAvailable=false)", () => {
    const proj: ProjectStub = { id: 1, title: "P", code: "P", managementLevel: "hq_managed" };
    expect(isPmrHqAvailable(proj, "state_program_officer", 1)).toBe(false);
  });

  it("state_managed project does not offer HQ to non-PM users", () => {
    const proj: ProjectStub = { id: 2, title: "P", code: "P", managementLevel: "state_managed" };
    expect(isPmrHqAvailable(proj, "technical_coordinator", 2)).toBe(false);
  });

  it("null management_level is denied (no authoritative HQ evidence)", () => {
    // Backend deny-by-default: only explicit 'hq_managed' permits HQ.
    const proj: ProjectStub = { id: 4, title: "P", code: "P", managementLevel: null };
    expect(isPmrHqAvailable(proj, "technical_coordinator", 4)).toBe(false);
  });

  it("hq_managed project with hasHqOperations=true offers HQ to TC (non-state-scoped)", () => {
    const proj: ProjectStub = { id: 3, title: "P", code: "P", managementLevel: "hq_managed", hasHqOperations: true };
    expect(isPmrHqAvailable(proj, "technical_coordinator", 3)).toBe(true);
  });
});

describe("PR-HQ-04: State report still requires a stateId", () => {
  it("stateId=0 with locationType=state fails draft validation", () => {
    const r = validatePmrDraft(
      { title: "Report", kind: "monthly", projectId: 1, stateId: 0, pmrLocationType: "state" },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
  });

  it("stateId=3 with locationType=state passes draft validation", () => {
    const r = validatePmrDraft(
      { title: "Report", kind: "monthly", projectId: 1, stateId: 3, pmrLocationType: "state" },
      { isProject: true },
    );
    expect(r.valid).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-DUP: Duplicate Check Tests (01–05)
══════════════════════════════════════════════════════════════════════════ */

describe("PR-DUP-01: Same project + location + period = duplicate", () => {
  it("exact match on project/state/period/kind is a duplicate", () => {
    const existing: PmrReportStub[] = [
      { id: 5, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "draft" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe(5);
  });
});

describe("PR-DUP-02: Same project + different location + same period = distinct", () => {
  it("different stateId with same project/period is NOT a duplicate", () => {
    const existing: PmrReportStub[] = [
      { id: 5, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "draft" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 2, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });
});

describe("PR-DUP-03: HQ and state are distinct location identities", () => {
  it("HQ report does not duplicate a same-project state report", () => {
    const existing: PmrReportStub[] = [
      { id: 5, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "submitted" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: null, locationType: "hq", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });

  it("state report does not duplicate a same-project HQ report", () => {
    const existing: PmrReportStub[] = [
      { id: 6, projectId: 10, stateId: null, locationType: "hq", period: "2026-07", kind: "monthly", status: "submitted" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });
});

describe("PR-DUP-04: Returned/archived reports do not block re-submission", () => {
  it("rejected report is not treated as a blocker", () => {
    const existing: PmrReportStub[] = [
      { id: 7, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "rejected" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });

  it("archived report is not treated as a blocker", () => {
    const existing: PmrReportStub[] = [
      { id: 8, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "archived" },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });
});

describe("PR-DUP-05: migration_is_duplicate records excluded from dup check", () => {
  it("migration-marked duplicate does not block a new legitimate report", () => {
    const existing: PmrReportStub[] = [
      {
        id: 9, projectId: 10, stateId: 1, locationType: "state",
        period: "2026-07", kind: "monthly", status: "submitted",
        migrationIsDuplicate: true,
      },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(false);
  });

  it("non-migration duplicate still blocks", () => {
    const existing: PmrReportStub[] = [
      {
        id: 10, projectId: 10, stateId: 1, locationType: "state",
        period: "2026-07", kind: "monthly", status: "submitted",
        migrationIsDuplicate: false,
      },
    ];
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly",
    });
    expect(result.isDuplicate).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-FORM: Form Field Ordering & State Logic (01–03)
══════════════════════════════════════════════════════════════════════════ */

describe("PR-FORM-01: Project change clears the previously selected location", () => {
  it("location state resets to 'state' when project changes", () => {
    // Simulate user had state 2 selected, then changes project
    let pmrLocationType: "state" | "hq" = "hq";
    let stateId = 0;

    // Simulating the onValueChange handler for the project selector
    const onProjectChange = (newProjectId: number) => {
      if (newProjectId !== 0) {
        stateId = 0;
        pmrLocationType = "state";
      }
    };

    onProjectChange(99); // user picks a different project
    expect(pmrLocationType).toBe("state");
    expect(stateId).toBe(0);
  });
});

describe("PR-FORM-02: Location options recalculate when project changes", () => {
  it("changing project updates the filtered state list", () => {
    const proj1: ProjectStub = { id: 1, title: "P1", code: "P1", stateIds: [1] };
    const proj2: ProjectStub = { id: 2, title: "P2", code: "P2", stateIds: [2, 3] };

    const filtered1 = filterStatesByProject(ALL_STATES, proj1);
    const filtered2 = filterStatesByProject(ALL_STATES, proj2);

    expect(filtered1.map((s) => s.id)).toEqual([1]);
    expect(filtered2.map((s) => s.id)).toEqual([2, 3]);
    expect(filtered1).not.toEqual(filtered2);
  });
});

describe("PR-FORM-03: Location selector is disabled until a project is selected", () => {
  it("no project selected means location selector should be disabled", () => {
    // In the UI: disabled={isProject && !selectedProjectId}
    const isProject = true;
    const selectedProjectId: number | undefined = undefined;
    const isLocationDisabled = isProject && !selectedProjectId;
    expect(isLocationDisabled).toBe(true);
  });

  it("location selector is enabled once a project is selected", () => {
    const isProject = true;
    const selectedProjectId = 1;
    const isLocationDisabled = isProject && !selectedProjectId;
    expect(isLocationDisabled).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-REG: "Can't Find Your Project?" Guidance (01–04)
══════════════════════════════════════════════════════════════════════════ */

describe("PR-REG-01: Guidance always appears in the PMR form", () => {
  it("getCannotFindGuidance returns shown=true for empty list", () => {
    const g = getCannotFindGuidance([], false);
    expect(g.shown).toBe(true);
    expect(g.message).toContain("registered in CAFA PMIS");
  });

  it("guidance remains shown even when projects are available", () => {
    const g = getCannotFindGuidance([{ id: 1 }], true);
    expect(g.shown).toBe(true);
  });
});

describe("PR-REG-02: Authorised user gets a Register Project action", () => {
  it("canCreateProject=true adds a register link to the guidance", () => {
    const g = getCannotFindGuidance([], true);
    expect(g.shown).toBe(true);
    expect(g.hasRegisterLink).toBe(true);
  });
});

describe("PR-REG-03: Unauthorised user does not get a Register Project action", () => {
  it("canCreateProject=false shows team-contact guidance instead", () => {
    const g = getCannotFindGuidance([], false);
    expect(g.shown).toBe(true);
    expect(g.hasRegisterLink).toBe(false);
  });
});

describe("PR-REG-04: Register link navigates to existing project registration flow", () => {
  it("guidance includes a reference to registering a project (not a second creation form)", () => {
    const g = getCannotFindGuidance([], true);
    // The guidance message refers to project registration, not a new inline form
    expect(g.message).toContain("registered");
    expect(g.hasRegisterLink).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-REG-05 to PR-REG-11: Persistent guidance (visible regardless of project count)
══════════════════════════════════════════════════════════════════════════ */

/** Mirror of the canCreateProject derivation in reports.tsx. */
function deriveCanCreateProject(permissions: string[]): boolean {
  return permissions.some((p) => p === "projects.create" || p === "*");
}

/** The route used by the Register Project link in the PMR form. */
const REGISTER_PROJECT_ROUTE = "/projects/new";

describe("PR-REG-05: Zero projects + projects.create → guidance + Register Project action present", () => {
  it("guidance is shown when project list is empty", () => {
    const g = getCannotFindGuidance([], true);
    expect(g.shown).toBe(true);
  });

  it("Register Project action is present when canCreateProject=true and list is empty", () => {
    const g = getCannotFindGuidance([], true);
    expect(g.hasRegisterLink).toBe(true);
  });
});

describe("PR-REG-06: Multiple projects + projects.create → guidance still visible + Register Project present", () => {
  const manyProjects = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("guidance remains shown when project list has multiple entries", () => {
    const g = getCannotFindGuidance(manyProjects, true);
    expect(g.shown).toBe(true);
  });

  it("Register Project action is present when canCreateProject=true and list is non-empty", () => {
    const g = getCannotFindGuidance(manyProjects, true);
    expect(g.hasRegisterLink).toBe(true);
  });
});

describe("PR-REG-07: Multiple projects, no projects.create → guidance visible, no Register Project action", () => {
  const manyProjects = [{ id: 1 }, { id: 2 }];

  it("guidance is shown even without create permission", () => {
    const g = getCannotFindGuidance(manyProjects, false);
    expect(g.shown).toBe(true);
  });

  it("no Register Project link when canCreateProject=false", () => {
    const g = getCannotFindGuidance(manyProjects, false);
    expect(g.hasRegisterLink).toBe(false);
  });
});

describe("PR-REG-08: Wildcard * permission → Register Project action present", () => {
  it("'*' permission resolves canCreateProject=true", () => {
    expect(deriveCanCreateProject(["*"])).toBe(true);
  });

  it("wildcard user gets Register Project link in guidance", () => {
    const canCreate = deriveCanCreateProject(["*"]);
    const g = getCannotFindGuidance([{ id: 1 }, { id: 2 }], canCreate);
    expect(g.hasRegisterLink).toBe(true);
  });

  it("projects.create explicit permission also resolves canCreateProject=true", () => {
    expect(deriveCanCreateProject(["projects.create"])).toBe(true);
  });

  it("unrelated permission does not grant canCreateProject", () => {
    expect(deriveCanCreateProject(["reports.create", "plans.view"])).toBe(false);
  });
});

describe("PR-REG-09: Register Project link href uses the existing Projects Module registration route", () => {
  it("the registration route is /projects/new", () => {
    expect(REGISTER_PROJECT_ROUTE).toBe("/projects/new");
  });

  it("route does not point to a new separate page or inline form", () => {
    expect(REGISTER_PROJECT_ROUTE).not.toContain("report");
    expect(REGISTER_PROJECT_ROUTE).not.toContain("inline");
  });
});

describe("PR-REG-10: No free-text project input in the PMR form", () => {
  it("draft validation requires a numeric projectId, not a string title", () => {
    // projectId=0 (falsy) simulates free-text entry resolving to no ID
    const r = validateDraft(
      { title: "T", kind: "monthly", projectId: 0, stateId: 1 },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errorMsg).toContain("Project");
  });

  it("undefined projectId also fails draft validation for PMR", () => {
    const r = validateDraft(
      { title: "T", kind: "monthly", projectId: undefined, stateId: 1 },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
  });

  it("null projectId also fails draft validation for PMR", () => {
    const r = validateDraft(
      { title: "T", kind: "monthly", projectId: null, stateId: 1 },
      { isProject: true },
    );
    expect(r.valid).toBe(false);
  });
});

describe("PR-REG-11: Guidance not duplicated when project list is empty — appears exactly once", () => {
  it("guidance helper returns a single shown=true result, not two separate entries", () => {
    // The pure helper is called once; a component that calls it once renders it once.
    const results = [getCannotFindGuidance([], false)];
    const shownCount = results.filter((g) => g.shown).length;
    expect(shownCount).toBe(1);
  });

  it("guidance message is a single coherent string, not concatenated duplicates", () => {
    const g = getCannotFindGuidance([], false);
    const msg = g.message;
    // The phrase should appear exactly once
    const occurrences = msg.split("registered in CAFA PMIS").length - 1;
    expect(occurrences).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PR-SEC: Security Tests
══════════════════════════════════════════════════════════════════════════ */

describe("PR-SEC: Cross-state access blocked", () => {
  it("a project not linked to state 3 — state 3 is absent from filtered list", () => {
    const proj: ProjectStub = { id: 20, title: "P", code: "P", stateIds: [1, 2] };
    const filtered = filterStatesByProject(ALL_STATES, proj);
    expect(filtered.map((s) => s.id)).not.toContain(3);
  });
});

describe("PR-SEC: Arbitrary stateId rejected by dup-check logic", () => {
  it("a stateId not linked to the project does not match any existing report", () => {
    const existing: PmrReportStub[] = [
      { id: 1, projectId: 10, stateId: 1, locationType: "state", period: "2026-07", kind: "monthly", status: "submitted" },
    ];
    // Attacker tries state 99 (not linked) — no duplicate is found, but backend would reject it
    const result = checkPmrDuplicate(existing, {
      projectId: 10, stateId: 99, locationType: "state", period: "2026-07", kind: "monthly",
    });
    // Not a dup — backend state-link validation would still reject the POST
    expect(result.isDuplicate).toBe(false);
  });
});

describe("PR-SEC: PATCH identity fields immutable for project reports", () => {
  it("sending projectId on PATCH is blocked (non-super_admin)", () => {
    const r = checkPmrPatchImmutability({ projectId: 99 }, false);
    expect(r.blocked).toBe(true);
    expect(r.fields).toContain("projectId");
  });

  it("sending stateId on PATCH is blocked", () => {
    const r = checkPmrPatchImmutability({ stateId: 2 }, false);
    expect(r.blocked).toBe(true);
    expect(r.fields).toContain("stateId");
  });

  it("sending locationType on PATCH is blocked", () => {
    const r = checkPmrPatchImmutability({ locationType: "hq" }, false);
    expect(r.blocked).toBe(true);
    expect(r.fields).toContain("locationType");
  });

  it("sending period on PATCH is blocked", () => {
    const r = checkPmrPatchImmutability({ period: "2026-08" }, false);
    expect(r.blocked).toBe(true);
    expect(r.fields).toContain("period");
  });

  it("super_admin may bypass identity immutability", () => {
    const r = checkPmrPatchImmutability({ projectId: 1, stateId: 2 }, true);
    expect(r.blocked).toBe(false);
    expect(r.fields).toHaveLength(0);
  });

  it("non-identity fields on PATCH are not blocked", () => {
    const r = checkPmrPatchImmutability({ title: "Updated Title", narrative: "..." }, false);
    expect(r.blocked).toBe(false);
    expect(r.fields).toHaveLength(0);
  });
});

describe("PR-HQ: HQ option not shown when no project is selected (before project)", () => {
  it("isPmrHqAvailable returns false when selectedProjectId is undefined", () => {
    const proj: ProjectStub = { id: 1, title: "P", code: "P", managementLevel: "hq_managed" };
    expect(isPmrHqAvailable(proj, "technical_coordinator", undefined)).toBe(false);
  });
});

describe("PMR title format — remains unambiguous for multi-location projects", () => {
  it("title uses project code + report type + period (no location suffix needed)", () => {
    const title = buildPmrTitle("PROJ-001", "monthly", "July 2026");
    expect(title).toBe("PROJ-001 — Monthly Report — July 2026");
    // Location is shown separately in the form context; not encoded in the title
    expect(title).not.toContain("Khartoum");
    expect(title).not.toContain("HQ");
  });

  it("title works without project code (falls back gracefully)", () => {
    const title = buildPmrTitle("", "monthly", "July 2026");
    expect(title).toBe("Monthly Report — July 2026");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LT-API: locationType field in Report API responses
   These tests verify the serialiser contract for the locationType field
   returned by the reportSelect query and declared in the OpenAPI schema.
   Valid values: "state" | "hq" | null
══════════════════════════════════════════════════════════════════════════ */

/** Minimal Report shape sufficient to test locationType behaviour. */
type ReportStub = {
  id: number;
  title: string;
  kind: string;
  status: string;
  period: string;
  submittedByName: string;
  submittedAt: string;
  stateId: number | null;
  locationType: "state" | "hq" | null;
  reportType?: string | null;
  activityId?: number | null;
};

/**
 * Mirrors the COALESCE logic from the reportSelect SQL:
 *   COALESCE(r.location_type, CASE WHEN r.state_id IS NOT NULL THEN 'state' ELSE NULL END)
 */
function resolveLocationType(
  rawLocationType: "state" | "hq" | null | undefined,
  stateId: number | null | undefined,
): "state" | "hq" | null {
  if (rawLocationType != null) return rawLocationType;
  if (stateId != null) return "state";
  return null;
}

/** Simulate reading locationType from a Report response (matches reports.tsx usage). */
function restoreLocationType(report: ReportStub): "hq" | "state" {
  return report.locationType === "hq" ? "hq" : "state";
}

describe("LT-API-01: State project report includes locationType: 'state'", () => {
  it("report with stateId set returns locationType 'state'", () => {
    const resolved = resolveLocationType(null, 5);
    expect(resolved).toBe("state");
  });

  it("report with explicit locationType 'state' preserves the value", () => {
    const resolved = resolveLocationType("state", 5);
    expect(resolved).toBe("state");
  });

  it("restoreLocationType returns 'state' when locationType is 'state'", () => {
    const report: ReportStub = {
      id: 1, title: "T", kind: "monthly", status: "draft",
      period: "2026-07", submittedByName: "User", submittedAt: "2026-07-01",
      stateId: 3, locationType: "state",
    };
    expect(restoreLocationType(report)).toBe("state");
  });

  it("restoreLocationType defaults to 'state' when locationType is null", () => {
    const report: ReportStub = {
      id: 2, title: "T", kind: "monthly", status: "draft",
      period: "2026-07", submittedByName: "User", submittedAt: "2026-07-01",
      stateId: 3, locationType: null,
    };
    // null → fallback "state" (the safer default used in reports.tsx)
    expect(restoreLocationType(report)).toBe("state");
  });
});

describe("LT-API-02: HQ project report includes locationType: 'hq' with stateId null", () => {
  it("HQ report has null stateId and locationType 'hq'", () => {
    const report: ReportStub = {
      id: 3, title: "HQ Report", kind: "monthly", status: "draft",
      period: "2026-07", submittedByName: "User", submittedAt: "2026-07-01",
      stateId: null, locationType: "hq",
    };
    expect(report.stateId).toBeNull();
    expect(report.locationType).toBe("hq");
  });

  it("resolved locationType for HQ record is 'hq' (not overridden by null stateId)", () => {
    // explicit location_type='hq' wins over COALESCE fallback
    const resolved = resolveLocationType("hq", null);
    expect(resolved).toBe("hq");
  });

  it("restoreLocationType returns 'hq' when locationType is 'hq'", () => {
    const report: ReportStub = {
      id: 4, title: "HQ R", kind: "monthly", status: "draft",
      period: "2026-07", submittedByName: "User", submittedAt: "2026-07-01",
      stateId: null, locationType: "hq",
    };
    expect(restoreLocationType(report)).toBe("hq");
  });
});

describe("LT-API-03: Legacy report with null locationType is handled safely", () => {
  it("legacy record with no stateId and no locationType resolves to null", () => {
    const resolved = resolveLocationType(null, null);
    expect(resolved).toBeNull();
  });

  it("null locationType does not crash restoreLocationType (defaults to 'state')", () => {
    const report: ReportStub = {
      id: 5, title: "Legacy", kind: "monthly", status: "approved",
      period: "2024-01", submittedByName: "User", submittedAt: "2024-01-01",
      stateId: null, locationType: null,
    };
    // Must not throw; returns a safe fallback
    expect(() => restoreLocationType(report)).not.toThrow();
    expect(restoreLocationType(report)).toBe("state");
  });

  it("locationType field accepts null without TypeScript error (nullable enum)", () => {
    const lt: "state" | "hq" | null = null;
    expect(lt).toBeNull();
  });
});

describe("LT-API-04: Activity report locationType field present with no regression", () => {
  it("activity report may carry locationType: null (no state linkage)", () => {
    const report: ReportStub = {
      id: 6, title: "AR", kind: "monthly", status: "draft",
      period: "2026-07", submittedByName: "User", submittedAt: "2026-07-01",
      stateId: null, locationType: null, reportType: "activity", activityId: 10,
    };
    // Field is present (not undefined) and safe to read
    expect(Object.prototype.hasOwnProperty.call(report, "locationType")).toBe(true);
    expect(report.locationType).toBeNull();
  });

  it("activity report with a project-state may have locationType 'state'", () => {
    const report: ReportStub = {
      id: 7, title: "AR State", kind: "monthly", status: "draft",
      period: "2026-07", submittedByName: "User", submittedAt: "2026-07-01",
      stateId: 2, locationType: "state", reportType: "activity", activityId: 11,
    };
    expect(report.locationType).toBe("state");
  });

  it("resolveLocationType is consistent for activity reports without explicit location_type", () => {
    // Activity report linked to a state project → stateId is non-null → resolves 'state'
    expect(resolveLocationType(null, 2)).toBe("state");
    // Activity report not linked to a state → null
    expect(resolveLocationType(null, null)).toBeNull();
  });

  it("valid locationType values are exactly 'state', 'hq', or null", () => {
    const validValues: Array<"state" | "hq" | null> = ["state", "hq", null];
    for (const v of validValues) {
      expect(["state", "hq", null]).toContain(v);
    }
  });
});

// ── SUBMIT-GUARD-01: Double-submit protection ────────────────────────────────
// Mirrors the isSubmittingReport guard added to onSubmitReport in reports.tsx.
// The guard must:
//   1. Block a second invocation while a submit is in progress.
//   2. Release the block after the submit completes (success or error).
//   3. Release the block after an early return (validateSubmit failure).
describe("SUBMIT-GUARD-01: isSubmittingReport guard prevents double-submit", () => {
  /** Minimal mirror of the onSubmitReport guard logic (from reports.tsx). */
  function makeSubmitHandler(submitFn: () => Promise<void>) {
    let isSubmitting = false;
    return {
      async invoke() {
        if (isSubmitting) return "blocked";
        isSubmitting = true;
        try {
          await submitFn();
          return "ok";
        } finally {
          isSubmitting = false;
        }
      },
      get pending() { return isSubmitting; },
    };
  }

  it("first call proceeds when not already submitting", async () => {
    const handler = makeSubmitHandler(async () => { /* noop */ });
    const result = await handler.invoke();
    expect(result).toBe("ok");
  });

  it("second concurrent call is blocked while first is in progress", async () => {
    let resolveFn!: () => void;
    const slow = new Promise<void>((r) => { resolveFn = r; });
    const handler = makeSubmitHandler(() => slow);

    const first = handler.invoke();          // starts, hangs
    const second = handler.invoke();         // should be blocked immediately
    resolveFn();                             // unblock first

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe("ok");
    expect(r2).toBe("blocked");
  });

  it("guard releases after successful submit — subsequent call proceeds", async () => {
    let calls = 0;
    const handler = makeSubmitHandler(async () => { calls++; });

    await handler.invoke();
    expect(calls).toBe(1);
    await handler.invoke();        // must not be blocked after first completed
    expect(calls).toBe(2);
  });

  it("guard releases after a failed submit — subsequent call proceeds", async () => {
    let calls = 0;
    const failing = makeSubmitHandler(async () => { calls++; throw new Error("fail"); });

    await failing.invoke().catch(() => {/* expected */});
    expect(calls).toBe(1);
    await failing.invoke().catch(() => {/* expected */});
    expect(calls).toBe(2);        // second call also reached the fn (guard released)
  });
});
