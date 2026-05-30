import { useState, useCallback, useMemo } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Package,
  Plus,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api, type TransferOrderRow, type TransferOrderItem } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/cn";

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—";

const fmtBin = (b: { zone: string; shelf: string; bin: string } | null) =>
  b ? `${b.zone}-${b.shelf}-${b.bin}` : "—";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

const statusTone: Record<TransferOrderRow["status"], StatusTone> = {
  draft: "neutral",
  ready: "info",
  in_transit: "primary",
  done: "success",
  cancelled: "danger",
};

const statusLabel: Record<TransferOrderRow["status"], string> = {
  draft: "Draft",
  ready: "Ready",
  in_transit: "In Transit",
  done: "Done",
  cancelled: "Cancelled",
};

const kindLabel: Record<TransferOrderRow["kind"], string> = {
  putaway: "Putaway",
  replenishment: "Replenishment",
  manual: "Manual",
};

const kindTone: Record<TransferOrderRow["kind"], StatusTone> = {
  putaway: "primary",
  replenishment: "warning",
  manual: "neutral",
};

// ─── Tab component ─────────────────────────────────────────────────────────────

type Tab = "all" | "putaway" | "replenishment" | "manual";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "putaway", label: "Putaway" },
  { id: "replenishment", label: "Replenishment" },
  { id: "manual", label: "Manual" },
];

// ─── Detail slide-over ─────────────────────────────────────────────────────────

const DetailSlideOver = ({
  order,
  onClose,
  onCancel,
}: {
  order: TransferOrderRow;
  onClose: () => void;
  onCancel: (id: string) => Promise<void>;
}) => {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!confirm(`Cancel transfer ${order.transferNo}?`)) return;
    setCancelling(true);
    await onCancel(order.id);
    setCancelling(false);
  };

  const canCancel = order.status === "draft" || order.status === "ready";

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 flex justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface h-full w-full max-w-xl flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3 shrink-0">
          <ArrowRightLeft size={18} className="text-primary" />
          <div>
            <p className="font-bold text-ink">{order.transferNo}</p>
            <p className="text-caption text-ink-muted">
              {kindLabel[order.kind]} · {order.fromWarehouse.name} → {order.toWarehouse.name}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canCancel && (
              <Button
                size="sm"
                variant="outline"
                icon={<XCircle size={13} />}
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel TO"}
              </Button>
            )}
            <button
              onClick={onClose}
              className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:text-ink hover:bg-canvas"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Meta strip */}
        <div className="px-5 py-3 border-b border-border bg-canvas shrink-0 grid grid-cols-2 gap-x-6 gap-y-1 text-caption">
          <MetaRow label="Status">
            <Chip tone={statusTone[order.status]} size="sm">
              {statusLabel[order.status]}
            </Chip>
          </MetaRow>
          <MetaRow label="Kind">
            <Chip tone={kindTone[order.kind]} size="sm">
              {kindLabel[order.kind]}
            </Chip>
          </MetaRow>
          <MetaRow label="Assigned to" text={order.assignedTo?.name ?? "Unassigned"} />
          <MetaRow label="Linked MO" text={order.productionOrder?.orderNo ?? "—"} />
          <MetaRow label="Picked by" text={order.pickedBy ? `${order.pickedBy.name} · ${fmtDate(order.pickedAt)}` : "—"} />
          <MetaRow label="Dropped by" text={order.droppedBy ? `${order.droppedBy.name} · ${fmtDate(order.droppedAt)}` : "—"} />
          {order.notes && <div className="col-span-2 text-ink-muted italic">{order.notes}</div>}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-caption font-semibold text-ink-muted uppercase tracking-wide">
            Items ({order.items.length})
          </p>
          {order.items.length === 0 && (
            <p className="text-caption text-ink-muted">No items.</p>
          )}
          {order.items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
};

const MetaRow = ({
  label,
  text,
  children,
}: {
  label: string;
  text?: string;
  children?: React.ReactNode;
}) => (
  <div className="flex items-center gap-1.5">
    <span className="text-ink-muted w-24 shrink-0">{label}</span>
    {children ?? <span className="text-ink font-medium">{text}</span>}
  </div>
);

const ItemCard = ({ item }: { item: TransferOrderItem }) => (
  <div className="border border-border rounded-md p-3 bg-canvas text-caption space-y-1">
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold text-ink">
        {item.product.sku}
        {item.variant ? ` · ${item.variant.sku}` : ""}
      </span>
      <span className="text-ink-muted">{item.product.uom}</span>
    </div>
    <p className="text-ink-muted">{item.product.name}</p>
    <div className="grid grid-cols-3 gap-2 pt-1">
      <StatCell label="Requested" value={item.qtyRequested} />
      <StatCell label="Picked" value={item.qtyPicked} />
      <StatCell label="Dropped" value={item.qtyDropped} />
    </div>
    <div className="pt-1 flex gap-4">
      <span className="text-ink-muted">
        From: <span className="font-mono text-ink">{fmtBin(item.fromBin ?? null)}</span>
      </span>
      <span className="text-ink-muted">
        To: <span className="font-mono text-ink">{fmtBin(item.tobin ?? null)}</span>
      </span>
    </div>
  </div>
);

const StatCell = ({ label, value }: { label: string; value: number }) => (
  <div>
    <div className="text-ink-muted">{label}</div>
    <div className="font-semibold text-ink tnum">{value}</div>
  </div>
);

// ─── Create Transfer modal ─────────────────────────────────────────────────────

interface CreateLine {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  qty: number;
}

const CreateTransferModal = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) => {
  const warehouses = useApi(() => api.warehouses(), []);
  const products = useApi(() => api.products(), []);

  const [fromWh, setFromWh] = useState("");
  const [toWh, setToWh] = useState("");
  const [kind, setKind] = useState<"manual" | "putaway" | "replenishment">("manual");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CreateLine[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filteredProducts = useMemo(() => {
    if (!products.data || !productSearch) return [];
    const q = productSearch.toLowerCase();
    return products.data
      .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products.data, productSearch]);

  const addLine = (p: { id: string; sku: string; name: string; uom: string }) => {
    if (lines.some((l) => l.productId === p.id)) return;
    setLines((prev) => [...prev, { productId: p.id, sku: p.sku, name: p.name, uom: p.uom, qty: 1 }]);
    setProductSearch("");
  };

  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId));

  const updateQty = (productId: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty } : l)));

  const handleCreate = async () => {
    setErr(null);
    if (!fromWh || !toWh) { setErr("Select both warehouses."); return; }
    if (lines.length === 0) { setErr("Add at least one product line."); return; }
    setSaving(true);
    try {
      await api.createTransferOrder({
        kind,
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        notes: notes || null,
        items: lines.map((l) => ({ productId: l.productId, qtyRequested: l.qty })),
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create transfer.");
    } finally {
      setSaving(false);
    }
  };

  const whList = warehouses.data ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface w-full max-w-xl max-h-[90vh] flex flex-col rounded-lg elevation-3 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-2 shrink-0">
          <Plus size={16} className="text-primary" />
          <span className="font-bold text-ink">Create Transfer Order</span>
          <button
            onClick={onClose}
            className="ml-auto h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:text-ink hover:bg-canvas"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Kind */}
          <div className="grid grid-cols-3 gap-2">
            {(["manual", "putaway", "replenishment"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  "h-9 rounded-md border text-caption font-semibold capitalize transition",
                  kind === k
                    ? "border-primary bg-primary-50 text-primary"
                    : "border-border text-ink-muted hover:border-ink-muted"
                )}
              >
                {kindLabel[k]}
              </button>
            ))}
          </div>

          {/* Warehouses */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption font-medium text-ink mb-1 block">From Warehouse</label>
              <select
                className="w-full border border-border rounded-md px-3 h-9 text-body-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-primary"
                value={fromWh}
                onChange={(e) => setFromWh(e.target.value)}
              >
                <option value="">— select —</option>
                {whList.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption font-medium text-ink mb-1 block">To Warehouse</label>
              <select
                className="w-full border border-border rounded-md px-3 h-9 text-body-sm bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-primary"
                value={toWh}
                onChange={(e) => setToWh(e.target.value)}
              >
                <option value="">— select —</option>
                {whList.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-caption font-medium text-ink mb-1 block">Notes (optional)</label>
            <Input
              size="md"
              placeholder="Reason or instructions…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Product search */}
          <div>
            <label className="text-caption font-medium text-ink mb-1 block">Add Products</label>
            <div className="relative">
              <Input
                size="md"
                placeholder="Search by SKU or name…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
              {filteredProducts.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 bg-surface border border-border rounded-md shadow-e2 mt-1 max-h-48 overflow-y-auto">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 text-caption hover:bg-canvas border-b border-border last:border-0"
                      onClick={() => addLine(p)}
                    >
                      <span className="font-semibold text-ink">{p.sku}</span>
                      <span className="text-ink-muted ml-2">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.productId} className="flex items-center gap-3 border border-border rounded-md px-3 py-2 bg-canvas">
                  <div className="flex-1 min-w-0">
                    <p className="text-caption font-semibold text-ink truncate">{l.sku}</p>
                    <p className="text-caption text-ink-muted truncate">{l.name}</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) => updateQty(l.productId, Number(e.target.value))}
                    className="w-20 border border-border rounded-md px-2 h-8 text-body-sm tnum text-right text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-caption text-ink-muted w-8">{l.uom}</span>
                  <button onClick={() => removeLine(l.productId)} className="text-ink-muted hover:text-danger">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {err && <p className="text-caption text-danger">{err}</p>}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="md" onClick={onClose}>Cancel</Button>
          <Button size="md" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Transfer"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ─── Main page ─────────────────────────────────────────────────────────────────

export const Transfers = () => {
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<TransferOrderRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const allOrders = useApi(
    () => api.transferOrders({ limit: 500 }),
    [refreshKey]
  );

  const rows = useMemo(() => {
    const data = allOrders.data ?? [];
    if (tab === "all") return data;
    return data.filter((r) => r.kind === tab);
  }, [allOrders.data, tab]);

  // KPIs over the full dataset
  const kpis = useMemo(() => {
    const data = allOrders.data ?? [];
    const today = new Date().toDateString();
    return {
      pending: data.filter((r) => r.status === "ready" || r.status === "draft").length,
      inTransit: data.filter((r) => r.status === "in_transit").length,
      doneToday: data.filter(
        (r) => r.status === "done" && new Date(r.droppedAt ?? r.updatedAt).toDateString() === today
      ).length,
      cancelled: data.filter((r) => r.status === "cancelled").length,
    };
  }, [allOrders.data]);

  const handleCancel = async (id: string) => {
    await api.cancelTransferOrder(id);
    refresh();
    setSelected(null);
  };

  const columns: Column<TransferOrderRow>[] = [
    {
      key: "transferNo",
      header: "Transfer No",
      sortable: true,
      sortValue: (r) => r.transferNo,
      cell: (r) => (
        <span className="font-mono font-semibold text-ink flex items-center gap-1">
          {r.transferNo}
          <ChevronRight size={12} className="text-ink-muted" />
        </span>
      ),
      width: "140px",
    },
    {
      key: "kind",
      header: "Kind",
      cell: (r) => (
        <Chip tone={kindTone[r.kind]} size="sm">{kindLabel[r.kind]}</Chip>
      ),
      width: "120px",
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      cell: (r) => (
        <Chip tone={statusTone[r.status]} size="sm">{statusLabel[r.status]}</Chip>
      ),
      width: "110px",
    },
    {
      key: "route",
      header: "Route",
      cell: (r) => (
        <span className="text-caption">
          <span className="font-medium text-ink">{r.fromWarehouse.code}</span>
          <span className="text-ink-muted mx-1">→</span>
          <span className="font-medium text-ink">{r.toWarehouse.code}</span>
        </span>
      ),
    },
    {
      key: "mo",
      header: "Linked MO",
      cell: (r) => (
        <span className="text-caption font-mono text-ink-muted">
          {r.productionOrder?.orderNo ?? "—"}
        </span>
      ),
      width: "120px",
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      cell: (r) => (
        <span className="tnum text-caption text-ink">{r.items.length}</span>
      ),
      width: "60px",
    },
    {
      key: "assigned",
      header: "Assigned",
      cell: (r) => (
        <span className="text-caption text-ink-muted">
          {r.assignedTo?.name ?? "—"}
        </span>
      ),
      width: "130px",
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      sortValue: (r) => r.createdAt,
      cell: (r) => (
        <span className="text-caption text-ink-muted">{fmtDate(r.createdAt)}</span>
      ),
      width: "140px",
    },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Toolbar
        left={
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={18} className="text-ink-muted shrink-0" />
            <div>
              <div className="text-h3 font-bold leading-tight">Transfers</div>
              <div className="text-caption text-ink-muted">Transfer order management</div>
            </div>
          </div>
        }
        right={
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
            Create Transfer
          </Button>
        }
      />

      {/* KPI row */}
      <div className="px-4 py-3 border-b border-border grid grid-cols-4 gap-3 shrink-0">
        <Kpi
          label="Pending"
          value={String(kpis.pending)}
          accent="warning"
          icon={<Clock size={14} />}
          hint="Draft + Ready"
        />
        <Kpi
          label="In Transit"
          value={String(kpis.inTransit)}
          accent="primary"
          icon={<Truck size={14} />}
        />
        <Kpi
          label="Done Today"
          value={String(kpis.doneToday)}
          accent="success"
          icon={<CheckCircle2 size={14} />}
        />
        <Kpi
          label="Cancelled"
          value={String(kpis.cancelled)}
          accent="danger"
          icon={<XCircle size={14} />}
        />
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 flex items-center gap-1 border-b border-border shrink-0">
        {TABS.map((t) => {
          const count = t.id === "all"
            ? (allOrders.data?.length ?? 0)
            : (allOrders.data?.filter((r) => r.kind === t.id).length ?? 0);
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-9 px-3 text-caption font-medium border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-ink-muted hover:text-ink"
              )}
            >
              {t.label}
              <span className={cn(
                "ml-1.5 inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full text-[11px] font-semibold",
                tab === t.id ? "bg-primary text-white" : "bg-canvas text-ink-muted"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {allOrders.loading && (
          <div className="p-8 text-center text-ink-muted text-caption">Loading…</div>
        )}
        {!allOrders.loading && rows.length === 0 && (
          <div className="p-8 text-center">
            <Package size={32} className="mx-auto text-ink-muted mb-2" />
            <p className="text-body-sm text-ink-muted">No transfer orders found.</p>
          </div>
        )}
        {!allOrders.loading && rows.length > 0 && (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            selectedKey={selected?.id}
          />
        )}
      </div>

      {/* Detail slide-over */}
      {selected && (
        <DetailSlideOver
          order={selected}
          onClose={() => setSelected(null)}
          onCancel={handleCancel}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateTransferModal
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
};
