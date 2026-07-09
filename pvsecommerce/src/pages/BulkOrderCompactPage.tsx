// Bulk Order v2 — Three-panel B2B ordering portal.
// Route: /bulk-order-v2 (internal power-user URL, not in nav)
//
// Layout: sticky category sidebar | scrollable product grid | sticky order summary
// Mobile: horizontal category chips + floating checkout bar

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CatalogProduct, CatalogVariant } from "@/lib/api";
import { resolveUploadUrl } from "@/lib/api";
import { useCatalog } from "@/state/CatalogContext";
import { useCart } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import { inr } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VariantRow {
  key: string;
  variantId: string | null;
  sizeLabel: string;
  rate: number;
  product: CatalogProduct;
  variant: CatalogVariant | null;
}

interface ProductEntry {
  productId: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  imageUrl: string | undefined;
  rows: VariantRow[];
}

interface CategoryGroup {
  slug: string;
  name: string;
  entries: ProductEntry[];
}

interface CategoryStat {
  slug: string;
  name: string;
  total: number;
  selected: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sizeLabel = (v: CatalogVariant): string =>
  [v.size, v.color, v.grade].filter(Boolean).join(" · ") || v.sku;

function buildGroups(products: CatalogProduct[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const p of products) {
    const slug = p.categorySlug ?? "_other";
    const name = p.categoryName ?? p.category ?? "Other";
    if (!map.has(slug)) map.set(slug, { slug, name, entries: [] });

    const rows: VariantRow[] =
      p.variants.length > 0
        ? p.variants.filter((v) => v.inStock).map((v) => ({
            key: v.id,
            variantId: v.id,
            sizeLabel: sizeLabel(v),
            rate: v.price,
            product: p,
            variant: v,
          }))
        : p.inStock
        ? [{ key: p.id, variantId: null, sizeLabel: p.uom ?? "—", rate: p.sellingPrice, product: p, variant: null }]
        : [];

    if (rows.length === 0) continue;
    const thumb = resolveUploadUrl(p.imageUrl, p.imageUpdatedAt);
    // prefer thumb size when it's a directory-style path
    const thumbUrl =
      p.imageUrl && !p.imageUrl.match(/\.\w{2,5}(\?.*)?$/)
        ? thumb?.replace("/medium.jpg", "/thumb.jpg")
        : thumb;
    map.get(slug)!.entries.push({ productId: p.id, name: p.name, categorySlug: slug, categoryName: name, imageUrl: thumbUrl, rows });
  }

  return [...map.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ ...g, entries: g.entries.sort((a, b) => a.name.localeCompare(b.name)) }));
}

// Initials avatar colour derived from product name
const AVATAR_COLOURS = ["#385f1c", "#4c7b2a", "#6b8f35", "#233e11", "#7c6d1a", "#a08020"];
const avatarColor = (name: string) =>
  AVATAR_COLOURS[name.charCodeAt(0) % AVATAR_COLOURS.length];

// ─── Sub-components ───────────────────────────────────────────────────────────

// Category Sidebar
interface SidebarProps {
  groups: CategoryGroup[];
  stats: CategoryStat[];
  active: string | null;
  onSelect: (slug: string | null) => void;
}
const CategorySidebar = ({ groups, stats, active, onSelect }: SidebarProps) => {
  const totalSelected = stats.reduce((s, c) => s + c.selected, 0);
  return (
    <nav className="boc2-sidebar" aria-label="Product categories">
      <button
        className={`boc2-cat-btn${active === null ? " boc2-cat-btn--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        <span className="boc2-cat-name">All products</span>
        <span className="boc2-cat-count">{groups.reduce((s, g) => s + g.entries.length, 0)}</span>
        {totalSelected > 0 && <span className="boc2-cat-sel">{totalSelected}</span>}
      </button>
      {stats.map((stat) => (
        <button
          key={stat.slug}
          className={`boc2-cat-btn${active === stat.slug ? " boc2-cat-btn--active" : ""}`}
          onClick={() => onSelect(stat.slug)}
        >
          <span className="boc2-cat-name">{stat.name}</span>
          <span className="boc2-cat-count">{stat.total}</span>
          {stat.selected > 0 && <span className="boc2-cat-sel">{stat.selected}</span>}
        </button>
      ))}
    </nav>
  );
};

// Product card — one per product, variant rows with steppers
interface CardProps {
  entry: ProductEntry;
  qtyByKey: Record<string, number>;
  onChange: (key: string, delta: number | string) => void;
}
const ProductCard = ({ entry, qtyByKey, onChange }: CardProps) => {
  const isSelected = entry.rows.some((r) => (qtyByKey[r.key] ?? 0) > 0);

  return (
    <article className={`boc2-card${isSelected ? " boc2-card--selected" : ""}`}>
      <div className="boc2-card-img-wrap">
        {entry.imageUrl ? (
          <img
            src={entry.imageUrl}
            alt={entry.name}
            className="boc2-card-img"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="boc2-card-avatar"
            style={{ background: avatarColor(entry.name) }}
            aria-hidden="true"
          >
            {entry.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        {isSelected && <span className="boc2-card-check" aria-hidden="true">✓</span>}
      </div>

      <div className="boc2-card-body">
        <div className="boc2-card-name" title={entry.name}>{entry.name}</div>

        <ul className="boc2-variant-list">
          {entry.rows.map((row) => {
            const qty = qtyByKey[row.key] ?? 0;
            return (
              <li key={row.key} className={`boc2-vrow${qty > 0 ? " boc2-vrow--active" : ""}`}>
                <span className="boc2-vrow-size">{row.sizeLabel}</span>
                <span className="boc2-vrow-price tnum">{inr(row.rate)}</span>
                <div className="boc2-stepper">
                  <button
                    type="button"
                    className="boc2-step-btn"
                    aria-label={`Decrease ${entry.name} ${row.sizeLabel}`}
                    onClick={() => onChange(row.key, -1)}
                    disabled={qty <= 0}
                  >−</button>
                  <input
                    type="number"
                    className="boc2-step-input"
                    min={0}
                    step={1}
                    value={qty === 0 ? "" : qty}
                    placeholder="0"
                    aria-label={`${entry.name} ${row.sizeLabel} quantity`}
                    onChange={(e) => onChange(row.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button
                    type="button"
                    className="boc2-step-btn"
                    aria-label={`Increase ${entry.name} ${row.sizeLabel}`}
                    onClick={() => onChange(row.key, +1)}
                  >+</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
};

// Order summary right panel
interface SummaryProps {
  orderLines: VariantRow[];
  qtyByKey: Record<string, number>;
  showSelected: boolean;
  onToggleSelected: () => void;
  onClearAll: () => void;
  onCheckout: () => void;
}
const OrderSummary = ({ orderLines, qtyByKey, showSelected, onToggleSelected, onClearAll, onCheckout }: SummaryProps) => {
  const lineCount = orderLines.length;
  const totalQty = orderLines.reduce((s, r) => s + (qtyByKey[r.key] ?? 0), 0);
  const subTotal = orderLines.reduce((s, r) => s + (qtyByKey[r.key] ?? 0) * r.rate, 0);

  return (
    <aside className="boc2-summary">
      <div className="boc2-sum-header">
        <span className="boc2-sum-title">Your Order</span>
        {lineCount > 0 && (
          <button type="button" className="boc2-sum-clear text-link" onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      <div className="boc2-sum-stats">
        <div className="boc2-sum-stat">
          <span className="muted">Items</span>
          <span className="tnum boc2-sum-val">{lineCount}</span>
        </div>
        <div className="boc2-sum-stat">
          <span className="muted">Qty</span>
          <span className="tnum boc2-sum-val">{totalQty}</span>
        </div>
        <div className="boc2-sum-stat boc2-sum-stat--total">
          <span>Subtotal</span>
          <span className="tnum boc2-sum-val">{inr(subTotal)}</span>
        </div>
      </div>

      {orderLines.length > 0 && (
        <ul className="boc2-sum-lines">
          {orderLines.map((r) => {
            const qty = qtyByKey[r.key] ?? 0;
            return (
              <li key={r.key} className="boc2-sum-line">
                <div className="boc2-sum-line-name">{r.product.name}</div>
                <div className="boc2-sum-line-detail">
                  <span className="muted">{r.sizeLabel} × {qty}</span>
                  <span className="tnum">{inr(qty * r.rate)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="boc2-sum-footer">
        <label className="boc2-toggle-label">
          <input
            type="checkbox"
            checked={showSelected}
            onChange={onToggleSelected}
            className="boc2-toggle-check"
          />
          Show selected only
        </label>
        <button
          type="button"
          className="btn btn-green btn-block boc2-checkout-btn"
          disabled={lineCount === 0}
          onClick={onCheckout}
        >
          {lineCount === 0 ? "Add to checkout" : `Checkout · ${inr(subTotal)}`}
        </button>
      </div>
    </aside>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const BulkOrderCompactPage = () => {
  const { products, loading, error } = useCatalog();
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategorySlug, setActiveCategorySlug] = useState<string | null>(null);
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({});
  const [showSelected, setShowSelected] = useState(false);

  // Debounce search by 150ms
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 150);
    return () => clearTimeout(id);
  }, [searchRaw]);

  // "/" key focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Build groups once from catalog
  const allGroups = useMemo(() => buildGroups(products), [products]);

  // Category stats (total + selected per category)
  const categoryStats = useMemo<CategoryStat[]>(
    () =>
      allGroups.map((g) => {
        const selected = g.entries.reduce(
          (s, e) => s + e.rows.filter((r) => (qtyByKey[r.key] ?? 0) > 0).length,
          0
        );
        return { slug: g.slug, name: g.name, total: g.entries.length, selected };
      }),
    [allGroups, qtyByKey]
  );

  // All rows with qty > 0
  const orderLines = useMemo<VariantRow[]>(() => {
    const out: VariantRow[] = [];
    for (const g of allGroups)
      for (const e of g.entries)
        for (const r of e.rows)
          if ((qtyByKey[r.key] ?? 0) > 0) out.push(r);
    return out;
  }, [allGroups, qtyByKey]);

  // Visible groups after category + search + showSelected filters
  const visibleGroups = useMemo<CategoryGroup[]>(() => {
    return allGroups
      .filter((g) => !activeCategorySlug || g.slug === activeCategorySlug)
      .map((g) => ({
        ...g,
        entries: g.entries.filter((e) => {
          if (showSelected && !e.rows.some((r) => (qtyByKey[r.key] ?? 0) > 0)) return false;
          if (!search) return true;
          return [e.name, e.categoryName, ...e.rows.map((r) => r.sizeLabel), ...e.rows.map((r) => r.product.sku), ...e.rows.map((r) => r.variant?.barcode ?? "")]
            .join(" ")
            .toLowerCase()
            .includes(search);
        }),
      }))
      .filter((g) => g.entries.length > 0);
  }, [allGroups, activeCategorySlug, search, showSelected, qtyByKey]);

  const totalQty = orderLines.reduce((s, r) => s + (qtyByKey[r.key] ?? 0), 0);
  const subTotal = orderLines.reduce((s, r) => s + (qtyByKey[r.key] ?? 0) * r.rate, 0);

  const handleChange = useCallback((key: string, deltaOrRaw: number | string) => {
    setQtyByKey((prev) => {
      const current = prev[key] ?? 0;
      let next: number;
      if (typeof deltaOrRaw === "number") {
        next = Math.max(0, current + deltaOrRaw);
      } else {
        next = deltaOrRaw === "" ? 0 : Math.max(0, Math.floor(Number(deltaOrRaw) || 0));
      }
      if (next === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  const handleClearAll = useCallback(() => setQtyByKey({}), []);

  const handleCheckout = useCallback(() => {
    if (orderLines.length === 0) {
      toast.show("Enter a quantity on at least one product.", "error");
      return;
    }
    const items = orderLines.map((r) => ({ product: r.product, variant: r.variant, qty: qtyByKey[r.key] ?? 0 }));
    cart.addMany(items);
    toast.show(`Added ${totalQty} items to cart`, "success");
    navigate("/checkout");
  }, [orderLines, qtyByKey, totalQty, cart, toast, navigate]);

  return (
    <div className="boc2-page">

      {/* ── Top search bar ── */}
      <div className="boc2-topbar">
        <div className="boc2-search-wrap">
          <svg className="boc2-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            className="boc2-search-input"
            placeholder="Search products… (press / to focus)"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            aria-label="Search products"
          />
          {searchRaw && (
            <button
              type="button"
              className="boc2-search-clear"
              onClick={() => { setSearchRaw(""); searchRef.current?.focus(); }}
              aria-label="Clear search"
            >×</button>
          )}
        </div>
      </div>

      {/* ── Main three-panel body ── */}
      <div className="boc2-shell">

        {/* Left: category sidebar (desktop) + chip strip (mobile) */}
        <CategorySidebar
          groups={allGroups}
          stats={categoryStats}
          active={activeCategorySlug}
          onSelect={setActiveCategorySlug}
        />

        {/* Centre: scrollable product grid */}
        <main className="boc2-main">
          {error && <div className="boc2-error">Could not load catalog: {error}</div>}
          {loading ? (
            <p className="muted boc2-loading">Loading catalog…</p>
          ) : visibleGroups.length === 0 ? (
            <p className="muted boc2-loading">No products match your filters.</p>
          ) : (
            visibleGroups.map((group) => (
              <section key={group.slug} className="boc2-group">
                <h2 className="boc2-group-heading">
                  {group.name}
                  <span className="boc2-group-count">{group.entries.length}</span>
                </h2>
                <div className="boc2-product-grid">
                  {group.entries.map((entry) => (
                    <ProductCard
                      key={entry.productId}
                      entry={entry}
                      qtyByKey={qtyByKey}
                      onChange={handleChange}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>

        {/* Right: order summary (desktop) */}
        <OrderSummary
          orderLines={orderLines}
          qtyByKey={qtyByKey}
          showSelected={showSelected}
          onToggleSelected={() => setShowSelected((v) => !v)}
          onClearAll={handleClearAll}
          onCheckout={handleCheckout}
        />
      </div>

      {/* Mobile floating checkout bar */}
      <div
        className={`boc2-mobile-bar${orderLines.length > 0 ? " boc2-mobile-bar--visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className="boc2-mobile-bar-info">
          {orderLines.length} item{orderLines.length !== 1 ? "s" : ""} · {inr(subTotal)}
        </span>
        <button
          type="button"
          className="btn btn-green boc2-mobile-checkout"
          disabled={orderLines.length === 0}
          onClick={handleCheckout}
        >
          Checkout →
        </button>
      </div>

    </div>
  );
};
