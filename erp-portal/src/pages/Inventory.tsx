import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Download,
  FileSpreadsheet,
  PackageX,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { CollapsibleStats } from "@/components/common/CollapsibleStats";
import { Toolbar } from "@/components/common/Toolbar";
import type { Bin, Product, StockLedgerEntry } from "@/data/types";
import { dt, inr, num } from "@/lib/format";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/common/EmptyState";
import { BulkOrderExportModal } from "@/components/sales/BulkOrderExportModal";
import { InventoryLocationsPanel } from "@/components/inventory/InventoryLocationsPanel";
import { MapPin } from "lucide-react";

const txTone = (t: StockLedgerEntry["txnType"]) => {
  switch (t) {
    case "GRN":
      return "success" as const;
    case "Sale":
      return "primary" as const;
    case "Issue":
      return "warning" as const;
    case "Production":
      return "info" as const;
    case "Transfer":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
};

export const Inventory = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<"ledger" | "locations" | "valuation" | "batches">(
    () =>
      tabParam === "ledger" || tabParam === "valuation" || tabParam === "batches"
        ? tabParam
        : "locations"
  );
  const locationProductId = searchParams.get("productId") ?? undefined;

  useEffect(() => {
    if (
      tabParam === "locations" ||
      tabParam === "ledger" ||
      tabParam === "valuation" ||
      tabParam === "batches"
    ) {
      setTab(tabParam);
    }
  }, [tabParam]);
  const [q, setQ] = useState("");
  // Ledger filters — date range (inclusive) and a set of selected
  // transaction types. Empty set = show all types.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<StockLedgerEntry["txnType"]>>(
    new Set()
  );
  const [exportOpen, setExportOpen] = useState(false);
  // Bumped on every successful Adjust Stock post so child tabs that
  // hold their own state (Locations panel) know to refetch.
  const [locationsRefreshKey, setLocationsRefreshKey] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustPrefill, setAdjustPrefill] = useState<{
    productId?: string;
    // Specific variant to target. Required when the product has
    // variants — the modal scopes its bin selector by this column.
    variantId?: string | null;
    warehouseId?: string;
    delta?: number;
    fromManufacturing?: boolean;
    mode?: "delta" | "count";
    reason?: string;
  } | null>(null);

  // Deep-link from Manufacturing: /inventory?adjust=1&productId=…&delta=…&mode=count
  useEffect(() => {
    if (searchParams.get("adjust") !== "1") return;
    const modeParam = searchParams.get("mode");
    setAdjustPrefill({
      productId: searchParams.get("productId") ?? undefined,
      variantId: searchParams.get("variantId") ?? undefined,
      warehouseId: searchParams.get("warehouseId") ?? undefined,
      delta: searchParams.get("delta")
        ? Number(searchParams.get("delta"))
        : undefined,
      fromManufacturing: searchParams.get("from") === "mfg",
      mode: modeParam === "count" ? "count" : "delta",
      reason: searchParams.get("reason") ?? undefined,
    });
    setAdjustOpen(true);
    const next = new URLSearchParams(searchParams);
    for (const k of ["adjust", "productId", "variantId", "warehouseId", "delta", "from", "mode", "reason"]) {
      next.delete(k);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const liveLedger = useApi(() => api.ledger({ limit: 200 }), []);
  const liveProducts = useApi(() => api.products({ limit: 500 }), []);
  const liveWarehouses = useApi(() => api.warehouses(), []);
  const stockLedger = liveLedger.data ?? [];
  const products = liveProducts.data ?? [];
  const loading = liveLedger.loading || liveProducts.loading;
  const errorObj = liveLedger.error ?? liveProducts.error;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Parse from/to as local-midnight; "to" is inclusive (end of that day).
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    const typeFilter = selectedTypes;

    return stockLedger.filter((l) => {
      if (typeFilter.size > 0 && !typeFilter.has(l.txnType)) return false;
      if (fromMs != null || toMs != null) {
        const ts = new Date(l.date).getTime();
        if (fromMs != null && ts < fromMs) return false;
        if (toMs != null && ts > toMs) return false;
      }
      if (t) {
        return (
          l.product.toLowerCase().includes(t) ||
          l.sku.toLowerCase().includes(t) ||
          (l.variantSku?.toLowerCase().includes(t) ?? false) ||
          (l.variantSize?.toLowerCase().includes(t) ?? false) ||
          l.ref.toLowerCase().includes(t) ||
          l.warehouse.toLowerCase().includes(t)
        );
      }
      return true;
    });
  }, [q, stockLedger, dateFrom, dateTo, selectedTypes]);

  const toggleType = (t: StockLedgerEntry["txnType"]) =>
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const clearLedgerFilters = () => {
    setQ("");
    setDateFrom("");
    setDateTo("");
    setSelectedTypes(new Set());
  };
  const hasActiveLedgerFilters =
    q !== "" || dateFrom !== "" || dateTo !== "" || selectedTypes.size > 0;

  const totalValue = useMemo(
    () => products.reduce((s, p) => s + p.stockOnHand * p.costPrice, 0),
    [products]
  );
  const totalUnits = useMemo(() => products.reduce((s, p) => s + p.stockOnHand, 0), [products]);
  const lowStock = useMemo(
    () => products.filter((p) => p.stockOnHand < p.reorderLevel).length,
    [products]
  );

  const columns: Column<StockLedgerEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (r) => <span className="text-ink-muted font-mono text-caption">{dt(r.date)}</span>,
      width: "140px",
      sortable: true,
      sortValue: (r) => r.date,
    },
    {
      key: "ref",
      header: "Ref",
      cell: (r) => <span className="font-mono text-caption font-semibold text-primary">{r.ref}</span>,
      width: "140px",
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => (
        <Chip tone={txTone(r.txnType)} size="sm">
          {r.txnType}
        </Chip>
      ),
      width: "120px",
    },
    {
      key: "product",
      header: "Product",
      cell: (r) => {
        // When a row applies to a specific variant (e.g. a production MO
        // that output the 250ml CAOL variant) show that variant's SKU
        // and size alongside the parent so users can distinguish it
        // from rows on the bulk parent.
        const variantLabel = r.variantSize ?? r.variantSku ?? null;
        return (
          <div>
            <div className="font-semibold text-ink">
              {r.product}
              {variantLabel ? (
                <span className="ml-1 text-caption font-normal text-ink-muted">
                  · {variantLabel}
                </span>
              ) : null}
            </div>
            <div className="text-caption text-ink-muted font-mono">
              {r.variantSku ? r.variantSku : r.sku}
            </div>
          </div>
        );
      },
    },
    {
      key: "warehouse",
      header: "Location",
      cell: (r) => (
        <div className="font-mono text-caption">
          <div>{r.warehouse}</div>
          <div className="text-ink-muted">{r.bin}</div>
        </div>
      ),
      width: "130px",
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      cell: (r) => (
        <span className={`font-bold tnum ${r.qty > 0 ? "text-success" : "text-danger"}`}>
          {r.qty > 0 ? "+" : ""}
          {num(r.qty)}
        </span>
      ),
      width: "100px",
      sortable: true,
      sortValue: (r) => r.qty,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      cell: (r) => <span className="tnum text-ink-muted">{num(r.balance)}</span>,
      width: "110px",
    },
  ];

  const valuationCols: Column<typeof products[number]>[] = [
    {
      key: "sku",
      header: "SKU",
      cell: (r) => <span className="font-mono text-caption">{r.sku}</span>,
      width: "110px",
    },
    {
      key: "name",
      header: "Product",
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      cell: (r) => <span className="tnum">{num(r.stockOnHand)}</span>,
      width: "100px",
      sortable: true,
      sortValue: (r) => r.stockOnHand,
    },
    {
      key: "cost",
      header: "Avg Cost",
      align: "right",
      cell: (r) => <span className="tnum text-ink-muted">{inr(r.costPrice)}</span>,
      width: "120px",
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (r) => (
        <span className="tnum font-bold text-primary">
          {inr(r.stockOnHand * r.costPrice)}
        </span>
      ),
      width: "140px",
      sortable: true,
      sortValue: (r) => r.stockOnHand * r.costPrice,
    },
    {
      key: "method",
      header: "Method",
      cell: () => <Chip size="sm" tone="info">FIFO</Chip>,
      width: "90px",
    },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Toolbar
        className="shrink-0"
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Inventory</h2>
            <div className="flex items-center gap-1 ml-2">
              {(
                  [
                    { id: "locations" as const, label: "Locations", icon: MapPin },
                    { id: "ledger" as const, label: "Ledger" },
                    { id: "valuation" as const, label: "Valuation" },
                    { id: "batches" as const, label: "Batches" },
                  ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    const next = new URLSearchParams(searchParams);
                    if (t.id === "locations") next.delete("tab");
                    else next.set("tab", t.id);
                    setSearchParams(next, { replace: true });
                  }}
                  className={`h-7 px-3 rounded-md text-caption font-semibold capitalize transition-colors inline-flex items-center gap-1 ${
                    tab === t.id
                      ? "bg-primary text-white"
                      : "bg-canvas text-ink-muted hover:text-primary"
                  }`}
                >
                  {"icon" in t && t.icon ? <t.icon size={12} /> : null}
                  {t.label}
                </button>
              ))}
            </div>
          </>
        }
        right={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download size={14} />}>
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<FileSpreadsheet size={14} />}
              onClick={() => setExportOpen(true)}
              title="Export bulk order Excel for customers"
            >
              Bulk Order Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<SlidersHorizontal size={14} />}
              onClick={() => setAdjustOpen(true)}
              title="Adjust stock on hand (recount / damage / found)"
            >
              Adjust Stock
            </Button>
            <Button size="sm" icon={<ArrowDownToLine size={14} />}>
              GRN · F2
            </Button>
          </>
        }
      />

      <CollapsibleStats
        storageKey="inventory"
        summary={
          <>
            Stock {inr(totalValue)} · {num(totalUnits)} units · {lowStock} low · 42 blocked
          </>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi
            label="Stock Value"
            value={inr(totalValue)}
            icon={<Boxes size={16} />}
            accent="primary"
            delta={2.4}
          />
          <Kpi
            label="Total Units"
            value={num(totalUnits)}
            icon={<ArrowUpFromLine size={16} />}
            accent="success"
            delta={1.1}
          />
          <Kpi
            label="Low Stock"
            value={String(lowStock)}
            deltaSuffix=""
            delta={3}
            icon={<ShieldAlert size={16} />}
            accent="warning"
          />
          <Kpi
            label="Damaged / Blocked"
            value="42"
            icon={<PackageX size={16} />}
            accent="danger"
            delta={-2}
            deltaSuffix=""
          />
        </div>
      </CollapsibleStats>

      {tab === "ledger" && (
        <>
          <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Filter by product, ref, warehouse…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="!h-8"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-ink-muted">From</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 px-2 rounded-md border border-border bg-surface text-body-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                title="Filter from this date (inclusive)"
              />
              <span className="text-caption text-ink-muted">to</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 px-2 rounded-md border border-border bg-surface text-body-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                title="Filter up to this date (inclusive)"
              />
            </div>
            <div className="flex items-center gap-1 ml-2 flex-wrap">
              {(["GRN", "Sale", "Issue", "Production", "Transfer", "Adjust"] as const).map(
                (t) => {
                  const active = selectedTypes.has(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      aria-pressed={active}
                      title={
                        active
                          ? `Showing only ${t}. Click to remove.`
                          : `Filter to ${t} entries`
                      }
                      className={cn(
                        "h-7 px-3 rounded-full text-caption font-semibold transition-all border",
                        active
                          ? "bg-primary text-white border-primary shadow-sm"
                          : "bg-canvas text-ink-muted border-border hover:border-primary hover:text-primary"
                      )}
                    >
                      {t}
                    </button>
                  );
                }
              )}
            </div>
            {hasActiveLedgerFilters && (
              <button
                type="button"
                onClick={clearLedgerFilters}
                className="h-7 px-2 rounded-md text-caption font-semibold text-ink-muted hover:text-danger hover:bg-danger-soft inline-flex items-center gap-1"
                title="Clear all ledger filters"
              >
                <X size={12} /> Clear
              </button>
            )}
            <span className="ml-auto text-caption text-ink-muted">
              {filtered.length} of {stockLedger.length} entries
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-surface">
            {loading || errorObj || stockLedger.length === 0 ? (
              <EmptyState
                loading={loading}
                error={errorObj}
                empty={!loading && !errorObj && stockLedger.length === 0}
                emptyTitle="No stock ledger entries yet"
                emptyDescription="Run GRNs, sales, or production to start the ledger."
                onRetry={liveLedger.refetch}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                empty
                emptyTitle="No entries match your filters"
                emptyDescription="Try widening the date range, clearing the search, or removing the type filter."
                action={
                  <Button size="sm" variant="outline" icon={<X size={14} />} onClick={clearLedgerFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <DataTable rows={filtered} columns={columns} rowKey={(r) => r.id} dense />
            )}
          </div>
        </>
      )}

      {tab === "locations" && (
        <InventoryLocationsPanel
          seedProductId={locationProductId}
          products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name }))}
          refreshKey={locationsRefreshKey}
        />
      )}

      {tab === "valuation" && (
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <Card title="Stock Valuation" subtitle="FIFO basis · Closing balance" noPadding>
            <DataTable
              rows={products}
              columns={valuationCols}
              rowKey={(r) => r.id}
              dense
            />
          </Card>
        </div>
      )}

      {tab === "batches" && (
        <div className="flex-1 min-h-0 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {products.filter((p) => p.batchTracked).slice(0, 8).map((p) => (
            <Card key={p.id} title={p.name} subtitle={p.sku} actions={<Chip tone="info" size="sm">Batch tracked</Chip>}>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => {
                  const days = 10 + i * 12;
                  const expDays = 90 - i * 18;
                  const tone = expDays < 20 ? "danger" : expDays < 50 ? "warning" : "success";
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 bg-canvas rounded-md border border-border">
                      <div>
                        <div className="font-mono text-caption font-semibold">BT-{2000 + i}</div>
                        <div className="text-caption text-ink-muted">Mfg {days}d ago · Exp in {expDays}d</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tnum font-semibold">{num(40 + i * 22)} {p.uom}</span>
                        <Chip tone={tone} size="sm">{tone === "success" ? "fresh" : tone === "warning" ? "expiring" : "critical"}</Chip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {exportOpen && (
        <BulkOrderExportModal onClose={() => setExportOpen(false)} />
      )}

      {adjustOpen && (
        <AdjustStockModal
          products={products}
          warehouses={liveWarehouses.data ?? []}
          prefill={adjustPrefill}
          onClose={() => {
            setAdjustOpen(false);
            setAdjustPrefill(null);
          }}
          onSaved={() => {
            setAdjustOpen(false);
            setAdjustPrefill(null);
            void liveLedger.refetch();
            void liveProducts.refetch();
            // Force the Locations panel to refetch its bin list — its
            // internal state would otherwise hold stale qty until the
            // user reloaded the page.
            setLocationsRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
};

// ─── Adjust Stock modal ────────────────────────────────────────────────────
// Manufacturing "In bins" uses Bin.qty (summed). This form adjusts a specific
// bin (or auto-picks one) so Refresh on the MO requirements panel updates.
const ADJUST_REASONS = [
  "Physical recount",
  "Damaged / spoilage",
  "Found stock",
  "Opening balance",
  "Mfg replenishment",
  "Theft / loss",
  "Other",
];

type BinRow = Bin;

// One option in the SKU picker: either a parent SKU (variant=null) or
// a variant SKU. Bin selectors and the stock counter scope by this so
// a bulk parent and its sellable variants are never conflated.
type SkuOption = {
  key: string; // "p:<id>" or "v:<id>"
  productId: string;
  variantId: string | null;
  sku: string;
  label: string;
  level: "parent" | "variant";
  uom: string;
  stockOnHand: number;
  hasVariants: boolean;
};

const buildSkuOptions = (products: Product[]): SkuOption[] => {
  const out: SkuOption[] = [];
  for (const p of products) {
    const hasVariants = (p.variants?.length ?? 0) > 0;
    out.push({
      key: `p:${p.id}`,
      productId: p.id,
      variantId: null,
      sku: p.sku,
      level: "parent",
      uom: p.uom,
      stockOnHand: p.stockOnHand ?? 0,
      hasVariants,
      label: hasVariants
        ? `${p.sku} · ${p.name} — bulk only (${p.uom}, internal)`
        : `${p.sku} · ${p.name} (${p.uom})`,
    });
    for (const v of p.variants ?? []) {
      if (!v.id) continue;
      const variantUom = v.uom ?? p.uom;
      const sizeLabel = v.size ? ` ${v.size}` : "";
      out.push({
        key: `v:${v.id}`,
        productId: p.id,
        variantId: v.id,
        sku: v.sku,
        level: "variant",
        uom: variantUom,
        stockOnHand: v.stockOnHand ?? 0,
        hasVariants: false,
        label: `   └─ ${v.sku}${sizeLabel} (${variantUom})`,
      });
    }
  }
  return out;
};

const AdjustStockModal = ({
  products,
  warehouses,
  prefill,
  onClose,
  onSaved,
}: {
  products: Product[];
  warehouses: { id: string; code: string; name: string }[];
  prefill: {
    productId?: string;
    variantId?: string | null;
    warehouseId?: string;
    delta?: number;
    fromManufacturing?: boolean;
    mode?: "delta" | "count";
    reason?: string;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const defaultWh =
    prefill?.warehouseId ??
    warehouses.find((w) => w.code === "WH-MAIN")?.id ??
    warehouses[0]?.id ??
    "";

  const skuOptions = useMemo(() => buildSkuOptions(products), [products]);
  const initialSkuKey = (() => {
    if (prefill?.variantId) return `v:${prefill.variantId}`;
    if (prefill?.productId) return `p:${prefill.productId}`;
    return "";
  })();

  const [skuKey, setSkuKey] = useState(initialSkuKey);
  const [warehouseId, setWarehouseId] = useState(defaultWh);
  const [binId, setBinId] = useState("");
  const [mode, setMode] = useState<"delta" | "count">(
    prefill?.mode ?? (prefill?.fromManufacturing ? "count" : "delta")
  );
  const [amount, setAmount] = useState(
    prefill?.mode === "count"
      ? ""
      : prefill?.delta != null && prefill.delta > 0
        ? String(prefill.delta)
        : ""
  );
  const [reason, setReason] = useState(
    prefill?.reason ??
      (prefill?.fromManufacturing ? "Mfg replenishment" : ADJUST_REASONS[0])
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bins, setBins] = useState<BinRow[]>([]);
  const [binsLoading, setBinsLoading] = useState(false);

  // Default warehouse once the list loads (modal can open before warehouses fetch).
  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return;
    const wh = warehouses.find((w) => w.code === "WH-MAIN") ?? warehouses[0];
    if (wh) setWarehouseId(wh.id);
  }, [warehouses, warehouseId]);

  useEffect(() => {
    if (!warehouseId) {
      setBins([]);
      setBinId("");
      return;
    }
    setBinsLoading(true);
    api
      .bins(warehouseId)
      .then((rows) => {
        setBins(rows as BinRow[]);
        setBinsLoading(false);
      })
      .catch(() => {
        setBins([]);
        setBinsLoading(false);
      });
  }, [warehouseId]);

  const selected = useMemo(
    () => skuOptions.find((o) => o.key === skuKey) ?? null,
    [skuOptions, skuKey]
  );

  // Bins fall into three buckets relative to the selected SKU:
  //   1. holding — physically tagged with this SKU level (variant
  //      bins for variants, parent-only bins for bulk parents).
  //   2. empty   — parent and variant tags both null, qty=0; can be
  //      adopted to receive new stock at the chosen SKU level.
  //   3. mismatched — tagged with a different SKU level; hidden so
  //      the user can't accidentally drop bulk into a variant bin
  //      (the backend would reject it anyway).
  const productBins = useMemo(() => {
    if (!selected) return { holding: [] as BinRow[], empty: [] as BinRow[] };
    if (selected.level === "variant") {
      const holding = bins.filter((b) => b.variantId === selected.variantId);
      const empty = bins.filter(
        (b) =>
          !b.productId &&
          !b.variantId &&
          (b.qty ?? 0) === 0
      );
      return { holding, empty };
    }
    // Parent-bulk: only bins with no variant tag, productId matching
    // (or empty bins available for putaway).
    const holding = bins.filter(
      (b) => b.productId === selected.productId && !b.variantId
    );
    const empty = bins.filter(
      (b) => !b.productId && !b.variantId && (b.qty ?? 0) === 0
    );
    return { holding, empty };
  }, [bins, selected]);

  const selectedBin = bins.find((b) => b.id === binId);
  const binQty = selectedBin?.qty ?? 0;
  const whTotalInBins = useMemo(() => {
    if (!selected) return 0;
    if (selected.level === "variant") {
      return bins
        .filter((b) => b.variantId === selected.variantId)
        .reduce((s, b) => s + (b.qty ?? 0), 0);
    }
    return bins
      .filter((b) => b.productId === selected.productId && !b.variantId)
      .reduce((s, b) => s + (b.qty ?? 0), 0);
  }, [bins, selected]);

  const parsed = Number(amount);
  const countBase = binQty;
  const delta =
    mode === "count"
      ? Number.isFinite(parsed)
        ? parsed - countBase
        : 0
      : parsed;
  const previewBin = binId ? binQty + (Number.isFinite(delta) ? delta : 0) : null;

  const binChoices = useMemo(() => {
    const holding = productBins.holding;
    const empty = productBins.empty;
    return [...holding, ...empty];
  }, [productBins]);

  const submit = async () => {
    setError(null);
    if (!selected) return setError("Pick a product or variant.");
    if (!warehouseId) return setError("Pick a warehouse.");
    if (!binId) {
      return setError(
        binChoices.length === 0
          ? selected.level === "variant"
            ? `No bins in this warehouse hold ${selected.sku}, and no empty bin is available. Create or empty a bin first.`
            : `No bulk-parent bins for ${selected.sku} in this warehouse, and no empty bin is available.`
          : "Select the exact bin where this stock lives."
      );
    }
    if (!Number.isFinite(parsed) || amount.trim() === "") return setError("Enter a quantity.");
    if (delta === 0) return setError("No change — quantity already matches.");
    if (previewBin != null && previewBin < 0) {
      return setError(`Bin would go negative (${previewBin}).`);
    }
    setBusy(true);
    try {
      const fullReason = note.trim() ? `${reason} — ${note.trim()}` : reason;
      await api.adjustStock({
        productId: selected.productId,
        variantId: selected.variantId,
        warehouseId,
        binId,
        qty: delta,
        reason: fullReason,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-xl rounded-lg elevation-3 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <div className="text-h3 font-bold">Adjust bin stock</div>
            <div className="text-caption text-ink-muted">
              Pick the exact bin, then enter qty. Manufacturing reads <strong>bin qty</strong>, not the product counter.
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas shrink-0">
            <X size={18} />
          </button>
        </div>

        {prefill?.fromManufacturing && (
          <div className="mx-5 mt-3 rounded-md bg-warning-soft border border-warning/30 px-3 py-2 text-body-sm text-[#8a6300]">
            Opened from Manufacturing. After posting, go back and click <strong>Refresh</strong> on material requirements.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium">SKU (product or variant)</span>
            <select
              value={skuKey}
              onChange={(e) => {
                setSkuKey(e.target.value);
                setBinId("");
              }}
              className="h-10 px-2 rounded-md border border-border bg-surface text-body"
            >
              <option value="">Select a SKU…</option>
              {skuOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} · counter {o.stockOnHand}
                </option>
              ))}
            </select>
            {selected && selected.level === "parent" && selected.hasVariants && (
              <span className="text-caption text-[#8a6300]">
                <strong>{selected.sku}</strong> is bulk only and not sold directly.
                It uses {selected.uom} and lives in a different bin from its
                variants. Pick a variant SKU above instead unless you're
                logging the bulk parent.
              </span>
            )}
            {selected && selected.level === "variant" && (
              <span className="text-caption text-ink-muted">
                Variant stock is held per-bin in <strong>{selected.uom}</strong>.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium">Warehouse</span>
            <select
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setBinId("");
              }}
              className="h-10 px-2 rounded-md border border-border bg-surface text-body"
            >
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </label>

          {selected && warehouseId && (
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium">
                Bin <span className="text-danger">*</span>
                <span className="text-ink-muted font-normal">
                  {" "}— scoped to {selected.level === "variant" ? "variant-tagged" : "bulk-parent"} bins
                </span>
              </span>
              {binsLoading ? (
                <div className="text-caption text-ink-muted py-2">Loading bins…</div>
              ) : (
                <select
                  value={binId}
                  onChange={(e) => setBinId(e.target.value)}
                  className={cn(
                    "h-10 px-2 rounded-md border bg-surface text-body",
                    !binId ? "border-warning" : "border-border"
                  )}
                >
                  <option value="">Select bin (required)…</option>
                  {productBins.holding.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.zone}/{b.shelf}/{b.bin} — holds {b.qty ?? 0} {selected.sku} ({selected.uom})
                    </option>
                  ))}
                  {productBins.empty.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.zone}/{b.shelf}/{b.bin} — empty slot
                    </option>
                  ))}
                </select>
              )}
              {!binsLoading && binChoices.length === 0 && (
                <div className="text-caption text-danger">
                  No bins in this warehouse hold {selected.sku} and no empty
                  slots are free. Create one under <strong>Warehouse</strong>{" "}
                  or empty an unused bin first.
                </div>
              )}
              {!binsLoading && binChoices.length > 0 && !binId && (
                <div className="text-caption text-[#8a6300]">
                  Choose where the physical stock sits — MO release reads this bin qty.
                </div>
              )}
            </label>
          )}

          {selected && warehouseId && binId && (
            <div className="rounded-md border border-border bg-canvas px-3 py-2 text-body-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-ink-muted">This bin now</span>
                <span className="tnum font-semibold">
                  {num(binQty)} {selected.uom}
                </span>
              </div>
              <div className="flex justify-between text-caption">
                <span className="text-ink-muted">
                  All {selected.level === "variant" ? "variant" : "bulk-parent"} bins in warehouse
                </span>
                <span className="tnum">
                  {num(whTotalInBins)} {selected.uom}
                </span>
              </div>
              <div className="flex justify-between text-caption">
                <span className="text-ink-muted">
                  {selected.level === "variant" ? "Variant" : "Parent"} counter (system-wide)
                </span>
                <span className="tnum">
                  {selected.stockOnHand} {selected.uom}
                </span>
              </div>
            </div>
          )}

          {selected && warehouseId && binId && (
            <>
          <div className="flex rounded-md border border-border overflow-hidden w-max">
            <button
              type="button"
              onClick={() => setMode("delta")}
              className={cn("px-3 h-8 text-body-sm", mode === "delta" ? "bg-primary text-white" : "bg-surface text-ink-muted")}
            >
              Add / remove (±)
            </button>
            <button
              type="button"
              onClick={() => setMode("count")}
              className={cn("px-3 h-8 text-body-sm", mode === "count" ? "bg-primary text-white" : "bg-surface text-ink-muted")}
            >
              Set bin total (count)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={
                mode === "delta"
                  ? "Change (+ add / − remove)"
                  : `New qty in ${selectedBin?.zone}/${selectedBin?.shelf}/${selectedBin?.bin}`
              }
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === "delta" ? "e.g. 25" : String(countBase)}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium">Reason</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 px-2 rounded-md border border-border bg-surface text-body">
                {ADJUST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. MO-2026-0042 shortage" />

          {Number.isFinite(delta) && delta !== 0 && (
            <div className="rounded-md bg-canvas border border-border px-3 py-2 text-body-sm">
              <span className="tnum">
                {selectedBin?.zone}/{selectedBin?.shelf}/{selectedBin?.bin}: {binQty}{" "}
                <span className={cn("font-semibold", delta > 0 ? "text-success" : "text-danger")}>
                  {delta > 0 ? `+${delta}` : delta}
                </span>{" "}
                → <strong>{previewBin}</strong>
              </span>
            </div>
          )}
            </>
          )}

          {error && <div className="text-body-sm text-danger">{error}</div>}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit} disabled={!selected || !warehouseId || !binId}>
            Post to selected bin
          </Button>
        </div>
      </div>
    </div>
  );
};
