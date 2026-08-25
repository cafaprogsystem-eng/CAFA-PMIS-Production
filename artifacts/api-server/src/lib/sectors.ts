// ── Canonical 7 Main Sectors (approved taxonomy — must match frontend lib/sectors.ts) ──
export const MAIN_SECTORS = Object.freeze([
  "Health",
  "Nutrition",
  "WASH",
  "Education",
  "Protection",
  "Food Security & Livelihoods",
  "Shelter & NFI",
] as const);

export type MainSector = (typeof MAIN_SECTORS)[number];

/** Backward-compatible alias. */
export const VALID_SECTORS = MAIN_SECTORS;
export type Sector = MainSector;
export const VALID_SECTOR_SET = new Set<string>(MAIN_SECTORS);

// ── Sub-sector taxonomy — approved humanitarian cluster list ──────────────────
export const SUB_SECTORS: Record<MainSector, readonly string[]> = {
  "Health": [
    "Primary Health Care",
    "Sexual & Reproductive Health (SRH)",
    "Communicable Diseases",
    "Community Health",
    "Maternal & Child Health",
    "Mental Health & Psychosocial Support (MHPSS)",
    "Trauma & Emergency Care",
    "Nutrition-Health Integration",
  ],
  "Nutrition": [
    "Acute Malnutrition Treatment",
    "Severe Acute Malnutrition (SAM)",
    "Moderate Acute Malnutrition (MAM)",
    "Stunting / Chronic Malnutrition Prevention",
    "Infant & Young Child Feeding (IYCF)",
    "Micronutrient Supplementation",
    "Community Management of Acute Malnutrition (CMAM)",
  ],
  "WASH": [
    "Water Supply",
    "Sanitation",
    "Hygiene Promotion",
    "Menstrual Hygiene Management (MHM)",
    "Water Quality",
    "Emergency WASH",
  ],
  "Education": [
    "Formal Education (EiE)",
    "Early Childhood Development (ECD)",
    "Primary Education",
    "Secondary Education",
    "Vocational & Technical Training",
    "Psychosocial Support in Education",
  ],
  "Protection": [
    "General Protection",
    "Child Protection",
    "Gender-Based Violence (GBV)",
    "Housing, Land & Property (HLP)",
    "Mine Action / EORE",
    "Legal Aid & Documentation",
    "Unaccompanied & Separated Children (UASC)",
    "Explosive Ordnance Risk Education (EORE)",
  ],
  "Food Security & Livelihoods": [
    "Food Assistance",
    "Food Security",
    "Livelihoods",
    "Agriculture",
    "Economic Recovery",
    "Market Support",
    "Cash & Voucher Assistance (CVA)",
    "Pastoral / Livestock Support",
  ],
  "Shelter & NFI": [
    "Emergency Shelter",
    "Non-Food Items (NFI) Distribution",
    "Transitional Shelter",
    "Permanent / Durable Shelter",
    "Collective Centre Management",
    "Shelter Repair & Rehabilitation",
  ],
};

// ── Assistance Modalities ─────────────────────────────────────────────────────
export const ASSISTANCE_MODALITIES = Object.freeze([
  "Cash",
  "Voucher",
  "In-Kind",
  "Service Delivery",
  "Multipurpose Cash Assistance (MPCA)",
  "Mixed Modality",
] as const);

export type AssistanceModality = (typeof ASSISTANCE_MODALITIES)[number];
export const ASSISTANCE_MODALITY_SET = new Set<string>(ASSISTANCE_MODALITIES);

// ── Program Resources sector classification (superset — includes non-project sector) ──
export const PR_SECTORS = Object.freeze([
  "General / Cross-Cutting",
  "Health",
  "Nutrition",
  "WASH",
  "Education",
  "Protection",
  "Food Security & Livelihoods",
  "Shelter & NFI",
] as const);

export const PR_SECTOR_SET = new Set<string>(PR_SECTORS);

/** All valid sub-sectors across all Main Sectors (flat set for validation). */
export const ALL_SUB_SECTOR_SET: ReadonlySet<string> = new Set(
  Object.values(SUB_SECTORS).flat(),
);

/**
 * Validate sub-sectors against a set of selected Main Sectors.
 * Each sub-sector is valid if it belongs to ANY of the selected sectors.
 * Returns an error string or null when valid.
 */
export function validateSubSectorsMulti(selectedSectors: string[], subSectors: string[]): string | null {
  const allowed = new Set<string>();
  for (const sector of selectedSectors) {
    if (sector in SUB_SECTORS) {
      for (const sub of SUB_SECTORS[sector as MainSector]) {
        allowed.add(sub);
      }
    }
  }
  for (const sub of subSectors) {
    if (!allowed.has(sub)) {
      return `"${sub}" is not a valid sub-sector for the selected sector(s): ${selectedSectors.join(", ")}`;
    }
  }
  return null;
}

/**
 * Validate sub-sectors against their parent Main Sector.
 * Returns an error string or null when valid.
 */
export function validateSubSectors(parentSector: string, subSectors: string[]): string | null {
  if (!(parentSector in SUB_SECTORS)) return null;
  return validateSubSectorsMulti([parentSector], subSectors);
}
