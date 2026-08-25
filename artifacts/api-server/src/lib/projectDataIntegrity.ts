import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Values that communicate missing or test data, rather than a confirmed
 * organisation. "Unknown" is used by the project API when no donor is
 * supplied, so it is intentionally included here for audit classification
 * but is not rejected when it is generated as that missing-value marker.
 */
const PLACEHOLDER_DONOR_VALUES = new Set([
  "dummy",
  "n/a",
  "na",
  "none",
  "not applicable",
  "placeholder",
  "test",
  "tbd",
  "to be confirmed",
  "to be determined",
  "unknown",
  "hrthtrhtr",
  "hrthtrhtrhtr",
]);

export function isExplicitNoDonorMarker(value: string | null): boolean {
  return value?.trim().toLowerCase() === "unknown";
}

export type DonorValidationResult =
  | { ok: true }
  | { ok: false; error: "placeholder_donor"; message: string };

/**
 * Identifies donor values that must not be presented as confirmed donor data.
 * This is deliberately conservative: legitimate short donor acronyms such as
 * WFP, EU, and GIZ must remain valid.
 */
export function isPlaceholderLikeDonorName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return false;
  if (PLACEHOLDER_DONOR_VALUES.has(normalized)) return true;
  return /^([a-z])\1{3,}$/i.test(normalized);
}

export function validateDonorName(value: unknown): DonorValidationResult {
  if (!isPlaceholderLikeDonorName(value)) return { ok: true };
  return {
    ok: false,
    error: "placeholder_donor",
    message: "Enter a confirmed donor organisation or select a registered donor.",
  };
}

/**
 * A correction target is stronger than a generic placeholder-looking value:
 * it must be unlinked legacy free text and must not be the deliberately
 * recorded Unknown missing-donor state.
 */
export function isConfirmedUnlinkedPlaceholderDonor(input: {
  donor: string | null;
  donorId: number | null;
  donorRegistryName: string | null;
}): boolean {
  return !isExplicitNoDonorMarker(input.donor)
    && input.donorId === null
    && input.donorRegistryName === null
    && isPlaceholderLikeDonorName(input.donor);
}

export type SuspiciousProjectDonor = {
  id: number;
  code: string;
  title: string;
  status: string;
  donor: string;
  donorId: number | null;
  budgetTotal: number | string | null;
  currency: string | null;
};

export type FocusedProjectDonorFinding = SuspiciousProjectDonor & {
  classification: "confirmed_placeholder" | "explicit_missing_donor";
  provenance: "unlinked_free_text" | "explicit_missing_marker";
};

export type FocusedProjectDonorScan = {
  confirmedPlaceholders: FocusedProjectDonorFinding[];
  explicitMissingDonors: FocusedProjectDonorFinding[];
};

/**
 * Read-only scan used by the administrative donor-correction workflow.
 * Restricting the query to operational/submitted lifecycle states keeps the
 * result focused, while requiring an unlinked donor value avoids flagging a
 * legitimate registered donor whose display name happens to be short or
 * placeholder-like.
 */
export async function scanFocusedProjectDonors(): Promise<FocusedProjectDonorScan> {
  const { rows } = await pool.query<{
    id: number;
    code: string;
    title: string;
    status: string;
    donor: string | null;
    donor_id: number | null;
    donor_registry_name: string | null;
    budget_total: number | string | null;
    currency: string | null;
  }>(
    `SELECT p.id, p.code, p.title, p.status, p.donor, p.donor_id,
            d.name AS donor_registry_name, p.budget_total, p.currency
       FROM projects p
       LEFT JOIN donors d ON d.id = p.donor_id
      WHERE p.deleted_at IS NULL
        AND p.status IN ('submitted', 'approved', 'active')
        AND p.donor IS NOT NULL
        AND p.donor <> ''`,
  );

  const confirmedPlaceholders: FocusedProjectDonorFinding[] = [];
  const explicitMissingDonors: FocusedProjectDonorFinding[] = [];
  for (const row of rows) {
    const base = {
      id: row.id,
      code: row.code,
      title: row.title,
      status: row.status,
      donor: row.donor ?? "",
      donorId: row.donor_id,
      budgetTotal: row.budget_total,
      currency: row.currency,
    };
    if (
      isExplicitNoDonorMarker(row.donor)
      && row.donor_id === null
      && row.donor_registry_name === null
    ) {
      explicitMissingDonors.push({
        ...base,
        classification: "explicit_missing_donor",
        provenance: "explicit_missing_marker",
      });
    } else if (isConfirmedUnlinkedPlaceholderDonor({
      donor: row.donor,
      donorId: row.donor_id,
      donorRegistryName: row.donor_registry_name,
    })) {
      confirmedPlaceholders.push({
        ...base,
        classification: "confirmed_placeholder",
        provenance: "unlinked_free_text",
      });
    }
  }
  return { confirmedPlaceholders, explicitMissingDonors };
}

/**
 * Logs suspicious existing project records for administrator review. This
 * never changes data and must not prevent the API from starting if the audit
 * query is unavailable.
 */
export async function runProjectDataIntegrityScan(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: number;
      code: string;
      title: string;
      status: string;
      donor: string | null;
      donor_id: number | null;
      budget_total: number | string | null;
      currency: string | null;
    }>(
      `SELECT id, code, title, status, donor, donor_id, budget_total, currency
       FROM projects
       WHERE deleted_at IS NULL AND donor IS NOT NULL AND donor <> ''`,
    );
    const suspicious = rows
      .filter((row) => !isExplicitNoDonorMarker(row.donor) && isPlaceholderLikeDonorName(row.donor))
      .map((row): SuspiciousProjectDonor => ({
        id: row.id,
        code: row.code,
        title: row.title,
        status: row.status,
        donor: row.donor ?? "",
        donorId: row.donor_id,
        budgetTotal: row.budget_total,
        currency: row.currency,
      }));

    if (suspicious.length > 0) {
      logger.warn(
        { projects: suspicious, count: suspicious.length },
        "Suspicious project donor value detected; authorised administrator review required",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Project donor integrity scan could not be completed");
  }
}