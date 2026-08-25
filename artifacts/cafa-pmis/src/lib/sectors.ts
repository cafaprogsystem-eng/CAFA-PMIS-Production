import { Heart, Droplets, Shield, BookOpen, Wheat, Apple, Home, type LucideIcon } from "lucide-react";

// ── Canonical 7 Main Sectors (approved taxonomy) ─────────────────────────────
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

/** Backward-compatible alias — all existing `SECTORS` imports continue to work. */
export const SECTORS = MAIN_SECTORS;
export type Sector = MainSector;

// ── Sub-sector taxonomy (parent → children) — approved humanitarian cluster list ──
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

// ── Assistance Modalities (independent of sector) ─────────────────────────────
export const ASSISTANCE_MODALITIES = Object.freeze([
  "Cash",
  "Voucher",
  "In-Kind",
  "Service Delivery",
  "Multipurpose Cash Assistance (MPCA)",
  "Mixed Modality",
] as const);

export type AssistanceModality = (typeof ASSISTANCE_MODALITIES)[number];

// ── Compact FSL abbreviation helper ──────────────────────────────────────────
export const FSL_ABBREVIATION = "Food Security & Livelihoods (FSL)";

/**
 * Compact display label — use in tight UI contexts where full name is too long.
 */
export function getSectorDisplayLabel(sector: string): string {
  if (sector === "Food Security & Livelihoods") return FSL_ABBREVIATION;
  return sector;
}

// ── Sector Metadata ───────────────────────────────────────────────────────────
export interface SectorMeta {
  color: string;
  bg: string;
  border: string;
  icon: LucideIcon;
}

export const SECTOR_META: Record<string, SectorMeta> = {
  "Health":                      { color: "text-rose-600",    bg: "bg-rose-50",    border: "border-rose-100",    icon: Heart    },
  "Nutrition":                   { color: "text-orange-600",  bg: "bg-orange-50",  border: "border-orange-100",  icon: Apple    },
  "WASH":                        { color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-100",    icon: Droplets },
  "Education":                   { color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-100",   icon: BookOpen },
  "Protection":                  { color: "text-purple-600",  bg: "bg-purple-50",  border: "border-purple-100",  icon: Shield   },
  "Food Security & Livelihoods": { color: "text-lime-600",    bg: "bg-lime-50",    border: "border-lime-100",    icon: Wheat    },
  "Shelter & NFI":               { color: "text-stone-600",   bg: "bg-stone-50",   border: "border-stone-100",   icon: Home     },
};

export const DEFAULT_SECTOR_META: SectorMeta = {
  color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-100", icon: Shield,
};

export function getSectorMeta(sector: string): SectorMeta {
  return SECTOR_META[sector] ?? DEFAULT_SECTOR_META;
}

/** All valid sub-sectors across all Main Sectors (flat set for validation). */
export const ALL_SUB_SECTORS: ReadonlySet<string> = new Set(
  Object.values(SUB_SECTORS).flat(),
);

/**
 * Validate sub-sectors against a set of selected Main Sectors (multi-sector projects).
 * Each sub-sector is valid if it belongs to ANY of the selected sectors.
 * Returns null if valid, or an error message.
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
 * Validate that every sub-sector in `subSectors` belongs to `parentSector`.
 * Returns null if valid, or an error message.
 */
export function validateSubSectors(parentSector: string, subSectors: string[]): string | null {
  if (!(parentSector in SUB_SECTORS)) return null; // unknown parent — skip validation
  return validateSubSectorsMulti([parentSector], subSectors);
}
