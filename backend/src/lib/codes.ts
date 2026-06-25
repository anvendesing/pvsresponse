// Location code encoder/decoder for the warehouse mobile flows.
//
// Codes are deterministic and round-trip with the three flat columns
// on the Bin model (zone, shelf, bin) plus the parent Warehouse.
//
// Two bin formats:
//
// **Compact** (when Warehouse.scanPrefix is set, e.g. WSP):
//   WSP.A         → zone A
//   WSP.AS05      → shelf (zone A, shelf S05)
//   WSP.AS05.11   → bin (zone A, shelf S05, bin 11)
//
// **Legacy** (full warehouse code):
//   B.WH-PROD-SOAP.A.S05.11
//   Z.<warehouse>.<zone>
//   S.<warehouse>.<zone>.<shelf>
//
// Segments are uppercased; zone/shelf/bin labels are A-Z, 0-9, underscore.

export type LocationKind = "zone" | "shelf" | "bin";

export interface LocationCode {
  kind: LocationKind;
  /** Full warehouse code after resolution, or scan prefix before lookup. */
  warehouseCode: string;
  zone: string;
  shelf?: string;
  bin?: string;
}

const LABEL_RE = /^[A-Z0-9_]+$/;
const WAREHOUSE_RE = /^[A-Z0-9_-]+$/;
/** 2–4 char alias used in compact bin codes (no dots or hyphens). */
const SCAN_PREFIX_RE = /^[A-Z0-9]{2,4}$/;

const norm = (s: string) => s.trim().toUpperCase();

const validateLabel = (name: string, value: string) => {
  if (!value) throw new Error(`location segment "${name}" is empty`);
  if (value.includes(".")) {
    throw new Error(`location segment "${name}" cannot contain a dot`);
  }
  if (!LABEL_RE.test(value)) {
    throw new Error(
      `location segment "${name}" may only contain A-Z, 0-9 and underscore`
    );
  }
};

const validateWarehouse = (value: string) => {
  if (!value) throw new Error(`warehouse code is empty`);
  if (value.includes(".")) {
    throw new Error(`warehouse code cannot contain a dot`);
  }
  if (!WAREHOUSE_RE.test(value)) {
    throw new Error(
      `warehouse code may only contain A-Z, 0-9, underscore and hyphen`
    );
  }
};

const validateScanPrefix = (value: string) => {
  if (!SCAN_PREFIX_RE.test(value)) {
    throw new Error(
      `scan prefix must be 2–4 characters (A-Z, 0-9), got "${value}"`
    );
  }
};

export type WarehouseCodeInput =
  | string
  | { code: string; scanPrefix?: string | null };

const warehouseParts = (warehouse: WarehouseCodeInput) => {
  if (typeof warehouse === "string") {
    return { code: warehouse, scanPrefix: null as string | null };
  }
  return {
    code: warehouse.code,
    scanPrefix: warehouse.scanPrefix?.trim() || null,
  };
};

export const encodeZone = (warehouseCode: string, zone: string) => {
  const wh = norm(warehouseCode);
  const z = norm(zone);
  validateWarehouse(wh);
  validateLabel("zone", z);
  return `Z.${wh}.${z}`;
};

export const encodeShelf = (
  warehouseCode: string,
  zone: string,
  shelf: string
) => {
  const wh = norm(warehouseCode);
  const z = norm(zone);
  const s = norm(shelf);
  validateWarehouse(wh);
  validateLabel("zone", z);
  validateLabel("shelf", s);
  return `S.${wh}.${z}.${s}`;
};

export const encodeBin = (
  warehouseCode: string,
  zone: string,
  shelf: string,
  bin: string
) => {
  const wh = norm(warehouseCode);
  const z = norm(zone);
  const s = norm(shelf);
  const b = norm(bin);
  validateWarehouse(wh);
  validateLabel("zone", z);
  validateLabel("shelf", s);
  validateLabel("bin", b);
  return `B.${wh}.${z}.${s}.${b}`;
};

/** Compact zone code: WSP.A (single-letter zones). */
export const encodeZoneCompact = (scanPrefix: string, zone: string) => {
  const p = norm(scanPrefix);
  const z = norm(zone);
  validateScanPrefix(p);
  validateLabel("zone", z);
  return `${p}.${z}`;
};

/** Compact shelf code: WSP.AS05 (zone + shelf merged; no bin segment). */
export const encodeShelfCompact = (
  scanPrefix: string,
  zone: string,
  shelf: string
) => {
  const p = norm(scanPrefix);
  const z = norm(zone);
  const s = norm(shelf);
  validateScanPrefix(p);
  validateLabel("zone", z);
  validateLabel("shelf", s);
  return `${p}.${z}${s}`;
};

/** Compact bin code: WSP.AS05.11 (zone + shelf merged after prefix). */
export const encodeBinCompact = (
  scanPrefix: string,
  zone: string,
  shelf: string,
  bin: string
) => {
  const p = norm(scanPrefix);
  const z = norm(zone);
  const s = norm(shelf);
  const b = norm(bin);
  validateScanPrefix(p);
  validateLabel("zone", z);
  validateLabel("shelf", s);
  validateLabel("bin", b);
  return `${p}.${z}${s}.${b}`;
};

/** Compact bin with explicit zone: WSP.LINE.01.01 (multi-char zones). */
export const encodeBinCompactExplicit = (
  scanPrefix: string,
  zone: string,
  shelf: string,
  bin: string
) => {
  const p = norm(scanPrefix);
  const z = norm(zone);
  const s = norm(shelf);
  const b = norm(bin);
  validateScanPrefix(p);
  validateLabel("zone", z);
  validateLabel("shelf", s);
  validateLabel("bin", b);
  return `${p}.${z}.${s}.${b}`;
};

/** Compact shelf with explicit zone: CL1.STG.01 (multi-char zones). */
export const encodeShelfCompactExplicit = (
  scanPrefix: string,
  zone: string,
  shelf: string
) => {
  const p = norm(scanPrefix);
  const z = norm(zone);
  const s = norm(shelf);
  validateScanPrefix(p);
  validateLabel("zone", z);
  validateLabel("shelf", s);
  return `${p}.${z}.${s}`;
};

const useMergedCompact = (zone: string) => norm(zone).length === 1;

// Parse location codes. Returns null if the string doesn't match any
// known shape — callers fall through to Bin.code lookup or SKU/barcode.
export const decodeLocation = (raw: string): LocationCode | null => {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  const parts = code.split(".");
  if (parts.length < 2) return null;

  const [prefix, ...rest] = parts;

  // -------- Compact zone: WSP.A (2 parts, zone only — single segment)
  if (
    parts.length === 2 &&
    SCAN_PREFIX_RE.test(prefix) &&
    rest.length === 1 &&
    LABEL_RE.test(rest[0]!) &&
    rest[0]!.length === 1
  ) {
    return {
      kind: "zone",
      warehouseCode: prefix,
      zone: rest[0]!,
    };
  }

  // -------- Compact shelf: WSP.AS05 (2 parts, zone + shelf merged)
  if (
    parts.length === 2 &&
    SCAN_PREFIX_RE.test(prefix) &&
    rest.length === 1 &&
    LABEL_RE.test(rest[0]!)
  ) {
    const locSeg = rest[0]!;
    if (locSeg.length < 2) return null;
    const zone = locSeg[0]!;
    const shelf = locSeg.slice(1);
    if (!LABEL_RE.test(zone) || !LABEL_RE.test(shelf)) return null;
    return {
      kind: "shelf",
      warehouseCode: prefix,
      zone,
      shelf,
    };
  }

  // -------- Compact bin: WSP.AS05.11 (3 parts, single-letter zone merged)
  // MUST run before explicit-zone shelf (next block). Otherwise STR.CS10.03
  // is misread as zone=CS10 shelf=03 instead of zone=C shelf=S10 bin=03.
  if (
    parts.length === 3 &&
    SCAN_PREFIX_RE.test(prefix) &&
    LABEL_RE.test(rest[0]!) &&
    LABEL_RE.test(rest[1]!)
  ) {
    const locSeg = rest[0]!;
    const binSeg = rest[1]!;
    if (locSeg.length >= 2) {
      const zone = locSeg[0]!;
      const shelf = locSeg.slice(1);
      if (
        zone.length === 1 &&
        LABEL_RE.test(zone) &&
        LABEL_RE.test(shelf) &&
        shelf.startsWith("S")
      ) {
        return {
          kind: "bin",
          warehouseCode: prefix,
          zone,
          shelf,
          bin: binSeg,
        };
      }
    }
  }

  // -------- Compact shelf (explicit zone): CL1.STG.01 (3 parts)
  if (
    parts.length === 3 &&
    SCAN_PREFIX_RE.test(prefix) &&
    rest.length === 2 &&
    rest[0]!.length > 1 &&
    LABEL_RE.test(rest[0]!) &&
    LABEL_RE.test(rest[1]!)
  ) {
    return {
      kind: "shelf",
      warehouseCode: prefix,
      zone: rest[0]!,
      shelf: rest[1]!,
    };
  }

  // -------- Compact bin (explicit zone): WSP.A.S05.11 (4 parts)
  if (
    parts.length === 4 &&
    SCAN_PREFIX_RE.test(prefix) &&
    rest.every((p) => p && LABEL_RE.test(p))
  ) {
    return {
      kind: "bin",
      warehouseCode: prefix,
      zone: rest[0]!,
      shelf: rest[1]!,
      bin: rest[2]!,
    };
  }

  // -------- Legacy prefixed forms
  if (parts.length < 3) return null;
  const warehouseCode = rest[0];
  if (!warehouseCode || !WAREHOUSE_RE.test(warehouseCode)) return null;
  const tail = rest.slice(1);
  for (const p of tail) if (!p || !LABEL_RE.test(p)) return null;

  switch (prefix) {
    case "Z":
      if (tail.length !== 1) return null;
      return { kind: "zone", warehouseCode, zone: tail[0]! };
    case "S":
      if (tail.length !== 2) return null;
      return {
        kind: "shelf",
        warehouseCode,
        zone: tail[0]!,
        shelf: tail[1]!,
      };
    case "B":
      if (tail.length !== 3) return null;
      return {
        kind: "bin",
        warehouseCode,
        zone: tail[0]!,
        shelf: tail[1]!,
        bin: tail[2]!,
      };
    default:
      return null;
  }
};

/** True when the segment is a compact scan prefix (not a full WH code). */
export const isScanPrefixSegment = (segment: string): boolean =>
  SCAN_PREFIX_RE.test(norm(segment));

export const zoneCodeFromRow = (
  zone: string,
  warehouse: WarehouseCodeInput
): string => {
  const { code: whCode, scanPrefix } = warehouseParts(warehouse);
  if (scanPrefix && norm(zone).length === 1) {
    return encodeZoneCompact(scanPrefix, zone);
  }
  return encodeZone(whCode, zone);
};

export const shelfCodeFromRow = (
  row: { zone: string; shelf: string },
  warehouse: WarehouseCodeInput
): string => {
  const { code: whCode, scanPrefix } = warehouseParts(warehouse);
  if (scanPrefix) {
    if (useMergedCompact(row.zone)) {
      return encodeShelfCompact(scanPrefix, row.zone, row.shelf);
    }
    return encodeShelfCompactExplicit(scanPrefix, row.zone, row.shelf);
  }
  return encodeShelf(whCode, row.zone, row.shelf);
};

export const binCodeFromRow = (
  bin: { zone: string; shelf: string; bin: string },
  warehouse: WarehouseCodeInput
): string => {
  const { code: whCode, scanPrefix } = warehouseParts(warehouse);
  if (scanPrefix) {
    if (useMergedCompact(bin.zone)) {
      return encodeBinCompact(scanPrefix, bin.zone, bin.shelf, bin.bin);
    }
    return encodeBinCompactExplicit(
      scanPrefix,
      bin.zone,
      bin.shelf,
      bin.bin
    );
  }
  return encodeBin(whCode, bin.zone, bin.shelf, bin.bin);
};
