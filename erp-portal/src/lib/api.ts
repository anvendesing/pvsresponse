// Live API client for NovaERP backend.
//
// `VITE_API_URL` may be:
//   - A full origin (e.g. http://localhost:4000) when the backend runs
//     on a different host/port than the SPA. Used in dev.
//   - Empty / unset when the SPA is served by the same reverse proxy
//     (nginx) that forwards /v1 to the backend. The IP-only VPS
//     deployment uses this mode so a single docker image works on any
//     IP without a rebuild.
//
// All pages load data exclusively from this API - the portal does not
// fall back to bundled mock data anymore.

const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const API_URL = RAW_API_URL ? RAW_API_URL.replace(/\/$/, "") : "";

// In a browser, an empty API_URL means "talk to the same origin that
// served this page" - the reverse proxy will route /v1/* and /health
// to the backend. apiEnabled is therefore always true at runtime.
// During SSR / unit tests there is no `window`, so we still gate.
export const apiEnabled =
  typeof window !== "undefined" || !!API_URL;

const TOKEN_KEY = "nova.token";
const USER_KEY = "nova.user";

export interface ApiUser {
  id: string;
  username: string;
  name: string;
  role: string;
  email?: string | null;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  user: (): ApiUser | null => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as ApiUser) : null;
  },
  set: (token: string, user: ApiUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

interface Options {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const buildUrl = (path: string, query?: Options["query"]) => {
  // When VITE_API_URL is an absolute URL we hit it directly. When
  // it's empty (same-origin deployment) we resolve against the
  // current page origin so the URL ends up as /v1/<path>.
  const base =
    API_URL ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const url = new URL(`/v1${path}`, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
};

const fetcher = async <T>(path: string, opts: Options = {}): Promise<T> => {
  if (!apiEnabled) throw new ApiError(0, "API disabled");
  // Only declare a JSON content-type when we actually send a body. Fastify
  // (correctly per HTTP) rejects requests that have `Content-Type: application/json`
  // with an empty body - which used to break DELETEs and bodyless POSTs.
  const hasBody = opts.body !== undefined && opts.body !== null;
  const headers: Record<string, string> = {};
  if (hasBody) headers["content-type"] = "application/json";
  const token = auth.token();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      auth.clear();
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        // Mobile app stays on the mobile sign-in route; desktop users
        // bounce to /login. Avoid a redirect loop if we're already
        // on the right place.
        if (path.startsWith("/m") && path !== "/m/login") {
          window.location.assign("/m/login");
        } else if (!path.startsWith("/m") && !path.endsWith("/login")) {
          window.location.assign("/login");
        }
      }
    }
    throw new ApiError(
      res.status,
      body?.error?.message ?? `${res.status} ${res.statusText}`,
      body?.error
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

// Anonymous fetcher used by the public share-link viewer.
// - Does NOT attach the bearer token (the page is meant to be opened by
//   customers who don't have a NovaERP login).
// - Does NOT redirect to /login on errors.
const publicFetcher = async <T>(path: string): Promise<T> => {
  if (!apiEnabled) throw new ApiError(0, "API disabled");
  // GETs with an empty body should not declare a JSON content-type; Fastify
  // 500's on `Content-Type: application/json` + empty body. We accept the
  // server's response as JSON regardless.
  const res = await fetch(buildUrl(path), { method: "GET" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body?.error?.message ?? `${res.status} ${res.statusText}`,
      body?.error
    );
  }
  return (await res.json()) as T;
};

// =====================================================================
// Adapters: normalize API responses to the same shapes the pages expect
// (the page components were originally written against `mockData.ts`).
// =====================================================================

import type {
  Bin,
  Bom,
  DispatchOrder,
  Invoice,
  Product,
  ProductVariant,
  ProductionOrder,
  PurchaseOrder,
  StockLedgerEntry,
  Uom,
  UomCategory,
  Vendor,
  WorkOrder,
  Worker,
} from "@/data/types";

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  gst?: string | null;
  contact?: string | null;
  creditLimit?: number;
  openBalance?: number;      // net unpaid AR (invoice amount − payments)
  availableCredit?: number | null; // creditLimit − openBalance (null if cash-only)
  priceListId?: string | null;
  priceList?: {
    id: string;
    code: string;
    name: string;
    multiplier?: number;
    basis?: string;
  } | null;
  active?: boolean;
  // Populated by /customers and /customers/:id so the UI can show
  // transaction counts and disable hard-delete when history exists.
  _count?: { quotes: number; salesOrders: number; invoices: number };
}

export type PaymentMode = "cash" | "upi" | "bank_transfer" | "cheque" | "credit_note";

export interface CustomerPaymentAllocation {
  invoiceId: string;
  amount: number;
  invoice?: { id: string; invoiceNo: string; amount: number };
}

export interface CustomerPayment {
  id: string;
  paymentNo: string;
  customerId: string;
  amount: number;
  mode: PaymentMode;
  reference?: string | null;
  notes?: string | null;
  paymentDate: string;
  createdAt: string;
  customer?: { id: string; code: string; name: string };
  allocations: CustomerPaymentAllocation[];
}

export interface CustomerPaymentInput {
  customerId: string;
  amount: number;
  mode: PaymentMode;
  reference?: string | null;
  notes?: string | null;
  paymentDate?: string;
  allocations?: { invoiceId: string; amount: number }[];
}

export interface OpenInvoice {
  id: string;
  invoiceNo: string;
  date: string;
  amount: number;
  paidAmount: number;
  openAmount: number;
  status: string;
  soNo?: string | null;
}

export interface StatementEntry {
  date: string;
  type: "invoice" | "payment";
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  status?: string;
}

export interface CustomerStatement {
  customer: CustomerRow & { openBalance: number; availableCredit: number | null };
  entries: StatementEntry[];
}

export interface CustomerInput {
  code?: string;
  name: string;
  gst?: string | null;
  city?: string | null;
  contact?: string | null;
  creditLimit?: number;
  priceListId?: string | null;
  active?: boolean;
}

// Warehouse / plant master record. binCount + ledgerCount are computed by
// the backend so the UI can show stock-pressure context and warn before
// deactivating a warehouse that still has inventory.
export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city: string;
  active: boolean;
  binCount: number;
  ledgerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseInput {
  code?: string;
  name?: string;
  city?: string;
  active?: boolean;
}

// =====================================================================
// Pricing
// =====================================================================

export type PriceBasis = "selling" | "cost";

export type PriceOrigin =
  | "list_override_tier"
  | "list_override"
  | "list_formula"
  | "variant_override"
  | "product_default";

export interface PriceListRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  currency: string;
  basis: PriceBasis;
  multiplier: number;
  active: boolean;
  isDefault: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number; customers: number };
  items?: PriceListItemRow[];
  customers?: { id: string; code: string; name: string }[];
}

export interface PriceListItemRow {
  id: string;
  priceListId: string;
  productId: string;
  variantId?: string | null;
  price: number;
  minQty: number;
  notes?: string | null;
  product?: {
    id: string;
    sku: string;
    name: string;
    sellingPrice: number;
    costPrice?: number;
    uom?: string;
  };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
  } | null;
}

export interface ResolvedPrice {
  price: number;
  origin: PriceOrigin;
  priceListCode?: string;
  minQty?: number;
  multiplier?: number;
  basisPrice?: number;
}

interface Raw {
  [key: string]: unknown;
}

// Adapter for /v1/warehouses/:id/bins payloads.
// Prefer the human-readable `warehouseCode` (e.g. "WH-MAIN") that the
// caller injects when iterating warehouses; fall back to the raw cuid only
// if the code wasn't supplied. The `warehouseName` is used by the UI tree
// label so users see "Main Warehouse · WH-MAIN" instead of a cuid.
const adaptBin = (r: Raw): Bin => ({
  id: r.id as string,
  warehouse:
    (r.warehouseCode as string) ??
    (r.warehouse as string) ??
    (r.warehouseId as string),
  warehouseName: (r.warehouseName as string) ?? undefined,
  zone: r.zone as string,
  rack: r.rack as string,
  shelf: r.shelf as string,
  bin: r.bin as string,
  capacity: r.capacity as number,
  occupied: r.occupied as number,
  qty: r.qty as number,
  batch: (r.batch as string) ?? undefined,
  productSku: ((r.product as Raw | null)?.sku as string) ?? undefined,
  productName: ((r.product as Raw | null)?.name as string) ?? undefined,
});

const adaptVendor = (r: Raw): Vendor => ({
  id: r.id as string,
  code: (r.code as string) ?? "",
  name: r.name as string,
  gst: (r.gst as string) ?? "",
  contact: (r.contact as string) ?? "",
  email: (r.email as string | null) ?? null,
  address: (r.address as string | null) ?? null,
  paymentTerms: (r.paymentTerms as string | null) ?? null,
  rating: (r.rating as number) ?? 0,
  leadTimeDays: (r.leadTimeDays as number) ?? 7,
  city: (r.city as string) ?? "",
  active: (r.active as boolean) ?? true,
  outstandingPO: (r.outstandingPO as number) ?? 0,
  totalSpend: (r.totalSpend as number) ?? 0,
});

const adaptPo = (r: Raw): PurchaseOrder => {
  const v = r.vendor as Raw | null;
  return {
    id: r.id as string,
    poNo: r.poNo as string,
    vendor: (v?.name as string) ?? "",
    vendorId: r.vendorId as string,
    vendorContact: (v?.contact as string | null) ?? null,
    vendorEmail: (v?.email as string | null) ?? null,
    date: r.date as string,
    expectedDate: r.expectedDate as string,
    status: r.status as PurchaseOrder["status"],
    amount: r.amount as number,
    itemCount: ((r.items as unknown[]) ?? []).length,
    receivedPct: r.receivedPct as number,
    shareToken: (r.shareToken as string | null) ?? null,
  };
};

const adaptProductionOrder = (r: Raw): ProductionOrder => {
  const bom = r.bom as Raw | null;
  const product = (bom?.product as Raw | null) ?? null;
  return {
    id: r.id as string,
    orderNo: r.orderNo as string,
    product: (product?.name as string) ?? "—",
    sku: (product?.sku as string) ?? "",
    plannedQty: r.plannedQty as number,
    actualQty: r.actualQty as number,
    scrapQty: r.scrapQty as number,
    reworkQty: r.reworkQty as number,
    status: r.status as ProductionOrder["status"],
    station: r.station as string,
    startDate: r.startDate as string,
    dueDate: r.dueDate as string,
    efficiency: r.efficiency as number,
  };
};

const adaptWorkOrder = (r: Raw): WorkOrder => ({
  id: r.id as string,
  workOrderNo: r.workOrderNo as string,
  productionOrderId: r.productionOrderId as string,
  station: r.station as string,
  workers: typeof r.workers === "string" ? (r.workers as string).split(",").map((w) => w.trim()) : [],
  machine: r.machine as string,
  startTime: (r.startTime as string) ?? "",
  endTime: (r.endTime as string) ?? undefined,
  output: r.output as number,
  target: r.target as number,
  status: r.status as WorkOrder["status"],
});

const adaptInvoice = (r: Raw): Invoice => ({
  id: r.id as string,
  invoiceNo: r.invoiceNo as string,
  customer: ((r.customer as Raw | null)?.name as string) ?? "",
  customerId: ((r.customer as Raw | null)?.id as string) ?? (r.customerId as string),
  customerContact: ((r.customer as Raw | null)?.contact as string) ?? null,
  shareToken: (r.shareToken as string | null) ?? null,
  date: r.date as string,
  amount: r.amount as number,
  tax: r.tax as number,
  status: r.status as Invoice["status"],
  paymentMode: r.paymentMode as Invoice["paymentMode"],
  itemCount: ((r.items as unknown[]) ?? []).length,
});

const adaptDispatch = (r: Raw): DispatchOrder => {
  const inv = r.invoice as Raw | null;
  const trip = r.trip as Raw | null;
  // Vehicle/driver fall through: per-dispatch override -> trip values
  // -> em-dash (no value at all). Trip-attached dispatches usually
  // leave the dispatch columns null and inherit from the trip.
  const vehicle =
    (r.vehicle as string | null) ??
    (trip?.vehicle as string | null) ??
    "";
  const driver =
    (r.driver as string | null) ??
    (trip?.driver as string | null) ??
    "";
  return {
    id: r.id as string,
    dispatchNo: r.dispatchNo as string,
    invoice: (inv?.invoiceNo as string) ?? "",
    invoiceId: (r.invoiceId as string) ?? (inv?.id as string),
    vehicle,
    driver,
    destination: (r.destination as string | null) ?? "",
    status: r.status as DispatchOrder["status"],
    etaHours: r.etaHours as number,
    weightKg: r.weightKg as number,
    customer: ((inv?.customer as Raw | null)?.name as string) ?? undefined,
    createdAt: r.createdAt as string | undefined,
  };
};

const adaptLedger = (r: Raw): StockLedgerEntry => ({
  id: r.id as string,
  date: r.date as string,
  product: ((r.product as Raw | null)?.name as string) ?? "",
  sku: ((r.product as Raw | null)?.sku as string) ?? "",
  txnType: r.txnType as StockLedgerEntry["txnType"],
  ref: r.ref as string,
  qty: r.qty as number,
  warehouse: ((r.warehouse as Raw | null)?.code as string) ?? "",
  bin: (r.bin as string) ?? undefined,
  balance: r.balance as number,
});

// ---- Multi-level BOM types ---------------------------------------
// Mirrors backend/src/lib/bom.ts. Nested children form the tree;
// `cycle: true` means a loop was detected and the walk stopped there.
export interface BomTreeNode {
  productId: string;
  sku: string;
  name: string;
  // Stock UoM of the product at this node (e.g. "kg" for bulk almonds).
  uom: string;
  type: string;
  qty: number;
  // BOM-line authored qty + UoM (e.g. "100 g") before conversion to
  // the stock UoM. Useful for showing "100 g (= 0.1 kg consumed)".
  bomQty?: number;
  bomUom?: string;
  // Set on the ROOT node only when the BOM is variant-scoped. Allows
  // the UI to show the variant code + label so the user can tell the
  // produced variant apart from the consumed parent product, which
  // share the same productId in a packaging BOM.
  variantId?: string | null;
  variantSku?: string;
  variantLabel?: string;
  scrapPct: number;
  bomId: string | null;
  effectiveQty: number;
  cycle?: boolean;
  children: BomTreeNode[];
}

export interface BomLeafRow {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  qty: number;
  path: string[];
}

export interface WhereUsedRow {
  bomId: string;
  parentProductId: string;
  parentSku: string;
  parentName: string;
  qtyPer: number;
  scrapPct: number;
}

// Requirements for a production order: explosion + on-hand totals so
// the UI can render a shortage badge.
export interface MoRequirements {
  productionOrderId: string;
  plannedFor: number;
  anyShortage: boolean;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    uom: string;
    path: string[];
    required: number;
    onHand: number;
    free: number;
    shortage: number;
  }>;
}

const adaptBom = (r: Raw): Bom => {
  const product = r.product as Raw | null;
  const variant = r.variant as Raw | null;
  return {
    id: r.id as string,
    product: (product?.name as string) ?? "",
    productId: (r.productId as string) ?? (product?.id as string),
    sku: (product?.sku as string) ?? "",
    variantId: (r.variantId as string | null) ?? (variant?.id as string) ?? null,
    variantSku: (variant?.sku as string) ?? null,
    variantLabel:
      (variant?.size as string) ?? (variant?.sku as string) ?? null,
    revision: r.revision as string,
    outputQty: r.outputQty as number,
    active: r.active as boolean,
    items: ((r.items as Raw[]) ?? []).map((item) => {
      const ip = item.product as Raw | null;
      const hasSubAssembly = (ip?.type as string) === "semi";
      return {
        id: item.id as string,
        productId: (item.productId as string) ?? (ip?.id as string),
        sku: (ip?.sku as string) ?? "",
        name: (ip?.name as string) ?? "",
        qty: item.qty as number,
        uom: item.uom as string,
        scrapPct: item.scrapPct as number,
        hasSubAssembly,
      };
    }),
  };
};

// Returned by GET /v1/products/:id/variants-with-boms - powers the
// "configure each variant" UX in the BOM editor.
export interface VariantsWithBomsRow {
  product: { id: string; sku: string; name: string; uom: string };
  productLevelBom: {
    id: string;
    revision: string;
    componentCount: number;
  } | null;
  variants: Array<{
    id: string;
    sku: string;
    label: string;
    size: string | null;
    color: string | null;
    activeBom: {
      id: string;
      revision: string;
      componentCount: number;
    } | null;
    inheritsFromProductLevel: boolean;
  }>;
}

export interface ApprovalRow {
  id: string;
  ref: string;
  type: string;
  requestedBy: string;
  amount: number;
  priority: "low" | "med" | "high";
  status: "pending" | "approved" | "rejected";
  reason: string;
  createdAt: string;
}

// =====================================================================
// Sales (Quotes / SalesOrders / ATP)
// =====================================================================

export type QuoteStatus =
  | "draft"
  | "submitted"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted";

export type SalesOrderStatus =
  | "confirmed"
  | "partially_invoiced"
  | "invoiced"
  | "closed"
  | "cancelled"
  | "on_hold";

export interface QuoteItemRow {
  id?: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  rate: number;
  discount: number;
  amount: number;
  requiredBy?: string | null;
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    stockOnHand: number;
  } | null;
}

export interface QuoteRevisionRow {
  id: string;
  quoteId: string;
  revision: number;
  reason: string;
  changedBy: string;
  changedByUser?: { id: string; username: string; name: string } | null;
  changedAt: string;
  snapshot: string;
}

// Sanitized payload returned by GET /v1/public/quotes/:token. Designed to be
// safe to render to anyone who has the share link.
export interface PublicQuotePayload {
  quoteNo: string;
  revision: number;
  status: string;
  validUntil: string;
  paymentTerms?: string | null;
  notes?: string | null;
  subTotal: number;
  tax: number;
  total: number;
  createdAt: string;
  customer: {
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
  };
  items: {
    productName: string;
    productSku: string;
    hsn?: string | null;
    uom?: string | null;
    variantSku?: string | null;
    variantAttrs: string;
    qty: number;
    rate: number;
    discount: number;
    amount: number;
    requiredBy?: string | null;
  }[];
}

interface PublicLineItem {
  productName: string;
  productSku: string;
  hsn?: string | null;
  uom?: string | null;
  variantSku?: string | null;
  variantAttrs: string;
  rate: number;
  amount: number;
}

// Full invoice detail returned by GET /v1/invoices/:id (authenticated).
// Used by the InvoiceDetail drawer in the portal so we can show
// everything in one round-trip including dispatches issued against it.
export interface InvoiceItemDetail {
  id: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  rate: number;
  amount: number;
  product: { id: string; sku: string; name: string; uom: string; hsn?: string | null };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
  } | null;
}

export interface InvoiceDispatchSummary {
  id: string;
  dispatchNo: string;
  vehicle?: string | null;
  driver?: string | null;
  destination?: string | null;
  status: "planned" | "loading" | "in-transit" | "delivered" | "delayed";
  etaHours: number;
  weightKg: number;
  otpVerified: boolean;
  signedAt?: string | null;
  createdAt: string;
  tripId?: string | null;
  // Inlined trip card so the UI can show "On TRP-... · 2026-05-19 · KA-01-AB-1234"
  trip?: {
    id: string;
    tripNo: string;
    scheduledDate: string;
    vehicle: string;
    driver: string;
    route?: string | null;
    status: "scheduled" | "in_transit" | "completed" | "cancelled";
  } | null;
}

export interface InvoiceDetail {
  id: string;
  invoiceNo: string;
  shareToken?: string | null;
  customerId: string;
  customer: {
    id: string;
    code: string;
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
  };
  salesOrderId?: string | null;
  salesOrder?: {
    id: string;
    soNo: string;
    status: string;
    // "internal" (back-office / quote-to-SO) vs "ecommerce" (storefront
    // mock prepaid checkout). Drives the dispatch-vs-courier UI split
    // on the invoice detail screen.
    source?: string;
  } | null;
  packingSlipId?: string | null;
  packingSlip?: {
    id: string;
    packingSlipNo: string;
    status: string;
    // Mock courier tracking stamped at pack-complete for ecommerce SOs
    // or via the /packing-slips/:id/assign-courier endpoint.
    awb?: string | null;
    carrier?: string | null;
    // Public tracking link rendered as the AWB hyperlink. Set when
    // the operator picks a courier from the static catalogue (the
    // server fills in the courier-specific URL template).
    trackingUrl?: string | null;
    // Courier lifecycle timestamps. dispatchedAt = courier assigned;
    // deliveredAt = operator confirmed delivery.
    dispatchedAt?: string | null;
    deliveredAt?: string | null;
  } | null;
  date: string;
  amount: number;
  tax: number;
  status: "draft" | "issued" | "paid" | "partial" | "overdue";
  paymentMode: "cash" | "card" | "upi" | "credit" | "split";
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItemDetail[];
  dispatches: InvoiceDispatchSummary[];
}

// Sanitized payload for GET /v1/public/invoices/:token.
export interface PublicInvoicePayload {
  invoiceNo: string;
  status: string;
  date: string;
  paymentMode: string;
  notes?: string | null;
  tax: number;
  amount: number;
  createdAt: string;
  customer: {
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
  };
  salesOrderNo?: string | null;
  packingSlipNo?: string | null;
  items: (PublicLineItem & { qty: number })[];
}

// Sanitized payload for GET /v1/public/sales-orders/:token.
export interface PublicSalesOrderPayload {
  soNo: string;
  status: string;
  orderDate: string;
  notes?: string | null;
  subTotal: number;
  tax: number;
  total: number;
  createdAt: string;
  quoteNo?: string | null;
  customer: {
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
  };
  items: (PublicLineItem & {
    qtyOrdered: number;
    qtyInvoiced: number;
    qtyCancelled: number;
  })[];
}

// Sanitized payload for GET /v1/public/packing-slips/:token.
export interface PublicPackingSlipPayload {
  packingSlipNo: string;
  status: string;
  packedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  soNo: string;
  invoiceNo?: string | null;
  customer: {
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
  };
  items: (PublicLineItem & {
    qtyOrdered: number;
    qtyPicked: number;
    qtyPacked: number;
  })[];
}

// Sanitized payload for GET /v1/public/purchase-orders/:token. The
// receiver here is the *vendor* (not a customer); we still call the
// recipient block "customer" in the shell to avoid forking it.
export interface PublicPurchaseOrderPayload {
  poNo: string;
  status: string;
  date: string;
  expectedDate: string;
  amount: number;
  receivedPct: number;
  notes?: string | null;
  createdAt: string;
  vendor: {
    name: string;
    code?: string | null;
    gst?: string | null;
    city?: string | null;
    address?: string | null;
    contact?: string | null;
    email?: string | null;
    paymentTerms?: string | null;
  };
  items: Array<{
    productName: string;
    productSku: string;
    hsn?: string | null;
    uom?: string | null;
    qty: number;
    rate: number;
    amount: number;
  }>;
}

// =====================================================================
// Logistics: Trips
// =====================================================================
export type TripStatus = "scheduled" | "in_transit" | "completed" | "cancelled";

export interface TripDispatch {
  id: string;
  dispatchNo: string;
  status: "planned" | "loading" | "in-transit" | "delivered" | "delayed";
  destination?: string | null;
  weightKg: number;
  etaHours: number;
  invoice: {
    id: string;
    invoiceNo: string;
    amount: number;
    status: string;
    customer: {
      id: string;
      name: string;
      code: string;
      city?: string | null;
      contact?: string | null;
    };
  };
}

export interface TripRow {
  id: string;
  tripNo: string;
  scheduledDate: string;
  vehicle: string;
  driver: string;
  route?: string | null;
  status: TripStatus;
  capacityKg: number;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  rolledOverFromId?: string | null;
  createdAt: string;
  updatedAt: string;
  dispatches: TripDispatch[];
}

export interface UnassignedDispatch {
  id: string;
  dispatchNo: string;
  destination?: string | null;
  weightKg: number;
  etaHours: number;
  status: "planned" | "loading" | "in-transit" | "delivered" | "delayed";
  invoice: {
    id: string;
    invoiceNo: string;
    amount: number;
    customer: { name: string; city?: string | null };
  };
}

export interface QuoteRow {
  id: string;
  quoteNo: string;
  revision: number;
  shareToken?: string | null;
  customerId: string;
  status: QuoteStatus;
  validUntil: string;
  subTotal: number;
  tax: number;
  total: number;
  paymentTerms?: string | null;
  notes?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  convertedSalesOrderId?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    code: string;
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
    creditLimit: number;
  };
  items: QuoteItemRow[];
  revisions?: QuoteRevisionRow[];
  _count?: { items: number; revisions: number };
  // Surfaced when status='accepted' but the SO is parked behind a credit-limit
  // approval. Allows the UI to explain the hold and deep-link to Approvals.
  pendingApproval?: {
    id: string;
    status: string;
    amount: number;
    reason: string;
    requestedBy: string;
    createdAt: string;
  } | null;
}

export interface SalesOrderItemRow {
  id: string;
  productId: string;
  variantId?: string | null;
  qtyOrdered: number;
  qtyInvoiced: number;
  qtyCancelled: number;
  rate: number;
  amount: number;
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    stockOnHand: number;
  } | null;
}

export interface SalesOrderRow {
  id: string;
  soNo: string;
  shareToken?: string | null;
  quoteId?: string | null;
  customerId: string;
  status: SalesOrderStatus;
  // Where the order came from. "internal" = back-office or quote->SO,
  // "ecommerce" = storefront mock (prepaid checkout). Used by the
  // Sales Orders list to badge / filter ecommerce traffic.
  source?: string;
  orderDate: string;
  subTotal: number;
  tax: number;
  total: number;
  notes?: string | null;
  customer: {
    id: string;
    code: string;
    name: string;
    gst?: string | null;
    city?: string | null;
    contact?: string | null;
  };
  items: SalesOrderItemRow[];
  invoices?: {
    id: string;
    invoiceNo: string;
    date: string;
    amount: number;
    // 'issued' = pre-generated when the SO is confirmed but not yet
    // attached to a packing slip; 'paid' / 'invoiced' / 'cancelled'
    // are the post-action states. The desktop SO detail uses status
    // + packingSlipId together to decide whether the SO is still
    // cancellable (a plain pre-gen invoice with no slip is not
    // blocking).
    status: string;
    paymentMode: string;
    // Null while the invoice is still pre-generated paperwork.
    // Populated when the matching packing slip has been packed and
    // the invoice is now backed by physical fulfilment.
    packingSlipId?: string | null;
  }[];
  quote?: { id: string; quoteNo: string; revision: number } | null;
  _count?: { items: number; invoices: number };
}

export interface AtpResult {
  onHand: number;
  reservedForSO: number;
  binReserved: number;
  openProcurement: number;
  openProduction: number;
  atp: number;
}

// =====================================================================
// Fulfilment: Pick lists / Packing slips
// =====================================================================

export type PickListStatus = "draft" | "picking" | "picked" | "cancelled";
export type PackingSlipStatus = "open" | "packed" | "invoiced" | "cancelled";

export interface BinSummary {
  id: string;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  qty: number;
  reservedQty: number;
}

export interface PickListItemRow {
  id: string;
  pickListId: string;
  salesOrderItemId: string;
  productId: string;
  variantId?: string | null;
  binId?: string | null;
  qtyToPick: number;
  qtyPicked: number;
  notes?: string | null;
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    stockOnHand: number;
  } | null;
  bin?: BinSummary | null;
}

export interface PickListRow {
  id: string;
  pickListNo: string;
  salesOrderId: string;
  status: PickListStatus;
  notes?: string | null;
  createdById: string;
  // Self-claim assignment (mobile worker who picked up the task).
  // Null while the slip is still in the queue. Populated once any
  // worker calls /pick-lists/:id/claim or completes a scan against
  // the line. Carried forward to the auto-created PackingSlip.
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string; username: string } | null;
  claimedAt?: string | null;
  pickedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  salesOrder?: {
    id: string;
    soNo: string;
    status: string;
    customerId: string;
    customer?: { id: string; name: string; code: string; city?: string | null };
  };
  items: PickListItemRow[];
  _count?: { items: number };
}

export interface PackingSlipItemRow {
  id: string;
  packingSlipId: string;
  salesOrderItemId: string;
  productId: string;
  variantId?: string | null;
  qtyOrdered: number;
  qtyPicked: number;
  qtyPacked: number;
  rate: number;
  amount: number;
  notes?: string | null;
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    stockOnHand: number;
  } | null;
}

export interface PackingSlipRow {
  id: string;
  packingSlipNo: string;
  shareToken?: string | null;
  salesOrderId: string;
  pickListId?: string | null;
  status: PackingSlipStatus;
  notes?: string | null;
  createdById: string;
  // Auto-populated from PickList.assignedToId when the slip is
  // created at /pick-lists/:id/complete, so whoever picked the order
  // is the default packer. Workers can release + re-claim from the
  // mobile PWA if a different person handles packing.
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string; username: string } | null;
  claimedAt?: string | null;
  // Mock courier tracking number stamped at pack-complete for SOs
  // that originated from the storefront mock (source="ecommerce").
  awb?: string | null;
  carrier?: string | null;
  packedAt?: string | null;
  invoicedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  salesOrder?: {
    id: string;
    soNo: string;
    status: string;
    customerId: string;
    customer?: {
      id: string;
      name: string;
      code: string;
      city?: string | null;
      contact?: string | null;
    };
  };
  pickList?: { id: string; pickListNo: string; status: PickListStatus } | null;
  invoice?: {
    id: string;
    invoiceNo: string;
    amount: number;
    status: string;
    date: string;
  } | null;
  items: PackingSlipItemRow[];
  _count?: { items: number };
}

export interface AcceptQuoteResponse {
  // Either: an SO row (HTTP 200) when no credit hold,
  // or { creditHold: true, approvalId, quote, message } (HTTP 202).
  creditHold?: boolean;
  approvalId?: string;
  quote?: QuoteRow;
  message?: string;
  // SO fields (when materialised immediately)
  id?: string;
  soNo?: string;
  status?: SalesOrderStatus;
  total?: number;
  alreadyConverted?: boolean;
  salesOrder?: SalesOrderRow;
}

export interface QuoteCreatePayload {
  customerId: string;
  validUntil?: string;
  paymentTerms?: string | null;
  notes?: string | null;
  items: {
    productId: string;
    variantId?: string | null;
    qty: number;
    rate: number;
    discount?: number;
    requiredBy?: string | null;
  }[];
}

export interface QuoteUpdatePayload {
  customerId?: string;
  validUntil?: string;
  paymentTerms?: string | null;
  notes?: string | null;
  reason?: string;
  items?: QuoteCreatePayload["items"];
}

// Settings · Company profile (singleton)
export interface CompanyProfile {
  id: string;
  key: string;
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  pan: string | null;
  cin: string | null;
  industry: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  invoicePrefix: string;
  quotePrefix: string;
  currency: string;
  fiscalYearStart: string;
  defaultTaxRate: number;
  termsDefault: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  upi: string | null;
  createdAt: string;
  updatedAt: string;
}

// Public projection used by the share/quote viewer; bank/UPI fields are
// stripped server-side so they never leak to customers via the share link.
export type PublicCompany = Pick<
  CompanyProfile,
  | "legalName"
  | "tradeName"
  | "gstin"
  | "addressLine"
  | "city"
  | "state"
  | "pincode"
  | "country"
  | "phone"
  | "email"
  | "website"
  | "logoUrl"
>;

export type CompanyProfileUpdate = Partial<
  Omit<CompanyProfile, "id" | "key" | "createdAt" | "updatedAt">
>;

export const api = {
  // Auth
  login: (username: string, password: string) =>
    fetcher<{ token: string; user: ApiUser }>("/auth/login", {
      method: "POST",
      body: { username, password },
    }),
  pinLogin: (username: string, pin: string) =>
    fetcher<{ token: string; user: ApiUser }>("/auth/pin", {
      method: "POST",
      body: { username, pin },
    }),

  // Catalog
  products: async (q?: { q?: string; type?: string; limit?: number }): Promise<Product[]> =>
    (await fetcher<Raw[]>("/products", { query: q })) as unknown as Product[],
  productByBarcode: (code: string): Promise<Product> =>
    fetcher<Product>(`/products/by-barcode/${encodeURIComponent(code)}`),
  productBySku: (sku: string): Promise<Product> =>
    fetcher<Product>(`/products/by-sku/${encodeURIComponent(sku)}`),
  createProduct: (body: Partial<Product> & { variants?: ProductVariant[] }): Promise<Product> =>
    fetcher<Product>("/products", { method: "POST", body }),
  updateProduct: (
    id: string,
    body: Partial<Product> & { variants?: ProductVariant[] }
  ): Promise<Product> => fetcher<Product>(`/products/${id}`, { method: "PATCH", body }),
  deleteProduct: (id: string): Promise<{ ok: boolean }> =>
    fetcher<{ ok: boolean }>(`/products/${id}`, { method: "DELETE" }),
  customers: (opts?: { includeInactive?: boolean }): Promise<CustomerRow[]> =>
    fetcher<CustomerRow[]>("/customers", {
      query: opts?.includeInactive ? { includeInactive: "1" } : undefined,
    }),
  customer: (id: string): Promise<CustomerRow> =>
    fetcher<CustomerRow>(`/customers/${id}`),
  createCustomer: (body: CustomerInput): Promise<CustomerRow> =>
    fetcher<CustomerRow>("/customers", { method: "POST", body }),
  updateCustomer: (id: string, body: Partial<CustomerInput>): Promise<CustomerRow> =>
    fetcher<CustomerRow>(`/customers/${id}`, { method: "PATCH", body }),
  deleteCustomer: (
    id: string
  ): Promise<{ softDeleted: boolean; message?: string; customer?: CustomerRow }> =>
    fetcher<{ softDeleted: boolean; message?: string; customer?: CustomerRow }>(
      `/customers/${id}`,
      { method: "DELETE" }
    ),
  customerOpenInvoices: (customerId: string): Promise<OpenInvoice[]> =>
    fetcher<OpenInvoice[]>(`/customers/${customerId}/open-invoices`),
  customerStatement: (
    customerId: string,
    opts?: { from?: string; to?: string }
  ): Promise<CustomerStatement> =>
    fetcher<CustomerStatement>(`/customers/${customerId}/statement`, {
      query: opts as Record<string, string | undefined>,
    }),
  customerPayments: (customerId?: string): Promise<CustomerPayment[]> =>
    fetcher<CustomerPayment[]>("/customer-payments", {
      query: customerId ? { customerId } : undefined,
    }),
  recordPayment: (body: CustomerPaymentInput): Promise<CustomerPayment> =>
    fetcher<CustomerPayment>("/customer-payments", { method: "POST", body }),
  warehouses: (opts?: { includeInactive?: boolean }) =>
    fetcher<WarehouseRow[]>("/warehouses", {
      query: opts?.includeInactive ? { includeInactive: "1" } : undefined,
    }),
  createWarehouse: (body: { code: string; name: string; city: string }) =>
    fetcher<WarehouseRow>("/warehouses", { method: "POST", body }),
  updateWarehouse: (id: string, body: WarehouseInput) =>
    fetcher<WarehouseRow>(`/warehouses/${id}`, { method: "PATCH", body }),
  deleteWarehouse: (id: string) =>
    fetcher<{
      softDeleted: boolean;
      message?: string;
      warehouse?: WarehouseRow;
    }>(`/warehouses/${id}`, { method: "DELETE" }),
  bins: async (warehouseId: string): Promise<Bin[]> =>
    (await fetcher<Raw[]>(`/warehouses/${warehouseId}/bins`)).map(adaptBin),
  // Single bin create. Backend uppercases zone/rack/shelf/bin.
  createBin: async (
    warehouseId: string,
    body: { zone: string; rack: string; shelf: string; bin: string; capacity?: number }
  ): Promise<Bin> =>
    adaptBin(
      await fetcher<Raw>(`/warehouses/${warehouseId}/bins`, {
        method: "POST",
        body,
      })
    ),
  // Bulk-create a whole rack: N shelves x M bins each.
  bulkCreateBins: (
    warehouseId: string,
    body: {
      zone: string;
      rack: string;
      shelves?: string[];
      shelfCount?: number;
      binsPerShelf: number;
      capacity?: number;
    }
  ) =>
    fetcher<{
      created: number;
      zone: string;
      rack: string;
      shelves: number;
      binsPerShelf: number;
    }>(`/warehouses/${warehouseId}/bins/bulk`, { method: "POST", body }),
  updateBin: async (
    binId: string,
    body: { bin?: string; capacity?: number; productId?: string | null }
  ): Promise<Bin> =>
    adaptBin(
      await fetcher<Raw>(`/bins/${binId}`, { method: "PATCH", body })
    ),
  deleteBin: (binId: string) =>
    fetcher<{ deleted: true }>(`/bins/${binId}`, { method: "DELETE" }),
  warehousesAndBins: async (): Promise<Bin[]> => {
    const whs = await fetcher<Raw[]>("/warehouses");
    const all: Bin[] = [];
    for (const wh of whs) {
      const bins = await fetcher<Raw[]>(`/warehouses/${wh.id}/bins`);
      for (const b of bins) {
        all.push(
          adaptBin({
            ...b,
            warehouseCode: wh.code,
            warehouseName: wh.name,
          })
        );
      }
    }
    return all;
  },

  // Inventory
  ledger: async (q?: {
    productId?: string;
    txnType?: string;
    limit?: number;
  }): Promise<StockLedgerEntry[]> =>
    (await fetcher<Raw[]>("/ledger", { query: q })).map(adaptLedger),
  valuation: () => fetcher<Raw[]>("/valuation"),

  // Manufacturing
  productionOrders: async (): Promise<ProductionOrder[]> =>
    (await fetcher<Raw[]>("/production-orders")).map(adaptProductionOrder),
  productionOrdersWithWO: async (): Promise<{ orders: ProductionOrder[]; workOrders: WorkOrder[] }> => {
    const raw = await fetcher<Raw[]>("/production-orders");
    const orders = raw.map(adaptProductionOrder);
    const workOrders: WorkOrder[] = [];
    for (const r of raw) {
      for (const wo of (r.workOrders as Raw[]) ?? []) workOrders.push(adaptWorkOrder(wo));
    }
    return { orders, workOrders };
  },
  productionOrder: (id: string) => fetcher<Raw>(`/production-orders/${id}`),
  boms: async (q?: {
    productId?: string;
    // variantId="<id>" filters to one variant; variantId=null only
    // returns product-level BOMs; omit to return both.
    variantId?: string | null;
    active?: boolean;
  }): Promise<Bom[]> => {
    const params = new URLSearchParams();
    if (q?.productId) params.set("productId", q.productId);
    if (q?.variantId === null) params.set("variantId", "null");
    else if (q?.variantId) params.set("variantId", q.variantId);
    if (q?.active === true) params.set("active", "1");
    if (q?.active === false) params.set("active", "0");
    const qs = params.toString();
    return (await fetcher<Raw[]>(`/boms${qs ? `?${qs}` : ""}`)).map(adaptBom);
  },
  // For the BOM editor: "what variants of this product exist and
  // which already have a BOM?". Powers the variant chip strip.
  variantsWithBoms: (productId: string) =>
    fetcher<VariantsWithBomsRow>(
      `/products/${productId}/variants-with-boms`
    ),

  // -- UoM master ----------------------------------------------------
  // Canonical units shared across products, BOMs, quotes, invoices.
  // Returns flat list optionally filtered by category code or
  // active-only. Cached at the page level via useApi() since the
  // master is effectively static.
  uoms: (q?: { category?: string; active?: boolean }) =>
    fetcher<Uom[]>("/uoms", {
      query: q
        ? { ...(q.category ? { category: q.category } : {}), ...(q.active ? { active: "true" } : {}) }
        : undefined,
    }),
  uomCategories: () => fetcher<UomCategory[]>("/uom-categories"),
  // Convert a quantity between two UoMs in the same category.
  // Throws on cross-category attempts (server returns 400).
  convertUom: (qty: number, from: string, to: string) =>
    fetcher<{ qty: number; from: string; to: string; result: number }>(
      "/uoms/convert",
      { method: "POST", body: { qty, from, to } }
    ),
  bom: (id: string) => fetcher<Raw>(`/boms/${id}`),
  getBom: async (id: string): Promise<Bom> =>
    adaptBom(await fetcher<Raw>(`/boms/${id}`)),
  bomTree: (id: string, qty: number = 1) =>
    fetcher<BomTreeNode>(`/boms/${id}/tree?qty=${qty}`),
  bomExplode: (id: string, qty: number = 1) =>
    fetcher<BomLeafRow[]>(`/boms/${id}/explode?qty=${qty}`),
  whereUsed: (productId: string) =>
    fetcher<WhereUsedRow[]>(`/products/${productId}/where-used`),
  createBom: (body: {
    productId: string;
    // Set to a variant id to make this a variant-level BOM, omit/null
    // for product-level default.
    variantId?: string | null;
    revision?: string;
    outputQty?: number;
    active?: boolean;
    // Optional production routing defaults. When set, MOs created from
    // this BOM prefill their station / machine fields.
    defaultWorkCenterId?: string | null;
    defaultMachineId?: string | null;
    items?: Array<{ productId: string; qty: number; uom: string; scrapPct?: number }>;
  }) => fetcher<Raw>("/boms", { method: "POST", body }),
  updateBom: (
    id: string,
    body: {
      revision?: string;
      outputQty?: number;
      active?: boolean;
      defaultWorkCenterId?: string | null;
      defaultMachineId?: string | null;
      items?: Array<{ productId: string; qty: number; uom: string; scrapPct?: number }>;
    }
  ) => fetcher<Raw>(`/boms/${id}`, { method: "PATCH", body }),
  // Clone an existing BOM. Omit `variantId` to keep the source
  // scope (handy for branching a new revision); pass a variantId to
  // clone *to* a specific variant; pass null to clone to product
  // level.
  cloneBom: (
    id: string,
    body?: {
      variantId?: string | null;
      revision?: string;
      setActive?: boolean;
    }
  ) => fetcher<Raw>(`/boms/${id}/clone`, { method: "POST", body: body ?? {} }),
  deleteBom: (id: string) =>
    fetcher<{ softDeleted: boolean; message?: string }>(`/boms/${id}`, {
      method: "DELETE",
    }),
  // Auto-create a packaging BOM for every variant of a product that
  // doesn't already have one. Each generated BOM consumes the parent
  // product at qty = variant.packSize (so a 100g pouch on a kg-tracked
  // parent consumes 0.1 kg per pack).
  // ---- Production master data: work centers + machines ----
  workCenters: (q?: { active?: boolean }) =>
    fetcher<
      Array<{
        id: string;
        code: string;
        name: string;
        description: string | null;
        capacityPerHour: number | null;
        active: boolean;
        machines: Array<{
          id: string;
          code: string;
          name: string;
          status: string;
          active: boolean;
        }>;
      }>
    >("/work-centers", {
      query: q?.active !== undefined ? { active: q.active ? "1" : "0" } : undefined,
    }),
  createWorkCenter: (body: {
    code: string;
    name: string;
    description?: string | null;
    capacityPerHour?: number | null;
    active?: boolean;
  }) => fetcher<Raw>("/work-centers", { method: "POST", body }),
  updateWorkCenter: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      description: string | null;
      capacityPerHour: number | null;
      active: boolean;
    }>
  ) => fetcher<Raw>(`/work-centers/${id}`, { method: "PATCH", body }),
  deleteWorkCenter: (id: string) =>
    fetcher<{ deleted?: boolean; softDeleted?: boolean; message?: string }>(
      `/work-centers/${id}`,
      { method: "DELETE" }
    ),
  machines: (q?: { workCenterId?: string; active?: boolean }) =>
    fetcher<
      Array<{
        id: string;
        code: string;
        name: string;
        workCenterId: string;
        workCenter: { id: string; code: string; name: string };
        status: string;
        description: string | null;
        active: boolean;
      }>
    >("/machines", {
      query: {
        ...(q?.workCenterId ? { workCenterId: q.workCenterId } : {}),
        ...(q?.active !== undefined ? { active: q.active ? "1" : "0" } : {}),
      },
    }),
  createMachine: (body: {
    code: string;
    name: string;
    workCenterId: string;
    status?: "running" | "idle" | "maintenance" | "broken";
    description?: string | null;
    active?: boolean;
  }) => fetcher<Raw>("/machines", { method: "POST", body }),
  updateMachine: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      workCenterId: string;
      status: "running" | "idle" | "maintenance" | "broken";
      description: string | null;
      active: boolean;
    }>
  ) => fetcher<Raw>(`/machines/${id}`, { method: "PATCH", body }),
  deleteMachine: (id: string) =>
    fetcher<{ deleted: boolean }>(`/machines/${id}`, { method: "DELETE" }),

  generateDefaultBoms: (productId: string) =>
    fetcher<{
      productSku: string;
      created: Array<{ variantSku: string; bomId: string; consumed: string }>;
      skipped: Array<{ variantSku: string; reason: string }>;
    }>(`/products/${productId}/generate-default-boms`, { method: "POST", body: {} }),

  // ---- Production order lifecycle ----
  createProductionOrder: (body: {
    bomId: string;
    // Both free-text. When omitted, the backend falls back to the
    // BOM's defaultWorkCenter / defaultMachine (configured in the BOM
    // editor) and finally to "Assembly 1" / "—" placeholders.
    station?: string;
    machine?: string;
    plannedQty: number;
    startDate: string;
    dueDate: string;
  }) => fetcher<Raw>("/production-orders", { method: "POST", body }),
  productionOrderRequirements: (id: string) =>
    fetcher<MoRequirements>(`/production-orders/${id}/requirements`),
  issueMaterials: (id: string, body?: { warehouseId?: string; allowShort?: boolean }) =>
    fetcher<{
      issued: Array<{ productId: string; sku: string; requested: number; issued: number }>;
      anyShort: boolean;
      productionOrder: Raw;
    }>(`/production-orders/${id}/issue-materials`, {
      method: "POST",
      body: body ?? {},
    }),
  logOutput: (
    id: string,
    body: { goodQty?: number; scrapQty?: number; reworkQty?: number }
  ) =>
    fetcher<Raw>(`/production-orders/${id}/log-output`, {
      method: "POST",
      body,
    }),
  completeProductionOrder: (
    id: string,
    body?: { warehouseId?: string; finalGoodQty?: number }
  ) =>
    fetcher<{
      productionOrder: Raw;
      putaway: { binId: string; bin: string; qty: number } | null;
    }>(`/production-orders/${id}/complete`, { method: "POST", body: body ?? {} }),
  updateWorkOrder: (
    id: string,
    body: { status?: "queued" | "running" | "paused" | "complete"; output?: number }
  ) => fetcher<Raw>(`/work-orders/${id}`, { method: "PATCH", body }),

  // Procurement: vendors, POs, GRNs.
  // Vendor CRUD - listing decorates each row with rolled-up
  // outstandingPO + totalSpend so the catalog UI can render KPIs
  // without N+1 fetches.
  vendors: async (q?: {
    includeInactive?: boolean;
    search?: string;
  }): Promise<Vendor[]> =>
    (
      await fetcher<Raw[]>("/vendors", {
        query: {
          ...(q?.includeInactive ? { includeInactive: "1" } : {}),
          ...(q?.search ? { search: q.search } : {}),
        },
      })
    ).map(adaptVendor),
  vendor: async (id: string): Promise<Vendor> =>
    adaptVendor(await fetcher<Raw>(`/vendors/${id}`)),
  createVendor: (body: {
    code?: string;
    name: string;
    gst?: string;
    contact?: string;
    email?: string | null;
    address?: string | null;
    city?: string;
    rating?: number;
    leadTimeDays?: number;
    paymentTerms?: string | null;
    active?: boolean;
  }) => fetcher<Raw>("/vendors", { method: "POST", body }),
  updateVendor: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      gst: string;
      contact: string;
      email: string | null;
      address: string | null;
      city: string;
      rating: number;
      leadTimeDays: number;
      paymentTerms: string | null;
      active: boolean;
    }>
  ) => fetcher<Raw>(`/vendors/${id}`, { method: "PATCH", body }),
  deleteVendor: (id: string) =>
    fetcher<{ deleted?: boolean; softDeleted?: boolean; message?: string }>(
      `/vendors/${id}`,
      { method: "DELETE" }
    ),

  // Purchase orders.
  purchaseOrders: async (q?: {
    status?: PurchaseOrder["status"];
    vendorId?: string;
    search?: string;
  }): Promise<PurchaseOrder[]> => {
    const rows = await fetcher<Raw[]>("/purchase-orders", {
      query: {
        ...(q?.status ? { status: q.status } : {}),
        ...(q?.vendorId ? { vendorId: q.vendorId } : {}),
        ...(q?.search ? { search: q.search } : {}),
      },
    });
    return rows.map(adaptPo);
  },
  // Full PO detail - items + GRNs (with their items). Used by the PO
  // editor + GRN receive flow.
  getPurchaseOrder: (id: string) =>
    fetcher<{
      id: string;
      poNo: string;
      status: PurchaseOrder["status"];
      date: string;
      expectedDate: string;
      amount: number;
      receivedPct: number;
      notes: string | null;
      vendor: { id: string; code: string; name: string; city: string };
      vendorId: string;
      items: Array<{
        id: string;
        productId: string;
        product: { id: string; sku: string; name: string; uom: string; hsn: string };
        qty: number;
        rate: number;
        amount: number;
        received: number;
      }>;
      grns: Array<{
        id: string;
        grnNo: string;
        date: string;
        qcStatus: "pending" | "pass" | "rework" | "reject";
        truckNo: string | null;
        driver: string | null;
        notes: string | null;
        receivedBy: string | null;
        items: Array<{
          id: string;
          poItemId: string;
          receivedQty: number;
          rejectedQty: number;
          remarks: string | null;
          poItem: {
            productId: string;
            product: { sku: string; name: string; uom: string };
          };
        }>;
      }>;
    }>(`/purchase-orders/${id}`),
  createPurchaseOrder: (body: {
    vendorId: string;
    expectedDate: string;
    notes?: string | null;
    items: Array<{ productId: string; qty: number; rate: number }>;
  }) => fetcher<Raw>("/purchase-orders", { method: "POST", body }),
  updatePurchaseOrder: (
    id: string,
    body: {
      expectedDate?: string;
      notes?: string | null;
      items?: Array<{ productId: string; qty: number; rate: number }>;
    }
  ) => fetcher<Raw>(`/purchase-orders/${id}`, { method: "PATCH", body }),
  approvePurchaseOrder: (id: string) =>
    fetcher<Raw>(`/purchase-orders/${id}/approve`, { method: "POST", body: {} }),
  cancelPurchaseOrder: (id: string) =>
    fetcher<Raw>(`/purchase-orders/${id}/cancel`, { method: "POST", body: {} }),
  closePurchaseOrder: (id: string) =>
    fetcher<Raw>(`/purchase-orders/${id}/close`, { method: "POST", body: {} }),
  // Mints (or rotates) a public share token so the vendor can open a
  // sanitized read-only view at /share/purchase-order/<token>.
  rotatePurchaseOrderShareToken: (id: string) =>
    fetcher<{ shareToken: string }>(
      `/purchase-orders/${id}/rotate-share-token`,
      { method: "POST", body: {} }
    ),
  publicPurchaseOrder: (token: string) =>
    publicFetcher<PublicPurchaseOrderPayload>(
      `/public/purchase-orders/${encodeURIComponent(token)}`
    ),

  // GRNs (goods receipt notes). The list endpoint returns enough
  // detail to render the queue strip + QC status on the GRN tab.
  grns: (q?: {
    qcStatus?: "pending" | "pass" | "rework" | "reject";
    poId?: string;
  }) =>
    fetcher<
      Array<{
        id: string;
        grnNo: string;
        date: string;
        qcStatus: "pending" | "pass" | "rework" | "reject";
        truckNo: string | null;
        driver: string | null;
        notes: string | null;
        receivedBy: string | null;
        po: {
          id: string;
          poNo: string;
          vendor: { id: string; name: string; code: string };
        };
        items: Array<{
          id: string;
          poItemId: string;
          receivedQty: number;
          rejectedQty: number;
          remarks: string | null;
          poItem: {
            productId: string;
            product: { id: string; sku: string; name: string; uom: string };
          };
        }>;
      }>
    >("/grns", { query: q as Record<string, string | undefined> | undefined }),
  createGrn: (body: {
    poId: string;
    qcStatus?: "pending" | "pass" | "rework" | "reject";
    truckNo?: string | null;
    driver?: string | null;
    notes?: string | null;
    items: Array<{
      poItemId: string;
      receivedQty: number;
      rejectedQty?: number;
      remarks?: string | null;
    }>;
  }) => fetcher<Raw>("/grns", { method: "POST", body }),
  updateGrnQc: (
    id: string,
    body: { qcStatus: "pending" | "pass" | "rework" | "reject"; notes?: string }
  ) => fetcher<Raw>(`/grns/${id}/qc`, { method: "PATCH", body }),

  // Workforce
  workers: async (): Promise<Worker[]> =>
    (await fetcher<Raw[]>("/workers")) as unknown as Worker[],

  // Billing
  invoices: async (): Promise<Invoice[]> =>
    (await fetcher<Raw[]>("/invoices")).map(adaptInvoice),
  // Full detail of one invoice with line items, linked SO/Packing slip,
  // and any dispatch (transport) orders already issued against it.
  getInvoice: (id: string) => fetcher<InvoiceDetail>(`/invoices/${id}`),
  createInvoice: (body: {
    customerId: string;
    paymentMode: "cash" | "card" | "upi" | "credit" | "split";
    items: { productId: string; variantId?: string | null; qty: number; rate: number }[];
  }) => fetcher<Raw>("/invoices", { method: "POST", body }),
  dispatches: async (): Promise<DispatchOrder[]> =>
    (await fetcher<Raw[]>("/dispatches")).map(adaptDispatch),
  createDispatch: async (body: {
    invoiceId: string;
    // Either tripId (preferred) OR vehicle+driver are required.
    tripId?: string | null;
    vehicle?: string;
    driver?: string;
    destination?: string;
    etaHours?: number;
    weightKg?: number;
    status?: "planned" | "loading" | "in-transit" | "delivered" | "delayed";
  }): Promise<DispatchOrder> =>
    adaptDispatch(
      await fetcher<Raw>("/dispatches", { method: "POST", body })
    ),
  confirmDispatch: (id: string) =>
    fetcher<Raw>(`/dispatches/${id}/confirm`, { method: "POST", body: {} }),

  // -------- Trips ----------------------------------------------------
  trips: (q?: { from?: string; to?: string; status?: TripStatus }) => {
    const params = new URLSearchParams();
    if (q?.from) params.set("from", q.from);
    if (q?.to) params.set("to", q.to);
    if (q?.status) params.set("status", q.status);
    const qs = params.toString();
    return fetcher<TripRow[]>(`/trips${qs ? `?${qs}` : ""}`);
  },
  trip: (id: string) => fetcher<TripRow>(`/trips/${id}`),
  createTrip: (body: {
    scheduledDate: string;
    vehicle: string;
    driver: string;
    route?: string | null;
    capacityKg?: number;
    notes?: string | null;
  }) => fetcher<TripRow>("/trips", { method: "POST", body }),
  updateTrip: (
    id: string,
    body: {
      scheduledDate?: string;
      vehicle?: string;
      driver?: string;
      route?: string | null;
      capacityKg?: number;
      notes?: string | null;
    }
  ) => fetcher<TripRow>(`/trips/${id}`, { method: "PATCH", body }),
  startTrip: (id: string) =>
    fetcher<TripRow>(`/trips/${id}/start`, { method: "POST", body: {} }),
  completeTrip: (id: string) =>
    fetcher<TripRow>(`/trips/${id}/complete`, { method: "POST", body: {} }),
  cancelTrip: (id: string, reason?: string) =>
    fetcher<{ trip: TripRow; successor: TripRow | null }>(
      `/trips/${id}/cancel`,
      { method: "POST", body: { reason: reason ?? null } }
    ),
  assignDispatchToTrip: (tripId: string, dispatchId: string) =>
    fetcher<TripRow>(`/trips/${tripId}/dispatches`, {
      method: "POST",
      body: { dispatchId },
    }),
  unassignDispatchFromTrip: (tripId: string, dispatchId: string) =>
    fetcher<TripRow>(`/trips/${tripId}/dispatches/${dispatchId}`, {
      method: "DELETE",
    }),
  autoScheduleTrips: (body?: {
    days?: number;
    vehicle?: string;
    driver?: string;
    route?: string | null;
    capacityKg?: number;
  }) =>
    fetcher<{ created: { tripNo: string; scheduledDate: string }[] }>(
      "/trips/auto-schedule",
      { method: "POST", body: body ?? {} }
    ),
  unassignedDispatches: () =>
    fetcher<UnassignedDispatch[]>("/dispatches/unassigned"),

  // Approvals
  approvals: () => fetcher<ApprovalRow[]>("/approvals"),
  // The decide endpoint returns one of three shapes depending on the
  // side-effect that fired:
  //   - bare ApprovalRow                             - no side-effect (e.g. Stock Adjust)
  //   - { approval, salesOrder }                     - Credit Limit approved -> SO materialised
  //   - { approval, quote }                          - Credit Limit rejected -> quote bounced to 'rejected'
  // Optional `reason` is appended to the audit row and to the linked
  // quote's notes, so the salesperson sees why their deal was killed.
  decideApproval: (
    id: string,
    decision: "approved" | "rejected",
    reason?: string
  ) =>
    fetcher<
      | ApprovalRow
      | { approval: ApprovalRow; salesOrder: SalesOrderRow }
      | { approval: ApprovalRow; quote: QuoteRow }
    >(`/approvals/${id}/decide`, {
      method: "POST",
      body: reason ? { decision, reason } : { decision },
    }),

  // Users & roles (admin only)
  users: (q?: { role?: string; active?: string }) =>
    fetcher<ApiUser[]>("/users", { query: q }),
  createUser: (body: {
    username: string;
    name: string;
    role: string;
    email?: string | null;
    password: string;
    pin?: string | null;
  }) => fetcher<ApiUser>("/users", { method: "POST", body }),
  updateUser: (
    id: string,
    body: Partial<{
      name: string;
      role: string;
      email: string | null;
      active: boolean;
      password: string | null;
      pin: string | null;
    }>
  ) => fetcher<ApiUser>(`/users/${id}`, { method: "PATCH", body }),
  deleteUser: (id: string) => fetcher<void>(`/users/${id}`, { method: "DELETE" }),
  roles: () => fetcher<{ value: string; label: string }[]>("/roles"),

  // Customer Returns
  returns: (q?: { status?: string; customerId?: string; from?: string; to?: string }) =>
    fetcher<CustomerReturnRow[]>("/returns", { query: q }),
  returnDoc: (id: string) => fetcher<CustomerReturnRow>(`/returns/${id}`),
  decideReturnLine: (
    id: string,
    lineId: string,
    body: { decision: "approved" | "rejected"; notes?: string }
  ) =>
    fetcher<CustomerReturnItemRow>(`/returns/${id}/lines/${lineId}/decide`, {
      method: "POST",
      body,
    }),
  finalizeReturn: (
    id: string,
    body: {
      decisions?: { lineId: string; decision: "approved" | "rejected"; notes?: string }[];
    }
  ) =>
    fetcher<{ doc: CustomerReturnRow; creditNote: CreditNoteRow | null }>(
      `/returns/${id}/finalize`,
      { method: "POST", body }
    ),
  cancelReturn: (id: string) =>
    fetcher<CustomerReturnRow>(`/returns/${id}/cancel`, { method: "POST", body: {} }),
  creditNote: (id: string) => fetcher<CreditNoteRow>(`/credit-notes/${id}`),

  // Reports
  dashboard: () =>
    fetcher<{
      productCount: number;
      activeWorkers: number;
      delayedOrders: number;
      lowStock: number;
      productionTotals: { _sum: { actualQty: number; plannedQty: number; scrapQty: number } };
      sales: number;
      pendingApprovals: number;
    }>("/reports/dashboard"),
  productionTrend: () =>
    fetcher<{ day: string; planned: number; actual: number; scrap: number }[]>(
      "/reports/production-trend"
    ),
  procurementSplit: () =>
    fetcher<{ name: string; value: number }[]>("/reports/procurement-split"),
  salesTrend: () =>
    fetcher<{ day: string; sales: number; cogs: number }[]>("/reports/sales-trend"),
  stationLoad: () =>
    fetcher<{ station: string; target: number; output: number; efficiency: number }[]>(
      "/reports/station-load"
    ),
  workersSummary: () =>
    fetcher<{ total: number; in: number; out: number }>("/reports/workers-summary"),
  productionLines: () =>
    fetcher<{
      lines: Array<{
        id: string;
        code: string;
        name: string;
        capacityPerHour: number | null;
        machines: Array<{
          id: string;
          code: string;
          name: string;
          status: "running" | "idle" | "maintenance" | "broken";
          busy: boolean;
        }>;
        activeOrders: number;
        orders: Array<{
          id: string;
          orderNo: string;
          status: string;
          plannedQty: number;
          actualQty: number;
          productSku: string;
          productName: string;
        }>;
        outputToday: number;
        dailyCapacity: number | null;
        utilisationPct: number | null;
      }>;
      totals: { activeOrders: number; outputToday: number };
    }>("/reports/production-lines"),
  attendanceHeatmap: (days = 28) =>
    fetcher<Array<{ date: string; weekday: string; presentCount: number }>>(
      "/reports/attendance-heatmap",
      { query: { days } }
    ),
  punchWorker: (body: { empNo: string; direction: "in" | "out" | "break" }) =>
    fetcher<Raw>("/workers/punch", { method: "POST", body }),

  // Sync
  syncInfo: () =>
    fetcher<{ entities: string[]; serverTime: string; appendOnly: string[] }>("/sync/info"),

  // Sales: Quotes
  quotes: (q?: { status?: QuoteStatus; q?: string; customerId?: string; limit?: number }) =>
    fetcher<QuoteRow[]>("/quotes", { query: q as Record<string, string | number | undefined> }),
  quote: (id: string) => fetcher<QuoteRow>(`/quotes/${id}`),
  quoteRevisions: (id: string) =>
    fetcher<QuoteRevisionRow[]>(`/quotes/${id}/revisions`),
  quoteRevision: (id: string, rev: number) =>
    fetcher<QuoteRevisionRow & { snapshot: unknown }>(`/quotes/${id}/revisions/${rev}`),
  createQuote: (body: QuoteCreatePayload) =>
    fetcher<QuoteRow>("/quotes", { method: "POST", body }),
  updateQuote: (id: string, body: QuoteUpdatePayload) =>
    fetcher<QuoteRow>(`/quotes/${id}`, { method: "PATCH", body }),
  submitQuote: (id: string) =>
    fetcher<QuoteRow>(`/quotes/${id}/submit`, { method: "POST", body: {} }),
  rejectQuote: (id: string) =>
    fetcher<QuoteRow>(`/quotes/${id}/reject`, { method: "POST", body: {} }),
  deleteQuote: (id: string) =>
    fetcher<{ ok: true }>(`/quotes/${id}`, { method: "DELETE" }),
  acceptQuote: (id: string) =>
    fetcher<AcceptQuoteResponse>(`/quotes/${id}/accept`, { method: "POST", body: {} }),
  forceConvertQuote: (id: string, reason?: string) =>
    fetcher<{
      forced: true;
      approvalId?: string;
      salesOrder: SalesOrderRow;
      alreadyConverted?: boolean;
    }>(`/quotes/${id}/force-convert`, {
      method: "POST",
      body: { reason: reason ?? "Manual override" },
    }),
  extendQuote: (id: string, validUntil: string) =>
    fetcher<QuoteRow>(`/quotes/${id}/extend-validity`, {
      method: "POST",
      body: { validUntil },
    }),
  rotateQuoteShareToken: (id: string) =>
    fetcher<{ shareToken: string }>(`/quotes/${id}/rotate-share-token`, {
      method: "POST",
      body: {},
    }),
  publicQuote: (token: string) =>
    publicFetcher<PublicQuotePayload>(`/public/quotes/${encodeURIComponent(token)}`),

  // Sharing: Sales Orders / Invoices / Packing Slips. Each (rotate)
  // endpoint also lazily mints a token if one doesn't exist yet, so
  // callers can use the same method to "Get share link" for the first
  // time and to "Revoke and reissue" later.
  rotateSalesOrderShareToken: (id: string) =>
    fetcher<{ shareToken: string }>(`/sales-orders/${id}/rotate-share-token`, {
      method: "POST",
      body: {},
    }),
  publicSalesOrder: (token: string) =>
    publicFetcher<PublicSalesOrderPayload>(
      `/public/sales-orders/${encodeURIComponent(token)}`
    ),

  rotateInvoiceShareToken: (id: string) =>
    fetcher<{ shareToken: string }>(`/invoices/${id}/rotate-share-token`, {
      method: "POST",
      body: {},
    }),
  publicInvoice: (token: string) =>
    publicFetcher<PublicInvoicePayload>(
      `/public/invoices/${encodeURIComponent(token)}`
    ),

  rotatePackingSlipShareToken: (id: string) =>
    fetcher<{ shareToken: string }>(
      `/packing-slips/${id}/rotate-share-token`,
      { method: "POST", body: {} }
    ),
  publicPackingSlip: (token: string) =>
    publicFetcher<PublicPackingSlipPayload>(
      `/public/packing-slips/${encodeURIComponent(token)}`
    ),

  // Settings · Company profile (singleton)
  getCompanyProfile: () => fetcher<CompanyProfile>("/settings/company"),
  updateCompanyProfile: (body: CompanyProfileUpdate) =>
    fetcher<CompanyProfile>("/settings/company", { method: "PUT", body }),
  publicCompany: () => publicFetcher<PublicCompany>("/public/company"),

  // Sales: Sales Orders
  salesOrders: (q?: {
    status?: SalesOrderStatus;
    q?: string;
    customerId?: string;
    limit?: number;
  }) =>
    fetcher<SalesOrderRow[]>("/sales-orders", {
      query: q as Record<string, string | number | undefined>,
    }),
  salesOrder: (id: string) => fetcher<SalesOrderRow>(`/sales-orders/${id}`),
  cancelSalesOrder: (id: string) =>
    fetcher<SalesOrderRow>(`/sales-orders/${id}/cancel`, { method: "POST", body: {} }),
  holdSalesOrder: (id: string) =>
    fetcher<SalesOrderRow>(`/sales-orders/${id}/hold`, { method: "POST", body: {} }),
  resumeSalesOrder: (id: string) =>
    fetcher<SalesOrderRow>(`/sales-orders/${id}/resume`, { method: "POST", body: {} }),
  closeSalesOrder: (id: string) =>
    fetcher<SalesOrderRow>(`/sales-orders/${id}/close`, { method: "POST", body: {} }),
  invoiceSalesOrder: (
    id: string,
    body: {
      paymentMode: "cash" | "card" | "upi" | "credit" | "split";
      items: { salesOrderItemId: string; qty: number }[];
    }
  ) => fetcher<Raw>(`/sales-orders/${id}/invoice`, { method: "POST", body }),

  // ATP
  atp: (productId: string, variantId?: string | null) =>
    fetcher<AtpResult>("/stock/atp", {
      query: { productId, ...(variantId ? { variantId } : {}) },
    }),

  // Fulfilment: Pick Lists
  pickLists: (q?: { status?: PickListStatus; salesOrderId?: string; limit?: number }) =>
    fetcher<PickListRow[]>("/pick-lists", {
      query: q as Record<string, string | number | undefined>,
    }),
  pickList: (id: string) => fetcher<PickListRow>(`/pick-lists/${id}`),
  createPickList: (salesOrderId: string) =>
    fetcher<PickListRow>(`/sales-orders/${salesOrderId}/pick-lists`, {
      method: "POST",
      body: {},
    }),
  updatePickList: (
    id: string,
    body: {
      notes?: string | null;
      items?: {
        id: string;
        binId?: string | null;
        qtyPicked?: number;
        qtyToPick?: number;
        notes?: string | null;
      }[];
    }
  ) => fetcher<PickListRow>(`/pick-lists/${id}`, { method: "PATCH", body }),
  // Add a new bin / qty split to an existing pick-list line. The backend
  // creates a sibling PickListItem against the same salesOrderItemId so
  // operators can pick the same SO line from multiple physical locations.
  addPickListItem: (
    id: string,
    body: { salesOrderItemId: string; binId: string | null; qtyToPick: number }
  ) => fetcher<PickListRow>(`/pick-lists/${id}/items`, { method: "POST", body }),
  // Remove a single split row. Refused if it would be the last row for
  // that SO line (use updatePickList to set qty=0, or cancelPickList).
  removePickListItem: (id: string, itemId: string) =>
    fetcher<PickListRow>(`/pick-lists/${id}/items/${itemId}`, {
      method: "DELETE",
    }),
  completePickList: (id: string) =>
    fetcher<{ pickList: PickListRow; packingSlip: PackingSlipRow }>(
      `/pick-lists/${id}/complete`,
      { method: "POST", body: {} }
    ),
  // One-click pick: server fills qtyPicked greedily for every line and
  // completes the list. If any line falls short of qtyToPick the call
  // 409s with `auto_pick_partial` and the qty is still saved so the
  // operator can see exactly where the gaps are. Re-posting with
  // { acceptShortfall: true } completes a partial pick.
  autoPickList: (id: string, body?: { acceptShortfall?: boolean }) =>
    fetcher<{
      pickList: PickListRow;
      packingSlip: PackingSlipRow;
      shortfalls: {
        itemId: string;
        sku: string;
        requested: number;
        filled: number;
        reason: "no_bin" | "bin_capped" | "variant_capped";
        location?: string | null;
      }[];
    }>(`/pick-lists/${id}/auto-pick`, { method: "POST", body: body ?? {} }),
  cancelPickList: (id: string) =>
    fetcher<PickListRow>(`/pick-lists/${id}/cancel`, { method: "POST", body: {} }),

  // Fulfilment: Packing Slips
  packingSlips: (q?: {
    status?: PackingSlipStatus;
    salesOrderId?: string;
    limit?: number;
  }) =>
    fetcher<PackingSlipRow[]>("/packing-slips", {
      query: q as Record<string, string | number | undefined>,
    }),
  packingSlip: (id: string) => fetcher<PackingSlipRow>(`/packing-slips/${id}`),
  updatePackingSlip: (
    id: string,
    body: {
      notes?: string | null;
      items?: { id: string; qtyPacked: number; notes?: string | null }[];
    }
  ) => fetcher<PackingSlipRow>(`/packing-slips/${id}`, { method: "PATCH", body }),
  packPackingSlip: (id: string) =>
    fetcher<PackingSlipRow>(`/packing-slips/${id}/pack`, { method: "POST", body: {} }),
  // One-click pack: copies qtyPicked into qtyPacked for every line and
  // locks the slip. Any pre-existing operator edits where qtyPacked
  // differed from qtyPicked are reported as `mismatches` for UI
  // highlighting (rare - usually the auto button is hit before any
  // editing).
  autoPackPackingSlip: (id: string) =>
    fetcher<{
      packingSlip: PackingSlipRow;
      mismatches: {
        itemId: string;
        sku: string;
        qtyPicked: number;
        qtyPacked: number;
        variance: number;
      }[];
    }>(`/packing-slips/${id}/auto-pack`, { method: "POST", body: {} }),
  invoicePackingSlip: (
    id: string,
    paymentMode: "cash" | "card" | "upi" | "credit" | "split"
  ) =>
    fetcher<Raw>(`/packing-slips/${id}/invoice`, {
      method: "POST",
      body: { paymentMode },
    }),
  cancelPackingSlip: (id: string) =>
    fetcher<PackingSlipRow>(`/packing-slips/${id}/cancel`, { method: "POST", body: {} }),

  // Static catalogue of supported couriers (Shiprocket mock + a few
  // real Indian carriers). Used by CourierPicker on the Billing
  // detail screen for ecommerce invoices.
  couriers: () => fetcher<{ code: string; name: string }[]>("/couriers"),
  // Assign / re-assign a courier to a packing slip. Stamps carrier,
  // awb (auto-generated when omitted) and trackingUrl. Idempotent in
  // practice - the operator can call it again to correct the AWB.
  assignCourier: (
    packingSlipId: string,
    body: { courier: string; awb?: string }
  ) =>
    fetcher<PackingSlipRow>(
      `/packing-slips/${packingSlipId}/assign-courier`,
      { method: "POST", body }
    ),
  // Mark an ecommerce package delivered. Sets deliveredAt; required
  // before the order is "complete" from a customer-care perspective.
  confirmCourierDelivery: (packingSlipId: string) =>
    fetcher<PackingSlipRow>(
      `/packing-slips/${packingSlipId}/confirm-delivery`,
      { method: "POST", body: {} }
    ),

  // Pricing: price lists
  priceLists: () => fetcher<PriceListRow[]>("/price-lists"),
  priceList: (id: string) => fetcher<PriceListRow>(`/price-lists/${id}`),
  createPriceList: (body: {
    code: string;
    name: string;
    description?: string | null;
    currency?: string;
    basis?: PriceBasis;
    multiplier?: number;
    active?: boolean;
    isDefault?: boolean;
    validFrom?: string | null;
    validUntil?: string | null;
  }) => fetcher<PriceListRow>("/price-lists", { method: "POST", body }),
  updatePriceList: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      description: string | null;
      currency: string;
      basis: PriceBasis;
      multiplier: number;
      active: boolean;
      isDefault: boolean;
      validFrom: string | null;
      validUntil: string | null;
    }>
  ) => fetcher<PriceListRow>(`/price-lists/${id}`, { method: "PATCH", body }),
  deletePriceList: (id: string) =>
    fetcher<{ ok: true }>(`/price-lists/${id}`, { method: "DELETE" }),
  upsertPriceListItems: (
    id: string,
    body: {
      upsert?: {
        id?: string;
        productId: string;
        variantId?: string | null;
        price: number;
        minQty?: number;
        notes?: string | null;
      }[];
      remove?: string[];
    }
  ) =>
    fetcher<PriceListRow>(`/price-lists/${id}/items`, {
      method: "PATCH",
      body,
    }),
  applyPriceListFormula: (
    id: string,
    body: { basis?: PriceBasis; multiplier: number; createMissing?: boolean }
  ) =>
    fetcher<{ ok: true; written: number }>(`/price-lists/${id}/apply-formula`, {
      method: "POST",
      body,
    }),

  // Pricing: resolver
  resolvePrice: (q: {
    productId: string;
    variantId?: string | null;
    customerId?: string | null;
    qty?: number;
  }) =>
    fetcher<ResolvedPrice>("/pricing/resolve", {
      query: {
        productId: q.productId,
        ...(q.variantId ? { variantId: q.variantId } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        qty: q.qty ?? 1,
      },
    }),
  resolvePrices: (body: {
    customerId?: string | null;
    items: { productId: string; variantId?: string | null; qty: number }[];
  }) =>
    fetcher<ResolvedPrice[]>("/pricing/resolve-many", {
      method: "POST",
      body,
    }),

  // Bins for picking - lookup by product to override the suggested bin.
  binsForProduct: async (productId: string): Promise<BinSummary[]> => {
    const whs = await fetcher<Raw[]>("/warehouses");
    const all: BinSummary[] = [];
    for (const wh of whs) {
      const bins = await fetcher<Raw[]>(`/warehouses/${wh.id}/bins`);
      for (const b of bins) {
        if ((b.productId as string | null) === productId && (b.qty as number) > 0) {
          all.push({
            id: b.id as string,
            zone: b.zone as string,
            rack: b.rack as string,
            shelf: b.shelf as string,
            bin: b.bin as string,
            qty: b.qty as number,
            reservedQty: (b.reservedQty as number) ?? 0,
          });
        }
      }
    }
    return all;
  },

  // ====================================================== Mobile warehouse ===
  myTasks: () =>
    fetcher<{
      pickClaimed: Raw[];
      pickAvailable: Raw[];
      packClaimed: Raw[];
      packAvailable: Raw[];
      counts: {
        pickClaimed: number;
        pickAvailable: number;
        packClaimed: number;
        packAvailable: number;
      };
    }>("/me/tasks"),
  claimPickList: (id: string) =>
    fetcher<Raw>(`/pick-lists/${id}/claim`, { method: "POST", body: {} }),
  releasePickList: (id: string) =>
    fetcher<Raw>(`/pick-lists/${id}/release`, { method: "POST", body: {} }),
  // Stale-line recovery: zero qtyPicked back to 0 so the worker can
  // rescan or skip a line whose variant stock has since been drained
  // by another in-flight pick list. See backend reset endpoint.
  resetPickItem: (pickListId: string, itemId: string) =>
    fetcher<Raw>(
      `/pick-lists/${pickListId}/items/${itemId}/reset`,
      { method: "POST", body: {} }
    ),
  scanPickItem: (
    pickListId: string,
    itemId: string,
    body: {
      binCode?: string;
      productCode?: string;
      qty: number;
      reasonCode?:
        | "ok"
        | "short_pick"
        | "damage"
        | "not_found"
        | "wrong_bin"
        | "substitute"
        | "other";
      remarks?: string | null;
      clientOpId?: string;
    }
  ) =>
    fetcher<Raw>(`/pick-lists/${pickListId}/items/${itemId}/scan`, {
      method: "POST",
      body,
    }),
  claimPackingSlip: (id: string) =>
    fetcher<Raw>(`/packing-slips/${id}/claim`, { method: "POST", body: {} }),
  releasePackingSlip: (id: string) =>
    fetcher<Raw>(`/packing-slips/${id}/release`, { method: "POST", body: {} }),
  scanPackItem: (
    packingSlipId: string,
    itemId: string,
    body: {
      productCode?: string;
      qty: number;
      reasonCode?:
        | "ok"
        | "short_pack"
        | "damage"
        | "substitute"
        | "other";
      remarks?: string | null;
      clientOpId?: string;
    }
  ) =>
    fetcher<Raw>(`/packing-slips/${packingSlipId}/items/${itemId}/scan`, {
      method: "POST",
      body,
    }),
  resolveLocation: (code: string) =>
    fetcher<Raw>("/locations/scan", { query: { code } }),
  recountBin: (
    binId: string,
    body: {
      qtyAfter: number;
      reasonCode:
        | "physical_match"
        | "damage"
        | "found_elsewhere"
        | "product_swap"
        | "spillage"
        | "expired"
        | "other";
      remarks?: string | null;
      clientOpId?: string;
    }
  ) => fetcher<Raw>(`/bins/${binId}/recount`, { method: "POST", body }),
  reassignBin: (
    binId: string,
    body: {
      productId: string;
      qty: number;
      reasonCode:
        | "physical_match"
        | "damage"
        | "found_elsewhere"
        | "product_swap"
        | "spillage"
        | "expired"
        | "other";
      remarks?: string | null;
      batch?: string | null;
      clientOpId?: string;
    }
  ) => fetcher<Raw>(`/bins/${binId}/reassign`, { method: "POST", body }),
  logScanEvent: (body: {
    kind: "bin" | "rack" | "shelf" | "zone" | "product" | "unknown";
    code: string;
    context?: string | null;
    outcome: "ok" | "mismatch" | "not_found";
  }) => fetcher<Raw>("/scan-events", { method: "POST", body }),
  scanEvents: (q?: { limit?: number; userId?: string; outcome?: string; kind?: string }) =>
    fetcher<Raw[]>("/scan-events", { query: q }),
  binCounts: (q?: { flagged?: "1"; binId?: string; limit?: number }) =>
    fetcher<Raw[]>("/bin-counts", { query: q }),

  // ===================================================== Mobile profile ===
  meWorker: () => fetcher<Raw>("/me/worker"),
  punchSelf: (direction: "in" | "out" | "break") =>
    fetcher<Raw>("/me/worker/punch", { method: "POST", body: { direction } }),
};

export { ApiError };

// ======================================================================
// Bulk-order helpers (file download + multipart upload – outside fetcher)
// ======================================================================

export interface BulkOrderPreview {
  dryRun: boolean;
  accepted: {
    productId: string;
    variantId: string | null;
    sku: string;
    productName: string;
    qty: number;
    rate: number;
    amount: number;
    discount: number;
    stockOnHand: number;
    stockWarning: boolean;
  }[];
  rejected: { sku: string; row: number; qty: number; reason: string }[];
  subTotal: number;
  tax: number;
  total: number;
  priceList: { id: string; code: string; name: string };
  customer: { id: string; name: string };
}

export interface BulkOrderImportResult {
  dryRun: false;
  quoteId: string;
  quoteNo: string;
  accepted: number;
  rejected: { sku: string; row: number; qty: number; reason: string }[];
  subTotal: number;
  tax: number;
  total: number;
  priceList: { id: string; code: string; name: string };
  customer: { id: string; name: string };
  stockWarnings: { sku: string; qty: number; stockOnHand: number }[];
}

/** Triggers a browser file download for the pricelist Excel. */
export const downloadPriceListXlsx = async (
  priceListId: string,
  opts: { includeOutOfStock?: boolean; customerId?: string } = {}
): Promise<void> => {
  const token = auth.token();
  const url = buildUrl(`/price-lists/${priceListId}/export.xlsx`, {
    includeOutOfStock: opts.includeOutOfStock ? "1" : "0",
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
  });
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: { message?: string } })?.error?.message ?? `Download failed (${res.status})`,
      body
    );
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "bulk-order.xlsx";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 100);
};

/** Sends the xlsx file to the server. Pass dryRun=true for preview. */
export const importQuoteXlsx = async (
  file: File,
  customerId: string,
  opts: { priceListId?: string; notes?: string; dryRun?: boolean } = {}
): Promise<BulkOrderPreview | BulkOrderImportResult> => {
  const token = auth.token();
  const url = buildUrl("/quotes/import-xlsx", {
    dryRun: opts.dryRun ? "1" : undefined,
  });
  // Non-file fields must come BEFORE the file in the FormData so that
  // @fastify/multipart can parse them before the file stream starts.
  const form = new FormData();
  form.append("customerId", customerId);
  if (opts.priceListId) form.append("priceListId", opts.priceListId);
  if (opts.notes) form.append("notes", opts.notes);
  form.append("file", file); // file last
  const res = await fetch(url, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: { message?: string } })?.error?.message ?? `Import failed (${res.status})`,
      body
    );
  }
  return res.json() as Promise<BulkOrderPreview | BulkOrderImportResult>;
};

// ─── Customer Returns / RMA ────────────────────────────────────────────────────

export interface CustomerReturnItemRow {
  id: string;
  customerReturnId: string;
  productId: string;
  variantId: string | null;
  invoiceItemId: string | null;
  qty: number;
  rate: number;
  amount: number;
  reason: string;
  reasonNotes: string | null;
  decision: "pending" | "approved" | "rejected";
  decisionNotes: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  product: { id: string; sku: string; name: string };
  variant: { id: string; sku: string; size: string | null } | null;
}

export interface CustomerReturnRow {
  id: string;
  returnNo: string;
  shareToken: string;
  customerId: string;
  invoiceId: string | null;
  status: "pending_approval" | "processed" | "cancelled";
  source: string;
  notes: string | null;
  subTotal: number;
  tax: number;
  total: number;
  importedById: string;
  finalizedById: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; code: string; name: string };
  invoice: { id: string; invoiceNo: string; amount: number } | null;
  items: CustomerReturnItemRow[];
  creditNote: { id: string; creditNoteNo: string; total: number; status: string } | null;
}

export interface CreditNoteRow {
  id: string;
  creditNoteNo: string;
  shareToken: string;
  customerId: string;
  customerReturnId: string;
  invoiceId: string | null;
  customerPaymentId: string | null;
  subTotal: number;
  tax: number;
  total: number;
  status: string;
  notes: string | null;
  createdAt: string;
  createdById: string;
  customer: { id: string; code: string; name: string; gst: string | null };
  invoice: { id: string; invoiceNo: string; amount: number; date: string } | null;
  customerReturn: { id: string; returnNo: string; createdAt: string };
  items: {
    id: string;
    productId: string;
    variantId: string | null;
    qty: number;
    rate: number;
    amount: number;
    reason: string;
    returnItemId: string | null;
    product: { id: string; sku: string; name: string };
    variant: { id: string; sku: string; size: string | null } | null;
  }[];
}

export interface ReturnImportPreview {
  dryRun: true;
  accepted: {
    productId: string;
    variantId: string | null;
    invoiceItemId: string;
    sku: string;
    productName: string;
    qty: number;
    rate: number;
    amount: number;
    reason: string;
    reasonNotes: string | undefined;
  }[];
  rejected: { sku: string; row: number; qty: number; reason: string }[];
  subTotal: number;
  tax: number;
  total: number;
  customer: { id: string; name: string; code: string };
  invoice: { id: string; invoiceNo: string } | null;
}

export interface ReturnImportResult {
  dryRun: false;
  returnId: string;
  returnNo: string;
  accepted: number;
  rejected: { sku: string; row: number; qty: number; reason: string }[];
  subTotal: number;
  tax: number;
  total: number;
  customer: { id: string; name: string; code: string };
}

export const importReturnXlsx = async (
  file: File,
  customerId: string,
  opts: { invoiceId?: string; notes?: string; dryRun?: boolean } = {}
): Promise<ReturnImportPreview | ReturnImportResult> => {
  const token = auth.token();
  const url = buildUrl("/returns/import-xlsx", {
    dryRun: opts.dryRun ? "1" : undefined,
  });
  // Non-file fields must come BEFORE the file in the FormData so that
  // @fastify/multipart can parse them before the file stream starts.
  const form = new FormData();
  form.append("customerId", customerId);
  if (opts.invoiceId) form.append("invoiceId", opts.invoiceId);
  if (opts.notes) form.append("notes", opts.notes);
  form.append("file", file); // file last
  const res = await fetch(url, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: { message?: string } })?.error?.message ??
        `Return import failed (${res.status})`,
      body
    );
  }
  return res.json() as Promise<ReturnImportPreview | ReturnImportResult>;
};

export const downloadReturnTemplate = async (): Promise<void> => {
  const token = auth.token();
  const url = buildUrl("/returns/template.xlsx");
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Failed to download template");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "returns-template.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
};
