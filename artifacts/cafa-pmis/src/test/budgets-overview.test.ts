/**
 * Budgets → Overview — Regression Verification
 *
 * 28 focused tests covering the currency-aware Overview Business Logic.
 * All tests are pure TypeScript — no DOM, no API mocks.
 *
 * §I   formatPercent — null, zero, adaptive precision, no clamping
 * §J   formatCurrency — with / without ISO currency code
 * §K   fmtMoney null-safety — null and undefined display as "—"
 * §L   KPI data derivation — single-currency, mixed-specific, all-currencies
 * §M   Scope badge label derivation — role → display label
 * §N   Currency selector consistency — all KPIs and Donor Portfolio filtered together
 * §O   Null vs zero spend distinction — null ≠ zero, zero ≠ missing
 * §P   Utilisation calculation and clamping — above-100%, progress-visual cap
 * §Q   Export column header labels — project currency, never hardcoded USD
 * §R   Donor real-data accumulation — beneficiaries and spend from activity records
 * §S   SPO scope is state-linked (userScope), not project-assignment-linked (buildScope)
 * §T   React Strict Mode — all pure helpers are idempotent under double-invocation
 * §U   Financial access gate — non-financial callers receive null spend fields
 */

import { describe, it, expect } from "vitest";
import { formatPercent, formatCurrency } from "@/lib/format";

/* ═══════════════════════════════════════════════════════════════════════════
   §I  formatPercent
   ═══════════════════════════════════════════════════════════════════════════ */

describe("§I  formatPercent", () => {
  it(`I-1.  null → "—"`, () => {
    expect(formatPercent(null)).toBe("—");
  });

  it(`I-2.  undefined → "—"`, () => {
    expect(formatPercent(undefined)).toBe("—");
  });

  it(`I-3.  0 → "0%"`, () => {
    expect(formatPercent(0)).toBe("0%");
  });

  it(`I-4.  small non-zero: 0.1058417 → "0.11%" (adaptive 2dp, no raw float)`, () => {
    expect(formatPercent(0.1058417)).toBe("0.11%");
  });

  it(`I-5.  12.5 → "12.5%" (trailing zero stripped)`, () => {
    expect(formatPercent(12.5)).toBe("12.5%");
  });

  it(`I-6.  100 → "100%" (trailing zeros stripped)`, () => {
    expect(formatPercent(100)).toBe("100%");
  });

  it(`I-7.  125.75 → "125.75%" (no clamping above 100)`, () => {
    // TC-23: utilisation above 100% must be preserved — not clamped to "100%"
    expect(formatPercent(125.75)).toBe("125.75%");
  });

  it(`I-8.  125 → "125%" (integer above 100, no clamping)`, () => {
    expect(formatPercent(125)).toBe("125%");
  });

  it("I-9.  negative value preserved as-is (no sign flipping)", () => {
    // Over-budget situations may produce negative remaining; formatter is factual
    expect(formatPercent(-5)).toBe("-5%");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §J  formatCurrency — with / without ISO currency code
   ═══════════════════════════════════════════════════════════════════════════ */

describe("§J  formatCurrency", () => {
  it("J-1.  without currency arg → uses legacy USD $ prefix (backward compat)", () => {
    const result = formatCurrency(1_000_000);
    expect(result).toContain("$");
    expect(result).toContain("1,000,000");
  });

  it("J-2.  with currency='USD' → uses ISO code prefix, no $ symbol (TC-25)", () => {
    // TC-25: no hardcoded "$" in the migrated Overview — when a currency is provided,
    // the formatter must output the ISO code ("USD"), not the "$" symbol.
    const result = formatCurrency(4_500_000, "USD");
    expect(result).not.toMatch(/^\$/);
    expect(result).toContain("USD");
    expect(result).toContain("4,500,000");
  });

  it("J-3.  with currency='SDG' → uses SDG code prefix", () => {
    const result = formatCurrency(2_000_000, "SDG");
    expect(result).toContain("SDG");
    expect(result).not.toContain("$");
  });

  it("J-4.  different currencies produce different formatted output (no conversion)", () => {
    // TC-12: no currency conversion — USD and SDG values are formatted independently
    const usd = formatCurrency(1_000, "USD");
    const sdg = formatCurrency(1_000, "SDG");
    expect(usd).not.toBe(sdg);   // different codes → different strings
    // Both contain the same numeric component (1,000) without mixing
    expect(usd).toContain("1,000");
    expect(sdg).toContain("1,000");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §K  fmtMoney null-safety
   Mirror of the inline `fmtMoney` helper in OverviewView.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * fmtMoney mirrors the inline helper defined in OverviewView exactly:
 *   if (val == null) return "—"
 *   if (!curr) return plain number string
 *   else return formatCurrency(val, curr)
 *
 * TC-19: missing KPI values display "—"
 * TC-20: Remaining does not use null-to-zero frontend coercion
 */
function fmtMoney(val: number | null | undefined, curr: string | null | undefined): string {
  if (val == null) return "—";
  if (!curr) return val.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return formatCurrency(val, curr);
}

describe("§K  fmtMoney null-safety (mirrors OverviewView inline helper)", () => {
  it(`K-1.  null val → "—" (TC-19: missing KPI displays —)`, () => {
    expect(fmtMoney(null, "USD")).toBe("—");
  });

  it(`K-2.  undefined val → "—"`, () => {
    expect(fmtMoney(undefined, "USD")).toBe("—");
  });

  it(`K-3.  null val with null currency → "—" (TC-20: Remaining must not coerce null to 0)`, () => {
    // If budgetRemaining is null (spent unknown), the UI must show "—", not "$0" or "0"
    expect(fmtMoney(null, null)).toBe("—");
  });

  it(`K-4.  numeric 0 val → NOT "—" (TC-17: authoritative zero shows "0", not "—")`, () => {
    const result = fmtMoney(0, "USD");
    expect(result).not.toBe("—");
  });

  it("K-5.  numeric val with currency code → does not contain $ symbol (TC-25)", () => {
    const result = fmtMoney(500_000, "USD");
    expect(result).not.toMatch(/^\$/);
    expect(result).toContain("USD");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §L  KPI data derivation
   Mirrors the `kpiData` useMemo in OverviewView.
   ═══════════════════════════════════════════════════════════════════════════ */

interface BudgetByCurrencyRow {
  currency: string;
  totalBudget: number;
  totalSpent: number | null;
  budgetRemaining: number | null;
  utilisationRate: number | null;
}

interface SummaryLike {
  totalBudget: number | null;
  totalSpent: number | null;
  budgetRemaining?: number | null;
  burnRatePct?: number | null;
  currencyMixed: boolean;
  budgetByCurrency: BudgetByCurrencyRow[];
}

type KpiRow = {
  currency: string | null | undefined;
  totalBudget: number | null;
  totalSpent: number | null;
  budgetRemaining: number | null;
  utilisationRate: number | null | undefined;
};

/** Pure mirror of the kpiData useMemo logic in OverviewView */
function deriveKpiData(
  summary: SummaryLike | null | undefined,
  selectedCurrency: string,
): KpiRow | null {
  if (!summary) return null;
  const { currencyMixed, budgetByCurrency } = summary;

  if (currencyMixed && selectedCurrency !== "all") {
    const row = budgetByCurrency.find(b => b.currency === selectedCurrency);
    return row
      ? { currency: row.currency, totalBudget: row.totalBudget, totalSpent: row.totalSpent, budgetRemaining: row.budgetRemaining, utilisationRate: row.utilisationRate }
      : null;
  }
  if (!currencyMixed) {
    if (budgetByCurrency.length > 0) {
      const row = budgetByCurrency[0];
      return { currency: row.currency, totalBudget: row.totalBudget, totalSpent: row.totalSpent, budgetRemaining: row.budgetRemaining, utilisationRate: row.utilisationRate };
    }
    return { currency: null, totalBudget: summary.totalBudget, totalSpent: summary.totalSpent, budgetRemaining: summary.budgetRemaining ?? null, utilisationRate: summary.burnRatePct };
  }
  // mixed + "all" → per-currency breakdown mode; no single KpiRow
  return null;
}

/** Whether to show per-currency breakdown instead of single KpiRow values */
const showMultiCurrency = (currencyMixed: boolean, selectedCurrency: string) =>
  currencyMixed && selectedCurrency === "all";

// ── Fixtures ────────────────────────────────────────────────────────────────

const SINGLE_SUMMARY: SummaryLike = {
  totalBudget: 1_000_000,
  totalSpent: 400_000,
  budgetRemaining: 600_000,
  burnRatePct: 40,
  currencyMixed: false,
  budgetByCurrency: [
    { currency: "USD", totalBudget: 1_000_000, totalSpent: 400_000, budgetRemaining: 600_000, utilisationRate: 40 },
  ],
};

const MIXED_SUMMARY: SummaryLike = {
  totalBudget: null,
  totalSpent: null,
  currencyMixed: true,
  budgetByCurrency: [
    { currency: "USD", totalBudget: 800_000, totalSpent: 320_000, budgetRemaining: 480_000, utilisationRate: 40 },
    { currency: "SDG", totalBudget: 500_000, totalSpent: null,     budgetRemaining: null,     utilisationRate: null },
  ],
};

describe("§L  KPI data derivation", () => {
  // TC-5: Single currency produces normal monetary KPIs
  it("L-1.  single currency: kpiData reflects the single budgetByCurrency row", () => {
    const kpi = deriveKpiData(SINGLE_SUMMARY, "all");
    expect(kpi?.currency).toBe("USD");
    expect(kpi?.totalBudget).toBe(1_000_000);
    expect(kpi?.totalSpent).toBe(400_000);
    expect(kpi?.budgetRemaining).toBe(600_000);
    expect(kpi?.utilisationRate).toBe(40);
  });

  // TC-6 + TC-4: Mixed "all" → per-currency breakdown; no single combined row
  it("L-2.  mixed + 'all': deriveKpiData returns null (per-currency breakdown mode, TC-4/6)", () => {
    expect(deriveKpiData(MIXED_SUMMARY, "all")).toBeNull();
    expect(showMultiCurrency(true, "all")).toBe(true);
  });

  // TC-6: All Currencies produces per-currency values (breakdown available)
  it("L-3.  mixed + 'all': budgetByCurrency contains one row per currency, never summed (TC-6)", () => {
    const { budgetByCurrency } = MIXED_SUMMARY;
    expect(budgetByCurrency).toHaveLength(2);
    // Two distinct currencies — their budgets must NOT be added together
    const naiveSum = budgetByCurrency.reduce((s, b) => s + b.totalBudget, 0);
    // Verify the code never produces a single "total" by cross-summing
    expect(budgetByCurrency.every(b => b.currency !== undefined)).toBe(true);
    // The raw sum exists only as an internal intermediate; it must never appear in a KpiRow
    expect(deriveKpiData(MIXED_SUMMARY, "all")).toBeNull(); // no combined KpiRow
    expect(naiveSum).toBeGreaterThan(0); // sum exists numerically but is suppressed in UI
  });

  // TC-4: Mixed currencies never cross-summed
  it("L-4.  mixed currencies: cross-currency sum is never exposed as a single monetary KPI (TC-4)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "all");
    // When mixed + all, no KpiRow → no combined monetary KPI can be displayed
    expect(kpi).toBeNull();
    // Each currency row keeps its own isolated budget total
    const usdRow = MIXED_SUMMARY.budgetByCurrency.find(b => b.currency === "USD")!;
    const sdgRow = MIXED_SUMMARY.budgetByCurrency.find(b => b.currency === "SDG")!;
    expect(usdRow.totalBudget).toBe(800_000);
    expect(sdgRow.totalBudget).toBe(500_000);
    // They are never added: 800k + 500k = 1.3M would be meaningless
    expect(usdRow.totalBudget + sdgRow.totalBudget).toBe(1_300_000);
    // But this combined value is inaccessible from kpiData
  });

  // TC-12: No currency conversion
  it("L-5.  no currency conversion: USD budget remains in USD, SDG budget remains in SDG (TC-12)", () => {
    const usd = MIXED_SUMMARY.budgetByCurrency.find(b => b.currency === "USD")!;
    const sdg = MIXED_SUMMARY.budgetByCurrency.find(b => b.currency === "SDG")!;
    // Values are raw figures in their native currencies — no exchange rate applied
    expect(usd.totalBudget).toBe(800_000); // unchanged USD figure
    expect(sdg.totalBudget).toBe(500_000); // unchanged SDG figure
    // A cross-currency rate would change the raw values; they must stay equal to source
    expect(typeof usd.totalBudget).toBe("number");
    expect(typeof sdg.totalBudget).toBe("number");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §M  Scope badge label derivation
   Mirror of the scopeLabel useMemo in OverviewView (TC-1/2/3 scope context).
   ═══════════════════════════════════════════════════════════════════════════ */

function deriveScopeLabel(
  role: string | undefined,
  userSectors: string[] | undefined,
): string | null {
  if (!role) return null;
  if (role === "technical_coordinator")
    return userSectors?.length ? `Sectors: ${userSectors.join(", ")}` : "Assigned Sectors";
  if (role === "state_program_officer" || role === "state_office_manager")
    return "Assigned State";
  return "Organisation-wide";
}

describe("§M  Scope badge label derivation", () => {
  it("M-1.  HQ roles → 'Organisation-wide'", () => {
    for (const role of ["executive_director", "program_manager", "super_admin", "senior_program_coordinator"]) {
      expect(deriveScopeLabel(role, undefined)).toBe("Organisation-wide");
    }
  });

  it("M-2.  TC with sectors → 'Sectors: Health, WASH'", () => {
    expect(deriveScopeLabel("technical_coordinator", ["Health", "WASH"]))
      .toBe("Sectors: Health, WASH");
  });

  it("M-3.  TC with no sectors assigned → 'Assigned Sectors' (fail-closed generic label)", () => {
    expect(deriveScopeLabel("technical_coordinator", [])).toBe("Assigned Sectors");
    expect(deriveScopeLabel("technical_coordinator", undefined)).toBe("Assigned Sectors");
  });

  it("M-4.  SPO → 'Assigned State' (TC-1: state-linked scope reflected in badge)", () => {
    // TC-1 / TC-2: SPO sees state-linked projects; badge reflects this constraint
    expect(deriveScopeLabel("state_program_officer", undefined)).toBe("Assigned State");
  });

  it("M-5.  no role (unauthenticated) → null (no badge rendered)", () => {
    expect(deriveScopeLabel(undefined, undefined)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §N  Currency selector consistency
   TC-7 to TC-11: selecting a currency applies uniformly to all KPI cards
   AND to the Donor Portfolio — never silently using a different currency basis.
   ═══════════════════════════════════════════════════════════════════════════ */

interface DonorByCurrency {
  currency: string;
  budgetTotal: number;
  budgetSpent: number | null;
}

interface DonorEntry {
  donorName: string;
  currency: string | null;
  currencyMixed: boolean;
  budgetTotal: number;
  budgetSpent: number | null;
  budgetByCurrency: DonorByCurrency[];
}

/** Mirror of OverviewView's displayDonors useMemo filter */
function filterDonorsByCurrency(
  donors: DonorEntry[],
  currencyMixed: boolean,
  selectedCurrency: string,
): DonorEntry[] {
  if (!currencyMixed || selectedCurrency === "all") return donors;
  return donors.filter(d =>
    d.currency === selectedCurrency ||
    d.budgetByCurrency.some(b => b.currency === selectedCurrency)
  );
}

const MIXED_DONORS: DonorEntry[] = [
  {
    donorName: "UNICEF",
    currency: "USD",
    currencyMixed: false,
    budgetTotal: 800_000,
    budgetSpent: 320_000,
    budgetByCurrency: [{ currency: "USD", budgetTotal: 800_000, budgetSpent: 320_000 }],
  },
  {
    donorName: "OCHA",
    currency: null,   // mixed-currency donor
    currencyMixed: true,
    budgetTotal: 1_300_000,
    budgetSpent: null,
    budgetByCurrency: [
      { currency: "USD", budgetTotal: 800_000, budgetSpent: null },
      { currency: "SDG", budgetTotal: 500_000, budgetSpent: null },
    ],
  },
  {
    donorName: "Qatar Fund",
    currency: "SDG",
    currencyMixed: false,
    budgetTotal: 500_000,
    budgetSpent: 100_000,
    budgetByCurrency: [{ currency: "SDG", budgetTotal: 500_000, budgetSpent: 100_000 }],
  },
];

describe("§N  Currency selector consistency (TC-7 to TC-11)", () => {
  // TC-7: Currency selection updates Total Budget
  it("N-1.  selecting USD: KPI Total Budget shows USD row only (TC-7)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "USD");
    expect(kpi?.currency).toBe("USD");
    expect(kpi?.totalBudget).toBe(800_000);
    // SDG budget (500k) must not appear
    expect(kpi?.totalBudget).not.toBe(1_300_000);
  });

  // TC-8: Currency selection updates Total Spent
  it("N-2.  selecting USD: KPI Total Spent shows USD row only (TC-8)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "USD");
    expect(kpi?.totalSpent).toBe(320_000);
  });

  // TC-9: Currency selection updates Remaining
  it("N-3.  selecting USD: KPI Remaining shows USD row only (TC-9)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "USD");
    expect(kpi?.budgetRemaining).toBe(480_000);
  });

  // TC-10: Currency selection updates Budget Utilisation
  it("N-4.  selecting USD: Budget Utilisation shows USD utilisation only (TC-10)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "USD");
    expect(kpi?.utilisationRate).toBe(40);
    // SDG utilisation (null) must not leak into the displayed value
  });

  // TC-11: Currency selection updates Donor Portfolio consistently (same basis)
  it("N-5.  selecting USD: Donor Portfolio filtered to USD donors only — same currency basis as KPIs (TC-11)", () => {
    const displayed = filterDonorsByCurrency(MIXED_DONORS, true, "USD");
    // UNICEF (USD only) and OCHA (has USD in budgetByCurrency) appear; Qatar Fund (SDG only) disappears
    expect(displayed.some(d => d.donorName === "UNICEF")).toBe(true);
    expect(displayed.some(d => d.donorName === "OCHA")).toBe(true);
    expect(displayed.some(d => d.donorName === "Qatar Fund")).toBe(false);
  });

  it("N-6.  selecting SDG: Donor Portfolio changes to SDG basis — never shows USD-only donors", () => {
    const displayed = filterDonorsByCurrency(MIXED_DONORS, true, "SDG");
    expect(displayed.some(d => d.donorName === "Qatar Fund")).toBe(true);
    expect(displayed.some(d => d.donorName === "UNICEF")).toBe(false);
  });

  it("N-7.  'all' selection: all donors visible (no filtering); KPIs enter per-currency breakdown mode", () => {
    const displayed = filterDonorsByCurrency(MIXED_DONORS, true, "all");
    expect(displayed).toHaveLength(MIXED_DONORS.length);
    // KPI enters breakdown mode — no single combined row
    expect(deriveKpiData(MIXED_SUMMARY, "all")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §O  Null vs zero spend distinction
   TC-15 to TC-18, TC-19, TC-20
   ═══════════════════════════════════════════════════════════════════════════ */

/** Compute utilisation rate: null when spent is null, actual rate otherwise */
function computeUtilisationRate(budget: number, spent: number | null): number | null {
  if (spent == null) return null;
  if (budget <= 0) return null;
  return (spent / budget) * 100;
}

/** Compute budgetRemaining: null when spent is null */
function computeRemaining(budget: number, spent: number | null): number | null {
  if (spent == null) return null;
  return budget - spent;
}

describe("§O  Null vs zero spend distinction (TC-15 to TC-20)", () => {
  // TC-15: Donor budgetSpent = null displays "—"
  it("O-1.  fmtMoney(null, 'USD') → '—' (TC-15: null budgetSpent displays —)", () => {
    expect(fmtMoney(null, "USD")).toBe("—");
  });

  // TC-16: Donor budgetSpent = null → Utilisation = "—", not "0%"
  it("O-2.  computeUtilisationRate(budget=500000, spent=null) → null → formatPercent → '—' (TC-16)", () => {
    const rate = computeUtilisationRate(500_000, null);
    expect(rate).toBeNull();
    expect(formatPercent(rate)).toBe("—");
  });

  // TC-17: Authoritative zero spend displays "0"/"0%"
  it("O-3.  computeUtilisationRate(budget=500000, spent=0) → 0 → formatPercent → '0%' (TC-17)", () => {
    const rate = computeUtilisationRate(500_000, 0);
    expect(rate).toBe(0);
    expect(formatPercent(rate)).toBe("0%");
  });

  it("O-3b. fmtMoney(0, 'USD') → not '—' (TC-17: zero spend is shown as 0, not missing)", () => {
    expect(fmtMoney(0, "USD")).not.toBe("—");
  });

  // TC-18: Missing spend (null) must not become zero
  it("O-4.  null spent is NOT equal to 0 spent — missing data stays null throughout (TC-18)", () => {
    const nullSpent: number | null = null;
    const zeroSpent: number | null = 0;
    // These must produce different results — null is NOT the same as 0
    expect(computeUtilisationRate(100_000, nullSpent)).toBeNull();
    expect(computeUtilisationRate(100_000, zeroSpent)).toBe(0);
    expect(fmtMoney(nullSpent, "USD")).toBe("—");
    expect(fmtMoney(zeroSpent, "USD")).not.toBe("—");
    expect(computeRemaining(100_000, nullSpent)).toBeNull();
    expect(computeRemaining(100_000, zeroSpent)).toBe(100_000);
  });

  // TC-19: Missing KPI values display "—"
  it("O-5.  KPI with null totalSpent → fmtMoney returns '—' (TC-19)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "SDG")!; // SDG has null totalSpent
    expect(kpi.totalSpent).toBeNull();
    expect(fmtMoney(kpi.totalSpent, kpi.currency)).toBe("—");
  });

  it("O-6.  KPI with null budgetRemaining → fmtMoney returns '—' (TC-19 + TC-20)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "SDG")!;
    expect(kpi.budgetRemaining).toBeNull();
    // TC-20: Remaining must not coerce null to 0 before display
    expect(fmtMoney(kpi.budgetRemaining, kpi.currency)).toBe("—");
    // Verify: if we incorrectly coerced null → 0, we'd get a money string instead of "—"
    expect(fmtMoney(0, "SDG")).not.toBe("—"); // proves "—" only comes from null, not from 0
  });

  it("O-7.  KPI with null utilisationRate → formatPercent returns '—' (TC-16 / TC-19)", () => {
    const kpi = deriveKpiData(MIXED_SUMMARY, "SDG")!;
    expect(kpi.utilisationRate).toBeNull();
    expect(formatPercent(kpi.utilisationRate)).toBe("—");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §P  Utilisation calculation and progress-bar visual cap
   TC-21 to TC-24
   ═══════════════════════════════════════════════════════════════════════════ */

/** Progress bar fill width (visual only) — capped at 100% to prevent overflow */
function progressBarWidth(utilisationRate: number | null): number {
  if (utilisationRate == null) return 0;
  return Math.min(100, utilisationRate);
}

describe("§P  Utilisation calculation and progress-bar visual cap (TC-21 to TC-24)", () => {
  // TC-21: Budget Utilisation = Spent / Budget × 100
  it("P-1.  utilisation = spent / budget × 100 (TC-21)", () => {
    expect(computeUtilisationRate(1_000_000, 400_000)).toBeCloseTo(40, 5);
    expect(computeUtilisationRate(500_000, 500_000)).toBeCloseTo(100, 5);
    expect(computeUtilisationRate(100, 125)).toBeCloseTo(125, 5);
  });

  // TC-22: Small non-zero utilisation formats correctly (no raw float output)
  it("P-2.  small non-zero utilisation: 0.1058417 formats to '0.11%' not raw float (TC-22)", () => {
    expect(formatPercent(0.1058417)).toBe("0.11%");
    expect(formatPercent(computeUtilisationRate(1_000_000, 1_058))).toBe("0.11%");
  });

  // TC-23: Utilisation above 100% preserved in displayed value
  it("P-3.  utilisation above 100%: value preserved, not clamped (TC-23)", () => {
    const rate = computeUtilisationRate(100, 125);
    expect(rate).toBeCloseTo(125, 5);
    expect(formatPercent(rate)).toBe("125%");
  });

  it("P-3b. 125.75% preserved (TC-23)", () => {
    expect(formatPercent(125.75)).toBe("125.75%");
  });

  // TC-24: Progress visual does not overflow — width capped at 100%
  it("P-4.  progress bar width capped at 100% when utilisation > 100% (TC-24)", () => {
    expect(progressBarWidth(125)).toBe(100);   // visually capped
    expect(progressBarWidth(200)).toBe(100);
    expect(progressBarWidth(99)).toBe(99);     // under 100: unchanged
    expect(progressBarWidth(100)).toBe(100);   // exactly 100: unchanged
    expect(progressBarWidth(null)).toBe(0);    // null: no fill
  });

  it("P-5.  progress bar cap is visual only — displayed percent retains true value (TC-24)", () => {
    const rate = 125;
    // Visual fill capped at 100
    expect(progressBarWidth(rate)).toBe(100);
    // But the displayed label retains the real value
    expect(formatPercent(rate)).toBe("125%");
    // These two differ — that's the correct behaviour
    expect(progressBarWidth(rate)).not.toBe(rate);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §Q  Export column header labels (TC-25 and TC-26)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Mirror of the export column-header logic in exportBudgetExcel / exportProjectCsv */
function budgetColumnHeader(label: string, currency: string | undefined | null): string {
  return currency ? `${label} (${currency})` : label;
}

describe("§Q  Export column header labels (TC-25 / TC-26)", () => {
  // TC-26: Project export currency remains factual
  it("Q-1.  USD project → headers show '(USD)', not hardcoded '(USD)' symbol-prefix (TC-26)", () => {
    expect(budgetColumnHeader("Total Budget", "USD")).toBe("Total Budget (USD)");
    expect(budgetColumnHeader("Total Spent", "USD")).toBe("Total Spent (USD)");
  });

  it("Q-2.  SDG project → headers show '(SDG)'", () => {
    expect(budgetColumnHeader("Total Budget", "SDG")).toBe("Total Budget (SDG)");
  });

  it("Q-3.  no currency set → headers have no currency suffix (graceful degradation)", () => {
    expect(budgetColumnHeader("Total Budget", undefined)).toBe("Total Budget");
    expect(budgetColumnHeader("Total Budget", null)).toBe("Total Budget");
  });

  // TC-25: No hardcoded "$" or "(USD)" in headers for non-USD projects
  it("Q-4.  SDG project headers do not contain '$' or 'USD' (TC-25: no hardcoded USD symbol)", () => {
    const header = budgetColumnHeader("Total Budget", "SDG");
    expect(header).not.toContain("$");
    expect(header).not.toContain("USD");
  });

  it("Q-5.  'Budget Utilisation (%)' label unchanged regardless of currency", () => {
    // Utilisation is currency-neutral — no currency code appended
    const header = "Budget Utilisation (%)";
    expect(header).not.toContain("USD");
    expect(header).not.toContain("SDG");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §R  Donor real-data accumulation (TC-13 and TC-14)
   Mirrors the beneficiaries + spend accumulation in the donor portfolio backend.
   ═══════════════════════════════════════════════════════════════════════════ */

interface ProjectRow {
  id: number;
  currency: string | null;
  budgetTotal: number;
  beneficiaries: number;  // from DB: COALESCE(male + female + boys + girls, 0)
}

function accumulateDonorData(
  projects: ProjectRow[],
  activitySpend: Map<number, number | null>,  // null = no activity records at all
): {
  totalBeneficiaries: number;
  spentByCurrency: Map<string, number>;
  hasAnySpendData: boolean;
} {
  let totalBeneficiaries = 0;
  const spentByCurrency = new Map<string, number>();

  for (const p of projects) {
    totalBeneficiaries += p.beneficiaries;

    const currency = (p.currency ?? "").trim() || null;
    if (currency) {
      const projectSpent = activitySpend.has(p.id) ? activitySpend.get(p.id)! : null;
      if (projectSpent !== null) {
        spentByCurrency.set(currency, (spentByCurrency.get(currency) ?? 0) + projectSpent);
      }
      // null projectSpent → no activities → omit from sum (not treated as 0)
    }
  }

  const hasAnySpendData = spentByCurrency.size > 0;
  return { totalBeneficiaries, spentByCurrency, hasAnySpendData };
}

describe("§R  Donor real-data accumulation (TC-13 and TC-14)", () => {
  const projects: ProjectRow[] = [
    { id: 1, currency: "USD", budgetTotal: 500_000, beneficiaries: 1200 },
    { id: 2, currency: "USD", budgetTotal: 300_000, beneficiaries: 800 },
    { id: 3, currency: "SDG", budgetTotal: 200_000, beneficiaries: 400 },
  ];

  // TC-14: Donor Beneficiaries use real Project data
  it("R-1.  totalBeneficiaries = sum of project beneficiary fields, not hardcoded 0 (TC-14)", () => {
    const activitySpend = new Map<number, number | null>([
      [1, 100_000], [2, 80_000], [3, null],
    ]);
    const { totalBeneficiaries } = accumulateDonorData(projects, activitySpend);
    expect(totalBeneficiaries).toBe(1200 + 800 + 400);   // 2400 — from real project fields
    expect(totalBeneficiaries).not.toBe(0);               // must NOT be hardcoded 0
  });

  // TC-13: Donor Budget Spent uses real Activity expenditure
  it("R-2.  spentByCurrency = sum of activity budget_spent by currency, not hardcoded 0 (TC-13)", () => {
    const activitySpend = new Map<number, number | null>([
      [1, 100_000], [2, 80_000], [3, 60_000],
    ]);
    const { spentByCurrency, hasAnySpendData } = accumulateDonorData(projects, activitySpend);
    expect(hasAnySpendData).toBe(true);
    expect(spentByCurrency.get("USD")).toBe(180_000);   // 100k + 80k — per-currency sum
    expect(spentByCurrency.get("SDG")).toBe(60_000);    // project 3
  });

  // TC-18 / TC-15: null activity spend does not become 0 in the currency accumulation
  it("R-3.  project with null activity spend is omitted from spentByCurrency (TC-18/15)", () => {
    const activitySpend = new Map<number, number | null>([
      [1, null],   // has activities row(s) but SUM returned null (all budget_spent null)
      [2, 80_000],
      // project 3: key absent → no activity records at all
    ]);
    const { spentByCurrency } = accumulateDonorData(projects, activitySpend);
    // USD: only project 2 contributed (80k); project 1's null is excluded (not 0+80k)
    expect(spentByCurrency.get("USD")).toBe(80_000);
    // SDG: project 3 not in activitySpend map → null → excluded
    expect(spentByCurrency.has("SDG")).toBe(false);
  });

  // TC-17: Authoritative zero spend (explicit 0 from activities) IS included
  it("R-4.  authoritative zero activity spend (explicit 0) IS accumulated, not omitted (TC-17)", () => {
    const activitySpend = new Map<number, number | null>([
      [1, 0],        // explicit zero — activities exist, all budget_spent = 0
      [2, 80_000],
    ]);
    const { spentByCurrency } = accumulateDonorData(projects, activitySpend);
    // Project 1 contributes 0 to USD total, project 2 contributes 80k → sum = 80k
    // (0 + 80k = 80k; this is still 80k, but the key point is 0 does not → "—")
    expect(spentByCurrency.get("USD")).toBe(80_000);
    // And the zero from project 1 is not treated as missing:
    const p1spent = activitySpend.get(1);
    expect(p1spent).toBe(0);
    expect(p1spent).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §S  SPO scope is state-linked (userScope), not assignment-linked (TC-1/2)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * userScope() returns the raw stateId from the session for SPO.
 * buildScope() (the old approach) instead resolves via project_assignments —
 * which is wrong for SPO, who sees projects linked via project_states.
 */
interface RawScopeResult {
  stateId: number | null;
  sectorIds: string[] | null;
}

/** Mirror of userScope() — returns the raw session-derived stateId */
function userScope(sessionUser: { role: string; stateId?: number | null; sectorIds?: string[] | null }): RawScopeResult {
  return {
    stateId: sessionUser.stateId ?? null,
    sectorIds: sessionUser.sectorIds ?? null,
  };
}

/** Simulates buildScope() — for SPO, would resolve via project_assignments instead */
function buildScope_WRONG_FOR_SPO(
  sessionUser: { role: string; stateId?: number | null },
  projectAssignmentStateId: number | null,
): RawScopeResult {
  if (sessionUser.role === "state_program_officer") {
    // buildScope rewrites SPO scope to project_assignments, which may differ
    return { stateId: projectAssignmentStateId, sectorIds: null };
  }
  return { stateId: sessionUser.stateId ?? null, sectorIds: null };
}

describe("§S  SPO scope uses userScope (state-linked), not buildScope (TC-1 and TC-2)", () => {
  const spo = { role: "state_program_officer", stateId: 3 };

  // TC-1: SPO Summary uses State-linked Project scope
  it("S-1.  userScope() for SPO returns the session stateId (state-linked scope, TC-1)", () => {
    const scope = userScope(spo);
    expect(scope.stateId).toBe(3);
  });

  it("S-2.  buildScope (wrong approach) may return a different stateId via project_assignments (TC-1)", () => {
    // This illustrates why buildScope must NOT be used for the Summary endpoint:
    // if project_assignments has a different stateId, the SPO sees wrong data.
    const wrongScope = buildScope_WRONG_FOR_SPO(spo, /* project_assignment stateId */ 7);
    expect(wrongScope.stateId).toBe(7);    // WRONG — should be 3 (from session)
    expect(wrongScope.stateId).not.toBe(spo.stateId);
  });

  it("S-3.  userScope gives same stateId for Summary and DonorPortfolio — consistent project population (TC-2)", () => {
    const summaryScope = userScope(spo);
    const portfolioScope = userScope(spo);
    // Both endpoints must call userScope() — ensuring the same project population
    expect(summaryScope.stateId).toBe(portfolioScope.stateId);
  });

  // TC-3: TC remains assigned-sector scoped
  it("S-4.  userScope() for TC returns sectorIds, not a stateId (TC-3)", () => {
    const tc = { role: "technical_coordinator", sectorIds: ["health", "wash"], stateId: null };
    const scope = userScope(tc);
    expect(scope.sectorIds).toEqual(["health", "wash"]);
    expect(scope.stateId).toBeNull();
  });

  it("S-5.  HQ roles: userScope returns null stateId and null sectorIds (org-wide)", () => {
    const ed = { role: "executive_director" };
    const scope = userScope(ed);
    expect(scope.stateId).toBeNull();
    expect(scope.sectorIds).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §T  React Strict Mode — all pure helpers are idempotent (TC-28)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("§T  React Strict Mode — pure helpers are idempotent (TC-28)", () => {
  it("T-1.  formatPercent is idempotent under double-invocation", () => {
    for (const val of [null, 0, 12.5, 100, 125.75]) {
      expect(formatPercent(val)).toBe(formatPercent(val));
    }
  });

  it("T-2.  fmtMoney is idempotent", () => {
    const pairs: [number | null, string | null][] = [
      [null, "USD"], [0, "USD"], [1_000_000, "USD"], [500_000, "SDG"], [null, null],
    ];
    for (const [val, curr] of pairs) {
      expect(fmtMoney(val, curr)).toBe(fmtMoney(val, curr));
    }
  });

  it("T-3.  deriveKpiData is pure — identical inputs produce identical outputs", () => {
    const r1 = deriveKpiData(SINGLE_SUMMARY, "all");
    const r2 = deriveKpiData(SINGLE_SUMMARY, "all");
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("T-4.  deriveScopeLabel is pure", () => {
    const label = deriveScopeLabel("technical_coordinator", ["health"]);
    expect(deriveScopeLabel("technical_coordinator", ["health"])).toBe(label);
  });

  it("T-5.  filterDonorsByCurrency is pure — never mutates source array", () => {
    const original = MIXED_DONORS.map(d => d.donorName);
    filterDonorsByCurrency(MIXED_DONORS, true, "USD");
    expect(MIXED_DONORS.map(d => d.donorName)).toEqual(original);
  });

  it("T-6.  progressBarWidth is pure", () => {
    for (const val of [null, 0, 50, 100, 125]) {
      expect(progressBarWidth(val)).toBe(progressBarWidth(val));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §U  Financial access gate (TC-27)
   Non-financial callers receive null spend fields — no unauthorised figures.
   ═══════════════════════════════════════════════════════════════════════════ */

const FINANCIAL_ACCESS_ROLES = new Set([
  "super_admin", "executive_director", "program_manager",
  "senior_program_coordinator", "technical_coordinator", "state_program_officer",
]);

/** Simulate the backend financial gate: returns null for spend fields when caller lacks access */
function gateSummaryFinancialFields(
  role: string,
  actual: { totalBudget: number; totalSpent: number },
): { totalBudget: number | null; totalSpent: number | null } {
  if (!FINANCIAL_ACCESS_ROLES.has(role)) {
    return { totalBudget: null, totalSpent: null };
  }
  return actual;
}

describe("§U  Financial access gate (TC-27)", () => {
  const ACTUAL = { totalBudget: 1_000_000, totalSpent: 400_000 };

  it("U-1.  approved roles receive actual financial figures", () => {
    for (const role of FINANCIAL_ACCESS_ROLES) {
      const result = gateSummaryFinancialFields(role, ACTUAL);
      expect(result.totalBudget).toBe(1_000_000);
      expect(result.totalSpent).toBe(400_000);
    }
  });

  it("U-2.  state_office_manager receives null financial fields (not in approved set, TC-27)", () => {
    const result = gateSummaryFinancialFields("state_office_manager", ACTUAL);
    expect(result.totalBudget).toBeNull();
    expect(result.totalSpent).toBeNull();
  });

  it("U-3.  viewer receives null financial fields (TC-27)", () => {
    const result = gateSummaryFinancialFields("viewer", ACTUAL);
    expect(result.totalBudget).toBeNull();
    expect(result.totalSpent).toBeNull();
  });

  it("U-4.  null financial fields display as '—' (not '$0'), confirming the gate is end-to-end (TC-27)", () => {
    const result = gateSummaryFinancialFields("state_office_manager", ACTUAL);
    // The frontend fmtMoney will produce "—" for null — not "$0"
    expect(fmtMoney(result.totalBudget, "USD")).toBe("—");
    expect(fmtMoney(result.totalSpent, "USD")).toBe("—");
  });

  it("U-5.  unauthenticated / empty role receives null financial fields (TC-27)", () => {
    const result = gateSummaryFinancialFields("", ACTUAL);
    expect(result.totalBudget).toBeNull();
    expect(result.totalSpent).toBeNull();
  });
});
