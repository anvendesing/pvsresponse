/**
 * Physical bin layout for Soap Room production warehouse (WH-PROD-SOAP).
 *
 * Two zones (A and B). Zone A is fully mapped below; Zone B is reserved
 * for future shelving — add entries to SOAP_ROOM_ZONE_B when ready.
 */

export const SOAP_ROOM_WAREHOUSE_CODE = "WH-PROD-SOAP";

/** 3-letter scan prefix for compact barcodes: WSP.AS05.11 */
export const SOAP_ROOM_SCAN_PREFIX = "WSP";

export type ShelfSpec = { shelf: string; binCount: number };

/** Zone A — 14 shelves, 71 bins total. */
export const SOAP_ROOM_ZONE_A: readonly ShelfSpec[] = [
  { shelf: "S01", binCount: 1 },
  { shelf: "S02", binCount: 5 },
  { shelf: "S03", binCount: 2 },
  ...Array.from({ length: 5 }, (_, i) => ({
    shelf: `S${String(i + 4).padStart(2, "0")}`,
    binCount: 11,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    shelf: `S${String(i + 9).padStart(2, "0")}`,
    binCount: 1,
  })),
  { shelf: "S12", binCount: 2 },
  { shelf: "S13", binCount: 2 },
  { shelf: "S14", binCount: 1 },
] as const;

/** Zone B — not yet laid out. */
export const SOAP_ROOM_ZONE_B: readonly ShelfSpec[] = [];

export function soapRoomBinRows(): Array<{
  zone: string;
  shelf: string;
  bin: string;
}> {
  const rows: Array<{ zone: string; shelf: string; bin: string }> = [];
  for (const spec of [
    ...SOAP_ROOM_ZONE_A.map((s) => ({ zone: "A", ...s })),
    ...SOAP_ROOM_ZONE_B.map((s) => ({ zone: "B", ...s })),
  ]) {
    for (let i = 1; i <= spec.binCount; i++) {
      rows.push({
        zone: spec.zone,
        shelf: spec.shelf,
        bin: String(i).padStart(2, "0"),
      });
    }
  }
  return rows;
}

export const SOAP_ROOM_BIN_COUNT = soapRoomBinRows().length;
