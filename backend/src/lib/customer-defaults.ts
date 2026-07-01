import { db } from "../db.js";

/** Auto-allocated ERP codes: CUST-1, CUST-001, CUST-0001, … */
const SYSTEM_CUSTOMER_CODE = /^CUST-\d+$/i;

export const isSystemAllocatedCustomerCode = (code: string): boolean =>
  SYSTEM_CUSTOMER_CODE.test(code.trim());

const cache: Partial<Record<"RETAIL" | "DEALER", string>> = {};

export const lookupPriceListIdByCode = async (
  code: "RETAIL" | "DEALER"
): Promise<string | null> => {
  if (cache[code]) return cache[code]!;
  const row = await db.priceList.findUnique({ where: { code }, select: { id: true } });
  if (row) cache[code] = row.id;
  return row?.id ?? null;
};

export const getRetailPriceListId = (): Promise<string | null> =>
  lookupPriceListIdByCode("RETAIL");

export const getDealerPriceListId = (): Promise<string | null> =>
  lookupPriceListIdByCode("DEALER");

/** Default tier: Retail for CUST-#### codes, Dealer for all other codes. */
export const defaultPriceListIdForCustomerCode = async (
  code: string,
  explicitPriceListId?: string | null
): Promise<string | null> => {
  if (explicitPriceListId) return explicitPriceListId;
  return isSystemAllocatedCustomerCode(code)
    ? getRetailPriceListId()
    : getDealerPriceListId();
};
