import { db } from "../db.js";
import { unitWeightKg } from "./variant-weight.js";
import { fetchShiprocketRates, getPickupPincode, type ShiprocketRateRow } from "./shiprocket.js";
import { resolveGstRate } from "./tax.js";
import { getTaxContextForCustomer } from "./company-tax.js";
import { computeDocumentTax } from "./document-tax.js";
import {
  distanceKmForCustomerAddress,
  distanceKmForCustomerProfile,
} from "./address-distance.js";
export const FREE_SHIPPING_THRESHOLD = 3000;
const PACKAGING_BUFFER_KG = 0.15;

export type DeliveryMethod = "standard" | "express";

export type ShippingOption = {
  id: DeliveryMethod;
  label: string;
  fee: number;
  transportTax: number;
  payableTotal: number;
  etaDays: number | null;
  courierName: string | null;
  mode: string;
  freeShippingApplied: boolean;
};

export type ShippingQuote = {
  pickupPincode: string;
  deliveryPincode: string;
  /** Approx. km between pickup and delivery pincodes (offline centroid lookup). */
  distanceKm: number | null;
  weightKg: number;
  subTotal: number;
  goodsTax: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxKind: "intra" | "inter";
  roundOff: number;
  source: "shiprocket" | "fallback";
  options: ShippingOption[];
};
type CartItem = {
  productId: string;
  variantId?: string | null;
  qty: number;
};

export async function computeCartWeightKg(items: CartItem[]): Promise<number> {
  const variantIds = items
    .map((i) => i.variantId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const productIds = items.map((i) => i.productId);

  const variants = variantIds.length
    ? await db.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, weightKg: true, size: true, productId: true },
      })
    : [];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, weightKg: true },
  });

  const vMap = new Map(variants.map((v) => [v.id, v]));
  const pMap = new Map(products.map((p) => [p.id, p]));

  let total = PACKAGING_BUFFER_KG;
  for (const it of items) {
    const p = pMap.get(it.productId);
    const v = it.variantId ? vMap.get(it.variantId) : null;
    total += unitWeightKg(v, p) * it.qty;
  }
  return Math.max(Math.round(total * 1000) / 1000, 0.5);
}

async function computeCartGoodsTax(
  items: CartItem[],
  deliveryState?: string | null
): Promise<{
  subTotal: number;
  goodsTax: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxKind: "intra" | "inter";
  roundOff: number;
}> {
  const variantIds = items
    .map((i) => i.variantId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const productIds = items.map((i) => i.productId);

  const variants = variantIds.length
    ? await db.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, sellingPriceOverride: true, gstRate: true, productId: true },
      })
    : [];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sellingPrice: true, gstRate: true },
  });

  const vMap = new Map(variants.map((v) => [v.id, v]));
  const pMap = new Map(products.map((p) => [p.id, p]));

  const taxCtx = await getTaxContextForCustomer(deliveryState);
  const lineInputs = items
    .map((it) => {
      const p = pMap.get(it.productId);
      if (!p) return null;
      const v = it.variantId ? vMap.get(it.variantId) : null;
      const rate = v?.sellingPriceOverride ?? p.sellingPrice ?? 0;
      return {
        qty: it.qty,
        rate,
        gstRate: resolveGstRate(
          { gstRate: p.gstRate },
          v ? { gstRate: v.gstRate } : null,
          taxCtx.defaultGstRate ?? 18
        ),
      };
    })
    .filter(Boolean) as { qty: number; rate: number; gstRate: number }[];

  const doc = computeDocumentTax({ items: lineInputs, transportCharge: 0, taxCtx });
  return {
    subTotal: doc.subTotal,
    goodsTax: doc.tax,
    cgstTotal: doc.cgstTotal,
    sgstTotal: doc.sgstTotal,
    igstTotal: doc.igstTotal,
    taxKind: doc.taxKind,
    roundOff: doc.roundOff,
  };
}

const buildOption = (
  id: DeliveryMethod,
  label: string,
  fee: number,
  goodsDoc: ReturnType<typeof computeDocumentTax>,
  row: ShiprocketRateRow,
  freeShippingApplied: boolean
): ShippingOption => {
  const withFreight = computeDocumentTax({
    items: [],
    transportCharge: fee,
    taxCtx: {
      sellerState: goodsDoc.sellerState,
      placeOfSupplyState: goodsDoc.placeOfSupplyState,
      pricingInclusive: goodsDoc.pricingInclusive,
      taxKind: goodsDoc.taxKind,
    },
  });
  const transportTax = fee > 0 ? withFreight.transportTax : 0;
  const payableTotal = Math.round(
    (goodsDoc.subTotal + goodsDoc.tax + goodsDoc.roundOff + fee + transportTax) * 100
  ) / 100;
  return {
    id,
    label,
    fee,
    transportTax,
    payableTotal,
    etaDays: row.etaDays,
    courierName: row.courierName,
    mode: row.mode,
    freeShippingApplied,
  };
};
const pickBest = (rows: ShiprocketRateRow[], mode: "Surface" | "Air" | "Unknown"): ShiprocketRateRow | null => {
  const filtered =
    mode === "Unknown"
      ? rows.filter((r) => r.mode === "Unknown")
      : rows.filter((r) => r.mode === mode || (mode === "Surface" && r.mode === "Unknown"));
  if (filtered.length === 0) return null;
  return filtered.reduce((best, row) => (row.rate < best.rate ? row : best));
};

export async function quoteStorefrontShipping(params: {
  deliveryPincode: string;
  subTotal: number;
  items: CartItem[];
  deliveryState?: string | null;
  addressId?: string | null;
  customerId?: string | null;
}): Promise<{ ok: true; quote: ShippingQuote } | { ok: false; code: string; message: string }> {
  const deliveryPincode = params.deliveryPincode.replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9]\d{5}$/.test(deliveryPincode)) {
    return { ok: false, code: "invalid_pincode", message: "Enter a valid 6-digit delivery pincode." };
  }

  const weightKg = await computeCartWeightKg(params.items);
  const goods = await computeCartGoodsTax(params.items, params.deliveryState);
  const pickupPincode = await getPickupPincode();

  let distanceKm: number | null = null;
  if (params.addressId && params.customerId) {
    distanceKm = await distanceKmForCustomerAddress(
      params.addressId,
      params.customerId,
      deliveryPincode
    );
  }
  if (distanceKm == null && params.customerId) {
    distanceKm = await distanceKmForCustomerProfile(params.customerId, deliveryPincode);
  }

  const { rows, source } = await fetchShiprocketRates({
    pickupPincode,
    deliveryPincode,
    weightKg,
  });

  if (rows.length === 0) {
    return {
      ok: false,
      code: "not_serviceable",
      message: "Delivery is not available for this pincode.",
    };
  }

  const standardRow = pickBest(rows, "Surface") ?? pickBest(rows, "Unknown");
  const expressRow = pickBest(rows, "Air") ?? standardRow;

  if (!standardRow) {
    return {
      ok: false,
      code: "not_serviceable",
      message: "No couriers available for this pincode.",
    };
  }

  const taxCtx = await getTaxContextForCustomer(params.deliveryState);
  const variantIds = params.items
    .map((i) => i.variantId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const productIds = params.items.map((i) => i.productId);
  const variants = variantIds.length
    ? await db.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, sellingPriceOverride: true, gstRate: true, productId: true },
      })
    : [];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sellingPrice: true, gstRate: true },
  });
  const vMap = new Map(variants.map((v) => [v.id, v]));
  const pMap = new Map(products.map((p) => [p.id, p]));
  const lineInputs = params.items
    .map((it) => {
      const p = pMap.get(it.productId);
      if (!p) return null;
      const v = it.variantId ? vMap.get(it.variantId) : null;
      const rate = v?.sellingPriceOverride ?? p.sellingPrice ?? 0;
      return {
        qty: it.qty,
        rate,
        gstRate: resolveGstRate(
          { gstRate: p.gstRate },
          v ? { gstRate: v.gstRate } : null,
          taxCtx.defaultGstRate ?? 18
        ),
      };
    })
    .filter(Boolean) as { qty: number; rate: number; gstRate: number }[];
  const goodsDoc = computeDocumentTax({ items: lineInputs, transportCharge: 0, taxCtx });

  const standardFree = goods.subTotal >= FREE_SHIPPING_THRESHOLD;
  const standardFee = standardFree ? 0 : Math.round(standardRow.rate);
  const expressFee = Math.round((expressRow ?? standardRow).rate);

  const options: ShippingOption[] = [
    buildOption(
      "standard",
      standardRow.etaDays
        ? `Standard (${standardRow.etaDays} day${standardRow.etaDays === 1 ? "" : "s"})`
        : "Standard (3-5 days)",
      standardFee,
      goodsDoc,
      standardRow,
      standardFree
    ),
    buildOption(
      "express",
      expressRow?.etaDays
        ? `Express (${expressRow.etaDays} day${expressRow.etaDays === 1 ? "" : "s"})`
        : "Express (1-2 days)",
      expressFee,
      goodsDoc,
      expressRow ?? standardRow,
      false
    ),
  ];

  return {
    ok: true,
    quote: {
      pickupPincode,
      deliveryPincode,
      distanceKm,
      weightKg,
      subTotal: goods.subTotal,
      goodsTax: goods.goodsTax,
      cgstTotal: goods.cgstTotal,
      sgstTotal: goods.sgstTotal,
      igstTotal: goods.igstTotal,
      taxKind: goods.taxKind,
      roundOff: goods.roundOff,
      source,
      options,
    },
  };
}
export function shippingFeeForMethod(
  quote: ShippingQuote,
  method: DeliveryMethod
): number {
  const opt = quote.options.find((o) => o.id === method);
  return opt?.fee ?? quote.options[0]?.fee ?? 0;
}

export async function resolveOrderPincode(body: {
  pincode?: string;
  addressId?: string;
  customerId?: string;
}): Promise<string | null> {
  if (body.pincode) {
    const p = body.pincode.replace(/\D/g, "").slice(0, 6);
    if (/^[1-9]\d{5}$/.test(p)) return p;
  }
  if (body.addressId) {
    const addr = await db.customerAddress.findFirst({
      where: body.customerId
        ? { id: body.addressId, customerId: body.customerId }
        : { id: body.addressId },
      select: { pincode: true },
    });
    if (addr?.pincode) {
      const p = addr.pincode.replace(/\D/g, "").slice(0, 6);
      if (/^[1-9]\d{5}$/.test(p)) return p;
    }
  }
  return null;
}

export async function resolveOrderState(body: {
  state?: string;
  addressId?: string;
  customerId?: string;
}): Promise<string | null> {
  if (body.state?.trim()) return body.state.trim();
  if (body.addressId) {
    const addr = await db.customerAddress.findFirst({
      where: body.customerId
        ? { id: body.addressId, customerId: body.customerId }
        : { id: body.addressId },
      select: { state: true },
    });
    if (addr?.state?.trim()) return addr.state.trim();
  }
  return null;
}
