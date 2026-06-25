/**
 * Zone C bin → variant barcode assignments from the 2026-06-22 floor walk.
 * Barcodes only (descriptive text on the notes is ignored).
 */
export const ZONE_C_STOCK_QTY = 1234;

/** Handwriting / catalog fixes — keyed by note barcode. */
export const ZONE_C_BARCODE_ALIASES: Readonly<Record<string, string>> = {
  DA343: "DH343",
};

export type ZoneCBinAssignment = {
  shelf: string;
  bin: string;
  /** One or more variant barcodes for this bin slot. */
  barcodes: readonly string[];
};

export const ZONE_C_BIN_ASSIGNMENTS: readonly ZoneCBinAssignment[] = [
  // Sheet 1 — S01–S03
  { shelf: "S01", bin: "01", barcodes: ["DH360"] },
  { shelf: "S01", bin: "02", barcodes: ["DH318"] },
  { shelf: "S01", bin: "03", barcodes: ["DH405"] },
  { shelf: "S01", bin: "04", barcodes: ["DH257"] },
  { shelf: "S01", bin: "05", barcodes: ["SM937"] },
  { shelf: "S02", bin: "01", barcodes: ["ML499"] },
  { shelf: "S02", bin: "02", barcodes: ["ML500"] },
  { shelf: "S02", bin: "03", barcodes: ["SM945"] },
  { shelf: "S02", bin: "04", barcodes: ["SM934"] },
  { shelf: "S02", bin: "05", barcodes: ["SM996", "SM991"] },
  { shelf: "S03", bin: "01", barcodes: ["DH347"] },
  { shelf: "S03", bin: "02", barcodes: ["SM986", "SM985"] },
  { shelf: "S03", bin: "03", barcodes: ["SM951"] },
  { shelf: "S03", bin: "04", barcodes: ["SM927"] },
  { shelf: "S03", bin: "05", barcodes: ["OS052", "OS053"] },
  // Sheet 2 — S04, S06, S07 (504→S04, 506→S06, 507→S07)
  { shelf: "S04", bin: "01", barcodes: ["DA343"] },
  { shelf: "S04", bin: "02", barcodes: ["DH344"] },
  { shelf: "S04", bin: "03", barcodes: ["DH342"] },
  { shelf: "S04", bin: "04", barcodes: ["S1224"] },
  { shelf: "S04", bin: "05", barcodes: ["SM1006"] },
  { shelf: "S06", bin: "01", barcodes: ["DH417"] },
  { shelf: "S06", bin: "02", barcodes: ["DH301", "DH303"] },
  { shelf: "S06", bin: "03", barcodes: ["S1287"] },
  { shelf: "S06", bin: "04", barcodes: ["S1235"] },
  { shelf: "S06", bin: "05", barcodes: ["SM981"] },
  { shelf: "S07", bin: "01", barcodes: ["SM999", "SM1000"] },
  { shelf: "S07", bin: "02", barcodes: ["DH302"] },
  { shelf: "S07", bin: "04", barcodes: ["S1285", "S1286"] },
  { shelf: "S07", bin: "05", barcodes: ["SM1007", "SM1008"] },
  // Sheet 3 — S11–S13
  { shelf: "S11", bin: "01", barcodes: ["SM1017"] },
  { shelf: "S11", bin: "02", barcodes: ["SM1016"] },
  { shelf: "S11", bin: "03", barcodes: ["SM1015"] },
  { shelf: "S11", bin: "04", barcodes: ["SM1014"] },
  { shelf: "S11", bin: "05", barcodes: ["CH259"] },
  { shelf: "S12", bin: "01", barcodes: ["SM975"] },
  { shelf: "S12", bin: "02", barcodes: ["DH341"] },
  { shelf: "S12", bin: "03", barcodes: ["DH340"] },
  { shelf: "S12", bin: "04", barcodes: ["SM971"] },
  { shelf: "S12", bin: "05", barcodes: ["SM967"] },
  { shelf: "S13", bin: "01", barcodes: ["SM966"] },
  { shelf: "S13", bin: "02", barcodes: ["CH255", "CH256"] },
  { shelf: "S13", bin: "03", barcodes: ["SM946"] },
  { shelf: "S13", bin: "04", barcodes: ["SM968"] },
  { shelf: "S13", bin: "05", barcodes: ["SM913"] },
  // Sheet 4 — S08–S10
  { shelf: "S08", bin: "01", barcodes: ["SM1001"] },
  { shelf: "S08", bin: "03", barcodes: ["S1249"] },
  { shelf: "S08", bin: "04", barcodes: ["DH412", "DH413"] },
  { shelf: "S09", bin: "01", barcodes: ["DH407", "DH409"] },
  { shelf: "S09", bin: "02", barcodes: ["DH357"] },
  { shelf: "S09", bin: "03", barcodes: ["S1314"] },
  { shelf: "S09", bin: "04", barcodes: ["S1229", "S1225"] },
  { shelf: "S09", bin: "05", barcodes: ["SM976"] },
  { shelf: "S10", bin: "01", barcodes: ["DH408"] },
  { shelf: "S10", bin: "02", barcodes: ["SM990"] },
  { shelf: "S10", bin: "03", barcodes: ["SM989"] },
  { shelf: "S10", bin: "04", barcodes: ["S1246"] },
  { shelf: "S10", bin: "05", barcodes: ["SM1009"] },
];

export function resolveZoneCBarcode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  return ZONE_C_BARCODE_ALIASES[code] ?? code;
}
