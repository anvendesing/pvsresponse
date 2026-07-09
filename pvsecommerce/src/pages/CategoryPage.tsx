// Category listing page — paginated fallback.
// Live version (infinite scroll): /category/:slug

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCatalog } from "@/state/CatalogContext";
import { useCategories } from "@/state/CategoriesContext";
import { usePlatform } from "@/state/PlatformContext";
import { ProductCard } from "@/components/ProductCard";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/assets/icons";

const PAGE_SIZE = 9;

const productInStock = (p: { inStock: boolean; variants: { inStock: boolean }[] }): boolean => {
  if (p.variants.length > 0) return p.variants.some((v) => v.inStock);
  return p.inStock;
};

export const CategoryPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { bySlug, categories, loading: categoriesLoading } = useCategories();
  const cat = slug ? bySlug.get(slug) : undefined;
  const { products, loading: productsLoading, error } = useCatalog();
  const { isPhone } = usePlatform();

  const [showInStock, setShowInStock] = useState(true);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"default" | "price-asc" | "price-desc">("default");

  useEffect(() => { setPage(1); }, [slug]);

  // Lock body scroll when filter sheet is open
  useEffect(() => {
    if (filterOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [filterOpen]);

  const inBucket = useMemo(() => {
    if (!cat) return [];
    return products.filter((p) => p.categorySlug === cat.slug);
  }, [products, cat]);

  const filtered = useMemo(() => {
    let list = inBucket.filter((p) => {
      const inStock = productInStock(p);
      if (inStock && !showInStock) return false;
      if (!inStock && !showOutOfStock) return false;
      return true;
    });
    if (sortOrder === "price-asc") list = [...list].sort((a, b) => a.sellingPrice - b.sellingPrice);
    if (sortOrder === "price-desc") list = [...list].sort((a, b) => b.sellingPrice - a.sellingPrice);
    return list;
  }, [inBucket, showInStock, showOutOfStock, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!cat && categoriesLoading) {
    return (
      <div className="listing-page">
        <div className={`listing-row${isPhone ? " listing-row--mobile" : ""}`}>
          {!isPhone && (
            <aside className="listing-sidebar">
              <div className="sidebar-block-title">Categories</div>
              <ul className="sidebar-category-links">
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i}><span className="muted">Loading…</span></li>
                ))}
              </ul>
            </aside>
          )}
          <div className="listing-grid-area">
            <div className="listing-toolbar">
              <h1 className="listing-grid-title">&nbsp;</h1>
            </div>
            <div className="listing-products-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="product-card" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!cat) {
    return (
      <div className="listing-page">
        <div className="listing-row" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card-soft" style={{ textAlign: "center" }}>
            <h2>Category not found</h2>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              We don't carry "{slug}".
            </p>
            {categories.length > 0 && (
              <>
                <p className="muted" style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
                  Try one of these instead:
                </p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginTop: "0.65rem" }}>
                  {categories.map((c) => (
                    <Link key={c.id} to={`/category-paginated/${c.slug}`} className="btn" style={{ padding: "0.4rem 0.85rem", fontSize: "0.85rem" }}>
                      {c.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <button type="button" className="btn btn-green" style={{ marginTop: "1.25rem" }} onClick={() => navigate("/")}>
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="listing-page">
      <div className="listing-preview-banner">
        Paginated view —{" "}
        <Link to={`/category/${cat.slug}`}>switch to live infinite scroll</Link>
      </div>
      {isPhone ? (
        /* ── Mobile layout ─────────────────────────────────────── */
        <>
          {/* Sticky filter/sort bar */}
          <div className="mobile-filter-bar">
            <button
              type="button"
              className="mobile-filter-btn"
              onClick={() => setFilterOpen(true)}
              aria-label="Open filters"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="4" y1="6" x2="16" y2="6" />
                <line x1="8" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="12" y2="18" />
              </svg>
              Filters
              {(!showInStock || showOutOfStock) && <span className="mobile-filter-dot" />}
            </button>

            <div className="mobile-sort-row">
              <label htmlFor="sort-select" className="sr-only">Sort by</label>
              <select
                id="sort-select"
                className="mobile-sort-select"
                value={sortOrder}
                onChange={(e) => { setSortOrder(e.target.value as typeof sortOrder); setPage(1); }}
              >
                <option value="default">Sort: Default</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            </div>

            <span className="mobile-filter-count muted">
              {filtered.length} {filtered.length === 1 ? "product" : "products"}
            </span>
          </div>

          {/* Grid */}
          <div className="listing-grid-area listing-grid-area--mobile">
            <h1 className="listing-grid-title listing-grid-title--mobile">{cat.name}</h1>

            {error && (
              <div className="card-soft" style={{ marginBottom: "1rem", color: "var(--color-error)", background: "#fef2f2" }}>
                Could not load catalog: {error}
              </div>
            )}

            {productsLoading ? (
              <div className="listing-products-grid">
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="product-card" />)}
              </div>
            ) : visible.length === 0 ? (
              <div className="card-soft" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
                <p className="muted">No products match these filters. Try adjusting them.</p>
              </div>
            ) : (
              <div className="listing-products-grid">
                {visible.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            )}

            {pageCount > 1 && <Pagination page={currentPage} pageCount={pageCount} setPage={setPage} />}
          </div>

          {/* Filter bottom sheet */}
          {filterOpen && (
            <>
              <div className="filter-sheet-backdrop" onClick={() => setFilterOpen(false)} aria-hidden="true" />
              <div className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filters">
                <div className="filter-sheet__header">
                  <h2 className="filter-sheet__title">Filters</h2>
                  <button
                    type="button"
                    className="filter-sheet__close"
                    onClick={() => setFilterOpen(false)}
                    aria-label="Close filters"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="filter-sheet__body">
                  <div className="filter-sheet__section-title">Categories</div>
                  <div className="filter-sheet__chips">
                    {categories.map((c) => (
                      <Link
                        key={c.id}
                        to={`/category-paginated/${c.slug}`}
                        className={`filter-chip${c.slug === cat.slug ? " active" : ""}`}
                        onClick={() => setFilterOpen(false)}
                      >
                        {c.name}
                      </Link>
                    ))}
                  </div>

                  <div className="filter-sheet__section-title" style={{ marginTop: "1.25rem" }}>Availability</div>
                  <div className="filter-sheet__check-group">
                    <CheckboxRow
                      checked={showInStock}
                      label="In Stock"
                      onToggle={() => { setShowInStock((v) => !v); setPage(1); }}
                    />
                    <CheckboxRow
                      checked={showOutOfStock}
                      label="Out of Stock"
                      onToggle={() => { setShowOutOfStock((v) => !v); setPage(1); }}
                    />
                  </div>
                </div>

                <div className="filter-sheet__footer">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => { setShowInStock(true); setShowOutOfStock(false); setSortOrder("default"); setPage(1); }}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn btn-green"
                    onClick={() => setFilterOpen(false)}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        /* ── Desktop layout ─────────────────────────────────────── */
        <div className="listing-row">
          <aside className="listing-sidebar">
            <div className="sidebar-block-title">Categories</div>
            <ul className="sidebar-category-links">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link to={`/category-paginated/${c.slug}`} className={c.slug === cat.slug ? "active" : ""}>
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="sidebar-block-title" style={{ marginTop: "1rem" }}>Availability</div>
            <CheckboxRow
              checked={showInStock}
              label="In Stock"
              onToggle={() => { setShowInStock((v) => !v); setPage(1); }}
            />
            <CheckboxRow
              checked={showOutOfStock}
              label="Out of Stock"
              onToggle={() => { setShowOutOfStock((v) => !v); setPage(1); }}
            />
          </aside>

          <div className="listing-grid-area">
            <div className="listing-toolbar">
              <h1 className="listing-grid-title">{cat.name}</h1>
              <span className="muted">
                {filtered.length} {filtered.length === 1 ? "product" : "products"}
              </span>
            </div>

            {error && (
              <div className="card-soft" style={{ marginBottom: "1rem", color: "var(--color-error)", background: "#fef2f2" }}>
                Could not load catalog: {error}
              </div>
            )}

            {productsLoading ? (
              <div className="listing-products-grid">
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="product-card" />)}
              </div>
            ) : visible.length === 0 ? (
              <div className="card-soft" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
                <p className="muted">
                  No products in this category yet. Check back soon — we add new farm-fresh items every week.
                </p>
              </div>
            ) : (
              <div className="listing-products-grid">
                {visible.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            )}

            {pageCount > 1 && <Pagination page={currentPage} pageCount={pageCount} setPage={setPage} />}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Helpers ──────────────────────────────────────────────────── */

const Pagination = ({
  page,
  pageCount,
  setPage,
}: {
  page: number;
  pageCount: number;
  setPage: (p: number | ((prev: number) => number)) => void;
}) => (
  <div className="pagination">
    <button
      type="button"
      className="pagination-btn"
      onClick={() => setPage((p) => Math.max(1, p - 1))}
      disabled={page === 1}
      aria-label="Previous page"
    >
      <ChevronLeftIcon />
    </button>
    {Array.from({ length: pageCount }).map((_, i) => (
      <button
        key={i}
        type="button"
        className={`pagination-btn ${i + 1 === page ? "active" : ""}`}
        onClick={() => setPage(i + 1)}
      >
        {i + 1}
      </button>
    ))}
    <button
      type="button"
      className="pagination-btn"
      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
      disabled={page === pageCount}
      aria-label="Next page"
    >
      <ChevronRightIcon />
    </button>
  </div>
);

const CheckboxRow = ({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className={`filter-checkbox-row ${checked ? "checked" : ""}`}
    onClick={onToggle}
    style={{ width: "100%", textAlign: "left", background: "transparent" }}
  >
    <span className="check">{checked && <CheckIcon />}</span>
    <span>{label}</span>
  </button>
);
