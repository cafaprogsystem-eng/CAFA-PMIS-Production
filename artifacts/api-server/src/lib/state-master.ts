import { pool } from "@workspace/db";

/** Canonical Sudan state identity. These values are master data, not UI labels. */
export const SUDAN_STATES = [
  ["KRT", "Khartoum State", "ولاية الخرطوم"],
  ["GZR", "Gezira State", "ولاية الجزيرة"],
  ["WNL", "White Nile State", "ولاية النيل الأبيض"],
  ["BNL", "Blue Nile State", "ولاية النيل الأزرق"],
  ["SNR", "Sennar State", "ولاية سنار"],
  ["GDR", "Gedaref State", "ولاية القضارف"],
  ["KSL", "Kassala State", "ولاية كسلا"],
  ["RDS", "Red Sea State", "ولاية البحر الأحمر"],
  ["RVN", "River Nile State", "ولاية نهر النيل"],
  ["NOR", "Northern State", "الولاية الشمالية"],
  ["NKR", "North Kordofan State", "ولاية شمال كردفان"],
  ["SKR", "South Kordofan State", "ولاية جنوب كردفان"],
  ["WKR", "West Kordofan State", "ولاية غرب كردفان"],
  ["NDF", "North Darfur State", "ولاية شمال دارفور"],
  ["SDF", "South Darfur State", "ولاية جنوب دارفور"],
  ["EDF", "East Darfur State", "ولاية شرق دارفور"],
  ["CDF", "Central Darfur State", "ولاية وسط دارفور"],
  ["WDF", "West Darfur State", "ولاية غرب دارفور"],
] as const;

export type StateMasterRecord = {
  id: number;
  name: string;
  nameAr: string;
  code: string;
  operationalStatus: "active" | "inactive";
  officeStatus: "present" | "absent" | "unknown";
};

/**
 * This assertion is deliberately used only by write paths. Historical reads
 * must resolve any existing state row even after it becomes inactive.
 */
export async function assertActiveState(stateId: number): Promise<
  | { ok: true; state: StateMasterRecord }
  | { ok: false; error: "invalid_state" | "inactive_state" }
> {
  const result = await pool.query<StateMasterRecord>(
    `SELECT id, name, name_ar AS "nameAr", code,
            operational_status AS "operationalStatus",
            office_status AS "officeStatus"
       FROM states
      WHERE id = $1`,
    [stateId],
  );
  const state = result.rows[0];
  if (!state) return { ok: false, error: "invalid_state" };
  // The tracked migration makes the database column non-null and constrained.
  // Treat an omitted value as active only for legacy callers/test fixtures that
  // select an existence row without the newly-added projection; no persisted
  // production row can enter this compatibility branch.
  if (state.operationalStatus === "inactive") return { ok: false, error: "inactive_state" };
  return { ok: true, state };
}