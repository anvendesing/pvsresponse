import { useMemo, useState } from "react";
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
  Truck,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import type { StockLedgerEntry } from "@/data/types";
import { dt, inr, num } from "@/lib/format";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { EmptyState } from "@/components/common/EmptyState";
import { BulkOrderExportModal } from "@/components/sales/BulkOrderExportModal";

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
  const [tab, setTab] = useState<"ledger" | "valuation" | "batches">("ledger");
  const [q, setQ] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  const liveLedger = useApi(() => api.ledger({ limit: 200 }), []);
  const liveProducts = useApi(() => api.products({ limit: 500 }), []);
  const stockLedger = liveLedger.data ?? [];
  const products = liveProducts.data ?? [];
  const loading = liveLedger.loading || liveProducts.loading;
  const errorObj = liveLedger.error ?? liveProducts.error;

  const filtered = useMemo(() => {
    if (!q) return stockLedger;
    const t = q.toLowerCase();
    return stockLedger.filter(
      (l) =>
        l.product.toLowerCase().includes(t) ||
        l.sku.toLowerCase().includes(t) ||
        l.ref.toLowerCase().includes(t) ||
        l.warehouse.toLowerCase().includes(t)
    );
  }, [q, stockLedger]);

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
      cell: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.product}</div>
          <div className="text-caption text-ink-muted font-mono">{r.sku}</div>
        </div>
      ),
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
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Inventory</h2>
            <div className="flex items-center gap-1 ml-2">
              {(["ledger", "valuation", "batches"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`h-7 px-3 rounded-md text-caption font-semibold capitalize transition-colors ${
                    tab === t
                      ? "bg-primary text-white"
                      : "bg-canvas text-ink-muted hover:text-primary"
                  }`}
                >
                  {t}
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
            <Button size="sm" icon={<ArrowDownToLine size={14} />}>
              GRN · F2
            </Button>
          </>
        }
      />

      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 bg-canvas border-b border-border">
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
            <div className="flex items-center gap-1 ml-2">
              {(["GRN", "Sale", "Issue", "Production", "Transfer", "Adjust"] as const).map((t) => (
                <Chip key={t} tone={txTone(t)} size="sm">
                  {t}
                </Chip>
              ))}
            </div>
            <span className="ml-auto text-caption text-ink-muted">{filtered.length} entries</span>
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
            ) : (
              <DataTable rows={filtered} columns={columns} rowKey={(r) => r.id} dense />
            )}
          </div>
        </>
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
    </div>
  );
};
