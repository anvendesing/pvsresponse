export type StockState = "available" | "reserved" | "blocked" | "damaged" | "transit";
export type ProductType = "raw" | "semi" | "finished" | "consumable" | "service";
export type ProductState = "draft" | "active" | "discontinued" | "blocked";

// Canonical Unit of Measure - mirrors the backend Uom master table.
// `code` is the short canonical form ("kg", "g", "L", "mL", "m", "pc"...)
// stored in records; `factor` is the conversion factor relative to the
// category's reference UoM.
export interface Uom {
  id: string;
  code: string;
  name: string;
  factor: number;
  isReference: boolean;
  rounding: number;
  active: boolean;
  categoryId: string;
  category?: { code: string; name: string };
}

export interface UomCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  uoms: Uom[];
}

export interface ProductCategory {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  active: boolean;
  imageUrl?: string | null;
  _count?: { products: number };
}

export interface ProductVariant {
  id?: string;
  sku: string;
  barcode?: string | null;
  // Optional variant-level HSN (overrides product HSN when non-null).
  hsn?: string | null;
  // Optional GST rate override. null/undefined = inherit parent product.gstRate.
  gstRate?: number | null;
  size?: string | null;
  color?: string | null;
  grade?: string | null;
  // Variant's selling unit-of-measure. Null/undefined => inherit parent's
  // UoM. Pattern: parent holds bulk (e.g. "L", "kg"), variant defines its
  // sellable unit (e.g. "pc"). Selling and billing pick this column first.
  uom?: string | null;
  // Conversion factor variant -> parent UoM. e.g. variant "100g pouch"
  // on a kg-tracked parent => packSize 0.1. Default 1.
  packSize?: number | null;
  costPriceOverride?: number | null;
  sellingPriceOverride?: number | null;
  stockOnHand: number;
  active: boolean;
  imageUrl?: string | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  type: ProductType;
  uom: string;
  barcode: string;
  state: ProductState;
  stockOnHand: number;
  reorderLevel: number;
  costPrice: number;
  sellingPrice: number;
  categoryId?: string | null;
  category?: ProductCategory | null;
  hsn: string;
  // GST rate percentage e.g. 18 = 18%. Default 18.
  gstRate: number;
  batchTracked: boolean;
  imageUrl?: string | null;
  variants?: ProductVariant[];
}

// Selects the right UoM to display / use for line-item logic. Variant
// UoM (the "selling unit") wins when set; otherwise we fall back to the
// parent UoM (the "bulk unit"). Used by quotes, sales orders, packing
// slips, invoices and stock displays so the customer-facing unit is
// consistent across the workflow.
export const effectiveUom = (
  parent: { uom?: string | null },
  variant?: { uom?: string | null } | null
): string => {
  const v = (variant?.uom ?? "").trim();
  if (v.length > 0) return v;
  return parent?.uom ?? "";
};

export interface Bin {
  id: string;
  // Human-readable warehouse code (e.g. "WH-MAIN") used in tree labels,
  // not the cuid id.
  warehouse: string;
  // Optional display name (e.g. "Main Warehouse") if the API supplied one.
  warehouseName?: string;
  zone: string;
  shelf: string;
  bin: string;
  capacity: number;
  occupied: number;
  productSku?: string;
  productName?: string;
  qty?: number;
  batch?: string;
}

export interface Vendor {
  id: string;
  code: string;
  name: string;
  gst: string;
  contact: string;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  rating: number;
  leadTimeDays: number;
  city: string;
  active: boolean;
  // Rolled-up counters - populated by the backend so the listing
  // doesn't need N+1 fetches.
  outstandingPO: number;
  totalSpend: number;
}

export interface PurchaseOrder {
  id: string;
  poNo: string;
  vendor: string;
  vendorId: string;
  // Vendor's contact channels - used by the share menu to pre-fill
  // WhatsApp / email destinations. Optional because legacy vendor rows
  // may not have them.
  vendorContact?: string | null;
  vendorEmail?: string | null;
  date: string;
  expectedDate: string;
  status: "draft" | "approved" | "partial" | "received" | "closed" | "cancelled";
  amount: number;
  itemCount: number;
  receivedPct: number;
  // Lazy-minted share token for the vendor-facing public PO view.
  // Null until the operator opens the share menu (or hits the rotate
  // endpoint), which mints one server-side.
  shareToken?: string | null;
}

export interface ProductionOrder {
  id: string;
  orderNo: string;
  product: string;
  sku: string;
  plannedQty: number;
  actualQty: number;
  scrapQty: number;
  reworkQty: number;
  status: "planned" | "in-progress" | "qc" | "completed" | "delayed";
  station: string;
  startDate: string;
  dueDate: string;
  efficiency: number;
}

export interface WorkOrder {
  id: string;
  workOrderNo: string;
  productionOrderId: string;
  station: string;
  workers: string[];
  machine: string;
  startTime: string;
  endTime?: string;
  output: number;
  target: number;
  status: "queued" | "running" | "paused" | "complete";
}

export interface Worker {
  id: string;
  empNo: string;
  name: string;
  station: string;
  shift: "A" | "B" | "C";
  status: "in" | "out" | "break";
  unitsToday: number;
  targetToday: number;
  efficiency: number;
  rejectionRate: number;
  hoursToday: number;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  customer: string;
  customerId?: string;
  customerContact?: string | null;
  shareToken?: string | null;
  date: string;
  amount: number;
  tax: number;
  status: "draft" | "issued" | "paid" | "partial" | "overdue";
  paymentMode: "cash" | "card" | "upi" | "credit" | "split";
  itemCount: number;
}

export interface DispatchOrder {
  id: string;
  dispatchNo: string;
  invoice: string;
  invoiceId?: string;
  vehicle: string;
  driver: string;
  destination: string;
  status: "planned" | "loading" | "in-transit" | "delivered" | "delayed";
  etaHours: number;
  weightKg: number;
  customer?: string;
  createdAt?: string;
}

export interface BomItem {
  // BomItem id - present when the row came from the API; absent when
  // the editor is composing a new row in memory.
  id?: string;
  sku: string;
  name: string;
  // Component product id; required for any backend mutation.
  productId?: string;
  // True if the component itself has its own active BOM (i.e. it's a
  // sub-assembly and the editor should let the user drill in).
  hasSubAssembly?: boolean;
  qty: number;
  uom: string;
  scrapPct: number;
}

export interface Bom {
  id: string;
  product: string;
  productId?: string;
  sku: string;
  // Variant scope:
  //   variantId set    - this BOM applies only to one variant of the
  //                      parent product (e.g. "Coconut Oil 5L").
  //   variantId null   - product-level default; used by any variant
  //                      that lacks its own BOM.
  variantId?: string | null;
  variantSku?: string | null;
  variantLabel?: string | null;
  revision: string;
  items: BomItem[];
  outputQty: number;
  active: boolean;
  // Optional defaults that flow into a new MO's station / machine
  // fields. Both nullable: a BOM may pin neither, just a work center,
  // or a work center + a specific machine on it.
  defaultWorkCenterId?: string | null;
  defaultWorkCenter?: { id: string; code: string; name: string } | null;
  defaultMachineId?: string | null;
  defaultMachine?: { id: string; code: string; name: string } | null;
}

export interface StockLedgerEntry {
  id: string;
  date: string;
  product: string;
  sku: string;
  txnType: "GRN" | "Issue" | "Transfer" | "Sale" | "Production" | "Adjust";
  ref: string;
  qty: number;
  warehouse: string;
  bin?: string;
  balance: number;
}

// ─── CRM: Enquiries ──────────────────────────────────────────────────────
export type EnquiryStage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
export type EnquiryType = "product" | "dealership" | "farm_visit" | "other";
export type EnquirySource =
  | "walk_in" | "phone" | "website" | "whatsapp" | "referral" | "exhibition" | "social" | "other";
export type EnquiryPriority = "low" | "medium" | "high";
export type EnquiryActivityType =
  | "note" | "call" | "email" | "meeting" | "whatsapp" | "visit" | "stage_change";

export interface EnquiryItem {
  id: string;
  productId?: string | null;
  variantId?: string | null;
  description?: string | null;
  qty: number;
  notes?: string | null;
  product?: { id: string; sku: string; name: string; uom: string } | null;
  variant?: { id: string; sku: string; size?: string | null; color?: string | null } | null;
}

export interface EnquiryActivity {
  id: string;
  type: EnquiryActivityType;
  body: string;
  outcome?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

export interface Enquiry {
  id: string;
  enquiryNo: string;
  type: EnquiryType;
  stage: EnquiryStage;
  source: EnquirySource;
  priority: EnquiryPriority;
  contactName: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  city?: string | null;
  subject: string;
  requirement?: string | null;
  estimatedValue: number;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  lostReason?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
  customerId?: string | null;
  assignedToId?: string | null;
  convertedQuoteId?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; code: string; name: string; city?: string | null } | null;
  assignedTo?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  items?: EnquiryItem[];
  activities?: EnquiryActivity[];
  _count?: { items: number; activities: number };
}

export interface EnquiryStats {
  byStage: Record<string, number>;
  open: number;
  won: number;
  lost: number;
  pipelineValue: number;
  followUpsDue: number;
}

export interface EnquiryItemInput {
  productId?: string | null;
  variantId?: string | null;
  description?: string | null;
  qty: number;
  notes?: string | null;
}

export interface EnquiryInput {
  type?: EnquiryType;
  source?: EnquirySource;
  priority?: EnquiryPriority;
  contactName: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  city?: string | null;
  subject: string;
  requirement?: string | null;
  estimatedValue?: number;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  customerId?: string | null;
  assignedToId?: string | null;
  items?: EnquiryItemInput[];
}
