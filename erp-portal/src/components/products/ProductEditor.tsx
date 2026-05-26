import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { UomPicker } from "@/components/common/UomPicker";
import type { Product, ProductState, ProductType, ProductVariant } from "@/data/types";
import { api } from "@/lib/api";

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
  category: "",
  hsn: "",
  batchTracked: false,
  variants: [],
});

const emptyVariant = (parent: { sku: string; barcode: string }): ProductVariant => ({
  sku: parent.sku ? `${parent.sku}-V${Date.now().toString().slice(-3)}` : "",
  barcode: null,
  size: null,
  color: null,
  grade: null,
  uom: null,
  packSize: 1,
  costPriceOverride: null,
  sellingPriceOverride: null,
  stockOnHand: 0,
  active: true,
});

export const ProductEditor = ({ open, mode, product, onClose, onSaved }: Props) => {
  const [form, setForm] = useState<Product>(() => emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && product) {
      setForm({ ...product, variants: product.variants ?? [] });
    } else {
      setForm(emptyForm());
    }
    setError(null);
  }, [open, mode, product]);

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
        category: form.category.trim(),
        hsn: form.hsn.trim(),
        costPrice: Number(form.costPrice) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        stockOnHand: Number(form.stockOnHand) || 0,
        batchTracked: !!form.batchTracked,
        variants: (form.variants ?? []).map((v) => ({
          id: v.id,
          sku: v.sku.trim(),
          barcode: v.barcode?.trim() || null,
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
      const saved =
        mode === "create"
          ? await api.createProduct(payload)
          : await api.updateProduct(form.id, payload);
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

          <section className="grid grid-cols-2 gap-3">
            <Field label="SKU *">
              <Input value={form.sku} onChange={(e) => update("sku", e.target.value)} />
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
            <Field label="Category">
              <Input value={form.category} onChange={(e) => update("category", e.target.value)} />
            </Field>
            <Field label="HSN">
              <Input value={form.hsn} onChange={(e) => update("hsn", e.target.value)} />
            </Field>
            <Field label="Reorder Level">
              <Input
                type="number"
                value={String(form.reorderLevel)}
                onChange={(e) => update("reorderLevel", Number(e.target.value))}
              />
            </Field>
            <Field label="On-hand">
              <Input
                type="number"
                value={String(form.stockOnHand)}
                onChange={(e) => update("stockOnHand", Number(e.target.value))}
              />
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
                        <Label>Variant SKU *</Label>
                        <Input
                          value={v.sku}
                          onChange={(e) => updateVariant(i, { sku: e.target.value })}
                        />
                      </div>
                      <div className="col-span-3">
                        <Label>Barcode</Label>
                        <Input
                          value={v.barcode ?? ""}
                          onChange={(e) => updateVariant(i, { barcode: e.target.value })}
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
                        <Input
                          type="number"
                          value={String(v.stockOnHand)}
                          onChange={(e) =>
                            updateVariant(i, { stockOnHand: Number(e.target.value) })
                          }
                        />
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
    </div>
  );
};

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
