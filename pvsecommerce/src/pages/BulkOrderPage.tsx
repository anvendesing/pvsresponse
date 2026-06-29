// Bulk order — category masonry grid, compact rows, qty → checkout.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CatalogProduct, CatalogVariant } from "@/lib/api";
import { useCatalog } from "@/state/CatalogContext";
import { useCategories } from "@/state/CategoriesContext";
import { useCart } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import { inr } from "@/lib/format";
import { lineBarcode } from "@/lib/scanCode";

interface BulkRow {
  key: string;
  productId: string;
  variantId: string | null;
  displayName: string;
  categorySlug: string | null;
  categoryName: string;
  barcode: string | null;
  available: number;
  rate: number;
  product: CatalogProduct;
  variant: CatalogVariant | null;
}

interface CategoryGroup {
  slug: string;
  name: string;
  rows: BulkRow[];
}

const variantParams = (v: CatalogVariant): string =>
  [v.size, v.color, v.grade].filter(Boolean).join(" · ");

const displayNameFor = (productName: string, variant: CatalogVariant | null): string => {
  if (!variant) return productName;
  const params = variantParams(variant);
  return params ? `${productName} · ${params}` : productName;
};

function flattenCatalog(products: CatalogProduct[]): BulkRow[] {
  const rows: BulkRow[] = [];
  for (const p of products) {
    if (p.variants.length > 0) {
      for (const v of p.variants) {
        if (!v.inStock) continue;
        rows.push({
          key: v.id,
          productId: p.id,
          variantId: v.id,
          displayName: displayNameFor(p.name, v),
          categorySlug: p.categorySlug,
          categoryName: p.categoryName ?? p.category,
          barcode: lineBarcode({ barcode: v.barcode, productBarcode: p.barcode }),
          available: 9999,
          rate: v.price,
          product: p,
          variant: v,
        });
      }
    } else if (p.inStock) {
      rows.push({
        key: p.id,
        productId: p.id,
        variantId: null,
        displayName: p.name,
        categorySlug: p.categorySlug,
        categoryName: p.categoryName ?? p.category,
        barcode: lineBarcode({ productBarcode: p.barcode }),
        available: 9999,
        rate: p.sellingPrice,
        product: p,
        variant: null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName) ||
      a.displayName.localeCompare(b.displayName)
  );
}

function groupByCategory(rows: BulkRow[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const row of rows) {
    const slug = row.categorySlug ?? "_other";
    let group = map.get(slug);
    if (!group) {
      group = { slug, name: row.categoryName, rows: [] };
      map.set(slug, group);
    }
    group.rows.push(row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const BulkOrderPage = () => {
  const { products, loading, error } = useCatalog();
  const { categories } = useCategories();
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({});

  const allRows = useMemo(() => flattenCatalog(products), [products]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (categorySlug && r.categorySlug !== categorySlug) return false;
      if (!needle) return true;
      const hay = [r.displayName, r.barcode, r.categoryName].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [allRows, search, categorySlug]);

  const categoryGroups = useMemo(() => groupByCategory(filteredRows), [filteredRows]);

  const filledRows = useMemo(
    () => allRows.filter((r) => (qtyByKey[r.key] ?? 0) > 0),
    [allRows, qtyByKey]
  );

  const summary = useMemo(() => {
    let lineCount = 0;
    let totalQty = 0;
    let subTotal = 0;
    for (const r of filledRows) {
      const q = qtyByKey[r.key] ?? 0;
      if (q <= 0) continue;
      lineCount += 1;
      totalQty += q;
      subTotal += q * r.rate;
    }
    return { lineCount, totalQty, subTotal };
  }, [filledRows, qtyByKey]);

  const setQty = (row: BulkRow, raw: string) => {
    const parsed = raw === "" ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
    const clamped = Math.min(parsed, row.available);
    setQtyByKey((prev) => {
      if (clamped <= 0) {
        const next = { ...prev };
        delete next[row.key];
        return next;
      }
      return { ...prev, [row.key]: clamped };
    });
  };

  const resetAll = () => setQtyByKey({});

  const goCheckout = () => {
    const items = filledRows
      .map((r) => ({
        product: r.product,
        variant: r.variant,
        qty: qtyByKey[r.key] ?? 0,
      }))
      .filter((i) => i.qty > 0);

    if (items.length === 0) {
      toast.show("Enter a quantity on at least one row.", "error");
      return;
    }

    cart.addMany(items);
    toast.show(`Added ${summary.totalQty} items to cart`, "success");
    navigate("/checkout");
  };

  return (
    <div className="bulk-order-page">
      <div className="bulk-order-inner">
        <h1 className="serif-title bulk-order-title">Bulk order</h1>
        <p className="muted bulk-order-lead">
          Type quantities per line — variant details are in the name. In-stock only. Shipping at checkout.
        </p>

        <div className="card-soft bulk-order-toolbar">
          <input
            type="search"
            className="bulk-order-search"
            placeholder="Search name or barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="bulk-order-select"
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="text-link bulk-order-reset" onClick={resetAll}>
            Reset all
          </button>
        </div>

        {error && (
          <div className="card-soft bulk-order-error">Could not load catalog: {error}</div>
        )}

        {loading ? (
          <div className="card-soft">
            <p className="muted">Loading catalog…</p>
          </div>
        ) : categoryGroups.length === 0 ? (
          <div className="card-soft bulk-order-empty">
            <p className="muted">No in-stock products match your filters.</p>
          </div>
        ) : (
          <div className="bulk-order-masonry">
            {categoryGroups.map((group) => (
              <section key={group.slug} className="bulk-order-cat-card">
                <header className="bulk-order-cat-head">
                  <h2>{group.name}</h2>
                  <span className="muted">{group.rows.length}</span>
                </header>
                <ul className="bulk-order-lines">
                  {group.rows.map((row) => {
                    const qty = qtyByKey[row.key] ?? 0;
                    return (
                      <li
                        key={row.key}
                        className={`bulk-order-line${qty > 0 ? " bulk-order-line--filled" : ""}`}
                      >
                        <span className="bulk-order-line-name" title={row.displayName}>
                          {row.displayName}
                        </span>
                        <span className="bulk-order-line-bc tnum">{row.barcode ?? ""}</span>
                        <span className="bulk-order-line-rate tnum">{inr(row.rate)}</span>
                        <input
                          type="number"
                          min={0}
                          max={row.available}
                          step={1}
                          value={qty === 0 ? "" : qty}
                          placeholder="0"
                          onChange={(e) => setQty(row, e.target.value)}
                          aria-label={`Quantity for ${row.displayName}`}
                          className="bulk-order-qty-input"
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <aside className="bulk-order-footer card-soft">
        <div className="bulk-order-footer-row">
          <span className="muted">Lines</span>
          <span className="tnum">{summary.lineCount}</span>
        </div>
        <div className="bulk-order-footer-row">
          <span className="muted">Qty</span>
          <span className="tnum">{summary.totalQty}</span>
        </div>
        <div className="bulk-order-footer-total">
          <span>Subtotal (excl. GST)</span>
          <span className="tnum">{inr(summary.subTotal)}</span>
        </div>
        <button
          type="button"
          className="btn btn-green btn-block"
          disabled={summary.lineCount === 0}
          onClick={goCheckout}
        >
          {summary.lineCount === 0
            ? "Add to checkout"
            : `Add to checkout (${summary.totalQty})`}
        </button>
      </aside>
    </div>
  );
};
