import { db } from "../db.js";
import { STOCK_ROOM_WAREHOUSE_CODE } from "./stock-room-layout.js";

/** Parse `[ops] fg=STR staging=WH-PROD-OIL replenish=WH-GDNW,WH-STOR` from facility description. */
export const parseFacilityOps = (description: string | null | undefined) => {
  const out: {
    fg?: string;
    staging?: string;
    zone?: string;
    replenish: string[];
  } = { replenish: [] };
  if (!description) return out;
  const line = description.split("\n").find((l) => l.startsWith("[ops]"));
  if (!line) return out;
  for (const part of line.replace("[ops]", "").trim().split(/\s+/)) {
    const [key, val] = part.split("=");
    if (!key || val == null) continue;
    if (key === "replenish") {
      out.replenish = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "fg") out.fg = val;
    else if (key === "staging") out.staging = val;
    else if (key === "zone") out.zone = val;
  }
  return out;
};

/** Merged replenish list: DB column first, then [ops] tag in description. */
export const facilityReplenishCodes = (facility: {
  replenishWarehouseCodes?: string | null;
  description?: string | null;
}): string[] => {
  const fromCol = (facility.replenishWarehouseCodes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromCol.length) return fromCol;
  return parseFacilityOps(facility.description).replenish;
};

/**
 * Resolve a source bin for MO-release replenishment TOs.
 * Tries configured replenish warehouses first, then any active storage WH.
 * Prefers parent (bulk) bins over variant bins for raw pulls.
 */
export const findReplenishmentSourceBin = async (
  productId: string,
  replenishCodes: string[],
  minQty = 1
) => {
  const productWhere = { productId, qty: { gte: minQty } };
  const activeWh = { active: true };

  const search = async (warehouseFilter: object, parentOnly: boolean) =>
    db.bin.findFirst({
      where: {
        ...productWhere,
        ...(parentOnly ? { variantId: null } : {}),
        warehouse: { ...activeWh, ...warehouseFilter },
      },
      orderBy: { qty: "desc" },
    });

  const codesToSearch = [
    ...replenishCodes,
    ...(replenishCodes.includes(STOCK_ROOM_WAREHOUSE_CODE)
      ? []
      : [STOCK_ROOM_WAREHOUSE_CODE]),
  ];

  if (codesToSearch.length) {
    const inConfigured = await search({ code: { in: codesToSearch } }, true);
    if (inConfigured) return inConfigured;
    const inConfiguredAny = await search({ code: { in: codesToSearch } }, false);
    if (inConfiguredAny) return inConfiguredAny;
  }

  const inStorage = await search({ kind: "storage" }, true);
  if (inStorage) return inStorage;
  return search({ kind: "storage" }, false);
};
