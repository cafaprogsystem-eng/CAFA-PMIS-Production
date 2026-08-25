/**
 * Canonical location scope for CAFA PMIS operational records.
 *
 * HQ is a first-class location, strictly separate from Sudan States.
 * Historical records that predate the location_type column are normalised
 * by inferLocationType() in the API response layer — no mass migration required.
 *
 * This is the single source of truth for location typing.
 * Do NOT add local `locationType === "hq" ? "HQ" : state.name` branches elsewhere;
 * use formatLocation() from lib/format.ts for display and LocationSelector for input.
 */

/** Discriminated union: HQ (no State) or a specific Sudan State. */
export type LocationScope =
  | { type: "hq";    stateId: null   }
  | { type: "state"; stateId: number };

/**
 * Infers the canonical locationType string from raw DB column values.
 *
 * Rules:
 *   explicit "hq"    → "hq"
 *   explicit "state" → "state"
 *   no explicit value, stateId present → infer "state" (backward compat)
 *   no explicit value, stateId absent  → null (no location set yet)
 */
export function inferLocationType(
  locationType: string | null | undefined,
  stateId: number | null | undefined,
): "hq" | "state" | null {
  if (locationType === "hq")    return "hq";
  if (locationType === "state") return "state";
  if (stateId != null)          return "state";
  return null;
}
