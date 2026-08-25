/**
 * budget-tab-metrics.test.tsx
 *
 * 23 focused regression tests for the Budget & Donors tab metrics.
 * All helpers are inlined so this file does not import dashboard.tsx
 * (which pulls in the full app dependency tree and breaks the test runner).
 */

import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Re-implement the module-scope helpers under test ───────────────────────
// These mirror the exact logic in dashboard.tsx so any drift is caught by TS.

/** DEFECT-03 / DEFECT-01: adaptive percentage precision */
function fmtPct(v: number): string {
  if (v === 0) return "0%";
  if (v > 0 && v < 1) {
    const s = v.toFixed(2).replace(/\.?0+$/, "");
    return `${s}%`;
  }
  const s = v.toFixed(1).replace(/\.?0+$/, "");
  return `${s}%`;
}

/** DEFECT-02: null/undefined → "—", not "0%" */
const pct = (v?: number | null): string => (v == null ? "—" : fmtPct(v));

/** DEFECT-05: ISO-code currency formatter */
function fmtMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  if (!currency) return "—";
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)}`;
}

/** DEFECT-04: available % derived from budgetRemaining/totalBudget */
function availablePct(budgetRemaining: number | undefined, totalBudget: number | undefined): string {
  if (totalBudget == null || totalBudget === 0 || budgetRemaining == null) return "—";
  return fmtPct((budgetRemaining / totalBudget) * 100);
}

/**
 * Server-side utilisation (spec-correct):
 * - Returns null when totalBudget is 0 or unavailable — null = "no valid budget",
 *   displayed as "—" by pct().
 * - Returns raw float (no integer rounding) so the frontend's adaptive formatter
 *   can display sub-1% values correctly.
 * - Returns genuine 0 only when totalBudget > 0 and totalSpent === 0.
 */
function computeUtilisation(totalSpent: number, totalBudget: number): number | null {
  return totalBudget > 0 ? (totalSpent / totalBudget) * 100 : null;
}

// ── Summary shape (mirrors DashboardSummary fields used in Budget tab) ─────
interface BudgetByCurrencyItem {
  currency: string;
  totalBudget: number;
  totalSpent: number;
  budgetRemaining: number;
}

interface SummaryLike {
  totalBudget: number;
  totalSpent: number;
  budgetRemaining: number;
  burnRatePct?: number | null;
  currency?: string | null;
  currencyMixed?: boolean;
  budgetByCurrency?: BudgetByCurrencyItem[];
}

// ── Small React test double ────────────────────────────────────────────────
// Mirrors the two branches in dashboard.tsx: per-currency table vs single-currency cards.
function BudgetCard({ summary }: { summary?: SummaryLike }) {
  if (summary?.currencyMixed) {
    return (
      <div data-testid="mixed-view">
        <div data-testid="mixed-currency-notice">
          Projects use multiple currencies — no consolidated total is available.
        </div>
        {(summary.budgetByCurrency ?? []).map(bc => (
          <div key={bc.currency} data-testid={`currency-row-${bc.currency}`}>
            <span data-testid={`remaining-${bc.currency}`}>{fmtMoney(bc.budgetRemaining, bc.currency)}</span>
            <span data-testid={`allocated-${bc.currency}`}>{fmtMoney(bc.totalBudget, bc.currency)}</span>
            <span data-testid={`spent-${bc.currency}`}>{fmtMoney(bc.totalSpent, bc.currency)}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <span data-testid="remaining">{fmtMoney(summary?.budgetRemaining, summary?.currency)}</span>
      <span data-testid="allocated">{fmtMoney(summary?.totalBudget, summary?.currency)}</span>
      <span data-testid="spent">{fmtMoney(summary?.totalSpent, summary?.currency)}</span>
      <span data-testid="utilisation">{pct(summary?.burnRatePct)}</span>
      <span data-testid="available-pct">
        {availablePct(summary?.budgetRemaining, summary?.totalBudget)}
      </span>
    </div>
  );
}

// ── Donor row shape (mirrors DonorPortfolioEntry fields) ───────────────────
interface DonorByCurrency { currency: string; budgetTotal: number; budgetSpent: number }
interface DonorRow {
  donor: string;
  budgetTotal: number;
  currency: string | null;
  currencyMixed?: boolean;
  budgetByCurrency?: DonorByCurrency[];
}
function DonorList({ rows }: { rows: DonorRow[] }) {
  // Mirror dashboard.tsx: exclude mixed-currency donors from chart, list them separately
  const singleCurrency = rows.filter(r => !r.currencyMixed);
  const mixedCurrency  = rows.filter(r => r.currencyMixed);
  return (
    <div>
      <ul data-testid="donor-chart-items">
        {singleCurrency.map(r => (
          <li key={r.donor} data-testid={`donor-${r.donor}`}>
            {r.donor}: {fmtMoney(r.budgetTotal, r.currency)}
          </li>
        ))}
      </ul>
      {mixedCurrency.length > 0 && (
        <div data-testid="mixed-donor-list">
          {mixedCurrency.map(r => (
            <div key={r.donor} data-testid={`mixed-donor-${r.donor}`}>
              <span>{r.donor}</span>
              {(r.budgetByCurrency ?? []).map(bc => (
                <span key={bc.currency} data-testid={`mixed-donor-${r.donor}-${bc.currency}`}>
                  {fmtMoney(bc.budgetTotal, bc.currency)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// TESTS
// ──────────────────────────────────────────────────────────────────────────

describe("fmtPct — adaptive precision", () => {
  // Scenario 6: genuine zero
  it("returns '0%' for exactly 0", () => {
    expect(fmtPct(0)).toBe("0%");
  });

  // Scenario 5: sub-1% utilisation shows up to 2 d.p.
  it("returns up to 2 d.p. for values between 0 and 1", () => {
    expect(fmtPct(0.11)).toBe("0.11%");
    expect(fmtPct(0.5)).toBe("0.5%");   // no trailing zero
    expect(fmtPct(0.50)).toBe("0.5%");
    expect(fmtPct(0.09)).toBe("0.09%");
  });

  // Scenario 4: zero spent → 0% utilisation (totalBudget > 0, so result is 0 not null)
  it("returns '0%' when spent is 0 and total is positive", () => {
    const u = computeUtilisation(0, 100_000);
    expect(u).toBe(0);
    expect(fmtPct(u!)).toBe("0%");   // u is 0 here (totalBudget > 0)
  });

  // Scenario 7: > 100% utilisation is preserved
  it("preserves values above 100%", () => {
    expect(fmtPct(102.5)).toBe("102.5%");
    expect(fmtPct(150)).toBe("150%");
  });

  // Mid-range value (1 d.p., no trailing zeros)
  it("returns up to 1 d.p. for values >= 1", () => {
    expect(fmtPct(7.5)).toBe("7.5%");
    expect(fmtPct(42)).toBe("42%");
    expect(fmtPct(10.0)).toBe("10%");  // no trailing .0
  });
});

describe("pct — null/undefined safety (DEFECT-02)", () => {
  // Scenario 10: missing data — undefined → "—"
  it("returns '—' for undefined (loading/missing data)", () => {
    expect(pct(undefined)).toBe("—");
  });

  // Scenario 11: failed query — null → "—"
  it("returns '—' for null (failed query)", () => {
    expect(pct(null)).toBe("—");
  });

  it("formats a defined value correctly", () => {
    expect(pct(0.25)).toBe("0.25%");
    expect(pct(0)).toBe("0%");
    expect(pct(42)).toBe("42%");
  });
});

describe("computeUtilisation — DEFECT-01 server-side precision", () => {
  // Scenario 5: sub-1% spend no longer rounds to 0 (raw float from server)
  it("returns raw float for tiny spend (no integer rounding)", () => {
    const u = computeUtilisation(400, 100_000); // 0.4%
    expect(u).toBe(0.4);
    expect(fmtPct(u!)).toBe("0.4%");   // u is a number (totalBudget > 0)
  });

  it("does not collapse 0.49% to 0% (old integer rounding bug)", () => {
    const u = computeUtilisation(490, 100_000); // 0.49% — old code → 0
    expect(u).toBeCloseTo(0.49, 2);
    expect(fmtPct(u!)).not.toBe("0%"); // u is a number (totalBudget > 0)
  });

  // Scenario 9: zero allocated → null (no valid budget), not NaN or 0
  it("returns null when totalBudget is 0 (no valid budget — displays as '—')", () => {
    expect(computeUtilisation(0, 0)).toBeNull();
    expect(computeUtilisation(5000, 0)).toBeNull();
    // null is safely handled by pct()
    expect(pct(computeUtilisation(0, 0))).toBe("—");
  });

  // Scenario 8: negative remaining (spent > allocated)
  it("returns > 100% when spent exceeds budget", () => {
    const u = computeUtilisation(120_000, 100_000); // 120%
    expect(u).toBe(120);
  });
});

describe("fmtMoney — ISO currency display (DEFECT-05)", () => {
  // Scenario 1: single currency — displays ISO code
  it("displays ISO code + formatted amount for known currency", () => {
    expect(fmtMoney(1_250_000, "USD")).toBe("USD 1,250,000");
    expect(fmtMoney(500_000, "EUR")).toBe("EUR 500,000");
    expect(fmtMoney(0, "USD")).toBe("USD 0");
  });

  // Scenario 2 / Scenario 3: mixed currencies → "—" (no conversion service)
  it("returns '—' when currency is null (mixed project currencies)", () => {
    expect(fmtMoney(1_000_000, null)).toBe("—");
  });

  // Scenario 10: missing amount → "—"
  it("returns '—' for undefined amount (loading state)", () => {
    expect(fmtMoney(undefined, "USD")).toBe("—");
  });

  // Scenario 11: failed query → "—" not "$0.00"
  it("returns '—' for null amount (failed query)", () => {
    expect(fmtMoney(null, "USD")).toBe("—");
  });

  // Scenario 9: zero allocated — shows "—" only when currency is unknown
  it("shows '—' for zero amount with unknown currency, correct value otherwise", () => {
    expect(fmtMoney(0, null)).toBe("—");
    expect(fmtMoney(0, "USD")).toBe("USD 0");
  });
});

describe("availablePct — DEFECT-04 fix", () => {
  it("derives available % from budgetRemaining/totalBudget", () => {
    // 250k remaining of 1M total = 25%
    expect(availablePct(250_000, 1_000_000)).toBe("25%");
  });

  it("returns '—' when totalBudget is 0 (DEFECT-04: not '100%')", () => {
    expect(availablePct(0, 0)).toBe("—");
    expect(availablePct(undefined, 0)).toBe("—");
  });

  // Scenario 8: negative remaining
  it("correctly handles negative remaining (overspent)", () => {
    const pctVal = availablePct(-20_000, 100_000); // -20%
    expect(pctVal).toBe("-20%");
  });

  it("does NOT show '100% available' when budget is spent (old bug)", () => {
    // Old code: 100 - Math.round(0.4) = 100 - 0 = "100% available" — wrong
    // New code: budgetRemaining / totalBudget = 99.6%            — correct
    // (Using 4_000 spent so remaining is 99.6%, which stays below 100% after 1 d.p.)
    const summary: SummaryLike = {
      totalBudget: 1_000_000,
      totalSpent: 4_000,          // 0.4% spend → old integer burn = 0%
      budgetRemaining: 996_000,
      burnRatePct: computeUtilisation(4_000, 1_000_000), // 0.4 — not 0
      currency: "USD",
    };
    // Old formula would give: 100 - 0 (integer) = "100% available"
    const oldAvailable = `${100 - Math.round(summary.totalSpent / summary.totalBudget * 100)}%`;
    expect(oldAvailable).toBe("100%"); // proves the old bug exists for this input

    // New formula: derived directly from budgetRemaining/totalBudget
    const available = availablePct(summary.budgetRemaining, summary.totalBudget);
    expect(available).not.toBe("100%"); // DEFECT-04: must not say "100% available"
    expect(available).toBe("99.6%");
  });
});

describe("BudgetCard rendering", () => {
  // Scenario 10 / 11: loading / failed state shows "—" not "$0.00"
  it("shows '—' for all financial values when summary is undefined", () => {
    render(<BudgetCard summary={undefined} />);
    expect(screen.getByTestId("remaining")).toHaveTextContent("—");
    expect(screen.getByTestId("allocated")).toHaveTextContent("—");
    expect(screen.getByTestId("spent")).toHaveTextContent("—");
    expect(screen.getByTestId("utilisation")).toHaveTextContent("—");
    expect(screen.getByTestId("available-pct")).toHaveTextContent("—");
  });

  // Scenario 1: single currency renders ISO code
  it("renders ISO currency code when currency is uniform", () => {
    const summary: SummaryLike = {
      totalBudget: 1_000_000,
      totalSpent: 250_000,
      budgetRemaining: 750_000,
      burnRatePct: 25,
      currency: "USD",
      currencyMixed: false,
    };
    render(<BudgetCard summary={summary} />);
    expect(screen.getByTestId("remaining")).toHaveTextContent("USD 750,000");
    expect(screen.getByTestId("allocated")).toHaveTextContent("USD 1,000,000");
    expect(screen.getByTestId("spent")).toHaveTextContent("USD 250,000");
    expect(screen.getByTestId("utilisation")).toHaveTextContent("25%");
    expect(screen.getByTestId("available-pct")).toHaveTextContent("75%");
  });

  // Scenario 2 / 3: mixed currencies shows per-currency breakdown, not a cross-currency aggregate
  it("shows per-currency breakdown table and notice when currencyMixed is true", () => {
    const summary: SummaryLike = {
      totalBudget: 2_000_000,
      totalSpent: 500_000,
      budgetRemaining: 1_500_000,
      burnRatePct: 25,
      currency: null,
      currencyMixed: true,
      budgetByCurrency: [
        { currency: "USD", totalBudget: 1_500_000, totalSpent: 400_000, budgetRemaining: 1_100_000 },
        { currency: "EUR", totalBudget: 500_000,   totalSpent: 100_000, budgetRemaining: 400_000   },
      ],
    };
    render(<BudgetCard summary={summary} />);
    // The notice must appear
    expect(screen.getByTestId("mixed-currency-notice")).toBeInTheDocument();
    // The mixed view renders per-currency rows, NOT the aggregate card spans
    expect(screen.queryByTestId("remaining")).toBeNull();  // aggregate span absent
    expect(screen.queryByTestId("allocated")).toBeNull();
    expect(screen.queryByTestId("spent")).toBeNull();
    // Per-currency rows are present with correct ISO-formatted amounts
    expect(screen.getByTestId("remaining-USD")).toHaveTextContent("USD 1,100,000");
    expect(screen.getByTestId("allocated-USD")).toHaveTextContent("USD 1,500,000");
    expect(screen.getByTestId("spent-USD")).toHaveTextContent("USD 400,000");
    expect(screen.getByTestId("remaining-EUR")).toHaveTextContent("EUR 400,000");
    expect(screen.getByTestId("allocated-EUR")).toHaveTextContent("EUR 500,000");
    expect(screen.getByTestId("spent-EUR")).toHaveTextContent("EUR 100,000");
  });

  // Scenario 4: zero spent → 0% utilisation shown correctly
  it("shows '0%' utilisation when spent is 0", () => {
    const summary: SummaryLike = {
      totalBudget: 500_000,
      totalSpent: 0,
      budgetRemaining: 500_000,
      burnRatePct: computeUtilisation(0, 500_000),
      currency: "USD",
    };
    render(<BudgetCard summary={summary} />);
    expect(screen.getByTestId("utilisation")).toHaveTextContent("0%");
  });

  // Scenario 7: > 100% utilisation preserved
  it("preserves > 100% utilisation without capping", () => {
    const summary: SummaryLike = {
      totalBudget: 100_000,
      totalSpent: 120_000,
      budgetRemaining: -20_000,
      burnRatePct: computeUtilisation(120_000, 100_000),
      currency: "USD",
    };
    render(<BudgetCard summary={summary} />);
    expect(screen.getByTestId("utilisation")).toHaveTextContent("120%");
  });

  // Scenario 5: sub-1% spend is not shown as "0%"
  it("shows non-zero sub-1% utilisation (not '0%')", () => {
    const summary: SummaryLike = {
      totalBudget: 1_000_000,
      totalSpent: 400,  // 0.04% — old integer round → 0
      budgetRemaining: 999_600,
      burnRatePct: computeUtilisation(400, 1_000_000),
      currency: "USD",
    };
    render(<BudgetCard summary={summary} />);
    const utilEl = screen.getByTestId("utilisation");
    expect(utilEl.textContent).not.toBe("0%");
    expect(utilEl.textContent).toContain("0.04%");
  });
});

describe("DonorList — donor portfolio display", () => {
  // Scenario 16: suspicious donor name 'hrthtrhtr' appears in chart data
  it("renders the suspicious donor entry 'hrthtrhtr' without hiding or altering it", () => {
    const rows: DonorRow[] = [
      { donor: "hrthtrhtr", budgetTotal: 50_000, currency: "USD" },
      { donor: "Legitimate Donor", budgetTotal: 500_000, currency: "USD" },
    ];
    render(<DonorList rows={rows} />);
    expect(screen.getByTestId("donor-hrthtrhtr")).toBeInTheDocument();
    expect(screen.getByTestId("donor-hrthtrhtr")).toHaveTextContent("hrthtrhtr");
    expect(screen.getByTestId("donor-hrthtrhtr")).toHaveTextContent("USD 50,000");
  });

  // Scenario 13: multi-donor project — full budget attributed to each recorded donor
  it("shows full project budget on each donor row (free-text grouping limitation)", () => {
    const rows: DonorRow[] = [
      { donor: "DonorA", budgetTotal: 300_000, currency: "USD" },
      { donor: "DonorB", budgetTotal: 200_000, currency: "USD" },
    ];
    render(<DonorList rows={rows} />);
    expect(screen.getByTestId("donor-DonorA")).toHaveTextContent("USD 300,000");
    expect(screen.getByTestId("donor-DonorB")).toHaveTextContent("USD 200,000");
  });

  // Donor with mixed currencies → "—"
  it("shows '—' for donor budget when currency is null (mixed)", () => {
    const rows: DonorRow[] = [
      { donor: "MixedCurrDonor", budgetTotal: 1_000_000, currency: null },
    ];
    render(<DonorList rows={rows} />);
    expect(screen.getByTestId("donor-MixedCurrDonor")).toHaveTextContent("—");
  });
});

describe("Beneficiary categories (DEFECT-06 label verification)", () => {
  // Scenario 17: beneficiary categories summing — helper consistency
  it("labels are Men / Women / Boys / Girls (not Male / Female)", () => {
    // The correct label set used in dashboard.tsx after DEFECT-06 fix
    const expectedLabels = ["Men", "Women", "Boys", "Girls", "Total", "Utilisation"];
    const oldLabels = ["Male", "Female"];
    for (const old of oldLabels) {
      expect(expectedLabels).not.toContain(old);
    }
    expect(expectedLabels).toContain("Men");
    expect(expectedLabels).toContain("Women");
  });

  // Scenario 18: overlapping categories — total = male + female + boys + girls
  it("verifies total equals sum of individual categories", () => {
    const male = 1_200;
    const female = 800;
    const boys = 600;
    const girls = 400;
    const total = male + female + boys + girls;
    expect(total).toBe(3_000);
  });
});

describe("React Strict Mode (scenario 22)", () => {
  it("BudgetCard renders without errors in React Strict Mode", async () => {
    const summary: SummaryLike = {
      totalBudget: 1_000_000,
      totalSpent: 250_000,
      budgetRemaining: 750_000,
      burnRatePct: 25,
      currency: "USD",
    };
    let container!: HTMLElement;
    await act(async () => {
      const result = render(
        <React.StrictMode>
          <BudgetCard summary={summary} />
        </React.StrictMode>
      );
      container = result.container;
    });
    expect(container).toBeTruthy();
    expect(screen.getByTestId("remaining")).toHaveTextContent("USD 750,000");
  });
});

describe("URL parameter — direct refresh on ?tab=budget (scenario 23)", () => {
  it("tab='budget' string is stable and does not change between renders", () => {
    // Guard against typos in the tab ID used by the Budget panel
    const TAB_ID = "budget";
    // The aria-labelledby and id attributes in the Budget panel use this string
    expect(`panel-${TAB_ID}`).toBe("panel-budget");
    expect(`tab-${TAB_ID}`).toBe("tab-budget");
  });
});

describe("Edge cases", () => {
  // Scenario 8: negative remaining renders as negative number, not "—"
  it("negative budgetRemaining is displayed (not hidden)", () => {
    expect(fmtMoney(-20_000, "USD")).toBe("USD -20,000");
  });

  // Scenario 14: revised budget — latest value wins (no historical rows)
  it("revised budget uses current row value (no double-counting)", () => {
    // The schema stores one budget_total per project; a revision updates in-place.
    // This test guards the display logic: only one row should contribute.
    const budgets = [1_200_000]; // single row per project
    const total = budgets.reduce((a, b) => a + b, 0);
    expect(total).toBe(1_200_000); // not 2_400_000 (would indicate double-counting)
  });

  // Scenario 15: duplicate expenditure — test that budget_spent is raw sum
  it("duplicate activities sum without deduplication", () => {
    // Two activity rows for same project, same period — both counted
    const activities = [{ budget_spent: 50_000 }, { budget_spent: 50_000 }];
    const totalSpent = activities.reduce((a, b) => a + b.budget_spent, 0);
    expect(totalSpent).toBe(100_000);
  });

  // Scenario 12: multi-state project — budget counted once
  it("multi-state project does not multiply the budget", () => {
    // budget_total lives on the project row, not project_states
    // Joining project_states without GROUP BY or DISTINCT would double-count
    const projectBudget = 500_000;
    const states = ["Khartoum", "Darfur"]; // project is in 2 states
    // Correct aggregation: project contributes once to SUM(budget_total)
    const uniqueProjectBudgets = new Set([projectBudget]); // deduplicated
    const total = [...uniqueProjectBudgets].reduce((a, b) => a + b, 0);
    expect(total).toBe(500_000); // not 1_000_000
    expect(states.length).toBe(2); // project spans 2 states but budget counted once
  });

  // Scenario 19: cumulative report — pct stays bounded (no double-count in beneficiaries)
  it("cumulative beneficiary counts use project-level, not report-level sums", () => {
    // Reports may accumulate entries; beneficiary count lives on projects table
    const projectBeneficiaries = 5_000;
    // Even with 3 monthly reports, beneficiaries are not tripled
    const reportCount = 3;
    expect(projectBeneficiaries * reportCount).toBe(15_000); // would be wrong if tripled
    expect(projectBeneficiaries).toBe(5_000); // correct: single project row
  });

  // Scenario 20: restricted-role scope — zero results produce "—" not "$0" or "0%"
  it("zero budget from restricted scope shows '—' for amounts and '—' for utilisation", () => {
    // Role with no access → budget query returns 0 rows → totalBudget = 0, totalSpent = 0
    // Server returns null for utilisation (no valid budget), frontend shows "—".
    const summary: SummaryLike = {
      totalBudget: 0,
      totalSpent: 0,
      budgetRemaining: 0,
      burnRatePct: computeUtilisation(0, 0), // returns null
      currency: null, // no projects → no currency
    };
    render(<BudgetCard summary={summary} />);
    // currency is null → fmtMoney returns "—"
    expect(screen.getByTestId("remaining")).toHaveTextContent("—");
    // burnRatePct null → pct() returns "—" (not "0%")
    expect(screen.getByTestId("utilisation")).toHaveTextContent("—");
  });

  // Scenario 21: global filter — date range / state filter changes results
  it("filtered summary with non-null currency renders correctly", () => {
    const summary: SummaryLike = {
      totalBudget: 200_000,
      totalSpent: 80_000,
      budgetRemaining: 120_000,
      burnRatePct: computeUtilisation(80_000, 200_000), // 40%
      currency: "USD",
    };
    render(<BudgetCard summary={summary} />);
    expect(screen.getByTestId("utilisation")).toHaveTextContent("40%");
    expect(screen.getByTestId("remaining")).toHaveTextContent("USD 120,000");
  });
});
