import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Camera,
  CheckCircle2,
  Download,
  Filter,
  ImagePlus,
  Layers,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Wand2,
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
import { NormalizeUomsModal } from "@/components/products/NormalizeUomsModal";
import { effectiveUom, type Product, type ProductType } from "@/data/types";
import { inr, num } from "@/lib/format";
import { api, auth, resolveUploadUrl } from "@/lib/api";
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
  const [imgUploading, setImgUploading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [showNormalizeUoms, setShowNormalizeUoms] = useState(false);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const role = auth.user()?.role ?? "";
  const canNormalize = role === "admin" || role === "supervisor";
  const productImgRef = useRef<HTMLInputElement>(null);
  // Delete-confirmation dialog state for the currently selected product.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleProductImageUpload = async (file: File) => {
    if (!selected?.id) return;
    setImgUploading(true);
    setImgError(null);
    try {
      const r = await api.uploadProductImage(selected.id, file);
      setSelected((s) => s ? { ...s, imageUrl: r.imageUrl } : s);
      await live.refetch();
    } catch (e) {
      setImgError((e as Error).message);
    } finally {
      setImgUploading(false);
    }
  };

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
        p.barcode.toLowerCase().includes(t) ||
        (p.category?.name ?? "").toLowerCase().includes(t) ||
        (p.variants ?? []).some(
          (v) =>
            v.sku.toLowerCase().includes(t) ||
            (v.barcode ?? "").toLowerCase().includes(t) ||
            (v.size ?? "").toLowerCase().includes(t) ||
            (v.color ?? "").toLowerCase().includes(t)
        )
      );
    });
  }, [q, type, products]);

  const columns: Column<Product>[] = [
    {
      key: "image",
      header: "",
      cell: (r) => {
        const src = resolveUploadUrl(r.imageUrl) ?? null;
        return src ? (
          <img src={src} alt={r.name} className="w-9 h-9 object-cover rounded border border-border" />
        ) : (
          <div
            className="w-9 h-9 rounded border border-border bg-canvas grid place-items-center text-ink-muted"
            title="No product image"
          >
            <Package size={16} />
          </div>
        );
      },
      width: "52px",
    },
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
      cell: (r) => <span className="text-ink">{r.category?.name ?? "—"}</span>,
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

  const handleConfirmDelete = async () => {
    if (!selected?.id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProduct(selected.id);
      setDeleteOpen(false);
      setSelected(null);
      await live.refetch();
    } catch (e) {
      // Backend returns 409 with a friendly message when the product is
      // still referenced by other records (BOMs, invoices, etc.) — show
      // that message verbatim so the user knows to mark it discontinued
      // instead.
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
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
            {canNormalize && (
              <Button
                variant="outline"
                size="sm"
                icon={<Wand2 size={14} />}
                onClick={() => setShowNormalizeUoms(true)}
                title="Bulk-coerce parents to kg/L and variants to pc"
              >
                Normalize UoMs
              </Button>
            )}
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
      {okBanner && (
        <div className="px-4 py-2 bg-success-soft border-b border-success text-success text-body-sm flex items-center gap-2">
          <CheckCircle2 size={14} />
          <span className="flex-1">{okBanner}</span>
          <button
            className="underline text-caption"
            onClick={() => setOkBanner(null)}
          >
            dismiss
          </button>
        </div>
      )}
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
              {/* Product image */}
              <div className="relative group">
                {selected.imageUrl ? (
                  <img
                    src={resolveUploadUrl(selected.imageUrl)}
                    alt={selected.name}
                    className="w-full aspect-[4/3] object-cover rounded-lg border border-border"
                  />
                ) : (
                  <div className="aspect-[4/3] bg-canvas rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-ink-muted">
                    <ImagePlus size={32} />
                    <span className="text-body-sm">No product image</span>
                  </div>
                )}
                {/* Upload overlay — appears on hover */}
                <button
                  className="absolute inset-0 rounded-lg bg-ink/0 hover:bg-ink/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100"
                  onClick={() => productImgRef.current?.click()}
                  title="Upload product image"
                >
                  <Camera size={20} className="text-white" />
                  <span className="text-white text-body-sm font-semibold">
                    {selected.imageUrl ? "Replace image" : "Upload image"}
                  </span>
                </button>
                {imgUploading && (
                  <div className="absolute inset-0 rounded-lg bg-ink/60 flex items-center justify-center">
                    <span className="text-white text-body-sm font-semibold">Uploading…</span>
                  </div>
                )}
                <input
                  ref={productImgRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleProductImageUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>
              {imgError && (
                <div className="text-danger text-body-sm bg-danger-soft border border-danger rounded px-2 py-1">
                  {imgError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Stat label="On Hand" value={num(selected.stockOnHand)} />
                <Stat label="Reorder" value={num(selected.reorderLevel)} />
                <Stat label="Cost" value={inr(selected.costPrice)} />
                <Stat label="Selling" value={inr(selected.sellingPrice)} />
                <Stat label="HSN" value={selected.hsn} />
                <Stat label="GST" value={`${selected.gstRate ?? 18}%`} />
                <Stat label="UOM" value={selected.uom} />
              </div>
              <Card title="Attributes" noPadding>
                <div className="divide-y divide-border">
                  <Row k="Category" v={selected.category?.name ?? "—"} />
                  <Row k="Type" v={typeChip(selected.type).label} />
                  <Row k="Barcode" v={selected.barcode} mono />
                  <Row k="Batch tracked" v={selected.batchTracked ? "Yes" : "No"} />
                  <Row k="State" v={selected.state} />
                </div>
              </Card>
              {selected.description?.trim() && (
                <Card title="Description">
                  <p className="text-body-sm text-ink whitespace-pre-wrap leading-relaxed">
                    {selected.description}
                  </p>
                </Card>
              )}
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
                      // Resolved image: variant-specific first, then fall back to product image
                      const varImgSrc = resolveUploadUrl(v.imageUrl || selected.imageUrl) ?? null;
                      return (
                        <div
                          key={v.id ?? i}
                          className="px-3 py-2 flex items-start gap-3"
                        >
                          {/* Variant image thumbnail / upload trigger */}
                          <VariantImgCell
                            src={resolveUploadUrl(v.imageUrl) ?? varImgSrc}
                            hasOwnImage={!!v.imageUrl}
                            variantId={v.id ?? null}
                            productId={selected.id}
                            onUploaded={(url) => {
                              setSelected((s) =>
                                s
                                  ? {
                                      ...s,
                                      variants: (s.variants ?? []).map((vv) =>
                                        vv.id === v.id ? { ...vv, imageUrl: url } : vv
                                      ),
                                    }
                                  : s
                              );
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-mono text-caption text-ink-muted">
                                {v.sku}
                              </div>
                              {v.barcode && (
                                <div className="font-mono text-caption text-ink-muted">
                                  · {v.barcode}
                                </div>
                              )}
                            </div>
                            <div className="text-body-sm font-semibold">
                              {[v.size, v.color, v.grade].filter(Boolean).join(" · ") || "—"}
                            </div>
                            <div className="text-caption text-ink-muted tnum mt-0.5 flex gap-2 flex-wrap">
                              <span>
                                sells in <span className="font-mono">{vu}</span>
                                {pack !== 1 && (
                                  <>
                                    {" "}
                                    · 1 {vu} = <b>{pack}</b> {selected.uom}
                                  </>
                                )}
                              </span>
                              {v.gstRate != null && (
                                <span className="text-ink-muted">· GST {v.gstRate}%</span>
                              )}
                              {v.hsn && (
                                <span className="text-ink-muted">· HSN {v.hsn}</span>
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
              <Button
                variant="outline"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
                title="Delete this product"
                className="text-danger border-danger/40 hover:bg-danger-soft hover:border-danger"
              >
                Delete
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

      {deleteOpen && selected && (
        <DeleteProductDialog
          product={selected}
          deleting={deleting}
          error={deleteError}
          onCancel={() => {
            if (!deleting) setDeleteOpen(false);
          }}
          onConfirm={handleConfirmDelete}
        />
      )}

      {showNormalizeUoms && (
        <NormalizeUomsModal
          onClose={() => setShowNormalizeUoms(false)}
          onApplied={(msg) => {
            setShowNormalizeUoms(false);
            setOkBanner(msg);
            void live.refetch();
          }}
        />
      )}
    </div>
  );
};

const DeleteProductDialog = ({
  product,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  product: Product;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div
    className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
    onClick={onCancel}
  >
    <div
      className="bg-surface w-full max-w-md rounded-lg elevation-3 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-5 py-4 border-b border-border flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-danger-soft text-danger grid place-items-center shrink-0">
          <Trash2 size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-h3 font-bold">Delete product?</div>
          <div className="text-body-sm text-ink-muted mt-0.5">
            <span className="font-mono text-caption">{product.sku}</span>
            {" · "}
            <span className="font-semibold text-ink">{product.name}</span>
          </div>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        <p className="text-body-sm text-ink">
          This permanently removes the product and all of its variants from the catalogue.
          The action cannot be undone.
        </p>
        <p className="text-caption text-ink-muted">
          If this product has been used in BOMs, purchase orders, invoices, or stock
          movements, the delete will fail and you should set its state to
          <span className="font-semibold"> discontinued</span> instead.
        </p>
        {error && (
          <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
            {error}
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-canvas">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onConfirm}
          disabled={deleting}
          icon={<Trash2 size={14} />}
        >
          {deleting ? "Deleting…" : "Delete product"}
        </Button>
      </div>
    </div>
  </div>
);

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
const POPOVER_WIDTH = 380;

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
                        <th className="px-3 py-1.5 text-left font-semibold">Barcode</th>
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
                            <td className="px-3 py-1.5 font-mono text-caption text-primary">
                              {v.barcode?.trim() || (
                                <span className="text-ink-muted">—</span>
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
                        <td className="px-3 py-1.5 text-caption text-ink-muted">—</td>
                        <td className="px-3 py-1.5 text-caption text-ink-muted">
                          loose bulk only
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tnum font-bold ${stockClass(
                            parentTone
                          )}`}
                          title="Bulk kg in storage — not packed variant pcs. Packaged stock is in the variant rows above."
                        >
                          {num(product.stockOnHand)} {product.uom}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="px-3 py-2 border-t border-border flex flex-wrap items-center justify-between gap-2">
                    <span className="text-caption text-ink-muted">
                      Packaged total in bulk UoM:{" "}
                      <span className="tnum font-semibold text-ink">
                        {num(
                          variants.reduce(
                            (s, v) => s + v.stockOnHand * (v.packSize ?? 1),
                            0
                          ),
                          3
                        )}{" "}
                        {product.uom}
                      </span>{" "}
                      (= sum of variant pcs × pack size)
                    </span>
                    <Link
                      to={`/inventory?tab=locations&productId=${encodeURIComponent(product.id)}`}
                      className="text-caption text-primary hover:underline font-semibold"
                    >
                      View bin locations →
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="p-3 space-y-1.5 text-body-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Barcode</span>
                    <span className="font-mono text-caption text-primary">
                      {product.barcode?.trim() || "—"}
                    </span>
                  </div>
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

// Small variant image cell with hover-to-upload.
// Shows the variant's own image when set; falls back to the product image.
// Clicking always uploads a NEW image specifically for that variant.
const VariantImgCell = ({
  src,
  hasOwnImage,
  variantId,
  productId,
  onUploaded,
}: {
  src: string | null;
  hasOwnImage: boolean;
  variantId: string | null;
  productId: string;
  onUploaded: (url: string) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canUpload = !!variantId && !!productId;

  const handleFile = async (file: File) => {
    if (!variantId) return;
    setUploading(true);
    setErr(null);
    try {
      const r = await api.uploadVariantImage(productId, variantId, file);
      onUploaded(r.imageUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="relative w-14 h-14 rounded-md border border-border overflow-hidden flex-shrink-0 group cursor-pointer"
      onClick={() => canUpload && inputRef.current?.click()}
      title={canUpload ? "Click to upload variant image" : ""}
    >
      {src ? (
        <img src={src} alt="variant" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-canvas flex items-center justify-center">
          <ImagePlus size={16} className="text-ink-muted" />
        </div>
      )}
      {/* Hover overlay */}
      {canUpload && !uploading && (
        <div className="absolute inset-0 bg-ink/0 hover:bg-ink/50 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Camera size={14} className="text-white" />
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 bg-ink/60 flex items-center justify-center">
          <span className="text-white text-[10px]">…</span>
        </div>
      )}
      {!hasOwnImage && src && (
        <div className="absolute bottom-0 left-0 right-0 bg-ink/60 text-white text-[9px] text-center leading-tight py-0.5">
          product
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
};
