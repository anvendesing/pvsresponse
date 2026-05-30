// Location code encoder/decoder for the warehouse mobile flows.
//
// Codes are deterministic and round-trip with the three flat columns
// on the Bin model (zone, shelf, bin) plus the parent Warehouse.code.
// We intentionally avoid introducing separate Zone/Shelf entities -
// the existing schema treats them as labels and any nesting is
// implicit via the unique key on Bin.
//
// Format (separator is "." because Warehouse.code legitimately
// contains hyphens, e.g. "WH-MAIN"):
//   Z.<warehouse>.<zone>
//   S.<warehouse>.<zone>.<shelf>
//   B.<warehouse>.<zone>.<shelf>.<bin>
//
// Segments are uppercased and trimmed; warehouse codes may contain
// hyphens; zone/shelf/bin labels are restricted to A-Z, 0-9
// and underscore so the parser stays unambiguous.

export type LocationKind = "zone" | "shelf" | "bin";

export interface LocationCode {
  kind: LocationKind;
  warehouseCode: string;
  zone: string;
  shelf?: string;
  bin?: string;
}

const LABEL_RE = /^[A-Z0-9_]+$/;
const WAREHOUSE_RE = /^[A-Z0-9_-]+$/;

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

// Parse any of the three prefixed forms. Returns null if the string
// doesn't look like a location code; callers can then fall through to
// SKU/barcode resolution. Never throws on shape - operators may scan
// arbitrary product barcodes through the same endpoint.
export const decodeLocation = (raw: string): LocationCode | null => {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  const parts = code.split(".");
  if (parts.length < 3) return null;
  const [prefix, warehouseCode, ...rest] = parts;
  if (!warehouseCode || !WAREHOUSE_RE.test(warehouseCode)) return null;
  for (const p of rest) if (!p || !LABEL_RE.test(p)) return null;
  switch (prefix) {
    case "Z":
      if (rest.length !== 1) return null;
      return { kind: "zone", warehouseCode, zone: rest[0] };
    case "S":
      if (rest.length !== 2) return null;
      return {
        kind: "shelf",
        warehouseCode,
        zone: rest[0],
        shelf: rest[1],
      };
    case "B":
      if (rest.length !== 3) return null;
      return {
        kind: "bin",
        warehouseCode,
        zone: rest[0],
        shelf: rest[1],
        bin: rest[2],
      };
    default:
      return null;
  }
};

// Look up a Bin's printable code from its row, given the parent
// Warehouse.code. Pure helper; doesn't touch the DB.
export const binCodeFromRow = (
  bin: { zone: string; shelf: string; bin: string },
  warehouseCode: string
): string =>
  encodeBin(warehouseCode, bin.zone, bin.shelf, bin.bin);
