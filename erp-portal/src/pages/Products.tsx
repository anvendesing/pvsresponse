import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Download,
  Filter,
  Layers,
  Pencil,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { EmptyState } from "@/components/common/EmptyState";
import { ProductEditor } from "@/components/products/ProductEditor";
import { effectiveUom, type Product, type ProductType } from "@/data/types";
import { inr, num } from "@/lib/format";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";

const typeChip = (t: ProductType) => {
  const map = {
    raw: { tone: "info" as const, label: "Raw" },
    semi: { tone: "warning" as const, label: "Semi" },
    finished: { tone: "success" as const, label: "Finished" },
    consumable: { tone: "neutral" as const, label: "Consumable" },
    service: { tone: "primary" as const, label: "Service" },
  } as const;
  return map[t];
};

export const Products = () => {
  const [q, setQ] = useState("");
  const [type, setType] = useState<ProductType | "all">("all");
  const [selected, setSelected] = useState<Product | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);

  const live = useApi(() => api.products({ limit: 500 }), []);
  const products = live.data ?? [];

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (type !== "all" && p.type !== type) return false;
      if (!q) return true;
      const t = q.toLowerCase();
      return (
        p.name.toLowerCase().includes(t) ||
        p.sku.toLowerCase().includes(t) ||
        p.barcode.includes(q) ||
        p.category.toLowerCase().includes(t) ||
        (p.variants ?? []).some(
          (v) =>
            v.sku.toLowerCase().includes(t) ||
            (v.barcode ?? "").includes(q) ||
            (v.size ?? "").toLowerCase().includes(t) ||
            (v.color ?? "").toLowerCase().includes(t)
        )
      );
    });
  }, [q, type, products]);

  const columns: Column<Product>[] = [
    {
      key: "sku",
      header: "SKU",
      sortable: true,
      sortValue: (r) => r.sku,
      cell: (r) => <span className="font-mono text-caption text-ink-muted">{r.sku}</span>,
      width: "120px",
    },
    {
      key: "name",
      header: "Product",
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.name}</div>
          <div className="text-caption text-ink-muted font-mono">{r.barcode}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => {
        const c = typeChip(r.type);
        return (
          <Chip tone={c.tone} size="sm">
            {c.label}
          </Chip>
        );
      },
      width: "110px",
    },
    {
      key: "variants",
      header: "Variants / Stock",
      align: "center",
      sortable: true,
      sortValue: (r) => r.stockOnHand,
      cell: (r) => <VariantStockCell product={r} />,
      width: "180px",
    },
    {
      key: "category",
      header: "Category",
      cell: (r) => <span className="text-ink">{r.category}</span>,
      width: "120px",
    },
    {
      key: "uom",
      header: "UOM",
      cell: (r) => <span className="font-mono text-caption">{r.uom}</span>,
      width: "70px",
      align: "center",
    },
    {
      key: "reorder",
      header: "Reorder",
      align: "right",
      cell: (r) => <span className="text-ink-muted tnum">{num(r.reorderLevel)}</span>,
      width: "90px",
    },
    {
      key: "price",
      header: "Price",
      sortable: true,
      sortValue: (r) => r.sellingPrice,
      align: "right",
      cell: (r) => <span className="text-ink font-semibold tnum">{inr(r.sellingPrice)}</span>,
      width: "110px",
    },
    {
      key: "state",
      header: "State",
      cell: (r) => (
        <Chip tone={r.state === "active" ? "success" : "danger"} size="sm">
          {r.state}
        </Chip>
      ),
      width: "100px",
    },
  ];

  const types: { id: ProductType | "all"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "raw", label: "Raw" },
    { id: "semi", label: "Semi" },
    { id: "finished", label: "Finished" },
    { id: "consumable", label: "Consumable" },
  ];

  const handleSaved = (p: Product) => {
    void live.refetch();
    if (selected?.id === p.id) setSelected(p);
  };

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Products</h2>
            <Chip tone="neutral">
              {filtered.length} of {products.length}
            </Chip>
          </>
        }
        right={
          <>
            <Button variant="outline" size="sm" icon={<Upload size={14} />}>
              Import
            </Button>
            <Button variant="outline" size="sm" icon={<Download size={14} />}>
              Export
            </Button>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setSelected(null);
                setEditorMode("create");
              }}
            >
              New Product · F2
            </Button>
          </>
        }
      />
      <div className="flex-1 flex min-h-0">
        <div
          className={`flex-1 flex flex-col min-w-0 ${selected ? "border-r border-border" : ""}`}
        >
          <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
            <Input
              size="sm"
              iconLeft={<Search size={14} />}
              placeholder="Search SKU, name, barcode, variant…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="!h-8"
            />
            <div className="flex items-center gap-1 ml-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className={`h-7 px-3 rounded-md text-caption font-semibold transition-colors ${
                    type === t.id
                      ? "bg-primary text-white"
                      : "bg-canvas text-ink-muted hover:text-primary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" icon={<Filter size={14} />}>
              More filters
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-surface">
            {live.loading || live.error || filtered.length === 0 ? (
              <EmptyState
                loading={live.loading}
                error={live.error}
                empty={!live.loading && !live.error && filtered.length === 0}
                emptyTitle={products.length === 0 ? "No products yet" : "No products match"}
                emptyDescription={
                  products.length === 0
                    ? "Click 'New Product' to add your first item."
                    : "Try a different search or clear the type filter."
                }
                onRetry={live.refetch}
              />
            ) : (
              <DataTable
                rows={filtered}
                columns={columns}
                rowKey={(r) => r.id}
                onRowClick={(r) => setSelected(r)}
                selectedKey={selected?.id}
              />
            )}
          </div>
        </div>
        {selected && (
          <aside className="w-[420px] bg-surface flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-caption text-ink-muted font-mono">{selected.sku}</div>
                <div className="text-h3 font-bold truncate">{selected.name}</div>
              </div>
              <button
                className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
                onClick={() => setSelected(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="aspect-[4/3] bg-canvas rounded-lg grid place-items-center text-ink-muted border border-border">
                <div className="text-center">
                  <div className="text-h2 font-bold text-primary">{selected.uom}</div>
                  <div className="text-caption">Image preview</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="On Hand" value={num(selected.stockOnHand)} />
                <Stat label="Reorder" value={num(selected.reorderLevel)} />
                <Stat label="Cost" value={inr(selected.costPrice)} />
                <Stat label="Selling" value={inr(selected.sellingPrice)} />
                <Stat label="HSN" value={selected.hsn} />
                <Stat label="UOM" value={selected.uom} />
              </div>
              <Card title="Attributes" noPadding>
                <div className="divide-y divide-border">
                  <Row k="Category" v={selected.category} />
                  <Row k="Type" v={typeChip(selected.type).label} />
                  <Row k="Barcode" v={selected.barcode} mono />
                  <Row k="Batch tracked" v={selected.batchTracked ? "Yes" : "No"} />
                  <Row k="State" v={selected.state} />
                </div>
              </Card>
              {selected.variants && selected.variants.length > 0 && (
                <Card
                  title={`Variants (${selected.variants.length})`}
                  noPadding
                  actions={
                    <Chip size="sm" tone="info">
                      parent <span className="font-mono mx-0.5">{selected.uom}</span>{" "}
                      = bulk
                    </Chip>
                  }
                >
                  <div className="divide-y divide-border">
                    {selected.variants.map((v, i) => {
                      const vu = effectiveUom(selected, v);
                      const pack = v.packSize ?? 1;
                      return (
                        <div
                          key={v.id ?? i}
                          className="px-3 py-2 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-caption text-ink-muted">
                              {v.sku}
                            </div>
                            <div className="text-body-sm font-semibold">
                              {[v.size, v.color, v.grade].filter(Boolean).join(" · ") || "—"}
                            </div>
                            <div className="text-caption text-ink-muted tnum mt-0.5">
                              sells in <span className="font-mono">{vu}</span>
                              {pack !== 1 && (
                                <>
                                  {" "}
                                  · 1 {vu} = <b>{pack}</b> {selected.uom}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div
                              className={`tnum text-body-sm font-semibold ${v.stockOnHand < 0 ? "text-danger" : ""}`}
                              title={
                                v.stockOnHand < 0
                                  ? "Negative on-hand: more units of this variant have been issued than were recorded in stock. Recount and reconcile in Inventory."
                                  : undefined
                              }
                            >
                              {num(v.stockOnHand)} {vu}
                            </div>
                            {v.sellingPriceOverride != null && (
                              <div className="text-caption text-ink-muted tnum">
                                {inr(v.sellingPriceOverride)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
              <Card title="Lifecycle">
                <div className="flex items-center gap-2">
                  {(["draft", "active", "discontinued", "blocked"] as const).map((s, i) => (
                    <div
                      key={s}
                      className={`flex-1 px-2 py-1.5 text-center rounded text-caption font-semibold ${
                        s === selected.state
                          ? "bg-primary text-white"
                          : "bg-canvas text-ink-muted"
                      }`}
                    >
                      {i + 1}. {s}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="border-t border-border p-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                icon={<Pencil size={14} />}
                onClick={() => setEditorMode("edit")}
              >
                Edit
              </Button>
              <Button size="sm" className="flex-1" icon={<CheckCircle2 size={14} />} disabled>
                Save · F4
              </Button>
            </div>
          </aside>
        )}
      </div>

      <ProductEditor
        open={editorMode !== null}
        mode={editorMode ?? "create"}
        product={selected}
        onClose={() => setEditorMode(null)}
        onSaved={handleSaved}
      />
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-canvas border border-border rounded-md px-3 py-2">
    <div className="text-caption text-ink-muted uppercase">{label}</div>
    <div className="text-body font-bold text-ink mt-0.5 tnum">{value}</div>
  </div>
);

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="flex items-center justify-between px-3 py-2 text-body-sm">
    <span className="text-ink-muted">{k}</span>
    <span className={mono ? "font-mono text-caption" : "font-semibold text-ink"}>{v}</span>
  </div>
);

// Stock tone helper: red = negative on-hand, amber = at-or-below reorder
// level, neutral otherwise. Used both on the cell trigger and inside the
// hover popover.
const stockTone = (
  stock: number,
  reorderLevel: number
): "danger" | "warning" | "neutral" => {
  if (stock < 0) return "danger";
  if (stock <= reorderLevel) return "warning";
  return "neutral";
};

const stockClass = (tone: ReturnType<typeof stockTone>) =>
  tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink";

// Combined cell for the "Variants / Stock" column. Replaces the old separate
// "On Hand" column - the parent total still drives sort and row tone, while
// hovering reveals the per-variant breakdown when a product has variants
// (or the parent reorder context for non-variant products). Built with a
// portal to escape the table's overflow:auto clipping.
const POPOVER_WIDTH = 340;

const VariantStockCell = ({ product }: { product: Product }) => {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const variants = product.variants ?? [];
  const hasVariants = variants.length > 0;
  const variantSum = hasVariants
    ? variants.reduce((s, v) => s + v.stockOnHand, 0)
    : 0;
  const parentTone = stockTone(product.stockOnHand, product.reorderLevel);
  const anyNegativeVariant = hasVariants && variants.some((v) => v.stockOnHand < 0);

  const recomputePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popoverHeight = hasVariants ? Math.min(280, 80 + variants.length * 28) : 110;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < popoverHeight && rect.top > spaceBelow;
    const top = flipUp ? rect.top - 6 - popoverHeight : rect.bottom + 6;
    let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    if (left < 8) left = 8;
    if (left + POPOVER_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - POPOVER_WIDTH - 8;
    }
    setPos({ top: Math.max(8, top), left });
  };

  useLayoutEffect(() => {
    if (open) recomputePos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onEnter = () => {
    recomputePos();
    setOpen(true);
  };
  const onLeave = () => setOpen(false);

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-flex items-center justify-center gap-1.5 cursor-help select-none"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {hasVariants ? (
          <>
            <Chip
              size="sm"
              tone={anyNegativeVariant ? "danger" : "info"}
              icon={<Layers size={11} />}
            >
              {variants.length}
            </Chip>
            <span
              className={`font-semibold tnum text-body-sm ${stockClass(parentTone)}`}
            >
              {num(product.stockOnHand)}
            </span>
          </>
        ) : (
          <span className={`font-semibold tnum text-body-sm ${stockClass(parentTone)}`}>
            {num(product.stockOnHand)}
          </span>
        )}
      </div>
      {open && pos
        ? createPortal(
            <div
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: POPOVER_WIDTH,
                zIndex: 1000,
              }}
              className="bg-surface border border-border rounded-md shadow-lg overflow-hidden text-left"
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
            >
              <div className="px-3 py-2 border-b border-border bg-canvas">
                <div className="text-caption text-ink-muted uppercase font-semibold">
                  Stock breakdown
                </div>
                <div className="text-body-sm font-semibold truncate" title={product.name}>
                  {product.sku} · {product.name}
                </div>
              </div>
              {hasVariants ? (
                <div className="max-h-[280px] overflow-auto">
                  <table className="w-full text-body-sm">
                    <thead className="text-caption text-ink-muted uppercase">
                      <tr className="bg-canvas">
                        <th className="px-3 py-1.5 text-left font-semibold">Variant</th>
                        <th className="px-3 py-1.5 text-left font-semibold">Attributes</th>
                        <th className="px-3 py-1.5 text-right font-semibold">On Hand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => {
                        const tone = stockTone(v.stockOnHand, product.reorderLevel);
                        const vu = effectiveUom(product, v);
                        const pack = v.packSize ?? 1;
                        return (
                          <tr key={v.id} className="border-t border-border">
                            <td className="px-3 py-1.5">
                              <div className="font-mono text-caption text-ink">{v.sku}</div>
                              {pack !== 1 && (
                                <div
                                  className="text-caption text-ink-muted tnum"
                                  title="Conversion factor: how many parent UoM units one variant unit represents."
                                >
                                  1 {vu} = <b>{pack}</b> {product.uom}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-ink-muted">
                              {[v.size, v.color, v.grade].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td
                              className={`px-3 py-1.5 text-right tnum font-semibold ${stockClass(
                                tone
                              )}`}
                              title={
                                tone === "danger"
                                  ? "Negative on-hand: more units issued than recorded. Recount in Inventory."
                                  : tone === "warning"
                                    ? `At or below reorder level (${product.reorderLevel}).`
                                    : undefined
                              }
                            >
                              {num(v.stockOnHand)} {vu}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-canvas">
                        <td className="px-3 py-1.5 text-caption text-ink-muted uppercase font-semibold">
                          Parent (bulk)
                        </td>
                        <td className="px-3 py-1.5 text-caption text-ink-muted">
                          stock monitor
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tnum font-bold ${stockClass(
                            parentTone
                          )}`}
                        >
                          {num(product.stockOnHand)} {product.uom}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-3 space-y-1.5 text-body-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">On hand</span>
                    <span
                      className={`tnum font-bold ${stockClass(parentTone)}`}
                    >
                      {num(product.stockOnHand)} {product.uom}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Reorder level</span>
                    <span className="tnum font-semibold text-ink">
                      {num(product.reorderLevel)} {product.uom}
                    </span>
                  </div>
                  {parentTone === "danger" && (
                    <div className="text-caption text-danger pt-1">
                      Negative on-hand: more units issued than recorded. Recount in
                      Inventory.
                    </div>
                  )}
                  {parentTone === "warning" && (
                    <div className="text-caption text-warning pt-1">
                      At or below reorder level. Consider raising a purchase order.
                    </div>
                  )}
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
