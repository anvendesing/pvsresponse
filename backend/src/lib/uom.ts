// Canonical Unit of Measure (UoM) catalog.
//
// Modeled after Odoo's UoM master:
//   - UoMs are grouped into categories (Weight, Volume, Length, Unit).
//   - Each category has exactly one reference UoM with factor 1.
//   - Other UoMs in the category store factor relative to the
//     reference: factor = "how many reference units are in 1 of this".
//
// Example - Weight (reference = kg):
//   kg.factor = 1     (1 kg = 1 kg)
//   g.factor  = 0.001 (1 g  = 0.001 kg)
//   t.factor  = 1000  (1 t  = 1000 kg)
//
// This module is the single source of truth used to seed the database
// and to normalize legacy free-text uom values during migration.

export interface UomCategorySeed {
  code: string;
  name: string;
  description?: string;
}

export interface UomSeed {
  code: string; // canonical code stored in records (lowercased)
  name: string; // human-friendly display name
  categoryCode: string;
  factor: number; // reference units per 1 of this UoM
  isReference?: boolean; // true for the category reference
  rounding?: number; // smallest displayed/stored increment
  active?: boolean;
}

export const UOM_CATEGORIES: UomCategorySeed[] = [
  {
    code: "unit",
    name: "Unit",
    description:
      "Counted items - pieces, packs, dozens, boxes. Reference: pc.",
  },
  {
    code: "weight",
    name: "Weight",
    description:
      "Mass-based units - kilograms, grams, tonnes. Reference: kg.",
  },
  {
    code: "volume",
    name: "Volume",
    description:
      "Liquid / dry volumes - litres, millilitres. Reference: L.",
  },
  {
    code: "length",
    name: "Length",
    description: "Linear dimensions - metres, centimetres. Reference: m.",
  },
  {
    code: "time",
    name: "Time",
    description: "Hours, minutes, days. Reference: hour.",
  },
];

// Canonical UoMs. Codes follow the SI / ISO short forms where possible:
//   - kg, g, mg, t (weight)
//   - L, mL          (volume - capital L per ISO 80000)
//   - m, cm, mm, km  (length)
//   - pc, dozen, pack, box (unit)
//   - hour, min, sec, day  (time)
export const UOMS: UomSeed[] = [
  // ----- Unit (counted items) -----
  {
    code: "pc",
    name: "Piece",
    categoryCode: "unit",
    factor: 1,
    isReference: true,
    rounding: 1,
  },
  { code: "dozen", name: "Dozen", categoryCode: "unit", factor: 12, rounding: 1 },
  { code: "pair", name: "Pair", categoryCode: "unit", factor: 2, rounding: 1 },
  { code: "pack", name: "Pack", categoryCode: "unit", factor: 1, rounding: 1 },
  { code: "box", name: "Box", categoryCode: "unit", factor: 1, rounding: 1 },
  {
    code: "hundred",
    name: "Hundred",
    categoryCode: "unit",
    factor: 100,
    rounding: 1,
  },
  {
    code: "thousand",
    name: "Thousand",
    categoryCode: "unit",
    factor: 1000,
    rounding: 1,
  },

  // ----- Weight -----
  {
    code: "kg",
    name: "Kilogram",
    categoryCode: "weight",
    factor: 1,
    isReference: true,
    rounding: 0.001,
  },
  {
    code: "g",
    name: "Gram",
    categoryCode: "weight",
    factor: 0.001,
    rounding: 0.01,
  },
  {
    code: "mg",
    name: "Milligram",
    categoryCode: "weight",
    factor: 0.000001,
    rounding: 0.1,
  },
  {
    code: "t",
    name: "Tonne",
    categoryCode: "weight",
    factor: 1000,
    rounding: 0.001,
  },
  {
    code: "lb",
    name: "Pound",
    categoryCode: "weight",
    factor: 0.45359237,
    rounding: 0.01,
  },
  {
    code: "oz",
    name: "Ounce",
    categoryCode: "weight",
    factor: 0.0283495,
    rounding: 0.01,
  },

  // ----- Volume -----
  {
    code: "L",
    name: "Litre",
    categoryCode: "volume",
    factor: 1,
    isReference: true,
    rounding: 0.001,
  },
  {
    code: "mL",
    name: "Millilitre",
    categoryCode: "volume",
    factor: 0.001,
    rounding: 0.1,
  },
  {
    code: "m3",
    name: "Cubic metre",
    categoryCode: "volume",
    factor: 1000,
    rounding: 0.001,
  },
  {
    code: "gal",
    name: "Gallon (US)",
    categoryCode: "volume",
    factor: 3.78541,
    rounding: 0.01,
  },

  // ----- Length -----
  {
    code: "m",
    name: "Metre",
    categoryCode: "length",
    factor: 1,
    isReference: true,
    rounding: 0.001,
  },
  {
    code: "cm",
    name: "Centimetre",
    categoryCode: "length",
    factor: 0.01,
    rounding: 0.01,
  },
  {
    code: "mm",
    name: "Millimetre",
    categoryCode: "length",
    factor: 0.001,
    rounding: 0.1,
  },
  {
    code: "km",
    name: "Kilometre",
    categoryCode: "length",
    factor: 1000,
    rounding: 0.001,
  },
  {
    code: "in",
    name: "Inch",
    categoryCode: "length",
    factor: 0.0254,
    rounding: 0.01,
  },
  {
    code: "ft",
    name: "Foot",
    categoryCode: "length",
    factor: 0.3048,
    rounding: 0.01,
  },

  // ----- Time -----
  {
    code: "hour",
    name: "Hour",
    categoryCode: "time",
    factor: 1,
    isReference: true,
    rounding: 0.01,
  },
  {
    code: "min",
    name: "Minute",
    categoryCode: "time",
    factor: 1 / 60,
    rounding: 0.1,
  },
  {
    code: "sec",
    name: "Second",
    categoryCode: "time",
    factor: 1 / 3600,
    rounding: 0.1,
  },
  { code: "day", name: "Day", categoryCode: "time", factor: 24, rounding: 0.5 },
];

// Legacy / informal strings that we need to map to canonical codes
// when normalizing existing data and accepting user input. Keys are
// lowercased, trimmed forms; values are canonical codes that exist
// in UOMS above.
//
// Order of resolution in normalizeUomCode():
//   1. Exact match (case-sensitive) against a canonical code -> return as-is
//   2. Lowercased lookup in this map
//   3. Fallback: return null (caller decides)
const LEGACY_UOM_ALIASES: Record<string, string> = {
  // unit
  nos: "pc",
  no: "pc",
  pcs: "pc",
  piece: "pc",
  pieces: "pc",
  unit: "pc",
  units: "pc",
  ea: "pc",
  each: "pc",
  doz: "dozen",
  dz: "dozen",
  pkt: "pack",
  packet: "pack",
  packets: "pack",
  bx: "box",
  boxes: "box",
  cs: "box",
  case: "box",
  ctn: "box",
  carton: "box",
  // weight
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilo: "kg",
  kilos: "kg",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  ton: "t",
  tonne: "t",
  tonnes: "t",
  mt: "t",
  pound: "lb",
  pounds: "lb",
  ounce: "oz",
  ounces: "oz",
  // volume
  ltr: "L",
  ltrs: "L",
  l: "L",
  lit: "L",
  liter: "L",
  liters: "L",
  litre: "L",
  litres: "L",
  ml: "mL",
  mls: "mL",
  millilitre: "mL",
  milliliters: "mL",
  cum: "m3",
  cbm: "m3",
  // length
  mtr: "m",
  mtrs: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  inch: "in",
  inches: "in",
  feet: "ft",
  // time
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  minute: "min",
  minutes: "min",
  mins: "min",
  second: "sec",
  seconds: "sec",
  secs: "sec",
  days: "day",
};

/**
 * Convert any legacy/informal UoM string to a canonical UoM code.
 * Returns null if no mapping exists - caller should treat that as
 * a validation error or fall back to "pc".
 */
export const normalizeUomCode = (input: string | null | undefined): string | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Exact case-sensitive match against canonical codes (covers
  // case-sensitive ones like "L" and "mL" so we don't accidentally
  // re-map them).
  if (UOMS.some((u) => u.code === trimmed)) return trimmed;
  // Case-insensitive alias resolution.
  const lower = trimmed.toLowerCase();
  if (LEGACY_UOM_ALIASES[lower]) return LEGACY_UOM_ALIASES[lower];
  // Some canonical codes also resolve case-insensitively (e.g. "KG" -> "kg")
  // unless they have an explicit case-sensitive form like "L" / "mL".
  const ci = UOMS.find((u) => u.code.toLowerCase() === lower);
  if (ci) return ci.code;
  return null;
};

/**
 * Convert a quantity from one UoM to another in the same category.
 * Throws if the codes are unknown or in different categories.
 */
export const convertUom = (
  qty: number,
  fromCode: string,
  toCode: string,
  uoms: { code: string; categoryCode: string; factor: number }[]
): number => {
  if (fromCode === toCode) return qty;
  const from = uoms.find((u) => u.code === fromCode);
  const to = uoms.find((u) => u.code === toCode);
  if (!from || !to)
    throw new Error(
      `Unknown UoM code(s) in conversion: from=${fromCode} to=${toCode}`
    );
  if (from.categoryCode !== to.categoryCode)
    throw new Error(
      `Cannot convert across UoM categories: ${fromCode} (${from.categoryCode}) -> ${toCode} (${to.categoryCode})`
    );
  return (qty * from.factor) / to.factor;
};
