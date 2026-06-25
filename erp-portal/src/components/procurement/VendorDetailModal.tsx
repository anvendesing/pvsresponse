// Vendor detail: supplier catalog + performance scorecard.
//
// Opened from the vendors tab when the operator clicks a vendor name.
// Profile edits still go through VendorEditor (onEditProfile callback).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Product, Vendor, VendorPerformance, VendorProduct } from "@/data/types";
import { inr, num } from "@/lib/format";
import { cn } from "@/lib/cn";

type Tab = "catalog" | "performance";

interface Props {
  vendor: Vendor;
  onClose: () => void;
  onEditProfile: () => void;
  onSaved: (message: string) => void;
}

const pctLabel = (v: number | null) => (v == null ? "—" : `${num(v, 1)}%`);

export const VendorDetailModal = ({
  vendor,
  onClose,
  onEditProfile,
  onSaved,
}: Props) => {
  const [tab, setTab] = useState<Tab>("catalog");
  const [catalog, setCatalog] = useState<VendorProduct[]>([]);
  const [perf, setPerf] = useState<VendorPerformance | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const liveProducts = useApi(() => api.products({ limit: 2000 }), []);
  const products: Product[] = liveProducts.data ?? [];

  const [form, setForm] = useState({
    productId: "",
    vendorProductCode: "",
    vendorProductName: "",
    vendorUom: "",
    packSize: 1,
    price: 0,
    minOrderQty: 1,
    leadTimeDays: "" as string | number,
    priority: 100,
    notes: "",
  });

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const rows = await api.vendorProducts(vendor.id);
      setCatalog(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingCatalog(false);
    }
  }, [vendor.id]);

  const loadPerf = useCallback(async () => {
    setLoadingPerf(true);
    try {
      const p = await api.vendorPerformance(vendor.id);
      setPerf(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingPerf(false);
    }
  }, [vendor.id]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (tab === "performance" && !perf) void loadPerf();
  }, [tab, perf, loadPerf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 40);
    const t = productSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)
      )
      .slice(0, 40);
  }, [products, productSearch]);

  const pickProduct = (p: Product) => {
    setForm((f) => ({
      ...f,
      productId: p.id,
      vendorUom: f.vendorUom || p.uom,
      packSize: f.packSize || 1,
    }));
    setProductSearch("");
  };

  const resetForm = () => {
    setForm({
      productId: "",
      vendorProductCode: "",
      vendorProductName: "",
      vendorUom: "",
      packSize: 1,
      price: 0,
      minOrderQty: 1,
      leadTimeDays: "",
      priority: 100,
      notes: "",
    });
    setAddOpen(false);
    setProductSearch("");
  };

  const addCatalogLine = async () => {
    if (!form.productId) return setError("Pick an internal product.");
    if (!form.vendorUom.trim()) return setError("Vendor UOM is required.");
    setBusy(true);
    setError(null);
    try {
      await api.createVendorProduct(vendor.id, {
        productId: form.productId,
        vendorProductCode: form.vendorProductCode.trim() || null,
        vendorProductName: form.vendorProductName.trim() || null,
        vendorUom: form.vendorUom.trim(),
        packSize: Number(form.packSize) || 1,
        price: Number(form.price) || 0,
        minOrderQty: Number(form.minOrderQty) || 1,
        leadTimeDays:
          form.leadTimeDays === "" ? null : Number(form.leadTimeDays) || null,
        priority: Number(form.priority) || 100,
        notes: form.notes.trim() || null,
      });
      resetForm();
      await loadCatalog();
      onSaved("Catalog line added.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeLine = async (line: VendorProduct) => {
    if (
      !window.confirm(
        `Remove ${line.product.sku} from ${vendor.name}'s catalog? Lines used on POs are deactivated instead of deleted.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteVendorProduct(vendor.id, line.id);
      await loadCatalog();
      onSaved(
        r.softDeleted
          ? "Catalog line deactivated (used on POs)."
          : "Catalog line removed."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncRating = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.syncVendorRating(vendor.id);
      setPerf(p);
      onSaved(`Rating updated to ${p.computedRating.toFixed(1)} (from performance).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectedProduct = products.find((p) => p.id === form.productId);

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[960px] max-w-[95vw] max-h-[92vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Building2 size={18} />
            </div>
            <div>
              <div className="text-h3 font-bold">{vendor.name}</div>
              <div className="text-caption text-ink-muted font-mono flex items-center gap-2">
                {vendor.code}
                {vendor.city && ` · ${vendor.city}`}
                <span className="inline-flex items-center gap-0.5">
                  <Star size={11} className="fill-warning text-warning" />
                  {vendor.rating.toFixed(1)}
                </span>
                {!vendor.active && (
                  <Chip size="sm" tone="neutral">
                    inactive
                  </Chip>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<Pencil size={14} />}
              onClick={onEditProfile}
            >
              Edit profile
            </Button>
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
            <button onClick={() => setError(null)} className="underline text-caption">
              dismiss
            </button>
          </div>
        )}

        <div className="px-5 py-2 border-b border-border flex gap-1 bg-canvas shrink-0">
          {(
            [
              { id: "catalog" as const, label: "Supplier catalog", icon: Package },
              { id: "performance" as const, label: "Performance", icon: TrendingUp },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-8 px-3 rounded-md text-caption font-semibold inline-flex items-center gap-1.5 transition-colors",
                tab === t.id
                  ? "bg-primary text-white"
                  : "text-ink-muted hover:text-primary hover:bg-surface"
              )}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "catalog" && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-body-sm font-semibold">Products this vendor supplies</div>
                  <div className="text-caption text-ink-muted">
                    Map vendor codes, names, and UOM with conversion into your internal stock UOM.
                  </div>
                </div>
                <Button
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setAddOpen((o) => !o)}
                  disabled={busy}
                >
                  {addOpen ? "Cancel add" : "Add line"}
                </Button>
              </div>

              {addOpen && (
                <div className="border border-border rounded-lg p-4 bg-canvas space-y-3">
                  <div className="text-caption text-ink-muted uppercase font-semibold">
                    New catalog line
                  </div>
                  <div>
                    <div className="text-caption text-ink-muted mb-1">Internal product *</div>
                    {form.productId && selectedProduct ? (
                      <div className="flex items-center gap-2 mb-2">
                        <Chip size="sm" tone="primary">
                          {selectedProduct.sku}
                        </Chip>
                        <span className="text-body-sm">{selectedProduct.name}</span>
                        <span className="text-caption text-ink-muted">
                          ({selectedProduct.uom})
                        </span>
                        <button
                          type="button"
                          className="text-caption text-primary underline"
                          onClick={() => setForm((f) => ({ ...f, productId: "" }))}
                        >
                          change
                        </button>
                      </div>
                    ) : (
                      <>
                        <Input
                          iconLeft={<Search size={14} />}
                          placeholder="Search SKU or name…"
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                        />
                        {productSearch && (
                          <div className="mt-1 border border-border rounded-md max-h-40 overflow-y-auto divide-y divide-border bg-surface">
                            {filteredProducts.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => pickProduct(p)}
                                className="w-full px-3 py-2 text-left hover:bg-canvas flex gap-2 items-center"
                              >
                                <span className="font-mono text-caption font-semibold">
                                  {p.sku}
                                </span>
                                <span className="flex-1 truncate text-body-sm">{p.name}</span>
                                <Chip size="sm" tone="neutral">
                                  {p.uom}
                                </Chip>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4">
                      <div className="text-caption text-ink-muted mb-1">Vendor item code</div>
                      <Input
                        value={form.vendorProductCode}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, vendorProductCode: e.target.value }))
                        }
                        placeholder="Their SKU"
                      />
                    </div>
                    <div className="col-span-8">
                      <div className="text-caption text-ink-muted mb-1">Vendor product name</div>
                      <Input
                        value={form.vendorProductName}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, vendorProductName: e.target.value }))
                        }
                        placeholder="Name on their price list"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-3">
                      <div className="text-caption text-ink-muted mb-1">Vendor UOM *</div>
                      <Input
                        value={form.vendorUom}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, vendorUom: e.target.value }))
                        }
                        placeholder="bag, drum, MT…"
                      />
                    </div>
                    <div className="col-span-3">
                      <div className="text-caption text-ink-muted mb-1">
                        Pack size
                        {selectedProduct && (
                          <span className="normal-case"> ({selectedProduct.uom} per unit)</span>
                        )}
                      </div>
                      <Input
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={form.packSize}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, packSize: Number(e.target.value) || 1 }))
                        }
                      />
                    </div>
                    <div className="col-span-3">
                      <div className="text-caption text-ink-muted mb-1">Price / vendor UOM</div>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.price}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, price: Number(e.target.value) || 0 }))
                        }
                      />
                    </div>
                    <div className="col-span-3">
                      <div className="text-caption text-ink-muted mb-1">Min order qty</div>
                      <Input
                        type="number"
                        min={0.001}
                        value={form.minOrderQty}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, minOrderQty: Number(e.target.value) || 1 }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={addCatalogLine} disabled={busy}>
                      Save catalog line
                    </Button>
                  </div>
                </div>
              )}

              {loadingCatalog ? (
                <div className="py-8 text-center text-ink-muted text-body-sm">Loading…</div>
              ) : catalog.length === 0 ? (
                <div className="py-8 text-center text-ink-muted text-body-sm">
                  No catalog lines yet. Add products this vendor supplies with their terminology
                  and UOM conversion.
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-12 grid-header-cell text-caption border-b border-border">
                    <div className="col-span-3 px-3 py-2">Internal SKU</div>
                    <div className="col-span-3 px-3 py-2">Vendor name / code</div>
                    <div className="col-span-2 px-3 py-2">UOM conversion</div>
                    <div className="col-span-2 px-3 py-2 text-right">Price</div>
                    <div className="col-span-1 px-3 py-2 text-center">MOQ</div>
                    <div className="col-span-1 px-3 py-2"></div>
                  </div>
                  {catalog.map((line) => (
                    <div
                      key={line.id}
                      className={cn(
                        "grid grid-cols-12 items-center border-b border-border last:border-0",
                        !line.active && "opacity-50 bg-canvas"
                      )}
                    >
                      <div className="col-span-3 px-3 py-2">
                        <div className="font-mono text-caption font-semibold">
                          {line.variant?.sku ?? line.product.sku}
                        </div>
                        <div className="text-caption text-ink-muted truncate">
                          {line.product.name}
                        </div>
                      </div>
                      <div className="col-span-3 px-3 py-2 text-body-sm">
                        <div>{line.vendorProductName || "—"}</div>
                        {line.vendorProductCode && (
                          <div className="text-caption text-ink-muted font-mono">
                            {line.vendorProductCode}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2 px-3 py-2 text-caption">
                        1 {line.vendorUom} = {num(line.packSize, 3)} {line.product.uom}
                      </div>
                      <div className="col-span-2 px-3 py-2 text-right tnum">
                        {inr(line.price)}
                        <span className="text-caption text-ink-muted"> /{line.vendorUom}</span>
                      </div>
                      <div className="col-span-1 px-3 py-2 text-center tnum text-caption">
                        {line.minOrderQty}
                      </div>
                      <div className="col-span-1 px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(line)}
                          disabled={busy}
                          className="text-danger hover:bg-danger-soft rounded p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "performance" && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-body-sm font-semibold">Supplier scorecard</div>
                  <div className="text-caption text-ink-muted">
                    Based on PO + GRN history (last {perf?.periodDays ?? 365} days).
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<RefreshCw size={14} />}
                    onClick={() => void loadPerf()}
                    disabled={loadingPerf}
                  >
                    Refresh
                  </Button>
                  <Button size="sm" onClick={syncRating} disabled={busy || !perf}>
                    Apply rating to vendor
                  </Button>
                </div>
              </div>

              {loadingPerf && !perf ? (
                <div className="py-8 text-center text-ink-muted text-body-sm">Loading…</div>
              ) : perf ? (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    <Kpi
                      label="Computed rating"
                      value={
                        <span className="inline-flex items-center gap-1">
                          <Star size={16} className="fill-warning text-warning" />
                          {perf.computedRating.toFixed(1)}
                        </span>
                      }
                      hint={`Manual: ${perf.manualRating.toFixed(1)}`}
                    />
                    <Kpi label="On-time delivery" value={pctLabel(perf.onTimePct)} />
                    <Kpi label="Quality (accept rate)" value={pctLabel(perf.qualityPct)} />
                    <Kpi label="Fill rate" value={pctLabel(perf.fillPct)} />
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <Kpi label="POs (period)" value={String(perf.poCount)} />
                    <Kpi label="GRNs (period)" value={String(perf.grnCount)} />
                    <Kpi label="Open POs" value={String(perf.openPoCount)} />
                    <Kpi label="Spend (period)" value={inr(perf.totalSpend)} />
                  </div>
                  <p className="text-caption text-ink-muted">
                    Rating blends on-time GRN dates vs PO expected date, accepted vs rejected
                    quantities, and received vs ordered fill. Use &quot;Apply rating&quot; to copy
                    the computed score onto the vendor master record.
                  </p>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
