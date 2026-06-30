// Backend client for the storefront.

import { AUTH_TOKEN_KEY } from "@/lib/auth-storage";
import { getAnonId } from "@/lib/anon-id";

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const API_URL = RAW_API_URL ? RAW_API_URL.replace(/\/$/, "") : "";
const MOCK_TOKEN = (import.meta.env.VITE_MOCK_STOREFRONT_TOKEN as string | undefined) ?? "";

// Derive the API origin (scheme + host + port) so relative image paths like
// /uploads/products/I97.jpg can be turned into absolute URLs.
const getApiOrigin = (): string => {
  if (API_URL) {
    try { return new URL(API_URL).origin; } catch { /* fall through */ }
  }
  return typeof window !== "undefined" ? window.location.origin : "http://localhost:4000";
};
export const API_ORIGIN = getApiOrigin();

/** Resolved set of responsive image URLs for a product/category/concern. */
export interface ImageSet {
  thumb:    { webp: string; jpeg: string };
  medium:   { webp: string; jpeg: string };
  large:    { webp: string; jpeg: string };
  original: string;
}

/** Resolve /uploads/… paths for img src (same-origin or dev backend).
 *  Directory-based image sets (new pipeline, no extension) resolve to medium.jpg.
 *  Optionally appends ?v=<epoch> so updated images bust the SW cache
 *  immediately rather than waiting for expiration.
 */
export function resolveUploadUrl(
  url: string | null | undefined,
  updatedAt?: Date | string | number | null
): string | undefined {
  if (!url) return undefined;
  // Directory-based image set (no extension) → resolve to medium.jpg fallback
  const resolved = url.startsWith("/uploads") && !/\.\w{2,5}(\?.*)?$/.test(url)
    ? `${url}/medium.jpg`
    : url;
  const base = resolved.startsWith("/uploads")
    ? API_URL ? `${API_URL}${resolved}` : resolved
    : resolved;
  if (!updatedAt) return base;
  const epoch =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : typeof updatedAt === "string"
        ? new Date(updatedAt).getTime()
        : Number(updatedAt);
  if (!Number.isFinite(epoch)) return base;
  return `${base}?v=${epoch}`;
}

/**
 * Build a responsive ImageSet from a product's imageUrl.
 * Returns null when imageUrl is a legacy flat file or missing.
 * The v= query parameter is appended to every URL for cache-busting.
 */
export function resolveImageSet(
  imageUrl: string | null | undefined,
  imageUpdatedAt?: number | null
): ImageSet | null {
  if (!imageUrl) return null;
  // Directory-based path: no file extension before optional ?v=
  // Legacy flat file: ends with extension like .jpg .png .webp
  if (/\.\w{2,5}(\?.*)?$/.test(imageUrl)) return null;

  const base = API_URL ? `${API_URL}${imageUrl}` : imageUrl;
  const v = imageUpdatedAt ? `?v=${imageUpdatedAt}` : "";
  return {
    thumb:    { webp: `${base}/thumb.webp${v}`,  jpeg: `${base}/thumb.jpg${v}` },
    medium:   { webp: `${base}/medium.webp${v}`, jpeg: `${base}/medium.jpg${v}` },
    large:    { webp: `${base}/large.webp${v}`,  jpeg: `${base}/large.jpg${v}` },
    original: `${base}/original.jpg${v}`,
  };
}

const buildUrl = (path: string, query?: Record<string, string | number | undefined>): string => {
  const base =
    API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const url = new URL(`/v1${path}`, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
};

// =====================================================================
// Catalog types - mirror the backend shape exactly.
// =====================================================================

export interface CatalogVariant {
  id: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  grade: string | null;
  uom: string | null;
  packSize: number;
  /** True when this variant has stock > 0. Exact count is not exposed on the storefront. */
  inStock: boolean;
  price: number;
}

export interface StorefrontCategory {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  imageUrl: string | null;
  updatedAt?: string | null;
}

export interface StorefrontConcern {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  imageUrl: string | null;
}

export interface CatalogProduct {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  /** Display name; same as categoryName for search compatibility */
  category: string;
  uom: string;
  sellingPrice: number;
  /** True when the product has stock > 0. Exact count is not exposed on the storefront. */
  inStock: boolean;
  description: string | null;
  imageHint: string | null;
  imageUrl: string | null;
  imageUpdatedAt?: number | null;
  /** Featured on home page best-sellers grid when true. */
  bestSellerEnabled?: boolean;
  tags: string[];
  concernSlugs?: string[];
  concernNames?: string[];
  variants: CatalogVariant[];
}

export interface ProductDetail extends CatalogProduct {
  ingredients: string | null;
}

// =====================================================================
// Cart line / order types.
// =====================================================================

export interface CartLine {
  productId: string;
  productName: string;
  variantId: string | null;
  variantSize: string | null;
  variantLabel: string | null;
  barcode: string | null;
  qty: number;
  rate: number;
  available: number;
  packagingHint: "craft-bag" | "bottle-oil" | "soap-pack" | "combo-bags";
}

export interface PlaceOrderInput {
  name: string;
  email?: string;
  phone: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  addressId?: string;
  notes?: string;
  deliveryMethod?: "standard" | "express";
  shippingFee?: number;
  items: { productId: string; variantId: string | null; qty: number }[];
}

export interface ShippingQuoteOption {
  id: "standard" | "express";
  label: string;
  fee: number;
  transportTax: number;
  payableTotal: number;
  etaDays: number | null;
  courierName: string | null;
  mode: string;
  freeShippingApplied: boolean;
}

export interface ShippingQuoteResult {
  pickupPincode: string;
  deliveryPincode: string;
  distanceKm?: number | null;
  weightKg: number;
  subTotal: number;
  goodsTax: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  taxKind?: "intra" | "inter";
  source: "shiprocket" | "fallback";
  options: ShippingQuoteOption[];
}

export interface StorefrontCustomer {
  id: string;
  accountId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  name: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string | null;
  pincode: string;
  /** Km from dispatch location — saved when address is created/updated. */
  distanceKm?: number | null;
  dispatchPincode?: string | null;
  isDefault: boolean;
}

export interface OtpSendResult {
  ok: boolean;
  expiresInSec: number;
  resendInSec?: number;
  attemptsLeft?: number;
  devOtp?: string;
}

export interface OtpVerifyResult {
  token: string;
  customer: StorefrontCustomer;
  addresses: CustomerAddress[];
  recentOrders: CustomerOrderRow[];
}

/** @deprecated Use initRazorpayOrder + confirmRazorpayOrder instead. */
export interface PlaceOrderResult {
  customer: { id: string; code: string; name: string };
  customerAccount: { id: string; email: string | null; phone?: string | null };
  salesOrder: {
    id: string;
    soNo: string;
    status: string;
    total: number;
    shareToken: string | null;
  };
  invoice: {
    id: string;
    invoiceNo: string;
    amount: number;
    status: string;
    shareToken: string | null;
  };
  pickList:
    | { id: string; pickListNo: string }
    | { error: { code: string; message: string } };
}

export interface CustomerOrderItem {
  productId: string;
  productName: string;
  variantId: string | null;
  variantSize: string | null;
  barcode: string | null;
  qty: number;
  rate: number;
  amount: number;
}

export interface CustomerOrderRow {
  id: string;
  soNo: string;
  status: string;
  total: number;
  createdAt: string;
  invoiceNo: string | null;
  invoiceStatus: string | null;
  packingSlip: {
    packingSlipNo: string;
    status: string;
    awb: string | null;
    carrier: string | null;
    trackingUrl: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  } | null;
  itemCount: number;
  items: CustomerOrderItem[];
}

export interface RazorpayInitResult {
  gateway?: "razorpay";
  intentId: string;
  razorpayOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  totals: {
    subTotal: number;
    tax: number;
    transportTax: number;
    shippingFee: number;
    total: number;
  };
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
}

export interface PayuInitResult {
  gateway: "payu";
  intentId: string;
  checkoutUrl: string;
  fields: Record<string, string>;
  totals: RazorpayInitResult["totals"];
  prefill: RazorpayInitResult["prefill"];
}

export type CheckoutInitResult = RazorpayInitResult | PayuInitResult;

export type StorefrontPaymentGateway = "razorpay" | "payu";

export interface RazorpayConfirmInput {
  intentId: string;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type RazorpayConfirmResult = PlaceOrderResult;

// =====================================================================
// Error wrapper - all API helpers throw ApiError, so callers can do
// `if (e instanceof ApiError)` to introspect status / details.
// =====================================================================

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const getAuthHeaders = (): Record<string, string> => {
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value : []);

const fetchJson = async <T,>(
  url: string,
  init?: RequestInit
): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-pv-anon-id": getAnonId(),
      ...getAuthHeaders(),
      ...(MOCK_TOKEN ? { "x-mock-token": MOCK_TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = body as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(
      res.status,
      err?.error?.message ?? `Request failed (${res.status})`,
      err?.error
    );
  }
  return body as T;
};

// =====================================================================
// Public api.
// =====================================================================

const mapCatalogProduct = (p: CatalogProduct): CatalogProduct => ({
  ...p,
  imageUrl: resolveUploadUrl(p.imageUrl, p.imageUpdatedAt) ?? null,
});

export const api = {
  categories: async () => {
    const list = asArray<StorefrontCategory>(
      await fetchJson<StorefrontCategory[]>(buildUrl("/storefront-mock/categories"))
    );
    return list.map((c) => ({
      ...c,
      imageUrl: resolveUploadUrl(c.imageUrl, c.updatedAt) ?? null,
    }));
  },
  concerns: async () => {
    const list = asArray<StorefrontConcern>(
      await fetchJson<StorefrontConcern[]>(buildUrl("/storefront-mock/concerns"))
    );
    return list.map((c) => ({
      ...c,
      imageUrl: resolveUploadUrl(c.imageUrl) ?? null,
    }));
  },
  catalog: async () => {
    const list = await fetchJson<CatalogProduct[]>(buildUrl("/storefront-mock/catalog"));
    return list.map(mapCatalogProduct);
  },
  product: async (id: string) => {
    const p = await fetchJson<ProductDetail>(
      buildUrl(`/storefront-mock/products/${encodeURIComponent(id)}`)
    );
    return mapCatalogProduct(p) as ProductDetail;
  },
  shippingQuote: (input: {
    pincode: string;
    state?: string;
    addressId?: string;
    subTotal: number;
    items: { productId: string; variantId: string | null; qty: number }[];
  }) =>
    fetchJson<ShippingQuoteResult>(buildUrl("/storefront-mock/shipping/quote"), {
      method: "POST",
      body: JSON.stringify(input),
    }).then((quote) => ({
      ...quote,
      options: asArray<ShippingQuoteOption>(quote?.options),
    })),
  activePaymentGateways: async () => {
    const res = await fetchJson<{ active?: unknown }>(
      buildUrl("/storefront-mock/payment/gateways")
    );
    const active = asArray<StorefrontPaymentGateway>(res?.active).filter(
      (g): g is StorefrontPaymentGateway => g === "payu" || g === "razorpay"
    );
    return { active };
  },
  initCheckoutOrder: (input: PlaceOrderInput & { gateway?: StorefrontPaymentGateway }) =>
    fetchJson<CheckoutInitResult>(buildUrl("/storefront-mock/order/init"), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  initRazorpayOrder: (input: PlaceOrderInput) =>
    fetchJson<RazorpayInitResult>(buildUrl("/storefront-mock/order/init"), {
      method: "POST",
      body: JSON.stringify({ ...input, gateway: "razorpay" }),
    }),
  confirmRazorpayOrder: (input: RazorpayConfirmInput) =>
    fetchJson<RazorpayConfirmResult>(buildUrl("/storefront-mock/order/confirm"), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** @deprecated Use initRazorpayOrder + confirmRazorpayOrder. */
  placeOrder: (input: PlaceOrderInput) =>
    fetchJson<PlaceOrderResult>(buildUrl("/storefront-mock/order"), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ordersByEmail: (email: string) =>
    fetchJson<CustomerOrderRow[]>(
      buildUrl("/storefront-mock/orders", { email })
    ),
  myOrders: () => fetchJson<CustomerOrderRow[]>(buildUrl("/storefront-mock/orders")),
  myOrder: (soNo: string) =>
    fetchJson<CustomerOrderRow>(buildUrl(`/storefront-mock/orders/${encodeURIComponent(soNo)}`)),
  lookupOrder: (input: { soNo: string; phone: string; code: string }) =>
    fetchJson<CustomerOrderRow>(buildUrl("/storefront-mock/orders/lookup"), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  sendOtp: (phone: string, purpose: "login" | "track" = "login") =>
    fetchJson<OtpSendResult>(buildUrl("/storefront-auth/otp/send"), {
      method: "POST",
      body: JSON.stringify({ phone, purpose }),
    }),
  verifyOtp: async (phone: string, code: string, name?: string, purpose: "login" | "track" = "login") => {
    const res = await fetchJson<OtpVerifyResult>(buildUrl("/storefront-auth/otp/verify"), {
      method: "POST",
      body: JSON.stringify({ phone, code, name, purpose }),
    });
    return {
      ...res,
      addresses: asArray<CustomerAddress>(res.addresses),
      recentOrders: asArray<CustomerOrderRow>(res.recentOrders),
    };
  },
  me: async () => {
    const res = await fetchJson<{ customer: StorefrontCustomer; addresses?: unknown }>(
      buildUrl("/storefront-auth/me")
    );
    return {
      customer: res.customer,
      addresses: asArray<CustomerAddress>(res.addresses),
    };
  },
  updateProfile: async (input: { name?: string; email?: string }) => {
    const res = await fetchJson<{ customer: StorefrontCustomer; addresses?: unknown }>(
      buildUrl("/storefront-auth/me"),
      { method: "PATCH", body: JSON.stringify(input) }
    );
    return {
      customer: res.customer,
      addresses: asArray<CustomerAddress>(res.addresses),
    };
  },
  logout: () =>
    fetchJson<{ ok: boolean }>(buildUrl("/storefront-auth/logout"), { method: "POST" }),
  listAddresses: async () =>
    asArray<CustomerAddress>(
      await fetchJson<CustomerAddress[]>(buildUrl("/storefront-auth/addresses"))
    ),
  createAddress: (input: Omit<CustomerAddress, "id" | "isDefault"> & { isDefault?: boolean }) =>
    fetchJson<CustomerAddress>(buildUrl("/storefront-auth/addresses"), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAddress: (id: string, input: Partial<Omit<CustomerAddress, "id">>) =>
    fetchJson<CustomerAddress>(buildUrl(`/storefront-auth/addresses/${id}`), {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteAddress: (id: string) =>
    fetchJson<{ ok: boolean }>(buildUrl(`/storefront-auth/addresses/${id}`), {
      method: "DELETE",
    }),
  setDefaultAddress: (id: string) =>
    fetchJson<{ ok: boolean }>(buildUrl(`/storefront-auth/addresses/${id}/default`), {
      method: "POST",
    }),
  submitEnquiry: (input: EnquiryFormInput) =>
    fetchJson<{ ok: boolean; enquiryNo: string }>(
      buildUrl("/storefront-mock/enquiries"),
      { method: "POST", body: JSON.stringify(input) }
    ),
  trackActivity: (input: {
    event: string;
    path?: string;
    productId?: string;
    sessionId?: string;
    meta?: Record<string, unknown>;
  }) =>
    fetchJson<void>(buildUrl("/storefront-mock/activity"), {
      method: "POST",
      body: JSON.stringify(input),
    }).catch(() => { /* fire and forget — never throw */ }),
};

export interface EnquiryFormInput {
  type: "product" | "dealership" | "farm_visit" | "other";
  contactName: string;
  phone?: string;
  email?: string;
  company?: string;
  city?: string;
  subject: string;
  requirement?: string;
}
