import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, History, ImagePlus, Lock, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { UomPicker } from "@/components/common/UomPicker";
import type { Product, ProductState, ProductType, ProductVariant, StockLedgerEntry } from "@/data/types";
import { api, resolveUploadUrl } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { ProductCategory } from "@/data/types";
import { cn } from "@/lib/cn";
import { dd, num } from "@/lib/format";

type Mode = "create" | "edit";

interface Props {
  open: boolean;
  mode: Mode;
  product?: Product | null;
  onClose: () => void;
  onSaved: (p: Product) => void;
}

const PRODUCT_TYPES: ProductType[] = ["raw", "semi", "finished", "consumable", "service"];
const PRODUCT_STATES: ProductState[] = ["draft", "active", "discontinued", "blocked"];

const emptyForm = (): Product => ({
  id: "",
  sku: "",
  name: "",
  type: "finished",
  uom: "pc",
  barcode: "",
  state: "active",
  stockOnHand: 0,
  reorderLevel: 0,
  costPrice: 0,
  sellingPrice: 0,
  categoryId: "",
  hsn: "",
  gstRate: 18,
  batchTracked: false,
  imageUrl: null,
  description: "",
  variants: [],
});

const emptyVariant = (_parent: { sku: string; barcode: string }): ProductVariant => ({
  // SKU and barcode intentionally left blank — the backend auto-generates
  // unique codes when submitted empty.
  sku: "",
  barcode: null,
  hsn: null,
  gstRate: null,
  size: null,
  color: null,
  grade: null,
  uom: null,
  packSize: 1,
  costPriceOverride: null,
  sellingPriceOverride: null,
  stockOnHand: 0,
  active: true,
  imageUrl: null,
});

export const ProductEditor = ({ open, mode, product, onClose, onSaved }: Props) => {
  const categoriesQuery = useApi(() => api.productCategories({ active: true }), []);
  const categories = categoriesQuery.data ?? [];

  const [form, setForm] = useState<Product>(() => emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgerProductId, setLedgerProductId] = useState<string | null>(null);
  const [binStock, setBinStock] = useState<{ total: number; free: number; bins: { warehouse: string; location: string; qty: number; reserved: number; free: number }[] } | null>(null);
  const [binStockLoading, setBinStockLoading] = useState(false);
  const [syncingStock, setSyncingStock] = useState(false);
  // variantId → { newQty: number; saving: boolean }
  const [varAdjust, setVarAdjust] = useState<Record<string, { newQty: number; saving: boolean }>>({});
  // Image upload state
  const [imgUploading, setImgUploading] = useState(false);
  const [varImgUploading, setVarImgUploading] = useState<string | null>(null); // variantId being uploaded
  const productImgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && product) {
      setForm({
        ...product,
        categoryId: product.categoryId ?? product.category?.id ?? "",
        variants: product.variants ?? [],
      });
    } else {
      const f = emptyForm();
      if (categories.length > 0 && !f.categoryId) {
        f.categoryId = categories[0].id;
      }
      setForm(f);
    }
    setError(null);
    if (mode === "edit" && product?.id) {
      setBinStockLoading(true);
      api.productBinStock(product.id).then((d) => { setBinStock(d); setBinStockLoading(false); }).catch(() => setBinStockLoading(false));
    } else {
      setBinStock(null);
    }
    setVarAdjust({});
  }, [open, mode, product]);

  const handleSyncStock = async () => {
    if (!form.id) return;
    setSyncingStock(true);
    try {
      const r = await api.syncProductStock(form.id);
      setForm((f) => ({ ...f, stockOnHand: r.after }));
      setBinStock((prev) => prev ? { ...prev, total: r.binTotal } : prev);
    } catch {
      // ignore
    } finally {
      setSyncingStock(false);
    }
  };

  const openVariantAdjust = (vid: string, current: number) =>
    setVarAdjust((m) => ({ ...m, [vid]: { newQty: current, saving: false } }));

  const closeVariantAdjust = (vid: string) =>
    setVarAdjust((m) => { const n = { ...m }; delete n[vid]; return n; });

  const saveVariantAdjust = async (vid: string, productId: string) => {
    const adj = varAdjust[vid];
    if (!adj) return;
    setVarAdjust((m) => ({ ...m, [vid]: { ...m[vid], saving: true } }));
    try {
      const r = await api.adjustVariantStock(productId, vid, adj.newQty);
      setForm((f) => ({
        ...f,
        stockOnHand: f.stockOnHand + r.delta,
        variants: (f.variants ?? []).map((v) =>
          v.id === vid ? { ...v, stockOnHand: r.after } : v
        ),
      }));
      closeVariantAdjust(vid);
    } catch {
      setVarAdjust((m) => ({ ...m, [vid]: { ...m[vid], saving: false } }));
    }
  };

  const update = <K extends keyof Product>(k: K, v: Product[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const addVariant = () =>
    setForm((f) => ({
      ...f,
      variants: [...(f.variants ?? []), emptyVariant({ sku: f.sku, barcode: f.barcode })],
    }));

  const updateVariant = (idx: number, patch: Partial<ProductVariant>) =>
    setForm((f) => ({
      ...f,
      variants: (f.variants ?? []).map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));

  const removeVariant = (idx: number) =>
    setForm((f) => ({
      ...f,
      variants: (f.variants ?? []).filter((_, i) => i !== idx),
    }));

  const handleProductImageUpload = async (file: File) => {
    if (!form.id) return; // can only upload after product is saved
    setImgUploading(true);
    setError(null);
    try {
      const r = await api.uploadProductImage(form.id, file);
      setForm((f) => ({ ...f, imageUrl: r.imageUrl }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImgUploading(false);
    }
  };

  const handleVariantImageUpload = async (variantId: string, file: File) => {
    if (!form.id || !variantId) return;
    setVarImgUploading(variantId);
    setError(null);
    try {
      const r = await api.uploadVariantImage(form.id, variantId, file);
      setForm((f) => ({
        ...f,
        variants: (f.variants ?? []).map((v) =>
          v.id === variantId ? { ...v, imageUrl: r.imageUrl } : v
        ),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVarImgUploading(null);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        type: form.type,
        uom: form.uom.trim(),
        barcode: form.barcode.trim(),
        state: form.state,
        categoryId: form.categoryId?.trim() || undefined,
        hsn: form.hsn.trim(),
        gstRate: Number(form.gstRate) || 18,
        costPrice: Number(form.costPrice) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        stockOnHand: Number(form.stockOnHand) || 0,
        batchTracked: !!form.batchTracked,
        // Send null when the user cleared the field so the backend
        // explicitly drops the previous value.
        description: form.description?.trim() ? form.description.trim() : null,
        variants: (form.variants ?? []).map((v) => ({
          id: v.id,
          // Empty string = let backend auto-generate
          sku: v.sku?.trim() || undefined,
          barcode: v.barcode?.trim() || undefined,
          hsn: v.hsn?.trim() || null,
          gstRate:
            v.gstRate === null || v.gstRate === undefined ? null : Number(v.gstRate),
          size: v.size?.trim() || null,
          color: v.color?.trim() || null,
          grade: v.grade?.trim() || null,
          uom: v.uom?.trim() ? v.uom.trim() : null,
          packSize:
            v.packSize === null || v.packSize === undefined || Number(v.packSize) <= 0
              ? 1
              : Number(v.packSize),
          costPriceOverride:
            v.costPriceOverride === null || v.costPriceOverride === undefined
              ? null
              : Number(v.costPriceOverride),
          sellingPriceOverride:
            v.sellingPriceOverride === null || v.sellingPriceOverride === undefined
              ? null
              : Number(v.sellingPriceOverride),
          stockOnHand: Number(v.stockOnHand) || 0,
          active: v.active !== false,
        })),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saved =
        mode === "create"
          ? await api.createProduct(payload as any)
          : await api.updateProduct(form.id, payload as any);
      onSaved(saved);
      onClose();
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const canSave = useMemo(() => {
    return (
      form.sku.trim().length > 0 &&
      form.name.trim().length > 0 &&
      form.barcode.trim().length > 0 &&
      form.uom.trim().length > 0 &&
      !!(form.categoryId?.trim()) &&
      !submitting
    );
  }, [form, submitting]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-end" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-3xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              {mode === "create" ? "New Product" : "Edit Product"}
            </div>
            <div className="text-h3 font-bold">{form.name || "Unnamed"}</div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
              {error}
            </div>
          )}

          {/* Product image */}
          <section className="flex gap-4 items-start">
            <div
              className="relative w-32 h-32 rounded-lg border-2 border-dashed border-border bg-canvas overflow-hidden flex items-center justify-center cursor-pointer hover:border-primary transition-colors group flex-shrink-0"
              onClick={() => {
                if (mode === "edit" && form.id) productImgRef.current?.click();
              }}
              title={mode === "create" ? "Save product first, then upload image" : "Click to upload product image"}
            >
              {form.imageUrl ? (
                <img
                  src={resolveUploadUrl(form.imageUrl)}
                  alt={form.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-ink-muted group-hover:text-primary">
                  <ImagePlus size={24} />
                  <span className="text-caption text-center px-1">
                    {mode === "create" ? "Save first" : "Add photo"}
                  </span>
                </div>
              )}
              {imgUploading && (
                <div className="absolute inset-0 bg-ink/40 flex items-center justify-center">
                  <span className="text-white text-caption">Uploading…</span>
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
            <div className="flex-1 text-body-sm text-ink-muted space-y-1 pt-1">
              <div className="font-semibold text-ink">Product image</div>
              <div>Upload a photo for this product. Accepted: JPG, PNG, WebP (max 50 MB).</div>
              {mode === "create" && <div className="text-warning">Create the product first, then come back to edit and upload the image.</div>}
              {form.imageUrl && <div className="font-mono text-caption truncate">{form.imageUrl}</div>}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <Field label="SKU *">              <Input value={form.sku} onChange={(e) => update("sku", e.target.value)} />
            </Field>
            <Field label="Barcode *">
              <Input value={form.barcode} onChange={(e) => update("barcode", e.target.value)} />
            </Field>
            <Field label="Name *" full>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
            </Field>
            <Field label="Type">
              <select
                className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                value={form.type}
                onChange={(e) => update("type", e.target.value as ProductType)}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="State">
              <select
                className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                value={form.state}
                onChange={(e) => update("state", e.target.value as ProductState)}
              >
                {PRODUCT_STATES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="UoM">
              <UomPicker
                value={form.uom}
                onChange={(uom) => update("uom", uom)}
                showName
                className="w-full"
              />
            </Field>
            <Field label="Category *">
              <select
                className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                value={form.categoryId ?? ""}
                onChange={(e) => update("categoryId", e.target.value)}
                disabled={categoriesQuery.loading}
              >
                <option value="">Select category…</option>
                {categories.map((c: ProductCategory) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="HSN">
              <Input value={form.hsn} onChange={(e) => update("hsn", e.target.value)} />
            </Field>
            <Field label="GST Rate (%)">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={String(form.gstRate ?? 18)}
                onChange={(e) => update("gstRate", Number(e.target.value))}
                placeholder="18"
              />
            </Field>
            <Field label="Reorder Level">
              <Input
                type="number"
                value={String(form.reorderLevel)}
                onChange={(e) => update("reorderLevel", Number(e.target.value))}
              />
            </Field>
            <Field label="On-hand">
              {mode === "edit" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 h-9 px-3 bg-canvas border border-border rounded-md text-body-sm">
                    <Lock size={12} className="text-ink-muted shrink-0" />
                    <span className="flex-1 tnum font-semibold">{num(form.stockOnHand)}</span>
                    <span className="text-caption text-ink-muted">{form.uom}</span>
                    {form.id && (
                      <button
                        type="button"
                        className="flex items-center gap-1 text-caption text-primary hover:underline ml-1"
                        onClick={() => setLedgerProductId(form.id)}
                      >
                        <History size={12} />
                        History
                      </button>
                    )}
                  </div>
                  {/* Bin stock reconciliation row */}
                  {form.id && (
                    <div className={cn(
                      "flex items-center gap-2 text-caption rounded px-2 py-1",
                      binStockLoading ? "text-ink-muted" :
                      binStock && binStock.total !== form.stockOnHand
                        ? "bg-warning-soft text-[#8a6300] border border-warning/30"
                        : "bg-canvas text-ink-muted border border-border/60"
                    )}>
                      {binStockLoading ? (
                        <span>Loading bin total…</span>
                      ) : binStock ? (
                        <>
                          <span>Bins: <strong className="tnum">{num(binStock.total)}</strong> ({num(binStock.free)} free)</span>
                          {binStock.total !== form.stockOnHand && (
                            <>
                              <AlertTriangle size={11} />
                              <span>Counter mismatch ({form.stockOnHand > binStock.total ? "+" : ""}{num(form.stockOnHand - binStock.total)})</span>
                              <button
                                type="button"
                                disabled={syncingStock}
                                onClick={handleSyncStock}
                                className="ml-auto flex items-center gap-1 text-[#8a6300] hover:underline disabled:opacity-50"
                              >
                                <RefreshCw size={10} className={syncingStock ? "animate-spin" : ""} />
                                Sync from bins
                              </button>
                            </>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : (
                <Input
                  type="number"
                  value={String(form.stockOnHand)}
                  onChange={(e) => update("stockOnHand", Number(e.target.value))}
                />
              )}
            </Field>
            <Field label="Cost Price">
              <Input
                type="number"
                value={String(form.costPrice)}
                onChange={(e) => update("costPrice", Number(e.target.value))}
              />
            </Field>
            <Field label="Selling Price">
              <Input
                type="number"
                value={String(form.sellingPrice)}
                onChange={(e) => update("sellingPrice", Number(e.target.value))}
              />
            </Field>
            <Field label="Batch tracked">
              <label className="flex items-center gap-2 h-9">
                <input
                  type="checkbox"
                  checked={!!form.batchTracked}
                  onChange={(e) => update("batchTracked", e.target.checked)}
                />
                <span className="text-body-sm text-ink-muted">
                  Track manufacturing batch / expiry
                </span>
              </label>
            </Field>
            <Field label="Description" full>
              <textarea
                className="w-full bg-surface border border-border rounded-md px-3 py-2 text-body-sm text-ink placeholder:text-ink-muted/70 min-h-[88px] resize-y outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                value={form.description ?? ""}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Short catalogue / storefront description shown to customers (optional)…"
                maxLength={5000}
              />
            </Field>
          </section>

          <section className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-h3 font-bold">Variants</div>
                <div className="text-caption text-ink-muted">
                  Size / colour / grade — each variant has its own SKU, barcode, and stock.
                </div>
              </div>
              <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={addVariant}>
                Add variant
              </Button>
            </div>
            {(form.variants ?? []).length === 0 ? (
              <div className="text-caption text-ink-muted bg-canvas border border-border rounded-md p-3">
                No variants. Click <strong>Add variant</strong> to create size, colour, or grade
                options. Parent <strong>{form.uom || "uom"}</strong> tracks bulk stock; each
                variant defines its own selling unit (e.g. "pc") and pack size.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-caption text-ink-muted bg-info-soft border border-info rounded-md px-3 py-1.5">
                  Parent UoM <strong className="font-mono">{form.uom || "—"}</strong> is the
                  bulk unit (used for stock monitoring). Each variant below has its own
                  selling unit and a <em>pack size</em> = how many <strong className="font-mono">{form.uom || "?"}</strong> one variant unit equals (e.g.
                  100g pouch on a kg-tracked parent &rarr; pack size 0.1).
                </div>
                {(form.variants ?? []).map((v, i) => {
                  const packSize = v.packSize ?? 1;
                  const variantUom = (v.uom ?? "").trim() || form.uom || "";
                  return (
                    <div
                      key={i}
                      className="border border-border rounded-md p-3 grid grid-cols-12 gap-2 items-end"
                    >
                      <div className="col-span-3">
                        <Label>Variant SKU</Label>
                        <Input
                          value={v.sku ?? ""}
                          onChange={(e) => updateVariant(i, { sku: e.target.value })}
                          placeholder="auto-generate if blank"
                        />
                      </div>
                      <div className="col-span-3">
                        <Label>Barcode</Label>
                        <Input
                          value={v.barcode ?? ""}
                          onChange={(e) => updateVariant(i, { barcode: e.target.value })}
                          placeholder="auto-generate if blank"
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>GST % (override)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={v.gstRate ?? ""}
                          onChange={(e) =>
                            updateVariant(i, {
                              gstRate: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          placeholder={`inherit (${form.gstRate ?? 18}%)`}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>HSN (override)</Label>
                        <Input
                          value={v.hsn ?? ""}
                          onChange={(e) => updateVariant(i, { hsn: e.target.value || null })}
                          placeholder={`inherit (${form.hsn || "—"})`}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>Size</Label>
                        <Input
                          value={v.size ?? ""}
                          onChange={(e) => updateVariant(i, { size: e.target.value })}
                          placeholder="e.g. 1 L"
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>Color</Label>
                        <Input
                          value={v.color ?? ""}
                          onChange={(e) => updateVariant(i, { color: e.target.value })}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>Grade</Label>
                        <Input
                          value={v.grade ?? ""}
                          onChange={(e) => updateVariant(i, { grade: e.target.value })}
                        />
                      </div>

                      <div className="col-span-2">
                        <Label>Selling UoM</Label>
                        <UomPicker
                          value={v.uom ?? ""}
                          onChange={(uom) =>
                            updateVariant(i, { uom: uom.trim() ? uom : null })
                          }
                          placeholder={`inherit (${form.uom || "—"})`}
                        />
                      </div>
                      <div className="col-span-2">
                        <Label>Pack size</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={String(v.packSize ?? 1)}
                          onChange={(e) =>
                            updateVariant(i, {
                              packSize:
                                e.target.value === "" ? 1 : Number(e.target.value),
                            })
                          }
                          title={`How many "${form.uom || "parent units"}" one variant unit represents.`}
                        />
                      </div>
                      <div className="col-span-3 pb-1.5">
                        <Label>Conversion</Label>
                        <div className="text-caption text-ink-muted h-9 flex items-center px-2 bg-canvas border border-border rounded-md tnum">
                          1 <strong className="font-mono mx-1">{variantUom || "?"}</strong>
                          ={" "}
                          <strong className="font-mono mx-1 tnum">{packSize}</strong>
                          <span className="font-mono">{form.uom || "?"}</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Label>Stock</Label>
                        {mode === "edit" ? (
                          <div className="space-y-1">
                            {varAdjust[v.id ?? ""] ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  className="flex-1 h-8 px-2 text-body-sm border border-primary rounded-md bg-surface tnum"
                                  value={varAdjust[v.id ?? ""].newQty}
                                  onChange={(e) =>
                                    setVarAdjust((m) => ({ ...m, [v.id ?? ""]: { ...m[v.id ?? ""], newQty: Number(e.target.value) } }))
                                  }
                                />
                                <button
                                  type="button"
                                  disabled={varAdjust[v.id ?? ""].saving}
                                  onClick={() => v.id && form.id && saveVariantAdjust(v.id, form.id)}
                                  className="h-8 px-2 text-caption bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50"
                                >
                                  {varAdjust[v.id ?? ""].saving ? "…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => v.id && closeVariantAdjust(v.id)}
                                  className="h-8 w-8 grid place-items-center text-ink-muted hover:bg-canvas rounded-md"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 h-9 px-2 bg-canvas border border-border rounded-md text-body-sm">
                                <Lock size={11} className="text-ink-muted shrink-0" />
                                <span className="flex-1 tnum font-semibold">{num(v.stockOnHand)}</span>
                                {form.id && v.id && (
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 text-caption text-primary hover:underline"
                                    onClick={() => openVariantAdjust(v.id!, v.stockOnHand)}
                                  >
                                    Adjust
                                  </button>
                                )}
                                {form.id && (
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 text-caption text-ink-muted hover:underline"
                                    onClick={() => setLedgerProductId(form.id)}
                                  >
                                    <History size={11} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Input
                            type="number"
                            value={String(v.stockOnHand)}
                            onChange={(e) =>
                              updateVariant(i, { stockOnHand: Number(e.target.value) })
                            }
                          />
                        )}
                      </div>

                      <div className="col-span-3">
                        <Label>Cost override</Label>
                        <Input
                          type="number"
                          value={v.costPriceOverride ?? ""}
                          onChange={(e) =>
                            updateVariant(i, {
                              costPriceOverride:
                                e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="col-span-3">
                        <Label>Sell override</Label>
                        <Input
                          type="number"
                          value={v.sellingPriceOverride ?? ""}
                          onChange={(e) =>
                            updateVariant(i, {
                              sellingPriceOverride:
                                e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="col-span-5 flex items-center gap-2 pb-1.5">
                        <label className="flex items-center gap-1 text-caption text-ink-muted">
                          <input
                            type="checkbox"
                            checked={v.active !== false}
                            onChange={(e) => updateVariant(i, { active: e.target.checked })}
                          />
                          active
                        </label>
                      </div>
                      {/* Variant image — only available when editing a saved variant */}
                      <div className="col-span-5 flex items-center gap-3 pb-1.5">
                        <VariantImagePicker
                          imageUrl={v.imageUrl ?? null}
                          variantId={v.id ?? null}
                          productId={form.id}
                          mode={mode}
                          busy={varImgUploading === v.id}
                          onUpload={(file) => {
                            if (v.id) handleVariantImageUpload(v.id, file);
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          className="h-8 w-8 grid place-items-center rounded text-danger hover:bg-danger-soft"
                          onClick={() => removeVariant(i)}
                          title="Remove variant"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-border p-3 flex items-center gap-2 justify-end">
          <Chip tone="info" size="sm">
            {(form.variants ?? []).length} variant{(form.variants ?? []).length === 1 ? "" : "s"}
          </Chip>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSave}>
            {submitting ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Stock ledger drawer */}
      {ledgerProductId && (
        <StockLedgerDrawer
          productId={ledgerProductId}
          productName={form.name}
          onClose={() => setLedgerProductId(null)}
        />
      )}
    </div>
  );
};

// ─── Stock Ledger Drawer ─────────────────────────────────────────────────────
const TXN_META: Record<string, { tone: string; label: string }> = {
  GRN:        { tone: "bg-success-soft text-success border-success/30",     label: "GRN" },
  Sale:       { tone: "bg-primary-50 text-primary border-primary/30",       label: "Sale" },
  Issue:      { tone: "bg-warning-soft text-[#8a6300] border-warning/30",   label: "Issue" },
  Transfer:   { tone: "bg-purple-50 text-purple-700 border-purple-200",     label: "Transfer" },
  Production: { tone: "bg-info-soft text-info border-info/30",              label: "Production" },
  Adjust:     { tone: "bg-canvas text-ink-muted border-border",             label: "Adjust" },
};

const StockLedgerDrawer = ({
  productId,
  productName,
  onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) => {
  const { data, loading, error } = useApi(
    () => api.ledger({ productId, limit: 500 }),
    [productId]
  );
  const entries: StockLedgerEntry[] = data ?? [];

  const rows = useMemo(() => [...entries].reverse(), [entries]);

  const totalIn  = entries.filter((e) => e.qty > 0).reduce((s, e) => s + e.qty, 0);
  const totalOut = entries.filter((e) => e.qty < 0).reduce((s, e) => s + Math.abs(e.qty), 0);
  const closing  = entries.length > 0 ? entries[0].balance : 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="bg-surface w-full max-w-2xl flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold tracking-wide flex items-center gap-1.5">
              <History size={12} /> Stock ledger
            </div>
            <div className="text-h3 font-bold">{productName}</div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        {entries.length > 0 && (
          <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-canvas">
            <div className="px-4 py-2.5 text-center">
              <div className="text-caption text-ink-muted uppercase tracking-wide">Total In</div>
              <div className="text-h3 font-bold text-success tnum">+{num(totalIn, 2)}</div>
            </div>
            <div className="px-4 py-2.5 text-center">
              <div className="text-caption text-ink-muted uppercase tracking-wide">Total Out</div>
              <div className="text-h3 font-bold text-danger tnum">−{num(totalOut, 2)}</div>
            </div>
            <div className="px-4 py-2.5 text-center">
              <div className="text-caption text-ink-muted uppercase tracking-wide">Closing Balance</div>
              <div className={cn("text-h3 font-bold tnum", closing < 0 ? "text-danger" : "text-ink")}>
                {num(closing, 2)}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 px-4 py-1.5 bg-canvas border-b border-border text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
          <div className="col-span-2">Date</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-3">Reference</div>
          <div className="col-span-2">Warehouse · Bin</div>
          <div className="col-span-1 text-right">Change</div>
          <div className="col-span-2 text-right">Balance</div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border/60">
          {loading && (
            <div className="py-10 text-center text-body-sm text-ink-muted">Loading ledger…</div>
          )}
          {error && (
            <div className="py-10 text-center text-body-sm text-danger">{error.message}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="py-10 text-center text-body-sm text-ink-muted">
              No transactions recorded yet. Stock movements via GRN, Inventory Adjust,
              Sales, Issues, and Transfers will appear here.
            </div>
          )}
          {rows.map((e) => {
            const meta = TXN_META[e.txnType] ?? TXN_META.Adjust;
            const isIn = e.qty > 0;
            return (
              <div
                key={e.id}
                className="grid grid-cols-12 px-4 py-2.5 items-center hover:bg-canvas/60 text-body-sm"
              >
                <div className="col-span-2 text-caption text-ink-muted tnum">{dd(e.date)}</div>
                <div className="col-span-2">
                  <span className={cn("text-[10px] rounded-full px-2 py-0.5 border font-semibold uppercase tracking-wide", meta.tone)}>
                    {meta.label}
                  </span>
                </div>
                <div className="col-span-3 font-mono text-caption truncate">
                  {e.ref}
                  {/* When the row applies to a variant (e.g. an MO output
                      for the 250ml CAOL variant) show the variant SKU
                      and size so the user can distinguish it from rows
                      on the bulk parent. */}
                  {e.variantSku || e.variantSize ? (
                    <div className="font-sans normal-case text-[10px] text-ink-muted truncate">
                      {e.variantSize ?? e.variantSku}
                      {e.variantSku && e.variantSize ? ` · ${e.variantSku}` : null}
                    </div>
                  ) : null}
                </div>
                <div className="col-span-2 text-caption text-ink-muted truncate">
                  {e.warehouse}{e.bin ? ` · ${e.bin}` : ""}
                </div>
                <div className={cn("col-span-1 text-right tnum font-semibold", isIn ? "text-success" : "text-danger")}>
                  {isIn ? "+" : ""}{num(e.qty, 2)}
                </div>
                <div className={cn("col-span-2 text-right tnum font-semibold", e.balance < 0 ? "text-danger" : "text-ink")}>
                  {num(e.balance, 2)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};

// ─── Field / Label helpers ────────────────────────────────────────────────────
const Field = ({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) => (
  <div className={full ? "col-span-2" : ""}>
    <Label>{label}</Label>
    {children}
  </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold mb-1">
    {children}
  </div>
);

const VariantImagePicker = ({
  imageUrl,
  variantId,
  productId,
  mode,
  busy,
  onUpload,
}: {
  imageUrl: string | null;
  variantId: string | null;
  productId: string;
  mode: "create" | "edit";
  busy: boolean;
  onUpload: (file: File) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const canUpload = mode === "edit" && !!productId && !!variantId;
  const resolvedSrc = resolveUploadUrl(imageUrl);

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative w-12 h-12 rounded border-2 border-dashed border-border bg-canvas overflow-hidden flex items-center justify-center ${canUpload ? "cursor-pointer hover:border-primary group" : "opacity-50"}`}
        onClick={() => { if (canUpload) inputRef.current?.click(); }}
        title={canUpload ? "Click to upload variant image" : "Save product first"}
      >
        {resolvedSrc ? (
          <img src={resolvedSrc} alt="variant" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus size={14} className="text-ink-muted group-hover:text-primary" />
        )}
        {busy && (
          <div className="absolute inset-0 bg-ink/40 flex items-center justify-center">
            <span className="text-white text-[10px]">…</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
      <span className="text-caption text-ink-muted">
        {imageUrl ? "variant image" : "no image"}
      </span>
    </div>
  );
};
