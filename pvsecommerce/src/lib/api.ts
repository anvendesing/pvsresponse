// Backend client for the storefront. We only consume two NovaERP
// endpoints right now:
//   GET  /v1/storefront-mock/catalog       (public)
//   POST /v1/storefront-mock/order         (public; gated by mock-token if set)
//   GET  /v1/storefront-mock/orders?email= (public; new helper for the
//                                            customer dashboard - returns
//                                            this customer's order history)
//
// Auth is intentionally fake during the demo so the storefront can be
// browsed end-to-end without standing up a real signup/login flow.
// The dummy "session" lives in localStorage; all order-history reads
// just send the email along.

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const API_URL = RAW_API_URL ? RAW_API_URL.replace(/\/$/, "") : "";
const MOCK_TOKEN = (import.meta.env.VITE_MOCK_STOREFRONT_TOKEN as string | undefined) ?? "";

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
  size: string | null;
  color: string | null;
  grade: string | null;
  uom: string | null;
  packSize: number;
  stockOnHand: number;
  price: number;
}

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  uom: string;
  sellingPrice: number;
  stockOnHand: number;
  description: string | null;
  imageHint: string | null;
  tags: string[];
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
  productSku: string;
  productName: string;
  variantId: string | null;
  variantSku: string | null;
  variantSize: string | null;
  qty: number;
  rate: number;
  available: number;
  packagingHint: "craft-bag" | "bottle-oil" | "soap-pack" | "combo-bags";
}

export interface PlaceOrderInput {
  name: string;
  email: string;
  phone: string;
  city?: string;
  notes?: string;
  items: { productId: string; variantId: string | null; qty: number }[];
}

export interface PlaceOrderResult {
  customer: { id: string; code: string; name: string };
  customerAccount: { id: string; email: string };
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
}

// =====================================================================
// Error wrapper - all API helpers throw ApiError, so callers can do
// `if (e instanceof ApiError)` to introspect status / details.
// =====================================================================

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const fetchJson = async <T,>(
  url: string,
  init?: RequestInit
): Promise<T> => {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
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

export const api = {
  catalog: () => fetchJson<CatalogProduct[]>(buildUrl("/storefront-mock/catalog")),
  product: (id: string) =>
    fetchJson<ProductDetail>(buildUrl(`/storefront-mock/products/${encodeURIComponent(id)}`)),
  placeOrder: (input: PlaceOrderInput) =>
    fetchJson<PlaceOrderResult>(buildUrl("/storefront-mock/order"), {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ordersByEmail: (email: string) =>
    fetchJson<CustomerOrderRow[]>(
      buildUrl("/storefront-mock/orders", { email })
    ),
};
