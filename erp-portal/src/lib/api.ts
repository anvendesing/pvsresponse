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

/** Turn DB paths like /uploads/products/I61.jpg into a browser-loadable URL.
 *  Directory-based image sets (new pipeline, no extension) resolve to medium.jpg.
 *  Legacy flat-file paths (e.g. /uploads/products/abc.jpg) are returned as-is. */
export function resolveUploadUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/uploads")) return url;
  // If the path has no file extension it is a directory-based image set —
  // append /medium.jpg so the browser can load an actual file.
  const withFile = /\.\w{2,5}(\?.*)?$/.test(url) ? url : `${url}/medium.jpg`;
  if (API_URL) return `${API_URL}${withFile}`;
  return withFile;
}

const TOKEN_KEY = "nova.token";
const USER_KEY = "nova.user";

export interface MoWoLogRow {
  moId: string;
  orderNo: string;
  moStatus: string;
  moStartDate: string;
  moDueDate: string;
  moCreatedAt: string;
  moUpdatedAt: string;
  plannedQty: number;
  actualQty: number;
  scrapQty: number;
  efficiency: number;
  productSku: string;
  productName: string;
  variantSize: string | null;
  facilityCode: string | null;
  facilityName: string | null;
  woId: string;
  workOrderNo: string;
  woStatus: string;
  woStartTime: string | null;
  woEndTime: string | null;
  durationMin: number | null;
  output: number;
  target: number;
  splitSeq: number;
  qaStatus: string | null;
  lineCode: string | null;
  lineName: string | null;
  lineCapacityPerHour: number | null;
  machineCode: string | null;
  machineName: string | null;
  machineStatus: string | null;
  operationSeq: number | null;
  operationName: string | null;
  plannedMinutes: number | null;
  workers: string[];
  targetVsActualPct: number | null;
  timeVsPlanPct: number | null;
  utilizationPct: number | null;
  materialsConsumed: number;
}

export interface MoWoLogResponse {
  rangeDays: number;
  since: string;
  totals: { woCount: number; moCount: number; totalOutput: number; totalRunMin: number };
  rows: MoWoLogRow[];
}

export interface MachineUtilizationRow {
  machineId: string;
  machineCode: string;
  machineName: string;
  machineStatus: string;
  lineCode: string | null;
  lineName: string | null;
  facilityCode: string | null;
  facilityName: string | null;
  capacityPerHour: number | null;
  woCount: number;
  completedCount: number;
  runMin: number;
  availableMin: number;
  utilizationPct: number;
  output: number;
  throughputPerHour: number;
  capacityUtilizationPct: number | null;
}

export interface MachineUtilizationResponse {
  rangeDays: number;
  hoursPerDay: number;
  since: string;
  totals: { machines: number; woCount: number; runMin: number; output: number; avgUtilizationPct: number };
  rows: MachineUtilizationRow[];
}

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

// Download helper: fetch a non-JSON endpoint (CSV, PDF, etc.) using the
// signed-in user's bearer token and trigger a browser download. Used by
// the reports pages for `?format=csv` downloads where we can't just
// link to the URL (the bearer token isn't in the URL).
export const downloadFile = async (
  path: string,
  filename: string,
  opts: Options = {}
): Promise<void> => {
  if (!apiEnabled) throw new ApiError(0, "API disabled");
  const headers: Record<string, string> = {};
  const token = auth.token();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick before revoking so Safari doesn't cancel
  // the download mid-flight.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  BomOperation,
  DispatchOrder,
  Enquiry,
  EnquiryInput,
  EnquiryItemInput,
  EnquiryStats,
  Invoice,
  Product,
  ProductVariant,
  ProductionOrder,
  PurchaseOrder,
  StockLedgerEntry,
  Uom,
  UomCategory,
  Vendor,
  VendorPerformance,
  VendorProduct,
  WorkOrder,
  Worker,
} from "@/data/types";

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  addressLine?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
  distanceKm?: number | null;
  dispatchPincode?: string | null;
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
  documentSeriesId?: string | null;
  documentSeries?: {
    id: string;
    code: string;
    name: string;
    prefix: string;
    pattern: string;
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
  breakdown?: {
    invoiceRemainder: number;
    openSOCommitment: number;
    unallocatedAdvance: number;
  };
  /**
   * Every SO that's still padding the customer's open AR — covers
   * 'partially_invoiced' as well as 'confirmed' / 'on_hold' SOs that
   * have an issued invoice but a remaining qty (warehouse shortfall
   * cases). Each entry is actionable from the AR drawer banner.
   */
  partiallyInvoicedSOs?: {
    id: string;
    soNo: string;
    status: string;
    total: number;
    invoicedFraction: number;
    remainingCommitment: number;
    remainingQty: number;
    hasIssuedInvoice: boolean;
  }[];
  entries: StatementEntry[];
}

export interface CustomerInput {
  code?: string;
  name: string;
  addressLine: string;
  city: string;
  district?: string | null;
  state?: string | null;
  pincode: string;
  gst?: string | null;
  contact?: string | null;
  creditLimit?: number;
  priceListId?: string | null;
  documentSeriesId?: string | null;
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
  kind: string; // "storage" | "production"
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
  kind?: string;
  active?: boolean;
}

// =====================================================================
// Putaway rules
// =====================================================================

export interface ProductBinStockRow {
  binId: string;
  warehouseId: string;
  warehouse: string;
  warehouseName: string;
  location: string;
  zone: string;
  shelf: string;
  bin: string;
  qty: number;
  reserved: number;
  free: number;
}

export interface ProductBinStockResult {
  total: number;
  free: number;
  bins: ProductBinStockRow[];
}

export interface InventoryLocationBinRow {
  binId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseKind: string;
  location: string;
  zone: string;
  shelf: string;
  bin: string;
  qty: number;
  reserved: number;
  free: number;
  /**
   * Variant attribution of *this specific bin*. NULL means the bin
   * stores the parent product in bulk form (e.g. drum of CAOL bulk
   * castor oil). The InventoryLocationsPanel chip uses this rather
   * than the parent-product-level `matchedVariant` so each bin shows
   * its own SKU instead of one variant being painted across all bins.
   */
  variantId?: string | null;
  variantSku?: string | null;
  variantSize?: string | null;
  variantUom?: string | null;
}

export interface InventoryLocationMatch {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  counterOnHand: number;
  binTotal: number;
  binFree: number;
  matchedVariant: {
    id: string;
    sku: string;
    label: string;
    stockOnHand: number;
    packSize: number;
  } | null;
  bins: InventoryLocationBinRow[];
}

export interface PutawayRuleRow {
  id: string;
  productId: string;
  variantId: string | null;
  toWarehouseId: string;
  toZone: string | null;
  toBinId: string | null;
  priority: number;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string; uom: string; barcode: string };
  variant: { id: string; sku: string; size: string | null; barcode: string | null } | null;
  toWarehouse: { id: string; code: string; name: string; kind: string };
  tobin: { id: string; code: string | null; zone: string; shelf: string; bin: string } | null;
}

// =====================================================================
// Stock rules (min-qty triggers)
// =====================================================================

export interface StockRuleRow {
  id: string;
  productId: string;
  variantId: string | null;
  monitorBinId: string | null;
  minQty: number;
  maxQty: number | null;
  orderMultiple: number | null;
  triggerType: "mo" | "transfer" | "po";
  vendorId: string | null;
  bomId: string | null;
  sourceBinId: string | null;
  toWarehouseId: string | null;
  toBinId: string | null;
  tags: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string; barcode: string | null };
  variant: {
    id: string;
    sku: string;
    size: string | null;
    color: string | null;
    barcode: string | null;
  } | null;
  monitorBin: {
    id: string;
    zone: string;
    shelf: string;
    bin: string;
    qty: number;
    warehouse: { id: string; code: string };
  } | null;
  bom: { id: string; revision: string; outputQty: number } | null;
  sourceBin: {
    id: string;
    zone: string;
    shelf: string;
    bin: string;
    warehouse: { code: string };
  } | null;
  toBin: {
    id: string;
    zone: string;
    shelf: string;
    bin: string;
    warehouse: { code: string };
  } | null;
  toWarehouse: { id: string; code: string; name: string } | null;
  vendor: { id: string; code: string; name: string } | null;
  effectiveStock?: {
    onHand: number;
    poPipeline: number;
    moPipeline: number;
    effective: number;
  };
}

// =====================================================================
// Transfer orders
// =====================================================================

export interface TransferOrderItem {
  id: string;
  transferOrderId: string;
  productId: string;
  variantId: string | null;
  qtyRequested: number;
  qtyPicked: number;
  qtyDropped: number;
  fromBinId: string | null;
  toBinId: string | null;
  notes: string | null;
  product: { id: string; sku: string; name: string; uom: string };
  variant: { id: string; sku: string; size: string | null } | null;
  fromBin: {
    id: string;
    code: string | null;
    zone: string;
    shelf: string;
    bin: string;
    qty: number;
    reservedQty?: number;
  } | null;
  tobin: { id: string; code: string | null; zone: string; shelf: string; bin: string; qty: number } | null;
}

export interface TransferOrderRow {
  id: string;
  transferNo: string;
  kind: "putaway" | "replenishment" | "manual";
  status: "draft" | "ready" | "in_transit" | "done" | "cancelled";
  fromWarehouseId: string;
  toWarehouseId: string;
  productionOrderId: string | null;
  assignedToId: string | null;
  claimedAt: string | null;
  pickedById: string | null;
  pickedAt: string | null;
  droppedById: string | null;
  droppedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
  fromWarehouse: { id: string; code: string; name: string; kind: string };
  toWarehouse: { id: string; code: string; name: string; kind: string };
  productionOrder: { id: string; orderNo: string; status: string } | null;
  assignedTo: { id: string; name: string; username: string } | null;
  pickedBy: { id: string; name: string } | null;
  droppedBy: { id: string; name: string } | null;
  items: TransferOrderItem[];
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
  validFrom?: string | null;
  validUntil?: string | null;
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
const adaptBin = (r: Raw): Bin => {
  const product = r.product as Raw | null;
  const variant = r.variant as Raw | null;
  return {
    id: r.id as string,
    warehouse:
      (r.warehouseCode as string) ??
      (r.warehouse as string) ??
      (r.warehouseId as string),
    warehouseName: (r.warehouseName as string) ?? undefined,
    zone: r.zone as string,
    shelf: r.shelf as string,
    bin: r.bin as string,
    capacity: r.capacity as number,
    occupied: r.occupied as number,
    qty: r.qty as number,
    batch: (r.batch as string) ?? undefined,
    productId: (r.productId as string | null) ?? null,
    productSku: (product?.sku as string) ?? undefined,
    productName: (product?.name as string) ?? undefined,
    variantId: (r.variantId as string | null) ?? null,
    variantSku: (variant?.sku as string | null) ?? null,
    variantSize: (variant?.size as string | null) ?? null,
    variantUom: (variant?.uom as string | null) ?? null,
    variantPackSize: (variant?.packSize as number | null) ?? null,
  };
};

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

/** Default bins for GRN receive (from putaway rules). */
export type GrnReceiveHint = {
  productId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  defaultBinId: string | null;
  defaultBinCode: string | null;
  defaultBinLabel: string | null;
  bins: Array<{
    id: string;
    code: string | null;
    zone: string;
    shelf: string;
    bin: string;
    label: string;
    qty: number;
    productId: string | null;
  }>;
};

/** Raw PO shape for mobile GRN — list endpoint includes line items. */
export type GrnPurchaseOrder = {
  id: string;
  poNo: string;
  status: string;
  vendorName: string;
  items: Array<{
    id: string;
    productId: string;
    qty: number;
    received: number;
    product: { sku: string; name: string; uom: string };
  }>;
};

const mapGrnPurchaseOrder = (r: Raw): GrnPurchaseOrder => {
  const v = r.vendor as Raw | null;
  return {
    id: r.id as string,
    poNo: r.poNo as string,
    status: r.status as string,
    vendorName: (v?.name as string) ?? "—",
    items: ((r.items as Raw[]) ?? []).map((i) => ({
      id: i.id as string,
      productId: i.productId as string,
      qty: i.qty as number,
      received: (i.received as number) ?? 0,
      product: i.product as { sku: string; name: string; uom: string },
    })),
  };
};

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
  const variant = (bom?.variant as Raw | null) ?? null;
  return {
    id: r.id as string,
    orderNo: r.orderNo as string,
    bomId: (r.bomId as string) ?? (bom?.id as string) ?? undefined,
    product: (product?.name as string) ?? "—",
    sku: (product?.sku as string) ?? "",
    variantId: (variant?.id as string | null) ?? (bom?.variantId as string | null) ?? null,
    variantSku: (variant?.sku as string | null) ?? null,
    variantSize: (variant?.size as string | null) ?? null,
    variantColor: (variant?.color as string | null) ?? null,
    plannedQty: r.plannedQty as number,
    actualQty: r.actualQty as number,
    scrapQty: r.scrapQty as number,
    reworkQty: r.reworkQty as number,
    status: r.status as ProductionOrder["status"],
    station: (r.station as string) ?? "",
    facilityId: (r.facilityId as string | null) ?? null,
    facility: (r.facility as ProductionOrder["facility"]) ?? null,
    lineId: (r.lineId as string | null) ?? null,
    line: (r.line as ProductionOrder["line"]) ?? null,
    startDate: r.startDate as string,
    dueDate: r.dueDate as string,
    efficiency: r.efficiency as number,
  };
};

const adaptWorkOrder = (r: Raw): WorkOrder => {
  const bomOp = r.bomOperation as Raw | null | undefined;
  const line = (r.line as Raw | null) ?? null;
  const machineRef = (r.machineRef as Raw | null) ?? null;
  return {
    id: r.id as string,
    workOrderNo: r.workOrderNo as string,
    productionOrderId: r.productionOrderId as string,
    station: r.station as string,
    workers:
      typeof r.workers === "string"
        ? (r.workers as string).split(",").map((w) => w.trim())
        : [],
    machine: (machineRef?.name as string) ?? (r.machine as string),
    startTime: (r.startTime as string) ?? "",
    endTime: (r.endTime as string) ?? undefined,
    output: r.output as number,
    target: r.target as number,
    status: r.status as WorkOrder["status"],
    bomOperationId: (r.bomOperationId as string | null) ?? null,
    bomOperation: bomOp
      ? {
          id: bomOp.id as string,
          seq: bomOp.seq as number,
          name: bomOp.name as string,
          requiresQa: bomOp.requiresQa as boolean | undefined,
        }
      : null,
    splitSeq: (r.splitSeq as number) ?? 0,
    plannedSplitQty: (r.plannedSplitQty as number | null) ?? null,
    qaStatus: (r.qaStatus as WorkOrder["qaStatus"]) ?? null,
    qaNotes: (r.qaNotes as string | null) ?? null,
    line: line
      ? { id: line.id as string, code: line.code as string, name: line.name as string }
      : null,
    machineRef: machineRef
      ? {
          id: machineRef.id as string,
          code: machineRef.code as string,
          name: machineRef.name as string,
        }
      : null,
    lineId: (r.lineId as string | null) ?? null,
    machineId: (r.machineId as string | null) ?? null,
    runs: Array.isArray(r.runs)
      ? (r.runs as Raw[]).map((rr) => {
          const m = rr.machine as Raw;
          const ln = (rr.line as Raw | null) ?? null;
          return {
            id: rr.id as string,
            workOrderId: rr.workOrderId as string,
            machineId: rr.machineId as string,
            lineId: (rr.lineId as string | null) ?? null,
            batchSeq: (rr.batchSeq as number) ?? 1,
            plannedQty: (rr.plannedQty as number | null) ?? null,
            inputQty: (rr.inputQty as number) ?? 0,
            goodQty: (rr.goodQty as number) ?? 0,
            scrapQty: (rr.scrapQty as number) ?? 0,
            status: rr.status as "queued" | "running" | "complete" | "abandoned",
            startTime: (rr.startTime as string | null) ?? null,
            endTime: (rr.endTime as string | null) ?? null,
            operator: (rr.operator as string | null) ?? null,
            notes: (rr.notes as string | null) ?? null,
            createdAt: (rr.createdAt as string | undefined) ?? undefined,
            machine: {
              id: m.id as string,
              code: m.code as string,
              name: m.name as string,
            },
            line: ln
              ? { id: ln.id as string, code: ln.code as string, name: ln.name as string }
              : null,
          };
        })
      : [],
  };
};

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
  variantSku: ((r.variant as Raw | null)?.sku as string) ?? null,
  variantSize: ((r.variant as Raw | null)?.size as string) ?? null,
  txnType: r.txnType as StockLedgerEntry["txnType"],
  ref: r.ref as string,
  qty: r.qty as number,
  warehouse: ((r.warehouse as Raw | null)?.code as string) ?? "",
  bin: (r.bin as string) ?? undefined,
  batch: (r.batch as string) ?? undefined,
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
/** Bin/warehouse trail for an MO (issue, receipt, transfers). */
export interface MoInventoryTrail {
  productionOrderId: string;
  orderNo: string;
  status: string;
  finishedGood: {
    productId: string;
    sku: string;
    name: string;
    /** Effective uom of the FG row — variant uom when BOM is variant-scoped, else the parent's bulk uom. */
    uom: string;
    /** Parent product's bulk uom (kg / L). Always populated. */
    parentUom?: string;
    variantId?: string | null;
    variantSku?: string | null;
    variantSize?: string | null;
    variantUom?: string | null;
    variantPackSize?: number | null;
  };
  productionLineWarehouse: {
    code: string;
    name: string;
    kind: string;
  } | null;
  materialsConsumed: Array<{
    productId: string;
    sku: string;
    name: string;
    variantId?: string | null;
    variantSku?: string | null;
    variantSize?: string | null;
    variantUom?: string | null;
    variantPackSize?: number | null;
    warehouseCode: string;
    warehouseName: string;
    warehouseKind: string;
    binPath: string;
    qty: number;
    txnTypes: string[];
    lastDate: string;
  }>;
  finishedGoodsPosted: Array<{
    productId: string;
    sku: string;
    name: string;
    variantId?: string | null;
    variantSku?: string | null;
    variantSize?: string | null;
    variantUom?: string | null;
    variantPackSize?: number | null;
    warehouseCode: string;
    warehouseName: string;
    warehouseKind: string;
    binPath: string;
    qty: number;
    txnTypes: string[];
    lastDate: string;
  }>;
  byproductsReleased: Array<{
    productId: string;
    sku: string;
    name: string;
    variantId?: string | null;
    variantSku?: string | null;
    variantSize?: string | null;
    variantUom?: string | null;
    variantPackSize?: number | null;
    warehouseCode: string;
    warehouseName: string;
    warehouseKind: string;
    binPath: string;
    qty: number;
    txnTypes: string[];
    lastDate: string;
  }>;
  transfers: Array<{
    id: string;
    transferNo: string;
    kind: string;
    status: string;
    fromWarehouseCode: string;
    fromWarehouseName: string;
    toWarehouseCode: string;
    toWarehouseName: string;
    items: Array<{
      sku: string;
      name: string;
      qtyRequested: number;
      qtyPicked: number;
      qtyDropped: number;
      fromBinPath: string | null;
      toBinPath: string | null;
    }>;
  }>;
  hasActivity: boolean;
}

export interface UomNormalizationResult {
  dryRun: boolean;
  appliedAt?: string;
  summary: {
    products: { total: number; willUpdate: number; unchanged: number; skipped: number };
    variants: { total: number; willUpdate: number; unchanged: number; skipped: number };
  };
  products: Array<{
    id: string;
    sku: string;
    name: string;
    type: string;
    currentUom: string;
    canonical: string | null;
    category: string | null;
    targetUom: string | null;
    action: "update" | "noop" | "skip";
    reason?: string;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    productSku: string;
    currentUom: string | null;
    targetUom: string;
    action: "update" | "noop";
    active: boolean;
  }>;
}

export interface MoRequirements {
  productionOrderId: string;
  plannedFor: number;
  orderNo: string;
  status: string;
  anyShortage: boolean;
  allFullyIssued: boolean;
  materialsIssued: boolean;
  /** When set, onHand/free/shortage are scoped to the facility production WH. */
  stockScope?: "production_line" | "all";
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    uom: string;
    path: string[];
    required: number;
    issued: number;
    stillNeeded: number;
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
      const bomOp = item.bomOperation as Raw | null | undefined;
      return {
        id: item.id as string,
        productId: (item.productId as string) ?? (ip?.id as string),
        bomOperationId: (item.bomOperationId as string | null) ?? null,
        operationSeq: bomOp?.seq as number | undefined,
        sku: (ip?.sku as string) ?? "",
        name: (ip?.name as string) ?? "",
        qty: item.qty as number,
        uom: item.uom as string,
        scrapPct: item.scrapPct as number,
        hasSubAssembly,
      };
    }),
    operations: (() => {
      const opsRaw = (r.operations as Raw[]) ?? [];
      const opIdToSeq = new Map(
        opsRaw.map((o) => [o.id as string, o.seq as number])
      );
      return opsRaw.map((op) => ({
        id: op.id as string,
        seq: op.seq as number,
        name: op.name as string,
        description: (op.description as string | null) ?? null,
        facilityId: (op.facilityId as string | null) ?? null,
        lineId: (op.lineId as string | null) ?? null,
        machineId: (op.machineId as string | null) ?? null,
        durationMinutes: (op.durationMinutes as number | null) ?? null,
        requiresQa: (op.requiresQa as boolean) ?? true,
        blockedByOperationId: (op.blockedByOperationId as string | null) ?? null,
        blockedBySeq: op.blockedByOperationId
          ? opIdToSeq.get(op.blockedByOperationId as string)
          : undefined,
        line: (op.line as BomOperation["line"]) ?? null,
        eligibleLines: ((op.eligibleLines as Raw[]) ?? []).map((el) => ({
          line: el.line as { id: string; code: string; name: string },
        })),
        eligibleLineIds: ((op.eligibleLines as Raw[]) ?? []).map(
          (el) => ((el.line as Raw)?.id as string) ?? (el.lineId as string)
        ),
      }));
    })(),
    operationDependencies: (r.operationDependencies as boolean) ?? false,
    byproducts: ((r.byproducts as Raw[]) ?? []).map((bp) => {
      const pp = bp.product as Raw | null;
      const pv = bp.variant as Raw | null;
      return {
        id: bp.id as string,
        productId: (bp.productId as string) ?? (pp?.id as string),
        variantId: (bp.variantId as string | null) ?? null,
        sku: (pp?.sku as string) ?? "",
        name: (pp?.name as string) ?? "",
        qty: bp.qty as number,
        uom: bp.uom as string,
        costShare: (bp.costShare as number) ?? 0,
        variantSku: (pv?.sku as string) ?? null,
      };
    }),
    defaultFacilityId: (r.defaultFacilityId as string | null) ?? null,
    defaultFacility: (r.defaultFacility as Bom["defaultFacility"]) ?? null,
    defaultLineId: (r.defaultLineId as string | null) ?? null,
    defaultLine: (r.defaultLine as Bom["defaultLine"]) ?? null,
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
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number; barcode?: string };
  variant?: {
    id: string;
    sku: string;
    barcode?: string | null;
    uom?: string;
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
  transportCharge?: number;
  transportTax?: number;
  roundOff?: number;
  total: number;
  dispatchOption?: { code: string; name: string; category: string } | null;
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
    lineCode?: string;
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
  lineCode?: string;
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
  gstRate?: number | null;
  taxAmount?: number | null;
  taxableValue?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstAmount?: number | null;
  product: { id: string; sku: string; name: string; uom: string; hsn?: string | null; gstRate?: number | null; barcode?: string };
  variant?: {
    id: string;
    sku: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    uom?: string | null;
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
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  taxKind?: "intra" | "inter";
  placeOfSupplyState?: string | null;
  sellerState?: string | null;
  pricingInclusive?: boolean;
  transportCharge?: number;
  transportTax?: number;
  roundOff?: number;
  // Estimated shipping weight (kg). For pack-derived invoices this
  // mirrors the packing slip's cached weight (incl. actual scale
  // readings); for direct/walk-in it's summed from invoice items.
  totalWeightKg?: number;
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
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  taxKind?: "intra" | "inter";
  placeOfSupplyState?: string | null;
  amount: number;
  transportCharge?: number;
  transportTax?: number;
  roundOff?: number;
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
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  taxKind?: "intra" | "inter";
  placeOfSupplyState?: string | null;
  transportCharge?: number;
  transportTax?: number;
  roundOff?: number;
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
  transportCharge?: number;
  transportTax?: number;
  roundOff?: number;
  total: number;
  // Estimated shipping weight (kg) rolled up from item qty * variant
  // weight. Re-derived on every edit; carries to the SO on accept.
  totalWeightKg?: number;
  dispatchOptionId?: string | null;
  dispatchOption?: DispatchOptionRow | null;
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

export interface SalesOrderReservationRow {
  id: string;
  binId: string;
  qty: number;
  createdAt: string;
  bin?: {
    id: string;
    zone: string;
    shelf: string;
    bin: string;
    warehouse?: { id: string; code: string; name: string } | null;
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
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number; barcode?: string };
  variant?: {
    id: string;
    sku: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    uom?: string | null;
    stockOnHand: number;
  } | null;
  // Hard-reservation rows for this line. Sum of qty == bin units
  // currently locked against this SO line. Empty array on SOs that
  // pre-date the reservation feature, until the operator clicks
  // "Reserve stock" on the SO detail panel.
  reservations?: SalesOrderReservationRow[];
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
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  taxKind?: "intra" | "inter";
  placeOfSupplyState?: string | null;
  sellerState?: string | null;
  pricingInclusive?: boolean;
  transportCharge?: number;
  transportTax?: number;
  roundOff?: number;
  total: number;
  // Estimated shipping weight (kg). Inherited from quote and recomputed
  // on any line edit.
  totalWeightKg?: number;
  dispatchOptionId?: string | null;
  dispatchOption?: DispatchOptionRow | null;
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
  product?: { id: string; sku: string; name: string; uom: string; stockOnHand: number; barcode?: string };
  variant?: {
    id: string;
    sku: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    uom?: string | null;
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
  product?: {
    id: string;
    sku: string;
    name: string;
    uom: string;
    stockOnHand: number;
    barcode?: string | null;
    weightKg?: number | null;
  };
  variant?: {
    id: string;
    sku: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    stockOnHand: number;
    barcode?: string | null;
    weightKg?: number | null;
    uom?: string | null;
    packSize?: number | null;
  } | null;
}

export type ContainerKind = "box" | "bag" | "carton" | "sack" | "other";

export interface ContainerTypeRow {
  id: string;
  code: string;
  name: string;
  kind: ContainerKind;
  tareKg: number;
  maxKg?: number | null;
  active: boolean;
  sortOrder: number;
}

export type PackingContainerStatus = "open" | "sealed";

export interface PackingContainerItemRow {
  id: string;
  containerId: string;
  packingSlipItemId: string;
  qty: number;
  packingSlipItem?: {
    id: string;
    productId: string;
    variantId?: string | null;
    qtyPacked: number;
    qtyPicked: number;
    product?: { id: string; sku: string; name: string; barcode?: string | null };
    variant?: { id: string; sku: string; size?: string | null; barcode?: string | null } | null;
  };
}

export interface PackingContainerRow {
  id: string;
  packingSlipId: string;
  seq: number;
  label: string;
  containerTypeId?: string | null;
  containerType?: ContainerTypeRow | null;
  status: PackingContainerStatus;
  estWeightKg: number;
  actualWeightKg?: number | null;
  tareKgOverride?: number | null;
  notes?: string | null;
  sealedAt?: string | null;
  sealedById?: string | null;
  createdAt: string;
  updatedAt: string;
  items: PackingContainerItemRow[];
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
    subTotal?: number;
    tax?: number;
    cgstTotal?: number;
    sgstTotal?: number;
    igstTotal?: number;
    taxKind?: "intra" | "inter";
    total?: number;
    transportCharge?: number;
    transportTax?: number;
    roundOff?: number;
    dispatchOption?: { id: string; name: string; code: string } | null;
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
    tax?: number;
    cgstTotal?: number;
    sgstTotal?: number;
    igstTotal?: number;
    taxKind?: "intra" | "inter";
    transportCharge?: number;
    transportTax?: number;
    roundOff?: number;
    status: string;
    date: string;
  } | null;
  items: PackingSlipItemRow[];
  containers?: PackingContainerRow[];
  totalEstWeightKg?: number;
  totalActualWeightKg?: number | null;
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
  dispatchOptionId?: string | null;
  transportCharge?: number;
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
  dispatchOptionId?: string | null;
  transportCharge?: number;
  reason?: string;
  items?: QuoteCreatePayload["items"];
}

export interface DispatchOptionRow {
  id: string;
  code: string;
  name: string;
  category: string;
  description?: string | null;
  defaultCharge: number;
  active?: boolean;
  sortOrder?: number;
}

export interface PaymentGatewayConfigRow {
  id: string;
  gateway: string;
  mode: string;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  active: boolean;
  updatedAt: string;
}

export interface SmsProviderConfigRow {
  id: string;
  provider: string;
  mode: string;
  username: string | null;
  password: string | null;
  senderId: string | null;
  templateId: string | null;
  templateText: string | null;
  orderTemplateId?: string | null;
  orderTemplateText?: string | null;
  peid?: string | null;
  active: boolean;
  hasPassword?: boolean;
  updatedAt?: string;
}

export interface ShiprocketConfigRow {
  id: string;
  email: string | null;
  password: string | null;
  pickupPincode: string | null;
  active: boolean;
  hasPassword?: boolean;
  updatedAt: string;
}

export interface SystemEventLogRow {
  id: string;
  level: string;
  source: string;
  action: string;
  message: string;
  context: unknown;
  refId: string | null;
  createdAt: string;
}

export interface SystemLogSummary {
  since: string;
  counts: { source: string; level: string; count: number }[];
  recentErrors: {
    id: string;
    source: string;
    action: string;
    message: string;
    refId: string | null;
    createdAt: string;
  }[];
}

export interface CustomerActivityRow {
  id: string;
  anonId: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  sessionId: string | null;
  event: string;
  path: string | null;
  referer: string | null;
  productId: string | null;
  meta: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
}

export interface PaymentIntentRow {
  id: string;
  gateway: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  amount: number;
  status: string;
  email: string | null;
  phone: string | null;
  salesOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

// External-channel barcode/SKU mapping (Settings → Channel mappings).
// `resolved` is true when `internalSku` matches a Product or
// ProductVariant the catalog actually has. `productName` is hydrated by
// the backend so the table can show a friendly label without a second
// round-trip.
export interface ChannelMappingRow {
  id: string;
  channel: string;
  externalCode: string;
  internalSku: string;
  notes?: string | null;
  active: boolean;
  productName: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

// Returned by POST /v1/imported-orders/preview — what the operator
// sees BEFORE committing. The UI may edit qty/rate/internalSku per
// line before calling commit.
export interface ImportedOrderPreview {
  channel: string;
  parsed: {
    channelHint: string | null;
    customer: {
      externalCode: string | null;
      name: string | null;
      addressLine: string | null;
      landmark: string | null;
      city: string | null;
      pincode: string | null;
      phone: string | null;
    };
    shipping: {
      awb: string | null;
      externalOrderNo: string | null;
      courier: string | null;
    };
    invoice: {
      externalInvoiceNo: string | null;
      invoiceDate: string | null;
    };
    totals: {
      totalUnits: number | null;
      grandTotal: number | null;
    };
    rawText: string;
    unparsedItemLines: string[];
  };
  items: {
    externalCode: string;
    description: string;
    qty: number;
    rate: number;
    internalSku: string | null;
    productId: string | null;
    variantId: string | null;
    productName: string | null;
    status: "ok" | "no_map" | "no_sku";
    rawLine: string;
    note?: string;
  }[];
  customerMatch: {
    id: string;
    code: string;
    name: string;
    matchedBy: "phone" | "code";
  } | null;
  existingSo: { id: string; soNo: string; status: string } | null;
  counts: { total: number; ok: number; noMap: number; noSku: number };
}

export interface ImportedOrderCommitBody {
  channel: string;
  customer: {
    customerId?: string | null;
    externalCode?: string | null;
    name: string;
    addressLine?: string | null;
    landmark?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    phone?: string | null;
    gst?: string | null;
  };
  shipping: {
    awb?: string | null;
    externalOrderNo?: string | null;
    courier?: string | null;
  };
  invoice: {
    externalInvoiceNo?: string | null;
    invoiceDate?: string | null;
  };
  items: {
    externalCode: string;
    description?: string;
    internalSku: string;
    productId: string;
    variantId?: string | null;
    qty: number;
    rate: number;
  }[];
  notes?: string | null;
  forceReimport?: boolean;
}

export const DISPATCH_CATEGORY_LABELS: Record<string, string> = {
  door_to_door: "Door-to-Door Delivery",
  bulk_carrier: "Bulk Carriers (LTL / FTL)",
  company_vehicle: "Company Vehicle",
  rtc_cargo: "RTC / State Transport Cargo",
  bus_cargo: "Private Bus Cargo",
  railway: "Railway Parcel / Freight",
  courier: "Courier & Express Parcel",
  customer_pickup: "Customer Pick-up / Ex-works",
};

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
  pricingIncludesGst?: boolean;
  transportGstEnabled?: boolean;
  termsDefault: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  upi: string | null;
  // Manufacturing / fulfilment toggles surfaced in Settings.
  requireMoReleaseBeforeIssue?: boolean;
  packMultiContainerEnabled?: boolean;
  packRequireSealConfirmation?: boolean;
  pickSortByBinEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSeriesRow {
  id: string;
  code: string;
  name: string;
  documentType: string;
  prefix: string;
  pattern: string;
  padWidth: number;
  startNumber: number;
  nextNumber: number;
  resetPeriod: string;
  lastPeriodKey: string | null;
  channelSource: string | null;
  isDefault: boolean;
  active: boolean;
  previewNext?: string;
}

export interface DocumentSeriesInput {
  code: string;
  name: string;
  documentType?: "invoice";
  prefix: string;
  pattern: string;
  padWidth?: number;
  startNumber?: number;
  nextNumber?: number;
  resetPeriod?: "never" | "yearly" | "fiscal" | "monthly";
  channelSource?: "internal" | "imported" | "ecommerce" | "pos" | null;
  isDefault?: boolean;
  active?: boolean;
}

export interface InvoiceSeriesOption {
  id: string;
  code: string;
  name: string;
  prefix: string;
  pattern: string;
  channelSource: string | null;
  isDefault: boolean;
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
  productSupplyOutlook: (productId: string, variantId?: string | null) =>
    fetcher<import("@/data/types").ProductSupplyOutlook>(
      `/products/${productId}/supply-outlook`,
      { query: variantId ? { variantId } : undefined }
    ),
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
  // Bulk update products: GST rate, HSN code, and/or stock quantity.
  // Stock changes trigger put-away rule resolution + ledger entries.
  bulkUpdateProducts: (
    rows: Array<{
      productId: string;
      gstRate?: number | null;
      hsn?: string | null;
      stockQty?: number;
      warehouseId?: string;
    }>
  ) =>
    fetcher<{
      results: Array<{
        productId: string;
        ok: boolean;
        stockOnHand?: number;
        adjRef?: string;
        error?: string;
      }>;
    }>("/products/bulk-update", { method: "PATCH", body: { rows } }),
  // Bulk-coerce all product/variant UoMs to the house pattern: parents
  // in bulk units (kg/L), variants in pieces. Always returns a
  // structured plan; pass `apply: true` to actually run the updates.
  normalizeProductUoms: (apply = false) =>
    fetcher<UomNormalizationResult>("/products/normalize-uoms", {
      method: "POST",
      body: { apply },
    }),
  productCategories: (opts?: { active?: boolean }) =>
    fetcher<import("@/data/types").ProductCategory[]>("/categories", {
      query: opts?.active ? { active: "1" } : undefined,
    }),
  productCategory: (id: string) =>
    fetcher<import("@/data/types").ProductCategory>(`/categories/${id}`),
  createProductCategory: (body: {
    slug: string;
    name: string;
    sortOrder?: number;
    active?: boolean;
  }) =>
    fetcher<import("@/data/types").ProductCategory>("/categories", {
      method: "POST",
      body,
    }),
  updateProductCategory: (
    id: string,
    body: Partial<{
      slug: string;
      name: string;
      sortOrder: number;
      active: boolean;
    }>
  ) =>
    fetcher<import("@/data/types").ProductCategory>(`/categories/${id}`, {
      method: "PATCH",
      body,
    }),
  deleteProductCategory: (id: string) =>
    fetcher<{ deleted: true }>(`/categories/${id}`, { method: "DELETE" }),

  productConcerns: (opts?: { active?: boolean }) =>
    fetcher<import("@/data/types").ProductConcern[]>("/concerns", {
      query: opts?.active ? { active: "1" } : undefined,
    }),
  productConcern: (id: string) =>
    fetcher<import("@/data/types").ProductConcern>(`/concerns/${id}`),
  createProductConcern: (body: {
    slug: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
    active?: boolean;
  }) =>
    fetcher<import("@/data/types").ProductConcern>("/concerns", {
      method: "POST",
      body,
    }),
  updateProductConcern: (
    id: string,
    body: Partial<{
      slug: string;
      name: string;
      description: string | null;
      icon: string | null;
      sortOrder: number;
      active: boolean;
    }>
  ) =>
    fetcher<import("@/data/types").ProductConcern>(`/concerns/${id}`, {
      method: "PATCH",
      body,
    }),
  deleteProductConcern: (id: string) =>
    fetcher<{ deleted: true }>(`/concerns/${id}`, { method: "DELETE" }),

  // ---------- channel mappings (external SKU ↔ internal SKU) -----------
  channelMappings: (params?: { channel?: string; q?: string; onlyUnresolved?: boolean }) =>
    fetcher<ChannelMappingRow[]>("/channel-mappings", {
      query: {
        channel: params?.channel,
        q: params?.q,
        onlyUnresolved: params?.onlyUnresolved ? "true" : undefined,
      },
    }),
  channelMappingChannels: () =>
    fetcher<{ channel: string; count: number }[]>("/channel-mappings/channels"),
  createChannelMapping: (body: {
    channel: string;
    externalCode: string;
    internalSku: string;
    notes?: string | null;
  }) =>
    fetcher<ChannelMappingRow>("/channel-mappings", { method: "POST", body }),
  updateChannelMapping: (
    id: string,
    body: Partial<{
      channel: string;
      externalCode: string;
      internalSku: string;
      notes: string | null;
      active: boolean;
    }>
  ) =>
    fetcher<ChannelMappingRow>(`/channel-mappings/${id}`, {
      method: "PATCH",
      body,
    }),
  deleteChannelMapping: (id: string) =>
    fetcher<{ ok: true }>(`/channel-mappings/${id}`, { method: "DELETE" }),
  importChannelMappings: (body: {
    channel: string;
    replace?: boolean;
    rows: { externalCode: string; internalSku: string; notes?: string | null }[];
  }) =>
    fetcher<{
      channel: string;
      total: number;
      created: number;
      updated: number;
      skipped: number;
      unresolved: { externalCode: string; internalSku: string }[];
    }>("/channel-mappings/import", { method: "POST", body }),

  // ---------- imported sales orders (PDF upload pipeline) ---------------
  previewImportedOrder: async (file: File, channel = "DTDC"): Promise<ImportedOrderPreview> => {
    const token = auth.token();
    const form = new FormData();
    form.append("pdf", file);
    const res = await fetch(buildUrl("/imported-orders/preview", { channel }), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.error?.message ?? `${res.status}`, body?.error);
    }
    return (await res.json()) as ImportedOrderPreview;
  },
  commitImportedOrder: (body: ImportedOrderCommitBody) =>
    fetcher<Raw>("/imported-orders/commit", { method: "POST", body }),

  dispatchOptions: () => fetcher<DispatchOptionRow[]>("/dispatch-options"),
  settingsDispatchOptions: () =>
    fetcher<DispatchOptionRow[]>("/settings/dispatch-options"),
  dispatchCategories: () =>
    fetcher<{ code: string; label: string }[]>("/settings/dispatch-categories"),
  createDispatchOption: (body: {
    code: string;
    name: string;
    category: string;
    description?: string | null;
    defaultCharge?: number;
    active?: boolean;
    sortOrder?: number;
  }) =>
    fetcher<DispatchOptionRow>("/settings/dispatch-options", {
      method: "POST",
      body,
    }),
  updateDispatchOption: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      category: string;
      description: string | null;
      defaultCharge: number;
      active: boolean;
      sortOrder: number;
    }>
  ) =>
    fetcher<DispatchOptionRow>(`/settings/dispatch-options/${id}`, {
      method: "PATCH",
      body,
    }),
  deleteDispatchOption: (id: string) =>
    fetcher<{ ok: true }>(`/settings/dispatch-options/${id}`, { method: "DELETE" }),

  paymentGateways: () => fetcher<PaymentGatewayConfigRow[]>("/settings/payment-gateways"),
  paymentGateway: (gateway: string) =>
    fetcher<PaymentGatewayConfigRow>(`/settings/payment-gateways/${gateway}`),
  updatePaymentGateway: (
    gateway: string,
    body: Partial<{
      mode: "test" | "live";
      keyId: string | null;
      keySecret: string | null;
      webhookSecret: string | null;
      active: boolean;
    }>
  ) =>
    fetcher<PaymentGatewayConfigRow>(`/settings/payment-gateways/${gateway}`, {
      method: "PATCH",
      body,
    }),
  smsProvider: () => fetcher<SmsProviderConfigRow>("/settings/sms-provider"),
  updateSmsProvider: (
    body: Partial<{
      provider: "smsidea";
      mode: "test" | "live";
      username: string | null;
      password: string | null;
      senderId: string | null;
      templateId: string | null;
      templateText: string | null;
      orderTemplateId: string | null;
      orderTemplateText: string | null;
      peid: string | null;
      active: boolean;
    }>
  ) =>
    fetcher<SmsProviderConfigRow>("/settings/sms-provider", {
      method: "PATCH",
      body,
    }),
  testSmsProvider: (body: { phone: string; message?: string }) =>
    fetcher<{ ok: boolean; ref?: string }>("/settings/sms-provider/test", {
      method: "POST",
      body,
    }),

  shiprocketConfig: () => fetcher<ShiprocketConfigRow>("/settings/shiprocket"),
  updateShiprocketConfig: (
    body: Partial<{
      email: string | null;
      password: string | null;
      pickupPincode: string | null;
      active: boolean;
    }>
  ) =>
    fetcher<ShiprocketConfigRow>("/settings/shiprocket", {
      method: "PATCH",
      body,
    }),
  testShiprocketConfig: () =>
    fetcher<{ ok: boolean; message?: string }>("/settings/shiprocket/test", {
      method: "POST",
      body: {},
    }),

  systemLogs: (params?: {
    level?: "error" | "warn" | "info";
    source?: string;
    q?: string;
    limit?: number;
    before?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.level) qs.set("level", params.level);
    if (params?.source) qs.set("source", params.source);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.before) qs.set("before", params.before);
    const tail = qs.toString();
    return fetcher<{ rows: SystemEventLogRow[]; nextBefore: string | null }>(
      `/admin/system-logs${tail ? `?${tail}` : ""}`
    );
  },
  systemLogSummary: () => fetcher<SystemLogSummary>("/admin/system-logs/summary"),
  customerActivity: (params?: {
    customerId?: string;
    anonId?: string;
    event?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.customerId) qs.set("customerId", params.customerId);
    if (params?.anonId) qs.set("anonId", params.anonId);
    if (params?.event) qs.set("event", params.event);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.limit) qs.set("limit", String(params.limit));
    const tail = qs.toString();
    return fetcher<{ rows: CustomerActivityRow[] }>(
      `/admin/customer-activity${tail ? `?${tail}` : ""}`
    );
  },
  customerActivityTimeline: (customerId: string) =>
    fetcher<{ rows: CustomerActivityRow[] }>(
      `/admin/customer-activity/timeline/${encodeURIComponent(customerId)}`
    ),
  paymentIntents: (params?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.limit) qs.set("limit", String(params.limit));
    const tail = qs.toString();
    return fetcher<{ rows: PaymentIntentRow[] }>(`/admin/payment-intents${tail ? `?${tail}` : ""}`);
  },

  uploadCategoryImage: async (categoryId: string, file: File): Promise<{ imageUrl: string }> => {
    const token = auth.token();
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(buildUrl(`/categories/${categoryId}/image`), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.error?.message ?? `${res.status}`, body?.error);
    }
    return res.json();
  },
  uploadConcernImage: async (concernId: string, file: File): Promise<{ imageUrl: string }> => {
    const token = auth.token();
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(buildUrl(`/concerns/${concernId}/image`), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.error?.message ?? `${res.status}`, body?.error);
    }
    return res.json();
  },
  uploadProductImage: async (productId: string, file: File): Promise<{ imageUrl: string }> => {
    const token = auth.token();
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(buildUrl(`/products/${productId}/image`), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.error?.message ?? `${res.status}`, body?.error);
    }
    return res.json();
  },
  uploadVariantImage: async (productId: string, variantId: string, file: File): Promise<{ imageUrl: string }> => {
    const token = auth.token();
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(buildUrl(`/products/${productId}/variants/${variantId}/image`), {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.error?.message ?? `${res.status}`, body?.error);
    }
    return res.json();
  },
  // Stock reconciliation & location trace
  inventoryLocations: async (q: string): Promise<InventoryLocationMatch[]> => {
    const r = await fetcher<{ matches: InventoryLocationMatch[] }>("/inventory/locations", {
      query: { q },
    });
    return r.matches ?? [];
  },
  productBinStock: (productId: string): Promise<ProductBinStockResult> =>
    fetcher(`/products/${productId}/bin-stock`),
  syncProductStock: (productId: string): Promise<{ before: number; after: number; delta: number; binTotal: number }> =>
    fetcher(`/products/${productId}/sync-stock`, { method: "POST" }),
  adjustVariantStock: (productId: string, variantId: string, newQty: number): Promise<{ sku: string; before: number; after: number; delta: number }> =>
    fetcher(`/products/${productId}/variants/${variantId}/adjust-stock`, { method: "POST", body: { newQty } }),
  adjustStock: (body: {
    productId: string;
    // Variant SKU this adjustment targets. Required when the parent
    // product has variants (each variant lives in its own bin family
    // with its own UoM); omit only for products without variants or
    // for genuine bulk-only adjustments under the parent SKU.
    variantId?: string | null;
    warehouseId: string;
    qty: number;
    reason: string;
    binId?: string;
    location?: { zone: string; shelf?: string; bin?: string };
  }): Promise<{ ledger: StockLedgerEntry; newSoh: number }> =>
    fetcher(`/inventory/adjust`, { method: "POST", body }),
  // ── Enquiries / CRM ────────────────────────────────────────────────
  enquiryStats: (): Promise<EnquiryStats> => fetcher<EnquiryStats>("/enquiries/stats"),
  enquiries: (q?: {
    stage?: string;
    type?: string;
    assignedToId?: string;
    q?: string;
    followUpsDue?: string;
    limit?: string;
  }): Promise<Enquiry[]> => fetcher<Enquiry[]>("/enquiries", { query: q }),
  enquiry: (id: string): Promise<Enquiry> => fetcher<Enquiry>(`/enquiries/${id}`),
  createEnquiry: (body: EnquiryInput): Promise<Enquiry> =>
    fetcher<Enquiry>("/enquiries", { method: "POST", body }),
  updateEnquiry: (id: string, body: Partial<EnquiryInput>): Promise<Enquiry> =>
    fetcher<Enquiry>(`/enquiries/${id}`, { method: "PATCH", body }),
  setEnquiryItems: (id: string, items: EnquiryItemInput[]): Promise<Enquiry> =>
    fetcher<Enquiry>(`/enquiries/${id}/items`, { method: "PUT", body: { items } }),
  setEnquiryStage: (
    id: string,
    stage: string,
    lostReason?: string
  ): Promise<Enquiry> =>
    fetcher<Enquiry>(`/enquiries/${id}/stage`, {
      method: "PATCH",
      body: { stage, ...(lostReason ? { lostReason } : {}) },
    }),
  addEnquiryActivity: (
    id: string,
    body: { type?: string; body: string; outcome?: string | null; dueAt?: string | null }
  ): Promise<unknown> =>
    fetcher(`/enquiries/${id}/activities`, { method: "POST", body }),
  completeEnquiryTask: (id: string, actId: string): Promise<unknown> =>
    fetcher(`/enquiries/${id}/activities/${actId}/complete`, { method: "PATCH" }),
  convertEnquiry: (
    id: string,
    body?: {
      customerId?: string | null;
      name?: string | null;
      gst?: string | null;
      city?: string | null;
      contact?: string | null;
      priceListId?: string | null;
      creditLimit?: number | null;
      markWon?: boolean;
    }
  ): Promise<{ enquiry: Enquiry; customerId: string }> =>
    fetcher(`/enquiries/${id}/convert`, { method: "POST", body: body ?? {} }),
  deleteEnquiry: (id: string): Promise<{ ok: boolean }> =>
    fetcher(`/enquiries/${id}`, { method: "DELETE" }),
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
  // Single bin create. Backend uppercases zone/shelf/bin.
  createBin: async (
    warehouseId: string,
    body: { zone: string; shelf: string; bin: string; capacity?: number }
  ): Promise<Bin> =>
    adaptBin(
      await fetcher<Raw>(`/warehouses/${warehouseId}/bins`, {
        method: "POST",
        body,
      })
    ),
  // Bulk-create a shelf-set: N shelves x M bins each.
  bulkCreateBins: (
    warehouseId: string,
    body: {
      zone: string;
      shelves?: string[];
      shelfCount?: number;
      binsPerShelf: number;
      capacity?: number;
    }
  ) =>
    fetcher<{
      created: number;
      zone: string;
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
  renameZone: (warehouseId: string, zone: string, newZone: string) =>
    fetcher<{ updated: number; newZone: string }>(
      `/warehouses/${warehouseId}/zones/${encodeURIComponent(zone)}`,
      { method: "PATCH", body: { newZone } }
    ),
  deleteZone: (warehouseId: string, zone: string) =>
    fetcher<{ deleted: number }>(
      `/warehouses/${warehouseId}/zones/${encodeURIComponent(zone)}`,
      { method: "DELETE" }
    ),
  renameShelf: (warehouseId: string, zone: string, shelf: string, newShelf: string) =>
    fetcher<{ updated: number; newShelf: string }>(
      `/warehouses/${warehouseId}/zones/${encodeURIComponent(zone)}/shelves/${encodeURIComponent(shelf)}`,
      { method: "PATCH", body: { newShelf } }
    ),
  deleteShelf: (warehouseId: string, zone: string, shelf: string) =>
    fetcher<{ deleted: number }>(
      `/warehouses/${warehouseId}/zones/${encodeURIComponent(zone)}/shelves/${encodeURIComponent(shelf)}`,
      { method: "DELETE" }
    ),
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
  stockLots: (q?: {
    productId?: string;
    warehouseId?: string;
    includeEmpty?: boolean;
    limit?: number;
  }) =>
    fetcher<
      Array<{
        id: string;
        batchNo: string;
        qtyOnHand: number;
        receivedAt: string;
        expiryDate: string | null;
        sourceType: string;
        sourceRef: string;
        product: { sku: string; name: string; uom: string; type: string; batchTracked: boolean };
        warehouse: { code: string; name: string };
        bin: { zone: string; shelf: string; bin: string; code: string | null } | null;
      }>
    >("/inventory/lots", { query: q as Record<string, string | undefined> }),
  valuation: () => fetcher<Raw[]>("/valuation"),

  // Manufacturing
  productionOrders: async (q?: {
    facilityId?: string;
    status?: string;
  }): Promise<ProductionOrder[]> =>
    (
      await fetcher<Raw[]>("/production-orders", {
        query: {
          ...(q?.facilityId ? { facilityId: q.facilityId } : {}),
          ...(q?.status ? { status: q.status } : {}),
        },
      })
    ).map(adaptProductionOrder),
  productionOrdersWithWO: async (q?: {
    facilityId?: string;
  }): Promise<{ orders: ProductionOrder[]; workOrders: WorkOrder[] }> => {
    const raw = await fetcher<Raw[]>("/production-orders", {
      query: q?.facilityId ? { facilityId: q.facilityId } : undefined,
    });
    const orders = raw.map(adaptProductionOrder);
    const workOrders: WorkOrder[] = [];
    for (const r of raw) {
      for (const wo of (r.workOrders as Raw[]) ?? []) workOrders.push(adaptWorkOrder(wo));
    }
    return { orders, workOrders };
  },
  productionOrder: (id: string) => fetcher<Raw>(`/production-orders/${id}`),
  getProductionOrder: async (
    id: string
  ): Promise<{
    order: ProductionOrder;
    workOrders: WorkOrder[];
  }> => {
    const raw = await fetcher<Raw>(`/production-orders/${id}`);
    return {
      order: adaptProductionOrder(raw),
      workOrders: ((raw.workOrders as Raw[]) ?? []).map(adaptWorkOrder),
    };
  },
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
    // this BOM prefill their facility/line/machine fields.
    defaultFacilityId?: string | null;
    defaultLineId?: string | null;
    defaultMachineId?: string | null;
    operationDependencies?: boolean;
    operations?: Array<{
      seq: number;
      name: string;
      description?: string;
      facilityId?: string | null;
      lineId?: string | null;
      machineId?: string | null;
      durationMinutes?: number | null;
      requiresQa?: boolean;
      blockedBySeq?: number | null;
      eligibleLineIds?: string[];
    }>;
    items?: Array<{
      productId: string;
      qty: number;
      uom: string;
      scrapPct?: number;
      operationSeq?: number;
    }>;
    byproducts?: Array<{
      productId: string;
      variantId?: string | null;
      qty: number;
      uom: string;
      costShare?: number;
    }>;
  }) => fetcher<Raw>("/boms", { method: "POST", body }),
  updateBom: (
    id: string,
    body: {
      revision?: string;
      outputQty?: number;
      active?: boolean;
      defaultFacilityId?: string | null;
      defaultLineId?: string | null;
      defaultMachineId?: string | null;
      operationDependencies?: boolean;
      operations?: Array<{
        seq: number;
        name: string;
        description?: string;
        facilityId?: string | null;
        lineId?: string | null;
        machineId?: string | null;
        durationMinutes?: number | null;
        requiresQa?: boolean;
        blockedBySeq?: number | null;
        eligibleLineIds?: string[];
      }>;
      items?: Array<{
        productId: string;
        qty: number;
        uom: string;
        scrapPct?: number;
        operationSeq?: number;
      }>;
      byproducts?: Array<{
        productId: string;
        variantId?: string | null;
        qty: number;
        uom: string;
        costShare?: number;
      }>;
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
  // ---- Production master data: facilities, lines, machines ----

  // Production facilities (e.g. "Soap Room"). Each facility may have
  // many production lines nested inside.
  productionFacilities: (q?: { active?: boolean }) =>
    fetcher<import("../data/types.js").ProductionFacility[]>("/production-facilities", {
      query: q?.active !== undefined ? { active: q.active ? "1" : "0" } : undefined,
    }),
  createProductionFacility: (body: {
    code: string;
    name: string;
    description?: string | null;
    capacityPerHour?: number | null;
    productionLineWarehouseId?: string | null;
    productionZone?: string | null;
    replenishWarehouseCodes?: string | null;
    autoCreateProductionWarehouse?: boolean;
    active?: boolean;
  }) => fetcher<Raw>("/production-facilities", { method: "POST", body }),
  updateProductionFacility: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      description: string | null;
      capacityPerHour: number | null;
      productionLineWarehouseId: string | null;
      productionZone: string | null;
      replenishWarehouseCodes: string | null;
      autoCreateProductionWarehouse: boolean;
      active: boolean;
    }>
  ) => fetcher<Raw>(`/production-facilities/${id}`, { method: "PATCH", body }),
  deleteProductionFacility: (id: string) =>
    fetcher<{ deleted?: boolean; softDeleted?: boolean; message?: string }>(
      `/production-facilities/${id}`,
      { method: "DELETE" }
    ),

  // Production lines (e.g. "Boiling Line") nested under a facility.
  productionLines: (q?: { facilityId?: string; active?: boolean }) =>
    fetcher<import("../data/types.js").ProductionLine[]>("/production-lines", {
      query: {
        ...(q?.facilityId ? { facilityId: q.facilityId } : {}),
        ...(q?.active !== undefined ? { active: q.active ? "1" : "0" } : {}),
      },
    }),
  createProductionLine: (body: {
    code: string;
    name: string;
    description?: string | null;
    facilityId: string;
    capacityPerHour?: number | null;
    active?: boolean;
  }) => fetcher<Raw>("/production-lines", { method: "POST", body }),
  updateProductionLine: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      description: string | null;
      facilityId: string;
      capacityPerHour: number | null;
      active: boolean;
    }>
  ) => fetcher<Raw>(`/production-lines/${id}`, { method: "PATCH", body }),
  deleteProductionLine: (id: string) =>
    fetcher<{ deleted?: boolean; softDeleted?: boolean; message?: string }>(
      `/production-lines/${id}`,
      { method: "DELETE" }
    ),

  // Legacy alias — keeps existing Settings components working until they
  // are migrated to productionFacilities. Prefer productionFacilities in new code.
  workCenters: (q?: { active?: boolean }) =>
    fetcher<import("../data/types.js").ProductionFacility[]>("/production-facilities", {
      query: q?.active !== undefined ? { active: q.active ? "1" : "0" } : undefined,
    }),

  machines: (q?: { productionLineId?: string; facilityId?: string; active?: boolean }) =>
    fetcher<import("../data/types.js").Machine[]>("/machines", {
      query: {
        ...(q?.productionLineId ? { productionLineId: q.productionLineId } : {}),
        ...(q?.facilityId ? { facilityId: q.facilityId } : {}),
        ...(q?.active !== undefined ? { active: q.active ? "1" : "0" } : {}),
      },
    }),
  createMachine: (body: {
    code: string;
    name: string;
    productionLineId: string;
    status?: "running" | "idle" | "maintenance" | "broken";
    description?: string | null;
    active?: boolean;
  }) => fetcher<Raw>("/machines", { method: "POST", body }),
  updateMachine: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      productionLineId: string;
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
    // New FK fields: facilityId defaults to BOM.defaultFacilityId.
    // lineId may stay null (supervisor assigns later).
    facilityId?: string;
    lineId?: string;
    // Legacy free-text kept for backward compat.
    station?: string;
    machine?: string;
    plannedQty: number;
    startDate: string;
    dueDate: string;
  }) => fetcher<Raw>("/production-orders", { method: "POST", body }),

  // Supervisor action: assign MO (and optionally its WOs) to a production line.
  assignMoToLine: (
    moId: string,
    body: {
      lineId: string;
      workOrderAssignments?: Array<{
        workOrderId: string;
        lineId?: string;
        machineId?: string | null;
      }>;
    }
  ) => fetcher<Raw>(`/production-orders/${moId}/assign-line`, { method: "PATCH", body }),

  assignMoWorkOrder: (
    moId: string,
    woId: string,
    body: { lineId?: string; machineId?: string | null }
  ) =>
    fetcher<Raw>(`/production-orders/${moId}/work-orders/${woId}/assign`, {
      method: "PATCH",
      body,
    }),

  splitMoOperation: (
    moId: string,
    body: {
      bomOperationId: string;
      splits: Array<{ lineId: string; machineId?: string | null; qty: number }>;
    }
  ) =>
    fetcher<{ workOrders: Raw[] }>(`/production-orders/${moId}/split-operation`, {
      method: "POST",
      body,
    }),

  startMoWorkOrder: (moId: string, woId: string) =>
    fetcher<Raw>(`/production-orders/${moId}/work-orders/${woId}/start`, {
      method: "POST",
      body: {},
    }),

  completeMoWorkOrder: (moId: string, woId: string) =>
    fetcher<{ needsQa: boolean; workOrder: Raw }>(
      `/production-orders/${moId}/work-orders/${woId}/done`,
      { method: "POST", body: {} }
    ),

  qaMoWorkOrder: (
    moId: string,
    woId: string,
    body: { pass: boolean; notes?: string }
  ) =>
    fetcher<{ action: string; workOrder: Raw }>(
      `/production-orders/${moId}/work-orders/${woId}/qa`,
      { method: "POST", body }
    ),

  // Multi-machine parallel runs inside a WO. Each run is one machine
  // consuming part of the raw material and producing part of the output.
  addWorkOrderRun: (
    moId: string,
    woId: string,
    body: {
      machineId: string;
      lineId?: string | null;
      plannedQty?: number | null;
      operator?: string | null;
    }
  ) =>
    fetcher<Raw>(`/production-orders/${moId}/work-orders/${woId}/runs`, {
      method: "POST",
      body,
    }),
  startWorkOrderRun: (moId: string, woId: string, runId: string) =>
    fetcher<Raw>(
      `/production-orders/${moId}/work-orders/${woId}/runs/${runId}/start`,
      { method: "POST", body: {} }
    ),
  logWorkOrderRun: (
    moId: string,
    woId: string,
    runId: string,
    body: {
      goodQty?: number;
      scrapQty?: number;
      inputQty?: number;
      notes?: string | null;
      operator?: string | null;
      byproducts?: Array<{ bomByproductId: string; qty: number }>;
    }
  ) =>
    fetcher<Raw>(
      `/production-orders/${moId}/work-orders/${woId}/runs/${runId}`,
      { method: "PATCH", body }
    ),
  completeWorkOrderRun: (
    moId: string,
    woId: string,
    runId: string,
    body?: {
      goodQty?: number;
      scrapQty?: number;
      inputQty?: number;
      notes?: string | null;
      byproducts?: Array<{ bomByproductId: string; qty: number }>;
    }
  ) =>
    fetcher<Raw>(
      `/production-orders/${moId}/work-orders/${woId}/runs/${runId}/complete`,
      { method: "POST", body: body ?? {} }
    ),
  abandonWorkOrderRun: (moId: string, woId: string, runId: string) =>
    fetcher<Raw>(
      `/production-orders/${moId}/work-orders/${woId}/runs/${runId}/abandon`,
      { method: "POST", body: {} }
    ),
  deleteWorkOrderRun: (moId: string, woId: string, runId: string) =>
    fetcher<{ id: string }>(
      `/production-orders/${moId}/work-orders/${woId}/runs/${runId}`,
      { method: "DELETE" }
    ),

  productionOrderRequirements: (id: string) =>
    fetcher<MoRequirements>(`/production-orders/${id}/requirements`),
  productionOrderInventoryTrail: (id: string) =>
    fetcher<MoInventoryTrail>(`/production-orders/${id}/inventory-trail`),
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
    body: {
      goodQty?: number;
      scrapQty?: number;
      reworkQty?: number;
      // Optional per-batch byproduct yields. Each entry posts to
      // inventory immediately (StockLedger + Bin update). Once any
      // byproduct is logged this way, /complete skips its auto-yield
      // path so the released components don't get double-posted.
      byproducts?: Array<{ bomByproductId: string; qty: number }>;
    }
  ) =>
    fetcher<
      Raw & {
        byproductPostings?: Array<{
          bomByproductId: string;
          productId: string;
          variantId: string | null;
          sku: string;
          name: string;
          qty: number;
          uom: string;
          bin: string;
        }>;
      }
    >(`/production-orders/${id}/log-output`, {
      method: "POST",
      body,
    }),
  adjustOutput: (
    id: string,
    body: {
      actualQty: number;
      scrapQty: number;
      reworkQty: number;
      reason?: string;
    }
  ) =>
    fetcher<Raw>(`/production-orders/${id}/adjust-output`, {
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
      putawayTransferOrderId: string | null;
    }>(`/production-orders/${id}/complete`, { method: "POST", body: body ?? {} }),
  releaseMo: (id: string) =>
    fetcher<{
      shortages: Array<{ productId: string; sku: string; required: number; available: number; shortage: number }>;
      transferOrderIds: string[];
      allMet: boolean;
    }>(`/production-orders/${id}/release`, { method: "POST", body: {} }),
  cancelMo: (id: string) =>
    fetcher<{
      productionOrderId: string;
      orderNo: string;
      transfersCancelled: number;
      issuesReversed: number;
    }>(`/production-orders/${id}/cancel`, { method: "POST", body: {} }),
  updateWorkOrder: (
    id: string,
    body: { status?: "queued" | "running" | "paused" | "complete"; output?: number }
  ) => fetcher<Raw>(`/work-orders/${id}`, { method: "PATCH", body }),

  // ---- Putaway rules ----
  putawayRules: (q?: { productId?: string; active?: boolean }) =>
    fetcher<PutawayRuleRow[]>("/putaway-rules", {
      query: {
        ...(q?.productId ? { productId: q.productId } : {}),
        ...(q?.active !== undefined ? { active: q.active ? "1" : "0" } : {}),
      },
    }),
  createPutawayRule: (body: {
    productId: string;
    variantId?: string | null;
    toWarehouseId: string;
    toZone?: string | null;
    toBinId?: string | null;
    priority?: number;
    active?: boolean;
    notes?: string | null;
  }) => fetcher<PutawayRuleRow>("/putaway-rules", { method: "POST", body }),
  updatePutawayRule: (
    id: string,
    body: Partial<{
      toWarehouseId: string;
      toZone: string | null;
      toBinId: string | null;
      priority: number;
      active: boolean;
      notes: string | null;
    }>
  ) => fetcher<PutawayRuleRow>(`/putaway-rules/${id}`, { method: "PATCH", body }),
  deletePutawayRule: (id: string) =>
    fetcher<{ deleted: boolean }>(`/putaway-rules/${id}`, { method: "DELETE" }),

  // ---- Stock rules ----
  stockRules: (q?: { productId?: string; variantId?: string; active?: boolean }) =>
    fetcher<StockRuleRow[]>("/stock-rules", {
      query: {
        ...(q?.productId ? { productId: q.productId } : {}),
        ...(q?.variantId ? { variantId: q.variantId } : {}),
        ...(q?.active !== undefined ? { active: q.active ? "1" : "0" } : {}),
      },
    }),
  createStockRule: (body: {
    productId: string;
    variantId?: string | null;
    monitorBinId?: string | null;
    minQty: number;
    maxQty?: number | null;
    orderMultiple?: number | null;
    triggerType: "mo" | "transfer" | "po";
    vendorId?: string | null;
    bomId?: string | null;
    sourceBinId?: string | null;
    toWarehouseId?: string | null;
    toBinId?: string | null;
    tags?: string | null;
    active?: boolean;
    notes?: string | null;
  }) => fetcher<StockRuleRow>("/stock-rules", { method: "POST", body }),
  updateStockRule: (
    id: string,
    body: Partial<{
      productId: string;
      variantId: string | null;
      monitorBinId: string | null;
      minQty: number;
      maxQty: number | null;
      orderMultiple: number | null;
      triggerType: "mo" | "transfer" | "po";
      vendorId: string | null;
      bomId: string | null;
      sourceBinId: string | null;
      toWarehouseId: string | null;
      toBinId: string | null;
      tags: string | null;
      active: boolean;
      notes: string | null;
    }>
  ) => fetcher<StockRuleRow>(`/stock-rules/${id}`, { method: "PATCH", body }),
  deleteStockRule: (id: string) =>
    fetcher<{ deleted: boolean }>(`/stock-rules/${id}`, { method: "DELETE" }),
  checkAllStockRules: () =>
    fetcher<{
      checked: number;
      triggered: number;
      results: Array<{
        ruleId: string;
        triggerType: string;
        created: { type: string; id: string; documentNo: string } | null;
        skippedReason?: string;
      }>;
    }>("/stock-rules/check-all", { method: "POST", body: {} }),

  // ---- Transfer orders ----
  transferOrders: (q?: {
    status?: string;
    kind?: string;
    productionOrderId?: string;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    limit?: number;
  }) =>
    fetcher<TransferOrderRow[]>("/transfer-orders", {
      query: {
        ...(q?.status ? { status: q.status } : {}),
        ...(q?.kind ? { kind: q.kind } : {}),
        ...(q?.productionOrderId ? { productionOrderId: q.productionOrderId } : {}),
        ...(q?.fromWarehouseId ? { fromWarehouseId: q.fromWarehouseId } : {}),
        ...(q?.toWarehouseId ? { toWarehouseId: q.toWarehouseId } : {}),
        ...(q?.limit ? { limit: String(q.limit) } : {}),
      },
    }),
  transferOrder: (id: string) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}`),
  createTransferOrder: (body: {
    kind?: "putaway" | "replenishment" | "manual";
    fromWarehouseId: string;
    toWarehouseId: string;
    productionOrderId?: string | null;
    notes?: string | null;
    items: Array<{
      productId: string;
      variantId?: string | null;
      qtyRequested: number;
      fromBinId?: string | null;
      toBinId?: string | null;
      notes?: string | null;
    }>;
  }) => fetcher<TransferOrderRow>("/transfer-orders", { method: "POST", body }),
  cancelTransferOrder: (id: string) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/cancel`, { method: "POST", body: {} }),
  claimTransferOrder: (id: string) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/claim`, { method: "POST", body: {} }),
  // Drop the current claim so another worker can pick this TO up.
  // Only callable while the TO is still `ready` (pre-pick).
  releaseTransferOrder: (id: string) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/release`, { method: "POST", body: {} }),
  // Re-run source-bin discovery for items still missing a fromBinId.
  // Returns the refreshed TO plus a breakdown of what got resolved
  // and what (if anything) is still missing.
  resolveTransferOrderSourceBins: (id: string) =>
    fetcher<{
      transferOrder: TransferOrderRow;
      resolved: Array<{ itemId: string; sku: string; binCode: string; qtyAvailable: number }>;
      stillMissing: Array<{ itemId: string; sku: string; needed: number }>;
    }>(`/transfer-orders/${id}/resolve-source-bins`, { method: "POST", body: {} }),
  pickTransferOrder: (id: string, lines: Array<{ itemId: string; qtyPicked: number; fromBinId: string }>) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/pick`, {
      method: "POST",
      body: { lines },
    }),
  // `toBinId` is optional: when null/omitted the backend auto-picks a bin
  // in the destination warehouse (consolidates onto an existing product
  // bin, else the least-occupied empty bin). A 409 is returned if the
  // destination warehouse has no bins at all.
  dropTransferOrder: (
    id: string,
    lines: Array<{ itemId: string; qtyDropped: number; toBinId: string | null }>
  ) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/drop`, {
      method: "POST",
      body: { lines },
    }),
  // Admin / supervisor: list users that can be assigned to a TO.
  transferOrderWorkers: () =>
    fetcher<Array<{ id: string; username: string; name: string; role: string }>>(
      "/transfer-orders/workers"
    ),
  // Admin / supervisor: assign (or unassign, pass null) the TO to a user.
  assignTransferOrder: (id: string, assignedToId: string | null, note?: string | null) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/assign`, {
      method: "POST",
      body: { assignedToId, note: note ?? null },
    }),
  // Admin / supervisor: manual status override ("backup" path for stuck
  // transfer orders). Pure metadata change — does NOT move stock. Use
  // pick/drop/cancel for flows that should update bin quantities.
  setTransferOrderStatus: (
    id: string,
    status: "draft" | "ready" | "in_transit" | "done" | "cancelled",
    reason: string
  ) =>
    fetcher<TransferOrderRow>(`/transfer-orders/${id}/status`, {
      method: "POST",
      body: { status, reason },
    }),

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

  vendorProducts: (vendorId: string, q?: { active?: boolean; productId?: string }) =>
    fetcher<VendorProduct[]>(`/vendors/${vendorId}/products`, {
      query: {
        ...(q?.active ? { active: "1" } : {}),
        ...(q?.productId ? { productId: q.productId } : {}),
      },
    }),
  createVendorProduct: (
    vendorId: string,
    body: {
      productId: string;
      variantId?: string | null;
      vendorProductCode?: string | null;
      vendorProductName?: string | null;
      vendorUom: string;
      packSize?: number;
      price?: number;
      minOrderQty?: number;
      leadTimeDays?: number | null;
      priority?: number;
      active?: boolean;
      notes?: string | null;
    }
  ) => fetcher<VendorProduct>(`/vendors/${vendorId}/products`, { method: "POST", body }),
  updateVendorProduct: (
    vendorId: string,
    lineId: string,
    body: Partial<{
      productId: string;
      variantId: string | null;
      vendorProductCode: string | null;
      vendorProductName: string | null;
      vendorUom: string;
      packSize: number;
      price: number;
      minOrderQty: number;
      leadTimeDays: number | null;
      priority: number;
      active: boolean;
      notes: string | null;
    }>
  ) =>
    fetcher<VendorProduct>(`/vendors/${vendorId}/products/${lineId}`, {
      method: "PATCH",
      body,
    }),
  deleteVendorProduct: (vendorId: string, lineId: string) =>
    fetcher<{ deleted?: boolean; softDeleted?: boolean; line?: VendorProduct }>(
      `/vendors/${vendorId}/products/${lineId}`,
      { method: "DELETE" }
    ),
  vendorPerformance: (vendorId: string, days = 365) =>
    fetcher<VendorPerformance>(`/vendors/${vendorId}/performance`, {
      query: { days: String(days) },
    }),
  syncVendorRating: (vendorId: string) =>
    fetcher<VendorPerformance>(`/vendors/${vendorId}/sync-rating`, {
      method: "POST",
      body: {},
    }),

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
  /** Approved + partial POs with lines — for mobile GRN list. */
  purchaseOrdersForGrn: async (): Promise<GrnPurchaseOrder[]> => {
    const rows = await fetcher<Raw[]>("/purchase-orders");
    return rows
      .filter((r) => ["approved", "partial"].includes(String(r.status)))
      .map(mapGrnPurchaseOrder)
      .filter((po) => po.items.some((i) => i.qty - i.received > 0.0001));
  },
  getPurchaseOrderForGrn: async (id: string): Promise<GrnPurchaseOrder> => {
    const r = await fetcher<Raw>(`/purchase-orders/${id}`);
    return mapGrnPurchaseOrder(r);
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
        vendorProductId?: string | null;
        vendorQty?: number | null;
        vendorUom?: string | null;
        vendorRate?: number | null;
        vendorProduct?: {
          id: string;
          vendorProductCode: string | null;
          vendorProductName: string | null;
          vendorUom: string;
          packSize: number;
        } | null;
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
    items: Array<{
      productId: string;
      qty?: number;
      rate?: number;
      vendorProductId?: string;
      vendorQty?: number;
      vendorRate?: number;
    }>;
  }) => fetcher<Raw>("/purchase-orders", { method: "POST", body }),
  updatePurchaseOrder: (
    id: string,
    body: {
      expectedDate?: string;
      notes?: string | null;
      items?: Array<{
        productId: string;
        qty?: number;
        rate?: number;
        vendorProductId?: string;
        vendorQty?: number;
        vendorRate?: number;
      }>;
    }
  ) => fetcher<Raw>(`/purchase-orders/${id}`, { method: "PATCH", body }),
  approvePurchaseOrder: (id: string) =>
    fetcher<Raw>(`/purchase-orders/${id}/approve`, { method: "POST", body: {} }),
  cancelPurchaseOrder: (id: string) =>
    fetcher<Raw>(`/purchase-orders/${id}/cancel`, { method: "POST", body: {} }),
  closePurchaseOrder: (id: string) =>
    fetcher<Raw>(`/purchase-orders/${id}/close`, { method: "POST", body: {} }),
  purchaseOrderClosePreview: (id: string) =>
    fetcher<import("@/data/types").PoClosePreview>(
      `/purchase-orders/${id}/close-preview`
    ),
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
  grnReceiveHints: (productIds: string[]) =>
    fetcher<{ hints: Record<string, GrnReceiveHint> }>("/grns/receive-hints", {
      method: "POST",
      body: { productIds },
    }),
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
      batchNo?: string | null;
      expiryDate?: string | null;
      allocations?: Array<{ binId: string; qty: number }>;
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
  productionLinesReport: async () => {
    const raw = await fetcher<{
      lines: Array<{
        id: string;
        code: string;
        name: string;
        capacityPerHour: number | null;
        machines?: Array<{
          id: string;
          code: string;
          name: string;
          status: "running" | "idle" | "maintenance" | "broken";
          busy: boolean;
        }>;
        lines?: Array<{
          id: string;
          code: string;
          name: string;
          machines?: Array<{
            id: string;
            code: string;
            name: string;
            status: "running" | "idle" | "maintenance" | "broken";
            busy: boolean;
          }>;
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
    }>("/reports/production-lines");
    return {
      ...raw,
      lines: raw.lines.map((fac) => ({
        ...fac,
        machines:
          fac.machines ??
          (fac.lines ?? []).flatMap((l) => l.machines ?? []),
      })),
    };
  },
  attendanceHeatmap: (days = 28) =>
    fetcher<Array<{ date: string; weekday: string; presentCount: number }>>(
      "/reports/attendance-heatmap",
      { query: { days } }
    ),

  // Production log: one row per WorkOrder with parent MO + line/machine context,
  // duration, materials consumed, and per-WO utilization.
  moWoLog: (q?: { days?: number; facilityId?: string; lineId?: string; machineId?: string; status?: string }) =>
    fetcher<MoWoLogResponse>("/reports/mo-wo-log", {
      query: {
        ...(q?.days ? { days: q.days } : {}),
        ...(q?.facilityId ? { facilityId: q.facilityId } : {}),
        ...(q?.lineId ? { lineId: q.lineId } : {}),
        ...(q?.machineId ? { machineId: q.machineId } : {}),
        ...(q?.status ? { status: q.status } : {}),
      },
    }),

  // Per-machine aggregated utilization over the window.
  machineUtilization: (q?: { days?: number; hoursPerDay?: number; facilityId?: string; lineId?: string }) =>
    fetcher<MachineUtilizationResponse>("/reports/machine-utilization", {
      query: {
        ...(q?.days ? { days: q.days } : {}),
        ...(q?.hoursPerDay ? { hoursPerDay: q.hoursPerDay } : {}),
        ...(q?.facilityId ? { facilityId: q.facilityId } : {}),
        ...(q?.lineId ? { lineId: q.lineId } : {}),
      },
    }),
  attendanceDay: (date: string) =>
    fetcher<{
      date: string;
      presentCount: number;
      workers: Array<{
        workerId: string;
        empNo: string;
        name: string;
        shift: string;
        station: string;
        inAt: string | null;
        outAt: string | null;
      }>;
    }>("/reports/attendance-day", { query: { date } }),
  punchWorker: (body: { empNo: string; direction: "in" | "out" | "break" }) =>
    fetcher<Raw>("/workers/punch", { method: "POST", body }),

  // Multi-container packing reports. The four endpoints below share a
  // common shape (most accept `?format=csv` to stream a download). For
  // CSV, callers build a URL with reportCsvUrl() and trigger a browser
  // download — fetching CSV through the JSON fetcher would re-parse and
  // throw.
  packManifest: (packingSlipId: string) =>
    fetcher<{
      slip: {
        id: string;
        packingSlipNo: string;
        status: string;
        packedAt: string | null;
        totalEstWeightKg: number;
        totalActualWeightKg: number | null;
      };
      salesOrder: {
        id: string;
        soNo: string;
        customer?: { id: string; code: string; name: string; city?: string | null } | null;
      } | null;
      invoice: {
        id: string;
        invoiceNo: string;
        dispatches: Array<{
          id: string;
          dispatchNo: string;
          status: string;
          trip: { id: string; tripNo: string; scheduledDate: string } | null;
        }>;
      } | null;
      containers: Array<{
        id: string;
        seq: number;
        label: string;
        code: string;
        status: PackingContainerStatus;
        containerType: { code: string; name: string; kind: string; tareKg: number } | null;
        estWeightKg: number;
        actualWeightKg: number | null;
        tareKgOverride: number | null;
        notes: string | null;
        sealedAt: string | null;
        sealedById: string | null;
        itemCount: number;
        unitCount: number;
        lines: Array<{
          packingSlipItemId: string;
          productId: string;
          productSku: string;
          productName: string;
          productBarcode: string | null;
          uom: string;
          variantId: string | null;
          variant: string;
          variantBarcode: string | null;
          qty: number;
          qtyPacked: number;
        }>;
      }>;
      unallocated: Array<{
        packingSlipItemId: string;
        productSku: string;
        productName: string;
        variant: string;
        uom: string;
        qtyPacked: number;
        allocated: number;
        shortage: number;
      }>;
      totals: {
        containerCount: number;
        sealedCount: number;
        unitCount: number;
        estWeightKg: number;
        actualWeightKg: number | null;
      };
    }>(`/reports/pack-manifest/${packingSlipId}`),

  itemContainerHistory: (q: {
    productId?: string;
    variantId?: string;
    sku?: string;
    barcode?: string;
    days?: number;
    limit?: number;
  }) =>
    fetcher<{
      productId: string | null;
      variantId: string | null;
      sinceDate: string;
      count: number;
      rows: Array<{
        packingSlipId: string;
        packingSlipNo: string;
        packedAt: string | null;
        slipStatus: string;
        containerId: string;
        containerSeq: number;
        containerLabel: string;
        containerCode: string;
        containerType: string | null;
        containerStatus: PackingContainerStatus;
        qty: number;
        qtyPacked: number;
        product: { id: string; sku: string; name: string; uom: string; barcode: string | null };
        variant: {
          id: string;
          sku: string;
          size: string | null;
          color: string | null;
          barcode: string | null;
        } | null;
        salesOrder: {
          id: string;
          soNo: string;
          customer?: { id: string; code: string; name: string } | null;
        } | null;
        invoiceNo: string | null;
        dispatches: Array<{
          dispatchNo: string;
          status: string;
          tripNo: string | null;
          scheduledDate: string | null;
        }>;
      }>;
    }>("/reports/item-container-history", {
      query: q as Record<string, string | number | undefined>,
    }),

  tripManifest: (tripId: string) =>
    fetcher<{
      trip: {
        id: string;
        tripNo: string;
        scheduledDate: string;
        status: string;
        vehicle: string;
        driver: string;
        route: string | null;
        capacityKg: number;
      };
      stops: Array<{
        dispatchId: string;
        dispatchNo: string;
        status: string;
        weightKg: number;
        invoiceNo: string;
        customer: { id: string; code: string; name: string; city: string | null } | null;
        packingSlip: {
          id: string;
          packingSlipNo: string;
          totalEstWeightKg: number;
          totalActualWeightKg: number | null;
        } | null;
        containers: Array<{
          id: string;
          seq: number;
          label: string;
          code: string;
          status: PackingContainerStatus;
          containerType: { code: string; kind: string; tareKg: number } | null;
          estWeightKg: number;
          actualWeightKg: number | null;
          unitCount: number;
          lines: Array<{
            productSku: string;
            productName: string;
            productBarcode: string | null;
            uom: string;
            variant: string;
            variantBarcode: string | null;
            qty: number;
          }>;
        }>;
        containerCount: number;
        unitCount: number;
        estWeightKg: number;
        actualWeightKg: number | null;
      }>;
      totals: {
        stopCount: number;
        containerCount: number;
        unitCount: number;
        weightKg: number;
        capacityKg: number;
      };
    }>(`/reports/trip-manifest/${tripId}`),

  packThroughput: (days = 14) =>
    fetcher<{
      rangeStart: string;
      days: number;
      totals: { slips: number; containers: number; estKg: number; actualKg: number };
      rows: Array<{
        day: string;
        slips: number;
        containers: number;
        estKg: number;
        actualKg: number;
      }>;
    }>("/reports/pack-throughput", { query: { days } }),

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
  getDocumentSeries: () => fetcher<DocumentSeriesRow[]>("/settings/document-series"),
  createDocumentSeries: (body: DocumentSeriesInput) =>
    fetcher<DocumentSeriesRow>("/settings/document-series", { method: "POST", body }),
  updateDocumentSeries: (id: string, body: Partial<DocumentSeriesInput>) =>
    fetcher<DocumentSeriesRow>(`/settings/document-series/${id}`, { method: "PATCH", body }),
  deleteDocumentSeries: (id: string) =>
    fetcher<{ ok: boolean; softDeleted?: boolean }>(`/settings/document-series/${id}`, {
      method: "DELETE",
    }),
  listInvoiceSeries: () => fetcher<InvoiceSeriesOption[]>("/document-series"),
  pincodeLookup: (pin: string) =>
    fetcher<{
      pincode: string;
      city: string;
      district: string;
      state: string;
      distanceKm: number | null;
      dispatchPincode: string | null;
    }>(`/pincode-lookup?pin=${encodeURIComponent(pin)}`),
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
  /**
   * Spin off the un-invoiced remainder of a partially-fulfilled SO
   * into a brand-new SO and close the parent. Used by the AR
   * statement banner when a warehouse shortfall is hanging on a
   * customer's open balance and the user wants to keep the
   * commitment alive on a fresh SO instead of writing it off.
   */
  backOrderSalesOrder: (id: string) =>
    fetcher<{ backOrder: SalesOrderRow; parent: SalesOrderRow }>(
      `/sales-orders/${id}/back-order`,
      { method: "POST", body: {} }
    ),
  invoiceSalesOrder: (
    id: string,
    body: {
      paymentMode: "cash" | "card" | "upi" | "credit" | "split";
      items: { salesOrderItemId: string; qty: number }[];
    }
  ) => fetcher<Raw>(`/sales-orders/${id}/invoice`, { method: "POST", body }),

  // Hard-reserve / re-reserve. Returns a per-line breakdown of how
  // much was actually reserved vs short. Idempotent — calling it on
  // an already-reserved SO does a release+reserve cycle that
  // re-anchors against current bin stock.
  reserveSalesOrder: (id: string) =>
    fetcher<{
      reserved: Array<{
        salesOrderItemId: string;
        productId: string;
        sku: string;
        requested: number;
        reserved: number;
        short: number;
        splits: Array<{ binId: string; qty: number; binPath: string }>;
      }>;
    }>(`/sales-orders/${id}/reserve`, { method: "POST", body: {} }),

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

  // ----- Multi-container packing -----
  // CRUD endpoints for the per-slip containers (box / bag / carton /
  // sack). The packer creates one container per physical unit, allocates
  // qty into it, optionally records an actual scale reading, and then
  // seals it. Once every packed unit is allocated to a sealed container
  // the slip can be /pack'd.
  containerTypes: () =>
    fetcher<ContainerTypeRow[]>("/settings/container-types"),
  containerKinds: () =>
    fetcher<readonly ContainerKind[]>("/settings/container-kinds"),
  createContainerType: (body: {
    code: string;
    name: string;
    kind: ContainerKind;
    tareKg?: number;
    maxKg?: number | null;
    active?: boolean;
    sortOrder?: number;
  }) =>
    fetcher<ContainerTypeRow>("/settings/container-types", {
      method: "POST",
      body,
    }),
  updateContainerType: (
    id: string,
    body: Partial<{
      code: string;
      name: string;
      kind: ContainerKind;
      tareKg: number;
      maxKg: number | null;
      active: boolean;
      sortOrder: number;
    }>
  ) =>
    fetcher<ContainerTypeRow>(`/settings/container-types/${id}`, {
      method: "PATCH",
      body,
    }),
  deleteContainerType: (id: string) =>
    fetcher<{ ok: true }>(`/settings/container-types/${id}`, {
      method: "DELETE",
    }),

  packingContainers: (slipId: string) =>
    fetcher<PackingContainerRow[]>(`/packing-slips/${slipId}/containers`),
  createPackingContainer: (
    slipId: string,
    body: { containerTypeId?: string | null; notes?: string | null } = {}
  ) =>
    fetcher<PackingContainerRow>(`/packing-slips/${slipId}/containers`, {
      method: "POST",
      body,
    }),
  updatePackingContainer: (
    slipId: string,
    containerId: string,
    body: Partial<{
      containerTypeId: string | null;
      notes: string | null;
      tareKgOverride: number | null;
      actualWeightKg: number | null;
    }>
  ) =>
    fetcher<PackingContainerRow>(
      `/packing-slips/${slipId}/containers/${containerId}`,
      { method: "PATCH", body }
    ),
  deletePackingContainer: (slipId: string, containerId: string) =>
    fetcher<{ ok: true }>(
      `/packing-slips/${slipId}/containers/${containerId}`,
      { method: "DELETE" }
    ),
  addPackingContainerItem: (
    slipId: string,
    containerId: string,
    body: { packingSlipItemId: string; qty: number }
  ) =>
    fetcher<PackingContainerRow>(
      `/packing-slips/${slipId}/containers/${containerId}/items`,
      { method: "POST", body }
    ),
  updatePackingContainerItem: (
    slipId: string,
    containerId: string,
    itemId: string,
    body: { qty: number }
  ) =>
    fetcher<PackingContainerRow>(
      `/packing-slips/${slipId}/containers/${containerId}/items/${itemId}`,
      { method: "PATCH", body }
    ),
  deletePackingContainerItem: (
    slipId: string,
    containerId: string,
    itemId: string
  ) =>
    fetcher<PackingContainerRow>(
      `/packing-slips/${slipId}/containers/${containerId}/items/${itemId}`,
      { method: "DELETE" }
    ),
  sealPackingContainer: (
    slipId: string,
    containerId: string,
    body: { actualWeightKg?: number | null } = {}
  ) =>
    fetcher<PackingContainerRow>(
      `/packing-slips/${slipId}/containers/${containerId}/seal`,
      { method: "POST", body }
    ),
  unsealPackingContainer: (slipId: string, containerId: string) =>
    fetcher<PackingContainerRow>(
      `/packing-slips/${slipId}/containers/${containerId}/unseal`,
      { method: "POST", body: {} }
    ),
  // Dispatch scan-out: resolve a C.<slipNo>.<NN> sticker to the
  // container + its slip + linked dispatch / trip. Used by the
  // loader's mobile UI to confirm the container is on the right truck.
  scanContainerCode: (code: string) =>
    fetcher<{
      code: string;
      container: PackingContainerRow;
      packingSlip: {
        id: string;
        packingSlipNo: string;
        status: PackingSlipStatus;
        totalEstWeightKg: number;
        totalActualWeightKg: number | null;
        containerCount: number;
      };
      salesOrder?: {
        id: string;
        soNo: string;
        customer?: { id: string; name: string; city?: string | null };
      } | null;
      invoice?: {
        id: string;
        invoiceNo: string;
        dispatches?: {
          id: string;
          dispatchNo: string;
          status: string;
          weightKg: number;
          vehicle?: string | null;
          driver?: string | null;
          trip?: {
            id: string;
            tripNo: string;
            scheduledDate: string;
            vehicle: string;
            driver: string;
          } | null;
        }[];
      } | null;
    }>("/packing-containers/scan", { method: "POST", body: { code } }),

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

  // Recompute a dispatch's weight from the linked packing-slip
  // container rollup. Surfaced on the trip detail screen so the
  // operator can refresh after a packer corrects an actual weight
  // post-pack. Returns the updated dispatch + previousWeightKg /
  // derivedWeightKg so the UI can show "26.4 → 27.1 kg" briefly.
  recomputeDispatchWeight: (dispatchId: string) =>
    fetcher<{
      id: string;
      weightKg: number;
      previousWeightKg: number;
      derivedWeightKg: number;
    }>(`/dispatches/${dispatchId}/recompute-weight`, {
      method: "POST",
      body: {},
    }),

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
        validFrom?: string | null;
        validUntil?: string | null;
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
      variantId?: string | null;
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
  // -----------------------------------------------------------------
  // Zone PR bulk capture (mobile warehouse PWA)
  // -----------------------------------------------------------------
  // Returns variants whose putaway rule still targets STR Zone PR
  // without a fixed bin. POST /capture assigns stock + pins the rule.
  zonePrVariants: () =>
    fetcher<{
      warehouse: { id: string; code: string; name: string } | null;
      counts: { total: number };
      variants: Array<{
        putawayRuleId: string;
        productId: string;
        productSku: string;
        productName: string;
        productType: string;
        variantId: string;
        variantSku: string;
        variantBarcode: string | null;
        variantSize: string | null;
        variantUom: string | null;
        stockOnHand: number;
      }>;
    }>("/zone-pr-variants"),

  captureZonePrVariants: (body: {
    items: Array<{
      variantId: string;
      binCode: string;
      qty: number;
      clientOpId?: string;
    }>;
  }) =>
    fetcher<{
      ok: number;
      failed: Array<{ variantId: string; error: string }>;
      results: Array<{
        variantId: string;
        variantSku: string;
        binId: string;
        binCode: string;
        binWarehouseCode: string;
        binZone: string;
        qty: number;
      }>;
    }>("/zone-pr-variants/capture", { method: "POST", body }),

  dailyProductionLogs: (q?: { limit?: number }) =>
    fetcher<
      Array<{
        logNo: string;
        loggedAt: string;
        loggedBy: string;
        notes: string | null;
        outputs: Array<{ sku: string; name: string; qty: number }>;
        postings: Array<{ sku: string; binCode: string; warehouseCode: string; qty: number }>;
      }>
    >("/daily-production/logs", { query: q }),

  previewDailyProduction: (body: {
    outputs: Array<{ barcode: string; qty: number }>;
    materialScans?: Array<{ barcode: string }>;
  }) =>
    fetcher<{
      outputs: Array<{
        sku: string;
        name: string;
        qty: number;
        materials: Array<{
          sku: string;
          name: string;
          required: number;
          available: number;
          uom: string;
        }>;
      }>;
      totals: Array<{
        sku: string;
        name: string;
        required: number;
        available: number;
        uom: string;
      }>;
    }>("/daily-production/preview", { method: "POST", body }),

  postDailyProduction: (body: {
    outputs: Array<{ barcode: string; qty: number }>;
    materialScans?: Array<{ barcode: string }>;
    notes?: string | null;
    allowShortMaterials?: boolean;
    clientOpId?: string;
  }) =>
    fetcher<{
      logNo: string;
      consumptions: Array<{ sku: string; qty: number; uom: string; source: string }>;
      postings: Array<{ sku: string; binCode: string; warehouseCode: string; qty: number }>;
    }>("/daily-production/log", { method: "POST", body }),

  bulkZoneStock: (
    warehouseId: string,
    zone: string,
    body: {
      reasonCode?:
        | "physical_match"
        | "damage"
        | "found_elsewhere"
        | "product_swap"
        | "spillage"
        | "expired"
        | "other";
      remarks?: string | null;
      items: Array<{ binId: string; barcode?: string; qty?: number }>;
    }
  ) =>
    fetcher<Raw>(
      `/warehouses/${warehouseId}/zones/${encodeURIComponent(zone)}/bins/bulk-stock`,
      { method: "POST", body }
    ),
  logScanEvent: (body: {
    kind: "bin" | "shelf" | "zone" | "product" | "unknown";
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
    /** Variant SKU when this line targets a specific variant; null for parent-only products. */
    variantSku?: string | null;
    /** Variant size token (e.g. "250 ml", "1 kg"). */
    variantSize?: string | null;
    /** Variant uom (typically "pc"); falls back to parent uom when null. */
    variantUom?: string | null;
    variantPackSize?: number | null;
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
