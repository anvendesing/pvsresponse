// Price Lists: master view + drill-in editor.
//
// UX: a vertical list of price lists on the left (Retail / Dealer / ...);
// the right pane is a "price book" - one row per product showing MRP,
// the computed (formula) price, and any explicit override. The whole
// grid is inline-editable; one click saves the lot. A "Apply formula"
// dialog lets ops do bulk rewrites (e.g. "Dealer = 80% off all SKUs").

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import {
  api,
  type CustomerRow,
  type PriceListItemRow,
  type PriceListRow,
} from "@/lib/api";
import type { Product, ProductVariant } from "@/data/types";
import { useApi } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import { BulkOrderExportModal } from "@/components/sales/BulkOrderExportModal";

export const PriceLists = () => {
  const lists = useApi(() => api.priceLists(), []);
  const products = useApi(() => api.products({ limit: 500 }), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const rows = lists.data ?? [];
  const prods = products.data ?? [];

  useEffect(() => {
    if (!selectedId && rows.length > 0) {
      setSelectedId(rows.find((r) => r.isDefault)?.id ?? rows[0].id);
    }
  }, [rows, selectedId]);

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={<h2 className="text-h3 font-bold">Price Lists</h2>}
        right={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setCreateOpen(true)}
          >
            New price list
          </Button>
        }
      />

      <div className="flex-1 flex min-h-0">
        {/* Left rail */}
        <aside className="w-64 border-r border-border bg-canvas overflow-y-auto">
          {lists.loading ? (
            <div className="p-4 text-caption text-ink-muted">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-caption text-ink-muted">
              No price lists yet.
            </div>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-border transition-colors",
                  selectedId === r.id
                    ? "bg-primary text-white"
                    : "hover:bg-surface"
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-caption font-bold">{r.code}</span>
                  {r.isDefault && (
                    <Chip
                      size="sm"
                      tone={selectedId === r.id ? "neutral" : "primary"}
                    >
                      default
                    </Chip>
                  )}
                  {!r.active && (
                    <Chip size="sm" tone="danger">
                      inactive
                    </Chip>
                  )}
                </div>
                <div
                  className={cn(
                    "text-body-sm font-semibold",
                    selectedId === r.id ? "" : "text-ink"
                  )}
                >
                  {r.name}
                </div>
                <div
                  className={cn(
                    "text-caption flex items-center gap-3 mt-1",
                    selectedId === r.id ? "text-white/80" : "text-ink-muted"
                  )}
                >
                  <span>
                    {r.basis} × {r.multiplier}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Layers size={11} /> {r._count?.items ?? 0}
                    <Users size={11} /> {r._count?.customers ?? 0}
                  </span>
                </div>
              </button>
            ))
          )}
        </aside>

        {/* Editor */}
        <div className="flex-1 min-w-0">
          {selectedId ? (
            <PriceListEditor
              priceListId={selectedId}
              products={prods}
              onChanged={() => {
                void lists.refetch();
              }}
              onDeleted={() => {
                setSelectedId(null);
                void lists.refetch();
              }}
            />
          ) : (
            <EmptyState
              emptyTitle="Pick a price list"
              emptyDescription="Or create a new one with the button above."
              empty
            />
          )}
        </div>
      </div>

      {createOpen && (
        <PriceListCreate
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            setSelectedId(id);
            void lists.refetch();
          }}
        />
      )}
    </div>
  );
};

// ===================================================== Right-side editor ===

interface EditorProps {
  priceListId: string;
  products: Product[];
  onChanged: () => void;
  onDeleted: () => void;
}

// A row in the editable price-book grid.
// isHeader rows are non-editable product-name rows that appear before the
// per-variant sub-rows for products that have active variants.
interface BookRow {
  productId: string;
  product: Product;
  variantId: string | null;
  variant: ProductVariant | null;
  isHeader: boolean; // true = non-editable product grouping row
  // Default tier (minQty=1) values
  baseItem: PriceListItemRow | undefined;
  basePrice: string;
  // Tier-2 (minQty>1) values
  tierItem: PriceListItemRow | undefined;
  tierMinQty: string;
  tierPrice: string;
}

// Build a human-readable label for a variant's defining axes.
function variantLabel(v: ProductVariant): string {
  return [v.size, v.color, v.grade].filter(Boolean).join(" · ") || v.sku;
}

const PriceListEditor = ({ priceListId, products, onChanged, onDeleted }: EditorProps) => {
  const live = useApi(() => api.priceList(priceListId), [priceListId]);
  const list = live.data;
  const [search, setSearch] = useState("");
  const [book, setBook] = useState<BookRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tab, setTab] = useState<"book" | "customers">("book");
  const [revisionTarget, setRevisionTarget] = useState<{
    productId: string;
    variantId: string | null;
    label: string;
  } | null>(null);

  // Build the editable grid from list items + all products.
  // Products with active variants emit a header row + one row per variant.
  // Products without variants emit a single plain row (existing behaviour).
  useEffect(() => {
    if (!list) return;

    // Key items by (productId, variantId|"__none__") for fast lookup.
    type ItemKey = string;
    const makeKey = (productId: string, variantId: string | null): ItemKey =>
      `${productId}__${variantId ?? "__none__"}`;

    const itemsByKey = new Map<ItemKey, PriceListItemRow[]>();
    for (const it of list.items ?? []) {
      const key = makeKey(it.productId, it.variantId ?? null);
      const arr = itemsByKey.get(key) ?? [];
      arr.push(it);
      itemsByKey.set(key, arr);
    }

    const rows: BookRow[] = [];
    for (const p of products.filter((p) => p.state === "active")) {
      const activeVariants = (p.variants ?? []).filter((v) => v.active);
      if (activeVariants.length > 0) {
        // Header row — not editable
        rows.push({
          productId: p.id,
          product: p,
          variantId: null,
          variant: null,
          isHeader: true,
          baseItem: undefined,
          basePrice: "",
          tierItem: undefined,
          tierMinQty: "",
          tierPrice: "",
        });
        // One editable row per variant
        for (const v of activeVariants) {
          const items = itemsByKey.get(makeKey(p.id, v.id ?? null)) ?? [];
          const base = items.find((i) => i.minQty <= 1);
          const tier = items.find((i) => i.minQty > 1);
          rows.push({
            productId: p.id,
            product: p,
            variantId: v.id ?? null,
            variant: v,
            isHeader: false,
            baseItem: base,
            basePrice: base ? String(base.price) : "",
            tierItem: tier,
            tierMinQty: tier ? String(tier.minQty) : "",
            tierPrice: tier ? String(tier.price) : "",
          });
        }
      } else {
        // Plain product row (no variants)
        const items = itemsByKey.get(makeKey(p.id, null)) ?? [];
        const base = items.find((i) => i.minQty <= 1);
        const tier = items.find((i) => i.minQty > 1);
        rows.push({
          productId: p.id,
          product: p,
          variantId: null,
          variant: null,
          isHeader: false,
          baseItem: base,
          basePrice: base ? String(base.price) : "",
          tierItem: tier,
          tierMinQty: tier ? String(tier.minQty) : "",
          tierPrice: tier ? String(tier.price) : "",
        });
      }
    }
    setBook(rows);
  }, [list, products]);

  const filteredBook = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return book;
    // Two-pass: collect product IDs with at least one matching row, then
    // include all rows (header + variant rows) for those products.
    const matchingProductIds = new Set<string>();
    for (const b of book) {
      if (b.isHeader) continue;
      const label = b.variant ? variantLabel(b.variant) : "";
      const matches =
        b.product.name.toLowerCase().includes(term) ||
        b.product.sku.toLowerCase().includes(term) ||
        (b.variant?.sku ?? "").toLowerCase().includes(term) ||
        label.toLowerCase().includes(term);
      if (matches) matchingProductIds.add(b.productId);
    }
    return book.filter((b) => matchingProductIds.has(b.productId));
  }, [book, search]);

  // Live preview of the formula-derived price for a book row.
  // For variant rows: use the variant's price override as the basis if set,
  // otherwise fall back to the parent product price.
  const formulaPrice = (r: BookRow): number => {
    if (!list) return r.product.sellingPrice;
    const basisP =
      list.basis === "cost"
        ? (r.variant?.costPriceOverride ?? r.product.costPrice)
        : (r.variant?.sellingPriceOverride ?? r.product.sellingPrice);
    return Math.round(basisP * list.multiplier * 100) / 100;
  };

  // The "MRP" for a row: variant override if available, else parent.
  const rowMrp = (r: BookRow): number =>
    r.variant?.sellingPriceOverride ?? r.product.sellingPrice;

  // Find the nearest upcoming price revision for a row (validFrom > now).
  const nextRevision = (r: BookRow): PriceListItemRow | null => {
    const items = list?.items ?? [];
    const now = new Date();
    const candidates = items.filter(
      (it) =>
        it.productId === r.productId &&
        (it.variantId ?? null) === r.variantId &&
        it.validFrom != null &&
        new Date(it.validFrom) > now
    );
    if (candidates.length === 0) return null;
    return candidates.sort(
      (a, b) =>
        new Date(a.validFrom!).getTime() - new Date(b.validFrom!).getTime()
    )[0];
  };

  const update = (idx: number, patch: Partial<BookRow>) =>
    setBook((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!list) return;
    setSaving(true);
    setMsg(null);
    try {
      const upsert: {
        id?: string;
        productId: string;
        variantId?: string | null;
        price: number;
        minQty: number;
      }[] = [];
      const remove: string[] = [];

      for (const r of book) {
        if (r.isHeader) continue; // header rows have no editable data

        // Base row
        const baseNum = r.basePrice.trim() === "" ? null : Number(r.basePrice);
        if (baseNum != null && Number.isFinite(baseNum) && baseNum >= 0) {
          if (
            !r.baseItem ||
            Math.abs(r.baseItem.price - baseNum) > 1e-6
          ) {
            upsert.push({
              id: r.baseItem?.id,
              productId: r.productId,
              variantId: r.variantId,
              price: baseNum,
              minQty: 1,
            });
          }
        } else if (r.baseItem) {
          remove.push(r.baseItem.id);
        }
        // Tier row
        const tierNum = r.tierPrice.trim() === "" ? null : Number(r.tierPrice);
        const tierMin = r.tierMinQty.trim() === "" ? null : Number(r.tierMinQty);
        if (
          tierNum != null &&
          tierMin != null &&
          Number.isFinite(tierNum) &&
          Number.isFinite(tierMin) &&
          tierNum >= 0 &&
          tierMin > 1
        ) {
          if (
            !r.tierItem ||
            Math.abs(r.tierItem.price - tierNum) > 1e-6 ||
            Math.abs(r.tierItem.minQty - tierMin) > 1e-6
          ) {
            // If minQty changed, remove the old row + create a new one
            if (r.tierItem && Math.abs(r.tierItem.minQty - tierMin) > 1e-6) {
              remove.push(r.tierItem.id);
              upsert.push({
                productId: r.productId,
                variantId: r.variantId,
                price: tierNum,
                minQty: tierMin,
              });
            } else {
              upsert.push({
                id: r.tierItem?.id,
                productId: r.productId,
                variantId: r.variantId,
                price: tierNum,
                minQty: tierMin,
              });
            }
          }
        } else if (r.tierItem) {
          remove.push(r.tierItem.id);
        }
      }

      await api.upsertPriceListItems(list.id, { upsert, remove });
      setMsg({
        kind: "ok",
        text: `Saved ${upsert.length} change(s)${remove.length ? `, removed ${remove.length}` : ""}.`,
      });
      await live.refetch();
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!list) return;
    await api.updatePriceList(list.id, { active: !list.active });
    await live.refetch();
    onChanged();
  };

  const toggleDefault = async () => {
    if (!list || list.isDefault) return;
    await api.updatePriceList(list.id, { isDefault: true });
    await live.refetch();
    onChanged();
  };

  const remove = async () => {
    if (!list) return;
    if ((list._count?.customers ?? 0) > 0) {
      alert("Reassign customers off this list first.");
      return;
    }
    if (!confirm(`Delete ${list.name}?`)) return;
    try {
      await api.deletePriceList(list.id);
      onDeleted();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    }
  };

  if (live.loading || !list) {
    return <div className="p-6 text-ink-muted">Loading…</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border bg-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-caption font-bold text-primary">
                {list.code}
              </span>
              {list.isDefault && (
                <Chip size="sm" tone="primary">
                  default
                </Chip>
              )}
              <Chip
                size="sm"
                tone={list.active ? "success" : "danger"}
                className="capitalize"
              >
                {list.active ? "active" : "inactive"}
              </Chip>
            </div>
            <div className="text-h3 font-bold">{list.name}</div>
            <div className="text-caption text-ink-muted mt-0.5">
              {list.description ?? "—"} · formula: {list.basis} × {list.multiplier} ·{" "}
              {list._count?.items ?? 0} explicit overrides ·{" "}
              {list._count?.customers ?? 0} customer(s) assigned
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<Download size={14} />}
              onClick={() => setExportOpen(true)}
              title="Export bulk order Excel for this price list"
            >
              Export Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<Sparkles size={14} />}
              onClick={() => setFormulaOpen(true)}
            >
              Apply formula
            </Button>
            {!list.isDefault && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleDefault}
                title="Set as default for new customers"
              >
                Set default
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={toggleActive}>
              {list.active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<Trash2 size={14} />}
              className="border-danger text-danger hover:bg-danger-soft"
              onClick={remove}
              disabled={(list._count?.customers ?? 0) > 0}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-4 bg-surface border-b border-border flex items-center gap-1">
        <button
          onClick={() => setTab("book")}
          className={cn(
            "px-3 py-2 text-body-sm font-semibold border-b-2 transition-colors",
            tab === "book"
              ? "border-primary text-primary"
              : "border-transparent text-ink-muted hover:text-ink"
          )}
        >
          Price book
        </button>
        <button
          onClick={() => setTab("customers")}
          className={cn(
            "px-3 py-2 text-body-sm font-semibold border-b-2 transition-colors",
            tab === "customers"
              ? "border-primary text-primary"
              : "border-transparent text-ink-muted hover:text-ink"
          )}
        >
          Customers ({list._count?.customers ?? 0})
        </button>
      </div>

      {tab === "book" && (
      <div className="px-4 py-2 bg-surface border-b border-border flex items-center gap-2">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search SKU or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="!h-8 max-w-md"
        />
        <span className="ml-auto text-caption text-ink-muted">
          {filteredBook.filter((r) => !r.isHeader).length} of{" "}
          {book.filter((r) => !r.isHeader).length} SKUs
        </span>
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw size={14} />}
          onClick={() => void live.refetch()}
        >
          Reload
        </Button>
        <Button
          size="sm"
          icon={<CheckCircle2 size={14} />}
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      )}

      {msg && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm",
            msg.kind === "ok"
              ? "bg-success-soft border-success text-success"
              : "bg-danger-soft border-danger text-danger"
          )}
        >
          {msg.text}
        </div>
      )}

      {/* Grid */}
      {tab === "book" && (
      <div className="flex-1 overflow-auto bg-surface">
        <table className="w-full text-body-sm">
          <thead className="sticky top-0 bg-canvas border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">SKU / Name</th>
              <th className="text-right px-4 py-2 font-semibold w-24">MRP</th>
              <th className="text-right px-4 py-2 font-semibold w-24">Formula</th>
              <th className="text-right px-4 py-2 font-semibold w-32">
                Base price
              </th>
              <th className="text-right px-4 py-2 font-semibold w-24">Tier ≥</th>
              <th className="text-right px-4 py-2 font-semibold w-32">
                Tier price
              </th>
              <th className="text-right px-4 py-2 font-semibold w-24">Savings</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filteredBook.map((r, i) => {
              // Header row: non-editable product grouping for variant products
              if (r.isHeader) {
                return (
                  <tr
                    key={`${r.productId}__header`}
                    className="border-b border-border bg-canvas/60"
                  >
                    <td colSpan={8} className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <ChevronRight size={13} className="text-ink-muted" />
                        <span className="font-semibold text-ink">{r.product.name}</span>
                        <span className="font-mono text-caption text-ink-muted">{r.product.sku}</span>
                        <Chip size="sm" tone="neutral">Variants</Chip>
                      </div>
                    </td>
                  </tr>
                );
              }

              // Editable row — find its index in the full (unfiltered) book
              const original = book.findIndex(
                (x) => x.productId === r.productId && x.variantId === r.variantId && !x.isHeader
              );
              const fp = formulaPrice(r);
              const mrp = rowMrp(r);
              const base = r.basePrice.trim() === "" ? fp : Number(r.basePrice);
              const savings = Number.isFinite(base)
                ? Math.round(((mrp - base) / Math.max(1, mrp)) * 100)
                : 0;
              const isVariantRow = r.variant !== null;
              const nextRev = nextRevision(r);

              return (
                <tr
                  key={`${r.productId}__${r.variantId ?? "null"}`}
                  className="border-b border-border hover:bg-canvas"
                >
                  <td className={cn("px-4 py-2", isVariantRow && "pl-8")}>
                    {isVariantRow ? (
                      <>
                        <div className="font-semibold text-ink">
                          {variantLabel(r.variant!)}
                        </div>
                        <div className="text-caption text-ink-muted font-mono flex items-center gap-2">
                          {r.variant!.sku}
                          {r.variant!.uom && (
                            <span className="text-ink-muted">· {r.variant!.uom}</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-semibold">{r.product.name}</div>
                        <div className="text-caption text-ink-muted font-mono">
                          {r.product.sku}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tnum text-ink-muted">
                    {inr(mrp)}
                  </td>
                  <td className="px-4 py-2 text-right tnum text-ink-muted">
                    {inr(fp)}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      placeholder={String(fp)}
                      value={r.basePrice}
                      onChange={(e) => update(original, { basePrice: e.target.value })}
                      className="w-full h-7 px-2 text-right tnum bg-surface border border-border rounded-md font-semibold focus:outline-none focus:border-primary"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      placeholder="—"
                      value={r.tierMinQty}
                      onChange={(e) => update(original, { tierMinQty: e.target.value })}
                      className="w-full h-7 px-2 text-right tnum bg-surface border border-border rounded-md focus:outline-none focus:border-primary"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      placeholder="—"
                      value={r.tierPrice}
                      onChange={(e) => update(original, { tierPrice: e.target.value })}
                      className="w-full h-7 px-2 text-right tnum bg-surface border border-border rounded-md focus:outline-none focus:border-primary"
                    />
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right tnum font-semibold",
                      savings > 0
                        ? "text-success"
                        : savings < 0
                          ? "text-danger"
                          : "text-ink-muted"
                    )}
                  >
                    <div className="flex flex-col items-end gap-1">
                      <span>{savings > 0 ? `-${savings}%` : savings < 0 ? `+${-savings}%` : "0%"}</span>
                      {nextRev && (
                        <button
                          onClick={() =>
                            setRevisionTarget({
                              productId: r.productId,
                              variantId: r.variantId,
                              label: r.variant
                                ? `${r.product.name} · ${variantLabel(r.variant)}`
                                : r.product.name,
                            })
                          }
                          className="text-caption text-success font-semibold hover:underline whitespace-nowrap"
                          title={`Price revision from ${fmtDate(nextRev.validFrom)}`}
                        >
                          {inr(nextRev.price)} from{" "}
                          {new Date(nextRev.validFrom!).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      title="Scheduled price revisions"
                      onClick={() =>
                        setRevisionTarget({
                          productId: r.productId,
                          variantId: r.variantId,
                          label: r.variant ? `${r.product.name} · ${variantLabel(r.variant)}` : r.product.name,
                        })
                      }
                      className={cn(
                        "h-6 w-6 rounded flex items-center justify-center transition-colors",
                        nextRev
                          ? "text-success hover:text-success hover:bg-success-soft"
                          : "text-ink-muted hover:text-primary hover:bg-primary-50"
                      )}
                    >
                      <Clock size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {tab === "customers" && (
        <CustomersPanel
          priceListId={list.id}
          onChanged={() => {
            void live.refetch();
            onChanged();
          }}
        />
      )}

      {formulaOpen && (
        <ApplyFormulaDialog
          list={list}
          onClose={() => setFormulaOpen(false)}
          onApplied={async () => {
            setFormulaOpen(false);
            await live.refetch();
            onChanged();
          }}
        />
      )}

      {exportOpen && (
        <BulkOrderExportModal
          priceListId={list.id}
          onClose={() => setExportOpen(false)}
        />
      )}

      {revisionTarget && (
        <RevisionsDrawer
          priceListId={list.id}
          productId={revisionTarget.productId}
          variantId={revisionTarget.variantId}
          label={revisionTarget.label}
          onClose={() => {
            setRevisionTarget(null);
            void live.refetch();
          }}
        />
      )}
    </div>
  );
};

// ============================================== Customers panel ===
//
// Shows every customer with a pull-down to assign / change their price
// list. Customers already assigned to THIS list have a primary-coloured
// badge.

const CustomersPanel = ({
  priceListId,
  onChanged,
}: {
  priceListId: string;
  onChanged: () => void;
}) => {
  const live = useApi<CustomerRow[]>(() => api.customers(), []);
  const lists = useApi(() => api.priceLists(), []);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"assigned" | "all">("assigned");
  const [busyId, setBusyId] = useState<string | null>(null);

  const customers = live.data ?? [];
  const allLists = lists.data ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (filter === "assigned" && c.priceListId !== priceListId) return false;
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term) ||
        c.city?.toLowerCase().includes(term)
      );
    });
  }, [customers, search, filter, priceListId]);

  const assign = async (customerId: string, listId: string | null) => {
    setBusyId(customerId);
    try {
      await api.updateCustomer(customerId, { priceListId: listId });
      await live.refetch();
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="px-4 py-2 bg-surface border-b border-border flex items-center gap-2">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="!h-8 max-w-md"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilter("assigned")}
            className={cn(
              "h-7 px-3 rounded-md text-caption font-semibold",
              filter === "assigned"
                ? "bg-primary text-white"
                : "bg-canvas text-ink-muted hover:text-primary"
            )}
          >
            On this list
          </button>
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "h-7 px-3 rounded-md text-caption font-semibold",
              filter === "all"
                ? "bg-primary text-white"
                : "bg-canvas text-ink-muted hover:text-primary"
            )}
          >
            All customers
          </button>
        </div>
        <span className="ml-auto text-caption text-ink-muted">
          {filtered.length} customer(s)
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-surface">
        <table className="w-full text-body-sm">
          <thead className="sticky top-0 bg-canvas border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-semibold w-24">Code</th>
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">City</th>
              <th className="text-left px-4 py-2 font-semibold w-56">
                Assigned list
              </th>
              <th className="text-right px-4 py-2 font-semibold w-32">
                Credit limit
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className={cn(
                  "border-b border-border",
                  c.priceListId === priceListId ? "bg-primary-50/30" : "hover:bg-canvas"
                )}
              >
                <td className="px-4 py-2 font-mono text-caption">{c.code}</td>
                <td className="px-4 py-2 font-semibold">{c.name}</td>
                <td className="px-4 py-2 text-ink-muted">{c.city ?? "—"}</td>
                <td className="px-4 py-2">
                  <select
                    disabled={busyId === c.id}
                    value={c.priceListId ?? ""}
                    onChange={(e) =>
                      void assign(c.id, e.target.value === "" ? null : e.target.value)
                    }
                    className={cn(
                      "h-7 w-full bg-surface border border-border rounded-md px-2 text-body-sm",
                      c.priceListId === priceListId && "border-primary"
                    )}
                  >
                    <option value="">— none (use default product price) —</option>
                    {allLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.name} ({l.basis} × {l.multiplier})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-right tnum">
                  {c.creditLimit ? inr(c.creditLimit) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

// ============================================== Apply formula dialog ===

const ApplyFormulaDialog = ({
  list,
  onClose,
  onApplied,
}: {
  list: PriceListRow;
  onClose: () => void;
  onApplied: () => void;
}) => {
  const [basis, setBasis] = useState<"selling" | "cost">(list.basis);
  const [multiplier, setMultiplier] = useState(String(list.multiplier));
  const [createMissing, setCreateMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = async () => {
    const m = Number(multiplier);
    if (!Number.isFinite(m) || m <= 0) {
      setErr("Multiplier must be > 0.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.applyPriceListFormula(list.id, {
        basis,
        multiplier: m,
        createMissing,
      });
      onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center" onClick={onClose}>
      <div
        className="bg-surface rounded-lg w-full max-w-md elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="text-h3 font-bold">Apply formula</div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-body-sm text-ink-muted">
            Rewrites every product's base (minQty = 1) override on{" "}
            <strong>{list.code}</strong> using <code>basis × multiplier</code>.
            Tier-pricing rows are not touched.
          </p>
          <div>
            <label className="text-caption text-ink-muted block mb-1">Basis</label>
            <select
              className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
              value={basis}
              onChange={(e) => setBasis(e.target.value as "selling" | "cost")}
            >
              <option value="selling">Selling price (MRP)</option>
              <option value="cost">Cost price</option>
            </select>
          </div>
          <div>
            <label className="text-caption text-ink-muted block mb-1">
              Multiplier (e.g. 0.85 = 15% off)
            </label>
            <Input
              type="number"
              step="0.01"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(e) => setCreateMissing(e.target.checked)}
            />
            Also create overrides for products that don't have one yet
          </label>
          {err && (
            <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
              {err}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={busy}>
            {busy ? "Working…" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============================================== Create dialog ===

const PriceListCreate = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) => {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [multiplier, setMultiplier] = useState("1.0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const pl = await api.createPriceList({
        code: code.toUpperCase().trim(),
        name: name.trim(),
        multiplier: Number(multiplier) || 1,
      });
      onCreated(pl.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center" onClick={onClose}>
      <div
        className="bg-surface rounded-lg w-full max-w-sm elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="text-h3 font-bold">New price list</div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-caption text-ink-muted block mb-1">
              Code (e.g. WHOLESALE)
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WHOLESALE"
            />
          </div>
          <div>
            <label className="text-caption text-ink-muted block mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wholesale tier"
            />
          </div>
          <div>
            <label className="text-caption text-ink-muted block mb-1">
              Default multiplier (× sellingPrice)
            </label>
            <Input
              type="number"
              step="0.01"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
          </div>
          {err && (
            <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
              {err}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={create}
            disabled={busy || code.length < 2 || name.length < 1}
          >
            {busy ? "…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============================================== Revisions Drawer ===
//
// A slide-in panel that shows all price revisions for one SKU+tier combo
// (identified by priceListId + productId + variantId + minQty=1 base price).
// Users can see the current/future/past timeline, add a new revision, and
// delete revisions. The "auto-close previous" checkbox sets validUntil on
// the prior open-ended row to validFrom-1day.

interface RevisionsDrawerProps {
  priceListId: string;
  productId: string;
  variantId: string | null;
  label: string;
  onClose: () => void;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toIsoDate(localDate: string): string {
  // Input is yyyy-mm-dd from a date <input>; convert to ISO datetime UTC midnight.
  return `${localDate}T00:00:00.000Z`;
}

const RevisionsDrawer = ({
  priceListId,
  productId,
  variantId,
  label,
  onClose,
}: RevisionsDrawerProps) => {
  const live = useApi(() => api.priceList(priceListId), [priceListId]);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // All items for this exact (product, variant) pair, sorted by validFrom asc.
  const revisions = useMemo<PriceListItemRow[]>(() => {
    const items = live.data?.items ?? [];
    return items
      .filter(
        (it) =>
          it.productId === productId &&
          (it.variantId ?? null) === variantId
      )
      .sort((a, b) => {
        const da = a.validFrom ? new Date(a.validFrom).getTime() : -Infinity;
        const db_ = b.validFrom ? new Date(b.validFrom).getTime() : -Infinity;
        return da - db_;
      });
  }, [live.data, productId, variantId]);

  const now = new Date();

  const statusOf = (r: PriceListItemRow): "past" | "current" | "future" => {
    const from = r.validFrom ? new Date(r.validFrom) : null;
    const until = r.validUntil ? new Date(r.validUntil) : null;
    if (until && until < now) return "past";
    if (from && from > now) return "future";
    return "current";
  };

  const deleteRevision = async (id: string) => {
    if (!confirm("Delete this price revision?")) return;
    setBusy(true);
    setErr(null);
    try {
      await api.upsertPriceListItems(priceListId, { remove: [id] });
      await live.refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-surface shadow-2xl flex flex-col border-l border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <div className="text-h3 font-bold">Price revisions</div>
            <div className="text-caption text-ink-muted mt-0.5 truncate max-w-[280px]">
              {label}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {live.loading && (
            <div className="text-caption text-ink-muted">Loading…</div>
          )}
          {!live.loading && revisions.length === 0 && (
            <div className="text-body-sm text-ink-muted text-center py-8">
              No explicit revisions. This SKU uses the list formula price.
            </div>
          )}
          {revisions.map((r) => {
            const status = statusOf(r);
            return (
              <div
                key={r.id}
                className={cn(
                  "rounded-lg border px-4 py-3 flex items-start gap-3",
                  status === "current"
                    ? "border-primary/30 bg-primary-50/20"
                    : status === "future"
                      ? "border-success/30 bg-success-soft/30"
                      : "border-border bg-canvas opacity-60"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-h3 font-bold tnum">{inr(r.price)}</span>
                    {r.minQty > 1 && (
                      <Chip size="sm" tone="neutral">Tier ≥ {r.minQty}</Chip>
                    )}
                    <Chip
                      size="sm"
                      tone={
                        status === "current"
                          ? "primary"
                          : status === "future"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {status === "current"
                        ? "Active now"
                        : status === "future"
                          ? "Upcoming"
                          : "Expired"}
                    </Chip>
                  </div>
                  <div className="text-caption text-ink-muted mt-1 flex items-center gap-1">
                    <Clock size={11} />
                    {r.validFrom ? `From ${fmtDate(r.validFrom)}` : "No start bound"}
                    {" · "}
                    {r.validUntil ? `Until ${fmtDate(r.validUntil)}` : "No end bound"}
                  </div>
                  {r.notes && (
                    <div className="text-caption text-ink-muted mt-0.5 italic">{r.notes}</div>
                  )}
                </div>
                <button
                  onClick={() => void deleteRevision(r.id)}
                  disabled={busy}
                  className="text-ink-muted hover:text-danger transition-colors mt-0.5"
                  title="Delete this revision"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {err && (
          <div className="mx-4 px-3 py-2 rounded-md bg-danger-soft border border-danger text-danger text-body-sm">
            {err}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          {addOpen ? (
            <AddRevisionForm
              priceListId={priceListId}
              productId={productId}
              variantId={variantId}
              existingRevisions={revisions}
              onSaved={() => {
                setAddOpen(false);
                void live.refetch();
              }}
              onCancel={() => setAddOpen(false)}
            />
          ) : (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setAddOpen(true)}
              className="w-full justify-center"
            >
              Add price revision
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================= Add-revision form (inside drawer) ===

interface AddRevisionFormProps {
  priceListId: string;
  productId: string;
  variantId: string | null;
  existingRevisions: PriceListItemRow[];
  onSaved: () => void;
  onCancel: () => void;
}

const AddRevisionForm = ({
  priceListId,
  productId,
  variantId,
  existingRevisions,
  onSaved,
  onCancel,
}: AddRevisionFormProps) => {
  const [price, setPrice] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [autoClose, setAutoClose] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const priceNum = Number(price);
    if (!price.trim() || !Number.isFinite(priceNum) || priceNum < 0) {
      setErr("Price is required and must be ≥ 0.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const upsert: Parameters<typeof api.upsertPriceListItems>[1]["upsert"] =
        [];

      // The new revision row
      upsert.push({
        productId,
        variantId,
        price: priceNum,
        minQty: 1,
        notes: notes.trim() || null,
        validFrom: validFrom ? toIsoDate(validFrom) : null,
        validUntil: validUntil ? toIsoDate(validUntil) : null,
      });

      // Auto-close the most recent open-ended current revision.
      if (autoClose && validFrom) {
        const openEnded = existingRevisions.find(
          (r) => r.validUntil == null && r.minQty <= 1
        );
        if (openEnded) {
          // Set its validUntil to one day before the new validFrom.
          const closeDate = new Date(toIsoDate(validFrom));
          closeDate.setUTCDate(closeDate.getUTCDate() - 1);
          upsert.push({
            id: openEnded.id,
            productId,
            variantId,
            price: openEnded.price,
            minQty: openEnded.minQty,
            notes: openEnded.notes ?? null,
            validFrom: openEnded.validFrom ?? null,
            validUntil: closeDate.toISOString(),
          });
        }
      }

      await api.upsertPriceListItems(priceListId, { upsert });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Warn if the new window overlaps an existing revision
  const overlapWarning = useMemo(() => {
    if (!validFrom) return null;
    const newFrom = new Date(toIsoDate(validFrom)).getTime();
    const newUntil = validUntil
      ? new Date(toIsoDate(validUntil)).getTime()
      : Infinity;
    const overlapping = existingRevisions.filter((r) => {
      const rFrom = r.validFrom ? new Date(r.validFrom).getTime() : -Infinity;
      const rUntil = r.validUntil
        ? new Date(r.validUntil).getTime()
        : Infinity;
      return rFrom < newUntil && rUntil > newFrom;
    });
    return overlapping.length > 0
      ? `Overlaps with ${overlapping.length} existing revision(s). The resolver will pick the newest validFrom.`
      : null;
  }, [validFrom, validUntil, existingRevisions]);

  return (
    <div className="space-y-3">
      <div className="text-body-sm font-semibold text-ink">New price revision</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-caption text-ink-muted block mb-1">
            New price (₹) *
          </label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div />
        <div>
          <label className="text-caption text-ink-muted block mb-1">
            Effective from
          </label>
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-caption text-ink-muted block mb-1">
            Effective until
          </label>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>
      <div>
        <label className="text-caption text-ink-muted block mb-1">Notes</label>
        <Input
          placeholder="e.g. Festive season promo"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {validFrom && (
        <label className="flex items-start gap-2 text-body-sm cursor-pointer">
          <input
            type="checkbox"
            checked={autoClose}
            onChange={(e) => setAutoClose(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Auto-close the current open-ended price on{" "}
            <strong>
              {fmtDate(
                new Date(
                  new Date(toIsoDate(validFrom)).getTime() - 86400000
                ).toISOString()
              )}
            </strong>{" "}
            (day before effective from)
          </span>
        </label>
      )}
      {overlapWarning && (
        <div className="text-caption text-warning bg-warning-soft/40 border border-warning/30 rounded-md px-3 py-2">
          {overlapWarning}
        </div>
      )}
      {err && (
        <div className="text-caption text-danger bg-danger-soft border border-danger rounded-md px-3 py-2">
          {err}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy} className="flex-1 justify-center">
          {busy ? "Saving…" : "Save revision"}
        </Button>
      </div>
    </div>
  );
};
