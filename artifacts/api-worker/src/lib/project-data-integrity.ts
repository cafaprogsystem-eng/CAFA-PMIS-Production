/**
 * Ported from artifacts/api-server/src/lib/projectDataIntegrity.ts — only the
 * pure donor-name validation used by projects.ts's create/update routes.
 * isConfirmedUnlinkedPlaceholderDonor / scanFocusedProjectDonors back the
 * donor-integrity-scan and donor-correction endpoints, deferred with the rest
 * of the donor routes.
 */

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
