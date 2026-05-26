// Purchase order editor.
//
// Two modes:
//   * Create  - pick a vendor, expected date, and add line items by
//               searching the product catalog. Submit creates a draft.
//   * Edit    - update notes / expected date / lines (lines only while
//               the PO is still 'draft'; backend rejects later edits).
//
// The flow is intentionally minimal in this first cut: no GST split,
// no MRP/dealer rate auto-fill - the operator types the rate that
// the supplier quoted. The backend computes line and PO totals.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Product, Vendor } from "@/data/types";
import { inr, num } from "@/lib/format";
import { cn } from "@/lib/cn";

interface PoLineDraft {
  // tempKey is local-only - we rebuild it on every render so adding
  // and removing rows mid-edit doesn't lose focus or scroll position.
  tempKey: string;
  productId: string;
  sku: string;
  name: string;
  uom: string;
  qty: number;
  rate: number;
}

interface ExistingPoSnapshot {
  id: string;
  poNo: string;
  status: string;
  vendorId: string;
  expectedDate: string;
  notes: string | null;
  items: Array<{
    productId: string;
    qty: number;
    rate: number;
    product: { sku: string; name: string; uom: string };
  }>;
}

interface Props {
  // Existing PO snapshot (in edit mode). Pass null to create a new one.
  po: ExistingPoSnapshot | null;
  onClose: () => void;
  onSaved: (poId: string, message: string) => void;
}

const isoDate = (offsetDays: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export const PoEditor = ({ po, onClose, onSaved }: Props) => {
  const isNew = po === null;
  const editable = isNew || po?.status === "draft";

  const liveVendors = useApi(() => api.vendors({ includeInactive: false }), []);
  const liveProducts = useApi(() => api.products(), []);
  const vendors: Vendor[] = liveVendors.data ?? [];
  const products: Product[] = liveProducts.data ?? [];

  const [vendorId, setVendorId] = useState<string>(po?.vendorId ?? "");
  const [expectedDate, setExpectedDate] = useState<string>(
    po?.expectedDate ? po.expectedDate.slice(0, 10) : isoDate(7)
  );
  const [notes, setNotes] = useState<string>(po?.notes ?? "");
  const [items, setItems] = useState<PoLineDraft[]>(
    (po?.items ?? []).map((i) => ({
      tempKey: Math.random().toString(36).slice(2),
      productId: i.productId,
      sku: i.product.sku,
      name: i.product.name,
      uom: i.product.uom,
      qty: i.qty,
      rate: i.rate,
    }))
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default vendor to the first one when creating and no vendor was
  // pre-set.
  useEffect(() => {
    if (isNew && !vendorId && vendors.length > 0) {
      setVendorId(vendors[0].id);
    }
  }, [isNew, vendorId, vendors]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addLine = (p: Product) => {
    if (items.some((i) => i.productId === p.id)) {
      setError(`${p.sku} is already on this PO. Update its qty instead.`);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        tempKey: Math.random().toString(36).slice(2),
        productId: p.id,
        sku: p.sku,
        name: p.name,
        uom: p.uom,
        qty: 1,
        rate: 0,
      },
    ]);
    setPickerOpen(false);
    setSearch("");
    setError(null);
  };

  const removeLine = (tempKey: string) =>
    setItems((prev) => prev.filter((i) => i.tempKey !== tempKey));

  const setQty = (tempKey: string, qty: number) =>
    setItems((prev) =>
      prev.map((i) => (i.tempKey === tempKey ? { ...i, qty } : i))
    );
  const setRate = (tempKey: string, rate: number) =>
    setItems((prev) =>
      prev.map((i) => (i.tempKey === tempKey ? { ...i, rate } : i))
    );

  const total = items.reduce((s, i) => s + i.qty * i.rate, 0);

  const validate = (): string | null => {
    if (!vendorId) return "Pick a vendor.";
    if (items.length === 0) return "Add at least one line item.";
    for (const i of items) {
      if (i.qty <= 0) return `Qty must be > 0 for ${i.sku}.`;
      if (i.rate < 0) return `Rate cannot be negative for ${i.sku}.`;
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const payload = {
        vendorId,
        expectedDate: new Date(expectedDate).toISOString(),
        notes: notes.trim() || null,
        items: items.map((i) => ({
          productId: i.productId,
          qty: i.qty,
          rate: i.rate,
        })),
      };
      if (isNew) {
        const created = (await api.createPurchaseOrder(payload)) as {
          id: string;
          poNo: string;
        };
        onSaved(created.id, `Draft ${created.poNo} created.`);
      } else {
        const updated = (await api.updatePurchaseOrder(po!.id, {
          expectedDate: payload.expectedDate,
          notes: payload.notes,
          // Only send items when editable to avoid backend 409.
          ...(editable ? { items: payload.items } : {}),
        })) as { id: string; poNo: string };
        onSaved(updated.id, `${updated.poNo} updated.`);
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!search) return products.slice(0, 30);
    const t = search.toLowerCase();
    return products
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)
      )
      .slice(0, 30);
  }, [products, search]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[920px] max-w-[95vw] max-h-[92vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              {isNew ? "New purchase order" : `Edit ${po!.poNo}`}
            </div>
            <div className="text-body-sm">
              {isNew
                ? "Pick a vendor, add line items, set expected date. Saved as a draft."
                : editable
                  ? "Drafts are fully editable; once approved, only notes and expected date can change."
                  : "Read-only - this PO is past the draft stage."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <Chip size="sm" tone={po!.status === "draft" ? "neutral" : "primary"}>
                {po!.status}
              </Chip>
            )}
            <button
              onClick={onClose}
              className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="underline text-caption"
            >
              dismiss
            </button>
          </div>
        )}

        <div className="px-5 py-3 grid grid-cols-12 gap-3 border-b border-border bg-canvas shrink-0">
          <div className="col-span-6">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Vendor *
            </div>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              disabled={!isNew}
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary disabled:bg-canvas disabled:text-ink-muted"
            >
              <option value="">— Select —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} · {v.name} {v.city ? `(${v.city})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Expected by *
            </div>
            <Input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Total
            </div>
            <div className="h-10 flex items-center text-h3 font-bold tnum text-primary">
              {inr(total)}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-2 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Line items ({items.length})
              </div>
            </div>
            {editable && (
              <Button
                size="sm"
                variant="outline"
                icon={<Plus size={14} />}
                onClick={() => setPickerOpen(true)}
              >
                Add product
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center text-body-sm text-ink-muted">
                No items yet. Click <strong>Add product</strong>.
              </div>
            ) : (
              <div className="grid grid-cols-12 grid-header-cell text-caption sticky top-0 bg-surface z-10 border-b border-border">
                <div className="col-span-2 px-3 py-2">SKU</div>
                <div className="col-span-4 px-3 py-2">Product</div>
                <div className="col-span-2 px-3 py-2 text-right">Qty</div>
                <div className="col-span-2 px-3 py-2 text-right">Rate</div>
                <div className="col-span-1 px-3 py-2 text-right">Amount</div>
                <div className="col-span-1 px-3 py-2"></div>
              </div>
            )}
            {items.map((it) => (
              <div
                key={it.tempKey}
                className="grid grid-cols-12 items-center border-b border-border hover:bg-canvas/50"
              >
                <div className="col-span-2 px-3 py-2 font-mono text-caption font-semibold">
                  {it.sku}
                </div>
                <div className="col-span-4 px-3 py-2 truncate">{it.name}</div>
                <div className="col-span-2 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0.001}
                      step={0.001}
                      value={it.qty}
                      onChange={(e) => setQty(it.tempKey, Number(e.target.value) || 0)}
                      disabled={!editable}
                      className="text-right"
                    />
                    <span className="text-caption text-ink-muted">{it.uom}</span>
                  </div>
                </div>
                <div className="col-span-2 px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={it.rate}
                    onChange={(e) => setRate(it.tempKey, Number(e.target.value) || 0)}
                    disabled={!editable}
                    className="text-right"
                  />
                </div>
                <div className="col-span-1 px-3 py-2 text-right tnum font-semibold">
                  {num(it.qty * it.rate, 2)}
                </div>
                <div className="col-span-1 px-3 py-2 text-right">
                  {editable && (
                    <button
                      onClick={() => removeLine(it.tempKey)}
                      className="text-danger hover:bg-danger-soft rounded p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border bg-canvas shrink-0">
          <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
            Notes (optional)
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Special instructions to vendor, payment notes, etc."
            className="w-full bg-white border border-border rounded-md px-3 py-2 text-body outline-none focus:border-primary"
          />
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={isNew ? <CheckCircle2 size={14} /> : <Save size={14} />}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Saving…" : isNew ? "Create draft" : "Save changes"}
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-[70] bg-ink/30 grid place-items-center"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className={cn(
              "bg-surface w-[640px] max-w-[95vw] max-h-[80vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-body-sm font-bold">Pick a product</div>
              <button
                onClick={() => setPickerOpen(false)}
                className="h-8 w-8 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <Input
                iconLeft={<Search size={14} />}
                placeholder="Search SKU or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {filteredProducts.length === 0 ? (
                <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
                  No matching products.
                </div>
              ) : (
                filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addLine(p)}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-canvas/60"
                  >
                    <div className="font-mono text-caption font-semibold">
                      {p.sku}
                    </div>
                    <div className="flex-1 min-w-0 truncate">{p.name}</div>
                    <Chip size="sm" tone="neutral">{p.uom}</Chip>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
