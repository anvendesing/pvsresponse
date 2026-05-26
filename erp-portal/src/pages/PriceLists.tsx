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
import type { Product } from "@/data/types";
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

// A row in the editable price-book grid. `existing` holds the
// PriceListItem row from the server (if any); `price` is the local
// edited value.
interface BookRow {
  productId: string;
  product: Product;
  // Default tier (minQty=1) values
  baseItem: PriceListItemRow | undefined;
  basePrice: string; // local string for editing
  // Tier-2 (minQty>1) values
  tierItem: PriceListItemRow | undefined;
  tierMinQty: string;
  tierPrice: string;
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

  // Build the editable grid from list items + all products.
  useEffect(() => {
    if (!list) return;
    const itemsByProduct = new Map<string, PriceListItemRow[]>();
    for (const it of list.items ?? []) {
      if (it.variantId) continue; // variant tier overrides not editable in this grid; keep simple
      const arr = itemsByProduct.get(it.productId) ?? [];
      arr.push(it);
      itemsByProduct.set(it.productId, arr);
    }
    setBook(
      products
        .filter((p) => p.state === "active")
        .map<BookRow>((p) => {
          const items = itemsByProduct.get(p.id) ?? [];
          const base = items.find((i) => i.minQty <= 1);
          const tier = items.find((i) => i.minQty > 1);
          return {
            productId: p.id,
            product: p,
            baseItem: base,
            basePrice: base ? String(base.price) : "",
            tierItem: tier,
            tierMinQty: tier ? String(tier.minQty) : "",
            tierPrice: tier ? String(tier.price) : "",
          };
        })
    );
  }, [list, products]);

  const filteredBook = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return book;
    return book.filter(
      (b) =>
        b.product.name.toLowerCase().includes(term) ||
        b.product.sku.toLowerCase().includes(term)
    );
  }, [book, search]);

  // Live preview of the formula-derived price
  const formulaPrice = (p: Product): number => {
    if (!list) return p.sellingPrice;
    const basisP = list.basis === "cost" ? p.costPrice : p.sellingPrice;
    return Math.round(basisP * list.multiplier * 100) / 100;
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
        price: number;
        minQty: number;
      }[] = [];
      const remove: string[] = [];

      for (const r of book) {
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
            // If minQty changed, we have to remove the old row + create a new one
            if (r.tierItem && Math.abs(r.tierItem.minQty - tierMin) > 1e-6) {
              remove.push(r.tierItem.id);
              upsert.push({
                productId: r.productId,
                price: tierNum,
                minQty: tierMin,
              });
            } else {
              upsert.push({
                id: r.tierItem?.id,
                productId: r.productId,
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
          {filteredBook.length} of {book.length} products
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
            </tr>
          </thead>
          <tbody>
            {filteredBook.map((r, i) => {
              const original = book.findIndex((x) => x.productId === r.productId);
              const fp = formulaPrice(r.product);
              const base = r.basePrice.trim() === "" ? fp : Number(r.basePrice);
              const savings = Number.isFinite(base)
                ? Math.round(((r.product.sellingPrice - base) / r.product.sellingPrice) * 100)
                : 0;
              return (
                <tr key={r.productId} className="border-b border-border hover:bg-canvas">
                  <td className="px-4 py-2">
                    <div className="font-semibold">{r.product.name}</div>
                    <div className="text-caption text-ink-muted font-mono">
                      {r.product.sku}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tnum text-ink-muted">
                    {inr(r.product.sellingPrice)}
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
                    {savings > 0 ? `-${savings}%` : savings < 0 ? `+${-savings}%` : "0%"}
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
