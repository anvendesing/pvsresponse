import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Truck } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { SalesOrderDetail } from "@/components/sales/SalesOrderDetail";
import { ImportOrderPdfModal } from "@/components/sales/ImportOrderPdfModal";
import { api, type SalesOrderRow, type SalesOrderStatus } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { dd, inr } from "@/lib/format";
import { cn } from "@/lib/cn";

type SourceFilter = "all" | "internal" | "ecommerce" | "imported";

const SOURCE_FILTERS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "internal", label: "Back office" },
  { id: "ecommerce", label: "Ecommerce" },
  { id: "imported", label: "Imported" },
];

const STATUS_FILTERS: { id: SalesOrderStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "confirmed", label: "Confirmed" },
  { id: "partially_invoiced", label: "Partial" },
  { id: "invoiced", label: "Invoiced" },
  { id: "on_hold", label: "On hold" },
  { id: "closed", label: "Closed" },
  { id: "cancelled", label: "Cancelled" },
];

const statusTone = (s: SalesOrderStatus): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (s) {
    case "confirmed":
      return "primary";
    case "partially_invoiced":
      return "warning";
    case "invoiced":
      return "success";
    case "closed":
      return "neutral";
    case "cancelled":
      return "danger";
    case "on_hold":
      return "warning";
  }
};

export const SalesOrders = () => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<SalesOrderStatus | "all">("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const live = useApi(() => api.salesOrders({ limit: 500 }), []);
  const sos = live.data ?? [];

  // Refetch the list every time the user comes back to this tab and
  // (as a safety net) every 30s while it's visible. Ecommerce orders
  // arrive asynchronously from /store so without this the list goes
  // stale the moment the user switches windows. The original deps:[]
  // useApi only ran once on mount, which is exactly how SO-2026-2010
  // could land in the DB but stay invisible on this screen.
  // refetch is memoized in useApi via useCallback(deps=[]) so depending
  // on it doesn't re-bind the listeners every render.
  const refetch = live.refetch;
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(id);
    };
  }, [refetch]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sos.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (source !== "all" && (s.source ?? "internal") !== source) return false;
      if (!term) return true;
      return (
        s.soNo.toLowerCase().includes(term) ||
        s.customer?.name.toLowerCase().includes(term)
      );
    });
  }, [sos, q, status, source]);

  const cols: Column<SalesOrderRow>[] = [
    {
      key: "no",
      header: "SO",
      width: "180px",
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-caption font-semibold text-primary">{r.soNo}</span>
          {r.source === "ecommerce" && (
            <Chip tone="primary" size="sm" className="!h-4 !px-1.5 text-[10px] uppercase tracking-wide">
              Ecom
            </Chip>
          )}
          {r.source === "imported" && (
            <Chip tone="warning" size="sm" className="!h-4 !px-1.5 text-[10px] uppercase tracking-wide">
              Imp
            </Chip>
          )}
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.soNo,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div>
          <div className="font-semibold">{r.customer?.name}</div>
          <div className="text-caption text-ink-muted">{r.customer?.city ?? ""}</div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.customer?.name ?? "",
    },
    {
      key: "lines",
      header: "Lines",
      align: "center",
      width: "70px",
      cell: (r) => <span className="tnum">{r._count?.items ?? r.items?.length ?? 0}</span>,
    },
    {
      key: "progress",
      header: "Progress",
      width: "180px",
      cell: (r) => {
        const ord = (r.items ?? []).reduce(
          (s, it) => s + ("qtyOrdered" in it ? it.qtyOrdered : 0),
          0
        );
        const inv = (r.items ?? []).reduce(
          (s, it) => s + ("qtyInvoiced" in it ? it.qtyInvoiced : 0),
          0
        );
        const pct = ord > 0 ? Math.round((inv / ord) * 100) : 0;
        return (
          <div>
            <div className="text-caption tnum">
              {inv}/{ord} ({pct}%)
            </div>
            <div className="h-1.5 bg-canvas rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-success transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      width: "130px",
      cell: (r) => <span className="font-bold tnum">{inr(r.total)}</span>,
      sortable: true,
      sortValue: (r) => r.total,
    },
    {
      key: "date",
      header: "Order date",
      width: "120px",
      cell: (r) => <span className="text-caption">{dd(r.orderDate)}</span>,
      sortable: true,
      sortValue: (r) => r.orderDate,
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      cell: (r) => (
        <Chip tone={statusTone(r.status)} size="sm" className="capitalize">
          {r.status.replace(/_/g, " ")}
        </Chip>
      ),
    },
    {
      key: "invoices",
      header: "Invoices",
      width: "90px",
      align: "center",
      cell: (r) => <span className="tnum">{r._count?.invoices ?? 0}</span>,
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={<h2 className="text-h3 font-bold">Sales Orders</h2>}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              title="Import a shipping-label / external order PDF"
              className="h-7 px-3 inline-flex items-center gap-1.5 rounded-md text-caption font-semibold border border-primary bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              <Truck size={13} />
              Import order PDF
            </button>
            <button
              type="button"
              onClick={() => void live.refetch()}
              disabled={live.loading}
              title="Refresh list"
              className={cn(
                "h-7 px-3 inline-flex items-center gap-1.5 rounded-md text-caption font-semibold border border-border bg-surface text-ink-muted hover:text-primary hover:border-primary transition-colors",
                live.loading && "opacity-60 cursor-not-allowed"
              )}
            >
              <RefreshCw size={13} className={cn(live.loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="px-4 py-2 bg-surface border-b border-border flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search by SO no. or customer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="!h-8 max-w-xs"
        />
        <div className="flex items-center gap-1 ml-2 flex-wrap">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={cn(
                "h-7 px-3 rounded-md text-caption font-semibold transition-colors capitalize",
                status === s.id
                  ? "bg-primary text-white"
                  : "bg-canvas text-ink-muted hover:text-primary"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-wrap border-l border-border pl-2">
          {SOURCE_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSource(s.id)}
              className={cn(
                "h-7 px-3 rounded-md text-caption font-semibold transition-colors",
                source === s.id
                  ? "bg-primary text-white"
                  : "bg-canvas text-ink-muted hover:text-primary"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-caption text-ink-muted">{filtered.length} orders</span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-surface">
        {live.loading || live.error || filtered.length === 0 ? (
          <EmptyState
            loading={live.loading}
            error={live.error}
            empty={!live.loading && !live.error && filtered.length === 0}
            emptyTitle="No sales orders match"
            emptyDescription="SOs are created when a quote is accepted, or directly from POS."
            onRetry={live.refetch}
          />
        ) : (
          <DataTable
            rows={filtered}
            columns={cols}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
          />
        )}
      </div>

      {openId && (
        <SalesOrderDetail
          salesOrderId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void live.refetch()}
        />
      )}

      <ImportOrderPdfModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onCreated={(soId) => {
          void live.refetch();
          setOpenId(soId);
        }}
      />
    </div>
  );
};
