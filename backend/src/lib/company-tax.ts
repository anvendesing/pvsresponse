import { db } from "../db.js";
import type { TaxContext } from "./tax.js";
import { resolveTaxKind } from "./tax.js";

let cached: { ctx: TaxContext; at: number } | null = null;
const CACHE_MS = 30_000;

export const getCompanyTaxContext = async (): Promise<TaxContext> => {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.ctx;

  const profile = await db.companyProfile.findUnique({ where: { key: "default" } });
  const ctx: TaxContext = {
    sellerState: profile?.state ?? null,
    placeOfSupplyState: profile?.state ?? null,
    pricingInclusive: profile?.pricingIncludesGst ?? false,
    defaultGstRate: profile?.defaultTaxRate ?? 18,
    transportGstEnabled: profile?.transportGstEnabled ?? true,
  };
  cached = { ctx, at: now };
  return ctx;
};

export const getTaxContextForCustomer = async (
  customerState?: string | null,
  overridePlaceOfSupply?: string | null
): Promise<TaxContext & { taxKind: "intra" | "inter" }> => {
  const base = await getCompanyTaxContext();
  const placeOfSupplyState = overridePlaceOfSupply ?? customerState ?? base.sellerState;
  const ctx = { ...base, placeOfSupplyState };
  return { ...ctx, taxKind: resolveTaxKind(ctx) };
};

export const invalidateCompanyTaxCache = (): void => {
  cached = null;
};
